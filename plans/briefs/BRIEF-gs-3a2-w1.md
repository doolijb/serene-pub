# BRIEF — worker `gs-3a2-w1` (server): seat handovers, the take of a seated card-less member, the take list

Repo `/home/jody/github/serene-pub` (app). The SDK repo is read-only. Supervisor: lane `gs-3a2`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (This task needs no `sdk:build`: do not run one.)

Also: run **no git command** that changes the index or the working tree (the lead staged the repo). Never `prettier --write`. No migration, no schema change, no SDK edit. Inside `db.transaction(async (tx) => …)` use only `tx` (the outer `db` deadlocks PGlite silently). No top-level `await` in `src/lib/server/db/index.ts`. Comments state the rule, never the history. It is a **session**, never a *chat*.

## Goal

The session's owner can give a **saved** seat to another person of the session, and a guest can take, and hand back, a card-less character seat that no person plays. One new optional field on `sessions:update`, one writer, one checker, and a wider take list. No client work (worker 2 does the form).

## Owner's words (2026-11-17) and the rules they became — your work depends on these

- S1: "One persona seat group per user. The owner can seat anyone they want to whoever they want as long as it's something they can see. The guest can seat to themselves when allowed, with cards they are allowed."
- S2: "No: the owner re-assigns only seats holding their own cards or card-less cast members" + "Guest cast members can still be moved to the ai playable seats by the owner freely, even personas".
- S4: "Make it a session permission when guests are invited, exist in the session. Hide otherwise like the rest." — taking a seated card-less member that no person plays is allowed under the session's **Guests can take cast members** switch.
- 2026-11-05: a character seat's person is "The person who seated it" (acting rights follow `session_characters.seated_by_user_id`).
- 2026-10-12 Q3: a shared card is "read and copy, never use-as-cast". Honour mode 2026-11-05: a player has "cards the player owns + their card-less seat".
- Bench is not absence (2026-11-15): a benched seat still holds its member.

The lane's cold review rules (verbatim, these govern):
> **"Played by a person", in stored terms.** A **player seat** (`session_personas`) is played by its `user_id`. A **character seat** (`session_characters`) is AI-voiced and its person is its seater (`seated_by_user_id`, `db/schema.ts` 4150–4157 …; `seatCast` refuses a seat with no seater, `sessions/seats.ts:561`). "No person plays it" = **a character seat seated by the session's owner**. A guest's take of such a card-less member rewrites `seated_by_user_id` to the guest **in place**, inside `seats.ts`; leaving rewrites it to the session's owner. No null seater, no second seat.

> **This lane builds same-kind moves only.** Player seat → another person: rewrite `user_id` (S2: only when it holds the owner's own card or a card-less member). Character seat → another person as its seater: rewrite `seated_by_user_id` (same S2 rule; a guest's own card keeps the guest as seater always). **Cross-kind moves (a person's player seat ↔ the AI-played group) are NOT built.**

### The supervisor's scoping (do not widen it)

A player seat **with a card** is NOT handed to another person in this task: today every reader of "who voices a carded player seat" reads the **card's owner** first (`sockets/sessions.messages.ts:324` `checkPersonaOwnership` refuses sending as a persona you don't own; `shared/sessions/playerSeat.ts:45` `isOwnPlayerSeat`; `state/resolve.ts:2477` `personaOf`). Those files are not ours. So a handover naming a carded player seat is **refused in words** (sentence below). A **card-less player seat** (`persona_id` null; the named seats, `isCardlessPlayerSeat`) is read by its `user_id` everywhere, so it may be handed over.

## Files owned (edit only these)

- `src/lib/shared/sockets/types.ts` — **only** the new `seatHandovers` field on `Sockets.Sessions.Update.Params` (near line 7255–7324). Lane `ap-1` is live in this file too: **re-read the exact region right before you edit**, add only your field, touch nothing else.
- `src/lib/server/sessions/seats.ts` — add the writer `handOverSeat` only.
- `src/lib/server/sessions/guestSeats.ts` — the checker, its sentences, the wider `castToTakeOf`.
- `src/lib/shared/sessions/guestSeats.ts` — **doc comments only**, where they describe "nobody holds" for taking cast members, so they stay true. No code change there.
- `src/lib/server/sockets/sessions.update.ts` — the door: preflight and apply.
- New test file `src/lib/server/sockets/sessions.seatHandover.int.test.ts`; edits to `src/lib/server/sockets/sessions.castToTake.int.test.ts` only where a pinned expectation changes because of the wider list.

## Files readable

`src/lib/server/db/schema.ts` 3993–4070 (player seats), 4130–4231 (character seats), 4234–4250 (`session_guests`, `is_player`); `sessions/seats.ts` (`seatCast` 512, `seatCardlessMember` 768, `seatPlayer` 893, `seatActorOf` 2100); `sessions/seatName.ts` 225–238 (the watcher check: "Only a player of this session can take a seat."); `state/handEdits.ts` 420–455 (`own` follows the seater / the player); `sockets/sessions.guestSeats.int.test.ts` and `sockets/sessions.castToTake.int.test.ts` (fixture patterns: copy their `vi.mock` block, temp dir, and seeding style).

## Build

1. **Wire field** (`types.ts`, inside `Update.Params`, after `playerSeatChanges`):
   ```ts
   /**
    * 🚧 **Seat handovers** (owner rulings S1, S2, S4, 2026-11-17): give a saved
    * seat to another person of the session — a character seat's seater
    * (`seated_by_user_id`), a card-less player seat's player (`user_id`).
    * Each names exactly one of `characterId` (a character seat with that card),
    * `castMemberId` (a card-less character seat of that member) or
    * `playerSeatId` (a card-less player seat). All are checked before any
    * write and applied before the seat lists. The session's owner gives a
    * seat holding their own card or a card-less member to themselves or a
    * guest; a guest takes a card-less character seat the owner seated
    * (`toUserId` their own) or hands one they seated back (`toUserId` the
    * owner), while *Guests can take cast members* is on.
    */
   seatHandovers?: Array<{
   	characterId?: number
   	castMemberId?: number
   	playerSeatId?: number
   	toUserId: number
   }>
   ```
2. **The writer** (`seats.ts`, next to `seatActorOf`): `handOverSeat(tx, { sessionId, kind: "character" | "player", seatId, toUserId })` writes `seated_by_user_id` (character) or `user_id` (player) on that live row of that session and returns whether a row changed. It is the one writer of a seat's person after it is seated (doc comment says so, and that it checks nothing: the caller checks).
3. **The checker** (`guestSeats.ts`): `resolveSeatHandovers(db, { sessionId, callerId, isOwner, handovers })` → `{ ok: false, refusal: string } | { ok: true, writes: { kind, seatId, toUserId }[] }`. Reads only; the first refusal wins. A handover that changes nothing (already that person) is dropped silently. Rules, in order:
   - exactly one seat id given, else refusal `SEAT_HANDOVER_REFUSALS.oneSeat`;
   - the seat must be live (`removed_at` null) in this session (an envoy seat never qualifies), else `seatGone`;
   - `toUserId` must be the session's owner or have a `session_guests` row for this session, else `notInSession`; a guest row with `is_player` false is refused for both kinds (`watcher(name)`, the person's display name or username, fallback "That person");
   - **owner caller**: `playerSeatId` with a card (`persona_id` not null) → `cardedPlayerSeat(name)`; `characterId` whose card's owner is not the session's owner → `notYourCard(name)`; a card-less character seat or a card-less player seat → allowed (benched seats too: the owner may hand a benched seat over). The owner is never frozen by the guest switches.
   - **guest caller**: only `castMemberId` (a card-less character seat). Anything else, or a `toUserId` that is neither the caller nor the session's owner → `ownerOnly`. *Guests can take cast members* off → `GUEST_SEAT_SENTENCES.takeCastOff`. **Take** (`toUserId` = caller): the seat must be in play (`is_active` true; a benched seat still holds its member) and seated by the session's owner, else `GUEST_SEAT_SENTENCES.memberHeld(name)`. **Hand back** (`toUserId` = the session's owner): the seat must be seated by the caller, else `ownerOnly`.
   - Names in sentences: a card's `nickname || name`; a card-less member's shown name through `membersAsRead(db, ids, { sessionId })`; a player seat's `seat_name`; fallback "That seat".
   - Sentences (★ copy, put them in `export const SEAT_HANDOVER_REFUSALS` in `guestSeats.ts`):
     - `oneSeat`: "Name one seat to hand over."
     - `seatGone`: "That seat is no longer in the session."
     - `notInSession`: "That person is not in this session."
     - `watcher(name)`: "‹name› is watching this session, so they can't be given a seat."
     - `ownerOnly`: "Only the session's owner can give a seat to someone else. Ask them."
     - `notYourCard(name)`: "‹name› is someone else's character card, so its seat stays with the person who seated it."
     - `cardedPlayerSeat(name)`: "‹name› is a persona with a card, so its seat stays with the card's owner."
4. **The take list** (`castToTakeOf`): list the card-less members of the session's books that are **unseated, or held only by an in-play card-less character seat seated by the session's owner** (no player seat holding them; no other live character seat). A benched seat still holds its member (not listed). Shape unchanged. Keep `guestTakeRefusal` as it is (it guards *adds* through `castMemberIds`; a seated member is still refused there, with `memberHeld`). Update the doc comments of `castToTakeOf`, `guestTakeRefusal` (if it mentions "nobody holds") and the shared file so they say "nobody plays".
5. **The door** (`sessions.update.ts`):
   - `seatPreflight`: count `seatHandovers?.length` in the `none` test; resolve the handovers there (after the switch reads, before returning `seatKindAddRefusal`), so a refusal is thrown before **any** write of the save. Carry the resolved writes out (change the function's return to carry them, or resolve once in the handler right after preflight and before the owner-only block; either way nothing is written before every check passes).
   - Apply all resolved writes in **one** `db.transaction` (only `tx`) **before** the seat-list diffs (`characterIds` ~820, `castMemberIds` ~969, `personaIds` ~1052).
   - When any write changed a row: `broadcastSessionToParticipants(socket, sessionId, userId)` (add to the condition at ~1315) and `pushSessionActions` (add to the condition at ~1332). No new event, no new `SeatChange` kind, no member event.
   - A guest's removal of a card-less seat through `castMemberIds` stays as it is today (it unseats); the hand back is the handover.

## Tests (new `sessions.seatHandover.int.test.ts`; 60 s timeouts as the sibling files)

Seed one owner, guest G1 (player), guest G2 (player), and where needed a watcher W (`is_player` false), a session on its notes with a card-less member, the owner's card, G1's own card, a card-less player seat (`seat_name` set). For every refusal, assert the thrown sentence **and that nothing changed** (re-read `seated_by_user_id` / `user_id` of every seat involved, and that a seat change sent in the same save — e.g. a `castMemberIds` add — was not written).
- Owner: card-less character seat → G1 (seater G1) → G2 → owner; owner's carded character seat → G1 (allowed); G1's own carded character seat → G2 or owner → `notYourCard`; card-less player seat → G1 (`user_id` G1) and back; carded player seat → G1 → `cardedPlayerSeat`; to a non-member → `notInSession`; to W → `watcher`; a removed seat → `seatGone`; two ids in one entry → `oneSeat`; a benched card-less seat → G1 allowed; with both guest switches off the owner is still allowed.
- Guest G1: take an in-play card-less seat the owner seated → seater G1, no second row (count rows); hand it back → seater owner; take with *take cast members* off → `takeCastOff`; take a benched owner-seated seat → `memberHeld`; take a seat G2 seated → `memberHeld`; hand back a seat G2 seated → `ownerOnly`; give to G2 → `ownerOnly`; a `characterId` or `playerSeatId` handover → `ownerOnly`.
- The take list: as G1, a card-less member seated in play by the owner is listed; seated by G1 or G2 not listed; benched (owner-seated) not listed; held by a player seat not listed; an unseated one still listed; a carded one never.
- The payload fact: after a handover, `getSessionFromDB` (or `sessions:get`) shows the new `seatedByUserId` / `userId` on that seat, for the owner and for a guest asking.
- Re-run the existing `sessions.castToTake.int.test.ts` and `sessions.guestSeats.int.test.ts`; adjust only an expectation the wider list changed, and list each change (old → new) in your report.

Run tests **only** as, one at a time, always with paths:

```
until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/gs-3a2-w1-<n>.log 2>&1"
```

Never pipe vitest into `head`. Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . > plans/gs-3a2-w1-tsc.log 2>&1` and report the error count in your files. `npx prettier --check` on each file you touched.

## Stop and ask (write it in your report and stop that part) when

A rule above cannot be built without editing a file not listed; a schema change or migration seems needed; a handover would need to unseat or duplicate a seat; you would add a name, sentence, setting or event not written above.

## Report

Your final message: changed files; each function's signature; the tests and their results (log paths, counts); every expectation you changed in an existing test (old → new); what `is_player` does today where you read it; tsc and prettier results; Noticed, not done. Under about 400 words.
