# BRIEF perf-E-w2 — scene-boundary watcher keeps running totals (lane perf-E step 6, review row F6)

Repository: /home/jody/github/serene-pub. Supervisor: lane perf-E.

**First:** `cd /home/jody/github/serene-pub && git status --short src/lib/server/scenes/boundaryWatcher.ts`. If it
prints anything (the peer session is editing it), make no edit and report "deferred: file in use". Re-run the same
check immediately before your first edit.

## Goal (verified by the supervisor at these lines on 2026-11-13)

1. `firedTriggers` (`src/lib/server/scenes/boundaryWatcher.ts` ~371) is called once per walked line from
   `sceneBoundariesOf` (~630). For the `length` trigger (~430–452) it re-reads the **content of every line from the
   scene's start to this line** each time — O(lines²) per walk. Keep the line count, token total and last line's
   tokens as running totals across the walk instead:
   - Before the loop, only when `ctx.settings.triggers.length` is set: one query for the content of live lines on the
     channel (`liveLinesWhere(sessionId, channel)`) with `id >= scene.start AND id < walked[0].id`, ordered by id →
     initial `n`, `total` (sum of `roughTokens`), `last` (roughTokens of the newest of them, as
     `before[n - 1]?.content`).
   - Pass that state into `firedTriggers` (replace the per-line query; same arithmetic: `lines && n > 0 && n % lines
     === 0`; `Math.floor(total / tokens) > Math.floor((total - last) / tokens)`).
   - After a line is evaluated: if `line.id >= scene.start`, add it (`n++`, `total += t`, `last = t`). When the walk
     resets the scene at that line (`scene = { start: line.id, … }` ~651), the new scene holds just that line:
     `n = 1, total = t, last = t`. Check carefully that the set counted equals today's query
     (`liveLinesWhere … id >= scene.start AND id < line.id`): the walked lines carry the same filter, so walked lines
     plus the pre-walk query are the same rows.
2. `judgedSceneCheckOf` (~1327) loads **every** live line id of the session (~1360–1367) to filter `id >(=) base`.
   Push the filter into SQL: a `count(*)` of live lines with `id >= base` (inclusive) or `id > base` for the
   `JUDGED_SCENE_MIN_LINES` check; then, after `from` is known, the ids of live lines with `id > from`, newest 20
   (`ORDER BY id DESC LIMIT 20`, reversed to ascending) — identical to `sinceBase.filter((id) => id > from).slice(-20)`.
   Same `why` strings, same returned shape.
3. `replayStoryLane` (`pipelines/routines/moments.ts` ~240) is **not** changed: it counts rounds from the session's
   first turn through the tally's own rule, so replaying from the anchor would change the round numbers. (Supervisor
   ruling for this lane; you only confirm it in the report.)

## Files owned

- `src/lib/server/scenes/boundaryWatcher.ts` — the two places above only.
- A new test beside it if you add one (e.g. `src/lib/server/scenes/boundaryWatcher.lengthTotals.int.test.ts`).

## Files readable

Everything under `src/lib/server/scenes/` and `pipelines/routines/moments.ts`; existing tests
`scenes/boundaryWatcher.int.test.ts`, `scenes/boundaryWatcher.genre.int.test.ts`, `scenes/sceneBoundaries.int.test.ts`,
`scenes/judgedSceneCue.int.test.ts` show the fixtures.

## Out of scope

Any other trigger, `moments.ts`, any other file under `scenes/` (the peer session edits several), any behaviour change.

## Done means

- Existing: `npx vitest run src/lib/server/scenes/boundaryWatcher.int.test.ts src/lib/server/scenes/boundaryWatcher.genre.int.test.ts src/lib/server/scenes/sceneBoundaries.int.test.ts src/lib/server/scenes/judgedSceneCue.int.test.ts` green (report counts; if one fails before your change too, say so with the failure).
- One targeted test: a `length` trigger (`lines` and, separately, `tokens`) over a walk that starts inside an
  already-open scene fires at exactly the lines today's code fires at (state the expected ids from the arithmetic),
  and the per-line content query is gone (e.g. count `sessionMessages` content selects with a spy, or assert by
  reading the code path — say which).
- `npx prettier --check` on changed files; filtered `tsc` clean.

## Rules you work under (quoted from the lane brief, CLAUDE.md and the multi-agent guide)

- **Owner 2026-11-13: change how often, never what.** Every job still processes the same rows in the same order; every response carries the same bytes and headers except where your step names a header it adds. If you find yourself changing an answer rather than how often it is computed, stop and say so in your report.
- **P1:** a cache is keyed so a stale answer is impossible, not merely unlikely. Name the key and its invalidation in your report.
- **Decisions (CLAUDE.md):** decide implementation inside the asked scope (structure, helpers, tests) and name each choice in your report. Do NOT add any user-facing name, setting, flag, event, table, migration or SDK change. Findings outside your step go under "Noticed, not done", never fixed in passing.
- Edit ONLY the files listed under "Files owned". Other uncommitted files in the tree belong to other lanes and a peer session: never touch them. Never `git checkout` / `git restore` / `git stash` in either repo.
- Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently.
- Never add a top-level `await` to `src/lib/server/db/index.ts`.
- `socket.off(event)` with no handler removes every listener app-wide; always pass the handler.
- It is a **session**, never a *chat*, in any new comment or string.
- `npx prettier --write <file>` only on your own files, by path; never on a directory.
- Typecheck: `cd /home/jody/github/serene-pub && npx tsc --noEmit -p . 2>&1 | grep -E "<your files>"` must print nothing for your files.
- Tests: `cd /home/jody/github/serene-pub && npx vitest run <file> [<file>…]` — targeted files only. No full `npm test`.

Verbatim (multi-agent guide / lane brief):
- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report "blocked on your dev server".
- Never pipe vitest into `head`. An int test that opens a DB inside an `it` needs a 60 s timeout. Image assets never in `/tmp`.
- Inside `db.transaction(async (tx) => …)` use only `tx`.

## Report (your final message)

Changed files; each design choice you made; tests run with exact pass/fail counts; `prettier --check` and filtered `tsc` results; anything you could not do and why; Noticed, not done.
