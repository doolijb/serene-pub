# BRIEF playtest2-S4 — file the day's scenes when the compile review is applied; keep the Compile gate fresh (lane S3 follow-on)

Lane id `playtest2-S4` · wave 3c · report `plans/REPORT-playtest2-S4-2026-11-04.md` · you are a `lane-supervisor`: read `.claude/guides/multi-agent.md` first, then `review.md` §2.

## Goal
Read `plans/REPORT-playtest2-S3-2026-11-04.md` § ★S3-1 (the lead accepted its recommendation; build exactly it) and § Noticed. Build:
1. **Filing at Apply.** The compile handler (`sockets/scenes.ts`, the block S2 added ~1145–1185) stops filing the day's unfiled scenes at the press; it still feeds the model those scenes (read in memory) and keeps their ids on the compile activity (`CompileHistoryEntryActivity.sceneIds?: number[]`, `utils/activityStore.ts`, memory only, never persisted). `activityStore.remove(id, "acted")` for a `compile_history_entry` activity calls a hook, 🚧 `setCompileReviewApplied`, wired once from `scenes.ts` the way `setSceneReviewDiscarded` is (`activityStore.ts` ~745–760); the hook files those ids under the entry in one `tx` under `lockBookCalendar`, guarded by `isNull(scenes.historyEntryId)`, and re-sends `scenes:listByLorebook`. A discard or lapse files nothing. `docs/lorebook-time.md` ~:23: *they are filed under it when you apply the changes; discarding leaves them not yet compiled.*
2. **The gate stays fresh.** Call `relistEntries(socket, lorebookId, HISTORY_TYPE_ID, emitToUser)` (`sockets/entries.ts` ~501) after scene create, delete and open, and after the filing in 1, so `unfiledSceneCount` follows; no new event.
Tests: `scenes.compileLine.int` (a compile followed by `acted` files the scenes; followed by a discard leaves them unfiled; a lost dismiss leaves them unfiled and a second compile reads them again), `activityStore` tests for the hook, `scenes.live.int` / the scene socket tests for the re-list, `entries.unfiledSceneCount.int` (the count drops to 0 after filing).

## Files owned (by name; re-read each immediately before editing)
`src/lib/server/sockets/scenes.ts` (the compile handler, the hook wiring, the re-list calls), `src/lib/server/utils/activityStore.ts` (the `sceneIds?` field on the compile activity record and the `acted` hook only), `docs/lorebook-time.md` (the one sentence), tests beside each. NOT yours: `CompileHistoryEntryModal.svelte`, `entries.ts` beyond calling `relistEntries`, `shared/sockets/types.ts`, `NOMENCLATURE.md`, the M2e stay-out list.

## Files readable
Everything. NOMENCLATURE §9 scene/history rows and today's §25 S2/S3 rows (tail); `docs/lorebook-time.md`.

## Out of scope — never built
S-B2 (the *Not yet compiled* group, compile-by-date); the entry id on `SceneWithMeta`; carrying ids on `entries:update` or the amendment event; any setting.

## Stop and ask when
The `acted` dismiss is not sent on one of the three save paths (then say which and stop); a name beyond `setCompileReviewApplied` / `sceneIds` is new; CLAUDE.md §Decisions applies.

## Done means
Green: `scenes.compileLine.int.test.ts`, `scenes.live.int.test.ts`, `scenes.displayNames.int.test.ts`, `entries.unfiledSceneCount.int.test.ts`, the `activityStore*` tests, plus the new cases above.
## Standing rules for every playtest2 lane (verbatim from the lead)
- **Scope is the ruled set in § Rulings.** Every ruling there is final; nothing else is in scope. The M2e programme (`plans/PLAN-sdk-creation-seams-2026-10-30.md` §19) builds in the same trees right now: claim files by name, re-read before every edit, and never edit the stay-out list in § Build plan 2.
- **Names.** Before any new identifier, field, event key, label or error string: NOMENCLATURE §1 and §24, then your area's group section. No lane edits `NOMENCLATURE.md`: list every new or changed term in your report under **Canon rows needed** with the row text.
- **Stored data.** 0.6 is in users' hands: an additive field is fine only if every reader still works on rows that lack it (test that); anything else is a migration (`db:generate`, index above the highest applied) and a second-boot-changes-nothing test.
- **P1.** A new automatic behaviour is off in core until a genre opts in; every automatic action shows its cause on the line and how to switch it off.
- **Sockets.** One domain context per event family is the only listener and the only place that toasts. A `SCOPED_EVENTS` event carries its scope key in the payload. `socket.off(event, handler)` always with the handler.
- **DB.** Inside `db.transaction(async (tx) => …)` use only `tx`. Never seed a fixed id. No top-level await in `src/lib/server/db/index.ts`.
- **Workers.** `lane-worker` agents, at most 2 at once, briefs at `plans/briefs/BRIEF-playtest2-S4-w<n>.md`, each carrying the rules it needs inline plus the verbatim lines below. Check each worker's diff against its brief before accepting.
- **Tests.** Only the targeted test files under **Done means** (plus any you add). Never a full `npm test`, `npm run check`, `tsc` over the project, or `npm run sdk:test` whole. Run vitest as: `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run <files> > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest2-S4-<n>.log 2>&1; echo exit=$?'` then read the log. Never pipe vitest into `head`. An int test that opens a DB inside an `it` gets a 60 s timeout.
- **SDK edits** happen in `/home/jody/github/serene-pub-sdk`. If an app test needs the rebuilt dist: first `pgrep -af "vite dev"`; if none, `flock /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/sdk-build.lock npm run sdk:build` from the app root.
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Also never `git checkout`, `git restore` or `git clean` in either repo.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."*
- **Report** at the path above: Changed files (both repos) · Tests run, exact command, pass/fail counts · Stopped, needs owner · Canon rows needed · Queued for other lanes (file:line + exact text) · Noticed, not done. The harness may refuse the report write from a subagent; if so, put the full report text in your final hand-back and the lead saves it.
