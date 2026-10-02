import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ConfigError, loadConfig, normalizeConfig } from "../config.mjs";
import { startApp, tempDir } from "./helpers.mjs";

test("requires an explicit mode", () => {
  assert.throws(() => loadConfig({}), ConfigError);
  assert.throws(() => normalizeConfig({ mode: "local" }), /mode/);
  assert.equal(loadConfig({ IMAGE_STUDIO_MODE: "platform" }).mode, "platform");
  assert.throws(() => loadConfig({ IMAGE_STUDIO_CONFIG: "/nonexistent/config.json" }), /Cannot read config file/);
});

test("reads the standalone config file with ports, database and storage paths", () => {
  const dir = tempDir();
  const file = path.join(dir, "config.json");
  fs.writeFileSync(file, JSON.stringify({ mode: "standalone", server: { port: 80 }, storage: { databasePath: "/data/db/x.sqlite", dataDir: "/data/files" } }));
  const config = loadConfig({ IMAGE_STUDIO_CONFIG: file });
  assert.equal(config.server.port, 80);
  assert.equal(config.storage.databasePath, "/data/db/x.sqlite");
  assert.equal(config.storage.dataDir, "/data/files");
  // AI defaults to skillsmaster.jp with no key until one is entered in Settings.
  assert.equal(config.ai.enabled, true);
  assert.equal(config.ai.baseUrl, "https://skillsmaster.jp");
  assert.equal(config.ai.configuredKey, null);
  assert.equal(config.ai.keyStorePath, "/data/files/settings/skillsmaster-api-key");
  assert.equal(normalizeConfig({ mode: "standalone", ai: { enabled: false } }).ai.enabled, false);
});

test("platform mode refuses storage, AI keys and access settings", () => {
  assert.equal(normalizeConfig({ mode: "platform" }).server.port, 8080);
  assert.throws(() => normalizeConfig({ mode: "platform", storage: {} }), /not allowed in platform mode/);
  assert.throws(() => normalizeConfig({ mode: "platform", ai: { baseUrl: "https://x" } }), /not allowed in platform mode/);
  assert.throws(() => normalizeConfig({ mode: "platform" }, { SKILLSMASTER_CUSTOMER_KEY_FILE: "/run/secrets/key" }), /customer key/);
});

test("a deployment-provided key must be readable and the base URL credential-free", () => {
  const dir = tempDir();
  const key = path.join(dir, "key");
  fs.writeFileSync(key, "ck_live_example\n");
  const config = normalizeConfig({ mode: "standalone", ai: { baseUrl: "https://ai.example.com/", customerKeyFile: key } });
  assert.equal(config.ai.configuredKey, "ck_live_example");
  assert.equal(config.ai.baseUrl, "https://ai.example.com");
  assert.throws(() => normalizeConfig({ mode: "standalone", ai: { baseUrl: "https://ai.example.com", customerKeyFile: path.join(dir, "missing") } }), /Cannot read/);
  assert.throws(() => normalizeConfig({ mode: "standalone", ai: { baseUrl: "https://user:pw@ai.example.com", customerKeyFile: key } }), /credentials/);
  assert.equal(normalizeConfig({ mode: "standalone", ai: { baseUrl: "https://ai.example.com", customerKeyEnv: "K" } }, { K: "env-key" }).ai.configuredKey, "env-key");
});

test("platform mode serves only static assets, /healthz and runtime config", async (t) => {
  const app = await startApp({ mode: "platform", staticFiles: { "assets/app.js": "console.log(1)", "icons.svg": "<svg/>" } });
  t.after(() => app.close());
  assert.deepEqual(await (await app.fetch("/healthz")).json(), { status: "ok", mode: "platform" });
  assert.deepEqual(await (await app.fetch("/runtime-config.json")).json(), { mode: "platform" });
  assert.deepEqual(await (await app.fetch("/apps/image-studio/runtime-config.json")).json(), { mode: "platform" });
  assert.equal((await app.fetch("/assets/app.js")).headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal((await app.fetch("/apps/image-studio/assets/app.js")).status, 200);
  assert.match(await (await app.fetch("/some/deep/link")).text(), /Image Studio/);
  for (const pathname of ["/image-studio/projects", "/local-ai/status", "/local-ai/mode-manifest"]) {
    assert.equal((await app.fetch(pathname)).status, 404, pathname);
  }
  assert.equal((await app.fetch("/image-studio/projects", { method: "POST" })).status, 404);
  assert.equal(fs.existsSync(path.join(app.dir, "db")), false, "platform mode must not create a database");
});

test("standalone mode redirects to the app base path and serves deep links and icons", async (t) => {
  const app = await startApp({ staticFiles: { "assets/app.js": "1", "icons.svg": "<svg/>" } });
  t.after(() => app.close());
  const root = await app.fetch("/", { redirect: "manual" });
  assert.equal(root.status, 302);
  assert.equal(root.headers.get("location"), "/apps/image-studio/");
  assert.deepEqual(await (await app.fetch("/apps/image-studio/runtime-config.json")).json(), { mode: "standalone", ai: { available: false } });
  assert.match(await (await app.fetch("/apps/image-studio/")).text(), /Image Studio/);
  assert.match(await (await app.fetch("/apps/image-studio/projects/abc")).text(), /Image Studio/);
  assert.equal((await app.fetch("/apps/image-studio/assets/missing.js")).status, 404);
  assert.equal((await app.fetch("/icons.svg")).status, 200);
  assert.equal((await app.fetch("/apps/image-studio/%2e%2e/%2e%2e/etc/passwd.txt")).status, 404);
});
