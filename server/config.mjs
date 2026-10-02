// Runtime configuration for the Image Studio container.
//
// The same image runs in one of two explicit modes:
//   - "platform":   mounted by skillsmaster under /apps/image-studio/*. Serves static
//                   assets, /healthz and /runtime-config.json only. Never opens a local
//                   database, storage directory or AI key.
//   - "standalone": serves the static app plus a local project API backed by SQLite and
//                   a storage directory, and optionally proxies AI calls to skillsmaster
//                   with a server-side customer key that the browser never sees.
//
// The mode comes from the JSON file named by IMAGE_STUDIO_CONFIG. Without that variable
// the mode must be given by IMAGE_STUDIO_MODE (the image defaults it to "platform").
// There is no implicit fallback between the two modes.
import fs from "node:fs";
import path from "node:path";

export const MODES = Object.freeze(["platform", "standalone"]);

const DEFAULTS = Object.freeze({
  platform: { port: 8080 },
  standalone: { port: 80 },
});

export const DEFAULT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const DEFAULT_MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

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
    if (!env.IMAGE_STUDIO_MODE) throw new ConfigError("Set IMAGE_STUDIO_CONFIG to a config file or IMAGE_STUDIO_MODE to platform|standalone");
    raw = { mode: env.IMAGE_STUDIO_MODE };
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
    if (env.SKILLSMASTER_CUSTOMER_KEY || env.SKILLSMASTER_CUSTOMER_KEY_FILE) {
      throw new ConfigError("Platform mode must not be given a skillsmaster customer key");
    }
    return Object.freeze({ mode, server: Object.freeze({ port, host, staticDir }) });
  }

  const storage = objectOrEmpty(raw.storage, "storage");
  const databasePath = path.resolve(string(storage.databasePath ?? "/var/lib/image-studio/db/image-studio.sqlite", "storage.databasePath"));
  const dataDir = path.resolve(string(storage.dataDir ?? "/var/lib/image-studio/storage", "storage.dataDir"));
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

  const ai = objectOrEmpty(raw.ai, "ai");
  const baseUrlValue = env.SKILLSMASTER_API_BASE_URL ?? ai.baseUrl;
  const keyFile = env.SKILLSMASTER_CUSTOMER_KEY_FILE ?? ai.customerKeyFile;
  const keyEnv = ai.customerKeyEnv ? string(ai.customerKeyEnv, "ai.customerKeyEnv") : null;
  const aiEnabled = ai.enabled === undefined ? Boolean(baseUrlValue) : ai.enabled === true;
  let aiConfig = Object.freeze({ enabled: false, reason: "AI is not configured for this Image Studio installation" });
  if (aiEnabled) {
    const baseUrl = parseBaseUrl(string(baseUrlValue, "ai.baseUrl"));
    let customerKey = null;
    if (keyFile) customerKey = readSecretFile(keyFile, "ai.customerKeyFile");
    else if (keyEnv) customerKey = env[keyEnv]?.trim() || null;
    if (!customerKey) throw new ConfigError("AI is enabled but no customer key was found (set ai.customerKeyFile or ai.customerKeyEnv)");
    aiConfig = Object.freeze({
      enabled: true,
      baseUrl,
      customerKey,
      manifestPath: string(ai.manifestPath ?? "/mode-manifest", "ai.manifestPath"),
      runsPath: string(ai.runsPath ?? "/v1/runs", "ai.runsPath"),
      requestTimeoutMs: integer(ai.requestTimeoutMs ?? 60_000, "ai.requestTimeoutMs", 1000, 600_000),
    });
  }

  return Object.freeze({
    mode,
    server: Object.freeze({ port, host, staticDir }),
    storage: Object.freeze({ databasePath, dataDir, maxUploadBytes, maxDocumentBytes }),
    access: Object.freeze({ basicAuth }),
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

function readSecretFile(file, label) {
  let value;
  try { value = fs.readFileSync(file, "utf8").trim(); }
  catch (error) { throw new ConfigError(`Cannot read ${label} (${file}): ${error.message}`); }
  if (!value) throw new ConfigError(`${label} (${file}) is empty`);
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
