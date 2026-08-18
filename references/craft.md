# The craft

Read this before your first generative work in a session. Treat these rules
as hard.

## What makes a round

A round is one design question, and the question is asked with variants rather
than words: you put rendered options in front of the user and they answer.

**One question per round.** Asking three at once is bewildering and the answers
contradict each other. Round one is the overall direction (usually the hero or
the page's dominant section). Later rounds zoom one level per verdict:
direction, then section by section, then components inside a section. Never
reopen a level the user has settled unless they reopen it.

**Four variants for an exploration round**, two or three for late fine-tuning.

**They must be structurally different.** Different layout, different
information hierarchy, different primary affordance, a different visual device.
Not different padding, not a different accent, not the same card grid four
times. Four slightly tweaked card grids is wallpaper, not a round.

Before you present, compare your own variants. If two came out alike, redraw
one against an explicit constraint: "no card grid", "no split layout", "type
only", "the composition is the background".

## Writing plan.json

Write it **before** you draft. Naming the corners of the idea space up front
is what stops four positions collapsing toward the same safe answer:

```json
{
  "question": "How much should the hero say before you scroll?",
  "positions": [
    { "name": "as it was" },
    { "name": "the ledger", "angle": "type only", "cost": "nothing to look at above the fold" },
    { "name": "split", "angle": "asymmetric two column", "cost": "weaker at 390px" },
    { "name": "the outcome", "angle": "leads with the result, not the product", "cost": "slower to say what it is" }
  ]
}
```

- **question**: what this round is asking. One line. Everything else is an
  answer to it, and a round without one is four files nobody can judge.
- **name**: what you would call this direction in conversation. It rides the
  card, so "the ledger" beats "Option B".
- **angle**: the one thing this position changes. Two positions with the same
  angle are one idea wearing two names, and `variate check` says so.
- **cost**: what it gives up. Every real direction gives something up, and
  the user reads this on the card while deciding, so an honest sentence here
  is worth more than a paragraph in chat.

Position 1 of a round on an existing file is their file as it was; it needs
neither an angle nor a cost.

## Presenting

Name what each position is trying, in the user's language, not yours: "1 is
what you had, 2 is a split manifesto, 3 leads with the product shot, 4 puts the
work list first". Then say which you would keep **and why**, in one sentence,
and name what it costs. A recommendation with no cost attached reads like
salesmanship; the decision is still theirs.

Positions, never filenames. The number on the card is the number in the
sentence.

## Applying a verdict

- A plain verdict: they are already on the one they want. Nothing to do but
  log it. ("Pick" belongs to the card's pick button, which starts a round on
  a clicked section; do not reuse the word for choosing a position.)
- **Compositional feedback is the best kind**: "2's layout with 4's stat strip"
  IS the design. Draw the merge as the next position rather than asking them to
  choose again. Each part comes from exactly one donor, whole, lifted from its
  real file (`.dropped/` keeps the narrowed-away ones): never blend two
  directions, because the average is the middle neither of them wanted. Name
  the donors in the merge's `angle`.
- Small edits to a winner (a word, a spacing value) are ordinary edits to the
  live file; a round is for a question with more than one defensible answer.
- "Like 3 but calmer" is a steer, below.
- **A passed-over direction stays dead.** The board remembers what each round
  turned down (`variate status` lists it); offering it again two rounds later
  as a fresh idea reads as not listening. It comes back only when the user
  asks for it, and then it is a copy from `.dropped/`, not a redraw.
- Silence on a round means it was not a real question. Ask a sharper one.

## The steers

Each bends the variants, never the brand:

- **calmer**: more restraint, softer contrast, fewer elements
- **bolder**: bigger type, stronger presence, higher contrast
- **airier**: much more whitespace, lighter density, room to breathe
- **denser**: tighter spacing, more information forward, more visible at once
- **playful**: unexpected details, a wink of personality, tasteful motion

## The style bar

Always, in every variant:

- **No eyebrow labels.** No small uppercase kicker above a heading, no
  numbered tags like "02 / RESEARCH".
- **No italic display type.** Emphasis comes from weight, colour, or space.
- **One earned accent colour**, and it means something.
- **Whitespace is the luxury.** When a section feels flat, add space, never
  another element.
- **No em dashes or en dashes in copy.** Use commas, colons, or parentheses.
- **Responsive from 360px to 1440px**, honest contrast, and honour
  `prefers-reduced-motion`.
- **Ground every word in the real product.** In their project, lift their
  copy. Designing from nothing, write specific plausible content: a real
  sentence about a real thing, never lorem ipsum and never a dead button.
  What you must never fake is proof: logo walls, testimonials, customer
  counts, revenue. Layout gets rewritten later; an invented number ships.

## Motion

Movement is a cost the user pays every time they meet it, so the first
question is never how to animate something, it is whether to.

- **Many times a day** (a menu, a toggle, anything a key triggers): no
  animation. Speed IS the feature, and motion here reads as lag.
- **Now and then** (a dialog, a drawer, a toast): a short one, earned.
- **Rarely** (first run, a success moment): room for delight.

When something does move:

- **Ease out on the way in.** Start fast and settle. Motion that starts slow
  delays the exact moment the user is waiting for.
- **Under a third of a second** for anything in the interface. If it feels
  too quick, it is probably right.
- **Move `transform` and `opacity`, nothing else.** Anything that changes
  layout will stutter.
- **Never grow from nothing.** Come in at around 95% and fade; things in the
  world do not appear out of zero size.
- **Grow from whatever opened it.** A menu or popover expands from its
  trigger, not from its own middle. A centred dialog is the exception.
- **`prefers-reduced-motion` turns it off**, not down.

The house curve, the one this tool's own card uses, is
`cubic-bezier(.2,.7,.2,1)`. Reach for it before inventing one.

When a round is *about* motion, say so in the position's `angle`, and give
the user something they can trigger more than once: on the card, clicking the
position they are already on replays it.

## Speaking the project's language

This is the difference between a variant that looks like their app and one
that looks like AI output. Before drafting, read:

1. **Their tokens.** A Tailwind `@theme` block, `:root` custom properties, a
   theme config. Use those names. `bg-paper-2` and `text-ink-muted` are the
   vocabulary; `bg-[#1a1a1a]` is a failure.
2. **The target file's imports.** Reuse their `Button`, `Reveal`, `Magnetic`,
   their easing constants, their fonts. Never reinvent a primitive they have.
3. **The neighbours.** The sections rendered immediately before and after, so
   your variant sits between them without a seam.
4. **Their copy.** Lift it. A variant is a design alternative, not a rewrite,
   unless the user asked for new words.
5. **How the product carries itself.** A calm daily tool and a loud consumer
   launch tolerate very different boldness. This is the ceiling on how far
   your most adventurous position may go: bold is relative to the room.
6. **How often this thing is used.** Something someone hits fifty times a day
   wants less of everything, motion most of all.

## The variant contract

Every variant file is a complete, drop-in replacement for the target:

- the same exports, the same props, the same shape the rest of the app imports
- in markup, the root element carries `data-variate-section="<set>"`, the
  card's handle for watching and pointing at the piece. Variant 1 never
  carries it, style files have no root to tag, and `end` strips it from the
  kept file, so it never ships.
- the same client/server nature (if the original is a client component, yours
  is too)
- only dependencies already in the project
- it compiles, and the dev server does not log an error after switching to it
- no edits to shared files. If the idea needs a token change, that is its own
  set on the theme file, not a smuggled edit.

**Where the styles go**, so two variants of the same set never disagree about
architecture: follow whatever the target file already does. If it uses utility
classes, use theirs. If it imports a stylesheet or a CSS module, put your rules
there only if that file belongs to this component alone. If the target relies
on class names that live in some global stylesheet you must not touch, keep
each variant self-contained with its styles inside the file: `<style scoped>`
in Vue or Svelte, a `<style>` block in Astro, and in React or plain JSX a
`<style>` element whose every selector is prefixed with a class unique to that
variant (`.v2-row`, `.v3-rail`). React has no scoping, so without that prefix
two variants of the same set will collide the moment they reuse a class name.
Never create a new shared stylesheet, and never make one variant depend on a
file another variant introduced: each one has to work the moment it is copied
over the target, on its own.

## When there is nothing to vary yet

If the user has no project, or the section does not exist, build it first, in
their stack, the way they would have written it. Then `variate add` that file
and run a round on it. Do not build inside `.variate/`: it is scratch space for
alternatives, not a place to author from.

With no design system to inherit, **settle a baseline before you diverge**:
one background, one ink, one accent, a system font stack, one spacing rhythm.
Fix that first, then let the positions differ on structure. Four positions
that each invent their own palette are not a round about layout, they are
four unrelated pages, and the user cannot tell you what they liked.

## Assets

Real images live wherever their project already keeps them (`public/`,
`assets/`, `static/`). Reference them exactly as the rest of the app does.
Drawn art (illustrations, mocks, decoration) is inline SVG or CSS, composed and
art-directed, never a placeholder box and never an external URL.
