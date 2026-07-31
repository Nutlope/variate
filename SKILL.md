---
name: variate
description: >
  Design landing pages with the user through rounds of concrete variants: you
  draft structurally different takes of each section, the user compares them
  in a live local preview and answers in the terminal, and the site converges
  section by section, page by page. Use when the user wants to build, design,
  or iterate a landing page, marketing site, homepage, or small multi-page
  website; when they ask for design variations or prototypes to choose
  between; or to continue an existing variate workspace ("open the variate
  studio"). Starts a local server; ends with a polished, shippable export.
license: MIT
compatibility: Requires Node.js 18+ and a local web browser. macOS/Linux first.
metadata:
  version: "2.1.0"
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
                            type scale, buttons. Shared by every page; the
                            only file you may edit in place (bootstrap and
                            polish only).
site/manifest.json          the single mutable truth. Schema: {version: 2,
                            rev: int (bumped on every write), title,
                            bodyAttrs, pages: [{id, title, route:
                            "<id>.html", sections: [{slug, takes:
                            ["take-1.html", ...], active: 0-BASED INDEX
                            into takes}]}]}. NEVER hand-edit it; every
                            mutation you make goes through land.mjs below.
site/sections/<page>/<slug>/  take files. IMMUTABLE: never edit or delete a
                            take; land a new one instead.
site/DECISIONS.md           append-only design-round log: question, takes,
                            verdict, why. Read at session start.
requests/ requests/done/    the studio click queue. NEVER touch these files
                            yourself; await.mjs is the only interface.
sketches/ assets/           sketch payloads; the user's images.
dist/                       the export: one flat <route>.html per page plus
                            assets/, ship-ready.
```

The scripts are implementation, not interface: never read `scripts/*.mjs`
source. Everything you need is this file, `references/recipes.md`, and the
usage text the CLIs print.

## Start

```
node <this-skill-dir>/scripts/start.mjs --ws <project>/variate
```

It prints the studio URL (tell the user; if your harness has a browser
preview pane, open it there too) and whether the page is empty. Empty page:
read the Bootstrap recipe and write `head.html`, a nav, a hero, and one or
two more sections from the user's brief. Then run the first design round.

## Landing work: land.mjs (your only pen for the manifest)

```
node <skill>/scripts/land.mjs land --ws <ws> --slug hero [--page index] \
  [--create [--position start|end|after:<slug>|before:<slug>]] \
  [--activate] [--label "split manifesto, quieter"]     take markup on stdin
node <skill>/scripts/land.mjs check [--ws <ws>]          dry-run validation
node <skill>/scripts/land.mjs pick|discard --ws <ws> --slug hero --take <N|last>
node <skill>/scripts/land.mjs move --ws <ws> --slug hero --to start|end|up|down|after:<x>
node <skill>/scripts/land.mjs cut  --ws <ws> --slug hero
node <skill>/scripts/land.mjs page --ws <ws> --id about [--title About]
```

It routes through the studio when it is running (parallel-safe: subagents may
land takes concurrently) and falls back to locked direct writes when it is
not. `--take` addresses FILES (`--take 3` = take-3.html, or `last`), never
pager positions. Draft, `check`, fix, THEN `land`: a landed take is immutable,
so validate before it enters the pager, not after. Give `--label` a short
intent line ("the wire, diagram-first"); it becomes the user's activity feed.
The JSON reply carries `warnings`; fix any before you ack or present.

## Terminal mode (the default)

The conversation drives; nothing blocks. Work like this:

1. **Act on what the user says**: draft takes, edit sections, apply verdicts,
   all through `land.mjs` (land / pick / discard / move / cut / page). The
   studio hot-reloads and the feed shows your labels as you land.
2. **Run design rounds** for anything worth a decision: takes first, then one
   question. The full loop is the "Design rounds" recipe; its compare views
   (`/compare/<page>/<slug>` live, or `scripts/compare.mjs --page --slug` for
   a static file) are how the user flips between takes.
3. **Fold in studio clicks between turns**:
   `node <skill>/scripts/await.mjs --ws <ws> --drain`
   prints every queued studio request as ONE JSON array and exits (2 = none).
   Fulfill each (recipes per type below), then ack each:
   `... --drain --ack <id> --note "<one line for the user's activity feed>"`.
   Run a drain whenever you finish a turn's work or the user mentions
   clicking something. Never sit blocked while the user is talking.

## Studio mode (opt-in, by words only)

Enter the blocking loop ONLY when the user says so in words ("I'll drive from
the studio"). Never infer it from silence: if the user goes quiet, end your
turn; queued clicks arrive on your next drain or via the Stop hook below.

1. `node <skill>/scripts/await.mjs --ws <ws>` blocks until a studio action,
   prints ONE request, exits 0. Fulfill it, then loop with the ack folded in:
   `... --ack <id> --note "..."`. Exit 2 = idle; just re-run. After three
   consecutive idles, ask the user whether to keep waiting.
2. Claude Code MAY use a long shell timeout (10 minutes) with `--timeout 540`
   to cut round trips; other CLIs keep `--timeout 90`. Never background
   await (its exit IS your signal), never pipe input to it.

Either mode: `"type":"done"` means the user finished. Apply any last verdicts
first, then ack: the server re-exports when your ack lands, so dist picks up
same-turn changes. Still open `dist/index.html` and verify it reflects the
final state before pointing the user at it, then stop.
`"redelivered": true` means a claim was interrupted earlier: check whether
your takes already landed before writing duplicates; if they did, just ack.

## Request types (studio clicks and their recipes)

Every target carries `target.page` (the page id); section work goes under
`site/sections/<page>/<slug>/`.

| type     | target             | fulfill by                                                      | recipe    |
|----------|--------------------|------------------------------------------------------------------|-----------|
| variate  | `page` + `slug`    | `params.count` new takes, each diverging from ALL existing takes; `params.steer` bends them; set `active` to your first new take | Variate |
| instruct | `page` + `slug`    | one new take applying `params.instruction` exactly, nothing else  | Instruct  |
| add      | `page`; position via `params.position` (`start`, `end`, `after:<slug>`) | new section dir + take-1 + manifest entry at the position; `params.kind` names a catalog entry, else `params.instruction` describes it | Add |
| sketch   | `page` + `slug`    | one new take whose COMPOSITION matches `params.blueprint` (and `params.png` if you can read images) | Sketch |
| polish   | `page`             | unify that page's seams: new take per section that needs it + fold `v<id>-` styles into head.html | Polish |
| page     | -                  | a new page from `params.id` + `params.title`: manifest entry (route `<id>.html`), then draft its nav + hero in the site's language | Pages |
| done     | -                  | ack, point the user at dist/, stop looping                       | -         |

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

## Look at what you made (a budget, not a rabbit hole)

Never ack work you have not checked, and never spend more than this:

1. ALWAYS: fix the `warnings` in land.mjs's reply (or `GET /api/state`)
   on everything you touched BEFORE acking. `check` catches most of them
   before the take even lands.
2. ONE visual pass when your harness can open web pages: `/page?p=<id>` at
   desktop and ~390px. For a single take, `/frame/<page>/<slug>?take=<N>`.
   Fix what is broken, then ack. Screenshot budget: a couple per round, not
   per take; prefer reading the served HTML when screenshots are slow.
3. NEVER open take files as `file://` URLs: they render without head.html,
   so what you would be judging is not the page.
4. After an export, open `dist/index.html` (or tell the user to) and confirm
   every page and image made it.

## Rules of the road

- Take files are immutable history; the user flips between them. Only land.
- With the user, options are PAGER POSITIONS (the numbers in the compare
  picker): say "2 of 5", never "take-6.html" (file numbers drift when takes
  are discarded). Record the position-to-file mapping in `DECISIONS.md`.
- Re-read the manifest AND `head.html` before every write; never trust a
  stale outline or an old design system.
- Only `head.html` may be edited in place, and only during bootstrap/polish;
  mention any head change in your notes (undo cannot restore it).
- Log every design-round verdict in `site/DECISIONS.md`; read it at start.
- Suggest a git commit of the workspace at good checkpoints.
- The user sees your `--note` and `--label` lines in their activity feed:
  write them for a human, one short line each.

## Optional: a Claude Code Stop hook so clicks are never forgotten

If the user wants it, they can paste this into the project's
`.claude/settings.json` (fill in the absolute paths); it warns when studio
clicks are waiting as a turn ends, and never blocks:

```json
{"hooks": {"Stop": [{"hooks": [{"type": "command", "timeout": 10,
  "command": "command -v node >/dev/null 2>&1 && node '<abs-skill-dir>/scripts/await.mjs' --ws '<abs-workspace>' --peek --hook || true"}]}]}}
```
