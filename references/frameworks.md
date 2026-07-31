# Per stack: where the tag goes, and what a switch feels like

`variate up` detects the stack and inserts the tag itself. Read this when
detection fails, when the user wants to place it by hand, or when a switch
behaves oddly.

Every insertion is bracketed by `variate:begin` / `variate:end` and is guarded
so a production build never contains it. `variate end` removes the exact
bracketed range.

| stack | file it patches | dev guard | switch feels like |
|---|---|---|---|
| Next app router | `app/layout.tsx` | `process.env.NODE_ENV === "development"` | Fast Refresh, roughly 200-400ms |
| Next pages | `pages/_document.tsx`, else `_app.tsx` | same | Fast Refresh |
| Vite (React, Vue, Solid, vanilla) | `src/main.tsx` or the entry module | `import.meta.env.DEV` | HMR, usually under 150ms |
| Astro | the shared layout in `src/layouts/` | `import.meta.env.DEV` | full reload, fast |
| SvelteKit | `src/routes/+layout.svelte` | `import.meta.env.DEV` | HMR |
| Nuxt | a new `plugins/variate.client.ts` | `import.meta.dev` | HMR |
| Rails | `app/views/layouts/application.html.erb` | `Rails.env.development?` | reload |
| plain HTML | the page itself | none available | reload |

Notes that matter:

- **Vite**: the tag goes in the entry module, never `index.html`. `index.html`
  is the production template, and `import.meta.env.DEV` is statically replaced
  at build time so the block disappears from the bundle.
- **Astro**: `is:inline` is required, otherwise Astro takes ownership of the
  script and bundles it.
- **Next**: `process.env.NODE_ENV` is inlined by both webpack and Turbopack, so
  the branch is dead code in `next build`. `public/` is not processed by
  either, and the card is not served from there anyway.
- **No HMR** (plain HTML, most template stacks): the card detects that the page
  did not change within 900ms of a switch and reloads once. If the tab is in
  the background it waits until the user comes back rather than reloading
  behind them.
- **A strict CSP** can block the tag or the card's connection to the sidecar.
  Either add `http://127.0.0.1:*` to `script-src` and `connect-src` in dev, or
  keep working without the card: flipping also works from the terminal with
  `variate use <set> <n>`.
- **The card refuses to mount inside an iframe** unless the URL carries
  `?variate=frame`, so a page that embeds another page shows one card, not two.

## Placing the tag by hand

```html
<script src="http://127.0.0.1:PORT/v.js"></script>
```

`variate up` prints the exact URL with the port filled in. Put it just before
`</body>`, wrap it in whatever dev-only guard the stack offers, and bracket it
with `<!-- variate:begin -->` and `<!-- variate:end -->` so `variate end` can
find it again.
