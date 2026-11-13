# BRIEF playtest2-T — the narrator's own turns: after the cast, every N rounds (item 7, ruled set)

Lane id `playtest2-T` · wave 3 (starts only when `plans/REPORT-m2e-D-2026-11-04.md` is filled in) · report `plans/REPORT-playtest2-T-2026-11-04.md` · you are a `lane-supervisor`: read `.claude/guides/multi-agent.md` first, then `review.md` §2.

## Goal
Plan `plans/PLAN-story-playtest-fixes-2026-11-03.md`: § Rulings (item 7), § Build plan 2 (lane T row), item 7 (lines 177–207). Ruled: the narrator takes turns by itself **after the cast, every N rounds** (rounds, not turns); **never a second reply under Next turn**; every automatic narrator turn shows its cause on the line (P1) and how to switch it off. Today: `NARRATOR_INTERJECTIONS_FIELD` is a boolean (`../serene-pub-sdk/core-catalog/src/registry/genres.ts:242-250`), turned into `"full"`/`"off"` at `core-catalog/src/factories/turnOrder.ts:71`. Build: the ONE control becomes the cadence choice **off · every round · every 2nd round · every 3rd round** (no position field — after the cast is ruled), one purpose sentence (P4), surfaced where the plan's item 7 says (`TurnPicker.svelte` / the Turn order widget) instead of buried; the turn-order factory places the narrator after the cast on the Nth round; old stored values read `true` → every round, `false` → off (settings JSON, no migration; test both). The line the narrator writes on its own turn says why (*Narrator's turn (every 2nd round)*) and the control is one press away.

## Files owned (by name; re-read each immediately before editing)
`../serene-pub-sdk/core-catalog/src/registry/genres.ts` (that field only), `../serene-pub-sdk/core-catalog/src/factories/turnOrder.ts`, the SDK test for it (run through `sdk-tests`' runner, one file), the server turn-order reader of that setting (name it), `TurnPicker.svelte` / the Turn order widget's control, `docs/sessions.md` § Turn order, `docs/genre-story.md`, tests beside each.
NOT yours: `sessions/settingsForm.ts` (the derived form draws the choice from the declaration — if it needs a change, queue it), `NOMENCLATURE.md` (lead), `sockets/sessions.ts`.

## Files readable
Everything. NOMENCLATURE §9 (turn order, narrator asides rows), §1, §24; `docs/sessions.md`; memory: who speaks = turn order as state (one decider).

## Out of scope
A position choice; a per-character cadence; a second reply under Next turn; any new setting beyond re-shaping this one.

## Stop and ask when
The cadence cannot be expressed in the existing field's declaration without a new field kind; a name is new; CLAUDE.md §Decisions applies.

## Done means
Green: the turnOrder SDK test file, the server turn-order tests, the TurnPicker DOM test, and new cases: every 2nd round places the narrator after the cast on rounds 2, 4…; off places none; `true` reads as every round; Next turn never yields two replies; the narrator's own line carries its cause.
## Standing rules for every playtest2 lane (verbatim from the lead)
- **Scope is the ruled set in § Rulings.** Every ruling there is final; nothing else is in scope. The M2e programme (`plans/PLAN-sdk-creation-seams-2026-10-30.md` §19) builds in the same trees right now: claim files by name, re-read before every edit, and never edit the stay-out list in § Build plan 2.
- **Names.** Before any new identifier, field, event key, label or error string: NOMENCLATURE §1 and §24, then your area's group section. No lane edits `NOMENCLATURE.md`: list every new or changed term in your report under **Canon rows needed** with the row text.
- **Stored data.** 0.6 is in users' hands: an additive field is fine only if every reader still works on rows that lack it (test that); anything else is a migration (`db:generate`, index above the highest applied) and a second-boot-changes-nothing test.
- **P1.** A new automatic behaviour is off in core until a genre opts in; every automatic action shows its cause on the line and how to switch it off.
- **Sockets.** One domain context per event family is the only listener and the only place that toasts. A `SCOPED_EVENTS` event carries its scope key in the payload. `socket.off(event, handler)` always with the handler.
- **DB.** Inside `db.transaction(async (tx) => …)` use only `tx`. Never seed a fixed id. No top-level await in `src/lib/server/db/index.ts`.
- **Workers.** `lane-worker` agents, at most 2 at once, briefs at `plans/briefs/BRIEF-playtest2-T-w<n>.md`, each carrying the rules it needs inline plus the verbatim lines below. Check each worker's diff against its brief before accepting.
- **Tests.** Only the targeted test files under **Done means** (plus any you add). Never a full `npm test`, `npm run check`, `tsc` over the project, or `npm run sdk:test` whole. Run vitest as: `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run <files> > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest2-T-<n>.log 2>&1; echo exit=$?'` then read the log. Never pipe vitest into `head`. An int test that opens a DB inside an `it` gets a 60 s timeout.
- **SDK edits** happen in `/home/jody/github/serene-pub-sdk`. If an app test needs the rebuilt dist: first `pgrep -af "vite dev"`; if none, `flock /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/sdk-build.lock npm run sdk:build` from the app root.
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Also never `git checkout`, `git restore` or `git clean` in either repo.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."*
- **Report** at the path above: Changed files (both repos) · Tests run, exact command, pass/fail counts · Stopped, needs owner · Canon rows needed · Queued for other lanes (file:line + exact text) · Noticed, not done. The harness may refuse the report write from a subagent; if so, put the full report text in your final hand-back and the lead saves it.
