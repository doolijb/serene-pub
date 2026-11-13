# REPORT m2e-F-D (2026-11-04)

(Saved by the lead from the supervisor's hand-back.) Items 0–4 built; 11 files / 102 pass in the final grouped run.

## New pin values (old → new)
- story-create: SDK `sdk-tests/writes.test.ts` `12c47aecb2baa0` → **`184ecbc0022b8e`**; app `specHashes.test.ts` `3523048ab5223` → **`184ecbc0022b8e`** (the app pin was already stale: the playtest Story declarations had moved it; both sides agree now).
- lair-create: SDK `lair.test.ts` `94639a590b82b` → **`a5f9511302c15`**; app the same.
- SDK golden `coreCatalog.test.ts` `680a98aec32065c7` → **`2660c8befd5557df`**.
Proven: reverting the five strings hashed back to the old values. No dev server during any build.

## Contract for F-C
`lorebooks:list` rows and the `lorebooks:get` lorebook carry **`readOnly?: true`** — exactly for a primer row (kind `starter_kit`, its own genuine provided mark, owner present); same meaning as a shipped prompt's `readOnly`. (Lead's late item: becomes `readOnly?: { pluginName: string | null }` in the resumed run.)

## Item 0 — the session-creation regression (fixed)
Not a wrong-handle call site: `checkSessionAccess`'s default handle was bound to the REAL database inside every int test. The mock's `importOriginal` boots the real `db/index.ts`, which runs `sync()` from `./defaults`; playtest2-C's `db/defaults.ts:9` static import of `connections/localOnnxConnections` (13:19 today) reaches `localModels/onnxRuntime.ts:35` → the `$lib/server/utils` barrel → `media/index.ts` → `media/access.ts` → `utils/sessionAccess.ts`, so every module on that chain bound `$lib/server/db` to the real module before the mock. Fix (the barrel's `./appDataDir` precedent): `isAndroidWrapper` moved to a new leaf `src/lib/server/utils/androidWrapper.ts`; `utils/index.ts` re-exports it; `onnxRuntime.ts` imports the leaf. No static path from `defaults.ts` to `sessionAccess.ts`/`media/access.ts`/`utils/index.ts` remains. A lazy dynamic import in `checkSessionAccess` would NOT have fixed it (the mocker decides by the import call stack — likely the same effect behind the "defaultDb() bypasses vi.mock" memory). All twelve files pass alone after the fix.

## Item 1 — headings
`core-catalog/src/registry/genres.ts`: `group: "Reply"` → `"Writing"` (lines 129, 174: `CHARACTER_DETAIL_FIELD`, `AUTHORS_NOTE_FIELD`); the Lair's `group: "Story"` → `"Lair"` (1104, 1129, 1147). No others in core-catalog or `exposure.ts`. `registryHashes.test.ts` untouched (nothing there moved).

## Item 2 — primer rows read-only
`plugins/providedMarks.ts`: **`primerRowEditRefusal(pluginName|null)`** (_This starter lorebook comes with the pub: clone it to make your own._; a plugin's row names the plugin) · **`primerRowEditProblem(db, lorebookId)`** (the one decider; takes the db/tx it is given, no static db import). Doors refused right after their ownership check: `sockets/lorebooks.ts` (update incl. settings/Rules/write mode/cover, binding create/update, member face upload, resolve-or-create when it would create, import-resolve overwrite) · `entries.ts` (copyFromLibrary, create, update incl. archive, setMarks, delete, updatePositions, iterateNext, settleImprint) · `starterKits:saveFromBook` · `narrativeGraph.ts` (10 write handlers) · `lorebookStoryTime.ts` (setCalendar, setClock) · `lorebookState.ts` (write branch of `scoped()`) · `amendments.ts` (8 sites) · `bindingSuggestions.ts` (ignore/unignore/add) · `scenes.ts` (create/update/delete/process). Left alone: reads, `lorebooks:duplicate`, clone, `lorebooks:delete`, `lorebooks:share`; syncs, `library/writes.ts`, the host and admin disable/enable unaffected. No new call inside a `db.transaction` callback.

## Item 3
`otherRulesListsOf` already sends only held lists; unchanged.

## Item 4 — triage (each file alone after item 0)
All twelve lorebook/session files pass (cause: item 0; `avatarAndCover` via `media/access.ts` on the same chain). Still red, another programme's: `pipelines/boot/registryHashes.test.ts` (`core:task/sweep-duties@1` recorded `1eb9149e0bda84`, code `3f6880c7be729` — playtest2-S removed the `summary` duty, `contracts/src/tasks.ts:5250–5290`, re-pinned specHashes but not this) · `pipelines/registrations/resolve.int.test.ts:128` (expects `ask`, retired from Story) and `:238` (`summary: "full"`).

## Changed files
Lead-level: `src/lib/server/utils/androidWrapper.ts` (new), `utils/index.ts`, `localModels/onnxRuntime.ts`. w1: `../serene-pub-sdk/core-catalog/src/registry/genres.ts`, `sdk-tests/{coreCatalog,writes,lair}.test.ts`, `src/lib/server/pipelines/boot/specHashes.test.ts`. w2: `plugins/providedMarks.ts`, `shared/sockets/types.ts`, `sockets/{lorebooks,entries,starterKits,narrativeGraph,lorebookStoryTime,lorebookState,amendments,bindingSuggestions,scenes}.ts` (additive), `plugins/primerRowReadOnly.int.test.ts` (new). Worker briefs `plans/briefs/BRIEF-m2e-F-D-w{1,2}.md`.

## Tests
Final: 8 item-0 files + `primerRowReadOnly.int` + `rulesLists.int` + `specHashes.test` = 11 files, 102/102; `tsc` clean on the item-0 files and `providedMarks`. w2: `primerRowReadOnly.int` 9/9; regression run 83 files 768/768. w1: the three SDK files 121/121; the rest of `sdk-tests` in chunks under a 3 GB cap (one all-at-once run was OOM-killed); `deriveDontSpell` the only failure (speech). App `specHashes` 2/2.

## §25 text (🚧) — written by F-C
`primerRowEditRefusal(pluginName)` · `primerRowEditProblem(db, lorebookId)` (not a permission check: the owner is the owner; never called by the syncs or disable/enable) · `readOnly` on the lorebook row (not `bookAccess`) · **Writing** / **Lair** headings.

## Open ★
- **★F-D-1** a primer row can still be attached to a session directly by its owner admin (`sessions.ts:236` `checkLorebookOwnership` → `findOwnedBook`); pipeline lore writes there would edit the primer and the scene doors now refuse. Recommend: refuse a NEW attach of a primer row with the same sentence (a session already reading one keeps it, as with disabled books).
- **★F-D-2** `lorebooks:share` of a primer row allowed (not an edit — keep); `lorebooks:import` overwriting a primer row by uuid is not refused (only the resolve overwrite is) — recommend refusing it too.

## Noticed, not done
A guard test on the import graph (no static path from `db/defaults.ts` to the access reader) would catch the next one · `lorebooks:duplicate` copies `extra_json.provided` (inert: the uuid no longer matches) · prettier warns on `providedMarks.ts` and the three SDK test files (not reformatted) · `deriveDontSpell` fails in the SDK (speech).
## Queued for the playtest programme
Re-pin `core:task/sweep-duties@1` in `registryHashes.test.ts`; update `resolve.int.test.ts:128` and `:238`. (Sent by the lead.)

## Addendum (resumed run): the two late items
- `readOnly?: { pluginName: string | null }` on `lorebooks:list` rows and `lorebooks:get` (`null` = core, "the pub"; else `plugins.name`, falling back to the id). `primerRowEditRefusal(pluginName)` now a pure function in `src/lib/shared/lorebooks/primerRow.ts`, re-exported by `providedMarks.ts`; new 🚧 `providedOwnerNames(db, pluginIds)` (one batched name read; not `providedOwnersPresent`). `sockets/lorebooks.ts`: one batched lookup in the list, one in `buildLorebookGet`. Tests `primerRowReadOnly.int`, `providedPrimers.int`, `providedBooks.int`, `lorebooks.bookSettings.int`: 61/61.
- **Client fix needed** (done by the lead): `starterKitCards.ts` `isReadOnlyBook` was `=== true` (now never true) → `!!book?.readOnly`; `primerRowLine` → the shared `primerRowEditRefusal(book.readOnly.pluginName)`.
