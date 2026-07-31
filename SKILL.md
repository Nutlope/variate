---
name: variate
description: >
  Put four design variations of a section, a page, or a theme in front of the
  user on their own dev server, and let them flip between them with arrow keys
  from a small card at the bottom of the page. Use when the user wants design
  variations, alternatives, or A/B options of something they are building;
  when they ask to try a different hero, layout, palette, or section; when
  they want to compare directions before committing; or to continue an
  existing variate session. Works on any stack: the variations are real files
  in their repo and switching just swaps one.
license: MIT
compatibility: Requires Node.js 18+ and a dev server the user already runs.
metadata:
  version: "3.0.0"
  author: youssef
---

# variate

The user's own localhost is the canvas. You write real alternatives of one of
their files; a small card at the bottom of their page lets them flip between
them; the one they stop on is the code. There is no studio, no preview server
of ours, and no separate thing to keep in sync.

## Critical floor

Obey these even if you read nothing else.

1. **Variant 1 is the user's file as it was.** Never edit it, never delete it,
   never overwrite it. Everything you write is a new numbered sibling.
2. **Every variant is a complete, drop-in replacement for the target file.**
   Same exports, same props, same imports the app relies on. It must run: a
   variant that breaks the build white-screens their app.
3. **Speak the project's own language.** Its design tokens, its utility
   classes, its components, its fonts, its real copy. A variant that adds a
   dependency or invents a colour has already failed.
4. **Four variants, structurally different.** Different layout, different
   hierarchy, different primary affordance. Four tweaked card grids is
   wallpaper, not a round.
5. **Write `plan.json` before the variants.** It names the directions, and it
   is what the user reads while they wait.
6. **Talk in positions, never filenames.** "2 of 4", not "3.tsx".
7. **Ask one question per round, with your recommendation.** Then wait.
8. **Never hand-edit `.variate/*/target`, and never write the target file
   directly while a set is open.** Write a variant and switch to it.
9. **Offer `variate end` when the session is done.** Leaving the tag behind is
   leaving litter in someone's repo.

## The flow at a glance

`<skill>` below is this skill's own directory, the one holding this file.

```
node <skill>/variate.mjs up    --root <project> [--port N]   card appears on their page
node <skill>/variate.mjs add   <file> [--n 4]                variant 1 = the file as it is
   write .variate/<set>/plan.json, then 2.<ext>, 3, 4        your actual design work
node <skill>/variate.mjs check <set>                         lint before you present
node <skill>/variate.mjs use   <set> <n>                     put one on their page
   hand it over and wait
node <skill>/variate.mjs end   [<set>]                       keep what is live, clean up
```

**Every command takes `--root <project>`**, defaulting to the current
directory. Pass it explicitly: many harnesses reset the working directory
between calls. `--json` on `status` gives machine output; `--help` lists
everything.

`--n` counts **positions including the user's original**, so `--n 4` means
their file plus three new designs. If the user asks for "four new ones", that
is `--n 5`.

Exit codes: **0** did it, **1** error, **2** nothing to do, **3** the user has
to act.

## The one model

A **set** is one target file plus N alternatives:

```
.variate/hero/
  target        one line: the path this set stands in for
  plan.json     ["as it was", "the ledger, type only", ...]  one name per position
  1.tsx         their file, untouched            <- position 1, always
  2.tsx 3.tsx 4.tsx                              <- yours
```

Switching copies a variant over the target file and their dev server
re-renders. Which variant is live is **derived** by comparing the target
against each variant, never stored, so it cannot drift. If the user hand-edits
the target, the next switch adopts that edit as a new variant first: their work
is never destroyed, which is why nothing in this tool asks "are you sure".

## Opening a round

1. **Resolve the target.** A component, a page, a layout, a theme or CSS file:
   anything that is one file. If the card sent you a selection, its `text` is
   the visible copy of what the user clicked, so grep the repo for it.
2. **Read the substrate before you draft.** This is what makes the variants
   look like their app instead of generic output:
   - their design tokens (Tailwind `@theme` block, `:root` custom properties,
     theme config) and use those names, never raw hex
   - the target file's own imports: reuse their `Button`, their motion
     helpers, their fonts
   - the files rendered immediately before and after it, so the seams flow
   - their real copy. Never invent metrics, customers, or testimonials.
3. **`variate add <file>`**, then write `plan.json` with one short direction
   per position, position 1 being "as it was".
4. **Draft.** One variant per file, landed as you finish each one: the pager
   on the card grows as the files land, so the user can see the round filling
   in. (The page itself only changes when someone switches.) For a big file or
   a long round, subagents drafting in parallel are worth the setup, one per
   variant with an explicit divergence constraint; for three short files it is
   faster to write them yourself.
5. **`variate check <set>`** and fix what it reports. `check` is a lint, not a
   compiler: it catches unresolvable imports, missing exports, dependencies you
   invented, and house-style breaches, but it cannot tell you a file parses. If
   the project has a typecheck, lint, or build script, run it too.
6. **Put your recommendation on the page** with `variate use <set> <n>` before
   you speak, so the user is looking at your best work rather than at what they
   already had.
7. **Hand it over.** Name what each position is trying, say which you would
   keep and why, and ask which one. Tell them: arrows, or the numbers. Say
   plainly that position 1 is what they had, one key away.

The full craft rules are in `references/craft.md`. Read it before your first
generative work in a session.

## Applying a verdict

A plain pick needs nothing from you: the user is already on it, and the file
already says so. Log the decision in your reply.

The best feedback is compositional. "2's layout with 4's stat strip" IS the
design: draw it as the next position rather than arguing.

"More like 3, but calmer" is a new round on the same set: keep the numbering
going, add positions, tell them the new range.

## What the user does without you

Flipping, picking, and hand-editing the target file all happen without a
request reaching you. So **always re-read the target and the set before you
write**, and never assume the position you left them on is the one they are
looking at.

## The card's asks

Between turns, and whenever the user mentions clicking something:

```
node <skill>/variate.mjs drain --root <project>
```

It prints every queued ask as ONE JSON array and exits **0**; with nothing
waiting it prints `[]` and exits **2**, so branch on the exit code. Ack with
`--ack <id> --note "<one line for the user>"` folded into the next call.
Types: `vary` (make N of this file or this selection), `more` (N more on an
existing set, with `steer` and `from`), `done`.

## Attaching, and leaving

`up` adds one dev-only, marker-bracketed line to their entry file and writes
`.variate/` (gitignored). `end` removes both and leaves the winning variant in
place, so `git diff` shows one changed file: the design decision, nothing else.
If their stack is not detected, `up` prints the tag for them to paste;
`references/frameworks.md` has the snippet and the caveat per stack.

## Look at what you made

1. Fix everything `check` reports before you present.
2. If your harness can open a page, look at the live one at desktop and at
   about 390px. One pass per round, not one per variant.
3. If the dev server logs an error after a switch, that variant is broken:
   switch back to 1 and fix it before saying anything.

## Optional: a Stop hook so clicks are never missed

The user can paste this into their project's `.claude/settings.json` if they
want a nudge when they end a turn with asks still queued. It warns, never
blocks:

```json
{"hooks": {"Stop": [{"hooks": [{"type": "command", "timeout": 10,
  "command": "command -v node >/dev/null 2>&1 && node '<abs-skill-dir>/scripts/await.mjs' --ws '<abs-project>/.variate' --peek --hook || true"}]}]}}
```
