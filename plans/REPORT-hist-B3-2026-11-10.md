# REPORT — hist-B3: undo scene notes; notes into the summarize prompt — 2026-11-10

Saved by the lead from the worker's final message.

## Changed files
- **`scenes/liveScenes.ts`:**
  - `takeSceneNotesAt(tx, messageId, sessionId?)` → `SceneNotesTaken[]`.
  - `restoreSceneNotes(tx, taken)` puts notes back in order and skips duplicates.
  - The ⚠ doc on `appendSceneNote` is updated.
- **`state/write.ts`:**
  - `retractStateAnchoredTo` takes the notes on replacement and Back.
  - `RetractedState.sceneNotes` records what was taken.
  - `restoreRetractedState` and `reviveRetractedState` restore the notes on Forward.
- **`messages/store.ts`:** `retractLoreOf` takes the notes of deleted rows. That covers `deleteLegacy` and `deleteLegacyWhere`, and so `retakeTurn`.
- **`runtime/host.ts`:** comment only.
- **`runtime/transcript.ts`:** `sceneOf` keeps `notes: string[]`.
- **SDK `core-catalog/src/shared/summarize/summarizeScene.ts`:** `DEFAULT_TRANSCRIPT_TEMPLATE` gets a "Noted in this scene:" line with `- {{{this}}}` items, after the name/place/date line. Lair's template is untouched. **Needs `sdk:build`.**
- **Tests:**
  - `sceneNotes.int.test.ts` gains a `takeSceneNotesAt` group;
  - new `transcript.sceneNotes.test.ts`.

## Tests
- Green: `sceneNotes.int`, `transcript.sceneNotes`, `transcript.castNames`, `liveScenes.rewind.int`, `state/write.int`, `retractCastVersions.int`, `sessions/settle.int`, `sessions.retake.int`, `sessions.retractAnnounce.int`.
- SDK `summarizeScene.test.ts`: 11/11, run from source.
- `tsc`: clean.

## Names for hist-F
`takeSceneNotesAt`, `restoreSceneNotes`, `SceneNotesTaken`, `RetractedState.sceneNotes`.

## Noticed, not done
- No `retakeTurn` test exercises notes directly.
- The new test file isn't prettier-formatted.
