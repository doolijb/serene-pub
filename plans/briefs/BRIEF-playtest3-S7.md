# BRIEF playtest3-S7 — a by-date compile creates nothing on any refusal; one day rule (lane S5's scope review)

Lane id `playtest3-S7` · wave 3b · report `plans/REPORT-playtest3-S7-2026-11-04.md` · you are a `lane-supervisor`: read `.claude/guides/multi-agent.md` first, then `review.md` §2, then `plans/REPORT-playtest3-S5-2026-11-04.md` (the by-date compile) and its scope-review findings 1–2 recorded at its tail.

## Goal
1. **No entry on a refusal.** `sockets/scenes.ts` `sceneCompileHandler` (~1117–1210, the `ByDate` branch) creates the dated entry (`historyEntryOfDate(…, { create: true })`, ~1191) and then falls into the entry path, which can still refuse: no `text->text` target (`resolveCapabilityTarget`, ~1354), the missing-sampling refusal (~1366), *That history entry is not on the line you are reading.* (~1272), the `startCompile` already-in-progress catch (~1397). Move every refusal the entry path can raise AHEAD of the creation (resolve the target and the sampling for both asks before the branch; the line check is already satisfied by construction for a by-date ask — say so or check it), so a refused compile creates nothing. Move the waiting-scenes pre-check (~1155–1185) inside the `tx`, under `lockBookCalendar`, so a concurrent Apply cannot file those scenes between the check and the creation. Tests: a book with no `text->text` target → refused, no entry made; a missing sampling → the same; the already-in-progress case → no second entry.
2. **One day rule.** `dayOnly` moves to `src/lib/shared/lorebooks/storyDate.ts` (re-exported from `scenes/historyEntryOfDate.ts` so its callers stand); the client's `sections/unfiledScenes.ts` `sceneDayOf` and `CompileHistoryEntryModal.svelte`'s `isAskedDay` call it instead of their own copies; `unfiledScenes.test.ts`'s "mirrors the server's dayOnly" case calls the one function.

## Files owned (by name; re-read each immediately before editing; Edit never Write)
`src/lib/server/sockets/scenes.ts` (the compile handler only), `src/lib/shared/lorebooks/storyDate.ts` (`dayOnly` added), `src/lib/server/scenes/historyEntryOfDate.ts` (re-export), `src/lib/client/lorebooks/sections/unfiledScenes.ts` (+ test), `src/lib/client/components/modals/CompileHistoryEntryModal.svelte` (`isAskedDay` only), `scenes.compileLine.int.test.ts`, tests beside each. NOT yours: `unfiledScenesByEntry.ts` beyond its import, `NOMENCLATURE.md`, `liveScenes.ts`.

## Files readable
Everything. NOMENCLATURE §9 and today's §25 S2–S6 rows (tail).

## Out of scope — never built
Changing the compile prompt or the review; creating the entry at Apply (★S5-2 ruled: at the press); any setting.

## Stop and ask when
A refusal cannot be moved ahead without duplicating a query the entry path already does (then say which and stop at the duplicate); a name is new; CLAUDE.md §Decisions applies.

## Done means
Green: `scenes.compileLine.int.test.ts` (+ the three no-entry cases), `unfiledScenes.test.ts` (calls `dayOnly`), the modal's DOM test, `historyEntryOfDate.int`, `unfiledScenesByEntry.int`.
## Standing rules for every playtest2 lane (verbatim from the lead)
- **Scope is the ruled set in § Rulings.** Every ruling there is final; nothing else is in scope. The M2e programme (`plans/PLAN-sdk-creation-seams-2026-10-30.md` §19) builds in the same trees right now: claim files by name, re-read before every edit, and never edit the stay-out list in § Build plan 2.
- **Names.** Before any new identifier, field, event key, label or error string: NOMENCLATURE §1 and §24, then your area's group section. No lane edits `NOMENCLATURE.md`: list every new or changed term in your report under **Canon rows needed** with the row text.
- **Stored data.** 0.6 is in users' hands: an additive field is fine only if every reader still works on rows that lack it (test that); anything else is a migration (`db:generate`, index above the highest applied) and a second-boot-changes-nothing test.
- **P1.** A new automatic behaviour is off in core until a genre opts in; every automatic action shows its cause on the line and how to switch it off.
- **Sockets.** One domain context per event family is the only listener and the only place that toasts. A `SCOPED_EVENTS` event carries its scope key in the payload. `socket.off(event, handler)` always with the handler.
- **DB.** Inside `db.transaction(async (tx) => …)` use only `tx`. Never seed a fixed id. No top-level await in `src/lib/server/db/index.ts`.
- **Workers.** `lane-worker` agents, at most 2 at once, briefs at `plans/briefs/BRIEF-playtest3-S7-w<n>.md`, each carrying the rules it needs inline plus the verbatim lines below. Check each worker's diff against its brief before accepting.
- **Tests.** Only the targeted test files under **Done means** (plus any you add). Never a full `npm test`, `npm run check`, `tsc` over the project, or `npm run sdk:test` whole. Run vitest as: `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run <files> > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest3-S7-<n>.log 2>&1; echo exit=$?'` then read the log. Never pipe vitest into `head`. An int test that opens a DB inside an `it` gets a 60 s timeout.
- **SDK edits** happen in `/home/jody/github/serene-pub-sdk`. If an app test needs the rebuilt dist: first `pgrep -af "vite dev"`; if none, `flock /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/sdk-build.lock npm run sdk:build` from the app root.
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Also never `git checkout`, `git restore` or `git clean` in either repo.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."*
- **Report** at the path above: Changed files (both repos) · Tests run, exact command, pass/fail counts · Stopped, needs owner · Canon rows needed · Queued for other lanes (file:line + exact text) · Noticed, not done. The harness may refuse the report write from a subagent; if so, put the full report text in your final hand-back and the lead saves it.
