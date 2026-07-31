#!/usr/bin/env node
// variate: design variations, on the localhost you are already looking at.
//
//   variate up      [--root .] [--port N]   start the sidecar, add the tag, print the block
//   variate add     <file> [--n 4]          register a set; variant 1 is the file as it is now
//   variate use     <set> <n>               switch (the same thing the card does)
//   variate check   [<set>]                 lint the variant files against the contract
//   variate status  [--json]                sets, live positions, whether the card has loaded
//   variate end     [<set>]                 keep what is live, remove variate from the project
//   variate drain | peek                    the agent's queue (thin wrappers over await.mjs)
//
// Exit codes are the protocol: 0 did it, 1 hard error, 2 nothing to do,
// 3 the user has to act.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import http from "node:http";
import { fileURLToPath } from "node:url";
import {
  paths, listSets, readSet, setDir, switchTo, slug, defaultPortFor,
  readSafe, readJsonSafe, atomicWrite,
} from "./src/core.mjs";
import { detect, attach, detach, isAttached, ignoreLine, unignoreLine, snippetFor } from "./src/attach.mjs";
import { checkSet, parserFor } from "./src/check.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VERSION = "3.0.0";

// ---------------------------------------------------------------------------
// args

let verb = null;
const rest = [];
const args = {};
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { verb == null ? (verb = a) : rest.push(a); continue; }
    const next = argv[i + 1];
    args[a.slice(2)] = next == null || next.startsWith("--") ? true : argv[++i];
  }
}

const flag = (k, d = null) => (args[k] != null && args[k] !== true ? String(args[k]) : d);
const ROOT = path.resolve(flag("root", "."));
const P = paths(ROOT);
const out = (s = "") => process.stdout.write(s + "\n");
const die = (msg, code = 1) => { process.stderr.write("variate: " + msg + "\n"); process.exit(code); };
const key = (k, v) => out(k.padEnd(9) + v);

// ---------------------------------------------------------------------------
// sidecar liveness

function get(port, pathname, timeout = 900) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: pathname, timeout }, (res) => {
      let b = ""; res.on("data", (c) => (b += c));
      res.on("end", () => { try { resolve(JSON.parse(b)); } catch { resolve(null); } });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

async function liveServer() {
  const sj = readJsonSafe(P.SERVER_JSON);
  if (!sj?.port) return null;
  const h = await get(sj.port, "/health");
  if (h?.ok && path.resolve(h.root) === P.ROOT) return { port: sj.port, token: readSafe(P.TOKEN)?.trim() };
  return null;
}

async function post(port, pathname, body) {
  const token = readSafe(P.TOKEN)?.trim() ?? "";
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1", port, path: pathname, method: "POST", timeout: 5000,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "Content-Length": Buffer.byteLength(payload) },
    }, (res) => {
      let b = ""; res.on("data", (c) => (b += c));
      res.on("end", () => { try { resolve(JSON.parse(b)); } catch { reject(new Error("bad response")); } });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.end(payload);
  });
}

// ---------------------------------------------------------------------------
// up

async function cmdUp() {
  fs.mkdirSync(P.REQ_DONE, { recursive: true });

  const already = await liveServer();
  const wantPort = flag("port") ? Number(flag("port")) : defaultPortFor(P.ROOT);

  let port;
  if (already) {
    port = already.port;
  } else {
    // Say so when the wanted port belongs to a different project's card.
    const squat = await get(wantPort, "/health");
    if (squat?.ok && path.resolve(squat.root) !== P.ROOT) {
      key("PORT", `${wantPort} is variate for ${squat.root}; taking the next free port.`);
    }
    const logFd = fs.openSync(P.LOG, "a");
    const child = spawn(process.execPath, [path.join(HERE, "src", "sidecar.mjs"), "--root", P.ROOT, "--port", String(wantPort)],
      { detached: true, stdio: ["ignore", logFd, logFd] });
    child.unref();
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline && !port) {
      await new Promise((r) => setTimeout(r, 200));
      const l = await liveServer();
      if (l) port = l.port;
    }
    if (!port) die(`the sidecar did not come up; see ${P.LOG}`);
  }

  const tagUrl = `http://127.0.0.1:${port}/v.js`;
  const found = detect(P.ROOT);
  let attached = readJsonSafe(P.ATTACH);

  if (args["no-attach"]) {
    // leave the project alone
  } else if (!found) {
    key("STACK", "not detected. Add this tag to your page yourself, in dev only:");
    key("", `<script src="${tagUrl}"></script>`);
  } else if (attached?.file && isAttached(P.ROOT, attached.file)) {
    // already wired; refresh the port in case it moved
    const cur = readSafe(path.join(P.ROOT, attached.file)) ?? "";
    if (!cur.includes(tagUrl)) {
      const fresh = cur.replace(/http:\/\/127\.0\.0\.1:\d+\/v\.js/g, tagUrl);
      atomicWrite(path.join(P.ROOT, attached.file), fresh);
    }
  } else {
    const r = attach(P.ROOT, found, tagUrl);
    if (r.error) die(r.error, 3);
    attached = { stack: found.stack, file: found.file, created: !!r.created, tagUrl, at: new Date().toISOString() };
    atomicWrite(P.ATTACH, JSON.stringify(attached, null, 2) + "\n");
  }

  const ig = ignoreLine(P.ROOT, ".variate/");
  const st = await get(port, "/health");
  const sets = listSets(P);
  const cardSeen = readJsonSafe(P.SERVER_JSON);

  key("VARIATE", `up on http://127.0.0.1:${port}  ·  root ${P.ROOT}`);
  if (attached) key("TAG", `${attached.file}  (dev only, marker-bracketed; \`variate end\` removes it)`);
  key("SETS", sets.length ? sets.map((s) => `${s.name} on ${s.at ?? "?"} of ${s.n}`).join(" · ") : "none yet");
  key("NEXT", sets.length
    ? "flip variants on your page: ← →, or 1-9"
    : `node ${path.join(HERE, "variate.mjs")} add <a component or page file> --root ${P.ROOT}`);
  key("KEYS", "← → flip · 1-9 jump · [ ] section · esc hide · ? help");
  if (ig.added) key("IGNORE", "added .variate/ to .gitignore");
  process.exit(already ? 2 : 0);
}

// ---------------------------------------------------------------------------
// add

/** Does anything in the project actually pull this file in? A cheap grep on
 *  the basename: variate's whole promise is that the user SEES the variants,
 *  so a target nothing renders is worth saying out loud. */
function referenced(abs) {
  const stem = path.basename(abs).replace(/\.[^.]+$/, "");
  const skip = new Set(["node_modules", ".git", ".variate", "dist", "build", ".next", ".svelte-kit", "out", "coverage"]);
  let hits = 0;
  const walk = (dir, depth) => {
    if (hits || depth > 6) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (hits) return;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!skip.has(e.name)) walk(p, depth + 1); continue; }
      if (p === abs || !/\.(m?[jt]sx?|vue|svelte|astro|html|erb|php|py|rb)$/i.test(e.name)) continue;
      const src = readSafe(p);
      if (src && new RegExp(`["'\`][^"'\`]*\\b${stem}\\b`).test(src)) hits++;
    }
  };
  walk(P.ROOT, 0);
  return hits > 0;
}

function cmdAdd() {
  const rel = rest[0];
  if (!rel) die("usage: variate add <file> [--n 4]");
  const abs = path.resolve(P.ROOT, rel);
  if (abs !== P.ROOT && !abs.startsWith(P.ROOT + path.sep)) die("that file is outside the project", 3);
  if (!fs.existsSync(abs)) die(`no such file: ${rel}`, 3);

  const name = slug(flag("name") || path.basename(abs));
  const dir = path.join(P.SETS, name);
  if (fs.existsSync(dir)) {
    out(`SET       ${name} already exists (${readSet(P, name)?.n ?? 0} variants)`);
    process.exit(2);
  }
  const n = Number(flag("n", "4"));
  const ext = path.extname(abs);

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "target"), path.relative(P.ROOT, abs) + "\n");
  fs.copyFileSync(abs, path.join(dir, `1${ext}`));

  key("SET", `${name}  ·  ${path.relative(P.ROOT, abs)}`);
  key("SLOT 1", `your file as it is now (${(fs.statSync(abs).size / 1024).toFixed(1)} KB), never edited`);
  key("WRITE", `${path.relative(P.ROOT, dir)}/plan.json  then  ${[...Array(Math.max(0, n - 1))].map((_, i) => `${i + 2}${ext}`).join("  ")}`);
  key("CARD", `the pager grows to ${n} as each file lands; the page changes only when you switch`);
  key("MORE", `to extend this round later, write ${n + 1}${ext} and append its direction to plan.json. No command needed.`);
  if (!referenced(abs)) {
    key("HEED", "nothing in this project seems to import that file, so the user may not see it on their page");
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// use / check / status / end

async function cmdUse() {
  const [name, nRaw] = rest;
  if (!name || !nRaw) die("usage: variate use <set> <n>");
  const s = readSet(P, slug(name));
  if (!s) die(`no set "${name}"`, 3);
  const n = Number(nRaw);
  if (s.at === n) { out(`USE       ${s.name} is already on ${n}`); process.exit(2); }

  const live = await liveServer();
  const res = live ? await post(live.port, "/switch", { set: s.name, to: n }) : switchTo(P, s.name, n);
  if (res.error) die(res.error, 3);
  key("USE", `${s.name} → ${n}${res.adopted ? ` (your edit kept as ${res.adopted})` : ""}`);
  key("FILE", s.targetRel);
  process.exit(0);
}

function cmdCheck() {
  const names = rest.length ? rest.map(slug) : listSets(P).map((s) => s.name);
  if (!names.length) { out("CHECK     no sets"); process.exit(2); }
  let warned = 0;
  for (const name of names) {
    const s = readSet(P, name);
    if (!s) { out(`CHECK     no set "${name}"`); continue; }
    const rows = checkSet(P, s);
    for (const r of rows) {
      if (!r.warnings.length) continue;
      warned += r.warnings.length;
      out(`${s.name} ${r.n}${" ".repeat(Math.max(1, 9 - String(s.name).length - String(r.n).length))}${r.warnings.join("; ")}`);
    }
  }
  // Say what was actually examined: "no warnings" must never read as "it builds".
  const scope = parserFor(P)
    ? "parsed with your esbuild, plus imports, exports and house style"
    : "imports, exports and house style; NOT parsed (no parser in this project, so run your own build)";
  key("CHECK", `${names.length} set${names.length === 1 ? "" : "s"}${warned ? "" : ", no warnings"}  ·  ${scope}`);
  process.exit(0);
}

async function cmdStatus() {
  const live = await liveServer();
  const sets = listSets(P);
  if (args.json) {
    out(JSON.stringify({ root: P.ROOT, port: live?.port ?? null, sets: sets.map((s) => ({ name: s.name, target: s.targetRel, n: s.n, at: s.at })) }));
    process.exit(sets.length ? 0 : 2);
  }
  key("ROOT", P.ROOT);
  key("SIDECAR", live ? `up on ${live.port}` : "not running (variate up)");
  const att = readJsonSafe(P.ATTACH);
  key("TAG", att?.file ? `${att.file}${isAttached(P.ROOT, att.file) ? "" : "  (MISSING: run variate up)"}` : "not attached");
  if (!sets.length) key("SETS", "none");
  for (const s of sets) {
    key(s.name, `on ${s.at ?? "?"} of ${s.n}  ·  ${s.targetRel}${s.at == null ? "  (hand-edited; the next switch keeps it)" : ""}`);
  }
  process.exit(sets.length ? 0 : 2);
}

function cmdEnd() {
  const only = rest[0] ? slug(rest[0]) : null;
  const sets = listSets(P);
  if (only) {
    const s = readSet(P, only);
    if (!s) die(`no set "${only}"`, 3);
    fs.rmSync(s.dir, { recursive: true, force: true });
    key("KEPT", `${s.targetRel} as it is now (variant ${s.at ?? "your own edit"})`);
    key("REMOVED", path.relative(P.ROOT, s.dir));
    process.exit(0);
  }

  for (const s of sets) fs.rmSync(s.dir, { recursive: true, force: true });
  const led = readJsonSafe(P.ATTACH);
  const d = detach(P.ROOT, P.ATTACH);
  unignoreLine(P.ROOT, ".variate/");
  try { fs.rmSync(P.VAR, { recursive: true, force: true }); } catch { /* ignore */ }

  key("KEPT", sets.length ? sets.map((s) => s.targetRel).join(", ") : "nothing to keep");
  key("REMOVED", `.variate/${led?.file ? ` and the tag in ${led.file}` : ""}`);
  key("NEXT", "stop the sidecar with: pkill -f variate/src/sidecar.mjs");
  process.exit(sets.length || led ? 0 : 2);
}

// ---------------------------------------------------------------------------
// queue passthroughs

function passthrough(extra) {
  const a = [path.join(HERE, "scripts", "await.mjs"), "--ws", P.VAR, ...extra];
  for (const k of ["ack", "result", "note", "timeout"]) if (args[k] != null) a.push("--" + k, String(args[k]));
  if (args.hook) a.push("--hook");
  const r = spawn(process.execPath, a, { stdio: "inherit" });
  r.on("exit", (code) => process.exit(code ?? 1));
}

// ---------------------------------------------------------------------------

const HELP = `variate ${VERSION}

  up      [--root .] [--port N] [--no-attach]   start the sidecar and put the card on your page
  add     <file> [--n 4]                        register a set; variant 1 is the file as it is now
  use     <set> <n>                             switch to a variant
  check   [<set>]                               lint the variant files
  status  [--json]                              what exists right now
  end     [<set>]                               keep what is live, remove variate
  drain | peek [--hook]                         the agent's queue

exit codes: 0 did it · 1 error · 2 nothing to do · 3 you have to act`;

switch (verb) {
  case "up": await cmdUp(); break;
  case "add": cmdAdd(); break;
  case "use": await cmdUse(); break;
  case "check": cmdCheck(); break;
  case "status": await cmdStatus(); break;
  case "end": cmdEnd(); break;
  case "drain": passthrough(["--drain"]); break;
  case "peek": passthrough(["--peek"]); break;
  case "version": out(VERSION); break;
  default: out(HELP); process.exit(verb ? 1 : 0);
}
