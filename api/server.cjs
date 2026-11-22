"use strict";

const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { ComplaintStore, StoreError } = require("./store.cjs");
const { AuthService, SESSION_MS } = require("./auth.cjs");
const { AuthService, SESSION_MS } = require("./auth.cjs");

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
  const auth = new AuthService(store.database);
  if (options.bootstrapAdmin) {
    const existing = store.database.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
    if (!existing) auth.createUser({ ...options.bootstrapAdmin, role: "admin" });
  }
  const auth = new AuthService(store.database);
  if (options.bootstrapAdmin && !store.database.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get()) auth.createUser({ ...options.bootstrapAdmin, role: "admin" });
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
      const cookies = Object.fromEntries(String(request.headers.cookie || "").split(";").map(part => { const i = part.indexOf("="); return i < 0 ? ["", ""] : [part.slice(0,i).trim(), decodeURIComponent(part.slice(i+1).trim())]; }).filter(([key]) => key));
      const sessionToken = cookies.civicdesk_session || "";
      const currentUser = auth.authenticate(sessionToken);
      const requireUser = () => { if (!currentUser) throw new StoreError(401, "Please sign in to continue."); return currentUser; };
      const requireRole = (...roles) => { if (options.authRequired === false) return { id: 0, role: "admin" }; const user = requireUser(); if (!roles.includes(user.role)) throw new StoreError(403, "Your account does not have permission to perform this action."); return user; };
      const sessionCookie = token => "civicdesk_session=" + token + "; HttpOnly; SameSite=Strict; Path=/; Max-Age=" + Math.floor(SESSION_MS / 1000);
      const cookies = Object.fromEntries(String(request.headers.cookie || "").split(";").map(part => {
        const index = part.indexOf("=");
        return index < 0 ? ["", ""] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
      }).filter(([key]) => key));
      const sessionToken = cookies.civicdesk_session || "";
      const currentUser = auth.authenticate(sessionToken);
      const requireUser = () => {
        if (!currentUser) throw new StoreError(401, "Please sign in to continue.");
        return currentUser;
      };
      const requireRole = (...roles) => {
        const user = requireUser();
        if (!roles.includes(user.role)) throw new StoreError(403, "Your account does not have permission to perform this action.");
        return user;
      };
      const sessionCookie = token => "civicdesk_session=" + token + "; HttpOnly; SameSite=Strict; Path=/; Max-Age=" + Math.floor(SESSION_MS / 1000);

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
      if (request.method === "POST" && pathname === "/api/auth/register") {
        const body = await readJson(request);
        if (Object.keys(body).some(key => !["email", "password"].includes(key))) throw new StoreError(400, "Only email and password are accepted.");
        auth.createUser({ ...body, role: "citizen" });
        const session = auth.login(body.email, body.password);
        return sendJson(response, 201, { user: session.user }, { "set-cookie": sessionCookie(session.token) });
      }
      if (request.method === "POST" && pathname === "/api/auth/login") {
        const body = await readJson(request);
        const session = auth.login(body.email, body.password);
        return sendJson(response, 200, { user: session.user }, { "set-cookie": sessionCookie(session.token) });
      }
      if (request.method === "POST" && pathname === "/api/auth/logout") {
        auth.logout(sessionToken);
        return sendJson(response, 200, { message: "Signed out." }, { "set-cookie": "civicdesk_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" });
      }
      if (request.method === "GET" && pathname === "/api/auth/me") {
        return sendJson(response, 200, { user: requireUser() });
      }
      if (request.method === "GET" && pathname === "/api/users") {
        requireRole("admin");
        return sendJson(response, 200, { users: auth.listUsers() });
      }
      if (request.method === "POST" && pathname === "/api/users") {
        requireRole("admin");
        const body = await readJson(request);
        if (Object.keys(body).some(key => !["email", "password", "role"].includes(key)) || !["officer", "admin"].includes(body.role)) throw new StoreError(400, "Admins may create officer or admin accounts using email, password and role.");
        return sendJson(response, 201, { user: auth.createUser(body) });
      }
      const userMatch = pathname.match(/^\/api\/users\/(\d+)\/active$/);
      if (request.method === "PATCH" && userMatch) {
        requireRole("admin");
        const body = await readJson(request);
        if (typeof body.active !== "boolean" || Object.keys(body).length !== 1) throw new StoreError(400, "Provide only a boolean active field.");
        auth.setUserActive(Number(userMatch[1]), body.active);
        return sendJson(response, 200, { message: "User access updated." });
      }
      if (request.method === "GET" && pathname === "/api/complaints") {
        const user = requireRole("citizen", "officer", "admin");
        const complaints = user.role === "citizen"
          ? store.database.prepare("SELECT c.* FROM complaints c JOIN complaint_owners o ON o.complaint_id=c.id WHERE o.user_id=? ORDER BY c.id").all(user.id).map(row => store.buildRecord(row))
          : store.list();
        return sendJson(response, 200, { complaints, count: complaints.length });
      }
      if (request.method === "POST" && pathname === "/api/complaints") {
        const user = requireRole("citizen", "admin");
        const item = await store.create(await readJson(request));
        if (user.role === "citizen") store.database.prepare("INSERT INTO complaint_owners (complaint_id,user_id) VALUES (?,?)").run(item.id, user.id);
        return sendJson(response, 201, item, { location: "/api/complaints/" + item.id });
      }

      const match = pathname.match(/^\/api\/complaints\/(\d+)(?:\/status)?$/);
      if (match) {
        const id = Number(match[1]);
        if (!Number.isSafeInteger(id)) throw new StoreError(400, "Complaint ID is invalid.");
        if (request.method === "GET" && !pathname.endsWith("/status")) {
          const user = requireRole("citizen", "officer", "admin");
          const item = store.find(id);
          if (!item) throw new StoreError(404, "Complaint not found.");
          if (user.role === "citizen") {
            const owner = store.database.prepare("SELECT user_id FROM complaint_owners WHERE complaint_id=?").get(id);
            if (!owner || owner.user_id !== user.id) throw new StoreError(404, "Complaint not found.");
          }
          return sendJson(response, 200, item);
        }
        if (request.method === "PATCH" && pathname.endsWith("/status")) {
          requireRole("officer", "admin");
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
  const bootstrapAdmin = process.env.CIVICDESK_ADMIN_EMAIL && process.env.CIVICDESK_ADMIN_PASSWORD
    ? { email: process.env.CIVICDESK_ADMIN_EMAIL, password: process.env.CIVICDESK_ADMIN_PASSWORD }
    : null;
  if (!bootstrapAdmin) throw new Error("Set CIVICDESK_ADMIN_EMAIL and CIVICDESK_ADMIN_PASSWORD before starting CivicDesk.");
  const server = await createApiServer({ bootstrapAdmin });
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
