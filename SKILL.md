---
name: variate
description: >
  Section-by-section landing page studio with a live local preview the user
  directs visually. Use when the user wants to build, design, or iterate a
  landing page, marketing site, or homepage interactively: they click a
  section to request variations (multiple takes), prompt-edits, new sections
  between sections, or sketch-driven layouts, and you fulfill each request by
  writing section files. Starts a local server; ends with a polished
  single-file export. Also fits "open the variate studio" or continuing work
  on an existing variate workspace.
license: MIT
compatibility: Requires Node.js 18+ and a local web browser. macOS/Linux first.
metadata:
  version: "1.0.0"
  author: youssef
---

# variate

You build a landing page one section at a time while the user art-directs from
a live browser studio. You are the designer and the model: every request the
studio sends, you fulfill by writing HTML section files. Read
`references/recipes.md` before your first generative request each session; it
carries the full craft contract.

## The workspace (created by start.mjs, default `./variate`)

```
site/head.html              the design system: ONE <style> with :root tokens,
                            type scale, buttons. The only file you may edit
                            in place (bootstrap and polish only).
site/manifest.json          {version, rev, title, bodyAttrs, sections:
                            [{slug, takes:["take-1.html", ...], active}]}
site/sections/<slug>/       take files. IMMUTABLE: never edit or delete a
                            take; always add take-<N+1>.html (N = highest).
requests/ requests/done/    the queue. NEVER touch these files yourself;
                            await.mjs is the only interface.
sketches/                   PNG + blueprint payloads for sketch requests.
dist/index.html             the assembled export.
```

## Start

```
node <this-skill-dir>/scripts/start.mjs --ws <project>/variate
```

It prints the studio URL (tell the user; if your harness has a browser
preview pane, open it there too) and whether the page is empty. Empty page:
read the Bootstrap recipe and write `head.html`, a nav, a hero, and one or
two more sections from the user's brief before entering the loop.

## The loop

1. `node <skill>/scripts/await.mjs --ws <ws>` blocks until the user acts in
   the studio, prints ONE request as JSON, and exits 0.
2. Re-read `site/manifest.json` (it may have changed: the user moves, cuts,
   and swaps takes without you). Open the recipe for the request type.
   Fulfill it by writing `site/sections/<slug>/take-<N+1>.html` files and
   updating the manifest (bump `rev`). The studio hot-reloads as you write.
3. Loop, folding the ack in:
   `node <skill>/scripts/await.mjs --ws <ws> --ack <id> --note "<one line for the user's activity feed>"`
   (`--result skipped` if the target was cut before you got to it; `failed`
   only when you could not fulfill at all.)
4. Exit 2 = idle: nothing queued. Re-run the same command. After three
   consecutive idles, ask the user whether to keep the studio open.
5. `"type":"done"` = the user finished: ack it, verify `dist/index.html`
   exists (the server exports eagerly), tell the user where it is, stop.
6. `"redelivered": true` = a previous claim was interrupted. Check whether
   your takes already landed (read the section dir + manifest); if so, ack
   with `--note "already landed"` instead of writing duplicates.

Timeouts: Claude Code MAY run await with a long shell timeout (10 minutes)
plus `--timeout 540` to cut round trips. Codex and other CLIs: keep the
default `--timeout 90` and simply re-run on idle; the server keeps running
between your turns. Never background await (its exit IS your signal), and
never pipe input to it.

## Request types

| type     | target        | fulfill by                                                      | recipe    |
|----------|---------------|------------------------------------------------------------------|-----------|
| variate  | `target.slug` | `params.count` new takes, each diverging from ALL existing takes; `params.steer` bends them; set `active` to your first new take | Variate |
| instruct | `target.slug` | one new take applying `params.instruction` exactly, nothing else  | Instruct  |
| add      | position via `params.position` (`start`, `end`, `after:<slug>`) | new section dir + take-1 + manifest entry at the position; `params.kind` names a catalog entry, else `params.instruction` describes it | Add |
| sketch   | `target.slug` | one new take whose COMPOSITION matches `params.blueprint` (and `params.png` if you can read images) | Sketch |
| polish   | whole page    | unify seams: new take per section that needs it + fold `v<id>-` styles into head.html | Polish |
| done     | -             | ack, point the user at dist/index.html, stop looping             | -         |

## The fragment contract (short form; full form in recipes.md)

Every take file is EXACTLY ONE `<section data-rb="<slug>">` element:

1. No doctype, html, head, or body tags; no markdown fences; no commentary.
2. The page's global CSS (head.html) already styles it: REUSE the custom
   properties, type scale, spacing rhythm, and button classes.
3. New styles: ONE `<style>` inside the section; every new class name starts
   with `v<request-id>-` (e.g. `v0007-grid`). Never touch `:root`, never
   restyle global tags or existing classes.
4. Zero external requests: no CDN, no web fonts, no remote anything.
5. No `<img>`: draw every visual as inline SVG or CSS.
6. At most ONE `<script>` inside the section, guarded so it never throws.
7. Responsive 360-1440px; honor `prefers-reduced-motion`; real contrast.
8. No eyebrow labels above headings, no italic display type, and whitespace
   is the luxury: generous padding, calm gaps, air around the type.

## What the user can do without you (no request reaches the agent)

The studio also has deterministic, instant tools the user drives directly.
They never queue a request, but they DO change the files you build on, so
always re-read fresh state before writing:

- **Move / cut / pick a take / undo / redo** — manifest edits, applied by the
  server.
- **Design tokens** — a live editor over your `head.html` `:root` values.
  The user can recolor or re-space the whole page in seconds; the server
  rewrites `head.html`. So `head.html` may differ from what you last wrote:
  re-read it before a polish or any head edit.
- **Inline text edits** — the user can click text in a section and retype it;
  the server saves the result as a new take of that section. So a section may
  gain takes you did not draw.

## Rules of the road

- Take files are immutable history; the user flips between them. Only add.
- Re-read the manifest AND `head.html` before every write; never trust a stale
  outline or an old design system (the user may have retuned tokens).
- Only `head.html` may be edited in place, and only during bootstrap/polish;
  mention any head change in your ack note (undo cannot restore it).
- Suggest a git commit of the workspace at good checkpoints.
- The user sees your `--note` lines in their activity feed: write them for a
  human, one short line each.
