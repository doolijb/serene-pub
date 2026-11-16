# REPORT perf-K w4 — boot markers (★P9) and 0158 test (★P8)

Status question: none relayed.

## Changed files
- new `src/lib/server/startup/bootMarkers.ts` (`readBootMarkers`, `writeBootMarker`, `runWithBootMarker`)
- new `src/lib/server/startup/bootMarkers.int.test.ts`
- `src/lib/server/startup/index.ts`: import, `StartupTask.doneMarker`, four `doneMarker`s + one doc sentence each, one call in `runStartupTasks`
- new `src/lib/server/db/indexes0158.int.test.ts`

## Marker keys
`seat-members`, `character-versions`, `deleted-card-members`, `dc-cairns`.

## Re-run by design
Found nothing suggesting any of the four re-runs by design. (The `seat-members` comment ties it to the attic ETL, which restores on the same boot, before the task.)

## Tests (capped scope)
- bootMarkers.int + indexes0158.int: 18 passed.
- Whole done-means set: 170 passed, 1 failed, 2 skipped. The failure is `db/dataUpgrades/0108_layering_registrations.int.test.ts`: the dropped-key list now also contains `speak-message#read-aloud` and `speak-message#say-it-as`. It is unrelated to my files (pipeline/speak-message registrations from another lane).
- `tsc`: no errors in my files. Prettier written on the three new files (all new); `index.ts` not touched by prettier.

## Noticed, not done
- The 0108 test failure above.
- Snapshot tables in bootMarkers test run on an empty-ish migrated DB, so "unchanged" is weak evidence; tasks' real behaviour is covered by their own tests.
