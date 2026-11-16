# REPORT — build lane `timeline-d` — the timeless copy of a lorebook (2026-11-14)

Brief: `plans/briefs/BRIEF-timeline-d.md` (its Corrections rule). Worker briefs `BRIEF-timeline-d-w1.md`,
`-w2.md`; logs `plans/timeline-d-*.log`. Saved by the lead from the supervisor's final message. **Nothing was
looked at in a running app.** No migration, no SDK edit, no `sdk:build`, no new socket event, no commit. Not
edited: `tableRegistry.ts`, the readers, `lorebookDuplicate.ts`, `refusable.ts`.

## Changed files

Server: new `src/lib/server/lorebooks/timelessCopy.ts` (`makeTimelessCopy(tx, { sourceId, branchId, userId,
name })`, `TIMELESS_COPY_NOTES_REFUSAL`) with `timelessCopy.int.test.ts`, `timelessCopy.large.int.test.ts`,
`sockets/lorebooks.timelessCopy.int.test.ts`; `sockets/lorebooks.ts` (the duplicate handler only: with
`timeless` it calls `makeTimelessCopy`, default name *‹name› (timeless)*; a malformed `timeless` is refused;
`requestId` echoed on reply and refusal; the copy is queued for embedding after commit; without `timeless`
unchanged); `shared/sockets/types.ts` (`Duplicate` params `timeless?`, `requestId?`; reply `requestId?`).

Client: `lorebooks/time/TimelineCard.svelte` (+ test); `lorebooks/BookSettings.svelte` (passes `branchId`,
`branchName`, `lineCount`, `sessionNotes`, `onDuplicated`); `lorebooks/LorebooksWorkspace.svelte` (one line);
`components/Layout.svelte` (`lorebooks:duplicate:error` in `HANDLED_WHEN_ASKED_ERROR_EVENTS` only) with
`layoutHandledErrors.test.ts`.

Docs: `docs/lorebook-time.md` (**Setting the switch**), `docs/lorebooks.md`, `NOMENCLATURE.md` (Timeline row,
new §8 row **timeless copy**, one §25 entry).

## The rule as built

"Now" is the head of the line open in the workspace: `readingOf(tx, sourceId, { branch })` with no moment.
The source is read first with the existing readers; `duplicateLorebookRows` makes the copy; only the copy is
flattened, in the corrected order.

Per table (the copy only):
- `lorebook_entries`: entries that read are kept and folded (`toEntryRow` → `entryAt` → `splitUpdate`; anchors
  mapped; `position` never folded), moved to main; a kept entry under a history entry or under an entry that
  goes moves to the top level first; history entries and entries that do not read are deleted.
- `entry_amendments`, `cast_amendments`, `cast_presences`: all deleted.
- `character_versions`: all deleted; each member's version in force goes back in as the base (main, undated;
  hour, personal position, source session and message, valid-from, retire order, lift source all NULL; parent
  and `follows` kept).
- `lorebook_bindings`: history day NULL. A member with no version in force goes (after `deleteOwnedRows`),
  unless a kept row names it (a kept entry's anchor, a link in force, a kept scene's cast, a kept member's
  parent): then it keeps its source base, retire mark included. A named member with no base goes (★T-D2).
- `narrative_relationships`: all deleted; one link per tie goes back in, undated, on main; latest story date
  wins, then nearer line, then higher id; `status` kept.
- `attribute_values`, `attribute_configs`: the book's, members' and places' rows deleted; one row per owner
  and slot in force goes back in, undated, on main; values' `story_clock_*` NULL.
- `owner_sheets` and other polymorphic rows: `deleteOwnedRows` for places and members that go.
- `scenes`: those that read are kept, unfiled, on main, story-clock stamps NULL; the rest deleted.
- `entry_annotations`, `binding_suggestions`: rows naming a gone entry or member deleted (or the example
  cleared).
- `lorebook_entry_vectors`: copied; a folded entry re-embeds by its hash.
- `lore_redlines`: not copied. `lorebook_branches`: all deleted, last. The copy's row: clock and calendar NULL,
  switch off. `state_proposals`: untouched.

## Time for a large lorebook

About 3 s in one transaction (3,000 entries, 400 dated changes, 50 members with 4 versions each, 300 links, 400
stats, 20 history entries, 1 line). The card waits up to 60 s.

## Tests

Supervisor's run: 7 files, 63 of 64 pass; the one failure is the comment ratchet on nine files of other
work. `tsc` 0 errors. Covered: the copy reads as the source read, from main and from the line (hand-written
cases and a seeded property test, 5 seeds); nothing dated survives; every version in the copy is a base; the
source's tables deep-equal before and after; `holdsSomethingDated` false on the copy; socket (param, plain
Duplicate unchanged, shared reader, `requestId` echo, notes refused); DOM (three buttons in order, the open
line sent, opens on its own reply only, no `lorebooks:update` sent, refusal in the card, line sentence only
with more than one line, no copy button on session notes).

## Names, sentences and labels added (all 🚧 — ★T-D3)

Default name *‹name› (timeless)*; refusals *Session notes can't be made into a timeless copy.* and *A timeless
copy needs the line to read: null for main, or a line's number.*; labels **Make a timeless copy**, *Copying…*;
*A timeless copy keeps this one as it is.*; *The copy is made from the line ‹name›.* **Switch off here** is
tonal beside the gold copy button; on session notes it stays gold.

## Open ★

- ★T-D1 Session notes get no timeless copy (the server refuses; **Share as a lorebook** is that job).
- ★T-D2 A cast member with no version in force and no base row is dropped even when character lore is anchored
  to it; the lore is kept and its anchor cleared, so lore private to that member becomes ordinary lore.
  Recommendation: keep that member with its latest version on any line as its base.
- ★T-D3 the copy and names above.
- ★T-D4 A tie that changed over time keeps only its latest version.
- ★T-B6 again: a timeless copy of a starter lorebook is itself a starter lorebook.

## Noticed, not done

- `LorebookActions.handleLorebooksDuplicate` accepts any `lorebooks:duplicate` reply while its own plain
  Duplicate is pending.
- Entry text and fields may hold ids or `{{char:N}}` tags naming dropped rows (Duplicate does not remap them
  either).
- CLAUDE.md's size note for `NOMENCLATURE.md` is out of date.

## Scope review and lead follow-up (2026-11-14)

Scope review: no objection on scope or on the source's safety (every write keyed to the copy; only `tx`; the
order holds against the constraints; the fold is complete; the socket and the card are right). Fixed by the
lead:
1. **★T-D2 closed.** A member a kept row names is kept even with no version and no base (the filter also
   checks `named`), exactly as the source holds it, so lore anchored to it stays its own and its links and
   scene-cast rows are kept. Such a member needs data that is already malformed (a base cannot be removed).
   Test updated: *Ghost C* stays and *Ghost lore* keeps its anchor.
2. The §8 row separates **timeless copy** from the timeless annex keys (`isTimelessAnnexKey`).
Left: ★T-D1 (notes) for the owner; `LorebookActions`' two duplicate handlers should ignore payloads that
carry a `requestId` (not this lane's file); the wording of the two refusals only a crafted request reaches.

## Grouped verification (lead, 2026-11-14)

Run together with `timeline-c`; see that report's section of the same name. Full `vitest run`: 2443 files,
19 fail, none this programme's (the same files as after `timeline-b`). `npm run sdk:test`: 4 of 4723 fail, none
this programme's. `tsc` and `npm run check`: 0 errors.
