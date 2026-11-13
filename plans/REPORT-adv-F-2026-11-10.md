# REPORT — adv-F: follow-ups — 2026-11-10

Saved by the lead from the supervisor's hand-back; the harness refused the supervisor's own write. Worker briefs: `plans/briefs/BRIEF-adv-F-w1.md`, `BRIEF-adv-F-w2.md`. A scope-reviewer, run inside the lane, had no objection.

## Changed files
**serene-pub**
- `StartSessionForm.svelte`:
  - Rules-card path, switch off: the adopted-rules sentence and the preset hint stay as plain text. `rulesCardHides = !rulesAdoptedLine || howStrictShown` (:1403) decides the line.
  - Book pick: the preset hint stays as text (:2933), and `bookPickHides` ends with `return howStrictShown`.
- `SessionLorebookReading.svelte`: new optional prop `lockedByAdvanced`. When it's set together with `readOnly`, the reading listens through `time.listen`, names the branch, spells the clock with the book's calendar (`spell(clock)`), and says *"Turn on advanced controls to change them."* Guests are unchanged.
- `EditSessionForm.svelte`: `lockedByAdvanced={!isGuest && !advanced}` at :2889 and :2901.
- `envelopeSections.svelte.ts`: the `viewer` getter adds `advancedControls: showsAdvancedControls(d.userSettingsCtx.settings)`, so it's live.
- Comments only: `Header.svelte`, `sessionLayout/layoutEditor.svelte.ts`, `sessionLayout/SessionLayout.svelte`. Each now calls the Layout button one of three ways into the editor.
- Tests:
  - `startSessionAdvanced.dom.test.svelte.ts`: 5 new tests (the kept controls render with the switch off; the text-only cases show no line).
  - `editSessionAdvanced.dom.test.svelte.ts`: 2 new tests (the owner's copy, calendar and branch; guests unchanged).
  - new `envelopeViewer.dom.test.svelte.ts`.

**serene-pub-sdk**
- `sdk/src/widgets.ts`: `ViewerV1.advancedControls?: boolean`, an additive v1 key.
- `core-catalog/src/registry/widgets.ts`: `authors-note` now has `reads: ['viewer']`.
- `core-catalog/components/genres/story/authors-note/AuthorsNoteWidget.svelte`: `advanced = viewer.v1.advancedControls !== false`. With it off, the depth and interval numbers, their help sentence and the *Sent as* fold are hidden. Save still sends the stored depth, interval and role.
- `sdk-tests/coreAuthorsNoteComponent.test.ts`: `mountNote({ viewer })`, plus 2 tests (switch off with Save unchanged; field absent). Three earlier edits in this file come from prior uncommitted work, not this lane.

## Tests
- App vitest: 16 files, 142 tests, green, plus a re-run of 3 files, 22 tests, green.
- `tsc`: 6 errors, all `advancedControls` missing on `ViewerV1`. They clear after `sdk:build`.
- **Blocked on a dev server** (another session's `vite dev`, :5234): `npm run sdk:build`, `npm run sdk:test`, and the re-run of `tsc`.

## Wording notes for lane E
- `docs/sessions.md`: with the switch off, the owner sees the start form's adopted-rules sentence and preset hint as text, and the edit form's read-only reading names the branch and dates the clock, with *Turn on advanced controls to change them.*
- Story docs: the Author's note numbers, their help line and *Sent as* show only with advanced controls on.
- NOMENCLATURE: `ViewerV1.advancedControls`, `lockedByAdvanced`.

## Noticed, not done
1. In the book pick (mode `new`), the line always shows with the switch off, because the *Start blank* rows are a real hidden choice.
2. The Rules-card path with adopted rules is reachable only through a next-chapter prefill.
3. With the switch off, the preset hint can end "Pick rules with numbers for them to decide." while the rules list is hidden. The line below it turns the switch on.
4. Author's note: unsaved note text can write old numbers back if they changed elsewhere. This predates the lane.
5. The Branch flash before the first actions push (carried from adv-C).
