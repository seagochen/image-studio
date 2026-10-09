import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { importLegacyExport } from "../importLegacy.mjs";
import { createHostedStores } from "../hostedStores.mjs";
import { tempDir, png, documentWith, rasterLayer } from "./helpers.mjs";

function fixture() {
  const base = tempDir(); const source = path.join(base, "export"); fs.mkdirSync(path.join(source, "objects"), { recursive: true });
  const bytes = png(); const hash = crypto.createHash("sha256").update(bytes).digest("hex");
  fs.writeFileSync(path.join(source, "objects", hash), bytes);
  const time = new Date().toISOString();
  const bundle = { schemaVersion: 1, moduleId: "image-studio", users: [{ userId: "alice",
    projects: [{ id: "old-project", user_id: "alice", title: "Existing", document_json: JSON.stringify(documentWith([rasterLayer("layer", "old-asset")])), revision: 9, created_at: time, updated_at: time }],
    assets: [{ id: "old-asset", project_id: "old-project", user_id: "alice", state: "ready", sha256: hash, size_bytes: bytes.length, mime_type: "image/png", width: 2, height: 3, created_at: time }], operations: [] }] };
  const write = () => fs.writeFileSync(path.join(source, "export.json"), JSON.stringify(bundle)); write();
  return { source, target: path.join(base, "imported"), bundle, write, hash };
}

test("preserves project identities, revisions, documents and asset bytes without reapplying a migration", () => {
  const data = fixture(); const report = importLegacyExport(data.source, data.target);
  assert.equal(report.projects, 1); assert.equal(report.assets, 1);
  const stores = createHostedStores({ rootDir: data.target }); const user = stores.acquire("alice");
  const project = user.store.openProject("old-project"); assert.equal(project.revision, 9);
  assert.equal(project.document.layers[0].source.assetId, "old-asset");
  assert.equal(fs.readFileSync(user.store.readAsset("old-project", "old-asset").path).length, png().length);
  user.store.saveProject("old-project", { revision: 9, document: project.document, title: "Edited" });
  user.release(); stores.close();
  assert.equal(importLegacyExport(data.source, data.target).replay, true);
  const reopened = createHostedStores({ rootDir: data.target }); const owner = reopened.acquire("alice");
  assert.equal(owner.store.openProject("old-project").title, "Edited");
  const bob = reopened.acquire("bob"); assert.throws(() => bob.store.openProject("old-project"), /not found/i);
  bob.release(); owner.release(); reopened.close();
});

test("rejects changed export, foreign assets and corrupt bytes without creating destination data", () => {
  const data = fixture(); data.bundle.users[0].assets[0].user_id = "bob"; data.write();
  assert.throws(() => importLegacyExport(data.source, data.target), /identity/); assert.equal(fs.existsSync(data.target), false);
  data.bundle.users[0].assets[0].user_id = "alice"; data.write();
  fs.writeFileSync(path.join(data.source, "objects", data.hash), "corrupted");
  assert.throws(() => importLegacyExport(data.source, data.target), /checksum/); assert.equal(fs.existsSync(data.target), false);
});

test("refuses in-flight submissions and unresolved result delivery before touching the destination", () => {
  const data = fixture(); data.bundle.users[0].operations.push({ id: "operation", project_id: "old-project", user_id: "alice", status: "running" }); data.write();
  assert.throws(() => importLegacyExport(data.source, data.target), /Drain/); assert.equal(fs.existsSync(data.target), false);
  data.bundle.users[0].operations[0].status = "success"; data.write();
  assert.throws(() => importLegacyExport(data.source, data.target), /Drain/); assert.equal(fs.existsSync(data.target), false);
});

test("preserves completed operation identities and archives deleted projects without resurrecting them", () => {
  const data = fixture(); const user = data.bundle.users[0]; const time = user.projects[0].created_at;
  user.operations.push({ id: "operation", project_id: "old-project", user_id: "alice", status: "success",
    base_revision: 8, mode: "denoise", input_layer_id: "layer", mask_layer_id: null, parameters_json: "{}",
    run_id: "original-run", output_layer_id: "result-layer", error: null, retry_of: null, recipe_id: "recipe",
    step_index: 0, created_at: time, updated_at: time });
  user.projects.push({ ...user.projects[0], id: "deleted-project", deleted_at: time });
  user.operations.push({ id: "deleted-operation", project_id: "deleted-project", user_id: "alice", status: "success", output_layer_id: null });
  data.write(); const report = importLegacyExport(data.source, data.target);
  assert.equal(report.operations, 1); assert.equal(report.projects, 1);
  const stores = createHostedStores({ rootDir: data.target }); const owner = stores.acquire("alice");
  const operation = owner.store.getOperation("operation");
  assert.equal(operation.runId, "original-run"); assert.equal(operation.status, "succeeded");
  assert.equal(operation.resultLayerId, "result-layer"); assert.equal(operation.recipeId, "recipe");
  assert.throws(() => owner.store.openProject("deleted-project"), /not found/i);
  const key = crypto.createHash("sha256").update("alice").digest("hex");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(data.target, "users", key, "legacy-records.json"))), user);
  owner.release(); stores.close();
  user.projects[0].title = "Different source"; data.write();
  assert.throws(() => importLegacyExport(data.source, data.target), /different migration/);
});

test("rejects a linked object directory before importing", () => {
  const data = fixture(); const original = path.join(data.source, "objects");
  fs.renameSync(original, `${original}-elsewhere`); fs.symlinkSync(`${original}-elsewhere`, original, "dir");
  assert.throws(() => importLegacyExport(data.source, data.target), /object directory/);
  assert.equal(fs.existsSync(data.target), false);
});
