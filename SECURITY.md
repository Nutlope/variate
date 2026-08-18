# Security

variate runs entirely on your machine. The sidecar binds 127.0.0.1 only, makes
no outbound network requests, and has zero dependencies. There are no accounts
and no telemetry.

## What guards the endpoints

- Every request must carry a loopback Host header, and any Origin must be
  localhost. An opaque origin (a sandboxed iframe) may read state but never
  write.
- Anything that writes (switching, ending, queuing an ask) needs a bearer
  token, generated per project into `.variate/token` (mode 0600). A token in
  the URL works for the read-only event stream alone, never for a POST.
- Static serving (serve mode) refuses dotfiles outright and resolves symlinks
  before reading, so `.variate/`, `.env` and `.git/` are never served and a
  link cannot walk out of the project.
- Set names and ask parameters are whitelisted, capped, and slugged before any
  of them touches a filename, so a request cannot write outside
  `.variate/requests/`.
- Request types are a fixed whitelist (`vary`, `more`, `done`), and switching
  can only land on a variant that already exists in a registered set.

## The residual risk, stated plainly

The card's script is served to any localhost page, so another dev server
running on your machine could read the token and call the same endpoints the
card uses: flip variants, queue asks, or stop the sidecar. Those endpoints are
scoped to `.variate/` and the files you registered with `variate add`. Ask
text (hints, steers, clicked-section descriptions) reaches your agent labelled
as page text, and the agent contract says to treat it as design intent, never
as instructions.

`variate check` may run your project's own typescript or esbuild to parse a
variant, the way any linter does. It never downloads or installs anything.

## Reporting

Open a GitHub issue, or use a private security advisory on the repository if
it should not be public.
