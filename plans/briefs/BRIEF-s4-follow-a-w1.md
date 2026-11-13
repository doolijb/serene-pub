# BRIEF — s4-follow-a worker w1 (2026-11-09): seat changes announced from the one seat writer

You are a `lane-worker` under supervisor lane `s4-follow-a`. Repo `/home/jody/github/serene-pub` (SvelteKit 5, Svelte 5 runes, TS, Vitest 4, Drizzle + PGlite). Use absolute paths.

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
*Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
*Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
*Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no sdk:build.)

## Goal

Owner, 2026-11-09: *"Seems to be a bigger structural issue if turn order and story composer can't see the updated roster."* Today `member-added` / `member-removed` are emitted by per-door snapshot diffs in `sockets/sessions.ts`, and some doors emit nothing (`sessions:addPersona` ~l.7489–7650 seats a persona with no event; `sessions:reassignRemovedParticipant` ~l.8160–8400 seats a new card with no event). Make the **seat writer** (`src/lib/server/sessions/seats.ts`) the one place that says what changed, and dispatch the events from that path through one announcer.

### Design (the supervisor's; build exactly this)

1. **`seats.ts` — what changed.**
   - Export 🚧 `SeatChange`: `{ kind: "character" | "player"; change: "added" | "removed"; seatId: number; castMemberId: number | null; cardId: number | null }` (cardId = `character_id` for a character seat, `persona_id` for a player seat). One JSDoc sentence.
   - `SeatResult`'s ok branch gains `changes: SeatChange[]`: `seatCast` / `seatPlayer` report `"added"` only when the seat was **not live before the call** (a new row, or a soft-removed row revived); a seat that was already live (position update, already seated) reports nothing. Envoy seats (`envoySlug`) report nothing (envoys are out of scope).
   - `SettleReport` gains `changes: SeatChange[]`: a merge depart (boot only) is `"removed"`; a **fill** (giving a member to a seat that had none) reports nothing — the seat did not join or leave. Say so in the JSDoc.
   - `reseatOnto` returns `{ moved: number; changes: SeatChange[] }`: a **character** seat whose `cast_member_id` moves reports `"removed"` with the old member then `"added"` with the new (its ref `seated-member:<id>` changes); a **player** seat reports nothing (its ref is `player-seat:<seatId>`, unchanged). Update its one caller, `src/lib/server/lorebooks/foldInParent.ts` (`repointMembers`, ~l.1302), to carry the changes up into `foldInParent`'s result as 🚧 `seatChanges: SeatChange[]` (find the result type; add the field with one JSDoc sentence). Do **not** edit `src/lib/server/sockets/ownBooks.ts` (not ours): report the exact 3-line call the lead should add there after the fold (`announceSeatChanges(db, socket.io, { sessionId, userId }, folded.seatChanges)`).
   - New 🚧 `unseat(tx, { sessionId, kind, seatId, removedName })` → `SeatChange[]`: soft-removes one live seat — `removedAt: new Date()`, `removedName`, and `isActive: false` on a character seat — exactly as the doors do today; returns `[]` when the seat is already removed or missing. Move the header's "What it does not own: Removal of a seat by a person (it stays where it is until a later step)" into "What it owns" (the removal by a person is now `unseat`).
   - New 🚧 `announceSeatChanges(db, io, { sessionId, userId }, changes)` (async, best-effort, never throws): **nets** the changes by ref first (an added and a removed of the same ref cancel; two of the same collapse to one), builds each ref with `hostSeatRefOf` (`$lib/server/pipelines/prompt/seatCards`, **dynamic import**) — `{ kind, seatId, castMemberId, cardId }`; a player seat with a null ref falls back to `character:<cardId>` as today's `cpRef` does; a null ref is skipped — then emits each through `emitSessionEvent` (`$lib/server/pipelines/runtime/sessionEvents`, dynamic import) with **exactly today's payload** from `emitMemberEvent` (`sockets/sessions.ts` ~l.11492): `{ sessionId, ref, change: "added" | "removed", cause: { kind: "settings", userId } }`, event `sessionEvents.memberAdded` / `memberRemoved` (import `sessionEvents` the way `sockets/sessions.ts` does), `io`. A failure is logged with `console.warn`, never thrown.
   - ⚠ seats.ts must keep **no static import of `$lib/server/db`** (header rule) — every function takes its handle first; imports of the dispatch side are dynamic.

2. **`sessions/seatName.ts`.** `writeSeatName` and `editCardlessPlayerSeats` keep their return types (`creationModes.ts` calls `writeSeatName`; it is not ours). Each takes an optional collector in its input object, 🚧 `changes?: SeatChange[]`, and pushes what its seat writes changed: `writeSeatName` the `seatPlayer` result's changes; `editCardlessPlayerSeats` removes through `unseat` (replacing its direct `update(schema.sessionPersonas)` removal ~l.409/418 — keep its removed-name rule) and pushes those. `givePlayerSeatACard` (a card-less player seat taking a card) changes no seat's ref: no change.

3. **The doors in `sockets/sessions.ts`** — each collects the writer's `changes` and calls `announceSeatChanges` **once, after its writes commit, at the point it emits today** (so turn order hears the seat when it does now):
   - `sessions:update` (~l.6858–7480): every seat write already goes through `seatCast` / `seatPlayer` / `settleSeats`; the removals (characterIds ~l.7010, castMemberIds leaving ~l.7147, personaIds ~l.7250) become `unseat` calls with the same removed names; `writeSeatName` and `editCardlessPlayerSeats` get the collector. Then **remove** the member-delta half of the snapshot diff (~l.7394–7451: the `deltas` and their `emitMemberEvent`, and the two separate `emitMemberEvent` calls after `writeSeatName` ~l.7365 and `editCardlessPlayerSeats` ~l.7387) and announce the collected changes at that spot. **Keep** the snapshot for the `cast-changed { change: 'position' }` diff (positions) — trim `memberSnapshot` to what positions need. Fix the stale comment "nothing serves today" above it.
   - `sessions:addPersona` (~l.7600–7620): collect from `seatPlayer` (and `settleSeats` on the `givePlayerSeatACard` path) and announce after the seat lands, before `broadcastSessionToParticipants`.
   - `sessions:reassignRemovedParticipant` (~l.8240–8370): collect from `seatCast` / `seatPlayer` (the hard delete of the already-removed old row is no change) and announce after `syncMintedSeatMembers`.
   - **Not changed, on purpose** (the supervisor raises these to the owner): `sessions:create`, `branch` (`sessions/branch.ts`), import, `creationModes.ts` — a session being born announces with `session-created` / `session-branched`, never one `member-added` per seat (that would fire Lair's and Dungeon Crawler's **welcome** pipelines, which bind on `member-added`, at birth). Bench (`sessions:setCastSeatEnabled`, ~l.11560) stays `cast-changed { change: 'enabled' }`. Envoy seats (`setEnvoySeat`, `user:<id>` guest join/leave) keep their own `emitMemberEvent`. Leave `branch.ts` untouched unless a type change forces a one-word edit.
   - `emitMemberEvent` stays for envoys and guests only; its JSDoc says seats go through `announceSeatChanges`.

4. `memberFormOn()` is **on** (`state/memberForm.ts`): a character seat's ref is `seated-member:<castMemberId>`, a player seat's `player-seat:<seatId>`.

## Rules you must follow (quoted from CLAUDE.md / the lane brief)

- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." Never call `announceSeatChanges` inside a transaction: collect inside, announce after.
- "Never add a top-level `await` to `src/lib/server/db/index.ts`."
- "It is a **session**, never a *chat*."
- New names are 🚧 provisional with one JSDoc sentence each: `SeatChange`, `unseat`, `announceSeatChanges`, `seatChanges` (fold result), the `changes` fields/collectors. Add no other new name, setting, flag, event or table. If you find you need one, stop and report it.
- Do what is asked at the size asked; anything else you notice goes under **Noticed, not done**.
- Prettier: run `npx prettier --check` on changed files, but **only `--write` the lines you changed** — never reformat a whole file (`sockets/sessions.ts` is 445 KB; do not reformat it). If a file fails the check only on lines you didn't touch, leave it and say so.
- If an `Edit` fails because the file changed since you read it, re-read that range and retry (another worker may be editing a different part of a shared file; never overwrite it).

## Files owned (edit only these)

`src/lib/server/sessions/seats.ts`, `src/lib/server/sessions/seatName.ts`, `src/lib/server/sockets/sessions.ts` (the seat doors listed above only), `src/lib/server/lorebooks/foldInParent.ts` (`repointMembers` + result field only), and tests: `src/lib/server/sessions/seats.int.test.ts` (extend), new `src/lib/server/sockets/sessions.seatEvents.int.test.ts`, and existing tests that break only because of the new result shapes (fix the expectation; say which).

## Files readable

Anything. Useful: `src/lib/server/sockets/sessions.castMemberIds.int.test.ts` (harness that captures member events: ~l.29–90 mocks, ~l.383–420 the test), `src/lib/server/pipelines/prompt/seatCards.ts` ~l.330 (`hostSeatRefOf`), `src/lib/server/pipelines/runtime/sessionEvents.ts`, `src/lib/server/sessions/seatSites.int.test.ts`.

## Tests (Done means)

- New `sessions.seatEvents.int.test.ts`: through the real handlers, each door fires **exactly one** event per changed seat with the member-form ref, and none when nothing changed: `sessions:update` adding and removing a **carded** character seat, a **card-less** character seat (`castMemberIds`), a **persona** player seat, a **card-less** player seat (seatName / `playerSeatChanges`); `sessions:addPersona` (one `member-added` `player-seat:<id>`); `sessions:reassignRemovedParticipant` (one `member-added`); an update that only reorders fires no member event (and still its `cast-changed position`); a re-save with the same seats fires none.
- `seats.int.test.ts`: `changes` for new / revived / already-live seats; `unseat` returns one change then `[]`; `reseatOnto` changes (character pair, player none); `announceSeatChanges` nets an add+remove of one ref to nothing.
- Run, capped and logged (one command per batch; log in the supervisor's scratchpad `/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/`):
  `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; cd /home/jody/github/serene-pub; npx vitest run <files> --maxWorkers=2 > <scratchpad>/s4-follow-a-w1-tests.log 2>&1; echo test-exit=$? >> <scratchpad>/s4-follow-a-w1-tests.log'`
  Files: the two above + `src/lib/server/sockets/sessions.castMemberIds.int.test.ts src/lib/server/sessions/seats.cardless.int.test.ts src/lib/server/sessions/seatName.mint.int.test.ts src/lib/server/sessions/seatSites.int.test.ts src/lib/server/sessions/branch.cardlessSeats.int.test.ts src/lib/server/lorebooks/foldInParent.int.test.ts src/lib/server/sockets/sessions.castFromLorebook.int.test.ts src/lib/server/sockets/sessions.storyEmptyCast.int.test.ts`. Never pipe vitest into `head`. An int test that opens a DB inside an `it` needs a 60 s timeout.
- Then `npx tsc --noEmit -p .` under a 12G scope (`systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=8192; ...'`). Baseline is 0 errors.

## Report

Return to the supervisor (your final message): changed files with one line each; the exact `ownBooks.ts` call for the lead; tests run with pass/fail counts; tsc result; any place where the one path does **not** cover what the removed diff covered (and what you kept); Noticed, not done.
