// The variant contract, checked cheaply.
//
// It warns, it never blocks: a warning is information for the agent before it
// shows the round to the user. Regex-level on purpose, because the one thing
// worse than no linter is a linter that needs a parser for six languages.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { readSafe } from "./core.mjs";

const exportsOf = (src) => {
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const as = part.split(/\s+as\s+/i);
      const n = (as[1] ?? as[0]).trim();
      if (n) names.add(n);
    }
  }
  if (/export\s+default\s+(?!function|class|const|let|var)/.test(src)) names.add("default");
  return names;
};

const importsOf = (src) => {
  const out = new Set();
  for (const m of src.matchAll(/(?:^|\n)\s*import\s[^"']*["']([^"']+)["']/g)) out.add(m[1]);
  for (const m of src.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)) out.add(m[1]);
  return out;
};

const bare = (spec) => !spec.startsWith(".") && !spec.startsWith("/") && !spec.startsWith("@/") && !spec.startsWith("~");
const pkgName = (spec) => (spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);

export function checkVariant(P, set, variant, baselineSrc, deps) {
  const src = readSafe(variant.file);
  const w = [];
  if (src == null) return { n: variant.n, warnings: ["unreadable"] };
  if (!src.trim()) return { n: variant.n, warnings: ["empty"] };

  const isCode = /\.(tsx?|jsx?|vue|svelte|astro|mjs|cjs)$/i.test(set.ext);

  if (isCode && baselineSrc) {
    const want = exportsOf(baselineSrc), got = exportsOf(src);
    const missing = [...want].filter((n) => !got.has(n));
    if (missing.length) w.push(`does not export ${missing.join(", ")} (variant 1 does; it must drop in)`);

    const baseClient = /^\s*["']use client["']/m.test(baselineSrc);
    const thisClient = /^\s*["']use client["']/m.test(src);
    if (baseClient !== thisClient) w.push(baseClient ? 'missing the "use client" directive variant 1 has' : 'adds "use client" where variant 1 has none');
  }

  if (isCode) {
    // Relative imports are written from where the variant will LIVE (the
    // target's directory), not from .variate/, so resolve them against the
    // target. This is the check that catches a variant which would not build.
    const dir = path.dirname(set.target);
    const exts = ["", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".vue", ".svelte", ".astro", ".css", "/index.js", "/index.jsx", "/index.ts", "/index.tsx"];
    for (const spec of importsOf(src)) {
      if (bare(spec)) {
        if (!deps) continue;
        const p = pkgName(spec);
        if (!deps.has(p) && !p.startsWith("node:")) w.push(`imports "${p}", which is not in package.json`);
        continue;
      }
      if (!spec.startsWith(".")) continue; // an alias like @/ or ~; we cannot resolve it here
      const base = path.resolve(dir, spec);
      if (!exts.some((e) => fs.existsSync(base + e))) {
        w.push(`imports "${spec}", which does not resolve from ${path.relative(P.ROOT, dir) || "."}`);
      }
    }
  }

  // House style, mechanically checkable.
  // Written as escapes so this repo contains no literal em or en dash.
  if (/[\u2013\u2014]/.test(src)) w.push("uses an em or en dash; the style bar forbids them");
  for (const tag of src.match(/<img\b[^>]*>/gi) ?? []) {
    if (!/\balt\s*=/.test(tag)) { w.push("an <img> is missing alt text"); break; }
  }
  if (/(?:src|href)\s*=\s*["']https?:\/\//i.test(src) && !/\.(css|scss)$/i.test(set.ext)) {
    w.push("references an external URL; keep variants self-contained");
  }

  const opens = (src.match(/\{/g) || []).length, closes = (src.match(/\}/g) || []).length;
  if (isCode && opens !== closes) w.push(`unbalanced braces (${opens} open, ${closes} close)`);

  return { n: variant.n, warnings: w };
}

/**
 * A real parse, if the project happens to own a parser. esbuild is in most
 * front-end projects already and handles jsx/tsx; when it is absent we say so
 * rather than letting "no warnings" imply the file compiles.
 */
export function parserFor(P) {
  for (const rel of ["node_modules/.bin/esbuild", "node_modules/esbuild/bin/esbuild"]) {
    const bin = path.join(P.ROOT, rel);
    if (fs.existsSync(bin)) return { kind: "esbuild", bin };
  }
  return null;
}

function parseWith(parser, file, ext) {
  const loader = { ".jsx": "jsx", ".tsx": "tsx", ".ts": "ts", ".mjs": "js", ".js": "js", ".cjs": "js" }[ext.toLowerCase()];
  if (!loader) return null;
  const r = spawnSync(parser.bin, [file, `--loader:${ext}=${loader}`, "--outfile=/dev/null"], { encoding: "utf8" });
  if (r.status === 0) return null;
  const first = String(r.stderr || "").split("\n").find((l) => /error/i.test(l)) ?? "does not parse";
  return first.replace(/^.*?error:\s*/i, "").trim().slice(0, 120);
}

export function checkSet(P, set) {
  const baselineSrc = set.variants[0] ? readSafe(set.variants[0].file) : null;
  let deps = null;
  const pkg = readSafe(path.join(P.ROOT, "package.json"));
  if (pkg) {
    try {
      const j = JSON.parse(pkg);
      deps = new Set([...Object.keys(j.dependencies ?? {}), ...Object.keys(j.devDependencies ?? {}), ...Object.keys(j.peerDependencies ?? {})]);
    } catch { /* no dep check */ }
  }
  const parser = parserFor(P);
  return set.variants.slice(1).map((v) => {
    const row = checkVariant(P, set, v, baselineSrc, deps);
    if (parser) {
      const err = parseWith(parser, v.file, set.ext);
      if (err) row.warnings.unshift(`does not parse: ${err}`);
    }
    return row;
  });
}
