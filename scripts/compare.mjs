#!/usr/bin/env node
// Static compare page: every take of one section as ONE self-contained HTML
// file with a picker. No server needed; made for terminal-only sessions
// ("here are 5 takes, open this file, tell me which"). The takes render
// between their real neighbor sections, dimmed, so they are judged in
// context.
//
//   node compare.mjs --ws <workspace> --slug hero [--page index] [--out path.html]
//
// Prints the written path. Exit 1 on a missing page or section.

import fs from "node:fs";
import path from "node:path";
import { wsPaths, loadManifest, readSafe, buildFrameDoc, buildComparePage } from "./core.mjs";

const args = {};
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const next = argv[i + 1];
    args[argv[i].slice(2)] = next == null || next.startsWith("--") ? true : argv[++i];
  }
}

if (!args.ws || !args.slug || args.slug === true) {
  console.error("usage: node compare.mjs --ws <workspace> --slug <section> [--page index] [--out file.html]");
  process.exit(1);
}

const P = wsPaths(String(args.ws));
const m = loadManifest(P);
const pageId = args.page && args.page !== true ? String(args.page) : m.pages[0]?.id ?? "index";
const pg = m.pages.find((x) => x.id === pageId);
if (!pg) {
  console.error(`compare.mjs: no page "${pageId}" (have: ${m.pages.map((x) => x.id).join(", ") || "none"})`);
  process.exit(1);
}
const i = pg.sections.findIndex((s) => s.slug === args.slug);
if (i === -1) {
  console.error(`compare.mjs: no section "${args.slug}" on ${pg.id} (have: ${pg.sections.map((s) => s.slug).join(", ") || "none"})`);
  process.exit(1);
}
const sec = pg.sections[i];
const head = readSafe(P.HEAD) ?? "";

// Reads tolerate both layouts so a not-yet-migrated v1 workspace still works.
const readTake = (slug, file) =>
  readSafe(path.join(P.SECTIONS, pg.id, slug, file)) ?? readSafe(path.join(P.SECTIONS, slug, file)) ?? "";
const activeOf = (s) => (s ? readTake(s.slug, s.takes[s.active] ?? s.takes[0]) : null);
const prev = pg.sections[i - 1] ?? null;
const next = pg.sections[i + 1] ?? null;

const takes = sec.takes.map((file, idx) => ({
  label: file.replace(/\.html$/, ""),
  doc: buildFrameDoc(head, m.bodyAttrs ?? "", readTake(sec.slug, file), sec.slug, {
    before: activeOf(prev), beforeSlug: prev?.slug,
    after: activeOf(next), afterSlug: next?.slug,
  }),
  active: idx === sec.active,
}));

const html = buildComparePage({ title: m.title ?? "", slug: sec.slug, page: pg.id, takes, live: false });
fs.mkdirSync(P.COMPARE, { recursive: true });
const out = args.out && args.out !== true ? path.resolve(String(args.out)) : path.join(P.COMPARE, `${pg.id}-${sec.slug}.html`);
fs.writeFileSync(out, html);
console.log(out);
