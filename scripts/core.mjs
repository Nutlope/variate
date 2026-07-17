// Shared internals for the variate scripts (serve.mjs, compare.mjs, start.mjs).
// Zero dependencies. Everything here is either pure string work or thin fs
// helpers; server state (caching, journal, SSE) stays in serve.mjs.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// small helpers

export const sha8 = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 8);
export const nowIso = () => new Date().toISOString();

export function readSafe(file) {
  try { return fs.readFileSync(file, "utf8"); } catch { return null; }
}

export function atomicWrite(file, content) {
  const tmp = file + ".tmp-" + process.pid;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

export function readJsonSafe(file) {
  const raw = readSafe(file);
  if (raw == null) return { json: null, error: "missing" };
  try { return { json: JSON.parse(raw), error: null }; }
  catch {
    // One brief retry: we may have caught a writer mid-rename.
    try {
      const again = fs.readFileSync(file, "utf8");
      return { json: JSON.parse(again), error: null };
    } catch (e2) { return { json: null, error: String(e2).slice(0, 120) }; }
  }
}

export function statMtime(p) {
  try { return fs.statSync(p).mtimeMs; } catch { return null; }
}

export function normalizeSlug(raw) {
  const s = String(raw ?? "").toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-{2,}/g, "-").replace(/^-|-$/g, "");
  return s || "item";
}

/** The standard workspace layout, derived once from the ws root. */
export function wsPaths(ws) {
  const WS = path.resolve(ws);
  const SITE = path.join(WS, "site");
  const REQ = path.join(WS, "requests");
  const STATE_DIR = path.join(WS, "state");
  return {
    WS,
    SITE,
    SECTIONS: path.join(SITE, "sections"),
    REQ,
    REQ_DONE: path.join(REQ, "done"),
    STATE_DIR,
    SKETCHES: path.join(WS, "sketches"),
    ASSETS: path.join(WS, "assets"),
    DIST: path.join(WS, "dist"),
    COMPARE: path.join(WS, "compare"),
    MANIFEST: path.join(SITE, "manifest.json"),
    HEAD: path.join(SITE, "head.html"),
    DECISIONS: path.join(SITE, "DECISIONS.md"),
    JOURNAL: path.join(STATE_DIR, "journal.jsonl"),
    HEARTBEAT: path.join(STATE_DIR, "agent.heartbeat"),
    SERVER_JSON: path.join(STATE_DIR, "server.json"),
    HISTORY: path.join(STATE_DIR, "history.json"),
  };
}

/** Wrap a v1 manifest (flat sections) into the v2 shape (pages) in memory. */
export function asV2(json) {
  if (json && Array.isArray(json.pages)) return json;
  if (json && Array.isArray(json.sections)) {
    return {
      version: 2,
      rev: json.rev ?? 0,
      title: json.title ?? "",
      bodyAttrs: json.bodyAttrs ?? "",
      pages: [{ id: "index", title: "Home", route: "index.html", sections: json.sections }],
    };
  }
  return { version: 2, rev: 0, title: "", bodyAttrs: "", pages: [] };
}

/** Plain uncached manifest read for one-shot scripts (compare.mjs etc.).
 *  Always returns the v2 shape; never writes. */
export function loadManifest(paths) {
  const { json } = readJsonSafe(paths.MANIFEST);
  return asV2(json);
}

/**
 * One-time disk migration v1 -> v2: sections/<slug>/ moves under
 * sections/index/<slug>/ and the manifest gains pages[]. Idempotent (renames
 * only happen while the source exists and the target does not) and safe to
 * re-run after a crash. Returns true when anything changed.
 */
export function migrateWorkspaceV2(paths) {
  const { json } = readJsonSafe(paths.MANIFEST);
  if (!json || Array.isArray(json.pages)) return false; // already v2 or absent
  if (!Array.isArray(json.sections)) return false;

  const indexDir = path.join(paths.SECTIONS, "index");
  fs.mkdirSync(indexDir, { recursive: true });
  for (const entry of fs.readdirSync(paths.SECTIONS, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "index") continue;
    const from = path.join(paths.SECTIONS, entry.name);
    const to = path.join(indexDir, entry.name);
    if (!fs.existsSync(to)) {
      try { fs.renameSync(from, to); } catch { /* leave for a later run */ }
    }
  }
  const v2 = asV2(json);
  v2.rev = (json.rev ?? 0) + 1;
  atomicWrite(paths.MANIFEST, JSON.stringify(v2, null, 2) + "\n");
  return true;
}

/** Resolve a take file path inside a page's section dir, escape-proof. */
export function takeFilePath(paths, pageId, slug, file) {
  const p = path.normalize(path.join(paths.SECTIONS, pageId, slug, file));
  if (!p.startsWith(paths.SECTIONS + path.sep)) throw new Error("path escape");
  return p;
}

// ---------------------------------------------------------------------------
// frame + page assembly (the reveal CSS and IO shim are ported verbatim from
// Recast lib/sections.ts; they are battle-tested, do not "improve" them)

export const REVEAL_CSS = `<style>[class*="reveal"],[class*="fade"],[data-reveal],[data-aos],[data-animate]{opacity:1!important;}</style>`;

export const IO_SHIM = `<script>(function(){try{window.IntersectionObserver=function(cb,o){o=o||{};return{root:o.root||null,rootMargin:o.rootMargin||'0px',thresholds:[].concat(o.threshold||0),observe:function(el){try{cb([{isIntersecting:true,intersectionRatio:1,target:el}],this);}catch(e){}},unobserve:function(){},disconnect:function(){},takeRecords:function(){return[];}};}catch(e){}function reveal(){try{var els=document.querySelectorAll('[class*="reveal"],[class*="fade"],[class*="animate"],[data-reveal],[data-aos],[data-animate]');for(var i=0;i<els.length;i++){var el=els[i];['in','visible','show','active','revealed','is-visible','in-view','aos-animate','animated'].forEach(function(c){el.classList.add(c);});el.style.opacity='1';el.style.visibility='visible';}}catch(e){}}window.addEventListener('load',reveal);[120,400,900].forEach(function(t){setTimeout(reveal,t);});})();</script>`;

// Live-edit bridge the studio talks to over postMessage: token overrides and
// inline text editing. Only leaf text elements become editable, so typing can
// never mangle structure; a clean toggle leaves the markup byte-identical
// (the snapshot guard relies on this to skip no-op saves).
export const BRIDGE = `<script>(function(){var R=document.documentElement,TE='h1,h2,h3,h4,h5,h6,p,li,a,span,button,td,th,blockquote,figcaption,strong,em,small,label',snap=null;function sec(){return document.querySelector('[data-rb]')||document.body;}function leaves(){var out=[],all=sec().querySelectorAll(TE);for(var i=0;i<all.length;i++){var el=all[i];if(el.childElementCount===0&&el.textContent.trim())out.push(el);}return out;}window.addEventListener('message',function(e){var d=e.data;if(!d)return;if(d.type==='rb-tokens'&&d.vars){for(var k in d.vars){try{R.style.setProperty(k,d.vars[k]);}catch(_){}}}else if(d.type==='rb-edit'){var s=sec();if(d.on){snap=s.outerHTML;leaves().forEach(function(el){el.setAttribute('contenteditable','true');el.setAttribute('data-rb-e','1');});}else{sec().querySelectorAll('[data-rb-e]').forEach(function(el){el.removeAttribute('contenteditable');el.removeAttribute('data-rb-e');});var out=s.outerHTML;if(snap!==null&&out!==snap){try{parent.postMessage({type:'rb-edited',markup:out},'*');}catch(_){}}snap=null;}}});})();</script>`;

export function reporterFor(slug) {
  // Height is measured from BODY content, not documentElement (docEl is
  // clamped to the iframe viewport, so short sections could never shrink).
  // Debounce via setTimeout, NOT requestAnimationFrame (hidden or embedded
  // pages throttle rAF to zero, which wedges reporting entirely).
  return `<script>(function(){var S=${JSON.stringify(slug)},last=-1,sched=false;function H(){var b=document.body;if(!b)return Math.max(document.documentElement.scrollHeight,1);var h=b.scrollHeight;var kids=b.children;for(var i=0;i<kids.length;i++){try{var r=kids[i].getBoundingClientRect();var bottom=r.bottom+(window.scrollY||0);if(bottom>h)h=bottom;}catch(e){}}return Math.max(Math.ceil(h),1);}function post(){sched=false;var h;try{h=H();}catch(e){return;}if(h===last)return;last=h;try{parent.postMessage({type:'rb-h',slug:S,h:h},'*');}catch(e){}}function R(){if(sched)return;sched=true;setTimeout(post,16);}window.addEventListener('load',R);if(document.readyState==='complete')R();try{if(document.fonts&&document.fonts.ready)document.fonts.ready.then(R);}catch(e){}try{var ro=new ResizeObserver(R);ro.observe(document.documentElement);if(document.body)ro.observe(document.body);}catch(e){}[50,200,500,1000].forEach(function(t){setTimeout(R,t);});})();</script>`;
}

/** Render tolerance: force the manifest slug onto the take's data-rb; wrap
 *  unwrapped content. Take files stay untouched on disk. */
export function normalizeTake(markup, slug) {
  const trimmed = (markup ?? "").trim();
  if (!trimmed) return `<section data-rb="${slug}"></section>`;
  if (/<(section|div|header|footer|main|article)\b[^>]*data-rb=/i.test(trimmed)) {
    return trimmed.replace(/data-rb="[^"]*"/i, `data-rb="${slug}"`);
  }
  return `<section data-rb="${slug}">${trimmed}</section>`;
}

export function buildFrameDoc(head, bodyAttrs, markup, slug, ctx = null) {
  // ctx = { before, beforeSlug, after, afterSlug }: render the take BETWEEN
  // its real neighbors (dimmed, inert) so it is judged in context, never in a
  // vacuum. Used by the compare views.
  const dim = (m, s) => (m ? `<div style="opacity:.38;pointer-events:none;user-select:none" aria-hidden="true">${normalizeTake(m, s)}</div>` : "");
  const body = ctx
    ? `${dim(ctx.before, ctx.beforeSlug ?? "before")}${normalizeTake(markup, slug)}${dim(ctx.after, ctx.afterSlug ?? "after")}`
    : normalizeTake(markup, slug);
  // Frames are served from /frame/*, so relative assets/ refs must go absolute.
  return rewriteAssetPaths(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${REVEAL_CSS}${head}</head><body ${bodyAttrs}>${IO_SHIM}${body}${BRIDGE}${reporterFor(slug)}</body></html>`);
}

/**
 * The compare host page: every take of one section, one visible at a time,
 * with a sticky bottom-center picker (buttons, keys 1-9 and arrow keys; keys
 * are ignored while an input is focused). `live` wires keep/discard buttons
 * to the studio API; the static variant (compare.mjs) inlines take docs as
 * srcdoc and swaps the buttons for a "tell your agent" hint.
 *
 * takes: [{ label, src?, doc?, active?: boolean }]
 */
export function buildComparePage({ title, slug, page = "index", takes, live }) {
  const frames = takes.map((t, i) => {
    const attr = t.src ? `src="${escapeAttr(t.src)}"` : `srcdoc="${escapeAttr(t.doc ?? "")}"`;
    return `<iframe id="f${i}" title="${escapeAttr(t.label)}" sandbox="allow-scripts" ${attr} loading="eager"></iframe>`;
  }).join("\n");
  const names = JSON.stringify(takes.map((t) => t.label));
  const activeIdx = Math.max(0, takes.findIndex((t) => t.active));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>compare · ${escapeAttr(slug)} · ${escapeAttr(title || "variate")}</title>
<style>
  :root{--ink:#faf8f3;--surface:#fffdf9;--line:#e6e0d2;--fg:#191611;--fg-mut:#5d564a;--fg-dim:#9a9284;--accent:#3a33e0;--mono:ui-monospace,"SF Mono",Menlo,monospace}
  *{box-sizing:border-box;margin:0}
  body{background:var(--ink);font-family:"Avenir Next","Segoe UI",system-ui,sans-serif;color:var(--fg)}
  header{display:flex;align-items:center;gap:10px;padding:14px 20px}
  header .dot{width:10px;height:10px;border-radius:3px;background:var(--accent)}
  header b{font-size:15px}
  header span{font-family:var(--mono);font-size:11px;color:var(--fg-dim)}
  main{padding:0 20px 110px;max-width:1440px;margin:0 auto}
  iframe{display:none;width:100%;height:78vh;border:1px solid var(--line);border-radius:12px;background:#fff}
  iframe.on{display:block}
  .picker{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);display:flex;align-items:center;gap:6px;background:rgba(25,22,17,.92);backdrop-filter:blur(6px);border-radius:999px;padding:8px 10px;box-shadow:0 14px 40px -14px rgba(0,0,0,.5);max-width:94vw;flex-wrap:wrap;justify-content:center}
  .picker button{font:inherit;border:0;background:none;color:#d9d4ca;font-family:var(--mono);font-size:12px;padding:6px 11px;border-radius:999px;cursor:pointer;white-space:nowrap}
  .picker button:hover{background:rgba(255,255,255,.12)}
  .picker button.on{background:var(--accent);color:#fff}
  .picker .act{background:rgba(255,255,255,.1);color:#fff;font-weight:600}
  .picker .act:hover{background:rgba(255,255,255,.2)}
  .picker .keep.on-active{background:#0a7d55;color:#fff}
  .hint{position:fixed;left:50%;bottom:74px;transform:translateX(-50%);font-family:var(--mono);font-size:10.5px;color:var(--fg-dim);background:var(--surface);border:1px solid var(--line);border-radius:999px;padding:4px 12px;white-space:nowrap;max-width:94vw;overflow:hidden;text-overflow:ellipsis}
</style>
</head>
<body>
<header><span class="dot"></span><b>${escapeAttr(slug)}</b><span>${takes.length} take${takes.length === 1 ? "" : "s"} · arrows or 1-${Math.min(9, takes.length)} to flip</span></header>
<main>
${frames}
</main>
<p class="hint">${live ? "keep = make this the live take · discard = drop it from the pager" : "tell your agent: keep 2, fold 4's stat strip in, drop the rest"}</p>
<div class="picker" id="picker"></div>
<script>
(function(){
  var names=${names},cur=${activeIdx},live=${live ? "true" : "false"},slug=${JSON.stringify(slug)},page=${JSON.stringify(page)};
  var picker=document.getElementById("picker");
  function show(i){
    cur=(i%names.length+names.length)%names.length;
    for(var k=0;k<names.length;k++){document.getElementById("f"+k).classList.toggle("on",k===cur);}
    render();
  }
  function render(){
    var h='<button data-go="-1" aria-label="previous">&#8249;</button>';
    for(var i=0;i<names.length;i++){h+='<button data-i="'+i+'" class="'+(i===cur?"on":"")+'">'+(i+1)+" · "+names[i]+"</button>";}
    h+='<button data-go="1" aria-label="next">&#8250;</button>';
    if(live){h+='<button class="act keep" data-keep="1">keep this</button><button class="act" data-discard="1">discard</button>';}
    picker.innerHTML=h;
  }
  picker.addEventListener("click",function(e){
    var b=e.target.closest("button");if(!b)return;
    if(b.dataset.i!=null)show(+b.dataset.i);
    else if(b.dataset.go)show(cur+ +b.dataset.go);
    else if(b.dataset.keep)api("pick",{take:cur});
    else if(b.dataset.discard){if(names.length<2)return;api("discard",{take:cur});}
  });
  function api(op,extra){
    fetch("/api/op",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(Object.assign({op:op,slug:slug,page:page},extra))})
      .then(function(r){return r.json();}).then(function(){location.reload();}).catch(function(){});
  }
  document.addEventListener("keydown",function(e){
    var el=document.activeElement;
    if(el&&(el.tagName==="INPUT"||el.tagName==="TEXTAREA"||el.isContentEditable))return;
    if(e.key==="ArrowLeft")show(cur-1);
    else if(e.key==="ArrowRight")show(cur+1);
    else{var n=parseInt(e.key,10);if(n>=1&&n<=Math.min(9,names.length))show(n-1);}
  });
  show(cur);
})();
</script>
</body>
</html>`;
}

export function assemblePage(head, bodyAttrs, markups) {
  return `<!doctype html>
<html lang="en">
<head>
${head}
</head>
<body${bodyAttrs ? " " + bodyAttrs : ""}>
${markups.join("\n")}
</body>
</html>`;
}

/** Every asset path a fragment references: src/srcset/href/url() under assets/. */
export function assetRefs(markup) {
  const out = new Set();
  for (const m of markup.matchAll(/(?:src|href)=["'](?:\/)?(assets\/[^"']+)["']/gi)) out.add(m[1]);
  for (const m of markup.matchAll(/url\(\s*["']?(?:\/)?(assets\/[^"')]+)["']?\s*\)/gi)) out.add(m[1]);
  return [...out];
}

/** Serve-time rewrite so relative assets/ paths resolve from /frame/* docs.
 *  Export skips this: dist/assets/ sits next to the pages, relative works. */
export function rewriteAssetPaths(html) {
  return html
    .replace(/((?:src|href)=["'])assets\//gi, "$1/assets/")
    .replace(/(url\(\s*["']?)assets\//gi, "$1/assets/");
}

/** Loud, never blocking: contract violations in a landed take.
 *  assetsDir (optional) lets missing local images be flagged too. */
export function validateTake(markup, assetsDir = null) {
  const warnings = [];
  for (const m of markup.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = tag.match(/src=["']([^"']*)["']/i)?.[1] ?? "";
    if (/^https?:\/\//i.test(src)) continue; // caught by the external check below
    if (!/^\/?assets\//.test(src)) warnings.push("an <img> src is outside assets/ (local images live in assets/, drawn art is inline SVG)");
    if (!/alt=["']/.test(tag)) warnings.push("an <img> is missing alt text");
  }
  if (/(src|href)=["']https?:\/\//i.test(markup)) warnings.push("references an external URL");
  if (/@import|url\(\s*["']?https?:/i.test(markup)) warnings.push("styles pull an external resource");
  if (assetsDir) {
    for (const ref of assetRefs(markup)) {
      const p = path.normalize(path.join(assetsDir, ref.replace(/^assets\//, "")));
      if (p.startsWith(path.normalize(assetsDir)) && !fs.existsSync(p)) warnings.push(`references a missing asset (${ref})`);
    }
  }
  const open = (markup.match(/<section\b/gi) || []).length;
  const close = (markup.match(/<\/section>/gi) || []).length;
  if (open !== close) warnings.push("unbalanced <section> tags");
  return warnings;
}

// 'self' lets frames load the workspace's own /assets/* images; everything
// remote stays blocked.
export const FRAME_CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: 'self';";

export const ASSET_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif", ".ico", ".avif"]);

// ---------------------------------------------------------------------------
// ship pack (ported from Recast lib/ship.ts, minus analytics and signup
// capture): derive title/description/OG/favicon from the page's own copy so
// the export is publishable as-is. Pure string work.

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export function escapeAttr(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function textOf(fragment) {
  return decodeEntities(
    fragment
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

export function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return decodeEntities((m?.[1] ?? "").trim()).slice(0, 120) || "Untitled page";
}

/** A meta description from the page's own copy: the hero's first real paragraph. */
export function deriveDescription(html) {
  const hero = html.match(/<section[^>]*data-rb="hero"[\s\S]*?<\/section>/i)?.[0] ?? html;
  const paras = [...hero.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => textOf(m[1]));
  let best = paras.find((p) => p.length >= 40) ?? paras.find((p) => p.length > 0) ?? "";
  if (!best) {
    const anyP = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    best = anyP ? textOf(anyP[1]) : "";
  }
  if (!best) best = extractTitle(html);
  return best.length > 155 ? best.slice(0, 152).replace(/\s+\S*$/, "") + "..." : best;
}

/** The page's own logo mark (first small inline svg) as a favicon data URI. */
export function deriveFavicon(html) {
  const nav = html.match(/<section[^>]*data-rb="nav"[\s\S]*?<\/section>/i)?.[0];
  const scopes = nav ? [nav, html] : [html];
  for (const scope of scopes) {
    for (const m of scope.matchAll(/<svg[\s\S]*?<\/svg>/gi)) {
      let svg = m[0];
      if (svg.length > 6000) continue; // hero illustration, not a mark
      if (!/xmlns=/.test(svg)) svg = svg.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
      return `data:image/svg+xml,${encodeURIComponent(svg)}`;
    }
  }
  return null;
}

/**
 * Inject title/description/OG/favicon into a page. Idempotent: refreshes its
 * own marked block on re-export, skips anything the page already carries.
 */
export function finalizeShipPack(html) {
  if (html.includes("data-variate-ship")) {
    html = html.replace(/<!--variate-ship-->[\s\S]*?<!--\/variate-ship-->/i, "");
  }
  const headClose = html.search(/<\/head>/i);
  if (headClose === -1) return html;

  const title = extractTitle(html);
  const desc = deriveDescription(html);
  const favicon = deriveFavicon(html);

  const tags = ['<!--variate-ship--><meta data-variate-ship content="1">'];
  if (!/name=["']description["']/i.test(html)) tags.push(`<meta name="description" content="${escapeAttr(desc)}">`);
  if (!/property=["']og:title["']/i.test(html)) {
    tags.push(`<meta property="og:title" content="${escapeAttr(title)}">`);
    tags.push(`<meta property="og:description" content="${escapeAttr(desc)}">`);
    tags.push(`<meta property="og:type" content="website">`);
    tags.push(`<meta name="twitter:card" content="summary">`);
  }
  if (favicon && !/rel=["'](?:shortcut )?icon["']/i.test(html)) {
    tags.push(`<link rel="icon" type="image/svg+xml" href="${favicon}">`);
  }
  tags.push("<!--/variate-ship-->");

  return html.slice(0, headClose) + tags.join("\n") + "\n" + html.slice(headClose);
}
