# REPORT — build lane `time-t8b` — *could exist here* and bulk edit (2026-11-15)

Brief: `plans/briefs/BRIEF-time-t8.md` (Builds C and D, with its Corrections). Worker briefs `-w1` to `-w5`; logs
`plans/time-t8b-*.log`. Saved by the lead from the supervisor's final message. **Nothing was looked at in a
running app.** No SDK change, migration, socket event, setting or commit.

## Inventory

- Rows are resolved in `resolveRows` (`LorebooksWorkspace.svelte:557–579`); `rawRows` is exposed at :874. The
  list is `EntryPool`, mounted by `EntryWorkspace.svelte:2265`, which reads `book.rawRows` per door (:308–315).
  Rows dated after the moment are already listed, dimmed (`dimmedKeys` :582–612) and moved to the end
  (`orderByMoment` :616–621). An entry type not loaded yet contributes no rows to the group until its list
  arrives (the group is derived; within a scope the list waits for every door, `poolReady` :712–715).
- Per-row actions: **Pin / Off** `entries:setMarks` (`sockets/entries.ts:1516–1610`; owner or admin; primer
  refused; base row only; returns `heldBy` when a dated change still decides the mark); **Archive, Beginning,
  Decay** `entries:update` → `saveEntry` (:1259–1487; owner; primer :1271; decay :1359; Beginning :1364–1460);
  **Delete** `entries:delete` (:1886–1939; deletes everything filed under the entry, :1910; re-sends the type's
  list after each delete).
- No bulk request exists. Measured with a throwaway int test: about 10 ms per operation on PGlite, so a
  200-entry selection is about 2 s on the server; the per-entry sequence was built. Client re-render per event
  was not measured in a browser.

## Changed files

New (`src/lib/client/lorebooks/`): `couldExistHere.ts`, `bulkEdit.ts`, `BulkTimeDialog.svelte`,
`CouldExistHereGroup.svelte`, `BulkEditBar.svelte` (each with a test), `entryPool.couldExistBulk.dom.test.svelte.ts`.
Edited: `EntryPool.svelte` (the toggles, checkboxes, two mounts); `time/MoveDownTheTreeDialog.svelte` and its
test (additive `entryIds?`, `prefer?`; `entryId` optional — lane t8a's file); `NOMENCLATURE.md` (§8 *could exist
here*, **bulk edit**; §25), `STYLE-GUIDE.md` §6.4, `docs/lorebooks.md`, `docs/lorebook-time.md`.
`LorebooksWorkspace.svelte` and `EntryWorkspace.svelte` untouched.

## Tests

Lane files: 8 files, 83 pass (`plans/time-t8b-sup-1.log`); neighbouring lorebook DOM tests 9 files, 71 pass; a
worker's neighbour run 61 pass; `tsc` 0 errors; `npm run check` 1 error in another lane's file
(`time/beginningDecayRow.dom.test.svelte.ts:65`, lane `entry-form-layout`, since fixed there).

## Names, labels and sentences (all 🚧; NOMENCLATURE §25)

Toggle and group **Could exist here** · *On ‹line›* · *Begins in ‹date›* · **Read from ‹date›**. Toggle and
toolbar **Bulk edit** · *Select ‹name›* · **Select all ‹n›** · *‹n› selected* · *Changing ‹d› of ‹n›…* ·
**Beginning…** · **Decay…** · **Pin** / **Unpin** · **Switch off** / **Switch on** · **Archive** / **Unarchive** ·
**Delete…**. Dialog: *Beginning for ‹n› entries* · *Decay for ‹n› entries* · *Sets when each entry starts being
read. Their other fields stay as they are.* · *Sets how each entry fades. Their other fields stay as they are.*
· **Apply to ‹n› entries**. Move dialog: *Move ‹n› entries down the tree*. Report: *No entry changed.* / *‹n›
entries changed.* · *‹name›: ‹reason›* · *On ‹line›: only Move down the tree… reaches it from here.* · *A History
entry takes no beginning: its date is its own.* · *The entry could not be changed.* · *The entry could not be
deleted.* Delete: *Delete ‹n› entries?* · *‹n› entries filed under them go too.* · *Their relationships,
amendments and edit history are deleted with them. This cannot be undone.* · *Each goes from every line that
reads it, not only this one.* Browser key `serene.lore.couldExistHere`.

## Open ★

- ★T8B-1 With the toggle on, rows that begin later move from the list body into the group (still counted).
- ★T8B-2 A row of a forked line opens read-only in place, inside the group.
- ★T8B-3 The labels and icons, especially **Read from ‹date›** and **Bulk edit**.
- ★T8B-4 History entries of forked lines are left out of the group.
- ★T8B-5 Forked rows are drawn as stored; their own line's dated changes are not applied.
- ★T8B-6 After an action, the entries left as they were stay selected.

## Noticed, not done

A bulk run toasts each refusal (Layout's catch-all) as well as listing it in the bar; `entries:delete:error` is
not in `typedSocket.ts`; refusals carry no correlation id (an editor save refused during a bulk run in the same
tab could settle the wrong request); `DeleteLorebookEntryConfirmModal` is not an `alertdialog`; the per-entry
delete wording does not mention the edit history; the Decay dialog says *how each entry fades* though nothing
reads Decay yet.

## Grouped verification (lead, 2026-11-15, second) — `time-t8a`, `time-t8b` + fix, `entry-form-layout`, `chronicle-timeline`

`tsc` 0 errors; `npm run check` 0 errors (9 old warnings). Full `vitest run` (`plans/lead-full3.log`): 2479 files,
2456 pass, 22 fail; 26,087 tests pass, 28 fail. Of the 22: 19 are the known baseline, 2 are environment
(`audiocpp/packages.v.int`, `net/hfDownload.v`), and 1 is expected until the SDK is rebuilt:
`sessionPage/remoteChronicle.dom` asserts the reworded note (*…no story dates here.*) while the built SDK still
holds the old one. **Held, blocked on the owner's own server** (a suspended `vite preview` on port 4173 holding
his real database): one `npm run sdk:build` and the closing `npm run build`. `sdk:test` passed in the Chronicle
lane before the rewording (4 known failures only).
