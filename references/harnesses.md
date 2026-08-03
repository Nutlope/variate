# Running variate in each agent

Read this only if something in the flow does not behave the way SKILL.md
describes. SKILL.md is the contract everywhere; this file is the local
weather.

## Everything, everywhere

The CLI is the whole interface. It is plain Node with no dependencies, it
takes `--root` on every command so a harness that resets the working
directory cannot confuse it, and it prints an aligned block saying what
happened and what to run next. Exit codes are the protocol: **0** did it,
**1** error, **2** nothing to do, **3** the user has to act.

Nothing about the design work needs the card. If `up` cannot start (see
below), `add`, `check`, `use`, `status` and `end` still do everything; the
user just reloads their page to see each switch instead of pressing an arrow.

## Claude Code

Everything works as written. Two extras worth using:

- **Subagents** for drafting variants in parallel, one per variant, each with
  its own divergence constraint. Worth it for a long round or a big file;
  for three short files, writing them yourself is faster.
- **The Stop hook** in SKILL.md, if the user wants a nudge when they end a
  turn with card requests still queued. It warns and never blocks.

## Codex CLI

Install puts variate at `~/.agents/skills/variate`. The things that differ:

- **The sandbox may refuse to keep a background process alive or to bind a
  port.** `variate up` handles this: it prints what is unavailable and exits
  **3**, not 1. That is not a failure. Carry on with `add`, `check` and `use`,
  and tell the user their page updates on reload rather than on an arrow key.
- **Do not suggest editing `~/.codex/config.toml`** to widen the sandbox. If
  something is blocked, name the block and take the fallback.
- **No hooks.** Ignore the Stop-hook section of SKILL.md.
- **`--drain` still works** if the card is running, because the queue is only
  files. If the card never started, no requests will ever arrive, so skip it.

## Cursor

Point it at `AGENTS.md`, which is the contract in one page. Cursor runs
commands in the workspace, so pass `--root .` and everything behaves. There is
no hook support; ignore that section.

## opencode

Install puts variate at `~/.config/opencode/skills/variate`, and opencode also
discovers the Claude Code and Codex copies, so one install is enough. Behaves
like Codex: assume no hooks, and check the exit code from `up` rather than
assuming the card is there.

## Any other agent

If it can run a shell command, it can run variate:

```
node <path-to-variate>/variate.mjs up --root <the project>
```

Follow the block it prints. `AGENTS.md` is written for exactly this case and
needs no skill loader.

## Timeouts

Nothing in variate blocks. Every command returns immediately; the only
long-running thing is the sidecar, which is detached by design. If your
harness has a short command timeout, it will not bite here.
