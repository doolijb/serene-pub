# BRIEF — bench-L4-w1: benched seats, the server half of the Participants tab

Supervisor: bench-L4. Repo: `/home/jody/github/serene-pub`. Design RULED by the owner 2026-11-10 (`plans/PROPOSAL-benched-seats-2026-11-10.md`, read the "Revised design" and both rulings rounds only). Earlier lanes: L1 built the data and the one writer `setSeatBench` (`src/lib/server/sessions/seats.ts`), L2 the readers (`inPlay` / `seatInPlay`), L3 the port and its undo records (`seatBenches`, `retractSeatBenchesAnchoredTo`).

## Goal

1. **`sessions:setCastSeatEnabled` gets a player branch.** The params already carry `playerSeatId?: number` (the supervisor added it to `src/lib/shared/sockets/types.ts`, Params and the Response echo; don't touch types.ts). In `sessionsSetCastSeatEnabledHandler` (`src/lib/server/sockets/sessions.ts` ~11595):
   - "Name exactly one" now counts three: `characterId`, `castMemberId`, `playerSeatId`. Keep the refusal's shape; the sentence may say "Name one seat: a character, a cast member or a player seat." (the old one is "Name one seat: a character or a cast member.").
   - `refuse()` echoes `playerSeatId` when asked.
   - A `kind: "player"` branch: the live seat `session_personas` row by `id = playerSeatId`, this session, `removedAt IS NULL` (benched or in play). Access: the session owner, **or** the seat's player (`session_personas.user_id`), **or** the owner of the seat's card (`characters.user_id` through `persona_id`) — mirror the character branch's "owner or the card's owner". Not found → the existing "Session character not found." refusal is wrong for a player seat; use "That seat is not in this session." (L1's own `setSeatBench` refusal copy, so no new string). Access denied → "Only the session owner or this seat's player can change this."  ★(new copy — keep it, the supervisor reports it).
   - Then `setSeatBench(tx, { sessionId, kind: "player", seatId, benched: !params.enabled })` inside `db.transaction`, and the same answer / `resendSession` / `announceSeatChanges` tail as the character branch. Restructure the handler so both kinds share that tail; don't copy it.
2. **`sessions:addPersona` brings a benched persona back** (`sessionsAddPersonaHandler` ~7515). Today any existing row for (session, persona) refuses with "This persona is already in the session." Change only this: when the existing row is **live and benched** (`removedAt == null && isActive === false`), bring it back with `setSeatBench(tx, {kind: "player", seatId: row.id, benched: false})` in a transaction, then `announceSeatChanges` and `broadcastSessionToParticipants` and `pushSessionActions` as the add path does, and answer success (read the handler's existing success response further down and send the same shape). A live seat in play, and a removed row, keep today's refusal unchanged.
3. **Undo moves are announced** (L3's queue). Back, Forward, regenerate and swipe move seats through `setSeatBench` in `retractSeatBenchesAnchoredTo` / `restoreRetractedState` (`src/lib/server/state/write.ts`), but nobody calls `announceSeatChanges`, so open pages show a stale seat.
   - `retractSeatBenchesAnchoredTo` (~1071) returns `{ taken, changed, changes: SeatChange[] }` — the `changes` of every `setSeatBench` that moved a seat (import the `SeatChange` type from `$lib/server/sessions/seats` as a type-only import; `seats.ts` is imported dynamically there today, keep it that way for the value).
   - `retractStateAnchoredTo` (~806) adds `seatChanges: SeatChange[]` to its return (from `retractSeatBenchesAnchoredTo`). This is the one line it needs; change nothing else in it.
   - `restoreRetractedState` (~1265) keeps returning `boolean` (8 int tests and a caller assert it) and gains an optional third param `opts?: { seatChanges?: SeatChange[] }`: it pushes into it the changes of its own `retractStateAnchoredTo` call (`undone.seatChanges`) and of every `setSeatBench` it re-applies. Document it in its JSDoc.
   - Callers announce **after their transaction commits** (never inside it), with `announceSeatChanges(db, io, { sessionId, userId }, changes)` from `$lib/server/sessions/seats`:
     - `src/lib/server/sessions/rewind.ts`: `rewindTurn` (~596) collects `seatChanges` from each `retractStateAnchoredTo` in its transaction and announces after the transaction, beside `announce(db, opts, …)` (~676). `forwardTurn` (~688) collects through `restoreRetractedState(t, state, { seatChanges })` (~737) and announces after its transaction (~774). `opts.io` is optional there: announce only when `opts.io` is present (as `announce` does for the broadcast), and say in a one-line comment that a call with no io (a test, a tool) moves seats without telling pages.
     - `src/lib/server/sockets/sessions.ts`: the regenerate handler (`retractStateAnchoredTo(db, params.id)` ~9218) and the swipe-right handler (`retractStateAnchoredTo(db, message.id, { annex: "keep" })` ~9847, and its failed-run `restoreRetractedState(db, retracted.taken)` ~9901) announce the seat changes after the call returns, with the socket user's id and `socket.io`.
   - **Not in scope:** the message delete path (`messages/store.ts` `retractLoreOf`, reached through `deleteTurnYield` and the host's deletion outlet), `generationStatus.ts` and `host.ts` callers. Don't edit those files; list them in your report.

## Files owned (edit only these)

- `src/lib/server/sockets/sessions.ts` — only: `sessionsSetCastSeatEnabledHandler`, `sessionsAddPersonaHandler`, and the regenerate and swipe-right handlers' retract/restore call sites (a few lines each). Nothing else in this file.
- `src/lib/server/state/write.ts` — only `retractSeatBenchesAnchoredTo`, `restoreRetractedState`, and the one `seatChanges` line in `retractStateAnchoredTo`'s return.
- `src/lib/server/sessions/rewind.ts` — only `rewindTurn` and `forwardTurn`.
- Int tests (new files, or extend `src/lib/server/sockets/sessions.benchedSeats.int.test.ts`):
  - the player branch of `setCastSeatEnabled`: benches a carded persona seat and a card-less player seat, brings one back, refuses a seat in another session, refuses a guest on someone else's seat, refuses naming two seats; a repeated set answers success with no write;
  - `addPersona` on a benched persona brings the seat back (`is_active` true, same row id, no second row); on a seat in play it still refuses;
  - Back announces the unbench: after a turn whose `set-seat-bench` benched a seat (see how `src/lib/server/pipelines/runtime/setSeatBench.int.test.ts` seeds one, and copy its setup; don't edit that file), `rewindTurn` with an `io` stub records a `cast-changed` emit with `change: "enabled", value: true`; Forward records `value: false`. Find how other int tests stub `io` / spy on `emitSessionEvent` (`grep -rn "emitSessionEvent" src/lib/server --include=*.int.test.ts`) and follow the closest pattern.

## Files readable

Anything. In particular `src/lib/server/sessions/seats.ts` (`setSeatBench`, `SeatChange`, `announceSeatChanges`, `unseat`), `src/lib/shared/sessions/inPlay.ts`, `src/lib/server/pipelines/runtime/setSeatBench.int.test.ts`, `src/lib/server/sockets/sessions.benchedSeats.int.test.ts`.

## Rules (quoted)

- CLAUDE.md Hard rule: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently; `db/transactionGuard.ts` throws in dev/test, warns in prod." `announceSeatChanges` takes `db` and runs after the commit, never inside.
- CLAUDE.md Standing ruling (Sockets): "one domain context per event family … is the only listener, and the only place that toasts … An event in `SCOPED_EVENTS` must carry its scope key (`sessionId`, `lorebookId`…) in the payload, or `emitToUser` silently sends nothing." Every answer of `sessions:setCastSeatEnabled` carries `sessionId`.
- The design: "One writer, `setSeatBench(tx, {sessionId, kind, seatId, benched})` … **Every** path calls it inside its own transaction." Never write `is_active` directly.
- Owner ruling 2026-11-10: core never benches automatically; there is no "nudge". Don't add any automatic bench.
- Every answer path of `setCastSeatEnabled` answers the asker on that event (the form counts answers to close).
- Int tests that open a DB inside an `it` need a 60 s timeout.

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`. Never `git checkout`, `restore` or `clean` in either repo. **Never run `prettier --write` on a file.**
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no sdk:build: never run one.)
- Never hand a DOM node to an assertion. Never pipe vitest into `head`. Run vitest in a capped scope: `systemd-run --user --scope -p MemoryMax=8G -p MemorySwapMax=0 --quiet bash -c 'NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --maxWorkers=2 <files>; echo test-exit=$?'`.
- Scratch files start with `bench-L4-`.

## Stop and ask when

A new name beyond the ones above is needed; a refusal sentence beyond the two above; a change outside the functions listed; anything that needs a migration. Put it in your report rather than deciding.

## Done means

- The int tests above, green, run in the capped scope. Also re-run `src/lib/server/sockets/sessions.benchedSeats.int.test.ts`, `src/lib/server/pipelines/runtime/setSeatBench.int.test.ts`, and the int tests that call `restoreRetractedState` (`grep -rln restoreRetractedState src --include=*.int.test.ts`) — they must stay green.
- `npx tsc --noEmit -p .` shows no error in your files.
- `npx prettier --check` on your files: report the result (pre-existing drift is fine, say so).

## Report

Your final message: changed files with the functions touched, tests run with pass counts, new strings, any departure from this brief and why, and **Noticed, not done**.
