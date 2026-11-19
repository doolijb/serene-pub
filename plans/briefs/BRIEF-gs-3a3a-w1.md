# BRIEF gs-3a3a-w1 — the person of a player seat is its `user_id` (server readers), and the owner opens a persona for someone

Repo `/home/jody/github/serene-pub` (app). The SDK repo `../serene-pub-sdk` is **read-only**: no edit, no build.
Supervisor: lane `gs-3a3a`. Report path: your final message (the supervisor reads it). Keep it under ~500 words.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build` in this task: don't run one.)

Also: run **no git command that changes the index or the working tree** (the lead has staged the repo). Never `prettier --write`, never pipe prettier's output into a file. No migration. No `npm run build`, no full test run.

## Owner rulings this work implements (2026-11-17, quoted)

- PS1: "If the card owner is the session owner, seat the card as a cast member, keep the card connected. There's no reason to make it cardless just because a guest is using it. You're over thinking it."
- S1: "The owner can seat anyone they want to whoever they want as long as it's something they can see. The guest can seat to themselves when allowed, with cards they are allowed."
- S2: the owner re-assigns only seats holding their own cards or card-less cast members; a guest's card is never handed to another person.

**One rule everywhere: the person of a player seat is `session_personas.user_id`**; a row from before that column (`user_id` null) reads its card's owner (`characters.user_id`). PS1's stored row is `{ persona_id: the owner's card, cast_member_id: its member, user_id: the guest }`. A guest must gain nothing over the card itself (its editor, its library row, other sessions).

## Project rules you must follow (from CLAUDE.md, quoted)

- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- "It is a **session**, never a *chat*."
- "Comments state the rule, never the history."
- "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing."
- Before every vitest run: `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`. Run tests only as
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/gs-3a3a-w1-<n>.log 2>&1"` (always at least one path; one run at a time; never pipe vitest into `head`). `tsc`: `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` — judge only your files (lanes `wt-1a` and `ap-2a` are mid-edit in `lorebooks/ownBook.ts`, `scenes/liveScenes.ts` etc.; their errors are not yours).
- An int test that opens a DB inside an `it` needs a 60 s timeout.

## Files owned (edit only these, only the named parts)

All under `src/lib/`:
- `server/sessions/seats.ts` — add the helper below.
- `server/sockets/sessions.messages.ts` — **only the call at ~326** (`checkPersonaOwnership(personaId, userId)` in `sessionMessagesSendPersonaMessageHandler`). If the `checkPersonaOwnership` import (line ~60) becomes unused, remove just that name from the import and say so. Nothing else in this file (another lane owns its token-count and error paths).
- `server/pipelines/runtime/host.ts` — **only `personLineOf`** (~1449–1520).
- `server/pipelines/runtime/bindings.turnOrder.ts` — only lines ~301–304 (a persona turn entry's `ownerUserId`).
- `server/state/resolve.ts` — **only `personaOf`** (~2469–2497) and its doc comment.
- `shared/sessions/playerSeat.ts` — `isOwnPlayerSeat` and the file's head comment.
- `server/sessions/guestSeats.ts` — `resolveSeatHandovers` (carded player seat) and a new resolver for the new field.
- `server/sessions/seatName.ts` — **only** add `export` to the existing private `seatNamed` (no logic change).
- `server/sockets/sessions.update.ts` — `seatPreflight`, the personaIds add loop (~1101–1250, one skip), and one new write step.
- `shared/sockets/types.ts` — **shared with other lanes**: re-read right before editing; add only the one new field to `Sockets.Sessions.Update.Params`, next to `seatHandovers`.
- Tests: new `server/sockets/sessions.ownerCardForGuest.int.test.ts`; add cases to `shared/sessions/playerSeat.test.ts`.

**Not yours, never edit:** `server/sockets/sessions.shared.ts` (`checkPersonaOwnership` stays as it is: it is also the gate of `addPersona` at `sessions.participants.ts:88` and of reassign at `:483`, which must keep checking card ownership), `server/sockets/sessions.participants.ts`, `messages/permissions.ts`, `sockets/sessions.turns.ts`, `pipelines/runtime/portrayals.ts`, `pipelines/runtime/speakerRotation.ts`, `state/handEdits.ts`, any client file, docs, NOMENCLATURE, anything of lanes `wt-1a` (`scenes/liveScenes.ts`, `utils/sceneCast*.ts`, `sockets/scenes.ts`, `utils/activityStore.ts`) and `ap-2a` (`plugins/providedMarks.ts`, `sockets/lorebooks.ts`, `utils/ownedBook.ts`, `lorebooks/ownBook.ts`, `state/durable.ts`, `shared/lorebooks/primerRow.ts`). If a fix seems to need one of them, stop and say so in the report.

## Task A — the readers (PS1)

1. **Helper** in `server/sessions/seats.ts` (name ★ provisional): 
   `export async function maySpeakAsCard(dbh: Db, q: { sessionId: number; cardId: number; userId: number }): Promise<boolean>`
   One query: the card (`characters.id = cardId`, its `user_id`), left-joined to this session's player seat on it (`session_personas` is unique on (session_id, persona_id), so at most one row: its `user_id`, `removed_at`), and the session's owner (`sessions.user_id`). Rule:
   - a seat on the card exists → the seat's person is `seat.user_id ?? card.user_id`; allowed iff that person is `userId` **and** either `userId` owns the card, or the card's owner is the session's owner and the seat is not removed (`removed_at` null);
   - no seat on the card in this session → allowed iff `userId` owns the card (today's rule, unchanged).
   Doc comment: purpose (who may speak as a card in a session), the rule, and that a guest gains nothing over the card outside this seat. So the session's owner, whose card a guest holds, is refused; a guest's own card in their own seat is unchanged; a guest's card is never spoken by anyone else.
2. **Send door** `sessions.messages.ts` ~326: `checkPersonaOwnership(personaId, userId)` → `maySpeakAsCard(db, { sessionId, cardId: personaId, userId })`. Same refusal sentence.
3. **`personLineOf`** (`host.ts`), the `parsed.kind === "character"` branch: replace the `characters.user_id = scope.userId` query with `maySpeakAsCard(db, { sessionId, cardId: personaId, userId: scope.userId! })` (use the same `db` handle the function already uses). Same sentence. Update the function's doc comment ("a persona they own" → the persona whose seat they hold, or their own unseated card). Nothing else in `host.ts`.
4. **Turn order** `bindings.turnOrder.ts` ~302: `const ownerUserId = cp.persona ? cp.persona.userId : cp.seatUserId` → the seat's person first: `cp.seatUserId ?? cp.persona?.userId` for a carded seat, `cp.seatUserId` for a card-less one. Check `seatUserId` is on the cast row type (it is filled by `host.read.sessionCast.ts:147`). Comment states the rule.
5. **`personaOf`** (`resolve.ts`): which persona the asking user voices = the first of `personas` (in their order) whose seat in this session has the asker as its person (`session_personas.user_id = userId`, or `user_id` null and the card's owner is `userId`). Still **one** query (join `session_personas` to `characters`). Same return shape. Don't add a removed/benched filter the old code did not have.
6. **`isOwnPlayerSeat`** (`shared/sessions/playerSeat.ts:42`): for a carded seat `(seat.persona?.userId ?? seat.userId) === userId` → `(seat.userId ?? seat.persona?.userId) === userId`. Rewrite the head comment's "when it carries their card (`persona_id`, the card's owner theirs)" to the one rule. Unit cases in `playerSeat.test.ts`: the owner's card with `userId` = guest is the guest's and not the owner's; a row with `userId` null reads the card's owner; card-less unchanged.

## Task B — the owner opens a persona for someone (server door)

New field on `Sockets.Sessions.Update.Params` (name ★ provisional, doc comment like `seatHandovers`'):
`playerSeatsFor?: { toUserId: number; characterId?: number; castMemberId?: number; seatName?: string }[]` — exactly one of `characterId` (one of the owner's own cards: a persona seated **linked**), `castMemberId` (a cast member of the session's books: its linked card, when it has one, is seated as `characterId` would be; a card-less member becomes a card-less player seat named as the member is shown), `seatName` (a new named card-less seat).

**Checker** `resolvePlayerSeatsFor(db, { sessionId, callerId, isOwner, entries })` in `server/sessions/guestSeats.ts`, reads only, first refusal wins, run in `seatPreflight` order (before ANY write of the save, like `resolveSeatHandovers` at `sessions.update.ts:305–313`). Checks, with these sentences (★ provisional; put them in one exported const next to `SEAT_HANDOVER_REFUSALS`, reusing its existing sentences where named):
- caller is not the session's owner → `SEAT_HANDOVER_REFUSALS.ownerOnly`;
- not exactly one of the three → "Pick one character, cast member or seat name to seat."
- `toUserId` is neither the owner nor a guest of the session → `notInSession`; a guest who does not play (`session_guests.is_player` false) → `watcher(name)` (read the name as `resolveSeatHandovers` does);
- `characterId` (or a member's linked card) whose `characters.user_id` is not the session's owner → `` `${name} is not your card, so it can't be seated for someone else.` ``
- the card (or the card-less member) already held by a **live** player seat of this session → `` `${name} already has a seat in this session.` ``
- `castMemberId` not a member of the session's books → the refusal `checkSeatMember` gives (`seats.ts:460`; `seatBookOf` for the book);
- `seatName` blank after trim → "A new character needs a name." (the words `writeSeatName` already uses).
Count each entry as a persona add in `seatPreflight`'s `seatKindAddRefusal` (the genre's seat-kind opt-in).

**Write**, in `sessions.update.ts`, after the personaIds sync, the seat-name and `playerSeatChanges` steps, before the shared-card copies; **all entries in one `db.transaction`** (only `tx` inside), positions appended (max position + 1, incrementing):
- card: `seatPlayer(t, { sessionId, personaId: card, userId: person, position })` (or `castMemberId` for a member with a linked card). `seatPlayer`'s revive (`onConflictDoUpdate`, `seats.ts` ~1081–1095) does **not** write `user_id`: when the row's stored `user_id` after the call is not the person, give it to them with `handOverSeat(t, { sessionId, kind: "player", seatId, fromUserId: <stored>, toUserId: person })` — the one writer of a seat's person. Do not change `seatPlayer`'s revive for its other callers.
- card-less member: `seatPlayer(t, { sessionId, personaId: null, castMemberId, userId: person, seatName: <member's shown name>, position })` (as `copySharedCard`'s seat does, `sessions.update.ts` ~1321–1333; name via `membersAsRead`).
- named seat: the exported `seatNamed(t, sessionId, person, name, position, changes)` (`seatName.ts:64`). Not `writeSeatName`: with no `playerSeatId` it renames the person's existing seat instead of opening one.
Collect every `changes` into `seatChanges` (announced by the existing `announceSeatChanges`), call `syncMintedSeatMembers` after commit and `markCharacterAsPersona` per card, as the personaIds add path does. In the personaIds add loop, skip a card that a `playerSeatsFor` entry names (so it is never first seated as the owner's).

**Handover of a carded persona** (`resolveSeatHandovers`, `guestSeats.ts` ~500–503): today the owner's `kind === "player" && seat.cardId != null` is always refused with `cardedPlayerSeat`. Allow it when the card's owner (`characters.user_id`, add it to the player-seat select) is the session's owner; keep the refusal for any other card. For the "changes nothing" test (`seat.current === to`) read the person as `user_id ?? card owner`; pass the **stored** `user_id` as `fromUserId` (the write's guard).

## Tests (new `server/sockets/sessions.ownerCardForGuest.int.test.ts`)

Copy the setup of `server/sockets/sessions.seatHandover.int.test.ts` (mocks, `createTestDb`, `bootstrapPipelines`, temp dir `serene-pub-vitest-ownercardguest-`). Drive the real handlers (`sessions:update`, `sessionMessages:sendPersonaMessage`, the participants handlers); find an existing test that sends a person's message through `offerMessage` for the pattern (`sessions.sendChannel.int.test.ts`, `sessions.messageLengthCap.int.test.ts`). Cases:
1. Owner `playerSeatsFor [{ characterId: ownersCard, toUserId: guest }]` → row `{ persona_id: card, cast_member_id: not null, user_id: guest }`.
2. The guest sends with `personaId: card` → saved through `offerMessage` → `personLineOf`; the row's `personaId` is the card. The session's owner sending with the same card is refused with "You can only send messages with personas you own."
3. `personaOf`/`who.user` for the guest is the card (via the exported resolver that calls it), and the turn-order candidates give the seat `ownerUserId` = guest (find how existing tests read turn-order entries, e.g. grep `turnOrder` in `*.int.test.ts`).
4. The guest edits and swipes/rerun-checks their own line through the real handlers (permissions read the seat: `messages/permissions.ts` 79–98).
5. The guest cannot read-for-edit or update the card (`characters:update` / the card editor's handler refuses), the library row is unchanged, and in a second session of the owner where the card is seated as the owner's own persona the guest is not the person (sending refused) and the owner still sends.
6. A guest can't `addPersona` (participants `:88`) nor reassign (`:483`) the owner's card to themselves: refused by the shared gate.
7. Handover: the owner's card seat back to the owner (`seatHandovers [{ playerSeatId, toUserId: owner }]`) → the owner sends, the guest is refused; to the guest again → allowed. A guest's own carded persona handed to another person → `cardedPlayerSeat`.
8. Refusals of `playerSeatsFor`, each writing nothing (row counts unchanged): a guest as caller; a person not in the session; a watcher; a guest's card; a card already live in a seat; blank seat name; two keys in one entry.
9. Card-less member for the guest → card-less player seat, `seat_name` = member's name, `user_id` guest. Named seat for a guest who already has a seat → a **new** seat; the old seat's name unchanged.
10. Revive: the owner's card seated, then removed, then `playerSeatsFor` to the guest → the same row, live, `user_id` guest.
11. A second identical save of case 1 is refused (already has a seat) and changes nothing.
Then run `shared/sessions/playerSeat.test.ts`, the new file, `server/sockets/sessions.seatHandover.int.test.ts`, `server/sockets/sessions.guestSeats.int.test.ts`, `server/sockets/sessions.playerSeats.int.test.ts`, `server/sockets/sessions.sharedCardSeat.int.test.ts`, `server/sockets/sessions.sendChannel.int.test.ts` (one run, all paths). If an existing test's expectation changes, don't edit it: report which and why.

## Report (final message)

Files changed (with the function names); each reader before → after in one line; the sentences and names you added; test run log path and pass/fail counts; `tsc` result for your files; prettier `--check` result on your files (report only); anything you could not do and why; **Noticed, not done**.
