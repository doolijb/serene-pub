# REPORT — lane `time-t7b` (2026-11-15): recipe and pure helpers BUILT; the render half is HELD on two names

Saved by the lead from the supervisor's report.

## Built

- `src/lib/shared/lorebooks/lastTrue.ts` (+ test, 40 rows): `storySpanBetween`, `storySpanWords`,
  `lastTrueDate`. Free-form never borrows; a declared calendar borrows by its month lengths and leap day;
  nothing under a day; null for a negative gap or a missing date. Nothing calls these yet.
- `src/lib/server/pipelines/scripts/livingRecallRecipe.int.test.ts`: runs the guide's exact `js` fence through
  the rescore seam (living entry's score falls, a Fact's is unchanged, rate 1 keeps the floor).
- SDK `guides/time.md`: section *Make living entries fade in recall* (a Rescore candidates script pasted in
  Admin › Scripts; floor 0.2; three caveats). Linked from `docs/pipelines.md` and `docs/scripts.md`.
- No `sdk:build` (markdown only). No published name added.

Tests: `lastTrue.test` 40/40; `livingRecallRecipe.int` 2/2; `sdk:test` 4723/4728 (the known four); `tsc` 0.
Not run: `npm run check` (no `.svelte` change), prompt tests (prompt path untouched).

## Why the render half stopped

A shipped layout cannot write `"(3 years ago) ‹text›"` without two new names an admin or plugin author sees:

1. **A data name** for the delta in words: a field on the host's lore row (copied to the allocation `meta`), a
   scope root on `core:var/world-lore@1` and `core:var/history@1`, an optional field on `CHARACTER_LORE_ENTRY`.
   `since` is taken (stat-trail in-port; `HistoryEntriesV1`'s open-scene `since`). Recommended 🚧 `lastTrueAgo`.
2. **A template helper** to join text before `jsonValue` (the app registers `eq ne and or pad isSet json
   jsonValue strokeList layout`; none concatenates). Options: (a) a generic `concat` helper, recommended: the
   words stay in the layout; (b) a `prefix=` option on `jsonValue`; (c) the delta as its own JSON member
   (changes the rendered shape, unmeasured); (d) the assembler pre-joins (breaks the 2026-09-30 ruling).

Cost with (1): a second scope root makes the variable's `sample` an object over both roots and breaks
`scopeRootFor`'s single-root fallback (`entities/variableLayouts.ts` ~1196) for plugin bands rendered through
world lore; that function must pick the value root.

## Inventory (file:line)

- Host read: `pipelines/runtime/host.ts` `entryOverlaysFor` ~5017 (once per book per run, cached ~5014),
  `resolvedOf` ~5038, `entryOf` ~5321; `utils/lorebookEntries.ts` `toEntryRow` carries `decayRate` ~323 and the
  Beginning parts ~324.
- Ranking: `runtime/bindings.ts` `loreFor` ~1044 → `keywordQuery` (`payload: entry`, tokens ~844–847).
- Assembly: `prompt/assemble.ts` `allocate` ~137 (`meta` ~150), `bandValue` ~1287 → `objectByRole` ~226.
- Layouts: `variableLayouts.ts` `renderVariable` ~1213 (~1281), `recordEntries` ~339 (world lore ~706, history
  ~791); character lore `anchoredEntriesOf` ~439 through `anchoredEntries` ~367/730. Shipped rows refresh on
  boot while unedited (`boot/seedVariableTemplates.ts` ~108–150).
- Dates: `reading.moment` (`state/reading.ts` ~374–383) gates the delta; `amendmentsOnLine`
  (`shared/lorebooks/lineReading.ts` ~456); `bookCalendarOf` (`state/storyTime.ts` ~139), one query per book
  per run. No per-entry query.
- Recipe: rescore seam `sdk/src/scripts.ts` ~352, `contracts/src/tasks.ts` ~810, `scripts/chains.ts` ~199; the
  payload carries `decayRate`; `ranking/select.ts` ~362 reads `signals.lastRefRecency`.
- Prompt pins: `measure/promptDiff.int`, `parity/productionParity.int`, `parity/harness*.int`,
  `prompt/assemble.test`, `prompt/characterLore*.test`, `prompt/liquidParity.test`,
  `entities/variableAccounting.test`, `objectVariableLayouts.test`.

## Held until the names are ruled

Host field and calendar load, the `meta` key, SDK scope declarations, the `scopeRootFor` fix, the shipped
layouts, budget counting, rendered-prompt tests and three examples, the Decay help line, `docs/lorebook-time.md`,
the NOMENCLATURE Decay row and §25, the guide's sentence on the delta. **The entry row still says *Stored now;
recall does not use it yet.***

## Open ★

- ★T7B-1 the data name (recommend `lastTrueAgo`).
- ★T7B-2 the join mechanism (recommend a `concat` helper).
- ★T7B-3 budget: count the ~5 tokens of the delta in the candidate (a ranking file) or leave to the layout.
- ★T7B-4 an undated held change that sets content gives no delta (supervisor's decision).
- ★T7B-5 a living History entry uses its own date (lead's decision).
- ★T7B-6 whether the code-default floor layout renders the delta too.
- ★T7B-7 character lore via an optional field would also appear in a custom `{{{json characterLore}}}` layout.

## Noticed, not done

- No `docs/sdk` directory in this checkout; `./sdk/guides/…` links resolve where the docs build maps them.
- `docs/pipelines.md` carries another session's uncommitted hunks.
- The two workers' vitest runs may have overlapped briefly.
