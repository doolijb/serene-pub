# BRIEF — lane `sense-st3`, worker 4 — every writer files session imprints; the annex changes per key

You are a `lane-worker` under the `sense-st3` supervisor. Repo: `/home/jody/github/serene-pub`. Use absolute paths.

## Where things stand (read first)

- `db/schema.ts`: the four runtime columns on `sessions` and the table `sessionImprints` (read its comment: the
  charter). `annex_deltas` is **gone** (migration `0155_chubby_lockjaw`, generated — never edit it, never run
  `db:generate`).
- `src/lib/server/sessions/sessionImprints.ts` — **read it whole**. You call `fileSessionImprint(tx, anchor, { kind,
  key }, before, after, annex?)` (no anchor message → files nothing; unchanged → nothing), `seatBenchKey`,
  `annexImprintKey`, `settleSessionImprints`, `sessionImprintsAfter`. Worker 3 is adding (same time, his file — do
  not edit it) `standingSeatBenches(db, sessionId): Promise<Map<string, boolean>>` — key `<kind>:<seatId>` →
  the newest standing `seat-bench` row's `after` value. Code against that signature.
- Worker 3 is working **at the same time** on `state/write.ts`, `messages/store.ts`, `sessions/retakeTurn.ts`,
  `sessions/rewind.ts`, `sessions/branch.ts`, `sessions/sessionImprints.ts` and their tests — never edit those. The
  retraction (`retractStateAnchoredTo`) will take every row you file by the one rule; Forward puts them back.

Rulings (owner, 2026-11-11, verbatim): "Move to columns (Recommended)" — "The annex becomes purely the modders'
home … Ruleset decks follow Back; turn order and read marks do not. Needs a migration and a boot pass." and "Yes,
a turn owns what it wrote". Amended design (`plans/DESIGN-st3-annex-and-runtime-2026-11-11.md`, the challenger
section wins), verbatim: "**Draws:** one row per write, not per turn; anchored with `turnAnchorOf` in every mode,
propose included (`rulesets/resolve.ts:1052-1058`), or a regenerated propose turn spends twice. When two turns draw
from one deck and the earlier is taken, the earlier turn's cards stay spent: the later card was dealt from the
position the earlier draw left." / "An annex write files one `session_imprints` row per changed key: kind `annex`,
key `<owner>/<key>`, before/after `{v}`, plus the audience before/after for that key. `annex_deltas` stops being
written." / "`annexAt` (a branch's annex as of the fork) folds per-key rows instead of whole documents." /
"`sockets/sessions.ts:5760-5772` ('fell in story': reads the newest standing `seat-bench` row)". / "The settle line
marks session imprint rows settled as it marks lore imprints." Brief, verbatim: "`annex-changed` may name the keys
that changed **only if** that is additive to its published payload; otherwise leave it and report." — **the
supervisor's decision: do not change `annex-changed` in this lane** (it would change an SDK shape and move pins);
report what it would take. "**No Clear button** in this lane."

## What to do

1. **`pipelines/runtime/host.ts`** (only these blocks):
   - `writeAnnexDocument` (~2376–2480): replace `recordAnnexDelta` with one `fileSessionImprint` per key whose value
     or audience changed between `previous` / `heldAudiences` and `next` / `nextAudiences` (the union of keys of
     both documents and both audience maps): kind `annex`, key `annexImprintKey(owner, k)`, before `previous[k]`,
     after `next[k]` (absent → `undefined`), `{ ownerVersion, audienceBefore: heldAudiences[k] ?? null,
     audienceAfter: nextAudiences[k] ?? null }`, anchor `{ sessionId, messageId: anchor?.messageId ?? null, runId:
     scope.runId ?? null }`. A key that never follows the story (`TIMELESS` in `annexChanges.ts`, today only
     `core` / `retake-quietly`) files no row: export one predicate from `annexChanges.ts` for it.
   - `core:outlet/set-seat-bench` (~9340–9410): replace the `seatBenches` list write with
     `fileSessionImprint(tx, { sessionId, messageId: anchor ?? null, runId: scope.runId ?? null }, { kind:
     "seat-bench", key: seatBenchKey(resolved.kind, resolved.seatId) }, !benched, benched)` when the bench moved a
     seat. Update the comment.
2. **`sessions/creationModes.ts`** (~280–354, its delta write): the same per-key filing as item 1.
3. **`sessions/convertRuleset.ts`** (~246–255): file `fileSessionImprint(t, { sessionId, messageId: anchor, runId:
   null or the run if it has one }, { kind: "ruleset-conversion", key: rulesetId }, cur, args.to)` instead of the
   `rulesetConversions` list; the version write stays. Update the comment.
4. **`rulesets/resolve.ts`** `writeDecks` and its call (~239–252, ~1049): inside the one transaction, read the
   current `ruleset_decks` under the lock, write the merge (as now), and file one `deck` row per key written —
   before the stored `DeckState` (or `undefined`), after the new — anchored to `turnAnchorOf(tx, sessionId,
   deps.turnMessageId ?? null)` **in every mode, propose included**, `runId: deps.runId ?? null`. Pass what
   `writeDecks` needs from its caller.
5. **`sessions/settle.ts`** (~266–270): the `annex_deltas` delete becomes `settleSessionImprints(tx, sessionId,
   line)`. Update the module comment where it names annex deltas.
6. **`sockets/sessions.ts`** ~5760–5772 only ("fell in story"): `fellOpen(kind, seatId)` reads
   `standingSeatBenches(db, sessionId).get(seatBenchKey(kind, seatId)) === true`.
7. **`sessions/annexChanges.ts`**: delete `recordAnnexDelta`, `retractAnnexDeltasAnchoredTo`, `restoreAnnexDeltas`,
   `landOwner`, `heldKeysOnly`, `laterDeltaStands`, `inMemberForm`, `withTimeless`, `AnnexDeltaTaken` and the
   `AnnexDeltaSide` re-export (keep `annexWithoutPoints`, `LEGACY_REVISION_POINTS_OWNER`, `TIMELESS` + the new
   predicate). `annexAt(db, sessionId, forkMessageId)` keeps its signature and folds per key: the current annex,
   then each `annex` row of `sessionImprintsAfter(db, sessionId, forkMessageId)` newest first sets
   `owner/key` back to `unwrap(before)` (removed when undefined; an owner whose document empties is removed);
   TIMELESS keys are never touched. Rewrite the header comment (lines 1–20) to the per-key truth.
8. **`sessions/seatKeys.ts`** (the boot pass and the fold-time rekey): the store `annex_deltas` becomes
   `annex_imprints` (rename in `SEAT_KEY_STORES`, the step, the report counts): for each `annex` session imprint row
   of the session, rekey `audience_before` / `audience_after` (every target, as audiences are) and, for key
   `core/dungeon-crawler-progress`, the `fates` keys inside `before.v` / `after.v`; write back only a changed row,
   raw SQL through `schema.sessionImprints` identifiers. Its candidate branch finds card-form refs in those
   columns. `rewind_taken`: a record's new `state.sessionImprints` (`[{ act, imprint, later? }]`) gets the same
   rekey for its `annex` imprints; the old `state.annexDeltas` handling stays (old records). Keep
   `rekeyDeltaSide` exported (worker 3 uses it). Update the header comment. Fix `seatKeys*.int.test.ts` to the new
   store (the `annex_deltas` cases become `annex_imprints` cases; the old assertion that a `turnOrder` inside a
   delta document is rekeyed goes, since runtime keys are no longer in any annex document — say so).
9. **`sessions/annexInspect.ts`**: confirm the Session data panel no longer lists runtime keys (they are no longer
   in the document); change nothing unless a reference to them remains.
10. **Tests:** `sessions/annexChanges.int.test.ts` and `sessions/annexChanges.memberForm.int.test.ts` rewritten to
    the per-key shape (never weakened: each case keeps its meaning); `sessions/settle.int.test.ts` (rows settled,
    `before` gone, not taken by Back); `sessions/convertRuleset.int.test.ts` (Back puts the version back via the
    row); `rulesets/resolve.int.test.ts` (a draw files one row per key written, in propose mode too, anchored to
    the turn); `pipelines/runtime/setSeatBench.int.test.ts` is worker 3's — leave it; the "fell in story" socket test
    (`sockets/sessions.benchedSeats.int.test.ts`) reads the row. Fixture/assertion edits in other test files are
    allowed; list each.

## Files owned (edit only these)

`src/lib/server/pipelines/runtime/host.ts` (the two blocks), `sessions/creationModes.ts`,
`sessions/convertRuleset.ts`, `rulesets/resolve.ts` (decks), `sessions/settle.ts`, `sockets/sessions.ts` (~5760
block), `sessions/annexChanges.ts`, `sessions/seatKeys.ts`, `sessions/annexInspect.ts` (only if needed), and the
tests in item 10. All under `src/lib/server/`.

## Files readable

Everything. Not yours: the files listed for worker 3 above, `db/schema.ts`, `drizzle/`, `db/dataUpgrades/`,
`lorebooks/imprints.ts`, docs, NOMENCLATURE, the SDK repo.

## Out of scope

The retraction and restore (worker 3); the lorebook annex write (`writeLorebookAnnexDocument`) and `lore_imprints`;
the user annex; a Clear button; `annex-changed`'s payload; the settle line's rule; docs.

## Stop and ask (in your report) when

A published SDK name or payload would change; a runtime key turns out to be read by a plugin-facing port; a name
beyond those given here is needed (the store name `annex_imprints` and the TIMELESS predicate are given).

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
- CLAUDE.md Hard rules that touch this work: inside `db.transaction(async (tx) => …)` use only `tx`; raw-SQL writes
  so no `updated_at` moves; the sockets rule — "one domain context per event family … is the only listener, and
  the only place that toasts"; never `git commit`; another session is editing this repo (visual-novel layout work:
  dialogue-box widget, `show-line`, portraits) — never touch its files.

## Done means

`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` clean in your files (list errors left and whose
files they are in). Passing in the capped scope: `annexChanges.int`, `annexChanges.memberForm`, every
`seatKeys*.int`, `settle.int`, `convertRuleset.int`, `resolve.int`, `sockets/sessions.benchedSeats.int`,
`sockets/sessions.creationModes.int`, `sockets/sessions.dungeonCrawler.int`. A failure that needs a worker-3 file
(retraction/restore), report with its error.

## Report

Return as your final message: every writer changed (file:line, before → after), what was deleted, the `annexAt`
fold as built, the seat-keys store as built, what naming keys on `annex-changed` would take, tests and counts, test
files edited outside the owned list, **Noticed, not done**.
