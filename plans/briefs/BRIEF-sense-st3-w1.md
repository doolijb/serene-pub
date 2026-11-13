# BRIEF — lane `sense-st3`, worker 1 — core's runtime values read and write their columns

You are a `lane-worker` under the `sense-st3` supervisor. Repo: `/home/jody/github/serene-pub`. Use absolute paths.

## Goal

The migration `drizzle/0155_chubby_lockjaw.sql` (already generated — **never edit it, never run
`db:generate`**) adds four nullable jsonb columns on `sessions`: `turn_order`, `turn_tally`, `lane_reads`,
`ruleset_decks` (drizzle names `turnOrder`, `turnTally`, `laneReads`, `rulesetDecks`; see
`src/lib/server/db/schema.ts`, the comment above them). They hold **exactly** what the `core` annex document's keys
of the same names held. Move every reader and writer of those four keys to its column, and take core's runtime keys
out of every annex code path. The owner's ruling (2026-11-11): "The annex becomes purely the modders' home … Ruleset
decks follow Back; turn order and read marks do not."

## What to do

1. `src/lib/server/sessions/coreAnnex.ts`: **delete** `coreAnnexIn`, `coreAnnexKeySql`, `coreAnnexSetSql`,
   `annexForPipelines`, `ownerDocForPipelines` and the private helpers only they use. Keep `CORE_ANNEX_OWNER`,
   `CORE_RUNTIME_KEYS` (now documented as "the list the data upgrade and the readers of old snapshots strip"),
   `CoreRuntimeKey`, `lockSessionAnnex`, and `readCoreAnnex` (other sites still call it; worker 3/4 remove those
   later). Rewrite the header comment (lines 1–44) to say what is true after this lane: the annex holds declared
   fields only; the four runtime values are columns (one writer each, named); `rulesetConversions` and
   `seatBenches` are `session_imprints` rows (kinds `ruleset-conversion`, `seat-bench`); the deck draws file
   `deck` imprints.
2. Deleting those functions makes the compiler list every site. Each site reads or writes its column instead:
   - `sessions/turnOrder.ts` — `readStoredTurnOrder` selects `turnOrder` and calls `readTurnOrder(row)` (the SDK's
     `readTurnOrder` reads `.turnOrder` off whatever it is given — pass the selected row); `writeTurnOrder` keeps its
     rule and its raw-SQL shape but reads `turn_order ->> 'basedOnAt'` and sets `turn_order = $json::jsonb`. Keep
     `lockSessionAnnex`. Update the file comment.
   - `pipelines/routines/turnTally.ts` — `readTurnTally(holder)` and `publishedTurns(holder)` keep their signature
     and meaning (they read `.turnTally` off what they are given), so a caller passes the selected row
     (`{ turnTally }`). `writeLaneTally` and `writeTurnTally` write the `turn_tally` column with raw SQL (no
     `updated_at` move), under `lockSessionAnnex`; `null` sets the column NULL. Update the comments.
   - `channels/attention.ts` — `laneReadsOf(holder, userId)` keeps its signature (reads `.laneReads`);
     `markLaneRead` updates `lane_reads` with the same jsonb expression on the column; `sessionChannelsFor`
     selects `laneReads`.
   - `rulesets/resolve.ts` — `decksFor` reads the `rulesetDecks` column; `writeDecks` sets
     `ruleset_decks = coalesce(ruleset_decks, '{}'::jsonb) || $decks::jsonb` (raw SQL, under the lock);
     `sessionTurnFacts` selects `turnTally`. **Do not add any imprint filing** (worker 4 does).
   - `sessions/settings.ts` ~216 (`readTurnOrder(session)` with the column selected / present) and ~253 (the annex
     goes to pipelines as `annexWithoutPoints(...)`, no strip).
   - `pipelines/entities/publishedValues.ts` ~171 (no strip) and ~184.
   - `pipelines/routines/moments.ts` ~219, `pipelines/routines/evaluate.ts` ~295, `sessions/turnPlan.ts` ~376,
     `notifications/yourMove.ts` ~55, `sessions/turnOrderPush.ts` ~43, `sockets/sessions.ts` ~10817,
     `sessions/rewind.ts` ~660 (the tally Back keeps on the record) and ~835 (`retallyStoryLane`: "no tally yet"
     is now `row.turnTally == null`).
   - `pipelines/runtime/host.ts` — only the `ownerDocForPipelines` lines (~2393, ~2493, ~2536, ~3790): the document
     goes back as it is.
   - `sessions/annexChanges.ts` line 66 only: `TIMELESS` becomes `{ core: ["retake-quietly"] }`; drop the
     `CORE_RUNTIME_KEYS` import if unused. Nothing else in that file.
   - Wherever a full session row is read with `db.query.sessions…` or `select()`, the column is already on it.
3. **Never to a client.** In `sockets/sessions.ts` add `turnOrder: false, turnTally: false, laneReads: false,
   rulesetDecks: false` to both excluded-column lists (~441 `sessions:list`, ~2079 `sessions:get`; today
   `{ annex: false, annexAudiences: false, drafts: false }`) and extend their comments ("read marks are every
   member's; a deck's state lets a player work out the next card"). Add a test (a new
   `src/lib/server/sockets/sessions.runtimeColumns.int.test.ts`, modelled on an existing `sessions:get` /
   `sessions:list` socket test) that writes all four columns on a session and asserts neither payload carries any
   of the four keys (and that the session's own fields still arrive). Then **report, do not change**, every other
   place in `sockets/sessions.ts` you find that emits a whole `sessions` row to a client (e.g. a `.returning()`
   or `select()` of all columns sent on a socket).
4. `sessions/seatKeys.ts` — the boot pass and the fold-time rekey (`rekeySessionRefs`): the `annex_core` step
   (`rekeyAnnexCore`, ~1233–1258) rekeys the `turn_order` and `turn_tally` **columns** (with the existing
   `orderIn` / `tallyIn` rewrites, writing back only a changed column, raw SQL) and the `core` annex document's
   remaining key (`dungeon-crawler-progress.fates`). `coreIn` (~776–790) no longer looks for `turnOrder` /
   `turnTally` inside the document. The candidate query (~1520, `coreCardSql(sql\`annex -> 'core'\`)`) also finds
   card-form refs in the two columns. Keep the store name `annex_core`. Do **not** touch the `annex_deltas` store
   or `rewind_taken` handling (worker 4). Update the header comment's store description.
5. Tests: fix every test fixture that seeds or asserts `annex.core.turnOrder` / `turnTally` / `laneReads` /
   `rulesetDecks` to use the columns (grep the test files; known: `turnOrder.write`, `sessions.turnOrder`,
   `yourMove`, `sessionEvents.emit`, `resolve.int`, `seatKeys.json`, `seatKeys.int`, `seatKeys.memberMove`,
   `turnAdvise`, `autoAdvance`, `fireTurn`, `turnTally.test`, the Dungeon Crawler / sanctum / lair / taskSweep
   socket tests). Fixture-only edits in a test file outside this list are allowed; list each one in your report.
   **Do not** touch fixtures or assertions about `seatBenches`, `rulesetConversions` or `annex_deltas` (later
   workers). Leave `db/dataUpgrades/0128_*` and `0139_*` and their tests alone.

## Files owned (edit only these)

`src/lib/server/sessions/coreAnnex.ts`, `sessions/turnOrder.ts`, `pipelines/routines/turnTally.ts`,
`channels/attention.ts`, `rulesets/resolve.ts` (the lines above only), `sessions/settings.ts`,
`pipelines/entities/publishedValues.ts`, `pipelines/routines/moments.ts`, `pipelines/routines/evaluate.ts`,
`sessions/turnPlan.ts`, `notifications/yourMove.ts`, `sessions/turnOrderPush.ts`, `sessions/rewind.ts` (~660,
~835 only), `sessions/seatKeys.ts` (as above), `sessions/annexChanges.ts` (line 66 only),
`pipelines/runtime/host.ts` (the four `ownerDocForPipelines` lines only), `sockets/sessions.ts` (the two
excluded lists and ~10817 only), the new socket test, and test fixtures as in item 5. All paths under
`src/lib/server/`.

## Files readable

Everything. Not yours: `state/write.ts`, `sessions/convertRuleset.ts`, `messages/store.ts`, `sessions/settle.ts`,
`sessions/branch.ts`, `sessions/creationModes.ts`, `lorebooks/imprints.ts`, `db/schema.ts`, `drizzle/`,
`db/dataUpgrades/`, any docs, NOMENCLATURE, the SDK repo. The sites in `state/write.ts`, `convertRuleset.ts`,
`host.ts` ~9371 and `sockets/sessions.ts` ~5760 that use `readCoreAnnex` / `coreAnnexSetSql` for `seatBenches` /
`rulesetConversions` will not compile after you delete `coreAnnexSetSql`: **leave them broken**; workers 3 and 4
rewrite them. Report the exact tsc errors left, all of which must be in those files.

## Out of scope

Session imprints of any kind; benches; conversions; annex deltas; the data upgrade; docs; the Session data panel;
the SDK. No new names beyond what this brief gives. No behaviour change: every reader returns what it returned.

## Stop and ask (in your report) when

A runtime key turns out to be read by a plugin-facing port or a published SDK shape; a site needs a new helper
that is more than a local select; anything outside the owned files must change.

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
- CLAUDE.md Hard rules that touch this work: never `git commit`; another session is editing this repo (visual-novel
  layout work: dialogue-box widget, `show-line`, portraits) — never touch its files; raw SQL writes so no
  `updated_at` moves (drizzle's `$onUpdate` only runs through the ORM).

## Done means

- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` — every remaining error is in `state/write.ts`,
  `sessions/convertRuleset.ts`, `pipelines/runtime/host.ts` (~9371 block) or `sockets/sessions.ts` (~5760 block);
  list them.
- Pass, in the capped scope: the new runtime-columns socket test; `sessions/turnOrder.write.int.test.ts`,
  `sessions/sessions.turnOrder.int.test.ts`, `pipelines/routines/turnTally.test.ts`, every `seatKeys*.int.test.ts`,
  `rulesets/resolve.int.test.ts`, `notifications/yourMove.int.test.ts`, `sessions/autoAdvance.int.test.ts`, the
  attention tests (grep `markLaneRead`/`sessionChannelsFor`), `sessions/annexChanges.int.test.ts`, and every other
  test file whose fixtures you edited. Report pass/fail counts per file; a failure you believe belongs to the
  broken bench/conversion sites, say so with the error.

## Report

Return as your final message: every reader and writer moved (file:line, before → after), the excluded-list test,
the other whole-row emits found, tsc errors left, tests and counts, fixture edits outside the owned list,
**Noticed, not done**.
