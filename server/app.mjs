// HTTP handler shared by both runtime modes. Platform mode exposes only static assets,
// /healthz and /runtime-config.json; standalone mode adds the local project API and the
// server-side AI proxy.
import fs from "node:fs";
import path from "node:path";
import { StoreError } from "./store.mjs";
import { createAccessControl, loginPage, sameOrigin } from "./access.mjs";
import { ALLOWED_IMAGE_TYPES, imageWithinLimits, sniffImage } from "./images.mjs";

export const APP_BASE_PATH = "/apps/image-studio";

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".wasm": "application/wasm",
};

export function createHandler({ config, store = null, ai = null, accessControl = null, log = () => {} }) {
  const standalone = config.mode === "standalone";
  if (standalone && (!store || !ai)) throw new Error("Standalone mode requires a store and an AI adapter");
  const staticDir = config.server.staticDir;
  const access = standalone ? (accessControl ?? createAccessControl(config.access)) : null;

  return async function handle(req, res) {
    const started = Date.now();
    res.on("finish", () => log(`${req.method} ${safePath(req.url)} ${res.statusCode} ${Date.now() - started}ms`));
    setCommonHeaders(res);
    if (config.privateResponses) res.setHeader("Referrer-Policy", "no-referrer");
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const pathname = url.pathname;

      if (pathname === "/healthz") return sendJson(res, 200, { status: "ok", mode: config.mode });

      let via = null;
      if (standalone) {
        if (!access.hostAllowed(req)) {
          return sendJson(res, 403, { detail: "This Image Studio only accepts localhost requests. Configure access.tokenFile to allow remote access." });
        }
        if (pathname === `${APP_BASE_PATH}/session`) return await routeSession(req, res);
        via = access.authenticate(req);
        if (!via) return unauthenticated(req, res, pathname);
      }

      const appPath = stripBase(pathname);
      if (appPath === "/runtime-config.json") {
        res.setHeader("Cache-Control", "no-store");
        return sendJson(res, 200, standalone
          ? { mode: "standalone", ai: { available: ai.status().enabled } }
          : { mode: "platform" });
      }

      if (pathname.startsWith("/image-studio/") || pathname === "/image-studio" || pathname.startsWith("/local-ai/")) {
        // Platform mode never serves a local business API; the platform owns these routes.
        if (!standalone) return sendJson(res, 404, { detail: "Not found" });
        if (!["GET", "HEAD"].includes(req.method) && (via === "session" ? !sameOrigin(req) : crossOrigin(req))) {
          return sendJson(res, 403, { detail: "Cross-origin request rejected" });
        }
        return await routeApi(req, res, url);
      }

      if (standalone && pathname === "/") return redirect(res, `${APP_BASE_PATH}/`);
      if (pathname === APP_BASE_PATH) return redirect(res, `${APP_BASE_PATH}/${url.search}`);
      if (!["GET", "HEAD"].includes(req.method)) return sendJson(res, 405, { detail: "Method not allowed" });
      if (pathname === "/icons.svg") return serveStatic(req, res, staticDir, "/icons.svg");
      return serveStatic(req, res, staticDir, appPath);
    } catch (error) {
      if (error instanceof StoreError) return sendJson(res, error.status, { detail: error.message, ...error.extra });
      log(`error ${req.method} ${safePath(req.url)}: ${error.stack ?? error}`);
      if (!res.headersSent) return sendJson(res, 500, { detail: "Internal server error" });
      res.destroy();
    }
  };

  async function routeSession(req, res) {
    if (req.method === "GET") return sendJson(res, 200, { authenticated: Boolean(access.authenticate(req)), tokenLogin: access.tokenLogin });
    if (req.method === "DELETE") {
      if (!sameOrigin(req)) return sendJson(res, 403, { detail: "Cross-origin request rejected" });
      res.setHeader("Set-Cookie", access.logoutCookie());
      return sendEmpty(res, 204);
    }
    if (req.method !== "POST") return sendJson(res, 405, { detail: "Method not allowed" });
    const body = await readJson(req, 4 * 1024);
    try {
      res.setHeader("Set-Cookie", access.login(req, body.token));
    } catch (error) {
      return sendJson(res, error.status ?? 400, { detail: error.message });
    }
    return sendEmpty(res, 204);
  }

  function unauthenticated(req, res, pathname) {
    if (access.basicAuth) res.setHeader("WWW-Authenticate", 'Basic realm="Image Studio", charset="UTF-8"');
    const appPath = stripBase(pathname);
    const navigation = ["GET", "HEAD"].includes(req.method) && !path.extname(appPath)
      && !pathname.startsWith("/image-studio") && !pathname.startsWith("/local-ai/");
    if (access.tokenLogin && navigation) {
      const page = Buffer.from(loginPage(APP_BASE_PATH));
      res.writeHead(401, { "Content-Type": "text/html; charset=utf-8", "Content-Length": page.length, "Cache-Control": "no-store" });
      return res.end(req.method === "HEAD" ? undefined : page);
    }
    return sendJson(res, 401, { detail: "Authentication required" });
  }

  async function routeApi(req, res, url) {
    const parts = url.pathname.split("/").filter(Boolean).map(decodeSegment);
    const method = req.method;

    if (parts[0] === "local-ai") return routeAi(req, res, url, parts.slice(1));

    // /image-studio/projects[/...]
    if (parts[1] !== "projects") return sendJson(res, 404, { detail: "Not found" });
    const [, , projectId, sub, subId] = parts;
    if (parts.length === 2) {
      if (method === "GET") return sendJson(res, 200, { items: store.listProjects() });
      if (method === "POST") {
        const body = await readJson(req, config.storage.maxDocumentBytes);
        return sendJson(res, 201, store.createProject({ title: body.title, document: body.document }));
      }
    } else if (parts.length === 3) {
      if (method === "GET") return sendJson(res, 200, store.openProject(projectId));
      if (method === "PUT") {
        const body = await readJson(req, config.storage.maxDocumentBytes);
        return sendJson(res, 200, store.saveProject(projectId, body));
      }
      if (method === "DELETE") { store.deleteProject(projectId); return sendEmpty(res, 204); }
    } else if (sub === "assets" && parts.length === 4 && method === "POST") {
      return sendJson(res, 201, await uploadAsset(req, projectId));
    } else if (sub === "assets" && parts.length === 5) {
      if (method === "GET" || method === "HEAD") {
        const asset = store.readAsset(projectId, subId);
        return sendFile(req, res, asset.path, asset.mimeType, { etag: `"${asset.sha256}"`,
          cache: config.privateResponses ? "private, no-store" : "private, max-age=31536000, immutable" });
      }
      if (method === "DELETE") { store.deleteAsset(projectId, subId); return sendEmpty(res, 204); }
    } else if (sub === "operations" && parts.length === 5 && method === "PATCH") {
      const body = await readJson(req, 64 * 1024);
      return sendJson(res, 200, store.completeOperation(projectId, subId, body.resultLayerId));
    }
    return sendJson(res, parts.length <= 5 ? 405 : 404, { detail: "Not found" });
  }

  async function routeAi(req, res, url, parts) {
    const method = req.method;
    if (parts[0] === "status" && parts.length === 1 && method === "GET") return sendJson(res, 200, ai.status());
    if (parts[0] === "settings" && parts.length === 1 && method === "GET") return sendJson(res, 200, ai.settings());
    if (parts[0] === "settings" && parts[1] === "api-key" && parts.length === 2) {
      if (method === "PUT") {
        const body = await readJson(req, 4 * 1024);
        return sendJson(res, 200, await ai.saveApiKey(body.apiKey));
      }
      if (method === "DELETE") return sendJson(res, 200, ai.deleteApiKey());
    }
    if (parts[0] === "mode-manifest" && parts.length === 1 && method === "GET") {
      res.setHeader("Cache-Control", "no-store");
      return sendJson(res, 200, await ai.manifest(url.searchParams.get("lang") ?? ""));
    }
    if (parts[0] === "projects" && parts[2] === "operations" && parts.length === 3 && method === "POST") {
      const form = await readForm(req, config.storage.maxUploadBytes * 2 + 256 * 1024);
      const { runId, operation } = await ai.submit(parts[1], form);
      return sendJson(res, 200, { runId, operation });
    }
    if (parts[0] === "runs" && parts.length === 2 && method === "GET") return sendJson(res, 200, await ai.runStatus(parts[1]));
    if (parts[0] === "runs" && parts[2] === "result" && parts.length === 3 && method === "GET") {
      const result = await ai.result(parts[1]);
      return sendFile(req, res, result.path, result.mimeType, { cache: "private, no-cache" });
    }
    return sendJson(res, 404, { detail: "Not found" });
  }

  async function uploadAsset(req, projectId) {
    store.requireProject(projectId);
    const declared = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.includes(declared)) throw new StoreError(415, "Assets must be PNG, JPEG or WebP images");
    const bytes = await readBody(req, config.storage.maxUploadBytes);
    const image = sniffImage(bytes);
    if (!image || image.mimeType !== declared) throw new StoreError(422, "Asset content does not match a supported image type");
    if (!imageWithinLimits(image)) throw new StoreError(413, "Asset image dimensions exceed the supported limits");
    return store.addAsset(projectId, { bytes, ...image });
  }
}

// ---- request helpers --------------------------------------------------------

function readBody(req, limit) {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > limit) {
    req.resume();
    return Promise.reject(new StoreError(413, "Request body is too large"));
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on("data", (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > limit) { failed = true; reject(new StoreError(413, "Request body is too large")); req.resume(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => { if (!failed) resolve(Buffer.concat(chunks)); });
    req.on("error", (error) => { if (!failed) { failed = true; reject(error); } });
  });
}

async function readJson(req, limit) {
  const type = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  // Requiring application/json forces a CORS preflight for any cross-site caller.
  if (type !== "application/json") throw new StoreError(415, "Content-Type must be application/json");
  const bytes = await readBody(req, limit);
  try {
    const value = JSON.parse(bytes.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value;
  } catch { throw new StoreError(400, "Request body must be a JSON object"); }
}

async function readForm(req, limit) {
  const type = String(req.headers["content-type"] ?? "");
  if (!type.toLowerCase().startsWith("multipart/form-data")) throw new StoreError(415, "Content-Type must be multipart/form-data");
  const bytes = await readBody(req, limit);
  try { return await new Response(bytes, { headers: { "content-type": type } }).formData(); }
  catch { throw new StoreError(400, "Malformed multipart body"); }
}

function crossOrigin(req) {
  if (req.headers["sec-fetch-site"] === "cross-site") return true;
  const origin = req.headers.origin;
  if (!origin) return false;
  try { return new URL(origin).host !== req.headers.host; } catch { return true; }
}

function stripBase(pathname) {
  if (pathname === APP_BASE_PATH) return "/";
  return pathname.startsWith(`${APP_BASE_PATH}/`) ? pathname.slice(APP_BASE_PATH.length) : pathname;
}

function decodeSegment(segment) {
  try { return decodeURIComponent(segment); } catch { throw new StoreError(400, "Malformed path"); }
}

function safePath(url = "") {
  return url.split("?")[0];
}

// ---- response helpers -------------------------------------------------------

function setCommonHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
}

function sendJson(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": payload.length, ...(res.getHeader("Cache-Control") ? {} : { "Cache-Control": "no-store" }) });
  res.end(payload);
}

function sendEmpty(res, status) {
  res.writeHead(status);
  res.end();
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function sendFile(req, res, file, contentType, { etag, cache } = {}) {
  let stat;
  try { stat = fs.statSync(file); } catch { return sendJson(res, 404, { detail: "Not found" }); }
  if (!stat.isFile()) return sendJson(res, 404, { detail: "Not found" });
  if (etag && req.headers["if-none-match"] === etag) { res.writeHead(304, { ETag: etag }); return res.end(); }
  res.writeHead(200, {
    "Content-Type": contentType, "Content-Length": stat.size,
    ...(etag ? { ETag: etag } : {}), ...(cache ? { "Cache-Control": cache } : {}),
  });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file).pipe(res);
}

function serveStatic(req, res, root, requestPath) {
  let relative;
  try { relative = path.posix.normalize(decodeURIComponent(requestPath)); } catch { return sendJson(res, 400, { detail: "Malformed path" }); }
  if (relative.includes("\0")) return sendJson(res, 400, { detail: "Malformed path" });
  const file = path.join(root, relative);
  if (file !== root && !file.startsWith(`${root}${path.sep}`)) return sendJson(res, 404, { detail: "Not found" });
  const extension = path.extname(file).toLowerCase();
  if (relative !== "/" && fileExists(file)) {
    const immutable = relative.startsWith("/assets/");
    return sendFile(req, res, file, CONTENT_TYPES[extension] ?? "application/octet-stream", {
      cache: immutable ? "public, max-age=31536000, immutable" : "no-cache",
    });
  }
  // Missing files with an extension are real 404s; extensionless paths are SPA deep links.
  if (extension && relative !== "/") return sendJson(res, 404, { detail: "Not found" });
  return sendFile(req, res, path.join(root, "index.html"), CONTENT_TYPES[".html"], { cache: "no-cache" });
}

function fileExists(file) {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}
