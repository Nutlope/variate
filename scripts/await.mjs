#!/usr/bin/env node
// The agent's side of the variate bridge. Four modes:
//
//   node await.mjs --ws <ws> --drain [--ack <id> ...]
//     Terminal mode: claims EVERY queued card ask right now, prints them as
//     ONE JSON array line, exits immediately. Always exits 0; an empty array
//     means nothing was waiting. Run it between conversational turns; never
//     blocks.
//
//   node await.mjs --ws <ws> [--ack <id> ...] [--timeout 20]
//     Listening mode: blocks until the user acts on the card, prints EXACTLY
//     ONE ask as a JSON line, exits. Exits 0 both when an ask is delivered
//     and on an idle timeout; the JSON says which, and the idle JSON says how
//     fresh the user's last flip is, so the caller can decide to keep
//     listening. Exit 1 = hard error (stderr).
//
//   node await.mjs --ws <ws> --peek [--hook]
//     Side-effect-free probe: counts queued and claimed-but-unfinished asks
//     WITHOUT claiming anything, writes no heartbeat. Always exits 0; the
//     counts are in the JSON. With --hook it speaks Claude Code Stop-hook JSON:
//     when asks are queued (and this stop is not itself a hook continuation)
//     it prints {"decision":"block","reason":...} so the agent drains them
//     before stopping; otherwise it exits 0 silently.
//
//   node await.mjs --ws <ws> --wake [--timeout 900]
//     The idle-wake watcher, run by an asyncRewake Stop hook. Takes a
//     single-instance lock, watches for a NEW queued ask without ever
//     claiming it, and when one lands prints one line to stderr and exits 2,
//     which wakes an idle Claude Code session. On timeout it exits 0
//     silently. Never run it by hand; the hook owns it.
//
// Ack in any claiming mode: --ack <id> [--result ok|skipped|failed]
// [--note "..."] folds the previous fulfillment's ack into this invocation.
//
// Filesystem only, no network: requests/NNNN-*.json is queued, renaming it to
// .working claims it (atomic, so concurrent awaits race safely), moving it to
// requests/done/ with ack fields closes it. An orphaned .working (crashed
// agent) is re-delivered with "redelivered": true before anything new.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

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
const LAST_SWITCH = path.join(WS, "state", "last-switch.json");
const WAKE_LOCK = path.join(WS, "state", "wake.lock");
const TIMEOUT_MS = Math.max(2, Number(args.timeout ?? (args.wake ? 900 : 90))) * 1000;

// What to tell an agent that has to act on the queue, wherever it wakes up.
const CLI = path.join(HERE, "..", "variate.mjs");
const ROOT = path.dirname(WS);
const DRAIN_HINT =
  `Run: node ${CLI} drain --root ${ROOT} then act on each ask ` +
  `(done: variate end <set>; more: extend that set with 2-3 tighter positions; ` +
  `vary: a new round) and ack each with --ack <id> --note "..."`;

function out(obj, code) {
  process.stdout.write(JSON.stringify(obj) + "\n", () => process.exit(code));
}

function beat() {
  // Never recreate a workspace that `variate end` removed: a heartbeat is a
  // claim about a live session, and writing one into a cleaned project is
  // litter in someone's repo.
  try {
    if (!fs.existsSync(path.dirname(HEARTBEAT))) return;
    fs.writeFileSync(HEARTBEAT, String(Date.now()));
  } catch { /* ignore */ }
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

function readSafeNum(p) {
  try { return fs.readFileSync(p, "utf8").trim(); } catch { return null; }
}

// Labels from filenames only (NNNN-type[-slug].json): torn-write-proof.
const labelOf = (f) => {
  const m = f.match(/^\d+-([a-z]+)(?:-(.+?))?\.json/);
  return m ? (m[2] ? `${m[1]} ${m[2]}` : m[1]) : f;
};

function lastSwitch() {
  const j = readJson(LAST_SWITCH);
  if (!j?.at) return { lastSwitchAt: null, lastSwitchAgoSec: null, lastSwitchSource: null };
  const ago = Math.round((Date.now() - Date.parse(j.at)) / 1000);
  return {
    lastSwitchAt: j.at,
    lastSwitchAgoSec: Number.isFinite(ago) ? ago : null,
    lastSwitchSource: j.source ?? null,
  };
}

// Hooks pipe their input JSON on stdin. Manual runs have a TTY (or nothing):
// never hang waiting for it, and treat anything unreadable as {}.
function readHookInput() {
  if (process.stdin.isTTY) return Promise.resolve({});
  return new Promise((resolve) => {
    let buf = "";
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try { resolve(buf ? JSON.parse(buf) : {}); } catch { resolve({}); }
    };
    const timer = setTimeout(finish, 300);
    process.stdin.on("data", (c) => (buf += c));
    process.stdin.on("end", () => { clearTimeout(timer); finish(); });
    process.stdin.on("error", () => { clearTimeout(timer); finish(); });
  });
}

// ---- peek: count without claiming, no side effects at all ------------------
async function peek() {
  const queued = listQueued();
  const working = listWorking();
  const labels = [...queued, ...working].map(labelOf).slice(0, 8);
  const n = queued.length + working.length;

  if (args.hook) {
    // Claude Code Stop-hook mode. Block the stop only for QUEUED asks (a
    // claimed one redelivers on the next drain; nagging about it risks a
    // loop), and never when this stop is itself a hook continuation.
    const input = await readHookInput();
    if (input.stop_hook_active === true) process.exit(0);
    if (!queued.length) process.exit(0);
    process.stdout.write(JSON.stringify({
      decision: "block",
      reason:
        `variate: ${queued.length} ask${queued.length === 1 ? "" : "s"} waiting from the card ` +
        `(${queued.map(labelOf).join(", ")}). ${DRAIN_HINT}. Then finish your reply.`,
    }) + "\n", () => process.exit(0));
    return new Promise(() => {});
  }

  // Exit 0 either way, like drain and await: "nothing is queued" is an
  // answer, not a failure, and a harness that paints non-zero red would make
  // a routine probe look like something broke. The counts are in the JSON.
  out({ queued: queued.length, working: working.length, labels, ...lastSwitch() }, 0);
  return new Promise(() => {});
}

// ---- wake: the asyncRewake watcher; never claims, exit 2 wakes the agent ---
async function wake() {
  // No stop_hook_active guard here, deliberately. That flag is the anti-loop
  // check for the BLOCKING sync hook; this watcher never blocks anything, and
  // the stop that ends a hook-forced continuation is exactly the stop after
  // which the user is most likely to click. Honouring the flag here would
  // leave that window uncovered. The lockfile and the timeout are what keep
  // watchers from piling up.

  // One watcher per workspace. The lock is a JSON {pid, startedAt, timeoutMs};
  // a lock whose pid is dead, or whose watcher must long since have timed out
  // by its OWN timeout, is stale and reclaimed. Everything here exits 0
  // silently: an asyncRewake hook only acts on exit 2.
  fs.mkdirSync(path.dirname(WAKE_LOCK), { recursive: true });
  const claimLock = () => {
    try {
      fs.writeFileSync(
        WAKE_LOCK,
        JSON.stringify({ pid: process.pid, startedAt: Date.now(), timeoutMs: TIMEOUT_MS }),
        { flag: "wx" },
      );
      return true;
    } catch { return false; }
  };
  if (!claimLock()) {
    const held = readJson(WAKE_LOCK);
    const alive = (() => { try { process.kill(Number(held?.pid), 0); return true; } catch { return false; } })();
    // Judge freshness by the holder's own timeout, never the newcomer's: a
    // short --timeout run must not evict a watcher that is still working.
    const fresh = held?.startedAt && Date.now() - held.startedAt < (Number(held.timeoutMs) || TIMEOUT_MS) + 60000;
    if (alive && fresh) process.exit(0);
    // Steal it by rename, which is atomic: two processes that both judge the
    // lock stale cannot both win, and the loser leaves rather than arming a
    // second watcher. Same trick the request queue uses to claim an ask.
    try {
      const mine = `${WAKE_LOCK}.${process.pid}.stale`;
      fs.renameSync(WAKE_LOCK, mine);
      fs.rmSync(mine, { force: true });
    } catch { process.exit(0); }
    if (!claimLock()) process.exit(0);
  }
  const releaseLock = () => {
    try { if (readJson(WAKE_LOCK)?.pid === process.pid) fs.rmSync(WAKE_LOCK, { force: true }); } catch { /* ignore */ }
  };
  process.on("exit", releaseLock);
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(0));

  const fire = () => {
    const queued = listQueued();
    if (!queued.length) return false;
    process.stderr.write(
      `variate: ${queued.length} ask${queued.length === 1 ? "" : "s"} waiting from the card ` +
      `(${queued.map(labelOf).join(", ")}). ${DRAIN_HINT}.\n`,
      () => process.exit(2));
    // Held open until the stderr flush callback exits with the wake code.
    return new Promise(() => {});
  };

  // Anything already queued at arm time is probably being drained by the
  // continuation the sync hook just forced. That takes a model round trip and
  // a Bash call, so wait for the queue to empty rather than firing over the
  // top of an agent that is already on it. Only a queue that is STILL full
  // when the grace runs out means nobody is coming.
  if (listQueued().length) {
    const graceEnd = Date.now() + 90000;
    while (Date.now() < graceEnd) {
      await new Promise((r) => setTimeout(r, 2000));
      if (!listQueued().length) break;                 // drained: arm normally
      const hb = Number(readSafeNum(HEARTBEAT));
      if (hb && Date.now() - hb < 15000) continue;     // an agent just ran: keep waiting
    }
    await fire(); // holds forever when it fires; the flush callback exits 2
  }

  // While a watcher is armed, an ask WILL reach the agent in seconds, so the
  // card may honestly claim the agent is around.
  beat();
  const beatTimer = setInterval(beat, 5000);
  const deadline = Date.now() + TIMEOUT_MS;
  let settling = false;
  const settle = () => {
    // A short settle so a burst (keep right after refine) arrives whole.
    if (settling) return;
    settling = true;
    setTimeout(() => { settling = false; fire(); }, 1000);
  };
  let watcher = null;
  try { watcher = fs.watch(REQ, () => settle()); } catch { /* poll only */ }
  const poll = setInterval(() => {
    // The round can end under us: `variate end` deletes the workspace while
    // this watcher is armed, and it must leave rather than keep beating a
    // heartbeat into a project that is done with variate.
    if (!fs.existsSync(WS) || Date.now() >= deadline) {
      if (settling) return;
      clearInterval(poll); clearInterval(beatTimer);
      try { watcher?.close(); } catch { /* ignore */ }
      process.exit(0);
    }
    if (listQueued().length) settle();
  }, 2000);
}

// ---- the mode fork ----------------------------------------------------------
if (args.peek) {
  await peek();
} else if (args.wake) {
  // No workspace means `variate end` already ran, or variate was never up
  // here. Either way there is nothing to watch, and creating one would put
  // back the directory end just promised to remove.
  if (!fs.existsSync(WS)) process.exit(0);
  fs.mkdirSync(REQ, { recursive: true });
  await wake();
} else {
  fs.mkdirSync(DONE, { recursive: true });
  fs.mkdirSync(path.dirname(HEARTBEAT), { recursive: true });

  // ---- 1. fold in the previous ack -----------------------------------------
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

  // ---- 2. drain mode: claim everything queued, print an array, never block --
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
    // Always 0, even for an empty batch. An empty queue is the normal case,
    // not a failure, and this runs at the top of every turn: harnesses paint
    // any non-zero exit as "Failed to run", so a quiet queue would light up
    // the user's transcript with red for a command that did its job. The
    // array itself says whether there was anything.
    out(batch, 0);
  } else {
    mainBlocking();
  }
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
      // Exit 0: waiting and hearing nothing is exactly what this command is
      // for, and it runs several times per round. `type` tells the caller it
      // was idle; the freshness of the last card flip tells it whether the
      // user is still deciding and the loop is worth continuing.
      out({
        type: "idle", waitedMs: TIMEOUT_MS,
        queued: 0, working: listWorking().length,
        ...lastSwitch(),
      }, 0);
    }
  }
  function cleanup() {
    clearInterval(beatTimer);
    clearInterval(pollTimer);
    try { watcher?.close(); } catch { /* ignore */ }
  }
}
