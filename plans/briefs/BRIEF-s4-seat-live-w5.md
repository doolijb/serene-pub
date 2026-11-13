# BRIEF — lane `s4-seat-live`, worker w5 — Take a seat mints a member; the seater acts for a card-less line; Pick who speaks shows card-less seats (Q10–Q12) (2026-11-08)

Supervisor: lane `s4-seat-live` (seat-cast S4, wave 4 follow-up; **the flip is ON**). Repo `/home/jody/github/serene-pub`. Report in your final message (no report file). Worker w6 runs beside you on the session forms' picker (`CharacterSelectModal`, Start/Edit session forms) — no shared files.

## Context (quoted by the supervisor; never reinterpret)

- Owner 2026-11-08 ★6 (ruled): **"Take a seat" with a seat name mints a card-less member in the session's book.** Trade-off accepted: one member per named seat, including retire re-seats.
- Owner 2026-11-05 ★S2b-1 "Still theo": **the person who seated a cast member keeps acting for that seat** (`session_characters.seated_by_user_id`).
- A **card-less character seat** is a `session_characters` row with `character_id` NULL, `envoy_slug` NULL, `cast_member_id` set; ref `seated-member:<castMemberId>`. Its lines: `character_id` null, `cast_member_id` = the member, `metadata.speaker = "seated-member:<id>"`. ⚠ A **card-less player seat** line also has `character_id` null and may have `cast_member_id` set; its `metadata.speaker` is `player-seat:<id>` (and `personaId` null). Never treat a player's line as a character seat's.
- ⚠ **Card ids and member ids share one id range** — never compare one to the other.
- Ready (lane s4-seat): `sessions/seats.ts` `seatPlayer(tx, { sessionId, personaId: null, userId, seatName, position, mintCardless: true })` mints a new card-less member (own book, else the attached book if mintable; under the book lock) and seats it — read its signature and refusals (it throws) at ~820–1000; `seatOf(db, sessionId, ref)` → `ResolvedSeat`; `seatActorOf(tx, sessionId, seat)` (~1466) → who acts for a seat (`actingUserId` = a character seat's seater). Client: `sessions:get` carries 🚧 `cardlessSeatShown` (member id → `{ name, nickname, faceMediaId }`), and `PickSpeakerModal.svelte` already takes a `cardlessSeatShown` prop and lists live seats by ref.

## Goal (the supervisor's queue, exactly)

1. **Q10 `src/lib/server/sessions/seatName.ts` `writeSeatName` (★6):** the two `insert(schema.sessionPersonas)` sites — the retire re-seat (~125, already inside `db.transaction` — use its `tx`) and the new seat (~212, not in a transaction — wrap the read of `last` and the seat in one `db.transaction`, `tx` only inside) — become `seatPlayer(tx, { sessionId, personaId: null, userId, seatName: name, position: (last?.position ?? -1) + 1, mintCardless: true })`, returning the new seat's id as today. A `seatPlayer` refusal reaches the caller as a `SeatNameRefusal` with its words (read how the caller turns `SeatNameRefusal` into a reply). Renaming an existing seat (no insert) is unchanged — no mint.
2. **Q12 `src/lib/server/messages/permissions.ts` `canActOnMessage` (~172–240):** a **card-less character line** (no `characterId`, no `personaId`, `metadata.speaker` = `seated-member:<id>`, not narration) → the session owner may act; otherwise the person `seatActorOf(db, sessionId, await seatOf(db, sessionId, speaker))` returns may act (live or departed seat — say which `seatOf` answers); anyone else no. Place it before the envoy branch. A card-less **player** line keeps today's path.
   **Mirror in the client** `src/lib/client/components/sessionPage/sessionPageProjections.ts` `canControlMessageAs` (~243–320): same line rule; non-guest (owner) → true; a guest → true when the seat in `session.sessionCharacters` with that `castMemberId`, no card and no envoy has `seatedByUserId === userCtx.user.id`. First check the client `LoadedSession`'s `sessionCharacters` rows carry `seatedByUserId` and `castMemberId` (grep the `sessions:get` read and the `LoadedSession` type); if `seatedByUserId` is missing, **stop and report** where it would be added (that's `sockets/sessions.ts` / `shared/sockets/types.ts` — outside your files) and build the server half only.
3. **Q11 `src/routes/sessions/[id]/+page.svelte` (~1128):** `cardlessSeatShown={session?.cardlessSeatShown}` on `<PickSpeakerModal>` — the one prop, nothing else in this file. Check the prop name/type in `PickSpeakerModal.svelte` and the `sessions:get` response type.

## Files owned (edit only these)

`src/lib/server/sessions/seatName.ts`, `src/lib/server/messages/permissions.ts`, `src/lib/client/components/sessionPage/sessionPageProjections.ts` (`canControlMessageAs` only), `src/routes/sessions/[id]/+page.svelte` (the one prop), and tests next to them: new `src/lib/server/sessions/seatName.mint.int.test.ts`, new `src/lib/server/messages/permissions.cardless.int.test.ts`, additions to the existing `sessionPageProjections` test file (grep it).

## Files readable

Everything. Key: `sessions/seats.ts` (`seatPlayer`, `seatOf`, `seatActorOf`, `ResolvedSeat`); `sessions/seats.cardless.int.test.ts` (harness for a card-less seat; how `seatCast({ castMemberId, seatedBy })` makes one); existing `seatName*.test.ts` and `permissions*.test.ts` (grep) for setup; `PickSpeakerModal.svelte`.

## Out of scope (never built here)

Everything else: the picker (w6), prompt/turn/state code (done). SDK. Docs. NOMENCLATURE (list rows to queue). Renaming a minted member when its seat is renamed (Noticed in the seat report — leave). Existing named card-less player seats with no member (no boot pass — leave).

## Stop and ask (in your report) when

CLAUDE.md §Decisions applies; a new exported name; a change outside your files; the client lacks `seatedByUserId` (item 2).

## Hard rules (CLAUDE.md)

- Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently.
- Never seed a row at a fixed id. No migration. Never add a top-level `await` to `src/lib/server/db/index.ts`.
- Browser code: no `crypto.randomUUID`, no `navigator.clipboard`. Views never call `toaster`/`notify` for socket results.
- It is a **session**, never a chat.
- An int test that opens a DB inside an `it` needs a 60 s timeout. Never pipe vitest into `head`.
- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no sdk:build; dev servers are running — don't build.)
- Prettier: `npx prettier --check` changed files; only `--write` lines you changed — never reformat a whole file (`+page.svelte` is huge: hand-format your one line).
- Never `kill -9` anything. Never `git checkout`/`restore`/`stash`.

## Tests (Done means)

Capped, logged:

```
SP=/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > $SP/s4-seat-live-w5-tests.log 2>&1; echo test-exit=\$? >> $SP/s4-seat-live-w5-tests.log"
```

Must pass, each its own `it`:
- a named Take a seat (`writeSeatName` with no seat) creates **one** card-less member in the session's book (count before/after) and a player seat whose `cast_member_id` is it, `persona_id` null, `seat_name` the name; the reply is the seat id;
- a retire re-seat retires the old seat and mints a second member for the new one;
- a rename of an existing seat mints nothing;
- `canActOnMessage` on a card-less character line: owner yes; the seater (a guest who seated it) yes; another guest no; a card-less player line by its player keeps today's answer;
- client `canControlMessageAs` mirrors the four cases (or, if item 2 stopped, says so).
Re-run the existing tests of every file you touched (grep `seatName`, `permissions`, `sessionPageProjections`, `pickSpeaker`), ≤10 files per batch. `npx tsc --noEmit -p .` and `npm run check` (12G scope, `NODE_OPTIONS=--max-old-space-size=8192`, one after the other, logs `$SP/s4-seat-live-w5-tsc.log` / `-check.log`) — no new errors.

## Report (final message)

Changed files with hunks named; decisions (named); tests + counts + log paths; tsc/check; stopped-and-asked; Noticed, not done; NOMENCLATURE rows to queue (draft).
