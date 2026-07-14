#!/usr/bin/env node
// The agent's side of the variate bridge. Blocks until the user asks for
// something in the studio, prints EXACTLY ONE JSON line to stdout, exits.
//
//   node await.mjs --ws <workspace> [--ack <id> [--result ok|skipped|failed] [--note "..."]] [--timeout 90]
//
// Exit codes: 0 = a request was delivered (fulfill it, then re-run with --ack)
//             2 = idle timeout, nothing queued (just re-run)
//             1 = hard error (message on stderr)
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
    if (argv[i].startsWith("--")) args[argv[i].slice(2)] = argv[i + 1]?.startsWith("--") ? true : argv[++i];
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

// ---- 2. redeliver an orphaned claim first ----------------------------------
function redeliver() {
  const w = listWorking()[0];
  if (!w) return false;
  const json = readJson(path.join(REQ, w));
  if (!json) return false;
  json.redelivered = true;
  out(json, 0);
  return true;
}

// ---- 3. claim the oldest queued request ------------------------------------
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

if (redeliver()) { /* exiting via out() */ }
else if (claim()) { /* exiting via out() */ }
else {
  // ---- 4. block: watch + poll safety net + heartbeat -----------------------
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
