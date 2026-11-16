# REPORT — lane `time-t5b` (2026-11-15): Beginning and Decay defaults for entries a session creates

Saved by the lead from the supervisor's report. **Built, except the genre override** (stopped under the brief's
stop-and-ask: ★T5B-1). No migration.

## Inventory (line numbers from before the edits)

1. `EntryShape` (`sdk/src/descriptors.ts` ~3242–3268, `assertEntryShape` ~3359) had no defaults. Core's five
   types: `core-catalog/src/registry/entries.ts` (104, 154, 205, 358, 478). A ruleset's types:
   `rulesetEntryTypeDecls` (`rulesets.ts` ~801) from `RulesetEntryTypeDecl` (`rulesetSections.ts` ~349) or the ⏳
   `RepertoireProps` (`repertoires.ts` ~381). The app reads types through `entries/declarations.ts`
   `readRegistry` ~76. The host's create case `host.ts` ~11798; one insert (~12164) serves both routes
   (`sessionLoreWriteTo` ~1630).
2. No genre override exists. `uses.entryTypes` (`genres.ts` ~255) is fit expectations keyed by tag with `label`
   and `why` required (`fit.ts` ~472); core's types have no tag, so it cannot name them.
3. Outlet params: `slots.params.schema` (`outlets.ts` ~1829–1841), reach the host as `p.params`; a param cannot
   be wired from a port, so model output cannot reach them; a preset can set them.
4. "Began": `sessionReadingOf(...).moment` (`state/reading.ts` ~331), day grain, null with the Timeline off;
   stored through `entryInsert` (`utils/lorebookEntries.ts` ~421). History files onto its day; untouched.
5. Fold: imprint re-key `foldInParent.ts` ~1180–1210; the amendments copy (`tableRegistry.ts` ~786) kept no map.

## Built

- Rule: per field, the step's params win over the entry type's default; with neither, perpetual and Decay 0.
  Applies wherever a session creates an entry, in every write mode, on both routes; Apply carries the values.
  Timeline off or no story date leaves only the Beginning unset. A match, a history day, a person's create, an
  import, a duplicate and a starter are untouched.
- Core's types: World lore, Character lore, Place perpetual, 0; Item begins at the session's date, 0; History
  declares nothing. No "slow" number chosen.
- The fold re-keys `version` records through a new `IdMaps.amendments`.

## New published names (all 🚧 `@experimental`)

- `EntryShape.defaultBeginning: 'perpetual' | 'began'`, `EntryShape.defaultDecayRate`; the same two on
  `RulesetEntryTypeDecl` and the ⏳ `RepertoireProps` / `RepertoireDecl` (absent when unstated: ruleset hashes do
  not move).
- Repertoire finding reason `bad-entry-default`.
- Params `defaultBeginning`, `defaultDecayRate` on `core:outlet/create-lore-entry@1`.
- Content hashes of core's four types and of the outlet moved under `@1`; re-pinned in
  `sdk-tests/entryFields.test.ts` and `pipelines/boot/registryHashes.test.ts`.

## Changed files

SDK: `sdk/src/descriptors.ts`, `rulesetSections.ts`, `repertoires.ts`, `rulesets.ts`;
`core-catalog/src/registry/entries.ts`; `contracts/src/outlets.ts` (params, a "Beginning and Decay" JSDoc
section, the JSDoc fixes queued by `time-t5a`); new `sdk-tests/entryDefaults.test.ts`; `entryFields.test.ts`;
`guides/rulesets.md`, `guides/writing-lore-from-a-pipeline.md`.
App: new `src/lib/server/lorebooks/entryDefaults.ts` (`newEntryTime`, `checkStepDefaults`,
`entryTypeDefaultsLayer`, `entryTypeSentenceName`) + test; new `runtime/host.entryDefaults.int.test.ts`;
`pipelines/runtime/host.ts` (create case); `lorebooks/tableRegistry.ts` (`IdMaps.amendments`);
`lorebooks/foldInParent.ts` + int test; `tableRegistry.versions.int.test.ts`;
`pipelines/boot/registryHashes.test.ts`; `docs/lorebook-time.md`, `docs/lorebooks.md`, `NOMENCLATURE.md`.

## Verification (lane's)

`sdk:build` 2026-11-15 11:14. `sdk:test` 4742: the four known failures (a fifth, `CREATE_PIN`, moved on purpose
and was re-pinned). Targeted: 165/165, 51 (+1 skipped), 21/21 + 110/110. Wide (`lorebooks`, `runtime/host.*`,
`registryHashes`): 68 files, 671 pass, 1 skipped. `tsc` 0. `npm run check` 0 errors.

## Open ★

- ★T5B-1 where a genre's override lives. Recommended: one new optional `GenreDecl` field, items keyed by a core
  entry type (the declaration, stored as its id) or a repertoire tag, each with the two values. Trade-off: a new
  field on the `@public` `GenreDecl` and in plugin manifests' genre validation. Until ruled, the host passes no
  genre layer and the docs name none.
- ★T5B-2 copy: param labels *New entry's beginning* / *New entry's decay*, options *Perpetual* / *Began at*,
  three step refusals.
- ★T5B-3 a step's `defaultDecayRate` on a History write is neither applied nor refused (waits on the History
  question).
- ★T5B-4 the reason name `bad-entry-default`.

## Noticed, not done

- `entries/declarations.ts` could carry both defaults (removes a second registry read).
- `INTEGRATING.md` does not mention the defaults or the params.
- The `fileLore` / `rememberNote` builders take neither param.
- The fold still leaves edit-history rows carrying `amendment_id` on the parent book.
- The "person's new Item" int test builds the row through `entryInsert`, not the socket handler.
- Edited files fail `prettier --check`; nothing was reformatted.
- Process slip: a worker deleted temp dirs with a glob (`/tmp/serene-pub-vitest-foldInParent-*`).

## Scope review and lead fixes (2026-11-15)

Scope review: in scope, no blocking objection, four low findings.

- Fixed: the resolver no longer takes a genre layer nobody can supply (input, test rows, ledger wording); it
  comes back with the change that rules ★T5B-1.
- Fixed: the dated-changes copy is one batched insert again (`.returning`, paired by order), not one per row.
- Left as ★T5B-3: a step's Decay rate on a History write does nothing and is not refused (waits on the History
  question).
- Left as ★T5B-4: the reason name `bad-entry-default` (ruleset sections use `bad-entry-type`).

After the fixes: `entryDefaults`, `foldInParent.int`, `tableRegistry*`, `host.entryDefaults.int`,
`lorebookDuplicate`: 6 files, 55 pass, 1 skipped; `tsc` 0 errors.
