# variate

Four design variations of a section, on the localhost you are already looking
at, flipped with the arrow keys.

Your coding agent writes real alternatives of one of your files. A small card
appears at the bottom of your own dev server's page. You press ← and → and the
page changes. The one you stop on is the code, already on disk, in your repo,
in your language.

```
     ┌──────────────────────────────────────────┐
     │  HERO │ ‹  1  [2]  3  4  › │ pick   ▾     │
     └──────────────────────────────────────────┘
```

## Why it is built this way

Switching **writes the real file** and lets your own dev server re-render it.
That one decision removes almost everything else: there is no preview server,
no wrapper component, no iframe, no hydration risk, no build step, no
dependency added to your project, and no "keep" step at the end, because what
you are looking at is already the code that ships. It also means variate works
the same on React, Vue, Svelte, Astro, Rails, or a single HTML file, and works
on components, whole pages, and theme files alike.

- **Nothing is variate-shaped.** A variant is a `.tsx`, or a `.vue`, or a
  `.css`. Its only contract is that it drops in where the original was.
- **Your original is variant 1**, never edited. Flipping back to it is one key.
- **A hand edit is never lost.** If you edit the live file yourself, the next
  switch keeps it as a new variant first.
- **Which variant is live is derived, not stored**, so it cannot drift out of
  sync with your files.
- **`variate end` leaves one line of git diff**: the design you chose.

## Use

In your agent, in a project you are already running:

```
/variate give me four takes on the hero
```

Or drive it yourself:

```bash
node variate.mjs up   --root .            # card appears on your page
node variate.mjs add  src/components/Hero.tsx
# your agent writes .variate/hero/plan.json and 2.tsx, 3.tsx, 4.tsx
node variate.mjs use  hero 3              # or just press 3 on the card
node variate.mjs end                      # keep what is live, remove variate
```

Keys: `←` `→` flip · `1`-`9` jump · `[` `]` change section · `esc` hide · `?` help.

The card also has a **pick** button: click a section on your page and your
agent gets a request to make four takes of it, with enough of the visible copy
to find it in your source.

## Install

```bash
git clone <this repo> ~/code/variate
node ~/code/variate/scripts/install.mjs
```

That links it into every agent it finds on the machine (Claude Code, Codex
CLI, opencode), so `git pull` updates all of them at once. `--dry-run` shows
what it would do, `--remove` undoes it, `--copy` installs copies instead of
symlinks.

Anything that can run a shell command works too: `node variate.mjs up` prints
what to do next, and `AGENTS.md` is the whole contract in one page.

## What it puts in your project

One dev-only, marker-bracketed line in your entry file, and `.variate/`
(gitignored) holding the alternatives. `variate end` removes both.

Everything is local: `127.0.0.1` only, an Origin allowlist, a per-project
token, no accounts, no telemetry, and no network calls beyond your own agent.

## Honest limits

Flip latency is your dev server's: usually under 150ms on Vite, 200-400ms on
Next, and a full reload where there is no HMR. Plain HTML reloads. A modal
`<dialog>` opened after the card can cover it; the keys still work. Finding
which file a clicked section came from is a text search of your repo, not a
source map, because source mapping is unreliable on modern bundlers and lying
about it would be worse.

## Dev

```bash
node dev/fixture.mjs                      # a real page to try the card on
node variate.mjs up --root <that copy>    # attach and start
dev/smoke-cli.sh && dev/smoke-http.sh && dev/smoke-card.sh
```
