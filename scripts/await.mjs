#!/usr/bin/env node
// The agent's side of the variate bridge. Two modes:
//
//   node await.mjs --ws <ws> --drain [--ack <id> ...]
//     Terminal mode (default workflow): claims EVERY queued studio request
//     right now, prints them as ONE JSON array line, exits immediately.
//     Exit 0 = array has requests; exit 2 = nothing waiting. Run it between
//     conversational turns; never blocks the conversation.
//
//   node await.mjs --ws <ws> [--ack <id> ...] [--timeout 90]
//     Studio mode: blocks until the user acts in the studio, prints EXACTLY
//     ONE request as a JSON line, exits. Exit 0 = delivered; exit 2 = idle
//     timeout (just re-run); exit 1 = hard error (stderr).
//
// Ack in either mode: --ack <id> [--result ok|skipped|failed] [--note "..."]
// folds the previous fulfillment's ack into this invocation.
//
// Filesystem only, no network: requests/NNNN-*.json is queued, renaming it to
// .working claims it (atomic, so concurrent awaits race safely), moving it to
// requests/done/ with ack fields closes it. An orphaned .working (crashed
// agent) is re-delivered with "redelivered": true before anything new.

import fs from "node:fs";
import path from "node:path";

const args = {};
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const next = argv[i + 1];
    // A flag with no value (end of argv, or another flag next) is boolean true.
    args[argv[i].slice(2)] = next == null || next.startsWith("--") ? true : argv[++i];
  }
}

if (!args.ws) { console.error("await.mjs: --ws <workspace> is required"); process.exit(1); }
const WS = path.resolve(String(args.ws));
const REQ = path.join(WS, "requests");
const DONE = path.join(REQ, "done");
const HEARTBEAT = path.join(WS, "state", "agent.heartbeat");
const TIMEOUT_MS = Math.max(2, Number(args.timeout ?? 90)) * 1000;

if (!fs.existsSync(REQ)) { console.error(`await.mjs: no requests/ under ${WS}. Run start.mjs first.`); process.exit(1); }
fs.mkdirSync(DONE, { recursive: true });
fs.mkdirSync(path.dirname(HEARTBEAT), { recursive: true });

function out(obj, code) {
  process.stdout.write(JSON.stringify(obj) + "\n", () => process.exit(code));
}

function beat() {
  try { fs.writeFileSync(HEARTBEAT, String(Date.now())); } catch { /* ignore */ }
}

function listQueued() {
  try { return fs.readdirSync(REQ).filter((f) => f.endsWith(".json")).sort(); } catch { return []; }
}
function listWorking() {
  try { return fs.readdirSync(REQ).filter((f) => f.endsWith(".json.working")).sort(); } catch { return []; }
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

// ---- 1. fold in the previous ack -------------------------------------------
if (args.ack) {
  const id = String(args.ack);
  const working = listWorking().find((f) => f.startsWith(id + "-"));
  if (working) {
    const p = path.join(REQ, working);
    const json = readJson(p) ?? { id };
    json.ackedAt = new Date().toISOString();
    json.result = ["ok", "skipped", "failed"].includes(args.result) ? args.result : "ok";
    if (args.note) json.note = String(args.note).slice(0, 300);
    const doneName = working.replace(/\.working$/, "");
    fs.writeFileSync(path.join(DONE, doneName), JSON.stringify(json, null, 2) + "\n");
    fs.rmSync(p, { force: true });
  } else {
    // Idempotent: an ack for something already closed is a warning, not an error.
    console.error(`await.mjs: nothing claimed under id ${id} (already acked?)`);
  }
}

// ---- 2. drain mode: claim everything queued, print an array, never block ----
if (args.drain) {
  beat();
  const batch = [];
  for (const w of listWorking()) {
    const j = readJson(path.join(REQ, w));
    if (j) { j.redelivered = true; batch.push(j); }
  }
  for (const f of listQueued()) {
    const from = path.join(REQ, f);
    const to = from + ".working";
    try { fs.renameSync(from, to); } catch { continue; }
    const j = readJson(to);
    if (j) batch.push(j);
  }
  out(batch, batch.length ? 0 : 2);
} else {
  mainBlocking();
}

function mainBlocking() {
  if (redeliver()) return;
  if (claim()) return;
  blockUntilRequest();
}

// ---- 3. redeliver an orphaned claim first ----------------------------------
function redeliver() {
  const w = listWorking()[0];
  if (!w) return false;
  const json = readJson(path.join(REQ, w));
  if (!json) return false;
  json.redelivered = true;
  out(json, 0);
  return true;
}

// ---- 4. claim the oldest queued request ------------------------------------
function claim() {
  for (const f of listQueued()) {
    const from = path.join(REQ, f);
    const to = from + ".working";
    try {
      fs.renameSync(from, to); // atomic; the loser of a race gets ENOENT
    } catch { continue; }
    const json = readJson(to);
    if (!json) continue;
    out(json, 0);
    return true;
  }
  return false;
}

// ---- 5. block: watch + poll safety net + heartbeat --------------------------
function blockUntilRequest() {
  beat();
  const beatTimer = setInterval(beat, 5000);
  const deadline = Date.now() + TIMEOUT_MS;
  let watcher = null;
  try { watcher = fs.watch(REQ, () => attempt()); } catch { /* poll only */ }
  const pollTimer = setInterval(attempt, 2000);

  function attempt() {
    if (claim()) { cleanup(); return; }
    if (Date.now() >= deadline) {
      cleanup();
      out({ type: "idle", waitedMs: TIMEOUT_MS, queued: 0 }, 2);
    }
  }
  function cleanup() {
    clearInterval(beatTimer);
    clearInterval(pollTimer);
    try { watcher?.close(); } catch { /* ignore */ }
  }
}
