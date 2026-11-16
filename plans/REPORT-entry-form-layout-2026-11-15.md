# REPORT — build lane `entry-form-layout` (2026-11-15)

Brief: `plans/briefs/BRIEF-entry-form-layout.md`. Worker briefs `-w1`, `-w2`; logs `plans/entry-form-layout-*.log`.
Saved by the lead from the supervisor's final message. Built; **nothing was looked at in a running app.** No
server, storage, socket or SDK change; every save assertion unchanged and green.

## What moved where (`src/lib/client/lorebooks/`)

- `EntryWorkspace.svelte`: the zones context gains `entryZoneRow` (~1160); state for the row (~1182–1235):
  `entryZoneRow` (every entries door except History), the open state kept for the current entry only
  (`rowOpenFor`, `entryRowOpen`, `setEntryRowOpen`), `entryRowDisabled` (a form that cannot write the row draws
  it open), `heldFields`, `parentName`, `promotable` (no Part of for a type never filed); the keywords loose end
  opens the row before it focuses (~2058); `entryZone` (~2688): one row holding Keywords, Part of, Pinned, Off
  (each only while it is the entry's), then **Move down the tree…**; the row is drawn after the rail and fields
  (~3027): header, Name, Content, the version's fields, the entry row. Deleted: the four per-field links,
  `versionMark`, the railed Pinned / Off block, `askingSame`. Untouched: `editsToken`, the moment guard, the
  reader's unmounted `VersionDateDialog`, ⋯, `MoveDownTheTreeDialog` and its focus return.
- `time/BeginningDecayRow.svelte` (name kept): props `open` (bindable), `disabled`, `held`, `parentName`,
  `promotable`, `onPromote`; open region: a fieldset with Beginning, Decay and the row's fields (the toggle
  outside it), one **Change from this version…** button that unfolds a group of field buttons, then the line
  *On ‹line›* with its action; opens by itself when the calendar refuses the Beginning; the words truncate with
  the full text in `title` and the accessible name.
- New `time/entryZoneWords.ts` (the closed words). `sections/EntryCoreFields.svelte`: Keywords and Part of draw
  here only when no row holds them (History) or when they differ by version; Pinned and Off that differ by
  version draw here, after Part of. `sections/EntryAdvancedFields.svelte` no longer mounts the row.
  `time/versionZones.ts`: `entryZoneRow`.
- Other editors: Derived, Place, Item, CharacterLore, WorldLore draw Keywords and Part of through
  `EntryCoreFields` (no change); `GenericEntryEditor` gets the row (the workspace mounts it); `HistoryEditor`
  unchanged. With the Timeline off, **Move down the tree…** stays only in ⋯.

## Tests

w1 2 files / 28; w2-a 44; w2-b 53; w2-c 53; supervisor's rerun 4 files / 68 (`plans/entry-form-layout-sup-final.log`);
`tsc` 0 errors; `npm run check` 0 errors. Tests changed where they pinned the old placement:
`time/beginningDecayRow.dom`, `sections/entryZones.dom`, `sections/entryAdvancedFields.dom`,
`entryWorkspace.versions.dom` (plus new tests: document order railed and Timeline off, closed by default, the
closed words, the Change control's list, the keywords loose end, read-only), `entryWorkspace.timeline.dom`; new
`time/entryZoneWords.test.ts`.

## Names and copy (all 🚧; NOMENCLATURE §25)

`entryZoneWords`, `EntryZoneWordsInput`, `VersionZones.entryZoneRow`; code says *entry zone* (an *entry row* is a
list row). Phrases *no keywords*, *1 keyword*, *‹n› keywords*, *top level*, *part of ‹name›*, *pinned*, *off*;
the toggle's accessible name *The entry: ‹words›*; the group *Change from this version* with buttons *Keywords*,
*Part of*, *Pinned*, *Off*.

## Open ★

- ★EFL-1 without the rail, Pinned and Off show both in the row and in ⋯ (recommend dropping them from ⋯ wherever
  the row exists).
- ★EFL-2 the advanced fold's *Pinned, in the ⋯ menu: …* is wrong with the rail; proposed *Pinned: always read
  in, so priority does not apply.*
- ★EFL-3 the accessible name and the closed-row phrases.
- ★EFL-4 with the rail, the version's own heading (its date, **Change its date**, **Delete this version**) still
  sits above Name.

## Noticed, not done

The keywords loose end opens the row but focuses nothing (`KeywordChips` draws its input only while adding);
one run started while another session's vitest was running; on a 1050 px window the closed row may sit below the
fold.

## Scope review and lead follow-up (2026-11-15)

Scope review: in scope; nothing saves differently (a keyword edited in the row goes to the entry; a field moved
with **Change from this version…** goes to the dated change; no value has two live controls in the form; closing
the row drops nothing from the draft). Fixed by the lead (`npm run check` 0 errors; the form, sections and cast
tests pass, 48 files):
1. **The cast board's lore editor had lost Beginning and Decay** (the lane removed the row from the advanced
   fold, which that editor still uses): the fold draws the row again wherever the form has no entry row of its
   own. Test rewritten.
2. **A keyword the server will refuse stayed hidden in the closed row**: the row now opens when a held keyword is
   a runaway regex pattern.
3. ★EFL-2: the advanced fold says *Pinned: always read in, so priority does not apply.*
Left for the owner: ★EFL-1 (Pinned and Off both in the row and in ⋯ on a form without the rail: two doors to one
action, not two writers), ★EFL-4 (the version's own heading sits above Name). Left: the **Change from this
version…** button's `aria-controls` names a group that exists only while open.

## Grouped verification (lead, 2026-11-15, second) — `time-t8a`, `time-t8b` + fix, `entry-form-layout`, `chronicle-timeline`

`tsc` 0 errors; `npm run check` 0 errors (9 old warnings). Full `vitest run` (`plans/lead-full3.log`): 2479 files,
2456 pass, 22 fail; 26,087 tests pass, 28 fail. Of the 22: 19 are the known baseline, 2 are environment
(`audiocpp/packages.v.int`, `net/hfDownload.v`), and 1 is expected until the SDK is rebuilt:
`sessionPage/remoteChronicle.dom` asserts the reworded note (*…no story dates here.*) while the built SDK still
holds the old one. **Held, blocked on the owner's own server** (a suspended `vite preview` on port 4173 holding
his real database): one `npm run sdk:build` and the closing `npm run build`. `sdk:test` passed in the Chronicle
lane before the rewording (4 known failures only).
