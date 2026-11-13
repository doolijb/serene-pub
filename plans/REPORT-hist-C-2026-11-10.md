# REPORT — hist-C: SDK teaching and new contracts — 2026-11-10

Saved by the lead from the supervisor's hand-back; the harness refused the supervisor's own write. Worker briefs: `plans/briefs/BRIEF-hist-C-w{1,2}.md`. `sdk:build` was denied by the permission classifier for the lane, so the lead runs it.

## Changed (SDK)
- **`contracts/src/outlets.ts`:**
  - `create-lore-entry@1`: the example is now a room-builder writing locations, plus a section "History is compiled, not written", and history is gone from the `entryType` text.
  - `update-lore-entry@1`: a doc paragraph on history re-dates.
  - **New `noteScene` = `core:outlet/note-scene@1`** (in-ports text/scene/sources, out main, `effects:'write'`, review text, label "Note it in the scene").
  - `update-cast-member@1`: the doc now says `changes` may carry `nodeState` and `nodeVisibility`. Types unchanged.
- **`sdk/src/document.ts`:** new exported `declaredNodeParams(doc, nodeKey)`. Conformance C39 now imports it instead of keeping its own copy, with identical behaviour.
- **`cli/src/compiler.ts`:** the `W_WRITES_HISTORY` warning. Documents with `summarize-request` are exempt.
- **New `sdk-tests/writesHistory.test.ts`.**
- **Descriptions:** `sdk/src/variables.ts` fixes the `current-date@1` description; `core-catalog/src/registry/entries.ts` changes the history JSDoc.
- **Guides:**
  - `writing-lore-from-a-pipeline.md`: "Story events: scenes first", the running-summary fix, and "Advanced: reading what changed, when" (★S5 recipe);
  - `genres-presets-and-routines.md`: "What a summarizer writes";
  - `INTEGRATING.md` §1l.

## Tests
- `tsc` on `sdk-tests`: 0 errors.
- 12 targeted files, run from source: 152/152.
- **Not run:** `sdk:build`, the full `sdk:test`, and the tests that read dist.

## Queued
- **Core `registryHashes.test.ts`, after the build:** the `create-lore-entry@1` hash may move, a `note-scene@1` line is needed, and `current-date` may move.
- **hist-B2:** `note-scene@1` host (binding and case), and the `nodeState`/`nodeVisibility` checker. Open point: does `{follow:true}` apply to them?
- **hist-D:** the conformance law (reuse `declaredNodeParams`).
- **hist-F:** NOMENCLATURE rows for `note-scene@1`, `W_WRITES_HISTORY`, `declaredNodeParams` and the `current-date` fix, and app docs alignment.

## Open ★
- **C-1:** label "Note it in the scene" (avoids "Notes" = session notes).
- **C-2:** "a summarizer writes a scene, held for review" is true of what a person sees, not of the node.
- S3 and S6 remain lead defaults.

## Noticed, not done
- The `varHistory` description says "chat".
- Three long single-line JSDoc paragraphs in `outlets.ts`.
- A tautological `r.ok` check in `writesHistory` case 1.
