"use strict";

const path = require("node:path");
const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");
const { ComplaintStore } = require("./store.cjs");
const { AuthService } = require("./auth.cjs");

function hiddenPrompt(label) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    return Promise.reject(new Error("Run this command in an interactive PowerShell terminal."));
  }

  return new Promise((resolve, reject) => {
    let value = "";
    stdout.write(label);
    stdin.setRawMode(true);
    stdin.resume();

    const cleanup = () => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(false);
      stdout.write("\n");
    };

    const onData = chunk => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003") {
          cleanup();
          reject(new Error("Password reset cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        if (character >= " " && character <= "~" && value.length < 128) {
          value += character;
        }
      }
    };

    stdin.on("data", onData);
  });
}

async function main() {
  const databaseFile = process.env.CIVICDESK_API_DATA ||
    path.join(__dirname, "data", "civicdesk.sqlite");
  const store = await ComplaintStore.open(databaseFile);
  const auth = new AuthService(store.database);
  const rl = readline.createInterface({ input: stdin, output: stdout });

  try {
    const email = (await rl.question("Admin email to reset: ")).trim();
    const admin = store.database.prepare(
      "SELECT id,email,role,active FROM users WHERE email=? COLLATE NOCASE"
    ).get(email);

    if (!admin || admin.role !== "admin" || admin.active !== 1) {
      throw new Error("No active administrator account matches that email. No changes were made.");
    }

    rl.close();
    const password = await hiddenPrompt("New admin password (input hidden): ");
    const confirmation = await hiddenPrompt("Confirm new admin password: ");
    if (password !== confirmation) throw new Error("Passwords do not match. No changes were made.");

    auth.validateCredentials(admin.email, password);
    const salt = require("node:crypto").randomBytes(16).toString("hex");
    const hash = AuthService.hashPassword(password, salt);

    store.database.exec("BEGIN IMMEDIATE");
    try {
      store.database.prepare(
        "UPDATE users SET password_hash=?,password_salt=? WHERE id=? AND role='admin' AND active=1"
      ).run(hash, salt, admin.id);
      store.database.prepare("DELETE FROM user_sessions WHERE user_id=?").run(admin.id);
      store.database.exec("COMMIT");
    } catch (error) {
      store.database.exec("ROLLBACK");
      throw error;
    }

    stdout.write("Admin password updated for " + admin.email + ".\n");
    stdout.write("All existing sessions for this admin were revoked. Sign in again with the new password.\n");
  } finally {
    if (!rl.closed) rl.close();
    store.close();
  }
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(error.message + "\n");
    process.exitCode = 1;
  });
}

module.exports = { hiddenPrompt };
