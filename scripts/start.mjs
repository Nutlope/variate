#!/usr/bin/env node
// Boot the variate studio: ensure the workspace skeleton, start (or reuse)
// the detached server, print the URL and the exact next command. Safe to run
// any number of times. Self-describing so even an agent without skill support
// can follow along.
//
//   node start.mjs [--ws ./variate] [--port 4177] [--no-open]

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--no-open") args.noOpen = true;
  else if (argv[i].startsWith("--")) args[argv[i].slice(2)] = argv[++i];
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WS = path.resolve(args.ws ?? "./variate");
const PORT = Number(args.port ?? 4177);
const SERVER_JSON = path.join(WS, "state", "server.json");

// ---- workspace skeleton -----------------------------------------------------
for (const d of ["site/sections", "requests/done", "state", "sketches", "assets", "dist"]) {
  fs.mkdirSync(path.join(WS, d), { recursive: true });
}
const manifestPath = path.join(WS, "site", "manifest.json");
if (!fs.existsSync(manifestPath)) {
  fs.writeFileSync(manifestPath, JSON.stringify({ version: 1, rev: 0, title: "", bodyAttrs: "", sections: [] }, null, 2) + "\n");
}
const decisionsPath = path.join(WS, "site", "DECISIONS.md");
if (!fs.existsSync(decisionsPath)) {
  fs.writeFileSync(decisionsPath, "# Design decisions\n\nAppend-only log of design rounds: the question asked, the takes offered, the user's verdict, and why. Read this at session start; the design tree lives here.\n");
}
const headPath = path.join(WS, "site", "head.html");
if (!fs.existsSync(headPath)) {
  fs.writeFileSync(headPath, `<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>Untitled</title>\n<style>\n/* The design system lives here: :root tokens, type scale, buttons, shared
   classes. The bootstrap recipe replaces this file wholesale. */\n:root{--bg:#ffffff;--ink:#111111}\nbody{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,sans-serif}\n</style>\n`);
}
const giPath = path.join(WS, ".gitignore");
if (!fs.existsSync(giPath)) fs.writeFileSync(giPath, "state/\ndist/\n");

// ---- server: reuse a live one, replace anything stale ------------------------
function getState(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/api/state", timeout: 900 }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => { try { resolve(JSON.parse(buf)); } catch { resolve(null); } });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

const existing = (() => {
  try { return JSON.parse(fs.readFileSync(SERVER_JSON, "utf8")); } catch { return null; }
})();

let live = null;
if (existing?.port) {
  const st = await getState(existing.port);
  // Identity check: same workspace answers on that port (defeats pid reuse
  // and a different project's studio squatting there).
  if (st?.ok && path.resolve(st.ws) === WS) live = { port: existing.port };
  else { try { fs.rmSync(SERVER_JSON, { force: true }); } catch { /* ignore */ } }
}

if (!live) {
  const logFd = fs.openSync(path.join(WS, "state", "server.log"), "a");
  const child = spawn(process.execPath, [path.join(HERE, "serve.mjs"), "--ws", WS, "--port", String(PORT)], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();
  // Wait for it to answer (it may have walked to a free port; server.json tells us).
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline && !live) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      const sj = JSON.parse(fs.readFileSync(SERVER_JSON, "utf8"));
      if (sj.startedAt && sj.port) {
        const st = await getState(sj.port);
        if (st?.ok && path.resolve(st.ws) === WS) live = { port: sj.port };
      }
    } catch { /* not up yet */ }
  }
  if (!live) {
    console.error(`variate: server did not come up; check ${path.join(WS, "state", "server.log")}`);
    process.exit(1);
  }
}

const url = `http://127.0.0.1:${live.port}`;
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const empty = !manifest.sections?.length;

if (!args.noOpen && process.platform === "darwin") {
  try { spawn("open", [url], { detached: true, stdio: "ignore" }).unref(); } catch { /* ignore */ }
}

console.log(`STUDIO   ${url}   (open this in a browser; it live-updates as files change)`);
console.log(`WORKSPACE ${WS}`);
console.log(empty
  ? `PAGE     empty. Bootstrap first: read references/recipes.md (Bootstrap), write site/head.html + first sections + manifest. Read site/DECISIONS.md too.`
  : `PAGE     ${manifest.sections.length} sections: ${manifest.sections.map((s) => s.slug).join(", ")}. Read site/DECISIONS.md for the design tree so far.`);
console.log(`MODE     terminal-first: talk with the user, edit the workspace files directly, and between turns fold in studio clicks with:`);
console.log(`DRAIN    node ${path.join(HERE, "await.mjs")} --ws ${WS} --drain   (prints queued studio requests as a JSON array; exit 2 = none; never blocks)`);
console.log(`STUDIO-MODE  only if the user says they want to click instead of talk: node ${path.join(HERE, "await.mjs")} --ws ${WS}   (blocks for one request; ack with --ack <id> --note "...")`);
console.log(`COMPARE  node ${path.join(HERE, "compare.mjs")} --ws ${WS} --slug <section>   writes a static side-by-side picker page for a design round.`);
