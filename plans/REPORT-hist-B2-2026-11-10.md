# REPORT — hist-B2: note-scene@1 host, scene notes, cast state from pipelines — 2026-11-10

Saved by the lead from the supervisor's hand-back; the harness refused the supervisor's own write. Worker briefs and reports: `plans/briefs/BRIEF-hist-B2-w{1,2}.md`, `plans/briefs/REPORT-hist-B2-w{1,2}.md`. A scope review ran inside the lane.

## Changed files
- **`db/schema.ts`:** nullable `scenes.notes jsonb` `[{text, runId, messageId, at}]`. The migration **`drizzle/0150_chief_starjammers.sql`** adds only that column.
- **`scenes/liveScenes.ts`:** `appendSceneNote(tx, {sessionId, sceneId?, channel?, text, runId, messageId})`.
  - It writes to the named scene, or the open scene on the run's channel, as one atomic jsonb append.
  - It never writes history or messages.
  - It refuses with `SceneBoundaryRefusal`.
- **`runtime/bindings.ts`:** a binding for `core:outlet/note-scene@1`.
- **`runtime/host.ts`:** the `note-scene` case, which calls `appendSceneNote` inside a transaction.
- **`runtime/castMember.ts`:** `nodeState` is checked against `CAST_STATE_WORDS`, and `nodeVisibility` against normal/legendary/hidden. `{follow:true}` is refused for both, following the writer.
- **`sockets/scenes.ts`:**
  - Compile: each scene's text gets "Noted in this scene:" plus its notes.
  - `processScene`: `request.scene.notes`.
- **`boot/registryHashes.test.ts`:** a `note-scene@1` pin. `create-lore-entry@1` didn't move.
- **Tests:**
  - new: `sceneNotes.int`, `host.noteScene.int`, `castMember.nodeState.int`, `scenes.notes.int`, `db/sceneNotes0150.int` (second boot);
  - edited: `castMember.int`.

## Tests
- Lane set: 36 files, 251/251. `tsc`: 0 errors across the whole repo.
- `pipelines/runtime/`: 146 files, 1365 pass, 4 fail. None are this lane's: `capabilityGuard`, `allPipelines` (oracle/speak), `illustrateScene`, `scoreLedAllocation`.

## Lead decisions on its ★ (2026-11-10)
- **B2-1, undo a note:** build the recommended anchoring.
  - New `takeSceneNotesAt(tx, messageId)` beside `takeSceneBoundariesAt`.
  - It is called from `retractStateAnchoredTo` (replacement and Back) and from the delete paths (`messages/store.ts`, `sessions/retakeTurn.ts`).
  - `restoreRetractedState` puts the notes back on Forward.
  - Given to lane hist-B3.
- **B2-2, recompile marker:** **none.** A person's Recompile already re-reads every scene of the day, notes included. The only marker the UI understands (un-filing the scene) reshapes data. This replaces plan default S2.
- **B2-3, notes into the summarize prompt:** build it. `transcript.ts` `sceneOf` keeps the notes, plus a template line in core-catalog `DEFAULT_TRANSCRIPT_TEMPLATE`. Given to hist-B3; the SDK half needs a build.
- **B2-4, the "Noted in this scene:" label can land word for word in a one-scene day's history:** asked of the owner.
- **B2-5, extra refusals** (lore writes off, "a note needs text.", "there is no scene ‹x›."): accepted.
- **B2-6, notes-only scenes are skipped by Compile:** accepted for now.

## Copy for hist-F (provisional 🚧)
- **note-scene refusals:**
  - "a note needs text."
  - "this genre keeps no scenes."
  - lore writes off (the existing sentence)
  - "there is no scene ‹x›."
  - "that scene belongs to another session."
  - "no scene is open to note; open one first (propose-scene-cue@1)."
  - with no session: "‹node› has no session to note a scene in — …"
- **update-cast-member refusals:** not a cast state, not a cast visibility, no card value to follow.
- **Label:** "Noted in this scene:".

## Noticed, not done
- `NODE_VISIBILITIES` is a third copy of the visibility list (alongside `castVocabulary.ts:16` and `amendments.ts:687`).
- The `sources` port isn't stored.
- The binding's `halt` branch can never be reached.
- The new tests aren't prettier-formatted.
- A worker tried a glob `rm` over `/tmp` test dirs; the harness refused it.
