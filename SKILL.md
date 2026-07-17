---
name: variate
description: >
  Design landing pages with the user through rounds of concrete variants: you
  draft structurally different takes of each section, the user compares them
  in a live local preview and answers in the terminal, and the page converges
  section by section. Use when the user wants to build, design, or iterate a
  landing page, marketing site, or homepage; when they ask for design
  variations or prototypes to choose between; or to continue an existing
  variate workspace ("open the variate studio"). Starts a local server; ends
  with a polished, shippable export.
license: MIT
compatibility: Requires Node.js 18+ and a local web browser. macOS/Linux first.
metadata:
  version: "2.0.0"
  author: youssef
---

# variate

You design a page WITH the user: rounds of takes they compare and pick from,
converging one decision at a time. You are the designer and the model; the
studio and compare pages only render options. The user's verdicts arrive as
terminal sentences, and those verdicts are the design. Read
`references/recipes.md` before your first generative work each session, and
read `site/DECISIONS.md` so you never re-litigate a settled round.

## The workspace (created by start.mjs, default `./variate`)

```
site/head.html              the design system: ONE <style> with :root tokens,
                            type scale, buttons. The only file you may edit
                            in place (bootstrap and polish only).
site/manifest.json          {version, rev, title, bodyAttrs, sections:
                            [{slug, takes:["take-1.html", ...], active}]}
site/sections/<slug>/       take files. IMMUTABLE: never edit or delete a
                            take; always add take-<N+1>.html (N = highest).
site/DECISIONS.md           append-only design-round log: question, takes,
                            verdict, why. Read at session start.
requests/ requests/done/    the studio click queue. NEVER touch these files
                            yourself; await.mjs is the only interface.
sketches/ assets/           sketch payloads; the user's images.
dist/                       the assembled export.
```

## Start

```
node <this-skill-dir>/scripts/start.mjs --ws <project>/variate
```

It prints the studio URL (tell the user; if your harness has a browser
preview pane, open it there too) and whether the page is empty. Empty page:
read the Bootstrap recipe and write `head.html`, a nav, a hero, and one or
two more sections from the user's brief. Then run the first design round.

## Terminal mode (the default)

The conversation drives; nothing blocks. Work like this:

1. **Act on what the user says**: draft takes, edit sections, apply verdicts.
   You edit workspace files directly, including the manifest for picks,
   moves, cuts, and discards the user asks for in chat (bump `rev`; the
   studio hot-reloads and journals your changes as you write).
2. **Run design rounds** for anything worth a decision: takes first, then one
   question. The full loop is the "Design rounds" recipe; its compare views
   (`/compare/<slug>` live, or `scripts/compare.mjs` for a static file) are
   how the user flips between takes.
3. **Fold in studio clicks between turns**:
   `node <skill>/scripts/await.mjs --ws <ws> --drain`
   prints every queued studio request as ONE JSON array and exits (2 = none).
   Fulfill each (recipes per type below), then ack each:
   `... --drain --ack <id> --note "<one line for the user's activity feed>"`.
   Run a drain whenever you finish a turn's work or the user mentions
   clicking something. Never sit blocked while the user is talking.

## Studio mode (opt-in)

If the user says they want to click instead of talk ("I'll drive from the
studio"), switch to the blocking loop:

1. `node <skill>/scripts/await.mjs --ws <ws>` blocks until a studio action,
   prints ONE request, exits 0. Fulfill it, then loop with the ack folded in:
   `... --ack <id> --note "..."`. Exit 2 = idle; just re-run. After three
   consecutive idles, ask the user whether to keep waiting.
2. Claude Code MAY use a long shell timeout (10 minutes) with `--timeout 540`
   to cut round trips; other CLIs keep `--timeout 90`. Never background
   await (its exit IS your signal), never pipe input to it.

Either mode: `"type":"done"` means the user finished. Ack it, verify
`dist/index.html` (the server exports eagerly), tell them where it is, stop.
`"redelivered": true` means a claim was interrupted earlier: check whether
your takes already landed before writing duplicates; if they did, just ack.

## Request types (studio clicks and their recipes)

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
   with `v<request-id>-` (e.g. `v0007-grid`) or, for takes you draft in
   terminal mode, `vt<take-number>-`. Never touch `:root`, never restyle
   global tags or existing classes.
4. Zero external requests: no CDN, no web fonts, no remote anything.
5. Images: `<img src="assets/<file>" alt="...">` for REAL images the user
   provided (photos, logos, screenshots; they live in `assets/`, dropped in
   the studio or copied there for you). Drawn art stays inline SVG or CSS.
   Never an external image URL, never a path outside assets/.
6. At most ONE `<script>` inside the section, guarded so it never throws.
7. Responsive 360-1440px; honor `prefers-reduced-motion`; real contrast.
8. No eyebrow labels above headings, no italic display type, and whitespace
   is the luxury: generous padding, calm gaps, air around the type.

## What the user can do without you (no request reaches the agent)

The studio has deterministic, instant tools the user drives directly. They
never queue a request, but they DO change the files you build on, so always
re-read fresh state before writing:

- **Move / cut / pick a take / discard a take / undo / redo** - manifest
  edits, applied by the server.
- **Design tokens** - a live editor over your `head.html` `:root` values.
  `head.html` may differ from what you last wrote: re-read it before a
  polish or any head edit.
- **Inline text edits** - clicking text and retyping saves a new take, so a
  section may gain takes you did not draw.

## Rules of the road

- Take files are immutable history; the user flips between them. Only add.
- Re-read the manifest AND `head.html` before every write; never trust a
  stale outline or an old design system.
- Only `head.html` may be edited in place, and only during bootstrap/polish;
  mention any head change in your notes (undo cannot restore it).
- Log every design-round verdict in `site/DECISIONS.md`; read it at start.
- Suggest a git commit of the workspace at good checkpoints.
- The user sees your `--note` lines in their activity feed: write them for a
  human, one short line each.
