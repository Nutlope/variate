<p align="center">
  <a href="https://variate-skill.vercel.app">
    <img alt="variate" src="docs/img/og.png">
  </a>
</p>

<h1 align="center">variate</h1>

<p align="center">
  Your agent writes four real versions of one file; arrow keys flip them on the localhost you are already looking at. The one you keep is the code. <a href="https://variate-skill.vercel.app">variate-skill.vercel.app</a>
</p>

## Tech stack

- Node 18 builtins only: zero dependencies, no package.json, nothing to build
- A vanilla JS card in a shadow root, injected into your own dev page
- A 127.0.0.1 sidecar that serves the card and switches files, with SSE for live state
- SKILL.md and AGENTS.md as the agent contracts (Claude Code, Codex CLI, opencode, Cursor, anything with a shell)
- Three shell smoke suites as the whole test harness
