#!/usr/bin/env node
// variate: design variations, on the localhost you are already looking at.
//
//   variate up      [--root .] [--port N]   start the sidecar, add the tag, print the block
//   variate add     <file> [--n 4]          register a set; variant 1 is the file as it is now
//   variate use     <set> <n>               switch (the same thing the card does)
//   variate narrow  <set> [<n>]             the question narrowed: keep one, drop the rest
//   variate check   [<set>]                 lint the variant files against the contract
//   variate status  [--json]                sets, live positions, whether the card has loaded
//   variate await   [--timeout 20]          block briefly for the card's next ask
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
  paths, listSets, readSet, switchTo, narrowTo, slug, defaultPortFor,
  readSafe, readJsonSafe, atomicWrite, readBoard, recordSettled, stripMarker,
  escapeRe, VERSION,
} from "./src/core.mjs";
import { detect, attach, detach, isAttached, ignoreLine, unignoreLine } from "./src/attach.mjs";
import { checkSet, checkPlan, parserFor } from "./src/check.mjs";
import { queueState } from "./src/queue.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

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

const STARTER = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Untitled</title>
</head>
<body>
<!-- Nothing here yet. Your agent is about to draft this page, and variate
     will put four versions of it behind the card at the bottom. -->
</body>
</html>
`;

/** The page a browser would land on when we serve the project. */
function firstHtml(root) {
  for (const c of ["index.html", "public/index.html", "src/index.html"]) {
    if (fs.existsSync(path.join(root, c))) return c;
  }
  try {
    const f = fs.readdirSync(root).find((x) => /\.html?$/i.test(x));
    if (f) return f;
  } catch { /* nothing */ }
  return null;
}

/** Is there anything here at all that a browser could open? */
function looksEmpty(root) {
  const found = detect(root);
  if (found) return false;
  const stack = [root];
  let depth = 0;
  while (stack.length && depth < 400) {
    const dir = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      depth++;
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      if (e.isDirectory()) { stack.push(path.join(dir, e.name)); continue; }
      if (/\.html?$/i.test(e.name)) return false;
    }
  }
  return true;
}

async function cmdUp() {
  fs.mkdirSync(P.REQ_DONE, { recursive: true });

  const already = await liveServer();
  const wantPort = flag("port") ? Number(flag("port")) : defaultPortFor(P.ROOT);

  // Three shapes of project, and none of them is allowed to dead-end:
  //   a framework we know   -> their dev server renders; we only add the tag
  //   plain HTML, no server -> we serve their real files, so there is a page
  //   nothing at all        -> we scaffold one page, then serve it
  const found = detect(P.ROOT);
  const framework = found && found.stack !== "static";
  const empty = !framework && looksEmpty(P.ROOT);
  let scaffolded = null;
  if (empty && !args["no-scaffold"]) {
    const page = path.join(P.ROOT, "index.html");
    fs.mkdirSync(P.ROOT, { recursive: true });
    fs.writeFileSync(page, STARTER);
    scaffolded = "index.html";
  }
  const serve = !framework;

  let port;
  if (already) {
    port = already.port;
  } else {
    // Somebody may already be on this port. If it is variate for THIS project
    // (a stale or missing server.json, so liveServer missed it), adopt it
    // rather than starting a rival: two sidecars for one project fight over
    // the token, and the loser's card 401s on every call.
    const squat = await get(wantPort, "/health");
    if (squat?.ok && path.resolve(squat.root) === P.ROOT) {
      atomicWrite(P.SERVER_JSON, JSON.stringify({ port: wantPort, root: P.ROOT, adopted: true, version: squat.version ?? null, serve }, null, 2) + "\n");
      port = wantPort;
      key("PORT", `${wantPort} was already variate for this project, so it was adopted`);
    } else if (squat?.ok) {
      key("PORT", `${wantPort} is variate for ${squat.root}; taking the next free port.`);
    }
    if (!port) {
      const logFd = fs.openSync(P.LOG, "a");
      const child = spawn(process.execPath,
        [path.join(HERE, "src", "sidecar.mjs"), "--root", P.ROOT, "--port", String(wantPort), ...(serve ? ["--serve"] : [])],
        { detached: true, stdio: ["ignore", logFd, logFd] });
      child.unref();
      const deadline = Date.now() + 6000;
      while (Date.now() < deadline && !port) {
        await new Promise((r) => setTimeout(r, 200));
        const l = await liveServer();
        if (l) port = l.port;
      }
    }
    if (!port) {
      // Some sandboxes (Codex and friends) refuse to keep a detached child
      // alive or to bind a port. That costs the card, and nothing else: the
      // whole round still runs from the CLI, so say so and exit 3 rather
      // than failing hard.
      key("VARIATE", "the sidecar could not start, so the on-page card is unavailable.");
      key("WHY", `no background process or no port. Details: ${P.LOG}`);
      key("STILL", "everything works from here: add, check, use, status, end.");
      key("HOW", "the user sees each variant by reloading their page after you switch.");
      key("NEXT", `node ${path.join(HERE, "variate.mjs")} add <a component or page file> --root ${P.ROOT}`);
      process.exit(3);
    }
  }

  // Served pages load the card from their own origin, so nothing is
  // cross-origin and the tag survives the port moving.
  // Served projects get the tag injected at request time, so their files
  // never mention variate and a variant can be a whole-file replacement
  // without losing the card. Only a project with its own dev server is
  // written to.
  const tagUrl = `http://127.0.0.1:${port}/v.js`;
  const target = serve ? null : found;
  let attached = readJsonSafe(P.ATTACH);

  if (args["no-attach"] || !target?.file) {
    // leave the project alone
  } else if (attached?.file && isAttached(P.ROOT, attached.file)) {
    // already wired; refresh the port in case it moved
    const cur = readSafe(path.join(P.ROOT, attached.file)) ?? "";
    if (!cur.includes(tagUrl)) {
      const fresh = cur.replace(/http:\/\/127\.0\.0\.1:\d+\/v\.js/g, tagUrl);
      atomicWrite(path.join(P.ROOT, attached.file), fresh);
    }
  } else {
    const r = attach(P.ROOT, target, tagUrl);
    if (r.error) die(r.error, 3);
    attached = { stack: target.stack, file: target.file, created: !!r.created, tagUrl, at: new Date().toISOString() };
    atomicWrite(P.ATTACH, JSON.stringify(attached, null, 2) + "\n");
  }

  const ig = ignoreLine(P.ROOT, ".variate/");
  // Remember that WE created the file, so end can take the whole file back
  // out; a .gitignore the user wrote is never deleted, only edited.
  if (ig.created) atomicWrite(path.join(P.STATE, "gitignore-created"), "1\n");
  const st = await get(port, "/health");
  const sets = listSets(P);

  const url = `http://127.0.0.1:${port}`;
  if (serve) key("PAGE", `${url}   (variate is serving your files; open this)`);
  else key("VARIATE", `up on ${url}  ·  your own dev server renders the page`);
  key("ROOT", P.ROOT);
  if (scaffolded) key("NEW", `this project was empty, so ${scaffolded} was created for you to design into`);
  if (attached) key("TAG", `${attached.file}  (marker-bracketed; \`variate end\` removes it)`);
  else if (serve) key("CARD", "injected as the page is served, so your files never mention variate");
  key("SETS", sets.length ? sets.map((s) => `${s.name} on ${s.at ?? "?"} of ${s.n}`).join(" · ") : "none yet");
  key("NEXT", sets.length
    ? "flip variants on the page: ← →, or 1-9"
    : scaffolded
      ? `node ${path.join(HERE, "variate.mjs")} add index.html --new --n 4 --root ${P.ROOT}   then write 1..4`
      : `node ${path.join(HERE, "variate.mjs")} add <a component or page file> --root ${P.ROOT}`);
  key("KEYS", "← → flip · 1-9 jump · again to replay · enter keep · [ ] section · esc hide · ? help");
  if (ig.created) key("IGNORE", "created .gitignore with .variate/ in it");
  else if (ig.added) key("IGNORE", "added .variate/ to .gitignore");
  else if (ig.skipped === "no git repo") key("IGNORE", "no git repo here, so nothing ignores .variate/");
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
      if (src && new RegExp(`["'\`][^"'\`]*\\b${escapeRe(stem)}\\b`).test(src)) hits++;
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
  // --new: nothing exists yet, so every position is a fresh design and there
  // is no "as it was" baseline to preserve. Designing from nothing is a first
  // class case, not an error.
  const fresh = !!args.new || !fs.existsSync(abs);

  // Already varying this exact file? Say so by name, whatever the set is
  // called, and point at extending it. Otherwise a second round on the same
  // section quietly becomes a second set fighting the first over one file.
  const owner = listSets(P).find((s) => s.target === abs);
  if (owner) {
    key("SET", `${owner.name} already varies ${owner.targetRel} (on ${owner.at ?? "?"} of ${owner.n})`);
    key("EXTEND", `write ${path.relative(P.ROOT, owner.dir)}/${owner.n + 1}${owner.ext} and append its direction to plan.json`);
    key("WHY", "one file, one set: a second set on the same file would fight it for the target");
    process.exit(2);
  }

  const name = slug(flag("name") || path.basename(abs));
  const dir = path.join(P.SETS, name);
  if (fs.existsSync(dir)) {
    const other = readSet(P, name);
    key("SET", `the name "${name}" is taken by ${other?.targetRel ?? "another set"}`);
    key("FIX", `pass --name <something-else>`);
    process.exit(2);
  }
  const n = Number(flag("n", "4"));
  const ext = path.extname(abs);

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "target"), path.relative(P.ROOT, abs) + "\n");
  if (!fresh) fs.copyFileSync(abs, path.join(dir, `1${ext}`));
  // A scaffold placeholder is not the user's work, so do not let the first
  // switch adopt it as a design.
  else if (readSafe(abs) === STARTER) fs.rmSync(abs, { force: true });

  key("SET", `${name}  ·  ${path.relative(P.ROOT, abs)}${fresh ? "  (new: nothing there yet)" : ""}`);
  if (fresh) key("SLOTS", `${n} fresh designs. Position 1 is a real design too, not a baseline.`);
  else key("SLOT 1", `your file as it is now (${(fs.statSync(abs).size / 1024).toFixed(1)} KB), never edited`);
  const first = fresh ? 1 : 2;
  key("WRITE", `${path.relative(P.ROOT, dir)}/plan.json  then  ${[...Array(Math.max(0, n - first + 1))].map((_, i) => `${i + first}${ext}`).join("  ")}`);
  key("CARD", `the pager grows to ${n} as each file lands; the page changes only when you switch`);
  key("MORE", `to extend this round later, write ${n + 1}${ext} and append its direction to plan.json. No command needed.`);
  // The page variate serves (or attached the tag to) is the page by
  // definition, so never claim nothing renders it. In serve mode that is the
  // HTML file a browser lands on, which is the whole greenfield flow: warning
  // there would be telling the user their only page is invisible.
  const relTarget = path.relative(P.ROOT, abs);
  const served = readJsonSafe(P.SERVER_JSON)?.serve ? firstHtml(P.ROOT) : null;
  const isEntry = readJsonSafe(P.ATTACH)?.file === relTarget
    || served === relTarget
    || (!!readJsonSafe(P.SERVER_JSON)?.serve && relTarget === "index.html");
  if (!isEntry && !referenced(abs)) {
    key("NOTE", "nothing in this project seems to import that file, so the user may not see it on their page");
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
  const res = live ? await post(live.port, "/switch", { set: s.name, to: n, source: "agent" }) : switchTo(P, s.name, n);
  if (res.error) die(res.error, 3);
  key("USE", `${s.name} → ${n}${res.adopted ? ` (your edit kept as ${res.adopted})` : ""}`);
  key("FILE", s.targetRel);
  process.exit(0);
}

async function cmdNarrow() {
  const [name, nRaw] = rest;
  if (!name) die("usage: variate narrow <set> [<n>]   (defaults to what is live)");
  const s = readSet(P, slug(name));
  if (!s) die(`no set "${name}"`, 3);
  // No position given means "the one I am looking at", which is the whole
  // point: the user narrows by deciding, not by counting.
  const n = nRaw ? Number(nRaw) : s.at;
  if (n == null) {
    key("NARROW", "the live file matches no variant, so there is nothing to narrow to");
    key("FIX", `switch first (variate use ${s.name} <n>), or name the position`);
    process.exit(3);
  }

  const res = narrowTo(P, s.name, n);
  if (res.error) die(res.error, 3);
  if (res.noop) { key("NARROW", `${s.name} is already down to one position`); process.exit(2); }

  key("NARROW", `${s.name} is now 1 of 1${res.label ? `  ·  ${res.label}` : ""}`);
  key("WAS", `position ${res.was}; the other ${res.removed} left the pager`);
  key("SAFE", `they are in ${path.relative(P.ROOT, s.dir)}/.dropped/ if the user wants one back`);
  key("NEXT", `write ${path.relative(P.ROOT, s.dir)}/2${s.ext} (and 3) as takes ON this one, and append their directions to plan.json`);
  process.exit(0);
}

function cmdCheck() {
  const names = rest.length ? rest.map(slug) : listSets(P).map((s) => s.name);
  if (!names.length) { out("CHECK     no sets"); process.exit(2); }
  let warned = 0;
  for (const name of names) {
    const s = readSet(P, name);
    if (!s) { out(`CHECK     no set "${name}"`); continue; }
    // The round before the files: a set whose positions do not disagree is
    // the failure the user feels, and no amount of clean code fixes it.
    for (const w of checkPlan(s)) {
      warned++;
      out(`${s.name}${" ".repeat(Math.max(1, 10 - String(s.name).length))}${w}`);
    }
    const rows = checkSet(P, s);
    for (const r of rows) {
      if (!r.warnings.length) continue;
      warned += r.warnings.length;
      out(`${s.name} ${r.n}${" ".repeat(Math.max(1, 9 - String(s.name).length - String(r.n).length))}${r.warnings.join("; ")}`);
    }
  }
  // Say what was actually examined: "no warnings" must never read as "it builds".
  const parser = parserFor(P);
  const anyJs = names.some((n) => /\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(readSet(P, n)?.ext ?? ""));
  const scope = parser && anyJs
    ? `parsed with your ${parser.kind}, plus imports, exports and house style`
    : anyJs
      ? "imports, exports and house style; NOT parsed (no parser in this project, so run your own build)"
      : "imports and house style (not a JavaScript set, so nothing to parse)";
  key("CHECK", `${names.length} set${names.length === 1 ? "" : "s"}${warned ? "" : ", no warnings"}  ·  ${scope}`);
  process.exit(0);
}

async function cmdStatus() {
  const live = await liveServer();
  const sets = listSets(P);
  const board = readBoard(P);
  if (args.json) {
    out(JSON.stringify({ root: P.ROOT, port: live?.port ?? null, sets: sets.map((s) => ({ name: s.name, target: s.targetRel, n: s.n, at: s.at })), settled: board.settled, passed: board.passed }));
    // Same predicate as the text branch below: a session with a board is not
    // "nothing to do", whichever way you asked for it.
    process.exit(sets.length || board.settled.length || board.passed.length ? 0 : 2);
  }
  key("ROOT", P.ROOT);
  key("SIDECAR", live ? `up on ${live.port}` : "not running (variate up)");
  const att = readJsonSafe(P.ATTACH);
  key("TAG", att?.file ? `${att.file}${isAttached(P.ROOT, att.file) ? "" : "  (MISSING: run variate up)"}` : "not attached");
  if (!sets.length) key("SETS", "none");
  for (const s of sets) {
    const where = s.n === 0 ? "nothing drafted yet"
      : !s.exists ? `${s.n} drafted, none on the page yet`
      : s.at == null ? `on your own edit, of ${s.n} (the next switch keeps it)`
      : `on ${s.at} of ${s.n}`;
    key(s.name, `${where}  ·  ${s.targetRel}`);
    // Earlier directions the round narrowed past: nameable, and one copy
    // away from being back in the pager.
    let dropped = [];
    try { dropped = fs.readdirSync(path.join(s.dir, ".dropped")); } catch { /* none */ }
    if (dropped.length) {
      key("", `dropped: ${dropped.map((f) => f.replace(/^\d+-/, "").replace(/\.[^.]+$/, "")).join(", ")}`);
    }
  }
  // What this session has already put to bed, so a long build has a shape and
  // you can see how far through the page you are. The passed lines are the
  // other half of the memory: directions the user turned down stay dead, and
  // a later round must not redraw one unasked.
  for (const e of board.settled) key("settled", `${e.piece}: ${e.kept}  ·  ${e.target}`);
  for (const e of board.passed) key("passed", `${e.piece}: ${e.name}${e.angle ? ` (${e.angle})` : ""}`);
  process.exit(sets.length || board.settled.length || board.passed.length ? 0 : 2);
}

async function cmdEnd() {
  const only = rest[0] ? slug(rest[0]) : null;
  const sets = listSets(P);
  const running = !!(await liveServer());
  if (only) {
    const s = readSet(P, only);
    if (!s) die(`no set "${only}"`, 3);
    const lost = Math.max(0, s.n - 1);
    // Note the decision before the evidence goes, so the session can still
    // recap it at the end.
    const kept = recordSettled(P, s, flag("why"));
    stripMarker(s);
    fs.rmSync(s.dir, { recursive: true, force: true });
    key("KEPT", `${s.targetRel} as it is now (${kept ?? `variant ${s.at ?? "your own edit"}`})`);
    key("REMOVED", `${path.relative(P.ROOT, s.dir)}, so the other ${lost} variant${lost === 1 ? " is" : "s are"} gone`);
    const openNow = listSets(P).filter((x) => x.name !== s.name);
    key("OPEN", openNow.length ? openNow.map((x) => x.name).join(", ") : "nothing else; variate end closes the session");
    process.exit(0);
  }

  // Everything still open is being settled on whatever is live, so note it
  // and count what goes BEFORE the directories do: reading .dropped after the
  // set is deleted silently counts zero.
  const lost = sets.reduce((n, s) => {
    let attic = 0;
    try { attic = fs.readdirSync(path.join(s.dir, ".dropped")).length; } catch { /* none */ }
    return n + Math.max(0, s.n - 1) + attic;
  }, 0);
  for (const s of sets) { recordSettled(P, s, null); stripMarker(s); }
  const board = readBoard(P);

  for (const s of sets) fs.rmSync(s.dir, { recursive: true, force: true });
  const led = readJsonSafe(P.ATTACH);
  const server = readJsonSafe(P.SERVER_JSON);
  const d = detach(P.ROOT, P.ATTACH);
  unignoreLine(P.ROOT, ".variate/", fs.existsSync(path.join(P.STATE, "gitignore-created")));

  // Stop the sidecar too: end means gone, with nothing for anyone to pkill.
  // Ask it to shut down over HTTP first, so an open card hears the empty
  // state and bows out; SIGTERM is the fallback for a wedged one. `running`
  // already health-checked the pid against THIS root, so a recycled pid on
  // another project can never be killed by mistake.
  if (running) {
    const bye = await post(server?.port ?? 0, "/shutdown", {}).catch(() => null);
    if (!bye?.ok && server?.pid) {
      try { process.kill(server.pid, "SIGTERM"); } catch { /* already gone */ }
    }
  }
  try { fs.rmSync(P.VAR, { recursive: true, force: true }); } catch { /* ignore */ }

  key("KEPT", sets.length ? sets.map((s) => s.targetRel).join(", ") : "nothing to keep");
  key("REMOVED", `.variate/${led?.file ? ` and the tag in ${led.file}` : ""}${lost ? `, so ${lost} unused variant${lost === 1 ? " is" : "s are"} gone` : ""}`);
  if (running) {
    key("SIDECAR", "stopped");
    // In serve mode the sidecar WAS the page's server, so say how to keep
    // looking at the design that was just kept.
    if (server?.serve) key("NEXT", "that page was served by variate; open the file directly, or run variate up to serve it again");
  }
  // The session, in one block: every piece it settled and what won. This is
  // the only place the decisions are spoken, and it goes with the directory
  // it was written in, so tell the user now.
  if (board.settled.length) {
    out("");
    key("SETTLED", `${board.settled.length} piece${board.settled.length === 1 ? "" : "s"} this session`);
    for (const e of board.settled) {
      key("", `${e.piece}: ${e.kept}${e.why ? `  (${e.why})` : ""}`);
      if (e.question) key("", `  asked: ${e.question}`);
    }
    if (board.passed.length) {
      key("PASSED", `${board.passed.map((e) => e.name).join(", ")}  ·  turned down; not fresh ideas next time`);
    }
  }
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

// Block briefly for the card's next ask. The one honest precondition: an ask
// can only ever arrive when the card exists. With no live sidecar and nothing
// already queued, waiting would be waiting for a phone that is not plugged in,
// so exit 3 and let the agent ask in chat instead.
async function cmdAwait() {
  const { queued, working } = queueState(P);
  if (queued.length || working.length) return passthrough([]);
  if (!(await liveServer())) {
    key("AWAIT", "no card is running here, so no ask can ever arrive");
    key("ASK", "get the verdict in chat instead");
    process.exit(3);
  }
  passthrough([]);
}

// ---------------------------------------------------------------------------

const HELP = `variate ${VERSION}

  up      [--root .] [--port N] [--no-attach]   start the sidecar and put the card on your page
          [--no-scaffold]                       ...and in an empty folder, do not write an index.html
  add     <file> [--n 4] [--name x]             register a set; variant 1 is the file as it is now
          [--new]                               ...nothing there yet: every position is a fresh design
  use     <set> <n>                             switch to a variant
  narrow  <set> [<n>]                           keep one position, drop the rest, draw again from there
  check   [<set>]                               lint the variant files
  status  [--json]                              what exists right now
  await   [--timeout 20]                        block briefly for the card's next ask
  end     [<set>] [--why "..."]                 keep what is live, remove variate
  drain | peek [--hook]                         the agent's queue

every command takes --root <project>; pass it when the cwd is not the project
exit codes: 0 did it · 1 error · 2 nothing to do · 3 you have to act
(await exits 3 when no card is running: skip the wait and ask in chat)`;

switch (verb) {
  case "up": await cmdUp(); break;
  case "add": cmdAdd(); break;
  case "use": await cmdUse(); break;
  case "narrow": await cmdNarrow(); break;
  case "check": cmdCheck(); break;
  case "status": await cmdStatus(); break;
  case "end": await cmdEnd(); break;
  case "await": await cmdAwait(); break;
  case "drain": passthrough(["--drain"]); break;
  case "peek": passthrough(["--peek"]); break;
  case "version": out(VERSION); break;
  default: out(HELP); process.exit(verb ? 1 : 0);
}
