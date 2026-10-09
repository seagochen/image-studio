// Quiesced multi-user backup and restore. The application must be stopped first.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { loadConfig } from "./config.mjs";

function hash(file) {
  const digest = crypto.createHash("sha256"); const fd = fs.openSync(file, "r"); const buffer = Buffer.alloc(64 * 1024);
  try { let count; while ((count = fs.readSync(fd, buffer)) > 0) digest.update(buffer.subarray(0, count)); }
  finally { fs.closeSync(fd); }
  return digest.digest("hex");
}
const safePath = (name) => typeof name === "string" && !name.includes("\\") && !path.isAbsolute(name)
  && name.split("/").every((part) => part && part !== "." && part !== "..");

function files(root, relative = "") {
  const result = [];
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const name = path.posix.join(relative, entry.name);
    if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) throw new Error("Backup data must contain only regular files and directories");
    if (entry.isDirectory()) result.push(...files(root, name)); else result.push(name);
  }
  return result.sort();
}

function databaseCheck(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    if (db.prepare("PRAGMA integrity_check").all().some((row) => Object.values(row)[0] !== "ok")
      || db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Backup database verification failed");
    return Object.fromEntries(["projects", "assets", "operations"].map((table) => [table, db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n]));
  } finally { db.close(); }
}

function emptyTarget(target, source) {
  const destination = path.resolve(target);
  const origin = fs.realpathSync(source);
  const ancestor = fs.existsSync(destination) ? destination : path.dirname(destination);
  const resolved = path.join(fs.realpathSync(ancestor), fs.existsSync(destination) ? "" : path.basename(destination));
  if (resolved === origin || resolved.startsWith(`${origin}${path.sep}`) || origin.startsWith(`${resolved}${path.sep}`)) {
    throw new Error("Backup and restore directories must not overlap");
  }
  if (fs.existsSync(destination) && (!fs.lstatSync(destination).isDirectory() || fs.lstatSync(destination).isSymbolicLink()
    || fs.readdirSync(destination).length)) throw new Error("Destination must be an empty directory or absent");
  return destination;
}

export function backupHosted(config, target, { quiesced = false } = {}) {
  if (config.mode !== "hosted" || !quiesced) throw new Error("Stop the hosted application and explicitly acknowledge quiesced storage");
  const root = fs.realpathSync(config.storage.rootDir);
  const destination = emptyTarget(target, root);
  fs.mkdirSync(destination, { recursive: true });
  const inventory = files(root).filter((name) => !name.endsWith("-wal") && !name.endsWith("-shm") && !name.endsWith(".tmp"));
  const databases = {};
  for (const name of inventory) {
    const file = path.join(destination, name); fs.mkdirSync(path.dirname(file), { recursive: true });
    if (/^users\/[a-f0-9]{64}\/db\/image-studio\.sqlite$/.test(name)) {
      const db = new DatabaseSync(path.join(root, name), { readOnly: true });
      try { db.prepare("VACUUM INTO ?").run(file); } finally { db.close(); }
      databases[name] = databaseCheck(file);
    } else fs.copyFileSync(path.join(root, name), file, fs.constants.COPYFILE_EXCL);
  }
  const manifest = { schemaVersion: 1, moduleId: "image-studio", createdAt: new Date().toISOString(), databases,
    files: files(destination).map((name) => ({ path: name, size: fs.statSync(path.join(destination, name)).size, sha256: hash(path.join(destination, name)) })) };
  fs.writeFileSync(path.join(destination, "backup-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  verifyHostedBackup(destination); return manifest;
}

export function verifyHostedBackup(source) {
  const root = fs.realpathSync(source);
  const inventory = files(root);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "backup-manifest.json"), "utf8"));
  if (manifest.schemaVersion !== 1 || manifest.moduleId !== "image-studio" || !Array.isArray(manifest.files)
    || !manifest.databases || typeof manifest.databases !== "object") throw new Error("Invalid hosted backup manifest");
  const declared = new Set();
  for (const entry of manifest.files) {
    if (!safePath(entry.path) || entry.path === "backup-manifest.json" || declared.has(entry.path)) throw new Error("Invalid backup path");
    declared.add(entry.path);
    const file = path.join(root, entry.path);
    if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size !== entry.size || hash(file) !== entry.sha256) {
      throw new Error("Backup file verification failed");
    }
  }
  const actual = inventory.filter((name) => name !== "backup-manifest.json");
  if (actual.length !== declared.size || actual.some((name) => !declared.has(name))) throw new Error("Backup inventory does not match its files");
  for (const [name, counts] of Object.entries(manifest.databases)) {
    if (!/^users\/[a-f0-9]{64}\/db\/image-studio\.sqlite$/.test(name) || !declared.has(name)
      || JSON.stringify(databaseCheck(path.join(root, name))) !== JSON.stringify(counts)) throw new Error("Backup database counts do not match");
  }
  if (actual.filter((name) => name.endsWith("/image-studio.sqlite")).length !== Object.keys(manifest.databases).length) {
    throw new Error("Backup database inventory is incomplete");
  }
  return manifest;
}

export function restoreHostedBackup(source, target) {
  const manifest = verifyHostedBackup(source);
  const destination = emptyTarget(target, source);
  const staging = fs.mkdtempSync(path.join(path.dirname(destination), ".image-studio-restore-"));
  try {
    fs.cpSync(source, staging, { recursive: true }); verifyHostedBackup(staging);
    fs.unlinkSync(path.join(staging, "backup-manifest.json"));
    if (fs.existsSync(destination)) fs.rmdirSync(destination);
    fs.renameSync(staging, destination); return manifest;
  } finally { if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true }); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const [action, source, destination] = process.argv.slice(2);
    if (action === "backup" && source && destination === "--quiesced") backupHosted(loadConfig(), source, { quiesced: true });
    else if (action === "verify" && source && !destination) verifyHostedBackup(source);
    else if (action === "restore" && source && destination) restoreHostedBackup(source, destination);
    else throw new Error("Usage: hostedBackup.mjs backup TARGET --quiesced | verify SOURCE | restore SOURCE EMPTY_TARGET");
    process.stdout.write("Hosted backup operation verified\n");
  } catch (error) { process.stderr.write(`Hosted backup operation failed: ${error.message}\n`); process.exit(1); }
}
