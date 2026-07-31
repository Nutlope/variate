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
    // scripts/await.mjs owns this file; it runs with --ws <root>/.variate
    HEARTBEAT: path.join(VAR, "state", "agent.heartbeat"),
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
  for (let n = 1; n <= 99; n++) {
    const f = path.join(dir, `${n}${ext}`);
    if (!fs.existsSync(f)) break;
    variants.push({ n, file: f, sha: sha(readBytes(f) ?? Buffer.alloc(0)) });
  }
  const plan = readJsonSafe(path.join(dir, "plan.json"));
  const live = readBytes(target);
  const liveSha = live ? sha(live) : null;
  // Derived, never stored: which variant the target currently equals.
  const at = liveSha ? (variants.find((v) => v.sha === liveSha)?.n ?? null) : null;

  return {
    name, dir, targetRel, target, ext,
    n: variants.length,
    variants,
    plan: Array.isArray(plan) ? plan.map((x) => String(x)) : [],
    at,
    exists: !!live,
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
    n: s.n,
    at: s.at,
    plan: s.plan,
    missing: !s.exists,
  };
}

/**
 * Switch a set to variant n by copying it over the target file.
 *
 * Adopt-never-destroy: if the target currently matches no variant, the user
 * hand-edited it, so that edit is adopted as a new variant BEFORE the switch.
 * Nothing a user wrote is ever lost, which is why no confirm dialog exists
 * anywhere in this product.
 */
export function switchTo(P, name, n) {
  const s = readSet(P, name);
  if (!s) return { error: `no set "${name}"` };
  const target = s.variants.find((v) => v.n === Number(n));
  if (!target) return { error: `set "${s.name}" has no variant ${n} (has 1-${s.n})` };

  let adopted = null;
  if (s.exists && s.at == null) {
    adopted = s.n + 1;
    fs.copyFileSync(s.target, path.join(s.dir, `${adopted}${s.ext}`));
  }
  if (s.at === Number(n) && !adopted) return { ok: true, at: s.at, noop: true };

  fs.copyFileSync(target.file, s.target);
  return { ok: true, at: Number(n), adopted };
}
