// The variate card: a 44px dock pinned to the bottom of YOUR page.
//
// It lives in a shadow root with `all: initial`, so your CSS cannot reach it
// and its CSS cannot reach you. It never styles, classes, or listens on your
// elements: selection is a separate rectangle drawn from getBoundingClientRect.
// Switching is a fetch; your own dev server re-renders the file.
//
// `VARIATE` ({port, token, version}) is prepended by the sidecar.

(() => {
  "use strict";

  // HMR runs init twice, and a stale build must not linger.
  if (window.__variate && window.__variate.version === VARIATE.version) return;
  if (window.__variate) { try { window.__variate.destroy(); } catch (_) {} }
  if (window.top !== window.self && !location.search.includes("variate=frame")) return;

  const API = `http://127.0.0.1:${VARIATE.port}`;
  const AUTH = { Authorization: `Bearer ${VARIATE.token}`, "Content-Type": "application/json" };
  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // -------------------------------------------------------------------------
  // shell

  const CSS = `
:host{
  all: initial;
  position: fixed; left: 50%; bottom: 0; transform: translateX(-50%);
  z-index: 2147483646;
  pointer-events: none;
  color-scheme: dark;
  contain: layout style;
  view-transition-name: variate-dock;
}
@media print { :host { display: none } }
*, *::before, *::after { box-sizing: border-box; margin: 0 }

.wrap{
  --bg: rgba(16,16,19,.88);
  --line: rgba(255,255,255,.10);
  --fg: #f2f2f4;
  --dim: rgba(242,242,244,.52);
  --accent: #6b64ff;
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  --ease: cubic-bezier(.2,.7,.2,1);
  position: relative;
  display: flex; flex-direction: column; align-items: center;
  padding-bottom: calc(16px + env(safe-area-inset-bottom));
}

.dock{
  pointer-events: auto;
  position: relative;
  height: 44px;
  display: flex; align-items: center; gap: 2px;
  padding: 0 6px 0 12px;
  border-radius: 14px;
  background: var(--bg);
  -webkit-backdrop-filter: blur(16px) saturate(150%);
  backdrop-filter: blur(16px) saturate(150%);
  box-shadow:
    0 0 0 1px var(--line),
    0 18px 44px -18px rgba(0,0,0,.65),
    inset 0 1px 0 rgba(255,255,255,.05);
  font: 400 12px/1 var(--mono);
  color: var(--fg);
  font-variant-numeric: tabular-nums;
  -webkit-user-select: none; user-select: none;
  transition: opacity .24s var(--ease), transform .24s var(--ease);
  overflow: hidden;
}
.dock[data-enter]{ animation: rise .38s cubic-bezier(.485,-.05,.285,1.505) }
@keyframes rise{ from{ transform: translateY(130%); opacity: 0 } }
.wrap[data-quiet] .dock{ opacity: .42 }
.wrap[data-collapsed]{ transform: translateY(calc(100% - 3px)) }
.wrap[data-picking] .dock{ opacity: 0; pointer-events: none }
.wrap{ transition: transform .3s var(--ease) }

/* the switch-in-flight hairline */
.dock::after{
  content:""; position:absolute; left:0; right:0; top:0; height:1.5px;
  background: var(--accent);
  transform: scaleX(0); transform-origin: left; opacity: 0;
}
.dock[data-busy]::after{ opacity:1; animation: sweep 1s var(--ease) infinite }
@keyframes sweep{ from{ transform: scaleX(0) } to{ transform: scaleX(1) } }

.name{
  all: unset;
  position: relative;
  font-size: 10px; text-transform: uppercase; letter-spacing: .14em;
  color: var(--dim);
  padding-right: 10px; margin-right: 4px;
  white-space: nowrap; max-width: 16ch; overflow: hidden; text-overflow: ellipsis;
}
.name::after{ content:""; position:absolute; right:0; top:-7px; bottom:-7px; width:1px; background:var(--line) }
button.name{ cursor: pointer }
button.name:hover{ color: var(--fg) }
button.name:focus-visible{ outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px }

.pager{ position: relative; display: flex; align-items: center; gap: 2px }
.thumb{
  position: absolute; top: 0; left: 0; height: 28px; width: 28px;
  border-radius: 9px; background: #f2f2f4;
  transform: translateX(var(--x, 0));
  transition: transform .26s var(--ease), width .26s var(--ease), opacity .2s var(--ease);
  pointer-events: none;
}
.thumb[hidden]{ display: block; opacity: 0 }

button.chip{
  all: unset;
  position: relative; z-index: 1;
  display: grid; place-items: center;
  min-width: 28px; height: 28px; padding: 0 7px;
  border-radius: 9px;
  font: 400 12px/1 var(--mono); font-variant-numeric: tabular-nums;
  color: var(--dim); cursor: pointer;
  transition: color .16s var(--ease), background-color .16s var(--ease);
}
button.chip:hover{ color: var(--fg); background: rgba(255,255,255,.07) }
button.chip[aria-current="true"]{ color: #0b0b0d; font-weight: 600; background: none }
button.chip:focus-visible{ outline: 2px solid var(--accent); outline-offset: 2px }
button.chip[disabled]{
  color: rgba(242,242,244,.22); cursor: default; background: none;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.09);
}
button.chip.nav{ opacity: .5; padding: 0 5px }
button.chip.nav:hover{ opacity: 1 }
button.chip.act{ color: var(--fg); background: rgba(255,255,255,.08); padding: 0 11px; font-size: 11px }
button.chip.act:hover{ background: rgba(255,255,255,.14) }
button.chip.go{ background: #f2f2f4; color: #0b0b0d; font-weight: 600 }
button.chip.go:hover{ background: #fff }

.tail{ display: flex; align-items: center; gap: 2px; margin-left: 4px; padding-left: 8px; position: relative }
.tail::before{ content:""; position:absolute; left:0; top:-7px; bottom:-7px; width:1px; background:var(--line) }

.note{
  max-width: min(92vw, 460px);
  margin-bottom: 8px;
  font: 400 11px/1.45 var(--mono);
  color: rgba(255,255,255,.66);
  background: rgba(16,16,19,.82);
  -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
  box-shadow: 0 0 0 1px var(--line);
  border-radius: 8px; padding: 5px 10px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  opacity: 0; transform: translateY(3px);
  transition: opacity .24s var(--ease), transform .24s var(--ease);
  pointer-events: none;
}
.note[data-on]{ opacity: 1; transform: none }
.note[data-copy]{ pointer-events: auto; cursor: copy; color: var(--fg) }

.menu{
  position: absolute; bottom: calc(100% + 8px); left: 0;
  min-width: 210px; padding: 5px;
  background: rgba(16,16,19,.94);
  -webkit-backdrop-filter: blur(16px) saturate(150%); backdrop-filter: blur(16px) saturate(150%);
  box-shadow: 0 0 0 1px var(--line), 0 18px 44px -18px rgba(0,0,0,.7);
  border-radius: 12px;
  pointer-events: auto;
}
button.row{
  all: unset; display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 7px 9px; border-radius: 8px; cursor: pointer;
  font: 400 12px/1 var(--mono); color: var(--dim);
}
button.row:hover, button.row[data-on]{ background: rgba(255,255,255,.07); color: var(--fg) }
button.row .n{ margin-left: auto; font-size: 10px; opacity: .7 }

.hit{ position: absolute; left: -10px; right: -10px; bottom: 0; height: 40px; pointer-events: auto }
.wrap:not([data-collapsed]) .hit{ display: none }

/* Narrow: the section name is the first thing to go (the note still says it
   on every change), so the positions and the actions always fit. */
@media (max-width: 560px){
  :host{ left: 10px; right: 10px; transform: none }
  .wrap{ padding-bottom: calc(10px + env(safe-area-inset-bottom)) }
  .dock{ width: 100%; padding: 0 6px }
  .name{ display: none }
  .pager{ flex: 1; justify-content: center }
  button.chip{ min-width: 30px; padding: 0 4px }
  button.chip.act{ padding: 0 9px }
  .tail{ margin-left: 2px; padding-left: 6px }
}
@media (pointer: coarse){
  .dock{ height: 52px } button.chip, .thumb{ height: 36px; min-width: 36px }
}
@media (prefers-reduced-motion: reduce){
  .dock, .thumb, .chip, .note, .wrap, .hl{ transition: none !important; animation: none !important }
}
`;

  const HL_CSS = `
:host{ all: initial; position: fixed; z-index: 2147483645; pointer-events: none;
  contain: layout style; }
.box{
  position: fixed; border-radius: 8px; pointer-events: none;
  box-shadow: 0 0 0 1px #6b64ff, 0 0 0 6px rgba(107,100,255,.16);
  background: rgba(107,100,255,.05);
  opacity: 0; transition: opacity .2s cubic-bezier(.2,.7,.2,1);
}
.box[data-on]{ opacity: 1 }
.box[data-move]{ transition: opacity .2s cubic-bezier(.2,.7,.2,1),
  top .16s cubic-bezier(.2,.7,.2,1), left .16s cubic-bezier(.2,.7,.2,1),
  width .16s cubic-bezier(.2,.7,.2,1), height .16s cubic-bezier(.2,.7,.2,1) }
.tag{
  position: fixed; padding: 3px 7px; border-radius: 6px;
  background: #6b64ff; color: #fff;
  font: 500 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: .08em; text-transform: uppercase; white-space: nowrap;
  opacity: 0; transition: opacity .2s cubic-bezier(.2,.7,.2,1);
}
.tag[data-on]{ opacity: 1 }
@media (prefers-reduced-motion: reduce){ .box, .tag { transition: none !important } }
`;

  // -------------------------------------------------------------------------
  // mount
  //
  // The host goes inside a <script>: React 19 owns <body> in the app router
  // and evicts foreign children, but it will not discard <script> nodes.
  // position:absolute so body{display:flex} cannot make it a flex item.

  const el = (tag, props, kids) => {
    const n = document.createElement(tag);
    if (props) for (const k in props) {
      if (k === "text") n.textContent = props[k];
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), props[k]);
      else if (props[k] === true) n.setAttribute(k, "");
      else if (props[k] != null && props[k] !== false) n.setAttribute(k, props[k]);
    }
    for (const c of kids || []) if (c) n.appendChild(c);
    return n;
  };

  const container = document.createElement("script");
  container.setAttribute("data-variate", "");
  container.style.cssText = "display:block;position:absolute;top:0;left:0;width:0;height:0";
  const host = document.createElement("variate-dock");
  host.setAttribute("data-variate-ignore", "");
  const root = host.attachShadow({ mode: "open" });
  container.appendChild(host);

  const hlHost = document.createElement("variate-highlight");
  hlHost.setAttribute("data-variate-ignore", "");
  const hlRoot = hlHost.attachShadow({ mode: "open" });
  container.appendChild(hlHost);

  const style = document.createElement("style"); style.textContent = CSS; root.appendChild(style);
  const hlStyle = document.createElement("style"); hlStyle.textContent = HL_CSS; hlRoot.appendChild(hlStyle);

  const wrap = el("div", { class: "wrap" });
  const noteEl = el("div", { class: "note" });
  const dock = el("div", { class: "dock", role: "toolbar", "aria-label": "variate" });
  const hitbox = el("div", { class: "hit", onclick: () => setCollapsed(false) });
  wrap.appendChild(noteEl); wrap.appendChild(dock); wrap.appendChild(hitbox);
  root.appendChild(wrap);

  const hlBox = el("div", { class: "box" });
  const hlTag = el("div", { class: "tag" });
  hlRoot.appendChild(hlBox); hlRoot.appendChild(hlTag);

  document.body.appendChild(container);

  // -------------------------------------------------------------------------
  // state

  let state = null;         // last /state payload
  // Which set you were looking at survives a reload: a reload is often OUR
  // doing (the no-HMR fallback), and coming back on a different set than you
  // left reads as the card losing your place.
  let cur = sessionStorage.getItem("variate.set") || null;
  let busy = false;
  let collapsed = sessionStorage.getItem("variate.collapsed") === "1";
  let menuOpen = false;
  let picking = false;
  let noteTimer = null;
  let sig = "";             // render signature, so polls never rebuild the DOM

  const setOf = (name) => (state?.sets || []).find((s) => s.name === name) || null;
  const active = () => setOf(cur) || (state?.sets || [])[0] || null;

  function note(text, opts) {
    clearTimeout(noteTimer);
    noteEl.textContent = text;
    noteEl.toggleAttribute("data-on", !!text);
    noteEl.toggleAttribute("data-copy", !!(opts && opts.copy));
    noteEl.onclick = opts && opts.copy
      ? () => { navigator.clipboard?.writeText(opts.copy).then(() => note("copied")); }
      : null;
    if (text && !(opts && opts.sticky)) noteTimer = setTimeout(() => note(""), opts?.ms || 2600);
  }

  function setCollapsed(v) {
    collapsed = v;
    sessionStorage.setItem("variate.collapsed", v ? "1" : "0");
    wrap.toggleAttribute("data-collapsed", v);
  }

  // -------------------------------------------------------------------------
  // transport

  async function post(pathname, body) {
    const r = await fetch(API + pathname, { method: "POST", headers: AUTH, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || String(r.status));
    return j;
  }

  let es = null, offline = false;
  function connect() {
    try { es?.close(); } catch (_) {}
    es = new EventSource(`${API}/events?t=${encodeURIComponent(VARIATE.token)}`);
    es.addEventListener("state", (e) => {
      offline = false;
      try { apply(JSON.parse(e.data)); } catch (_) {}
    });
    es.onerror = () => {
      if (!offline) { offline = true; render(); }
      // EventSource retries on its own; the retry hint is set server-side.
    };
  }

  // -------------------------------------------------------------------------
  // switching

  let switchTimer = null;
  function go(n) {
    const s = active();
    if (!s || busy) return;
    if (n < 1 || n > s.n) return;
    if (n === s.at) return;

    busy = true;
    dock.setAttribute("data-busy", "");
    const label = s.plan[n - 1];
    if (label) note(`${n} · ${label}`);

    post("/switch", { set: s.name, to: n })
      .then((out) => {
        if (out.adopted) note(`your edit kept as ${out.adopted}`, { ms: 3400 });
        // The dev server re-renders on its own. Watch for it, and if nothing
        // moves (no HMR: plain HTML, a template stack), reload once.
        waitForRender();
      })
      .catch((e) => {
        busy = false; dock.removeAttribute("data-busy");
        offline = true; render();
        note(`say: variate the ${s.name}, ${n}`, { copy: `variate the ${s.name}, ${n}`, sticky: true });
      });
  }

  // Their dev server re-renders on its own (HMR, Fast Refresh, live reload).
  // Watch THEIR content, not ours: sample a cheap fingerprint of the page and
  // if it has not moved by the deadline there is no HMR here (plain HTML, a
  // template stack), so reload once. A fingerprint is used rather than a
  // MutationObserver because the card mutates the document too, and telling
  // the two apart is exactly the kind of subtlety that fails silently.
  // THEIR content only: walk the body's own children and skip our container.
  // textContent (not innerText) is used deliberately: it ignores shadow roots,
  // so the card's own chips and captions can never look like a re-render, and
  // it costs no layout.
  function fingerprint() {
    let n = 0, head = "";
    for (const child of document.body ? document.body.children : []) {
      if (child === container) continue;
      const t = child.textContent || "";
      n += t.length;
      if (head.length < 300) head += t.slice(0, 300 - head.length);
    }
    return n + "|" + head;
  }

  // Does this page have a dev server that will re-render on its own? If it
  // does, reloading is the wrong move: HMR keeps scroll position and client
  // state, and a cold module compile can take several seconds, which is
  // longer than any reload deadline worth having for a static page.
  function hasHMR() {
    if (window.__NEXT_DATA__ || window.next || document.querySelector('script[src*="/_next/static/"]')) return true;
    if (window.__vite_plugin_react_preamble_installed__ || document.querySelector('script[src*="/@vite/client"], script[src*="/@id/"]')) return true;
    if (window.__astro_dev_toolbar__ || document.querySelector('script[src*="astro"]')) return true;
    if (window.__webpack_require__ || window.webpackHotUpdate) return true;
    return false;
  }

  function waitForRender() {
    const before = fingerprint();
    const started = Date.now();
    const hmr = hasHMR();
    const deadline = hmr ? 8000 : 900;
    let settled = false;
    const done = (reload) => {
      if (settled) return;
      settled = true;
      busy = false; dock.removeAttribute("data-busy");
      if (!reload) return;
      // Reload while the tab is in the background and the user comes back to a
      // scroll position they never chose, so defer it rather than skip it.
      if (document.hidden) {
        addEventListener("visibilitychange", function once() {
          removeEventListener("visibilitychange", once);
          if (!document.hidden) location.reload();
        });
        note("switched · reloading when you come back", { ms: 3000 });
        return;
      }
      location.reload();
    };
    const poll = () => {
      if (settled) return;
      if (fingerprint() !== before) return done(false);
      if (Date.now() - started > deadline) {
        // With HMR, a slow answer means a cold compile, not a dead server:
        // wait it out rather than reloading over the top of it.
        if (hmr) { note("your dev server is still compiling that one", { ms: 2600 }); return done(false); }
        return done(true);
      }
      setTimeout(poll, 120);
    };
    setTimeout(poll, 120);
  }

  // -------------------------------------------------------------------------
  // render (build once, then update in place; never destroy an open menu)

  let refs = null;
  function build() {
    dock.textContent = "";
    const nameBtn = el("button", { class: "name", type: "button", onclick: onName });
    const pager = el("div", { class: "pager" });
    const thumb = el("div", { class: "thumb" });
    pager.appendChild(thumb);
    const tail = el("div", { class: "tail" });
    dock.appendChild(nameBtn); dock.appendChild(pager); dock.appendChild(tail);
    refs = { nameBtn, pager, thumb, tail, chips: [] };
  }

  function signature() {
    const s = active();
    return JSON.stringify([
      s?.name, s?.n, s?.at, s?.plan, (state?.sets || []).length,
      offline, picking, (state?.working || []).length, (state?.queued || []).length, state?.agent,
    ]);
  }

  function render() {
    const next = signature();
    if (next === sig) { positionThumb(); return; }
    sig = next;
    if (!refs) build();

    const sets = state?.sets || [];
    const s = active();

    // No sets: render nothing at all, so a stale script tag is invisible.
    host.style.display = sets.length ? "" : "none";
    hlHost.style.display = sets.length ? "" : "none";
    if (!sets.length) return;

    refs.nameBtn.textContent = s.name;
    refs.nameBtn.disabled = sets.length < 2;
    refs.nameBtn.title = sets.length > 1 ? "change section  [ ]" : s.target;

    // pager: one chip per position, plus arrows
    const want = [];
    want.push({ k: "prev", label: "\u2039", nav: true });
    for (let i = 1; i <= Math.max(s.n, s.plan.length || s.n); i++) want.push({ k: "p" + i, n: i });
    want.push({ k: "next", label: "\u203a", nav: true });

    if (refs.chips.length !== want.length) {
      for (const c of refs.chips) c.remove();
      refs.chips = want.map((w) => {
        const b = el("button", { class: "chip" + (w.nav ? " nav" : ""), type: "button" });
        b.addEventListener("click", () => (w.k === "prev" ? step(-1) : w.k === "next" ? step(1) : go(w.n)));
        refs.pager.appendChild(b);
        return b;
      });
    }
    want.forEach((w, i) => {
      const b = refs.chips[i];
      if (w.nav) { b.textContent = w.label; b.setAttribute("aria-label", w.k === "prev" ? "previous" : "next"); return; }
      b.textContent = String(w.n);
      const landed = w.n <= s.n;
      b.disabled = !landed;
      b.setAttribute("aria-current", String(landed && w.n === s.at));
      const lbl = s.plan[w.n - 1];
      b.title = landed ? (lbl ? `${w.n} · ${lbl}` : `variant ${w.n}`) : (lbl ? `${lbl} (drawing)` : "drawing");
      b.onmouseenter = () => { if (lbl && landed) note(`${w.n} · ${lbl}`); };
    });

    // tail: pick + collapse, or the offline hint
    refs.tail.textContent = "";
    if (offline) {
      const b = el("button", { class: "chip act", type: "button", text: "offline" });
      b.title = "the variate sidecar is not answering";
      b.onclick = () => note(`say: variate the ${s.name}`, { copy: `variate the ${s.name}`, sticky: true });
      refs.tail.appendChild(b);
    } else {
      const busyReq = (state?.working || []).concat(state?.queued || [])[0];
      if (busyReq) {
        const b = el("button", { class: "chip act", type: "button", text: "drawing" });
        b.title = busyReq.label;
        b.onclick = () => note(busyReq.label, { ms: 3200 });
        refs.tail.appendChild(b);
      } else {
        const p = el("button", { class: "chip act", type: "button", text: picking ? "cancel" : "pick" });
        p.title = picking ? "cancel (esc)" : "pick a section to vary";
        p.onclick = () => (picking ? stopPick() : startPick());
        refs.tail.appendChild(p);
      }
    }
    const x = el("button", { class: "chip nav", type: "button", text: "\u25be" });
    x.title = "hide (esc)";
    x.setAttribute("aria-label", "hide");
    x.onclick = () => setCollapsed(true);
    refs.tail.appendChild(x);

    positionThumb();
  }

  function positionThumb() {
    const s = active();
    if (!refs || !s) return;
    const idx = s.at ? s.at : 0;
    const chip = idx ? refs.chips[idx] : null;  // chips[0] is the prev arrow
    if (!chip || chip.disabled) { refs.thumb.setAttribute("hidden", ""); return; }
    refs.thumb.removeAttribute("hidden");
    refs.thumb.style.setProperty("--x", chip.offsetLeft + "px");
    refs.thumb.style.width = chip.offsetWidth + "px";
  }

  function step(d) {
    const s = active();
    if (!s) return;
    const from = s.at || 1;
    let n = from + d;
    if (n < 1) n = s.n;
    if (n > s.n) n = 1;
    go(n);
  }

  function cycleSet(d) {
    const sets = state?.sets || [];
    if (sets.length < 2) return;
    const i = Math.max(0, sets.findIndex((x) => x.name === active()?.name));
    cur = sets[(i + d + sets.length) % sets.length].name;
    sessionStorage.setItem("variate.set", cur);
    sig = "";
    render();
    note(cur + " · " + (active()?.target || ""));
    flashHighlightFor(active());
  }

  // -------------------------------------------------------------------------
  // set menu (built outside the render cycle so a poll never destroys it)

  let menuEl = null;
  function onName() {
    if ((state?.sets || []).length < 2) return;
    menuOpen ? closeMenu() : openMenu();
  }
  function openMenu() {
    closeMenu();
    menuOpen = true;
    menuEl = el("div", { class: "menu", role: "menu" });
    for (const s of state.sets) {
      const row = el("button", { class: "row", type: "button", role: "menuitem" }, [
        el("span", { text: s.name }),
        el("span", { class: "n", text: s.at ? `${s.at}/${s.n}` : `${s.n}` }),
      ]);
      if (s.name === active()?.name) row.setAttribute("data-on", "");
      row.onmouseenter = () => flashHighlightFor(s);
      row.onclick = () => { cur = s.name; sessionStorage.setItem("variate.set", cur); closeMenu(); sig = ""; render(); };
      menuEl.appendChild(row);
    }
    wrap.appendChild(menuEl);
  }
  function closeMenu() {
    menuOpen = false;
    menuEl?.remove();
    menuEl = null;
  }

  // -------------------------------------------------------------------------
  // highlight + pick
  //
  // The page is never touched: no classes, no styles, no listeners on user
  // elements. The highlight is a fixed rect in our own shadow root, so there
  // is no scroll math and nothing to clean up.

  let hlTarget = null, hlRaf = 0;
  function drawHighlight(node, label, opts) {
    hlTarget = node;
    if (!node) {
      hlBox.removeAttribute("data-on"); hlTag.removeAttribute("data-on");
      cancelAnimationFrame(hlRaf); hlRaf = 0;
      return;
    }
    const paint = () => {
      if (!hlTarget || !hlTarget.isConnected) return drawHighlight(null);
      const r = hlTarget.getBoundingClientRect();
      hlBox.style.top = (r.top - 4) + "px";
      hlBox.style.left = (r.left - 4) + "px";
      hlBox.style.width = (r.width + 8) + "px";
      hlBox.style.height = (r.height + 8) + "px";
      hlTag.style.top = Math.max(4, r.top - 26) + "px";
      hlTag.style.left = Math.max(4, r.left - 4) + "px";
      if (hlRaf) hlRaf = requestAnimationFrame(paint);
    };
    hlBox.toggleAttribute("data-move", !!opts?.animate && !REDUCED);
    hlTag.textContent = label || "";
    hlBox.setAttribute("data-on", "");
    hlTag.toggleAttribute("data-on", !!label);
    paint();
    if (!hlRaf) { hlRaf = requestAnimationFrame(function loop() { paint(); if (hlRaf) hlRaf = requestAnimationFrame(loop); }); }
  }

  let flashTimer = null;
  function flashHighlightFor(s) {
    if (!s) return;
    const node = document.querySelector(`[data-variate-section="${CSS_escape(s.name)}"]`);
    if (!node) return;
    clearTimeout(flashTimer);
    drawHighlight(node, s.name, { animate: true });
    flashTimer = setTimeout(() => drawHighlight(null), 1200);
  }
  const CSS_escape = (s) => String(s).replace(/["\\]/g, "\\$&");

  const SECTIONISH = new Set(["SECTION", "HEADER", "FOOTER", "NAV", "MAIN", "ARTICLE", "ASIDE"]);
  function sectionAt(x, y) {
    const stack = document.elementsFromPoint(x, y);
    let node = null;
    for (const e of stack) {
      if (e.closest && (e.closest("variate-dock") || e.closest("variate-highlight") || e.closest("[data-variate-ignore]"))) continue;
      node = e; break;
    }
    if (!node) return null;
    let best = node;
    for (let e = node; e && e !== document.body; e = e.parentElement) {
      const r = e.getBoundingClientRect();
      const pr = e.parentElement?.getBoundingClientRect();
      const wide = pr ? r.width >= pr.width * 0.6 : false;
      if (SECTIONISH.has(e.tagName) || (r.height >= innerHeight * 0.25 && wide)) { best = e; break; }
      best = e;
    }
    return best;
  }

  function describe(node) {
    const text = (node.innerText || "").replace(/\s+/g, " ").trim().slice(0, 140);
    const parent = node.parentElement;
    const nth = parent ? [...parent.children].indexOf(node) + 1 : 0;
    return {
      tag: node.tagName.toLowerCase(),
      id: node.id || null,
      cls: (node.className && typeof node.className === "string" ? node.className : "").slice(0, 160) || null,
      nth,
      text,
      path: location.pathname,
    };
  }

  let pickMove = null, pickClick = null, pickNode = null;
  function startPick() {
    if (picking) return;
    picking = true;
    wrap.setAttribute("data-picking", "");
    sig = ""; render();
    note("click a section to vary it \u00b7 esc to cancel", { sticky: true });

    pickMove = (e) => {
      const n = sectionAt(e.clientX, e.clientY);
      if (!n || n === pickNode) return;
      pickNode = n;
      drawHighlight(n, n.tagName.toLowerCase() + (n.id ? "#" + n.id : ""), { animate: true });
    };
    pickClick = (e) => {
      if (!pickNode) return;
      e.preventDefault(); e.stopPropagation();
      const sel = describe(pickNode);
      stopPick();
      post("/request", { type: "vary", params: { count: 4, selection: sel, hint: sel.text.slice(0, 40) } })
        .then(() => note("asked for 4 takes \u00b7 your agent picks this up on its next turn", { ms: 4200 }))
        .catch(() => note(`say: variate the section that starts "${sel.text.slice(0, 30)}"`,
          { copy: `variate the section that starts "${sel.text.slice(0, 60)}"`, sticky: true }));
    };
    addEventListener("pointermove", pickMove, true);
    addEventListener("click", pickClick, true);
  }

  function stopPick() {
    if (!picking) return;
    picking = false;
    pickNode = null;
    wrap.removeAttribute("data-picking");
    removeEventListener("pointermove", pickMove, true);
    removeEventListener("click", pickClick, true);
    drawHighlight(null);
    note("");
    sig = ""; render();
  }

  // -------------------------------------------------------------------------
  // keyboard
  //
  // No bare letters: this card lives on someone else's app. No Alt+Arrow
  // (browser history). Never preventDefault on arrows, so a page that scrolls
  // horizontally still scrolls.

  function typing() {
    const deep = (n) => (n && n.shadowRoot && n.shadowRoot.activeElement) ? deep(n.shadowRoot.activeElement) : n;
    const a = deep(document.activeElement);
    return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT" || a.isContentEditable);
  }

  function onKey(e) {
    if (e.key === "Escape") {
      if (picking) return stopPick();
      if (menuOpen) return closeMenu();
      if (!collapsed) return setCollapsed(true);
      return;
    }
    if (typing() || e.metaKey || e.ctrlKey || e.altKey) return;
    if (collapsed || !(state?.sets || []).length) return;
    if (e.key === "ArrowLeft") step(-1);
    else if (e.key === "ArrowRight") step(1);
    else if (e.key === "[") cycleSet(-1);
    else if (e.key === "]") cycleSet(1);
    else if (e.key === "?") note("\u2190 \u2192 flip \u00b7 1-9 jump \u00b7 [ ] section \u00b7 esc hide", { ms: 5000 });
    else if (/^[1-9]$/.test(e.key)) go(Number(e.key));
  }

  // -------------------------------------------------------------------------
  // life

  function apply(next) {
    state = next;
    if (!cur || !setOf(cur)) cur = (state.sets[0] || {}).name || null;
    if (cur) sessionStorage.setItem("variate.set", cur);
    // Self-heal: a client-side route change or a rogue unmount must not kill us.
    if (!container.isConnected) document.body.appendChild(container);
    render();
  }

  let quietTimer = null;
  function onScroll() {
    wrap.setAttribute("data-quiet", "");
    clearTimeout(quietTimer);
    quietTimer = setTimeout(() => wrap.removeAttribute("data-quiet"), 260);
  }

  const onDocDown = (e) => {
    if (!menuOpen) return;
    const p = e.composedPath();
    if (!p.includes(menuEl) && !p.includes(refs?.nameBtn)) closeMenu();
  };

  addEventListener("keydown", onKey, true);
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("pointerdown", onDocDown, true);
  addEventListener("resize", positionThumb);

  setCollapsed(collapsed);
  dock.setAttribute("data-enter", "");
  setTimeout(() => dock.removeAttribute("data-enter"), 500);
  connect();
  fetch(`${API}/state`, { headers: AUTH }).then((r) => r.json()).then(apply).catch(() => { offline = true; render(); });

  window.__variate = {
    version: VARIATE.version,
    go, step, note,
    destroy() {
      try { es?.close(); } catch (_) {}
      removeEventListener("keydown", onKey, true);
      removeEventListener("scroll", onScroll);
      removeEventListener("pointerdown", onDocDown, true);
      removeEventListener("resize", positionThumb);
      stopPick();
      container.remove();
    },
  };
})();
