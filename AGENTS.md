# Instructions for coding agents

This repo is an Agent Skill named `variate`: a section-by-section landing
page studio with a live local preview the user directs.

If your harness supports Agent Skills, read `SKILL.md`; it is the contract.

If not, you can still drive it: run

```
node scripts/start.mjs --ws <the user's project>/variate
```

and follow what it prints: it starts the studio server, tells the user the
URL, and gives you the exact `await.mjs` loop command. Read `SKILL.md` for
the loop rules and `references/recipes.md` for the craft contract before
fulfilling requests.

Never edit files under `requests/` directly, never edit or delete existing
`take-*.html` files (always land a new take), and never hand-edit
`site/manifest.json`: every mutation goes through `scripts/land.mjs`
(verbs: land, check, pick, discard, move, cut, page; it prints usage).
