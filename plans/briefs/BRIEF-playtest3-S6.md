# BRIEF playtest3-S6 — the Chronicle lists the Not yet compiled scenes too (★S2-1b)

Lane id `playtest3-S6` · wave 3 (after lane T2's report: it owns `sdk/src/widgets.ts` until then) · report `plans/REPORT-playtest3-S6-2026-11-04.md` · you are a `lane-supervisor`: read `.claude/guides/multi-agent.md` first, then `review.md` §2.

## Goal
Owner (2026-11-04): the Chronicle widget shows a *Not yet compiled* section under **Now**: the session's unfiled scenes grouped by date, each date with the same **Compile** lane S5 built for the History lens (compile by date creates the dated entry). Read `plans/REPORT-playtest3-S5-2026-11-04.md` first (the by-date compile ask, the group's shape and copy — reuse both; one rule, `unfiledScenesByEntry`). Build: `HistoryEntriesV1` (`../serene-pub-sdk/sdk/src/widgets.ts` ~2389) gains one optional field 🚧 `unfiledScenes?: Array<{ date, scenes[] }>` (name per §24; additive); the server's history-entries projection for the session (`requests/historyEntries.ts`'s source, name it) fills it for the session's line; the Chronicle component (`core-catalog/components/**/HistoryEntries*.svelte` — name it) draws the section under Now with a **Compile** per date that sends S5's by-date ask; docs `docs/sessions.md` (the Chronicle paragraph) + the widget guide if generated.

## Files owned (by name; re-read each immediately before editing)
`../serene-pub-sdk/sdk/src/widgets.ts` (the one field), the Chronicle component + its `sdk-tests` test, the server projection file that builds `HistoryEntriesV1` for a session, `src/lib/client/components/sessionPage/requests/historyEntries.ts` (if it carries the request), `docs/sessions.md` (the Chronicle paragraph), tests beside each. `sdk:build` only when `pgrep -af "[v]ite dev"` shows no serene-pub server, under the flock. NOT yours: `sockets/scenes.ts`, the History lens (S5's), `NOMENCLATURE.md`.

## Files readable
Everything. NOMENCLATURE §9 (Chronicle row), §16 widget contracts, §1, §24; today's §25 rows; STYLE-GUIDE §6 lists.

## Out of scope — never built
A second compile rule; a setting; changing what Now lists for filed scenes.

## Stop and ask when
`HistoryEntriesV1` cannot take the field additively; the projection has no access to the session's line; a name beyond the field's is new; CLAUDE.md §Decisions applies.

## Done means
Green: the Chronicle's SDK test (+ the section renders by date and its Compile sends the by-date ask), the projection's test (+ a session's unfiled scenes listed by date; filed ones not), `historyEntries` request tests.
## Standing rules for every playtest2 lane (verbatim from the lead)
- **Scope is the ruled set in § Rulings.** Every ruling there is final; nothing else is in scope. The M2e programme (`plans/PLAN-sdk-creation-seams-2026-10-30.md` §19) builds in the same trees right now: claim files by name, re-read before every edit, and never edit the stay-out list in § Build plan 2.
- **Names.** Before any new identifier, field, event key, label or error string: NOMENCLATURE §1 and §24, then your area's group section. No lane edits `NOMENCLATURE.md`: list every new or changed term in your report under **Canon rows needed** with the row text.
- **Stored data.** 0.6 is in users' hands: an additive field is fine only if every reader still works on rows that lack it (test that); anything else is a migration (`db:generate`, index above the highest applied) and a second-boot-changes-nothing test.
- **P1.** A new automatic behaviour is off in core until a genre opts in; every automatic action shows its cause on the line and how to switch it off.
- **Sockets.** One domain context per event family is the only listener and the only place that toasts. A `SCOPED_EVENTS` event carries its scope key in the payload. `socket.off(event, handler)` always with the handler.
- **DB.** Inside `db.transaction(async (tx) => …)` use only `tx`. Never seed a fixed id. No top-level await in `src/lib/server/db/index.ts`.
- **Workers.** `lane-worker` agents, at most 2 at once, briefs at `plans/briefs/BRIEF-playtest3-S6-w<n>.md`, each carrying the rules it needs inline plus the verbatim lines below. Check each worker's diff against its brief before accepting.
- **Tests.** Only the targeted test files under **Done means** (plus any you add). Never a full `npm test`, `npm run check`, `tsc` over the project, or `npm run sdk:test` whole. Run vitest as: `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run <files> > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest3-S6-<n>.log 2>&1; echo exit=$?'` then read the log. Never pipe vitest into `head`. An int test that opens a DB inside an `it` gets a 60 s timeout.
- **SDK edits** happen in `/home/jody/github/serene-pub-sdk`. If an app test needs the rebuilt dist: first `pgrep -af "vite dev"`; if none, `flock /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/sdk-build.lock npm run sdk:build` from the app root.
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Also never `git checkout`, `git restore` or `git clean` in either repo.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."*
- **Report** at the path above: Changed files (both repos) · Tests run, exact command, pass/fail counts · Stopped, needs owner · Canon rows needed · Queued for other lanes (file:line + exact text) · Noticed, not done. The harness may refuse the report write from a subagent; if so, put the full report text in your final hand-back and the lead saves it.
