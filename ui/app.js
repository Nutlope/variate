// variate studio: store + SSE + keyboard. Rendering lives in render.js,
// the sketch pad in sketch.js.

import { render } from "/ui/render.js";
import { op } from "/ui/api.js";

export const store = {
  state: null,          // last /api/state payload
  selected: null,       // slug
  highlight: null,      // slug hovered in the rail
  openInsert: null,     // index of the open insert menu
  openMenu: null,       // {slug, kind: "variate" | "prompt"}
  variateCount: Number(localStorage.getItem("variate.count") || 1),
  device: Number(localStorage.getItem("variate.device") || 1280),
  landed: new Set(),    // slugs to glow this render
  prevHashes: new Map(),
};

export function setState(patch) {
  Object.assign(store, patch);
  if (patch.variateCount) localStorage.setItem("variate.count", String(patch.variateCount));
  if (patch.device) localStorage.setItem("variate.device", String(patch.device));
  render(store);
}

function onServerState(state) {
  // Landed glow: any section whose content hash changed since last state.
  store.landed = new Set();
  for (const s of state.sections) {
    const prev = store.prevHashes.get(s.slug);
    if (prev && prev !== s.hash) store.landed.add(s.slug);
  }
  store.prevHashes = new Map(state.sections.map((s) => [s.slug, s.hash]));
  if (store.selected && !state.sections.some((s) => s.slug === store.selected)) store.selected = null;
  store.state = state;
  render(store);
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
  if (document.getElementById("sketch-modal")) return; // the pad owns its keys

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
  if (!slug) return;
  const sec = store.state?.sections.find((s) => s.slug === slug);
  if (!sec) return;

  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    if (sec.takes < 2) return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    const next = ((sec.active + dir) % sec.takes + sec.takes) % sec.takes;
    op({ op: "pick", slug, take: next }).catch(() => {});
  } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
    e.preventDefault();
    op({ op: "move", slug, dir: e.key === "ArrowUp" ? "up" : "down" }).catch(() => {});
  } else if (e.key === "Backspace" || e.key === "Delete") {
    e.preventDefault();
    window.dispatchEvent(new CustomEvent("variate:cut", { detail: { slug } }));
  }
});

fetch("/api/state").then((r) => r.json()).then(onServerState).catch(() => {
  document.getElementById("app").textContent = "cannot reach the studio server";
});
connect();
setInterval(() => {
  // Busy elapsed labels + agent presence tick without a full server round.
  if (store.state) render(store);
}, 1000);
