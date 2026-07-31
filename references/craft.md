# The craft

Read this before your first generative work in a session. These rules
descend from a battle-tested prompt library; treat them as hard.

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

Give each position a direction **before** you draft it, and write those
directions into `plan.json`. Naming the four corners of the idea space up front
is what stops them collapsing toward the same safe answer:

```json
["as it was", "the ledger, type only", "split, asymmetric axis", "the outcome first"]
```

## Presenting

Name what each position is trying, in the user's language, not yours: "1 is
what you had, 2 is a split manifesto, 3 leads with the product shot, 4 puts the
work list first". Then say which you would keep **and why**, in one sentence.
Facts you can look up yourself; the decision is theirs.

Positions, never filenames. The number on the card is the number in the
sentence.

## Applying a verdict

- A plain pick: they are already on it. Nothing to do but log it.
- **Compositional feedback is the best kind**: "2's layout with 4's stat strip"
  IS the design. Draw the merge as the next position rather than asking them to
  choose again.
- "Like 3 but calmer" is a steer, below.
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
- **Responsive from 360px to 1440px**, honest contrast, and honor
  `prefers-reduced-motion`.
- **Ground every word in the real product.** Never invent metrics, customers,
  testimonials, or logos. If you need copy you do not have, ask for one line
  rather than inventing three.

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

## The variant contract

Every variant file is a complete, drop-in replacement for the target:

- the same exports, the same props, the same shape the rest of the app imports
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

## Assets

Real images live wherever their project already keeps them (`public/`,
`assets/`, `static/`). Reference them exactly as the rest of the app does.
Drawn art (illustrations, mocks, decoration) is inline SVG or CSS, composed and
art-directed, never a placeholder box and never an external URL.
