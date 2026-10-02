import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { normalizeConfig } from "../config.mjs";
import { createHandler } from "../app.mjs";
import { openStore } from "../store.mjs";
import { createAiProxy } from "../aiProxy.mjs";

export function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "image-studio-test-"));
}

/** A 1x1 PNG with the given width/height written into IHDR (pixels are not decoded). */
export function png(width = 2, height = 3) {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "latin1");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

export function documentWith(layers = []) {
  return { version: 12, id: "document-1", title: "Doc", canvas: { width: 100, height: 100 }, layers, selection: { layerId: null }, metadata: {} };
}

export function rasterLayer(id, assetId) {
  return { id, type: "raster", name: id, width: 2, height: 3, source: { kind: "asset", assetId, mimeType: "image/png" } };
}

export async function startApp({ mode = "standalone", dir = tempDir(), ai = undefined, access = undefined, staticFiles = {}, env = {} } = {}) {
  const staticDir = path.join(dir, "dist");
  fs.mkdirSync(staticDir, { recursive: true });
  fs.writeFileSync(path.join(staticDir, "index.html"), "<!doctype html><title>Image Studio</title>");
  for (const [name, content] of Object.entries(staticFiles)) {
    fs.mkdirSync(path.dirname(path.join(staticDir, name)), { recursive: true });
    fs.writeFileSync(path.join(staticDir, name), content);
  }
  const raw = mode === "platform"
    ? { mode, server: { port: 1, staticDir } }
    : { mode, server: { port: 1, staticDir }, storage: { databasePath: path.join(dir, "db", "studio.sqlite"), dataDir: path.join(dir, "storage"), maxUploadBytes: 4096 }, ai, access };
  const config = normalizeConfig(raw, env);
  let store = null;
  let aiProxy = null;
  if (mode === "standalone") {
    store = openStore(config.storage);
    aiProxy = createAiProxy({ ai: config.ai, store });
  }
  const server = http.createServer(createHandler({ config, store, ai: aiProxy }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let closed = false;
  return {
    dir, base, config, store,
    fetch: (pathname, init) => fetch(`${base}${pathname}`, init),
    async close() {
      if (closed) return;
      closed = true;
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      store?.close();
    },
  };
}

/** Minimal fake of the skillsmaster customer AI API. */
export async function startFakeSkillsmaster({ key = "test-customer-key" } = {}) {
  const state = { submissions: [], requests: [], runs: new Map(), failStatus: false };
  const server = http.createServer(async (req, res) => {
    state.requests.push({ method: req.method, url: req.url, headers: req.headers });
    const send = (status, body, type = "application/json") => {
      res.writeHead(status, { "Content-Type": type });
      res.end(type === "application/json" ? JSON.stringify(body) : body);
    };
    if (req.url.startsWith("/storage/")) return send(200, png(7, 9), "image/png");
    if (req.headers["x-customer-key"] !== key) return send(401, { detail: "bad key" });
    const url = new URL(req.url, "http://fake");
    if (url.pathname === "/mode-manifest") {
      return send(200, { modes: { deblur: { enabled: true, label: `Deblur (${url.searchParams.get("lang")})`, fields: [] } }, fields: {} });
    }
    if (url.pathname === "/v1/runs" && req.method === "POST") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const form = await new Response(Buffer.concat(chunks), { headers: { "content-type": req.headers["content-type"] } }).formData();
      const idempotencyKey = req.headers["idempotency-key"];
      const existing = [...state.runs.entries()].find(([, run]) => run.key === idempotencyKey);
      if (existing) return send(200, { run_id: existing[0] });
      const runId = `run-${state.runs.size + 1}`;
      state.runs.set(runId, { key: idempotencyKey, polls: 0 });
      state.submissions.push({ headers: req.headers, fields: [...form.keys()], mode: form.get("mode"), form });
      return send(200, { run_id: runId });
    }
    const match = /^\/v1\/runs\/([^/]+)(\/result)?$/.exec(url.pathname);
    if (match && state.runs.has(match[1])) {
      const run = state.runs.get(match[1]);
      // Results live on a different origin (like a presigned storage URL).
      if (match[2]) return send(200, { url: `http://localhost:${server.address().port}/storage/${match[1]}.png?sig=abc` });
      if (state.failStatus) return send(200, { status: "failed", message: "model error" });
      run.polls += 1;
      return send(200, run.polls > 1 ? { status: "success", result_ready: true } : { status: "running", result_ready: false });
    }
    return send(404, { detail: "not found" });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    state, key,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }),
  };
}

export function jsonInit(method, body) {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}
