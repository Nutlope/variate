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

The listening loop (`await --timeout 20`, short slices, count the quiet ones)
is the universal mechanism and works in any harness that can run a 20 second
command. Hooks, where they exist, are upgrades on top of it, not requirements.

## Claude Code

Everything works as written. What differs here is only how fast a click
reaches you, and that is worth understanding before you promise the user
anything.

**Draining at the top of every turn is the mechanism.** It needs no setup and
it cannot be switched off by a harness. Everything below only shortens the
wait.

**The hooks in SKILL.md's frontmatter do fire.** Verified in practice:
invoking the skill and letting the turn end arms the 15 minute watcher, and
`.variate/state/wake.lock` names a live process. `hooks` is a recognised
skill-frontmatter field, and once the watcher is armed it is an ordinary
background process that outlives the turn that started it. So a user who
installs nothing still gets idle wake for the fifteen minutes after a round.

What the frontmatter cannot cover is the window after that, or a turn where
the skill was never invoked at all: no invocation, no hooks, and a user who
comes back an hour later is outside the watcher's life either way. That is
what the settings copy is for, and why draining first is still the mechanism
that never depends on any of this.

**For coverage that does not depend on the skill being in play**, install the
same pair into the user's own settings, where they are registered for the
whole session:

```
node <skill>/scripts/install.mjs --hooks
```

It backs the file up first, leaves any other Stop hooks alone, and is
reversible with `--hooks --remove`. Offer it; never run it unasked. With it
installed:

- The **sync hook** (`--peek --hook`) runs when you try to stop. If asks are
  queued it blocks the stop once, handing you the asks and the exact drain
  command, so a click that landed as you were finishing is never dropped. It
  stands down when `stop_hook_active` is set, and Claude Code overrides after
  8 consecutive blocks, so a stop cannot be held hostage.
- The **wake hook** (`--wake`, asyncRewake) arms a 15 minute watcher when your
  turn ends, and a click while you are idle wakes you with the ask on stderr.
  It takes a single-instance lock in `.variate/state/wake.lock`, never claims
  an ask itself (your `drain` does), and in a project with no `.variate/` it
  exits in about 25ms having created nothing, which is why it is safe as a
  global hook.

Also worth using: **subagents** for drafting variants in parallel, one per
variant, each with its own divergence constraint. Worth it for a long round
or a big file; for three short files, writing them yourself is faster.

## Codex CLI

Install links variate at `~/.codex/skills/variate` (Codex's global skills
home) and at the shared `~/.agents/skills/variate`, which Codex also reads
per project. `agents/openai.yaml` in the skill directory is Codex's optional
display metadata; leave it in place. The things that differ:

- **The sandbox may refuse to keep a background process alive or to bind a
  port.** `variate up` handles this: it prints what is unavailable and exits
  **3**, not 1. That is not a failure, but it does mean no card, so no ask
  will ever arrive: `await` exits 3 for exactly this. Skip the listening
  loop, carry on with `add`, `check` and `use`, tell the user their page
  updates on reload, and take verdicts in chat.
- **Do not suggest editing `~/.codex/config.toml`** to widen the sandbox. If
  something is blocked, name the block and take the fallback.
- **Codex has Stop hooks** (sync only, command type only, no idle wake). A
  blocked stop synthesizes a continuation prompt from the reason, so the
  same `--peek --hook` probe closes the "clicked as you stopped" race. If
  the user wants it, they can put this in `<repo>/.codex/hooks.json` (or
  `~/.codex/hooks.json`):

  ```json
  {
    "hooks": {
      "Stop": [
        {
          "type": "command",
          "timeout": 10,
          "command": "node \"$HOME/.agents/skills/variate/scripts/await.mjs\" --ws \"$PWD/.variate\" --peek --hook"
        }
      ]
    }
  }
  ```

  There is no idle wake in Codex: once your turn truly ends, clicks queue on
  disk and drain on the user's next message. Say so in the handoff.

## Cursor

Point it at `AGENTS.md`, which is the contract in one page. Cursor runs
commands in the workspace, so pass `--root .` and everything behaves. No
hooks: the listening loop is the whole live mechanism, and after the turn
ends, clicks drain on the user's next message.

## opencode

Install puts variate at `~/.config/opencode/skills/variate`, and opencode
also discovers the Claude Code and Codex copies, so one install is enough.
No hooks (plugins only): behave as in Cursor. When you end a turn with a
round open, say "click keep on the card, then send me any message" so the
user knows the second half of the gesture.

## Any other agent

If it can run a shell command, it can run variate:

```
node <path-to-variate>/variate.mjs up --root <the project>
```

Follow the block it prints. `AGENTS.md` is written for exactly this case and
needs no skill loader.

## Timeouts

Only `await` blocks, on purpose, for the seconds you pass it: keep
`--timeout 20` so chat messages land between slices, and never run one long
await. Everything else returns immediately; the sidecar is detached by
design; `--wake` is only ever run by hooks, never by you.
