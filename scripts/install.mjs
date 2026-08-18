#!/usr/bin/env node
// Install variate as a skill for whichever agents are on this machine.
//
//   node scripts/install.mjs [--dry-run] [--remove] [--copy]
//                            [--claude] [--codex] [--cursor] [--agents] [--opencode]
//   node scripts/install.mjs --hooks [--dry-run] [--remove]
//
// With no target flags it installs everywhere it finds a home. A symlink is
// used so `git pull` in this repo updates every agent at once; on a system
// where symlinks are awkward, pass --copy.
//
// --hooks is separate and opt-in, because it edits the user's own Claude Code
// settings. It adds two Stop hooks so a card click reaches the agent while it
// is idle.
//
// There are two layers here and they cover different windows. SKILL.md's
// frontmatter declares the same pair, and those do fire: invoking the skill
// and ending the turn arms the watcher for its full fifteen minutes. What
// they cannot cover is a turn where the skill was never invoked, or a user
// who wanders back long after the watcher expired. These, in settings.json,
// are registered for the whole session either way. Neither layer makes the
// other redundant, and running both is not double-handling: await.mjs claims
// from a queue, so whichever fires first drains it and the other finds
// nothing to do.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");
const HOME = os.homedir();

const args = {};
for (const a of process.argv.slice(2)) if (a.startsWith("--")) args[a.slice(2)] = true;

// Where each agent looks. All of them read the same open skill format; each
// gets its own link, so removing one agent's install never breaks another.
// ~/.agents/skills is the shared store several agents (and the npx skills
// CLI) read; Codex's own global home is ~/.codex/skills.
const TARGETS = [
  { key: "claude", label: "Claude Code", dir: path.join(HOME, ".claude", "skills", "variate") },
  { key: "codex", label: "Codex CLI", dir: path.join(HOME, ".codex", "skills", "variate") },
  { key: "cursor", label: "Cursor", dir: path.join(HOME, ".cursor", "skills", "variate") },
  { key: "agents", label: "shared store", dir: path.join(HOME, ".agents", "skills", "variate") },
  { key: "opencode", label: "opencode", dir: path.join(HOME, ".config", "opencode", "skills", "variate") },
];

const wanted = TARGETS.filter((t) => args[t.key]);
const chosen = wanted.length ? wanted : TARGETS;
const dry = !!args["dry-run"];

const say = (k, v) => console.log(k.padEnd(13) + v);

// ---------------------------------------------------------------------------
// --hooks: idle wake, in the one place it stays registered
//
// Both hooks are silent no-ops in any project that has no .variate/, so they
// cost a process spawn per turn and nothing else. The sync one hands the
// agent anything queued before it stops; the async one watches for 15 minutes
// after the turn ends and wakes an idle agent when a click lands.

const SETTINGS = path.join(HOME, ".claude", "settings.json");
const AWAIT = path.join(SRC, "scripts", "await.mjs");
const MARK = "variate/scripts/await.mjs";

function variateHooks() {
  const ws = '"${CLAUDE_PROJECT_DIR:-$PWD}/.variate"';
  return [
    { type: "command", timeout: 15, command: `node "${AWAIT}" --ws ${ws} --peek --hook` },
    { type: "command", timeout: 920, asyncRewake: true, command: `node "${AWAIT}" --ws ${ws} --wake --timeout 900` },
  ];
}

function installHooks() {
  if (!fs.existsSync(path.dirname(SETTINGS))) {
    say("HOOKS", "no ~/.claude here, so Claude Code is not installed; nothing to do");
    return;
  }
  let raw = null, json = {};
  if (fs.existsSync(SETTINGS)) {
    raw = fs.readFileSync(SETTINGS, "utf8");
    try { json = JSON.parse(raw); } catch {
      say("HOOKS", `${SETTINGS} is not valid JSON; leaving it alone`);
      return;
    }
  }

  const groups = (json.hooks?.Stop ?? []).filter(Boolean);
  const isOurs = (g) => (g.hooks ?? []).some((h) => String(h.command ?? "").includes(MARK));
  const others = groups.filter((g) => !isOurs(g));
  const had = groups.length !== others.length;

  if (args.remove) {
    if (!had) { say("HOOKS", "none of ours installed"); return; }
    if (dry) { say("HOOKS", `would remove variate's Stop hooks from ${SETTINGS}`); return; }
    writeSettings(json, others, raw);
    say("HOOKS", `removed from ${SETTINGS}`);
    return;
  }

  if (dry) {
    say("HOOKS", `would ${had ? "refresh" : "add"} variate's Stop hooks in ${SETTINGS}`);
    return;
  }
  writeSettings(json, [...others, { hooks: variateHooks() }], raw);
  say("HOOKS", `${had ? "refreshed" : "added"} in ${SETTINGS}`);
  say("", "a card click now reaches your agent while it sits idle");
  say("", "restart Claude Code, or open a new session, for it to take effect");
}

function writeSettings(json, stopGroups, raw) {
  // Back up whatever was there first: this is the user's own settings file,
  // and it is usually much more than variate's two lines.
  if (raw != null) {
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15);
    fs.writeFileSync(`${SETTINGS}.bak-${stamp}`, raw);
    // Keep the two newest backups only: the settings file holds the user's
    // own config, and copies of it should not pile up forever.
    const dir = path.dirname(SETTINGS);
    const baks = fs.readdirSync(dir).filter((f) => f.startsWith("settings.json.bak-")).sort();
    for (const f of baks.slice(0, -2)) {
      try { fs.rmSync(path.join(dir, f), { force: true }); } catch { /* fine */ }
    }
  }
  const next = { ...json, hooks: { ...(json.hooks ?? {}) } };
  if (stopGroups.length) next.hooks.Stop = stopGroups;
  else delete next.hooks.Stop;
  if (!Object.keys(next.hooks).length) delete next.hooks;
  const tmp = `${SETTINGS}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n");
  fs.renameSync(tmp, SETTINGS);
}

if (args.hooks) {
  installHooks();
  process.exit(0);
}

function parentExists(dir) {
  // Only install where the agent already lives: creating ~/.codex on a
  // machine with no Codex is litter, not helpfulness.
  const agentRoot = path.dirname(path.dirname(dir));
  return fs.existsSync(agentRoot);
}

function current(dir) {
  try {
    const st = fs.lstatSync(dir);
    if (st.isSymbolicLink()) return { kind: "link", to: fs.realpathSync(dir) };
    if (st.isDirectory()) return { kind: "dir" };
    return { kind: "file" };
  } catch { return null; }
}

let installed = 0, skipped = 0;

for (const t of chosen) {
  const has = current(t.dir);

  if (args.remove) {
    if (!has) { say(t.label, "nothing installed"); skipped++; continue; }
    if (has.kind === "link" && has.to !== SRC) { say(t.label, `left alone: points at ${has.to}`); skipped++; continue; }
    if (dry) { say(t.label, `would remove ${t.dir}`); continue; }
    fs.rmSync(t.dir, { recursive: true, force: true });
    say(t.label, `removed ${t.dir}`);
    installed++;
    continue;
  }

  if (!parentExists(t.dir) && !wanted.length) { say(t.label, "not on this machine, skipped"); skipped++; continue; }
  if (has?.kind === "link" && has.to === SRC) { say(t.label, "already linked here"); skipped++; continue; }
  if (has && !(has.kind === "link")) { say(t.label, `a real directory is already at ${t.dir}; leaving it alone`); skipped++; continue; }
  if (dry) { say(t.label, `would link ${t.dir} -> ${SRC}`); continue; }

  fs.mkdirSync(path.dirname(t.dir), { recursive: true });
  if (has) fs.rmSync(t.dir, { force: true });
  // A copy install ships the runtime only: the marketing site, the eval
  // fixtures and the dev harness stay in the repo. agents/ rides along
  // because Codex reads its display metadata from the installed directory.
  const SKIP_COPY = new Set(["docs", ".vercel", "evals", "dev", "fixtures", ".git", ".gitignore", ".DS_Store", "vercel.json"]);
  if (args.copy) fs.cpSync(SRC, t.dir, { recursive: true, filter: (s) => {
    const rel = path.relative(SRC, s);
    return !rel || !SKIP_COPY.has(rel.split(path.sep)[0]);
  } });
  else fs.symlinkSync(SRC, t.dir, "dir");
  say(t.label, `${args.copy ? "copied to" : "linked"} ${t.dir}`);
  installed++;
}

console.log();
if (dry) say("DRY RUN", "nothing was written");
else if (args.remove) say("DONE", `${installed} removed, ${skipped} untouched`);
else {
  say("DONE", `${installed} installed, ${skipped} skipped`);
  say("USE", 'in any project, ask your agent for "four takes on the hero"');
  say("HOOKS", "optional, Claude Code: rerun with --hooks so a card click reaches an idle agent");
  say("MANUAL", `any other agent: point it at ${path.join(SRC, "AGENTS.md")}`);
}
