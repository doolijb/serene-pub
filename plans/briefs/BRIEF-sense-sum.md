# BRIEF — build lane `sense-sum` — a routine summarizes a finished scene by itself

**You are a lane supervisor.** Read `.claude/guides/multi-agent.md` first. Then, in full:
`plans/REPORT-sense-scn-2026-11-12.md` (the scenes routine; this lane copies its shape),
`plans/REPORT-sense-b4-2026-11-12.md` and `plans/REPORT-sense-b2-2026-11-12.md` (automatic Apply and "unless a
summary waits"), `plans/DESIGN-e-scenes-2026-11-12.md` (the owner's answers), CLAUDE.md Hard rules, Principles and
"0.6 is in users' hands", NOMENCLATURE §1, §23, §24, §25, `docs/summarization.md`, `docs/sessions.md` ~410–431 and
~509–522, `../serene-pub-sdk/INTEGRATING.md` (the routine and outlet steps). `plans/briefs/BRIEF-sense-clk.md`'s
**Verbatim rules** bind you and your workers.

Words. A **build lane** is this stream of work; a **channel** is a session's message channel. **"Compile" is
taken**: it means turning scenes into a history entry (`sceneCompileHandler`, *Compile to Entry*), which stays a
person's press and the lorebook's job. This lane **summarizes scenes**. Never write "compile" for it.

## Rulings that bind (owner)

- "Core genres should trigger the scene/history compilation maybe 6 rounds deep?" Lead's reading: the scene summary
  only, six rounds after the scene ended, one declared number. History entries are a later lane.
- Summaries are "Saved by itself, editable".
- What is saved: "Summary, name, known cast. Keep the new characters as a toggle in the pipeline that's off by
  default."
- "Core does nothing unless declared", "Existing sessions follow their genre".
- A purpose sentence on a routine that calls no model: "Yes allow it".
- "Only Apply settles." "A turn owns what it wrote." "You're over complicating it": take the plainer shape and say
  so.
- Lead's decisions, said to the owner: a summary that saves itself does **not** stop Back; going Back into such a
  scene clears its automatic summary so it is summarized again later. Held lorebook changes apply at scene end and
  do not wait for a summary nobody has started.

## The rule to build, in four sentences

Story (Living and Rule Based), the Lair and the Dungeon Crawler register one more routine, *Summarize finished
scenes*. Every two rounds it looks for the oldest scene on the main channel that ended at least six rounds ago and
has no summary, and starts the genre's own scene summarizer for it in the background. Under **Full** the result is
saved by itself (summary, name, known cast) and marked as saved by the routine; under **Review** it waits in
today's review window; under **Off** nothing happens. A summary the routine saved never settles the story by
itself.

## Build

Begin by re-reading every cited line; the numbers below are from an inventory on 2026-11-12 and may have moved.

1. **The routine (SDK, core catalog).** A new spec beside `core-catalog/src/shared/sceneBoundaries.ts`, the same
   shape: routine inlet → a query that names the one due scene → an outlet that starts its summary. It calls no
   model itself. Names (🚧 provisional; check §23 and §24 and say what you chose):
   `core:spec/scene-summaries` (*Summarize finished scenes*), `core:query/scenes-to-summarize@1` with one declared
   param `depth` (default 6, rounds since the scene closed), `core:outlet/summarize-finished-scene@1` (*Summarize a
   finished scene*). Register it in `core-catalog/src/genres/defaults.ts` on the existing cadence,
   `register(everyNRounds({ n: 2 }), …, { minAge: 0 })`, mounted in Story, the Lair and the Dungeon Crawler; the
   Minimal preset drops it as it drops `r.scenes` (`seed/presets.ts` ~62); Chat and the Guide never have it.
   `minAge: 0` because the routine default of 20 lines after each source would refuse a six-round-old scene in a
   two-seat session; `depth` is the age guard here. Say so in the registration's comment.
2. **Which scene is due** (app; a new small module under `src/lib/server/scenes/`, bound in
   `pipelines/runtime/bindings.ts` like `sceneBoundariesBindings`). One scene at most per run, the oldest first:
   a session scene on the **main** channel; closed; `summaryStatus = 'none'`; **nobody has decided about it**
   (its `summary` is blank and `processed_by_spec_id IS NULL`, so a summary a person saved and a boundary move then
   reset, and a review a person discarded, are never taken; the one exception is a scene whose `summary_origin` is
   `routine`, which Back reset and the routine may summarize again); closed at least `depth` rounds ago,
   counting rounds exactly as the scenes routine counts them (reuse its counter, do not write a second); the
   session's **Summaries** setting is not *Never*; the session has no rewound turns (a Forward stack); for a branch
   session, only a scene whose lines the branch itself wrote (never one copied from its original: find how a
   branch copies scenes and say what you found). `failed` is never retried by the routine. `running` and `review`
   are skipped.
3. **The outlet starts the genre's summarizer, detached.** Its commit reads the routine's mode off the `routine`
   port (so Review is not forced through the generic review gate, `run.ts` ~306–316) and calls the existing path
   (`runSceneSummaries` → `processScene`, `sockets/scenes.ts` ~2704, ~1719) with the session genre's own
   summarize-scene spec (`resolveSummarizeSceneSpec`), never a second prompt. It returns at once; the summary's
   model calls are never awaited inside the routine run or under the generation lock. Under **Review** it is
   today's behaviour unchanged (the scene goes to `review`, the review window and notification as now). Under
   **Full** the run carries one new flag and, when it completes, saves instead of parking (item 4).
   **The run is a routine's in the model queue.** `processScene` runs with no `registration` today, so its calls
   queue as a person's action, ahead of a reply (`runTurn.ts` ~567, `llmQueue.ts` ~61–95). The outlet passes an
   option that makes this run's family `routine` while keeping the genre's spec (`via` swaps the spec, so it cannot
   be reused as is). Test: with a summary's calls queued, a person's reply call is served before the summary's next
   call. A person can still send, get a reply and go Back while it runs; if not, stop and ask.
4. **One writer for a saved summary.** Extract the save from `sceneUpdateHandler` (`sockets/scenes.ts` ~546–870:
   name patch, scene row, `writeSceneCast`, `recordLoreSources`, then settle and the after-commit steps) into one
   function both callers use. Do not copy it. The person's Save calls it as today, byte-for-byte in effect. The
   routine's save calls it with:
   - the summary; the model's name **only while the scene's name is still the automatic one** (`nameIsDefault`
     true; a name a person gave is never replaced; a saved name ends automatic "Scene N" renumbering, ~699);
   - **no cast.** The known cast is what the scene's close already stored without a model, silent members
     included (`liveScenes.ts` ~741–823). `processScene`'s participants are only the senders, and `writeSceneCast`
     deletes and rewrites, so passing them would shrink the cast. The routine's save leaves `scene_characters`
     alone, and with the routine flag `processScene` skips `resolveOrCreateBinding` (~2146);
   - `summaryStatus = 'done'` and the new mark (item 5) set to `routine`;
   - `checkLoreSources` at `minAge: 0`, but **no `lore_sources` row and no `scene-summary-applied` event**: both
     say the stretch is part of the record, and Back can still undo this save. They are written when the summary
     becomes a person's (item 5);
   - **no `settleThrough`**;
   - after commit: the scene list refresh, and a release of what waited. A `running` (or `review`) scene holds
     back every automatic Apply from its start (`ownBook.ts` ~2877–2894), and the release that names only the
     summarized scene reaches only to that scene's close (~2880), which already applied. So on save, on failure
     and on cancel, release **up to the newest closed scene on the channel**. That Apply may settle; that is Apply
     settling, which is the rule. If the save itself throws after the run (lines rewound meanwhile, writes turned
     Off), the scene goes to `failed` and the release still happens. Test: a scene that closes while the run goes
     gets its held changes when the summary saves, fails or is cancelled.
   The refusals the socket handler makes (`primerRowEditProblem`, `loreWritesOffRefusal`, ownership as the
   session's owner) apply to the routine's save too: decide them inside the shared function or before it, once.
5. **The mark, and Back.** One new nullable column on `scenes`, 🚧 `summary_origin` (`person` | `routine`; NULL
   reads as a person's, so every stored row behaves as before). **Generated** migration (`npm run db:generate`),
   index 0157, above the highest applied. No data pass.
   - `settledLineOf` (`sessions/settle.ts` ~65–86) counts a `done` scene only when its origin is not `routine`.
   - `takeSceneBoundariesAt` (`scenes/liveScenes.ts` ~2020–2125, `notDone` ~2036) treats a routine-saved `done`
     scene as not done: Back into it reopens or moves it as it does any unsummarized scene, and its status goes to
     `none` **keeping the origin `routine`**, which is what lets the routine take it again once it is due (item 2).
   - **A person saving any text on a routine-saved scene makes it theirs**: `scenes:update` treats a
     routine-origin `done` scene as not yet applied (~619–622), so the save sets origin `person`, records
     `lore_sources`, emits `scene-summary-applied` and settles, exactly as a person's Save does today. Without this
     a person's edit would be overwritten by the routine after a Back. Saving the review of a pressed Summarize is
     the same.
   - Tests: Back across a routine-saved scene works and the scene becomes due again; a person's saved scene still
     stops Back with today's sentence; Forward puts back what Back took.
6. **Shown, with its cause and its off switch (P1).** Where the session shows a scene's summary, a routine-saved
   one carries one line, 🚧 *Summarized by itself. You can edit it, or turn this off under Routines.* Use the
   existing place a scene's summary is listed; no new panel. The routine appears in the session's routines list
   with its mode like any other.
7. **The purpose sentence (SDK).** `sdk/src/builder.ts` ~588 and `sdk/src/validate.ts` ~1450 refuse
   `expose.purpose` on a step that calls no model. Allow it **when the whole spec calls no model**; keep refusing
   it on a non-model step of a spec that does. The builder's check runs node by node (`exposeOf`, ~573–589), so
   it cannot know the whole spec: move it to `build()` (~1799), and make `validate.ts`'s a whole-document check
   that counts swaps too. Give `scene-boundaries` and the new spec one sentence each (🚧
   *Finds where one scene ends and the next begins. Calls no model.* / *Summarizes each scene a few rounds after it
   ends, with the genre's scene summarizer.*). Update `sdk-tests/stepLabel.test.ts` ~61, ~72 and
   `sdk-tests/coreSceneBoundaries.test.ts` ~37.
8. **Docs and ledgers in the same change:** `docs/summarization.md` (~40–62), `docs/sessions.md` (~241–259 Back,
   ~410–431 Routines, ~509–522), `docs/pipelines.md` (~48–105), the genre pages that list routines,
   `../serene-pub-sdk/guides/` where routines are listed, `INTEGRATING.md`, NOMENCLATURE rows with charters (P6)
   and §25. In §25 also list `sceneBoundariesOf` and `sceneBoundariesBindings`, owed from `sense-scn`.

## Files owned

SDK: `contracts/src/queries.ts`, `contracts/src/outlets.ts`, `core-catalog/src/shared/` (the new spec file and
`sceneBoundaries.ts` for its sentence), `core-catalog/src/genres/defaults.ts`, `core-catalog/src/seed/presets.ts`,
`core-catalog/src/index.ts`, `sdk/src/builder.ts`, `sdk/src/validate.ts`, the tests named above and new ones.
App: `src/lib/server/sockets/scenes.ts`, `src/lib/server/scenes/` (the new module; `liveScenes.ts` for item 5
only), `src/lib/server/sessions/settle.ts`, `src/lib/server/pipelines/runtime/bindings.ts` and `host.ts` (the new
query and outlet only), `src/lib/server/db/schema.ts` and the generated migration, the one client component that
lists a scene's summary, the docs above.

## Open ★ to carry into the report (build nothing for them)

- **Summaries setting and the routine.** The session's **Summaries** (On close / On request / Never) and the
  routine's mode now both decide whether a scene is summarized. This lane: *Never* stops the routine; *On close*
  still drafts for review at the close, and the routine then leaves that scene alone; *On request* no longer means
  "only when you ask" where the routine is on, so `docs/sessions.md` ~520 is reworded. Whether the setting folds
  into the routine's mode is the owner's.
- **New characters.** Owner 2026-11-12: "Keep the new characters as a toggle in the pipeline that's off by
  default." Ruling 2026-09-08 (`scene.ts` ~10–14): the model step that proposes them is on ice. The lead told the
  owner that the iced build-time switch is left as it is and no session toggle is added; the owner has not
  answered.

## Out of scope

History entries and *Compile to Entry*; summaries in the reply's prompt; the model step that proposes **new
characters** (on ice by the 2026-09-08 ruling, `core-catalog/src/shared/summarize/scene.ts` ~10–40: it stays a
build-time `extractsCast` that is off, and this lane neither thaws it nor adds a session toggle for it); the
session's **Summaries** setting (kept; only *Never* is read); side channels; Close out; the write mode; any change
to the genres' summarize-scene specs or prompts; any second migration, setting or settle trigger.

## Stop and ask when

A published SDK name, port or result shape would change or go; more than the one column is needed; a person's
send or reply would wait on the background summary; the save cannot be extracted without changing what a person's
Save does; a shipped genre's summarizer cannot be started from the outlet without a new inlet; existing stored
data would need a pass.

## Done means

New tests pass: due-scene selection (each condition in item 2), Full saves by itself with summary, name and known
cast and no settle, Review parks as today, Off does nothing, Minimal has no such routine, Back and Forward across a
routine-saved scene, a person's edit of a routine-saved summary making it theirs, a custom name and the stored
cast untouched by the routine's save, held changes released after the routine's save, failure and cancel, the
model-queue order, a person's Save unchanged (the existing scene
suites pass untouched), the SDK purpose rule both ways. `npm run sdk:test` for the touched SDK tests;
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` clean. Tests run only inside
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 …"`,
never two runs at once. **One** `npm run sdk:build`, and only after `pgrep -af "vite dev"` shows no serene-pub dev
server; if one is up, finish the rest and report "blocked on your dev server". Do not re-pin hashes: list every
pin that moved (`specHashes.test.ts`, `registryHashes.test.ts`, SDK `coreCatalog.test.ts`, `lair.test.ts`,
`writes.test.ts`, `coreGenreDefaults.test.ts`, app `registrations/resolve.int.test.ts`) and the lead re-pins.

## Report

**Return the full report as your final message**, after every worker has finished (the lead saves it as
`plans/REPORT-sense-sum-2026-11-12.md`): the rule as built in sentences a modder could read; names chosen and why;
what the shared save function does for each caller; how Back treats each kind of scene; provisional copy verbatim;
changed files in each repo; tests and results; pins that moved; open ★; **Noticed, not done**.
