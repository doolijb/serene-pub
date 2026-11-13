# BRIEF playtest4-C4 — the connection fold never collides on a unique key (build-2 code review, recorded)

Lane id `playtest4-C4` · wave 2 · report `plans/REPORT-playtest4-C4-2026-11-04.md` · you are a `lane-supervisor`: read `.claude/guides/multi-agent.md` first, then `review.md` §2, then `plans/REPORT-playtest2-C-2026-11-04.md` (`foldConnectionInto`) and the plan's "Code review over the landed lanes" line (the fold hazard).

## Goal
`connections/connectionFold.ts` repoints every FK into `connections.id` / `connection_models.id` with a blind UPDATE; only `connection_scripts` gets a duplicate-pair pre-delete (~95–106). A table whose unique key includes the connection (or model) id — e.g. `logit_bias_tokens` on (model, fingerprint, text) — collides when source and target both hold the pair; the fold transaction rolls back, `ensureLocalOnnxConnections` logs and leaves the duplicate row, and the managed-KoboldCPP fold fails the same way. Build: generalise the pre-delete — introspect each referencing table's UNIQUE indexes/constraints (Drizzle's table config, the way `referencesTo` introspects FKs); for each unique key that includes the repointed column, delete the source's rows whose other key columns match a target row before the UPDATE (the target's row wins, as `connection_scripts` does today); the `connection_scripts` special case becomes one instance of the rule. drizzle-orm's `getTableConfig` (pg-core) returns `indexes` (each `config.unique`, `columns` — a column with `.name` or a SQL expression — and an optional `where`) and `uniqueConstraints`; today the two keys that include the repointed id are `logit_bias_tokens_lookup` and `connection_scripts_pair_idx`. A unique index whose columns include a SQL expression, or that has a `where`, is NOT guessed at: skip it with a dev-time warning naming the table (none exists today; the test asserts the warning path on a fake table config). Tests (`connectionFold.int` or beside `localOnnxConnections.int`): two rows each holding a `logit_bias_tokens`-style pair on the same (fingerprint, text) fold without error and the target keeps one; a table with no unique key folds as before; the KoboldCPP managed fold test still green.

## Files owned (by name; re-read each immediately before editing; Edit never Write)
`src/lib/server/connections/connectionFold.ts` + its test(s), `src/lib/server/connections/koboldCppManagedFold.int.test.ts` (run only). NOT yours: `koboldCppManagedFold.ts`, `localOnnxConnections.ts`, `schema.ts`, `NOMENCLATURE.md`.

## Files readable
Everything. NOMENCLATURE §10 (fold rows, 2026-11-04 lane C row); memory: inside `db.transaction` use only `tx`.

## Out of scope — never built
Merging the colliding rows' values (the target's wins); a setting; schema changes.

## Stop and ask when
Drizzle's table config does not expose unique indexes for a table that needs it (then propose a static list of the tables with such keys and stop); a name is new; CLAUDE.md §Decisions applies.

## Done means
Green: the fold tests (+ the collision case), `koboldCppManagedFold.int`, `localOnnxConnections.int`.
## Standing rules for every playtest2 lane (verbatim from the lead)
- **Scope is the ruled set in § Rulings.** Every ruling there is final; nothing else is in scope. The M2e programme (`plans/PLAN-sdk-creation-seams-2026-10-30.md` §19) builds in the same trees right now: claim files by name, re-read before every edit, and never edit the stay-out list in § Build plan 2.
- **Names.** Before any new identifier, field, event key, label or error string: NOMENCLATURE §1 and §24, then your area's group section. No lane edits `NOMENCLATURE.md`: list every new or changed term in your report under **Canon rows needed** with the row text.
- **Stored data.** 0.6 is in users' hands: an additive field is fine only if every reader still works on rows that lack it (test that); anything else is a migration (`db:generate`, index above the highest applied) and a second-boot-changes-nothing test.
- **P1.** A new automatic behaviour is off in core until a genre opts in; every automatic action shows its cause on the line and how to switch it off.
- **Sockets.** One domain context per event family is the only listener and the only place that toasts. A `SCOPED_EVENTS` event carries its scope key in the payload. `socket.off(event, handler)` always with the handler.
- **DB.** Inside `db.transaction(async (tx) => …)` use only `tx`. Never seed a fixed id. No top-level await in `src/lib/server/db/index.ts`.
- **Workers.** `lane-worker` agents, at most 2 at once, briefs at `plans/briefs/BRIEF-playtest4-C4-w<n>.md`, each carrying the rules it needs inline plus the verbatim lines below. Check each worker's diff against its brief before accepting.
- **Tests.** Only the targeted test files under **Done means** (plus any you add). Never a full `npm test`, `npm run check`, `tsc` over the project, or `npm run sdk:test` whole. Run vitest as: `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run <files> > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest4-C4-<n>.log 2>&1; echo exit=$?'` then read the log. Never pipe vitest into `head`. An int test that opens a DB inside an `it` gets a 60 s timeout.
- **SDK edits** happen in `/home/jody/github/serene-pub-sdk`. If an app test needs the rebuilt dist: first `pgrep -af "vite dev"`; if none, `flock /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/sdk-build.lock npm run sdk:build` from the app root.
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Also never `git checkout`, `git restore` or `git clean` in either repo.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."*
- **Report** at the path above: Changed files (both repos) · Tests run, exact command, pass/fail counts · Stopped, needs owner · Canon rows needed · Queued for other lanes (file:line + exact text) · Noticed, not done. The harness may refuse the report write from a subagent; if so, put the full report text in your final hand-back and the lead saves it.
