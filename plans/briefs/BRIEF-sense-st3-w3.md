# BRIEF — lane `sense-st3`, worker 3 — the retraction core takes session imprints; a branch is the session as of the fork

You are a `lane-worker` under the `sense-st3` supervisor. Repo: `/home/jody/github/serene-pub`. Use absolute paths.

## Where things stand (read first)

- `db/schema.ts`: `sessions.turn_order` / `turn_tally` / `lane_reads` / `ruleset_decks` columns and the table
  `sessionImprints` (read its comment: the charter). `annex_deltas` is **gone** (migration `0155_chubby_lockjaw`,
  generated — never edit it, never run `db:generate`). The four runtime columns already have their readers and
  writers (worker 1).
- `src/lib/server/sessions/sessionImprints.ts` (worker 2) — **read it whole**: `fileSessionImprint`,
  `retractSessionImprints(tx, { sessionId, messageIds }, { keep?, above? })` →
  `{ taken: TakenSessionImprint[], seatChanges, changed }`, `restoreSessionImprints(tx, taken)` →
  `{ seatChanges, changed }`, `settleSessionImprints`, `sessionImprintsAfter`, `sessionImprintsFromOldRecord`,
  `seatBenchKey`, `annexImprintKey`. The one retraction rule is `retractionAct` in `lorebooks/imprints.ts`
  (newest first; a later standing row of the same key → splice or drop; else, for a session row, always revert).
- Kinds: `seat-bench` (key `<character|player>:<seatId>`, value the benched flag), `ruleset-conversion` (key the
  ruleset id, value `ruleset_version`), `deck` (key the method key, value its `DeckState` in `ruleset_decks`),
  `annex` (key `<owner>/<key>`, value the annex key, with audience before/after and `owner_version`).
- Worker 4 is working **at the same time** on the writers that file these rows (`host.ts`, `creationModes.ts`,
  `convertRuleset.ts`, `resolve.ts`, `settle.ts`, `sockets/sessions.ts`, `annexChanges.ts`, `seatKeys.ts`) — never
  edit those files. Until worker 4 is done, rows are not yet filed by the app; your tests file them with
  `fileSessionImprint` directly where they need them, or use the app path and expect it once worker 4 lands
  (say which in your report).

Rulings (owner, 2026-11-11, verbatim): "Move to columns (Recommended)" — "The annex becomes purely the modders'
home … Ruleset decks follow Back; turn order and read marks do not. Needs a migration and a boot pass." and
"Yes, a turn owns what it wrote". The amended design (`plans/DESIGN-st3-annex-and-runtime-2026-11-11.md`, the
"Challenger round" section wins), verbatim: "`retractStateAnchoredTo` takes these rows by the imprints' rule
instead of editing JSON logs; `RetractedState` keeps carrying what Forward needs. `turnTally` keeps its replay
path. `turnOrder` and `laneReads` are bookkeeping: never recorded, never taken." / "**A branch is the session as of
the fork (plan §1.9 F1, Rule 3).** The parent's session imprints after the fork are folded backwards onto
`ruleset_decks`, `ruleset_version` and the seat bench flags, as `annexAt` does for the annex; `turn_tally` is
replayed on the branch (`retallyStoryLane`), not copied; seat ids inside bench keys are remapped with the branch's
seat maps as message ids are. `turn_order` and `lane_reads` copy as they stand. The F1 test: a branch cut before a
draw, a bench and a conversion sees none of them." / "**Old `rewind_taken` survives the upgrade.** A revive step
turns an old record's `seatBenches` and `conversions` into session imprint rows, so 'Back before the upgrade,
Forward after' restores them." Brief (verbatim): "`keepOnRetell` becomes 'skip that key's rows on a replacement';
the in-place narrowing, `kept`, `except` and the failed-re-tell special case are deleted, and their tests are
rewritten to the new shape, not weakened."

## What to do

1. **`state/write.ts`**
   - `retractStateAnchoredTo(db, messageId, turnCase, opts)`: replace the three JSON-log / delta parts (annex deltas
     ~915–923, conversions ~938–958, seat benches ~959–962) with ONE call, inside the existing transaction:
     `retractSessionImprints(t, { sessionId: message.sessionId, messageIds: [messageId] }, turnCase === "replaced"
     ? { keep, above: opts.above } : {})`, where `keep(row)` is true only for an `annex` row whose key is declared
     `keepOnRetell` by the session's genre for that owner (adapt `keepOnRetellOf` ~770 into that row predicate).
     Add `above?: number` to `opts`. Its `seatChanges` join the returned `seatChanges`; its `changed` joins
     `changed`.
   - `RetractedState`: remove `annexDeltas`, `conversions`, `seatBenches`; add `sessionImprints:
     TakenSessionImprint[]` and `imprintMark?: number` — the highest `session_imprints.id` of the session when the
     retraction ran (read it in the same transaction, `max(id)`, or 0). Delete `RulesetConversionRecord`,
     `SeatBenchRecord` and `retractSeatBenchesAnchoredTo` (their callers move to `retractSessionImprints`).
   - `restoreRetractedState(db, taken, opts)`: the inner retraction becomes
     `retractStateAnchoredTo(db, taken.messageId, "replaced", { above: taken.imprintMark })` — a failed re-tell's
     own rows (above the mark) go in full, `keepOnRetell` or not; **delete** the second `except` pass and the
     `kept` logic. Then, inside the restore transaction, `restoreSessionImprints(t, taken.sessionImprints)` (its
     `seatChanges` into `opts.seatChanges`); delete the conversions and seat-bench re-apply blocks. Rewrite the
     doc comment to describe this.
   - `reviveRetractedState(raw, sessionId?)`: revive `sessionImprints` (each taken row's `imprint.createdAt` a
     `Date` again — `reviveDates(schema.sessionImprints, …)`); and when the raw record carries the old
     `annexDeltas`, `seatBenches` or `conversions` (written before ST3), append
     `sessionImprintsFromOldRecord(raw, sessionId)` (needs the session id: add the optional parameter; the old
     `annexDeltas` rows carry their own). The caller in `sessions/rewind.ts` passes `opts.sessionId`.
   - `takenSummaryOf`: keep the key `annexDeltas` (it rides the deletion outlet's `taken` port; do not change the
     payload's keys) counting the taken `annex` rows that were reverted or spliced. Say so in a comment.
2. **`messages/store.ts`** `retractLoreOf` (~625–645): replace `retractSeatBenchesAnchoredTo` with
   `retractSessionImprints(db, { sessionId, messageIds: ids })` (all kinds: a delete takes a draw, a bench, a
   conversion and annex writes), its `seatChanges` pushed as today. Update the comment ~566–573.
3. **`sessions/retakeTurn.ts`** ~206–213: remove the `retractAnnexDeltasAnchoredTo` loop — the store delete it
   ends with (`deleteLegacyWhere` → `retractLoreOf`) now takes every session imprint of those rows. Update its
   comment. (Only those lines.)
4. **`sessions/rewind.ts`**: Forward (~735–748) drops the special `conversions` re-attach (the revive converts an
   old record now) and passes `opts.sessionId` to `reviveRetractedState`. Export `retallyStoryLane` for the branch.
   Nothing else in this file (worker 1 already moved ~660 and ~835).
5. **`sessions/branch.ts`** — a branch is the session as of the fork:
   - Copy `turnOrder` and `laneReads` as they stand; copy `turnTally`, then after the messages are copied run
     `retallyStoryLane(tx, created.id)` so the story lane is replayed over the branch's own history (other lanes
     as they stand, Back's rule — say so in a comment).
   - `rulesetDecks` and `rulesetVersion`: the parent's current values with the parent's `sessionImprintsAfter(tx,
     parent, fork)` rows folded backwards, newest first (`deck` → that key back to `unwrap(before)`, removed when
     undefined; `ruleset-conversion` → `rulesetVersion = unwrap(before)`).
   - Seat bench flags: after the branch's seats exist, each parent `seat-bench` row after the fork (newest first)
     puts the **branch's** corresponding seat back to `unwrap(before)` with `setSeatBench` (character seats: keep a
     map from each parent `session_characters.id` to the branch seat id `seatCast` returns; player seats:
     `seatRemap`). A seat with no counterpart is skipped.
   - Copy the parent's session imprint rows anchored at or before the fork (standing and settled), each with its
     `message_id` remapped by `remap` (a row whose message is not copied is skipped) and, for `seat-bench`, the seat
     id in its key remapped by the same seat maps (skipped when unmapped). Ids are new. Put this copy in
     `sessions/sessionImprints.ts` as `copySessionImprintsToBranch(tx, { fromSessionId, toSessionId,
     forkMessageId, messageRemap, seatRemap: { character: Map, player: Map } })` — the module owns its writes.
   - The annex line (`annexAt(...)`) stays as it is; worker 4 rewrites `annexAt` to fold per-key rows with the same
     signature.
   - **The F1 test** (new `sessions/branch.asOfFork.int.test.ts`): a session plays on past a fork message; after
     the fork it draws from a deck, benches a seat, converts its ruleset and writes an annex key (file the rows
     with `fileSessionImprint` and set the values as the writers would, or drive the real writers if worker 4 has
     landed); the branch cut at the fork sees none of them (deck, version, bench flag, annex key as at the fork;
     turn tally replayed), and its copied rows anchor to the branch's message ids with remapped seat keys.
6. **`sessions/sessionImprints.ts`** (now yours; worker 2 is done): add `copySessionImprintsToBranch` (above) and
   `standingSeatBenches(db, sessionId): Promise<Map<string, boolean>>` — key `<kind>:<seatId>` → `unwrap(after)` of
   the newest **standing** `seat-bench` row of that key (worker 4 calls it for "fell in story"; keep this exact
   signature). And in `restoreSessionImprints`, for an `annex` row while `memberFormOn()` (`state/memberForm.ts`;
   it is on): put `after` and `audience_after` in member form first, as the old `restoreAnnexDeltas` did
   (`rekeyDeltaSide({ document: { [key]: after }, audiences: { [key]: audienceAfter } }, owner,
   await loadSeatMap(tx, sessionId))` from `sessions/seatKeys.ts`, then take the key back out). Keep the rest of
   the module as it is.
7. **Tests — rewrite to the new shape, never weaken:**
   - `sessions/oneUndoRule.int.test.ts` and `sessions/annexChanges.keepOnRetell.int.test.ts`: every case keeps its
     meaning. The narrowing / `kept` / `except` assertions become per-key ones: a replacement leaves a
     `keepOnRetell` key's rows standing and takes the rest; Back takes them all; **a failed re-tell keeps none of
     its own annex values, a kept key included** (the swipe's state comes back exactly).
   - `sessions/rewind.int.test.ts`, every `sessions/branch*.int.test.ts`, `pipelines/runtime/setSeatBench*.int.test.ts`,
     `pipelines/routines/seatChangesOfTurn.int.test.ts`, `messages/rewindMirror.int.test.ts`,
     `state/write*.test.ts` that touch these paths: fix fixtures and assertions that read `annex.core.seatBenches` /
     `rulesetConversions` or `schema.annexDeltas` so they read the rows (through `sessionImprints.ts`) instead.
   - New cases (in `oneUndoRule` or a new `sessions/sessionImprints.undo.int.test.ts`): Back of a turn that wrote a
     bench, a conversion, a deck draw and an annex key takes all four and Forward restores all four; a delete
     (`deleteLegacy`) takes them; an **old-shape** `rewind_taken` record (raw JSON with `annexDeltas`,
     `seatBenches`, `conversions` as written before ST3) on a rewound row is restored by Forward.

## Files owned (edit only these)

`src/lib/server/state/write.ts`, `messages/store.ts` (~560–645), `sessions/retakeTurn.ts` (~206–213),
`sessions/rewind.ts` (Forward ~720–760 and the export), `sessions/branch.ts`, `sessions/sessionImprints.ts` (the
additions above), and the tests in item 7 (fixture/assertion edits only in test files outside that list, each
listed in your report). All under `src/lib/server/`.

## Files readable

Everything. Not yours (worker 4 is in them): `pipelines/runtime/host.ts`, `sessions/creationModes.ts`,
`sessions/convertRuleset.ts`, `rulesets/resolve.ts`, `sessions/settle.ts`, `sockets/sessions.ts`,
`sessions/annexChanges.ts`, `sessions/seatKeys.ts` and their tests (`annexChanges.int`, `annexChanges.memberForm`,
`seatKeys*`, `settle.int`, `convertRuleset.int`, `resolve.int`). Never `db/schema.ts`, `drizzle/`,
`db/dataUpgrades/`, docs, NOMENCLATURE, the SDK.

## Out of scope

Filing rows from the writers (worker 4); `annexAt`'s internals; the lorebook annex and `lore_imprints`' behaviour;
the settle line's rule; what a branch inherits beyond item 5; docs.

## Stop and ask (in your report) when

A published SDK name or payload would change; the shared rule would need to change; a branch needs to inherit
anything beyond item 5; a name beyond those given here is needed.

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
- CLAUDE.md Hard rules that touch this work: inside `db.transaction(async (tx) => …)` use only `tx` (the outer `db`
  deadlocks PGlite); raw-SQL writes so no `updated_at` moves; never `git commit`; another session is editing this
  repo (visual-novel layout work: dialogue-box widget, `show-line`, portraits) — never touch its files.

## Done means

`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` clean in your files (list any errors left and whose
files they are in). Passing in the capped scope: `oneUndoRule`, `annexChanges.keepOnRetell`, `rewind`, every
`branch*` (with the new F1 test), `setSeatBench`, `setSeatBench.announce`, `seatChangesOfTurn`, `rewindMirror`,
`sessionImprints.int`, your new undo test, `lorebooks/imprints.int`, `state/write*` touched. A failure that needs a
worker-4 file, report with its error.

## Report

Return as your final message: what changed per file (with line ranges), what was deleted, the `RetractedState`
shape as built, the branch fold as built, tests and counts, test files edited outside the owned list, **Noticed,
not done**.
