import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { ConfigError, normalizeConfig } from "../config.mjs";
import { documentWith, jsonInit, startApp, tempDir } from "./helpers.mjs";

const TOKEN = "a-very-long-remote-access-token-0123456789";

/** Raw request so tests can set Host, Origin and Sec-Fetch-Site freely. */
function raw(app, pathname, { method = "GET", headers = {}, body } = {}) {
  const { port } = new URL(app.base);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: pathname, method, headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

async function tokenApp(t, access = {}) {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "token"), `${TOKEN}\n`);
  const app = await startApp({ dir, access: { tokenFile: path.join(dir, "token"), ...access } });
  t.after(() => app.close());
  return app;
}

async function login(app, headers = {}) {
  const body = JSON.stringify({ token: TOKEN });
  return raw(app, "/apps/image-studio/session", {
    method: "POST", body,
    headers: { "Content-Type": "application/json", Origin: app.base, "Content-Length": Buffer.byteLength(body), ...headers },
  });
}

test("without access control only loopback host names are served", async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  for (const host of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000", "studio.localhost"]) {
    assert.equal((await raw(app, "/image-studio/projects", { headers: { Host: host } })).status, 200, host);
  }
  for (const host of ["192.168.1.20:3000", "studio.example.com", "localhost.evil.example"]) {
    const response = await raw(app, "/image-studio/projects", { headers: { Host: host } });
    assert.equal(response.status, 403, host);
    assert.match(JSON.parse(response.text).detail, /access\.tokenFile/);
  }
  // Health checks from an orchestrator stay available.
  assert.equal((await raw(app, "/healthz", { headers: { Host: "10.0.0.5" } })).status, 200);
});

test("allowedHosts admits a trusted reverse proxy name", async (t) => {
  const app = await startApp({ access: { allowedHosts: ["Studio.Internal"] } });
  t.after(() => app.close());
  assert.equal((await raw(app, "/image-studio/projects", { headers: { Host: "studio.internal:8443" } })).status, 200);
  assert.equal((await raw(app, "/image-studio/projects", { headers: { Host: "other.internal" } })).status, 403);
});

test("a remote access token is required from any host and exchanged for an HttpOnly session", async (t) => {
  const app = await tokenApp(t);
  const remote = { Host: "studio.example.com" };
  assert.equal((await raw(app, "/image-studio/projects", { headers: remote })).status, 401);
  const page = await raw(app, "/apps/image-studio/", { headers: remote });
  assert.equal(page.status, 401);
  assert.match(page.text, /Access token/);
  assert.equal((await raw(app, "/apps/image-studio/assets/app.js", { headers: remote })).status, 401);

  const bearer = await raw(app, "/image-studio/projects", { headers: { ...remote, Authorization: `Bearer ${TOKEN}` } });
  assert.equal(bearer.status, 200);
  assert.equal((await raw(app, "/image-studio/projects", { headers: { ...remote, Authorization: "Bearer wrong" } })).status, 401);

  const signedIn = await login(app);
  assert.equal(signedIn.status, 204);
  const cookie = signedIn.headers["set-cookie"][0];
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.doesNotMatch(cookie, new RegExp(TOKEN), "the cookie must not carry the token itself");
  const session = cookie.split(";")[0];
  assert.equal((await raw(app, "/image-studio/projects", { headers: { Cookie: session } })).status, 200);
  assert.match((await raw(app, "/apps/image-studio/", { headers: { Cookie: session } })).text, /<title>Image Studio<\/title>/);
  assert.deepEqual(JSON.parse((await raw(app, "/apps/image-studio/session", { headers: { Cookie: session } })).text), { authenticated: true, tokenLogin: true });

  const tampered = session.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
  assert.equal((await raw(app, "/image-studio/projects", { headers: { Cookie: tampered } })).status, 401);
});

test("session writes must prove same origin and login rejects cross-site or wrong tokens", async (t) => {
  const app = await tokenApp(t);
  assert.equal((await login(app, { Origin: "https://evil.example" })).status, 403);
  assert.equal((await login(app, { Origin: "", "Sec-Fetch-Site": "cross-site" })).status, 403);
  const wrongBody = JSON.stringify({ token: "nope" });
  const wrong = await raw(app, "/apps/image-studio/session", {
    method: "POST", body: wrongBody, headers: { "Content-Type": "application/json", Origin: app.base, "Content-Length": wrongBody.length },
  });
  assert.equal(wrong.status, 401);

  const session = (await login(app)).headers["set-cookie"][0].split(";")[0];
  const body = JSON.stringify({ document: documentWith() });
  const write = (headers) => raw(app, "/image-studio/projects", {
    method: "POST", body, headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), Cookie: session, ...headers },
  });
  // A cookie alone (no Origin, no Sec-Fetch-Site) is not enough for a write.
  assert.equal((await write({})).status, 403);
  assert.equal((await write({ Origin: "https://evil.example" })).status, 403);
  assert.equal((await write({ "Sec-Fetch-Site": "same-site" })).status, 403);
  assert.equal((await write({ Origin: app.base })).status, 201);
  assert.equal((await write({ "Sec-Fetch-Site": "same-origin" })).status, 201);

  const logout = await raw(app, "/apps/image-studio/session", { method: "DELETE", headers: { Cookie: session, Origin: app.base } });
  assert.equal(logout.status, 204);
  assert.match(logout.headers["set-cookie"][0], /Max-Age=0/);
});

test("repeated wrong tokens are rate limited", async (t) => {
  const app = await tokenApp(t);
  const body = JSON.stringify({ token: "wrong-token" });
  const attempt = () => raw(app, "/apps/image-studio/session", {
    method: "POST", body, headers: { "Content-Type": "application/json", Origin: app.base, "Content-Length": body.length },
  });
  for (let index = 0; index < 10; index += 1) assert.equal((await attempt()).status, 401);
  assert.equal((await attempt()).status, 429);
  assert.equal((await login(app)).status, 429, "even the right token waits out the lockout");
});

test("sessions expire and are invalidated by rotating the token", async (t) => {
  const app = await tokenApp(t, { sessionHours: 1 });
  const session = (await login(app)).headers["set-cookie"][0].split(";")[0];
  await app.close();
  fs.writeFileSync(path.join(app.dir, "token"), `${TOKEN}-rotated\n`);
  const rotated = await startApp({ dir: app.dir, access: { tokenFile: path.join(app.dir, "token") } });
  t.after(() => rotated.close());
  assert.equal((await raw(rotated, "/image-studio/projects", { headers: { Cookie: session } })).status, 401);
});

test("access configuration is validated", () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "short"), "too-short");
  assert.throws(() => normalizeConfig({ mode: "standalone", access: { tokenFile: path.join(dir, "short") } }), /at least 32/);
  assert.throws(() => normalizeConfig({ mode: "standalone", access: { tokenFile: path.join(dir, "missing") } }), ConfigError);
  assert.throws(() => normalizeConfig({ mode: "standalone", access: { allowedHosts: "x" } }), /allowedHosts/);
  assert.throws(() => normalizeConfig({ mode: "platform" }, { IMAGE_STUDIO_ACCESS_TOKEN_FILE: "/run/secrets/token" }), /access token/);
  fs.writeFileSync(path.join(dir, "token"), TOKEN);
  assert.equal(normalizeConfig({ mode: "standalone" }, { IMAGE_STUDIO_ACCESS_TOKEN_FILE: path.join(dir, "token") }).access.token, TOKEN);
});

test("basic auth still protects the API and session endpoint reports state", async (t) => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "password"), "s3cret\n");
  const app = await startApp({ dir, access: { basicAuth: { username: "studio", passwordFile: path.join(dir, "password") } } });
  t.after(() => app.close());
  const response = await app.fetch("/apps/image-studio/");
  assert.equal(response.status, 401);
  assert.match(response.headers.get("www-authenticate"), /Basic/);
  assert.equal((await app.fetch("/apps/image-studio/session", jsonInit("POST", { token: "x" }))).status, 404);
});
