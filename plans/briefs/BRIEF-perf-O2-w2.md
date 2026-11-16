# BRIEF perf-O2-w2 — one seed-key read in `seedCoreScripts`

Supervisor: perf-O2 (lane brief `plans/briefs/BRIEF-perf-O2.md`). You are a lane-worker.

## Goal
`src/lib/server/pipelines/boot/seedScripts.ts` `seedCoreScripts` reads `pipeline_scripts` by `seed_key` once per entry of
`CORE_SCRIPTS` inside its loop (~`:58-62`). Make it **one** select of every core seed-key row before the loop
(`inArray(schema.pipelineScripts.seedKey, CORE_SCRIPTS.map((s) => s.seedKey))`, through `tx`), then look each one up in
memory (a `Map` by seed key). Same rows, same names, same results, same single transaction.

## Constraints
- Keep the per-script `pool` select (by `type_id`) exactly as it is: names depend on insertion order
  (`namesTakenBesides`/`shippedNameFor`), and a script inserted or renamed earlier in the loop changes the pool a later
  one sees.
- `seed_key` is unique (`schema.ts`, `pipeline_scripts.seed_key ... .unique()`). Confirm `CORE_SCRIPTS` seed keys are
  distinct (read `@serene-pub/core-catalog`'s `seed/scripts.ts` under `/home/jody/github/serene-pub-sdk/core-catalog/`,
  read-only, or count at runtime in a throwaway node check) — the prefetch is only equivalent when they are. State the
  result in your report. If they are not distinct, stop and report; do not change anything.
- Inside `db.transaction(async (tx) => …)` use only `tx` (the outer `db` deadlocks PGlite silently).
- Update the file's comments only where they describe the read; comment ratchet: say what the code does now; avoid
  "no longer", "used to", "previously", "deliberately not".
- Leave `scriptIdFor` alone.

## Files owned (edit only this)
`src/lib/server/pipelines/boot/seedScripts.ts` (and `seedScripts.int.test.ts` only if it breaks — it should not).

## Out of scope — never touch
Every other file. Another worker is editing `seed.ts`, `bootstrap.ts`, `named.ts`, `fit.ts`, `presetReconcile.ts`,
`contextTemplateFit.ts` right now. No SDK edit, no migration, no setting.

## Rules
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- **Do not run `prettier --write` at all.** `npx prettier --check <file>` only; fix only your own hunks by hand.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (No sdk:build is needed.)
- Never `git checkout`/`restore`/`stash` anything, in either repo.
- Int tests only inside `systemd-run --user --scope -p MemoryMax=6G --quiet npx vitest run <files>`; check
  `pgrep -af "vitest run"` first and wait if another run is up. Never pipe vitest into `head`; redirect to
  `/tmp/claude-1000/-home-jody-github-serene-pub/c46dc447-41a1-4f0c-98ce-0f42e7756232/scratchpad/perf-O2-w2.log`.

## Done means
- `src/lib/server/pipelines/boot/seedScripts.int.test.ts` green.
- `npx tsc --noEmit -p .` shows no error in `seedScripts.ts` (other files may be mid-edit by the other worker; report
  their errors separately, don't touch them).

## Report
Final message: the diff summary, the distinct-seed-key check, test result and log path, tsc result for your file.
