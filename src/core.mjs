// Shared internals for variate. Zero dependencies.
//
// The model, entire: a SET is one target file plus N alternatives living in
// .variate/<set>/. Variant 1 is the user's original, never edited. Switching
// copies a variant over the target file and the user's own dev server
// re-renders it. Which variant is live is never stored: it is derived by
// hashing the target against each variant, so there is nothing to desync.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// The one copy of the version. SKILL.md's frontmatter states it too (a skill
// file cannot import), and smoke-cli trips when the two drift.
export const VERSION = "3.2.0";

export const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
export const nowIso = () => new Date().toISOString();

export function readSafe(file) {
  try { return fs.readFileSync(file, "utf8"); } catch { return null; }
}

export function readBytes(file) {
  try { return fs.readFileSync(file); } catch { return null; }
}

/** Write via a temp file + rename so a reader never sees a half-written file. */
export function atomicWrite(file, content) {
  const tmp = file + ".tmp-" + process.pid;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

export function readJsonSafe(file) {
  const raw = readSafe(file);
  if (raw == null) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function statMtimeSafe(p) {
  try { return fs.statSync(p).mtimeMs; } catch { return null; }
}

export function slug(raw) {
  const s = String(raw ?? "").toLowerCase().trim()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return s || "set";
}

/** Escape a string for literal use inside a RegExp source. */
export const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Stable per-project port in 4100-4899, so two projects' cards never contend
 * and the script tag URL is deterministic for a given root.
 */
export function defaultPortFor(rootAbs) {
  const h = crypto.createHash("sha1").update(String(rootAbs)).digest();
  return 4100 + (h.readUInt32BE(0) % 800);
}

/** Every path variate knows about, derived once from the project root. */
export function paths(root) {
  const ROOT = path.resolve(root);
  const VAR = path.join(ROOT, ".variate");
  return {
    ROOT,
    VAR,
    SETS: VAR,
    REQ: path.join(VAR, "requests"),
    REQ_DONE: path.join(VAR, "requests", "done"),
    STATE: path.join(VAR, "state"),
    // what this session has already settled; see recordSettled
    BOARD: path.join(VAR, "board.json"),
    // scripts/await.mjs owns this file; it runs with --ws <root>/.variate
    HEARTBEAT: path.join(VAR, "state", "agent.heartbeat"),
    // written by the sidecar on every /switch; read by await's idle report
    LAST_SWITCH: path.join(VAR, "state", "last-switch.json"),
    SERVER_JSON: path.join(VAR, "server.json"),
    TOKEN: path.join(VAR, "token"),
    ATTACH: path.join(VAR, "attach.json"),
    LOG: path.join(VAR, "server.log"),
  };
}

// ---------------------------------------------------------------------------
// sets

const RESERVED = new Set(["requests", "done", "node_modules"]);

/** A set dir holds: target (one line), plan.json, and 1.<ext> .. N.<ext>. */
export function listSets(P) {
  let names;
  try { names = fs.readdirSync(P.SETS, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of names) {
    if (!e.isDirectory() || e.name.startsWith(".") || RESERVED.has(e.name)) continue;
    const s = readSet(P, e.name);
    if (s) out.push(s);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function readSet(P, name) {
  const dir = setDir(P, name);
  if (!dir) return null;
  const targetRel = (readSafe(path.join(dir, "target")) ?? "").trim();
  if (!targetRel) return null;
  const target = path.resolve(P.ROOT, targetRel);
  // A target must stay inside the project: variate never writes outside it.
  if (target !== P.ROOT && !target.startsWith(P.ROOT + path.sep)) return null;

  const ext = path.extname(target);
  const variants = [];
  // Scan past a gap: a set started from nothing has no variant until the
  // agent writes one, and positions can be written in any order.
  for (let n = 1; n <= 99; n++) {
    const f = path.join(dir, `${n}${ext}`);
    if (!fs.existsSync(f)) continue;
    variants.push({ n, file: f, sha: sha(readBytes(f) ?? Buffer.alloc(0)) });
  }
  const { question, plan } = readPlan(path.join(dir, "plan.json"));
  const live = readBytes(target);
  const liveSha = live ? sha(live) : null;
  // Derived, never stored: which variant the target currently equals.
  const at = liveSha ? (variants.find((v) => v.sha === liveSha)?.n ?? null) : null;

  return {
    name, dir, targetRel, target, ext,
    n: variants.length,
    variants,
    question,
    plan,
    at,
    exists: !!live,
  };
}

/**
 * A round is a question with named answers, and each answer can say what it
 * changes and what that costs:
 *
 *   { "question": "...", "positions": [{ "name", "angle", "cost" }, ...] }
 *
 * A bare array of strings is still a plan, just one where every position is a
 * name and nothing else. Both shapes normalize to the same thing here, so
 * nothing downstream has to know which was written.
 */
export function readPlan(file) {
  const raw = readJsonSafe(file);
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.positions) ? raw.positions : [];
  const str = (v) => (v == null || v === "" ? null : String(v));
  return {
    question: str(raw && !Array.isArray(raw) ? raw.question : null),
    plan: list.map((p) => (typeof p === "string" || p == null
      ? { name: str(p), angle: null, cost: null }
      : { name: str(p.name), angle: str(p.angle), cost: str(p.cost) })),
  };
}

export function setDir(P, name) {
  const clean = slug(name);
  if (!clean || RESERVED.has(clean)) return null;
  const dir = path.join(P.SETS, clean);
  if (!dir.startsWith(P.SETS + path.sep)) return null;
  return fs.existsSync(dir) ? dir : null;
}

/** The public shape the card sees. Never leaks absolute paths. */
export function setSummary(s) {
  return {
    name: s.name,
    target: s.targetRel,
    n: s.n,                                   // how many exist
    have: s.variants.map((v) => v.n),         // which positions exist: they can arrive out of order
    max: s.variants.length ? s.variants[s.variants.length - 1].n : 0,
    at: s.at,
    question: s.question,
    plan: s.plan,
    missing: !s.exists,
  };
}

// ---------------------------------------------------------------------------
// the board
//
// A page is not one round. Someone prototyping a landing page settles the
// hero, then the nav, then the pricing, and each closed round takes its own
// directory with it, so by the end nothing remembers what was decided or why.
// The board is the thin thread through a session: one line per settled piece,
// written when a round closes, read back as the closing recap. It lives
// inside .variate and leaves with it. Nothing is ever written to the user's
// own tree, and nothing depends on this file existing.

export function readBoard(P) {
  const b = readJsonSafe(P.BOARD);
  return {
    settled: Array.isArray(b?.settled) ? b.settled : [],
    passed: Array.isArray(b?.passed) ? b.passed : [],
  };
}

// What the user turned down is worth remembering as much as what they kept:
// a direction they passed over is not a fresh idea two rounds later, and the
// board is how a later draft knows. Position 1 is their own baseline, so
// moving off it is never recorded as a rejection.
export function recordPassed(P, piece, entries) {
  try {
    const board = readBoard(P);
    let grew = false;
    for (const e of entries) {
      if (!e?.name) continue;
      if (board.passed.some((p) => p.piece === piece && p.name === e.name)) continue;
      board.passed.push({ piece, name: e.name, ...(e.angle ? { angle: e.angle } : {}), at: nowIso() });
      grew = true;
    }
    if (grew) atomicWrite(P.BOARD, JSON.stringify(board, null, 2) + "\n");
  } catch { /* advisory: a broken board never blocks a round */ }
}

export function recordSettled(P, s, why) {
  // Only positions the user could actually have SEEN count as turned down.
  // A round is often decided before the last file lands, and killing off a
  // direction nobody ever looked at is worse than not remembering at all.
  recordPassed(P, s.name, s.plan
    .map((p, i) => ({ ...p, n: i + 1 }))
    .filter((p) => p.n !== 1 && p.n !== (s.at ?? -1))
    .filter((p) => s.variants.some((v) => v.n === p.n)));
  try {
    const board = readBoard(P);
    const kept = s.at ? (s.plan[s.at - 1]?.name ?? `position ${s.at}`) : "your own edit";
    board.settled = board.settled.filter((e) => e.piece !== s.name);
    board.settled.push({
      piece: s.name,
      target: s.targetRel,
      question: s.question ?? null,
      kept,
      why: why ?? null,
      at: nowIso(),
    });
    atomicWrite(P.BOARD, JSON.stringify(board, null, 2) + "\n");
    return kept;
  } catch { return null; }   // advisory: a broken board never blocks a round
}

/** plan.json as we write it back: the object form, without empty fields. */
function writablePlan(question, positions) {
  const out = {};
  if (question) out.question = question;
  out.positions = positions.map((p) => {
    const o = { name: p?.name ?? null };
    if (p?.angle) o.angle = p.angle;
    if (p?.cost) o.cost = p.cost;
    return o;
  });
  return out;
}

/**
 * Narrow a set to one position.
 *
 * A round is a question, and once it is answered the losing answers stop
 * being interesting: leaving them in the pager means every later take is
 * compared against three dead ends the user already rejected. So the chosen
 * variant becomes position 1 and the rest are deleted, and the next takes
 * land as 2 and 3 against it. The round converges instead of accumulating.
 */
export function narrowTo(P, name, n) {
  const s = readSet(P, name);
  if (!s) return { error: `no set "${name}"` };
  const keep = s.variants.find((v) => v.n === Number(n));
  if (!keep) return { error: `set "${s.name}" has no variant ${n} (has ${s.variants.map((v) => v.n).join(", ") || "none"})` };
  if (s.n === 1 && keep.n === 1) return { ok: true, kept: 1, removed: 0, noop: true };

  const kept = s.plan[keep.n - 1] ?? null;
  const label = kept?.name ?? null;
  const body = readBytes(keep.file);
  if (!body) return { error: `variant ${n} could not be read` };

  // Nothing anyone made is destroyed, which is the reason this tool never
  // asks "are you sure". The passed-over positions move out of the pager and
  // into .dropped/, named by the direction they were trying, so "actually,
  // bring back the split one" is a copy rather than a redraw. `end` takes
  // the whole set directory, so they still leave with everything else.
  const attic = path.join(s.dir, ".dropped");
  fs.mkdirSync(attic, { recursive: true });
  recordPassed(P, s.name, s.variants
    .filter((v) => v.n !== keep.n && v.n !== 1)
    .map((v) => s.plan[v.n - 1])
    .filter(Boolean));
  for (const v of s.variants) {
    if (v.n !== keep.n) {
      const tag = slug(s.plan[v.n - 1]?.name ?? `position-${v.n}`);
      // Round two can drop a position with the same number and the same name
      // as round one did. Never overwrite: the promise is that nothing anyone
      // made is destroyed, and a silent clobber here is the one way to break
      // it that no one would notice until they asked for the file back.
      let dest = path.join(attic, `${v.n}-${tag}${s.ext}`);
      for (let i = 2; fs.existsSync(dest); i++) dest = path.join(attic, `${v.n}-${tag}-${i}${s.ext}`);
      fs.copyFileSync(v.file, dest);
    }
    fs.rmSync(v.file, { force: true });
  }
  const first = path.join(s.dir, `1${s.ext}`);
  fs.writeFileSync(first, body);
  // The round narrowed; it did not restart. The question still stands and the
  // surviving position keeps what it was trying, so the next takes are drawn
  // against something that still knows what it is.
  atomicWrite(path.join(s.dir, "plan.json"),
    JSON.stringify(writablePlan(s.question, [kept ?? { name: "where you landed" }]), null, 2) + "\n");

  // The kept one is the answer, so it is what should be on the page. Only
  // write when it is not already live: a needless write is an HMR reload.
  const live = readBytes(s.target);
  if (!live || sha(live) !== keep.sha) fs.copyFileSync(first, s.target);

  return { ok: true, kept: 1, was: Number(n), removed: s.n - 1, label };
}

/**
 * Switch a set to variant n by copying it over the target file.
 *
 * Adopt-never-destroy: if the target currently matches no variant, the user
 * hand-edited it, so that edit is adopted as a new variant BEFORE the switch.
 * Nothing a user wrote is ever lost, which is why no confirm dialog exists
 * anywhere in this product.
 */
export function switchTo(P, name, n, opts = {}) {
  const s = readSet(P, name);
  if (!s) return { error: `no set "${name}"` };
  const target = s.variants.find((v) => v.n === Number(n));
  if (!target) return { error: `set "${s.name}" has no variant ${n} (has 1-${s.n})` };

  let adopted = null;
  if (s.exists && s.at == null) {
    // The next FREE position, not the count: positions land out of order all
    // the time (the agent writes 3 before 2), so counting would adopt the
    // user's edit straight over a variant that already exists.
    adopted = (s.variants.at(-1)?.n ?? 0) + 1;
    fs.copyFileSync(s.target, path.join(s.dir, `${adopted}${s.ext}`));
  }
  // `force` is a replay: write the same bytes over the target so the dev
  // server sees a change and mounts the position again.
  if (s.at === Number(n) && !adopted && !opts.force) return { ok: true, at: s.at, noop: true };

  fs.copyFileSync(target.file, s.target);
  return { ok: true, at: Number(n), adopted };
}

// A variant may tag its root element data-variate-section="<set>" so the card
// can watch exactly that part of the page, flash it when sets switch, and say
// so when the user is on a screen that does not render it. The marker is
// working apparatus, not design: `end` calls this so the kept file leaves the
// session without it, keeping the promise that nothing is variate-shaped.
export function stripMarker(s) {
  const src = readSafe(s.target);
  if (src == null) return false;
  const esc = escapeRe(s.name);
  // Only in attribute position. The same string can legitimately appear as a
  // CSS selector the variant styles itself with ([data-variate-section="x"]),
  // and a blind replace there shreds the selector and ships the kept design
  // unstyled, with the only other copy already deleted. So: preceded by
  // whitespace, followed by an attribute boundary, and inside a tag, which
  // the lookbehind checks by requiring a `<` with no `>` between.
  const attr = new RegExp(
    `(?<=<[^<>]*)\\s+data-variate-section\\s*=\\s*(?:"${esc}"|'${esc}'|\\{\\s*["'\`]${esc}["'\`]\\s*\\})(?=[\\s/>])`,
    "g",
  );
  const out = src.replace(attr, "");
  if (out === src) return false;
  atomicWrite(s.target, out);
  return true;
}
