"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createApiServer } = require("../api/server.cjs");

async function startTestServer(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "civicdesk-api-"));
  const dataFile = path.join(directory, "complaints.json");
  const server = await createApiServer({ dataFile });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { base: "http://127.0.0.1:" + address.port, dataFile };
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
  const { base, dataFile } = await startTestServer(t);
  await createComplaint(base, { name: "Persisted citizen" });

  const restarted = await createApiServer({ dataFile });
  await new Promise((resolve, reject) => {
    restarted.once("error", reject);
    restarted.listen(0, "127.0.0.1", resolve);
  });
  t.after(async () => new Promise(resolve => restarted.close(resolve)));

  const response = await fetch("http://127.0.0.1:" + restarted.address().port + "/api/complaints/1000");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).name, "Persisted citizen");
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
