# REPORT — lane `time-t6f` (2026-11-15): Story and the Lair place the knowledge filter; the History-filter warning; stored cast for scenes with no live lines

Saved by the lead from the supervisor's report.

## Inventory

- **Wired.** Story `core-catalog/src/genres/story/respond.ts`: chain `gather.unknownEntries.read` (~757–764),
  `speaker: $.input.speaker`; exclusions into the `retrieval` junction's `on`-branch `eligible` (~1020). Lair
  `lair/reply.ts` `voiceBranch` (the delver's own turn): `unknownEntries` (~420–426), speaker `character:<id>`;
  exclusions into that branch's `eligible` (~482).
- **Not wired, by design** (a narrator's, envoy's or side character's step reads everything): Lair spine
  `eligible` (~1201), Story `narrate.ts`, `look.ts`, `narrateCharacter.ts`, Lair `castellanAction.ts`,
  `buildRoom.ts`, `fileRoom.ts`, `roomAnswer.ts`.
- **C.** The member id is `lorebook_bindings.id` = `scene_characters.binding_id`. Only role `participant`
  counts; a *mentioned* character was not there.

## Statements per reply (nothing marked)

Story 2040 → 2041; Lair 4581 → 4582; prompt byte-identical (sha256 Story `7be63a35…7e7c5`, Lair
`cb880fdd…be593`). C: 0 with no bare closed scene, 1 with one.

## Changed files

SDK: `core-catalog/src/genres/story/respond.ts`, `lair/reply.ts`, `sdk/src/validate.ts`,
`sdk-tests/firsthand.test.ts`, `lair.test.ts` (pin `14fa075cce73ab`, was `c4fe814f1e089`), `coreCatalog.test.ts`
(digest `506cddbac87c5bc8`, was `d997da157b5f16ab`), `guides/genres-presets-and-routines.md`, `INTEGRATING.md`
§1p. App: `sessions/firsthandFilter.ts` (+ tests), `pipelines/boot/specHashes.test.ts` (story-respond
`132e6d51cab887`, was `12007bbfaccef3`; lair-reply `14fa075cce73ab`, was `c4fe814f1e089`), new
`pipelines/runtime/unknownEntries.reply.int.test.ts`, `sockets/sessions.lairUnknownEntries.int.test.ts`, docs
(`pipelines`, `lorebooks`, `genre-story`, `genre-lair`), `NOMENCLATURE.md`.

## Verification (lane's)

`sdk:build` 20:53. `sdk:test` 4761, the four known failures after re-pins. App: 11 files, 115 pass; failures
are the `paramsSlotWiring` ×2 and `allPipelines` "core:oracle/speak" baselines. `tsc` 0; `npm run check` 0.

## Open ★

- ★T6F-1 the node is not optional, so a failure or its timeout fails Story's reply and the Lair's voice. Owner,
  2026-11-15 (later): a global admin debug switch for step time limits is the fallback; behaviour stays.
- ★T6F-2 a closed scene with no live lines and an empty stored cast is left out for everyone.
- ★T6F-3 only `participant` rows count.
- ★T6F-4 new `validate()` strings and names are 🚧.

## Noticed, not done

- `docs/sessions.md` ~544 does not mention History entries.
- `prettier --check` drift in the touched files, likely pre-existing.

Lead: removed a stacked duplicate comment on the `unknown-entries` binding (`bindings.ts`).

## Scope review (2026-11-15)

No objection on scope; placement, the stored-cast rule and the warning verified. Two low findings:

1. The new warning was not documented beside its pair: added to `INTEGRATING.md` §1p and the guide's limit (lead).
2. The stored-cast read runs on every loader call, including the lines-only read that never judges a summary,
   so with all three reads wired a session holding such a scene pays up to three extra statements per reply.
   Not changed (no shipped spec wires `firsthandFor`); **Noticed, not done**: limit `bare` to the scenes the
   call judges.

## Grouped verification (lead, 2026-11-16)

- Full vitest run 9 (`plans/lead-full9.log`): 2,514 files, 25 failed. 21 are the standing baseline; the 4 new ones were pinned expectations that the two lanes moved on purpose (`openRenders.test.ts`: Assemble renders `storyCalendar`; `receipts.int.test.ts` and `pipelines.scoping.int.test.ts`: Story places `gather.unknownEntries.read`; `parity/harness.int.test.ts`: History prints as rows). The lead updated the four expectations; rerun of those files: 58/58 (`plans/lead-run9-fix.log`).
- `npm run build`: exit 0. `tsc --noEmit`: 0 errors. `npm run check`: 0 errors, 9 warnings (standing).
