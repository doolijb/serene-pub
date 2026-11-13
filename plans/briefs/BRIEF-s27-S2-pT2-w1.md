# BRIEF s27-S2-pT2-w1 — one find-only rule for a seat's member; trust a stored member only in the session's books

Lane **s27-S2-pT2** (seat-cast programme, stage S2: readers switch onto the seated cast member). Supervisor: the lane-supervisor that wrote this. App `/home/jody/github/serene-pub`. Another worker (w2) edits `host.ts` and `sideCharacter.ts` at the same time; concurrent lanes edit `state/**`, `rulesets/**` and more. Touch nothing outside **Files owned**.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`: no SDK edit in this lane.)

## Goal
Today two pieces of code each say "which cast member is this card in this session, find-only": `resolveSeatMember` in `src/lib/server/sessions/seats.ts` (~213–246, the seat writer's rule: attached book, then — with `mint` — mint in the attached book, then the session's own book), and `seatCardsAsRead` in `src/lib/server/pipelines/prompt/seatCards.ts` (~108–131, a hand-copied loop over `castMemberCards` per book). Two copies of one rule is a bug (P2: "Two writers of one thing is a bug"; R1 one word, one meaning). Make ONE find-only export in `seats.ts` and have both use it. **No behaviour change.**

Second: `seatCardsAsRead` trusts a seat's stored `cast_member_id` wherever that member lives. After a book swap the stored member can sit in a book the session no longer reads. Trust it only when the member's lorebook is the session's attached book or its own book; otherwise treat the seat as unfilled (the find-only rule; none found → the card as it is).

## Items

### 1. The find-only export — `src/lib/server/sessions/seats.ts`
Add, beside `resolveSeatMember`, exactly this export (name chosen by the supervisor; do not rename):

```ts
/**
 * 🚧 Find-only: the member each card is in this session — its member in the
 * attached book, else in the session's own book (`resolveSeatMember`'s find
 * order, never minting). A card with neither is absent from the map. Each
 * card is asked once per call. "The card's member" is `memberOfCard`.
 */
export async function findSeatMembers(
	tx: Db,
	book: SeatBook,
	cardIds: readonly number[]
): Promise<Map<number, { memberId: number; lorebookId: number }>>
```
- Implement with `memberOfCard` (already imported in `seats.ts`), books in order `[book.attachedId, book.ownBookId]` (skip null; a book equal to one already asked is not asked again), each distinct card asked only until found.
- Rewrite `resolveSeatMember`'s **find half** onto it; the mint branch stays byte-for-byte. Result must be identical to today for every input:
  1. found in the attached book (`lorebookId === book.attachedId`) → that member, `minted: false`;
  2. else, when `book.attachedId != null && mint && book.attachedMintable` → today's mint branch exactly (advisory lock, `findOrInsertBinding`, `!made` → `{ memberId: null, … }` **without** falling back to the own book — as today);
  3. else found in the own book → that member;
  4. else `{ memberId: null, minted: false, mintedIn: null }`.
- Edit nothing else in `seats.ts` (not `seatOf`, not `seatCast`, not the header beyond adding `findSeatMembers` to the "Which member a card is" paragraph if you want one clause). Re-read the function right before you edit; the file is uncommitted work.

### 2. `seatCardsAsRead` uses it, and trusts a stored member only in the session's books — `src/lib/server/pipelines/prompt/seatCards.ts`
- Replace the hand-copied unfilled loop (the `castMemberCards` maps, ~117–131) with `findSeatMembers(db, book, cards)`. Drop the `castMemberCards` import if nothing else uses it.
- When any row has a card, read `seatBookOf(db, sessionId)` once. For the stored `castMemberId`s of rows with a card, read each member's lorebook in **one** query (`schema.lorebookBindings` `id`, `lorebookId` where `id in (…)`). A stored member is **trusted** only when its lorebook is `book.attachedId` or `book.ownBookId`. An untrusted one (another book, a deleted member, or `book` null) makes the row unfilled → `findSeatMembers`; nothing found → the row comes back as it was (the card).
- Keep every exported signature in `seatCards.ts` unchanged (`seatCardAsRead`, `seatCardsAsRead`, `cardsAsSeatsRead`, `cardFormRef`, `cardFormRefInCast`, `SeatCardRow`, `SeatRefCast`): later lanes build on them. Update the module header and `seatCardsAsRead`'s doc comment to say the find-only rule is `findSeatMembers` and that a stored member is read only when it lives in the attached or own book.
- `cardFormRefInCast`: add to its doc comment one sentence: "⚠ Mirrors `seatOf`'s order (`sessions/seats.ts`) — change both together; `seatCards.test.ts` pins it." No code change.

### 3. Tests
- `src/lib/server/pipelines/prompt/seatCards.test.ts` (pure): add a `describe("cardFormRefInCast keeps seatOf's order")` with one fixture of several seats on one member and assertions for each step of `seatOf`'s order: live before departed (a live player seat beats a departed character seat); then the character seat before the player seat; then lowest `position` (a null position counts as 0 — `seatOf` orders by `coalesce(position, 0)`); then lowest seat id. Read `seatOf` (`seats.ts` ~838–952) to match it exactly. Existing tests unchanged.
- `src/lib/server/pipelines/prompt/seatCards.int.test.ts`: add
  - "a stored member in a book the session no longer reads is not read": card C; book B1 with member M1 (`ownName: "Old"`) on C; book B2 with member M2 (`ownName: "New"`) on C; session attached to B2; seat holds C with stored `castMemberId = M1.id` → reads "New". Same with B2 holding no member for C → reads the card's name.
  - "a stored member in the session's own book is read": a session attached to B, a seat whose stored member lives in the session's own book (make the own book the way the existing tests do) → that member's own name.
- `src/lib/server/sessions/seats.int.test.ts`: append one `describe("findSeatMembers")` (re-read the file's end first; append only): attached book's member wins over the own book's; a card only the own book holds is found there with its `lorebookId`; a card linked nowhere is absent; a dated card (cast amendment `fields.characterId`, see `utils/castMemberCards.ts`) is found. Reuse the file's own fixture helpers.
- Existing tests in those files must stay green **unchanged**. If one needs editing, stop and say why in your report — that is a finding, not a fix.

## Rules (quoted from the lane's sources)
- CLAUDE.md Hard rules: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." `findSeatMembers` takes the caller's handle (`tx`); never import `$lib/server/db` statically in `seats.ts` or `seatCards.ts` ("⚠ No static import of `$lib/server/db`: every function takes its handle").
- S2 contract: "changes **no stored key and no stored data**"; "No migration, no SDK edit, no boot-pass change, no new setting, flag or event."
- "Every session has a lorebook — its own book (Session notes) or an overlay of a book. Never write 'no book', 'no lorebook', 'bookless', 'reads no lorebook' in code, comments, tests or copy; say 'a session whose lorebook is its own book'."
- CLAUDE.md Decisions: "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing." No new exported name other than `findSeatMembers`.
- Tests: "Never pipe vitest into `head`: the SIGPIPE leaks PGlite temp dirs." "An int test that opens a DB inside an `it` needs a 60 s timeout under load" (the files already set `vi.setConfig({ testTimeout: 60_000 … })`).

## Files owned
- `src/lib/server/sessions/seats.ts` — `findSeatMembers` (new) and `resolveSeatMember`'s find half only
- `src/lib/server/pipelines/prompt/seatCards.ts`
- `src/lib/server/pipelines/prompt/seatCards.test.ts`, `src/lib/server/pipelines/prompt/seatCards.int.test.ts`
- `src/lib/server/sessions/seats.int.test.ts` (append one describe)

## Files readable
Anything. Especially `src/lib/server/utils/castMemberCards.ts`, `src/lib/server/cast/memberAsRead.ts`, `src/lib/server/lorebooks/ownBook.ts`.

## Out of scope
`host.ts`, `sideCharacter.ts` (w2's), NOMENCLATURE (the supervisor's), `state/seatRefs.ts`, `seatOf`, every other file.

## Stop and ask when
A test must change; the find order can't be kept identical; you'd need a new name, setting or migration.

## Done means
Green, run from the app root with `npx vitest run <files>`:
`src/lib/server/pipelines/prompt/seatCards.test.ts src/lib/server/pipelines/prompt/seatCards.int.test.ts src/lib/server/sessions/seats.int.test.ts src/lib/server/sessions/seatSites.int.test.ts src/lib/server/sessions/seatMembers.int.test.ts src/lib/server/sockets/sessions.seatCast.int.test.ts src/lib/server/sessions/greetings.seatMembers.int.test.ts src/lib/server/connections/stops.seatMembers.int.test.ts src/lib/server/pipelines/runtime/host.seatMembers.int.test.ts`
plus `npx tsc --noEmit -p . 2>&1 | grep -E "seats\.ts|seatCards"` empty, and `npx prettier --check` on `seatCards.ts`, `seatCards.test.ts`, `seatCards.int.test.ts` (report `seats.ts` / `seats.int.test.ts` status; do not reformat them wholesale).

## Report
Return as your final message: changed files, the `findSeatMembers` and `resolveSeatMember` diffs in brief, tests run with counts, any test you had to touch (should be none), the `/tmp/serene-pub-vitest-*` dirs you made and deleted, Noticed-not-done.
