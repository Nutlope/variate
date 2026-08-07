// The card's asks for the agent, as files. Ported from v2's request queue,
// which survived a real end-to-end run unchanged: the card writes a numbered
// JSON file, the agent claims it by atomic rename (scripts/await.mjs), and
// acks it into requests/done/. Filesystem only, so it works inside a
// network-sandboxed agent and survives either side dying.

import fs from "node:fs";
import path from "node:path";
import { atomicWrite, nowIso, readJsonSafe } from "./core.mjs";

export const TYPES = new Set(["vary", "more", "done"]);

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
    return params.hint ? `${n} takes of "${short(params.hint)}"` : `${n} takes of the selected section`;
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

export function createRequest(P, type, params = {}) {
  if (!TYPES.has(type)) return { error: `unknown request type "${type}"` };
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
  const namePart = params.set ? `-${params.set}` : "";
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
