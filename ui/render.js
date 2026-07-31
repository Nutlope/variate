// DOM rendering for the studio. No framework, but the discipline of one:
// nothing the user is interacting with is ever destroyed by a render.
//
//  - Frames (iframes) are created once per page/section and reused; DOM order
//    is only touched when the active page's section order changes.
//  - Each frame's chrome is built once; renders update it in place via refs.
//  - Popovers (prompt textarea, variate menu, insert input, add-page) live
//    OUTSIDE the render cycle: never recreated while open, so typing survives.
//  - The rail re-renders only when its signature changes; the 1s tick updates
//    only busy timers.

import { op, request, toast } from "/ui/api.js";
import { setState, store, curPage } from "/ui/app.js";
import { openSketch, isSketching } from "/ui/sketch.js";
import { mountTokens, syncTokens } from "/ui/tokens.js";

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
const GENERIC = ["More whitespace", "Simplify the layout", "Turn up the contrast"];

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const slugify = (s) => String(s ?? "").toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-{2,}/g, "-").replace(/^-|-$/g, "");

// ---------------------------------------------------------------------------
// module state

const frames = new Map(); // "<pageId>/<slug>" -> { wrap, box, iframe, chrome, busyEl, hash, rawH }
let openPop = null;       // { key: "<pageId>/<slug>" | "@add-page", kind, el }
let openInsert = null;    // { index, el }
let railSig = "";
let stackKey = "";
let scaffolded = false;
let tokensMounted = false;
let stackEl, railEl, railA, railB, titleEl, deviceSeg, pageSeg;

const fkey = (slug) => (curPage()?.id ?? "index") + "/" + slug;

/** Post a message to every live frame iframe (token overrides, edit toggle). */
export function postToFrames(msg) {
  for (const [, f] of frames) f.iframe.contentWindow?.postMessage(msg, "*");
}

// ---------------------------------------------------------------------------
// scaffold (once)

function scaffold() {
  const app = document.getElementById("app");
  app.innerHTML = `
    <header class="bar">
      <span class="brand"><span class="dot"></span>variate</span>
      <span class="title" id="page-title"></span>
      <div class="right">
        <div class="seg" id="page-seg"></div>
        <div class="seg" id="device-seg">
          <button data-action="device" data-w="1280">Desktop</button>
          <button data-action="device" data-w="768">Tablet</button>
          <button data-action="device" data-w="390">Mobile</button>
        </div>
      </div>
    </header>
    <main id="stack"></main>
    <aside id="rail">
      <div id="rail-a"></div>
      <div id="tokens-card"></div>
      <div id="rail-b"></div>
    </aside>`;
  stackEl = document.getElementById("stack");
  railEl = document.getElementById("rail");
  railA = document.getElementById("rail-a");
  railB = document.getElementById("rail-b");
  titleEl = document.getElementById("page-title");
  deviceSeg = document.getElementById("device-seg");
  pageSeg = document.getElementById("page-seg");

  stackEl.addEventListener("click", onStackClick);
  railEl.addEventListener("click", onRailClick);
  railEl.addEventListener("mouseover", (e) => {
    const row = e.target.closest("[data-hi]");
    if (row && store.highlight !== row.dataset.hi) setHighlight(row.dataset.hi);
  });
  railEl.addEventListener("mouseout", (e) => {
    if (e.target.closest("[data-hi]") && !e.relatedTarget?.closest?.("[data-hi]")) setHighlight(null);
  });
  deviceSeg.addEventListener("click", (e) => {
    const b = e.target.closest("[data-action='device']");
    if (b) setState({ device: Number(b.dataset.w) });
  });
  pageSeg.addEventListener("click", onPageSegClick);

  window.addEventListener("message", onFrameMessage);
  window.addEventListener("resize", () => { for (const [, f] of frames) applyGeometry(f); });
  window.addEventListener("variate:cut", (e) => cutSection(e.detail.slug));

  // Drop an image anywhere on the stack: it lands in assets/ and the path is
  // copied so the user can hand it straight to the agent ("use assets/x.png").
  stackEl.addEventListener("dragover", (e) => { e.preventDefault(); stackEl.classList.add("dropping"); });
  stackEl.addEventListener("dragleave", (e) => { if (!stackEl.contains(e.relatedTarget)) stackEl.classList.remove("dropping"); });
  stackEl.addEventListener("drop", async (e) => {
    e.preventDefault();
    stackEl.classList.remove("dropping");
    const files = [...(e.dataTransfer?.files ?? [])].filter((f) => /image\//.test(f.type) || /\.(png|jpe?g|webp|svg|gif|ico|avif)$/i.test(f.name));
    if (!files.length) return;
    for (const file of files) {
      try {
        const base64 = await new Promise((ok, bad) => {
          const r = new FileReader();
          r.onload = () => ok(String(r.result).split(",")[1]);
          r.onerror = bad;
          r.readAsDataURL(file);
        });
        const res = await fetch("/api/asset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: file.name, base64 }) });
        const data = await res.json();
        if (!res.ok) { toast(data.error ?? "upload failed"); continue; }
        try { await navigator.clipboard.writeText(data.path); } catch { /* clipboard optional */ }
        toast(`saved ${data.path} (path copied): tell your agent where to use it`);
      } catch { toast(`could not read ${file.name}`); }
    }
  });

  // Click anywhere that is not a popover or a menu trigger closes menus.
  document.addEventListener("mousedown", (e) => {
    if (e.target.closest(".pop") || e.target.closest("[data-action='menu']") || e.target.closest("[data-action='insert']") || e.target.closest("[data-action='add-page']")) return;
    if (openPop || openInsert) setState({ openMenu: null, openInsert: null });
  }, true);

  scaffolded = true;
}

function setHighlight(slug) {
  store.highlight = slug;
  for (const [key, f] of frames) f.wrap.classList.toggle("hi", key === fkey(slug) && store.selected !== slug);
}

// ---------------------------------------------------------------------------
// geometry

function onFrameMessage(e) {
  if (!e.data) return;
  if (e.data.type === "rb-h") {
    for (const [, f] of frames) {
      if (f.iframe.contentWindow === e.source) {
        const h = Math.max(40, Math.min(6000, Number(e.data.h) || 0));
        if (Math.abs(h - f.rawH) < 2) return;
        f.rawH = h;
        applyGeometry(f);
        return;
      }
    }
  } else if (e.data.type === "rb-edited") {
    for (const [key, f] of frames) {
      if (f.iframe.contentWindow === e.source) {
        const [page, slug] = key.split("/");
        editing.delete(key);
        f.wrap.classList.remove("editing");
        fetch("/api/text", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ page, slug, markup: e.data.markup }) })
          .then((r) => r.json()).then((res) => { if (res.ok) toast(`saved your text edits to ${slug} as a new take`); }).catch(() => {});
        return;
      }
    }
  }
}

function stackWidth() { return stackEl?.clientWidth || 900; }

function applyGeometry(f) {
  if (f.sketching) return; // sketch owns the frame geometry while active
  const scale = Math.min(1, stackWidth() / store.device);
  f.iframe.style.width = store.device + "px";
  f.iframe.style.height = f.rawH + "px";
  f.iframe.style.transform = `scale(${scale})`;
  f.box.style.height = Math.round(f.rawH * scale) + "px";
}

// ---------------------------------------------------------------------------
// render entry

export function render() {
  const st = store.state;
  if (!st) return;
  if (!scaffolded) scaffold();

  const pg = curPage();
  titleEl.textContent = st.title || (st.empty ? "an empty site, waiting for its brief" : "untitled");
  for (const b of deviceSeg.children) b.classList.toggle("on", Number(b.dataset.w) === store.device);
  renderPageTabs(st, pg);

  reconcileFrames(st, pg);
  if (pg) {
    for (const s of pg.sections) {
      const f = frames.get(pg.id + "/" + s.slug);
      if (f) updateFrame(f, s, pg);
    }
  }
  syncPopover();
  syncInsert();
  renderRail(st, pg);
  if (!tokensMounted) { mountTokens(document.getElementById("tokens-card")); tokensMounted = true; }
  syncTokens(st.headHash);
}

// 1s tick: only the live-changing bits (busy elapsed), never structure.
export function tickLive() {
  const pg = curPage();
  if (!pg) return;
  for (const s of pg.sections) {
    const f = frames.get(pg.id + "/" + s.slug);
    if (f?.busyEl && s.busy?.claimedAt) {
      const el = f.busyEl.querySelector("[data-elapsed]");
      if (el) el.textContent = Math.round((Date.now() - s.busy.claimedAt) / 1000) + "s";
    }
  }
}

// ---------------------------------------------------------------------------
// page tabs

function renderPageTabs(st, pg) {
  const want = st.pages.map((p) => `${p.id}:${p.id === pg?.id ? 1 : 0}`).join("|");
  if (pageSeg.dataset.sig === want) return;
  pageSeg.dataset.sig = want;
  pageSeg.innerHTML = st.pages.map((p) =>
    `<button data-page="${esc(p.id)}" class="${p.id === pg?.id ? "on" : ""}" title="${esc(p.title)}">${esc(p.title || p.id)}</button>`
  ).join("") + `<button data-action="add-page" title="add a page">+</button>`;
}

function onPageSegClick(e) {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.page) {
    setState({ page: b.dataset.page, selected: null, openMenu: null, openInsert: null });
  } else if (b.dataset.action === "add-page") {
    setState({ openMenu: openPop?.key === "@add-page" ? null : { kind: "add-page" }, openInsert: null });
  }
}

function addPageMenu() {
  const el = document.createElement("div");
  el.className = "pop";
  el.style.right = "12px";
  el.style.top = "52px";
  el.innerHTML = `
    <p class="cap">add a page</p>
    <input type="text" placeholder="Page title, e.g. About" style="margin:8px 0">
    <div style="display:flex;align-items:center;gap:10px">
      <button class="go" data-add-page-go>ask the agent to draft it</button>
      <span class="hint">it lands with a nav + hero to start</span>
    </div>`;
  const input = el.querySelector("input");
  const go = () => {
    const title = input.value.trim();
    if (!title) return;
    const id = slugify(title) || "page";
    request("page", null, { id, title }).catch(() => {});
    toast(`asked the agent to draft the ${title} page`);
    setState({ openMenu: null });
  };
  el.querySelector("[data-add-page-go]").addEventListener("click", go);
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") go();
    if (e.key === "Escape") setState({ openMenu: null });
  });
  setTimeout(() => input.focus(), 30);
  return el;
}

// ---------------------------------------------------------------------------
// frames

function reconcileFrames(st, pg) {
  const wantKeys = new Set((pg?.sections ?? []).map((s) => pg.id + "/" + s.slug));
  for (const key of [...frames.keys()]) {
    if (!wantKeys.has(key)) {
      frames.get(key).wrap.remove();
      frames.delete(key);
      if (openPop?.key === key) { openPop.el.remove(); openPop = null; }
    }
  }

  if (!pg || pg.sections.length === 0) {
    const label = st.empty ? "Nothing on the site yet." : `Nothing on ${pg?.title ?? "this page"} yet.`;
    const key = "EMPTY:" + (pg?.id ?? "-");
    if (stackKey !== key) {
      stackEl.textContent = "";
      const d = document.createElement("div");
      d.className = "empty-state";
      d.innerHTML = `<h2>${esc(label)}</h2><p>Ask your agent to draft it: describe what this ${st.empty ? "site" : "page"} is for, and sections land here as they are written.</p>`;
      stackEl.appendChild(d);
      stackKey = key;
    }
    return;
  }

  const key = pg.id + "::" + pg.sections.map((s) => s.slug).join("|") + (st.manifestError ? "|err" : "");
  if (key === stackKey) return; // order unchanged: leave DOM alone (no reloads)
  stackKey = key;

  stackEl.textContent = "";
  if (st.manifestError) {
    const b = document.createElement("div");
    b.className = "banner";
    b.textContent = st.manifestError;
    stackEl.appendChild(b);
  }
  pg.sections.forEach((s, i) => {
    stackEl.appendChild(makeInsert(i));
    stackEl.appendChild(ensureFrame(pg.id, s).wrap);
  });
  stackEl.appendChild(makeInsert(pg.sections.length));
}

function ensureFrame(pageId, s) {
  const key = pageId + "/" + s.slug;
  let f = frames.get(key);
  if (f) return f;

  const wrap = document.createElement("div");
  wrap.className = "frame-wrap";
  wrap.dataset.slug = s.slug;
  wrap.dataset.page = pageId;

  const box = document.createElement("div");
  box.className = "frame-box";
  box.style.height = "300px";

  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts"); // never allow-same-origin
  iframe.setAttribute("title", `${s.slug} preview`);
  box.appendChild(iframe);

  const chrome = buildChrome(s.slug);
  wrap.appendChild(box);
  wrap.appendChild(chrome.root);

  f = { wrap, box, iframe, chrome, busyEl: null, hash: null, rawH: 300, sketching: false };
  frames.set(key, f);
  return f;
}

// Chrome built once; updateFrame twiddles the stored refs.
function buildChrome(slug) {
  const root = document.createElement("div");
  root.innerHTML = `
    <div class="slug-chip">
      <span data-slug-name></span>
      <span data-take-count style="opacity:.65"></span>
      <span class="warn" data-warn hidden title="">⚠</span>
    </div>
    <div class="toolbar">
      <div class="grp" data-pager hidden>
        <button data-action="cycle" data-slug="${esc(slug)}" data-dir="-1" aria-label="previous take">‹</button>
        <button disabled data-pager-text style="padding:6px 4px"></button>
        <button data-action="cycle" data-slug="${esc(slug)}" data-dir="1" aria-label="next take">›</button>
        <button data-action="compare" data-slug="${esc(slug)}" title="compare all takes">⊞</button>
        <button data-action="discard" data-slug="${esc(slug)}" title="discard this take">⌫</button>
      </div>
      <div class="grp">
        <button class="primary" data-action="variate" data-slug="${esc(slug)}"><span data-variate-label>variate ×1</span></button>
        <button class="primary" data-action="menu" data-slug="${esc(slug)}" data-kind="variate" aria-label="variate options" style="padding:6px 7px">▾</button>
      </div>
      <div class="grp">
        <button data-action="edit" data-slug="${esc(slug)}" title="edit text in place">text</button>
        <button data-action="sketch" data-slug="${esc(slug)}">sketch</button>
        <button data-action="menu" data-slug="${esc(slug)}" data-kind="prompt">prompt</button>
      </div>
      <div class="grp">
        <button data-action="move" data-slug="${esc(slug)}" data-dir="up" aria-label="move up">↑</button>
        <button data-action="move" data-slug="${esc(slug)}" data-dir="down" aria-label="move down">↓</button>
        <button data-action="cut" data-slug="${esc(slug)}" aria-label="remove section">✕</button>
      </div>
    </div>`;
  return {
    root,
    name: root.querySelector("[data-slug-name]"),
    takeCount: root.querySelector("[data-take-count]"),
    warn: root.querySelector("[data-warn]"),
    pager: root.querySelector("[data-pager]"),
    pagerText: root.querySelector("[data-pager-text]"),
    variateLabel: root.querySelector("[data-variate-label]"),
    up: root.querySelector('[data-action="move"][data-dir="up"]'),
    down: root.querySelector('[data-action="move"][data-dir="down"]'),
    toolbar: root.querySelector(".toolbar"),
  };
}

function updateFrame(f, s, pg) {
  const idx = pg.sections.findIndex((x) => x.slug === s.slug);
  const c = f.chrome;
  const key = pg.id + "/" + s.slug;

  f.wrap.classList.toggle("selected", store.selected === s.slug);
  f.wrap.classList.toggle("hi", store.highlight === s.slug && store.selected !== s.slug);
  f.wrap.classList.toggle("busy", !!s.busy);

  c.name.textContent = s.slug;
  c.takeCount.textContent = s.takes > 1 ? `take ${s.active + 1}/${s.takes}` : "";
  c.warn.hidden = !s.warning;
  if (s.warning) c.warn.title = s.warning;

  c.pager.hidden = s.takes < 2;
  if (s.takes >= 2) c.pagerText.textContent = `${s.active + 1}/${s.takes}`;
  c.variateLabel.textContent = `variate ×${store.variateCount}`;
  c.up.disabled = idx === 0;
  c.down.disabled = idx === pg.sections.length - 1;

  // busy layer
  if (s.busy) {
    if (!f.busyEl) {
      f.busyEl = document.createElement("div");
      f.busyEl.innerHTML = `<div class="progress-slide"></div><div class="busy-veil"><div class="busy-strip"><span class="pulse"></span><span data-label></span><span style="opacity:.6" data-elapsed>queued</span><span data-stall></span></div></div>`;
      f.box.appendChild(f.busyEl);
    }
    f.busyEl.querySelector("[data-label]").textContent = s.busy.label ?? s.busy.type;
    const el = s.busy.claimedAt ? Math.round((Date.now() - s.busy.claimedAt) / 1000) : null;
    f.busyEl.querySelector("[data-elapsed]").textContent = el != null ? el + "s" : "queued";
    const stall = f.busyEl.querySelector("[data-stall]");
    stall.innerHTML = el != null && el > 600
      ? `<button data-action="requeue" data-req="${esc(s.busy.reqId)}" style="margin-left:auto;color:#fbbf24">stalled? re-queue</button>` : "";
  } else if (f.busyEl) {
    f.busyEl.remove();
    f.busyEl = null;
  }

  // iframe reload only on content-hash change
  if (f.hash !== s.hash) {
    const first = f.hash === null;
    f.hash = s.hash;
    f.iframe.src = `/frame/${encodeURIComponent(pg.id)}/${encodeURIComponent(s.slug)}?v=${s.hash}`;
    if (!first && store.landed.has(key)) {
      f.box.classList.remove("take-landed");
      void f.box.offsetWidth;
      f.box.classList.add("take-landed");
    }
  }
  applyGeometry(f);
}

// ---------------------------------------------------------------------------
// popovers (managed outside render; never recreated while open)

function syncPopover() {
  const want = store.openMenu; // { slug, kind } | { kind: "add-page" } | null
  if (!want) { if (openPop) { openPop.el.remove(); openPop = null; } return; }

  if (want.kind === "add-page") {
    if (openPop?.key === "@add-page") return;
    if (openPop) openPop.el.remove();
    const el = addPageMenu();
    document.querySelector("header.bar").appendChild(el);
    openPop = { key: "@add-page", kind: "add-page", el };
    return;
  }

  const key = fkey(want.slug);
  if (openPop && openPop.key === key && openPop.kind === want.kind) {
    if (want.kind === "variate") refreshVariateMenu(openPop.el); // safe: no user text
    return;
  }
  if (openPop) openPop.el.remove();
  const f = frames.get(key);
  if (!f) { openPop = null; return; }
  const el = want.kind === "variate" ? variateMenu(want.slug) : promptMenu(want.slug);
  f.wrap.appendChild(el);
  openPop = { key, kind: want.kind, el };
  if (want.kind === "prompt") {
    const ta = el.querySelector("textarea");
    ta?.focus();
    ta?.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitPrompt(want.slug); }
      if (e.key === "Escape") setState({ openMenu: null });
    });
  }
}

function promptMenu(slug) {
  const base = slug.replace(/-\d+$/, "");
  const sugg = [...(SUGGESTIONS[base] ?? []), ...GENERIC].slice(0, 3);
  const el = document.createElement("div");
  el.className = "pop";
  el.innerHTML = `
    <textarea rows="2" placeholder='Only ${esc(slug)} changes, e.g. "${esc(sugg[0])}"'></textarea>
    <div class="row" style="margin:8px 0">
      ${sugg.map((x) => `<button class="chip" data-action="fill" data-text="${esc(x)}">${esc(x)}</button>`).join("")}
    </div>
    <div style="display:flex;align-items:center;gap:10px">
      <button class="go" data-action="prompt-go" data-slug="${esc(slug)}">draw it</button>
      <span class="hint">↵ draw · esc close</span>
    </div>`;
  return el;
}

function variateMenu(slug) {
  const el = document.createElement("div");
  el.className = "pop";
  el.dataset.slug = slug;
  el.innerHTML = variateInner(slug);
  return el;
}
function variateInner(slug) {
  return `
    <p class="cap">takes at once</p>
    <div class="row" style="margin:7px 0 11px">
      ${[1, 2, 3, 4].map((n) => `<button class="chip ${store.variateCount === n ? "on" : ""}" data-action="count" data-n="${n}">${n}</button>`).join("")}
    </div>
    <p class="cap">steer the take${store.variateCount > 1 ? "s" : ""}</p>
    <div class="row" style="margin-top:7px">
      ${STEERS.map((k) => `<button class="chip" data-action="steer" data-slug="${esc(slug)}" data-steer="${k}">${k} ×${store.variateCount}</button>`).join("")}
    </div>`;
}
function refreshVariateMenu(el) {
  el.innerHTML = variateInner(el.dataset.slug);
}

// ---------------------------------------------------------------------------
// insert points

function makeInsert(index) {
  const el = document.createElement("div");
  el.className = "insert";
  el.dataset.index = String(index);
  el.innerHTML = `<span class="hair"></span><button class="plus" data-action="insert" data-index="${index}" aria-label="add a section here">+</button>`;
  return el;
}

function syncInsert() {
  const want = store.openInsert; // index | null
  if (want == null) { if (openInsert) { openInsert.el.classList.remove("open"); openInsert.el.querySelector(".pop")?.remove(); openInsert = null; } return; }
  if (openInsert && openInsert.index === want) return; // leave the open input alone
  if (openInsert) { openInsert.el.classList.remove("open"); openInsert.el.querySelector(".pop")?.remove(); }
  const el = stackEl.querySelector(`.insert[data-index="${want}"]`);
  if (!el) { openInsert = null; return; }
  el.classList.add("open");
  el.appendChild(insertMenu(want));
  openInsert = { index: want, el };
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
  const secs = curPage()?.sections ?? [];
  if (index <= 0) return "start";
  if (index >= secs.length) return "end";
  return "after:" + secs[index - 1].slug;
}

function addSection(index, kind, custom) {
  const params = kind
    ? { kind, position: positionFor(index) }
    : { instruction: (custom ?? "").trim(), position: positionFor(index) };
  if (!kind && !params.instruction) return;
  request("add", { page: curPage()?.id }, params).catch(() => {});
  setState({ openInsert: null });
}

function cutSection(slug) {
  const page = curPage()?.id;
  op({ op: "cut", page, slug }).then(() => {
    setState({ selected: null, openMenu: null });
    toast(`removed ${slug}`, { label: "undo", run: () => op({ op: "undo" }).catch(() => {}) });
  }).catch(() => {});
}

function submitPrompt(slug) {
  const ta = openPop?.el.querySelector("textarea");
  const text = ta?.value.trim();
  if (!text) return;
  request("instruct", { page: curPage()?.id, slug }, { instruction: text }).catch(() => {});
  setState({ openMenu: null });
}

function onStackClick(e) {
  const b = e.target.closest("[data-action]");
  if (!b) {
    if (e.target.closest(".pop")) return;
    const wrap = e.target.closest(".frame-wrap");
    if (wrap && !isSketching()) setState({ selected: wrap.dataset.slug, openMenu: null, openInsert: null });
    return;
  }
  const a = b.dataset.action;
  const slug = b.dataset.slug;
  const pg = curPage();
  if (!pg) return;

  if (a === "cycle") {
    const s = pg.sections.find((x) => x.slug === slug);
    const next = ((s.active + Number(b.dataset.dir)) % s.takes + s.takes) % s.takes;
    op({ op: "pick", page: pg.id, slug, take: next }).catch(() => {});
  } else if (a === "compare") { window.open(`/compare/${encodeURIComponent(pg.id)}/${encodeURIComponent(slug)}`, "_blank"); }
  else if (a === "discard") {
    const s = pg.sections.find((x) => x.slug === slug);
    if (!s || s.takes < 2) return;
    op({ op: "discard", page: pg.id, slug, take: s.active }).then(() => {
      toast(`discarded a take of ${slug}`, { label: "undo", run: () => op({ op: "undo" }).catch(() => {}) });
    }).catch(() => {});
  } else if (a === "variate") { request("variate", { page: pg.id, slug }, { count: store.variateCount }).catch(() => {}); setState({ openMenu: null }); }
  else if (a === "steer") { request("variate", { page: pg.id, slug }, { count: store.variateCount, steer: b.dataset.steer }).catch(() => {}); setState({ openMenu: null }); }
  else if (a === "count") { store.variateCount = Number(b.dataset.n); localStorage.setItem("variate.count", b.dataset.n); if (openPop?.kind === "variate") refreshVariateMenu(openPop.el); for (const [, f] of frames) f.chrome.variateLabel.textContent = `variate ×${store.variateCount}`; }
  else if (a === "menu") setState({ openMenu: openPop && openPop.key === fkey(slug) && openPop.kind === b.dataset.kind ? null : { slug, kind: b.dataset.kind }, selected: slug, openInsert: null });
  else if (a === "sketch") { setState({ openMenu: null }); openSketch(slug, frames.get(fkey(slug))); }
  else if (a === "edit") { setState({ openMenu: null }); toggleTextEdit(slug); }
  else if (a === "prompt-go") submitPrompt(slug);
  else if (a === "fill") { const ta = openPop?.el.querySelector("textarea"); if (ta) { ta.value = b.dataset.text; ta.focus(); } }
  else if (a === "move") op({ op: "move", page: pg.id, slug, dir: b.dataset.dir }).catch(() => {});
  else if (a === "cut") cutSection(slug);
  else if (a === "insert") setState({ openInsert: openInsert && openInsert.index === Number(b.dataset.index) ? null : Number(b.dataset.index), openMenu: null });
  else if (a === "add-kind") addSection(Number(b.dataset.index), b.dataset.kind, null);
  else if (a === "add-custom") { const inp = b.closest(".pop").querySelector("input"); addSection(Number(b.dataset.index), null, inp.value); }
  else if (a === "requeue") fetch(`/api/request?requeue=${encodeURIComponent(b.dataset.req)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
}

// ---------------------------------------------------------------------------
// inline text editing (no model turn): toggle contenteditable inside the frame

const editing = new Set(); // frame keys
function toggleTextEdit(slug) {
  const key = fkey(slug);
  const f = frames.get(key);
  if (!f) return;
  const on = !editing.has(key);
  if (on) editing.add(key); else editing.delete(key);
  f.wrap.classList.toggle("editing", on);
  f.iframe.contentWindow?.postMessage({ type: "rb-edit", on }, "*");
  if (on) toast(`editing ${slug}: click any text and type, then click "text" again to save`);
}

// ---------------------------------------------------------------------------
// rail (re-render only when its signature changes)

function railSignature(st, pg) {
  return JSON.stringify({
    p: pg?.id,
    s: (pg?.sections ?? []).map((x) => [x.slug, x.takes, x.active, !!x.busy, x.warning ? 1 : 0, x.busy?.label ?? "", store.selected === x.slug]),
    q: st.queue.map((x) => x.id + x.label),
    w: st.working.map((x) => x.id),
    d: st.recentDone.slice(0, 4).map((x) => x.id + x.result),
    u: st.canUndo, r: st.canRedo, a: st.agent.mode, e: st.manifestError,
    act: st.activity.slice(0, 6).map((x) => x.seq),
  });
}

function renderRail(st, pg) {
  const sig = railSignature(st, pg);
  if (sig === railSig) return;
  railSig = sig;

  const secs = pg?.sections ?? [];
  const extra = secs.reduce((n, s) => n + Math.max(0, s.takes - 1), 0);
  const awaitCmd = `node <skill>/scripts/await.mjs --ws ${st.ws} --drain`;

  railA.innerHTML = `
    <div class="card">
      <h4 class="cap">${esc(pg?.title ?? "the page")} · ${secs.length} section${secs.length === 1 ? "" : "s"}${extra ? ` · ${extra} extra take${extra === 1 ? "" : "s"}` : ""}</h4>
      ${secs.map((s) => `
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
    </div>` : ""}`;

  railB.innerHTML = `
    <div class="card">
      <h4 class="cap">page actions</h4>
      <div class="action-row">
        <button class="action" data-action="undo" ${st.canUndo ? "" : "disabled"}>↩ undo</button>
        <button class="action" data-action="redo" ${st.canRedo ? "" : "disabled"}>↪ redo</button>
      </div>
      <button class="action" data-action="polish" ${st.working.length ? "disabled" : ""}>Polish the seams</button>
      <button class="action" data-action="preview">Preview ${esc(pg?.title ?? "the page")} ↗</button>
      <button class="action" data-action="export">Export dist/</button>
      <button class="action primary" data-action="done" ${st.working.length ? "disabled" : ""}>Done building</button>
    </div>

    <div class="card">
      <div class="presence ${st.agent.mode === "standing-by" ? "on" : st.agent.mode === "working" || st.agent.mode === "terminal" ? "mid" : ""}">
        <span class="dot"></span>${
          st.agent.mode === "standing-by" ? "agent standing by"
          : st.agent.mode === "working" ? "agent working · changes are landing"
          : st.agent.mode === "terminal" ? "agent in terminal mode · clicks land on its next turn"
          : "agent not connected"}
      </div>
      ${st.agent.mode === "away" ? `<code>${esc(awaitCmd)}</code>` : ""}
    </div>

    ${st.activity.length ? `<div class="card">
      <h4 class="cap">activity</h4>
      <div class="feed">
        ${st.activity.slice(0, 24).map((a) => `<div><span class="t">${esc(a.ts?.slice(11, 19) ?? "")}</span>${esc(a.label)}</div>`).join("")}
      </div>
    </div>` : ""}`;
}

function onRailClick(e) {
  const b = e.target.closest("[data-action]");
  if (!b) return;
  const a = b.dataset.action;
  const slug = b.dataset.slug;
  const pg = curPage();
  if (a === "jump") {
    setState({ selected: slug });
    frames.get(fkey(slug))?.wrap.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  else if (a === "rail-up") { e.stopPropagation(); op({ op: "move", page: pg?.id, slug, dir: "up" }).catch(() => {}); }
  else if (a === "rail-down") { e.stopPropagation(); op({ op: "move", page: pg?.id, slug, dir: "down" }).catch(() => {}); }
  else if (a === "rail-cut") { e.stopPropagation(); cutSection(slug); }
  else if (a === "undo") op({ op: "undo" }).catch(() => {});
  else if (a === "redo") op({ op: "redo" }).catch(() => {});
  else if (a === "polish") { request("polish", { page: pg?.id }, {}).catch(() => {}); toast("polish queued for the agent"); }
  else if (a === "preview") window.open(`/page?p=${encodeURIComponent(pg?.id ?? "index")}`, "_blank");
  else if (a === "export") fetch("/api/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then(() => toast("exported dist/ (every page, ship-ready)"));
  else if (a === "done") { request("done", null, {}).catch(() => {}); toast("told the agent you are done; it will wrap up and export"); }
}
