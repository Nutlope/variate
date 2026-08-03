# Instructions for coding agents

variate puts four design variations of one of the user's files on their own
dev server, behind a small card at the bottom of the page. If your harness
supports Agent Skills, read `SKILL.md`: it is the contract, and this file is a
summary of it.

If not, you can drive the whole thing from here.

```bash
node <this-dir>/variate.mjs up   --root <the user's project>
node <this-dir>/variate.mjs add  <a file to vary> [--n 4]
node <this-dir>/variate.mjs check <set>
node <this-dir>/variate.mjs use  <set> <n>
node <this-dir>/variate.mjs end  [<set>]
node <this-dir>/variate.mjs drain --root <project> [--ack <id> --note "..."]
```

Each command prints an aligned block telling you what happened and what to run
next. Exit codes: **0** did it, **1** error, **2** nothing to do, **3** the
user has to act.

If `up` exits **3**, a sandbox would not let it start the on-page card. That
is not a failure: `add`, `check`, `use`, `status` and `end` all still work, and
the user sees each switch by reloading their page. Carry on.

After the user picks one: extend the same set to refine it (write the next
numbered file and append to `plan.json`), `add` another file to vary something
else, or `end` to finish. One file, one set: if `add` says the file is already
varied, extend that set instead.

The model: a set is one target file plus N alternatives in
`.variate/<set>/`. Variant 1 is the user's file as it was. You write
`plan.json` (one short direction per position) and then `2.<ext>`, `3`, `4`.
Switching copies a variant over the target file; the user's own dev server
re-renders it.

Rules that matter most:

1. Never edit or delete variant 1, and never write the target file directly
   while a set is open. Write a variant and switch to it.
2. Every variant is a complete, drop-in replacement for the target: same
   exports, same props, only dependencies already in the project, and it must
   compile.
3. Use the project's own tokens, components, and copy. A variant that invents
   a colour or adds a dependency has failed.
4. Four variants, structurally different. Write `plan.json` first.
5. Talk to the user in positions ("2 of 4"), never filenames.
6. Ask one question per round, with your recommendation, then wait.
7. Read `references/craft.md` before drafting and `references/frameworks.md`
   if the tag needs placing by hand.
