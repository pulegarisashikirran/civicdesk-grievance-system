"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const DEPARTMENTS = ["Water Supply", "Electricity", "Roads", "Sanitation", "Street Lights"];
const PRIORITIES = ["Urgent", "High", "Normal"];
const STATUSES = ["Filed", "Assigned", "In Progress", "Resolved"];

class StoreError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function validateNewComplaint(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return "Request body must be a JSON object.";
  }
  for (const field of ["name", "area"]) {
    if (typeof input[field] !== "string" || !input[field].trim()) {
      return field + " is required.";
    }
    if (input[field].trim().length > 31) {
      return field + " must be 31 characters or fewer.";
    }
    if (/[\u0000-\u001f\u007f]/.test(input[field])) {
      return field + " contains unsupported control characters.";
    }
  }
  if (!DEPARTMENTS.includes(input.department)) {
    return "Choose a valid department.";
  }
  if (!PRIORITIES.includes(input.priority)) {
    return "Choose a valid priority.";
  }
  return null;
}

class ComplaintStore {
  constructor(filePath, complaints, nextId) {
    this.filePath = filePath;
    this.complaints = complaints;
    this.nextId = nextId;
    this.writeQueue = Promise.resolve();
  }

  static async open(filePath) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    let saved;
    try {
      saved = JSON.parse(await fs.readFile(filePath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return new ComplaintStore(filePath, [], 1000);
      throw new Error("Could not read API data file: " + error.message);
    }
    if (!saved || saved.version !== 1 || !Array.isArray(saved.complaints) ||
        !Number.isSafeInteger(saved.nextId) || saved.nextId < 1000) {
      throw new Error("API data file has an unsupported or invalid format.");
    }
    const ids = new Set();
    for (const item of saved.complaints) {
      if (!item || !Number.isSafeInteger(item.id) || item.id < 1 ||
          ids.has(item.id) || typeof item.name !== "string" ||
          typeof item.area !== "string" || !DEPARTMENTS.includes(item.department) ||
          !PRIORITIES.includes(item.priority) || !STATUSES.includes(item.status) ||
          !Array.isArray(item.history)) {
        throw new Error("API data file contains an invalid complaint record.");
      }
      ids.add(item.id);
    }
    return new ComplaintStore(filePath, saved.complaints, saved.nextId);
  }

  async persist(complaints, nextId) {
    const tempPath = this.filePath + "." + process.pid + ".tmp";
    const content = JSON.stringify({ version: 1, nextId, complaints }, null, 2) + "\n";
    try {
      await fs.writeFile(tempPath, content, { encoding: "utf8" });
      await fs.rename(tempPath, this.filePath);
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => {});
      throw new StoreError(500, "Could not save API data: " + error.message);
    }
  }

  async mutate(change) {
    const operation = this.writeQueue.then(async () => {
      const complaints = copy(this.complaints);
      const nextId = this.nextId;
      const result = change(complaints, nextId);
      const next = result.nextId === undefined ? nextId : result.nextId;
      await this.persist(complaints, next);
      this.complaints = complaints;
      this.nextId = next;
      return copy(result.value);
    });
    this.writeQueue = operation.catch(() => {});
    return operation;
  }

  list() {
    return copy(this.complaints).sort((a, b) => a.id - b.id);
  }

  find(id) {
    const item = this.complaints.find(complaint => complaint.id === id);
    return item ? copy(item) : null;
  }

  create(input) {
    const problem = validateNewComplaint(input);
    if (problem) throw new StoreError(400, problem);
    return this.mutate((complaints, nextId) => {
      if (complaints.length >= 10000) {
        throw new StoreError(409, "The API supports up to 10000 complaints.");
      }
      const now = new Date().toISOString();
      const item = {
        id: nextId,
        name: input.name.trim(),
        area: input.area.trim(),
        department: input.department,
        priority: input.priority,
        status: "Filed",
        remarks: "",
        createdAt: now,
        updatedAt: now,
        history: [{ status: "Filed", remarks: "Complaint registered", at: now }]
      };
      complaints.push(item);
      return { value: item, nextId: nextId + 1 };
    });
  }

  updateStatus(id, input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new StoreError(400, "Request body must be a JSON object.");
    }
    if (input.remarks !== undefined &&
        (typeof input.remarks !== "string" || input.remarks.length > 63)) {
      throw new StoreError(400, "remarks must be a string of 63 characters or fewer.");
    }
    return this.mutate(complaints => {
      const item = complaints.find(complaint => complaint.id === id);
      if (!item) throw new StoreError(404, "Complaint not found.");
      const current = STATUSES.indexOf(item.status);
      const expected = STATUSES[current + 1];
      if (!expected || input.status !== expected) {
        throw new StoreError(409, "Invalid status transition. Next status must be " + (expected || "none") + ".");
      }
      const now = new Date().toISOString();
      item.status = expected;
      item.remarks = (input.remarks || "").trim();
      item.updatedAt = now;
      item.history.push({ status: expected, remarks: item.remarks, at: now });
      return { value: item };
    });
  }
}

module.exports = { ComplaintStore, StoreError, DEPARTMENTS, PRIORITIES, STATUSES };
