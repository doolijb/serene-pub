# BRIEF — s4-rul-c-w1 (2026-11-10) — a deleted card's seats get a member; resolveSeatMember and the boot pass move together

Supervisor: lane `s4-rul-c` (it read the rules and quotes what you need below). Repo: `/home/jody/github/serene-pub`. Use absolute paths. Do not read CLAUDE.md-named canon files whole; read the line ranges named here.

## Owner's words (never reinterpret)

- ★RF-1, approved: *"Yes, if the card is removed/deleted, populate the cast member with the deleted content."* Follow-up, **"Fallback + new members"**: *"Fill the seat from the session notes' member as recommended, AND when a deleted card is seated somewhere with no member at all, make a member from the card's content before it goes, so no seat is left empty."*
- *"Cast by default cascades… a card is a seed, not the sole carrier… not having a card doesn't make them 2nd class."*

## Why the work happens inside the delete transaction, before anything else

`findOrInsertBinding` returns null for a deleted card (`src/lib/server/utils/characterBindingSync.ts` ~386); `characters:delete` sets `isDeleted` before its member loop (`src/lib/server/sockets/characters.ts` ~1192–1218); a minted member is named only after commit by `syncLorebookBindingsForCharacter`, which finds members by `character_id` (`characterBindingSync.ts` ~147) — and `makeMemberCardless` (`src/lib/server/cast/cardless.ts` ~178) clears that. So: fill seats **first**, inside the delete transaction, while the card is still live and linked; then the existing conversion (`resolveFollows` + `makeMemberCardless`) turns every member of the card, old and new, into a card-less member that owns the card's words.

## Goal A — one helper, called by both card-delete writers

In `src/lib/server/sessions/seats.ts` add one exported function, 🚧 `fillSeatsBeforeCardDelete(tx: Db, cardId: number): Promise<{ filled: number; minted: number }>` (JSDoc: one paragraph — what it does, that it runs inside the caller's delete transaction before the card is marked deleted, that a fill reports no `SeatChange`, that it uses only `tx`). Behaviour:

1. First statement: take the card's sync lock, `select pg_advisory_xact_lock(hashtext('charBindingSync:character'), ${cardId})`, **before** any lorebook lock (the naming in step 4 re-takes it inside the same transaction; advisory locks are re-entrant for one transaction, and taking it first keeps the documented order character → book).
2. The sessions to visit: every session with a **live** seat holding the card and no member — `session_characters` with `character_id = cardId`, `removed_at is null`, `cast_member_id is null`; and `session_personas` with `persona_id = cardId`, `removed_at is null`, `cast_member_id is null` (a persona IS a character). Ascending session id.
3. Per session: `book = await seatBookOf(tx, sessionId)`. The member: `(await findSeatMembers(tx, book, [cardId])).get(cardId)` — the card's member in the attached book, else the session's own book, else an ancestor's (the RF-1 fallback). If none: `resolveSeatMember(tx, book, cardId, { mint: true })` mints (attached when `attachedMintable`, else the own book). Order matters: **find before mint**, so a member in the session's notes is used even when the attached book could mint.
4. **Name a minted member inside the transaction**: when it minted (`minted && mintedIn != null`), call `syncLorebookBindingsForCharacter(cardId, tx, { lorebookId: mintedIn })` with the **`tx`** handle (it opens `db.transaction`, which on a `tx` is a savepoint; never pass the outer `db`). `syncMintedSeatMembers` must NOT be used here (it runs after commit, when the card is gone).
5. Write the member onto every live seat of this card in this session that has none (both tables). Departed seats of this card in this session with no member take the same member **only if one was found or minted for a live seat** (never mint for a departed seat alone) — the way `settleSeats` step 2 uses its per-call cache. Report this in your report.
6. No `SeatChange`, no event, no toast: a fill reports nothing (keep that). Seats that already have a member, card-less seats, other cards' seats and other sessions are never touched.

Callers (edit only these blocks):
- `src/lib/server/sockets/characters.ts`, the `charactersDelete` handler only. Inside its transaction: select the ids the delete applies to (same `where`: `id = params.id and user_id = userId`), call `fillSeatsBeforeCardDelete(tx as unknown as Db, id)` for each, **then** the `isDeleted` update, then the existing `resolveFollows` and member loop unchanged (newly minted members are linked by `character_id`, so the loop converts them and `tellMemberSessions` tells their sessions after commit). Update the handler's comment block in a sentence or two.
- `src/lib/server/plugins/providedBooks.ts`, `deleteProvidedBooks`'s card transaction only (~1546–1562): call the helper for each id **first**, before `resolveFollows`. Update its comment in a sentence.

## Goal B — `resolveSeatMember` and the boot pass, in one change

- `resolveSeatMember` (`seats.ts` ~354–410): when the attached book is mintable and `findOrInsertBinding` answers null (a deleted card the attached book has no member for), **fall through** to the found member (own book / ancestor), instead of returning null. Live cards behave as today (step 2 still mints in the attached book before the own-book find). Resolvable becomes: `attached-find OR own-find OR ((attached-mintable OR own exists) AND card live)`. Update the function's JSDoc and the module header's "Which member a card is" paragraph to say so (★RF-1, 2026-11-09).
- `src/lib/server/sessions/seatMembers.ts` `resolvable` (~57–105) **in the same change**: the SQL predicate becomes
  `found(= s.lorebook_id) OR found(own) OR ((mintable OR own book exists) AND live)`, reusing the existing `found`, `own`, `mintable`, `live` fragments. Update the comment above it and the header bullet ("A no-op fast path"), which today says a mintable attached book stops settling for a deleted card — no longer true. Ancestor books are still not looked in (can only miss, never re-select). Report fix 4 of 2026-11-09 was exactly the drift between these two; they must agree.

## Tests

1. New `src/lib/server/sessions/seats.cardDelete.int.test.ts` (copy the DB setup of `src/lib/server/sessions/seatMembers.int.test.ts` lines 1–190 or `src/lib/server/sockets/characters.softDelete.int.test.ts`; provided-card setup: `src/lib/server/plugins/providedBooks.int.test.ts` ~1624–1670, which stamps `extensions.serenepub.provided` with the card's uuid). Cases, each through **both** paths (`charactersDelete.handler` and `deleteProvidedBooks`) — a `describe.each` over the two paths is fine:
   - (a) the card has a member in the attached book; the seat has no member → the seat takes it;
   - (b) the card's member is only in the session's own book (notes), attached book mintable → the seat takes the notes' member, nothing is minted in the attached book;
   - (c) no member anywhere — on a session whose attached book is mintable (minted there) and on a session with only its own book (`lorebook_id` null; minted in the own book);
   - every live seat ends with a member that has a **non-empty name equal to the card's** (`lorebook_bindings.name`) and whose `membersAsRead` description is the card's, `character_id` null (card-less), no version following anything;
   - a card-less seat in the same session and a seat in another session (another card) are unchanged; no `SeatChange`/event is needed or checked beyond that.
   Any DB-opening test needs a 60 s timeout (`vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })`).
2. `src/lib/server/sessions/seatMembers.int.test.ts`: the test at ~577 ("an attached book that may mint and a deleted card that only the own book knows: not a candidate, ever") now inverts: it is a candidate once, the seat is filled with the own-book member, and **a second boot changes nothing** (second `seatMembers` returns zeros: `sessions: 0`). Rename it to say so. Keep every other case green.
3. If `seats.int.test.ts` has a case asserting null for a deleted card with a mintable attached book and an own-book member, update it the same way; add one small `resolveSeatMember` case there if none covers the fall-through.

Run only these, in a capped scope, logged (scratch dir `/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/`, file names start `s4-rul-c-w1`):
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; cd /home/jody/github/serene-pub; npx vitest run <files> --maxWorkers=2 > <scratch>/s4-rul-c-w1-tests.log 2>&1; echo test-exit=$? >> <scratch>/s4-rul-c-w1-tests.log'`
Files: the new test, `seatMembers.int.test.ts`, `seats.int.test.ts`, `seats.cardless.int.test.ts`, `src/lib/server/sockets/characters.softDelete.int.test.ts`, `src/lib/server/plugins/providedBooks.int.test.ts`, `src/lib/server/cast/cardless.int.test.ts`, `src/lib/server/sockets/sessions.seatEvents.int.test.ts`. Never pipe vitest into `head`.

## Docs (same change)

- `docs/lorebook-cast.md` line ~177 (the "Deleting a character card…" paragraph): add one or two plain sentences — a session that seats the card keeps its seat: a seat with no cast member yet is given the card's member from the session's lorebook or its notes, or a new member made from the card, before the card goes. Second person, plain words, no code names. Never frame a session as having no lorebook.
- `docs/characters.md` §"Delete a character" (~143–145): one sentence — in sessions that have it, it plays on as a cast member who keeps the card's words (link to `./lorebook-cast.md` as the doc does elsewhere).

## Files owned (edit nothing else)

`src/lib/server/sessions/seats.ts`; `src/lib/server/sessions/seatMembers.ts`; `src/lib/server/sockets/characters.ts` (the `charactersDelete` handler only); `src/lib/server/plugins/providedBooks.ts` (`deleteProvidedBooks`'s card block only); `src/lib/server/sessions/seats.cardDelete.int.test.ts` (new); `src/lib/server/sessions/seatMembers.int.test.ts`; `src/lib/server/sessions/seats.int.test.ts`; `docs/lorebook-cast.md` (that paragraph); `docs/characters.md` (that section).

Readable, not editable: `cast/cardless.ts`, `utils/characterBindingSync.ts`, `utils/castMemberCards.ts`, `characters/versions.ts`, `lorebooks/ownBook.ts`, any test. If you think one of them must change, stop and say so in your report.

## Rules your work depends on (quoted by the supervisor)

- CLAUDE.md Hard rules: *"Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently; `db/transactionGuard.ts` throws in dev/test, warns in prod."* `seats.ts` header: *"No static import of `$lib/server/db`, here or through anything this module imports: every function takes its handle first."*
- *"Migrations are generated… "* — this lane makes **no migration and no schema change**. No new event, setting, or socket. No SDK change.
- *"It is a session, never a chat."* Memory rule: never write copy or code paths that frame a session as having no lorebook; say own book / notes.
- Mark new names 🚧. Your only new name is `fillSeatsBeforeCardDelete`; if you need another, stop and ask.
- Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
- Prettier: run `npx prettier --check` on changed files, but **only `--write` the lines you changed** — never reformat a whole file. If a file fails only on lines you didn't touch, leave it and say so.

## Verbatim rules

- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no `sdk:build`; the owner's dev server is up.)

## Report (your final message)

Changed files with line ranges; each decision you made; tests run with pass/fail counts and the log path; what you did for departed seats; anything you could not do; Noticed, not done.
