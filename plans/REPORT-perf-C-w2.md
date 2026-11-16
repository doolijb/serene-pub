# REPORT perf-C-w2

Status question: none relayed.

## Step 1 counts (by reasoning from the code, no fake-socket test)
Every derived over `bookRows` depends on the whole object, so each `bookRows` assignment in its own socket tick reruns all six once.
- One `entries:update`, before: 2 assignments (update handler, then the relist's `handleEntriesList`), so 12 derived runs. After perf-C-w1 drops the relist: 1 assignment, 6 runs.
- `handleEntryUpdated` also rebuilt every other type's array with `filter` (always a new reference) even with no retype. That invalidated per-type deriveds for all types. Now the untouched types keep their reference.
- Burst of N `vectorization:itemUpdated` for held rows, before: N assignments, 6N runs. After: one assignment per animation frame, so 6 runs per frame.

## Done
- Step 2: `bookRows` NOT converted to a `SvelteMap` (22 call sites; the lead decided this).
- Step 3: added `patchEmbeddings(rows, msgs, sourceKindOf)` in `bookPatches.ts`. It folds `patchEmbedding` in arrival order, and returns null if nothing matched. `handleVectorized` queues messages and flushes once per `requestAnimationFrame`, or `setTimeout(0)` when there is no rAF. `onDestroy` cancels a pending flush. `relationships.embedded` still runs per message, unbatched.
- Step 4: the no-retype path keeps the same array references for untouched types.

## Files
`src/lib/client/lorebooks/LorebooksWorkspace.svelte`, `bookPatches.ts`, `bookPatches.test.ts` (new `patchEmbeddings` tests: burst equals one-by-one with later reports winning; null cases).

## Tests
vitest on bookPatches, bookCopy, castPool and libraryRows: 4 files, 51 tests, green. `tsc --noEmit` shows nothing for `lorebooks/` files. `svelte-check` skipped (not run). `prettier --check`: the Svelte file is clean. `bookPatches.ts` and `bookPatches.test.ts` fail, but both were already unformatted at HEAD (checked via `git show | prettier --stdin-filepath`), so I did not reformat them.

## Noticed, not done
- No test covers the workspace's rAF flush itself. It lives in a Svelte component and I did not add a harness.
- Pre-existing prettier drift in the two `bookPatches` files.
