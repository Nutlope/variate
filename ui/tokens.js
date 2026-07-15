// Live design-token editor. Parses the :root custom properties out of
// head.html and gives you swatches and fields for them. Editing one previews
// instantly across every section (postMessage override into each frame, no
// reload, no model turn) and persists to head.html debounced. This is how you
// recolor or re-space the whole page in seconds.

import { postToFrames } from "/ui/render.js";
import { toast } from "/ui/api.js";

let card = null;
let tokens = [];          // [{ name, value }]
let lastHeadHash = null;
let pending = {};         // name -> value awaiting persist
let flushTimer = null;
let open = localStorage.getItem("variate.tokens.open") !== "0";

const isHex = (v) => /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v.trim());
const isColor = (v) => { try { return CSS.supports("color", v.trim()); } catch { return false; } };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function parseRoot(head) {
  const m = head.match(/:root\s*\{([\s\S]*?)\}/);
  if (!m) return [];
  return [...m[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((x) => ({ name: x[1], value: x[2].trim() }));
}

export function mountTokens(el) {
  card = el;
  refetch();
}

/** External head change (e.g. the agent polished and folded styles): refresh
 *  values, unless the user is mid-edit inside the panel. */
export function syncTokens(headHash) {
  if (headHash === lastHeadHash) return;
  lastHeadHash = headHash;
  if (card && document.activeElement && card.contains(document.activeElement)) return;
  refetch();
}

async function refetch() {
  try {
    const { head } = await fetch("/api/head").then((r) => r.json());
    tokens = parseRoot(head || "");
    build();
  } catch { /* leave the last panel */ }
}

function build() {
  if (!card) return;
  const colors = tokens.filter((t) => isColor(t.value));
  const others = tokens.filter((t) => !isColor(t.value));
  if (!tokens.length) { card.innerHTML = ""; return; }

  card.innerHTML = `
    <div class="card tokens">
      <button class="tok-head" data-tok="toggle">
        <span class="cap">design tokens · live</span>
        <span class="tok-caret ${open ? "open" : ""}">▾</span>
      </button>
      <div class="tok-body" ${open ? "" : "hidden"}>
        <div class="tok-swatches">
          ${colors.map((t) => `
            <label class="tok-color" title="${esc(t.name)}">
              <input type="${isHex(t.value) ? "color" : "text"}" data-name="${esc(t.name)}" value="${esc(isHex(t.value) ? t.value : t.value)}" ${isHex(t.value) ? "" : 'style="width:100%"'}>
              <span>${esc(t.name.replace(/^--/, ""))}</span>
            </label>`).join("")}
        </div>
        ${others.length ? `<div class="tok-others">
          ${others.map((t) => `
            <label class="tok-field">
              <span>${esc(t.name.replace(/^--/, ""))}</span>
              <input type="text" data-name="${esc(t.name)}" value="${esc(t.value)}">
            </label>`).join("")}
        </div>` : ""}
        <p class="hint" style="margin-top:8px">edits preview instantly and save to head.html</p>
      </div>
    </div>`;

  card.querySelector('[data-tok="toggle"]').onclick = () => {
    open = !open;
    localStorage.setItem("variate.tokens.open", open ? "1" : "0");
    card.querySelector(".tok-body").hidden = !open;
    card.querySelector(".tok-caret").classList.toggle("open", open);
  };
  for (const inp of card.querySelectorAll("input[data-name]")) {
    inp.addEventListener("input", () => onEdit(inp.dataset.name, inp.value));
  }
}

function onEdit(name, value) {
  // live preview across every frame, instantly
  postToFrames({ type: "rb-tokens", vars: { [name]: value } });
  const t = tokens.find((x) => x.name === name);
  if (t) t.value = value;
  pending[name] = value;
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, 650);
}

async function flush() {
  const tokensToSave = pending;
  pending = {};
  if (!Object.keys(tokensToSave).length) return;
  try {
    const res = await fetch("/api/head", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tokens: tokensToSave }) });
    const data = await res.json();
    if (data.ok && data.changed) toast(`restyled ${data.changed} token${data.changed === 1 ? "" : "s"}`);
  } catch { toast("could not save tokens"); }
}
