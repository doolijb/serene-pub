# BRIEF playtest3-A4-w2 — tests: form-addressed dispatches in every genre; only the AI's answer halts

Lane `playtest3-A4` · worker 2 · supervisor reads your diff. Report in your final hand-back (no report file).

## What changed (worker 1, already on disk — read it, do not edit it)
`src/lib/server/pipelines/runtime/runTurn.ts`:
- `dispatchAddressedForms` (~1585-1660) no longer returns early when the genre lacks `forms.modelAnswers`: `core:event/form-addressed@1` is dispatched through `dispatchSessionEvent` in every genre, so every registration on it runs (R24: each its own run, in order — `sessionEvents.ts` `dispatchSessionEvent` ~779). `optedIn` now only gates the progress-card frame.
- The gate is the answer spec's door in `runSpecOnce` (~709-735): a child run (`request.lineage`) whose document holds a `core:outlet/answer-form` node, in a session whose genre does not opt in, returns `refusalReceipt(...)` (halt, `haltReason` = *"The AI does not answer forms in this genre: the genre does not opt in (forms.modelAnswers)."*) before its first node — no model call.
- Owner ruling (2026-11-04, P1): the opt-in gates the AI's ANSWER, never the event.

## Build — all in `src/lib/server/sockets/sessions.forms.int.test.ts`, describe `"P1 · the AI's form answer is off until the genre opts in"` (~687)
1. **The existing off test** (~688, "without forms.modelAnswers: no answer run, no model call, and a halted receipt says why"): keep every assertion (they still hold: `[`${askId}:ok`, "core:spec/story-answer-form:halt"]`, the reason, `parentRunId`). Retitle it to say the event still dispatches and the answer spec halts at its door before any model call. Nothing else.
2. **New test — off, a second registration still fires.** A fixture listener spec, e.g. `core:spec/test-<tag>-listen`, whose inlet is `C.formAddressed.v1()` with `{ genre: storyGenre, event: "core:event/form-addressed@1" }` and one outlet that writes something visible — first try `C.createMessage.v1({ narration: true, text: "A form was put to someone." })`. Publish it with `saveDocument(testDb as any, doc, { publish: true })` as `publishAskAndAnswer` does (~264-420). If `validate()`/publish refuses that outlet under the form-addressed inlet, pick the smallest core node that is allowed and still leaves an assertable result (the run row `ok` is the minimum), and say which in your report. Register it on the session, on top of the genre's defaults:
   ```ts
   const { register } = await import("@serene-pub/sdk")
   const { rowOfDecl } = await import("$lib/server/pipelines/registrations/rows")
   const { upsertRow } = await import("$lib/server/pipelines/registrations/write")
   await upsertRow(testDb as never, rowOfDecl(register("core:event/form-addressed@1", listenId), { kind: "session", sessionId: session.id }, "owner"))
   ```
   (pattern: `sessions.taskReckoning.int.test.ts` ~176-188; the registration cache is off under Vitest, but call `invalidateRegistrations()` from `registrations/resolve` if it is cheap). Then, with `modelAnswersOn = false` inside `try { … } finally { modelAnswersOn = true }` exactly as the existing off test does, fire the ask (`sessionWithTom(tag)`, `publishAskAndAnswer(tag, festival(`character:${tom}`))`, `fire(owner.id, { sessionId, action: `${askId}#${askFn}` })`). Assert:
   - `modelCalls - before === 0`;
   - `runsOf(session.id)` holds, **in any order after the ask's row** (registration order is not this test's subject — compare sorted lists or `expect.arrayContaining` + length): `${askId}:ok`, `core:spec/story-answer-form:halt` with the reason above, and `${listenId}:ok`;
   - the listener's run and the halted answer row both have `parentRunId === ` the ask run's `runId`;
   - if the listener writes a line, it landed (`schema.sessionMessages` for the session).
3. **New test — on, unchanged plus the listener.** Same fixture, `modelAnswersOn` left `true` (the file's default), `modelAnswer = '{"choice":"maybe"}'`. Assert `modelCalls - before === 1`; runs hold `${askId}:ok`, `core:spec/story-answer-form:ok`, `${answerId}:ok` (the click the answer fires, as the existing R-15 test at ~744 shows) and `${listenId}:ok`; the block reads answered by `character:${tom}` choice `maybe` (pattern ~818-824).
Use a fresh tag per test. Put the listener fixture in one small local helper inside that describe. An int test that opens a DB inside an `it` gets a 60 s timeout: pass `60_000` as the test's timeout if the file's other tests do not already set one globally (check the top of the file / `vi.setConfig`).

`src/lib/server/pipelines/runtime/formsModelAnswers.test.ts`: no change needed (it unit-tests `genreModelAnswersForms`, which did not change) — run it.

## Files owned (re-read immediately before editing; Edit, never Write)
- `/home/jody/github/serene-pub/src/lib/server/sockets/sessions.forms.int.test.ts`
- `/home/jody/github/serene-pub/src/lib/server/pipelines/runtime/formsModelAnswers.test.ts` (only if a change is truly needed — say why)

Never edit any other file — not `runTurn.ts` (if the code looks wrong, stop and report with the failing output), not `sessionEvents.ts`, `fireAction.ts`, `bindings.ts`, `host.ts`, `NOMENCLATURE.md`, nothing in `../serene-pub-sdk`. Other lanes (S7: `sockets/scenes.ts`, scene files) are editing the tree right now.

## Out of scope
Any production-code change; any new setting, name or payload field; tests of the press door (`fireAction.ts`'s `modelAnswersFormsHere`).

## Tests — run exactly these, nothing else (never `npm test`, never `tsc` over the project, never `npm run check`)
```
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run src/lib/server/sockets/sessions.forms.int.test.ts src/lib/server/pipelines/runtime/formsModelAnswers.test.ts src/lib/server/sockets/sessions.enabledWhen.int.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest3-A4-<n>.log 2>&1; echo exit=$?'
```
(`<n>` = 1, 2, … per run). Then read the log (grep for `✓|×|FAIL|Tests ` and the failure blocks). Never pipe vitest into `head`. One failure is known and pre-existing: the parked-action R-b case in `sessions.forms.int.test.ts` ("a grandchild parked at review releases the press…", ~843) — it may stay red; name it in your report with its error line. Any other red: fix your test if the test is wrong; if the code is wrong, stop and report.
Then `cd /home/jody/github/serene-pub && npx prettier --check src/lib/server/sockets/sessions.forms.int.test.ts` (report; if it already failed before your edits on lines you did not touch, say so).

## Hand back
The diff (`git diff -- <your files>`, read-only git), the exact test command(s), per-file pass/fail counts from the last log, the known R-b failure's error line, anything beyond this brief and why.

## Standing rules (verbatim from the lead)
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Also never `git checkout`, `git restore` or `git clean` in either repo.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (No SDK source changed; you need no `sdk:build`.)
- CLAUDE.md: never seed a row at a hardcoded id; inside `db.transaction(async (tx) => …)` use only `tx`; it is a **session**, never a *chat*.
