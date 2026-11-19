# BRIEF — worker `kn-6-w1` (server): a knowledge tie play wrote to the notes is offered in Apply

App repo `/home/jody/github/serene-pub`. Supervisor: lane `kn-6` (brief `plans/briefs/BRIEF-kn-6.md`, read its
last section "Cold review corrections"; this brief already folds them in). Another worker (`kn-6-w2`) does the
client rows, docs and NOMENCLATURE at the same time; the shared socket types are **already edited** by the
supervisor (`src/lib/shared/sockets/types.ts`: `OverlayItems.Item.kind` gains `"knowledge-tie"` and `tieId`;
`AppliedBatches.Item` the same; `ApplyOverlay.Params.tieIds`; `ApplyOverlay.Response.appliedTies`,
`droppedTies`, `supersededTies`). Do not edit `types.ts`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (This lane runs no `sdk:build` at all.)

Also: both repos are staged by the lead — run **no git command that changes the index or working tree** (no add,
reset, checkout, restore, stash, commit). Never `prettier --write`. No migration (stop and report if one seems
needed). No `npm run build`, no full test run.

## Owner rulings this builds (quote in comments where a rule is enforced)

- D41 (2026-11-16): "Offer it in Apply" — a knowledge tie play writes while the lorebook is not on Full.
- D39 (2026-11-16): "A hand tie always wins over what play wrote".
- S3 (2026-11-11): "Only Apply settles". NOMENCLATURE *held amendment*: "Apply to the lorebook is the only door."
- P2: "A module owns its data and every write to it … Two writers of one thing is a bug." `lorebooks/entryKnowledge.ts`
  header: "**Owns.** … the **knowledge ties** (`narrative_relationships` rows with a `knowledge_kind`): every write
  to them". So every write to a tie row (move, delete) is a function in `entryKnowledge.ts`; `ownBook.ts` calls it.
- `imprints.ts` ~656: "An applied change is the lorebook's ("Only Apply settles"): no message or run takes it
  back." and ~668: "Gone since, or carried out of the book it was written in (a note applied to the lorebook is the
  person's now): nothing to take back." — a moved tie's imprint already follows this (subject `relationship`,
  `bookOf` is `lorebookId`). Do not edit `imprints.ts` unless a test proves a tie needs it (then stop and report).
- CLAUDE.md hard rules: inside `db.transaction(async (tx) => …)` use only `tx` (the outer `db` deadlocks PGlite);
  no top-level await in `db/index.ts`.

## Definitions

- **Play kinds:** `was_told`, `has_been_there`. **Hand tie:** `isHandTie` in `entryKnowledge.ts` ~102 (kind
  `knows`/`kept_from`, `history_entry_id` NULL, `branch_id` NULL) **and** `status = 'active'`.
- **Held play tie** (the new row kind's source): a `narrative_relationships` row in the session's notes
  (`lorebook_id = ownBook.id`), `knowledge_kind IN (play kinds)`, `status = 'active'`, `branch_id IS NULL`,
  `rules_run_id IS NULL`, whose member binding (`from_node_id`) **and** entry (`to_entry_id`) both belong to the
  attached lorebook (`session.lorebookId`). Only while `ownBook.overlayOf != null` (as links). A hand tie in the
  notes is never one. A tie on a notes-born entry is never one (it rides with its entry: see Pin below). A tie
  from a notes-only member is never one.
- **Superseded:** a held play tie whose pair has an active hand tie in the attached lorebook (`lorebook_id =
  bookId`).
- **Twin (already true):** an `active` tie in the attached lorebook with the same `from_node_id`, `to_entry_id`,
  `knowledge_kind`, the same `coalesce(branch_id,0)` as the target line and the same `coalesce(history_entry_id,0)`
  as the target day. **Live only**: a `resolved` twin does not count (cold review 4: `findLinkedThatWay` ignores
  `status`, so do not use it for ties).

## Build

Files owned: `src/lib/server/lorebooks/ownBook.ts` (tie rows only: overlay list, Apply, Take back, settle cap,
automatic Apply, applied list), `src/lib/server/lorebooks/entryKnowledge.ts` (new functions only),
`src/lib/server/sockets/sessions.overlay.ts` (the Apply handler's `tieIds` param and three response fields only),
`src/lib/server/pipelines/runtime/host.loreWrites.ts` (receipt words only, ~958–960 and the return at the end of
`noteEntryKnowledgeWrite`), tests (new and the ones your change breaks; see Tests).

### A. `entryKnowledge.ts` (the only writer)
1. `handTieInBook(db, { lorebookId, castMemberId, entryId }): Promise<number | null>` — id of an active hand tie
   for the pair in that book (reuse `HAND_KINDS`/`isHandTie`'s columns). Read-only.
2. `moveKnowledgeTieToBook(db, { userId, tieId, lorebookId, branchId, historyEntryId }): Promise<"moved" |
   "superseded" | "twin" | "gone">` — called by Apply with the transaction handle. Loads the tie; it must be a play
   kind and `active`, else `"gone"` (no write). Refuses with `TIE_REFUSAL` unless `userId` owns `lorebookId`
   (`findOwnedBook`, as `writeKnowledgeTie`). Re-checks the member binding and the entry both have `lorebook_id =
   lorebookId`, else `"gone"` (no write; the row stays held). An active hand tie in the book for the pair: **delete**
   the row, `"superseded"`. A twin (definition above, against the given `branchId`/`historyEntryId`): **delete** the
   row, `"twin"`. Else update `lorebook_id`, `branch_id`, `history_entry_id` (same row, same id), `"moved"`.
3. `dropSupersededKnowledgeTies(db, { userId, notesId, lorebookId }): Promise<number[]>` — deletes every active
   play-kind tie in the notes book whose pair has an active hand tie in `lorebookId`; returns their ids. Owner check
   as above.
   Module header: add these writers to the "Owns" / writers wording in one line. Every function takes its handle.

### B. `ownBook.ts`
1. **Row kind.** `interface OverlayKnowledgeTieItem { kind: "knowledge-tie"; tieId; entryId; typeId (the entry's);
   title; sourceMessageId }`, added to `OverlayItem`. A private reader `heldKnowledgeTiesOf(t, ownBookId, bookId)`
   mirroring `standaloneLinksOf` (~1614) returning the held play ties (definition above), **superseded ones left
   out** (a read writes nothing, as ~1831 "A change the lorebook already agrees with is done: not listed").
   **Do not relax `standaloneLinksOf`'s `isNull(knowledgeKind)` filter** — cold review 1: that would print the raw
   type ("Ana was_told Tavern", `linkTitlesOf` ~1667), move ties through the links loop's `alone` path (~2349,
   chosen by `chosenLinkIds` ~2027) without the hand-tie check, and list them as "· link". Ties never enter
   `alone`, `chosenLinkIds`, `appliedLinks` or `droppedLinks`.
2. **Sentence** (★ provisional copy; comment `// 🚧 Provisional copy: the owner has not seen these sentences.`):
   `was_told` → `‹member› was told about ‹entry›`; `has_been_there` → `‹member› has been to ‹entry›`. Names exactly
   as `linkTitlesOf` names ends (entry as the session reads it, held changes laid on; member by binding name):
   factor the end-naming out of `linkTitlesOf` into a helper both use; link titles must not change.
3. **List** (`overlayItemsOf`): after the links block, inside `if (ownBook.overlayOf != null)`, push one tie item
   per held tie, oldest id first; `sourceMessageId` from `madeLinkMessagesOf` (ties are imprinted with
   `imprintMade(subject: "relationship")`).
4. **Apply** (`applyOverlayItems`): input `tieIds?: readonly number[] | null`; `everything` is all four lists absent;
   `chosenTieIds` from items of kind `knowledge-tie` (`everything || wantedTies.has`). Inside the transaction,
   right after the done-amendment drop (~2066–2074), selected or not: `supersededTies.push(...await
   dropSupersededKnowledgeTies(t, …))`. The early return (~2075) also checks `chosenTieIds.size`. After the links
   loop (~2416), a ties loop over the chosen ids (sorted): read the row from the notes; **dating exactly as a
   link's** (cold review 3): factor the link loop's day code (~2366–2378: a day that stays in the notes becomes the
   lorebook's day of the same date via `lorebookDayOfDate`, or no day) into one helper both loops call; `branchId` =
   the reading's line (after `ensureSessionLine`). Call `moveKnowledgeTieToBook(t, { userId: input.userId, tieId,
   lorebookId: bookId, branchId, historyEntryId: day })`. `"moved"`: `fileImprint({ messageId, subjectKind:
   "relationship", subjectId: tieId, cause: { ...who, sessionId, knowledgeTie: true, title: sentence, messageId,
   moved: { lorebookId: ownBook.id, branchId: row.branchId, historyEntryId: row.historyEntryId } } })` where
   `messageId` is the made-imprint message; push `appliedTies` and the anchor into `appliedAnchors`. `"twin"` →
   `droppedTies`; `"superseded"` → `supersededTies`; `"gone"` → nothing. Result: add `appliedTies`, `droppedTies`,
   `supersededTies` to `ApplyOverlayResult` (doc comments) and the return; `batch` non-null also when
   `appliedTies.length`.
5. **Settle cap** (~2497–2515): held ties still listed (via `heldKnowledgeTiesOf` + `madeLinkMessagesOf`) add their
   anchors to `stillHeldAnchors`, as the links do (~2507–2511). Superseded ties are already gone and never cap.
6. **Automatic Apply** (`applyHeldAutomatically` ~2939): `tieIds` from tie items `within(sourceMessageId)`, passed
   to `applyOverlayItems`; the "nothing to apply" test (~3068) includes them; the null-applied literal (~3129) gets
   the three empty arrays. Do not change when it runs (only on Full, owner's own book, ~2967–2969). Ties are not
   filtered for branches (links are not). Its settle (~3101) already reads `overlayItemsOf`, which now lists ties.
7. **Take back** (`takeBackApply`): a record whose `cause.knowledgeTie` is set must still be in the lorebook
   (`lorebook_id = bookId`), checked with the standalone links (~2774–2784); else refuse with a new
   `TAKE_BACK_REFUSALS.tieGone(title)` → `` `The knowledge tie "${title}" is no longer in the lorebook, so this can't be taken back.` ``
   (★). The move back itself is the existing `linkMoves` loop (~2832–2843: `moved.lorebookId`, `branchId`,
   `historyEntryId` restored when the day still stands) — keep it; add `knowledgeTie?: true` to `causeOf`'s type.
8. **Applied list** (`appliedBatchesOf` ~3192): a `relationship` record with `cause.knowledgeTie` is an item
   `{ kind: "knowledge-tie", tieId, entryId: to_entry_id, title }` (the sentence recomputed as the list does, else
   `cause.title`), counted in `count`. Not a link item.
9. Update the doc comments you touch (`overlayItemsOf`, `applyOverlayItems`, `appliedBatchesOf`, `OverlayItem`) in
   the file's existing voice, marked 🚧.

### C. `sessions.overlay.ts`
Parse `params.tieIds` exactly as `linkIds` (~58–60), pass `tieIds` to `applyOverlayItems`, add `appliedTies`,
`droppedTies`, `supersededTies` to the response. Nothing else.

### D. Receipt (`host.loreWrites.ts` `noteEntryKnowledgeWrite`, ★ provisional copy, cold review 5)
Replace the one `keptInNotes` sentence by the case that is true when the tie is written to the notes:
- the session reads an attached lorebook and both the member and the entry are the lorebook's (route `own-book`):
  `Kept in this session's notes; Apply offers it to the lorebook.`
- the entry exists only in the notes (`notesEntry !== null`), member the lorebook's:
  `` `Kept in this session's notes with ${entry}; it goes to the lorebook when ${entry} is applied.` `` (names via the
  existing `names()`)
- the member exists only in the notes: `` `Kept in this session's notes: ${member} is in this session's cast only.` ``
- the session reads no attached lorebook (the notes are its whole lorebook): no note.
Nothing else in the function changes.

## Tests

New file `src/lib/server/lorebooks/applyKnowledgeTies.int.test.ts` (model the fixtures on
`applyOwnBookLinksDays.int.test.ts` and `pipelines/runtime/host.noteEntryKnowledge.int.test.ts`; each `it` that opens
a DB needs a 60 s timeout; mkdtemp prefix `serene-pub-vitest-kn6-`, removed in `afterAll` by that exact path).
Each of these is one `it`:
1. A held `was_told` tie (written to the notes, imprinted with a message) is listed as `kind: "knowledge-tie"` with
   title `‹member› was told about ‹entry›`; `has_been_there` → `has been to`; neither appears as a `link` item.
2. Apply (by `tieIds`) → the same row id is in the lorebook on the session's line, `appliedTies` has it, an `apply`
   record with `cause.moved` and `knowledgeTie` exists; the list no longer has it; `loadEntryKnowledge` (or the
   judge's reader) for the session sees one tie for the pair, not two; **a second session on the same lorebook and
   the same line** (state "same line" in the test name) now knows the entry.
3. A dated held tie (dated by an own-book day): with the lorebook holding a day of that date it moves onto that day;
   without one it moves undated — the same as a link.
4. Superseded: an active hand tie (`setHandKnowledgeTie`) for the pair in the lorebook → the tie is not listed;
   Apply (anything, even a selection not naming it) deletes it and returns it in `supersededTies`; it never caps the
   settle line (an applied item after it settles past its anchor).
5. Twin: an active tie of the same kind, pair, line and day in the lorebook → Apply deletes the held one,
   `droppedTies`; with a `resolved` twin instead, it moves.
6. Take back of that Apply → the tie is back in the notes with its dating, listed again; refused with `tieGone` when
   the moved tie was deleted from the lorebook since.
7. Back before Apply (`retractImprints` with the message) removes the held tie; after Apply, Back of that message
   leaves it in the lorebook.
8. Cap: a tie still held stops Apply's settle before its anchor (mirror "a link still held stops the settle").
9. Automatic Apply on scene close (Full, owner's book, the tie written earlier to the notes) carries it
   (mirror "an automatic Apply includes links and paragraphs in range").
10. A hand tie (`knows`) in the notes on a lorebook pair is never listed and Apply-all never moves it.
11. Pin (cold review 5): a tie (play kind, and a hand tie) on an entry **born in the notes** moves with that entry
    when the entry is applied, without being listed as a tie row.
12. Apply is the lorebook owner's alone; on a lorebook someone else owns the session's owner gets `notOwner`, the
    lorebook's owner can apply the tie (same as links).

Also update what your change breaks, and nothing more: `ApplyOverlayResult` literals in
`autoApply.settle.int.test.ts` (~180) and `sockets/sessions.applyOverlayLinks.int.test.ts`; the "not ties" case in
`applyOwnBookLinksDays.int.test.ts` ~268 only if its tie is a play tie on a lorebook pair (then assert it is not a
`link` item); receipt expectations in `pipelines/runtime/host.noteEntryKnowledge.int.test.ts`.

Run (one at a time; first `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`):
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/kn-6-w1-<n>.log 2>&1"`
then read `tail -n 40` of the log (never pipe vitest into `head`).
1. the new file; 2. every test file you edited plus `src/lib/server/lorebooks/applyOwnBookLinksDays.int.test.ts`,
`applyTakeBack.int.test.ts`, `autoApply.int.test.ts`, `autoApply.settle.int.test.ts`, `heldApply.int.test.ts`,
`src/lib/server/sockets/sessions.applyOverlayLinks.int.test.ts`,
`src/lib/server/pipelines/runtime/host.noteEntryKnowledge.int.test.ts`; 3. the two prompt baselines, which must
pass unchanged: `src/lib/server/pipelines/runtime/unknownEntries.reply.int.test.ts`,
`src/lib/server/sockets/sessions.lairUnknownEntries.int.test.ts`.
Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` (0 errors in your files; report others by file).

## Stop and ask (report back instead of deciding)
CLAUDE.md §Decisions applies; a name or sentence beyond the ones above is needed; a migration seems needed; a prompt
baseline changes; Take back cannot return a tie; anything needs a file outside the list above.

## Report (your final message, under 400 words)
Changed files; each function added (one line); the tests and their results (log paths); tsc result; anything you
could not do; Noticed, not done.
