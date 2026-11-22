"use strict";

const http = require("node:http");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { createApiServer } = require("../api/server.cjs");
const { ComplaintStore } = require("../api/store.cjs");
const { createBackup, restoreBackup, inspectDatabase } = require("../api/maintenance.cjs");

async function startTestServer(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "civicdesk-api-"));
  const dataFile = path.join(directory, "civicdesk.sqlite");
  const server = await createApiServer({ dataFile, authRequired: false });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  t.after(async () => {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { base: "http://127.0.0.1:" + address.port, dataFile, server };
}

async function createComplaint(base, overrides = {}) {
  return fetch(base + "/api/complaints", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Asha",
      area: "Madhapur",
      department: "Roads",
      priority: "Urgent",
      ...overrides
    })
  });
}

test("API health endpoint reports that the service is ready", async t => {
  const { base } = await startTestServer(t);
  const response = await fetch(base + "/api/health");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok", service: "CivicDesk API" });
});

test("API creates complaints and returns their generated IDs", async t => {
  const { base } = await startTestServer(t);
  const response = await createComplaint(base);
  const item = await response.json();
  assert.equal(response.status, 201);
  assert.equal(item.id, 1000);
  assert.equal(item.name, "Asha");
  assert.equal(item.priority, "Urgent");
  assert.equal(item.status, "Filed");
  assert.equal(item.history.length, 1);
  assert.equal(response.headers.get("location"), "/api/complaints/1000");
});

test("API lists complaints and retrieves one complaint by ID", async t => {
  const { base } = await startTestServer(t);
  await createComplaint(base);
  await createComplaint(base, { name: "Ravi", priority: "Normal" });

  const listResponse = await fetch(base + "/api/complaints");
  const list = await listResponse.json();
  assert.equal(listResponse.status, 200);
  assert.equal(list.count, 2);
  assert.deepEqual(list.complaints.map(item => item.id), [1000, 1001]);

  const detail = await fetch(base + "/api/complaints/1001");
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).name, "Ravi");
});

test("API rejects invalid complaint fields without saving records", async t => {
  const { base } = await startTestServer(t);
  for (const fields of [
    { name: "", area: "Madhapur" },
    { name: "A".repeat(32) },
    { department: "Unknown" },
    { priority: "Critical" }
  ]) {
    const response = await createComplaint(base, fields);
    assert.equal(response.status, 400);
    assert.ok((await response.json()).error);
  }
  const list = await (await fetch(base + "/api/complaints")).json();
  assert.equal(list.count, 0);
});

test("API enforces the complaint status lifecycle", async t => {
  const { base } = await startTestServer(t);
  await createComplaint(base);

  const skip = await fetch(base + "/api/complaints/1000/status", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "Resolved" })
  });
  assert.equal(skip.status, 409);

  for (const status of ["Assigned", "In Progress", "Resolved"]) {
    const response = await fetch(base + "/api/complaints/1000/status", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status, remarks: "Moved to " + status })
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, status);
  }
  const finalItem = await (await fetch(base + "/api/complaints/1000")).json();
  assert.equal(finalItem.history.length, 4);
});

test("API data survives a server restart", async t => {
  const { base, dataFile, server } = await startTestServer(t);
  await createComplaint(base, { name: "Persisted citizen" });

  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  const restarted = await createApiServer({ dataFile });
  await new Promise((resolve, reject) => {
    restarted.once("error", reject);
    restarted.listen(0, "127.0.0.1", resolve);
  });
  try {
    const response = await fetch("http://127.0.0.1:" + restarted.address().port + "/api/complaints/1000");
    assert.equal(response.status, 200);
    assert.equal((await response.json()).name, "Persisted citizen");
  } finally {
    await new Promise((resolve, reject) => restarted.close(error => error ? reject(error) : resolve()));
  }
});

test("API rejects malformed JSON and oversized request bodies", async t => {
  const { base } = await startTestServer(t);
  const malformed = await fetch(base + "/api/complaints", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{invalid"
  });
  assert.equal(malformed.status, 400);

  const oversized = await fetch(base + "/api/complaints", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "A", area: "B", department: "Roads", priority: "Urgent", extra: "x".repeat(17000) })
  });
  assert.equal(oversized.status, 413);
});

test("API returns clear errors for missing records and unknown routes", async t => {
  const { base } = await startTestServer(t);
  const missing = await fetch(base + "/api/complaints/9999");
  assert.equal(missing.status, 404);
  assert.match((await missing.json()).error, /not found/i);

  const unknown = await fetch(base + "/api/not-a-route");
  assert.equal(unknown.status, 404);
});


test("API server serves the browser dashboard from the same origin", async t => {
  const { base } = await startTestServer(t);
  const response = await fetch(base + "/");
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.match(html, /Connect API/);
  assert.match(html, /refreshFromApi/);
});


test("API stores complaints and status history in SQLite tables", async t => {
  const { base, dataFile } = await startTestServer(t);
  await createComplaint(base);
  await fetch(base + "/api/complaints/1000/status", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "Assigned", remarks: "Team notified" })
  });

  const header = await fs.readFile(dataFile);
  assert.equal(header.subarray(0, 16).toString("utf8"), "SQLite format 3\u0000");
  const database = new DatabaseSync(dataFile);
  try {
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM complaints").get().count, 1);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM complaint_history").get().count, 2);
    assert.equal(database.prepare("SELECT status FROM complaints WHERE id = 1000").get().status, "Assigned");
  } finally {
    database.close();
  }
});

test("API migrates valid legacy JSON records into SQLite without losing history", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "civicdesk-migration-"));
  const dataFile = path.join(directory, "civicdesk.sqlite");
  const legacyDataFile = path.join(directory, "complaints.json");
  const now = "2026-11-22T10:00:00.000Z";
  await fs.writeFile(legacyDataFile, JSON.stringify({
    version: 1,
    nextId: 1001,
    complaints: [{
      id: 1000, name: "Legacy Citizen", area: "Madhapur", department: "Roads",
      priority: "High", status: "Assigned", remarks: "Assigned to team",
      createdAt: now, updatedAt: now,
      history: [
        { status: "Filed", remarks: "Complaint registered", at: now },
        { status: "Assigned", remarks: "Assigned to team", at: now }
      ]
    }]
  }));
  const server = await createApiServer({ dataFile, legacyDataFile });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });

  const base = "http://127.0.0.1:" + server.address().port;
  const migrated = await (await fetch(base + "/api/complaints/1000")).json();
  assert.equal(migrated.name, "Legacy Citizen");
  assert.equal(migrated.status, "Assigned");
  assert.equal(migrated.history.length, 2);
  const created = await createComplaint(base, { name: "New Citizen" });
  assert.equal((await created.json()).id, 1001);
});

test("API assigns unique increasing IDs to concurrent complaint submissions", async t => {
  const { base } = await startTestServer(t);
  const responses = await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      createComplaint(base, { name: "Citizen " + index }))
  );
  assert.ok(responses.every(response => response.status === 201));
  const ids = (await Promise.all(responses.map(response => response.json())))
    .map(item => item.id).sort((a, b) => a - b);
  assert.deepEqual(ids, Array.from({ length: 20 }, (_, index) => 1000 + index));
});


test("SQLite schema upgrades from version 1 to version 3 without losing records", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "civicdesk-schema-migration-"));
  const dataFile = path.join(directory, "civicdesk.sqlite");
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const initial = await ComplaintStore.open(dataFile);
  initial.create({ name: "Migration Citizen", area: "Madhapur", department: "Roads", priority: "High" });
  initial.close();

  const oldDatabase = new DatabaseSync(dataFile);
  oldDatabase.exec("DROP INDEX IF EXISTS idx_complaints_status_priority; DROP INDEX IF EXISTS idx_complaints_area; PRAGMA user_version = 1;");
  oldDatabase.close();

  const upgraded = await ComplaintStore.open(dataFile);
  try {
    const check = new DatabaseSync(dataFile);
    try {
      assert.equal(check.prepare("PRAGMA user_version").get().user_version, 3);
      const indexes = check.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name);
      assert.ok(indexes.includes("idx_complaints_status_priority"));
      assert.ok(indexes.includes("idx_complaints_area"));
    } finally {
      check.close();
    }
    assert.equal(upgraded.list().length, 1);
    assert.equal(upgraded.find(1000).name, "Migration Citizen");
  } finally {
    upgraded.close();
  }
});

test("SQLite backup restores complaint data and preserves a pre-restore safety copy", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "civicdesk-backup-"));
  const dataFile = path.join(directory, "civicdesk.sqlite");
  const backupFile = path.join(directory, "backup.sqlite");
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const original = await ComplaintStore.open(dataFile);
  original.create({ name: "Backup Citizen", area: "Madhapur", department: "Roads", priority: "Urgent" });
  original.close();
  await createBackup(dataFile, backupFile);
  assert.equal(inspectDatabase(backupFile).integrity, "ok");

  const changed = await ComplaintStore.open(dataFile);
  changed.create({ name: "Later Citizen", area: "Gachibowli", department: "Water Supply", priority: "Normal" });
  changed.close();

  const restored = await restoreBackup(backupFile, dataFile);
  assert.ok(restored.safetyBackup);
  assert.equal(inspectDatabase(dataFile).integrity, "ok");

  const recovered = await ComplaintStore.open(dataFile);
  try {
    assert.equal(recovered.list().length, 1);
    assert.equal(recovered.find(1000).name, "Backup Citizen");
  } finally {
    recovered.close();
  }

  const safety = new DatabaseSync(restored.safetyBackup);
  try {
    assert.equal(safety.prepare("SELECT COUNT(*) AS count FROM complaints").get().count, 2);
  } finally {
    safety.close();
  }
});

test("invalid SQLite backup is rejected without changing the live database", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "civicdesk-invalid-backup-"));
  const dataFile = path.join(directory, "civicdesk.sqlite");
  const backupFile = path.join(directory, "not-a-database.sqlite");
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const store = await ComplaintStore.open(dataFile);
  store.create({ name: "Keep This Citizen", area: "Madhapur", department: "Roads", priority: "High" });
  store.close();
  await fs.writeFile(backupFile, "not a SQLite database");

  await assert.rejects(() => restoreBackup(backupFile, dataFile));
  const unchanged = await ComplaintStore.open(dataFile);
  try {
    assert.equal(unchanged.list().length, 1);
    assert.equal(unchanged.find(1000).name, "Keep This Citizen");
  } finally {
    unchanged.close();
  }
});


test("API rejects cross-origin and DNS-rebinding-style host requests", async t => {
  const { base } = await startTestServer(t);
  const crossOrigin = await fetch(base + "/api/complaints", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://attacker.example" },
    body: JSON.stringify({ name: "Blocked", area: "Madhapur", department: "Roads", priority: "Urgent" })
  });
  assert.equal(crossOrigin.status, 403);

  const parsed = new URL(base);
  const hostileHost = await new Promise((resolve, reject) => {
    const request = http.request({
      hostname: parsed.hostname,
      port: Number(parsed.port),
      path: "/api/health",
      headers: { host: "attacker.example" }
    }, response => {
      response.resume();
      resolve(response.statusCode);
    });
    request.on("error", reject);
    request.end();
  });
  assert.equal(hostileHost, 421);

  const list = await (await fetch(base + "/api/complaints")).json();
  assert.equal(list.count, 0);
});

test("API rejects unknown fields and control characters", async t => {
  const { base } = await startTestServer(t);
  const unknown = await createComplaint(base, { isAdmin: true });
  assert.equal(unknown.status, 400);

  const control = await createComplaint(base, { name: "Asha\nInjected" });
  assert.equal(control.status, 400);

  await createComplaint(base);
  const badRemarks = await fetch(base + "/api/complaints/1000/status", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "Assigned", remarks: "line\nbreak" })
  });
  assert.equal(badRemarks.status, 400);
});

test("API rate-limits writes without blocking read-only requests", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "civicdesk-rate-limit-"));
  const dataFile = path.join(directory, "civicdesk.sqlite");
  const server = await createApiServer({ dataFile, rateLimit: { windowMs: 60_000, max: 2 } });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(async () => {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const base = "http://127.0.0.1:" + server.address().port;
  assert.equal((await createComplaint(base)).status, 201);
  assert.equal((await createComplaint(base, { name: "Second" })).status, 201);
  const limited = await createComplaint(base, { name: "Third" });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) >= 1);
  assert.equal((await fetch(base + "/api/complaints")).status, 200);
});

test("API requires JSON content type and rejects invalid UTF-8 bodies", async t => {
  const { base } = await startTestServer(t);
  const wrongType = await fetch(base + "/api/complaints", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "{}"
  });
  assert.equal(wrongType.status, 415);

  const invalidUtf8 = await fetch(base + "/api/complaints", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: Buffer.from([0x7b, 0x22, 0x6e, 0x61, 0x6d, 0x65, 0x22, 0x3a, 0xff, 0x7d])
  });
  assert.equal(invalidUtf8.status, 400);
});


async function startAuthenticatedServer(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "civicdesk-auth-"));
  const dataFile = path.join(directory, "civicdesk.sqlite");
  const server = await createApiServer({ dataFile, bootstrapAdmin: { email: "admin@example.test", password: "AdminPassword123" } });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(async () => {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return "http://127.0.0.1:" + server.address().port;
}
async function authRequest(base, route, body, cookieValue) {
  return fetch(base + route, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookieValue ? { cookie: cookieValue } : {}) },
    body: JSON.stringify(body)
  });
}
function sessionCookie(response) { return response.headers.get("set-cookie").split(";")[0]; }

test("authentication registers citizen accounts with hashed passwords and secure sessions", async t => {
  const base = await startAuthenticatedServer(t);
  assert.equal((await fetch(base + "/api/complaints")).status, 401);
  const weak = await authRequest(base, "/api/auth/register", { email: "citizen@example.test", password: "weak" });
  assert.equal(weak.status, 400);
  const response = await authRequest(base, "/api/auth/register", { email: "Citizen@example.test", password: "CitizenPassword123" });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).user.role, "citizen");
  assert.match(response.headers.get("set-cookie"), /HttpOnly/);
  assert.match(response.headers.get("set-cookie"), /SameSite=Strict/);
  const cookieValue = sessionCookie(response);
  assert.equal((await fetch(base + "/api/auth/me", { headers: { cookie: cookieValue } })).status, 200);
  assert.equal((await authRequest(base, "/api/auth/register", { email: "citizen@example.test", password: "CitizenPassword123" })).status, 409);
  assert.equal((await authRequest(base, "/api/auth/login", { email: "citizen@example.test", password: "wrongPassword123" })).status, 401);
});

test("citizens can only access their own complaints and cannot advance statuses", async t => {
  const base = await startAuthenticatedServer(t);
  const first = await authRequest(base, "/api/auth/register", { email: "first@example.test", password: "FirstPassword123" });
  const firstCookie = sessionCookie(first);
  const created = await authRequest(base, "/api/complaints", { name: "First Citizen", area: "Madhapur", department: "Roads", priority: "High" }, firstCookie);
  assert.equal(created.status, 201);
  const second = await authRequest(base, "/api/auth/register", { email: "second@example.test", password: "SecondPassword123" });
  const hidden = await fetch(base + "/api/complaints/1000", { headers: { cookie: sessionCookie(second) } });
  assert.equal(hidden.status, 404);
  const forbidden = await authRequest(base, "/api/complaints/1000/status", { status: "Assigned" }, firstCookie);
  assert.equal(forbidden.status, 403);
});

test("admins create officers and officers can update complaint statuses", async t => {
  const base = await startAuthenticatedServer(t);
  const admin = await authRequest(base, "/api/auth/login", { email: "admin@example.test", password: "AdminPassword123" });
  const adminCookie = sessionCookie(admin);
  const citizen = await authRequest(base, "/api/auth/register", { email: "owner@example.test", password: "OwnerPassword123" });
  const citizenCookie = sessionCookie(citizen);
  const complaint = await authRequest(base, "/api/complaints", { name: "Owner", area: "Madhapur", department: "Roads", priority: "High" }, citizenCookie);
  assert.equal(complaint.status, 201);
  const staff = await authRequest(base, "/api/users", { email: "officer@example.test", password: "OfficerPassword123", role: "officer" }, adminCookie);
  assert.equal(staff.status, 201);
  const officer = await authRequest(base, "/api/auth/login", { email: "officer@example.test", password: "OfficerPassword123" });
  const changed = await authRequest(base, "/api/complaints/1000/status", { status: "Assigned" }, sessionCookie(officer));
  assert.equal(changed.status, 200);
  assert.equal((await fetch(base + "/api/users", { headers: { cookie: citizenCookie } })).status, 403);
});

test("logout revokes sessions and admins can deactivate accounts", async t => {
  const base = await startAuthenticatedServer(t);
  const admin = await authRequest(base, "/api/auth/login", { email: "admin@example.test", password: "AdminPassword123" });
  const adminCookie = sessionCookie(admin);
  const user = await authRequest(base, "/api/auth/register", { email: "disable@example.test", password: "DisablePassword123" });
  const userCookie = sessionCookie(user);
  const list = await fetch(base + "/api/users", { headers: { cookie: adminCookie } });
  assert.equal(list.status, 200);
  const users = (await list.json()).users;
  const id = users.find(item => item.email === "disable@example.test").id;
  const disabled = await authRequest(base, "/api/users/" + id + "/active", { active: false }, adminCookie);
  assert.equal(disabled.status, 200);
  assert.equal((await fetch(base + "/api/auth/me", { headers: { cookie: userCookie } })).status, 401);
  const logout = await authRequest(base, "/api/auth/logout", {}, adminCookie);
  assert.equal(logout.status, 200);
  assert.equal((await fetch(base + "/api/auth/me", { headers: { cookie: adminCookie } })).status, 401);
});
