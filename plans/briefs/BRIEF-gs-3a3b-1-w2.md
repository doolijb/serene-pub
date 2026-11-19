# BRIEF gs-3a3b-1-w2 — the session's owner moves a player seat to the AI-played group (owner rulings S2, MV1, MV2, 2026-11-17): server only

Repo `/home/jody/github/serene-pub` (app). Supervisor: lane `gs-3a3b-1`. You type; you do not decide
anything a user sees (every sentence and name below is the supervisor's, marked 🚧 provisional). Report
back in your final message (under 600 words).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

The repo is staged by the lead: run **no git command that changes the index or the working tree** (no
checkout, restore, add, reset, stash). Never run prettier with `--write` and never pipe its output into a
file. No SDK edit or build, no `npm run build`, no full test run, **no migration, no schema change**.

## The owner's words

S2: "No: the owner re-assigns only seats holding their own cards or card-less cast members" + "Guest cast
members can still be moved to the ai playable seats by the owner freely, even personas".
MV1: "Move the old seat's lines to the new seat, then remove the old seat."
MV2: "Earlier lines move to the new seat and keep their kind" (what a person typed stays a person's line,
by that person; what the AI wrote stays the AI's; nothing about who may edit an old line changes; the model
reads history as it was written).

**This worker builds only the move person → AI** (a player seat, `session_personas`, becomes a character
seat, `session_characters`, for the same card or cast member). Not built: AI → person, any client control,
docs. Worker w1 already made a line's seat resolve within its own kind (`seatOf(..., { kind })`,
`messages/permissions.ts`): don't touch those.

## Files you may edit

- `src/lib/server/sessions/seatKeys.ts` — the translator and a `leaves` field (below).
- `src/lib/server/sessions/seats.ts` — **only** new `SEAT_MOVE_REFUSALS`, new `moveSeatKind`, and
  `maySpeakAsCard`. **Live lane `el-1a` edits this file too** (e.g. `seatPlayer`'s `createdBy`): re-read
  the file right before every edit and change only those three. Never touch `unseat` or `seatHasLines`.
- `src/lib/server/sessions/guestSeats.ts` — new checker `resolveSeatMoves`.
- `src/lib/server/sockets/sessions.update.ts` — the door (below), nothing else in it.
- `src/lib/shared/sockets/types.ts` — **only** the new optional field on `Sockets.Sessions.Update.Params`
  (re-read right before the edit; other lanes edit this file).
- New tests: `src/lib/server/sessions/seatKeys.seatMove.int.test.ts`,
  `src/lib/server/sockets/sessions.seatMove.int.test.ts`.

## 1. The translator (`seatKeys.ts`)

- Add an optional field to `SeatRefTranslator`: `leaves?: readonly SeatKeyStore[]` — stores this
  translator leaves as they are. `rekeySessionRefs` skips a step whose store is in it. The boot pass and
  the fold pass nothing: unchanged.
- New exported `seatMoveTranslator(move: { playerSeatId: number; castMemberId: number }): SeatRefTranslator`
  (🚧 name), PURE, in the style of `memberMoveTranslator` (~214): owner `{ kind: "player_seat", id:
  playerSeatId }` → `[{ kind: "seated_member", id: castMemberId }]`; ref exactly `player-seat:<playerSeatId>`
  → `[\`seated-member:<castMemberId>\`]`; every other owner and ref → null (not moved; never a prefix match:
  `player-seat:12` must not move `player-seat:123`). `ownerKinds: ["player_seat"]`; `refSql` a POSIX
  pre-filter that matches the exact ref in JSON text (e.g. `"player-seat:<id>"` with the closing quote).
  `survivor(target)`: for `{ seated_member, castMemberId }` return `playerSeatId` (the moved row wins over a
  row a departed character seat of that member left on the same unique key), else null.
  `leaves: ["message_speakers", "message_blocks"]` — **a line keeps the stamp of the seat it was spoken
  from** (`metadata.speaker`), and a line's blocks (`addressee`, `answered.by`) stay as written: readers
  (client `seatOfMessage`, the prompt's `removedSessionPersonas`) resolve the removed seat by those, so the
  line keeps its name, face and kind. Doc comment states this rule.
- Every other store (values, configs, zones, owner sheets, carries, proposals, zone towards, `annex_core`
  turn order + tally + Dungeon Crawler fates, audiences, speech keys, widget settings, rewind, imprints) is
  rekeyed.

## 2. `moveSeatKind` (`seats.ts`) — the one writer of the move (🚧 name)

`moveSeatKind(tx, { sessionId, playerSeatId, seen: { personaId, castMemberId } })` runs **inside the
caller's transaction, using only `tx`** (never `db`; no static import of `$lib/server/db`; dynamic imports
as the file already does). Returns `{ ok: true; changes: SeatChange[]; mintedMembers: MintedSeatMember[];
characterSeatId: number; castMemberId: number }` or throws `new Error(<sentence>)` so the transaction rolls
back. Steps, in order:

1. Read the player seat by id **and** session. Missing, `removed_at` set, or `persona_id` /
   `cast_member_id` not what the check saw → throw `SEAT_MOVE_REFUSALS.seatGone`.
2. No member and no card (`cast_member_id` and `persona_id` both null) → `noCast`.
3. A **live** character seat (`removed_at` null, not an envoy; benched counts as live) holding the card
   (`character_id` = `persona_id`) or the member (`cast_member_id`) → `alreadyAi(name)`. Never merge two
   seats.
4. The stored turn order's head (`readStoredTurnOrder(tx, sessionId)` from `sessions/turnOrder.ts`,
   `.order[0]?.ref`) is `player-seat:<id>` → `holdsTurn(name)`.
5. A counted run in progress in the session → `(await import("$lib/server/pipelines/runtime/runsInProgress")).quietRefusal(tx, sessionId)`; a non-null sentence is thrown as is (reuse, do not reword).
6. Who seats the AI seat: the card's owner when the seat has a card **and** that owner is not the session's
   owner (a guest's card stays the guest's: `seated_by_user_id` = the guest); otherwise (the owner's card,
   or a card-less member) the session's owner (`sessions.user_id`).
7. Position: one past the highest `position` of the session's live character seats (not envoys) —
   as the shared-card block in `sessions.update.ts` ~1429–1446 computes it. Bench: the new seat's
   `isActive` = the player seat's `is_active`.
8. `seatCast(tx, { sessionId, castMemberId: <member>, seatedBy, position, isActive })` when the seat has a
   member; else `seatCast(tx, { sessionId, cardId: persona_id, seatedBy, position, isActive })` (mints
   the member as any carded seat does). A refusal → throw its `refusal`. This creates a new row or
   **revives** the departed character row of that card / member (it keeps the revived row's id).
9. Drop the moved seat from the turn order: entries of `order` and `candidates` whose `ref` is
   `player-seat:<id>`, written through the one writer `writeTurnOrder(tx, sessionId, next)` with the stored
   `basedOnAt` (equal is not stale); and `player-seat:<id>` out of every lane's `persons` of the tally,
   written through `writeTurnTally(tx, sessionId, tally)` (`pipelines/routines/turnTally.ts`; read with
   `readTurnTally({ turnTally: <column> })`). Write only what changed. (The recompute follows from the
   member events the door announces, as when a seat is added; never build an order by hand.)
10. `rekeySessionRefs(tx, sessionId, seatMoveTranslator({ playerSeatId, castMemberId }))` with the new
    seat's member.
11. Soft-remove the player seat: `removed_at` now, `removed_name` its shown name (seat name, else the card's
    name through `cardsNow` + `resolveCharacterName`, else the member's shown name through
    `membersAsRead`), `where id and session and removed_at is null`. The row is kept (lines resolve it).
    `unseat` and its "has lines" guard are not used and not changed.
12. Return the changes: `{ kind: "player", change: "removed", seatId, castMemberId, cardId }` plus
    `seatCast`'s `changes` (the character seat `"added"`).

`SEAT_MOVE_REFUSALS` (🚧 ★ copy, next to `SEAT_REFUSALS`):
- `ownerOnly`: "Only the session's owner can move a seat to the AI."
- `seatGone`: "That seat is no longer in the session."
- `noCast`: "That seat has no character or cast member, so the AI can't play it."
- `alreadyAi(name)`: "‹name› already has a seat the AI plays in this session."
- `holdsTurn(name)`: "It's ‹name›'s turn. Move the seat once that turn is taken."
(`‹name›` = the seat's shown name as in step 11.)

## 3. `maySpeakAsCard` (`seats.ts`)

New rule, first: **a card that a live character seat holds in this session, with no live player seat, is
spoken by no person here** (return false). ★K-2: a card with both a live player seat and a live character
seat → unchanged (the player seat's person speaks). Keep it **one query**: add the live-character-seat
fact as a selected `exists(...)` column (`session_characters`, same session, `character_id` = the card,
`removed_at` null, `envoy_slug` null) — the send path is in the statement baselines, so no second
statement. Update the doc comment (state the rule).

## 4. The checker (`guestSeats.ts`) and the door (`sessions.update.ts`)

- `resolveSeatMoves(db, { sessionId, callerId, isOwner, moves })` (🚧 name), reads only, first refusal wins,
  in the pattern of `resolveSeatHandovers` (~383): not the owner → `ownerOnly`; per entry the seat checks
  1–5 above (same sentences, import `SEAT_MOVE_REFUSALS` from `seats.ts`); then the genre's opt-in once:
  `seatKindAddRefusal(db, sessionId, { characters: <number of moves>, personas: 0 })`. Duplicate entries
  for one seat collapse. Returns `{ ok: true, writes: { playerSeatId, seen }[] }` or `{ ok: false, refusal }`.
- `shared/sockets/types.ts`, `Sockets.Sessions.Update.Params`: `seatMoves?: { playerSeatId: number }[]`
  (🚧 ★ name) with a one-line doc: each moves a player seat to the AI-played group (owner only).
- `sessions.update.ts`: call `resolveSeatMoves` right after `resolvePlayerSeatsFor` (~328), throwing its
  refusal (so nothing of the save is written). Add `!params.seatMoves?.length` to `seatPreflight`'s `none`
  test only if needed for the check to run (it is not needed: `resolveSeatMoves` does its own opt-in).
  Write the moves **after** the shared-card seats block and **before** `announceSeatChanges` (~1489): all
  moves in one `db.transaction(async (tx) => …)` calling `moveSeatKind(tx as unknown as Db, …)`; push the
  changes into `seatChanges`; `syncMintedSeatMembers(db, minted)` after the transaction as the other blocks
  do; then set `isGroup` from the live character-seat count exactly as the shared-card block does
  (~1469–1486). Add `params.seatMoves?.length` to the broadcast condition (~1571) and to the
  `pushSessionActions` condition (~1591).

## 5. Tests

`seatKeys.seatMove.int.test.ts` (model it on `src/lib/server/sessions/seatKeys.memberMove.int.test.ts`):
pure translator cases (exact id only; other refs/owners null; survivor); a table-driven test that puts one
`player-seat:<X>` / `player_seat:X` item in **each of the 15 stores**, runs `rekeySessionRefs` with the
translator, and finds 13 stores moved to the member (none left under the old ref) and
`message_speakers` / `message_blocks` byte-identical; another player seat and another session untouched;
a unique-key collision keeps the moved row; a second call changes nothing.

`sessions.seatMove.int.test.ts` (harness of `src/lib/server/sockets/sessions.seatHandover.int.test.ts` /
`sessions.ownerCardForGuest.int.test.ts`; drive the real `sessions:update` handler):
1. A guest's persona (the guest's card) → AI: one live character seat for the card, `seated_by` the guest,
   bench state copied, position after the last character seat; the player row kept with `removed_at` set;
   values under `player_seat:X` now under `seated_member:M`; message rows byte-identical (stamp kept).
2. After 1: `maySpeakAsCard` false for the guest and the owner; the guest's earlier lines still the guest's
   (`canActOnMessage` change and rerun) and not the owner's; the stored order and tally no longer name
   `player-seat:X`; the turn candidates as the pool reads the live seats include `seated-member:M` (find the
   pool read used in `src/lib/server/pipelines/runtime/turnSeats.seatMembers.int.test.ts` or similar).
3. PS1: the owner's card in a player seat whose `user_id` is the guest → AI: `seated_by` the owner; the
   guest's earlier person lines, **stamped and unstamped** (`metadata` without `speaker`), still the
   guest's and not the owner's.
4. A card-less member the guest plays (player seat `user_id` guest, `cast_member_id` M, no card) → a
   card-less character seat of M seated by the owner.
5. The owner's own persona → AI: `seated_by` the owner.
6. Revive: the member had a departed character seat → the same row id comes back, one row only, and an
   `owner_sheets` row of the moved seat wins over the departed seat's.
7. Refusals, each leaving seats, values, turn order and tally exactly as before: a guest asks
   (`ownerOnly`); unknown or removed seat (`seatGone`); a player seat with neither member nor card
   (`noCast`; insert the row raw); a live character seat already on the card (★K-2), and a benched one
   (`alreadyAi`); a genre whose shape has no character seats (the opt-in sentence; find such a genre or set
   the shape as other opt-in tests do — grep `seatKindAddRefusal` tests); the seat holds the turn (write an
   order whose head is `player-seat:X` with `writeTurnOrder`) (`holdsTurn`); a counted run in progress
   (register one with the run registry as `src/lib/server/sockets/sessions.editedLineRerun.int.test.ts`
   does) (the reused sentence).
8. The removal guard is unchanged: `unseat` of a benched player seat with lines still throws "has lines",
   also when the same card holds a live character seat (★K-2).
9. A second boot changes nothing: after a move, `seatKeys(db)` (`sessions/seatKeys.ts`) and `seatMembers(db)`
   (`sessions/seatMembers.ts`) change nothing for the session.
10. `maySpeakAsCard` ★K-2: a card with a live player seat (guest) and a live character seat → the guest
    still speaks as it.

## Done means

- Your two new files green, and these existing files green **without editing their expectations** (if one
  fails, stop and report the assertion): `src/lib/server/sessions/seatKeys.int.test.ts`
  `src/lib/server/sessions/seatKeys.json.int.test.ts` `src/lib/server/sessions/seatKeys.memberMove.int.test.ts`
  `src/lib/server/sockets/sessions.seatHandover.int.test.ts`
  `src/lib/server/sockets/sessions.ownerCardForGuest.int.test.ts`
  `src/lib/server/sockets/sessions.benchedSeats.int.test.ts` `src/lib/server/sessions/seats.cardless.int.test.ts`
  `src/lib/server/messages/permissions.ownKind.int.test.ts` `src/lib/server/sessions/seatOf.int.test.ts`.
  Run them in at most three capped runs (a few paths each).
- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` 0 errors (report the total).
- `src/lib/shared/conformance/commentHistory.test.ts` green.

### How to run tests (exactly)

Before **every** vitest run: `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`. Then
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "cd /home/jody/github/serene-pub && npx vitest run --maxWorkers=3 <paths> > plans/gs-3a3b-1-w2-<n>.log 2>&1"`
(always at least one path; `<n>` = 1, 2, 3 …; read the log with `tail`/`grep`, never pipe vitest into
`head`). One run at a time. An int test that opens a DB inside an `it` needs a 60 s timeout.

## Rules you work under (quoted)

- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite
  silently; `db/transactionGuard.ts` throws in dev/test." Every helper you call inside the move gets `tx`.
- `seats.ts`: "⚠ No static import of `$lib/server/db`, here or through anything this module imports: every
  function takes its handle first." `seatKeys.ts`: "⚠ Must not statically import `$lib/server/db`; the
  handle is the first argument." Use dynamic `await import(...)` for `turnOrder.ts`, `turnTally.ts`,
  `runsInProgress.ts` from `seats.ts`.
- CLAUDE.md: "An event in `SCOPED_EVENTS` must carry its scope key … in the payload" — you add no event;
  the reply and broadcast are the door's existing ones.
- CLAUDE.md: "Never seed a row at a hardcoded id." "No migration."
- Comments state the rule, never the history (no "now", "used to", "was", "previously"):
  `commentHistory.test.ts` enforces it. "It is a **session**, never a *chat*."
- No other new name, setting, flag, event or table than those named here. Anything else you notice: list it
  under **Noticed, not done**; don't fix it.

## Report

Changed files and functions; `moveSeatKind` as built, step by step (say any deviation from the steps above
and why); each test file with pass/fail counts; `tsc` total; what the revived AI seat shows (name,
portrait, position) as you observed it; any existing test whose expectation you believe must change (with
the failing assertion; do not change it); **Noticed, not done**.
