// The sketch pad: draw a wireframe for one section, run it as a request.
// The drawing serializes two ways: a textual blueprint (geometry as x/y
// percentages, the layout ground truth, ported from Recast lib/sketch.ts)
// plus a rasterized PNG for agents with vision. Sketches persist per slug.

import { request, toast } from "/ui/api.js";

const CANVAS_H = { slim: 24, standard: 46, tall: 70 };
const SIZE_HINT = {
  slim: "a slim band (nav / strip height, tight vertical padding)",
  standard: "a regular section (comfortable vertical padding)",
  tall: "a tall, hero-scale section (generous vertical presence)",
};
const KIND_LABEL = {
  heading: "heading", text: "paragraph text", button: "button / call to action",
  visual: "visual (illustration, product mock, chart, drawn in CSS/SVG)",
  input: "input field / form", list: "list of items", logo: "logo / brand mark",
  links: "nav links", card: "card", block: "content block",
};
const KINDS = Object.keys(KIND_LABEL);
const EMPTY = () => ({ boxes: [], strokes: [], notes: [], size: "standard" });
const MIN_BOX = 3;

// ---------------------------------------------------------------------------
// blueprint serialization (port of Recast serializeSketch, kept faithful)

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

function strokeRegions(strokes) {
  const boxes = strokes
    .filter((s) => s.points.length >= 2)
    .map((s) => {
      const xs = s.points.map((p) => p.x), ys = s.points.map((p) => p.y);
      return { x: Math.min(...xs), y: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
    });
  const PAD = 3;
  const merged = [];
  for (const b of boxes) {
    const hit = merged.find((m) => b.x < m.x2 + PAD && b.x2 > m.x - PAD && b.y < m.y2 + PAD && b.y2 > m.y - PAD);
    if (hit) {
      hit.x = Math.min(hit.x, b.x); hit.y = Math.min(hit.y, b.y);
      hit.x2 = Math.max(hit.x2, b.x2); hit.y2 = Math.max(hit.y2, b.y2);
    } else merged.push({ ...b });
  }
  return merged.map((m) => ({ kind: "freehand", note: null, x: m.x, y: m.y, w: m.x2 - m.x, h: m.y2 - m.y }));
}

function intoRows(items, H) {
  const sorted = [...items].sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2));
  const rows = [];
  for (const it of sorted) {
    const row = rows.find((r) => {
      const bandTop = Math.min(...r.map((x) => x.y));
      const bandBot = Math.max(...r.map((x) => x.y + x.h));
      const overlap = Math.min(bandBot, it.y + it.h) - Math.max(bandTop, it.y);
      return overlap > 0.35 * Math.min(it.h, bandBot - bandTop);
    });
    if (row) row.push(it);
    else rows.push([it]);
  }
  for (const r of rows) r.sort((a, b) => a.x - b.x);
  return rows;
}

export function serializeSketch(sk) {
  const H = CANVAS_H[sk.size] ?? 46;
  const items = [
    ...sk.boxes.map((b) => ({ kind: b.kind, note: b.note, x: b.x, y: b.y, w: b.w, h: b.h })),
    ...strokeRegions(sk.strokes),
  ];
  if (!items.length && !sk.notes.length) return "";
  const lines = [];
  lines.push(`Section proportions: ${SIZE_HINT[sk.size] ?? SIZE_HINT.standard}.`);
  lines.push(`Layout, top to bottom (x and y are % of the section's width and height):`);
  const rows = intoRows(items, H).slice(0, 12);
  let dropped = 0;
  rows.forEach((row, i) => {
    const parts = row.slice(0, 8).map((it) => {
      dropped += Math.max(0, row.length - 8);
      const label = it.kind === "freehand" ? "freehand sketch (read it as an organic visual / illustration shape)" : KIND_LABEL[it.kind] ?? it.kind;
      const x1 = pct(it.x), x2 = pct(it.x + it.w);
      const y1 = pct((it.y / H) * 100), y2 = pct(((it.y + it.h) / H) * 100);
      const cx = it.x + it.w / 2;
      let s = `a ${widthWord(it.w)} ${label} ${hPos(cx, it.w)} (x ${x1}-${x2}%, y ${y1}-${y2}%)`;
      if (it.note) s += `, it says "${String(it.note).slice(0, 90)}"`;
      return s;
    });
    lines.push(`- Row ${i + 1}: ${parts.join("; ")}.`);
  });
  if (dropped > 0) lines.push(`- (${dropped} more small marks omitted.)`);
  lines.push(`The x/y percentages are the ground truth for placement; the row narration is only a reading order. Elements whose y ranges overlap sit side by side (e.g. a text column beside a visual).`);
  if (sk.notes.length) {
    lines.push(`Handwritten notes on the sketch:`);
    for (const n of sk.notes.slice(0, 8)) {
      lines.push(`- "${String(n.text).slice(0, 120)}" (written near x ${pct(n.x)}%, y ${pct((n.y / H) * 100)}%)`);
    }
  }
  return lines.join("\n").slice(0, 5500);
}

// ---------------------------------------------------------------------------
// the modal

let current = null; // {slug, sk, tool, sel, undo, redo, drag}

const stored = (slug) => {
  try { return JSON.parse(localStorage.getItem("variate.sketch." + slug)) ?? EMPTY(); } catch { return EMPTY(); }
};
const persist = () => {
  if (current) localStorage.setItem("variate.sketch." + current.slug, JSON.stringify(current.sk));
};

export function openSketch(slug) {
  current = { slug, sk: stored(slug), tool: "box", sel: null, undo: [], redo: [], drag: null, tagFor: null };
  const modal = document.createElement("div");
  modal.id = "sketch-modal";
  modal.innerHTML = `<div class="sketch-card">
    <div class="sketch-head">
      <span class="cap">sketch · ${slug}</span>
      <div class="seg" id="sk-tools">
        <button data-tool="box" class="on">box <span class="hint">B</span></button>
        <button data-tool="pen">pen <span class="hint">P</span></button>
        <button data-tool="note">note <span class="hint">T</span></button>
      </div>
      <div class="seg" id="sk-size"></div>
      <div class="right">
        <button class="chip" id="sk-undo">↩</button>
        <button class="chip" id="sk-redo">↪</button>
        <button class="chip" id="sk-clear">clear</button>
        <button class="chip" id="sk-close">✕</button>
      </div>
    </div>
    <div class="sketch-canvas"><svg id="sk-svg"></svg></div>
    <div class="sketch-foot">
      <input id="sk-note" type="text" placeholder="anything else? e.g. keep it playful">
      <button class="go" id="sk-run" style="background:var(--accent);color:#fff;border-radius:8px;padding:9px 16px;font-weight:600">Draw it from my sketch</button>
    </div>
    <p class="hint" style="margin-top:8px">the sketch sets the layout; the page's design language sets the style · lands as a new take</p>
  </div>`;
  document.body.appendChild(modal);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });

  modal.querySelector("#sk-close").onclick = close;
  modal.querySelector("#sk-clear").onclick = () => { push(); current.sk = EMPTY(); current.sel = null; draw(); };
  modal.querySelector("#sk-undo").onclick = undo;
  modal.querySelector("#sk-redo").onclick = redo;
  modal.querySelector("#sk-run").onclick = run;
  for (const b of modal.querySelectorAll("#sk-tools [data-tool]")) {
    b.onclick = () => { current.tool = b.dataset.tool; syncTools(); };
  }
  modal.addEventListener("keydown", onKeys, true);

  const svg = modal.querySelector("#sk-svg");
  svg.addEventListener("pointerdown", onDown);
  svg.addEventListener("pointermove", onMove);
  svg.addEventListener("pointerup", onUp);

  drawSizeSeg();
  draw();
  setTimeout(() => modal.querySelector(".sketch-card").focus?.(), 0);
}

function close() {
  persist();
  document.getElementById("sketch-modal")?.remove();
  current = null;
}

function onKeys(e) {
  e.stopPropagation();
  if (!current) return;
  const typing = document.activeElement?.tagName === "INPUT";
  if (e.key === "Escape") {
    if (current.tagFor) { current.tagFor = null; draw(); }
    else if (current.sel) { current.sel = null; draw(); }
    else close();
    return;
  }
  if (typing) return;
  const k = e.key.toLowerCase();
  if (k === "b") { current.tool = "box"; syncTools(); }
  else if (k === "p") { current.tool = "pen"; syncTools(); }
  else if (k === "t") { current.tool = "note"; syncTools(); }
  else if ((e.metaKey || e.ctrlKey) && k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if ((e.key === "Backspace" || e.key === "Delete") && current.sel) {
    e.preventDefault(); push();
    const { type, id } = current.sel;
    if (type === "box") current.sk.boxes = current.sk.boxes.filter((b) => b.id !== id);
    if (type === "note") current.sk.notes = current.sk.notes.filter((n) => n.id !== id);
    if (type === "stroke") current.sk.strokes = current.sk.strokes.filter((s) => s.id !== id);
    current.sel = null; current.tagFor = null;
    draw();
  }
}

function push() {
  current.undo.push(JSON.stringify(current.sk));
  if (current.undo.length > 40) current.undo.shift();
  current.redo = [];
}
function undo() {
  const s = current.undo.pop();
  if (!s) return;
  current.redo.push(JSON.stringify(current.sk));
  current.sk = JSON.parse(s); current.sel = null; current.tagFor = null;
  draw();
}
function redo() {
  const s = current.redo.pop();
  if (!s) return;
  current.undo.push(JSON.stringify(current.sk));
  current.sk = JSON.parse(s); current.sel = null;
  draw();
}

function syncTools() {
  for (const b of document.querySelectorAll("#sk-tools [data-tool]")) {
    b.classList.toggle("on", b.dataset.tool === current.tool);
  }
}

function drawSizeSeg() {
  const seg = document.getElementById("sk-size");
  seg.innerHTML = Object.keys(CANVAS_H)
    .map((s) => `<button data-size="${s}" class="${current.sk.size === s ? "on" : ""}">${s}</button>`).join("");
  for (const b of seg.querySelectorAll("[data-size]")) {
    b.onclick = () => {
      push();
      const H = CANVAS_H[b.dataset.size];
      // Re-fit marks so nothing silently vanishes below the new fold.
      for (const bx of current.sk.boxes) { bx.y = Math.min(bx.y, H - 2); bx.h = Math.min(bx.h, H - bx.y); }
      for (const n of current.sk.notes) n.y = Math.min(n.y, H - 1);
      for (const st of current.sk.strokes) for (const p of st.points) p.y = Math.min(p.y, H);
      current.sk.size = b.dataset.size;
      drawSizeSeg(); draw();
    };
  }
}

// pointer coords -> canvas units (x: 0..100, y: 0..H)
function toUnits(e) {
  const svg = document.getElementById("sk-svg");
  const r = svg.getBoundingClientRect();
  const H = CANVAS_H[current.sk.size];
  return {
    x: Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)),
    y: Math.max(0, Math.min(H, ((e.clientY - r.top) / r.height) * H)),
  };
}

function onDown(e) {
  if (!current || current.tagFor) return;
  const svg = document.getElementById("sk-svg");
  svg.setPointerCapture(e.pointerId);
  const p = toUnits(e);
  const hit = e.target.closest("[data-id]");

  if (hit) {
    const id = hit.dataset.id, type = hit.dataset.type;
    current.sel = { type, id };
    if (type === "box") {
      const b = current.sk.boxes.find((x) => x.id === id);
      const corner = e.target.dataset.corner;
      push();
      current.drag = corner ? { kind: "resize", b, corner } : { kind: "move", b, dx: p.x - b.x, dy: p.y - b.y };
    }
    draw();
    return;
  }

  if (current.tool === "box") {
    push();
    const b = { id: crypto.randomUUID().slice(0, 8), kind: "block", note: null, x: p.x, y: p.y, w: 0, h: 0 };
    current.sk.boxes.push(b);
    current.drag = { kind: "new", b, ox: p.x, oy: p.y };
    current.sel = { type: "box", id: b.id };
  } else if (current.tool === "pen") {
    push();
    const s = { id: crypto.randomUUID().slice(0, 8), points: [p] };
    current.sk.strokes.push(s);
    current.drag = { kind: "pen", s };
  } else if (current.tool === "note") {
    push();
    const text = prompt("note text");
    if (text?.trim()) current.sk.notes.push({ id: crypto.randomUUID().slice(0, 8), text: text.trim().slice(0, 120), x: p.x, y: p.y });
    else current.undo.pop();
  }
  draw();
}

function onMove(e) {
  if (!current?.drag) return;
  const p = toUnits(e);
  const d = current.drag;
  const H = CANVAS_H[current.sk.size];
  if (d.kind === "new") {
    d.b.x = Math.min(d.ox, p.x); d.b.y = Math.min(d.oy, p.y);
    d.b.w = Math.abs(p.x - d.ox); d.b.h = Math.abs(p.y - d.oy);
  } else if (d.kind === "move") {
    d.b.x = Math.max(0, Math.min(100 - d.b.w, p.x - d.dx));
    d.b.y = Math.max(0, Math.min(H - d.b.h, p.y - d.dy));
  } else if (d.kind === "resize") {
    if (d.corner.includes("e")) d.b.w = Math.max(2, p.x - d.b.x);
    if (d.corner.includes("s")) d.b.h = Math.max(2, p.y - d.b.y);
    if (d.corner.includes("w")) { const x2 = d.b.x + d.b.w; d.b.x = Math.min(p.x, x2 - 2); d.b.w = x2 - d.b.x; }
    if (d.corner.includes("n")) { const y2 = d.b.y + d.b.h; d.b.y = Math.min(p.y, y2 - 2); d.b.h = y2 - d.b.y; }
  } else if (d.kind === "pen") {
    d.s.points.push(p);
  }
  draw();
}

function onUp() {
  if (!current?.drag) return;
  const d = current.drag;
  current.drag = null;
  if (d.kind === "new") {
    if (d.b.w < MIN_BOX || d.b.h < MIN_BOX) {
      current.sk.boxes = current.sk.boxes.filter((x) => x !== d.b);
      current.sel = null; current.undo.pop();
    } else {
      current.tagFor = d.b.id; // auto-open the tagger for a fresh box
    }
  } else if (d.kind === "pen") {
    let len = 0;
    for (let i = 1; i < d.s.points.length; i++) {
      len += Math.hypot(d.s.points[i].x - d.s.points[i - 1].x, d.s.points[i].y - d.s.points[i - 1].y);
    }
    if (d.s.points.length < 3 || len <= 2.5) { current.sk.strokes.pop(); current.undo.pop(); }
  }
  persist();
  draw();
}

function draw() {
  const svg = document.getElementById("sk-svg");
  if (!svg || !current) return;
  const H = CANVAS_H[current.sk.size];
  svg.setAttribute("viewBox", `0 0 100 ${H}`);
  svg.style.aspectRatio = `100 / ${H}`;

  const selId = current.sel?.id;
  let out = "";
  for (const s of current.sk.strokes) {
    const dpath = s.points.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
    out += `<path data-id="${s.id}" data-type="stroke" d="${dpath}" fill="none" stroke="${selId === s.id ? "var(--accent)" : "#9a9284"}" stroke-width="0.45" stroke-linecap="round"/>`;
  }
  for (const b of current.sk.boxes) {
    const sel = selId === b.id;
    out += `<g data-id="${b.id}" data-type="box" style="cursor:move">
      <rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="0.8"
        fill="${sel ? "rgba(58,51,224,0.08)" : "rgba(58,51,224,0.04)"}"
        stroke="var(--accent)" stroke-width="${sel ? 0.5 : 0.3}" stroke-dasharray="1.6 1"/>
      <text x="${b.x + b.w / 2}" y="${b.y + b.h / 2}" text-anchor="middle" dominant-baseline="middle"
        font-size="2.6" fill="#5d564a" style="pointer-events:none;font-family:var(--mono)">${b.kind}${b.note ? " ✎" : ""}</text>
      ${sel ? ["nw", "ne", "sw", "se"].map((c) => {
        const cx = c.includes("e") ? b.x + b.w : b.x;
        const cy = c.includes("s") ? b.y + b.h : b.y;
        return `<rect data-id="${b.id}" data-type="box" data-corner="${c}" x="${cx - 1}" y="${cy - 1}" width="2" height="2" fill="var(--accent)" style="cursor:${c}-resize"/>`;
      }).join("") : ""}
    </g>`;
  }
  for (const n of current.sk.notes) {
    out += `<text data-id="${n.id}" data-type="note" x="${n.x}" y="${n.y}" font-size="2.8" fill="${selId === n.id ? "var(--accent)" : "#5d564a"}" style="cursor:pointer;font-family:var(--mono)">✎ ${String(n.text).slice(0, 40).replace(/[&<>]/g, "")}</text>`;
  }
  svg.innerHTML = out;
  renderTagger();
}

function renderTagger() {
  document.querySelector(".tagger")?.remove();
  if (!current?.tagFor) return;
  const b = current.sk.boxes.find((x) => x.id === current.tagFor);
  if (!b) { current.tagFor = null; return; }
  const canvas = document.querySelector(".sketch-canvas");
  const el = document.createElement("div");
  el.className = "tagger";
  const H = CANVAS_H[current.sk.size];
  el.style.left = Math.min(72, b.x) + "%";
  el.style.top = Math.min(84, ((b.y + b.h) / H) * 100) + "%";
  el.innerHTML = `
    <div class="row">${KINDS.map((k) => `<button class="chip ${b.kind === k ? "on" : ""}" data-k="${k}">${k}</button>`).join("")}</div>
    <input type="text" placeholder='says... e.g. "Start free trial"' value="${b.note ? String(b.note).replace(/"/g, "&quot;") : ""}">
    <div class="row" style="margin-top:6px;justify-content:space-between">
      <button class="chip" data-del="1">delete</button>
      <button class="chip on" data-done="1">done</button>
    </div>`;
  canvas.appendChild(el);
  el.addEventListener("click", (e) => {
    const k = e.target.dataset.k;
    if (k) { b.kind = k; persist(); draw(); }
    else if (e.target.dataset.del) { push(); current.sk.boxes = current.sk.boxes.filter((x) => x.id !== b.id); current.tagFor = null; current.sel = null; draw(); }
    else if (e.target.dataset.done) { current.tagFor = null; draw(); }
  });
  const input = el.querySelector("input");
  let snapped = false;
  input.addEventListener("input", () => {
    if (!snapped) { push(); snapped = true; } // one undo step per typing session
    b.note = input.value.trim() || null;
    persist();
  });
  input.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") { current.tagFor = null; draw(); } });
}

// ---------------------------------------------------------------------------
// run: blueprint + PNG -> request

async function rasterize() {
  const svg = document.getElementById("sk-svg");
  const H = CANVAS_H[current.sk.size];
  const clone = svg.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", "1000");
  clone.setAttribute("height", String(H * 10));
  // Inline the CSS variables the SVG leans on.
  clone.style.background = "#fffdf9";
  clone.innerHTML = clone.innerHTML.replaceAll("var(--accent)", "#3a33e0").replaceAll("var(--mono)", "monospace");
  const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = url; });
    const canvas = document.createElement("canvas");
    canvas.width = 1000; canvas.height = H * 10;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fffdf9";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png").split(",")[1];
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function run() {
  if (!current) return;
  const blueprint = serializeSketch(current.sk);
  if (!blueprint) { toast("sketch something first: a box or two is plenty"); return; }
  const note = document.getElementById("sk-note")?.value.trim();
  let png = null;
  try { png = await rasterize(); } catch { /* blueprint alone is fine */ }
  const slug = current.slug;
  persist();
  close();
  await request("sketch", { slug }, { blueprint, instruction: note || undefined }, png);
}
