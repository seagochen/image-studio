import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { documentWith, jsonInit, png, rasterLayer, startApp, tempDir } from "./helpers.mjs";

async function createProject(app, title = "Portrait") {
  const response = await app.fetch("/image-studio/projects", jsonInit("POST", { title, document: documentWith() }));
  assert.equal(response.status, 201);
  return response.json();
}

async function uploadAsset(app, projectId, bytes = png(), type = "image/png") {
  return app.fetch(`/image-studio/projects/${projectId}/assets`, { method: "POST", headers: { "Content-Type": type }, body: bytes });
}

test("creates, saves, lists and reopens a project with its assets", async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  const project = await createProject(app);
  assert.equal(project.revision, 1);

  const asset = await (await uploadAsset(app, project.id)).json();
  assert.deepEqual({ width: asset.width, height: asset.height, mimeType: asset.mimeType }, { width: 2, height: 3, mimeType: "image/png" });

  const saved = await app.fetch(`/image-studio/projects/${project.id}`, jsonInit("PUT", {
    title: "Renamed", revision: 1, document: documentWith([rasterLayer("layer-1", asset.id)]), retainedAssetIds: [],
  }));
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).revision, 2);

  const list = await (await app.fetch("/image-studio/projects")).json();
  assert.deepEqual(list.items.map((item) => item.title), ["Renamed"]);

  const opened = await (await app.fetch(`/image-studio/projects/${project.id}`)).json();
  assert.equal(opened.document.layers[0].source.assetId, asset.id);
  assert.equal(opened.assets[0].id, asset.id);
  const bytes = Buffer.from(await (await app.fetch(opened.assets[0].url)).arrayBuffer());
  assert.deepEqual(bytes, png());
});

test("survives a restart using the same database and storage volume", async () => {
  const dir = tempDir();
  const first = await startApp({ dir });
  const project = await createProject(first);
  const asset = await (await uploadAsset(first, project.id)).json();
  await first.fetch(`/image-studio/projects/${project.id}`, jsonInit("PUT", { revision: 1, document: documentWith([rasterLayer("l", asset.id)]) }));
  await first.close();

  const second = await startApp({ dir });
  try {
    const opened = await (await second.fetch(`/image-studio/projects/${project.id}`)).json();
    assert.equal(opened.revision, 2);
    assert.equal((await second.fetch(opened.assets[0].url)).status, 200);
  } finally { await second.close(); }
});

test("returns a recoverable 409 with the current revision on save conflicts", async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  const project = await createProject(app);
  await app.fetch(`/image-studio/projects/${project.id}`, jsonInit("PUT", { revision: 1, document: documentWith() }));
  const conflict = await app.fetch(`/image-studio/projects/${project.id}`, jsonInit("PUT", { revision: 1, document: documentWith() }));
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).currentRevision, 2);
});

test("rejects missing or foreign assets, inline pixels and invalid uploads", async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  const project = await createProject(app);
  const other = await createProject(app, "Other");
  const foreign = await (await uploadAsset(app, other.id)).json();

  for (const document of [documentWith([rasterLayer("l", "asset-missing")]), documentWith([rasterLayer("l", foreign.id)])]) {
    const response = await app.fetch(`/image-studio/projects/${project.id}`, jsonInit("PUT", { revision: 1, document }));
    assert.equal(response.status, 422);
  }
  const inline = documentWith([{ id: "l", type: "raster", source: { kind: "data-url", value: "data:image/png;base64,AA", mimeType: "image/png" } }]);
  assert.equal((await app.fetch(`/image-studio/projects/${project.id}`, jsonInit("PUT", { revision: 1, document: inline }))).status, 422);

  assert.equal((await uploadAsset(app, project.id, png(), "image/gif")).status, 415);
  assert.equal((await uploadAsset(app, project.id, Buffer.from("not an image"), "image/png")).status, 422);
  assert.equal((await uploadAsset(app, project.id, png(), "image/jpeg")).status, 422);
  assert.equal((await uploadAsset(app, project.id, Buffer.concat([png(), Buffer.alloc(5000)]))).status, 413);
  assert.equal((await uploadAsset(app, project.id, png(20_000, 10))).status, 413);
  assert.equal((await uploadAsset(app, "project-unknown")).status, 404);
  assert.equal((await app.fetch("/image-studio/projects", { method: "POST", body: "{}" })).status, 415);
});

test("cleans up unreferenced assets on save and all files on project delete", async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  const project = await createProject(app);
  const kept = await (await uploadAsset(app, project.id)).json();
  const retained = await (await uploadAsset(app, project.id)).json();
  const dropped = await (await uploadAsset(app, project.id)).json();
  await app.fetch(`/image-studio/projects/${project.id}`, jsonInit("PUT", {
    revision: 1, document: documentWith([rasterLayer("l", kept.id)]), retainedAssetIds: [retained.id],
  }));
  assert.equal((await app.fetch(dropped.url)).status, 404);
  assert.equal((await app.fetch(retained.url)).status, 200);
  assert.equal((await app.fetch(kept.url, { method: "DELETE" })).status, 409, "referenced assets cannot be deleted");
  assert.equal((await app.fetch(retained.url, { method: "DELETE" })).status, 204);

  const projectDir = path.join(app.config.storage.dataDir, "projects", project.id);
  assert.ok(fs.existsSync(projectDir));
  assert.equal((await app.fetch(`/image-studio/projects/${project.id}`, { method: "DELETE" })).status, 204);
  assert.ok(!fs.existsSync(projectDir));
  assert.equal((await app.fetch(`/image-studio/projects/${project.id}`)).status, 404);
});

test("rejects cross-origin writes to the local API", async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  const response = await app.fetch("/image-studio/projects", {
    ...jsonInit("POST", { document: documentWith() }), headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
  });
  assert.equal(response.status, 403);
});

test("enforces optional basic auth except for /healthz", async (t) => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "password"), "s3cret\n");
  const app = await startApp({ dir, access: { basicAuth: { username: "studio", passwordFile: path.join(dir, "password") } } });
  t.after(() => app.close());
  assert.equal((await app.fetch("/healthz")).status, 200);
  assert.equal((await app.fetch("/image-studio/projects")).status, 401);
  const wrong = Buffer.from("studio:nope").toString("base64");
  assert.equal((await app.fetch("/image-studio/projects", { headers: { Authorization: `Basic ${wrong}` } })).status, 401);
  const right = Buffer.from("studio:s3cret").toString("base64");
  assert.equal((await app.fetch("/image-studio/projects", { headers: { Authorization: `Basic ${right}` } })).status, 200);
});
