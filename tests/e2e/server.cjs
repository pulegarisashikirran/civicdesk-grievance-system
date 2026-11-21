const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const page = path.join(root, "index.html");
const server = http.createServer((req, res) => {
  if (req.url !== "/" && req.url !== "/index.html") {
    res.writeHead(404);
    return res.end("Not found");
  }
  fs.readFile(page, (error, content) => {
    if (error) {
      res.writeHead(500);
      return res.end("Could not read CivicDesk index.html");
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(content);
  });
});

server.listen(4173, "127.0.0.1");
