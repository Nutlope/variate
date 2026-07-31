#!/usr/bin/env node
// The agent's workspace CLI: every manifest mutation an agent makes goes
// through here, never through hand-edited JSON. When the studio server is up
// for this workspace it is the single writer (POST /api/agent, so parallel
// lands from subagents cannot collide); when it is not, a locked direct-fs
// fallback applies the same shared core.mjs logic.
//
//   node land.mjs land    --ws <ws> --slug hero [--page index] [--file take.html | markup on stdin]
//                         [--create [--position start|end|after:<slug>|before:<slug>]]
//                         [--activate] [--label "one human line"]
//   node land.mjs check   [--ws <ws>] [--slug hero] [--file take.html | markup on stdin]
//   node land.mjs pick    --ws <ws> --slug hero --take <N|take-N.html|last> [--page index]
//   node land.mjs discard --ws <ws> --slug hero --take <N|take-N.html|last> [--page index]
//   node land.mjs move    --ws <ws> --slug hero --to up|down|start|end|after:<slug>|before:<slug> [--page index]
//   node land.mjs cut     --ws <ws> --slug hero [--page index]
//   node land.mjs page    --ws <ws> --id about [--title "About"] [--route about.html]
//
// --take addresses FILES (3 means take-3.html; also "last"), never pager
// indices: indices shift when takes are discarded, file numbers never do.
// Output: ONE JSON line on stdout ({ok, mode: "server"|"fs", ...}); contract
// warnings also go to stderr, one per line, and never block the landing.
// check is a dry run: validates markup, mutates nothing, exit 0.
// Exit codes: 0 ok, 1 error.

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import {
  wsPaths, loadManifest, readJsonSafe, readSafe, atomicWrite, normalizeSlug, normalizeTake,
  validateTake, applyManifestOp, registerTake, nextTakeNumber, manifestDiffLabel,
  migrateWorkspaceV2,
} from "./core.mjs";

const VERBS = new Set(["land", "check", "pick", "discard", "move", "cut", "page"]);

// ---------------------------------------------------------------------------
// args

let verb = null;
const args = {};
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      if (verb == null) verb = a;
      continue;
    }
    const next = argv[i + 1];
    args[a.slice(2)] = next == null || next.startsWith("--") ? true : argv[++i];
  }
}

function fail(msg) {
  console.error(`land.mjs: ${msg}`);
  process.exit(1);
}

function emit(obj) {
  for (const w of obj.warnings ?? []) console.error(`warning: ${w}`);
  if (obj.warning) console.error(`warning: ${obj.warning}`);
  process.stdout.write(JSON.stringify(obj) + "\n");
  process.exit(0);
}

if (!verb || !VERBS.has(verb)) {
  fail(`usage: land.mjs <${[...VERBS].join("|")}> --ws <workspace> ... (see the header of this file for flags)`);
}

// ---------------------------------------------------------------------------
// markup input (land / check)

async function readMarkupInput() {
  let markup = null;
  if (args.file && args.file !== true) {
    try { markup = fs.readFileSync(String(args.file), "utf8"); }
    catch { fail(`cannot read --file ${args.file}`); }
  } else if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    markup = Buffer.concat(chunks).toString("utf8");
  }
  if (markup == null || !markup.trim()) fail("no take markup: pipe it on stdin or pass --file <path>");
  if (markup.length > 8_000_000) fail("take markup is over 8MB");
  return markup;
}

// ---------------------------------------------------------------------------
// check: dry-run validation, no workspace mutation, works without a server

if (verb === "check") {
  const markup = await readMarkupInput();
  const slug = args.slug && args.slug !== true ? String(args.slug) : "take";
  const assetsDir = args.ws && args.ws !== true ? wsPaths(String(args.ws)).ASSETS : null;
  const warnings = validateTake(normalizeTake(markup, slug), assetsDir);
  emit({ ok: true, verb: "check", warnings });
}

// ---------------------------------------------------------------------------
// workspace + transport

if (!args.ws || args.ws === true) fail("--ws <workspace> is required");
const P = wsPaths(String(args.ws));
if (!fs.existsSync(P.MANIFEST)) fail(`no workspace at ${P.WS}; run start.mjs first`);
fs.mkdirSync(P.STATE_DIR, { recursive: true }); // the lock and journal live here

function getStateHttp(port, timeoutMs = 900) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/api/state", timeout: timeoutMs }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => { try { resolve(JSON.parse(buf)); } catch { resolve(null); } });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

function postJson(port, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      { host: "127.0.0.1", port, path: pathname, method: "POST", timeout: 5000, headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          let json = null;
          try { json = JSON.parse(buf); } catch { /* below */ }
          if (json == null) return reject(new Error(`server answered ${res.statusCode} with no JSON`));
          resolve(json);
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("server timed out")); });
    req.end(payload);
  });
}

async function resolveTransport() {
  const sj = readJsonSafe(P.SERVER_JSON).json;
  if (!sj?.port) return { mode: "fs" };
  const st = await getStateHttp(sj.port);
  if (st?.ok && path.resolve(st.ws) === P.WS) return { mode: "server", port: sj.port };
  return { mode: "fs" }; // stale or foreign server.json; start.mjs owns its cleanup
}

// ---------------------------------------------------------------------------
// verb body (validated up front so both transports see the same shape)

function resolveTakeFlag(m, pageId, slug) {
  const pg = m.pages.find((p) => p.id === pageId);
  if (!pg) return { error: `no page "${pageId}" (have: ${m.pages.map((p) => p.id).join(", ") || "none"})` };
  const sec = pg.sections.find((s) => s.slug === slug);
  if (!sec) return { error: `no section "${slug}" on ${pg.id} (have: ${pg.sections.map((s) => s.slug).join(", ") || "none"})` };
  const t = String(args.take);
  if (t === "last") {
    let best = null, bestN = -1;
    for (const f of sec.takes) {
      const n = Number(f.match(/take-(\d+)\.html/)?.[1] ?? -1);
      if (n > bestN) { bestN = n; best = f; }
    }
    return best ? { file: best } : { error: `no takes in ${slug}'s pager` };
  }
  const file = /^\d+$/.test(t) ? `take-${t}.html` : t;
  if (!sec.takes.includes(file)) return { error: `"${file}" is not in ${slug}'s pager (have: ${sec.takes.join(", ")})` };
  return { file };
}

async function buildVerbBody() {
  const m = loadManifest(P); // read-only; used for defaults and --take resolution
  const pageId = args.page && args.page !== true ? String(args.page) : m.pages[0]?.id;
  const slug = args.slug && args.slug !== true ? String(args.slug) : null;

  if (verb === "land") {
    if (!slug) fail("--slug is required for land");
    const markup = await readMarkupInput();
    return {
      verb, page: pageId, slug, markup,
      create: args.create ? { position: args.position && args.position !== true ? String(args.position) : "end" } : null,
      activate: !!args.activate,
      label: args.label && args.label !== true ? String(args.label) : null,
    };
  }
  if (verb === "pick" || verb === "discard") {
    if (!slug) fail(`--slug is required for ${verb}`);
    if (!args.take || args.take === true) fail(`--take <N|take-N.html|last> is required for ${verb}`);
    const r = resolveTakeFlag(m, pageId, slug);
    if (r.error) fail(r.error);
    return { verb, page: pageId, slug, file: r.file };
  }
  if (verb === "move") {
    if (!slug) fail("--slug is required for move");
    const to = args.to && args.to !== true ? String(args.to) : null;
    if (!to) fail("--to up|down|start|end|after:<slug>|before:<slug> is required for move");
    return to === "up" || to === "down" ? { verb, page: pageId, slug, dir: to } : { verb, page: pageId, slug, to };
  }
  if (verb === "cut") {
    if (!slug) fail("--slug is required for cut");
    return { verb, page: pageId, slug };
  }
  if (verb === "page") {
    if (!args.id || args.id === true || !String(args.id).trim()) fail("--id is required for page");
    return {
      verb, id: String(args.id),
      title: args.title && args.title !== true ? String(args.title) : undefined,
      route: args.route && args.route !== true ? String(args.route) : undefined,
    };
  }
  fail(`unhandled verb "${verb}"`);
}

// ---------------------------------------------------------------------------
// fs fallback: mkdir lock, shared core logic, journal as actor "agent"

let holdingLock = false;

function acquireLock() {
  const deadline = Date.now() + 12000; // > the 10s staleness so a crashed holder unblocks within one cycle
  for (;;) {
    try {
      fs.mkdirSync(P.LOCK);
      holdingLock = true;
      try { fs.writeFileSync(path.join(P.LOCK, "owner.json"), JSON.stringify({ pid: process.pid, ts: Date.now() })); } catch { /* cosmetic */ }
      return;
    } catch (e) {
      if (e.code !== "EEXIST") fail(`cannot take the workspace lock: ${e.message}`);
      const age = Date.now() - (fs.statSync(P.LOCK, { throwIfNoEntry: false })?.mtimeMs ?? Date.now());
      if (age > 10000) {
        try { fs.rmSync(P.LOCK, { recursive: true, force: true }); } catch { /* the other recoverer won */ }
        continue;
      }
      if (Date.now() > deadline) fail("workspace is locked (state/manifest.lock); another land in progress? remove it if stale");
      const wait = 25 + Math.floor(Math.random() * 25);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait); // sync sleep, keeps the critical path await-free
    }
  }
}

function releaseLock() {
  if (!holdingLock) return;
  holdingLock = false;
  try { fs.rmSync(P.LOCK, { recursive: true, force: true }); } catch { /* already gone */ }
}

process.on("SIGINT", () => { releaseLock(); process.exit(130); });
process.on("SIGTERM", () => { releaseLock(); process.exit(143); });

function readTailSeq() {
  const raw = readSafe(P.JOURNAL);
  if (!raw) return 0;
  const lines = raw.trim().split("\n");
  for (let i = lines.length - 1; i >= 0 && i >= lines.length - 5; i--) {
    try { return JSON.parse(lines[i]).seq ?? 0; } catch { /* torn tail line */ }
  }
  return 0;
}

function appendJournalFs(op, label, manifest) {
  const entry = { seq: readTailSeq() + 1, ts: new Date().toISOString(), actor: "agent", op, label, reqId: null, manifest };
  try { fs.appendFileSync(P.JOURNAL, JSON.stringify(entry) + "\n"); } catch { /* journal is best-effort in fs mode */ }
}

function commitFs(m, op, label) {
  m.rev = (m.rev ?? 0) + 1;
  atomicWrite(P.MANIFEST, JSON.stringify(m, null, 2) + "\n");
  appendJournalFs(op, label, m);
}

function fsDispatch(body) {
  // A raw v1 workspace migrates first, exactly like the server at boot.
  if (migrateWorkspaceV2(P)) appendJournalFs("migrate", "migrated the workspace to multi-page (v2)", loadManifest(P));
  const m = loadManifest(P);

  if (body.verb === "land") {
    const slug = body.slug;
    if (!slug || slug !== normalizeSlug(slug)) return { error: `bad slug "${slug}"${slug ? ` (try "${normalizeSlug(slug)}")` : ""}` };
    const pageId = body.page ?? m.pages[0]?.id;
    if (!pageId) return { error: "no pages in the manifest yet" };
    const before = JSON.stringify(m);
    const { dir, n } = nextTakeNumber(P.SECTIONS, pageId, slug);
    const file = `take-${n}.html`;
    const normalized = normalizeTake(body.markup, slug);
    fs.writeFileSync(path.join(dir, file), normalized + "\n"); // file first, manifest second
    const reg = registerTake(m, pageId, slug, file, { create: body.create, activate: body.activate });
    if (reg.error) return reg;
    const label = body.label ? String(body.label).slice(0, 140).replace(/\n/g, " ") : manifestDiffLabel(JSON.parse(before), m);
    commitFs(m, "landed", label);
    return {
      ok: true, page: pageId, slug, file, take: n, index: reg.index,
      active: reg.section.active === reg.index, rev: m.rev,
      warnings: validateTake(normalized, P.ASSETS), warning: reg.warning ?? null, label,
    };
  }
  if (body.verb === "pick" || body.verb === "discard") {
    const pg = m.pages.find((p) => p.id === (body.page ?? m.pages[0]?.id));
    const sec = pg?.sections.find((s) => s.slug === body.slug);
    const idx = sec ? sec.takes.indexOf(body.file) : -1;
    if (idx === -1) return { error: `"${body.file}" is not in ${body.slug}'s pager (have: ${sec?.takes.join(", ") ?? "nothing"})` };
    const out = applyManifestOp(m, { op: body.verb, page: body.page, slug: body.slug, take: idx });
    if (out.error) return out;
    commitFs(m, body.verb, out.label);
    return { ok: true, rev: m.rev, label: out.label, warning: out.warning ?? null };
  }
  if (body.verb === "move" || body.verb === "cut") {
    const out = applyManifestOp(m, { op: body.verb, page: body.page, slug: body.slug, dir: body.dir, to: body.to });
    if (out.error) return out;
    commitFs(m, body.verb, out.label);
    return { ok: true, rev: m.rev, label: out.label, warning: out.warning ?? null };
  }
  if (body.verb === "page") {
    const id = normalizeSlug(body.id);
    if (m.pages.some((p) => p.id === id)) return { ok: true, existed: true, id };
    const before = JSON.stringify(m);
    m.pages.push({ id, title: body.title ?? id, route: /\.html$/.test(body.route ?? "") ? body.route : `${id}.html`, sections: [] });
    commitFs(m, "page", manifestDiffLabel(JSON.parse(before), m));
    return { ok: true, id, rev: m.rev };
  }
  return { error: `unknown verb "${body.verb}"` };
}

// ---------------------------------------------------------------------------
// main

const body = await buildVerbBody();
const transport = await resolveTransport();

if (transport.mode === "server") {
  let out;
  try { out = await postJson(transport.port, "/api/agent", body); }
  catch (e) { fail(`studio server errored (${e.message}); not retrying on disk to avoid a double apply`); }
  if (out.error) fail(out.error);
  emit({ ...out, mode: "server", verb });
} else {
  acquireLock();
  let out;
  try {
    // The server may have booted while we waited: serve.mjs publishes
    // server.json before its first manifest write, so re-check and route
    // over HTTP instead of racing it on disk.
    const again = await resolveTransport();
    if (again.mode === "server") {
      releaseLock();
      let viaSrv;
      try { viaSrv = await postJson(again.port, "/api/agent", body); }
      catch (e) { fail(`studio server errored (${e.message}); not retrying on disk to avoid a double apply`); }
      if (viaSrv.error) fail(viaSrv.error);
      emit({ ...viaSrv, mode: "server", verb });
    }
    out = fsDispatch(body);
  } finally {
    releaseLock();
  }
  if (out.error) fail(out.error);
  emit({ ...out, mode: "fs", verb });
}
