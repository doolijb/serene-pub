# REPORT — build lane `time-t8b-fix` (2026-11-15)

Brief: `plans/briefs/BRIEF-time-t8b-fix.md`. Saved by the lead from the supervisor's final message. Five fixes
built; **not looked at in a running app.** No migration, setting, event or SDK change.

- **A refusal goes only to its asker:** `sockets/entries.ts` (`entries:update` through `saveEntry` and
  `entries:delete` echo an optional `requestId` on reply and refusal, the `lorebooks:duplicate` pattern);
  `shared/sockets/types.ts`; `client/sockets/typedSocket.ts` (`entries:delete:error`); `Layout.svelte` (the two
  events joined `HANDLED_WHEN_ASKED_ERROR_EVENTS`, by Edit) + `layoutHandledErrors.test.ts`;
  `EntryWorkspace.svelte` (`writeEntryFields` sends and matches its own id); new
  `sockets/entries.requestEcho.int.test.ts`.
- **A truthful bulk delete, the later rows back in the list, the Decay copy, touch size:** `BulkEditBar.svelte`,
  `bulkEdit.ts` (`withParentOutcome`, `bulkMoveCount`), `EntryPool.svelte`, `CouldExistHereGroup.svelte`,
  `couldExistHere.ts`, `BulkTimeDialog.svelte`, their tests, `docs/lorebooks.md`, `NOMENCLATURE.md`.

Decisions the lane made: the entry form's refusal now carries a `requestId`, so Layout no longer toasts it and
the form says it itself (`notify.error`, title *‹Label› was not saved* with the server's sentence; before:
*Entries Update failed*); *Begins in ‹date›* sits in the row's pick part and **Read from ‹date›** in its controls
column; the filed-under count is given only when every fileable entry type is loaded, else *Entries filed under
them go too.*; a child counts as deleted only if its nearest sent ancestor was deleted.

Tests: supervisor's run 9 files, 99 pass (`plans/time-t8b-fix-sup.log`); all `sockets/entries*.int.test.ts` 24
files, 181 pass; a neighbour run 10 files, 80 pass; `tsc` 0 errors; `npm run check` 0 errors.

Copy 🚧: *Not deleted: ‹parent› was not.* · *Entries filed under them go too.* · *Sets the Decay stored on each
entry. Their other fields stay as they are.*

Open ★: ★T8B-1 (later rows stay in the list; the lead's decision); the entry form's refusal title.

Noticed, not done: `CastWorkspace`, `TimeLens` and `CompileHistoryEntryModal` send no `requestId` and pass no
`matchError`, so a refusal arriving while one of them waits on `entries:update` could still reject it; the move
count fix is covered by a pure test only.

## Grouped verification (lead, 2026-11-15, second) — `time-t8a`, `time-t8b` + fix, `entry-form-layout`, `chronicle-timeline`

`tsc` 0 errors; `npm run check` 0 errors (9 old warnings). Full `vitest run` (`plans/lead-full3.log`): 2479 files,
2456 pass, 22 fail; 26,087 tests pass, 28 fail. Of the 22: 19 are the known baseline, 2 are environment
(`audiocpp/packages.v.int`, `net/hfDownload.v`), and 1 is expected until the SDK is rebuilt:
`sessionPage/remoteChronicle.dom` asserts the reworded note (*…no story dates here.*) while the built SDK still
holds the old one. **Held, blocked on the owner's own server** (a suspended `vite preview` on port 4173 holding
his real database): one `npm run sdk:build` and the closing `npm run build`. `sdk:test` passed in the Chronicle
lane before the rewording (4 known failures only).
