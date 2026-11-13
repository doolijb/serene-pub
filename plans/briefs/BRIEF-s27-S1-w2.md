# BRIEF s27-S1-w2 — the one seat writer (`sessions/seats.ts`) and the `seat-members` boot pass

Lane **s27-S1**. App `/home/jody/github/serene-pub`. Report: your final message.

## Context (already built by w1 — read it in `src/lib/server/db/schema.ts`, migration `drizzle/0145_seat_cast_members.sql`)
- `session_characters` now has `id` (identity PK), `cast_member_id` (→ `lorebook_bindings.id`, SET NULL; non-unique index with `session_id`), `merged_into` (→ `session_characters.id`, SET NULL, ⏳). The unique (session, character) index stays.
- `session_personas.cast_member_id` (SET NULL). `lorebook_bindings.overlay_of`, `.timbre`; `messages`/`session_messages.cast_member_id`; `sprite_sets.cast_member_id` — **not yours, do not write them**.
- Owner ruling (2026-11-05, plan §27): *"Move to seating cast instead of cards. Every session has a lorebook or [own book] now. Cards seed cast, cast defaults to reading active linked card."* S1 = dual-write (`character_id` **and** `cast_member_id`), **behaviour otherwise unchanged**.

## Goal
Two new modules + one startup registration + their int tests. Do **not** convert any call site (that is w3's job, after you); w3 will call exactly the API below, so keep these names and shapes.

### 1. `src/lib/server/sessions/seats.ts` (new, 🚧 header doc: purpose, what it owns — every write of a seat row's `character_id`/`envoy_slug`/`cast_member_id`/`merged_into`; what it does not — readers (S2), lines and values (S4))
Every function takes a handle (`tx: Db`) first; the caller is inside a transaction and passes its `tx`. **No static import of `$lib/server/db`** (directly or through a module that imports it statically — e.g. `utils/ownedBook.ts` does; `lorebooks/ownBook.ts` may: import those with `await import(...)` inside the function). Use `memberOfCard` from `utils/castMemberCards.ts`, `findOrInsertBinding` + `syncLorebookBindingsForCharacter` from `utils/characterBindingSync.ts`, `markedBook` from `plugins/providedMarks.ts` (check its import chain), `ownBookOf`/`ownBookFor` from `lorebooks/ownBook.ts` (read-only use; that file belongs to another lane — never edit it), `resolveCharacterName` from `$lib/shared/utils/resolveCharacterName`.

- `seatBookOf(tx, sessionId): Promise<SeatBook | null>` — `SeatBook { sessionId; ownerId; attachedId: number | null; attachedMintable: boolean; ownBookId: number | null }`. `attachedMintable` = the attached book exists, its `user_id` = the session's `user_id`, and it is **not** a genuinely provided book (`markedBook(extraJson, uuid)` null). That is exactly today's `runLorebookBindingCheck` gate (`sockets/sessions.ts` ~5612–5641: owner owns the book via `findOwnedBook`, and a provided book mints nothing for anyone) — read it and match it; say in your report if `findOwnedBook`'s extra session-notes branch matters (it should not: an attached book is never a session's notes).
- `resolveSeatMember(tx, book, cardId, { mint }): Promise<{ memberId: number | null; minted: boolean }>` — plan §27 A, in order: (1) the card's member in the attached book (`memberOfCard`, which finds linked **and dated** cards); (2) else its member in the own book; (3) else, only when `mint`, mint one: in the attached book when `attachedMintable`, else in the own book (`ownBookFor(tx, sessionId)` when `ownBookId` is null). Mint = `await tx.execute(sql\`select pg_advisory_xact_lock(${lorebookId})\`)`, then `findOrInsertBinding(tx, lorebookId, cardId)` (null for a deleted card no member has — answer `{ memberId: null }`), and when it `created`, `await syncLorebookBindingsForCharacter(cardId, tx, { lorebookId })` (name/aliases from the card — the same follow-up `resolveOrCreateBindingRow` does).
- `seatCast(tx, input): Promise<SeatResult>` — the one writer of a **character seat** or an **envoy seat**:
  ```ts
  input: {
    sessionId: number
    cardId?: number | null        // a character seat
    envoySlug?: string | null     // an envoy seat — no member; passed through
    position?: number
    isActive?: boolean
    onExisting?: "revive" | "keep" // default "revive": upsert on (session, card) / (session, envoy) reviving a soft-removed row
                                   //   (removedAt null, removedName null, isActive true, position, castMemberId); "keep": ON CONFLICT DO NOTHING
    secondCard?: "refuse" | "allow" // default "refuse"
  }
  type SeatResult =
    | { ok: true; seatId: number; castMemberId: number | null; minted: boolean }
    | { ok: false; refusal: string; memberId: number; seatedSeatId: number }
  ```
  A character seat resolves its member with `mint: true`, writes **both** `character_id` and `cast_member_id`. The upsert target for a card is (sessionId, characterId); for an envoy (sessionId, envoySlug) — copy the two existing upserts (`sockets/sessions.ts` ~6497–6517 for cards, `pipelines/entities/envoys.ts` ~267–278 for envoys). Return the row's `id` (`returning`, or a select when DO NOTHING returned nothing).
  **The merge rule applies to new seats** (owner ruling): with `secondCard: "refuse"`, when the resolved member already has a **live** seat in this session (`removed_at IS NULL`, `cast_member_id` = it, `character_id` ≠ this card), write nothing and answer `{ ok: false, refusal, … }`. Refusal copy 🚧 (★ for the owner, keep it in one exported constant/function `SEAT_REFUSALS.sameMember(memberName, seatedName)`): *"‹member name› is already in this session as ‹seated card's name›."*, or *"‹member name› is already in this session."* when the two names are equal ignoring case. Names: the member's `lorebook_bindings.name` (fallback the card's resolved name), the seated card's `resolveCharacterName`. With `"allow"` (bulk paths — import, branch), seat anyway; the caller settles after (below).
- `seatPlayer(tx, input): Promise<{ seatId: number; castMemberId: number | null; minted: boolean }>` — the one writer of a **player seat** row (`session_personas`):
  ```ts
  input: { sessionId: number; personaId: number | null; position?: number; userId?: number | null; seatName?: string | null;
           portraitMediaId?: number | null; removedAt?: Date | null; removedName?: string | null; onExisting?: "revive" | "insert" }
  ```
  `"revive"` (default) = the upsert at `sockets/sessions.ts` ~6628–6644 (on (sessionId, personaId): position, removedAt null, removedName null — plus castMemberId); `"insert"` = a plain insert (branch copies retired seats with their `removedAt`). Member: resolved by the same rule when `personaId` is set — `mint` only for a live seat (`removedAt` null/absent); a card-less seat has none. **A persona seat is never refused and never merged** into a character seat (owner ruling); a persona seat and a character seat on one card both carry the member.
- `settleSeats(tx, sessionId): Promise<SettleReport>` — steps 1–2 for one session, the body the boot pass and (w3) `runLorebookBindingCheck` call. `SettleReport { filled: number; minted: number; merged: { departedSeatId: number; survivorSeatId: number; castMemberId: number }[]; unexplained: number }`.
  1. Every **live** character seat with a `character_id` and every live player seat with a `persona_id`: resolve with `mint: true`; when the answer is non-null and differs from the stored `cast_member_id`, write it (count `filled`). A null answer never clears a stored one. A live seat with a card left null afterwards counts `unexplained` (a deleted card no member has) and is left.
  2. Every **departed** seat (`removed_at` set) with a card and a null `cast_member_id`: resolve with `mint: false` and fill if found; never mint for a departed seat; a departed seat with no card (`character_id` null) is left alone.
  3. **The merge rule** (owner ruling 2026-11-05): group the live **character** seats (envoys excluded; `removed_at IS NULL`) by non-null `cast_member_id`. In a group of two or more, the **survivor** is: the seat holding the member's linked card (`lorebook_bindings.character_id` — the "active linked card"); else the one with `is_active` true; then the lowest `position` (null = 0); then the lowest `id`. Every other seat of the group **departs** exactly as today's removal does (`sockets/sessions.ts` ~6450–6460: `removedAt: new Date()`, `removedName: resolveCharacterName(card, "Unknown")`, `isActive: false`) **and** gets `merged_into = survivor.id`; it keeps its `cast_member_id`. That row is the merge-pair record S4 reads. **Do not touch messages, attribute values/configs, sheets or anything else** — S4 re-stamps lines and merges values. Player seats are never merged.
  Deterministic: a second call on the same data changes nothing (assert it).

### 2. `src/lib/server/sessions/seatMembers.ts` (new; ⏳ header: lives as long as the attic, since the attic's ETL writes seats without members; deleted with the attic at the RC1 squash)
`seatMembers(db: Db): Promise<{ sessions: number; filled: number; minted: number; merged: number; unexplained: number; failed: number }>`:
- **Fast no-op path:** one query for the session ids that need it — a live character seat with a card and null `cast_member_id`, a live player seat with a persona and null `cast_member_id`, a departed character seat with a card and null `cast_member_id`, or two live character seats sharing a non-null `cast_member_id`. None → return zeros (one query, nothing else).
- Otherwise, **one transaction per session** (`db.transaction(async (tx) => settleSeats(tx as unknown as Db, id))`; inside it use **only `tx`**). A session that throws is counted in `failed`, logged with its id, and the pass goes on; after the loop, if `failed > 0` throw one Error naming the count (so the task's `failsHealth` reports it).
- Note: a session holding an unexplained seat (deleted card, no member) is a candidate on every boot and changes nothing — that is expected; say so in the doc comment.

### 3. Registration in `src/lib/server/startup/index.ts`
One new task object **right after** the `own-books` task (~line 258), additive hunk, matching its style: `name: "seat-members"`, `failsHealth: true` (not critical), ⏳ doc comment (plan §27 v2 S1; steps 1–2; lives as long as the attic; one transaction per session), `run` dynamically imports `seatMembers` and passes `db`; log one line only when something was filled/minted/merged or is unexplained/failed: `[seat-members] … seat(s) given a cast member, … minted, … merged, … left without one`.

## Tests (int; `it(…, 60_000)`; your own temp dirs only, released at the end)
`src/lib/server/sessions/seats.int.test.ts` and `src/lib/server/sessions/seatMembers.int.test.ts` (new). Read an existing int test that builds sessions/books/bindings on `createTestDb` (e.g. `src/lib/server/sockets/sessions.castBindings.int.test.ts`, `src/lib/server/lorebooks/ownBook.int.test.ts`) for setup. Pass the test db **explicitly** to the functions (a `defaultDb()`-style dynamic import bypasses `vi.mock`). Cover at least:
- seats: a card with a member in the attached book (linked) → that member, no mint; a **dated** card (a `cast_amendments` row whose `fields.characterId` names it) → the dated card's member; a card with a member only in the own book → the own book's; no member + owner owns the attached book → minted there with the card's name; no member + someone else's book (or a provided-marked book) → minted in the own book; a deleted card with no member → null, nothing minted; an envoy → seat with null member; revive of a soft-removed seat writes the member; `secondCard: "refuse"` on a second card of a seated member → refused with the sentence, nothing written; `"allow"` → written; `seatPlayer` with a card → member; card-less → null.
- seatMembers: fixtures with **overlapping card and member id ranges** (make a card whose id equals a member id of a different person, e.g. card 12 and member 12 being unrelated — assert the seat gets the right member, not id 12 by accident); seats with null members get them (attic-shaped rows: insert raw seats with `cast_member_id` null); **two live seats → one member**: the linked card's seat survives, the other departs with `removed_at`, `removed_name`, `is_active` false, `merged_into` = survivor id, messages and values untouched (insert one `session_messages` row naming the departing card and assert it is unchanged); **a persona seat + a character seat on one card** → both carry the member, no merge; a departed card-less seat left untouched; a deleted card without member → counted unexplained, left; **second run is a no-op** (all row snapshots equal, report all zeros except `unexplained`); the fast path returns zeros on a database with nothing to do; one session's failure does not roll back another's (optional if it needs mocking — say so if skipped).
Also run: `npx vitest run src/lib/server/sockets/sessions.castBindings.int.test.ts src/lib/server/lorebooks/ownBook.int.test.ts` (must stay green — you changed no caller, so they should).

## Files owned
`src/lib/server/sessions/seats.ts` (new), `src/lib/server/sessions/seatMembers.ts` (new), `src/lib/server/startup/index.ts` (the one task object), `src/lib/server/sessions/seats.int.test.ts` (new), `src/lib/server/sessions/seatMembers.int.test.ts` (new).
## Files readable
Anything.
## Out of scope (never edit)
Every call site (`sockets/sessions.ts`, `sockets/import.ts`, `sessions/branch.ts`, `pipelines/entities/envoys.ts`, `sessions/seatBookCast.ts`, `utils/characterBindingSync.ts`) — w3 does those; `schema.ts`/`drizzle/**`; `state/**`, `sockets/state.ts`, `messages/verbs.ts`, `sessions/settings.ts`, `db/defaults.ts`, `lorebooks/ownBook.ts`, the SDK, NOMENCLATURE.
## Stop and ask (in your report) when
a name beyond those above seems needed; a rule here conflicts with the code you read; a test can't pass without editing a non-owned file.

## Rules (quoted)
- CLAUDE.md: *"Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."* · *"Never add a top-level `await` to `src/lib/server/db/index.ts`; await `dbReady`."* · *"Never seed a row at a hardcoded id."* · *"0.6 is in users' hands. A change to stored data or ids ships with a forward migration or boot pass and a test that a second boot changes nothing."* · *"Never `kill -9` the dev server."*
- CLAUDE.md P1: *"Deterministic, never hidden. Code decides what code can … Same inputs, same result."* P2: *"A module owns its data and every write to it … Two writers of one thing is a bug."*
- Plan §27 challenger (taken): the boot pass is **not critical**, one transaction per session, a no-op fast path, `failsHealth`, unexplained rows counted and left.
- Memory: *"defaultDb() bypasses vi.mock — pass db explicitly."* · *"An int test that opens a DB inside an `it` needs a 60 s timeout under load."* · *"Never pipe vitest into `head`."*
- NOMENCLATURE R1/R3/R6: one word one meaning; qualify (`cast member`, `character seat`, `player seat` — never bare `seat` as a type name); mark 🚧/⏳.
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You need no sdk:build.)

## Done means
The five files; both new test files green and the two existing suites green (counts); `npx tsc --noEmit -p . 2>&1 | grep -E "seats|seatMembers|startup/index"` empty; prettier check on your files. Report: the exported API as built (signatures), decisions you made, test counts, anything stopped on.
