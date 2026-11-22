"use strict";

const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { ComplaintStore, StoreError } = require("./store.cjs");

const MAX_BODY_BYTES = 16 * 1024;
const DEFAULT_RATE_LIMIT = Object.freeze({ windowMs: 60_000, max: 60 });
const SECURITY_HEADERS = Object.freeze({
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "cross-origin-resource-policy": "same-origin",
  "cross-origin-opener-policy": "same-origin",
  "x-permitted-cross-domain-policies": "none"
});

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...SECURITY_HEADERS,
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
        const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
        resolve(JSON.parse(text));
      } catch {
        reject(new StoreError(400, "Request body must contain valid JSON."));
      }
    });
    request.on("error", reject);
  });
}

async function createApiServer(options = {}) {
  const usesDefaultPath = !options.dataFile && !process.env.CIVICDESK_API_DATA;
  const dataFile = options.dataFile || process.env.CIVICDESK_API_DATA || path.join(__dirname, "data", "civicdesk.sqlite");
  const legacyDataFile = usesDefaultPath ? path.join(__dirname, "data", "complaints.json") : options.legacyDataFile;
  const store = await ComplaintStore.open(dataFile, { legacyDataFile });
  const rateLimit = { ...DEFAULT_RATE_LIMIT, ...(options.rateLimit || {}) };
  if (!Number.isSafeInteger(rateLimit.windowMs) || rateLimit.windowMs < 1 ||
      !Number.isSafeInteger(rateLimit.max) || rateLimit.max < 1) {
    store.close();
    throw new TypeError("rateLimit.windowMs and rateLimit.max must be positive safe integers.");
  }
  const mutationBuckets = new Map();

  const server = http.createServer({ maxHeaderSize: 8 * 1024 }, async (request, response) => {
    try {
      if (typeof request.url !== "string" || request.url.length > 2048) {
        throw new StoreError(414, "Request URL is too long.");
      }
      let requestHost;
      try {
        requestHost = new URL("http://" + request.headers.host);
      } catch {
        throw new StoreError(400, "Host header is invalid.");
      }
      const boundPort = server.address()?.port;
      if (!["127.0.0.1", "localhost"].includes(requestHost.hostname) ||
          Number(requestHost.port || 80) !== boundPort) {
        throw new StoreError(421, "This service only accepts requests addressed to its local host and port.");
      }
      const originHeader = request.headers.origin;
      if (originHeader) {
        let requestOrigin;
        try { requestOrigin = new URL(originHeader); } catch {
          throw new StoreError(403, "Cross-origin requests are not allowed.");
        }
        if (requestOrigin.origin !== "http://" + requestHost.host) {
          throw new StoreError(403, "Cross-origin requests are not allowed.");
        }
      }
      if (request.headers["sec-fetch-site"] === "cross-site") {
        throw new StoreError(403, "Cross-site requests are not allowed.");
      }
      const url = new URL(request.url, "http://127.0.0.1");
      const pathname = url.pathname;

      if (request.method === "POST" || request.method === "PATCH") {
        const now = Date.now();
        const key = request.socket.remoteAddress || "unknown";
        let bucket = mutationBuckets.get(key);
        if (!bucket || now - bucket.startedAt >= rateLimit.windowMs) {
          bucket = { startedAt: now, count: 0 };
          mutationBuckets.set(key, bucket);
        }
        if (bucket.count >= rateLimit.max) {
          const retryAfter = Math.max(1, Math.ceil((bucket.startedAt + rateLimit.windowMs - now) / 1000));
          return sendJson(response, 429, { error: "Too many write requests. Please try again later." }, { "retry-after": String(retryAfter) });
        }
        bucket.count += 1;
        if (mutationBuckets.size > 1000) {
          for (const [address, entry] of mutationBuckets) {
            if (now - entry.startedAt >= rateLimit.windowMs) mutationBuckets.delete(address);
          }
        }
      }

      if (request.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
        const html = await fs.readFile(path.join(__dirname, "..", "index.html"));
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-cache",
          ...SECURITY_HEADERS,
          "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
        });
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

  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.on("close", () => store.close());
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
