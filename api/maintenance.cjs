"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const CURRENT_SCHEMA_VERSION = 4;
const REQUIRED_TABLES = ["app_metadata", "complaints", "complaint_history", "users", "user_sessions", "complaint_owners"];

function sqlString(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function inspectDatabase(filePath) {
  const database = new DatabaseSync(filePath);
  try {
    const integrity = database.prepare("PRAGMA integrity_check").all();
    if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") {
      throw new Error("SQLite integrity check failed.");
    }
    const version = database.prepare("PRAGMA user_version").get().user_version;
    if (!Number.isInteger(version) || version < 1 || version > CURRENT_SCHEMA_VERSION) {
      throw new Error("Unsupported CivicDesk database schema version: " + version);
    }
    const tables = new Set(database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table'"
    ).all().map(row => row.name));
    for (const table of REQUIRED_TABLES) {
      if (!tables.has(table)) throw new Error("Database is missing required table: " + table);
    }
    const foreignKeyErrors = database.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeyErrors.length) throw new Error("Database contains foreign-key violations.");
    return { schemaVersion: version, integrity: "ok" };
  } finally {
    database.close();
  }
}

async function createBackup(sourceFile, destinationFile) {
  const source = path.resolve(sourceFile);
  const destination = path.resolve(destinationFile);
  if (source === destination) throw new Error("Backup destination must be different from the live database.");
  if (!(await exists(source))) throw new Error("Source database does not exist.");
  if (await exists(destination)) throw new Error("Backup destination already exists; choose a new filename.");

  const parent = path.dirname(destination);
  await fs.mkdir(parent, { recursive: true });
  const temporaryDirectory = await fs.mkdtemp(path.join(parent, ".civicdesk-backup-"));
  const temporaryFile = path.join(temporaryDirectory, "backup.sqlite");
  let database;
  try {
    database = new DatabaseSync(source);
    database.exec("PRAGMA busy_timeout = 5000;");
    database.exec("VACUUM INTO " + sqlString(temporaryFile));
    database.close();
    database = null;
    inspectDatabase(temporaryFile);
    await fs.rename(temporaryFile, destination);
    return destination;
  } finally {
    if (database) database.close();
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function restoreBackup(backupFile, targetFile) {
  const backup = path.resolve(backupFile);
  const target = path.resolve(targetFile);
  if (backup === target) throw new Error("Backup and live database paths must be different.");
  if (!(await exists(backup))) throw new Error("Backup file does not exist.");
  inspectDatabase(backup);

  const parent = path.dirname(target);
  await fs.mkdir(parent, { recursive: true });
  const temporaryDirectory = await fs.mkdtemp(path.join(parent, ".civicdesk-restore-"));
  const candidate = path.join(temporaryDirectory, "restored.sqlite");
  const displaced = path.join(temporaryDirectory, "previous.sqlite");
  let safetyBackup = null;
  let movedCurrent = false;
  try {
    await fs.copyFile(backup, candidate);
    inspectDatabase(candidate);

    if (await exists(target)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      safetyBackup = target + ".pre-restore-" + stamp + ".sqlite";
      await createBackup(target, safetyBackup);
      await fs.rename(target, displaced);
      movedCurrent = true;
    }

    try {
      await fs.rename(candidate, target);
    } catch (error) {
      if (movedCurrent) {
        await fs.rename(displaced, target);
        movedCurrent = false;
      }
      throw error;
    }

    if (movedCurrent) {
      await fs.rm(displaced, { force: true });
      movedCurrent = false;
    }
    return { target, safetyBackup };
  } finally {
    if (movedCurrent && !(await exists(target))) {
      await fs.rename(displaced, target).catch(() => {});
    }
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function defaultDatabasePath() {
  return process.env.CIVICDESK_API_DATA ||
    path.join(__dirname, "data", "civicdesk.sqlite");
}

async function main(args) {
  const [command, file] = args;
  const database = defaultDatabasePath();

  if (command === "backup") {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const destination = file || path.join(__dirname, "data", "backups", "civicdesk-" + stamp + ".sqlite");
    const result = await createBackup(database, destination);
    process.stdout.write("Backup created: " + result + "\n");
    return;
  }

  if (command === "restore" && file) {
    process.stdout.write("Restore requires the CivicDesk API server to be stopped.\n");
    const result = await restoreBackup(file, database);
    process.stdout.write("Database restored: " + result.target + "\n");
    if (result.safetyBackup) process.stdout.write("Previous database preserved at: " + result.safetyBackup + "\n");
    return;
  }

  process.stderr.write(
    "Usage:\n  node api/maintenance.cjs backup [destination.sqlite]\n" +
    "  node api/maintenance.cjs restore <backup.sqlite>\n"
  );
  process.exitCode = 1;
}

if (require.main === module) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write("Database maintenance failed: " + error.message + "\n");
    process.exitCode = 1;
  });
}

module.exports = { createBackup, restoreBackup, inspectDatabase, defaultDatabasePath };
