# REPORT — build lane `time-t8a` — move an entry down the tree (2026-11-15)

Brief: `plans/briefs/BRIEF-time-t8.md` (its Corrections rule; this lane is the inventory and Build B only).
Worker briefs `BRIEF-time-t8a-w1.md`, `-w2.md`; logs `plans/time-t8a-sup-*.log`. Saved by the lead from the
supervisor's final message. **Nothing was looked at in a running app.** No migration, no SDK change, no setting,
no commit. Builds C and D are lane `time-t8b`'s.

## Inventory (file:line)

1. A move writes only `lorebook_entries.branch_id` (schema.ts:9150). Dated changes
   (`entry_amendments.branch_id`, :9397) are applied by their own line (`amendmentsOnLine`,
   lineReading.ts:456–487): they keep applying on the old line and are not read on the target. Line-keyed rows
   (links :5289, stats :10492 / :10594, presences :9508, scenes :4892, which hang only from History entries)
   stay. Embeddings, annotations, held changes and character lore's binding have no line. The edit history has no
   line key (`redlineKeysOf`, redlines.ts:223–241): a move is not recorded. Children (`anchor_entry_id`,
   cascades): `assertAnchorEntry` (anchorEntry.ts ~100–135) requires a parent to be shared or on the child's
   exact line (★T8A-1). `pointedAt` (forkHistory.ts:193–261): every table it lists points at History entries
   (refused) or is a line-keyed row the old line still reads. `lore_imprints`: "standing" is `status =
   'standing'` (imprints.ts:56–62) with `subject_kind = 'entry'`; a made row's take-back compares `branchId`
   (:233), and a kept record's **Revert** deletes the row (:882).
2. A move is allowed exactly when `rowReadsOnLine({branchId: target}, lineOf(source), date)` holds (cuts from
   `lineOf`, lineReading.ts:274–300); then the source line and every line forked from it read as before (tested).
3. Entry names are unique nowhere (only position, schema.ts:9236): no clash refusal.
4. `place` / `unplace` are cast presences; `entries:update` cannot write `branchId` (`splitUpdate`,
   lorebookEntries.ts:724–770); the only other writer of an entry's line is `keepHistoryForForks`
   (forkHistory.ts:131–175). So the move is a new event, `amendments:moveDownTheTree`.
5. For `time-t8b`: rows are resolved in `resolveRows` (LorebooksWorkspace.svelte:557–578); `getBookData().rawRows`
   already holds every line's rows.

## Changed files

Shared: new `src/lib/shared/lorebooks/moveDownTheTree.ts` (+ test), the one rule the server and the dialog use.
Server: new `src/lib/server/lorebooks/moveDownTheTree.ts`; `sockets/amendments.ts` (the handler and one register
line; reuses `announceReadingMoved`); new `sockets/amendments.moveDownTheTree.int.test.ts`. Registries
(additive): `shared/sockets/types.ts`, `shared/sockets/interest.ts`, `client/sockets/typedSocket.ts`,
`shared/sockets/scopedReplies.test.ts`. Client: new `lorebooks/time/MoveDownTheTreeDialog.svelte`,
`time/moveDownTheTree.ts` (+ tests); `time/BeginningDecayRow.svelte` (an optional `lineAction` snippet);
`EntryWorkspace.svelte` (the button, the ⋯ item, one dialog mount); `components/Layout.svelte` (one line:
`"amendments:moveDownTheTree:error"`). Docs: `docs/lorebook-time.md` (*Moving an entry down the tree*; "Nothing
ever merges between lines" amended), `docs/lorebooks.md`, `NOMENCLATURE.md` (§8 **move down the tree**, §25).

## Tests

All pass: `amendments.moveDownTheTree.int` 11, shared `moveDownTheTree.test` 10, `scopedReplies` 55,
`gatedEvents` 29, client `interest` 41, client `moveDownTheTree.test` 3, `moveDownTheTreeDialog.dom` 9,
`beginningDecayRow.dom` 15, `versionRail.dom` 28, `entryWorkspace.versions.dom` 26, `entryZones.dom` 5,
`readOnlyLenses.dom` 12. The int test covers: a perpetual entry to any line below; a Beginning that reaches and
one that does not, across two forks; a child refused without its parent and moved with it; what stays on the old
line reads there and not on the target; every line reads as before except where the entry is added; a second
boot changes nothing; refusals (non-owner, a session's notes, a starter kit, a History entry, a line not below,
a standing per-turn record); `state:changed` to sessions on lines that start reading it. `tsc` 0 errors;
`npm run check` 0 errors.

## Names, event, labels and sentences (all 🚧; code names in NOMENCLATURE §25)

Event `amendments:moveDownTheTree` (`{lorebookId, entryIds, branchId}`; scoped and gated on `lorebookId`; its
`:error` is said inside the dialog). Labels: **Move down the tree…**; *Move ‹entry› down the tree*; *Pick a line
‹line› was forked from. The entry moves there for good.*; *Move to*, *Here now*; **Move to ‹line›** / **Move ‹n›
entries to ‹line›**. Dialog: *Also moves ‹names›: entries filed under one another move together.* · *‹lines›
will start reading it, and so will the sessions playing on them.* · *Its dated changes and links written on
‹line› stay on ‹line›.* · *It can't be moved back.* · *Save or discard your changes first.* Refusals: *‹entry›
is on main, the bottom of the tree.* · *Move entries from one line at a time.* · *‹line› is not a line ‹line›
was forked from. An entry moves only down the tree, toward main.* · *‹entry› is a History entry. History entries
stay on their line, one for each date.* · *‹entry› began at ‹date›; ‹line› left ‹parent› at ‹fork date›.* ·
*‹line› left ‹parent› before ‹entry› began.* · *‹entry› is filed under ‹parent›, which that line does not read.*
· *‹entry› is filed under ‹parent›: move ‹parent› with it.* · *‹child› is filed under ‹entry›: move it with
‹entry›.* · *A session's turn made or changed ‹entry› and can still take it back. It can move once that scene
settles or the change is kept.* · *Entries in a session's notes don't move between lines.* · *Choose the entries
to move and the line to move them to.* · *Move at most 500 entries at once.* · *The entry could not be moved.*

## Open ★

- ★T8-1 (lead) the move is refused while a session's turn can still take the entry back.
- ★T8A-1 Entries filed under one another on the same line move together (parents, and everything filed under a
  moving entry); the dialog names them in one approval.
- ★T8A-2 After a move the reading stays on the old line; the entry area there is read-only with *The entry
  belongs to ‹target›; open it there…*.
- ★T8A-3 With the Timeline off there is no entry area, so **Move down the tree…** sits in ⋯.
- ★T8A-4 A *kept* record of a session having made the entry still has **Revert**, which would delete the entry
  from every line now reading it: should a kept "made" record refuse the move too?

## Noticed, not done

`BranchChip.svelte`'s popover still says "Nothing merges back." (still true); `announceReadingMoved` logs with
the `[amendments:deleteBranch]` tag; with the Timeline off the ⋯ item does not say which line the entry is on;
the dialog test mocks `awaitReply`; focus after a move was not walked; `rawRows` holds only the entry types
already loaded (a child of an unloaded type is caught by the server's sentence); moving History entries, scenes
or cast members needs more than this lane has.

## Scope review and lead follow-up (2026-11-15)

Scope review: in scope (nothing of Builds C or D; one event; no stored value; the shared rule file is accepted);
the server action checks ownership before the transaction, writes only `branch_id` under the book's lock on
`tx`, and the reach rule holds for every case traced. Fixed by the lead (3 files, 47 tests pass,
`plans/time-t8a-lead-1.log`; `tsc` 0 errors):
1. **★T8A-4 closed, the safe way.** A *kept* record of a session having made the entry (no field) never expires,
   and its **Revert** deletes the row with no line check (`imprints.ts` ~882): the move is now refused for it
   too. A kept record of one field stays allowed (its Revert puts back one value). The sentence reads *…It can
   move once that scene settles, or once you keep or revert that change.* 🚧 Test added.
2. Focus after a move no longer lands on a disabled button (it falls back to the ⋯ trigger).
Left for the owner: **★T8A-1** is larger than needed when the target is main (a child may be filed under a
parent on main, so children and siblings need not move there); on any other target it is the smallest safe
rule. Left: the dialog cannot add a child whose entry type is not loaded yet (the server's sentence names it,
but the dialog has no way to include it); `announceReadingMoved`'s log tag.

## Grouped verification (lead, 2026-11-15, second) — `time-t8a`, `time-t8b` + fix, `entry-form-layout`, `chronicle-timeline`

`tsc` 0 errors; `npm run check` 0 errors (9 old warnings). Full `vitest run` (`plans/lead-full3.log`): 2479 files,
2456 pass, 22 fail; 26,087 tests pass, 28 fail. Of the 22: 19 are the known baseline, 2 are environment
(`audiocpp/packages.v.int`, `net/hfDownload.v`), and 1 is expected until the SDK is rebuilt:
`sessionPage/remoteChronicle.dom` asserts the reworded note (*…no story dates here.*) while the built SDK still
holds the old one. **Held, blocked on the owner's own server** (a suspended `vite preview` on port 4173 holding
his real database): one `npm run sdk:build` and the closing `npm run build`. `sdk:test` passed in the Chronicle
lane before the rewording (4 known failures only).

## Walk on a copy of the owner's data (lead, 2026-11-15, later; no model)

Migration 0164 applied cleanly. Seen working: the entry form's new layout (Name and Content beside the rail; the
entry row closed as *On main · Perpetual · Fact · no keywords · top level*, opening to Beginning, Decay,
Keywords, Part of, Pinned, Off); bulk edit (checkboxes, the bar, Pin then Unpin on two entries: *2 entries
changed.*, no toasts); the Chronicle with the Timeline off (the sentence, no clock, the open scene, this
session's scenes, **Open in lorebook** landing on the lorebook's Scenes list); the cast member page's rail;
**Could exist here** (an entry made on a new branch listed from main as *On What if* with **Move down the
tree…**); the move dialog and the move itself (the entry reads on main afterwards; the group empties).
Fixed: the dialog said *…the sessions playing on them* for one line (now *on it*).
Seen, not changed: with the Timeline off the open scene's stored name still ends in its story date (*Scene 4 ·
… · Friday, 2 March, Year 1*); the Chronicle's note still reads *…no dates here.* until the SDK is rebuilt; the
cast member page shows no Save button until something is edited (not checked further). Not walked: Summarize,
the timeless copy on real data, a routine's write landing as a version (needs the model), the clock-moved-back
confirmation (not built yet).
