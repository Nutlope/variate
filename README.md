# variate

Turn the coding agent you already pay for into a landing-page studio.

`variate` is an [Agent Skill](https://agentskills.io) that works in Claude
Code, OpenAI Codex CLI, Cursor, and any other agent that supports the open
skill format (or can run a shell command; see below). Your agent writes the
page one section at a time; you art-direct from a live local preview:

- **Variate a section**: 1 to 4 alternative takes land in place, stack behind
  a pager, and you keep the one you like. Steer them with one word (calmer,
  bolder, airier, denser, playful).
- **Prompt a section**: a scoped edit that touches nothing else.
- **Add a section between sections**: a hairline blooms into a catalog
  (features, pricing, FAQ, waitlist form...) or a custom ask.
- **Sketch a section**: draw a wireframe in the pad; it serializes into a
  geometric blueprint (plus a PNG for vision models) and the agent implements
  it in place, in the page's own design language.
- **Move, cut, swap takes, undo**: instant, no agent turn burned.
- **Done**: one self-contained `dist/index.html`, no build step, no CDN.

Everything runs local: a zero-dependency Node server bound to 127.0.0.1, a
file-queue bridge between the browser and the agent, no accounts, no
telemetry, no API keys beyond whatever runs your agent.

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

The agent boots the studio (default http://127.0.0.1:4177), bootstraps the
page from your brief, and then waits on your clicks. Keep talking to the
agent OR click the page; both work on the same files.

## How it works

```
browser studio  ->  POST /api/request  ->  requests/0007-variate-hero.json
                                                 |
agent loop:  await.mjs (blocks, prints request JSON, exits)
             -> writes site/sections/hero/take-4.html + manifest
             -> await.mjs --ack 0007 --note "drew 2 takes"
                                                 |
server watches files -> SSE -> only the touched section's iframe reloads
```

- Take files are immutable; every mutation is a manifest mutation; undo is a
  journal-backed manifest restore. Cut never deletes work.
- Deterministic ops (move / cut / pick / undo) are applied by the server
  instantly; only generative asks reach the agent.
- Sections render in sandboxed iframes (`allow-scripts`, never
  `allow-same-origin`) with a strict CSP, so generated code cannot touch the
  studio.
- The workspace is plain files under `./variate/` in your project: diff it,
  commit it, or point the skill at a Recast export and keep building.

## Dev

```bash
node scripts/serve.mjs --ws fixtures/demo-ws --port 4177   # studio on the fixture
node fixtures/pseudo-agent.mjs --ws fixtures/demo-ws       # canned agent, no LLM
dev/smoke-1.sh && dev/smoke-2.sh && dev/smoke-3.sh          # protocol tests
```

macOS first; Linux uses a polling watcher (`--poll` forces it anywhere);
Windows is untested in v1.
