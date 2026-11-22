"use strict";

const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { ComplaintStore, StoreError } = require("./store.cjs");

const MAX_BODY_BYTES = 16 * 1024;

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...extraHeaders
  });
  response.end(JSON.stringify(payload));
}

function readJson(request) {
  if (!String(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
    throw new StoreError(415, "Content-Type must be application/json.");
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    request.on("data", chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
      } else if (!tooLarge) {
        chunks.push(chunk);
      }
    });
    request.on("end", () => {
      if (tooLarge) return reject(new StoreError(413, "Request body exceeds the 16 KB limit."));
      if (size === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new StoreError(400, "Request body must contain valid JSON."));
      }
    });
    request.on("error", reject);
  });
}

async function createApiServer(options = {}) {
  const dataFile = options.dataFile || process.env.CIVICDESK_API_DATA || path.join(__dirname, "data", "complaints.json");
  const store = await ComplaintStore.open(dataFile);

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      const pathname = url.pathname;

      if (request.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
        const html = await fs.readFile(path.join(__dirname, "..", "index.html"));
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache", "x-content-type-options": "nosniff" });
        return response.end(html);
      }
      if (request.method === "GET" && pathname === "/api/health") {
        return sendJson(response, 200, { status: "ok", service: "CivicDesk API" });
      }
      if (request.method === "GET" && pathname === "/api/complaints") {
        const complaints = store.list();
        return sendJson(response, 200, { complaints, count: complaints.length });
      }
      if (request.method === "POST" && pathname === "/api/complaints") {
        const item = await store.create(await readJson(request));
        return sendJson(response, 201, item, { location: "/api/complaints/" + item.id });
      }

      const match = pathname.match(/^\/api\/complaints\/(\d+)(?:\/status)?$/);
      if (match) {
        const id = Number(match[1]);
        if (!Number.isSafeInteger(id)) throw new StoreError(400, "Complaint ID is invalid.");
        if (request.method === "GET" && !pathname.endsWith("/status")) {
          const item = store.find(id);
          if (!item) throw new StoreError(404, "Complaint not found.");
          return sendJson(response, 200, item);
        }
        if (request.method === "PATCH" && pathname.endsWith("/status")) {
          const item = await store.updateStatus(id, await readJson(request));
          return sendJson(response, 200, item);
        }
      }

      return sendJson(response, 404, { error: "API route not found." });
    } catch (error) {
      const statusCode = error instanceof StoreError ? error.statusCode : 500;
      return sendJson(response, statusCode, {
        error: statusCode === 500 ? "Internal server error." : error.message
      });
    }
  });

  return server;
}

async function start() {
  const port = Number(process.env.PORT || 4174);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  const server = await createApiServer();
  server.listen(port, "127.0.0.1", () => {
    process.stdout.write("CivicDesk API listening at http://127.0.0.1:" + port + "\n");
  });
}

if (require.main === module) {
  start().catch(error => {
    process.stderr.write(error.message + "\n");
    process.exitCode = 1;
  });
}

module.exports = { createApiServer, MAX_BODY_BYTES };
