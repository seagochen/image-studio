import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { backupHosted, restoreHostedBackup, verifyHostedBackup } from "../hostedBackup.mjs";
import { createHostedStores } from "../hostedStores.mjs";
import { documentWith, tempDir } from "./helpers.mjs";

test("backs up and restores all users with verified databases and complete files", () => {
  const base = tempDir(); const rootDir = path.join(base, "data");
  const stores = createHostedStores({ rootDir });
  const alice = stores.acquire("alice"); const bob = stores.acquire("bob");
  const project = alice.store.createProject({ title: "Alice", document: documentWith() });
  bob.store.createProject({ title: "Bob", document: documentWith() });
  alice.release(); bob.release(); stores.close();
  const config = { mode: "hosted", storage: { rootDir } };
  const backup = path.join(base, "backup");
  assert.throws(() => backupHosted(config, backup), /Stop/);
  const manifest = backupHosted(config, backup, { quiesced: true });
  assert.equal(Object.keys(manifest.databases).length, 2);
  assert.equal(Object.values(manifest.databases).reduce((sum, item) => sum + item.projects, 0), 2);
  assert.throws(() => backupHosted(config, backup, { quiesced: true }), /empty/);
  const restored = path.join(base, "restored"); restoreHostedBackup(backup, restored);
  const app = createHostedStores({ rootDir: restored });
  const owner = app.acquire("alice"); assert.equal(owner.store.openProject(project.id).title, "Alice");
  owner.release(); app.close();
  assert.throws(() => restoreHostedBackup(backup, restored), /empty/);
  fs.writeFileSync(path.join(backup, manifest.files[0].path), "corrupted");
  assert.throws(() => verifyHostedBackup(backup), /verification/);
});

test("rejects links, overlapping destinations and unlisted files", () => {
  const base = tempDir(); const rootDir = path.join(base, "data"); fs.mkdirSync(rootDir);
  const config = { mode: "hosted", storage: { rootDir } };
  assert.throws(() => backupHosted(config, path.join(rootDir, "backup"), { quiesced: true }), /overlap/);
  fs.symlinkSync(base, path.join(rootDir, "escape"));
  assert.throws(() => backupHosted(config, path.join(base, "linked"), { quiesced: true }), /regular/);
  fs.unlinkSync(path.join(rootDir, "escape"));
  const backup = path.join(base, "backup"); backupHosted(config, backup, { quiesced: true });
  fs.writeFileSync(path.join(backup, "extra"), "not declared");
  assert.throws(() => verifyHostedBackup(backup), /inventory/);
});
