// In-place tracing-paper sketch. Instead of a separate abstract canvas, you
// draw directly ON the section: the real section dims to ~12% opacity behind
// the drawing surface, so a box you draw where the headline is maps to where
// the headline actually sits. The canvas proportions match the live section,
// so the serialized blueprint's geometry is grounded in the real layout.

import { request, toast } from "/ui/api.js";

const KIND_LABEL = {
  heading: "heading", text: "paragraph text", button: "button / call to action",
  visual: "visual (illustration, product mock, chart, drawn in CSS/SVG)",
  input: "input field / form", list: "list of items", logo: "logo / brand mark",
  links: "nav links", card: "card", block: "content block",
};
const KINDS = Object.keys(KIND_LABEL);
const EMPTY = () => ({ boxes: [], strokes: [], notes: [] });
const MIN_BOX = 2;

// ---------------------------------------------------------------------------
// blueprint serialization (geometry is ground truth; H = section proportions)

const pct = (n) => Math.max(0, Math.min(100, Math.round(n)));

function hPos(cx, w) {
  if (w > 84) return "spanning the full width";
  if (cx < 38) return "on the left";
  if (cx > 62) return "on the right";
  return "centered";
}
function widthWord(w) {
  if (w > 84) return "full-width";
  if (w > 55) return "wide";
  if (w > 30) return "half-width";
  if (w > 12) return "narrow";
  return "small";
}
function proportionHint(H) {
  if (H < 30) return "a slim band (nav / strip height, tight vertical padding)";
  if (H > 66) return "a tall, hero-scale section (generous vertical presence)";
  return "a regular section (comfortable vertical padding)";
}

function strokeRegions(strokes) {
  const boxes = strokes.filter((s) => s.points.length >= 2).map((s) => {
    const xs = s.points.map((p) => p.x), ys = s.points.map((p) => p.y);
    return { x: Math.min(...xs), y: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
  });
  const PAD = 3, merged = [];
  for (const b of boxes) {
    const hit = merged.find((m) => b.x < m.x2 + PAD && b.x2 > m.x - PAD && b.y < m.y2 + PAD && b.y2 > m.y - PAD);
    if (hit) { hit.x = Math.min(hit.x, b.x); hit.y = Math.min(hit.y, b.y); hit.x2 = Math.max(hit.x2, b.x2); hit.y2 = Math.max(hit.y2, b.y2); }
    else merged.push({ ...b });
  }
  return merged.map((m) => ({ kind: "freehand", note: null, x: m.x, y: m.y, w: m.x2 - m.x, h: m.y2 - m.y }));
}

function intoRows(items) {
  const sorted = [...items].sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2));
  const rows = [];
  for (const it of sorted) {
    const row = rows.find((r) => {
      const top = Math.min(...r.map((x) => x.y)), bot = Math.max(...r.map((x) => x.y + x.h));
      const overlap = Math.min(bot, it.y + it.h) - Math.max(top, it.y);
      return overlap > 0.35 * Math.min(it.h, bot - top);
    });
    if (row) row.push(it); else rows.push([it]);
  }
  for (const r of rows) r.sort((a, b) => a.x - b.x);
  return rows;
}

export function serializeSketch(sk, H) {
  const items = [...sk.boxes.map((b) => ({ kind: b.kind, note: b.note, x: b.x, y: b.y, w: b.w, h: b.h })), ...strokeRegions(sk.strokes)];
  if (!items.length && !sk.notes.length) return "";
  const lines = [];
  lines.push(`Section proportions: ${proportionHint(H)}.`);
  lines.push(`Layout, top to bottom (x and y are % of the section's width and height):`);
  const rows = intoRows(items).slice(0, 12);
  let dropped = 0;
  rows.forEach((row, i) => {
    const parts = row.slice(0, 8).map((it) => {
      dropped += Math.max(0, row.length - 8);
      const label = it.kind === "freehand" ? "freehand sketch (read it as an organic visual / illustration shape)" : KIND_LABEL[it.kind] ?? it.kind;
      const x1 = pct(it.x), x2 = pct(it.x + it.w);
      const y1 = pct((it.y / H) * 100), y2 = pct(((it.y + it.h) / H) * 100);
      let s = `a ${widthWord(it.w)} ${label} ${hPos(it.x + it.w / 2, it.w)} (x ${x1}-${x2}%, y ${y1}-${y2}%)`;
      if (it.note) s += `, it says "${String(it.note).slice(0, 90)}"`;
      return s;
    });
    lines.push(`- Row ${i + 1}: ${parts.join("; ")}.`);
  });
  if (dropped > 0) lines.push(`- (${dropped} more small marks omitted.)`);
  lines.push(`The x/y percentages are the ground truth for placement; the row narration is only a reading order. Elements whose y ranges overlap sit side by side (e.g. a text column beside a visual).`);
  if (sk.notes.length) {
    lines.push(`Handwritten notes on the sketch:`);
    for (const n of sk.notes.slice(0, 8)) lines.push(`- "${String(n.text).slice(0, 120)}" (written near x ${pct(n.x)}%, y ${pct((n.y / H) * 100)}%)`);
  }
  return lines.join("\n").slice(0, 5500);
}

// ---------------------------------------------------------------------------
// in-place session

let cur = null; // { slug, frame, sk, tool, sel, undo, redo, drag, tagFor, H, els }

export function isSketching() { return !!cur; }

const stored = (slug) => { try { return { ...EMPTY(), ...JSON.parse(localStorage.getItem("variate.sketch." + slug)) }; } catch { return EMPTY(); } };
const persist = () => { if (cur) localStorage.setItem("variate.sketch." + cur.slug, JSON.stringify(cur.sk)); };

export function openSketch(slug, frame) {
  if (cur) closeSketch(false);
  if (!frame) return;
  const boxW = frame.box.clientWidth || 900;
  const boxH = frame.box.clientHeight || 420;
  const H = Math.max(14, Math.round(100 * boxH / boxW)); // canvas units tall
  cur = { slug, frame, sk: stored(slug), tool: "box", sel: null, undo: [], redo: [], drag: null, tagFor: null, H, els: {} };

  frame.sketching = true;
  frame.wrap.classList.add("sketching");

  const surface = document.createElement("div");
  surface.className = "sketch-surface";
  surface.innerHTML = `<svg viewBox="0 0 100 ${H}" preserveAspectRatio="none"></svg>`;
  frame.box.appendChild(surface);

  const bar = document.createElement("div");
  bar.className = "sketch-bar";
  bar.innerHTML = `
    <span class="sk-title">sketch on ${slug}</span>
    <div class="sk-seg" data-tools>
      <button data-tool="box" class="on">box</button>
      <button data-tool="pen">pen</button>
      <button data-tool="note">note</button>
    </div>
    <div class="sk-seg">
      <button data-sk="undo" title="undo">↩</button>
      <button data-sk="redo" title="redo">↪</button>
      <button data-sk="clear">clear</button>
    </div>`;
  const foot = document.createElement("div");
  foot.className = "sketch-foot";
  foot.innerHTML = `
    <input data-sk="note" type="text" placeholder="anything else? e.g. keep the chart, make the headline huge">
    <button data-sk="cancel" class="ghost">cancel</button>
    <button data-sk="run" class="go">Draw it from my sketch</button>`;
  frame.wrap.appendChild(bar);
  frame.wrap.appendChild(foot);
  cur.els = { surface, svg: surface.querySelector("svg"), bar, foot };

  bar.addEventListener("click", onBar);
  foot.addEventListener("click", onFoot);
  const svg = cur.els.svg;
  svg.addEventListener("pointerdown", onDown);
  svg.addEventListener("pointermove", onMove);
  svg.addEventListener("pointerup", onUp);
  window.addEventListener("keydown", onKeys, true);
  frame.wrap.scrollIntoView({ behavior: "smooth", block: "center" });

  draw();
  toast(`tracing over ${slug} — draw boxes where elements go, tag them, then "Draw it"`);
}

function closeSketch(commit) {
  if (!cur) return;
  const { frame, els } = cur;
  window.removeEventListener("keydown", onKeys, true);
  els.surface.remove();
  els.bar.remove();
  els.foot.remove();
  frame.sketching = false;
  frame.wrap.classList.remove("sketching");
  // restore geometry
  frame.iframe.style.opacity = "";
  cur = null;
}

function onBar(e) {
  const t = e.target.closest("[data-tool]");
  if (t) { cur.tool = t.dataset.tool; for (const b of cur.els.bar.querySelectorAll("[data-tool]")) b.classList.toggle("on", b === t); return; }
  const s = e.target.closest("[data-sk]")?.dataset.sk;
  if (s === "undo") undo();
  else if (s === "redo") redo();
  else if (s === "clear") { push(); cur.sk = EMPTY(); cur.sel = null; cur.tagFor = null; draw(); }
}

function onFoot(e) {
  const s = e.target.closest("[data-sk]")?.dataset.sk;
  if (s === "cancel") closeSketch(false);
  else if (s === "run") run();
}

function onKeys(e) {
  if (!cur) return;
  const typing = document.activeElement?.tagName === "INPUT";
  if (e.key === "Escape") {
    e.stopPropagation();
    if (cur.tagFor) { cur.tagFor = null; draw(); }
    else if (cur.sel) { cur.sel = null; draw(); }
    else closeSketch(false);
    return;
  }
  if (typing) return;
  e.stopPropagation();
  const k = e.key.toLowerCase();
  if (k === "b") setTool("box");
  else if (k === "p") setTool("pen");
  else if (k === "t") setTool("note");
  else if ((e.metaKey || e.ctrlKey) && k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if ((e.key === "Backspace" || e.key === "Delete") && cur.sel) {
    e.preventDefault(); push();
    const { type, id } = cur.sel;
    if (type === "box") cur.sk.boxes = cur.sk.boxes.filter((b) => b.id !== id);
    if (type === "note") cur.sk.notes = cur.sk.notes.filter((n) => n.id !== id);
    if (type === "stroke") cur.sk.strokes = cur.sk.strokes.filter((s) => s.id !== id);
    cur.sel = null; cur.tagFor = null; draw();
  }
}
function setTool(t) { cur.tool = t; for (const b of cur.els.bar.querySelectorAll("[data-tool]")) b.classList.toggle("on", b.dataset.tool === t); }

function push() { cur.undo.push(JSON.stringify(cur.sk)); if (cur.undo.length > 40) cur.undo.shift(); cur.redo = []; }
function undo() { const s = cur.undo.pop(); if (!s) return; cur.redo.push(JSON.stringify(cur.sk)); cur.sk = JSON.parse(s); cur.sel = null; cur.tagFor = null; draw(); }
function redo() { const s = cur.redo.pop(); if (!s) return; cur.undo.push(JSON.stringify(cur.sk)); cur.sk = JSON.parse(s); cur.sel = null; draw(); }

function toUnits(e) {
  const r = cur.els.svg.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)),
    y: Math.max(0, Math.min(cur.H, ((e.clientY - r.top) / r.height) * cur.H)),
  };
}

function onDown(e) {
  if (!cur || cur.tagFor) return;
  cur.els.svg.setPointerCapture(e.pointerId);
  const p = toUnits(e);
  const hit = e.target.closest("[data-id]");
  if (hit) {
    const id = hit.dataset.id, type = hit.dataset.type;
    cur.sel = { type, id };
    if (type === "box") {
      const b = cur.sk.boxes.find((x) => x.id === id);
      const corner = e.target.dataset.corner;
      push();
      cur.drag = corner ? { kind: "resize", b, corner } : { kind: "move", b, dx: p.x - b.x, dy: p.y - b.y };
    }
    draw();
    return;
  }
  if (cur.tool === "box") {
    push();
    const b = { id: crypto.randomUUID().slice(0, 8), kind: "block", note: null, x: p.x, y: p.y, w: 0, h: 0 };
    cur.sk.boxes.push(b);
    cur.drag = { kind: "new", b, ox: p.x, oy: p.y };
    cur.sel = { type: "box", id: b.id };
  } else if (cur.tool === "pen") {
    push();
    const s = { id: crypto.randomUUID().slice(0, 8), points: [p] };
    cur.sk.strokes.push(s);
    cur.drag = { kind: "pen", s };
  } else if (cur.tool === "note") {
    push();
    const text = prompt("note text");
    if (text?.trim()) cur.sk.notes.push({ id: crypto.randomUUID().slice(0, 8), text: text.trim().slice(0, 120), x: p.x, y: p.y });
    else cur.undo.pop();
  }
  draw();
}

function onMove(e) {
  if (!cur?.drag) return;
  const p = toUnits(e), d = cur.drag, H = cur.H;
  if (d.kind === "new") { d.b.x = Math.min(d.ox, p.x); d.b.y = Math.min(d.oy, p.y); d.b.w = Math.abs(p.x - d.ox); d.b.h = Math.abs(p.y - d.oy); }
  else if (d.kind === "move") { d.b.x = Math.max(0, Math.min(100 - d.b.w, p.x - d.dx)); d.b.y = Math.max(0, Math.min(H - d.b.h, p.y - d.dy)); }
  else if (d.kind === "resize") {
    if (d.corner.includes("e")) d.b.w = Math.max(2, p.x - d.b.x);
    if (d.corner.includes("s")) d.b.h = Math.max(2, p.y - d.b.y);
    if (d.corner.includes("w")) { const x2 = d.b.x + d.b.w; d.b.x = Math.min(p.x, x2 - 2); d.b.w = x2 - d.b.x; }
    if (d.corner.includes("n")) { const y2 = d.b.y + d.b.h; d.b.y = Math.min(p.y, y2 - 2); d.b.h = y2 - d.b.y; }
  } else if (d.kind === "pen") d.s.points.push(p);
  draw();
}

function onUp() {
  if (!cur?.drag) return;
  const d = cur.drag; cur.drag = null;
  if (d.kind === "new") {
    if (d.b.w < MIN_BOX || d.b.h < MIN_BOX) { cur.sk.boxes = cur.sk.boxes.filter((x) => x !== d.b); cur.sel = null; cur.undo.pop(); }
    else cur.tagFor = d.b.id;
  } else if (d.kind === "pen") {
    let len = 0;
    for (let i = 1; i < d.s.points.length; i++) len += Math.hypot(d.s.points[i].x - d.s.points[i - 1].x, d.s.points[i].y - d.s.points[i - 1].y);
    if (d.s.points.length < 3 || len <= 2.5) { cur.sk.strokes.pop(); cur.undo.pop(); }
  }
  persist();
  draw();
}

function draw() {
  const svg = cur.els.svg, H = cur.H;
  const selId = cur.sel?.id;
  let out = "";
  for (const s of cur.sk.strokes) {
    const d = s.points.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
    out += `<path data-id="${s.id}" data-type="stroke" d="${d}" fill="none" stroke="${selId === s.id ? "#3a33e0" : "#3a33e0aa"}" stroke-width="0.5" stroke-linecap="round"/>`;
  }
  for (const b of cur.sk.boxes) {
    const sel = selId === b.id;
    out += `<g data-id="${b.id}" data-type="box" style="cursor:move">
      <rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="0.6" fill="rgba(58,51,224,0.10)" stroke="#3a33e0" stroke-width="${sel ? 0.55 : 0.32}" stroke-dasharray="1.6 1"/>
      <text x="${b.x + b.w / 2}" y="${b.y + b.h / 2}" text-anchor="middle" dominant-baseline="middle" font-size="${Math.min(3, H / 14)}" fill="#3a33e0" style="pointer-events:none;font-family:monospace">${b.kind}${b.note ? " ✎" : ""}</text>
      ${sel ? ["nw", "ne", "sw", "se"].map((c) => { const cx = c.includes("e") ? b.x + b.w : b.x, cy = c.includes("s") ? b.y + b.h : b.y; return `<rect data-id="${b.id}" data-type="box" data-corner="${c}" x="${cx - 1}" y="${cy - 1}" width="2" height="2" fill="#3a33e0" style="cursor:${c}-resize"/>`; }).join("") : ""}
    </g>`;
  }
  for (const n of cur.sk.notes) {
    out += `<text data-id="${n.id}" data-type="note" x="${n.x}" y="${n.y}" font-size="${Math.min(3.2, H / 13)}" fill="${selId === n.id ? "#3a33e0" : "#1c1a15"}" style="cursor:pointer;font-family:monospace">✎ ${String(n.text).slice(0, 40).replace(/[&<>]/g, "")}</text>`;
  }
  svg.innerHTML = out;
  renderTagger();
}

function renderTagger() {
  cur.els.surface.querySelector(".tagger")?.remove();
  if (!cur.tagFor) return;
  const b = cur.sk.boxes.find((x) => x.id === cur.tagFor);
  if (!b) { cur.tagFor = null; return; }
  const el = document.createElement("div");
  el.className = "tagger";
  el.style.left = Math.min(70, b.x) + "%";
  el.style.top = Math.min(82, ((b.y + b.h) / cur.H) * 100) + "%";
  el.innerHTML = `
    <div class="row">${KINDS.map((k) => `<button class="chip ${b.kind === k ? "on" : ""}" data-k="${k}">${k}</button>`).join("")}</div>
    <input type="text" placeholder='says... e.g. "Start free trial"' value="${b.note ? String(b.note).replace(/"/g, "&quot;") : ""}">
    <div class="row" style="margin-top:6px;justify-content:space-between">
      <button class="chip" data-del="1">delete</button>
      <button class="chip on" data-done="1">done</button>
    </div>`;
  cur.els.surface.appendChild(el);
  el.addEventListener("pointerdown", (e) => e.stopPropagation());
  el.addEventListener("click", (e) => {
    const k = e.target.dataset.k;
    if (k) { b.kind = k; persist(); draw(); }
    else if (e.target.dataset.del) { push(); cur.sk.boxes = cur.sk.boxes.filter((x) => x.id !== b.id); cur.tagFor = null; cur.sel = null; draw(); }
    else if (e.target.dataset.done) { cur.tagFor = null; draw(); }
  });
  const input = el.querySelector("input");
  let snapped = false;
  input.addEventListener("input", () => { if (!snapped) { push(); snapped = true; } b.note = input.value.trim() || null; persist(); });
  input.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") { cur.tagFor = null; draw(); } });
}

async function rasterize() {
  const H = cur.H, svg = cur.els.svg;
  const clone = svg.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", "900");
  clone.setAttribute("height", String(Math.round(900 * H / 100)));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = url; });
    const canvas = document.createElement("canvas");
    canvas.width = 900; canvas.height = Math.round(900 * H / 100);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fffdf9"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png").split(",")[1];
  } finally { URL.revokeObjectURL(url); }
}

async function run() {
  if (!cur) return;
  const blueprint = serializeSketch(cur.sk, cur.H);
  if (!blueprint) { toast("draw a box or two first"); return; }
  const note = cur.els.foot.querySelector("[data-sk='note']")?.value.trim();
  const slug = cur.slug;
  let png = null;
  try { png = await rasterize(); } catch { /* blueprint alone is fine */ }
  persist();
  closeSketch(true);
  await request("sketch", { slug }, { blueprint, instruction: note || undefined }, png);
}
