// Standalone AI adapter: proxies mode manifest, run submission, polling and result
// delivery to the skillsmaster customer API using a server-side X-Customer-Key.
//
// It deliberately does NOT call the platform-only /image-studio/projects/:id/operations
// pre-registration API and never sends X-Image-Studio-Operation-Id. The operation id is
// recorded locally and reused as the upstream Idempotency-Key, and result bytes are
// persisted under the storage volume so a reconnect or restart can still deliver them.
import fs from "node:fs";
import path from "node:path";
import { StoreError } from "./store.mjs";
import { sniffImage } from "./images.mjs";

const MAX_RESULT_BYTES = 128 * 1024 * 1024;
const FIELD_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const RESERVED_FIELDS = new Set(["mode", "file", "operation", "mask_field"]);

export class AiUnavailableError extends StoreError {
  constructor(message, status = 503) { super(status, message); }
}

const NOT_SENT_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH"]);

export const NO_KEY_REASON = "No skillsmaster API key is configured. Add one in Settings → API Key.";
const API_KEY_PATTERN = /^[\x21-\x7e]{8,512}$/;

export function createAiProxy({ ai, store, appSessionToken = null, fetchImpl = globalThis.fetch }) {
  const enabled = ai.enabled === true;
  const keys = enabled ? (appSessionToken
    ? { current: () => appSessionToken, source: () => "config" }
    : createKeyStore(ai)) : null;

  function requireEnabled() {
    if (!enabled) throw new AiUnavailableError(ai.reason ?? "AI is disabled for this Image Studio installation");
  }

  function requireKey() {
    requireEnabled();
    const key = keys.current();
    if (!key) throw new AiUnavailableError(NO_KEY_REASON);
    return key;
  }

  async function upstream(pathname, init = {}, key = requireKey()) {
    const url = new URL(pathname, `${ai.baseUrl}/`);
    const credentials = appSessionToken ? { Authorization: `Bearer ${key}` } : { "X-Customer-Key": key };
    return request(url, { ...init, headers: { ...init.headers, ...credentials } });
  }

  async function request(url, init) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ai.requestTimeoutMs ?? 60_000);
    try {
      return await fetchImpl(url, { ...init, signal: controller.signal, redirect: "manual" });
    } catch (error) {
      const unavailable = new AiUnavailableError("The skillsmaster AI API could not be reached", 502);
      // Connection setup failures prove the request never left this container.
      unavailable.notSent = NOT_SENT_CODES.has(error?.cause?.code ?? error?.code);
      throw unavailable;
    } finally {
      clearTimeout(timer);
    }
  }

  function manifestUrl(language) {
    const query = language ? `?lang=${encodeURIComponent(language)}` : "";
    return `${ai.manifestPath.replace(/^\//, "")}${query}`;
  }

  return {
    status() {
      if (!enabled) return { enabled: false, reason: ai.reason };
      return keys.current() ? { enabled: true } : { enabled: false, reason: NO_KEY_REASON };
    },

    /** Settings view for the browser. Never includes the key itself, only its last 4 characters. */
    settings() {
      if (!enabled) return { enabled: false, reason: ai.reason, baseUrl: null, keySource: "none", keyHint: null, editable: false };
      const source = keys.source();
      const key = keys.current();
      return {
        enabled: true, baseUrl: ai.baseUrl, keySource: source, keyHint: key ? `…${key.slice(-4)}` : null,
        // A key provided by the deployment (file/env) is managed outside the UI.
        editable: source !== "config",
      };
    },

    /**
     * Validates the key against skillsmaster before storing it. A key the API rejects
     * (401/403) is not saved; if skillsmaster is unreachable the key is saved unverified.
     */
    async saveApiKey(value) {
      requireEnabled();
      if (keys.source() === "config") throw new StoreError(409, "The API key is managed by the server configuration file");
      const key = typeof value === "string" ? value.trim() : "";
      if (!API_KEY_PATTERN.test(key)) throw new StoreError(400, "Enter the API key exactly as issued by skillsmaster.jp");
      let verified = false;
      let warning;
      try {
        const response = await upstream(manifestUrl(""), {}, key);
        if (response.status === 401 || response.status === 403) throw new StoreError(422, "skillsmaster.jp rejected this API key");
        verified = response.ok;
        if (!response.ok) warning = `skillsmaster.jp answered ${response.status}; the key was saved without verification`;
      } catch (error) {
        if (error instanceof StoreError && error.status === 422) throw error;
        warning = "skillsmaster.jp could not be reached; the key was saved without verification";
      }
      keys.save(key);
      return { ...this.settings(), verified, ...(warning ? { warning } : {}) };
    },

    deleteApiKey() {
      requireEnabled();
      if (keys.source() === "config") throw new StoreError(409, "The API key is managed by the server configuration file");
      keys.remove();
      return this.settings();
    },

    async manifest(language) {
      const response = await upstream(manifestUrl(language));
      const body = await safeJson(response);
      if (response.status === 401 || response.status === 403) throw new AiUnavailableError("skillsmaster.jp rejected the configured API key. Update it in Settings → API Key.", 502);
      if (!response.ok) throw new AiUnavailableError(upstreamDetail(body, `AI mode manifest failed (${response.status})`, [keys?.current()]), 502);
      return body;
    },

    /** form: a parsed multipart FormData with `operation` (JSON), `file` and optional `mask_field` + `mask`. */
    async submit(projectId, form) {
      requireKey();
      let input;
      try { input = JSON.parse(String(form.get("operation") ?? "")); }
      catch { throw new StoreError(400, "operation must be a JSON field"); }
      const operation = store.prepareOperation(projectId, input);
      if (operation.runId) return { runId: operation.runId, operation };
      if (operation.submission === "unknown" && !ai.idempotentSubmit) {
        throw new StoreError(409, operation.error ?? "It is unknown whether this AI edit reached skillsmaster; start a new edit instead");
      }
      if (operation.submission === "rejected" || operation.status === "failed") {
        throw new StoreError(409, "This AI edit already failed; start a new edit to try again");
      }
      if (operation.submission === "sent") throw new StoreError(409, "This AI edit is already being submitted");

      const file = form.get("file");
      if (!(file instanceof Blob) || !file.size) throw new StoreError(400, "file is required");
      const maskField = form.get("mask_field");
      const mask = form.get("mask");
      if (maskField !== null && (typeof maskField !== "string" || !FIELD_NAME.test(maskField) || RESERVED_FIELDS.has(maskField) || !(mask instanceof Blob))) {
        throw new StoreError(400, "Invalid mask input");
      }

      const body = new FormData();
      body.append("mode", operation.mode);
      body.append("file", file, "image.png");
      if (maskField) body.append(maskField, mask, "mask.png");
      for (const [key, value] of Object.entries(operation.parameters)) {
        if (value !== "" && !RESERVED_FIELDS.has(key) && key !== maskField) body.append(key, value);
      }

      // Recorded before the request leaves, so a crash from here on is detected at startup.
      store.updateOperation(operation.id, { submission: "sent", status: "submitting", error: null });
      let response;
      try {
        response = await upstream(ai.runsPath.replace(/^\//, ""), { method: "POST", headers: { "Idempotency-Key": operation.id }, body });
      } catch (error) {
        if (error.notSent) {
          store.updateOperation(operation.id, { submission: "pending", status: "submitting", error: error.message });
          throw error;
        }
        // The request may have been accepted before the connection failed or timed out.
        store.markSubmissionUnknown(operation.id, "The connection to skillsmaster failed while submitting this AI edit", { idempotentSubmit: ai.idempotentSubmit });
        throw error;
      }
      const result = await safeJson(response);
      if (response.ok && typeof result.run_id === "string" && result.run_id) {
        const updated = store.updateOperation(operation.id, { runId: result.run_id, submission: "accepted", status: "running", error: null });
        return { runId: result.run_id, operation: updated };
      }
      if (response.status >= 400 && response.status < 500) {
        // A 4xx is a definite rejection: nothing was started upstream.
        const message = upstreamDetail(result, `AI run submission failed (${response.status})`, [keys?.current()]);
        store.updateOperation(operation.id, { submission: "rejected", status: "failed", error: message });
        throw new StoreError(clientStatus(response.status), message);
      }
      // 5xx or a success without a run id: the upstream may still have started the run.
      const reason = upstreamDetail(result, `skillsmaster answered ${response.status} without a run id while submitting this AI edit`, [keys?.current()]);
      store.markSubmissionUnknown(operation.id, reason.replace(/\.$/, ""), { idempotentSubmit: ai.idempotentSubmit });
      throw new StoreError(502, store.getOperation(operation.id).error);
    },

    async runStatus(runId) {
      const operation = requireOperation(runId);
      if (store.hasResult(operation)) return { status: "success", resultReady: true };
      if (operation.status === "failed") return { status: "failed", resultReady: false, message: operation.error ?? undefined };
      const response = await upstream(`${ai.runsPath.replace(/^\//, "")}/${encodeURIComponent(runId)}`);
      const body = await safeJson(response);
      if (!response.ok) throw new StoreError(clientStatus(response.status), upstreamDetail(body, `AI run status failed (${response.status})`, [keys?.current()]));
      const status = String(body.status ?? "unknown");
      const message = typeof body.message === "string" && !body.message.includes(keys.current()) ? body.message.slice(0, 500) : undefined;
      if (status === "failed") store.updateOperation(operation.id, { status: "failed", error: message ?? "AI image edit failed" });
      return { status, resultReady: body.result_ready === true, ...(message ? { message } : {}) };
    },

    /** Returns { path, mimeType } of the persisted result, downloading it once if needed. */
    async result(runId) {
      let operation = requireOperation(runId);
      if (!store.hasResult(operation)) {
        const response = await upstream(`${ai.runsPath.replace(/^\//, "")}/${encodeURIComponent(runId)}/result`);
        const body = await safeJson(response);
        if (!response.ok || typeof body.url !== "string") {
          throw new StoreError(clientStatus(response.status), upstreamDetail(body, `AI result delivery failed (${response.status})`, [keys?.current()]));
        }
        const target = new URL(typeof body.content_url === "string" ? body.content_url : body.url, `${ai.baseUrl}/`);
        // Only send the customer key back to the configured API origin, never to a storage URL.
        const sameOrigin = target.origin === new URL(ai.baseUrl).origin;
        const artifact = sameOrigin
          ? await upstream(target.toString())
          : await request(target, {});
        if (!artifact.ok) {
          store.updateOperation(operation.id, { status: "delivery-failed", error: `AI result download failed (${artifact.status})` });
          throw new StoreError(502, `AI result download failed (${artifact.status})`);
        }
        const bytes = Buffer.from(await artifact.arrayBuffer());
        if (bytes.length > MAX_RESULT_BYTES) throw new StoreError(502, "AI result is too large");
        const image = sniffImage(bytes);
        if (!image) throw new StoreError(502, "AI result is not a supported image");
        operation = store.writeResult(operation, bytes, image.mimeType);
      }
      return { path: store.resultPath(operation), mimeType: operation.resultMimeType, exists: fs.existsSync(store.resultPath(operation)) };
    },
  };

  function requireOperation(runId) {
    const operation = typeof runId === "string" ? store.getOperationByRun(runId) : null;
    if (!operation) throw new StoreError(404, "Unknown AI run");
    return operation;
  }
}

/** Customer key holder: deployment-provided key wins; otherwise the key saved from Settings. */
function createKeyStore(ai) {
  const file = ai.keyStorePath;
  let saved = readSaved();

  function readSaved() {
    try { return fs.readFileSync(file, "utf8").trim() || null; } catch { return null; }
  }

  return {
    current: () => ai.configuredKey ?? saved,
    source: () => (ai.configuredKey ? "config" : saved ? "settings" : "none"),
    save(key) {
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      const temp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(temp, `${key}\n`, { mode: 0o600 });
      fs.renameSync(temp, file);
      saved = key;
    },
    remove() {
      fs.rmSync(file, { force: true });
      saved = null;
    },
  };
}

async function safeJson(response) {
  try { return await response.json(); } catch { return {}; }
}

function upstreamDetail(body, fallback, secrets = []) {
  if (typeof body?.detail !== "string" || body.detail.length > 500) return fallback;
  // An upstream message must never carry a customer key back to the browser or the logs.
  return secrets.some((secret) => secret && body.detail.includes(secret)) ? fallback : body.detail;
}

/** Upstream auth failures concern the server's key, not the browser: report them as 502. */
function clientStatus(status) {
  if (status === 401 || status === 403) return 502;
  if (status >= 400 && status < 500) return status;
  return 502;
}
