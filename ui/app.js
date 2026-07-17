// variate studio: store + SSE + keyboard. Rendering lives in render.js,
// the sketch pad in sketch.js.

import { render, tickLive } from "/ui/render.js";
import { op } from "/ui/api.js";

export const store = {
  state: null,          // last /api/state payload (v2: pages[])
  page: null,           // active page id (resolved to the first page on load)
  selected: null,       // slug within the active page
  highlight: null,      // slug hovered in the rail
  openInsert: null,     // index of the open insert menu
  openMenu: null,       // {slug, kind: "variate" | "prompt"} | {kind: "add-page"}
  variateCount: Number(localStorage.getItem("variate.count") || 1),
  device: Number(localStorage.getItem("variate.device") || 1280),
  landed: new Set(),    // page/slug keys to glow this render
  prevHashes: new Map(),
};

/** The active page object (always resolves to something real when pages exist). */
export function curPage() {
  const pages = store.state?.pages ?? [];
  return pages.find((p) => p.id === store.page) ?? pages[0] ?? null;
}

export function setState(patch) {
  Object.assign(store, patch);
  if (patch.variateCount) localStorage.setItem("variate.count", String(patch.variateCount));
  if (patch.device) localStorage.setItem("variate.device", String(patch.device));
  render();
}

function onServerState(state) {
  // Landed glow: any section whose content hash changed since last state,
  // tracked per page/slug so page switches never false-positive.
  store.landed = new Set();
  const hashes = new Map();
  for (const pg of state.pages) {
    for (const s of pg.sections) {
      const key = pg.id + "/" + s.slug;
      const prev = store.prevHashes.get(key);
      if (prev && prev !== s.hash) store.landed.add(key);
      hashes.set(key, s.hash);
    }
  }
  store.prevHashes = hashes;
  store.state = state;
  if (!state.pages.some((p) => p.id === store.page)) store.page = state.pages[0]?.id ?? null;
  const pg = curPage();
  if (store.selected && !pg?.sections.some((s) => s.slug === store.selected)) store.selected = null;
  render();
}

function connect() {
  const es = new EventSource("/events");
  es.addEventListener("state", (e) => {
    try { onServerState(JSON.parse(e.data)); } catch { /* ignore */ }
  });
  es.onerror = () => {
    // EventSource reconnects itself; refetch once it is back.
    setTimeout(() => fetch("/api/state").then((r) => r.json()).then(onServerState).catch(() => {}), 1200);
  };
}

const isTyping = () => {
  const el = document.activeElement;
  return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
};

window.addEventListener("keydown", (e) => {
  if (isTyping()) return;
  if (document.querySelector(".frame-wrap.sketching")) return; // the pad owns its keys

  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === "z") {
    e.preventDefault();
    op({ op: e.shiftKey ? "redo" : "undo" }).catch(() => {});
    return;
  }
  if (e.key === "Escape") {
    setState({ selected: null, openInsert: null, openMenu: null });
    return;
  }
  const slug = store.selected;
  const pg = curPage();
  if (!slug || !pg) return;
  const sec = pg.sections.find((s) => s.slug === slug);
  if (!sec) return;

  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    if (sec.takes < 2) return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    const next = ((sec.active + dir) % sec.takes + sec.takes) % sec.takes;
    op({ op: "pick", page: pg.id, slug, take: next }).catch(() => {});
  } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
    e.preventDefault();
    op({ op: "move", page: pg.id, slug, dir: e.key === "ArrowUp" ? "up" : "down" }).catch(() => {});
  } else if (e.key === "Backspace" || e.key === "Delete") {
    e.preventDefault();
    window.dispatchEvent(new CustomEvent("variate:cut", { detail: { slug } }));
  }
});

fetch("/api/state").then((r) => r.json()).then(onServerState).catch(() => {
  document.getElementById("app").textContent = "cannot reach the studio server";
});
connect();
// The tick updates ONLY live-changing text (busy elapsed). It never touches
// structure or any open input, so typing a prompt is never interrupted.
setInterval(tickLive, 1000);
