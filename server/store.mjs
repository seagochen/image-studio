// Standalone persistence: SQLite holds project, asset and AI operation metadata;
// asset bytes and AI result bytes live as files under the storage directory.
// Both locations are expected to be mounted volumes so projects survive restarts.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export const OPERATION_STATUSES = Object.freeze([
  "draft", "submitting", "running", "result-ready", "succeeded", "failed", "delivery-failed", "stale", "cancelled",
]);

export class StoreError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  document_json TEXT NOT NULL,
  document_version INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  mime_type TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS assets_project ON assets(project_id);
CREATE TABLE IF NOT EXISTS operations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  base_revision INTEGER NOT NULL,
  mode TEXT NOT NULL,
  input_layer_id TEXT NOT NULL,
  mask_layer_id TEXT,
  parameters_json TEXT NOT NULL,
  run_id TEXT,
  status TEXT NOT NULL,
  result_layer_id TEXT,
  result_mime_type TEXT,
  error TEXT,
  retry_of TEXT,
  recipe_id TEXT,
  step_index INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS operations_project ON operations(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS operations_run ON operations(run_id) WHERE run_id IS NOT NULL;
`;

export function openStore({ databasePath, dataDir, now = () => new Date().toISOString() }) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  assertWritable(path.dirname(databasePath));
  assertWritable(dataDir);
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  return new Store(db, dataDir, now);
}

class Store {
  constructor(db, dataDir, now) {
    this.db = db;
    this.dataDir = dataDir;
    this.now = now;
  }

  close() { this.db.close(); }

  // ---- projects -------------------------------------------------------------

  listProjects() {
    return this.db.prepare("SELECT * FROM projects ORDER BY updated_at DESC").all().map(projectSummary);
  }

  createProject({ title, document }) {
    const id = `project-${crypto.randomUUID()}`;
    const doc = validateDocument(document);
    if (assetReferences(doc).length) throw new StoreError(422, "A new project cannot reference assets");
    const at = this.now();
    this.db.prepare(`INSERT INTO projects (id, title, document_json, document_version, revision, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)`).run(id, cleanTitle(title, doc), JSON.stringify(doc), documentVersion(doc), at, at);
    return this.projectSummary(id);
  }

  projectSummary(id) {
    return projectSummary(this.requireProject(id));
  }

  openProject(id) {
    const row = this.requireProject(id);
    return {
      ...projectSummary(row),
      document: JSON.parse(row.document_json),
      assets: this.db.prepare("SELECT * FROM assets WHERE project_id = ? ORDER BY created_at").all(id).map(assetJson),
      operations: this.db.prepare("SELECT * FROM operations WHERE project_id = ? ORDER BY created_at").all(id).map(operationJson),
    };
  }

  saveProject(id, { title, revision, document, retainedAssetIds = [] }) {
    const row = this.requireProject(id);
    if (!Number.isInteger(revision)) throw new StoreError(400, "revision must be an integer");
    if (revision !== row.revision) throw new StoreError(409, "Project was changed in another session", { currentRevision: row.revision });
    if (!Array.isArray(retainedAssetIds) || retainedAssetIds.some((value) => typeof value !== "string")) {
      throw new StoreError(400, "retainedAssetIds must be an array of strings");
    }
    const doc = validateDocument(document);
    const known = new Set(this.db.prepare("SELECT id FROM assets WHERE project_id = ?").all(id).map((asset) => asset.id));
    const referenced = assetReferences(doc);
    for (const assetId of referenced) {
      if (!known.has(assetId)) throw new StoreError(422, "Project references a missing asset", { assetId });
    }
    const keep = new Set([...referenced, ...retainedAssetIds.filter((assetId) => known.has(assetId))]);
    const removed = [...known].filter((assetId) => !keep.has(assetId));
    const at = this.now();
    this.transaction(() => {
      // Compare-and-swap on revision so concurrent writers cannot both succeed.
      const result = this.db.prepare(`UPDATE projects SET title = ?, document_json = ?, document_version = ?, revision = revision + 1, updated_at = ?
        WHERE id = ? AND revision = ?`).run(cleanTitle(title, doc), JSON.stringify(doc), documentVersion(doc), at, id, revision);
      if (result.changes !== 1) throw new StoreError(409, "Project was changed in another session", { currentRevision: this.requireProject(id).revision });
      const remove = this.db.prepare("DELETE FROM assets WHERE id = ? AND project_id = ?");
      for (const assetId of removed) remove.run(assetId, id);
    });
    for (const assetId of removed) removeFile(this.assetPath(id, assetId));
    return this.projectSummary(id);
  }

  deleteProject(id) {
    this.requireProject(id);
    this.db.prepare("DELETE FROM projects WHERE id = ?").run(id);
    fs.rmSync(this.projectDir(id), { recursive: true, force: true });
  }

  // ---- assets ---------------------------------------------------------------

  addAsset(projectId, { bytes, mimeType, width, height }) {
    this.requireProject(projectId);
    const id = `asset-${crypto.randomUUID()}`;
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    writeFileAtomic(this.assetPath(projectId, id), bytes);
    const at = this.now();
    try {
      this.db.prepare(`INSERT INTO assets (id, project_id, mime_type, width, height, size_bytes, sha256, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, projectId, mimeType, width, height, bytes.length, sha256, at);
    } catch (error) {
      removeFile(this.assetPath(projectId, id));
      throw error;
    }
    return assetJson(this.db.prepare("SELECT * FROM assets WHERE id = ?").get(id));
  }

  readAsset(projectId, assetId) {
    this.requireProject(projectId);
    const row = this.db.prepare("SELECT * FROM assets WHERE id = ? AND project_id = ?").get(assetId, projectId);
    if (!row) throw new StoreError(404, "Asset not found");
    return { mimeType: row.mime_type, sha256: row.sha256, path: this.assetPath(projectId, assetId) };
  }

  deleteAsset(projectId, assetId) {
    const row = this.requireProject(projectId);
    const asset = this.db.prepare("SELECT id FROM assets WHERE id = ? AND project_id = ?").get(assetId, projectId);
    if (!asset) throw new StoreError(404, "Asset not found");
    if (assetReferences(JSON.parse(row.document_json)).includes(assetId)) throw new StoreError(409, "Asset is referenced by the saved project");
    this.db.prepare("DELETE FROM assets WHERE id = ?").run(assetId);
    removeFile(this.assetPath(projectId, assetId));
  }

  // ---- AI operations --------------------------------------------------------

  getOperation(id) {
    const row = this.db.prepare("SELECT * FROM operations WHERE id = ?").get(id);
    return row ? operationJson(row) : null;
  }

  getOperationByRun(runId) {
    const row = this.db.prepare("SELECT * FROM operations WHERE run_id = ?").get(runId);
    return row ? operationJson(row) : null;
  }

  /** Inserts a new operation or returns the existing one with the same id (idempotent). */
  prepareOperation(projectId, input) {
    const project = this.requireProject(projectId);
    const operation = validateOperationInput(input);
    const existing = this.getOperation(operation.id);
    if (existing) {
      if (existing.projectId !== projectId) throw new StoreError(409, "Operation id belongs to another project");
      return existing;
    }
    const document = JSON.parse(project.document_json);
    if (!layerIds(document).has(operation.inputLayerId)) throw new StoreError(422, "Input layer is not part of the saved project");
    const at = this.now();
    this.db.prepare(`INSERT INTO operations (id, project_id, base_revision, mode, input_layer_id, mask_layer_id, parameters_json,
      run_id, status, result_layer_id, error, retry_of, recipe_id, step_index, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'submitting', NULL, NULL, ?, ?, ?, ?, ?)`).run(
      operation.id, projectId, operation.baseRevision, operation.mode, operation.inputLayerId, operation.maskLayerId,
      JSON.stringify(operation.parameters), operation.retryOf, operation.recipeId, operation.stepIndex, at, at,
    );
    return this.getOperation(operation.id);
  }

  updateOperation(id, patch) {
    const columns = { runId: "run_id", status: "status", error: "error", resultLayerId: "result_layer_id", resultMimeType: "result_mime_type" };
    const sets = [];
    const values = [];
    for (const [key, column] of Object.entries(columns)) {
      if (!(key in patch)) continue;
      if (key === "status" && !OPERATION_STATUSES.includes(patch.status)) throw new StoreError(400, "Unknown operation status");
      sets.push(`${column} = ?`);
      values.push(patch[key] ?? null);
    }
    if (!sets.length) return this.getOperation(id);
    sets.push("updated_at = ?");
    values.push(this.now(), id);
    this.db.prepare(`UPDATE operations SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    return this.getOperation(id);
  }

  completeOperation(projectId, operationId, resultLayerId) {
    this.requireProject(projectId);
    const operation = this.getOperation(operationId);
    if (!operation || operation.projectId !== projectId) throw new StoreError(404, "Operation not found");
    if (typeof resultLayerId !== "string" || !resultLayerId) throw new StoreError(400, "resultLayerId is required");
    if (!["result-ready", "succeeded", "delivery-failed", "running"].includes(operation.status)) throw new StoreError(409, "Operation has no result to link");
    return this.updateOperation(operationId, { status: "succeeded", resultLayerId, error: null });
  }

  resultPath(operation) {
    return path.join(this.projectDir(operation.projectId), "ai-results", `${safeName(operation.id)}.bin`);
  }

  writeResult(operation, bytes, mimeType) {
    writeFileAtomic(this.resultPath(operation), bytes);
    return this.updateOperation(operation.id, { resultMimeType: mimeType, status: operation.status === "succeeded" ? "succeeded" : "result-ready", error: null });
  }

  hasResult(operation) {
    return Boolean(operation.resultMimeType) && fs.existsSync(this.resultPath(operation));
  }

  // ---- helpers --------------------------------------------------------------

  requireProject(id) {
    const row = typeof id === "string" ? this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id) : undefined;
    if (!row) throw new StoreError(404, "Project not found");
    return row;
  }

  projectDir(projectId) { return path.join(this.dataDir, "projects", safeName(projectId)); }
  assetPath(projectId, assetId) { return path.join(this.projectDir(projectId), "assets", safeName(assetId)); }

  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try { fn(); this.db.exec("COMMIT"); }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
}

function projectSummary(row) {
  return {
    id: row.id, title: row.title, documentVersion: row.document_version, revision: row.revision,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function assetJson(row) {
  return {
    id: row.id, mimeType: row.mime_type, width: row.width, height: row.height, sizeBytes: row.size_bytes,
    url: `/image-studio/projects/${encodeURIComponent(row.project_id)}/assets/${encodeURIComponent(row.id)}`,
  };
}

function operationJson(row) {
  return {
    id: row.id, projectId: row.project_id, baseRevision: row.base_revision, mode: row.mode,
    inputLayerId: row.input_layer_id, maskLayerId: row.mask_layer_id, parameters: JSON.parse(row.parameters_json),
    runId: row.run_id, status: row.status, resultLayerId: row.result_layer_id, error: row.error,
    retryOf: row.retry_of, recipeId: row.recipe_id, stepIndex: row.step_index,
    resultMimeType: row.result_mime_type, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

/** Structural checks only; the editor owns full document normalization and migration. */
export function validateDocument(document) {
  if (!document || typeof document !== "object" || Array.isArray(document)) throw new StoreError(400, "document must be an object");
  if (!Number.isInteger(document.version) || document.version < 1) throw new StoreError(400, "document.version must be a positive integer");
  if (!Array.isArray(document.layers)) throw new StoreError(400, "document.layers must be an array");
  for (const layer of document.layers) {
    if (!layer || typeof layer !== "object" || typeof layer.id !== "string" || !layer.id) throw new StoreError(400, "Every layer needs an id");
    if (layer.type === "raster") {
      const source = layer.source;
      if (!source || typeof source !== "object") throw new StoreError(400, "Raster layer has no source");
      if (source.kind === "data-url") throw new StoreError(422, "Raster pixels must be uploaded as project assets before saving");
      if (source.kind !== "asset" || typeof source.assetId !== "string" || !source.assetId) throw new StoreError(400, "Raster layer has an invalid source");
    }
  }
  return document;
}

export function assetReferences(document) {
  const ids = [];
  for (const layer of document.layers ?? []) {
    if (layer?.type === "raster" && layer.source?.kind === "asset" && !ids.includes(layer.source.assetId)) ids.push(layer.source.assetId);
  }
  return ids;
}

function layerIds(document) {
  return new Set((document.layers ?? []).map((layer) => layer?.id).filter((id) => typeof id === "string"));
}

function documentVersion(document) { return document.version; }

function cleanTitle(title, document) {
  const value = typeof title === "string" && title.trim() ? title : typeof document.title === "string" ? document.title : "Untitled";
  return value.trim().slice(0, 200) || "Untitled";
}

function validateOperationInput(input) {
  const fail = (field) => { throw new StoreError(400, `Invalid AI operation field: ${field}`); };
  if (!input || typeof input !== "object") fail("operation");
  const id = input.id;
  if (typeof id !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(id)) fail("id");
  if (!Number.isInteger(input.baseRevision) || input.baseRevision < 1) fail("baseRevision");
  if (typeof input.mode !== "string" || !input.mode || input.mode.length > 128) fail("mode");
  if (typeof input.inputLayerId !== "string" || !input.inputLayerId) fail("inputLayerId");
  if (input.maskLayerId !== null && input.maskLayerId !== undefined && typeof input.maskLayerId !== "string") fail("maskLayerId");
  const parameters = input.parameters ?? {};
  if (typeof parameters !== "object" || Array.isArray(parameters) || Object.values(parameters).some((value) => typeof value !== "string")) fail("parameters");
  const optionalString = (value, field) => { if (value !== null && value !== undefined && typeof value !== "string") fail(field); return value ?? null; };
  const stepIndex = input.stepIndex ?? null;
  if (stepIndex !== null && (!Number.isInteger(stepIndex) || stepIndex < 0)) fail("stepIndex");
  return {
    id, baseRevision: input.baseRevision, mode: input.mode, inputLayerId: input.inputLayerId, maskLayerId: input.maskLayerId ?? null,
    parameters, retryOf: optionalString(input.retryOf, "retryOf"), recipeId: optionalString(input.recipeId, "recipeId"), stepIndex,
  };
}

function safeName(value) {
  if (!/^[A-Za-z0-9._-]{1,160}$/.test(value) || value === "." || value === "..") throw new StoreError(400, "Invalid identifier");
  return value;
}

function writeFileAtomic(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, bytes);
  fs.renameSync(temp, file);
}

function removeFile(file) {
  fs.rmSync(file, { force: true });
}

function assertWritable(directory) {
  try { fs.accessSync(directory, fs.constants.W_OK); }
  catch { throw new Error(`Directory ${directory} is not writable by uid ${process.getuid?.() ?? "?"}; check the volume mount and its owner`); }
}
