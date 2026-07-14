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
the page is absent. Zero external requests. No `<img>` ever: compose every
visual as inline SVG, CSS shapes, or gradients, art-directed rather than
placeholder-shaped. Close every tag. Fully responsive from 360px to 1440px,
semantic and accessible, honor `prefers-reduced-motion`.

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
5. Write the opening sections, each as `take-1.html` in its own dir with a
   manifest entry: a `nav` (logo + a few links + one CTA), a `hero` composed
   to be visually complete in the first viewport (headline in 2-3 balanced
   lines, supporting line, primary CTA, and a signature visual drawn in pure
   CSS/SVG that looks art-directed), and one or two more sections the brief
   deserves. Set `title` in the manifest. Bump `rev`.
6. Tell the user the studio URL and what you drew.

## Import (the user points you at an existing single-file page)

Split it at the top-level `data-rb` blocks (ignore nested ones): the inner
`<head>` content becomes `head.html`, each block becomes
`sections/<slug>/take-1.html` (dedupe repeated slugs as `slug-2`, `slug-3`),
`<body>` attributes go to `bodyAttrs`, and page-level scripts that live
outside any section fold into the LAST section's take inside its guarded
`<script>`. A page without `data-rb` tags becomes one `page` section; offer
to split it into real sections as a follow-up. Recast exports import cleanly.

## Variate

Draw a genuinely DIFFERENT take on the same section. Same brand, same content
and purpose, same design language, but a clearly different composition:
change the arrangement, the alignment axis, the geometry, or the visual
device, not just the padding. Read EVERY existing take file in the section's
dir first; yours must be clearly different from all of them. It must still
sit perfectly between its neighbors (read them for seams) and read as the
same designer's work.

`params.count` > 1: write each take as its own file, updating the manifest
after EACH so takes land in the studio one by one. Make each take claim a
different corner of the idea space: a different alignment axis, density, or
visual device than the obvious first idea. Set `active` to your FIRST new
take; later ones stack behind the pager. (If your harness can run parallel
subagents safely, you may parallelize, but sequential is always correct.)

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
`after:<slug>`; if that slug was cut in the meantime, fall back to `end`).
Create the dir, write `take-1.html`, and splice the manifest entry at the
position. Slug: the kind's canonical slug below, deduped with `-2`, `-3` if
taken. Match the page's design language exactly and make the seams flow into
both neighbors. Kind briefs:

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
- Never edit `requests/`, never edit existing takes, never delete take files.
