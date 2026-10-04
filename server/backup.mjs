// Online backup of a standalone installation:
//
//   node server/backup.mjs <empty-target-directory>
//
// Reads the same config as the server (IMAGE_STUDIO_CONFIG). The database is copied
// with VACUUM INTO, which produces a consistent snapshot while the server keeps running;
// the storage directory is copied afterwards. Restore by stopping the container and
// putting image-studio.sqlite and storage/ back in place (see README "备份与恢复").
// Startup recovery then removes any files the snapshot no longer references.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { loadConfig, ConfigError } from "./config.mjs";
import { SCHEMA_VERSION } from "./store.mjs";

export function backup(config, target, now = new Date()) {
  if (config.mode !== "standalone") throw new ConfigError("Backups apply to standalone mode only; platform mode holds no data");
  const destination = path.resolve(target);
  if (fs.existsSync(destination) && fs.readdirSync(destination).length) throw new Error(`${destination} must be empty or missing`);
  const { databasePath, dataDir } = config.storage;
  if (destination === dataDir || destination.startsWith(`${dataDir}${path.sep}`)) throw new Error("The backup target must be outside the storage directory");
  fs.mkdirSync(destination, { recursive: true });

  const databaseCopy = path.join(destination, "image-studio.sqlite");
  const db = new DatabaseSync(databasePath, { readOnly: true });
  let schemaVersion;
  let projects;
  try {
    schemaVersion = db.prepare("PRAGMA user_version").get().user_version;
    projects = db.prepare("SELECT COUNT(*) AS count FROM projects").get().count;
    db.prepare("VACUUM INTO ?").run(databaseCopy);
  } finally {
    db.close();
  }
  fs.cpSync(dataDir, path.join(destination, "storage"), {
    recursive: true,
    filter: (source) => !source.endsWith(".tmp"),
  });
  const manifest = { createdAt: now.toISOString(), schemaVersion, appSchemaVersion: SCHEMA_VERSION, projects };
  fs.writeFileSync(path.join(destination, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const target = process.argv[2];
    if (!target) throw new ConfigError("Usage: node server/backup.mjs <empty-target-directory>");
    const manifest = backup(loadConfig(), target);
    process.stdout.write(`backup written to ${path.resolve(target)} (${manifest.projects} projects, schema ${manifest.schemaVersion})\n`);
  } catch (error) {
    process.stderr.write(`backup failed: ${error.message}\n`);
    process.exit(1);
  }
}
