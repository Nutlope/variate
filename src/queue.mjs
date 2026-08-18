// The card's asks for the agent, as files. Ported from v2's request queue,
// which survived a real end-to-end run unchanged: the card writes a numbered
// JSON file, the agent claims it by atomic rename (scripts/await.mjs), and
// acks it into requests/done/. Filesystem only, so it works inside a
// network-sandboxed agent and survives either side dying.

import fs from "node:fs";
import path from "node:path";
import { atomicWrite, nowIso, readJsonSafe, slug } from "./core.mjs";

export const TYPES = new Set(["vary", "more", "done"]);

// Everything in params arrived off the wire from whatever local page could
// reach the sidecar. Keep only the keys each type is known to carry, cap
// every string, coerce every number, and drop the rest, so a hostile page
// can neither smuggle payloads to the agent nor bend the filename below.
const capStr = (v, max) => {
  if (v == null || typeof v === "object") return undefined;
  const s = String(v).replace(/\s+/g, " ").trim().slice(0, max);
  return s || undefined;
};
const capInt = (v, lo, hi) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : undefined;
};
const capList = (v, count, max) => {
  if (!Array.isArray(v)) return undefined;
  const out = v.slice(0, count).map((s) => capStr(s, max)).filter(Boolean);
  return out.length ? out : undefined;
};

function cleanSelection(sel) {
  if (!sel || typeof sel !== "object" || Array.isArray(sel)) return undefined;
  const out = {};
  const v = capInt(sel.v, 1, 9);
  if (v != null) out.v = v;
  for (const [k, max] of [["set", 64], ["tag", 24], ["id", 80], ["cls", 120], ["heading", 80], ["text", 160], ["place", 12], ["pinned", 8], ["src", 200]]) {
    const s = capStr(sel[k], max);
    if (s) out[k] = s;
  }
  // src names a file the agent will read: keep it relative and inside the
  // project shape, never absolute, never traversing.
  if (out.src && (out.src.startsWith("/") || out.src.startsWith("\\") || out.src.includes(".."))) delete out.src;
  const chain = capList(sel.chain, 6, 80);
  if (chain) out.chain = chain;
  const media = capList(sel.media, 2, 80);
  if (media) out.media = media;
  if (sel.rect && typeof sel.rect === "object") {
    const rect = {};
    for (const k of ["x", "y", "w", "h"]) {
      const n = capInt(sel.rect[k], -100000, 100000);
      if (n != null) rect[k] = n;
    }
    if (Object.keys(rect).length) out.rect = rect;
  }
  if (sel.url && typeof sel.url === "object") {
    const url = {};
    for (const [k, max] of [["path", 200], ["search", 200], ["hash", 80], ["title", 80]]) {
      const s = capStr(sel.url[k], max);
      if (s) url[k] = s;
    }
    if (Object.keys(url).length) out.url = url;
  }
  return Object.keys(out).length ? out : undefined;
}

export function sanitizeParams(type, raw) {
  const p = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const out = {};
  // Set names are made with slug() everywhere else; hold the wire to the
  // same alphabet, so a set param can never carry a path or markup.
  const set = capStr(p.set, 64);
  if (set) out.set = slug(set).slice(0, 64);
  const count = capInt(p.count, 1, 9);
  if (count != null) out.count = count;
  if (type === "vary") {
    const hint = capStr(p.hint, 140);
    if (hint) out.hint = hint;
    const sel = cleanSelection(p.selection);
    if (sel) out.selection = sel;
  } else if (type === "more") {
    const steer = capStr(p.steer, 400);
    if (steer) out.steer = steer;
    const from = capInt(p.from, 1, 99);
    if (from != null) out.from = from;
  } else if (type === "done") {
    const n = capInt(p.n, 1, 99);
    if (n != null) out.n = n;
    const label = capStr(p.label, 120);
    if (label) out.label = label;
  }
  return out;
}

function nextSeq(P) {
  let max = 0;
  for (const dir of [P.REQ, P.REQ_DONE]) {
    let files = [];
    try { files = fs.readdirSync(dir); } catch { /* not created yet */ }
    for (const f of files) {
      const m = f.match(/^(\d+)-/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
  }
  return max + 1;
}

const short = (s, max = 38) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut) + "...";
};

/** One line a human reads in the terminal and in the card's feed. */
export function labelFor(type, params = {}) {
  const n = params.count ?? 4;
  if (type === "vary") {
    if (params.set) return `${n} takes of ${params.set}`;
    const sel = params.selection ?? {};
    const what = params.hint || sel.heading || sel.text;
    const where = sel.place && sel.place !== "band" ? ` (${sel.place})` : "";
    return what ? `${n} takes of "${short(what)}"${where}` : `${n} takes of the selected section${where}`;
  }
  if (type === "more") {
    const bits = [`${n} more of ${params.set}`];
    if (params.steer) bits.push(params.steer);
    if (params.from) bits.push(`from ${params.from}`);
    return bits.join(", ");
  }
  if (type === "done") {
    if (!params.set) return "finish up";
    return `keep ${params.n ?? "the live one"} of ${params.set}`;
  }
  return type;
}

export function createRequest(P, type, rawParams = {}) {
  if (!TYPES.has(type)) return { error: `unknown request type "${type}"` };
  const params = sanitizeParams(type, rawParams);
  fs.mkdirSync(P.REQ_DONE, { recursive: true });
  const id = String(nextSeq(P)).padStart(4, "0");
  const req = {
    v: 3,
    id,
    type,
    createdAt: nowIso(),
    label: labelFor(type, params),
    params,
  };
  // The name context is display only (idle-agent notifications read it off
  // the filename), but it lands on disk, so whatever the wire said goes
  // through slug(): no slashes, no dots, no way out of the queue directory.
  const sel = params.selection ?? {};
  const context = params.set || sel.heading || sel.id || params.hint || sel.place || "";
  const namePart = context ? `-${slug(context).slice(0, 24).replace(/-+$/, "")}` : "";
  atomicWrite(path.join(P.REQ, `${id}-${type}${namePart}.json`), JSON.stringify(req, null, 2) + "\n");
  return req;
}

/** Queued + claimed, for the card's "the agent is on it" state. */
export function queueState(P) {
  let files = [];
  try { files = fs.readdirSync(P.REQ); } catch { return { queued: [], working: [] }; }
  const queued = [], working = [];
  for (const f of files.sort()) {
    if (!f.endsWith(".json") && !f.endsWith(".json.working")) continue;
    const j = readJsonSafe(path.join(P.REQ, f));
    if (!j) continue;
    // The set (when the ask names one) lets the card scope its pending state
    // to the round the user is actually looking at.
    (f.endsWith(".working") ? working : queued).push({ id: j.id, type: j.type, label: j.label, set: j.params?.set ?? null });
  }
  return { queued, working };
}
