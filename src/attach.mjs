// Putting the card on the user's own dev server, and taking it off again
// without a trace.
//
// Every insertion is bracketed by markers and recorded in .variate/attach.json,
// so `variate end` removes exactly the bytes it added and `git status` comes
// back empty. Nothing is ever inserted without a dev-only guard, so a
// production build never ships the tag.

import fs from "node:fs";
import path from "node:path";
import { readSafe, atomicWrite, readJsonSafe } from "./core.mjs";

export const BEGIN = "variate:begin";
export const END = "variate:end";

const has = (root, ...rel) => fs.existsSync(path.join(root, ...rel));
const firstFile = (root, cands) => cands.find((c) => has(root, c)) ?? null;

/**
 * Which stack, and which file takes the tag. Ordered most specific first.
 * Each entry returns { stack, file, snippet(tagUrl), comment }.
 */
export function detect(root) {
  const nextCfg = firstFile(root, ["next.config.ts", "next.config.js", "next.config.mjs"]);
  if (nextCfg) {
    const layout = firstFile(root, ["app/layout.tsx", "app/layout.jsx", "src/app/layout.tsx", "src/app/layout.jsx"]);
    if (layout) return { stack: "next-app", file: layout, marker: "jsx" };
    const doc = firstFile(root, ["pages/_document.tsx", "pages/_document.jsx", "src/pages/_document.tsx"]);
    if (doc) return { stack: "next-pages", file: doc, marker: "jsx" };
    const app = firstFile(root, ["pages/_app.tsx", "pages/_app.jsx", "src/pages/_app.tsx"]);
    if (app) return { stack: "next-pages", file: app, marker: "jsx" };
  }
  if (firstFile(root, ["astro.config.mjs", "astro.config.ts", "astro.config.js"])) {
    const lay = ["src/layouts/Layout.astro", "src/layouts/BaseLayout.astro", "src/layouts/main.astro"]
      .find((c) => has(root, c)) ?? findOne(root, "src/layouts", ".astro");
    if (lay) return { stack: "astro", file: lay, marker: "jsx" };
  }
  if (firstFile(root, ["svelte.config.js", "svelte.config.ts"])) {
    const lay = firstFile(root, ["src/routes/+layout.svelte"]);
    if (lay) return { stack: "sveltekit", file: lay, marker: "html" };
  }
  if (firstFile(root, ["nuxt.config.ts", "nuxt.config.js"])) {
    return { stack: "nuxt", file: "plugins/variate.client.ts", marker: "js", create: true };
  }
  if (firstFile(root, ["vite.config.ts", "vite.config.js", "vite.config.mjs"])) {
    const entry = firstFile(root, ["src/main.tsx", "src/main.ts", "src/main.jsx", "src/main.js", "src/index.tsx", "src/index.jsx"]);
    if (entry) return { stack: "vite", file: entry, marker: "js" };
  }
  if (has(root, "app/views/layouts/application.html.erb")) {
    return { stack: "rails", file: "app/views/layouts/application.html.erb", marker: "erb" };
  }
  const html = firstFile(root, ["index.html", "public/index.html", "src/index.html"]);
  if (html) return { stack: "static", file: html, marker: "html" };
  return null;
}

function findOne(root, dir, ext) {
  try {
    const f = fs.readdirSync(path.join(root, dir)).find((x) => x.endsWith(ext));
    return f ? path.join(dir, f) : null;
  } catch { return null; }
}

/** The dev-guarded snippet per stack. Guards are statically replaced by every
 *  bundler listed, so a production build drops the whole block. */
export function snippetFor(stack, tagUrl) {
  const src = JSON.stringify(tagUrl);
  switch (stack) {
    case "next-app":
    case "next-pages":
      return `      {/* ${BEGIN} */}\n` +
             `      {process.env.NODE_ENV === "development" && (\n` +
             `        // eslint-disable-next-line @next/next/no-sync-scripts\n` +
             `        <script src=${src} async />\n` +
             `      )}\n` +
             `      {/* ${END} */}\n`;
    case "astro":
      return `{/* ${BEGIN} */}\n{import.meta.env.DEV && <script is:inline src=${src} async />}\n{/* ${END} */}\n`;
    case "sveltekit":
      return `<!-- ${BEGIN} -->\n{#if import.meta.env.DEV}<svelte:head><script src=${src} async></script></svelte:head>{/if}\n<!-- ${END} -->\n`;
    case "vite":
      return `/* ${BEGIN} */\nif (import.meta.env.DEV) { const s = document.createElement("script"); s.src = ${src}; document.head.append(s); }\n/* ${END} */\n`;
    case "nuxt":
      return `/* ${BEGIN} */\nexport default defineNuxtPlugin(() => {\n  if (!import.meta.dev) return;\n  const s = document.createElement("script"); s.src = ${src}; document.head.append(s);\n});\n/* ${END} */\n`;
    case "rails":
      return `<%# ${BEGIN} %>\n<% if Rails.env.development? %><script src=${src}></script><% end %>\n<%# ${END} %>\n`;
    default:
      return `<!-- ${BEGIN} (dev only; \`variate end\` removes this) -->\n<script src=${src}></script>\n<!-- ${END} -->\n`;
  }
}

const markerRe = () => new RegExp(`[^\\n]*${BEGIN}[\\s\\S]*?${END}[^\\n]*\\n?`, "m");

/**
 * Insert whole lines ABOVE the line that `at` falls on, matched to that
 * line's indentation. Splitting a line in the middle (which is what a naive
 * slice at the index of `</body>` does) strands the closing tag's indent
 * above the insert, so removing the block later cannot restore the file
 * byte for byte. The empty-diff promise depends on this being exact.
 */
function insertBefore(src, at, snippet) {
  const lineStart = src.lastIndexOf("\n", at) + 1;
  const lead = src.slice(lineStart, at);
  const indent = /^\s*$/.test(lead) ? lead : "";

  const lines = snippet.replace(/\n$/, "").split("\n");
  const own = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
  const body = lines.map((l) => (l.trim() ? indent + l.slice(own) : "")).join("\n");

  return src.slice(0, lineStart) + body + "\n" + src.slice(lineStart);
}

export function isAttached(root, file) {
  const src = readSafe(path.join(root, file));
  return !!src && src.includes(BEGIN);
}

/** Insert the snippet at the right anchor for the file type. */
export function attach(root, { stack, file, create }, tagUrl) {
  const abs = path.join(root, file);
  const snippet = snippetFor(stack, tagUrl);

  if (create) {
    if (fs.existsSync(abs) && readSafe(abs).includes(BEGIN)) return { ok: true, already: true, file };
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, snippet);
    return { ok: true, file, created: true };
  }

  const src = readSafe(abs);
  if (src == null) return { error: `cannot read ${file}` };
  if (src.includes(BEGIN)) return { ok: true, already: true, file };

  let out;
  if (stack === "vite") {
    // Entry module. Go BELOW the import block: an executable statement above
    // the imports reads as a bug in a diff and trips import/first, and ESM
    // hoisting means it would not run earlier anyway.
    const lines = src.split("\n");
    let at = 0;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim();
      if (l.startsWith("import ") || l.startsWith("import{") || (l.startsWith("}") && lines[i].includes("from"))) at = i + 1;
      else if (l === "" || l.startsWith("//") || l.startsWith("/*") || l.startsWith("*")) continue;
      else if (at) break;
    }
    lines.splice(at, 0, snippet.replace(/\n$/, ""));
    out = lines.join("\n");
  } else {
    const i = src.lastIndexOf("</body>");
    if (i === -1) {
      if (stack === "next-app" || stack === "next-pages" || stack === "astro" || stack === "sveltekit") out = src + "\n" + snippet;
      else return { error: `no </body> in ${file}; add the tag by hand (see references/frameworks.md)` };
    } else {
      out = insertBefore(src, i, snippet);
    }
  }
  atomicWrite(abs, out);
  return { ok: true, file };
}

export function detach(root, ledgerPath) {
  const led = readJsonSafe(ledgerPath);
  if (!led?.file) return { ok: true, nothing: true };
  const abs = path.join(root, led.file);
  if (led.created) {
    try { fs.rmSync(abs, { force: true }); } catch { /* already gone */ }
    return { ok: true, file: led.file, removed: true };
  }
  const src = readSafe(abs);
  if (src == null || !src.includes(BEGIN)) return { ok: true, file: led.file, nothing: true };
  const out = src.replace(markerRe(), "");
  atomicWrite(abs, out);
  return { ok: true, file: led.file };
}

/** Add a line to .gitignore exactly once, and be able to take it back. In a
 *  git repo with no .gitignore at all, create one: the promise that .variate/
 *  never lands in a commit must not depend on the project already having the
 *  file. With no git there is nothing to ignore into; report that instead. */
export function ignoreLine(root, line) {
  const gi = path.join(root, ".gitignore");
  const src = readSafe(gi);
  if (src == null) {
    if (!fs.existsSync(path.join(root, ".git"))) return { skipped: "no git repo" };
    atomicWrite(gi, line + "\n");
    return { created: true };
  }
  if (src.split("\n").some((l) => l.trim() === line)) return { already: true };
  atomicWrite(gi, src.replace(/\n*$/, "\n") + line + "\n");
  return { added: true };
}

export function unignoreLine(root, line, removeFileIfEmpty = false) {
  const gi = path.join(root, ".gitignore");
  const src = readSafe(gi);
  if (src == null) return { skipped: true };
  const kept = src.split("\n").filter((l) => l.trim() !== line);
  // A file variate itself created (the caller knows, via the marker) goes
  // back out with its line, so end leaves the tree exactly as it was found.
  // A file the USER wrote is never deleted, however empty it ends up.
  if (removeFileIfEmpty && kept.every((l) => !l.trim())) {
    try { fs.rmSync(gi, { force: true }); } catch { /* fine */ }
    return { removed: true, file: true };
  }
  atomicWrite(gi, kept.join("\n").replace(/\n{3,}$/, "\n"));
  return { removed: true };
}
