---
name: variate
description: >
  Puts real design variations of one project file on the user's own localhost,
  behind a small card that flips them with the arrow keys, then keeps
  listening for their verdict. Use when the user wants design variations,
  alternatives, or directions to choose between; asks to try a different
  hero, layout, palette, section, or page; wants to design something new and
  compare a few takes; clicked the card (a vary, more, or done ask is
  queued); or wants to continue or finish a variate session. It works in an
  empty folder (serves a page, drafts four fresh designs) and in a real
  project (varies one file in place), on any stack. Not for a single change
  with one right answer, a refactor, or a non-visual edit: just edit the
  file for those.
license: MIT
compatibility: Requires Node.js 18+. Works with or without a dev server.
metadata:
  version: "3.2.0"
  author: youssef
hooks:
  Stop:
    - hooks:
        - type: command
          timeout: 15
          command: node "${CLAUDE_SKILL_DIR:-$HOME/.claude/skills/variate}/scripts/await.mjs" --ws "${CLAUDE_PROJECT_DIR:-$PWD}/.variate" --peek --hook
        - type: command
          timeout: 920
          asyncRewake: true
          command: node "${CLAUDE_SKILL_DIR:-$HOME/.claude/skills/variate}/scripts/await.mjs" --ws "${CLAUDE_PROJECT_DIR:-$PWD}/.variate" --wake --timeout 900
---

# variate

The user's own localhost is the canvas. You write real alternatives of one of
their files; a small card at the bottom of their page lets them flip between
them; the one they keep is the code. There is no studio, no preview server of
ours, and no separate thing to keep in sync.

## Critical floor

Obey these even if you read nothing else.

1. **Variant 1 is the user's file as it was.** Never edit it, never delete it,
   never overwrite it. Everything you write is a new numbered sibling.
2. **Every variant is a complete, drop-in replacement for the target file.**
   Same exports, same props, same imports the app relies on. It must run.
3. **Speak the project's own language.** Its design tokens, its utility
   classes, its components, its fonts, its real copy. A variant that adds a
   dependency or invents a colour has already failed.
4. **Four positions that disagree.** Each changes something different, and
   `plan.json` says what and what it costs. Four tweaked card grids is
   wallpaper, not a round. Write `plan.json` before the variants; `check`
   lints it.
5. **A round narrows, it never accumulates.** Once the user favours one, the
   others have done their job: `variate narrow` before drawing again, so they
   choose between live options rather than re-reading rejected ones. It hides
   rather than destroys, in `.variate/<set>/.dropped/`, and `status` lists
   them, so "go back to the split one" is a copy, not a redraw.
6. **Talk in positions, never filenames.** "2 of 4", not "3.tsx".
7. **Ask one question per round, with your recommendation.**
8. **Presenting a round never ends your turn.** Hand it over, then run the
   listening loop below. The card's keep, refine and pick land there.
9. **Drain before you answer, every turn a round is open.** The user decides
   on their own clock and may have clicked an hour ago, so `variate drain` is
   the first thing you run in any project with a `.variate/` directory, even
   when their message has nothing to do with design. An ask left sitting is
   the user waiting for an answer you already have.
10. **Never write the target file directly while a set is open.** Write a
    variant and switch to it. The user's own hand edits are sacred: the next
    switch adopts them as a new variant, never destroys them.
11. **`variate end` when the session is done.** `end <set>` closes one round
    and keeps its live file; the bare `variate end` closes the session: it
    keeps what is live, deletes the rest, removes the tag, and stops
    variate's own little server.

## The commands

`<skill>` below is this skill's own directory, the one holding this file.
**Every command takes `--root <project>`**; pass it explicitly, since many
harnesses reset the working directory between calls.

```
node <skill>/variate.mjs up    --root <project>              card appears on their page
node <skill>/variate.mjs add   <file> [--n 4] [--new]        register a set
node <skill>/variate.mjs check <set>                         lint before you present
node <skill>/variate.mjs use   <set> <n>                     put one on their page
node <skill>/variate.mjs status                              every set, and which position is live
node <skill>/variate.mjs peek                                is anything queued? counts only, claims nothing
node <skill>/variate.mjs narrow <set> [<n>]                  keep one, drop the rest, draw again from there
node <skill>/variate.mjs await [--timeout 20]                block briefly for the card's next ask
node <skill>/variate.mjs drain [--ack <id> --note "..."]     claim every queued ask now
node <skill>/variate.mjs end   [<set>]                       keep what is live, clean up
```

Exit codes: **0** did it, **1** error, **2** nothing to do, **3** the user has
to act. `up` exits 3 when a sandbox will not let the card start: not a
failure, everything else still works and the user reloads to see each switch.
**`await`, `drain` and `peek` never use 2**: hearing nothing is them working,
so they exit 0 and say what happened in their JSON, because they run
constantly and a harness paints any non-zero exit as a failure in the user's
transcript. Their one non-zero case is `await` with no card running: it exits
3, so skip the loop and ask in chat.

## The one model

A **set** is one target file plus N alternatives in `.variate/<set>/`:
`target` (one line: the path), `plan.json` (the round's question and one
entry per position), `1.ext` (their file, untouched), and your `2..N`.
Switching copies a variant over the target file and their dev server
re-renders. Which variant is live is **derived** by hashing, never stored, so
it cannot drift. Three words, one thing each: a **variant** is a file on
disk, a **position** is its slot on the card, and a **direction** is the
name `plan.json` gives it.

## Starting from nothing

There is always something to attach to: a known framework (their dev server
renders, we add the tag), plain HTML (variate serves their files), or an
empty directory (`up` writes `index.html` and serves it). In the empty case
do NOT scaffold a framework unless asked: `up`, then
`add index.html --new --n 4`, write positions 1 to 4 as four real answers to
the brief, `use` your favourite, hand over. It is the fastest path from a
sentence to four designs on a URL, and a first-class flow.

## Opening a round

1. **Settle the question first.** One line: what is this round actually
   asking? Everything else is an answer to it, and it goes in `plan.json`.
2. **Resolve the target**: one file. From a phrase, grep for the words a user
   would see on the page; if a card ask carried a `selection`, its `text` is
   the visible copy of what they clicked. When several files could be it, ask.
3. **Read the substrate before you draft**: their tokens (never raw hex),
   the target's own imports, the sections either side of it, their real copy,
   and how loud the product lets you be. `variate status` lists every
   direction this session already passed over: a dead direction is not a
   fresh idea. Read `references/craft.md` before your first generative work
   in a session; it has the shape of `plan.json`, the style bar, and the
   motion rules.
4. `variate add <file>` (`--n` counts positions **including** the user's
   original), write `plan.json`, then draft one variant per file, landing
   each as you finish: the card's pager grows as files land. In markup
   variants (never variant 1, never style files) the root element carries
   `data-variate-section="<set>"`: it is how the card watches, flashes and
   locates the piece, and `end` strips it from the kept file.
5. `variate check <set>` and fix what it reports: it lints the round as well
   as the files. It is not a compiler, so run their typecheck or build too.
6. **Look at every position** before you speak, and at 390px once. A console
   error after a switch means that variant is broken, not that you are done.
7. **Put your recommendation on the page** with `use` before you speak.
8. **Hand it over in one short block**: what each position tries and costs,
   which you would keep and why, and the keys: arrows or digits to flip,
   **enter or keep to decide**, refine to steer, and clicking the position
   you are on replays it. Then start the loop.

## Stay at the table

The user is about to flip, and their keep or refine lands in a queue only you
can drain. So after the handoff, listen:

```
node <skill>/variate.mjs await --root <project> --timeout 20
```

Each call blocks at most 20 seconds and returns the moment an ask arrives.
Keep every slice this short: a typed chat message can only land between
calls, so short slices are what keep the chat alive. Never run one long await.

Read the JSON it prints, not the exit code: waiting and hearing nothing is
this command working, so it exits **0** either way.

- **An ask arrived** (any object without `"type": "idle"`). Act on it now, in
  this same turn, ack it, then go back to listening.
- **`{"type": "idle", ...}`.** It carries `lastSwitchAt` and
  `lastSwitchSource`: if the source is `card` and under 60 seconds old the
  user is flipping right now, so do not count this slice. Otherwise count it,
  and after 6 counted slices (about two minutes of quiet) end your turn.
  Say plainly how it works from here: the card stays live, and **you pick up
  their next click the moment they send you anything**. Never imply you are
  still watching, because you are not.
- **Exit 3: there is no card**, so nothing can arrive. Do not loop; ask in
  chat. It is the only exit code `await` uses to mean something.

Acting on an ask, by type:

- **done**: the user kept a position. `variate end <set> --why "<their
  reason>"` keeps the live file, closes the round, and remembers what won; if
  it was the only set, run the bare `variate end` so the tag and the server
  go too. Confirm in chat by naming the kept direction from `plan.json`
  ("kept 3, the split manifesto"), then offer the next step in one line:
  refine it further, vary another section, or done.
- **more**: the question narrowed, so the round must narrow with it. **First
  `variate narrow <set> <from>`**: the position they chose becomes 1 and the
  ones they passed over move to `.dropped/`, out of the pager but recoverable.
  Then write 2 and 3 as takes ON that, honouring `steer`, append them to
  `plan.json`, `use` the strongest, and say in one line what changed. Read
  the steer for which move they want: "but calmer" is **tightening** toward
  one answer, "other takes like this" is **exploring around** it, and the
  second wants wider positions than the first. Never leave rejected positions
  in the pager: offering the three they already turned down re-asks a
  question they have answered.
- **vary**: a new round on another file, as in "Opening a round". Close the
  round they are leaving first: whatever is live in it is their decision, so
  `variate end <that set>` keeps it and clears the card down to the new
  question. One file, one set: if `add` refuses because the file is already
  varied, narrow or extend that set instead of making a second one.

Fold the ack into your next queue call: `--ack <id> --note "<what you did>"`.
The note is the queue's audit trail; what the user reads is your reply. An
ask marked `"redelivered": true` is one you already claimed, so ack it rather
than doing the work twice. The user flips, keeps and hand-edits without you,
so re-read the set and the target before writing anything mid-loop.

The best feedback is compositional: "2's layout with 4's stat strip" IS the
design, so draw the merge as the next position rather than arguing. A steer
that names several positions is this ask. One rule when you draw it: **each
part comes from exactly one donor, whole.** "2's layout" means 2's layout
entire, lifted from 2's real file (narrowed-away donors wait in `.dropped/`),
never a blend of two directions: averaging produces the middle neither of
them wanted. Name the donors in the merge's `angle` ("2's layout wearing 4's
palette"). Small edits to a winner (a word, a spacing value) are ordinary
edits to the live file; a round is for a question with more than one
defensible answer.

## The card's asks, between turns

The listening loop covers the minutes after you present. Real decisions take
longer: the user looks, thinks, goes to lunch. So the loop is not the only
path and it is not the important one.

**On every turn, in a project that has a `.variate/` directory, start with:**

```
node <skill>/variate.mjs drain --root <project>
```

It prints every waiting ask as ONE JSON array and always exits 0: an empty
array is the normal case and costs you one command. Act on each ask (same
three types as above) before you answer whatever they typed, and ack each.
Do this even when their message is about something else entirely: "does this
deploy?" from a user whose refine has been queued for an hour means they
think you already have it.

Ack with `--ack <id> --note "..."` folded into your next queue call.

Clicks only reach an idle agent if the user installs the hooks
(`node <skill>/scripts/install.mjs --hooks`, Claude Code). Offer it once,
when a round ends with them wishing it had been automatic; never install it
unasked. `references/harnesses.md` explains why both hook layers exist.

## Many pieces, one page

A page is a series of rounds: the hero, then the nav, then pricing. Each
`end <set>` records what won, `status` shows what is settled next to what is
still open, and the final `end` recaps the session. Keep one round open at a
time unless the user wants two, and when they move on, close the one they are
leaving: whatever is live in it is their decision.

## Attaching, and leaving

`up` adds one dev-only, marker-bracketed line to their entry file (or injects
it at serve time, leaving their files untouched) and writes `.variate/`
(gitignored). `end` removes all of it and stops the sidecar, so `git diff`
shows the design decision and nothing else. If their stack is not detected,
`references/frameworks.md` has the tag. If their dev server is not running,
say so: switching writes the real file, but they will see nothing until they
start it.

## References, one hop each

- `references/craft.md`: read before your first generative work in a session.
  `plan.json`'s shape, the style bar, motion, the variant contract.
- `references/frameworks.md`: read when the tag needs placing by hand.
- `references/harnesses.md`: read when you are not Claude Code or something
  misbehaves.
