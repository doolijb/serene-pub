# REPORT — lane `sense-b1` — 2026-11-11 (saved by the lead; condensed from the supervisor's message)

Stage B slice: a pipeline's change to a lorebook entry is held, listed, applied and taken back. All nine items of
the brief built. No stop condition hit; one edit outside the owned files (★B1-2). Five workers, two at a time.

## Migration

`drizzle/0156_nappy_paladin.sql` (idx 156, generated). `entry_amendments`: `year` nullable, `source_message_id` int
(no FK), `base` jsonb, CHECK `entry_amendments_undated_check` (`year IS NOT NULL OR (base IS NOT NULL AND month IS
NULL)`). `lore_imprints`: `origin` text NOT NULL default `'run'` with CHECK (run · routine · press · person · apply ·
book-run · upgrade), `batch` text, `cause` jsonb. No data upgrade: existing amendments have `base` NULL, existing
imprints take `'run'`. Test `db/entryAmendmentsHeld.int.test.ts` (CHECK cases, default, second migrate no-op).

## The rule, for a modder

A pipeline's change to an entry already in the lorebook a session reads is never written into that lorebook,
whatever the write mode. It is kept in the session's own book as a **held amendment** 🚧, which records what the
session read before the change and the message that made it. Only that session, and a branch cut at or after that
message, reads it; a swipe, a regenerate, Back or a delete of that turn takes it, and Forward brings it back. It
reaches the lorebook only when the lorebook's owner applies it: Apply keeps it held when the lorebook changed that
field since; otherwise it folds it in and keeps before and after, so the Apply can be taken back.

## How it works

- **Marker:** an `entry_amendments` row with `base IS NOT NULL`, filed under the holder's own book, naming the
  attached lorebook's entry. By-book readers never see another session's.
- **Holder on the reading:** `LineReading.holderBookId`, set by `sessionReadingOf` (`state/reading.ts`, ★B1-2);
  `entryOverlaysFor` adds that book's held rows; `amendmentsOnLine` applies them last (anchor order, null first,
  then id; dated only at or before the moment; undated always; fork cuts never apply; `amendmentsAheadOnLine`
  never lists one).
- **Write:** `holdLoreEntryChange` (`host.ts`): only keys that differ from what the session reads; `base` the
  value read before; anchor by `turnAnchorOf`; dated at the reading's moment (day grain) or undated; locks the own
  book; nothing written to the lorebook, no imprint, no vector delete, no line fork.
- **Undo:** `retractLoreAnchoredTo` deletes and returns the turn's held rows; `RetractedState.heldAmendments`;
  re-inserted with the same ids on Forward or a failed re-tell. Swipe, regenerate, Back, delete all reach it.
- **List:** `overlayItemsOf` also returns `{ kind: "entry-change", amendmentId, entryId, typeId, title,
  sourceMessageId, changes: [{ field, label, before, after }], conflict }`; existing items carry `kind: "entry"`.
- **Apply:** `applyOverlayItems({ entryIds?, amendmentIds? })` (neither = everything); re-checked in anchor order
  in the transaction; undated updates the entry row; dated moves the amendment onto the session's line (`base`,
  `source_message_id` null; base row untouched); files `lore_imprints` with `origin: 'apply'`, one `batch`,
  `cause: { by: { userId }, sessionId, messageId, amendmentId, key, dated? }`; returns `appliedChanges`,
  `stillHeld`, `batch`.
- **Take-back:** `takeBackApply(db, { batch, userId })`: owner only, all or nothing, refuses in a sentence when
  something stands on it; restores `before` or moves a dated row back; re-inserts the held row with its id and
  anchor; deletes the batch's records. No socket, no UI.
- **Apply records** are never selected by `retractImprints` and never compacted by `compactThrough` (interim, ★B1-4).
- **Branch:** `copyOwnBookToBranch` copies held rows anchored at or before the fork (and unanchored ones), anchors
  remapped.

## Readers

Through the session's reading, no code change, one test each (`state/heldAmendments.readers.int.test.ts`):
retrieval (`host.ts readBook`, `ragContext.ts`), keyword match (`loreMatch.ts`), places, supply, side characters,
graph links, entries workspace. Names vocabulary: `amendedNamesOf(db, book, holderBookId?)`,
`loadVocabulary(…, { holderBookId })`, three `host.ts` sites pass the holder. Explicit `isNull(base)` exclusions
(`heldAmendments.exclusions.int.test.ts`): `utils/lorebookEntries.ts amendmentPatternLayers`, `imprints.ts`
`holds`, `tableRegistry.ts` copy, `utils/forkHistory.ts`, `sockets/amendments.ts` (list, edit, delete),
`state/storyTime.ts` axis. Left as they were: `sockets/lorebooks.ts countIn`, `utils/castTags.ts`.

## Decisions inside scope

1. ★B1-2 `state/reading.ts` edited (outside the list): the holder, one subquery in the session select.
2. A held change is dated at the reading's moment when it has one.
3. History days stay write-through (`writeThrough: true` in `fileOntoHistoryDay`).
4. `create-lore-entry`'s match no longer forks the line; a fork only for an insert, a history day or `links`.
5. `update-lore-entry` result shape unchanged; values for a held change: `lorebookId` the entry's lorebook,
   `route: "own-book"`.
6. `update-lore-entry` resolves over what the session reads; side effect: under Full an own-book entry is now
   reachable (written to the own book).
7. Apply does not move the settle line; Apply records are excluded from retraction by `origin`.
8. A second conflict: an undated held change whose field a dated line amendment decides.
9. Conflicted items have no Apply button. 10. `heldBy` skips a held deciding amendment.
11. New exports: `IMPRINT_ORIGINS`, `ImprintOrigin`, `takeBackApply`, `fieldLabel`, `LineAmendment`,
    `HeldAmendment`, `LineDatedRow`, `HeldDated`. Internal: `holdLoreEntryChange`, `holderBookOf`, `writeThrough`,
    `heldChangeConflict`, `storedAddressOf`, `labelOfKey`, `writeEntryKeys`, `byAnchor`, `lowerFirst`.

## Open ★

- **★B1-1** the name "held amendment".
- **★B1-2** the `state/reading.ts` edit.
- **★B1-3** a press-started run anchors its held change to the newest message, so a swipe or Back of it takes it
  (before, a press wrote through and stood).
- **★B1-4** Apply does not move the settle line (ST7).
- **★B1-5** an undated change a dated line amendment would hide is a conflict, not folded as dated.
- **★B1-6** on a branch line, an undated held change folds into the base row, so every line sees it.
- **★B1-7** "Share to ‹book›" sends Apply with no ids, so it now applies held changes too.
- **★B1-8** take-back UI or socket.

## Provisional copy 🚧

Host refusal: `'‹entry›' keeps its date in the lorebook, and a session's change cannot move it — change it in the
lorebook.` Conflicts: `‹Label› has changed in the lorebook since this session changed it.` · `A dated change in the
lorebook decides ‹label› here, so this change would not show.` Take-back: `Nothing to take back.` · `‹Entry› is no
longer in the lorebook, so this can't be taken back.` · `‹Entry›'s ‹label› has changed in the lorebook since it was
applied, so this can't be taken back.` · `The dated change to ‹Entry› was edited in the lorebook since it was
applied, so this can't be taken back.` Card: `‹Label›: ‹before› → ‹after›`, `empty`. Docs: `docs/lorebooks.md`
(seven sentences), `docs/sessions.md` (one), SDK `guides/storage.md` (a paragraph, a Back bullet, one cell), the
NOMENCLATURE rows (held amendment 🚧, amendment, lore imprint, own book, §25).

## Tests

Lane's final run: 30 files, 423 tests pass; `tsc` clean; `sdk:build` once; no pin moved. New:
`db/entryAmendmentsHeld.int`, `pipelines/runtime/host.heldEntryChange.int`, `state/heldAmendments.{undo,readers,
exclusions}.int`, `sessions/branch.heldAmendments.int`, `lorebooks/heldApply.int`. Rewritten where behaviour moved:
`imprints.int`, `sessions.retraction.int`, `sessions.lairWalk.int`, `rewind.int`, `host.historyWrites.int`,
`loreSources.int` (g). Not run: svelte-check, `sdk:test`.

## Noticed, not done

- Session-scoped vocabulary callers that pass no holder: `annotations/queue.ts:128`, `:310`,
  `utils/sceneMentions.ts:162`, `scenes/liveScenes.ts:1056`, `bindingSuggestions/index.ts:254`, `:663`,
  `annotations/index.ts:1030`.
- A session that switches lorebook keeps held rows naming the old book's entries (unread, unlisted); "Merge ‹book›
  into these notes" likewise.
- Held rows carry no run id (`takeRunWritesElsewhere` does not take them).
- The `sources` path still settles for a held change (ST7).
- `forkHistory` no longer repoints held rows when a history entry is copied onto a fork.
- Docs possibly now false: `docs/lorebook-time.md`, `docs/session-actions.md`, `docs/stats-and-states.md`.
- A PGlite `ENOTEMPTY` teardown race once in `branch.heldAmendments.int.test.ts`.

## For the next Stage B lanes

Copy: one column marks a session's row in a shared table; the holder rides `sessionReadingOf`; turn-owned rows ride
`retractLoreAnchoredTo` / `RetractedState`; Apply's shape (conflict against `base`, anchor order, `origin: 'apply'`
with one `batch` and `cause`, all-or-nothing take-back re-inserting the held row, branch copy by anchor). Do not
copy: the `writeThrough` escape; the exclusion of Apply records by `origin` (interim until Apply settles); the
per-record `cause.key` / `amendmentId` / `dated` shape (entry fields only).

## Scope review and the lead's follow-up (2026-11-11)

Lead's own run before the review: `tsc` clean; 64 files, 818 tests pass. The review found the lane mostly right,
isolation sound (no path to another session, the lorebook's own reading, an export or a copy), ordinary amendments
resolving as before, and raised five points:

1. **A person's edit after an Apply turned the Apply's records into "kept" decision notes**, which could then be
   dropped, making take-back partial. Fixed: `markImprintsKept` and the kept-delete in `imprintField` leave
   `origin: 'apply'` records alone. Test extended.
2. **A "Nothing to share" toast fired after a held change was applied** (`client/contexts/sessionOutcomes.svelte.ts`,
   outside the lane's files; it is the one place that event toasts). Fixed: it toasts only when nothing was
   applied and nothing stays held.
3. **Take-back could re-anchor the held row to a deleted or rewound turn**, leaving it owned by no turn or dropped
   by Forward. Fixed: it refuses — 🚧 `The turn that changed ‹Entry› is no longer in the session, so this can't be
   taken back.` Test extended.
4. **`update-lore-entry` reached own-book entries under Full** (beyond the brief). Fixed: where the write would
   have gone to the lorebook itself, only the lorebook's entries are named, as before.
5. **History-day appends under Full still write through** (`writeThrough`). Left, as the brief put history out of
   scope; it goes with the history/scenes lane. ★B1-9.

After the fixes: `tsc` clean; 31 files, 261 tests pass. NOMENCLATURE §25 path corrected (`sessions/settle.ts`).

Review notes kept for the next lanes: after the original applies a change, a branch's copy of that held change
reads as a permanent conflict (`heldChangeConflict` should treat "the lorebook already reads `after`" as done);
applying only the second of two held changes to one field says "has changed in the lorebook" when the cause is the
session's own earlier change; `recordLoreSources` files a source for a change that was only held;
`entries:setMarks` answers by `lorebookId`, so one person with two sessions of a lorebook open could see one
session's held `enabled` / `constant` in the other (not verified); overwrite losses do not count other sessions'
held changes; the "Share to ‹book›" confirm copy is untrue once a change conflicts.
