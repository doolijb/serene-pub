# REPORT — lane `perf-C` — lorebook saves cost one entry, not one book — 2026-11-13

**Lead as acting supervisor** (Opus supervisors were refused upstream at launch time); two Sonnet workers built it:
`plans/REPORT-perf-C-w1.md` (server) and `plans/REPORT-perf-C-w2.md` (client). Nothing committed.

## Built (BRIEF-perf-C.md steps)

| step | state | note |
|---|---|---|
| 1 `syncLorebookBindings` scans one entry | built | optional `entry: { content }`; lock and issued-tag read unchanged; full scan remains the default for every other caller; test proves same minted rows |
| 2 no full relist after a single create/update | built, two deviations | the targeted event now carries the list-shaped row (`toListRow`, incl. embedding triple and `keptImprints`); the **owner's** trailing `entries:list` is skipped. **History keeps it** (`unfiledSceneCount` depends on other rows). **Shared-book readers still get `entries:list`** (the targeted event goes to the owner only), so readers receive exactly what they did. |
| 3 client keyed rows | scoped down by lead | no `SvelteMap` rewrite (22 call sites; one targeted update is now one assignment). `handleEntryUpdated` keeps untouched types' array references; `handleVectorized` coalesces a burst into one assignment per animation frame (`patchEmbeddings` beside `patchEmbedding`, unit-tested). |
| 4 `lorebooks:list` counts | built | one grouped `count(*)` replaces the per-book entry load; **the unread id arrays `worldLoreEntries` / `characterLoreEntries` / `historyEntries` are removed from the wire** (D4 verified: no reader in `src/lib/client` or the SDK core-catalog; one int test moved to `entryCounts`). A wire-field removal: recorded for the owner below. |
| 5 reorder in two statements | built | two `UPDATE … FROM (VALUES …)` in the existing transaction, `tx` only; repeated id keeps its last position |

Changed files: `src/lib/server/sockets/entries.ts` (afterWrite, relistEntries, reorderEntries, `toListRow`),
`src/lib/server/sockets/lorebooks.ts` (syncLorebookBindings, `lorebooks:list` builder),
`src/lib/server/sockets/lorebooks.everyCapability.int.test.ts` (moved to `entryCounts`), new
`src/lib/server/sockets/entries.singleSave.int.test.ts`, `src/lib/client/lorebooks/LorebooksWorkspace.svelte`,
`src/lib/client/lorebooks/bookPatches.ts`, `bookPatches.test.ts`. All inside Files owned.

## Tests

Server: 13 files / 105 tests green (the brief's five, the binding/cast tests, the new single-save test with its three
cases). Client: 4 files / 51 tests green plus the two `patchEmbeddings` unit tests. `tsc` clean on the touched files.
Prettier: new files clean; `entries.ts`, `lorebooks.ts`, `bookPatches.ts`, `bookPatches.test.ts` already failed
`--check` at HEAD and were not reformatted.

## Measured

One entry save in a 20-entry type with one vector: **12,516 → 676 bytes** on the owner's wire (old targeted row +
full list, vs the list-shaped targeted row alone). Client derived runs per update: 12 → 6; per burst of N vectorised
items: 6N → 6.

## For the owner

- **★P13 (new):** `lorebooks:list` no longer carries `worldLoreEntries` / `characterLoreEntries` / `historyEntries`
  (arrays of `{id}` per book). Nothing read them; `entryCounts` carries the counts. ★ Recommend: keep removed. If a
  plugin could have read the list payload, say so and the arrays go back behind the grouped count.
- ★P6 (the `embedding` vector on the entries wire) untouched; still open.

## Noticed, not done

- `lorebooks:list` still loads `lorebookBindings` ids per book; a grouped count would do.
- No test covers the component's rAF flush itself (the coalescing helper is unit-tested).
- Shared-book readers still receive the full relist per save; dropping it needs the targeted event relayed to readers
  as them (per-reader payload), which the brief put out of scope.

## Lead's acceptance note (after scope review)

Scope review: no objection; one low finding, fixed by the lead: a vector report queued for the next frame could land
after a same-frame `entries:update` that had cleared that row's vector. `settleVectorized()` now applies the queue
synchronously at the top of `handleEntriesList`, `handleEntryCreated` and `handleEntryUpdated`, so the order is the
socket's again. Recorded narrowings (lead's, in the worker briefs): the issued-tag read still runs on every save
(only the content scan was narrowed); `buildLorebooksList`'s book-row select was not narrowed to explicit columns.
