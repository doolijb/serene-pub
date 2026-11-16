# BRIEF — `sense-sumset` worker 1 — one place decides: the scene context reads the routine's mode

You are a `lane-worker` in build lane `sense-sumset` (Serene Pub, app repo `/home/jody/github/serene-pub`). Your
supervisor read the rules; the ones your work depends on are quoted here. Line numbers are from 2026-11-13:
re-read before editing. Report as your final message (changed files, tests run with results, decisions you made,
anything you could not do, **Noticed, not done**).

## Verbatim rules

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (This lane runs **no** `sdk:build` at all.)
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo. Never `kill -9`
  anything. Inside `db.transaction(async (tx) => …)` use only `tx`. It is a **session**, never a *chat* (Chat is
  only a genre's name). Every session has a lorebook: never write "no lorebook". No reference to any other project
  or product in code, comments, tests or docs. "Compile" is never used for scene summaries.
- Comments state the rule, not the story: `src/lib/shared/conformance/commentHistory.test.ts` fails on phrases such
  as "no longer", "used to", "deliberately not", "now" as history. Write "X does Y", never "X now does Y / no longer Z".
- Run only your targeted test files, one run at a time, in a capped scope:
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files> > <log> 2>&1"`
  with the log under `/tmp/claude-1000/-home-jody-github-serene-pub/c4d03dff-b9b2-4178-92cd-10084eb4de8b/scratchpad/sense-sumset-w1-*.log`.
  An int test that opens a DB inside an `it` needs a 60 s timeout. Never pipe vitest into `head`. Typecheck:
  `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .`. `npx prettier --check <file>` on each file you
  changed (report drift in files that were already unformatted; do not reformat whole files you barely touched).
  Do not start a dev server.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
- Known unrelated failing tests (not yours): speech-related expectations in `sessions/genreFieldDefaults.int`,
  `pipelines/entities/publishedValues.int`, `pipelines/entities/sessionGenres.int`,
  `sockets/sessionAdmin.presetActions.int`, `db/dataUpgrades/0108_layering_registrations.int`,
  `pipelines/boot/paramsSlotWiring.test`. Other uncommitted work is in the tree: leave it alone.

## The owner's rulings (2026-11-12, 2026-11-13)

A session **has the routine** when its effective registrations hold a routine whose pipeline is
`core:spec/scene-summaries` (*Summarize finished scenes*; per session: a preset or a session row that drops it means
it does not; a routine set **Off** still counts as had). For such a session the stored **Summaries** value
(`metadata.scenes.summary`: On close / On request / Never) is not read anywhere: the routine's mode alone decides
what is summarized by itself, a scene's close drafts nothing, and *Summarize*, *Summarize all* and *Close and
summarize* are always offered to the owner ("Off stops only the automatic run"). A session without the routine is
unchanged in every way.

## Goal

1. **`sessionSceneContext`** (`src/lib/server/sessions/sceneSettings.ts` ~127–181) is what every reader goes
   through. After it resolves `settings`, ask whether the session has the routine and, when it does, answer
   `settings.summary = "onRequest"` whatever is stored. Add one field to `SessionSceneContext`:
   ```ts
   /**
    * 🚧 The mode of the session's *Summarize finished scenes* routine
    * (`core:spec/scene-summaries`), or null when the session has no such
    * routine. When it has one, `settings.summary` reads `onRequest` whatever is
    * stored: the routine's mode decides what is summarized by itself.
    */
   summaryRoutine: "off" | "review" | "full" | null
   ```
   (import the `RoutineMode` type from `$lib/server/pipelines/routines/sessionRoutines` if it fits.)
   **The helper already exists:** `sessionRoutineMode(db, sessionId, pipeline)` in
   `src/lib/server/pipelines/routines/sessionRoutines.ts` ~37 returns the routine's mode (`?? "full"`) or null, and
   throws when the resolver throws. Use it, by dynamic `await import(...)` like the file's other imports, with
   `SCENE_SUMMARIES_SPEC_ID` from `@serene-pub/core-catalog`. Do **not** add a second helper anywhere (the brief's
   proposed `sessionRoutineMode` in `boundaryWatcher.ts` would be a second meaning of an existing name).
   **The context never throws** (it has about fifteen callers; `scenesEndByThemselves` turns a throw into a refused
   lore write, `lorebooks/ownBook.ts` ~446–458): when `sessionRoutineMode` throws, the context answers
   `settings.summary = "onRequest"` with `summaryRoutine: null` and `console.warn`s one line naming the session.
   `mayPlace`, `mode`, triggers and every other field stay exactly as they are computed today.
2. **`src/lib/server/scenes/sceneSummaryDue.ts`** ~30–33: the `ctx.settings.summary === "never"` check can no longer
   fire (the routine's query runs only for a session that has the routine, whose context reads `onRequest`). Remove
   the check and its host note *this session's Summaries is Never*, and fix the file's header comment ("Not due: the
   session's Summaries is Never, …") to match. Keep everything else in the query.
3. Nothing in `src/lib/server/sockets/scenes.ts` should need to change: `summarizeOnClose` (~3016–3030) reads
   `ctx.settings.summary !== "onClose"`, `scenes:processAll` (~3208–3211) refuses on `"never"`, `buildSceneCuesReply`
   (~2914) and `scenes:openScenes` (~3301) send `ctx.settings`. If you find you must edit it, **stop and report**
   instead.

## Tests (each claim gets one)

Find how existing int tests make a session that has the routine (`scenes/sceneSummaryDue.int.test.ts`,
`sockets/scenes.routineSummary.int.test.ts`, `pipelines/routines/sceneSummaries.routine.int.test.ts`,
`pipelines/registrations/resolve.int.test.ts` ~231–246) and one that does not (Story's **Minimal** preset drops
the routine; `core:genre/chat` never has it; a session-level dropped registration row). Prove in the test that the
session you call "with the routine" really has it (`sessionRoutineMode(...) !== null`), so no test passes by
accident because registrations were not projected.

New claims, for a session **with the routine** holding a stored value:
- stored *On close*: a scene's close drafts nothing (`summarizeOnClose` path: close a scene through the socket the
  existing tests use and assert no summary run starts / status stays `none`);
- stored *Never*: `scenes:processAll` (*Summarize all*, and the Chronicle's *Close and summarize* which uses it) is
  not refused;
- stored *Never*: `sceneSummaryDueOf` names the due scene;
- stored *Never* or *On close*: the `scenes:cues` reply (`buildSceneCuesReply`) and `scenes:openScenes` read
  `settings.summary === "onRequest"`; `summaryRoutine` carries the mode (`full` by default; `off` when the session's
  row sets it Off);
- the resolver throwing (e.g. `vi.spyOn` / `vi.doMock` on `sessionRoutines`' `sessionRoutineMode`, or on
  `effectiveRegistrations`): the context resolves (never rejects) with `summary: "onRequest"`, `summaryRoutine:
  null`, `mayPlace` unchanged, and a warning is logged;
- a session **without** the routine (Minimal or Chat) still reads its stored value: *Never* still refuses
  `scenes:processAll` with the existing message, *On close* still drafts at a close, the cues read the stored value.

Existing tests that pin the stored value on a Story session (which has the routine by default) — e.g.
`scenes.cues.int.test.ts` ~116–122, ~217–228, ~290; `sceneSummaryDue.int.test.ts` ~246–252 *"Summaries Never:
none"*; `boundaryWatcher.int.test.ts` ~423–427 — are updated **only where the rule changed what they pin, never
weakened**: move the old claim onto a session without the routine (so it is still proven there), and add the
routine-session claim beside it. Say in your report, test by test, what you changed and why.

Put the new claims in the existing suites where they fit, or one new file
`src/lib/server/sessions/sceneSettings.summaryRoutine.int.test.ts`.

## Files owned

`src/lib/server/sessions/sceneSettings.ts`, `src/lib/server/scenes/sceneSummaryDue.ts`, the test files named above
(`sockets/scenes.cues.int.test.ts`, `scenes/sceneSummaryDue.int.test.ts`, `scenes/boundaryWatcher.int.test.ts`,
`sockets/scenes.routineSummary.int.test.ts`, `pipelines/routines/sceneSummaries.routine.int.test.ts`) and the one
new test file. Nothing else.

## Files readable

Anything, especially `sockets/scenes.ts`, `scenes/boundaryWatcher.ts`, `scenes/liveScenes.ts`,
`lorebooks/ownBook.ts`, `pipelines/routines/sessionRoutines.ts`, `pipelines/registrations/resolve.ts`,
`shared/sessions/sceneSettings.ts`.

## Out of scope

`sockets/sessions.ts`, `startup/`, any conversion of stored values (worker 2), the form, docs, the SDK, any
migration, any new setting, the Chronicle and conversation widgets, `boundaryWatcher.ts`.

## Stop and ask when

A published SDK name or type would have to change; `sockets/scenes.ts` would have to change; a reader of
`sessionSceneContext` turns out to need the stored Summaries value for a session that has the routine; you would
need a new name beyond `summaryRoutine`.

## Done means

Your new tests pass; these pass, updated only as above: `src/lib/server/sockets/scenes.cues.int.test.ts`,
`src/lib/server/scenes/sceneSummaryDue.int.test.ts`, `src/lib/server/scenes/boundaryWatcher.int.test.ts`,
`src/lib/shared/sessions/sceneSettings.test.ts`, `src/lib/server/sockets/scenes.routineSummary.int.test.ts`,
`src/lib/server/pipelines/routines/sceneSummaries.routine.int.test.ts`, plus
`src/lib/shared/conformance/commentHistory.test.ts`; `tsc` clean for your files. Report the exact commands and
pass counts.
