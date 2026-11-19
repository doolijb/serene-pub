# BRIEF — worker `gs-3a3b-2-w1` — server: a seat moves from the AI to a person (owner rulings S2, MV1, MV2, 2026-11-17)

Repo `/home/jody/github/serene-pub` (app). Supervisor: lane `gs-3a3b-2`. SDK repo is read-only.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build` at all: no SDK edit.)

The repo is staged by the lead: run **no git command that changes the index or the working tree** (`git diff` / `git status` are fine). Never run prettier with `--write` and never pipe its output into a file. No `npm run build`, no full test run, no migration, no SDK edit.

## Goal

The person → AI half is built (read `plans/REPORT-gs-3a3b-1-2026-11-17.md`, all of it, before you start). Build its mirror: **the session's owner moves a character seat (AI-played group, `session_characters`) to a person's Personas group (a player seat, `session_personas`)**, through the same writer `moveSeatKind`, the same translator `seatMoveTranslator`, the same checker `resolveSeatMoves` and the same door field `seatMoves` on `sessions:update`. Plus one reader fix (pick-sprite) and tests.

## Rules (quoted; they decide your work)

- Owner S2: "No: the owner re-assigns only seats holding their own cards or card-less cast members" + "Guest cast members can still be moved to the ai playable seats by the owner freely, even personas".
- Owner MV1: "Move the old seat's lines to the new seat, then remove the old seat." MV2: "Earlier lines move to the new seat and keep their kind" (what the AI wrote stays the AI's; nothing about who may edit an old line changes; the model reads history as it was written).
- Standing: a guest's card is never handed to another **person**. One writer per seat table (P2: "A module owns its data and every write to it … Two writers of one thing is a bug").
- Cold review design (rules here): **a line keeps the stamp of the seat it was spoken from**: `message_speakers` and `message_blocks` are NOT rekeyed (the translator's `leaves`). **A line's seat is resolved only within its own kind**, departed seats included (`seatOf(…, { kind })`, `messages/permissions.ts` already does this). **The removal guard in `unseat` is not changed**: `moveSeatKind` soft-removes the old row itself. **The turn order drops the moved seat** from `order` and `candidates` and the recompute (the member events the door announces) fills it; never hand-build an order.
- CLAUDE.md Hard rules: inside `db.transaction(async (tx) => …)` use only `tx` (the outer `db` deadlocks PGlite silently). No top-level `await` in `db/index.ts`. "0.6 is in users' hands": a second boot changes nothing (test it). Migrations: none.
- Comments state the rule, never history ("was", "now", "used to", "lane …", dates of change). `src/lib/shared/conformance/commentHistory.test.ts` must pass on your files.
- Names: any new exported name, field or sentence is provisional: mark the doc comment 🚧 like its neighbours, and list it in your report.
- Other lanes edit nearby: `el-1a` may write in `sessions/seats.ts` where a member is created. **Re-read each of `sessions/seats.ts`, `sockets/sessions.update.ts`, `shared/sockets/types.ts` right before each edit, and change only the functions/lines named here.** Not yours, never edit: `db/schema.ts`, `lorebooks/*`, `scenes/liveScenes.ts`, `sessions/seatName.ts`, `cast/sharedCardCopy.ts`, `pipelines/runtime/host*.ts`, `pipelines/runtime/dispatch.ts`, `pipelines/routines/log.ts`, `sockets/routines.ts`, `sockets/scenes.ts`, `sockets/narrativeGraph*.ts`, `sessions/offerMessage.ts`, `messages/deletion.ts`, `messages/permissions.ts`, `state/write.ts`.

## Build

### 1. Wire (`src/lib/shared/sockets/types.ts`, the `seatMoves` line only, ~7355)

`seatMoves?: Array<{ playerSeatId: number } | { characterSeatId: number; toUserId: number }>`. Doc comment: each moves a player seat to the AI-played group, or a character seat (`session_characters.id`) to `toUserId`'s Personas group (owner only; S2, MV1, MV2).

### 2. Translator (`src/lib/server/sessions/seatKeys.ts`, `seatMoveTranslator` only)

Add an optional `to?: "character" | "player"` (default `"character"`, today's behaviour byte-for-byte). With `to: "player"`: owner `{ seated_member, castMemberId }` → `{ player_seat, playerSeatId }`; ref `seated-member:<castMemberId>` exactly (never a prefix match) → `player-seat:<playerSeatId>`; `ownerKinds: ["seated_member"]`; `refSql` `"seated-member:<id>"` (with the quotes, as the existing one); `survivor(target)` returns `castMemberId` when `target` is `{ player_seat, playerSeatId }` (the moved rows win over rows a departed player seat of the same id left: the revive case); `leaves: ["message_speakers", "message_blocks"]`. Update its doc comment to state both directions.

### 3. Check (`src/lib/server/sessions/seats.ts`)

Add 🚧 `seatMoveToPersonCheck(tx, sessionId, characterSeatId, toUserId)` beside `seatMoveCheck` (reads only; returns `{ ok: false, refusal } | { ok: true, seat: { characterId, castMemberId, isActive, seatedByUserId } }`). In order:
1. the character seat is live in this session and not an envoy seat, else `SEAT_MOVE_REFUSALS.seatGone`;
2. `castMemberId` null → new 🚧 `SEAT_MOVE_REFUSALS.noMember`: *That seat has no cast member, so it can't move to a person.*;
3. `toUserId` is the session's owner, or a `session_guests` row with `isPlayer` true; no row → `SEAT_HANDOVER_REFUSALS.notInSession` sentence (*That person is not in this session.*); a watcher → the `watcher(name)` sentence (name: displayName, else username, else "That person", as `resolvePlayerSeatsFor` does). Those constants live in `guestSeats.ts`, which imports from `seats.ts`: do **not** create an import cycle; put the person check in `resolveSeatMoves` (guestSeats.ts) and in the writer re-check pass the person through a small exported helper in `guestSeats.ts` only if that adds no cycle, else re-read the guest row in `seats.ts` and throw the same literal sentence from a constant you move or duplicate in `SEAT_MOVE_REFUSALS` (say which you did);
4. the card rule: `characterId` not null, its owner (`characters.user_id`) is neither the session's owner nor `toUserId` → `PLAYER_SEATS_FOR_REFUSALS.notYourCard(name)` (*‹name› is not your card, so it can't be seated for someone else.*; same cycle note). A card-less member and the session owner's card go to anyone allowed by 3; a guest's own card only back to that guest;
5. ★K-2: a live player seat (benched or not) of this session already holds the card (`persona_id`) or the member (`cast_member_id`) → new 🚧 `SEAT_MOVE_REFUSALS.alreadyPerson(name)`: *‹name› already has a seat a person plays in this session.* Never merge two seats;
6. the seat is the head of the stored turn order: compare `readStoredTurnOrder(tx, sessionId).order[0]?.ref` with the seat's ref as the turn order stores it (build it with `hostSeatRefOf` from `pipelines/prompt/seatCards.ts`, as `sockets/sessions.update.ts` ~850–866 does for `ccRef`) → `SEAT_MOVE_REFUSALS.holdsTurn(name)`;
7. a counted run in progress → `quietRefusal(tx, sessionId)` as `seatMoveCheck` does.
Name for sentences: the member as read, else the card's name, else "That seat" (reuse/extend `movingSeatName`).

Add 🚧 `SEAT_MOVE_REFUSALS.ownerOnlyToPerson`: *Only the session's owner can move a seat to a person.* (Keep `ownerOnly` as it is.)

### 4. Writer (`moveSeatKind` in `seats.ts`: the ONE writer of a move, both directions)

Widen the input to a union: today's `{ sessionId, playerSeatId, seen: { personaId, castMemberId } }` (unchanged behaviour) or `{ sessionId, characterSeatId, toUserId, seen: { characterId, castMemberId } }`. Return a union with a discriminant `to: "character"` (today's fields incl. `characterSeatId`, `castMemberId`) | `to: "player"` (`playerSeatId`, `castMemberId`), both with `changes`, `mintedMembers`. Existing callers/tests that read `characterSeatId` must still compile (narrow on `to`). The AI → person branch, all inside the caller's `tx`, throwing the sentence on any refusal so the transaction rolls back:
1. re-run `seatMoveToPersonCheck`; a `seen` mismatch → `seatGone`;
2. position: after the last live player seat of the session (max + 1); bench state copied (`isActive`);
3. `seatPlayer(tx, { sessionId, personaId: null, castMemberId, userId: toUserId, position, isActive })`: it seats the member's linked card as the persona (a card-less member: a card-less player seat) and revives an earlier row of the same card / member. A revived **card-less** row keeps its stored `user_id` (`seatPlayer`'s card-less revive does not write it): read the stored `user_id` after the call and, when it differs from `toUserId`, hand it over through `handOverSeat(tx, { sessionId, kind: "player", seatId, fromUserId: stored, toUserId })` (the pattern `sessions.update.ts` ~1490–1510 uses for `playerSeatsFor`); a false return throws `seatGone`;
4. drop the character seat's ref from the stored turn order's `order` and `candidates` (write only when something was dropped). The tally's `persons` holds only people's refs: nothing to drop for this direction;
5. `rekeySessionRefs(tx, sessionId, seatMoveTranslator({ playerSeatId, castMemberId, to: "player" }))`;
6. soft-remove the character seat: `removed_at = now`, `removed_name` = the name as in 3 above; the guard in `unseat` is not touched;
7. changes: `{ kind: "character", change: "removed", seatId, castMemberId, cardId: characterId }` then the player seat's changes.
Update the doc comment to state both directions (rules only).

### 5. Checker (`resolveSeatMoves` in `src/lib/server/sessions/guestSeats.ts`)

Accept both entry shapes. Owner only: a non-owner with any to-AI entry → `ownerOnly`; with only to-person entries → `ownerOnlyToPerson`. Each entry checked once (dedupe by seat id per kind); a seat named in both directions in one save → `seatGone` for the second. Genre opt-in once: `seatKindAddRefusal(db, sessionId, { characters: <to-AI count>, personas: <to-person count> })`. `SeatMoveWrite` becomes a union carrying what each check saw (the to-person one: `characterSeatId`, `toUserId`, `seen: { characterId, castMemberId }`).

### 6. The door (`src/lib/server/sockets/sessions.update.ts`, the moves block ~906–957 and the diffs' skip rules only)

Run each write through `moveSeatKind` by its shape. Then the same save's lists must not undo a move to a person:
- `characterIds` listing a card moved to a person **in this save**: ignored (not added back, no ownership check, no position write);
- `castMemberIds` listing a member moved to a person in this save: ignored (no `alreadySeated` throw);
- `personaIds` omitting the moved card: the new player seat stays (add the card to the kept set); listing it: as today (a position write).
Extend the payload-rule comment at the door: send the move in `seatMoves`; the moved card may stay in or leave `characterIds` / `castMemberIds` (ignored); `personaIds` may list it or not; the new player seat stays either way. The isGroup recount after the moves stays as it is.

### 7. Reader fix (`src/lib/server/pipelines/runtime/bindings.outlets.ts` ~644, one line)

pick-sprite's `seatOf(db, sessionId, input.speaker)` → `seatOf(db, sessionId, input.speaker, { kind: "character" })`: a sprite is picked only for a character's line, so the speaker's seat is found among character seats, departed ones included. (Without it, after a card-less member moves to a person, an earlier AI line's `seated-member:` speaker resolves to the live player seat and picks nothing.) Fix the nearby comment to state the rule.

Two other readers were checked and need no change (do not edit them): `state/write.ts` `sealerName` (a name only, through the member, the same on either seat) and `lorebooks/entryKnowledge.ts` `loadEntryKnowledge` (member-keyed: the same member on either seat). Pin `loadEntryKnowledge` in a test (below).

## Tests (new file `src/lib/server/sockets/sessions.seatMoveToPerson.int.test.ts`, mirroring the setup of `sessions.seatMove.int.test.ts` lines 1–335; plus a describe added to `src/lib/server/sessions/seatKeys.seatMove.int.test.ts`)

1. Owner's card AI seat → a guest: one live player seat (person = guest, bench state and position as stated), the character seat soft-removed (row kept), a value under `seated_member:<M>` is now under `player_seat:<P>`; the AI line's `metadata.speaker` and its blocks unchanged; order and candidates drop the AI seat's ref.
2. After it: `maySpeakAsCard` true for the guest, false for the owner; an earlier AI line: the guest may not edit it (`canActOnMessage` / the permission function `permissions.ownKind.int.test.ts` uses), the owner still may; `seatOf(…, { kind: "character" })` on its stamp finds the departed character seat; `loadEntryKnowledge` with the old AI stamp reads the same member's ties as before the move.
3. A card-less member AI seat → the owner: a card-less player seat, person = owner; with an earlier departed card-less player seat of that member held by a guest, the same row is revived and its person is the owner.
4. A guest's own card (seated by the guest as AI) → that guest: allowed; → another guest or the owner: refused `notYourCard`, nothing written.
5. There and back, both orders: player → AI → player revives the first player row (same id; one row per table), AI → player → AI revives the first character row; a value written before the first move is under the original ref after the second; lines keep their stamp, name and editor.
6. Refusals write nothing (each asserts row counts and the stored order unchanged): a guest asks; an unknown / removed / envoy seat; a seat with no member (if you can build one; else say why not); a person not in the session; a watcher; ★K-2 live player seat (in play, and benched); a genre whose shape has no personas; the seat holds the turn; a counted run in progress (copy how the existing file fakes one).
7. A second boot changes nothing for the moved session (copy test 9 of the existing file).
8. The door: `characterIds` listing the moved card / omitting it; `castMemberIds` listing the moved member / omitting it; `personaIds` listing / omitting: one live player seat, no live character seat, no error.
9. pick-sprite after a card-less member moved to a person: the binding resolves the old AI speaker to that member (`ctx.call` receives `castMemberId`). Find how `src/lib/server/sprites/spriteEmbedCalls.int.test.ts` reaches the binding; if calling the binding is unreasonably heavy, test the exact `seatOf(…, { kind: "character" })` call on that data and say so.
10. Optional, only if `pipelines/runtime/portrayals.ts`'s exported function is directly callable in a few lines: an unanswered form addressed to `seated-member:<M>` is portrayed by the new person after the move. Report what you found either way; change nothing in portrayals.
11. `seatKeys.seatMove.int.test.ts`: the pure translator with `to: "player"` (exact match, no prefix match, survivor, leaves) and a table-driven `rekeySessionRefs` run over the 13 rekeyed stores (mirror the existing describe at ~357).

## Done means

Run, one run at a time, each after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`, as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/gs-3a3b-2-<n>.log 2>&1"` with `<n>` from 10 to 29 (always at least one path; never pipe vitest into `head`):
- your two test files; `src/lib/server/sockets/sessions.seatMove.int.test.ts`; `src/lib/server/messages/permissions.ownKind.int.test.ts`; `src/lib/server/sessions/seatOf.int.test.ts`; `src/lib/server/sockets/sessions.seatHandover.int.test.ts`; `src/lib/server/sprites/spriteEmbedCalls.int.test.ts`; `src/lib/server/lorebooks/entryKnowledge.door.int.test.ts`; `src/lib/shared/conformance/commentHistory.test.ts`: all green.
- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` once at the end: 0 errors in your files (list any others by file, untouched).
- `npx prettier --check` on your changed files: report, do not fix other people's lines.

## Stop and ask (write it in your report and stop) when

A rule above cannot hold without editing a file not listed; a move would give the session's owner acting rights over a guest's card; a reference kind cannot be re-pointed without a migration; "keep their kind" would need a message row rewritten; any new name beyond those listed here.

## Report

Your final message: changed files (with functions), every new name and sentence, tests run with counts and log numbers, tsc result, anything that did not hold, Noticed-not-done. Under ~500 words.
