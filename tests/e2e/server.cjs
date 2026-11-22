"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createApiServer } = require("../../api/server.cjs");

async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "civicdesk-e2e-"));
  const server = await createApiServer({ dataFile: path.join(directory, "civicdesk.sqlite"), authRequired: false });
  const port = Number(process.env.PORT || 4173);

  server.listen(port, "127.0.0.1", () => {
    process.stdout.write("CivicDesk API + dashboard E2E server listening at http://127.0.0.1:" + port + "\\n");
  });

  let closing = false;
  async function shutdown() {
    if (closing) return;
    closing = true;
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
  process.once("SIGINT", () => shutdown().finally(() => process.exit(0)));
  process.once("SIGTERM", () => shutdown().finally(() => process.exit(0)));
}

main().catch(error => {
  process.stderr.write(error.stack + "\\n");
  process.exitCode = 1;
});
