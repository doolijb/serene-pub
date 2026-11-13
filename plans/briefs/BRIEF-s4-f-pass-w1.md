# BRIEF — worker `s4-f-pass-w1` — the own-book mint (seat-cast S4, wave 2) — 2026-11-08

Supervisor: lane `s4-f-pass`. You are a lane-worker; you cannot spawn agents. Return your report as your final message (no report file).

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
*Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
*Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
*Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You should not need `sdk:build` at all.)

## Goal

Owner ruling 2026-11-08 ★B-5: the session's book is **fixed at start** ("supersedes the 2026-10-21 'until play has written' lock; the own-book mint may count as play"). So the S1 guard "never mint into the own book" goes.

In `src/lib/server/sessions/seats.ts`, `resolveSeatMember` (~line 306): after today's steps (1) the card's member in the attached book, (2) with `mint` and `attachedMintable`, a new member in the attached book, (3) the card's member found in the own book / ancestor books — add **(4) with `mint`, when no member was found anywhere and `book.ownBookId != null`, mint a new member into the own book**: take `pg_advisory_xact_lock(ownBookId)` exactly as step 2 locks the attached book, call `findOrInsertBinding(tx, ownBookId, cardId)` (it returns null for a deleted card — keep that: a deleted card is never given a member), and answer `{ memberId, minted: created, mintedIn: created ? ownBookId : null }` so `settleSeats` records it in `mintedMembers` and the caller names it after commit (`syncMintedSeatMembers`). Order matters: an attached mintable book still wins (step 2 before step 4); a member found in the own book or an ancestor's book (step 3) still wins over minting. `ownBookId == null` (a session with no own book yet, e.g. a branch mid-copy) → no mint, as today.

"The session's book" is the own book whether that own book is the session's whole lorebook (`sessions.lorebook_id` null) or an overlay of an attached book the session may not mint into (another user's, or a provided book): both go to `ownBookId`.

Then:
- Remove the "⚠ S1 never mints into the own book…" paragraph of `resolveSeatMember`'s doc comment and reword the doc to the new step 4 (one or two sentences, cite ★B-5 2026-11-08). Reword the matching sentence in the module header's "Which member a card is" paragraph (seats.ts ~lines 30-36: "else none yet — S1 never mints into the own book") to say it mints into the own book. Touch nothing else in seats.ts.
- `src/lib/server/sessions/seatMembers.ts` (the `seat-members` boot pass): its no-op fast path names candidates only when "settling can give it a member". Add the own-book mint to `resolvable`: a live seat is also resolvable when the session has an own book (`exists (select 1 from lorebooks o where o.session_id = s.id)`) and its card exists and is not deleted (`characters.is_deleted` false). Keep the query one query. Update the module doc (lines 19-30 mention "since S1 never mints into the own book" twice) and the comment above `resolvable` to match. Nothing else changes in seatMembers.ts.
- Is `syncLorebookBindingsForCharacter(cardId, db, { lorebookId })` (`src/lib/server/utils/characterBindingSync.ts`) fine naming a member in an own book? Read it and say so in your report (don't edit it; if it isn't, stop and report).

## Tests

- `src/lib/server/sessions/seats.int.test.ts`: the tests that assert "S1 never mints into the own book" (~lines 260-340: "no attached book: no member, nothing minted in the own book", and the `ownBookId == null || bindingsOf(ownBookId).length === 0` assertions) flip to the new rule: a session whose lorebook is its own book (no attached book) gets a member minted in its own book for each live carded seat; an attached book the owner may not mint into (provided / another user's) → the member is minted into the session's own book; an attached mintable book still takes the member (not the own book); a deleted card gets no member anywhere; a departed seat is never minted for. Update the file's header claim (~line 6).
- `src/lib/server/sessions/seatMembers.int.test.ts`: add "a session whose lorebook is its own book gets a member for every live carded seat (character and player seat); a second run changes nothing (report all zeros, a dump of `session_characters`, `session_personas`, `lorebook_bindings` identical)". Also a fast-path check: after the first run, the candidate query names no session (the second run's report is all zeros).
- Run these, and say which other files break because they assert the old guard: `src/lib/server/sessions/seatSites.int.test.ts` (~line 193 "S1 never mints into an own book"), `src/lib/server/sockets/sessions.seatCast.int.test.ts` (header ~line 11; find the assertion), `src/lib/server/sessions/closeOut*.test.ts` if any (see ★ below), `src/lib/server/sessions/branch.seatMembers.int.test.ts`, `src/lib/server/sessions/greetings.seatMembers.int.test.ts`. For `seatSites.int.test.ts` and `sessions.seatCast.int.test.ts` you MAY flip **only the assertions and header sentences that state the removed guard** to the new rule (the member is minted in the own book); nothing else in those files. Any other failure: don't fix, report it with the assertion and your diagnosis.

Command (from `/home/jody/github/serene-pub`, capped; never pipe vitest into `head`):

```
SP=/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > $SP/s4-f-pass-w1-tests.log 2>&1; echo test-exit=\$? >> $SP/s4-f-pass-w1-tests.log"
```

An int test that opens a DB inside an `it` needs a 60 s timeout (`vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })`, as the existing files do).

## Rules your work depends on (quoted)

- CLAUDE.md Hard rule: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." seats.ts takes its handle first and must not statically import `$lib/server/db`.
- CLAUDE.md Standing ruling: "0.6 is in users' hands. A change to stored data or ids ships with a forward migration or boot pass and a test that a second boot changes nothing."
- Owner 2026-11-05 ★27-10: "All sessions have a lorebook, [own book] or overlay. No exceptions…" — never write code or comments that frame a session as having no lorebook; say "own book" / "overlay" / "a session whose lorebook is its own book".
- Owner 2026-11-05 ★S1-1: "a second card of a person already seated is refused in words, never merged silently" — the merge rule and `secondCard` are untouched by you.
- Prettier: run `npx prettier --check` on changed files, but only `--write` the lines you changed — never reformat a whole file you didn't otherwise edit. If a file fails the check only on lines you didn't touch, leave it and say so.
- It is a **session**, never a chat.

## Files owned

`src/lib/server/sessions/seats.ts` (only `resolveSeatMember`, its doc, and the header sentence named above), `src/lib/server/sessions/seatMembers.ts`, `src/lib/server/sessions/seats.int.test.ts`, `src/lib/server/sessions/seatMembers.int.test.ts`; the guard assertions only in `src/lib/server/sessions/seatSites.int.test.ts` and `src/lib/server/sockets/sessions.seatCast.int.test.ts`.

## Files readable

Anything. Useful: `src/lib/server/utils/characterBindingSync.ts`, `src/lib/server/lorebooks/ownBook.ts` (`ownBookOf`, `ownBookFor`), `src/lib/server/sessions/bookLock.ts`, `src/lib/server/sessions/closeOut.ts`.

## Out of scope

`seatCast` / `seatPlayer` / `settleSeats` bodies (they already pass `mint` through), the merge rule, `seatOf`, `startup/index.ts`, `bookLock.ts`, `closeOut.ts`, anything under `state/**`, any new seat-keys code (another worker).

## Stop and ask (in your report, don't decide) when

A new name, setting, event, table or migration seems needed; a test outside the files above needs more than the guard flip; `syncLorebookBindingsForCharacter` can't name an own-book member.

**Known side effect to check and report, not fix:** `playHasWritten` (`sessions/bookLock.ts:28`) counts any member in the own book as play, and `catchUpOfferFor` (`sessions/closeOut.ts:79`) hides the catch-up offer once play has written. A session reading another user's / a provided book with a seated persona will now get a member minted into its own book at seat time. Tell me whether any existing test of the catch-up offer fails because of it (run `src/lib/server/sessions/closeOut*.test.ts` files if they exist).

## Done means

The seats and seatMembers files green (plus the two guard-flipped files), each new claim tested, report listing: changed files with a one-line summary each, every test file run with pass/fail counts, prettier result, the `syncLorebookBindingsForCharacter` answer, the catch-up-offer answer, anything noticed and not done.
