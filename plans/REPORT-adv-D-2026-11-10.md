# REPORT — adv-D: characters and lorebooks — 2026-11-10

Saved by the lead from the supervisor's hand-back; the harness refused the supervisor's own write. Worker briefs: `plans/briefs/BRIEF-adv-D-w1.md`, `BRIEF-adv-D-w2.md`.

## Changed files
- **`characterForms/CharacterForm.svelte`:** one `advanced` derived replaces all five `showAllCharacterFields` reads.
  - Removed the inline *Show all fields* switch, its handler, its hint, and the now-dead `useInterest("userSettings:updateShowAllCharacterFields")` along with its notify.
  - `AdvancedHiddenLine` shows while the switch is off, except on the Stats, Likeness and Speech tabs.
  - Tabs and card versions are untouched.
  - Tests: `cardVersions.dom.test.svelte.ts` (`showAll` → `advanced`); new `characterFormAdvanced.dom.test.svelte.ts`.
- **`lorebooks/sections/EntryAdvancedFields.svelte`:** the whole fold, `extra` included, shows only with the switch on; otherwise the line shows.
  - Tests: new `entryAdvancedFields.dom.test.svelte.ts`, which also checks the stored draft is unchanged. `derivedEntryEditor.dom.test.svelte.ts`'s fixture now has the switch on.
  - History's *Completed* is machine-written (summarizer, Compile; `db/schema.ts:8680`), so hiding it is fine.
- **`lorebooks/BookSettings.svelte`:** `BookRulesCard` and `StoryCalendarEditor` show only with the switch on. The line shows when the page isn't read-only. Writes, the clock and the other cards are kept.
  - Tests: new `bookSettingsAdvanced.dom.test.svelte.ts`.
- **`lorebooks/lenses/registry.ts`:**
  - `lensesShown(advanced)` drops graph and lives;
  - `lensShown(lens, advanced)` falls back to List;
  - `lensForKey(event, advanced)` handles the hidden lenses' shortcuts.
  - Tests: `registry.test.ts`.
- **`LensTrack.svelte`:** a required `advanced` prop. **`LorebooksWorkspace.svelte`:** `lens = lensShown(route.lens ?? DEFAULT_LENS, advanced)`, done at draw time with no redirect or toast; the route keeps naming the lens. `loreRail.dom.test.ts` mounts get `advanced: true`.
  - Tests: new `lensTrackAdvanced.dom.test.svelte.ts` and `lorebooksWorkspace.hiddenLens.dom.test.svelte.ts`.
- **Lead (★adv-D-1):** the Cast board's *See in graph* door is hidden while the switch is off.
  - `PoolMount.svelte` passes `onViewRelationships` only when the switch is on.
  - `CastWorkspace.svelte` passes `onSeeInGraph` only when it gets that callback.
  - `CastRelationships.svelte` makes `onSeeInGraph` optional, and the button needs it.
  - ActivitySidebar's graph-build rows still land on List; they only appear for someone who built a graph.

## Tests
- 44 files, 442 tests, green. `tsc`: 0 errors.
- svelte-check: no errors in this lane's files. The one error, `envelopeSections.svelte.ts:167` (`advancedControls` not on `ViewerV1`), is lane F's and waits on `sdk:build`.

## Wording notes for lane E
- `docs/characters.md:117,123`: *Show all fields*.
- `docs/lorebooks.md`:
  - :69: the fold hides with the switch off.
  - :101: the track has 5 lenses when off; Graph (4) and Lives (6) and their shortcuts are gone, so the numbers have gaps; an address naming either shows List.
  - :119/:123: Book settings' rules and Calendar are hidden.
- `docs/lorebook-time.md:75-96` (Calendar), `docs/lorebook-cast.md:167` (*Show as › Lives*).
- NOMENCLATURE: the implementation helpers `lensesShown`, `lensShown` and the LensTrack prop `advanced` need rows if helpers get rows. `userSettings:updateShowAllCharacterFields` has no client listener now.

## Noticed, not done
- The registry and LensTrack comments ("every lens stands in every book … a control that vanishes teaches the reader the capability does not exist") now sit beside the advanced-controls sentence, and the wording should be reconciled.
- `show_all_character_fields`, its event and its handler have no client reader now. Dropping them is RC1 squash work (★B).
