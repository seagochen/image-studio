// Imports an offline, application-only export. It never connects to platform storage.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { openStore, validateDocument, assetReferences } from "./store.mjs";

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const identifier = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);

/** The destination is built in staging; existing user data is never merged or overwritten. */
export function importLegacyExport(source, destination) {
  const sourceRoot = fs.realpathSync(source);
  const exportPath = path.join(sourceRoot, "export.json");
  if (!fs.lstatSync(exportPath).isFile() || fs.realpathSync(exportPath) !== exportPath) throw new Error("Invalid legacy export file");
  const objectsRoot = path.join(sourceRoot, "objects");
  if (!fs.lstatSync(objectsRoot).isDirectory() || fs.realpathSync(objectsRoot) !== objectsRoot) throw new Error("Invalid legacy object directory");
  const bundle = JSON.parse(fs.readFileSync(exportPath, "utf8"));
  if (bundle.schemaVersion !== 1 || bundle.moduleId !== "image-studio" || !Array.isArray(bundle.users)) throw new Error("Invalid Image Studio legacy export");
  const digest = sha256(Buffer.from(JSON.stringify(bundle)));
  const target = path.resolve(destination);
  const receipt = path.join(target, "legacy-import.json");
  if (fs.existsSync(receipt)) {
    const prior = JSON.parse(fs.readFileSync(receipt, "utf8"));
    if (prior.sourceDigest !== digest) throw new Error("Destination already contains a different migration");
    return { ...prior, replay: true };
  }
  if (fs.existsSync(target)) throw new Error("Legacy migration requires a new destination");
  const targetRoot = path.join(fs.realpathSync(path.dirname(target)), path.basename(target));
  if (targetRoot === sourceRoot || targetRoot.startsWith(`${sourceRoot}${path.sep}`) || sourceRoot.startsWith(`${targetRoot}${path.sep}`)) throw new Error("Migration directories must not overlap");
  const users = new Set();
  for (const user of bundle.users) {
    if (typeof user.userId !== "string" || !user.userId || user.userId.length > 200 || users.has(user.userId)
      || ![user.projects, user.assets, user.operations].every(Array.isArray)) throw new Error("Invalid legacy owner data");
    users.add(user.userId);
    for (const rows of [user.projects, user.assets, user.operations]) {
      const ids = new Set();
      for (const row of rows) {
        if (!identifier(row.id) || row.user_id !== user.userId || ids.has(row.id)) throw new Error("Invalid legacy row ownership or identity");
        ids.add(row.id);
      }
    }
    const allProjects = new Set(user.projects.map((project) => project.id));
    if ([...user.assets, ...user.operations].some((row) => !allProjects.has(row.project_id))) throw new Error("Legacy row references a missing or foreign project");
    const activeProjects = new Set(user.projects.filter((project) => !project.deleted_at).map((project) => project.id));
    if (user.operations.some((operation) => activeProjects.has(operation.project_id) && (!["success", "failed"].includes(operation.status)
      || (operation.status === "success" && !operation.output_layer_id)))) {
      throw new Error("Drain running submissions and apply or resolve ready results before migration");
    }
  }
  const staging = fs.mkdtempSync(path.join(path.dirname(target), ".image-studio-import-"));
  const report = { sourceDigest: digest, users: 0, projects: 0, assets: 0, operations: 0 };
  try {
    for (const user of bundle.users) {
      const key = sha256(Buffer.from(user.userId)); const root = path.join(staging, "users", key);
      const store = openStore({ databasePath: path.join(root, "db", "image-studio.sqlite"), dataDir: path.join(root, "storage") });
      try {
        const projects = new Set();
        const importedAssets = new Map();
        for (const project of user.projects.filter((item) => !item.deleted_at)) {
          if (!identifier(project.id) || project.user_id !== user.userId || projects.has(project.id) || !Number.isInteger(project.revision) || project.revision < 1) throw new Error("Invalid legacy project ownership or revision");
          const document = validateDocument(JSON.parse(project.document_json));
          store.db.prepare(`INSERT INTO projects (id,title,document_json,document_version,revision,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?)`).run(project.id, project.title, JSON.stringify(document), document.version, project.revision, project.created_at, project.updated_at);
          projects.add(project.id); report.projects += 1;
        }
        for (const asset of user.assets.filter((item) => projects.has(item.project_id) && ["staged", "ready"].includes(item.state))) {
          if (!identifier(asset.id) || asset.user_id !== user.userId || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error("Invalid legacy asset identity");
          const file = path.join(sourceRoot, "objects", asset.sha256);
          if (!fs.lstatSync(file).isFile() || fs.realpathSync(file) !== file) throw new Error("Invalid legacy asset file");
          const bytes = fs.readFileSync(file);
          if (bytes.length !== asset.size_bytes || sha256(bytes) !== asset.sha256) throw new Error("Legacy asset checksum mismatch");
          const targetFile = store.assetPath(asset.project_id, asset.id); fs.mkdirSync(path.dirname(targetFile), { recursive: true });
          fs.writeFileSync(targetFile, bytes, { flag: "wx" });
          store.db.prepare(`INSERT INTO assets (id,project_id,mime_type,width,height,size_bytes,sha256,created_at) VALUES (?,?,?,?,?,?,?,?)`)
            .run(asset.id, asset.project_id, asset.mime_type, asset.width, asset.height, asset.size_bytes, asset.sha256, asset.created_at);
          importedAssets.set(asset.id, asset.project_id); report.assets += 1;
        }
        for (const projectId of projects) {
          const project = store.openProject(projectId);
          if (assetReferences(project.document).some((id) => importedAssets.get(id) !== projectId)) throw new Error("Legacy project references a missing or foreign asset");
        }
        for (const operation of user.operations.filter((item) => projects.has(item.project_id))) {
          if (!identifier(operation.id) || operation.user_id !== user.userId) throw new Error("Invalid legacy operation ownership");
          store.db.prepare(`INSERT INTO operations (id,project_id,base_revision,mode,input_layer_id,mask_layer_id,parameters_json,
            run_id,status,result_layer_id,error,retry_of,recipe_id,step_index,created_at,updated_at,submission)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(operation.id, operation.project_id, operation.base_revision, operation.mode,
              operation.input_layer_id, operation.mask_layer_id, operation.parameters_json, operation.run_id,
              operation.status === "success" ? "succeeded" : "failed", operation.output_layer_id, operation.error,
              operation.retry_of, operation.recipe_id, operation.step_index, operation.created_at, operation.updated_at,
              operation.run_id ? "accepted" : "rejected");
          report.operations += 1;
        }
        fs.writeFileSync(path.join(root, "legacy-records.json"), `${JSON.stringify(user)}\n`, { flag: "wx" });
        if (store.db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Imported database foreign keys are invalid");
      } finally { store.close(); }
      report.users += 1;
    }
    fs.writeFileSync(path.join(staging, "legacy-import.json"), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
    fs.renameSync(staging, target); return report;
  } finally { if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true }); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const [source, destination] = process.argv.slice(2);
    if (!source || !destination) throw new Error("Usage: importLegacy.mjs EXPORT_DIRECTORY NEW_DATA_ROOT");
    process.stdout.write(`${JSON.stringify(importLegacyExport(source, destination))}\n`);
  } catch (error) { process.stderr.write(`Legacy import failed: ${error.message}\n`); process.exit(1); }
}
