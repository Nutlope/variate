#!/usr/bin/env node
// A dev server for fixtures/static, so the card can be exercised in a real
// browser with no user project. It has no HMR on purpose: that makes it the
// test for the reload fallback path.
//
//   node dev/fixture.mjs [--port 5177] [--dir fixtures/static]

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = {};
{
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith("--")) continue;
    const n = a[i + 1];
    args[a[i].slice(2)] = n == null || n.startsWith("--") ? true : a[++i];
  }
}
const DIR = path.resolve(args.dir && args.dir !== true ? String(args.dir) : path.join(HERE, "..", "fixtures", "static"));
const PORT = Number(args.port ?? 5177);
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png" };

http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file = path.normalize(path.join(DIR, rel === "/" ? "index.html" : rel));
  if (file !== DIR && !file.startsWith(DIR + path.sep)) { res.writeHead(403).end("no"); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!fs.existsSync(file)) { res.writeHead(404).end("not found"); return; }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "text/plain", "Cache-Control": "no-store" });
  res.end(fs.readFileSync(file));
}).listen(PORT, "127.0.0.1", () => {
  console.log(`fixture app on http://127.0.0.1:${PORT}   (serving ${DIR})`);
});
