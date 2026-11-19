# BRIEF — lane `gs-3a`, worker 1 (server): the guest seat switches, the freeze, the take checks, the genre opt-in on adds, the cast-to-take read

Repo `/home/jody/github/serene-pub` (app). No SDK change. Supervisor: lane `gs-3a`. Owner rulings G3, G4
(2026-11-16), quoted: *"On by default; off freezes guests' seats as they are"* · *"Guests can bring their own
if enabled. Guests can grab the sessions/lorebooks cast members if also enabled. So two settings, both on by
default. The genre still has to opt in to characters/personas since we still have to support the user as a
speaker and envoys etc. Guests can't choose directly from the owners card list"* · *"Keep: any guest may take a
card-less cast member's seat"* · *"Bench is not absence"* (2026-11-15).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (This lane needs no `sdk:build` at all: don't run one.)

Also: never `git checkout / restore`; never `prettier --write`; no migration; no `npm run build`; no full test run.

## Already written by the supervisor (read; do not rename)

- `src/lib/shared/sessions/guestSeats.ts`: `GUESTS_BRING_OWN_METADATA_KEY` (`"guestsBringOwn"`),
  `GUESTS_TAKE_CAST_METADATA_KEY` (`"guestsTakeCast"`), `storedGuestSeatSwitches(metadata)` (missing key = on;
  only a stored `false` is off), `GUEST_SEAT_SENTENCES` (`bringOwnOff`, `takeCastOff`, `cardedMember(name)`,
  `memberHeld(name)`). Use these sentences verbatim; add none of your own without saying so in the report.
- `src/lib/shared/sockets/types.ts`: `Sockets.Sessions.Update.Params.guestsBringOwn?` / `guestsTakeCast?`
  (booleans) and the namespace `Sockets.Sessions.CastToTake` (`Params { sessionId }`, `Member { castMemberId,
  name, faceMediaId }`, `Response { sessionId, members, error? }`).
- `src/lib/client/sockets/typedSocket.ts` and `src/lib/shared/sockets/interest.ts`: `sessions:castToTake` is
  typed, gated and SCOPED by `payload.sessionId`.

## Files owned (only these)

- NEW `src/lib/server/sessions/guestSeats.ts` (the one writer of the two keys, and the helpers below)
- `src/lib/server/sockets/sessions.update.ts` (the seat doors only, plus the switch write in the owner block)
- `src/lib/server/sockets/sessions.participants.ts` (`addPersona`, `reassignRemovedParticipant`,
  `setCastSeatEnabled`, and the NEW `sessions:castToTake` handler)
- `src/lib/server/sessions/seatName.ts` — **only inside `writeSeatName`**
- `src/lib/server/sessions/seats.ts` — only to `export` `checkSeatMember` (no behaviour change)
- `src/lib/server/sockets/sessions.ts` — **only** the import/export of the new handler next to
  `sessionsAccountVisibilityHandler` (~118–141) and one `register(...)` line beside its register (~2062).
  Nothing else in that file.
- NEW test files `src/lib/server/sockets/sessions.guestSeats.int.test.ts` and
  `src/lib/server/sockets/sessions.castToTake.int.test.ts` (split as you see fit; name any third in the report)

Do **not** edit `pipelines/runtime/host.ts` (its `core:outlet/set-seat-name` already calls `writeSeatName` and
turns a `SeatNameRefusal` into `{ halt: e.message }`; that is how a run obeys the check), the client, docs,
`NOMENCLATURE.md`, or any other file. Anything else you think needs changing goes in your report.

## Rules your work depends on (quoted from CLAUDE.md)

- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- "Never add a top-level `await` to `src/lib/server/db/index.ts`; await `dbReady`."
- "An event in `SCOPED_EVENTS` must carry its scope key (`sessionId`, `lorebookId`…) in the payload, or
  `emitToUser` silently sends nothing." — every `sessions:castToTake` reply carries `sessionId`, refusals too.
- "One domain context per event family … is the only place that toasts" — the server only answers; no toasts.
- "A change to stored data or ids ships with a forward migration or boot pass and a test that a second boot
  changes nothing." Here: no migration and no boot pass; a missing key reads as on, so the test shows that
  reading and saving without the switch params writes no key.
- "It is a **session**, never a *chat*." NOMENCLATURE R3: qualify names, never a bare noun.
- Decisions: do what is asked at the size asked; findings go under **Noticed, not done**, never fixed in
  passing. No new option, hook or extension point.

## What to build

### 1. `sessions/guestSeats.ts` (new)

- `guestSeatSwitchesOf(db, sessionId): Promise<GuestSeatSwitches>` — reads `sessions.metadata`, through
  `storedGuestSeatSwitches`.
- `writeGuestSeatSwitches(db, sessionId, { bringOwn?: boolean; takeCast?: boolean })` — the ONE writer, in
  the manner of `writePlayerLabel` (`sessions/playerLabel.ts`: SQL `jsonb_set` / `-` on `metadata`, cast to
  `jsonb` and back to `json`, so the row's other keys never move). **Off stores `false`; on removes the key**
  (so a session switched back on reads exactly as one never touched). A key not given is left alone.
- `heldMemberIds(db, sessionId): Promise<Set<number>>` — every `cast_member_id` of a NOT-removed seat of
  either table (`session_characters` without `envoy_slug`, and `session_personas`), **benched seats
  included** (a benched seat still holds its member; correction 2 of the lane brief).
- `castToTakeOf(db, sessionId): Promise<Sockets.Sessions.CastToTake.Member[]>` — the members of
  `lorebook_bindings` in the session's attached lorebook and its own notes (`seatBookOf(...).attachedId` /
  `.ownBookId`), `overlay_of` null, `character_id` null (card-less), not in `heldMemberIds`; read through
  `membersAsRead(db, ids, { sessionId })` (`cast/memberAsRead.ts`) and kept only when the read returns the
  member and it reads `cardless`; `name` = the read's `shownName` (fallback the row's name, else
  `"Unnamed character"`), `faceMediaId` = the read's `faceMediaId`. Sorted by name. Nothing else: no
  description, personality, summary, greetings, sheet or card field.
- `guestTakeRefusal(db, sessionId, castMemberId): Promise<string | null>` — for a guest taking one member:
  `checkSeatMember` (export it from `seats.ts`) refusal first; then carded (`checkSeatMember`'s
  `characterId` not null, OR the session's read of it not `cardless`) → `GUEST_SEAT_SENTENCES.cardedMember(name)`;
  then held (`heldMemberIds`) → `memberHeld(name)`; names via `membersAsRead` `shownName`.
- `seatKindAddRefusal(db, sessionId, adds: { characters: number; personas: number }): Promise<string | null>`
  — **the genre opt-in, adds only** (lane correction 5). Genre: `getSessionGenre(db, await sessionGenreOf(db,
  sessionId))` (find `sessionGenreOf`; `sessions.update.ts` imports it). No genre found → null (the F29
  posture). A kind "the shape does not have" is the one `shapeViolations`
  (`pipelines/entities/sessionGenres.ts` ~337) treats as none permitted: the shape omits it or its `max` is 0.
  When `adds.characters > 0` and characters are absent (or personas likewise), answer with the existing
  sentence: `` `This session does not fit '${genre.name}': ${violation}.` `` where `violation` is the
  `"this genre has no characters — the session has N"` (resp. personas) string `shapeViolations` produces, N =
  the live non-envoy seats of that kind now plus the adds (`sessionShapeFacts` gives the live counts). Never
  re-check existing seats, card-less seats, named (card-less player) seats or envoys.

### 2. The switch write (owner only) — `sessions.update.ts`

Inside `if (sessionAccess.isOwner)`, beside the `playerLabel` write (~400): when `params.guestsBringOwn` or
`params.guestsTakeCast` is a boolean, `writeGuestSeatSwitches`. A guest's values are dropped like every session
field (no refusal, nothing written). When a switch was written, push the session to every member: extend the
existing `if (params.seatName !== undefined || params.playerSeatChanges?.length)
broadcastSessionToParticipants(...)` (~1142) condition. No run reads the switches.

### 3. The freeze and the take checks — a preflight, before ANY write

In `sessionsUpdateHandler`, right after the `sameMemberRefusal` block (~123) and before the owner block, so a
refusal leaves everything as it was. Throwing `new Error(sentence)` is this handler's way to refuse (it reaches
the asker as `sessions:update:error`). Only for a caller who is **not** the session's owner; the owner is never
frozen and is not held to the card-less rule. Read `guestSeatSwitchesOf` once.

| `params` | Switch | Refused when the switch is off and… |
|---|---|---|
| `characterIds` | bring own | any id not among the session's not-removed carded seats (an add), **or** a not-removed seat whose card the caller owns is missing from the list (a removal of their own). A missing seat of someone else's card stays **silently skipped** as today (not refused). |
| `personaIds` | bring own | the same over `session_personas` (persona `user_id` = caller). |
| `playerSeatChanges` | bring own | any entry with `remove`. A rename stays allowed. |
| `castMemberIds` | take cast | any wanted member not already held by a not-removed card-less character seat (an add), or a card-less seat the caller seated (`seated_by_user_id`) missing from the list. Others' card-less seats missing: silently skipped as today. |

With **take cast on**, each `castMemberIds` add by a guest must pass `guestTakeRefusal` (all checked before any
seat is written). Then, for owner **and** guest, the genre opt-in: `seatKindAddRefusal` with
`characters` = the `characterIds` adds + the `castMemberIds` adds that are carded (linked card), `personas` = the
`personaIds` adds. Leave the existing per-row checks in the diffs as they are.

`seatName` is NOT checked in the door: see 4.

### 4. `writeSeatName` (`sessions/seatName.ts`) — one check, so the door and a run obey the same rule

When `!isOwner`: in the `retireSeatId` path (before its transaction) and in the path that opens a NEW
card-less seat (after the watcher check, before its transaction), if `guestSeatSwitchesOf(...).bringOwn` is
false → `throw new SeatNameRefusal(GUEST_SEAT_SENTENCES.bringOwnOff)`. Renaming a seat the caller already
holds stays allowed. Nothing else in `seatName.ts` changes. Find (read only) what a player sees when the host
outlet halts with that sentence (the Dungeon Crawler planner seats guests through it) and say it in one line.

### 5. The participants doors — `sessions.participants.ts`

Each refusal answers the asker on the door's own event in its existing shape, and nothing changes. Not for the
owner.
- `addPersona`: right after the access check, bring own off → `{ success: false, error: bringOwnOff }` (this
  covers the bench-back path too). The genre opt-in (`seatKindAddRefusal`, one persona) only before seating a
  NEW persona seat, never on the bench-back path.
- `reassignRemovedParticipant`: bring own off → refused with `bringOwnOff`; the genre opt-in for the kind
  (`type`) before the transaction, owner too.
- `setCastSeatEnabled`: after the existing permission check, only when the set would change the seat
  (`seatIsActive !== params.enabled`; a repeated set stays a no-op success): a player seat or a carded seat →
  bring own; a card-less member seat → take cast; switch off → `refuse(sentence, seatIsActive)`.
- NEW `sessionsCastToTakeHandler` (`event: "sessions:castToTake"`): `checkSessionAccess`; not a member →
  emit `{ sessionId, members: [], error: "no access to this session" }`; else `{ sessionId, members:
  await castToTakeOf(db, sessionId) }`. Any member may call it (owner and guests). Register it in
  `sockets/sessions.ts` as described above.

## Tests (Done means)

Two new int test files (find the setup pattern in `sessions.castMemberIds.int.test.ts`,
`sessions.participantRemoval.int.test.ts`, `sessions/seatName.mint.int.test.ts`; 60 s timeout on any `it` that
opens a DB under load). **Every refusal asserts the sentence AND that nothing changed** (the seat rows of both
tables and `sessions.metadata` read the same before and after). Cover:
- switches: a session with no keys reads both on; the owner stores off (`false`) and on (key removed); a
  guest's values change nothing; a save without the switch params writes no key (second-boot rule).
- each door × owner | guest × the relevant switch on | off: `characterIds` add and own-remove; a guest's list
  missing the owner's card with bring own off is still silently skipped (no refusal, owner's seat stays);
  `personaIds` add/remove; `castMemberIds` add/remove; `seatName` opening a seat (refused) and renaming one
  (allowed); `writeSeatName` called directly as a run calls it (`isOwner: false`) refused; `playerSeatChanges`
  remove refused, rename allowed; `addPersona`; `reassignRemovedParticipant`; `setCastSeatEnabled` (bench and
  bring back; a no-op set still a success).
- **with both switches on, the owner's and a guest's ordinary seat actions are unchanged** (add, remove,
  bench, take a free card-less member, name a seat).
- take checks (guest): a carded member refused; a member of another lorebook refused; a member held by
  another seat refused, **including a benched seat**; a free card-less member seated. The owner may still seat a
  carded member.
- genre opt-in: a session whose genre shape has no personas (or no characters; find a registered genre or
  the pattern existing tests use to fake one) refuses adding one, owner too, with the sentence; a session
  already outside its shape still saves removals.
- cast read, as a guest: on a notes-only session, and on a session over an attached lorebook the guest
  cannot read (`lorebooks:bindingList` refuses them): only free card-less members of both books; the
  serialised reply (`JSON.stringify`) carries none of a member's description / personality text; someone not
  in the session gets `members: []` with `error`.

Also run, as regression, the existing seat files: `sessions.castMemberIds.int.test.ts`,
`sessions.seatEvents.int.test.ts`, `sessions.benchedSeats.int.test.ts`,
`sessions.participantRemoval.int.test.ts`, `sessions/seatName.mint.int.test.ts`, and
`src/lib/shared/sockets/gatedEvents.test.ts`, `src/lib/shared/sockets/scopedReplies.test.ts` (they read the
interest lists; if one needs the new event listed, report it, don't edit it).

Run tests ONLY like this, one run at a time, each after the wait:

```
until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/gs-3a-w1-<n>.log 2>&1"
```

Never pipe vitest into `head`. Typecheck your files with
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` (report errors in your files only).
`npx prettier --check` your files.

## Stop and ask (in your report, don't decide) when

A door cannot tell a guest's own-card seat from a cast-member seat; the freeze would unseat anyone; the read
would need sheet text; a new name, setting, event or sentence beyond the ones above seems needed; a file
outside the list must change.

## Report

Your final message: changed files; each door and what it refuses (one line each); tests run with pass counts
and log paths; what a player sees when a run's seat naming is refused; anything left; **Noticed, not done**.
Under 500 words.
