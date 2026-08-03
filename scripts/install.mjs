#!/usr/bin/env node
// Install variate as a skill for whichever agents are on this machine.
//
//   node scripts/install.mjs [--dry-run] [--remove] [--claude] [--codex] [--opencode]
//
// With no target flags it installs everywhere it finds a home. A symlink is
// used so `git pull` in this repo updates every agent at once; on a system
// where symlinks are awkward, pass --copy.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");
const HOME = os.homedir();

const args = {};
for (const a of process.argv.slice(2)) if (a.startsWith("--")) args[a.slice(2)] = true;

// Where each agent looks. Claude Code and Codex read the same open skill
// format; opencode discovers either of those two, so it is only listed for
// the report and never written to twice.
const TARGETS = [
  { key: "claude", label: "Claude Code", dir: path.join(HOME, ".claude", "skills", "variate") },
  { key: "codex", label: "Codex CLI", dir: path.join(HOME, ".agents", "skills", "variate") },
  { key: "opencode", label: "opencode", dir: path.join(HOME, ".config", "opencode", "skills", "variate") },
];

const wanted = TARGETS.filter((t) => args[t.key]);
const chosen = wanted.length ? wanted : TARGETS;
const dry = !!args["dry-run"];

const say = (k, v) => console.log(k.padEnd(13) + v);

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
  if (args.copy) fs.cpSync(SRC, t.dir, { recursive: true, filter: (s) => !s.includes("/.git/") });
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
  say("MANUAL", `any other agent: point it at ${path.join(SRC, "AGENTS.md")}`);
}
