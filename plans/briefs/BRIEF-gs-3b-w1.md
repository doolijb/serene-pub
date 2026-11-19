# BRIEF — worker `gs-3b-w1` (server): a guest seats a copy of a card someone shared with them

Repo `/home/jody/github/serene-pub` (app). The SDK repo is read-only: no SDK edit, no `sdk:build`.
Supervisor: lane `gs-3b`. Re-verify every file:line below before you edit: the seat code changed today.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

Also: run **no git command that changes the index or the working tree** (no add, reset, checkout, restore, stash, commit). **Never run prettier with `--write` and never pipe prettier's output into a file.** No migration, no `npm run build`, no full test run.

## Owner rulings this implements (quote, don't reinterpret)

- 2026-10-12 (Q3): a shared character is "read and copy, never use-as-cast"; "a shared character is copied before it can join a session".
- 2026-11-16 (G3): "Guests can't choose directly from the owners card list, but can choose from shared cards from other users, shared cards are copied into the lorebook unlinked."
- 2026-11-17 (C1): the copy lands in **the session's notes** (the session's own book, `lorebooks.session_id = sessionId`), not the lorebook under them.

## Goal

A session member (built for the guest; the server needs no owner special case) asks, in a `sessions:update` save, to be seated on a card someone shared with them. The server, inside one transaction per pick: makes a **new card-less cast member in the session's notes** carrying the card's words, sheets, sprites, gallery and faces, with **no link back** to the card (no `character_id`, no `character_versions` parent pointing at the card's versions), then seats the caller on it **by `castMemberId` only** (never writing the shared card into `session_characters.character_id` / `session_personas.persona_id`). Later edits of the card never reach the copy.

## Build

### 1. `src/lib/server/cast/cardless.ts`
Add `"shared"` to `CardlessCause` (a TS union only; it is not stored, so no migration — verify with a grep that nothing persists `cause`). One doc line: a copy of a card shared with the asker, made into a new member of a session's notes (`copySharedCard`).

### 2. New `src/lib/server/cast/sharedCardCopy.ts` (★ names, keep them exactly)
Header doc: purpose, why it exists (the rulings above), what it owns (making the copy) and what it does not (seating: `sessions/seats.ts`; the share itself: `utils/shares.ts`). It takes its handle first and **never statically imports `$lib/server/db`**; import `lorebooks/ownBook` dynamically inside the function (as `sessions/seats.ts` does).

- `export const SHARED_CARD_REFUSALS = { notShared: "Only a character someone shared with you can be copied into a session." }` ★ copy.
- `export async function sharedCardRefusal(db: Db, cardId: number, userId: number): Promise<string | null>` — null only when the card exists, is not deleted (`characters.is_deleted`), is **not** the caller's (`characters.user_id !== userId`), and `isSharedWith(db, "character", cardId, userId)` (`utils/shares.ts` ~36). Otherwise `SHARED_CARD_REFUSALS.notShared`.
- `export async function copySharedCard(tx: Db, input: { sessionId: number; cardId: number; userId: number }): Promise<{ castMemberId: number; name: string; lorebookId: number }>`:
  1. `sharedCardRefusal(tx, …)`; a refusal is `throw new Error(sentence)`.
  2. The notes: `(await import("$lib/server/lorebooks/ownBook")).ownBookFor(tx, sessionId)` (makes it on first ask; `ownBook.ts` ~97).
  3. `await tx.execute(sql\`select pg_advisory_xact_lock(${lorebookId})\`)`, then `deriveNextBindingToken(lorebookId, tx)` (`utils/lorebookBindingToken`), as `seatPlayer`'s `mintCardless` branch does (`sessions/seats.ts` ~958–981).
  4. **Always a new member; never `findOrInsertBinding` and never "link then detach"** (the book's unique index `lorebook_bindings_character_unique` allows one linked member per card per book, and the sharer may already have that card's member here). Direct path, using only the versions module's exported writers (P2: it owns `character_versions`):
     - `const parent = await ensureCardVersion(tx, cardId)` (`characters/versions.ts` ~436).
     - `const member = await insertCastMemberCopy(tx, { lorebookId, binding: token, characterId: null, name: <card's name> })` (~695: a member with no base).
     - `insertCharacterVersions(tx, [{ castMemberId: member.id, lorebookId, parentVersionId: parent.id, personalPosition: null, nodeState: member.nodeState, nodeVisibility: member.nodeVisibility, writtenBy: null, ...emptyCharacterProfile(), follows: [...CHARACTER_PROFILE_FIELDS] }])` — its base (main, undated, no life point, no source session: `isBaseVersion` ~2063). Check the column list against `schema.characterVersions` and `insertMemberBase` (~707) and fix any field this list misses; say what you changed.
     - `makeMemberCardless(tx, member.id, { cause: "shared", card: cardId })` (`cast/cardless.ts` 72): `resolveFollows(… { detach: true })` copies every followed field from the card version into the version's own columns and clears `parent_version_id`; then sprites, gallery, card-layer sheets/configs/values, and faces re-owned to the notes' owner (the session's owner) through `fileForOwner`.
     - `writeBackShownName(tx, member.id)` (~1740; the one writer of the stored name).
  5. Return `{ castMemberId: member.id, name, lorebookId }`, `name` being the member's shown name as read (`membersAsRead(tx, [id], { sessionId })`), falling back to the card's name.

  Report whether the base insert needed anything beyond the list above, and confirm after the copy: no `character_versions` row of the member has a `parent_version_id`, and `lorebook_bindings.character_id` is null.

### 3. `src/lib/shared/sockets/types.ts` — `Sockets.Sessions.Update.Params` (~7256)
Shared file: re-read right before the edit, add only this field, after `seatHandovers`:
```ts
/**
 * 🚧 **Seats from shared cards** (owner rulings Q3 2026-10-12, G3 2026-11-16, C1 2026-11-17):
 * each names a card someone shared with the caller and the seat kind it was picked for.
 * The server makes a new card-less cast member in the session's notes, a copy with no
 * link back to the card (`copySharedCard`), and seats the caller on it: a character
 * seat they seated, or a card-less player seat they play, named as the card. One-shot:
 * nothing is compared against the existing seats, so a later save never copies again.
 */
sharedCardSeats?: Array<{ characterId: number; kind: "character" | "player" }>
```

### 4. `src/lib/server/sockets/sessions.update.ts`
- `seatPreflight` (~63): count `params.sharedCardSeats` in `none`. Dedupe entries by `characterId` + `kind`. For each entry, before any write: `sharedCardRefusal` → refusal; a guest (`switches` set) with `!switches.bringOwn` → `GUEST_SEAT_SENTENCES.bringOwnOff`; add 1 to `characterAdds` (kind `character`) or `personaAdds` (kind `player`) so the existing `seatKindAddRefusal` (genre opt-in, adds only) covers them. Do **not** add a watcher (`is_player`) check: an own-card add has none today (say so in the report).
- The write: a new block **after** the `playerSeatChanges` block (~1243) and **before** `announceSeatChanges`, so the `castMemberIds` / `personaIds` diffs of the same save never see the copy (a shared card id never enters `characterIds` / `personaIds`, so `checkCharactersOwnership`, `givePlayerSeatACard` and `markCharacterAsPersona` are never reached for it). For each deduped entry, **one** `db.transaction(async (tx) => …)` using **only `tx`** (the outer `db` inside deadlocks PGlite):
  - `const copy = await copySharedCard(t, { sessionId, cardId: entry.characterId, userId })`
  - kind `character`: position = (max `position` of the session's live character seats, as the `castMemberIds` block computes it ~1016) + 1; `seatCast(t, { sessionId, castMemberId: copy.castMemberId, position, seatedBy: userId })`; `!ok` → `throw new Error(seat.refusal)` (rolls the copy back).
  - kind `player`: position = (max `session_personas.position` of the session) + 1; `seatPlayer(t, { sessionId, personaId: null, castMemberId: copy.castMemberId, userId, seatName: copy.name, position })` — a named card-less player seat (`isCardlessPlayerSeat` needs the `seat_name`; `shared/sessions/playerSeat.ts` 33).
  - push the writer's `changes` onto `seatChanges`.
  - After the loop, when any character seat was added, recompute `sessions.is_group` exactly as the `castMemberIds` block does (~1057–1071).
- Add `params.sharedCardSeats?.length` to: the `membersBefore` condition (~835), and the `broadcastSessionToParticipants` condition (~1338). `pushSessionActions` then follows `membersBefore`.

### 5. The linked path Q3 forbids — `verifyBindingTargetAccess` (`sockets/lorebooks.ts` ~2324)
New rule: a linked binding of a card is allowed only for a card the caller **owns**, or one they can see **through a session's seat**; never one seen through a share alone. Today it falls through to `canViewCharacter` (`utils/sessionAccess.ts` ~73), which answers true on a share first.
- In `utils/sessionAccess.ts` (**the supervisor allows this one file outside the lane's list, extraction only**): split the session half of `canViewCharacter` into `export async function canViewCharacterThroughSessions(characterId, userId, handle = db)` (everything after the share probe, unchanged), and make `canViewCharacter` = share probe `||` that. No behaviour change for its other callers; keep its doc comment, give the new export a one-line doc.
- `verifyBindingTargetAccess`: unchanged for a missing/deleted card and for the owner; otherwise `return canViewCharacterThroughSessions(characterId, userId)`. Update its comment (one sentence: a card shared with the caller is read and copy only, Q3; it enters a cast only as an unlinked copy). Its four callers need no change: `sockets/lorebooks.ts` ~2407 and ~2647, `sockets/entries.ts` ~1037, `sockets/amendments.ts` ~933 — verify they still read correctly.

## Files owned (edit only these)
`src/lib/server/cast/cardless.ts`, new `src/lib/server/cast/sharedCardCopy.ts`, `src/lib/server/sockets/sessions.update.ts`, `src/lib/shared/sockets/types.ts` (the one field), `src/lib/server/sockets/lorebooks.ts` (`verifyBindingTargetAccess` only), `src/lib/server/utils/sessionAccess.ts` (the extraction only), new test files below. Readable: anything. Not yours: `sessions/seats.ts`, `sessions/seatName.ts`, `sessions/guestSeats.ts`, `sockets/sessions.ts`, `characters/versions.ts`, every client file, docs, NOMENCLATURE. A diagnostics lane may be live in `pipelines/runtime/haltExplanation.ts`, `utils/runReply.ts`, `sockets/sessions.pipelines.ts`, `sockets/sessions.turns.ts`: never touch them.

## Tests (new files; model the harness on `src/lib/server/sockets/sessions.seatHandover.int.test.ts`: its `vi.mock`s, `testDb`, `releaseDataDir`, `socket(userId)`, a 60 s test timeout)

`src/lib/server/sockets/sessions.sharedCardSeat.int.test.ts` (data dir prefix `serene-pub-vitest-sharedcardseat-`):
1. A guest (player) seats, as a **player seat**, a card a third user shared with them (`character_shares` row): a member exists in the session's notes (`lorebooks.session_id`), `character_id` null, its shown name and description the card's; the card's avatar file was copied to a file row owned by the **session's owner** (and a gallery picture or a card-layer sheet, whichever is cheaper to set up); no version of the member has a `parent_version_id`; the seat is `session_personas` with `persona_id` null, `cast_member_id` the copy, `user_id` the guest, `seat_name` the card's name.
2. Editing the original card afterwards (its description, through the card's own writer or the `characters` row + its card version as existing tests do) leaves the copy's description as it was.
3. Kind `character`: a card-less character seat, `seated_by_user_id` the guest, `character_id` null; `is_group` recomputed.
4. Refusals, each leaving no new member and no new seat: a card neither owned nor shared; the guest's **own** card sent through `sharedCardSeats`; a deleted shared card; *Guests can bring their own characters* off (`GUEST_SEAT_SENTENCES.bringOwnOff`); a genre whose shape has no personas, for kind `player` (use whatever genre/shape fixture the guest-seat tests use for `seatKindAddRefusal`).
5. The sharer's own card already seated in the same session (so its linked member is in the notes or the attached book): after the guest's copy, both members exist and the sharer's is still linked (`character_id` = the card).
6. A later save from the guest that sends `castMemberIds` including the copy keeps the seat (no second copy, no unseat).
7. Removing the seat: the guest removes the player seat (`playerSeatChanges: [{ playerSeatId, remove: true }]`): the seat is benched/removed by today's rule and the member stays in the notes.
8. The guest is removed (`sessions:removeGuest` by the owner): the player-seat copy is benched (its `user_id` still the guest) and the character-seat copy is handed to the owner (`seated_by_user_id` = owner); the copied members stay in the notes. Assert what happens; do not change `removeGuest`.
9. The owner's seat doors unchanged: run (not edit) the existing `sessions.guestSeats.int.test.ts`, `sessions.castToTake.int.test.ts`, `sessions.seatHandover.int.test.ts`, `sessions.seatCast.int.test.ts`.

`src/lib/server/sockets/sharedCardLinkedBinding.int.test.ts` (prefix `serene-pub-vitest-sharedcardlink-`): a forged request per caller, each refused with its existing sentence and writing nothing, with the card **shared** with the caller and not seated anywhere they are: `lorebooks:createBinding` (~2394), the binding update handler at ~2647 (find its event name), the entries save with `lorebookBindingCharacterId` (`sockets/entries.ts` ~1030), the amendments cast member edit with `characterId` (`sockets/amendments.ts` ~925). Twins that still pass: the caller's own card; a card seated in a session the caller is a guest of (through `lorebooks:createBinding` only).

Plus one assertion wherever cheapest: `characters:list` for a user carries a card shared with them (`isSharedWithMe`, `ownerName`) and never another user's card not shared with them (check first whether `sockets/shares.int.test.ts` already pins it; if so, name the test and add nothing).

## How to run tests
One at a time, always with paths, after waiting for other runs:
```
until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/gs-3b-w1-<n>.log 2>&1"
```
Never pipe vitest into `head`. `tsc`: `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` once at the end, filtered to your files in the report.

## Stop and ask (in your report; do not decide) when
A migration looks needed; the base version insert cannot be made through the versions module's exported writers; `makeMemberCardless` cannot copy the art without the asker holding access to the original's media; a new name or sentence beyond the ★ ones above; anything outside the files above.

## Done means
Both new test files green; the four existing seat test files green; `tsc` 0 errors in your files; `npx prettier --check` on your new files (report the result; do not fix other files).

## Report (your final message, under ~400 words)
Changed files; for each Build step what you did and any deviation; the base version columns; tests run with counts and log paths; tsc result; prettier result; anything stopped; **Noticed, not done**.
