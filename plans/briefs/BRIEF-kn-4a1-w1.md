# BRIEF — worker `kn-4a1-w1` — the knowledge door, server side

Repo `/home/jody/github/serene-pub` (app). Supervisor: lane `kn-4a1`. Report path: your final message (the
supervisor reads it). The SDK is not touched.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

Also: never `git checkout` / `restore`; never `prettier --write` (nor a scratch-copy equivalent); no migration
(the columns exist, 0167; if one seems needed, stop and report). Inside `db.transaction(async (tx) => …)` use
only `tx`, and pass `tx` to every helper it calls (the outer `db` deadlocks PGlite; `transactionGuard` throws in
tests). Never add a top-level `await` to `src/lib/server/db/index.ts`. `NODE_OPTIONS=--max-old-space-size=10240`
for `npx tsc --noEmit -p .`; name, never fix, errors in files you do not own.

## Goal

One socket family `entryKnowledge:*` (🚧 provisional names) through which the lorebook row's owner reads who
knows each entry, as the existing judgement decides it, and writes the mark and the hand ties through the
existing writers. No second writer, no SQL in the socket file.

The wire types are already written (do not change them without saying why in your report):
`src/lib/shared/sockets/types.ts`, namespace `Sockets.EntryKnowledge` (search `namespace EntryKnowledge`): `Row`,
`Winner`, `Hand`, `List`, `SetCommonKnowledge`, `SetTie`. The client map (`src/lib/client/sockets/typedSocket.ts`,
`"entryKnowledge:list"` …) and the interest lists (`src/lib/shared/sockets/interest.ts`: `SCOPED_EVENTS` with
`payload?.lorebookId`, and `GATED_EVENTS`) are also written. Read them first.

## Files owned (edit only these)

- `src/lib/server/lorebooks/entryKnowledge.ts` — **another lane (`kn-4b`) may edit this file at the same time.**
  Make small targeted edits; re-read the region right before each edit; append new functions at the end of the
  file; do not change the signature or behaviour of `setEntryCommonKnowledge`, `writeKnowledgeTie`,
  `endKnowledgeTie`, `loadEntryKnowledge`, `judgeEntryKnowledge`.
- `src/lib/server/sockets/entryKnowledge.ts` (new)
- `src/lib/server/sockets/index.ts` — two lines only: the import and `registerEntryKnowledgeHandlers(socket, emitToUser, register)` beside `registerLorebookStateHandlers` (~line 364).
- `src/lib/shared/sockets/gatedEvents.test.ts`, `src/lib/shared/sockets/scopedReplies.test.ts` — add the family where their lists require it (read their headers).
- `src/lib/server/sockets/scopedReplies.lorebooks.int.test.ts` — only if its coverage rule requires the new events.
- Tests (new): `src/lib/server/lorebooks/entryKnowledge.door.int.test.ts`, `src/lib/server/sockets/entryKnowledge.int.test.ts`; and additions to `src/lib/server/lorebooks/entryKnowledge.test.ts`.

Readable: everything. Patterns to copy: `src/lib/server/sockets/lorebookState.ts` (a small family file: `refusable`,
the `aboutRequest` echo of `lorebookId` + `requestId`, the register function), `src/lib/server/lorebooks/entryKnowledge.int.test.ts`
(the test world: users, books, cast members via `insertCastMember`, a session with notes), `src/lib/server/sockets/lorebookState.int.test.ts`
(driving handlers with a fake socket and `emitToUser`).

## The rules your work depends on (quoted)

- CLAUDE.md P2: "A module owns its data and every write to it; peers use its contract … Two writers of one thing is a bug."
- CLAUDE.md Sockets: "An event in `SCOPED_EVENTS` must carry its scope key (`sessionId`, `lorebookId`…) in the payload, or `emitToUser` silently sends nothing."
- Lane brief: "Every write calls the existing functions (`setEntryCommonKnowledge`, `writeKnowledgeTie`, `endKnowledgeTie`); no second writer, no SQL in the socket. Refusals use the existing sentences."
- Lane brief: "The mark is not in edit history (NOMENCLATURE:961): keep it so." (So do not route the mark through `entries:update`.)
- Lane brief correction 3: "`toEntryRow` is not touched (it feeds export, pipeline and plugin rows and reads by share recipients: the mark would leak and the file format would widen)."
- Lane brief correction 4: "the read and every write are gated on `book.userId === userId` (the row's owner), exactly as the writers already are (`entryKnowledge.ts:451`): not `findOwnedBook` / `lorebookAccessFor`, which admit every member of a session to its notes book. An administrator who is not the owner gets nothing."
- Lane brief correction 1: "The read returns the judged result, not a guess from the hand tie: for each (member, entry) asked, what `judgeEntryKnowledge` decides at the workspace's line and moment, the winning reason … and the hand tie if one exists."
- Lane brief correction 2: "Changing the switch ends that member's hand ties for the entry, then writes the new one, in one outer transaction passing `tx` to the existing functions … Hand ties stay undated and on every line (`null`), as today; the precedence itself is not changed in this lane."
- How the filter judges (`entryKnowledge.ts` 20–43, 97–170): any active cast→entry row counts as knowing (an ordinary relationship included); one tie wins per (member, entry): the later date, then the nearer line, then *kept from*; undated is earliest; *kept from* hides an entry marked or not. Hand ties are written undated (`historyEntryId ?? null`), so a dated tie beats a hand one.

Note: the writers already take their handle as the first parameter and open `db.transaction(...)` on it. Called
with an outer `tx`, that opens a savepoint (`tx.transaction` is used elsewhere: `sessions/settingsForm.ts:334`,
`characters/cardFromMember.ts:323`). So **no signature change** is needed: pass `tx` as their `db`.

## Build

### 1. `entryKnowledge.ts` — the judgement shares its winners (no behaviour change)

Extract the winner loop of `judgeEntryKnowledge` (lines ~105–130: `stepIndex`, `nearness`, the `winners` map,
`beats`) into an exported 🚧 `winningTies(input: { rows; line; moment; timelineOff; ownBookIsReading? }):
Map<number, KnowledgeRowRead>` (entry id → the winning row), and have `judgeEntryKnowledge` call it. Its output
must stay identical: every existing test in `entryKnowledge.test.ts` passes unchanged. A one-line doc comment
stating the rule (later date, nearer line, then kept from).

### 2. `entryKnowledge.ts` — read helper for the door (append)

🚧 `readBookKnowledge(db, { userId, lorebookId, entryId?, castMemberId?, branchId, moment }): Promise<{ markedEntryIds: number[]; rows: Sockets.EntryKnowledge.Row[] }>`
(define a local interface with the same fields if importing the ambient `Sockets` type is awkward here; the socket
reply must be assignable to the wire type).

- Gate: `findOwnedBook(db, userId, lorebookId)` (dynamic import, as the writers do): none → throw `"Lorebook not found."`;
  `book.userId !== userId` → throw `TIE_REFUSAL`. Nothing else is read before the gate passes.
- Reading: `readingOf(db, book.id, { branch: branchId ?? "main", moment })` from `$lib/server/state/reading`
  (it handles a book with the Timeline off). A `BranchRefusal` → throw `"That is not a line of this lorebook."`
  (the sentence `sockets/lorebookState.ts` uses).
- `markedEntryIds`: ids of `lorebook_entries` with `lorebook_id = book.id AND not_common_knowledge`, ascending.
- Neither id → `rows: []`.
- Reach (as `writeKnowledgeTie` computes it): the book, plus its session's attached lorebook when the book is a
  session's notes. Members are `lorebook_bindings` with `lorebook_id` in reach. An `entryId` not in reach →
  `"That entry is not in this lorebook."`; a `castMemberId` not in reach → `"That cast member is not in this lorebook."`.
- Pairs: `entryId` alone → every member × that entry; `castMemberId` alone → that member × (every marked entry of
  the book ∪ every entry in reach it has an active tie to in this book); both → the one pair.
- Ties read: `narrative_relationships` with `lorebook_id = book.id`, `status = 'active'`, `from_node_id` in the
  members asked, `to_entry_id` in the entries asked; with `knowledge_kind`, `relationship_type`, `branch_id`,
  `history_entry_id`, and the history entry's `fields` (LEFT JOIN, as `loadEntryKnowledge` does) for the date
  (`historyEntryDate`). Only this book's rows (a session's notes may hold newer ones; the screen says so).
  Few statements: never one query per member.
- Per member: build `KnowledgeRowRead[]` (`inNotes: false`), then `winningTies({ rows, line: reading.line,
  moment: reading.moment, timelineOff: reading.timelineOff === true })` for the winner and
  `judgeEntryKnowledge({ markedEntryIds: <marked among the entries asked>, rows, line, moment, timelineOff })`
  for `known` (`known = !leftOut.has(entryId)`). One judge: do not re-implement any part of the decision.
- `winner`: `{ tieId, kind, relationshipType, hand, date }`, where `hand` = kind is `knows` or `kept_from` AND
  `history_entry_id IS NULL` AND `branch_id IS NULL`; `date` as `{ year, month: ?? null, day: ?? null }` or null.
- `hand` (the switch): among the member's **live hand ties** for the entry (same three conditions as above):
  `"kept_from"` if any is kept from, else `"knows"` if any, else null.
- `name`: the member's shown name (`membersAsRead(db, ids)` → `shownName`), else the binding's `name`, trimmed.
- `placeEntry`: the entry's `typeId === LOCATION_TYPE_ID` (`$lib/shared/entries/types`).
- Order: entry mode by `name` (`localeCompare`), member mode by `entryId`.

### 3. `entryKnowledge.ts` — two write helpers (append), each one outer transaction

- 🚧 `setBookCommonKnowledge(db, { userId, lorebookId, entryIds, notCommonKnowledge }): Promise<number[]>`
  (returns the book's marked ids after the write, read after the commit with `db`).
  `entryIds` deduped; empty or any non-integer → throw `"Name the entries to mark."` (new sentence; list it in
  your report). `db.transaction(async (tx) => …)`: gate with `findOwnedBook(tx, …)` and `book.userId !== userId`
  → `"Only the lorebook's owner can mark what is common knowledge."`; every id must be an entry with
  `lorebook_id = book.id`, else `"That entry is not in this lorebook."` (nothing written); then
  `await setEntryCommonKnowledge(tx, { userId, entryId, notCommonKnowledge })` for each, in order. A refusal on
  any entry rolls back all of them.
- 🚧 `setHandKnowledgeTie(db, { userId, lorebookId, castMemberId, entryId, hand }): Promise<void>`,
  `hand: "knows" | "kept_from" | null`; anything else → `"That is not a kind of knowledge."`.
  `db.transaction(async (tx) => …)`: gate (`findOwnedBook(tx, …)`: none → `"Lorebook not found."`; not the row's
  owner → `TIE_REFUSAL`); select the ids of the member's live hand ties for the entry (`lorebook_id = book.id`,
  `from_node_id = castMemberId`, `to_entry_id = entryId`, `status = 'active'`, `knowledge_kind IN ('knows','kept_from')`,
  `history_entry_id IS NULL`, `branch_id IS NULL`); `await endKnowledgeTie(tx, { userId, tieId })` for each; then,
  when `hand` is not null, `await writeKnowledgeTie(tx, { userId, lorebookId: book.id, castMemberId, entryId, kind: hand })`
  (undated, no branch: leave `historyEntryId` / `branchId` out). Rows of play's kinds (`was_told`,
  `has_been_there`), dated or line-bound rows, and ordinary relationships are never selected, ended or changed.

Comments state the rule, not the story. Mark new exported names 🚧.

### 4. `src/lib/server/sockets/entryKnowledge.ts` (new) — the door

Header comment: purpose, what it owns (nothing but the door), who owns the data (`lorebooks/entryKnowledge.ts`),
owner-only gate, scoped by `lorebookId`. Three handlers with `refusable(event, body, fallback, undefined, aboutRequest)`,
`aboutRequest` echoing `lorebookId` and `requestId` exactly as `lorebookState.ts` does:

- `entryKnowledge:list` → `readBookKnowledge(db, { userId: socket.user!.id, … })`; reply
  `{ lorebookId, entryId?, castMemberId?, branchId, moment, markedEntryIds, rows, requestId? }`; fallback
  `"Who knows this entry could not be read."`.
- `entryKnowledge:setCommonKnowledge` → `setBookCommonKnowledge`; reply
  `{ lorebookId, entryIds, notCommonKnowledge, markedEntryIds, requestId? }` — **one** `emitToUser` for the whole
  request; fallback `"The entries could not be marked."`.
- `entryKnowledge:setTie` → `setHandKnowledgeTie`, then `readBookKnowledge` for the one pair at the params'
  `branchId` / `moment`; reply `{ lorebookId, castMemberId, entryId, branchId, moment, row, requestId? }`;
  fallback `"Who knows this entry could not be saved."`.

Param checks in the socket (no SQL): `lorebookId` an integer (else `"Lorebook not found."`); `branchId` null or an
integer (else `"That is not a line of this lorebook."`); `moment` through `storyDateFrom` (`state/reading`) to
`{ year, month, day }` or null; `castMemberId` / `entryId` integers where required (else the writers' sentences).
Writes also refuse a primer book as `lorebookState.ts` does (`primerRowEditProblem(db, lorebookId)` → throw its sentence).
Register function `registerEntryKnowledgeHandlers(socket, emitToUser, register)` like `registerLorebookStateHandlers`.
Every reply object is typed as its declared `Response`.

## Tests (Done means)

`src/lib/server/lorebooks/entryKnowledge.test.ts` (pure): `winningTies` picks the winner by the three rules
(dated over undated; nearer line; kept from at a tie); existing tests unchanged and green.

`src/lib/server/lorebooks/entryKnowledge.door.int.test.ts` (real PGlite; copy the setup of
`entryKnowledge.int.test.ts`, 60 s timeouts; its own `mkdtemp` prefix `serene-pub-vitest-kn4a-door-`):
1. the judged result and winner per case: an ordinary relationship → known, `winner.kind === null` with its
   `relationshipType`; a dated `was_told` (a History entry for the date, as the existing test dates ties) over a
   hand `kept_from` → known, winner `was_told`, `hand === "kept_from"`; hand `kept_from` and hand `knows` both live
   (written directly with `writeKnowledgeTie`) → not known, winner `kept_from`, `hand === "kept_from"`; a common
   entry with a hand `kept_from` → `known === false`; a marked entry with no tie → `known === false`, `winner === null`;
   a common entry with no tie → `known === true`, `winner === null`; a place entry → `placeEntry === true`;
   member mode lists marked entries and tied ones; both ids → one row;
2. `setHandKnowledgeTie` leaves exactly one live hand tie (starting from two), `null` ends every hand tie, and a
   `was_told` / `has_been_there` row and an ordinary relationship for the same pair keep their id and `active` status;
3. `setBookCommonKnowledge` is one transaction: with one entry of another book in the list, no entry is marked;
   the mark is not written to edit history (no new redline row: find the redlines table in `db/schema.ts`);
4. gate: another user, an administrator who is not the owner (`isAdmin` does not matter to the helper: show the
   helper never consults it), and a session member who is not the notes book's row owner are refused by
   `readBookKnowledge` and by both writers;
5. integration: in a session reading the book, `setHandKnowledgeTie(… "kept_from")` makes `loadEntryKnowledge`
   leave the entry out for that member's speaker ref, and `"knows"` on a marked entry brings it back.

`src/lib/server/sockets/entryKnowledge.int.test.ts`: drive the three handlers (fake socket + `emitToUser` spy, as
`lorebookState.int.test.ts` does): every reply carries `lorebookId` and `scopeOfPayload(event, reply)` reads it;
a non-owner gets `<event>:error` with the sentence and no reply; bulk emits one reply for several ids; the
`requestId` comes back on reply and refusal.

Also run, unchanged and green: `src/lib/server/lorebooks/entryKnowledge.int.test.ts`,
`src/lib/server/pipelines/runtime/bindings.entryKnowledge.int.test.ts`, `src/lib/server/utils/lorebookEntries.test.ts`,
`src/lib/server/sockets/lorebooks.roundTrip.int.test.ts`, `src/lib/server/sockets/lorebooks.import-export.int.test.ts`,
`src/lib/server/lorebooks/knowledgeTiesTravel.int.test.ts`, `src/lib/shared/sockets/gatedEvents.test.ts`,
`src/lib/shared/sockets/scopedReplies.test.ts`.

**How to run tests (only this way, one run at a time):** first wait for other lanes:
`until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`, then
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/kn-4a1-w1-<n>.log 2>&1"`
and read the log (never pipe vitest into `head`). Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .`
(0 errors in your files) and `npx prettier --check` on every file you touched.

## Stop and report (do not decide) when

A migration seems needed; the wire types cannot express something; a hand tie and a play tie need a precedence
the judgement does not define; anything outside the files above needs changing; a new user-visible sentence
beyond the ones named here seems needed.

## Report

Changed files; for each new function its signature; every sentence a person can read (refusals and fallbacks)
listed; tests run with pass counts and log paths; `tsc` result; anything noticed and not done.
