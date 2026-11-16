# REPORT — build lane `sense-sumset` — 2026-11-13

Brief: `plans/briefs/BRIEF-sense-sumset.md` (cold review folded in). Saved by the lead from the supervisor's report.
**Status:** built as briefed; no migration; no published SDK name changed; the pass is a no-op on its second run.

## The rule as built

- A session **has the routine** when its effective registrations hold a routine whose pipeline is
  `core:spec/scene-summaries` (Off still counts). Story Living and Rule Based, the Lair and the Dungeon Crawler have
  it; Story Minimal, a session whose own row drops it, Chat and the Guide do not.
- For such a session `sessionSceneContext` always answers `settings.summary = "onRequest"` and carries the routine's
  mode in `summaryRoutine` (`RoutineMode | null`). Every reader goes through the context, so a scene's close drafts
  nothing, *Summarize*, *Summarize all* and *Close and summarize* are never refused, the routine's query does not
  stop on a stored Never (that dead check is removed from `sceneSummaryDue.ts`), and the cues and open-scenes
  replies read `onRequest`: no SDK or widget change.
- The context never throws: on a resolver error it answers `onRequest`, `summaryRoutine: null`, and warns.
- **The conversion** (`convertSummariesSetting(db, sessionId)`, `sessions/summariesToRoutine.ts`): for a session
  with the routine and a stored `metadata.scenes.summary` of `never` or `onClose`, set the routine's mode to `off` or
  `review` through `patchSessionRow`, only where the session's row has no mode; then clear the stored value;
  `invalidateRegistrations()`. Called by the startup task `summaries-to-routine` (after `pipelines`,
  `failsHealth: true`) and at once by `sessions:setSessionPreset`, which then pushes the scene cues.
- `sessions:update` drops a `summary` sent for a session with the routine.
- The form: for a session with the routine the Scenes card shows one line in place of the Summaries select, 🚧
  *Summaries are written by the ‹name› routine (‹Full | Review | Off›).* and, when the card is not disabled,
  *Change it under Routines.*
- Changed from the brief: no new helper in `boundaryWatcher.ts`; `sessionRoutineMode` already exists in
  `pipelines/routines/sessionRoutines.ts` with the wanted behaviour and is reused.

## Changed files

App: `server/sessions/sceneSettings.ts`, `server/scenes/sceneSummaryDue.ts`, new
`server/sessions/summariesToRoutine.ts`, `server/startup/index.ts`, `server/sockets/sessions.ts`,
`client/components/sessionForms/SessionSceneSettings.svelte`; tests: new
`sessions/sceneSettings.summaryRoutine.int` (10), `sessions/summariesToRoutine.int` (10),
`sessionForms/sessionSceneSettings.dom` (5), `scenes/sceneSummaryDue.int` (one case reworded); docs `sessions`,
`summarization`, `session-layout`, `genre-story`; NOMENCLATURE §4 rows and §25. SDK: four doc comments
(`sceneSettings.ts`, `descriptors.ts`, `widgets.ts`, `sessionDossier.ts`).

## Tests

14 files: 142 of 143 pass; the one failure (`shared/conformance/commentHistory.test.ts`) is over its limit in nine
files that are not this lane's. `tsc` 0 errors; `npm run check` 0 errors.

## Open ★

- **SS-1** A branch copies metadata but not session-level registration rows, so a branch of a session set to Off
  starts on its preset's mode (true of every routine).
- **SS-2** `SceneSummaryMode` keeps three values; a plugin genre that declares `summary` and registers the routine
  has the declaration ignored.
- **SS-3** The single-scene `scenes:process` never checked Never server-side.
- **SS-4** The form line is two sentences. **SS-5** names. **SS-6** the pass marks the instance unhealthy if a
  session's conversion throws (as `dc-crawl-clock` does).

## Noticed, not done

`sessions:update` stores `{}` when dropping `summary` leaves nothing; a stored `onRequest` is left in place; a
session that gets a stored Never by another route (import, duplicate, a branch made before the conversion) converts
only at the next boot; the pass runs before `plugins` (plugin genres unverified); three weak test spots (an empty
queue for "not refused", the Off proof, the DOM test's closed popup); `cues.int` and `boundaryWatcher.int` never
bootstrap pipelines, so their Story sessions have no routine; prettier drift; a worker's glob `rm` over its own
test prefix.

## Verification (lead, 2026-11-13)

Scope review: pending.

Scope review: no objection on scope; three findings, all fixed by the lead with tests.

1. **A save could wipe a stored Never that was never converted** (an import, a routine added to the preset since),
   leaving the routine on its preset's mode for good. `sessions:update` now runs the conversion first for any
   session with the routine, whenever scene settings are saved (a `null` save, *Use the genre's settings*, too).
2. **The boot pass could block every launcher update** over a session it would never write: a session whose
   routines cannot be read is now logged and left, not counted as a failure; only a throw inside a conversion
   counts. The header comment no longer claims a session without the routine is "not selected again" (it is
   selected each boot and never written).
3. **A Summaries pick made before the routines answered was dropped without a word.** For a session that exists,
   the form shows neither the select nor the routine's line until the answer arrives.

Noticed by the review, not done: a Minimal session switched to Living and back ends On request, not its original
Never; `sceneSummaryDueOf` is a pipeline binding, so another pipeline calling it in a session without the routine
would not stop on Never (only the routine calls it today).

Verification after the fixes: the lane's three new suites and the Back suites, 9 files, 90 tests pass; `tsc` and
`npm run check` clean.

## Same day, outside the lane: Story's Back takes one message (lead)

Owner 2026-11-13: "I think story back/forward should move one message at a time on main, not the whole round."
That was already ruled (2026-11-04) and coded, but Story's `history: { settle, back: "message" }` sat inside the
genre's `shape`, where `genre()` never reads it, so every shipped build took the whole turn (reproduced on a copy
of the owner's data: one press removed the person's line and the reply). Fixed in
`../serene-pub-sdk/core-catalog/src/registry/genres.ts` (the setting is a genre property now); a new SDK test reads
the registered genre (`sdk-tests/coreGenreDefaults.test.ts`); SDK rebuilt; `core:spec/story-create@2.2.0` re-pinned
to `1ceb1bd52f96e9`, SDK digest `f68dcfdeb1e54da7`. Seven integration tests that had assumed a whole-turn Back in a
Story session now press once per message (`settle.int`, `rewindMirror.int`, `liveScenes.rewind.int`,
`oneUndoRule.int`, `seatKeys.gate.int`). Confirmed in a production build on a copy of the owner's data: Back reads
"the newest message (Eldriana)", then "your line"; Forward puts one back per press. Open: the button's label still
says "Back one turn" / "1 turn ahead" in Story; intro (greeting) messages cannot be taken back (owner asked).
