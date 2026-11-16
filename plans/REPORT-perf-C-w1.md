# REPORT perf-C-w1

## Changed files
- `src/lib/server/sockets/lorebooks.ts`: `syncLorebookBindings` takes optional `entry: { content }` (scans that content only; lock and issued-tag read unchanged; no `entry` = full scan as before). `lorebooks:list` builder: per-book entry relation removed, one grouped `count(*) ... WHERE NOT archived GROUP BY lorebook_id, type_id`. Removed two now-unused imports, added `count`.
- `src/lib/server/sockets/entries.ts`: `afterWrite` option `saved` (passes the row to the bindings sync; skips the owner's trailing relist); new helper `toListRow`; create/update emit the targeted event with the list-shaped row; `reorderEntries` is two `UPDATE ... FROM (VALUES ...)` statements in the existing transaction (tx only).
- `src/lib/server/sockets/lorebooks.everyCapability.int.test.ts`: assertions moved from the three id arrays to `entryCounts` / `entryCount`.
- New `src/lib/server/sockets/entries.singleSave.int.test.ts` (3 tests).

## D4 verification
`worldLoreEntries` / `characterLoreEntries` / `historyEntries` as list-payload fields: no reader in `src/lib/client` (hits there are local variables named `historyEntries`) and none in `serene-pub-sdk/core-catalog`. Only reader was one server test (`everyCapability`), updated. Client reads `entryCount` / `entryCounts`, both kept with the same values. So the three arrays are GONE from `lorebooks:list`. Owner: this removes wire fields; if you would rather keep them, say so (it needs the per-row load back).

## Step 2 decisions (please read)
- List-row vs targeted payload: the targeted row lacked `embedding`/`embeddingModel`/`vectorizedAt` (null), and `keptImprints`, and history rows' `unfiledSceneCount`. The first two groups now ride in the targeted event (`toListRow`, one vector read and one imprints read for the row). Test (a) asserts every key of the list row is present on the event.
- `unfiledSceneCount` depends on other rows' dates (a new or re-dated history entry moves scenes between entries), so a single-row event cannot carry it. History type therefore KEEPS the trailing relist on create/update. All other types skip it.
- Readers: the targeted event goes only to the owner (`emitToUser`), so shared readers would lose live updates. I kept the `entries:list` relay to book readers (`relayToBookReaders`) and dropped only the owner's re-send. Same lists any reader receives as today.
- Only the emitted event carries the extras; the handler's reply `{ entry }` is unchanged.

## Tests (all green)
- 5 required files + `lorebooks.everyCapability`, `characters.bindingSync`, `presetBindings`, `sessions.castBindings`, `historyEntries.positions`, `lorebooks.castTags`, `entries.lines`, `entries.singleSave`: 13 files, 105 tests pass. Also `loreEntries.positionExclusion`, `scopedReplies.lorebooks`, `lorebooks.mutationScoping`: 17 pass. No test file name contains `reorder`/`binding` beyond those listed (also `lorebooks.bindingCrossTenantRefs`, `bindingSuggestions` not run: not touched).
- (a) update emits no `entries:list` + payload carries every list-row field; (b) `syncLorebookBindings` with `entry` mints the same rows as the full scan and leaves another entry's tag alone; (c) added: reorder rotation + repeated id.
- Bytes on one entry save (20-entry type, one vector): before 12516 (targeted row + full list) after 676. Measured in the test; "before" is computed as old targeted payload plus the list payload.
- `tsc` filtered to my files: clean. Prettier: new test formatted; `entries.ts` and `lorebooks.ts` were ALREADY not prettier-clean at HEAD (checked via `git show HEAD:` into stdin), so I did not reformat them.

## Open questions
- D4 wire-field removal (above).
- History keeps its owner relist; fine to accept, or carry `unfiledSceneCount` some other way later.

## Noticed, not done
- `lorebooks:list` still loads `lorebookBindings` rows (ids only) per book just for a `.length`-style consumer (tests read it); could be a grouped count too.
- A client-side concern for w2: the targeted create event appends the row; list order for non-order types is id order, which matches append.
