#!/usr/bin/env node
// variate studio server. Zero dependencies, binds 127.0.0.1 only, one file.
//
// It renders a workspace (site/head.html + site/sections/<slug>/take-N.html +
// site/manifest.json) as a stack of per-section sandboxed iframes, applies
// deterministic ops (move / cut / pick / undo / redo) directly, and turns
// generative asks (variate / instruct / add / sketch / polish / done) into
// queue files under requests/ that the agent consumes via await.mjs.
//
// Core invariant: take files are immutable; every mutation is a manifest
// mutation. Undo is a manifest restore from the append-only journal.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  sha8, nowIso, readSafe, atomicWrite, readJsonSafe, statMtime, wsPaths,
  buildFrameDoc, assemblePage, normalizeTake, validateTake, FRAME_CSP,
} from "./core.mjs";

// ---------------------------------------------------------------------------
// args + paths

const args = parseArgs(process.argv.slice(2));
const P = wsPaths(args.ws ?? "./variate");
const { WS, SITE, SECTIONS, REQ, REQ_DONE, STATE_DIR, SKETCHES, DIST, MANIFEST, HEAD, JOURNAL, HEARTBEAT, SERVER_JSON, HISTORY } = P;
const PORT_WANTED = Number(args.port ?? 4177);
const FORCE_POLL = !!args.poll;

const UI_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "ui");

for (const d of [SITE, SECTIONS, REQ, REQ_DONE, STATE_DIR, SKETCHES, DIST]) fs.mkdirSync(d, { recursive: true });

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--poll") out.poll = true;
    else if (a.startsWith("--")) out[a.slice(2)] = argv[++i];
  }
  return out;
}

// ---------------------------------------------------------------------------
// manifest (tolerant: keep last good on parse failure)

let lastGoodManifest = null;
let manifestError = null;

function readManifest() {
  const { json, error } = readJsonSafe(MANIFEST);
  if (json && Array.isArray(json.sections)) {
    lastGoodManifest = json;
    manifestError = null;
    return json;
  }
  manifestError = error === "missing" ? null : `manifest.json unreadable (${error}); showing the last good state`;
  return lastGoodManifest ?? { version: 1, rev: 0, title: "", bodyAttrs: "", sections: [] };
}

function writeManifest(m) {
  m.rev = (m.rev ?? 0) + 1;
  const json = JSON.stringify(m, null, 2) + "\n";
  atomicWrite(MANIFEST, json);
  lastServerManifestJson = json.trim();
  lastGoodManifest = m;
  return m;
}

function takePath(slug, file) {
  const p = path.normalize(path.join(SECTIONS, slug, file));
  if (!p.startsWith(SECTIONS + path.sep)) throw new Error("path escape");
  return p;
}

// ---------------------------------------------------------------------------
// journal + undo/redo (manifest snapshots)

let journalSeq = 0;
let undoStack = [];  // manifests (JSON strings) BEFORE each change
let redoStack = [];
let lastServerManifestJson = null; // set when THIS server writes; watcher skips journaling those
let lastObservedManifestJson = null;

function appendJournal(actor, op, label, manifest, reqId = null) {
  journalSeq++;
  const entry = { seq: journalSeq, ts: nowIso(), actor, op, label, reqId, manifest };
  fs.appendFileSync(JOURNAL, JSON.stringify(entry) + "\n");
  return entry;
}

function loadJournalTail(n = 200) {
  const raw = readSafe(JOURNAL);
  if (!raw) return [];
  const lines = raw.trim().split("\n").slice(-n);
  const out = [];
  for (const l of lines) { try { out.push(JSON.parse(l)); } catch { /* skip torn line */ } }
  return out;
}

// The undo/redo stacks are persisted verbatim (state/history.json), not
// reconstructed from the journal: replaying past undo/redo entries as history
// would make a post-restart undo walk back through the dance instead of
// continuing the logical timeline. The journal stays the activity feed.
function saveHistory() {
  try { atomicWrite(HISTORY, JSON.stringify({ undo: undoStack.slice(-60), redo: redoStack.slice(-60) })); } catch { /* ignore */ }
}

function bootHistory() {
  const tail = loadJournalTail(1);
  journalSeq = tail.length ? tail[tail.length - 1].seq : 0;
  const { json } = readJsonSafe(HISTORY);
  undoStack = Array.isArray(json?.undo) ? json.undo : [];
  redoStack = Array.isArray(json?.redo) ? json.redo : [];
}

// ---------------------------------------------------------------------------
// queue

let reqSeq = 0;

function bootSeq() {
  const all = [...listDir(REQ), ...listDir(REQ_DONE)];
  for (const f of all) {
    const m = f.match(/^(\d+)-/);
    if (m) reqSeq = Math.max(reqSeq, parseInt(m[1], 10));
  }
}

function listDir(dir) {
  try { return fs.readdirSync(dir).filter((f) => f.endsWith(".json") || f.endsWith(".json.working")); } catch { return []; }
}

const REQUEST_TYPES = new Set(["variate", "instruct", "add", "sketch", "polish", "done"]);

function labelFor(type, slug, params = {}) {
  if (type === "variate") return `${params.count > 1 ? params.count + " takes" : "a new take"} of ${slug}${params.steer ? ", " + params.steer : ""}`;
  if (type === "instruct") return `edit ${slug}`;
  if (type === "add") return `add ${params.kind ?? "a section"} ${params.position ?? ""}`.trim();
  if (type === "sketch") return `redraw ${slug} from a sketch`;
  if (type === "polish") return "polish the seams";
  if (type === "done") return "finish and export";
  return type;
}

function createRequest(type, target, params) {
  reqSeq++;
  const id = String(reqSeq).padStart(4, "0");
  const manifest = readManifest();
  const req = {
    v: 1,
    id,
    type,
    createdAt: nowIso(),
    target: target?.slug ? { slug: target.slug } : null,
    params: params ?? {},
    snapshot: { rev: manifest.rev ?? 0, outline: manifest.sections.map((s) => s.slug) },
  };
  const slugPart = target?.slug ? `-${target.slug}` : "";
  atomicWrite(path.join(REQ, `${id}-${type}${slugPart}.json`), JSON.stringify(req, null, 2) + "\n");
  appendJournal("user", "request", labelFor(type, target?.slug, params), null, id);
  return req;
}

function queueSnapshot() {
  const items = [];
  for (const f of listDir(REQ).sort()) {
    const working = f.endsWith(".working");
    const { json } = readJsonSafe(path.join(REQ, f));
    if (!json) continue;
    items.push({
      id: json.id,
      type: json.type,
      slug: json.target?.slug ?? null,
      label: labelFor(json.type, json.target?.slug, json.params),
      status: working ? "working" : "queued",
      createdAt: json.createdAt,
      claimedAt: working ? statMtime(path.join(REQ, f)) : null,
    });
  }
  return items;
}

function recentDone(n = 6) {
  const files = listDir(REQ_DONE).sort().slice(-n);
  const out = [];
  for (const f of files) {
    const { json } = readJsonSafe(path.join(REQ_DONE, f));
    if (json) out.push({ id: json.id, type: json.type, slug: json.target?.slug ?? null, result: json.result ?? "ok", note: json.note ?? "", ackedAt: json.ackedAt ?? null });
  }
  return out.reverse();
}

// ---------------------------------------------------------------------------
// state

const START_TOKEN = Date.now();

function computeState() {
  const manifest = readManifest();
  const head = readSafe(HEAD) ?? "";
  const headHash = sha8(head);
  const queue = queueSnapshot();
  const working = queue.filter((q) => q.status === "working");
  const polishBusy = working.find((w) => w.type === "polish" || w.type === "done");

  const sections = manifest.sections.map((s) => {
    const activeFile = s.takes[s.active] ?? s.takes[0];
    const markup = activeFile ? readSafe(takePath(s.slug, activeFile)) ?? "" : "";
    const busyReq = polishBusy ?? working.find((w) => w.slug === s.slug);
    const warnings = markup ? validateTake(markup) : [];
    return {
      slug: s.slug,
      takes: s.takes.length,
      active: s.active,
      hash: sha8(headHash + (markup ?? "")),
      busy: busyReq ? { reqId: busyReq.id, type: busyReq.type, label: busyReq.label, claimedAt: busyReq.claimedAt } : null,
      warning: warnings.length ? warnings.join("; ") : null,
    };
  });

  const hb = statMtime(HEARTBEAT);
  return {
    ok: true,
    ws: WS,
    startedAt: START_TOKEN,
    rev: manifest.rev ?? 0,
    title: manifest.title ?? "",
    headHash,
    sections,
    queue: queue.filter((q) => q.status === "queued"),
    working,
    recentDone: recentDone(),
    activity: loadJournalTail(50).map(({ manifest: _m, ...rest }) => rest).reverse(),
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    agent: { listening: hb != null && Date.now() - hb < 15000, lastSeen: hb },
    manifestError,
    empty: manifest.sections.length === 0,
  };
}

// ---------------------------------------------------------------------------
// deterministic ops

function applyOp(body) {
  const { op } = body;
  const m = readManifest();
  const before = JSON.stringify(m);

  if (op === "undo" || op === "redo") {
    const from = op === "undo" ? undoStack : redoStack;
    const to = op === "undo" ? redoStack : undoStack;
    const snap = from.pop();
    if (!snap) return { error: `nothing to ${op}` };
    to.push(before);
    const restored = JSON.parse(snap);
    restored.rev = m.rev; // writeManifest bumps
    writeManifest(restored);
    saveHistory();
    appendJournal("server", op, op === "undo" ? "undid the last change" : "redid the change", restored);
    return { ok: true };
  }

  const i = m.sections.findIndex((s) => s.slug === body.slug);
  if (i === -1) return { error: `no section "${body.slug}"` };

  if (op === "move") {
    const dir = body.dir === "up" ? -1 : 1;
    const j = i + dir;
    if (j < 0 || j >= m.sections.length) return { error: "already at the edge" };
    [m.sections[i], m.sections[j]] = [m.sections[j], m.sections[i]];
    commitOp(before, m, "move", `${body.slug} moved ${body.dir}`);
    return { ok: true };
  }
  if (op === "cut") {
    m.sections.splice(i, 1);
    commitOp(before, m, "cut", `removed ${body.slug}`);
    return { ok: true };
  }
  if (op === "pick") {
    const take = Number(body.take);
    if (!(take >= 0 && take < m.sections[i].takes.length)) return { error: "no such take" };
    m.sections[i].active = take;
    commitOp(before, m, "pick", `${body.slug} showing take ${take + 1}`);
    return { ok: true };
  }
  return { error: `unknown op "${op}"` };
}

function commitOp(beforeJson, manifest, op, label) {
  undoStack.push(beforeJson);
  if (undoStack.length > 60) undoStack.shift();
  redoStack = [];
  writeManifest(manifest);
  saveHistory();
  appendJournal("server", op, label, manifest);
}

// ---------------------------------------------------------------------------
// export

function writeExport() {
  const m = readManifest();
  const head = readSafe(HEAD) ?? "";
  const markups = m.sections
    .map((s) => {
      const f = s.takes[s.active] ?? s.takes[0];
      return f ? normalizeTake(readSafe(takePath(s.slug, f)) ?? "", s.slug) : "";
    })
    .filter(Boolean);
  const html = assemblePage(head, m.bodyAttrs ?? "", markups);
  atomicWrite(path.join(DIST, "index.html"), html);
  appendJournal("server", "export", "assembled dist/index.html", null);
  return path.join(DIST, "index.html");
}

// ---------------------------------------------------------------------------
// live edits (deterministic, no agent turn)

/** Overwrite existing :root token values in head.html. Only known tokens are
 *  touched; a value change makes the whole page reflow on the next reload. */
function patchHeadTokens(tokens) {
  let head = readSafe(HEAD);
  if (head == null) return { error: "no head.html" };
  const root = head.match(/:root\s*\{([\s\S]*?)\}/);
  if (!root) return { error: "no :root block in head.html" };
  let block = root[1];
  let changed = 0;
  for (const [name, value] of Object.entries(tokens)) {
    if (!/^--[\w-]+$/.test(name)) continue;
    const v = String(value).slice(0, 200).replace(/[;{}]/g, "");
    const re = new RegExp(`(${name}\\s*:\\s*)([^;]*)(;)`);
    if (re.test(block)) { block = block.replace(re, `$1${v}$3`); changed++; }
  }
  if (!changed) return { ok: true, changed: 0 };
  head = head.replace(root[1], block);
  atomicWrite(HEAD, head);
  appendJournal("server", "tokens", `restyled ${changed} design token${changed === 1 ? "" : "s"}`, null);
  return { ok: true, changed };
}

/** Commit inline-edited section markup as a new immutable take. */
function writeTextTake(slug, markup) {
  const m = readManifest();
  const sec = m.sections.find((s) => s.slug === slug);
  if (!sec) return { error: `no section "${slug}"` };
  const dir = path.join(SECTIONS, slug);
  fs.mkdirSync(dir, { recursive: true });
  const ns = fs.readdirSync(dir).map((f) => Number(f.match(/take-(\d+)\.html/)?.[1] ?? 0));
  const n = Math.max(0, ...ns) + 1;
  const file = `take-${n}.html`;
  fs.writeFileSync(path.join(dir, file), normalizeTake(markup, slug) + "\n");
  const before = JSON.stringify(m);
  sec.takes.push(file);
  sec.active = sec.takes.length - 1;
  commitOp(before, m, "text", `edited text in ${slug}`);
  return { ok: true, take: n };
}

// ---------------------------------------------------------------------------
// SSE hub + watcher

const clients = new Set();

function broadcast() {
  const state = computeState();
  detectAgentLanding(state);
  const frame = `event: state\ndata: ${JSON.stringify(state)}\n\n`;
  for (const res of clients) { try { res.write(frame); } catch { clients.delete(res); } }
  return state;
}

/** Journal agent-side manifest changes (this server did not write them). */
function detectAgentLanding() {
  const raw = readSafe(MANIFEST)?.trim() ?? null;
  if (raw == null) return;
  if (lastObservedManifestJson === null) { lastObservedManifestJson = raw; return; }
  if (raw === lastObservedManifestJson) return;
  const cameFromServer = raw === lastServerManifestJson;
  const prev = lastObservedManifestJson;
  lastObservedManifestJson = raw;
  if (cameFromServer) return;
  try {
    const m = JSON.parse(raw);
    undoStack.push(prev);
    if (undoStack.length > 60) undoStack.shift();
    redoStack = [];
    saveHistory();
    appendJournal("agent", "landed", "the agent landed new work", m);
  } catch { /* torn write; next tick settles it */ }
}

let debounceTimer = null;
function poke() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(broadcast, 120);
}

function startWatcher() {
  const canRecursive = process.platform === "darwin" || process.platform === "win32";
  if (!FORCE_POLL && canRecursive) {
    try {
      fs.watch(WS, { recursive: true }, (_ev, file) => {
        const f = String(file ?? "");
        if (f.startsWith("state" + path.sep) && !f.endsWith("agent.heartbeat")) return;
        if (f.startsWith("dist" + path.sep)) return;
        poke();
      });
      return;
    } catch { /* fall through to poll */ }
  }
  setInterval(poke, 800);
}

// ---------------------------------------------------------------------------
// http

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };

function send(res, code, body, headers = {}) {
  res.writeHead(code, { "Cache-Control": "no-store", ...headers });
  res.end(body);
}

function sendJson(res, code, obj) {
  send(res, code, JSON.stringify(obj), { "Content-Type": "application/json" });
}

async function readBody(req) {
  let buf = "";
  for await (const chunk of req) {
    buf += chunk;
    if (buf.length > 8_000_000) throw new Error("body too large");
  }
  return buf ? JSON.parse(buf) : {};
}

const server = http.createServer(async (req, res) => {
  const host = (req.headers.host ?? "").split(":")[0];
  if (host !== "127.0.0.1" && host !== "localhost") return send(res, 403, "local only");
  const url = new URL(req.url, "http://127.0.0.1");
  const p = url.pathname;

  try {
    if (req.method === "GET") {
      if (p === "/" ) {
        return send(res, 200, readSafe(path.join(UI_DIR, "index.html")) ?? "ui missing", { "Content-Type": MIME[".html"] });
      }
      if (p.startsWith("/ui/")) {
        const f = path.normalize(path.join(UI_DIR, p.slice(4)));
        if (!f.startsWith(UI_DIR)) return send(res, 403, "no");
        const body = readSafe(f);
        if (body == null) return send(res, 404, "not found");
        return send(res, 200, body, { "Content-Type": MIME[path.extname(f)] ?? "text/plain" });
      }
      if (p === "/api/state") return sendJson(res, 200, computeState());
      if (p === "/api/head") return sendJson(res, 200, { head: readSafe(HEAD) ?? "" });
      if (p === "/events") {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
        res.write("retry: 1000\n\n");
        clients.add(res);
        res.write(`event: state\ndata: ${JSON.stringify(computeState())}\n\n`);
        req.on("close", () => clients.delete(res));
        return;
      }
      if (p.startsWith("/frame/")) {
        const slug = decodeURIComponent(p.slice(7));
        const m = readManifest();
        const s = m.sections.find((x) => x.slug === slug);
        if (!s) return send(res, 404, "no such section");
        const f = s.takes[s.active] ?? s.takes[0];
        const markup = f ? readSafe(takePath(slug, f)) ?? "" : "";
        const doc = buildFrameDoc(readSafe(HEAD) ?? "", m.bodyAttrs ?? "", markup, slug);
        return send(res, 200, doc, { "Content-Type": MIME[".html"], "Content-Security-Policy": FRAME_CSP });
      }
      if (p === "/page") {
        const m = readManifest();
        const head = readSafe(HEAD) ?? "";
        const markups = m.sections.map((s) => {
          const f = s.takes[s.active] ?? s.takes[0];
          return f ? normalizeTake(readSafe(takePath(s.slug, f)) ?? "", s.slug) : "";
        }).filter(Boolean);
        return send(res, 200, assemblePage(head, m.bodyAttrs ?? "", markups), { "Content-Type": MIME[".html"], "Content-Security-Policy": FRAME_CSP });
      }
      if (p.startsWith("/sketches/")) {
        const f = path.normalize(path.join(SKETCHES, p.slice(10)));
        if (!f.startsWith(SKETCHES)) return send(res, 403, "no");
        const body = fs.existsSync(f) ? fs.readFileSync(f) : null;
        if (!body) return send(res, 404, "not found");
        return send(res, 200, body, { "Content-Type": MIME[".png"] });
      }
      return send(res, 404, "not found");
    }

    if (req.method === "POST") {
      const body = await readBody(req);

      if (p === "/api/request") {
        const requeueId = url.searchParams.get("requeue");
        if (requeueId) {
          const stale = listDir(REQ).find((f) => f.startsWith(requeueId + "-") && f.endsWith(".working"));
          if (!stale) return sendJson(res, 404, { error: "no stale request with that id" });
          const { json } = readJsonSafe(path.join(REQ, stale));
          const clone = createRequest(json.type, json.target, json.params);
          const doneName = stale.replace(/\.working$/, "");
          json.ackedAt = nowIso(); json.result = "failed"; json.note = `requeued as ${clone.id}`;
          atomicWrite(path.join(REQ_DONE, doneName), JSON.stringify(json, null, 2) + "\n");
          fs.rmSync(path.join(REQ, stale), { force: true });
          broadcast();
          return sendJson(res, 200, { id: clone.id });
        }
        const { type, target, params, pngBase64 } = body;
        if (!REQUEST_TYPES.has(type)) return sendJson(res, 400, { error: "unknown request type" });
        const request = createRequest(type, target, { ...(params ?? {}) });
        // The sketch PNG is named after the allocated id, so it lands after
        // createRequest and the request file is rewritten with the path.
        if (pngBase64 && target?.slug) {
          const pngName = `${target.slug}-${request.id}.png`;
          fs.writeFileSync(path.join(SKETCHES, pngName), Buffer.from(pngBase64, "base64"));
          request.params.png = `sketches/${pngName}`;
          const slugPart = `-${target.slug}`;
          atomicWrite(path.join(REQ, `${request.id}-${type}${slugPart}.json`), JSON.stringify(request, null, 2) + "\n");
        }
        if (type === "done") writeExport();
        broadcast();
        return sendJson(res, 200, { id: request.id });
      }

      if (p === "/api/op") {
        const out = applyOp(body);
        broadcast();
        return sendJson(res, out.error ? 400 : 200, out);
      }

      if (p === "/api/export") {
        const file = writeExport();
        broadcast();
        return sendJson(res, 200, { path: file });
      }
      if (p === "/api/head") {
        const out = patchHeadTokens(body?.tokens ?? {});
        broadcast();
        return sendJson(res, out.error ? 400 : 200, out);
      }
      if (p === "/api/text") {
        if (!body?.slug || typeof body?.markup !== "string") return sendJson(res, 400, { error: "slug and markup required" });
        const out = writeTextTake(body.slug, body.markup);
        broadcast();
        return sendJson(res, out.error ? 400 : 200, out);
      }
      return send(res, 404, "not found");
    }

    return send(res, 405, "method not allowed");
  } catch (e) {
    return sendJson(res, 500, { error: String(e?.message ?? e) });
  }
});

// ---------------------------------------------------------------------------
// boot

function listen(port, attemptsLeft) {
  server.once("error", (e) => {
    if (e.code === "EADDRINUSE" && attemptsLeft > 0) listen(port + 1, attemptsLeft - 1);
    else { console.error("listen failed:", e.message); process.exit(1); }
  });
  server.listen(port, "127.0.0.1", () => {
    atomicWrite(SERVER_JSON, JSON.stringify({ pid: process.pid, port, startedAt: START_TOKEN, ws: WS }, null, 2));
    lastObservedManifestJson = readSafe(MANIFEST)?.trim() ?? null;
    bootSeq();
    bootHistory();
    startWatcher();
    setInterval(() => {
      for (const res of clients) { try { res.write("event: ping\ndata: {}\n\n"); } catch { clients.delete(res); } }
    }, 25000);
    console.log(`variate studio on http://127.0.0.1:${port}  ws=${WS}`);
  });
}

listen(PORT_WANTED, 9);
