# BRIEF — worker `s4-f-pass-w4` — the `seat-keys` gate tests and the no-op cost (seat-cast S4, wave 2) — 2026-11-08

Supervisor: lane `s4-f-pass`. You are a lane-worker; you cannot spawn agents. Return your report as your final message (no report file).

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
*Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
*Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
*Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You should not need `sdk:build`.)

**Never touch `~/.local/share/SerenePub`** (the owner's data — don't read, copy or open it). Use test databases only.

## Background

Seat-cast S4 flips stored seat keys from card form (`session_cast:<cardId>`, `character:<cardId>`) to member form (`seated_member:<castMemberId>` / `seated-member:<id>` for a character seat; `player_seat:<seatId>` / `player-seat:<id>` for a player seat). The `seat-keys` boot pass is built: `src/lib/server/sessions/seatKeys.ts` (`seatKeys(db) → SeatKeysReport`, read its module doc and the store list) with tests `seatKeys.int.test.ts` (owner columns, proposals) and `seatKeys.json.int.test.ts` (JSON stores). It is **not** in `startup/index.ts` yet (wave 3) — call it directly. These gate tests prove the pass is safe across the paths a user's data really takes. Don't change `seatKeys.ts`; if a gate test finds a bug, stop and report it with the failing assertion and your diagnosis.

## Goal — new `src/lib/server/sessions/seatKeys.gate.int.test.ts`

Harness: copy `seatKeys.int.test.ts`'s (mocks, `mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-seatKeysGate-"))`, `releaseDataDir`, `vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })`), unless a test needs the attic harness (below; a separate `describe` file is fine if the harnesses can't share — then name it `seatKeys.attic.int.test.ts`). One test per claim:

1. **Back before the pass → pass → Forward → Back.** A session whose seats hold cast members, with card-form state anchored to its newest turn: an `attribute_values` row (`session_cast:<card>`), a zone snapshot with a tie end `towards: "character:<card>"`, a pending proposal whose `payload.owner` is `session_cast`, and an annex write that leaves an `annex_deltas` row with audiences naming `character:<card>` (and, for owner `core`, a `dungeon-crawler-progress.fates` key). Take the turn **Back** with the real `rewindTurn` (`src/lib/server/sessions/rewind.ts:596`), so `session_messages.rewind_taken` and the delta hold card form. Run `seatKeys`. Then **Forward** (`forwardTurn`, rewind.ts:688): the restored rows are in member form (`seated_member:<member>`, `seated-member:<member>`), ids kept. Then Back again: the record written is member form. Second `seatKeys` run: all zeros. Copy the turn setup from `src/lib/server/sessions/rewind.int.test.ts` (its "rows written straight (no model)" tests are the light path — prefer them over a scripted model turn). If Back/Forward can't be driven without a pipeline, write the rows and the `rewind_taken` record the way `rewindTurn` does and say so.
2. **One session's failure rolls back that session alone** across JSON stores too: two sessions with card form in owner columns AND in the annex / a message speaker; `vi.mock("$lib/server/state/seatRefs", …)` making the translator throw for one session only after the column stores ran (e.g. on the first call from a JSON step — wrap `memberFormTargetsOf`/`memberFormOf` and count calls per `map.sessionId`); that session's columns, annex and metadata unchanged (compare stored text), the other session fully rekeyed, the pass rejects naming 1 session.
3. **Attic upgrade, then the pass.** Use the attic fixture harness (`src/lib/server/attic/testFixture.ts`: `placeFixture("tiny")`, `bootFixture()`, `runUpgradeTasks(db)`; pattern `src/lib/server/attic/upgrade.tiny.int.test.ts`), then the boot passes in startup order (`src/lib/server/startup/index.ts:255-330`): `ensureOwnBooks` (`lorebooks/ownBook.ts`), `seatMembers` (`sessions/seatMembers.ts`), `liftCharacterVersions` (`characters/versionsLift.ts`), then `seatKeys`. Assert: no row of the five owner tables is `session_cast` except ones the report counts in `left` (and say what they are if any), no `failed`; a second `seatKeys` run reports all zeros (or only the same `left`) and a dump of the touched tables is identical. Don't import `$lib/server/startup` (it starts `appReady` at module scope — see `src/lib/server/db/layoutPresets.boot.int.test.ts` header).
4. **A pre-flip backup, then the pass.** A backup is a PGlite data-dir dump (`src/lib/server/db/recovery.ts` header: "The archive is exactly what PGlite's `dumpDataDir()` produced"). Seed card-form data in every store, dump the test database (`dumpDataDir`), load it into a fresh PGlite (`PGlite.create({ loadDataDir })`) wrapped in drizzle with the schema (see how `src/lib/server/utils/testDb.ts` builds one; `recovery.int.test.ts` for loadDataDir), run `seatKeys` on the restored database: everything rekeyed as on the original; second run all zeros. If dumping the shared test DB is impractical, build the card-form data directly in the fresh PGlite and say so.
5. **Second boot over everything at once:** one rich fixture with card form in **every** store the pass names (five tables, proposals, zone tie ends, annex core turnOrder/turnTally/fates, annex_audiences, genre_fields auto-voice key, widget chosenImages/pickMembers, a message speaker, a `core:blocks` addressee and `answered.by`, a `rewind_taken` record, an annex delta), a card in both a character seat and a player seat (★K-2), a merged pair, and card ids overlapping member ids (move both sequences with `setval`, pattern `seatMembers.int.test.ts:198`). First run: every store's `rekeyed` > 0. Then a **dump of every touched table and JSON column** (`select … ::text` of each JSON column, plus whole rows of the five owner tables and proposals, ordered by id) and a second run: dump identical, report all zeros. Check that no row or ref names the decoy member (the person whose member id equals a seated card id).

## The no-op cost (measure; don't commit the measuring file)

Write a throwaway `src/lib/server/sessions/seatKeys.cost.int.test.ts`, run it, record the numbers, then **delete it**. Seed a database at a realistic upper size with `generate_series` inserts (fast): 60 sessions, ~400 `session_messages` + `messages` each (24k rows) with `metadata` like real rows (most with no speaker; envoy speakers; some `player-seat:` speakers), ~30 `core:blocks` parts per session, 300 `attribute_values` per session already in member form, annex documents with a turn order and tally in member form, a few `rewind_taken` records in member form, 20 annex deltas per session. Measure with `performance.now()` around `seatKeys(db)`: (a) the no-op run (nothing card form) — run it 5 times, report min/median; (b) the same with one session holding one card-form row (one candidate); (c) the first run over 60 sessions all in card form (the one-time flip). Also `EXPLAIN ANALYZE` the candidate query once on the no-op database and report its total time and the slowest branch. Report the numbers. If the no-op run's median exceeds ~200 ms, say so plainly — don't build a "pass ran" marker (that's the supervisor's ★ to raise).

## Commands (from `/home/jody/github/serene-pub`, capped; never pipe vitest into `head`)

```
SP=/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > $SP/s4-f-pass-w4-tests.log 2>&1; echo test-exit=\$? >> $SP/s4-f-pass-w4-tests.log"
```

Run the cost file alone (`--maxWorkers=1`) to a separate log `$SP/s4-f-pass-w4-cost.log`. At the end run all four seatKeys files together (gate, attic if separate, `seatKeys.int.test.ts`, `seatKeys.json.int.test.ts`).

## Rules your work depends on (quoted)

- CLAUDE.md Hard rules: "Inside `db.transaction(async (tx) => …)` use only `tx`." "Never `kill -9` the dev server: PGlite's WAL corrupts." "Migrations are generated … 0000–0093 are 0.5.3's and byte-identical forever; 0.5.3 data reaches 0.6 through the attic (`src/lib/server/attic/`), never a migration."
- CLAUDE.md: "0.6 is in users' hands. A change to stored data or ids ships with a forward migration or boot pass and a test that a second boot changes nothing."
- Plan §34.5 (tests that gate the flip): "the `seat-keys` second boot (dump of every touched table and JSON column identical, report all zeros), ids-overlap range test (card and member ids share one range — a wrong-person read is silent), Back-before-flip → boot → Forward/Back on `annex_deltas`, one session's failure rolls back alone, attic upgrade → boot, pre-flip backup → boot."
- Memory: the Vitest PGlite `/tmp` leak — never pipe vitest into `head`; delete only your own `serene-pub-vitest-*` dirs by name. An int test that opens a DB inside an `it` needs a 60 s timeout.
- It is a **session**, never a chat. Never frame a session as having no lorebook.
- Prettier: your new test file(s) may be `--write`n whole.

## Files owned

`src/lib/server/sessions/seatKeys.gate.int.test.ts` (new), optionally `src/lib/server/sessions/seatKeys.attic.int.test.ts` (new), the throwaway `src/lib/server/sessions/seatKeys.cost.int.test.ts` (create, run, delete).

## Files readable

Anything (except the owner's data dir). Named above, plus `src/lib/server/state/write.ts` (`retractStateAnchoredTo`, `restoreRetractedState` ~1100-1200), `src/lib/server/sessions/annexChanges.ts`.

## Out of scope

Editing `seatKeys.ts`, `seats.ts`, `seatMembers.ts`, `state/**` (lane f-door is editing it now), `rewind.ts`, `startup/index.ts`; any migration; NOMENCLATURE.

## Stop and ask (in your report) when

A gate test exposes a bug in the pass (report it; don't fix `seatKeys.ts`); Back/Forward or the backup round trip can't be driven as described (report what you did instead); the attic fixture leaves card-form rows the pass can't take (list them).

## Done means

The gate file(s) green alongside `seatKeys.int.test.ts` and `seatKeys.json.int.test.ts`; the cost numbers (a, b, c, EXPLAIN) in your report; the cost file deleted; prettier clean; report: each test with pass/fail, how Back/Forward and the backup were driven, the attic run's report object, any `left` items and what they are, decisions made, anything noticed and not done.
