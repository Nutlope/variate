# variate

Turn the coding agent you already pay for into a website studio you direct
from the terminal.

`variate` is an [Agent Skill](https://agentskills.io) that works in Claude
Code, OpenAI Codex CLI, Cursor, and any other agent that supports the open
skill format (or can run a shell command; see below). Your agent writes the
site one section at a time; you art-direct it through **design rounds**: it
drafts a handful of structurally different takes, you flip through them in a
live preview, and you answer in the terminal ("2, but with 4's stat strip").
That sentence IS the design; the agent draws it, logs the verdict, and the
site converges one decision at a time.

- **Design rounds**: 5 wildly different takes of a section, compared in
  place between their real neighbors, picked by keyboard or by talking.
  Verdicts append to `site/DECISIONS.md`, so the design tree survives
  restarts and context loss.
- **The studio** (a zero-dep local server): a live section stack with
  variate/steer, scoped prompt edits, an in-place tracing-paper **sketch
  pad**, drag-and-drop **images**, a live **design-token editor** over your
  `:root`, inline **text editing**, takes pagers, move/cut/discard/undo.
  Deterministic tools apply instantly; only generative asks reach the agent.
- **Terminal-first**: the agent never sits blocked. It folds studio clicks
  in between conversational turns (`await.mjs --drain`); a blocking studio
  mode exists when you would rather click than talk, and an optional Claude
  Code Stop hook (`await.mjs --peek --hook`, see SKILL.md) warns the agent
  whenever it tries to end a turn with clicks still queued.
- **Multi-page**: pages share one design system; the studio grows tabs; the
  export is flat (`index.html`, `about.html`, `assets/`) so links work from
  disk and on any static host.
- **Ship-ready export**: every page gets a meta description, OG tags, and a
  favicon derived from its own copy and logo mark. `npx serve dist`, drag
  dist/ into Netlify, or `vercel deploy dist`: nothing else to configure.

Everything runs local: 127.0.0.1 only, no accounts, no telemetry, no API
keys beyond whatever runs your agent.

## Install

One repo, any agent, via the [skills CLI](https://github.com/vercel-labs/skills):

```bash
npx skills add <you>/variate -a claude-code -a codex
```

or by hand (Claude Code):

```bash
git clone <this repo> ~/.claude/skills/variate
```

(Codex CLI reads `~/.agents/skills/variate`; anything that runs shell
commands works via `node scripts/start.mjs`, which prints what to do next.)

## Use

In your agent, in any project:

```
/variate build a landing page for my soil-testing startup
```

The agent boots the studio (on a stable per-project port, printed at start),
drafts the design system and opening sections from your brief, then runs the
first design round. Keep talking in the terminal OR click in the studio;
both land on the same files.

## How it works

```
you, in the terminal  <->  the agent (lands takes via scripts/land.mjs:
        |                   server-routed when the studio is up, so parallel
        |                   subagents can land takes concurrently)
        |            node await.mjs --drain   (folds in studio clicks, never blocks)
        |                        |
   the studio  ->  POST /api/request  ->  requests/0007-variate-hero.json
   (live viewer,   deterministic ops (move/cut/pick/discard/undo, tokens,
    picker, sketch,  text edits) applied by the server instantly
    drag-drop)
        |
   server watches files -> SSE -> only the touched section's iframe reloads
```

- Take files are immutable; every mutation is a manifest mutation; undo is a
  journal-backed manifest restore. Cut and discard never delete work.
- Sections render in sandboxed iframes (`allow-scripts`, never
  `allow-same-origin`) behind a strict CSP; generated code cannot touch the
  studio, and external requests are blocked and flagged.
- The workspace is plain files under `./variate/` in your project: diff it,
  commit it, or import any single-file page with `data-rb` sections (Recast
  exports continue seamlessly).

## Dev

```bash
node scripts/serve.mjs --ws fixtures/demo-ws --port 4177    # studio on the fixture
node fixtures/pseudo-agent.mjs --ws fixtures/demo-ws        # canned agent, no LLM
for t in 1 2 3 4 5 6 7; do dev/smoke-$t.sh; done            # protocol tests
```

The fixture workspace is deliberately v1; the server migrates it to the
multi-page v2 layout at boot, which is itself under test (smoke-5).

macOS first; Linux uses a polling watcher (`--poll` forces it anywhere);
Windows is untested.
