import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { normalizeConfig } from "../config.mjs";
import { createHostedHandler } from "../hostedApp.mjs";
import { documentWith, png, rasterLayer, tempDir } from "./helpers.mjs";

const alice = "alice-token-" + "a".repeat(30);
const bob = "bob-token-" + "b".repeat(30);

async function fixture(t, rootDir = tempDir()) {
  const state = { revoked: new Set(), unavailable: false, requests: [], runOwner: alice };
  const platform = http.createServer(async (req, res) => {
    state.requests.push({ url: req.url, headers: req.headers });
    const reply = (status, body, type = "application/json") => {
      res.writeHead(status, { "Content-Type": type }); res.end(type === "application/json" ? JSON.stringify(body) : body);
    };
    if (state.unavailable) return reply(503, {});
    const token = req.headers.authorization?.replace(/^Bearer /, "");
    if (req.url === "/platform/app-sessions/image-studio/exchange") {
      let text = ""; for await (const chunk of req) text += chunk;
      const body = JSON.parse(text);
      if (body.code !== "code-" + "c".repeat(30) || !/^[A-Za-z0-9_-]{64}$/.test(body.codeVerifier)) return reply(401, {});
      return reply(200, { token: alice, scopes: ["platform.auth", "platform.ai-runs"], expiresAt: new Date(Date.now() + 900_000).toISOString() });
    }
    if (![alice, bob].includes(token) || state.revoked.has(token)) return reply(401, {});
    if (req.url === "/platform/app-sessions/image-studio/me") {
      return reply(200, { userId: token === alice ? "alice" : "bob", appId: "image-studio", scopes: ["platform.auth", "platform.ai-runs"], expiresAt: new Date(Date.now() + 900_000).toISOString() });
    }
    if (req.url === "/platform/app-sessions/image-studio" && req.method === "DELETE") { state.revoked.add(token); return reply(204, "", "text/plain"); }
    if (req.url.startsWith("/mode-manifest")) return reply(200, { modes: {} });
    if (req.url === "/v1/runs" && req.method === "POST") {
      for await (const _chunk of req) { /* Consume the multipart stream. */ }
      state.runOwner = token; return reply(200, { run_id: "run-1" });
    }
    if (req.url === "/v1/runs/run-1" && token === state.runOwner) return reply(200, { status: "success", result_ready: true });
    if (req.url === "/v1/runs/run-1/result" && token === state.runOwner) return reply(200, { url: `http://127.0.0.1:${platform.address().port}/artifact` });
    if (req.url === "/artifact" && token === state.runOwner) return reply(200, png(), "image/png");
    return reply(404, {});
  });
  await new Promise((resolve) => platform.listen(0, "127.0.0.1", resolve));
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const staticDir = path.join(rootDir, "dist");
  fs.mkdirSync(staticDir, { recursive: true }); fs.writeFileSync(path.join(staticDir, "index.html"), "<title>Image Studio</title>");
  const config = normalizeConfig({ mode: "hosted", server: { staticDir }, storage: { rootDir },
    identity: { publicOrigin: base, platformOrigin: `http://127.0.0.1:${platform.address().port}` } });
  const app = createHostedHandler({ config });
  server.on("request", app.handle);
  let closed = false;
  async function close() {
    if (closed) return; closed = true;
    server.closeAllConnections(); platform.closeAllConnections();
    await Promise.all([new Promise((resolve) => server.close(resolve)), new Promise((resolve) => platform.close(resolve))]);
    app.close();
  }
  t.after(close);
  function call(url, token = alice, init = {}) {
    return fetch(`${base}${url}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } });
  }
  async function create(token = alice) {
    const response = await call("/image-studio/projects", token, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Owned project", document: documentWith() }) });
    assert.equal(response.status, 201); return response.json();
  }
  return { state, call, base, rootDir, create, close, config };
}

test("hosted config requires independent origins and forbids account keys", () => {
  const identity = { publicOrigin: "https://editor.test", platformOrigin: "https://platform.test" };
  assert.equal(normalizeConfig({ mode: "hosted", identity }).mode, "hosted");
  assert.throws(() => normalizeConfig({ mode: "hosted", identity: { ...identity, publicOrigin: identity.platformOrigin } }), /distinct/);
  assert.throws(() => normalizeConfig({ mode: "hosted", identity, ai: {} }), /not allowed/);
  assert.throws(() => normalizeConfig({ mode: "hosted", identity }, { SKILLSMASTER_CUSTOMER_KEY: "secret" }), /not allowed/);
  assert.throws(() => normalizeConfig({ mode: "hosted", identity: { ...identity, publicOrigin: "http://editor.test" } }), /HTTPS/);
});

test("hosted project CRUD and assets stay isolated per owner and survive a restart", async (t) => {
  const app = await fixture(t);
  const project = await app.create();
  const upload = await app.call(`/image-studio/projects/${project.id}/assets`, alice, { method: "POST", headers: { "Content-Type": "image/png" }, body: png() });
  assert.equal(upload.status, 201); const asset = await upload.json();
  const saved = await app.call(`/image-studio/projects/${project.id}`, alice, { method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ revision: 1, title: "New title", document: documentWith([rasterLayer("layer-1", asset.id)]) }) });
  assert.equal(saved.status, 200);
  assert.deepEqual((await (await app.call("/image-studio/projects", bob)).json()).items, []);
  for (const [url, init] of [
    [`/image-studio/projects/${project.id}`, {}],
    [`/image-studio/projects/${project.id}/assets/${asset.id}`, {}],
    [`/image-studio/projects/${project.id}`, { method: "DELETE" }],
  ]) assert.equal((await app.call(url, bob, init)).status, 404);
  assert.deepEqual(Buffer.from(await (await app.call(asset.url)).arrayBuffer()), png());
  assert.equal((await app.call(asset.url)).headers.get("cache-control"), "private, no-store");
  await app.close();
  const restarted = await fixture(t, app.rootDir);
  assert.equal((await (await restarted.call(`/image-studio/projects/${project.id}`)).json()).revision, 2);
  assert.deepEqual(Buffer.from(await (await restarted.call(asset.url)).arrayBuffer()), png());
  assert.equal((await restarted.call(`/image-studio/projects/${project.id}`, alice, { method: "DELETE" })).status, 204);
  assert.equal((await restarted.call(`/image-studio/projects/${project.id}`)).status, 404);
});

test("rejects invalid audience/credentials and fails closed on platform outages or revocation", async (t) => {
  const app = await fixture(t);
  assert.equal((await app.call("/image-studio/projects", "other-app-token-" + "x".repeat(30))).status, 401);
  assert.equal((await fetch(`${app.base}/image-studio/projects`, { headers: { Cookie: "skillsmaster_session=platform-secret" } })).status, 401);
  assert.equal(fs.existsSync(path.join(app.rootDir, "users")), false);
  await app.create();
  app.state.revoked.add(alice);
  assert.equal((await app.call("/image-studio/projects")).status, 401);
  app.state.unavailable = true;
  assert.equal((await app.call("/image-studio/projects", bob)).status, 503);
  assert.equal((await fetch(`${app.base}/healthz`)).status, 200);
});

test("PKCE login callback is state-bound and stores only a host cookie; logout revokes it", async (t) => {
  const app = await fixture(t);
  const start = await fetch(`${app.base}/auth/platform/login?next=${encodeURIComponent("/projects/p1?view=layers#selection")}`, { redirect: "manual" });
  assert.equal(start.status, 303);
  const authorize = new URL(start.headers.get("location"));
  assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
  const cookie = start.headers.get("set-cookie").split(";")[0];
  const callback = `${app.base}/auth/platform/callback?code=${"code-" + "c".repeat(30)}&state=${authorize.searchParams.get("state")}`;
  assert.equal((await fetch(callback, { redirect: "manual" })).status, 401);
  const reply = await fetch(callback, { redirect: "manual", headers: { Cookie: cookie } });
  assert.equal(reply.status, 303);
  assert.equal(reply.headers.get("location"), "/projects/p1?view=layers#selection");
  const authCookie = reply.headers.getSetCookie().find((part) => part.startsWith("image_studio_identity=")).split(";")[0];
  assert.match(reply.headers.getSetCookie()[0], /HttpOnly; SameSite=Lax/);
  assert.equal((await fetch(callback, { redirect: "manual", headers: { Cookie: cookie } })).status, 401);
  assert.equal((await fetch(`${app.base}/image-studio/projects`, { headers: { Cookie: authCookie } })).status, 200);
  assert.equal((await fetch(`${app.base}/image-studio/projects`, { method: "POST", headers: { Cookie: authCookie, Origin: "https://other-app.test" } })).status, 403);
  const logout = await fetch(`${app.base}/auth/platform/logout`, { method: "POST", headers: { Cookie: authCookie, Origin: app.base } });
  assert.equal(logout.status, 204);
  assert.equal((await app.call("/image-studio/projects")).status, 401);
});

test("AI submission uses scoped REST identity and keeps operation/result ownership local", async (t) => {
  const app = await fixture(t);
  const project = await app.create();
  const asset = await (await app.call(`/image-studio/projects/${project.id}/assets`, alice,
    { method: "POST", headers: { "Content-Type": "image/png" }, body: png() })).json();
  await app.call(`/image-studio/projects/${project.id}`, alice, { method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ revision: 1, document: documentWith([rasterLayer("input", asset.id)]) }) });
  const body = new FormData(); body.append("file", new Blob([png()], { type: "image/png" }), "image.png");
  body.append("operation", JSON.stringify({ id: "op-1", baseRevision: 2, inputLayerId: "input", mode: "deblur", parameters: {} }));
  const response = await app.call(`/local-ai/projects/${project.id}/operations`, alice, { method: "POST", body });
  assert.equal(response.status, 200); assert.equal((await response.json()).runId, "run-1");
  assert.equal((await app.call("/local-ai/runs/run-1", bob)).status, 404);
  assert.equal((await app.call("/local-ai/runs/run-1/result", bob)).status, 404);
  assert.deepEqual(Buffer.from(await (await app.call("/local-ai/runs/run-1/result")).arrayBuffer()), png());
  const submitted = app.state.requests.find((item) => item.url === "/v1/runs");
  assert.equal(submitted.headers.authorization, `Bearer ${alice}`);
  assert.equal(submitted.headers["idempotency-key"], "op-1");
  assert.equal(submitted.headers["x-customer-key"], undefined);
  assert.equal(submitted.headers["x-image-studio-operation-id"], undefined);
  assert.equal(submitted.headers.cookie, undefined);
});
