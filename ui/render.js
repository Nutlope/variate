// DOM rendering for the studio. No framework: a per-slug frame cache keeps
// iframes alive across renders (an iframe reloads if the node moves, so DOM
// order is only touched when the section order actually changed), and all
// clicks flow through two delegated listeners via data-action attributes.

import { op, request, toast } from "/ui/api.js";
import { setState, store } from "/ui/app.js";
import { openSketch } from "/ui/sketch.js";

const KINDS = [
  ["features", "Features"], ["showcase", "Showcase"], ["stats", "Stats"],
  ["pricing", "Pricing"], ["faq", "FAQ"], ["logos", "Logo strip"],
  ["howitworks", "How it works"], ["cta", "Call to action"],
  ["waitlist", "Waitlist form"], ["footer", "Footer"],
];

const STEERS = ["calmer", "bolder", "airier", "denser", "playful"];

const SUGGESTIONS = {
  nav: ["Make it sticky with a blur", "Center the links", "Add a second CTA"],
  hero: ["Flip the layout", "Bigger, bolder headline", "Calmer, more whitespace"],
  features: ["Make it three columns", "Add small icons", "Tighter cards"],
  pricing: ["Highlight the middle tier", "Add a yearly toggle", "Simplify to two tiers"],
  footer: ["Add link columns", "Slimmer, quieter", "Echo the logo bigger"],
  cta: ["Make it a full-bleed band", "Punchier line", "Add the form inline"],
};
const GENERIC_SUGGESTIONS = ["More whitespace", "Simplify the layout", "Turn up the contrast"];

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------------------------------------------------------------------------
// scaffold + frame cache

const frames = new Map(); // slug -> {wrap, box, iframe, overlay, rawH, hash}
let lastOrderKey = "";
let scaffolded = false;
let stackEl, railEl, headEl;

function scaffold() {
  const app = document.getElementById("app");
  app.innerHTML = `
    <header class="bar">
      <span class="brand"><span class="dot"></span>variate</span>
      <span class="title" id="page-title"></span>
      <div class="right">
        <div class="seg" id="device-seg">
          <button data-action="device" data-w="1280">Desktop</button>
          <button data-action="device" data-w="768">Tablet</button>
          <button data-action="device" data-w="390">Mobile</button>
        </div>
      </div>
    </header>
    <main id="stack"></main>
    <aside id="rail"></aside>`;
  stackEl = document.getElementById("stack");
  railEl = document.getElementById("rail");
  headEl = document.getElementById("page-title");
  stackEl.addEventListener("click", onStackClick);
  railEl.addEventListener("click", onRailClick);
  railEl.addEventListener("mouseover", (e) => {
    const row = e.target.closest("[data-hi]");
    if (row && store.highlight !== row.dataset.hi) setState({ highlight: row.dataset.hi });
  });
  railEl.addEventListener("mouseout", (e) => {
    if (e.target.closest("[data-hi]") && !e.relatedTarget?.closest?.("[data-hi]")) setState({ highlight: null });
  });
  document.getElementById("device-seg").parentElement.addEventListener("click", onStackClick);
  window.addEventListener("message", onFrameMessage);
  window.addEventListener("resize", applyAllGeometry);
  window.addEventListener("variate:cut", (e) => cutSection(e.detail.slug));
  scaffolded = true;
}

function onFrameMessage(e) {
  if (!e.data || e.data.type !== "rb-h") return;
  for (const [, f] of frames) {
    if (f.iframe.contentWindow === e.source) {
      const h = Math.max(40, Math.min(6000, Number(e.data.h) || 0));
      if (Math.abs(h - f.rawH) < 2) return;
      f.rawH = h;
      applyGeometry(f);
      return;
    }
  }
}

function stackWidth() {
  return stackEl?.clientWidth || 900;
}

function applyGeometry(f) {
  const scale = Math.min(1, stackWidth() / store.device);
  f.iframe.style.width = store.device + "px";
  f.iframe.style.height = f.rawH + "px";
  f.iframe.style.transform = `scale(${scale})`;
  f.box.style.height = Math.round(f.rawH * scale) + "px";
}

function applyAllGeometry() {
  for (const [, f] of frames) applyGeometry(f);
}

// ---------------------------------------------------------------------------
// render

export function render(store_) {
  const st = store_.state;
  if (!st) return;
  if (!scaffolded) scaffold();

  headEl.textContent = st.title || (st.empty ? "an empty page, waiting for its brief" : "untitled");
  for (const b of document.querySelectorAll('#device-seg [data-action="device"]')) {
    b.classList.toggle("on", Number(b.dataset.w) === store_.device);
  }

  renderStack(st);
  renderRail(st);
}

function renderStack(st) {
  // Drop caches for sections that no longer exist.
  for (const slug of [...frames.keys()]) {
    if (!st.sections.some((s) => s.slug === slug)) { frames.get(slug).wrap.remove(); frames.delete(slug); }
  }

  const orderKey = st.sections.map((s) => s.slug).join("|") + "::" + (st.empty ? "empty" : "full") + "::" + !!st.manifestError;
  const needRebuild = orderKey !== lastOrderKey;
  lastOrderKey = orderKey;

  if (st.empty) {
    stackEl.innerHTML = `<div class="empty-state">
      <h2>Nothing on the page yet.</h2>
      <p>Ask your agent to bootstrap it: describe the product, and it writes the design system and the first sections here.</p>
    </div>`;
    frames.clear();
    return;
  }

  if (needRebuild) {
    // Full re-append in the new order (iframes for moved sections reload; that
    // is the accepted cost of reordering).
    stackEl.textContent = "";
    if (st.manifestError) {
      const b = document.createElement("div");
      b.className = "banner";
      b.textContent = st.manifestError;
      stackEl.appendChild(b);
    }
    st.sections.forEach((s, i) => {
      stackEl.appendChild(makeInsert(i));
      stackEl.appendChild(ensureFrame(s).wrap);
    });
    stackEl.appendChild(makeInsert(st.sections.length));
  }

  st.sections.forEach((s) => {
    const f = ensureFrame(s);
    if (f.hash !== s.hash) {
      f.hash = s.hash;
      f.iframe.src = `/frame/${encodeURIComponent(s.slug)}?v=${s.hash}`;
      if (store.landed.has(s.slug)) {
        f.box.classList.remove("take-landed");
        void f.box.offsetWidth;
        f.box.classList.add("take-landed");
      }
    }
    f.wrap.classList.toggle("selected", store.selected === s.slug);
    f.wrap.classList.toggle("hi", store.highlight === s.slug);
    renderOverlay(f, s, st);
    applyGeometry(f);
  });

  // Insert menus reflect open state.
  for (const el of stackEl.querySelectorAll(".insert")) {
    const idx = Number(el.dataset.index);
    const open = store.openInsert === idx;
    el.classList.toggle("open", open);
    el.querySelector(".pop")?.remove();
    if (open) el.appendChild(insertMenu(idx));
  }
}

function ensureFrame(s) {
  let f = frames.get(s.slug);
  if (f) return f;
  const wrap = document.createElement("div");
  wrap.className = "frame-wrap";
  wrap.dataset.slug = s.slug;
  const box = document.createElement("div");
  box.className = "frame-box";
  box.style.height = "300px";
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts"); // never allow-same-origin
  iframe.setAttribute("title", `${s.slug} preview`);
  const overlay = document.createElement("div");
  box.appendChild(iframe);
  wrap.appendChild(box);
  wrap.appendChild(overlay);
  wrap.addEventListener("click", (e) => {
    if (e.target.closest(".toolbar") || e.target.closest(".pop")) return;
    setState({ selected: s.slug, openMenu: null, openInsert: null });
  });
  f = { wrap, box, iframe, overlay, rawH: 300, hash: null };
  frames.set(s.slug, f);
  return f;
}

function renderOverlay(f, s, st) {
  const menu = store.openMenu?.slug === s.slug ? store.openMenu.kind : null;
  const busy = s.busy;
  const idx = st.sections.findIndex((x) => x.slug === s.slug);
  const elapsed = busy?.claimedAt ? Math.round((Date.now() - busy.claimedAt) / 1000) : null;
  const stalled = elapsed != null && elapsed > 600;

  f.overlay.innerHTML = `
    <div class="slug-chip">
      <span>${esc(s.slug)}</span>
      ${s.takes > 1 ? `<span style="opacity:.65">take ${s.active + 1}/${s.takes}</span>` : ""}
      ${s.warning ? `<span class="warn" title="${esc(s.warning)}">⚠</span>` : ""}
    </div>
    ${busy ? `
      <div class="progress-slide"></div>
      <div class="busy-veil"><div class="busy-strip">
        <span class="pulse"></span>
        <span>${esc(busy.label ?? busy.type)}</span>
        <span style="opacity:.6">${elapsed != null ? elapsed + "s" : "queued"}</span>
        ${stalled ? `<button data-action="requeue" data-req="${esc(busy.reqId)}" style="margin-left:auto;color:#fbbf24">stalled? re-queue</button>` : ""}
      </div></div>` : `
      <div class="toolbar ${menu ? "open" : ""}">
        ${s.takes > 1 ? `<div class="grp">
          <button data-action="cycle" data-slug="${esc(s.slug)}" data-dir="-1" aria-label="previous take">‹</button>
          <button disabled style="padding:6px 4px">${s.active + 1}/${s.takes}</button>
          <button data-action="cycle" data-slug="${esc(s.slug)}" data-dir="1" aria-label="next take">›</button>
        </div>` : ""}
        <div class="grp">
          <button class="primary" data-action="variate" data-slug="${esc(s.slug)}">variate ×${store.variateCount}</button>
          <button class="primary" data-action="menu" data-slug="${esc(s.slug)}" data-kind="variate" aria-label="variate options" style="padding:6px 7px">▾</button>
        </div>
        <div class="grp">
          <button data-action="sketch" data-slug="${esc(s.slug)}">sketch</button>
          <button data-action="menu" data-slug="${esc(s.slug)}" data-kind="prompt">prompt</button>
        </div>
        <div class="grp">
          <button data-action="move" data-slug="${esc(s.slug)}" data-dir="up" ${idx === 0 ? "disabled" : ""} aria-label="move up">↑</button>
          <button data-action="move" data-slug="${esc(s.slug)}" data-dir="down" ${idx === st.sections.length - 1 ? "disabled" : ""} aria-label="move down">↓</button>
          <button data-action="cut" data-slug="${esc(s.slug)}" aria-label="remove section">✕</button>
        </div>
      </div>
      ${menu === "variate" ? variateMenu(s) : ""}
      ${menu === "prompt" ? promptMenu(s) : ""}`}
  `;

  if (menu === "prompt") {
    const ta = f.overlay.querySelector("textarea");
    ta?.focus();
    ta?.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitPrompt(s.slug, f.overlay); }
      if (e.key === "Escape") setState({ openMenu: null });
    });
  }
}

function variateMenu(s) {
  return `<div class="pop" data-slug="${esc(s.slug)}">
    <p class="cap">takes at once</p>
    <div class="row" style="margin:7px 0 11px">
      ${[1, 2, 3, 4].map((n) => `<button class="chip ${store.variateCount === n ? "on" : ""}" data-action="count" data-n="${n}">${n}</button>`).join("")}
    </div>
    <p class="cap">steer the take${store.variateCount > 1 ? "s" : ""}</p>
    <div class="row" style="margin-top:7px">
      ${STEERS.map((k) => `<button class="chip" data-action="steer" data-slug="${esc(s.slug)}" data-steer="${k}">${k} ×${store.variateCount}</button>`).join("")}
    </div>
  </div>`;
}

function promptMenu(s) {
  const base = s.slug.replace(/-\d+$/, "");
  const sugg = [...(SUGGESTIONS[base] ?? []), ...GENERIC_SUGGESTIONS].slice(0, 3);
  return `<div class="pop" data-slug="${esc(s.slug)}">
    <textarea rows="2" placeholder='Only ${esc(s.slug)} changes, e.g. "${esc(sugg[0])}"'></textarea>
    <div class="row" style="margin:8px 0">
      ${sugg.map((x) => `<button class="chip" data-action="fill" data-text="${esc(x)}">${esc(x)}</button>`).join("")}
    </div>
    <div style="display:flex;align-items:center;gap:10px">
      <button class="go" data-action="prompt-go" data-slug="${esc(s.slug)}">draw it</button>
      <span class="hint">↵ draw · esc close</span>
    </div>
  </div>`;
}

function makeInsert(index) {
  const el = document.createElement("div");
  el.className = "insert";
  el.dataset.index = String(index);
  el.innerHTML = `<span class="hair"></span><button class="plus" data-action="insert" data-index="${index}" aria-label="add a section here">+</button>`;
  return el;
}

function insertMenu(index) {
  const el = document.createElement("div");
  el.className = "pop";
  el.innerHTML = `
    <p class="cap">add a section here, drawn in this design's language</p>
    <div class="row" style="margin:9px 0">
      ${KINDS.map(([k, label]) => `<button class="chip" data-action="add-kind" data-kind="${k}" data-index="${index}">${label}</button>`).join("")}
    </div>
    <div style="display:flex;gap:6px">
      <input type="text" placeholder="or describe one: a comparison vs spreadsheets...">
      <button class="go" data-action="add-custom" data-index="${index}">draw it</button>
    </div>`;
  const input = el.querySelector("input");
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") addSection(index, null, input.value);
    if (e.key === "Escape") setState({ openInsert: null });
  });
  setTimeout(() => input.focus(), 30);
  return el;
}

// ---------------------------------------------------------------------------
// actions

function positionFor(index) {
  const secs = store.state.sections;
  if (index <= 0) return "start";
  if (index >= secs.length) return "end";
  return "after:" + secs[index - 1].slug;
}

function addSection(index, kind, custom) {
  const params = kind ? { kind, position: positionFor(index) } : { instruction: (custom ?? "").trim(), position: positionFor(index) };
  if (!kind && !params.instruction) return;
  request("add", null, params).catch(() => {});
  setState({ openInsert: null });
}

function cutSection(slug) {
  op({ op: "cut", slug }).then(() => {
    setState({ selected: null });
    toast(`removed ${slug}`, { label: "undo", run: () => op({ op: "undo" }).catch(() => {}) });
  }).catch(() => {});
}

function submitPrompt(slug, overlayEl) {
  const ta = overlayEl.querySelector("textarea");
  const text = ta?.value.trim();
  if (!text) return;
  request("instruct", { slug }, { instruction: text }).catch(() => {});
  setState({ openMenu: null });
}

function onStackClick(e) {
  const b = e.target.closest("[data-action]");
  if (!b) return;
  const a = b.dataset.action;
  const slug = b.dataset.slug;

  if (a === "device") setState({ device: Number(b.dataset.w) });
  else if (a === "cycle") {
    const s = store.state.sections.find((x) => x.slug === slug);
    const next = ((s.active + Number(b.dataset.dir)) % s.takes + s.takes) % s.takes;
    op({ op: "pick", slug, take: next }).catch(() => {});
  }
  else if (a === "variate") { request("variate", { slug }, { count: store.variateCount }).catch(() => {}); setState({ openMenu: null }); }
  else if (a === "steer") { request("variate", { slug }, { count: store.variateCount, steer: b.dataset.steer }).catch(() => {}); setState({ openMenu: null }); }
  else if (a === "count") setState({ variateCount: Number(b.dataset.n) });
  else if (a === "menu") setState({ openMenu: store.openMenu?.slug === slug && store.openMenu.kind === b.dataset.kind ? null : { slug, kind: b.dataset.kind }, selected: slug, openInsert: null });
  else if (a === "sketch") { setState({ openMenu: null }); openSketch(slug); }
  else if (a === "prompt-go") submitPrompt(slug, b.closest(".pop").parentElement);
  else if (a === "fill") { const ta = b.closest(".pop").querySelector("textarea"); ta.value = b.dataset.text; ta.focus(); }
  else if (a === "move") op({ op: "move", slug, dir: b.dataset.dir }).catch(() => {});
  else if (a === "cut") cutSection(slug);
  else if (a === "insert") setState({ openInsert: store.openInsert === Number(b.dataset.index) ? null : Number(b.dataset.index), openMenu: null });
  else if (a === "add-kind") addSection(Number(b.dataset.index), b.dataset.kind, null);
  else if (a === "add-custom") addSection(Number(b.dataset.index), null, b.closest(".pop").querySelector("input").value);
  else if (a === "requeue") fetch(`/api/request?requeue=${encodeURIComponent(b.dataset.req)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
}

// ---------------------------------------------------------------------------
// rail

function renderRail(st) {
  const extra = st.sections.reduce((n, s) => n + Math.max(0, s.takes - 1), 0);
  const awaitCmd = `node <skill>/scripts/await.mjs --ws ${st.ws}`;
  railEl.innerHTML = `
    <div class="card">
      <h4 class="cap">the page · ${st.sections.length} section${st.sections.length === 1 ? "" : "s"}${extra ? ` · ${extra} extra take${extra === 1 ? "" : "s"}` : ""}</h4>
      ${st.sections.map((s) => `
        <div class="rail-row ${s.busy ? "busy" : ""} ${store.selected === s.slug ? "sel" : ""}" data-hi="${esc(s.slug)}" data-action="jump" data-slug="${esc(s.slug)}">
          <span class="dot"></span>${esc(s.slug)}
          ${s.warning ? `<span title="${esc(s.warning)}">⚠</span>` : ""}
          <span class="mini">
            <button data-action="rail-up" data-slug="${esc(s.slug)}" aria-label="move up">↑</button>
            <button data-action="rail-down" data-slug="${esc(s.slug)}" aria-label="move down">↓</button>
            <button data-action="rail-cut" data-slug="${esc(s.slug)}" aria-label="remove">✕</button>
          </span>
          <span class="n">${s.busy ? "drawing" : s.takes > 1 ? "×" + s.takes : ""}</span>
        </div>`).join("")}
      <p class="hint" style="margin-top:8px">hover a section for tools · ←/→ takes · ⌥↑↓ move · ⌫ cut</p>
    </div>

    ${st.queue.length || st.working.length || st.recentDone.length ? `<div class="card">
      <h4 class="cap">asks for the agent</h4>
      ${st.working.map((q) => `<div class="qchip working"><span class="st">drawing</span>${esc(q.label)}</div>`).join("")}
      ${st.queue.map((q) => `<div class="qchip"><span class="st">queued</span>${esc(q.label)}</div>`).join("")}
      ${st.recentDone.slice(0, 4).map((d) => `<div class="qchip ${esc(d.result)}"><span class="st">${esc(d.result)}</span>${esc(d.note || d.type)}</div>`).join("")}
    </div>` : ""}

    <div class="card">
      <h4 class="cap">page actions</h4>
      <div class="action-row">
        <button class="action" data-action="undo" ${st.canUndo ? "" : "disabled"}>↩ undo</button>
        <button class="action" data-action="redo" ${st.canRedo ? "" : "disabled"}>↪ redo</button>
      </div>
      <button class="action" data-action="polish" ${st.working.length ? "disabled" : ""}>Polish the seams</button>
      <button class="action" data-action="preview">Preview the full page ↗</button>
      <button class="action" data-action="export">Export dist/index.html</button>
      <button class="action primary" data-action="done" ${st.working.length ? "disabled" : ""}>Done building</button>
    </div>

    <div class="card">
      <div class="presence ${st.agent.listening ? "on" : ""}">
        <span class="dot"></span>${st.agent.listening ? "agent standing by" : "agent not connected"}
      </div>
      ${st.agent.listening ? "" : `<code>${esc(awaitCmd)}</code>`}
    </div>

    ${st.activity.length ? `<div class="card">
      <h4 class="cap">activity</h4>
      <div class="feed">
        ${st.activity.slice(0, 24).map((a) => `<div><span class="t">${esc(a.ts?.slice(11, 19) ?? "")}</span>${esc(a.label)}</div>`).join("")}
      </div>
    </div>` : ""}
  `;
}

function onRailClick(e) {
  const b = e.target.closest("[data-action]");
  if (!b) return;
  const a = b.dataset.action;
  const slug = b.dataset.slug;
  if (a === "jump") {
    setState({ selected: slug });
    frames.get(slug)?.wrap.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  else if (a === "rail-up") { e.stopPropagation(); op({ op: "move", slug, dir: "up" }).catch(() => {}); }
  else if (a === "rail-down") { e.stopPropagation(); op({ op: "move", slug, dir: "down" }).catch(() => {}); }
  else if (a === "rail-cut") { e.stopPropagation(); cutSection(slug); }
  else if (a === "undo") op({ op: "undo" }).catch(() => {});
  else if (a === "redo") op({ op: "redo" }).catch(() => {});
  else if (a === "polish") { request("polish", null, {}).catch(() => {}); toast("polish queued for the agent"); }
  else if (a === "preview") window.open("/page", "_blank");
  else if (a === "export") fetch("/api/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then(() => toast("exported dist/index.html"));
  else if (a === "done") { request("done", null, {}).catch(() => {}); toast("told the agent you are done; it will wrap up and export"); }
}
