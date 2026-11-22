"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const DEPARTMENTS = ["Water Supply", "Electricity", "Roads", "Sanitation", "Street Lights"];
const PRIORITIES = ["Urgent", "High", "Normal"];
const STATUSES = ["Filed", "Assigned", "In Progress", "Resolved"];

class StoreError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function validateNewComplaint(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "Request body must be a JSON object.";
  for (const field of ["name", "area"]) {
    if (typeof input[field] !== "string" || !input[field].trim()) return field + " is required.";
    if (input[field].trim().length > 31) return field + " must be 31 characters or fewer.";
    if (/[\u0000-\u001f\u007f]/.test(input[field])) return field + " contains unsupported control characters.";
  }
  if (!DEPARTMENTS.includes(input.department)) return "Choose a valid department.";
  if (!PRIORITIES.includes(input.priority)) return "Choose a valid priority.";
  return null;
}

function validateLegacyRecord(item) {
  if (!item || !Number.isSafeInteger(item.id) || item.id < 1 ||
      typeof item.name !== "string" || !item.name.trim() || item.name.length > 31 ||
      typeof item.area !== "string" || !item.area.trim() || item.area.length > 31 ||
      !DEPARTMENTS.includes(item.department) || !PRIORITIES.includes(item.priority) ||
      !STATUSES.includes(item.status) || typeof item.remarks !== "string" ||
      typeof item.createdAt !== "string" || typeof item.updatedAt !== "string" ||
      !Array.isArray(item.history) || item.history.length < 1) {
    throw new Error("Legacy JSON contains an invalid complaint record.");
  }
  let previous = -1;
  for (const entry of item.history) {
    const current = STATUSES.indexOf(entry.status);
    if (current !== previous + 1 || typeof entry.remarks !== "string" || typeof entry.at !== "string") {
      throw new Error("Legacy JSON contains an invalid status history.");
    }
    previous = current;
  }
  if (item.history[item.history.length - 1].status !== item.status) {
    throw new Error("Legacy JSON complaint status does not match its history.");
  }
}

class ComplaintStore {
  constructor(filePath, database) {
    this.filePath = filePath;
    this.database = database;
    this.closed = false;
    this.insertComplaint = database.prepare(
      "INSERT INTO complaints (id, name, area, department, priority, status, remarks, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    this.insertHistory = database.prepare(
      "INSERT INTO complaint_history (complaint_id, sequence, status, remarks, at) VALUES (?, ?, ?, ?, ?)"
    );
    this.selectComplaint = database.prepare("SELECT * FROM complaints WHERE id = ?");
    this.selectHistory = database.prepare(
      "SELECT status, remarks, at FROM complaint_history WHERE complaint_id = ? ORDER BY sequence"
    );
  }

  static async open(filePath, options = {}) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    let databaseExisted = true;
    try {
      await fs.access(filePath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      databaseExisted = false;
    }

    const database = new DatabaseSync(filePath);
    try {
      database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
      database.exec(`
        CREATE TABLE IF NOT EXISTS app_metadata (
          key TEXT PRIMARY KEY,
          value INTEGER NOT NULL
        );
        INSERT OR IGNORE INTO app_metadata (key, value) VALUES ('next_id', 1000);
        CREATE TABLE IF NOT EXISTS complaints (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 31),
          area TEXT NOT NULL CHECK(length(trim(area)) BETWEEN 1 AND 31),
          department TEXT NOT NULL CHECK(department IN ('Water Supply', 'Electricity', 'Roads', 'Sanitation', 'Street Lights')),
          priority TEXT NOT NULL CHECK(priority IN ('Urgent', 'High', 'Normal')),
          status TEXT NOT NULL CHECK(status IN ('Filed', 'Assigned', 'In Progress', 'Resolved')),
          remarks TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS complaint_history (
          complaint_id INTEGER NOT NULL,
          sequence INTEGER NOT NULL CHECK(sequence >= 0),
          status TEXT NOT NULL CHECK(status IN ('Filed', 'Assigned', 'In Progress', 'Resolved')),
          remarks TEXT NOT NULL,
          at TEXT NOT NULL,
          PRIMARY KEY (complaint_id, sequence),
          FOREIGN KEY (complaint_id) REFERENCES complaints(id) ON DELETE CASCADE
        );
      `);

      if (!databaseExisted && options.legacyDataFile) {
        await ComplaintStore.migrateLegacyJson(database, options.legacyDataFile);
      }
      return new ComplaintStore(filePath, database);
    } catch (error) {
      database.close();
      throw error;
    }
  }

  static async migrateLegacyJson(database, legacyDataFile) {
    let raw;
    try {
      raw = await fs.readFile(legacyDataFile, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    let saved;
    try {
      saved = JSON.parse(raw);
    } catch {
      throw new Error("The previous API JSON data file is not valid JSON; it was left unchanged.");
    }
    if (!saved || saved.version !== 1 || !Array.isArray(saved.complaints) ||
        !Number.isSafeInteger(saved.nextId) || saved.nextId < 1000) {
      throw new Error("The previous API JSON data file has an unsupported format; it was left unchanged.");
    }

    const ids = new Set();
    for (const item of saved.complaints) {
      validateLegacyRecord(item);
      if (ids.has(item.id)) throw new Error("The previous API JSON data file contains duplicate complaint IDs.");
      ids.add(item.id);
    }

    database.exec("BEGIN IMMEDIATE");
    try {
      const insertComplaint = database.prepare(
        "INSERT INTO complaints (id, name, area, department, priority, status, remarks, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      );
      const insertHistory = database.prepare(
        "INSERT INTO complaint_history (complaint_id, sequence, status, remarks, at) VALUES (?, ?, ?, ?, ?)"
      );
      for (const item of saved.complaints) {
        insertComplaint.run(item.id, item.name, item.area, item.department, item.priority,
          item.status, item.remarks, item.createdAt, item.updatedAt);
        item.history.forEach((entry, index) =>
          insertHistory.run(item.id, index, entry.status, entry.remarks, entry.at));
      }
      const maxId = saved.complaints.reduce((max, item) => Math.max(max, item.id + 1), 1000);
      database.prepare("UPDATE app_metadata SET value = ? WHERE key = 'next_id'")
        .run(Math.max(saved.nextId, maxId));
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw new Error("Could not migrate the previous API JSON data: " + error.message);
    }
  }

  buildRecord(row, historyRows) {
    if (!row) return null;
    const history = historyRows || this.selectHistory.all(row.id);
    return {
      id: row.id, name: row.name, area: row.area, department: row.department,
      priority: row.priority, status: row.status, remarks: row.remarks,
      createdAt: row.created_at, updatedAt: row.updated_at,
      history: history.map(entry => ({ status: entry.status, remarks: entry.remarks, at: entry.at }))
    };
  }

  list() {
    const rows = this.database.prepare("SELECT * FROM complaints ORDER BY id").all();
    const histories = this.database.prepare(
      "SELECT complaint_id, status, remarks, at FROM complaint_history ORDER BY complaint_id, sequence"
    ).all();
    const byId = new Map();
    for (const entry of histories) {
      if (!byId.has(entry.complaint_id)) byId.set(entry.complaint_id, []);
      byId.get(entry.complaint_id).push(entry);
    }
    return rows.map(row => this.buildRecord(row, byId.get(row.id) || []));
  }

  find(id) {
    return this.buildRecord(this.selectComplaint.get(id));
  }

  create(input) {
    const problem = validateNewComplaint(input);
    if (problem) throw new StoreError(400, problem);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const nextId = this.database.prepare("SELECT value FROM app_metadata WHERE key = 'next_id'").get().value;
      const now = new Date().toISOString();
      this.insertComplaint.run(nextId, input.name.trim(), input.area.trim(),
        input.department, input.priority, "Filed", "", now, now);
      this.insertHistory.run(nextId, 0, "Filed", "Complaint registered", now);
      this.database.prepare("UPDATE app_metadata SET value = ? WHERE key = 'next_id'").run(nextId + 1);
      this.database.exec("COMMIT");
      return this.find(nextId);
    } catch (error) {
      this.database.exec("ROLLBACK");
      if (error instanceof StoreError) throw error;
      throw new StoreError(500, "Could not create complaint in SQLite.");
    }
  }

  updateStatus(id, input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new StoreError(400, "Request body must be a JSON object.");
    }
    if (input.remarks !== undefined &&
        (typeof input.remarks !== "string" || input.remarks.length > 63)) {
      throw new StoreError(400, "remarks must be a string of 63 characters or fewer.");
    }
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const row = this.selectComplaint.get(id);
      if (!row) throw new StoreError(404, "Complaint not found.");
      const current = STATUSES.indexOf(row.status);
      const expected = STATUSES[current + 1];
      if (!expected || input.status !== expected) {
        throw new StoreError(409, "Invalid status transition. Next status must be " + (expected || "none") + ".");
      }
      const now = new Date().toISOString();
      const remarks = (input.remarks || "").trim();
      this.database.prepare("UPDATE complaints SET status = ?, remarks = ?, updated_at = ? WHERE id = ?")
        .run(expected, remarks, now, id);
      const sequence = this.database.prepare(
        "SELECT COALESCE(MAX(sequence), -1) + 1 AS next_sequence FROM complaint_history WHERE complaint_id = ?"
      ).get(id).next_sequence;
      this.insertHistory.run(id, sequence, expected, remarks, now);
      this.database.exec("COMMIT");
      return this.find(id);
    } catch (error) {
      this.database.exec("ROLLBACK");
      if (error instanceof StoreError) throw error;
      throw new StoreError(500, "Could not update complaint in SQLite.");
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.database.close();
  }
}

module.exports = { ComplaintStore, StoreError, DEPARTMENTS, PRIORITIES, STATUSES };
