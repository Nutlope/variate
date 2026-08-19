// The variate card: a small dock pinned to the bottom of YOUR page.
//
// It lives in a shadow root with `all: initial`, so your CSS cannot reach it
// and its CSS cannot reach you. It never styles, classes, or listens on your
// elements: selection is a separate rectangle drawn from getBoundingClientRect.
// Switching is a fetch; your own dev server re-renders the file.
//
// The round has a shape: flip until one feels right, then keep it (the check,
// or Enter). Keep locks the set and tells your agent, which deletes the
// alternatives and carries on with you in chat. refine asks for tighter takes
// on the one you are looking at. pick starts a round on another section.
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

  // Inter, registered under a private family name. document.fonts is shared
  // with the host page, so the name must never be "Inter": the page's own use
  // of the real thing has to stay untouched. Failure just leaves the system
  // stack; nothing depends on the load.
  if (!window.__variateFont) {
    try {
      const face = new FontFace(
        "variate-inter",
        `url("${API}/inter.woff2?v=${encodeURIComponent(VARIATE.version)}")`,
        { weight: "100 900", style: "normal", display: "swap" },
      );
      document.fonts.add(face);
      window.__variateFont = face;
      face.load().catch(() => {});
    } catch (_) { /* older engine: the fallback stack carries it */ }
  }

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

/* Bottom centre is where toasts, sheets, docks and sticky CTAs live, which
   is exactly the furniture people prototype. When something fixed is already
   down there, the bar moves to the top rather than sitting on the work. */
:host([data-top]){ top: 0; bottom: auto }
:host([data-top]) .wrap{
  flex-direction: column-reverse;
  padding-bottom: 0; padding-top: calc(16px + env(safe-area-inset-top));
}
:host([data-top]) .wrap[data-collapsed]{ transform: translateY(calc(-100% + 3px)) }
:host([data-top]) .wrap[data-away]:not(:hover):not(:focus-within){ transform: translateY(calc(-100% + 3px)) }
:host([data-top]) .wrap[data-exit]{ transform: translateY(-130%) }
:host([data-top]) .menu{ bottom: auto; top: calc(100% + 8px) }
:host([data-top]) .tip{ bottom: auto; top: calc(100% + 7px) }
:host([data-top]) .hit{ bottom: auto; top: 0 }
:host([data-top]) .dock[data-enter]{ animation-name: drop }
@keyframes drop{ from{ transform: translateY(-130%); opacity: 0 } }

.wrap{
  --bg: rgba(16,16,19,.88);
  --line: rgba(255,255,255,.10);
  --fg: #f2f2f4;
  --dim: rgba(242,242,244,.52);
  --accent: #6b64ff;
  --sans: "variate-inter", -apple-system, system-ui, "Segoe UI", sans-serif;
  --ease: cubic-bezier(.2,.7,.2,1);
  position: relative;
  display: flex; flex-direction: column; align-items: center;
  padding-bottom: calc(16px + env(safe-area-inset-bottom));
  transition: transform .3s var(--ease), opacity .3s var(--ease);
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
  font: 400 12px/1 var(--sans);
  letter-spacing: 0;
  color: var(--fg);
  font-variant-numeric: tabular-nums;
  -webkit-user-select: none; user-select: none;
  transition: opacity .24s var(--ease), transform .24s var(--ease);
  overflow: hidden;
}
/* Enter is delayed a beat so the dock never fights the page's first paint. */
.dock[data-enter]{ animation: rise .38s cubic-bezier(.485,-.05,.285,1.505) .3s both }
@keyframes rise{ from{ transform: translateY(130%); opacity: 0 } }
.wrap[data-quiet] .dock{ opacity: .42 }
.wrap[data-collapsed]{ transform: translateY(calc(100% - 3px)) }
/* Route-aware: the active set's marker is not in this screen's DOM, so the
   card ducks to the same lip on its own. Unlike data-collapsed (the user's
   explicit choice), approaching it brings it straight back. */
.wrap[data-away]:not(:hover):not(:focus-within){ transform: translateY(calc(100% - 3px)) }
.wrap[data-picking] .dock{ opacity: 0; pointer-events: none }
.wrap[data-exit]{ transform: translateY(130%); opacity: 0 }
.wrap[data-kept] .pager{ opacity: .45; pointer-events: none }

/* the hairline: a quiet breathe while an ask waits, a sweep while a switch
   is in flight (declared after, so the sweep wins when both apply) */
.dock::after{
  content:""; position:absolute; left:0; right:0; top:0; height:1.5px;
  background: var(--accent);
  transform: scaleX(0); transform-origin: left; opacity: 0;
}
.dock[data-pending]::after{ transform: scaleX(1); animation: breathe 2.4s var(--ease) infinite }
@keyframes breathe{ 0%,100%{ opacity:.22 } 50%{ opacity:.6 } }
.dock[data-busy]::after{ opacity:1; animation: sweep 1s var(--ease) infinite }
@keyframes sweep{ from{ transform: scaleX(0) } to{ transform: scaleX(1) } }

.name{
  all: unset;
  position: relative;
  font: 500 11px/1 var(--sans);
  letter-spacing: -0.01em;
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
  font: 400 12px/1 var(--sans); font-variant-numeric: tabular-nums;
  letter-spacing: 0;
  color: var(--dim); cursor: pointer;
  transition: color .16s var(--ease), background-color .16s var(--ease);
}
button.chip:hover{ color: var(--fg); background: rgba(255,255,255,.07) }
button.chip[aria-current="true"]{ color: #0b0b0d; font-weight: 550; background: none }
/* the live chip wears its direction; cap it so one long name cannot push
   the actions off the dock, and drop it entirely when the room runs out */
/* the chip is a centring grid, so the name needs to be told to sit beside
   the number rather than under it */
button.chip.named{ padding: 0 11px; grid-auto-flow: column; align-items: center }
button.chip .nm{
  margin-left: 5px; max-width: 18ch;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
button.chip .nm::before{ content: "\\00b7"; margin-right: 5px; opacity: .45 }
@media (max-width: 900px){ button.chip .nm{ display: none } }
button.chip:focus-visible{ outline: 2px solid var(--accent); outline-offset: 2px }
button.chip[disabled]{
  color: rgba(242,242,244,.22); cursor: default; background: none;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.09);
}
button.chip.nav{ opacity: .5; padding: 0 5px }
button.chip.nav:hover{ opacity: 1 }
/* Secondary verbs are quiet until you reach for them: three filled boxes in
   a row read as three equal demands, and only one of these ends the round. */
button.chip.act{ color: var(--dim); background: none; padding: 0 10px; font-size: 11px }
button.chip.act:hover{ color: var(--fg); background: rgba(255,255,255,.09) }
/* The verbs are drawn, not worded: three glyphs cost half the room of three
   words, and the instant tooltip carries the sentence. Keep alone wears
   colour, because green-check is the one gesture that ends the round;
   everything else is still browsing. */
button.chip.ic{ min-width: 30px; padding: 0 }
button.chip.ic svg{ display: block; transition: transform .16s var(--ease) }
button.chip.ic:hover svg{ transform: scale(1.1) }
button.chip.go{ background: #3edc97; color: #07130d; font-weight: 550; padding: 0 13px }
button.chip.go:hover{ background: #5ceaab; color: #07130d }
/* keep's signature: on click the check draws itself once, tail to tip, and
   the receipt waits for the stroke to land. 23 is the path's measured length. */
button.chip.go[data-signing] svg path{
  stroke-dasharray: 23; stroke-dashoffset: 23;
  animation: signdraw .2s var(--ease) .05s forwards;
}
@keyframes signdraw{ to{ stroke-dashoffset: 0 } }

.receipt{
  display: flex; align-items: center;
  height: 28px; padding: 0 10px;
  font: 450 12px/1 var(--sans);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0;
  color: var(--dim);
  white-space: nowrap;
}

.tail{ display: flex; align-items: center; gap: 4px; margin-left: 8px; padding-left: 10px; position: relative }
.tail::before{ content:""; position:absolute; left:0; top:-7px; bottom:-7px; width:1px; background:var(--line) }

/* Our own tooltip, because the native one waits about a second and then
   draws an OS box in an OS font. This is a toolbar: the label has to be
   there the moment you are pointing at the button, or it is not help. */
.tip{
  position: absolute; bottom: calc(100% + 7px); left: 0;
  padding: 4px 8px; border-radius: 7px;
  background: #f2f2f4; color: #16161a;
  font: 450 11px/1.35 var(--sans); letter-spacing: 0;
  white-space: nowrap; pointer-events: none;
  opacity: 0; transform: translateY(2px);
  transition: opacity .09s var(--ease), transform .09s var(--ease);
  box-shadow: 0 6px 18px -8px rgba(0,0,0,.55);
}
.tip[data-on]{ opacity: 1; transform: none }
.tip .k{
  margin-left: 6px; padding: 1px 4px; border-radius: 4px;
  background: rgba(0,0,0,.10); font-size: 10px; font-weight: 500;
}

.note{
  max-width: min(92vw, 460px);
  margin-bottom: 8px;
  font: 400 11px/1.45 var(--sans);
  letter-spacing: 0;
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

.ask{ pointer-events: auto; margin-bottom: 8px }
.ask[hidden]{ display: none }
.ask input{
  all: unset;
  display: block;
  box-sizing: border-box;
  width: min(78vw, 360px);
  height: 32px;
  padding: 0 12px;
  border-radius: 9px;
  background: rgba(16,16,19,.92);
  -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
  box-shadow: 0 0 0 1px var(--line);
  font: 400 12px/30px var(--sans);
  letter-spacing: 0;
  color: var(--fg);
  caret-color: var(--accent);
  -webkit-user-select: text; user-select: text;
}
.ask input::placeholder{ color: var(--dim) }
.ask input:focus{ box-shadow: 0 0 0 1px var(--accent) }

.menu{
  position: absolute; bottom: calc(100% + 8px); left: 0;
  min-width: 230px; padding: 5px;
  background: rgba(16,16,19,.94);
  -webkit-backdrop-filter: blur(16px) saturate(150%); backdrop-filter: blur(16px) saturate(150%);
  box-shadow: 0 0 0 1px var(--line), 0 18px 44px -18px rgba(0,0,0,.7);
  border-radius: 12px;
  pointer-events: auto;
}
.mhead{ display: flex; flex-direction: column; gap: 3px; padding: 7px 9px 6px }
.mhead .t{ font: 500 12px/1 var(--sans); letter-spacing: -0.01em; color: var(--fg) }
.mhead .p{
  font: 400 10px/1.3 var(--sans); color: var(--dim);
  max-width: 280px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.msep{ height: 1px; background: var(--line); margin: 5px 4px }
.mfoot{ padding: 6px 9px 4px; font: 400 10px/1 var(--sans); color: var(--dim) }
button.row{
  all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 7px 9px; border-radius: 8px; cursor: pointer;
  font: 400 12px/1 var(--sans); letter-spacing: 0; color: var(--dim);
  font-variant-numeric: tabular-nums;
}
button.row:hover, button.row[data-on]{ background: rgba(255,255,255,.07); color: var(--fg) }
button.row[disabled]{ opacity: .45; cursor: default }
button.row[disabled]:hover{ background: none; color: var(--dim) }
button.row .pn{ min-width: 14px; opacity: .8 }
button.row .n{ margin-left: auto; font-size: 10px; opacity: .7 }
button.row .cost{ display: block; margin-top: 3px; font-size: 10px; opacity: .62 }

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
  /* Every verb and every position must fit a 390px phone at once: the chips
     are content-box (all: unset), so these paddings ride on top of min-width,
     and the pre-icon values overflowed the dock the moment a fourth tail
     button existed. Counted, not eyeballed. */
  button.chip{ min-width: 24px; padding: 0 3px }
  button.chip.nav{ padding: 0 2px }
  button.chip.named{ padding: 0 6px }
  button.chip.act{ padding: 0 7px }
  button.chip.ic{ padding: 0; min-width: 26px }
  button.chip.go{ padding: 0 8px }
  .tail{ gap: 2px; margin-left: 2px; padding-left: 6px }
  /* When the round outgrows the phone (six positions, or coarse-pointer
     44px targets), the pager scrolls sideways rather than letting the dock
     clip the verbs; positionThumb keeps the live chip centred. "safe"
     degrades to plain center where unsupported, which just keeps today's
     behavior. */
  .pager{ min-width: 0; overflow-x: auto; scrollbar-width: none; justify-content: safe center }
  .pager::-webkit-scrollbar{ display: none }
}
@media (pointer: coarse){
  .dock{ height: 56px } button.chip, .thumb, .receipt{ height: 44px; min-width: 44px }
  .ask input{ height: 44px; font: 400 14px/42px var(--sans) }
}
@media (prefers-reduced-motion: reduce){
  .dock, .thumb, .chip, .note, .wrap, .hl{ transition: none !important; animation: none !important }
  .dock::after{ animation: none !important }
  .chip svg, .chip svg path{ transition: none !important; animation: none !important }
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
  font: 500 10px/1 "variate-inter", -apple-system, system-ui, "Segoe UI", sans-serif;
  letter-spacing: 0; white-space: nowrap;
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

  // The three verbs, drawn by hand for this dock rather than pulled from an
  // icon set: pick is a viewfinder whose fourth corner is the cursor doing
  // the picking, refine is two staggered sliders mid-adjustment, keep is the
  // check. Built node by node, never from a markup string, so Trusted Types
  // cannot break it, same as everything else here.
  const SVG_NS = "http://www.w3.org/2000/svg";
  const ICONS = {
    pick: [
      ["path", { d: "M8.5 3.5h-3a2 2 0 0 0-2 2v3" }],
      ["path", { d: "M15.5 3.5h3a2 2 0 0 1 2 2v3" }],
      ["path", { d: "M3.5 15.5v3a2 2 0 0 0 2 2h3" }],
      ["path", { d: "M11.5 11.5l9 3.4-4 1.6-1.6 4z", fill: "currentColor" }],
    ],
    refine: [
      ["path", { d: "M4 8h6.4" }], ["path", { d: "M16.6 8H20" }],
      ["circle", { cx: "13.5", cy: "8", r: "2.4" }],
      ["path", { d: "M4 16h1.4" }], ["path", { d: "M11.6 16H20" }],
      ["circle", { cx: "8.5", cy: "16", r: "2.4" }],
    ],
    keep: [
      ["path", { d: "M4.5 12.6l5.1 5.1L19.5 6.6", "stroke-width": "2.4" }],
    ],
  };
  function icon(name) {
    const s = document.createElementNS(SVG_NS, "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("width", "15"); s.setAttribute("height", "15");
    s.setAttribute("fill", "none");
    s.setAttribute("stroke", "currentColor");
    s.setAttribute("stroke-width", "1.8");
    s.setAttribute("stroke-linecap", "round");
    s.setAttribute("stroke-linejoin", "round");
    s.setAttribute("aria-hidden", "true");
    for (const [tag, attrs] of ICONS[name]) {
      const n = document.createElementNS(SVG_NS, tag);
      for (const k in attrs) n.setAttribute(k, attrs[k]);
      s.appendChild(n);
    }
    return s;
  }

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
  const tipEl = el("div", { class: "tip" });
  // The refine input lives OUTSIDE the tail on purpose: the tail is rebuilt on
  // every render, and a poll must never destroy a field mid-typing.
  const askEl = el("form", { class: "ask", hidden: true });
  const askInput = el("input", { type: "text", "aria-label": "refine this variant" });
  askEl.appendChild(askInput);
  const noteEl = el("div", { class: "note" });
  const dock = el("div", { class: "dock", role: "toolbar", "aria-label": "variate" });
  const hitbox = el("div", { class: "hit", onclick: () => setCollapsed(false) });
  wrap.appendChild(askEl); wrap.appendChild(noteEl); wrap.appendChild(dock);
  wrap.appendChild(tipEl); wrap.appendChild(hitbox);
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
  // Two different things used to be one flag, and conflating them cost the
  // user the card. `switching` is a write in flight, measured in milliseconds,
  // and it is the ONLY thing that may refuse a keypress. `busy` is the wait
  // for the page to visibly catch up, which can take seconds on a cold
  // compile: it drives the hairline and nothing else. Blocking the arrows on
  // that second one froze the card for the whole deadline every time a
  // variant changed the layout without changing the words.
  let switching = false;    // a /switch POST is in flight
  let busy = false;         // waiting for their dev server to show it
  let renderGen = 0;        // only the newest wait may conclude
  let optimistic = null;    // { set, n, at } until the server's own reading agrees
  const markerSeen = new Set(); // sets we have seen wearing data-variate-section
  let keeping = false;      // a keep POST in flight
  let signing = false;      // the keep check is drawing itself; renders hold
  let askOpen = false;      // the refine input is up
  let exiting = false;      // playing the goodbye slide
  let collapsed = sessionStorage.getItem("variate.collapsed") === "1";
  let menuOpen = false;
  let picking = false;
  let noteTimer = null;
  let sig = "";             // render signature, so polls never rebuild the DOM

  const setOf = (name) => (state?.sets || []).find((s) => s.name === name) || null;
  const active = () => setOf(cur) || (state?.sets || [])[0] || null;
  // The live position, one beat ahead of the server. The sidecar derives `at`
  // by hashing and pushes it on its next tick; between our successful /switch
  // and that tick, WE are the fresher source, so everything that reads the
  // live position reads it through here.
  const OPTIMISTIC_MS = 2500;
  const atOf = (s) =>
    (optimistic && s && optimistic.set === s.name && Date.now() - optimistic.at < OPTIMISTIC_MS
      ? optimistic.n
      : s?.at);

  // A kept set is locked: the decision is made, and flipping it further would
  // un-make it silently. The lock lives in sessionStorage so a reload (often
  // ours) keeps it, and it dissolves on its own if the set changes shape
  // (the agent drew more instead of ending) or disappears (the agent ended
  // it). The queued done ask is a second witness that survives a lost
  // sessionStorage.
  const shapeOf = (s) => (s.have || []).join(".") + "|" + (s.plan || []).length;
  function keptStore() {
    try { return JSON.parse(sessionStorage.getItem("variate.kept") || "{}"); } catch { return {}; }
  }
  function saveKeptStore(all) {
    try { sessionStorage.setItem("variate.kept", JSON.stringify(all)); } catch { /* ignore */ }
  }
  function setKept(s, n, label) {
    const all = keptStore();
    // Scoped to this sidecar run: the token dies with `variate end`, so a
    // lock can never come back to life on a later round that happens to
    // share a name and a shape ("hero", four positions, which is the common
    // case, not an exotic one).
    all[s.name] = { n, label, shape: shapeOf(s), run: VARIATE.token };
    saveKeptStore(all);
  }
  function clearKept(name) {
    const all = keptStore();
    if (!(name in all)) return;
    delete all[name];
    saveKeptStore(all);
  }
  function keptFor(s) {
    if (!s) return null;
    const e = keptStore()[s.name];
    if (e && e.run === VARIATE.token && e.shape === shapeOf(s)) return e;
    const ask = allAsks().find((a) => a.type === "done" && a.set === s.name);
    if (ask) {
      const m = /keep (\d+)/.exec(ask.label || "");
      return { n: m ? Number(m[1]) : null, label: null, shape: shapeOf(s) };
    }
    return null;
  }

  function allAsks() {
    return [
      ...(state?.queued || []).map((a) => ({ ...a, bucket: "queued" })),
      ...(state?.working || []).map((a) => ({ ...a, bucket: "working" })),
    ];
  }
  // Asks about THIS round: they are what makes keeping premature, because
  // the agent is about to change the set under the user.
  function asksFor(s) {
    return s ? allAsks().filter((a) => a.set === s.name) : [];
  }
  // A pick's vary names no set until the agent resolves the file. It belongs
  // to no round, so it must not take the verbs away from any of them.
  function globalAsks() {
    return allAsks().filter((a) => a.set == null);
  }
  const scopedAsks = (s) => asksFor(s).concat(globalAsks());

  const agentHere = () => state?.agent === "here";

  // Can this round be concluded right now? Two positions is the obvious case,
  // but a narrowed round has exactly one and still needs a way to say "yes,
  // this is it". What must not happen is offering the verdict while positions
  // are still landing, so a round with ghosts left to fill waits.
  function canDecide(s) {
    if (!s) return false;
    const have = s.have || [];
    const upto = Math.max(s.max || 0, (s.plan || []).length || 0, 1);
    return have.length >= 2 || (have.length >= 1 && have.length >= upto);
  }

  function note(text, opts) {
    clearTimeout(noteTimer);
    noteEl.textContent = text;
    noteEl.toggleAttribute("data-on", !!text);
    noteEl.toggleAttribute("data-copy", !!(opts && opts.copy));
    noteEl.onclick = opts && opts.copy
      ? () => {
        // A denied or absent clipboard must fail quietly: the text is
        // already on screen, and an unhandled rejection helps nobody.
        const p = navigator.clipboard && navigator.clipboard.writeText(opts.copy);
        if (p) p.then(() => note("copied")).catch(() => {});
      }
      : null;
    if (text && !(opts && opts.sticky)) noteTimer = setTimeout(() => note(""), opts?.ms || 2600);
  }

  // A label and an optional key hint, shown the instant you point at
  // something and centred over it. `tip(node, "flip back", "←")`.
  function tip(node, text, keyHint) {
    if (!node) return;
    node.__tip = { text, keyHint };
    if (node.__tipWired) return;
    node.__tipWired = true;
    const show = () => {
      const t = node.__tip;
      if (!t || !t.text || collapsed) return;
      tipEl.textContent = t.text;
      if (t.keyHint) tipEl.appendChild(el("span", { class: "k", text: t.keyHint }));
      // Centre over the button, then pull back inside the dock's own width
      // so a tip on the first or last chip never hangs off the edge.
      tipEl.style.left = "0px";
      const nb = node.getBoundingClientRect();
      const wb = wrap.getBoundingClientRect();
      const want = nb.left + nb.width / 2 - wb.left - tipEl.offsetWidth / 2;
      const max = Math.max(0, wb.width - tipEl.offsetWidth);
      tipEl.style.left = Math.max(0, Math.min(want, max)) + "px";
      tipEl.__owner = node;
      tipEl.setAttribute("data-on", "");
    };
    const hide = () => tipEl.removeAttribute("data-on");
    node.addEventListener("pointerenter", show);
    node.addEventListener("pointerleave", hide);
    node.addEventListener("focus", show);
    node.addEventListener("blur", hide);
    node.addEventListener("click", hide);
  }
  const hideTip = () => tipEl.removeAttribute("data-on");

  function setCollapsed(v) {
    collapsed = v;
    if (v) { closeAsk(); closeMenu(); }
    sessionStorage.setItem("variate.collapsed", v ? "1" : "0");
    wrap.toggleAttribute("data-collapsed", v);
  }

  // -------------------------------------------------------------------------
  // transport

  async function post(pathname, body) {
    const r = await fetch(API + pathname, { method: "POST", headers: AUTH, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      // A refusal from a live sidecar is not the same thing as a dead one,
      // and the difference decides whether the card should say "offline".
      const err = new Error(j.error || String(r.status));
      err.status = r.status;
      throw err;
    }
    return j;
  }

  let es = null, offline = false;
  // Set when the sidecar is reachable but refuses us (401). Not the same as
  // offline: offline recovers on its own, this one needs a fresh card.
  let misconfigured = false;
  function connect() {
    try { es?.close(); } catch (_) {}
    es = new EventSource(`${API}/events?t=${encodeURIComponent(VARIATE.token)}`);
    es.addEventListener("state", (e) => {
      offline = false;
      try { apply(JSON.parse(e.data)); } catch (_) {}
    });
    // The sidecar is going away for good (variate end). Close the stream, or
    // EventSource retries a dead port every two seconds for the life of the
    // tab and the user's console fills with connection errors.
    es.addEventListener("bye", () => { try { es.close(); } catch (_) {} });
    es.onerror = () => {
      if (!offline) { offline = true; render(); }
      // EventSource retries on its own; the retry hint is set server-side.
    };
  }

  // -------------------------------------------------------------------------
  // links
  //
  // `?variate=hero:3` opens on a position, so a round survives a reload and
  // can be sent to someone sitting at the same dev server. We only WRITE the
  // param on a page we serve ourselves: rewriting the URL of someone's app
  // means arguing with their router, and that is their URL, not ours.

  function stampUrl(setName, n) {
    if (!weServeThisPage()) return;
    try {
      const u = new URL(location.href);
      u.searchParams.set("variate", `${setName}:${n}`);
      history.replaceState(null, "", u);
    } catch (_) { /* opaque origin, or history is not ours to touch */ }
  }

  let linkRead = false;
  function followLink() {
    if (linkRead) return;
    linkRead = true;
    let raw = null;
    try { raw = new URLSearchParams(location.search).get("variate"); } catch (_) { return; }
    if (!raw) return;
    const bits = String(raw).split(":");
    const wanted = bits.length > 1 ? bits[0] : null;
    const n = Number(bits[bits.length - 1]);
    if (!Number.isFinite(n)) return;
    if (wanted && setOf(wanted)) { cur = wanted; sessionStorage.setItem("variate.set", cur); }
    const s = active();
    if (s && !keptFor(s) && (s.have || []).includes(n) && atOf(s) !== n) go(n);
  }

  // -------------------------------------------------------------------------
  // switching

  function go(n) {
    const s = active();
    // Only a write in flight refuses a flip. Waiting for the page to LOOK
    // different (busy) never does: the file is already switched, the next
    // keypress is a new decision, and holding the keys hostage to a render
    // deadline froze the card for seconds on variants that reuse the copy.
    // A keep in flight counts as a write: the verdict already names its
    // position, and flipping under it would make the receipt a lie.
    if (!s || switching || keeping) return;
    if (keptFor(s)) return;
    if (!(s.have || []).includes(n)) return;

    // Landing on the position you are already on is a replay: rewrite the
    // file anyway so the page mounts it again and any entrance animation
    // runs a second time. Judging motion means seeing it more than once.
    const again = n === atOf(s);

    switching = true;
    busy = true;
    dock.setAttribute("data-busy", "");
    const label = s.plan[n - 1]?.name;
    note(again ? "replaying" : (label ? `${n} \u00b7 ${label}` : ""));

    post("/switch", { set: s.name, to: n, source: "card", force: again })
      .then((out) => {
        switching = false;
        // The file IS this position now: show it before the sidecar's next
        // tick says so, so a run of arrow presses reads as flipping, not lag.
        optimistic = { set: s.name, n, at: Date.now() };
        sig = ""; render();
        // State is only pushed when it changes, so an overlay the server
        // never confirms could otherwise sit there forever with nothing due
        // to arrive and correct it. Hand it an ending of its own.
        setTimeout(() => {
          if (optimistic && optimistic.set === s.name && optimistic.n === n) {
            optimistic = null; sig = ""; render();
          }
        }, OPTIMISTIC_MS + 100);
        stampUrl(s.name, n);
        if (out.adopted) note(`your edit kept as ${out.adopted}`, { ms: 3400 });
        // The dev server re-renders on its own. Watch for it, and if nothing
        // moves (no HMR: plain HTML, a template stack), reload once.
        waitForRender({ replay: again, set: s.name });
      })
      .catch((e) => {
        switching = false;
        busy = false; dock.removeAttribute("data-busy");
        if (e?.status) {
          // The sidecar answered and said no (an unwritable file, a variant
          // that vanished). Say what it said, and do not pretend to be offline.
          note(`could not switch · ${e.message}`, { ms: 6000 });
          return;
        }
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
  // A variant that carries data-variate-section can be watched precisely: its
  // own box, its own subtree. Without it the whole page is sampled, and
  // structure is sampled alongside the words, because a design alternative
  // usually keeps the user's own copy: watching text alone reports "nothing
  // happened" for exactly the redesigns this tool exists to compare.
  function markerFor(name) {
    if (!name) return null;
    return document.querySelector(`[data-variate-section="${CSS_escape(name)}"]`);
  }
  function fingerprint(name) {
    const el = markerFor(name);
    if (el) {
      const r = el.getBoundingClientRect();
      const t = el.textContent || "";
      return `m|${Math.round(r.width)}x${Math.round(r.height)}|${el.getElementsByTagName("*").length}|${t.length}|${t.slice(0, 200)}`;
    }
    let n = 0, els = 0, head = "";
    for (const child of document.body ? document.body.children : []) {
      if (child === container) continue;
      const t = child.textContent || "";
      n += t.length;
      els += child.getElementsByTagName("*").length;
      if (head.length < 300) head += t.slice(0, 300 - head.length);
    }
    return `p|${n}|${els}|${Math.round(document.body ? document.body.scrollHeight : 0)}|${head}`;
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

  // When variate serves the page itself, it is same-origin, which means a
  // switch can be applied by swapping the document instead of reloading it:
  // no white flash, no lost scroll position, and it still works when the tab
  // is in the background. Anything with its own scripts still reloads, since
  // re-running scripts by hand is where this kind of trick starts lying.
  const weServeThisPage = () => location.origin === API;

  async function swapInPlace() {
    const res = await fetch(location.href, { cache: "no-store" });
    if (!res.ok) return false;
    const doc = new DOMParser().parseFromString(await res.text(), "text/html");
    const ours = (s) => (s.getAttribute("src") || "").includes("/v.js") || s.hasAttribute("data-variate");
    if ([...doc.querySelectorAll("script")].some((s) => !ours(s))) return false;

    document.title = doc.title;
    for (const old of document.head.querySelectorAll('style, link[rel="stylesheet"]')) old.remove();
    for (const node of doc.head.querySelectorAll('style, link[rel="stylesheet"]')) {
      document.head.appendChild(document.importNode(node, true));
    }
    for (const attr of ["class", "style"]) {
      const v = doc.body.getAttribute(attr);
      v == null ? document.body.removeAttribute(attr) : document.body.setAttribute(attr, v);
    }
    for (const child of [...document.body.children]) if (child !== container) child.remove();
    for (const node of [...doc.body.children]) {
      if (node.tagName === "SCRIPT") continue;
      document.body.insertBefore(document.importNode(node, true), container);
    }
    return true;
  }

  function waitForRender(opts = {}) {
    const gen = ++renderGen;
    const before = fingerprint(opts.set);
    const started = Date.now();
    const hmr = hasHMR();
    // A replay writes the same bytes, so the page never LOOKS different and
    // watching for a change would wait out the whole deadline. Where we serve
    // the page, mount it again ourselves and be done in a frame; elsewhere the
    // dev server has already re-rendered by the time a short wait is up.
    const deadline = opts.replay ? (weServeThisPage() ? 0 : 1200) : (hmr ? 8000 : 900);
    let settled = false;
    let applying = false;
    const done = (reload) => {
      if (settled) return;
      settled = true;
      // A newer flip owns the card now: this one neither clears the hairline
      // nor, above all, reloads out from under the position they just chose.
      if (gen !== renderGen) return;
      busy = false; dock.removeAttribute("data-busy");
      // A new position can bring its own fixed furniture with it, so this is
      // the moment to check whether we are now in the way. Never per render.
      setTimeout(considerPlacement, 260);
      if (!reload) return;
      // Reload while the tab is in the background and the user comes back to a
      // scroll position they never chose, so defer it rather than skip it.
      if (document.hidden) {
        addEventListener("visibilitychange", function once() {
          removeEventListener("visibilitychange", once);
          if (!document.hidden) location.reload();
        });
        note("switched \u00b7 reloading when you come back", { ms: 3000 });
        return;
      }
      location.reload();
    };
    const poll = () => {
      if (settled || applying) return;
      if (gen !== renderGen) { settled = true; return; }
      if (!opts.replay && fingerprint(opts.set) !== before) return done(false);
      if (Date.now() - started >= deadline) {
        if (opts.replay && !weServeThisPage()) return done(false);
        // With HMR, a slow answer means a cold compile, not a dead server:
        // wait it out rather than reloading over the top of it. Unless we
        // know this set wears a marker and it is nowhere on screen, in which
        // case nothing was ever going to move here and saying "compiling"
        // would be a lie: they are on a route this piece does not render on.
        if (!opts.replay && hmr) {
          const away = opts.set && markerSeen.has(opts.set) && !markerFor(opts.set);
          note(away ? `switched · the ${opts.set} is not on this screen` : "your dev server is still compiling that one",
            { ms: away ? 4000 : 2600 });
          return done(false);
        }
        if (!weServeThisPage()) return done(true);
        applying = true;
        return swapInPlace()
          .then((ok) => { applying = false; done(!ok); })
          .catch(() => { applying = false; done(true); });
      }
      setTimeout(poll, 120);
    };
    setTimeout(poll, 120);
  }

  // -------------------------------------------------------------------------
  // keep and refine: the verbs that conclude a round

  function keep() {
    const s = active();
    // Same rule as go(): a decision made while the page is still catching up
    // is still a decision. Only a switch POST in flight defers it, because
    // until that returns, which position "the live one" is could still move.
    if (!s || switching || keeping || offline) return;
    if (keptFor(s)) return;
    // An ask about this round is in flight, so the set is about to change:
    // keeping now would tell the agent to end a round whose new positions
    // the user just asked for. This is also why the tail hides the verb,
    // and the two must never disagree: Enter reaches this function too.
    if (asksFor(s).length) return;
    if (!canDecide(s)) return;

    keeping = true;
    const n = atOf(s) ?? null;
    const label = n ? (s.plan[n - 1]?.name ?? null) : "your edit";
    // The signature moment: the check draws itself once, and the receipt
    // waits for the stroke to land. `signing` holds every render for that
    // window, because the sidecar echoes our own ask over SSE within
    // milliseconds and would otherwise rebuild the tail mid-stroke.
    const t0 = Date.now();
    const kBtn = refs ? refs.tail.querySelector("button.chip.go") : null;
    if (kBtn && !REDUCED) { signing = true; kBtn.setAttribute("data-signing", ""); }
    post("/request", { type: "done", params: { set: s.name, n, label } })
      .then(() => {
        const settle = () => {
          signing = false;
          keeping = false;
          setKept(s, n, label);
          closeMenu(); closeAsk(); stopPick();
          const kept = n ? `kept ${n}${label ? ` \u00b7 ${label}` : ""}` : "kept your edit";
          note(agentHere() ? kept : `${kept} \u00b7 send your agent any message to wrap up`,
            { ms: agentHere() ? 2600 : 6000 });
          sig = ""; render();
        };
        setTimeout(settle, signing ? Math.max(0, 300 - (Date.now() - t0)) : 0);
      })
      .catch((e) => {
        signing = false;
        keeping = false;
        if (kBtn) kBtn.removeAttribute("data-signing");
        sig = "";  // the hold may have swallowed a render
        if (e?.status) { note(`could not keep · ${e.message}`, { ms: 6000 }); render(); return; }
        offline = true; render();
        note(`say: keep ${n ?? "the live one"} of the ${s.name}`,
          { copy: `keep ${n ?? "the live one"} of the ${s.name}`, sticky: true });
      });
  }

  function openAsk() {
    const s = active();
    if (!s || offline || keptFor(s)) return;
    closeMenu();
    askOpen = true;
    askEl.hidden = false;
    askInput.value = "";
    // With enough positions on the table the input also teaches the other
    // move: naming parts from several of them. The agent reads either.
    const donors = (s.have || []).filter((n) => n !== atOf(s)).slice(0, 2);
    askInput.placeholder = donors.length >= 2
      ? `more like ${atOf(s) ?? "this"}, but ... · or ${donors[0]}'s layout with ${donors[1]}'s palette`
      : `more like ${atOf(s) ?? "this"}, but ...`;
    note("");
    askInput.focus();
    sig = ""; render();
  }

  function closeAsk() {
    if (!askOpen) return;
    askOpen = false;
    askEl.hidden = true;
    try { askInput.blur(); } catch (_) {}
    sig = ""; render();
  }

  // Enter submits explicitly: implicit form submission is unreliable inside
  // shadow roots and embedded webviews, and this input is ours to own.
  askInput.addEventListener("keydown", (e) => {
    // Accept the several ways a return key can present itself (key, code, and
    // the legacy numeric), so an IME or an odd input stack cannot swallow the
    // one gesture that sends the steer.
    if (!(e.key === "Enter" || e.code === "Enter" || e.keyCode === 13)) return;
    if (e.isComposing) return;
    e.preventDefault();
    if (askEl.requestSubmit) askEl.requestSubmit();
    else askEl.dispatchEvent(new Event("submit", { cancelable: true }));
  });

  askEl.addEventListener("submit", (e) => {
    e.preventDefault();
    const s = active();
    const steer = askInput.value.trim();
    if (!s || !steer) return;
    post("/request", { type: "more", params: { set: s.name, from: atOf(s) ?? null, steer, count: 2 } })
      .then(() => {
        closeAsk();
        note(agentHere()
          ? "sent \u00b7 your agent is on it"
          : "saved \u00b7 send your agent any message and it picks this up",
          { ms: agentHere() ? 3400 : 6000 });
        sig = ""; render();
      })
      .catch((e) => {
        closeAsk();
        if (e?.status) { note(`could not send that · ${e.message}`, { ms: 6000 }); return; }
        offline = true; sig = ""; render();
        note(`say: more like ${atOf(s) ?? "this"} of the ${s.name}, ${steer}`,
          { copy: `more like ${atOf(s) ?? "this"} of the ${s.name}, ${steer}`, sticky: true });
      });
  });

  // -------------------------------------------------------------------------
  // staying out of the way
  //
  // Ask the page what is underneath the bar. Anything pinned there (a toast
  // stack, a bottom sheet, a mobile nav, a sticky buy button) is the design
  // being judged, and we are covering it. Move once, remember it, and never
  // move back on our own: a bar that hops around while you work is worse
  // than one in the wrong place.

  let placed = sessionStorage.getItem("variate.place") || "";
  const OURS = (e) => e === container || (e.closest && e.closest("[data-variate-ignore]"));

  function somethingLivesUnderUs() {
    const r = dock.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const y = r.top + r.height / 2;
    for (const x of [r.left + 8, r.left + r.width / 2, r.right - 8]) {
      for (const hit of document.elementsFromPoint(x, y)) {
        if (OURS(hit)) continue;
        let n = hit, hops = 0;
        while (n && n !== document.body && hops++ < 3) {
          const pos = getComputedStyle(n).position;
          if (pos === "fixed" || pos === "sticky") return true;
          n = n.parentElement;
        }
        break;                       // only the topmost element that is not ours counts
      }
    }
    return false;
  }

  function considerPlacement() {
    if (placed === "top" || collapsed || !(state?.sets || []).length) return;
    if (!somethingLivesUnderUs()) return;
    placed = "top";
    try { sessionStorage.setItem("variate.place", "top"); } catch (_) {}
    host.setAttribute("data-top", "");
    note("moved up, something lives down there", { ms: 3200 });
  }

  // -------------------------------------------------------------------------
  // render (build once, then update in place; never destroy an open menu)

  // The sidecar answered and turned us away (a stale card from an older run,
  // or two sidecars fighting over one project). Say so on the page: this is
  // the one failure the user cannot diagnose from the outside.
  function drawMisconfigured() {
    if (!refs) build();
    refs.nameBtn.textContent = "variate";
    refs.nameBtn.disabled = true;
    for (const c of refs.chips) c.remove();
    refs.chips = [];
    refs.tail.textContent = "";
    const b = el("button", { class: "chip act", type: "button", text: "reconnect" });
    tip(b, "this card is from an older run of variate");
    b.onclick = () => location.reload();
    refs.tail.appendChild(b);
    positionThumb();
  }

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

  // What the tail should say, in order of who wins. Only an ask about THIS
  // round takes the verbs away: a pick aimed at some other section leaves
  // this one concludable.
  function tailState(s) {
    if (offline) return "offline";
    if (keptFor(s)) return "receipt";
    if (asksFor(s).length) return "pending";
    return "idle";
  }

  function signature() {
    const s = active();
    const ask = s ? scopedAsks(s)[0] : null;
    return JSON.stringify([
      s?.name, s?.n, s?.at, s?.plan, (state?.sets || []).length,
      offline, picking, askOpen, exiting, state?.agent,
      s ? tailState(s) : null,
      s ? (keptFor(s)?.n ?? false) : false,
      s ? markerSeen.has(s.name) && !markerFor(s.name) : false,
      ask ? `${ask.id}:${ask.bucket}` : null,
      (state?.working || []).length, (state?.queued || []).length,
    ]);
  }

  function render() {
    // Nothing repaints while the keep check is drawing: the next render is
    // the receipt, and it arrives when the stroke lands (or on the failure
    // path, which resets `sig` so nothing stays stale).
    if (signing) return;
    const next = signature();
    if (next === sig) { positionThumb(); return; }
    sig = next;
    if (!refs) build();

    const sets = state?.sets || [];
    const s = active();

    // No sets: render nothing at all (after the goodbye slide, if one is
    // playing), so a stale script tag on a finished project is invisible.
    // A refused connection is different from a finished one though: if the
    // sidecar is answering but rejecting us, staying hidden leaves the user
    // staring at one design wondering where the bar went.
    const visible = sets.length || exiting || misconfigured;
    host.style.display = visible ? "" : "none";
    hlHost.style.display = sets.length ? "" : "none";
    if (!sets.length) {
      if (misconfigured) drawMisconfigured();
      return;
    }

    const kept = keptFor(s);
    const locked = !!kept;
    wrap.toggleAttribute("data-kept", locked);

    // Route-aware duck: a set that tags itself, currently rendered on some
    // OTHER screen of the app, does not need the full card on this one. The
    // markerSeen gate keeps this honest the same way the "not on this
    // screen" note is kept honest, so CSS and theme sets never duck.
    const away = !picking && !askOpen && !locked && markerSeen.has(s.name) && !markerFor(s.name);
    wrap.toggleAttribute("data-away", away);

    refs.nameBtn.textContent = s.name;
    refs.nameBtn.disabled = false;
    tip(refs.nameBtn, "what each position tries", sets.length > 1 ? "[ ]" : null);

    // pager: one chip per position, plus arrows
    // Chips run to the highest position the round will have, so the pager
    // shows the shape of the round while it is still being drafted. A
    // position with no file yet is a ghost, and positions can land in any
    // order (parallel drafting), so membership is what counts, not the count.
    const have = s.have || [];
    const upto = Math.max(s.max || 0, s.plan.length || 0, 1);
    const want = [];
    want.push({ k: "prev", label: "\u2039", nav: true });
    for (let i = 1; i <= upto; i++) want.push({ k: "p" + i, n: i, landed: have.includes(i) });
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
      if (w.nav) {
        b.textContent = w.label;
        b.setAttribute("aria-label", w.k === "prev" ? "previous" : "next");
        tip(b, w.k === "prev" ? "previous" : "next", w.k === "prev" ? "\u2190" : "\u2192");
        return;
      }
      const landed = w.landed;
      const live = landed && w.n === atOf(s);
      const p = s.plan[w.n - 1] || {};
      // The one you are on wears its name, the rest stay numbers: you always
      // know what you are looking at without hovering, and the bar stays as
      // narrow as a row of digits. The name is its own element so a dock that
      // is running out of room can drop it and keep the actions reachable.
      b.textContent = String(w.n);
      b.classList.toggle("named", !!(live && p.name));
      if (live && p.name) b.appendChild(el("span", { class: "nm", text: p.name }));
      b.disabled = !landed;
      b.setAttribute("aria-current", String(live));

      // The tooltip carries what the chip cannot: what this position changes
      // and what that costs you. That is the whole decision, on the thing you
      // are pointing at, at the moment you are deciding.
      const trade = [p.angle, p.cost ? `costs ${p.cost}` : null].filter(Boolean).join(" \u00b7 ");
      const text = !landed
        ? (p.name ? `${p.name} \u00b7 drawing` : "drawing")
        : live
          ? (trade || p.name || `variant ${w.n}`) + (locked ? "" : " \u00b7 click to replay")
          : [p.name, trade].filter(Boolean).join(" \u00b7 ") || `variant ${w.n}`;
      tip(b, text, landed && !locked && !live ? String(w.n) : null);
    });

    // tail: what the round needs next
    refs.tail.textContent = "";
    const ts = tailState(s);

    if (ts === "offline") {
      const b = el("button", { class: "chip act", type: "button", text: "offline" });
      tip(b, "variate is not answering · click for what to say");
      const line = kept
        ? `keep ${kept.n ?? "the live one"} of the ${s.name}`
        : `variate the ${s.name}`;
      b.onclick = () => note(`say: ${line}`, { copy: line, sticky: true });
      refs.tail.appendChild(b);
    } else if (ts === "receipt") {
      const text = kept.n
        ? `kept ${kept.n}${kept.label ? ` \u00b7 ${kept.label}` : ""}`
        : "kept your edit";
      refs.tail.appendChild(el("div", { class: "receipt", text }));
    } else if (ts === "pending") {
      const ask = asksFor(s)[0];
      const here = agentHere();
      const word = ask.bucket === "working"
        ? (here ? "drawing" : "stalled")
        : (here ? "sent" : "saved");
      const b = el("button", { class: "chip act", type: "button", text: word });
      // The tooltip answers "what did I send?", the click answers "so what
      // happens now?". The note right after a send already says the second
      // one, and a chip that appears under a resting pointer shows its tip
      // immediately, so the two must never carry the same sentence.
      tip(b, word === "stalled" ? "your agent went quiet on this one" : ask.label);
      b.onclick = word === "stalled"
        ? () => note(`say: ${ask.label}`, { copy: ask.label, sticky: true })
        : word === "drawing"
          ? () => note(ask.label, { ms: 3200 })
          : () => note(here ? "your agent is on it" : "send your agent any message and it picks this up", { ms: 3200 });
      refs.tail.appendChild(b);
    } else {
      // A pick aimed at another section is still worth showing, but as a
      // quiet aside next to the verbs rather than in place of them.
      const g = globalAsks()[0];
      if (g) {
        const b = el("button", { class: "chip act", type: "button", text: agentHere() ? "drawing" : "saved" });
        tip(b, g.label);
        b.onclick = () => note(g.label, { ms: 3200 });
        refs.tail.appendChild(b);
      }
      const p = picking
        ? el("button", { class: "chip act", type: "button", text: "cancel" })
        : el("button", { class: "chip act ic", type: "button", "aria-label": "pick a section" });
      if (!picking) p.appendChild(icon("pick"));
      tip(p, picking ? "cancel" : "pick · click a section to vary it", picking ? "esc" : null);
      p.onclick = () => (picking ? stopPick() : startPick());
      refs.tail.appendChild(p);
      if (canDecide(s)) {
        const r = el("button", { class: "chip act ic", type: "button", "aria-label": "refine this one" });
        r.appendChild(icon("refine"));
        tip(r, "refine · more like this one, but ...");
        r.onclick = openAsk;
        refs.tail.appendChild(r);
        const k = el("button", { class: "chip go ic", type: "button", "aria-label": "keep this one" });
        k.appendChild(icon("keep"));
        tip(k, "keep · this is the one, your agent wraps up", "enter");
        k.onclick = keep;
        refs.tail.appendChild(k);
      }
    }

    const x = el("button", { class: "chip nav", type: "button", text: "\u25be" });
    tip(x, "hide the card", "esc");
    x.setAttribute("aria-label", "hide");
    x.onclick = () => { hideTip(); setCollapsed(true); };
    refs.tail.appendChild(x);

    // The hairline breathes while an ask is waiting for the agent, including
    // the moment between keep and the agent's cleanup.
    dock.toggleAttribute("data-pending", ts === "pending" || (ts === "receipt" && scopedAsks(s).length > 0));

    // A rebuild can remove the button the pointer is resting on (keep clears
    // the whole tail), and no pointerleave ever fires for a node that left the
    // document, so the tooltip would stay up, orphaned, until the next hover.
    if (tipEl.hasAttribute("data-on") && !(tipEl.__owner && tipEl.__owner.isConnected)) hideTip();

    positionThumb();
  }

  function positionThumb() {
    const s = active();
    if (!refs || !s) return;
    const kept = keptFor(s);
    const idx = kept ? (kept.n ?? 0) : (atOf(s) || 0);
    const chip = idx ? refs.chips[idx] : null;  // chips[0] is the prev arrow
    if (!chip || (chip.disabled && !kept)) { refs.thumb.setAttribute("hidden", ""); return; }
    refs.thumb.removeAttribute("hidden");
    refs.thumb.style.setProperty("--x", chip.offsetLeft + "px");
    refs.thumb.style.width = chip.offsetWidth + "px";
    // A pager that had to become scrollable keeps the live position in view.
    const pg = refs.pager;
    if (pg.scrollWidth > pg.clientWidth + 1) {
      pg.scrollTo({
        left: chip.offsetLeft - (pg.clientWidth - chip.offsetWidth) / 2,
        behavior: REDUCED ? "auto" : "smooth",
      });
    }
  }

  // Step through the positions that actually exist, so a gap or a still
  // drafting position never swallows an arrow press.
  function step(d) {
    const s = active();
    if (keptFor(s)) return;
    const have = s?.have || [];
    if (!have.length) return;
    const i = have.indexOf(atOf(s));
    const next = i === -1 ? (d > 0 ? have[0] : have[have.length - 1])
      : have[(i + d + have.length) % have.length];
    go(next);
  }

  function cycleSet(d) {
    const sets = state?.sets || [];
    if (sets.length < 2) return;
    const i = Math.max(0, sets.findIndex((x) => x.name === active()?.name));
    cur = sets[(i + d + sets.length) % sets.length].name;
    sessionStorage.setItem("variate.set", cur);
    sig = "";
    render();
    note(cur + " \u00b7 " + (active()?.target || ""));
    flashHighlightFor(active());
  }

  // -------------------------------------------------------------------------
  // the menu (built outside the render cycle so a poll never destroys it;
  // apply() rebuilds it in place when the state underneath it changes)

  let menuEl = null;
  function onName() {
    menuOpen ? closeMenu() : openMenu();
  }
  function openMenu() {
    closeMenu();
    closeAsk();
    menuOpen = true;
    const s = active();
    if (!s) { menuOpen = false; return; }
    const kept = keptFor(s);
    menuEl = el("div", { class: "menu", role: "menu" });

    // The question the round is asking leads, because it is the thing every
    // position is an answer to.
    menuEl.appendChild(el("div", { class: "mhead" }, [
      el("span", { class: "t", text: s.question || s.name }),
      el("span", { class: "p", text: s.question ? `${s.name} · ${s.target || ""}` : (s.target || "") }),
    ]));

    // The positions of the set on screen, with the direction each one tries
    // and what it gives up.
    const upto = Math.max(s.max || 0, s.plan.length || 0, 1);
    for (let i = 1; i <= upto; i++) {
      const landed = (s.have || []).includes(i);
      const p = s.plan[i - 1] || {};
      const lbl = p.name ?? (landed ? `variant ${i}` : "drawing");
      // The right-edge tag tells the row's state; a planned position that
      // has no file yet says so here too, not only in the pager tooltip.
      const tagText = kept && kept.n === i ? "kept"
        : landed && i === atOf(s) ? "live"
        : !landed ? "drawing"
        : null;
      const row = el("button", { class: "row", type: "button", role: "menuitem" }, [
        el("span", { class: "pn", text: String(i) }),
        el("span", {}, [
          el("span", { text: lbl }),
          p.cost ? el("span", { class: "cost", text: `costs ${p.cost}` }) : null,
        ]),
        tagText ? el("span", { class: "n", text: tagText }) : null,
      ]);
      if (landed && i === atOf(s)) row.setAttribute("data-on", "");
      row.disabled = !landed || !!kept;
      if (!row.disabled) row.onclick = () => { closeMenu(); go(i); };
      menuEl.appendChild(row);
    }

    // The other open rounds, one hop away.
    const sets = state?.sets || [];
    if (sets.length > 1) {
      menuEl.appendChild(el("div", { class: "msep" }));
      for (const o of sets) {
        if (o.name === s.name) continue;
        const row = el("button", { class: "row", type: "button", role: "menuitem" }, [
          el("span", { text: o.name }),
          el("span", { class: "n", text: atOf(o) ? `${atOf(o)}/${o.n}` : `${o.n}` }),
        ]);
        row.onmouseenter = () => flashHighlightFor(o);
        row.onclick = () => { cur = o.name; sessionStorage.setItem("variate.set", cur); closeMenu(); sig = ""; render(); };
        menuEl.appendChild(row);
      }
    }

    menuEl.appendChild(el("div", { class: "mfoot", text: `your agent: ${agentHere() ? "here" : "away"}` }));
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
      // No self-rescheduling here: the loop below already paints once per
      // frame. Doing both spawns a new paint lineage every frame, and each
      // paint forces a reflow, so pick mode would grind to a halt after a
      // few seconds of hovering.
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

  const SECTIONISH = new Set(["SECTION", "HEADER", "FOOTER", "NAV", "MAIN", "ARTICLE", "ASIDE", "DIALOG"]);
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
      best = e;
      // An active set's own root is the exact answer; never climb past it.
      if (e.getAttribute && e.getAttribute("data-variate-section")) return e;
      const r = e.getBoundingClientRect();
      // A pinned rail or bar is a section whatever its markup says.
      const pos = getComputedStyle(e).position;
      if ((pos === "fixed" || pos === "sticky") && (r.width >= innerWidth * 0.5 || r.height >= innerHeight * 0.5)) return e;
      if (SECTIONISH.has(e.tagName)) return e;
      // Geometry is judged against the VIEWPORT, never the parent: a band is
      // a hero or a footer strip, a rail is a div-soup sidebar. The old
      // parent-relative width test made a narrow rail unmatchable, so a
      // sidebar click climbed all the way up and picked the page shell.
      const band = r.height >= innerHeight * 0.25 && r.width >= innerWidth * 0.6;
      const rail = r.height >= innerHeight * 0.6 && r.width >= 120 && r.width <= innerWidth * 0.4;
      if (band || rail) return e;
    }
    return best;
  }

  // What the click knew, gathered without touching the page. Text comes from
  // textContent walks (see the fingerprint note above): no layout cost, no
  // shadow-root surprises. Every cap here is re-enforced by the sidecar.
  function visibleText(node, cap) {
    let out = "";
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
      acceptNode: (t) => {
        const p = t.parentElement;
        return p && p.closest("style,script,noscript,template") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });
    while (out.length < cap * 2) {
      const t = walker.nextNode();
      if (!t) break;
      out += t.nodeValue + " ";
    }
    return out.replace(/\s+/g, " ").trim().slice(0, cap);
  }
  function headingIn(node) {
    const h = node.querySelector && node.querySelector("h1,h2,h3,h4,h5,h6");
    return h ? visibleText(h, 80) || null : null;
  }
  function chainOf(node) {
    // From the node itself upward: the clicked element's own data-testid or
    // aria-label is often the single best grep in the payload.
    const chain = [];
    for (let e = node, hops = 0; e && e !== document.body && e !== document.documentElement && hops < 6; e = e.parentElement, hops++) {
      let s = e.tagName.toLowerCase();
      if (e.id) s += "#" + e.id;
      const cls = typeof e.className === "string" ? e.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
      if (cls.length) s += "." + cls.join(".");
      for (const a of ["data-testid", "data-component", "data-cy", "aria-label"]) {
        const v = e.getAttribute && e.getAttribute(a);
        if (v) { s += "[" + a + "=" + v.slice(0, 24) + "]"; break; }
      }
      if (s !== "div" && s !== "span") chain.push(s.slice(0, 80));
    }
    return chain;
  }
  function placeOf(node, r) {
    const vw = innerWidth, vh = innerHeight;
    const top = r.top + scrollY;
    const docH = Math.max(document.documentElement.scrollHeight, vh);
    if (r.height >= vh * 0.5 && r.width <= vw * 0.4) return "sidebar";
    if (top + r.height >= docH - 80) return "footer";
    if (top < vh * 0.2 && r.height <= vh * 0.35 && r.width >= vw * 0.8) return "header";
    if (top < vh * 0.4 && r.height >= vh * 0.45) return "hero";
    return "band";
  }
  function srcHint(node) {
    // Dev-build framework handles, when the stack leaves them lying around:
    // Svelte stamps elements with their source location, Vue hangs the
    // component file off the vnode. Free precision; absent in production.
    try {
      for (let e = node, hops = 0; e && hops < 6; e = e.parentElement, hops++) {
        const sv = e.__svelte_meta && e.__svelte_meta.loc;
        if (sv && sv.file) return String(sv.file).slice(0, 190) + ":" + sv.line + ":" + sv.column;
        const vue = e.__vueParentComponent && e.__vueParentComponent.type && e.__vueParentComponent.type.__file;
        if (vue) return String(vue).slice(0, 200);
      }
    } catch { /* not that stack */ }
    return null;
  }

  function describe(node) {
    const r = node.getBoundingClientRect();
    const pos = getComputedStyle(node).position;
    const marked = node.closest && node.closest("[data-variate-section]");
    const sel = {
      v: 2,
      set: (marked && marked.getAttribute("data-variate-section")) || null,
      tag: node.tagName.toLowerCase(),
      id: node.id || null,
      cls: (typeof node.className === "string" ? node.className : "").slice(0, 120) || null,
      text: visibleText(node, 140) || null,
      heading: headingIn(node),
      chain: chainOf(node),
      rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      place: placeOf(node, r),
      pinned: pos === "sticky" || pos === "fixed" ? pos : null,
      url: {
        path: location.pathname,
        search: location.search || null,
        hash: location.hash || null,
        title: (document.title || "").slice(0, 80) || null,
      },
      src: srcHint(node),
      media: null,
    };
    if (!sel.text && node.querySelectorAll) {
      // No copy to grep for (an icon grid, an image hero): image alt text
      // and aria labels are the next most distinctive words available.
      const alts = [];
      for (const img of node.querySelectorAll("img[alt], svg[aria-label], [role=img][aria-label]")) {
        const a = (img.getAttribute("alt") || img.getAttribute("aria-label") || "").trim();
        if (a) alts.push(a.slice(0, 80));
        if (alts.length === 2) break;
      }
      if (alts.length) sel.media = alts;
    }
    for (const k of Object.keys(sel.url)) if (sel.url[k] == null) delete sel.url[k];
    for (const k of Object.keys(sel)) if (sel[k] == null) delete sel[k];
    if (sel.chain && !sel.chain.length) delete sel.chain;
    return sel;
  }

  let pickMove = null, pickClick = null, pickNode = null;
  function startPick() {
    if (picking) return;
    picking = true;
    closeAsk();
    wrap.setAttribute("data-picking", "");
    sig = ""; render();
    note("click a section to vary it \u00b7 esc to cancel", { sticky: true });

    pickMove = (e) => {
      const n = sectionAt(e.clientX, e.clientY);
      if (!n || n === pickNode) return;
      pickNode = n;
      const mk = n.getAttribute && n.getAttribute("data-variate-section");
      drawHighlight(n, mk || n.tagName.toLowerCase() + (n.id ? "#" + n.id : ""), { animate: true });
    };
    pickClick = (e) => {
      // The page may have re-rendered since the hover (HMR swaps nodes
      // wholesale), and a detached node describes a DOM the user is no
      // longer looking at, so resolve the click point again.
      const target = pickNode && pickNode.isConnected ? pickNode : sectionAt(e.clientX, e.clientY);
      if (!target) return;
      e.preventDefault(); e.stopPropagation();
      const sel = describe(target);
      stopPick();
      const gist = sel.heading || sel.text || (sel.media && sel.media[0]) || "";
      post("/request", { type: "vary", params: {
        count: 4,
        selection: sel,
        hint: gist.slice(0, 40) || undefined,
        // A pick inside an open set's marker is that set, exactly: scoping
        // the ask lets the label, the pending chip and the agent all say so.
        set: sel.set || undefined,
      } })
        .then(() => note(agentHere()
          ? "asked for 4 takes \u00b7 your agent is on it"
          : "asked for 4 takes \u00b7 send your agent any message and it picks this up", { ms: 6000 }))
        .catch(() => note(`say: variate the section that starts "${gist.slice(0, 30)}"`,
          { copy: `variate the ${sel.place ?? "section"} that starts "${gist.slice(0, 60)}"`, sticky: true }));
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
  // horizontally still scrolls. Enter keeps, but never while the focus sits
  // on anything that would act on Enter itself.

  function deepActive() {
    const deep = (n) => (n && n.shadowRoot && n.shadowRoot.activeElement) ? deep(n.shadowRoot.activeElement) : n;
    return deep(document.activeElement);
  }

  function typing() {
    const a = deepActive();
    return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT" || a.isContentEditable);
  }

  const ENTERISH = new Set(["BUTTON", "A", "SELECT", "SUMMARY", "INPUT", "TEXTAREA"]);

  function onKey(e) {
    if (e.key === "Escape") {
      if (picking) return stopPick();
      if (askOpen) return closeAsk();
      if (menuOpen) return closeMenu();
      if (!collapsed) return setCollapsed(true);
      return;
    }
    if (typing() || e.metaKey || e.ctrlKey || e.altKey) return;
    if (collapsed || !(state?.sets || []).length) return;
    if (e.key === "Enter") {
      const a = deepActive();
      if (a && (ENTERISH.has(a.tagName) || a.getAttribute?.("role") === "button")) return;
      if (menuOpen || picking || askOpen) return;
      return keep();
    }
    const locked = !!keptFor(active());
    if (e.key === "ArrowLeft") { if (!locked) step(-1); }
    else if (e.key === "ArrowRight") { if (!locked) step(1); }
    else if (e.key === "[") cycleSet(-1);
    else if (e.key === "]") cycleSet(1);
    else if (e.key === "?") note("\u2190 \u2192 flip \u00b7 1-9 jump \u00b7 again to replay \u00b7 enter keep \u00b7 [ ] section \u00b7 esc hide", { ms: 5000 });
    else if (/^[1-9]$/.test(e.key)) { if (!locked) go(Number(e.key)); }
  }

  // -------------------------------------------------------------------------
  // life

  function apply(next) {
    const hadSets = (state?.sets || []).length > 0;
    state = next;
    if (!cur || !setOf(cur)) cur = (state.sets[0] || {}).name || null;
    if (cur) sessionStorage.setItem("variate.set", cur);

    // The optimistic position stands down the moment the sidecar's own
    // hash-derived reading agrees, the set it spoke for is gone, or the
    // sidecar has had time to look and still says something else. That last
    // one is not a rarity: the user hand-edits the file, or the agent runs
    // `use` to put its own recommendation up. Holding on through that would
    // have the card name one position while `keep` settled another, which is
    // a lie at the exact moment the whole product is about deciding.
    if (optimistic) {
      const s = setOf(optimistic.set);
      const stale = Date.now() - optimistic.at >= OPTIMISTIC_MS;
      if (!s || s.at === optimistic.n || stale) optimistic = null;
    }
    // Remember which sets have ever worn their data-variate-section marker,
    // so "not on this screen" is only ever said about a set that tags itself.
    for (const s of state.sets || []) {
      if (!markerSeen.has(s.name) && markerFor(s.name)) markerSeen.add(s.name);
    }

    // Kept locks dissolve on their own: a set that changed shape was extended
    // by the agent (the round reopened), and a set that is gone was ended.
    for (const name of Object.keys(keptStore())) {
      const e = keptStore()[name];
      const s = setOf(name);
      if (!s || e.run !== VARIATE.token || e.shape !== shapeOf(s)) clearKept(name);
    }

    // The goodbye: the last set closing is the round concluding, so the dock
    // bows out rather than blinking off.
    if (hadSets && !(state.sets || []).length && !exiting) {
      exiting = true;
      closeMenu(); closeAsk(); stopPick();
      wrap.setAttribute("data-exit", "");
      setTimeout(() => {
        exiting = false;
        wrap.removeAttribute("data-exit");
        sig = ""; render();
      }, REDUCED ? 0 : 380);
    }

    // Self-heal: a client-side route change or a rogue unmount must not kill us.
    if (!container.isConnected) document.body.appendChild(container);

    const before = sig;
    render();
    // An open menu tracks the world: rebuild it in place when the state
    // underneath it changed, so it never shows stale positions.
    if (menuOpen && sig !== before) openMenu();
    // Both of these need a set to exist, so they wait for the first state
    // rather than firing at load.
    if ((state.sets || []).length) { followLink(); setTimeout(considerPlacement, 400); }
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
  let placeTimer = null;
  const onResize = () => {
    positionThumb();
    clearTimeout(placeTimer);
    placeTimer = setTimeout(considerPlacement, 300);
  };
  addEventListener("resize", onResize);

  if (placed === "top") host.setAttribute("data-top", "");
  setCollapsed(collapsed);
  // A client-side route change swaps the DOM without touching variate state,
  // so no SSE event arrives to say the marker left the screen. A cheap look
  // every 1.5s keeps the away duck honest; same-signature renders no-op.
  const awayTick = setInterval(() => { if ((state?.sets || []).length) render(); }, 1500);
  dock.setAttribute("data-enter", "");
  setTimeout(() => dock.removeAttribute("data-enter"), 900);
  connect();
  fetch(`${API}/state`, { headers: AUTH })
    .then((r) => {
      if (r.status === 401 || r.status === 403) {
        misconfigured = true;
        sig = ""; render();
        return null;
      }
      return r.json().then(apply);
    })
    .catch(() => { offline = true; render(); });

  window.__variate = {
    version: VARIATE.version,
    go, step, note, keep,
    destroy() {
      try { es?.close(); } catch (_) {}
      clearInterval(awayTick);
      removeEventListener("keydown", onKey, true);
      removeEventListener("scroll", onScroll);
      removeEventListener("pointerdown", onDocDown, true);
      removeEventListener("resize", onResize);
      stopPick();
      container.remove();
    },
  };
})();
