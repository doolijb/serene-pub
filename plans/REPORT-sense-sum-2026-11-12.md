# REPORT — build lane `sense-sum` — 2026-11-12

Brief: `plans/briefs/BRIEF-sense-sum.md` (cold review folded in before the build). Supervisor's report, saved by the
lead; the lead's verification is at the end.

**Status:** built as briefed, nothing stopped. One new column (`scenes.summary_origin`), one generated migration
(0157). No published SDK name, port or result shape changed or removed.

## The rule as built

- **Who has it.** Story (Living, Rule Based), the Lair and the Dungeon Crawler register the routine *Summarize
  finished scenes* (`core:spec/scene-summaries`), every 2 rounds, `minAge: 0` (the query's `depth` is its age guard).
  Registration key `every-n-rounds→scene-summaries` (object key `sceneSummaries`). Story Minimal drops it; Chat and
  the Guide never have it. It calls no model itself.
- **Which scene, one per run, oldest first.** `core:query/scene-summary-due@1` (host `sceneSummaryDueOf`) names the
  oldest scene that is: this session's, on `main`, a range scene, closed; status `none` (never `running`, `review`,
  `done`, `failed`; failures are never retried); undecided (blank summary and `processed_by_spec_id` null, or
  `summary_origin = 'routine'`); closed at least `depth` rounds ago (default 6, counted with the scenes routine's
  `replayStoryLane`); the session's **Summaries** is not *Never*; no rewound turns; on a branch, opened after the
  branch's last copied line. Else `null`.
- **The outlet starts the summary.** `core:outlet/summarize-finished-scene@1` reads the mode off the `routine` port
  and calls `startRoutineSceneSummary`: re-checks `none`, decides the refusals (owner owns the lorebook, primer, lore
  writes Off; a refusal is a note, not a halt), starts `runSceneSummaries` → `processScene` with the genre's own
  summarize-scene spec, detached, returns at once. The run's family is `routine` (`LLM_PRIORITY.routine`, after
  people's replies). No generation lock across model calls, not in `runRegistry`: a person can send, get replies and
  go Back.
- **Full.** Saved by itself: summary, `done`, origin `routine`, `processedBySpecId`. The model's name only while
  `nameIsDefault` holds at save time. Cast untouched; the sender-binding step is skipped. No `lore_sources` row, no
  `scene-summary-applied` event, no settle. Its Activity card is removed as used; no review window.
- **Review.** Today's behaviour: `review`, card and notification. **Off.** Nothing runs.
- **Release.** When a routine-started run saves, fails or is cancelled, held lorebook changes are released up to the
  newest closed scene on its channel.
- **Never the record by itself.** A routine-saved summary does not settle and does not stop Back. Back into the
  scene resets it to `none` keeping origin `routine`, so it becomes due again; Forward restores it. A person saving
  any text on it makes it theirs: origin `person`, a `lore_sources` row, the event and the settle.

## Names (all 🚧)

`core:spec/scene-summaries` (`SCENE_SUMMARIES_SPEC_ID`, `SCENE_SUMMARIES_VERSION` 1.0.0, `sceneSummariesSpec`);
`core:query/scene-summary-due@1` (`C.sceneSummaryDue`, param `depth`; **changed from the brief's
`scenes-to-summarize`**, because the app already has `scenesToSummarize()` and this names one scene: ★SUM-3);
`core:outlet/summarize-finished-scene@1` (`C.summarizeFinishedScene`); `scenes.summary_origin`
(`SceneSummaryOrigin`: `person` | `routine`, NULL reads as a person's); app helpers `saveSceneSummary`,
`startRoutineSceneSummary`, `RoutineSceneSummary`, `sceneSummaryDueOf`; SDK internal `specCallsModel`. Near
collision noted, not renamed: the boot startup task `scene-summaries` (reconciles derelict summaries).

## The shared save `saveSceneSummary({ by, userId, params, io?, emitToUser?, routine? })`

- Both callers: refusals decided once as the acting user (`findOwnedBook`, `primerRowEditProblem`,
  `loreWritesOffRefusal`); the routine acts as the session owner.
- Person's Save: today's path, with two changes: a `done` scene with origin `routine` counts as not yet applied;
  any save carrying `summary` sets origin `person`. `sceneUpdateHandler` is a thin wrapper. All 23 existing
  `sockets/scenes.*` suites pass untouched.
- Routine's save: summary, `done`, origin `routine`, the spec, the name only while `nameIsDefault`;
  `checkLoreSources` at minAge 0 over the run's sources (a line taken back meanwhile refuses the save); no cast,
  selection, `castResolvedAt`, `lore_sources`, settle, announce or event; a conditional update that lands only while
  the scene still reads `running`; after commit the scene list goes to every page of the session. If the save
  throws: `failed`, the card shows the sentence, the release still happens.

## How Back treats each kind of scene

No summary, stale, `running`, `review`: as before. Routine-saved `done`: not done; Back reopens, moves or removes it,
status `none`, text kept, origin stays `routine`; Forward restores the row as `done`. A person's `done`: untouched,
Back refuses with *This part of the story is in the lorebook now.* A routine run in flight when Back happens stays
`running`; if Back took any of its lines the save refuses at `checkLoreSources`.

## Provisional copy (verbatim)

Spec *Summarize finished scenes*. Find step: label *Finished scenes*; status *Looking for a finished scene to
summarize*; purpose *Summarizes each scene a few rounds after it ends, with the genre's scene summarizer.* Outlet
step label *Summarize the scene*. Query *The scene due a summary*; `depth` *Rounds after it ends* · *A scene is
summarized once it ended at least this many rounds ago, so its lines have stopped changing.* Outlet *Summarize a
finished scene*. Scenes routine purpose *Finds where one scene ends and the next begins. Calls no model.* Scene page
line *Summarized by itself. You can edit it, or turn this off under Routines.* Host notes: *no finished scene is due
a summary*; *turns are taken back*; *this session's Summaries is Never*. New doc paragraphs in
`docs/summarization.md` (*Finished scenes, summarized by themselves*) and `docs/sessions.md`.

## Decisions inside scope

The query answers a plain scene id or `null` (the outlet notes "nothing due"); the outlet declares no `review` field;
the purpose check moved from `exposeOf` to `build()` and is a whole-document law in `validate()` (swap options count
as model calls; an unknown definition counts as none); the routine's release lives in `processScene`; the cause line
is on `SceneEditor.svelte` (the lorebook's scene page); branches copy messages and no scene rows; one expectation
list fixed in SDK `coreGenreDefaults.test.ts` (Minimal's drops).

## Changed files

SDK: `contracts/src/queries.ts`, `contracts/src/outlets.ts`, new `core-catalog/src/shared/sceneSummaries.ts`,
`core-catalog/src/shared/sceneBoundaries.ts` (purpose), `core-catalog/src/index.ts`, `genres/defaults.ts`,
`seed/presets.ts`, `sdk/src/builder.ts`, `sdk/src/validate.ts`; tests `stepLabel`, `coreSceneBoundaries`, new
`coreSceneSummaries`, `coreGenreDefaults`, `lair` (routine lists); docs `guides/genres-presets-and-routines.md`,
`INTEGRATING.md` §1i.

App: `src/lib/server/db/schema.ts`; `drizzle/0157_legal_puppet_master.sql` (`ALTER TABLE "scenes" ADD COLUMN
"summary_origin" text;`), its snapshot and journal (generated); `sockets/scenes.ts`; `sessions/settle.ts`;
`scenes/liveScenes.ts`; new `scenes/sceneSummaryDue.ts`; `pipelines/runtime/bindings.ts`, `host.ts`;
`client/lorebooks/sections/SceneEditor.svelte`; new tests `sockets/scenes.routineSummary.int` (15),
`scenes/liveScenes.routineSummary.int` (3), `scenes/sceneSummaryDue.int` (15),
`pipelines/routines/sceneSummaries.routine.int` (7), `sceneEditor.routineSummary.dom` (3); docs `summarization`,
`sessions`, `pipelines`, `genre-story`, `genre-lair`, `genre-dungeon-crawler`; NOMENCLATURE §4, §9, §25 (with
`sceneBoundariesOf`, `sceneBoundariesBindings` owed from sense-scn). Worker briefs `plans/briefs/BRIEF-sense-sum-w1`
to `-w4`.

## Open ★

- **★SUM-1** The session's **Summaries** setting and the routine's mode both decide whether a scene is summarized
  (*Never* stops the routine; *On close* drafts for review and the routine leaves that scene; *On request* reworded).
- **★SUM-2** New characters: owner "a toggle in the pipeline that's off by default"; nothing built, `extractsCast`
  stays iced (2026-09-08); owner has not answered.
- **★SUM-3** Query name `scene-summary-due`.
- **★SUM-4** A person stopping a routine-started run restores `none` undecided, so the routine takes the scene again
  two rounds later. Should a stop count as decided?
- **★SUM-5** The cause line is only on the lorebook's scene page; the session's Chronicle shows only its dot.
- **★SUM-6** A person-pressed or *On close* run still releases held changes only up to that scene's close.

## Noticed, not done

`activityStore.startScene` supersede race (an aborted earlier run's catch writes `statusBefore` over a newer run's
`running`); a refused routine start is retried every 2 rounds (no model calls); whether a purpose on a non-model
step shows oddly in the pipeline panel (`pipelines/config/panel/groups.ts` ~417); a fragment's misplaced purpose is
refused only when a spec including it is built; `scenes:process:error` still emitted on a routine failure; docs say
Back "clears" the summary though the text is kept; prettier drift in already-unformatted files; test gaps (Off only
through *Run now* refused; the Back-then-due test clears the Forward stack by SQL; the DOM test stubs `SceneForm`).

## Verification (lead, 2026-11-12)

Re-pinned: `core:spec/scene-boundaries@1.0.0` → `1e8c550568e1f5`, new `core:spec/scene-summaries@1.0.0`
`1b6e3f7460bd58`; new `core:query/scene-summary-due@1` `d78f075f52a77`, `core:outlet/summarize-finished-scene@1`
`1443315d18526`; SDK digest → `04abf88df591dd61`; `registrations/resolve.int.test.ts` Minimal's drops gain
`every-n-rounds→scene-summaries`. SDK `coreCatalog` 5/5, `coreSceneSummaries` 4/4, `stepLabel` 12/12,
`coreGenreDefaults` 19/19. App: 48 files, 300 of 301 tests pass; the one failure
(`dataUpgrades/0108_layering_registrations.int`) is the speech work's (`speak-message` registrations), not this
lane's. `tsc` clean.

## Scope review and the lead's follow-up (2026-11-12)

Scope: no objection (every file inside **Files owned**; the migration is generated and adds the one column). Five
findings; four fixed by the lead, with tests:

1. **A draft a person discarded could be taken again after Back.** The due rule accepted any `none` scene of origin
   `routine`. Now: `processed_by_spec_id IS NULL` and (blank summary or origin `routine`); every reset of a
   routine-saved `done` scene (Back, a moved boundary, a merge) clears the draft mark (`summaryResetPatch`,
   `liveScenes.ts`), so the routine takes it again, while a pressed or reviewed draft a person discards keeps the
   mark and is never taken.
2. **Back into a scene while its summary was being written left it `failed` for good.** When the routine's save is
   refused because a source line is no longer live, the scene goes back to what it was (`none`), the card leaves,
   and the release happens; other refusals still fail the run.
3. **A second summary could start while one was running.** `sceneSummaryDueOf` answers nothing while any scene of
   the session is `running` (*a scene's summary is being written*).
4. **When the routine's save did not land (a person had the last word), nothing was released.** It now releases.
5. **The queue-order test the brief asked for is not written.** The run's family and priority are tested and
   `llmQueue.test.ts` proves the order; an end-to-end test is owed.

Docs: `docs/summarization.md` says "marks out of date" (the text is kept), and gains *One at a time*.
Verification after the fixes: 51 files, 436 tests pass; `tsc` clean.
