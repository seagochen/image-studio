import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { openStore, SCHEMA_VERSION } from "../store.mjs";
import { documentWith, jsonInit, png, rasterLayer, startApp, startFakeSkillsmaster, tempDir } from "./helpers.mjs";

async function savedProject(app) {
  const project = await (await app.fetch("/image-studio/projects", jsonInit("POST", { document: documentWith() }))).json();
  const asset = await (await app.fetch(`/image-studio/projects/${project.id}/assets`, { method: "POST", headers: { "Content-Type": "image/png" }, body: png() })).json();
  await app.fetch(`/image-studio/projects/${project.id}`, jsonInit("PUT", { revision: 1, document: documentWith([rasterLayer("layer-1", asset.id)]) }));
  return { projectId: project.id, assetId: asset.id };
}

function operationForm(projectId, id = "ai-operation-1") {
  const form = new FormData();
  form.append("operation", JSON.stringify({
    id, projectId, baseRevision: 2, mode: "deblur", inputLayerId: "layer-1", maskLayerId: null,
    parameters: {}, retryOf: null, recipeId: null, stepIndex: null,
  }));
  form.append("file", new Blob([png()], { type: "image/png" }), "image.png");
  return form;
}

async function aiApp(t, dir, fake, extra = {}) {
  const keyFile = path.join(dir, "customer-key");
  fs.writeFileSync(keyFile, `${fake.key}\n`);
  const app = await startApp({ dir, recover: true, ai: { baseUrl: fake.baseUrl, customerKeyFile: keyFile, ...extra } });
  t.after(() => app.close());
  return app;
}

test("startup recovery removes temp files and orphaned projects, assets and results", async (t) => {
  const dir = tempDir();
  const first = await startApp({ dir });
  const { projectId, assetId } = await savedProject(first);
  await first.close();

  const storage = path.join(dir, "storage", "projects");
  fs.writeFileSync(path.join(storage, projectId, "assets", `${assetId}.123.abc.tmp`), "partial");
  fs.writeFileSync(path.join(storage, projectId, "assets", "asset-orphan"), "orphan");
  fs.mkdirSync(path.join(storage, projectId, "ai-results"), { recursive: true });
  fs.writeFileSync(path.join(storage, projectId, "ai-results", "ai-operation-gone.bin"), "orphan");
  fs.mkdirSync(path.join(storage, "project-deleted", "assets"), { recursive: true });
  fs.writeFileSync(path.join(storage, "project-deleted", "assets", "asset-x"), "orphan");

  const app = await startApp({ dir, recover: true });
  t.after(() => app.close());
  assert.deepEqual(app.store.recovery, { tempFiles: 1, orphanProjects: 1, orphanAssets: 1, orphanResults: 1, interruptedSubmissions: 0 });
  assert.deepEqual(fs.readdirSync(path.join(storage, projectId, "assets")), [assetId]);
  assert.equal(fs.existsSync(path.join(storage, "project-deleted")), false);
  // The project itself is untouched and still opens with its asset.
  const reopened = await (await app.fetch(`/image-studio/projects/${projectId}`)).json();
  assert.equal(reopened.assets[0].id, assetId);
  assert.equal((await app.fetch(`/image-studio/projects/${projectId}/assets/${assetId}`)).status, 200);
});

test("migrates a database created before submission tracking and refuses newer schemas", () => {
  const dir = tempDir();
  const databasePath = path.join(dir, "db.sqlite");
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, title TEXT NOT NULL, document_json TEXT NOT NULL, document_version INTEGER NOT NULL,
      revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE operations (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, base_revision INTEGER NOT NULL, mode TEXT NOT NULL,
      input_layer_id TEXT NOT NULL, mask_layer_id TEXT, parameters_json TEXT NOT NULL, run_id TEXT, status TEXT NOT NULL,
      result_layer_id TEXT, result_mime_type TEXT, error TEXT, retry_of TEXT, recipe_id TEXT, step_index INTEGER,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO projects VALUES ('project-1', 'Old', '{"version":12,"layers":[]}', 12, 3, 't', 't');
    INSERT INTO operations VALUES ('op-1', 'project-1', 3, 'deblur', 'layer-1', NULL, '{}', 'run-9', 'running', NULL, NULL, NULL, NULL, NULL, NULL, 't', 't');`);
  legacy.close();

  const store = openStore({ databasePath, dataDir: path.join(dir, "storage") });
  assert.equal(store.db.prepare("PRAGMA user_version").get().user_version, SCHEMA_VERSION);
  assert.equal(store.getOperation("op-1").submission, "accepted");
  assert.equal(store.openProject("project-1").revision, 3);
  store.close();

  const newer = new DatabaseSync(databasePath);
  newer.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
  newer.close();
  assert.throws(() => openStore({ databasePath, dataDir: path.join(dir, "storage") }), /newer than this Image Studio/);
});

test("refuses to start on a corrupted database", () => {
  const dir = tempDir();
  const databasePath = path.join(dir, "db.sqlite");
  fs.writeFileSync(databasePath, Buffer.concat([Buffer.from("SQLite format 3\0"), Buffer.alloc(4096, 0x41)]));
  assert.throws(() => openStore({ databasePath, dataDir: path.join(dir, "storage") }));
});

test("a crash during submission is recorded as unknown and never resubmitted automatically", async (t) => {
  const fake = await startFakeSkillsmaster();
  t.after(() => fake.close());
  const dir = tempDir();
  const first = await aiApp(t, dir, fake);
  const { projectId } = await savedProject(first);
  // Simulate the process dying after the request left: the row is still "sent".
  first.store.prepareOperation(projectId, JSON.parse(operationForm(projectId).get("operation")));
  first.store.updateOperation("ai-operation-1", { submission: "sent" });
  await first.close();

  const app = await aiApp(t, dir, fake);
  assert.equal(app.store.recovery.interruptedSubmissions, 1);
  const operation = (await (await app.fetch(`/image-studio/projects/${projectId}`)).json()).operations[0];
  assert.equal(operation.status, "failed");
  assert.equal(operation.submission, "unknown");
  assert.match(operation.error, /unknown whether skillsmaster accepted it/);

  const again = await app.fetch(`/local-ai/projects/${projectId}/operations`, { method: "POST", body: operationForm(projectId) });
  assert.equal(again.status, 409);
  assert.equal(fake.state.submissions.length, 0, "nothing may be resent under the same operation id");
  // A user-initiated new edit is a new operation and is submitted normally.
  const fresh = await app.fetch(`/local-ai/projects/${projectId}/operations`, { method: "POST", body: operationForm(projectId, "ai-operation-2") });
  assert.equal(fresh.status, 200);
  assert.equal(fake.state.submissions.length, 1);
});

test("a timeout or 5xx while submitting leaves the outcome unknown without resubmitting", async (t) => {
  const fake = await startFakeSkillsmaster();
  t.after(() => fake.close());
  const app = await aiApp(t, tempDir(), fake, { requestTimeoutMs: 1000 });
  const { projectId } = await savedProject(app);

  fake.state.submitBehavior = "hang";
  const timedOut = await app.fetch(`/local-ai/projects/${projectId}/operations`, { method: "POST", body: operationForm(projectId) });
  assert.equal(timedOut.status, 502);
  assert.equal(app.store.getOperation("ai-operation-1").submission, "unknown");
  fake.state.submitBehavior = null;
  assert.equal((await app.fetch(`/local-ai/projects/${projectId}/operations`, { method: "POST", body: operationForm(projectId) })).status, 409);

  fake.state.submitBehavior = { status: 503, body: { detail: "upstream busy" } };
  const unavailable = await app.fetch(`/local-ai/projects/${projectId}/operations`, { method: "POST", body: operationForm(projectId, "ai-operation-2") });
  assert.equal(unavailable.status, 502);
  assert.match((await unavailable.json()).detail, /unknown whether skillsmaster accepted it/);
  assert.equal(app.store.getOperation("ai-operation-2").status, "failed");

  fake.state.submitBehavior = { status: 422, body: { detail: "bad mode" } };
  const rejected = await app.fetch(`/local-ai/projects/${projectId}/operations`, { method: "POST", body: operationForm(projectId, "ai-operation-3") });
  assert.equal(rejected.status, 422);
  assert.equal(app.store.getOperation("ai-operation-3").submission, "rejected");
  assert.equal(fake.state.submissions.length, 3, "each operation reached skillsmaster exactly once");
});

test("with a confirmed idempotent upstream an interrupted submission resumes under the same key", async (t) => {
  const fake = await startFakeSkillsmaster();
  t.after(() => fake.close());
  const dir = tempDir();
  const first = await aiApp(t, dir, fake, { idempotentSubmit: true });
  const { projectId } = await savedProject(first);
  first.store.prepareOperation(projectId, JSON.parse(operationForm(projectId).get("operation")));
  first.store.updateOperation("ai-operation-1", { submission: "sent" });
  await first.close();

  const app = await aiApp(t, dir, fake, { idempotentSubmit: true });
  assert.equal(app.store.getOperation("ai-operation-1").status, "submitting");
  const resumed = await app.fetch(`/local-ai/projects/${projectId}/operations`, { method: "POST", body: operationForm(projectId) });
  assert.equal(resumed.status, 200);
  assert.equal(fake.state.submissions[0].headers["idempotency-key"], "ai-operation-1");
  assert.equal(app.store.getOperation("ai-operation-1").submission, "accepted");
});

test("a connection that was refused is known not to have been sent and stays resumable", async (t) => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "key"), "customer-key");
  const closed = http.createServer();
  await new Promise((resolve) => closed.listen(0, "127.0.0.1", resolve));
  const port = closed.address().port;
  await new Promise((resolve) => closed.close(resolve));
  const app = await startApp({ dir, ai: { baseUrl: `http://127.0.0.1:${port}`, customerKeyFile: path.join(dir, "key") } });
  t.after(() => app.close());
  const { projectId } = await savedProject(app);
  const response = await app.fetch(`/local-ai/projects/${projectId}/operations`, { method: "POST", body: operationForm(projectId) });
  assert.equal(response.status, 502);
  const operation = app.store.getOperation("ai-operation-1");
  assert.equal(operation.submission, "pending");
  assert.equal(operation.status, "submitting");
});

test("a result file lost from storage is downloaded again instead of served as missing", async (t) => {
  const fake = await startFakeSkillsmaster();
  t.after(() => fake.close());
  const dir = tempDir();
  const first = await aiApp(t, dir, fake);
  const { projectId } = await savedProject(first);
  const { runId } = await (await first.fetch(`/local-ai/projects/${projectId}/operations`, { method: "POST", body: operationForm(projectId) })).json();
  await first.fetch(`/local-ai/runs/${runId}`);
  await first.fetch(`/local-ai/runs/${runId}`);
  assert.equal((await first.fetch(`/local-ai/runs/${runId}/result`)).status, 200);
  const resultFile = first.store.resultPath(first.store.getOperation("ai-operation-1"));
  await first.close();
  fs.rmSync(resultFile);

  const app = await aiApp(t, dir, fake);
  assert.equal(app.store.getOperation("ai-operation-1").resultMimeType, null);
  const result = await app.fetch(`/local-ai/runs/${runId}/result`);
  assert.equal(result.status, 200);
  assert.deepEqual(Buffer.from(await result.arrayBuffer()), png(7, 9));
});

test("an online backup restores into a working installation", async (t) => {
  const { backup } = await import("../backup.mjs");
  const dir = tempDir();
  const app = await startApp({ dir });
  const { projectId, assetId } = await savedProject(app);
  const target = path.join(tempDir(), "backup");
  const manifest = backup(app.config, target);
  assert.equal(manifest.projects, 1);
  assert.equal(manifest.schemaVersion, SCHEMA_VERSION);
  assert.throws(() => backup(app.config, target), /must be empty/);
  assert.throws(() => backup(app.config, path.join(app.config.storage.dataDir, "backups")), /outside the storage directory/);
  await app.close();

  const restoredDir = tempDir();
  fs.mkdirSync(path.join(restoredDir, "db"));
  fs.copyFileSync(path.join(target, "image-studio.sqlite"), path.join(restoredDir, "db", "studio.sqlite"));
  fs.cpSync(path.join(target, "storage"), path.join(restoredDir, "storage"), { recursive: true });
  const restored = await startApp({ dir: restoredDir, recover: true });
  t.after(() => restored.close());
  assert.equal((await (await restored.fetch(`/image-studio/projects/${projectId}`)).json()).revision, 2);
  assert.equal((await restored.fetch(`/image-studio/projects/${projectId}/assets/${assetId}`)).status, 200);
});
