# BRIEF playtest2-A2 — 13c: a dayless clock counts days (ruled set, lane A follow-on)

Lane id `playtest2-A2` · wave 2b · report `plans/REPORT-playtest2-A2-2026-11-04.md` · you are a `lane-supervisor`: read `.claude/guides/multi-agent.md` first, then `review.md` §2.

## Goal
Read `plans/REPORT-playtest2-A-2026-11-04.md` § ★13c — **Proposal A is accepted by the lead; build exactly it, clock-only.** Ruled (owner 2026-11-04): a dayless clock crossing midnight starts counting days (Day 1 → Day 2) the first time, instead of refusing. Build: SDK `sdk/src/storyTime.ts` — `advanceStoryTime` reads a month-less clock's day as a count (past midnight, and on a `days` step: `day = (day ?? 1) + n`; going back below Day 1 refused as today; a `months` step still refused); its start and result checks accept the count; `formatStoryTime` calendar branch gains the *Day 2, Year 1 AR, 02:00* form instead of dropping the day (free-form already reads *Year 1, Day 2, 02:00*); `compareStoryTimes` already orders it (absent month = 0). `'A day needs a month.'` (`storyTime.ts:412`) STAYS for every dated writer (history entries, amendments, placements): the relaxation is for the session clock only. Server: `src/lib/server/state/storyTime.ts` `clockColumns` keeps `day` when `month` is null for the clock; `clockProblem` accepts the count for the clock only (a person typing a day without a month into a dated field is still refused). Old dayless rows `{ year, hour }` read, format and sort exactly as today (test). Knock-ons: (b) the scenes `dayCrossed` trigger sees day null → 2 as crossed (wanted — test); (c) Back on such a move gives *Day 1, 22:00* (accepted). Docs: `docs/lorebook-time.md:116` (*A clock with a time of day but no date can't run past midnight…* → the new rule), `docs/genre-story.md` if it repeats it.
After the SDK edit: `pgrep -af "[v]ite dev"`; if none, `flock /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/sdk-build.lock npm run sdk:build` from the app root, then the app tests.

## Files owned (by name; re-read each immediately before editing — another programme edits `sdk/src` right now, not this file)
`../serene-pub-sdk/sdk/src/storyTime.ts`, its test under `../serene-pub-sdk/sdk-tests/` (run that single file through `sdk-tests/package.json`'s runner), `src/lib/server/state/storyTime.ts` + its tests, `src/lib/server/state/clockMoves.int.test.ts` (new cases only), `src/lib/server/scenes/boundaryWatcher.int.test.ts` (one dayCrossed case), `docs/lorebook-time.md`, `docs/genre-story.md` (one line if present).
NOT yours: `descriptors.ts`, `sceneSettings.ts` (lead), `NOMENCLATURE.md` (lead), `pipelines/runtime/host.ts` (lane A's drop block — leave it), anything on the M2e stay-out list.

## Files readable
Everything. NOMENCLATURE §9 story time rows, §1, §24; memory: compareDates is the ordering key (one comparator per calendar); `docs/lorebook-time.md`.

## Out of scope — never built
Alternative B (inventing a month); relaxing `:412` for dated writers; any calendar change; a setting.

## Stop and ask when
A stored clock row needs a migration (it should not: the columns exist); `compareStoryTimes` would need a change; a name is new; CLAUDE.md §Decisions applies.

## Done means
Green: the SDK storyTime test file (+ cases: midnight on a dayless clock → Day 2; a `days` step counts; below Day 1 refused; `months` refused; a dated writer with day-no-month still refused; old dayless value formats and sorts unchanged), `server/state/storyTime*.test.ts`, `clockMoves.int.test.ts` (+ the host-level midnight case), `boundaryWatcher.int.test.ts` (dayCrossed on null → 2).
## Standing rules for every playtest2 lane (verbatim from the lead)
- **Scope is the ruled set in § Rulings.** Every ruling there is final; nothing else is in scope. The M2e programme (`plans/PLAN-sdk-creation-seams-2026-10-30.md` §19) builds in the same trees right now: claim files by name, re-read before every edit, and never edit the stay-out list in § Build plan 2.
- **Names.** Before any new identifier, field, event key, label or error string: NOMENCLATURE §1 and §24, then your area's group section. No lane edits `NOMENCLATURE.md`: list every new or changed term in your report under **Canon rows needed** with the row text.
- **Stored data.** 0.6 is in users' hands: an additive field is fine only if every reader still works on rows that lack it (test that); anything else is a migration (`db:generate`, index above the highest applied) and a second-boot-changes-nothing test.
- **P1.** A new automatic behaviour is off in core until a genre opts in; every automatic action shows its cause on the line and how to switch it off.
- **Sockets.** One domain context per event family is the only listener and the only place that toasts. A `SCOPED_EVENTS` event carries its scope key in the payload. `socket.off(event, handler)` always with the handler.
- **DB.** Inside `db.transaction(async (tx) => …)` use only `tx`. Never seed a fixed id. No top-level await in `src/lib/server/db/index.ts`.
- **Workers.** `lane-worker` agents, at most 2 at once, briefs at `plans/briefs/BRIEF-playtest2-A2-w<n>.md`, each carrying the rules it needs inline plus the verbatim lines below. Check each worker's diff against its brief before accepting.
- **Tests.** Only the targeted test files under **Done means** (plus any you add). Never a full `npm test`, `npm run check`, `tsc` over the project, or `npm run sdk:test` whole. Run vitest as: `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run <files> > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest2-A2-<n>.log 2>&1; echo exit=$?'` then read the log. Never pipe vitest into `head`. An int test that opens a DB inside an `it` gets a 60 s timeout.
- **SDK edits** happen in `/home/jody/github/serene-pub-sdk`. If an app test needs the rebuilt dist: first `pgrep -af "vite dev"`; if none, `flock /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/sdk-build.lock npm run sdk:build` from the app root.
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Also never `git checkout`, `git restore` or `git clean` in either repo.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."*
- **Report** at the path above: Changed files (both repos) · Tests run, exact command, pass/fail counts · Stopped, needs owner · Canon rows needed · Queued for other lanes (file:line + exact text) · Noticed, not done. The harness may refuse the report write from a subagent; if so, put the full report text in your final hand-back and the lead saves it.
