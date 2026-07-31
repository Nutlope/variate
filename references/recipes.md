# variate recipes

The craft contract for every generative request. These are instructions to
YOU, the agent fulfilling studio requests. They descend from a battle-tested
prompt library; treat the constraints as hard.

## The full fragment contract

A take file contains exactly one `<section data-rb="<slug>">` element and
nothing else. The page's `head.html` CSS already applies to it; treat that
stylesheet as the design system: reuse its custom properties, class names,
type scale, spacing rhythm, buttons, and components wherever possible. If you
need NEW styles, put them in ONE `<style>` tag inside the section, and every
new class name must start with `v<request-id>-` (the request's `id` field,
e.g. `v0007-card`). Never restyle global tags, never redefine existing
classes, never touch `:root`. JS only if the section truly needs it: ONE
`<script>` inside the section, wrapped so it never throws even if the rest of
the page is absent. Zero external requests. Two kinds of visuals, never
mixed up: REAL images (the user's photos, logos, product shots) are
`<img src="assets/<file>" alt="...">` from the workspace `assets/` folder,
always with honest alt text and width/height or aspect-ratio CSS so nothing
jumps; DRAWN art (illustrations, mocks, charts, decorations) is composed
inline as SVG, CSS shapes, or gradients, art-directed rather than
placeholder-shaped. Never an external image URL, never an <img> standing in
for something you could draw. Close every tag. Fully responsive from 360px
to 1440px, semantic and accessible, honor `prefers-reduced-motion`.

Style bar, always: no eyebrow labels (no small uppercase kicker line above a
heading, no numbered tags like "02 / RESEARCH"), no italic display type, one
earned accent color, and whitespace as the luxury: when a section feels flat,
add space, never another element. Never use em dashes or en dashes in copy;
use commas, colons, or parentheses. Ground every word in the page's real
product and copy: never invent metrics, customers, or testimonials the page
does not support.

## Bootstrap (empty manifest)

You are setting a page's entire design language from the user's brief, so
spend the effort here: everything after inherits it.

1. Ask the user for a brief if you do not have one (what the product is, who
   it is for, the mood). One question, not an interview.
2. Commit to a real art direction: deliberate palette (one earned accent),
   an expressive system font stack, a type scale, a spacing rhythm. Push past
   a default corporate look unless that truly fits.
3. Write `site/head.html`: charset, viewport, a real `<title>`, and ONE
   `<style>` carrying the FULL design system as `:root` custom properties
   (palette, spacing, radii, font sizes), base element styles, a `.wrap`
   container, button classes, and shared component classes. Write it as if
   the whole page already existed; sections lean on it from now on.
4. Give the page a real identity: the brand's actual name when the brief
   provides one, otherwise ONE short credible name (never "Acme" or an
   obvious placeholder), plus a small original inline-SVG logo mark.
5. Land the opening sections PROGRESSIVELY so the user watches the page
   appear instead of waiting on a big bang: first the `nav` (logo + a few
   links + one CTA) and the `hero` (composed to be visually complete in the
   first viewport: headline in 2-3 balanced lines, supporting line, primary
   CTA, and a signature visual drawn in pure CSS/SVG that looks
   art-directed), each landed with
   `land.mjs land --slug <s> --create --activate --label "..."`, and tell
   the user the studio is live. THEN land the one or two more sections the
   brief deserves. The site's name lives in head.html's `<title>`; the
   studio picks it up from there.
6. Tell the user the studio URL and what you drew.

## Import (the user points you at an existing single-file page)

Split it at the top-level `data-rb` blocks (ignore nested ones): the inner
`<head>` content becomes `head.html`, each block becomes
`sections/index/<slug>/take-1.html` (dedupe repeated slugs as `slug-2`, `slug-3`),
`<body>` attributes go to `bodyAttrs`, and page-level scripts that live
outside any section fold into the LAST section's take inside its guarded
`<script>`. A page without `data-rb` tags becomes one `page` section; offer
to split it into real sections as a follow-up. Recast exports import cleanly.

## Design rounds (the convergence loop)

This is how a page gets designed WITH the user instead of at them. A round is
one design question, and the question is asked with takes, not words: you put
rendered options in front of the user and they answer in the terminal. One
question per round; asking several at once is bewildering.

1. **Pick the question.** Round one is always the overall direction (usually
   the hero). Later rounds zoom one level per verdict: overall direction,
   then section by section, then components within a section. Never reopen a
   frozen level unless the user does.
2. **Draft 5 takes for exploration rounds** (2 or 3 for late fine-tuning).
   They must be STRUCTURALLY different: different layout, different
   information hierarchy, different primary affordance, not just different
   colors. Five slightly tweaked card grids is wallpaper, not a round.
   If your harness runs parallel subagents, draft the takes IN PARALLEL:
   one subagent per take, each given the head, the neighbors, and an
   explicit divergence constraint ("no card grid", "split layout", "type
   only"), each landing its own take via land.mjs (parallel-safe; takes
   stream into the pager as they finish). Sequential is always correct too.
   Per take, the order is draft, `check`, fix, `land`: a landed take is
   immutable, so it must be right BEFORE it enters the pager, not pruned
   after. Before presenting, compare your takes; if two came out alike,
   redraw one with an explicit constraint.
3. **Show them.** Open the compare view: `/compare/<page>/<slug>` when the
   studio is running, else `node <skill>/scripts/compare.mjs --ws <ws>
   --page <page> --slug <slug>` and open the printed file. The user flips
   with arrow keys; takes render between their real neighbors so nothing is
   judged in a vacuum.
4. **Ask ONE question, with your recommendation.** Number the options by
   PAGER POSITION exactly as the compare picker shows them ("1 is a split
   manifesto, 2 is centered and quiet, 3 leads with the product shot...");
   never use take file names with the user (file numbers drift when takes
   are discarded). Say which you would keep and why. Facts you can look up
   yourself; the decision is the user's. Do not proceed without it.
5. **Apply the verdict.** The best feedback is compositional: "2's layout
   with 4's stat strip" IS the design, so draw that merged take next and make
   it active. A plain pick means set it active and move on.
6. **Log and prune.** Append the round to `site/DECISIONS.md`: question,
   options in pager order WITH their take files ("2 = take-6.html"),
   verdict, why. Discard the rejected takes (`land.mjs discard --take <N>`,
   or the user clicks discard) unless the user wants them kept. Then zoom
   in: next round, one level deeper.

`site/DECISIONS.md` is the design tree's memory. Read it at session start;
without it, a fresh session re-litigates settled decisions.

## Variate

Draw a genuinely DIFFERENT take on the same section. Same brand, same content
and purpose, same design language, but a clearly different composition:
change the arrangement, the alignment axis, the geometry, or the visual
device, not just the padding. Read EVERY existing take file in the section's
dir first; yours must be clearly different from all of them. It must still
sit perfectly between its neighbors (read them for seams) and read as the
same designer's work.

`params.count` > 1: land each take as its own file the moment it is checked
(`land.mjs` is parallel-safe), so takes appear in the studio one by one. Make
each take claim a different corner of the idea space: a different alignment
axis, density, or visual device than the obvious first idea. Pass
`--activate` on your FIRST new take only; later ones stack behind the pager.
If your harness runs parallel subagents, one subagent per take with an
explicit divergence constraint each; sequential is always correct too.

`params.steer` bends every take in the batch, strictly within the page's
design language; it bends the takes, never the brand:

- calmer: more restraint, softer contrast, fewer elements
- bolder: bigger type, stronger presence, higher contrast
- airier: much more whitespace, lighter density, more breathing room
- denser: tighter spacing, more information-forward, more visible at once
- playful: unexpected details, a wink of personality, tasteful motion

## Instruct

Apply exactly `params.instruction` to the current active take and change
nothing else about it: keep its design language, structure, copy, and
quality. Do not rebuild it, do not drop content that was not asked to be
dropped. Land the result as a NEW take (the old one stays in the pager).

## Add

Design a brand-new section to sit at `params.position` (`start`, `end`, or
`after:<slug>`; a slug cut in the meantime falls back to `end` on its own).
Land it with `land.mjs land --slug <s> --create --position <p> --activate`.
Slug: the kind's canonical slug below, deduped with `-2`, `-3` if taken.
Match the page's design language exactly and make the seams flow into both
neighbors. Kind briefs:

- features (slug `features`): the product's real capabilities from the page's
  own copy, each with a small inline-SVG glyph drawn in the page's style
- showcase (`showcase`): a product mock, screens, or illustrative composition
  drawn purely in CSS/SVG, with a short supporting line
- stats (`stats`): a stats band; only reuse numbers already on the page,
  otherwise express scale qualitatively, never invented figures
- pricing (`pricing`): 2 or 3 tiers named and scoped from the page's actual
  offering; structure over specifics
- faq (`faq`): the 4 or 5 questions a real visitor of THIS page would ask,
  answered from the page's copy, with working expand/collapse if it fits
- logos (`logos`): a quiet trust strip; names already on the page, else an
  abstract text-free band, never invented customers
- howitworks (slug `showcase`): the product's real flow in 3 or 4 steps,
  numbered plainly inside the card bodies
- cta (`cta`): one confident closing line and one primary action in the
  page's button language
- waitlist (slug `cta`): a waitlist band with a REAL email form: one <form>
  with a single required email input and a submit button, one line of honest
  microcopy, no fake baked-in success state
- footer (`footer`): brand mark echo, link columns matching the page's real
  sections, a quiet legal line

Custom (`params.instruction` instead of `kind`): a new section matching that
request, grounded in the page's real copy; derive a short slug from it.

## Sketch

The user drew a wireframe for this section. `params.blueprint` is its
serialized geometry; read it the way a designer reads a whiteboard: the
blueprint dictates COMPOSITION (what exists, where it sits, relative size,
alignment, what sits beside what), never styling. The page's design language
dictates styling. The x/y percentages are the ground truth for placement;
row narration is only a reading order. If `params.png` is set and you can
read images, open it too; the text remains authoritative for geometry.

Redraw the section so its layout matches faithfully: every region becomes a
real element at roughly that position and proportion; do not add major
elements the sketch does not show, do not drop ones it does. Where a region
carries a quoted note, use that content; where it is generic, fill it with
the RIGHT content for this section from the page's real copy.
`params.instruction` is a note the user added alongside. Land as a new take.

## Pages (a small multi-page site)

The manifest's `pages[]` array is the site map; every page shares
`head.html` (one design system) and keeps its own sections under
`site/sections/<page>/<slug>/`. A `page` request (or the user asking in
chat) means: `land.mjs page --id <id> --title "<T>"`, then draft the page's
opening in the site's established language: its nav (copy the index nav's
markup and adjust the active link, landed with `--create`), a hero that says
what THIS page is for, and whatever one or two sections the page obviously
needs. Keep every page's nav and footer consistent: when one changes, land
matching takes on the others (a polish pass per page is the cheap way).

Cross-page links are flat: `href="index.html"`, `href="about.html"`,
matching each page's `route`. They work in the export from disk and on any
static host; the live `/page` preview rewrites them on the fly. Section
anchors within a page stay `#slug`.

## Content grounding (real copy beats invented copy)

When the user points at something real, fetch it before writing: a URL (use
your harness's web fetch to pull the actual copy, product names, numbers), a
README or doc (read the file), an existing site export (see Import). Quote
their actual claims; never pad with invented metrics, customers, or
testimonials. When you have no source material, ask for one line about the
product and write honest structural copy around it.

## Assets (the user's real images)

`<ws>/assets/` is the only home for real images. They arrive two ways: the
user drops files onto the studio (saved automatically, path toasted and
copied), or hands you a path in chat and you copy it in yourself:
`cp ~/Desktop/logo.png <ws>/assets/logo.png` (lowercase-slug the name).
Reference them as `src="assets/<file>"` exactly; the studio serves them live
and export copies them to `dist/assets/` so the same relative path ships.
Give every `<img>` real alt text and a stable box (width/height attributes
or aspect-ratio CSS). Prefer the drawn-SVG route for anything decorative;
reach for `<img>` only when the pixels themselves matter. If a take
references an asset that does not exist, the studio flags it as a warning:
fix the path or add the file before acking.

## Polish

The page accumulated per-take styles and seams. Keep every section, its
order, its `data-rb`, and its content. Unify: consistent vertical rhythm and
padding scale, a deliberate background progression, aligned container widths,
one type scale, consistent border and button language. Fold `v<id>-` prefixed
styles from inside sections into head.html's stylesheet (renaming to stable
class names), removing duplicates. Land the result as a NEW take for every
section you touched plus the updated head.html, and say in your ack note that
head.html changed (server undo cannot restore it; git can).

## Etiquette

- Redelivered request: check the section dir and manifest first; if your work
  already landed, ack `--result ok --note "already landed"` and move on.
- Target cut while queued: ack `--result skipped --note "<slug> was cut
  before I got to it"`.
- Malformed or impossible ask: fulfill the closest sensible reading; only
  `--result failed` when you truly cannot.
- Never edit `requests/`, never edit existing takes, never delete take files,
  never hand-edit `site/manifest.json` (land.mjs is your only pen for it).
