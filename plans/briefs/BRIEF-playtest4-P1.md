# BRIEF playtest4-P1 — the scene lists' two performance notes (build-3 code review)

Lane id `playtest4-P1` · wave 1 · report `plans/REPORT-playtest4-P1-2026-11-04.md` · you are a `lane-supervisor`: read `.claude/guides/multi-agent.md` first, then `review.md` §2, then `plans/REPORT-playtest3-S7-2026-11-04.md` and the plan's "Build 3 code review" line (the two perf findings).

## Goal
1. **One read per call for day → entry.** `scenes/unfiledScenesByEntry.ts` calls `historyEntryOfDate` once per (branch, day) group, and each call re-runs `lineOfBook` and re-reads every history entry; this runs on every `entries:list` relist (now sent after every scene write) for every reader. Refactor WITHOUT a second rule: extract from `historyEntryOfDate.ts` a pure picker (e.g. `pickEntryOfDate(rows, lineIds, date)` — the loop at ~73–84 over already-read rows) that `historyEntryOfDate` itself calls; `unfiledScenesByEntry` reads the book's history rows ONCE per call and resolves every group through the same picker. **The line is per scene, not per call:** the file's charter says a scene files "on the scene's own line" (`unfiledScenesByEntry.ts:3`, groups by each scene's `branchId` at ~60) — so call `lineOfBook` once per DISTINCT scene `branchId` (memoised within the call), keeping the per-branch `BranchRefusal` skip; never resolve every group on the viewer's line. Behaviour identical (the existing tests pin it; add two cases: a fixture with several groups gives the same map through both paths; a fork-only history entry dated the same day as a shared main-line scene, read from the fork, still files the main-line scene as today — the existing fork case at `unfiledScenesByEntry.int.test.ts:125–144` has no such entry).
2. **`sceneDisplayNames` linear.** `liveScenes.ts` ~673: `numbered.includes(s)` and a full `lanes.filter` per scene are quadratic over a whole-book list. Group scenes per (session, channel) lane, sort by `sceneStartOf`, number by a lower-bound search over the lane's sorted starts (position = 1 + the count of lane scenes whose start is STRICTLY earlier, `liveScenes.ts:667–671` — so two scenes sharing a start share a number, as today; a plain one-pass counter would give distinct numbers and change output); a Set for `numbered`. Same output (the existing `scenes.displayNames.int` cases pin it; add a 200-scene fixture case, with at least one tie of starts, asserting the same names as the old rule computed in the test).
3. **`sceneCauses` parallel.** ~989 awaits one `sessionSceneContext` per session in sequence; read them with `Promise.all` (bounded by the number of sessions; no new concurrency knob).
Docs: none.

## Files owned (by name; re-read each immediately before editing; Edit never Write)
`src/lib/server/scenes/unfiledScenesByEntry.ts` (+ int test), `src/lib/server/scenes/historyEntryOfDate.ts` (+ int test; the pure picker), `src/lib/server/scenes/liveScenes.ts` (`sceneDisplayNames`, `sceneCauses` only) + `sockets/scenes.displayNames.int.test.ts`, `scenes/sceneCauses.int.test.ts`, `sceneStartOf.test.ts` if touched. NOT yours: `sockets/scenes.ts` (lane S8 edits it this wave), `NOMENCLATURE.md`, the modal.

## Files readable
Everything. NOMENCLATURE §9 scene / history-entry rows and the 2026-11-04 S2–S7 rows (tail).

## Out of scope — never built
A cache; a setting; any change to what is listed or named; `relistEntries`' fan-out.

## Stop and ask when
The pure picker cannot reproduce `historyEntryOfDate`'s `create: true` path without duplicating it (keep creation in `historyEntryOfDate` only); a name beyond the picker's is new; CLAUDE.md §Decisions applies.

## Done means
Green: `unfiledScenesByEntry.int`, `historyEntryOfDate.int`, `scenes.displayNames.int`, `sceneCauses.int`, `scenes.compileLine.int`, `entries.unfiledSceneCount.int`, `lorebooks.unfiledScenesExport.int`, plus the equivalence cases above.
## Standing rules for every playtest2 lane (verbatim from the lead)
- **Scope is the ruled set in § Rulings.** Every ruling there is final; nothing else is in scope. The M2e programme (`plans/PLAN-sdk-creation-seams-2026-10-30.md` §19) builds in the same trees right now: claim files by name, re-read before every edit, and never edit the stay-out list in § Build plan 2.
- **Names.** Before any new identifier, field, event key, label or error string: NOMENCLATURE §1 and §24, then your area's group section. No lane edits `NOMENCLATURE.md`: list every new or changed term in your report under **Canon rows needed** with the row text.
- **Stored data.** 0.6 is in users' hands: an additive field is fine only if every reader still works on rows that lack it (test that); anything else is a migration (`db:generate`, index above the highest applied) and a second-boot-changes-nothing test.
- **P1.** A new automatic behaviour is off in core until a genre opts in; every automatic action shows its cause on the line and how to switch it off.
- **Sockets.** One domain context per event family is the only listener and the only place that toasts. A `SCOPED_EVENTS` event carries its scope key in the payload. `socket.off(event, handler)` always with the handler.
- **DB.** Inside `db.transaction(async (tx) => …)` use only `tx`. Never seed a fixed id. No top-level await in `src/lib/server/db/index.ts`.
- **Workers.** `lane-worker` agents, at most 2 at once, briefs at `plans/briefs/BRIEF-playtest4-P1-w<n>.md`, each carrying the rules it needs inline plus the verbatim lines below. Check each worker's diff against its brief before accepting.
- **Tests.** Only the targeted test files under **Done means** (plus any you add). Never a full `npm test`, `npm run check`, `tsc` over the project, or `npm run sdk:test` whole. Run vitest as: `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run <files> > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest4-P1-<n>.log 2>&1; echo exit=$?'` then read the log. Never pipe vitest into `head`. An int test that opens a DB inside an `it` gets a 60 s timeout.
- **SDK edits** happen in `/home/jody/github/serene-pub-sdk`. If an app test needs the rebuilt dist: first `pgrep -af "vite dev"`; if none, `flock /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/sdk-build.lock npm run sdk:build` from the app root.
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Also never `git checkout`, `git restore` or `git clean` in either repo.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."*
- **Report** at the path above: Changed files (both repos) · Tests run, exact command, pass/fail counts · Stopped, needs owner · Canon rows needed · Queued for other lanes (file:line + exact text) · Noticed, not done. The harness may refuse the report write from a subagent; if so, put the full report text in your final hand-back and the lead saves it.
