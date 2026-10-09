// Runtime configuration for the Image Studio container.
//
// The same image runs in one of three explicit modes:
//   - "platform":   mounted by skillsmaster under /apps/image-studio/*. Serves static
//                   assets, /healthz and /runtime-config.json only. Never opens a local
//                   database, storage directory or AI key.
//   - "standalone": serves the static app plus a local project API backed by SQLite and
//                   a storage directory, and optionally proxies AI calls to skillsmaster
//                   with a server-side customer key that the browser never sees.
//
//   - "hosted":     independent origin, REST identity, and per-user application storage.
//                   Never holds a platform customer key or account database.
//
// The mode comes from the JSON file named by IMAGE_STUDIO_CONFIG. Without that variable
// it comes from SKILLSMASTER_MODE, which the skillsmaster Module Manager injects into
// platform containers, or IMAGE_STUDIO_MODE (the image defaults it to "platform").
// SKILLSMASTER_MODE must agree with whichever source decides the mode, so a host that
// mounts the image as a platform module can never end up running it standalone.
// There is no implicit fallback between the two modes.
import fs from "node:fs";
import path from "node:path";

export const MODES = Object.freeze(["platform", "standalone", "hosted"]);

const DEFAULTS = Object.freeze({
  platform: { port: 8080 },
  standalone: { port: 80 },
  hosted: { port: 8080 },
});

export const DEFAULT_SKILLSMASTER_BASE_URL = "https://api.skillsmaster.jp";
export const DEFAULT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const DEFAULT_MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

export const MIN_ACCESS_TOKEN_LENGTH = 32;

export class ConfigError extends Error {}

/** Loads and validates configuration from the process environment. */
export function loadConfig(env = process.env) {
  const file = env.IMAGE_STUDIO_CONFIG?.trim();
  let raw;
  if (file) {
    let text;
    try { text = fs.readFileSync(file, "utf8"); }
    catch (error) { throw new ConfigError(`Cannot read config file ${file}: ${error.message}`); }
    try { raw = JSON.parse(text); }
    catch (error) { throw new ConfigError(`Config file ${file} is not valid JSON: ${error.message}`); }
  } else {
    const envModes = [env.SKILLSMASTER_MODE, env.IMAGE_STUDIO_MODE].map((value) => value?.trim()).filter(Boolean);
    if (!envModes.length && env.IMAGE_STUDIO_DEFAULT_MODE) envModes.push(env.IMAGE_STUDIO_DEFAULT_MODE.trim());
    if (envModes.length === 0) {
      throw new ConfigError("Set IMAGE_STUDIO_CONFIG to a config file or SKILLSMASTER_MODE / IMAGE_STUDIO_MODE to platform|standalone|hosted");
    }
    if (new Set(envModes).size > 1) throw new ConfigError("SKILLSMASTER_MODE and IMAGE_STUDIO_MODE disagree");
    raw = { mode: envModes[0] };
  }
  const platformMode = env.SKILLSMASTER_MODE?.trim();
  if (platformMode && raw && typeof raw === "object" && raw.mode !== platformMode) {
    throw new ConfigError(`SKILLSMASTER_MODE=${platformMode} does not match the configured mode`);
  }
  return normalizeConfig(raw, env);
}

export function normalizeConfig(raw, env = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ConfigError("Config must be a JSON object");
  const mode = raw.mode;
  if (!MODES.includes(mode)) throw new ConfigError(`Config "mode" must be one of: ${MODES.join(", ")}`);

  const server = objectOrEmpty(raw.server, "server");
  const port = integer(env.PORT ?? server.port ?? DEFAULTS[mode].port, "server.port", 1, 65535);
  const host = string(server.host ?? "0.0.0.0", "server.host");
  const staticDir = path.resolve(string(env.IMAGE_STUDIO_STATIC_DIR ?? server.staticDir ?? "dist", "server.staticDir"));

  if (mode === "platform") {
    // A platform module never holds project data or long-lived credentials.
    for (const key of ["storage", "ai", "access"]) {
      if (raw[key] !== undefined && raw[key] !== null) throw new ConfigError(`"${key}" is not allowed in platform mode`);
    }
    if (env.IMAGE_STUDIO_ACCESS_TOKEN_FILE) throw new ConfigError("Platform mode must not be given an access token; the platform owns authentication");
    if (env.SKILLSMASTER_CUSTOMER_KEY || env.SKILLSMASTER_CUSTOMER_KEY_FILE) {
      throw new ConfigError("Platform mode must not be given a skillsmaster customer key");
    }
    return Object.freeze({ mode, server: Object.freeze({ port, host, staticDir }) });
  }

  if (mode === "hosted") {
    for (const key of ["ai", "access"]) {
      if (raw[key] != null) throw new ConfigError(`"${key}" is not allowed in hosted mode`);
    }
    for (const key of ["SKILLSMASTER_CUSTOMER_KEY", "SKILLSMASTER_CUSTOMER_KEY_FILE", "IMAGE_STUDIO_ACCESS_TOKEN_FILE"]) {
      if (env[key]) throw new ConfigError(`${key} is not allowed in hosted mode`);
    }
    const identity = objectOrEmpty(raw.identity, "identity");
    const publicOrigin = hostedOrigin(env.WEB_APP_PUBLIC_ORIGIN ?? env.IMAGE_STUDIO_PUBLIC_ORIGIN ?? identity.publicOrigin, "identity.publicOrigin");
    const platformOrigin = hostedOrigin(env.SKILLSMASTER_API_BASE_URL ?? identity.platformOrigin, "identity.platformOrigin");
    if (publicOrigin === platformOrigin) throw new ConfigError("Hosted Image Studio must use an origin distinct from the platform");
    const storage = objectOrEmpty(raw.storage, "storage");
    const rootDir = path.resolve(string(env.WEB_APP_DATA_DIR ?? env.IMAGE_STUDIO_DATA_DIR ?? storage.rootDir ?? "/data/image-studio", "storage.rootDir"));
    return Object.freeze({ mode, server: Object.freeze({ port, host, staticDir }),
      identity: Object.freeze({ publicOrigin, platformOrigin, moduleId: "image-studio" }),
      storage: Object.freeze({ rootDir,
        maxUploadBytes: integer(storage.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES, "storage.maxUploadBytes", 1024, 512 * 1024 * 1024),
        maxDocumentBytes: integer(storage.maxDocumentBytes ?? DEFAULT_MAX_DOCUMENT_BYTES, "storage.maxDocumentBytes", 1024, 256 * 1024 * 1024),
      }),
    });
  }

  const storage = objectOrEmpty(raw.storage, "storage");
  const databasePath = path.resolve(string(storage.databasePath ?? "/data/db/image-studio.sqlite", "storage.databasePath"));
  const dataDir = path.resolve(string(storage.dataDir ?? "/data/storage", "storage.dataDir"));
  const maxUploadBytes = integer(storage.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES, "storage.maxUploadBytes", 1024, 512 * 1024 * 1024);
  const maxDocumentBytes = integer(storage.maxDocumentBytes ?? DEFAULT_MAX_DOCUMENT_BYTES, "storage.maxDocumentBytes", 1024, 256 * 1024 * 1024);

  const access = objectOrEmpty(raw.access, "access");
  let basicAuth = null;
  if (access.basicAuth) {
    const auth = objectOrEmpty(access.basicAuth, "access.basicAuth");
    const username = string(auth.username, "access.basicAuth.username");
    const passwordFile = string(auth.passwordFile, "access.basicAuth.passwordFile");
    const password = readSecretFile(passwordFile, "access.basicAuth.passwordFile");
    basicAuth = Object.freeze({ username, password });
  }
  // Remote access token: browsers exchange it once for an HttpOnly session cookie,
  // scripts send it as `Authorization: Bearer <token>`.
  let token = null;
  const tokenFile = env.IMAGE_STUDIO_ACCESS_TOKEN_FILE ?? access.tokenFile;
  if (tokenFile) {
    token = readSecretFile(string(tokenFile, "access.tokenFile"), "access.tokenFile");
    if (token.length < MIN_ACCESS_TOKEN_LENGTH) throw new ConfigError(`access.tokenFile must contain at least ${MIN_ACCESS_TOKEN_LENGTH} characters`);
  }
  const sessionHours = integer(access.sessionHours ?? 12, "access.sessionHours", 1, 24 * 30);
  const secureCookie = boolean(access.secureCookie ?? false, "access.secureCookie");
  // Without access control only loopback Host names are served. Extra names are for a
  // trusted reverse proxy that performs its own authentication.
  const allowedHosts = access.allowedHosts ?? [];
  if (!Array.isArray(allowedHosts) || allowedHosts.some((host) => typeof host !== "string" || !host.trim())) {
    throw new ConfigError('"access.allowedHosts" must be an array of host names');
  }

  // AI is on by default and talks to skillsmaster.jp. The customer key either comes from
  // the deployment (ai.customerKeyFile / ai.customerKeyEnv, read-only in the UI) or is
  // entered in Settings → API Key and stored server-side under the storage volume.
  const ai = objectOrEmpty(raw.ai, "ai");
  const aiEnabled = ai.enabled !== false;
  let aiConfig = Object.freeze({ enabled: false, reason: "AI is disabled for this Image Studio installation" });
  if (aiEnabled) {
    const baseUrl = parseBaseUrl(string(env.SKILLSMASTER_API_BASE_URL ?? ai.baseUrl ?? DEFAULT_SKILLSMASTER_BASE_URL, "ai.baseUrl"));
    const keyFile = env.SKILLSMASTER_CUSTOMER_KEY_FILE ?? ai.customerKeyFile;
    const keyEnv = ai.customerKeyEnv ? string(ai.customerKeyEnv, "ai.customerKeyEnv") : null;
    let configuredKey = null;
    if (keyFile) configuredKey = readSecretFile(keyFile, "ai.customerKeyFile");
    else if (keyEnv) {
      configuredKey = env[keyEnv]?.trim() || null;
      if (!configuredKey) throw new ConfigError(`ai.customerKeyEnv names ${keyEnv}, which is empty`);
    }
    aiConfig = Object.freeze({
      enabled: true,
      baseUrl,
      configuredKey,
      keyStorePath: path.join(dataDir, "settings", "skillsmaster-api-key"),
      manifestPath: string(ai.manifestPath ?? "/mode-manifest", "ai.manifestPath"),
      runsPath: string(ai.runsPath ?? "/v1/runs", "ai.runsPath"),
      requestTimeoutMs: integer(ai.requestTimeoutMs ?? 60_000, "ai.requestTimeoutMs", 1000, 600_000),
      // Set true only after confirming that the skillsmaster runs API deduplicates
      // submissions by Idempotency-Key. Otherwise a submission whose outcome is unknown
      // (timeout, crash, 5xx) is never resent automatically.
      idempotentSubmit: boolean(ai.idempotentSubmit ?? false, "ai.idempotentSubmit"),
    });
  }

  return Object.freeze({
    mode,
    server: Object.freeze({ port, host, staticDir }),
    storage: Object.freeze({ databasePath, dataDir, maxUploadBytes, maxDocumentBytes }),
    access: Object.freeze({
      basicAuth, token, sessionHours, secureCookie,
      allowedHosts: Object.freeze(allowedHosts.map((host) => host.trim().toLowerCase())),
    }),
    ai: aiConfig,
  });
}

function parseBaseUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new ConfigError("ai.baseUrl must be an absolute URL"); }
  if (!["http:", "https:"].includes(url.protocol)) throw new ConfigError("ai.baseUrl must use http or https");
  if (url.username || url.password) throw new ConfigError("ai.baseUrl must not embed credentials");
  return url.toString().replace(/\/+$/, "");
}

function hostedOrigin(value, name) {
  const input = string(value, name);
  let url;
  try { url = new URL(input); } catch { throw new ConfigError(`${name} must be an absolute origin`); }
  const local = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !local) || url.origin !== input || url.username || url.password) {
    throw new ConfigError(`${name} must be an HTTPS origin (loopback HTTP is allowed for development)`);
  }
  return url.origin;
}

function readSecretFile(file, label) {
  let value;
  try { value = fs.readFileSync(file, "utf8").trim(); }
  catch (error) { throw new ConfigError(`Cannot read ${label} (${file}): ${error.message}`); }
  if (!value) throw new ConfigError(`${label} (${file}) is empty`);
  return value;
}

function boolean(value, label) {
  if (typeof value !== "boolean") throw new ConfigError(`"${label}" must be true or false`);
  return value;
}

function objectOrEmpty(value, label) {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new ConfigError(`"${label}" must be an object`);
  return value;
}

function string(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new ConfigError(`"${label}" must be a non-empty string`);
  return value.trim();
}

function integer(value, label, min, max) {
  const number = typeof value === "string" ? Number(value) : value;
  if (!Number.isInteger(number) || number < min || number > max) throw new ConfigError(`"${label}" must be an integer between ${min} and ${max}`);
  return number;
}
