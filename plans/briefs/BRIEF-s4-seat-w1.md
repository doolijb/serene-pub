# BRIEF — lane `s4-seat`, worker w1 — card-less seats: the seat writer and the create/update doors (2026-11-08)

Supervisor: lane `s4-seat` (wave 4 of seat-cast S4; the flip is ON — `src/lib/server/state/memberForm.ts` `memberFormSwitch = { on: true }`). Repo `/home/jody/github/serene-pub`. Report back in your final message (the supervisor saves it); do not write a report file.

## Context you need (quoted by the supervisor; never reinterpret)

- Owner 2026-11-05: "Everything in session is cast → active card." Cards seed cast; a seat reads its member over the member's active card.
- Owner 2026-11-05 ★S2b-1 "Still theo": the person who seated a cast member keeps acting for that seat (`session_characters.seated_by_user_id`).
- Owner 2026-11-05 ★27-10: "All sessions have a lorebook, [own book] or overlay. No exceptions … No swapping lorebooks." Never write code or copy that frames a session as having no lorebook.
- Owner 2026-11-08 ★6: "Take a seat" with a seat name **mints a card-less member in the session's book**, named by the seat name. Trade-off accepted: one member per named seat, including retire re-seats.
- Owner 2026-11-08 ★K-4: the unique (session, member) index waits for S5's migration — **no migration in this lane**; live paths refuse pairs.
- Owner 2026-11-08 ★S4-1: provided books keep their plugin-stamped cards hidden; starter copies are card-less. Plan §34.2: "a provided book seats all its members".
- Plan §34.2: "`seatCast` gains a `castMemberId` form: member must live in one of the session's books and not be an overlay row, else refused in words; `character_id` = linked card or null (⏳ until S5); seater required ("Still theo"); revive by (session, member). `seatPlayer` gains `castMemberId` (★6). `bookCastToSeat` returns `{castMemberId, cardId|null}` and stops dropping card-less members. `sessions:create`/add accept `castMemberIds`. Every `isNotNull(characterId)` filter → 'not an envoy, and has a member or a card'."
- Schema facts (`src/lib/server/db/schema.ts` ~3866 `sessionPersonas`, ~4001 `sessionCharacters`): `session_characters` unique on (session_id, character_id) and on (session_id, envoy_slug) — NULLs are distinct, so a card-less row (`character_id` null, `envoy_slug` null) has **no unique key**: revive it by find-then-update. A CHECK forbids card+envoy together. `session_personas` unique on (session_id, persona_id). `cast_member_id` on both tables is `lorebook_bindings.id`. A **member overlay row** is a `lorebook_bindings` row with `overlay_of` set (0145); never seat one.
- **A card-less character seat** = `session_characters` row with `envoy_slug IS NULL`, `character_id IS NULL`, `cast_member_id` set. Addressed `seated-member:<castMemberId>`, stat owner `seated_member` (already works through `seatOf`, which matches `cast_member_id` and skips envoys).
- **The seat filter** (replaces `isNotNull(characterId)` where a query means "a character seat"): *not an envoy, and has a member or a card* — `and(isNull(cs.envoySlug), or(isNotNull(cs.characterId), isNotNull(cs.castMemberId)))`. Write it inline; do not export a new helper name.
- **The session's books** are `SeatBook` (`sessions/seats.ts` `seatBookOf`): `attachedId` (the book the session reads — for an overlay session this is the overlay's parent), `ownBookId` (the session's own notes; for an overlay session its `overlay_of` = `attachedId`), and `ancestorBooks[].lorebookId` (a branch reads its ancestors' own books). A member "in the session's books" lives in any of these.
- Binding writer (P2 — the lorebooks/characters module's writer, never a raw insert): `insertCastMember(tx, { lorebookId, characterId: null, binding: <token>, name })` in `src/lib/server/characters/versions.ts` (~640), with the token from `deriveNextBindingToken(lorebookId, tx)` (see how `resolveOrCreateBindingByName` in `src/lib/server/utils/summarizer/availableSceneCast.ts` ~621 does it) **under `pg_advisory_xact_lock(lorebookId)`** taken on the same `tx`.

## Goal

1. **`seatCast` castMemberId form** (`src/lib/server/sessions/seats.ts` ~375). Input gains `castMemberId?: number | null` (one JSDoc sentence). Exactly one of `cardId` / `envoySlug` / `castMemberId` (update the thrown message). With `castMemberId`:
   - Read the member row (`lorebook_bindings`: `lorebookId`, `characterId`, `overlayOf`, name). Refuse (return `{ ok: false, refusal, … }` — widen `SeatResult`'s refusal arm so `memberId`/`seatedSeatId` may be null, or add a sibling arm; your choice, name it) when: the member does not exist; it is an overlay row; it does not live in one of the session's books. Sentences go in `SEAT_REFUSALS` as new functions, marked "★ copy for the owner" like the existing one. Draft copy (use as written):
     - overlay row: `"That row is this session's notes on ${name}. Seat ${name} instead."`
     - outside the books: `"${name} isn't in this session's lorebook. Seat someone from its cast instead."`
     - gone: `"That cast member is no longer in this session's lorebook."`
   - **Seater required:** `seatedBy` must be a number; throw an `Error` naming the rule otherwise (a programming error, not a user refusal).
   - `character_id` := the member's linked card (`lorebook_bindings.character_id`) or null (⏳ until S5 — comment it).
   - Linked card non-null → behave as the card form with that card, but take this member directly (no `resolveSeatMember`); the same-member refusal (`secondCard`) still applies.
   - Card-less → the merge rule up front: a **live** character seat of this session already holding this member (any `character_id`) → with `onExisting: "keep"` return it; else refuse with `SEAT_REFUSALS.sameMember(name, name)` (`secondCard: "allow"` skips the refusal and returns that seat). Otherwise revive by (session, member): the newest departed row with `envoy_slug` null and this `cast_member_id` (clear `removed_at`, `removed_name`, `merged_into`; set `is_active`, `position` when given, `seated_by_user_id` = seater); else insert. `minted: false`, `mintedMembers: []`.
2. **`seatPlayer` castMemberId form + ★6 mint** (`seats.ts` ~564).
   - `castMemberId?: number | null`: same member checks and refusal sentences as above (seatPlayer returns no refusal today — **throw an `Error` carrying the sentence** is acceptable here; or add a refusal return; name your choice). `persona_id` := linked card (if a `personaId` is also passed and differs, throw). Linked card → the persona path with this member. Card-less → revive by (session, member) among `session_personas` (newest departed row with that member and `persona_id` null) else insert.
   - **★6:** `mintCardless?: boolean` (one JSDoc sentence quoting ★6). When true, `personaId` null, no `castMemberId`, a non-blank `seatName`, live (`removedAt` not set), not `deferMember`: mint one card-less member named `seatName.trim()` in the session's **own book** (`ownBookId`); if the session has no own book, mint in `attachedId` only when `attachedMintable`; else write the seat with no member. Always a NEW member (never matched by name). Return it on the result (`castMemberId`, `minted: true`; `mintedMembers` stays card-only — a card-less mint needs no after-commit name sync because it is born named).
   - ⚠ `writeSeatName` (`sessions/seatName.ts`) is **not your file**: do not edit it. The supervisor queues "call `seatPlayer({ …, mintCardless: true })`" there for the lead. Your tests call `seatPlayer` directly.
3. **`settleSeats` merge rule covers card-less seats** (`seats.ts` ~826): the step-3 query uses the seat filter instead of `isNotNull(cs.characterId)` (keep `isNotNull(castMemberId)`); the ranking's "holds the linked card" must not count `null === null` as holding a card (a card-less seat holds the linked card only when the member is card-less too — decide and say so); `removedName` and `cardsNow` guard a null `cardId`. Steps 1–2 (fill members by card) stay card-only — say so in a comment. Lines ~733 and ~779 keep `isNotNull(characterId)` (they resolve cards) unless you find a reason; justify either way.
4. **`sameMemberRefusal`** gains `castMemberIds?: readonly number[]` so create/update check card and member forms together before writing (a card whose member is also listed by id → refused).
5. **`bookCastToSeat`** (`src/lib/server/sessions/seatBookCast.ts`) returns `{ castMemberId: number; cardId: number | null }[]`: every member of the book (`lorebook_bindings` with `lorebook_id` = the book, `overlay_of` null), in the book's order (as `castMemberCards` orders: by member id), card-less members included. Skip a member whose **active card** is a persona card (`membersAsRead(db, ids, {})` `activeCardId` → `characters.is_persona`); skip a member whose cards (`castMemberCards(…).cardsOf`) include one in `exclude`, or whose id is in a new `excludeMembers` set. A provided book seats **all** its members (drop the provided-mark card filter; keep the readable-by check). Update the header comment.
6. **Doors** (`src/lib/server/sockets/sessions.ts`, `src/lib/shared/sockets/types.ts`):
   - `Sockets.Sessions.Create.Params` and `Sockets.Sessions.Update.Params` gain `castMemberIds?: number[]` (one JSDoc sentence each: "🚧 Card-less cast members of this session's lorebook to seat as characters (plan §34.2); the server checks each lives in the session's books."). ⚠ Another lane (s4-cp) may edit the `Sockets.Characters` namespace of `types.ts` at the same time — touch nothing in that namespace, and nothing in `Sockets.Characters.Page` (lane chr-read's block).
   - `sessions:create` (~849, seats at ~1555–1610; book cast at ~1240): seat `castMemberIds` after the picked characters via `seatCast({ castMemberId, seatedBy: userId, secondCard: "allow" })`; the book's cast (`bookCastToSeat`'s new shape) through the castMemberId form too (`excludeMembers` = the request's `castMemberIds`); `shapeViolations` counts both; `sameMemberRefusal` gets both lists. A refusal from `seatCast` inside the create transaction must abort the create with that sentence (find how the handler refuses today — `refuse(...)` — and keep one path).
   - `sessions:update` (~6700–6900): when `params.castMemberIds !== undefined`, diff the live card-less character seats (`character_id` null, `envoy_slug` null, `cast_member_id` set) against it: add through `seatCast` castMemberId form (`seatedBy: userId`; a refusal throws its sentence as the handler's other refusals do); soft-remove one not in the list when the caller is the session owner or the seat's `seated_by_user_id` (same columns a removal sets today: `removed_at`, `removed_name` = the member's shown name as read, `is_active: false`). Never touch carded rows in this diff, and keep the existing `characterIds` diff from touching card-less rows (it already skips `characterId === null`; keep that). `is_group` counts both.
7. **The remaining `seats.ts` filters** — check `seatOf`, `findSeatMembers` and any other `isNotNull(characterId)` in `seats.ts` and apply the seat filter only where the query means "a character seat" (not where it resolves a card). List each site and the choice in your report.

## Files owned (edit only these)

`src/lib/server/sessions/seats.ts`, `src/lib/server/sessions/seatBookCast.ts`, `src/lib/server/sockets/sessions.ts` (only the create / update hunks named above), `src/lib/shared/sockets/types.ts` (only the two Params fields), and new or existing tests next to them: `src/lib/server/sessions/seats.int.test.ts` or a new `src/lib/server/sessions/seats.cardless.int.test.ts`, a new `src/lib/server/sessions/seatBookCast.cardless.int.test.ts` (or the existing seatBookCast test if one exists — `grep -rl bookCastToSeat src --include=*.test.ts`), and the existing tests of these functions that your change makes stale (fix them to the new shape; never delete an assertion — say which).

## Files readable

Everything. Start with `seats.ts` 1–1129, `seatBookCast.ts`, `utils/castMemberCards.ts`, `characters/versions.ts` ~630–700, `utils/summarizer/availableSceneCast.ts` ~600–660, `cast/memberAsRead.ts` (`membersAsRead`, `MemberAsRead`), `lorebooks/ownBook.ts` ~290–330, existing `sessions/seats.int.test.ts` for the test harness pattern.

## Out of scope (written down, never built)

Reader sites (seatedCast, rowProjection, portrayals, gate, handEdits, seatRefs, seatCards, resolveVoice, sprites, characterLore, bindings, greetings, speakerRotation, illustrateScene) — worker w2. Client and pickers. `seatName.ts`. Docs. NOMENCLATURE (queue rows in your report). Starters, Copy to my characters, the Characters view, fold. No migration, no unique index (★K-4).

## Stop and ask (put it in your report, don't decide) when

CLAUDE.md §Decisions applies; a ★ is unruled; you want a new exported name beyond `castMemberId`, `mintCardless`, `excludeMembers` and the new `SEAT_REFUSALS` functions; a migration seems needed; a change outside your files is needed (describe the exact edit).

## Hard rules (CLAUDE.md)

- Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently.
- Never seed a row at a fixed id. No migration. Never add a top-level `await` to `src/lib/server/db/index.ts`.
- It is a **session**, never a chat.
- An int test that opens a DB inside an `it` needs a 60 s timeout. Never pipe vitest into `head`.
- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no sdk:build.)
- Prettier: `npx prettier --check` changed files; only `--write` lines you changed — never reformat a whole file. `sockets/sessions.ts` and `types.ts` are huge: hand-format your hunks.
- Never `kill -9` anything. Never `git checkout`/`restore`/`stash`.

## Tests (Done means)

Run only your test files, capped, logged in the supervisor's scratchpad:

```
SP=/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > $SP/s4-seat-w1-tests.log 2>&1; echo test-exit=\$? >> $SP/s4-seat-w1-tests.log"
```

Must pass, each as its own `it`:
- a card-less member of the session's own book is seated by `castMemberId` (row: `character_id` null, `cast_member_id` = member, `seated_by_user_id` = seater) and `seatOf(db, sessionId, "seated-member:<id>")` finds it;
- removed then seated again → the **same row** is revived (no second row);
- a member of an unrelated book → refused with the outside sentence, nothing written; an overlay row → refused with the overlay sentence; a missing seater → throws;
- a member with a linked card seated by `castMemberId` → `character_id` = that card;
- envoy seats untouched (an envoy seat in the same session keeps its row; `seatCast({ envoySlug })` still works);
- the merge rule (`settleSeats(tx, id, { merge: true })`) departs a duplicate when a card-less seat and a carded seat (or two card-less rows inserted raw) share one member, survivor per the rule, `merged_into` set;
- `seatPlayer({ castMemberId })` card-less → `persona_id` null, member set; revive reuses the row;
- `seatPlayer({ personaId: null, seatName: "Ann", mintCardless: true })` mints exactly one new card-less member named "Ann" in the own book and stores it on the seat; a second call (a retire re-seat) mints a second member;
- `bookCastToSeat` returns card-less members, skips a persona-active-card member and an excluded one, and a provided book returns all its members;
- `sessions:create` with `castMemberIds` seats them (handler-level int test if the existing tests drive handlers that way; otherwise test the pieces and say so).
Also re-run the existing tests for these functions (`grep -rl "seatCast\|seatPlayer\|settleSeats\|bookCastToSeat\|sameMemberRefusal" src --include=*.test.ts`), in batches of ≤10 files.

`npx tsc --noEmit -p .` must show no new errors in your files (run it under `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0` with `NODE_OPTIONS=--max-old-space-size=8192`; log to `$SP/s4-seat-w1-tsc.log`).

## Report (final message)

Changed files; each decision you made (named); tests run with pass counts and log path; tsc result; anything stopped-and-asked; Noticed, not done; NOMENCLATURE rows to queue (new fields/options/refusals, verbatim draft).
