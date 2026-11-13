# BRIEF playtest3-A4 — the form-answer gate stops only the AI's answer, never the event (build-3 code review)

Lane id `playtest3-A4` · wave 3c · report `plans/REPORT-playtest3-A4-2026-11-04.md` · you are a `lane-supervisor`: read `.claude/guides/multi-agent.md` first, then `review.md` §2, then `plans/REPORT-playtest2-A-2026-11-04.md` § Built item 6 (the `forms.modelAnswers` gate) and the SDK's `INTEGRATING.md` forms-dispatch step (~402).

## Goal
`pipelines/runtime/runTurn.ts` `dispatchAddressedForms` (~1557-1575) returns before `dispatchSessionEvent` when the genre does not opt into `forms.modelAnswers`, so EVERY registration on `core:event/form-addressed@1` is suppressed — a plugin's or routine's listener (logging, notifying, routing) that used to fire on each addressed form never does. The ruling gates the AI's ANSWER, not the event. Build: the event is dispatched as before in every genre; what the gate stops is core's answer registration — the routed answer spec (`core:spec/*-answer-form`) gets the halted `refusalReceipt` with `MODEL_ANSWERS_OFF_REASON` instead of running, while any other registration on the event runs. Find the smallest seam: a flag on the dispatch (the event payload or the dispatch options) that the core answer binding reads and refuses on, or the answer spec's own door (`fireAction`'s / `runSpec`'s pre-run check) consulting `genreModelAnswersForms`. One rule (R1): `genreModelAnswersForms` stays the only reader of the shape field. Update `INTEGRATING.md`'s sentence (lead applied one on 11-04; correct it: the event always dispatches, core's answer spec halts without opt-in). Tests: `sessions.forms.int` (the off case: a second registration on `form-addressed` still fires; the answer spec halts with the reason; the on case unchanged), `formsModelAnswers.test`.

## Files owned (by name; re-read each immediately before editing; Edit never Write)
`src/lib/server/pipelines/runtime/runTurn.ts` (`dispatchAddressedForms`), the core answer binding's door you choose (`pipelines/runtime/bindings.ts` for `*-answer-form`, or `fireAction.ts`'s pre-run check — name it), `../serene-pub-sdk/INTEGRATING.md` (the one sentence, ~402), tests `sessions.forms.int.test.ts`, `formsModelAnswers.test.ts`. NOT yours: `fireAction.ts`'s press door (`modelAnswersFormsHere`, the lead's), `NOMENCLATURE.md`, the SDK's `sdk/src`.

## Files readable
Everything. NOMENCLATURE §9 forms rows + today's lane-A §25 row; `docs/pipelines.md` forms paragraph.

## Out of scope — never built
Any change to who may answer a form (the press door); a setting; the ★A3 cause mark.

## Stop and ask when
No seam exists without a new published field on the event payload (then propose the name, build 🚧, and say so); CLAUDE.md §Decisions applies.

## Done means
Green: `sessions.forms.int.test.ts` (the pre-existing parked-action R-b failure may stay; name it), `formsModelAnswers.test.ts`, `sessions.enabledWhen.int.test.ts`, plus the new case: a second `form-addressed` registration fires in a genre without `forms.modelAnswers`.
## Standing rules for every playtest2 lane (verbatim from the lead)
- **Scope is the ruled set in § Rulings.** Every ruling there is final; nothing else is in scope. The M2e programme (`plans/PLAN-sdk-creation-seams-2026-10-30.md` §19) builds in the same trees right now: claim files by name, re-read before every edit, and never edit the stay-out list in § Build plan 2.
- **Names.** Before any new identifier, field, event key, label or error string: NOMENCLATURE §1 and §24, then your area's group section. No lane edits `NOMENCLATURE.md`: list every new or changed term in your report under **Canon rows needed** with the row text.
- **Stored data.** 0.6 is in users' hands: an additive field is fine only if every reader still works on rows that lack it (test that); anything else is a migration (`db:generate`, index above the highest applied) and a second-boot-changes-nothing test.
- **P1.** A new automatic behaviour is off in core until a genre opts in; every automatic action shows its cause on the line and how to switch it off.
- **Sockets.** One domain context per event family is the only listener and the only place that toasts. A `SCOPED_EVENTS` event carries its scope key in the payload. `socket.off(event, handler)` always with the handler.
- **DB.** Inside `db.transaction(async (tx) => …)` use only `tx`. Never seed a fixed id. No top-level await in `src/lib/server/db/index.ts`.
- **Workers.** `lane-worker` agents, at most 2 at once, briefs at `plans/briefs/BRIEF-playtest3-A4-w<n>.md`, each carrying the rules it needs inline plus the verbatim lines below. Check each worker's diff against its brief before accepting.
- **Tests.** Only the targeted test files under **Done means** (plus any you add). Never a full `npm test`, `npm run check`, `tsc` over the project, or `npm run sdk:test` whole. Run vitest as: `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run <files> > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest3-A4-<n>.log 2>&1; echo exit=$?'` then read the log. Never pipe vitest into `head`. An int test that opens a DB inside an `it` gets a 60 s timeout.
- **SDK edits** happen in `/home/jody/github/serene-pub-sdk`. If an app test needs the rebuilt dist: first `pgrep -af "vite dev"`; if none, `flock /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/sdk-build.lock npm run sdk:build` from the app root.
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Also never `git checkout`, `git restore` or `git clean` in either repo.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."*
- **Report** at the path above: Changed files (both repos) · Tests run, exact command, pass/fail counts · Stopped, needs owner · Canon rows needed · Queued for other lanes (file:line + exact text) · Noticed, not done. The harness may refuse the report write from a subagent; if so, put the full report text in your final hand-back and the lead saves it.
