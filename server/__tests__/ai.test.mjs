import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { NO_KEY_REASON } from "../aiProxy.mjs";
import { documentWith, jsonInit, png, rasterLayer, startApp, startFakeSkillsmaster, tempDir } from "./helpers.mjs";

async function setup(t, { dir = tempDir(), upstream } = {}) {
  const fake = upstream ?? await startFakeSkillsmaster();
  const keyFile = path.join(dir, "customer-key");
  fs.writeFileSync(keyFile, `${fake.key}\n`);
  const app = await startApp({ dir, ai: { baseUrl: fake.baseUrl, customerKeyFile: keyFile } });
  t.after(async () => { await app.close(); if (!upstream) await fake.close(); });
  return { app, fake, dir };
}

async function savedProject(app) {
  const project = await (await app.fetch("/image-studio/projects", jsonInit("POST", { document: documentWith() }))).json();
  const asset = await (await app.fetch(`/image-studio/projects/${project.id}/assets`, { method: "POST", headers: { "Content-Type": "image/png" }, body: png() })).json();
  await app.fetch(`/image-studio/projects/${project.id}`, jsonInit("PUT", { revision: 1, document: documentWith([rasterLayer("layer-1", asset.id)]) }));
  return project.id;
}

function operationForm(projectId, { id = "ai-operation-1", mask = false } = {}) {
  const form = new FormData();
  form.append("operation", JSON.stringify({
    id, projectId, baseRevision: 2, mode: "deblur", inputLayerId: "layer-1", maskLayerId: null,
    parameters: { strength: "medium", output_format: "png" }, retryOf: null, recipeId: null, stepIndex: null,
  }));
  form.append("file", new Blob([png()], { type: "image/png" }), "image.png");
  if (mask) { form.append("mask_field", "mask_file"); form.append("mask", new Blob([png()], { type: "image/png" }), "mask.png"); }
  return form;
}

test("reports a clear status and keeps the project API working without AI configuration", async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  assert.deepEqual(await (await app.fetch("/local-ai/status")).json(), { enabled: false, reason: NO_KEY_REASON });
  const manifest = await app.fetch("/local-ai/mode-manifest?lang=en");
  assert.equal(manifest.status, 503);
  assert.match((await manifest.json()).detail, /Settings → API Key/);
  assert.equal((await app.fetch("/image-studio/projects")).status, 200);
});

test("reports an unreachable skillsmaster API as 502", async (t) => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "key"), "k");
  const app = await startApp({ dir, ai: { baseUrl: "http://127.0.0.1:9", customerKeyFile: path.join(dir, "key"), requestTimeoutMs: 2000 } });
  t.after(() => app.close());
  const response = await app.fetch("/local-ai/mode-manifest?lang=en");
  assert.equal(response.status, 502);
  assert.match((await response.json()).detail, /could not be reached/);
});

test("proxies manifest, submission with mask, polling and result with the server-side key", async (t) => {
  const { app, fake } = await setup(t);
  const manifest = await (await app.fetch("/local-ai/mode-manifest?lang=ja")).json();
  assert.equal(manifest.modes.deblur.label, "Deblur (ja)");

  const projectId = await savedProject(app);
  const submitted = await app.fetch(`/local-ai/projects/${projectId}/operations`, { method: "POST", body: operationForm(projectId, { mask: true }) });
  assert.equal(submitted.status, 200);
  const { runId, operation } = await submitted.json();
  assert.equal(operation.status, "running");
  const upstream = fake.state.submissions[0];
  assert.equal(upstream.headers["x-customer-key"], fake.key);
  assert.equal(upstream.headers["idempotency-key"], "ai-operation-1");
  assert.equal(upstream.headers["x-image-studio-operation-id"], undefined, "platform-only header must not be sent");
  assert.deepEqual(upstream.fields.sort(), ["file", "mask_file", "mode", "output_format", "strength"]);
  assert.ok(!fake.state.requests.some((request) => request.url.includes("/image-studio/projects")), "platform pre-registration must not be called");

  assert.equal((await (await app.fetch(`/local-ai/runs/${runId}`)).json()).status, "running");
  assert.deepEqual(await (await app.fetch(`/local-ai/runs/${runId}`)).json(), { status: "success", resultReady: true });
  const result = await app.fetch(`/local-ai/runs/${runId}/result`);
  assert.equal(result.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await result.arrayBuffer()), png(7, 9));
  const storageDownload = fake.state.requests.find((request) => request.url.startsWith("/storage/"));
  assert.equal(storageDownload.headers["x-customer-key"], undefined, "the key must not leak to a storage URL");

  const linked = await app.fetch(`/image-studio/projects/${projectId}/operations/ai-operation-1`, jsonInit("PATCH", { resultLayerId: "layer-2" }));
  assert.equal((await linked.json()).status, "succeeded");
  const opened = await (await app.fetch(`/image-studio/projects/${projectId}`)).json();
  assert.deepEqual(opened.operations.map((item) => [item.id, item.runId, item.status, item.resultLayerId]), [["ai-operation-1", runId, "succeeded", "layer-2"]]);

  for (const response of [manifest, opened]) assert.ok(!JSON.stringify(response).includes(fake.key));
});

test("does not resubmit a repeated operation and recovers the result after a restart", async (t) => {
  const fake = await startFakeSkillsmaster();
  t.after(() => fake.close());
  const dir = tempDir();
  const first = await setup(t, { dir, upstream: fake });
  const projectId = await savedProject(first.app);
  const one = await (await first.app.fetch(`/local-ai/projects/${projectId}/operations`, { method: "POST", body: operationForm(projectId) })).json();
  const two = await (await first.app.fetch(`/local-ai/projects/${projectId}/operations`, { method: "POST", body: operationForm(projectId) })).json();
  assert.equal(one.runId, two.runId);
  assert.equal(fake.state.submissions.length, 1);
  await first.app.fetch(`/local-ai/runs/${one.runId}`);
  await first.app.fetch(`/local-ai/runs/${one.runId}`);
  await first.app.fetch(`/local-ai/runs/${one.runId}/result`);
  await first.app.close();

  // Restart against the same volume; upstream is no longer needed to deliver the stored result.
  await fake.close();
  const second = await startApp({ dir, ai: { baseUrl: fake.baseUrl, customerKeyFile: path.join(dir, "customer-key"), requestTimeoutMs: 1000 } });
  t.after(() => second.close());
  assert.deepEqual(await (await second.fetch(`/local-ai/runs/${one.runId}`)).json(), { status: "success", resultReady: true });
  const result = await second.fetch(`/local-ai/runs/${one.runId}/result`);
  assert.equal(result.status, 200);
  assert.deepEqual(Buffer.from(await result.arrayBuffer()), png(7, 9));
  const opened = await (await second.fetch(`/image-studio/projects/${projectId}`)).json();
  assert.equal(opened.operations[0].status, "result-ready");
});

test("records upstream failures and rejects operations for unknown layers or runs", async (t) => {
  const { app, fake } = await setup(t);
  const projectId = await savedProject(app);
  const bad = operationForm(projectId);
  bad.set("operation", JSON.stringify({ id: "ai-operation-x", baseRevision: 2, mode: "deblur", inputLayerId: "nope", parameters: {} }));
  assert.equal((await app.fetch(`/local-ai/projects/${projectId}/operations`, { method: "POST", body: bad })).status, 422);
  assert.equal((await app.fetch("/local-ai/runs/run-unknown")).status, 404);

  fake.state.failStatus = true;
  const { runId } = await (await app.fetch(`/local-ai/projects/${projectId}/operations`, { method: "POST", body: operationForm(projectId) })).json();
  assert.deepEqual(await (await app.fetch(`/local-ai/runs/${runId}`)).json(), { status: "failed", resultReady: false, message: "model error" });
  const opened = await (await app.fetch(`/image-studio/projects/${projectId}`)).json();
  assert.equal(opened.operations[0].status, "failed");
});

test("never sends the key to the browser or logs it in errors", async (t) => {
  const dir = tempDir();
  const fake = await startFakeSkillsmaster({ key: "expected" });
  t.after(() => fake.close());
  fs.writeFileSync(path.join(dir, "key"), "wrong-secret-key");
  const app = await startApp({ dir, ai: { baseUrl: fake.baseUrl, customerKeyFile: path.join(dir, "key") } });
  t.after(() => app.close());
  const response = await app.fetch("/local-ai/mode-manifest?lang=en");
  assert.equal(response.status, 502);
  const text = await response.text();
  assert.ok(!text.includes("wrong-secret-key"));
  assert.ok(!JSON.stringify(await (await app.fetch("/apps/image-studio/runtime-config.json")).json()).includes("wrong-secret-key"));
});

async function settingsApp(t, fake, extra = {}) {
  const app = await startApp({ ai: { baseUrl: fake.baseUrl, ...extra } });
  t.after(() => app.close());
  return app;
}

test("saves an API key from Settings server-side and uses it for skillsmaster calls", async (t) => {
  const fake = await startFakeSkillsmaster();
  t.after(() => fake.close());
  const app = await settingsApp(t, fake);
  assert.deepEqual(await (await app.fetch("/local-ai/settings")).json(),
    { enabled: true, baseUrl: fake.baseUrl, keySource: "none", keyHint: null, editable: true });

  const saved = await app.fetch("/local-ai/settings/api-key", jsonInit("PUT", { apiKey: ` ${fake.key} ` }));
  assert.equal(saved.status, 200);
  const body = await saved.json();
  assert.deepEqual(body, { enabled: true, baseUrl: fake.baseUrl, keySource: "settings", keyHint: `…${fake.key.slice(-4)}`, editable: true, verified: true });
  assert.ok(!JSON.stringify(body).includes(fake.key));

  const keyFile = path.join(app.config.storage.dataDir, "settings", "skillsmaster-api-key");
  assert.equal(fs.readFileSync(keyFile, "utf8").trim(), fake.key);
  assert.equal(fs.statSync(keyFile).mode & 0o777, 0o600);
  assert.deepEqual(await (await app.fetch("/apps/image-studio/runtime-config.json")).json(), { mode: "standalone", ai: { available: true } });
  assert.equal((await (await app.fetch("/local-ai/mode-manifest?lang=en")).json()).modes.deblur.enabled, true);
  assert.equal(fake.state.requests.at(-1).headers["x-customer-key"], fake.key);

  // The key survives a restart because it lives on the storage volume.
  await app.close();
  const restarted = await startApp({ dir: app.dir, ai: { baseUrl: fake.baseUrl } });
  t.after(() => restarted.close());
  assert.equal((await (await restarted.fetch("/local-ai/settings")).json()).keySource, "settings");

  const removed = await (await restarted.fetch("/local-ai/settings/api-key", { method: "DELETE" })).json();
  assert.equal(removed.keySource, "none");
  assert.ok(!fs.existsSync(keyFile));
  assert.equal((await restarted.fetch("/local-ai/mode-manifest?lang=en")).status, 503);
});

test("rejects keys skillsmaster refuses, malformed keys and cross-site writes", async (t) => {
  const fake = await startFakeSkillsmaster();
  t.after(() => fake.close());
  const app = await settingsApp(t, fake);
  const rejected = await app.fetch("/local-ai/settings/api-key", jsonInit("PUT", { apiKey: "wrong-key-123" }));
  assert.equal(rejected.status, 422);
  assert.equal((await (await app.fetch("/local-ai/settings")).json()).keySource, "none");
  assert.equal((await app.fetch("/local-ai/settings/api-key", jsonInit("PUT", { apiKey: "short" }))).status, 400);
  assert.equal((await app.fetch("/local-ai/settings/api-key", jsonInit("PUT", { apiKey: "has spaces inside key" }))).status, 400);
  const crossSite = await app.fetch("/local-ai/settings/api-key", {
    ...jsonInit("PUT", { apiKey: fake.key }), headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
  });
  assert.equal(crossSite.status, 403);
});

test("saves the key unverified when skillsmaster is unreachable", async (t) => {
  const app = await startApp({ ai: { baseUrl: "http://127.0.0.1:9", requestTimeoutMs: 2000 } });
  t.after(() => app.close());
  const body = await (await app.fetch("/local-ai/settings/api-key", jsonInit("PUT", { apiKey: "ck_offline_1234" }))).json();
  assert.equal(body.verified, false);
  assert.match(body.warning, /could not be reached/);
  assert.equal(body.keySource, "settings");
});

test("a key from the server config file is read-only in Settings", async (t) => {
  const fake = await startFakeSkillsmaster();
  t.after(() => fake.close());
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "key"), fake.key);
  const app = await startApp({ dir, ai: { baseUrl: fake.baseUrl, customerKeyFile: path.join(dir, "key") } });
  t.after(() => app.close());
  const settings = await (await app.fetch("/local-ai/settings")).json();
  assert.deepEqual([settings.keySource, settings.editable], ["config", false]);
  assert.equal((await app.fetch("/local-ai/settings/api-key", jsonInit("PUT", { apiKey: "another-key-123" }))).status, 409);
  assert.equal((await app.fetch("/local-ai/settings/api-key", { method: "DELETE" })).status, 409);
});

test("an administrator can disable AI entirely", async (t) => {
  const app = await startApp({ ai: { enabled: false } });
  t.after(() => app.close());
  assert.equal((await (await app.fetch("/local-ai/settings")).json()).enabled, false);
  assert.equal((await app.fetch("/local-ai/settings/api-key", jsonInit("PUT", { apiKey: "ck_some_key_1" }))).status, 503);
});

test("the customer key never appears in logs or any browser-facing response of a full AI flow", async (t) => {
  const fake = await startFakeSkillsmaster({ key: "ck_secret_never_logged_123" });
  t.after(() => fake.close());
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "customer-key"), `${fake.key}\n`);
  const lines = [];
  const app = await startApp({ dir, ai: { baseUrl: fake.baseUrl, customerKeyFile: path.join(dir, "customer-key") }, log: (line) => lines.push(line) });
  t.after(() => app.close());
  const bodies = [];
  const call = async (pathname, init) => {
    const response = await app.fetch(pathname, init);
    bodies.push(JSON.stringify([...response.headers]), Buffer.from(await response.arrayBuffer()).toString("latin1"));
    return response;
  };
  const projectId = await savedProject(app);
  await call("/apps/image-studio/runtime-config.json");
  await call("/local-ai/status");
  await call("/local-ai/settings");
  await call("/local-ai/mode-manifest?lang=en");
  const submitted = await app.fetch(`/local-ai/projects/${projectId}/operations`, { method: "POST", body: operationForm(projectId) });
  const { runId } = await submitted.json();
  await call(`/local-ai/runs/${runId}`);
  await call(`/local-ai/runs/${runId}`);
  await call(`/local-ai/runs/${runId}/result`);
  await call(`/image-studio/projects/${projectId}`);
  fake.state.submitBehavior = { status: 500, body: { detail: `echo ${fake.key}` } };
  await call(`/local-ai/projects/${projectId}/operations`, { method: "POST", body: operationForm(projectId, { id: "ai-operation-2" }) });
  assert.ok(lines.length > 5);
  for (const text of [...lines, ...bodies]) assert.ok(!text.includes(fake.key), text.slice(0, 200));
});
