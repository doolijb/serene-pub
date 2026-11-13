# BRIEF s27-S1-w5 — bring the seat tests to the S1 minting rule

Lane **s27-S1**. App `/home/jody/github/serene-pub`. Report: your final message. Only test files change.

## What changed (supervisor decision, already in the code — read `src/lib/server/sessions/seats.ts` `resolveSeatMember` and `src/lib/server/sessions/seatMembers.ts`)
`resolveSeatMember` now resolves: (1) the card's member in the attached book; (2) with `mint`, when the attached book is `attachedMintable` (the session owner's, not provided), a new member **there**; (3) the card's member in the own book; (4) else **null — S1 never mints into the own book**. Why: a member minted into the own book counts as play (`sessions/bookLock.ts` `playHasWritten`), which locks a bookless session against a later attach and keeps the card's member out of the book attached then (w3 found this through `sessions.castBindings` and `sessions.castFromLorebook`). The boot pass's candidate query now includes a live seat lacking a member only when settling can give it one (a book of the session knows the card, or the attached book may mint for a non-deleted card). `sessions:create` no longer defers members (the `deferMember` branch there is gone).

## Goal
Update the 11 now-failing tests to the rule above — change expectations and, where a test's point was "minted in the own book", re-aim it at what the rule now does — without weakening anything else. Current failures:
- `src/lib/server/sessions/seats.int.test.ts`: "a card that is a member only in the own book: the own book's" (now: with an attached mintable book the attached book mints first — make the test's attached book someone else's or provided so the own-book member is found, and add the mintable case as its own expectation); "no member, a book someone else owns: minted in the own book", "no member, a provided book: minted in the own book, even for its owner", "no attached book: minted in the own book" → each now: **null member, no row minted anywhere** (assert no `lorebook_bindings` row for the card in the own book or the attached book).
- `src/lib/server/sessions/seatMembers.int.test.ts`: "a second run changes nothing" (a session whose only seat is unexplained is no longer a candidate: `sessions`/`unexplained` counts change — recompute from the fixture, keep the second-run no-op assertion).
- `src/lib/server/sessions/seatSites.int.test.ts`: "a session with no book: the branch's seats carry members of the branch's own book…" → now null members in the branch and nothing minted; "an envoy seat comes across…", "player seats: … members carried …", "a solo chat …", "a group chat …" → read each failure; where the fixture is bookless, either give it a book its owner owns (so the members are minted in the attached book and the assertions keep their point) or assert null — prefer giving it a book where the test's point is "members carried", and keep one bookless assertion of null.
- `src/lib/server/sockets/sessions.seatCast.int.test.ts`: "a provided book gets no member made in it: the seats' members land in the session's own book" → now: no member made in the provided book **and none in the own book**; the seats' `cast_member_id` is null (unless the provided book already holds a member for the card — then that one).
Add two tests in `sessions.seatCast.int.test.ts`: (a) a bookless `sessions:create` with a character → seat member null, **no** `lorebook_bindings` row in the own book, and a later attach of a book the owner owns (through the same update path `sessions.castBindings.int.test.ts` uses) is allowed and gives the seat the attached book's newly minted member; (b) `seatMembers` over a bookless session with a seat lacking a member returns all zeros (not a candidate).
Re-read each test before you edit it; keep the files' existing style; do not touch tests that pass.

## Run (all must be green)
`npx vitest run src/lib/server/sessions/seats.int.test.ts src/lib/server/sessions/seatMembers.int.test.ts src/lib/server/sessions/seatSites.int.test.ts src/lib/server/sockets/sessions.seatCast.int.test.ts src/lib/server/sockets/sessions.castBindings.int.test.ts src/lib/server/sockets/sessions.castFromLorebook.int.test.ts src/lib/server/sockets/sessions.ownBookCreate.int.test.ts src/lib/server/sockets/castMemberLifecycle.int.test.ts src/lib/server/sockets/scopedReplies.lorebooks.int.test.ts src/lib/server/sessions/branch.clock.int.test.ts src/lib/server/sessions/branch.revision.int.test.ts src/lib/server/sessions/branch.state.int.test.ts src/lib/server/pipelines/entities/envoys.int.test.ts src/lib/server/sockets/import.sillyTavernFinish.int.test.ts src/lib/server/sockets/imports.hardening.int.test.ts src/lib/server/sockets/import.mapperParity.int.test.ts src/lib/server/lorebooks/ownBook.int.test.ts`
If a failure is in non-test code, stop and report it with the error — do not change non-test code.

## Files owned
`src/lib/server/sessions/seats.int.test.ts`, `src/lib/server/sessions/seatMembers.int.test.ts`, `src/lib/server/sessions/seatSites.int.test.ts`, `src/lib/server/sockets/sessions.seatCast.int.test.ts`.
## Out of scope
Every non-test file.

## Rules (quoted)
- CLAUDE.md: *"Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently; `db/transactionGuard.ts` throws in dev/test."* · *"Never add a top-level `await` to `src/lib/server/db/index.ts`."* · *"Never seed a row at a hardcoded id."* · *"`socket.off(event)` with no handler removes every listener app-wide."* · *"Sockets: one domain context per event family … is the only listener, and the only place that toasts."* · *"Never `kill -9` the dev server."*
- CLAUDE.md P1 *"Deterministic, never hidden … every automatic action shows its cause"*; P2 *"A module owns its data and every write to it … Two writers of one thing is a bug."* — `sessions/seats.ts` is now the one writer of seat rows: no site may `insert(schema.sessionCharacters)` / `insert(schema.sessionPersonas)` directly any more.
- Decisions: *"Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing."* · *"Say each assumption when you make it."*
- The files you edit are **dirty at HEAD** with other lanes' uncommitted work: re-read the region right before each edit, make additive hunks, **never reformat** the file (no prettier --write on it; `npx prettier --check` only to see), never revert anything you did not write.
- Memory: *"defaultDb() bypasses vi.mock — pass db explicitly."* · *"An int test that opens a DB inside an `it` needs a 60 s timeout under load."* · *"Never pipe vitest into `head`: the SIGPIPE leaks PGlite temp dirs."*
- NOMENCLATURE R1/R3/R6: one word one meaning; qualify (*cast member*, *character seat*, *player seat*); mark 🚧/⏳. No new exported name beyond what this brief lists.
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You need no sdk:build.)
- Never `git checkout` / `restore` / `stash` in either repo.

## Done means
The 11 tests updated (say what each now asserts), the two new tests, the run above green with counts.
