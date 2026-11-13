# BRIEF — lane `s4-rul-d`, worker 1 (2026-11-10) — tests for the boot fill of deleted cards' seats

Supervisor: lane `s4-rul-d`. You write tests only; the code is built. Report back in your final message (no report file).

## Owner's words (the behaviour under test; never reinterpret)

- ★RF-1 (2026-11-10): *"Yes, if the card is removed/deleted, populate the cast member with the deleted content."* Follow-up: *"…when a deleted card is seated somewhere with no member at all, make a member from the card's content before it goes, so no seat is left empty."*
- On seats of cards deleted **before** the delete-time fill existed, with no member anywhere: **"Yes, at startup"** — *"One startup pass fills those seats, and a test pins that a second start changes nothing. No seat stays empty, as your cascade rule asks."*

## What was built (read these, do not edit them)

- `src/lib/server/sessions/seatMembers.ts` — `seatMembers(db)`, the `seat-members` boot pass. New step 1 (runs before settling): one query (`deletedCardSeats`) names every **live** seat (`session_characters.character_id` or `session_personas.persona_id`, `removed_at` null, `cast_member_id` null) whose card is soft-deleted (`characters.is_deleted`) and that **neither the attached book (`sessions.lorebook_id`) nor the session's own book (`lorebooks.session_id = s.id`) knows** (linked binding, or a dated card). `takes` = the attached book may mint (same owner as the session, no genuine `provided` mark) OR the own book exists.
  - `takes` rows: one transaction per card: `fillSeatsBeforeCardDelete(tx, card, { mintDeleted: true })` then `makeMemberCardless(tx, id, { cause: "card-delete" })` for each minted member. Counted in `report.filled`, `report.minted`, `report.sessions`.
  - not-`takes` rows: left alone; each seat counted in `report.unexplained` (unless settling also settled that session, which counts it itself). Never worked, so nothing is written on any boot.
- `src/lib/server/sessions/seats.ts` — `fillSeatsBeforeCardDelete(tx, cardId, { mintDeleted })` (~1420) and `resolveSeatMember(..., { mint, mintDeleted })` (~375). Book choice: the attached book when it may mint, else the own book.
- `src/lib/server/utils/characterBindingSync.ts` `findOrInsertBinding(tx, book, card, { mintDeleted })` (~370).
- `src/lib/server/cast/cardless.ts` `makeMemberCardless` — clears `lorebook_bindings.character_id`, detaches the member's versions so it holds the card's words.

## Files owned (the only files you may edit)

1. **New** `src/lib/server/sessions/seatMembers.deletedCards.int.test.ts`.
2. `src/lib/server/sessions/seatMembers.int.test.ts` — only the three tests that pinned the old behaviour (a deleted card with no member in a session whose books can take one is now **minted for**), and its header claim line ("a deleted card no member has are left") if it now misreads:
   - ~433 "a departed card-less seat is left untouched; a deleted card no member has is counted and left" — book `b` is the owner's (mintable), so the deleted seat is now filled with a new card-less member: expect `unexplained: 0`, `minted: 2`, `filled: 2`, the deleted seat's `castMemberId` set (member card-less, `characterId` null, named "Deleted"); keep the other two seats unchanged. Rename the test to say what it now claims. Keep its point about the departed card-less seat and the envoy seat being untouched.
   - ~492 "a session whose lorebook is its own book…" — the `gone` seat now gets a member minted into `own` (card-less). Adjust `filled`/`minted` and the `mintedIn` assertions (the minted card-less member has `characterId` null — identify it by the seat's `castMemberId`, and by `name === "Gone"`). Fix the comment "Only the deleted card's seat is left bare". Second run still ZEROS and `everything()` unchanged.
   - ~537 "a second run changes nothing" — session `t`'s deleted seat (book `b`, mintable) is now filled by step 1. Adjust the first report (`sessions: 2`, `filled` and `minted` +1 each, `unexplained: 0`) and the comment; second and third runs stay ZEROS with `everything()` unchanged.
   Change nothing else in that file. Note: that file's DB is shared by all its tests and every boot scans it all, so each test must `retire` the sessions it leaves unfillable.

## Tests to write in the new file

Copy the fixture style of `seatMembers.int.test.ts` (lines 1–190: the `vi.mock("$lib/server/db")` with `createTestDb`, `fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-seatMembersDeleted-"))`, `releaseDataDir` in `afterAll`, `vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })`, `uniq`, `user`, `book`, `session`, `everything`, `retire`). Make deleted cards with `insertCard` from `$lib/server/characters/versions` (gives a card version, as real cards have) with a description, then `update characters set is_deleted = true`. Members in fixtures through `insertCastMember` (see `seats.cardDelete.int.test.ts` ~89). Assert "the card's words" as `seats.cardDelete.int.test.ts` `expectFilled` (~165–200) does: binding `characterId` null, binding `name` = card name, `membersAsRead(db, [id]).get(id)` name and description = the card's, no version of the member still follows the card (read that helper to the end and reuse its checks).

1. **Character seat, mintable attached book** (session's `lorebookId` = a book the session owner owns, no own book): after one `seatMembers`: report `{ sessions: 1, filled: 1, minted: 1, merged: 0, unexplained: 0, failed: 0 }`; the seat's member lives in the attached book, named as the card, holds the card's words, card-less. **Second boot**: report equals ZEROS, `everything()` deep-equal to after the first (no rows written, no session re-selected).
2. **Player seat, own-book-only session**: session with `lorebookId` null (or attached to another user's book) and an own book from `ownBookFor(db, s.id)` (`$lib/server/lorebooks/ownBook`); a `session_personas` seat of a deleted card: member minted into the own book, card-less, card's words; second boot ZEROS, nothing changed.
3. **Character and player seat of one deleted card in one session**: both seats take the same member; `filled: 2`, `minted: 1`.
4. **Untouched**, each with a second boot that changes nothing:
   - a deleted card that already has a member in the attached book (a linked binding): settling fills it (lane c's path) — `minted: 0`, the seat takes that member; nothing card-less is minted.
   - a live card's seat with no member: settling mints a **linked** member (`characterId` = the card) — not card-less.
   - a departed seat (`removedAt` set) of a deleted card with no member: untouched, `castMemberId` stays null, no binding made, session not counted.
   - a session whose books can take no member (attached book owned by **another** user, no own book) with a live seat of a deleted card: seat stays null, no binding written; report `{ sessions: 0, filled: 0, minted: 0, unexplained: 1 }` on the first boot **and** the second, `everything()` unchanged across both (it is counted, never worked). `retire` it at the end of the test so later tests' reports are clean.
5. **The pass sends nothing**: it takes no `io` at all; assert nothing about events. (Skip if nothing to assert.)

Order the file so a leftover unfillable session never leaks into another test's exact report (retire at the end of each test, or use `toMatchObject` where a leftover is expected).

## Rules (quoted from CLAUDE.md and the lane's common brief)

- *"Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."*
- *"An int test that opens a DB inside an `it` needs a 60 s timeout under load."* Never pipe vitest into `head` (the SIGPIPE leaks PGlite temp dirs).
- *"Never seed a row at a hardcoded id."* Let ids come from the sequences.
- It is a **session**, never a *chat*. Every session has a lorebook (own book or overlay): never write a comment or test name framing a session as having "no lorebook" — say "own-book-only", "an attached book it may not mint into".
- Run tests only like this (from `/home/jody/github/serene-pub`), log in the scratchpad `/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/`:
  `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-rul-d-w1-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-rul-d-w1-tests.log'`
  Files: `src/lib/server/sessions/seatMembers.deletedCards.int.test.ts src/lib/server/sessions/seatMembers.int.test.ts`. Then read the log's tail.
- If a test shows the **code** is wrong (not the test), stop and say so with the evidence; do not edit the code.
- Prettier: `npx prettier --check <file>` on both files; the new file may be `--write`n whole; in `seatMembers.int.test.ts` only the lines you changed.

## Verbatim rules

- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no `sdk:build`.)

## Report (final message)

Files changed; each test's name and what it pins; the test run's pass/fail counts and `test-exit`; any `/tmp/serene-pub-vitest-*` dir left; anything that looked wrong in the code.
