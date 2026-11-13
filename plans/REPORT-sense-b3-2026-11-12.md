# REPORT — lane `sense-b3` — 2026-11-12 (saved by the lead; condensed from the supervisor's message)

Stage B, the step before the flip: on the own-book route a session's own book is a complete place to write
entries, places, history days and links. All eight items built; no stop condition; no migration; SDK JSDoc and a
guide only; `state/write.ts` untouched. The route and what Full **writes** are unchanged; Full **reads** differ in
two places, each tested (★b3-4).

"Own-book route": the route is `own-book` and the session reads an attached lorebook (your own lorebook under
Review or Off; a member's session on someone else's lorebook).

## One-book assumptions found → now

- A1 `sessionLoreWriteTo`: also carries `LoreWriteLine.alsoReads` (the attached lorebook and the session's
  reading). Routing unchanged; a `{ notes: true }` filing-tool write never gets it (★b3-1).
- A2 `create-lore-entry` match: own book first, then the lorebook as read; a lorebook hit is a held change.
- A3 `resolveBind`: own book's cast first, then the lorebook's.
- A4 `resolveLoreLinkEnd`: both books, own book first for names; an id may be in either.
- A5 `writeLoreLink` / `linksOnReadingThatWay`: a standing link in either book; tie copies (`rules_run_id`) never
  count.
- A6 `exitsLineLinks`: own-book places first, then the lorebook's. A7 `link-lore-entries`: both ends over both.
- A8 `fileOntoHistoryDay`: dates checked through the lorebook's calendar (`historyEntryOfDate`'s `calendarBookId`);
  the default date counts own-book days. A9 own-book line dating: the newest history day of the two books.
- A10 prompt `currentDate`: counts own-book days for any session with an attached lorebook.
- A11 `loadVocabulary`: with a holder, reads the own book's entries first.
- A12 a press-run link is imprinted at the newest message (as entries are).
- A13 `imprints.ts` `holds`: a link in another session's notes does not hold the entry.
- A14 `forkHistory` `pointedAt` / `linesUsing`: a notes-book link counts only for that book's own history entries.
- A15 take-back "linked": refuses with its own sentence for another session's notes.
- A16 `graphEntryLinks` own-book pass: the session's reading, held changes included.
- A17 branch copy: links copied for an attached parent too, cut at each link's made-imprint message; the branch
  gets its own imprint. A18: `anchor_binding_id` kept for a lorebook member.
- A19 `overlayItemsOf`: also `link` items, and a held day as an `entry-change` item.
- A20 Apply: standalone links move, and links with a lorebook-member end. A21: `anchor_binding_id` kept for a
  lorebook member (★b3-9). A22: an own-book day merges onto the lorebook's day as a paragraph, after re-pointing
  every `history_entry_id` (9 tables). A23: Apply's settle counts link and day anchors.

## Rules, for a modder

Match: own book first; a lorebook hit is a held change; two hits refuse within one book only; `bind` accepts either
cast; Exits link over both. Links: may join the two books, stored in the own book; one either book already holds is
not written again (`written: false`); a tie copy never counts; a session's private link never acts on another
session's undo or on "main uses this day". History days: always the own book's on this route, one per date, dates
in the lorebook's calendar, never a held change; "does the lorebook hold this day" is `lorebookDayOfDate`. Reading:
names, the graph's links, the prompt's current date and this route's write dating read both books;
`writeDatingAt` and `sessionStoryNowOf` are unchanged. A turn owns its entries, days, paragraphs and links,
cross-book included; Forward and a failed re-tell restore them. Press-started runs: entries, new days, links and
held changes anchor to the newest message; a paragraph onto an existing day is not anchored (★b3-6). A branch
copies the notes' links as of the fork. Apply moves a link, merges a day, drops a link the lorebook already says;
every item is recorded; take-back returns a link, and a merged day only while its paragraph is the day's last.

## What `sense-b4` (the flip) still has to change

1. The own book as the only write place: retire `loreWriteRoute`, `loreWriteTargetFor`, `ensureSessionLine` /
   `forkedLoreLine` for these writes; `alsoReads` under Full; the `{ notes: true }` distinction goes.
2. Remove history days' `writeThrough: true` under Full (★B1-9).
3. `ownBookDaysCounted` for all dating on the write path; retire Full's "Both ends of a link live in one book."
4. Full tests that pin write-through: `host.historyWrites`, `host.forkTiming`, `host.ownBookRoute` (the Full
   sentence), `sessions.lairWalk`, `sessions.lairKnock`, `sessions.lairFileRoom`, `messages/loreLinks`,
   `state/sessionLoreWrites`, `lorebooks/imprints.int`, `state/durable`, `state/locations`, `state/ownNotesLine`.

## Provisional copy 🚧

Host: `entry ‹id› is not in this session's lorebook or its notes, so there is nothing here to link it to.`
Take-back: `‹Entry› is linked from another session's notes, so this can't be taken back.` · `The link ‹title› is no
longer in the lorebook, so this can't be taken back.` · `Something was written after this session's paragraph on
‹Day›, so this can't be taken back.` Held day: `A link dated by ‹day› in this session's notes would say the same
thing twice on the lorebook's day, so the paragraph waits.` Card: link title `‹From› ‹wording› ‹To›`; applied item
`‹title› · link` (`Untitled link`). Docs: `docs/lorebooks.md` (five sentences/paragraphs),
`docs/session-actions.md` (one row, one cell), SDK `guides/storage.md` ("The own-book route", the Branch cell).

## Changed files

`pipelines/runtime/host.ts`, `pipelines/runtime/loreMatch.ts`, `utils/relationshipGuards.ts`,
`scenes/historyEntryOfDate.ts`, `annotations/index.ts`, `utils/graphEntryLinks.ts`, `lorebooks/imprints.ts` (entry
`holds` only), `utils/forkHistory.ts`, `lorebooks/ownBook.ts`, `sockets/sessions.ts`, `shared/sockets/types.ts`,
`SessionViewPanel.svelte`; docs and NOMENCLATURE (§25 sense-b3). SDK: `guides/storage.md`,
`contracts/src/outlets.ts` (JSDoc). New tests: `host.ownBookRoute.int`, `annotations/vocabulary.ownBook.int`,
`utils/graphEntryLinks.ownBook.int`, `lorebooks/imprints.otherSessionLink.int`, `utils/forkHistory.ownBookLinks.int`,
`lorebooks/applyTakeBack.otherSessionLink.int`, `sessions/branch.ownBookLinks.int`,
`lorebooks/applyOwnBookLinksDays.int`, `state/ownBookRoute.undo.int`, `sessions/branch.ownBookRoute.int`,
`sockets/sessions.applyOverlayLinks.int`, `sessionViewPanel.ownBookItems.dom`, two blocks in
`scenes/historyEntryOfDate.int`.

## Tests (lane)

New files and applies: 16 files, 153 tests; regression batches 16 files, 201 tests, unchanged; `tsc` clean;
svelte-check 0 errors; one `sdk:build`; no pin moved.

## Open ★

- **★b3-1** filing-tool writes (`{ notes: true }`) do not get the two-book reading or dating.
- **★b3-2** at Apply an own-book link the lorebook already says is deleted with no record (cannot be taken back).
- **★b3-3** when re-pointing a merged day would make a twin link, the whole day stays held.
- **★b3-4** reads under Full: names vocabulary reads the own book's entries; `currentDate` counts own-book days.
- **★b3-5** a pipeline link that exactly twins an own-book tie copy (same words, both undated) hits
  `narrative_relationships_entry_pair_uq` and fails with a raw error.
- **★b3-6** a press-run paragraph onto an existing own-book day has no imprint; a later Back of the newest message
  can lose it (predates the lane).
- **★b3-7** names and copy. **★b3-8** member–member own-book links are copied to a branch of an attached parent.
- **★b3-9** Apply keeps `anchor_binding_id` for a lorebook member. **★b3-10** a moved link dated by an own-book day
  that stays behind is re-dated to the lorebook's day for that date, or undated.
- Carried: ★B1-1, ★B1-3, ★B1-7, ★B1-9, ★b2-1…6.

## Provisional names 🚧

`LoreWriteLine.alsoReads`; optional arguments `findLoreMatch(…, then?)`, `resolveBind(…, also?)`,
`resolveLoreLinkEnd(…, then?)`, `linksOnReadingThatWay(…, alsoIn?)`; `LoreLinkWrite.lorebookId?`;
`ownBookDaysCounted`, `linkAnchorOf`, `copyAttachedNotesLinks`; exported `lorebookDayOfDate`, `calendarBookId`;
payload `OverlayLinkItem`, `OverlayEntryChangeItem.notesEntryId`; Apply input `linkIds`, result `appliedLinks`,
`mergedDays`, `droppedLinks`, `heldDays`; `cause` keys `merged`, `standalone`, `title`, `moved.historyEntryId`.

## Noticed, not done

- `appliedBatchesOf` casts the link item `as unknown as Item` (now redundant).
- `historyDayOwnerRefusal` spells own-book-day dates through the own book's calendar (wording only).
- A lorebook-member end in `graphEntryLinks`' own-book pass is named on the own book's main head.
- `loadVocabulary` does not read the own book's cast members.
- Merging an own day does not re-point `anchor_entry_id` children and cascades links that end at the day.
- `update-lore-entry` resolves lorebook-first; everything else on the route is own-book-first.
- `copyAttachedNotesLinks` copies only own-book links with `branch_id` null.

## Scope review and the lead's follow-up (2026-11-12)

Lead's own run before the review: `tsc` clean; 179 files, 1,646 tests pass. The review confirmed Full's writes are
unchanged (route `book` carries no `alsoReads`; every new argument is absent there), the three by-entry link
readers are fixed and no fourth exists, all nine `history_entry_id` tables are re-pointed, and the lane stayed in
its files. Five points, all fixed by the lead:

1. **Merging a day at Apply deleted entries filed under that day and links ending at it** (both cascade), and under
   "Apply all" a selected child vanished with no record. Now the day stays held — 🚧 `Entries or links in this
   session's notes are filed under ‹day›, so its paragraph waits.` Test added.
2. **"Nothing to share" toast after applying a link or merging a day** (`client/contexts/sessionOutcomes.svelte.ts`,
   outside the lane's files): the toast now counts `appliedLinks`, `mergedDays`, `droppedLinks`, `heldDays`. A held
   day's reason is shown beside its item on the card.
3. **Duplicate each-keys on the card** (a held change and a held day share the kind and may share an id): keys now
   carry the id's kind. A link with no title says "Untitled link".
4. **★b3-5, wider than reported**: a pipeline link twinning a ruleset's own copy raised a raw unique-index error
   (undated) or wrote a second row saying the same thing (dated). Lead's decision, reversing a line of the brief:
   a tie copy **does** count for the write's "already said" check, as before the lane (`written: false`, the tie
   row's id). It is still never listed and never applied. Test 5c rewritten.
5. **The day merge skipped the rule that a day another line owns is not this line's to write**: the merge now asks
   `historyDayOwnerRefusal` and holds the day with that sentence.

Also: SDK `contracts/src/outlets.ts` JSDoc no longer says a link end may be a cast member (no build; the next SDK
build carries it).

After the fixes: `tsc` clean; 113 files, 1,147 tests pass.

Review notes kept: undoing a run that made a lorebook entry cascades away another session's private link to it
with no record (a consequence of the `holds` fix as briefed); take-back of a merged day can leave two own-book days
for one date if the session wrote that date again since; `ownBookDaysCounted` adds queries to every turn's prompt
under Full; the `imprintAnchor` comment at `host.ts` ~2102 is stale; under Full a name both books hold now points
at the notes copy in the names list, and unapplied own-book days move the prompt's date.
