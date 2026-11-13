# BRIEF — lane `sense-st3`, worker 6 — the lane's proving tests, and the suites it must keep green

You are a `lane-worker` under the `sense-st3` supervisor. Repo: `/home/jody/github/serene-pub`. Use absolute paths.

## Where things stand (read first)

Built by workers 1–4 (all done; `tsc` clean): core's runtime values live in four `sessions` columns
(`turn_order`, `turn_tally`, `lane_reads`, `ruleset_decks`); a new table `session_imprints`
(`sessions/sessionImprints.ts` — read it whole) records what a turn changed on session rows: kinds `seat-bench`,
`ruleset-conversion`, `deck`, `annex`, one row per write, anchored to the turn's message. `retractStateAnchoredTo`
/ `restoreRetractedState` (`state/write.ts`) take and restore them by the one rule (`retractionAct`,
`lorebooks/imprints.ts`: newest first; a later standing row of the same key → splice or drop; else revert).
`rulesets/resolve.ts` `writeDecks` files one `deck` row per key written, anchored with `turnAnchorOf` in every mode,
propose included. Migration `drizzle/0155_chubby_lockjaw.sql` (generated — never edit it, never run
`db:generate`) with its data upgrade `db/dataUpgrades/0155_chubby_lockjaw.ts` (and its test, which already covers a
0154 database with the six keys, deltas across owners, a settle line and a branch, and a second boot).

Rulings and design (verbatim): "Ruleset decks follow Back; turn order and read marks do not." / "**Draws:** one row
per write, not per turn; anchored with `turnAnchorOf` in every mode, propose included, or a regenerated propose turn
spends twice. When two turns draw from one deck and the earlier is taken, the earlier turn's cards stay spent: the
later card was dealt from the position the earlier draw left." / "**Old `rewind_taken` survives the upgrade.** A
revive step turns an old record's `seatBenches` and `conversions` into session imprint rows, so 'Back before the
upgrade, Forward after' restores them."

## What to do

1. **Draws, through the real resolver** — a new `src/lib/server/rulesets/deckDraws.undo.int.test.ts` (find how
   `rulesets/resolve.int.test.ts` sets up a ruleset with a `card-draw` method and a turn; reuse it). Prove:
   - a swipe (the replaced case: `retractStateAnchoredTo(db, id, "replaced")`, or the real swipe path if a test
     helper drives it), a regenerate, Back (`rewindTurn`) and a delete (`deleteLegacy`) each take the draw: the
     deck's `DeckState` in `sessions.ruleset_decks` returns to what it was before the turn, and the row goes;
   - Forward (`forwardTurn`) after Back puts the draw back (deck and row);
   - **a propose-mode turn regenerated does not spend twice**: draw in propose mode, take it back as a regenerate
     does, draw again → the deck has advanced by one draw, not two;
   - **two turns drawing from one deck**: turn A draws, turn B draws; taking A leaves the deck where B left it (A's
     cards stay spent) and B's row now carries A's `before`; then taking B puts the deck where it stood before both.
2. **Back before the upgrade, Forward after** — extend `db/dataUpgrades/0155_chubby_lockjaw.int.test.ts` (or a
   sibling `0155_chubby_lockjaw.forward.int.test.ts`): on a database built at 0154 (as that test does), seed a
   session with a **rewound turn** — `session_messages.rewind_ordinal` set and `rewind_taken` holding an old-shape
   `RewoundTakenV1` record (`{ v: 1, wasHidden: false, state: { messageId, values: [], …, annexDeltas: [ … ],
   seatBenches: [ … ], conversions: [ … ] }, turn: { tally, elsewhere } }` — read `sessions/rewind.ts` and
   `state/write.ts` `reviveRetractedState` for the exact old shape) and the session's values as Back left them;
   upgrade with `runMigrationsWithUpgrades`; then call `forwardTurn` against that same database (a drizzle instance
   with `schema`) and assert the seat is benched again, the version converted again, the annex key back, and the
   rows filed. Then a second `runMigrationsWithUpgrades` changes nothing (`upgradesRun` empty, tables identical).
   Report the upgrade's logged counts.
3. **The suites the lane must keep green** — run, in the capped scope, in batches of a few files:
   `sessions/annexChanges*.int`, `sessions/oneUndoRule.int`, `sessions/rewind.int`, every `sessions/branch*.int`,
   every `sessions/seatKeys*.int`, `pipelines/runtime/setSeatBench*.int`, `sessions/convertRuleset.int`,
   `pipelines/routines/turnTally.test`, `pipelines/routines/roundTick*.int`, `sessions/turnOrder.write.int`,
   `sessions/sessions.turnOrder.int`, `channels/lanes.int`, `lorebooks/imprints*.test`, `sessions/settle.int`,
   `sessions/sessionImprints*.int`, `state/memberForm.int`, `messages/rewindMirror.int`,
   `sockets/sessions.runtimeColumns.int`, `sockets/sessions.benchedSeats.int`, `sockets/sessions.creationModes.int`,
   and **every** `sockets/sessions.dungeonCrawler*.int.test.ts`, plus `sockets/sessions.lairWalk.int`,
   `sockets/sessions.narratorCarryOn.int`, `sockets/sessions.sanctum*.int`, `sockets/sessions.taskSweep.int`,
   `sockets/sessions.channelEntries.int`, `pipelines/runtime/sessionEvents.emit.int`,
   `pipelines/scripts/dungeonCrawlerStory.test`, `db/dataUpgrades/0128_*`, `0139_*`, `0155_*`, `runner.int`,
   `db/migrationJournal.test`, `db/migrationSet.test`. For each failure: find the cause. If it is a stale fixture
   or assertion about `annex.core.turnOrder` / `turnTally` / `laneReads` / `rulesetDecks` / `seatBenches` /
   `rulesetConversions` or `annex_deltas`, fix the test to read the column or the rows (meaning unchanged, never
   weakened). If it is a bug in a lane file, fix it if the fix is small and plainly within the design above, and
   report it; otherwise report it with the error and stop on that one. A failure that exists without this lane's
   changes (check with `git diff` of the code it exercises; never stash or checkout), report as pre-existing.

## Files owned

New test files above; the 0155 upgrade test; test files in the item-3 list (fixture/assertion edits only, each
listed); and, only for a small bug fix you report, these lane files: `sessions/sessionImprints.ts`,
`state/write.ts`, `rulesets/resolve.ts`, `sessions/branch.ts`, `sessions/annexChanges.ts`, `sessions/seatKeys.ts`,
`pipelines/routines/turnTally.ts`, `sessions/turnOrder.ts`, `channels/attention.ts`, `messages/store.ts`,
`db/dataUpgrades/0155_chubby_lockjaw.ts`. All under `src/lib/server/`.

## Out of scope

Docs, NOMENCLATURE, the SDK (another worker is writing docs now); schema and migration; any behaviour beyond the
design; files of the other session (visual-novel layout work: dialogue-box widget, `show-line`, portraits).

## Stop and ask (in your report) when

A fix would change what a lore imprint does, a published SDK name or payload, or the design's rules above; a test
can only pass by weakening it.

## Rules (verbatim; they bind you)

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You have no reason to run `sdk:build`.)
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo (most of the
  SDK repo is uncommitted). Never `kill -9` a dev server. Inside `db.transaction(async (tx) => …)` use only `tx`.
  `socket.off(event)` always passes the handler. `$state(new Set())` is not reactive: use `SvelteSet`. Browser code
  runs on plain-http LAN addresses: no `crypto.randomUUID`, no `navigator.clipboard`. It is a **session**, never a
  *chat*. Every session has a lorebook (its own book, or an overlay): never write "no lorebook".
- **No reference to any other project or product** in code, comments, tests or docs in either repo.
- Run only your targeted test files, in a capped scope:
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files>"`.
  An int test that opens a DB inside an `it` needs a 60 s timeout. Never pipe vitest into `head`.
  `npx prettier --check <file>` on each file you changed. Do not start a dev server.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
- **Re-read the cited lines before changing anything.** A review row marked "? inferred" is yours to confirm first;
  if it turns out false, report that and do not "fix" it.
- CLAUDE.md: the 0.6 rule — "A change to stored data or ids ships with a forward migration or boot pass and a test
  that a second boot changes nothing"; never `git commit`.

## Done means

The new draw test and the Forward-after-upgrade test pass; `NODE_OPTIONS=--max-old-space-size=10240 npx tsc
--noEmit -p .` clean; every item-3 file passes, or each failure is explained (cause, pre-existing or not).

## Report

Return as your final message: the new tests (what each proves), the upgrade's counts, every item-3 file with
pass/fail counts, each failure's cause and fix, every code change with why, test files edited, **Noticed, not
done**.
