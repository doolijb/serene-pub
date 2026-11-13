# REPORT playtest2-S3-w2

Status question: none relayed. All work done.

## Changed
- sections/HistoryRowMenu.svelte: `unfiled = Number(source?.unfiledSceneCount)||0`, `canCompile = scenes.length>0 || unfiled>0`; button disabled/title ("Capture scenes first" only when neither).
- sections/HistorySceneList.svelte: `unfiled` derived; empty paragraph shows "{n} scene(s) not yet compiled for this day." when unfiled>0, else today's sentence; the single Compile to Entry button now sits after the if/else and shows when `scenes.length>0 || unfiled>0` (non-empty branch unchanged, button just moved out of it).
- time/DatedEntryPanel.svelte: `unfiled` derived; Recompile enabled on `scenes>0 || unfiled>0`; three titles per brief; italic paragraph shows the not-yet-compiled sentence when unfiled>0.
- New tests: sections/historyCompileGate.dom.test.svelte.ts (7 tests), time/datedEntryCompileGate.dom.test.svelte.ts (4 tests). Names match the existing dom glob (vitest.config.ts:31).

## Tests
Exact command from the brief: 3 files passed, 27 tests passed (historyEntries.test.ts included). Log: /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest2-S3-w2.log. (First run had one failing assertion of mine, a selector; fixed.)
Prettier: both new tests clean; HistoryRowMenu and HistorySceneList clean; DatedEntryPanel.svelte fails --check, but the diff includes lines I did not touch (History span ~:93, the `{#if !readOnly}` indentation ~:195); my changed lines match prettier's output. Not reformatted.

## Read-only findings
- EntryWorkspace.svelte:803 `openCompile` refuses/hides nothing for an entry with no scenes; it only reads the activity and sets compileTarget/compileOpen.
- TimeLens.svelte:479 `recompile` only needs `selected`; no scene check. `selected` (:192) is the `entries` row itself, so extra fields (unfiledSceneCount) survive to `source` in DatedEntryPanel (TimeLens.svelte:~820 passes it as source).
- CompileHistoryEntryModal.svelte: no scene-count gate (grep: only content-length checks at :101, :135); startCompile (:205-217) emits `scenes:compile` with the entry id, branch, moment.
- Row reaching HistoryRowMenu/HistorySceneList: `source`/`entry` are the PoolSource rows (HistoryRow passes `source`), so the field survives; not verified end to end against worker 1's server field.
- Server side of `scenes:compile` for zero filed scenes was not read (out of scope).

## Decisions
- HistorySceneList: one button for both branches (placed after the if/else), as the brief preferred.
- Tests mock `./poolContext`, typedSocket, and LoreContentField (the latter for DatedEntryPanel).

## Noticed, not done
- DatedEntryPanel.svelte is not prettier-clean before my change (see above).
- DatedEntryPanel logs svelte `binding_property_non_reactive` warnings in tests because the draft passed is a plain object; harmless, test-only.
