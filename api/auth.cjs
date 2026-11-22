"use strict";

const crypto = require("node:crypto");
const { StoreError } = require("./store.cjs");

const SESSION_MS = 8 * 60 * 60 * 1000;
const ROLES = ["citizen", "officer", "admin"];

class AuthService {
  constructor(database) {
    this.database = database;
    database.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('citizen','officer','admin')),
        created_at TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
      );
      CREATE TABLE IF NOT EXISTS user_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS complaint_owners (
        complaint_id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        FOREIGN KEY(complaint_id) REFERENCES complaints(id) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON user_sessions(expires_at);
      CREATE INDEX IF NOT EXISTS idx_complaint_owners_user ON complaint_owners(user_id);
    `);
  }

  static hashPassword(password, salt) {
    return crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex");
  }

  validateCredentials(email, password) {
    if (typeof email !== "string" || email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      throw new StoreError(400, "A valid email address is required.");
    }
    if (typeof password !== "string" || password.length < 12 || password.length > 128 ||
        !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
      throw new StoreError(400, "Password must be 12–128 characters and include lowercase, uppercase and a number.");
    }
  }

  createUser({ email, password, role = "citizen" }) {
    this.validateCredentials(email, password);
    if (!ROLES.includes(role)) throw new StoreError(400, "Invalid user role.");
    const normalized = email.trim().toLowerCase();
    const salt = crypto.randomBytes(16).toString("hex");
    try {
      const result = this.database.prepare(
        "INSERT INTO users (email,password_hash,password_salt,role,created_at) VALUES (?,?,?,?,?)"
      ).run(normalized, AuthService.hashPassword(password, salt), salt, role, new Date().toISOString());
      return { id: Number(result.lastInsertRowid), email: normalized, role };
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) throw new StoreError(409, "An account with this email already exists.");
      throw error;
    }
  }

  login(email, password) {
    if (typeof email !== "string" || typeof password !== "string") {
      throw new StoreError(400, "Email and password are required.");
    }
    const user = this.database.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE").get(email.trim());
    const salt = user?.password_salt || "civicdesk-fixed-timing-salt";
    const actual = AuthService.hashPassword(password.slice(0, 128), salt);
    const expected = user?.password_hash || "0".repeat(128);
    const valid = crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
    if (!user || !valid || !user.active) throw new StoreError(401, "Email or password is incorrect.");
    const token = crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const expiresAt = Date.now() + SESSION_MS;
    this.database.prepare("INSERT INTO user_sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)")
      .run(tokenHash, user.id, expiresAt, new Date().toISOString());
    this.database.prepare("DELETE FROM user_sessions WHERE expires_at <= ?").run(Date.now());
    return { token, expiresAt, user: { id: user.id, email: user.email, role: user.role } };
  }

  authenticate(token) {
    if (!token) return null;
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    const user = this.database.prepare(`
      SELECT u.id,u.email,u.role FROM user_sessions s
      JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.expires_at>? AND u.active=1
    `).get(hash, Date.now());
    return user || null;
  }

  logout(token) {
    if (!token) return;
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    this.database.prepare("DELETE FROM user_sessions WHERE token_hash=?").run(hash);
  }

  listUsers() {
    return this.database.prepare("SELECT id,email,role,created_at AS createdAt,active FROM users ORDER BY id").all();
  }

  setUserActive(id, active) {
    const result = this.database.prepare("UPDATE users SET active=? WHERE id=?").run(active ? 1 : 0, id);
    if (!result.changes) throw new StoreError(404, "User not found.");
    if (!active) this.database.prepare("DELETE FROM user_sessions WHERE user_id=?").run(id);
  }
}

module.exports = { AuthService, SESSION_MS, ROLES };
