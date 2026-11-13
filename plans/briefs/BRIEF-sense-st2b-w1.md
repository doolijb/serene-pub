# BRIEF — lane `sense-st2b`, worker w1 — Part A: close the undo rule's review findings

You are a `lane-worker` for the supervisor of lane `sense-st2b`. Repo: `/home/jody/github/serene-pub`
(app); sibling SDK: `/home/jody/github/serene-pub-sdk`. Another worker (w2) is editing SDK files under
`core-catalog/src/shared/`, `genres/`, `seed/`, `sdk-tests/`, the app's `pipelines/routines/clockOwners.int.test.ts`,
`pipelines/boot/clauseChainRoundTrip.int.test.ts`, `docs/genre-lair.md`, `docs/lorebook-time.md`,
`guides/time.md` and `NOMENCLATURE.md` right now: never touch those. Another session is editing visual-novel
layout files: never touch anything outside your list.

**This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.**

## Re-read before changing anything

The line numbers below were read today; re-read them first. Read the owner's ruling words in
`plans/briefs/BRIEF-sense-st2b.md` Part A and the previous lane's report `plans/REPORT-sense-st2-2026-11-11.md`.

## Owner rulings (2026-11-11, verbatim choices)

- The round's clock move on a swipe: **"Keep the round's move on a swipe"** (★ST2-1 is ruled, no longer interim).
- The Dungeon Crawler's reveal: **"Follow the rule, change the copy"**.

## Tasks

### 1. A scene boundary goes with a turn only when nothing sits after it

`src/lib/server/state/write.ts` ~916 calls `takeSceneBoundariesAt(t, messageId)`
(`src/lib/server/scenes/liveScenes.ts` ~1970–2074) in both cases. A row regenerate accepts any row id
(`sockets/sessions.ts` ~9328) and a plugin's delete of an older row (`runtime/host.ts` ~9853) takes boundaries too,
so either can delete or reopen a scene that later lines already sit in.

**Rule (supervisor's wording of the brief):** in either case, a boundary at the row is taken only when **no later
live line of the session sits after the row in that scene's channel**; otherwise that scene stays exactly as it is
(no delete, no reopen, no close moved, no selection change). Back's newest-turn case behaves exactly as today.

Build it this way (the supervisor's design; do not invent another):

- `takeSceneBoundariesAt(tx, messageId, opts: { leavingWith?: readonly number[] } = {})`. Before acting on any
  scene in each of its three steps (opened at the row, closed at the row, selection holding the row), check whether
  a later line stays: a `schema.sessionMessages` row with the same `sessionId`, `channel` equal to the scene's
  `channel` (compare the way `lineBefore` does), `id > messageId`, `liveMessageWhere()` (already imported there),
  and `id` not in `leavingWith`. If one exists, `continue` past that scene: nothing touched, nothing pushed to
  `taken`. Put the check in one small private helper beside `lineBefore` (e.g. `laterLineStays`). In step 1, the
  "prior scene reopens" belongs to the removed scene, so it is skipped with it.
- `leavingWith` exists because several rows can leave together in one transaction, and the rows after the one being
  retracted that are leaving with it must not count as "later lines". Two callers need it:
  - **Back** (`sessions/rewind.ts` ~646, NOT your file: do not edit it) retracts a whole turn newest first, inside
    one transaction, with `retractStateAnchoredTo(t, id, "leaves")` and marks the rows rewound only after the
    loop. So in `state/write.ts`, keep a module-level `WeakMap<object, number[]>` keyed by the `db` handle passed
    to `retractStateAnchoredTo` (for Back that is the same transaction handle `t` on every call): on a
    `"leaves"` call, pass the ids already recorded for that handle as `leavingWith`, and after the take succeeds,
    record this `messageId` for that handle. `"replaced"` calls record nothing and pass nothing (the row stays).
    Document it in a short comment: rows that already left earlier in the same transaction (a turn leaving newest
    first) are not later lines; a handle used outside a transaction only ever lists rows its callers delete or
    rewind, so the list is harmless there.
  - **`deleteTurnYield`** (task 5) passes the other yield ids explicitly.
- The function's docblock (~1962–1969) is stale ("`retractStateAnchoredTo` with `scenes: 'take'`"): rewrite it to
  say it is called by `retractStateAnchoredTo` in both cases and by `deleteTurnYield`, and state the new rule.
- Update `retractStateAnchoredTo`'s docblock bullet on scene boundaries (~834–836) to state the rule in one sentence.

**Report, do not build:** whether a boundary a **person** set at a row (Start scene, Mark as scene, a selection,
via `sockets/scenes.ts` / `openScene` / `closeScene`) can be told from one a turn wrote, from what is stored on
`schema.scenes` (`db/schema.ts` ~4740–4840). The supervisor found no column that records who set it; confirm or
correct, in one or two sentences. Do not add a column or a second rule.

**Tests** (in `src/lib/server/sessions/oneUndoRule.int.test.ts`, new `describe`; use the real writers already used
there — `openScene`, the scene functions — and the existing fixture style):
- a regenerate (`retractStateAnchoredTo(db, olderId, "replaced")`) of an **older** row with a later live line on the
  same channel keeps a scene opened at it, unchanged (and the scene before it is not reopened);
- a delete (the delete outlet, or `"leaves"` + the store's delete as the host does) of an older row with later lines
  keeps the scene;
- the same two on the **newest** row take the scene (today's behaviour);
- Back of a whole turn (person line + reply, via `rewindTurn` as the file already does) with a scene opened at the
  turn's **first** row (the person's line) still takes the scene, and Forward puts it back.

### 2. A failed re-tell must not lose annex values

Read `src/lib/server/sessions/annexChanges.ts` ~186–331 (`retractAnnexDeltasAnchoredTo`, `restoreAnnexDeltas`),
`state/write.ts` `restoreRetractedState` (~1300–1460) and `utils/generationStatus.ts` ~229–270 (not your file).

The defect: after a swipe ("replaced") narrows or leaves the turn's delta rows that changed `keepOnRetell` keys, the
re-telling run writes its own delta rows (call them F) anchored to the same message, then fails. The failed run's
cleanup (`generationStatus.ts` ~244) and the inner call in `restoreRetractedState` (~1324) both retract
`"replaced"`, so F rows that touch kept keys stay. `restoreAnnexDeltas` then lands the newest row for the message,
which is an F row: the restore lands the failed run's values.

Fix (the supervisor's design: take the failed run's deltas fully first):
- In `retractAnnexDeltasAnchoredTo`, a row a replacement leaves **untouched** (it changed only kept keys: today the
  `if (!others.length) { remain.push(row.id); continue }` branch) is now also listed in the returned array as
  `{ row, reverted: false, kept: true }` — add `kept?: true` to `AnnexDeltaTaken` with a one-line doc ("left as it
  is: changed only kept keys; listed so a failed re-tell's restore can tell the swipe's rows from the re-tell's").
  It changes nothing in the table. Every consumer must ignore `kept` entries where they count changes:
  `retractStateAnchoredTo`'s `changed` (~962) and `takenSummaryOf`'s count (~1163). `restoreAnnexDeltas` upserting a
  kept row is a no-op and it is not `reverted`, so it is not landed by itself; confirm that by reading.
- `retractAnnexDeltasAnchoredTo` gains `opts.except?: readonly number[]`: delta ids it leaves alone entirely.
- In `restoreRetractedState`, right after the inner `retractStateAnchoredTo(db, taken.messageId, "replaced")`, take
  every remaining delta anchored to `taken.messageId` whose id is **not** among `taken.annexDeltas`' row ids, fully
  (no `keep`), in a `db.transaction`: those are the failed run's own rows (F). This must happen even when `taken`
  holds nothing else (move it before the early return, and fold its result into the returned "changed"). Then the
  existing restore puts the swipe's rows back and lands the newest of them, which is now the pre-swipe state.
- Update the docblocks you touch (`restoreRetractedState`, `retractAnnexDeltasAnchoredTo`, the module header if it
  describes this) in the file's plain style.
- `restoreRetractedState` is also Forward's (`rewind.ts` ~749, with Back's record, which never holds `kept`
  entries): make sure Forward is unchanged.

**Tests** (in `src/lib/server/sessions/annexChanges.keepOnRetell.int.test.ts`, which already has a fixture genre
with a `keepOnRetell` field; follow its style): a turn writes one delta changing a kept key K and a plain key X; a
swipe (`retractStateAnchoredTo(db, M, "replaced")`, keep the returned `taken`); the re-tell writes a delta changing K
and X again (as the host's `writeAnnexDocument` would: the document and `recordAnnexDelta`); the failed run's cleanup
(`retractStateAnchoredTo(db, M, "replaced")`, as `generationStatus.ts` does); then
`restoreRetractedState(db, taken)`. Assert every annex value (document and audiences) is exactly as before the swipe,
and the delta rows anchored to M are exactly the original turn's. A second case where the original turn's row changed
**only** K (the untouched row), with the same assertions. Keep the existing tests passing.

### 3. The reveal follows the rule (provisional 🚧 copy; list each string in your report)

`/home/jody/github/serene-pub-sdk/core-catalog/src/genres/dungeon-crawler/reveal.ts` ~111 and ~117: the two `en`
strings only (not the comment). Use exactly:
- ~111 description: `"Shows everyone the Planner's secret notes. Going Back past it hides them again."`
- ~117 confirm description: `"Everyone at the table reads the Planner's secret notes from now on: the goal, what is hidden and what the world will do next. Going Back past this hides them again."`

**Do this SDK edit first, before anything else**, and tell nobody to build: the supervisor runs the one
`sdk:build` at the end.

`docs/genre-dungeon-crawler.md` ~270–272 ("Revealing the planning notes"): stop saying it cannot be undone or taken
back; say instead that going **Back** past the reveal hides the notes again. Keep the rest of the paragraph. E.g.
"…they appear for everyone under **Planning notes**, and stay there; going **Back** past the reveal hides them
again." and "It asks first (_Reveal the planning notes?_): **Reveal** goes ahead, **Cancel** changes nothing."

### 4. The round's move on a replacement is ruled, not interim

- `/home/jody/github/serene-pub-sdk/guides/storage.md` ~74–76: delete "This is interim." Add one sentence to the
  same bullet for task 1's rule, e.g. "A scene boundary at a replaced or deleted line that later lines already sit
  in stays where it is." (provisional; list it).
- `docs/sessions.md` ~285: leave as it stands.
- `docs/stats-and-states.md:90`: "a reply's fixed tick" becomes "a round's move".
- ★ST2-1 comments **in your files only**: `state/write.ts` ~810–818 (say it is ruled: owner 2026-11-11 "Keep the
  round's move on a swipe"; drop "interim, open"), `sessions/oneUndoRule.int.test.ts` ~11. List, do not edit, every
  other ★ST2-1 you find (the supervisor knows of `state/clockMoves.ts` ~32, ~250, ~338;
  `sockets/sessions.ts` ~9325, ~9961; `pipelines/routines/roundTick.undo.int.test.ts` ~2).

### 5. `sessions/retakeTurn.ts` `deleteTurnYield` takes scene boundaries by the same rule

`deleteTurnYield` (~165) deletes a turn's yield in one transaction and today takes no scene boundaries. Inside its
transaction, before `deleteLegacyWhere`, newest first like the annex loop at ~221, call
`takeSceneBoundariesAt(t, id, { leavingWith: ids })` for each yield id (the smallest change; the yield rows leave
together so none of them counts as a later line). Edit only `deleteTurnYield`. Update its docblock with one clause.
Test: one case (in `oneUndoRule.int.test.ts`, or beside an existing `deleteTurnYield` test in a file you own) where a
scene opened at a yield row is taken; and one where a later live line on the channel outside the yield keeps it.
If building such a turn yield needs more fixture than a few lines, stop and report instead of building a big fixture.

### 6. Who wrote `utils/generationStatus.ts` ~249–268

Nothing to do: the supervisor established it (lane `bench-L4b`, worker w2). Do not edit that file.

## Files owned (edit only these)

- `src/lib/server/state/write.ts`
- `src/lib/server/scenes/liveScenes.ts` — `takeSceneBoundariesAt`, its docblock, and one new private helper only
- `src/lib/server/sessions/annexChanges.ts`
- `src/lib/server/sessions/retakeTurn.ts` — `deleteTurnYield` only
- `src/lib/server/sessions/oneUndoRule.int.test.ts`, `src/lib/server/sessions/annexChanges.keepOnRetell.int.test.ts`
- `docs/genre-dungeon-crawler.md`, `docs/stats-and-states.md`, `/home/jody/github/serene-pub-sdk/guides/storage.md`
- `/home/jody/github/serene-pub-sdk/core-catalog/src/genres/dungeon-crawler/reveal.ts` — the two strings only

## Out of scope

ST3 (annex per key, draws, runtime keys); `replyRoad.int.test.ts`; migrations; `sockets/sessions.ts`,
`runtime/host.ts`, `rewind.ts`, `clockMoves.ts`, `generationStatus.ts`; any new name a person sees. Findings go
under **Noticed, not done**.

## Stop and ask when

A migration, a schema change, a new published name or a new setting would be needed; the design above cannot work
for a reason in the code (say why, with file:line); a test needs a fixture far larger than a few dozen lines.

## Verbatim rules

- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You do not build at all in this brief.)
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

Also: w2 may run `npm run sdk:build`; before each vitest run check `pgrep -f "[n]pm run build --prefix"` and wait
if a build is live (its dist swap breaks a running test). Run from the app root.

## Done means

Run, from `/home/jody/github/serene-pub`, in the capped scope: `src/lib/server/sessions/oneUndoRule.int.test.ts`,
`src/lib/server/sessions/annexChanges.keepOnRetell.int.test.ts`, `src/lib/server/sessions/annexChanges.int.test.ts`,
`src/lib/server/pipelines/routines/roundTick.undo.int.test.ts`, and any existing test file that covers
`liveScenes` take/restore or `deleteTurnYield` (find them with grep; e.g. `scenes/liveScenes*.int.test.ts`,
`pipelines/runtime/setSeatBench.int.test.ts`) — all pass. Then
`cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` clean (report other
lanes' errors, if any, without fixing them).

## Report (your final message)

Changed files; the rule as built (one paragraph each for tasks 1, 2, 5); tests run with pass counts; the person-set
boundary finding; each provisional string verbatim; every ★ST2-1 left in files you do not own; **Noticed, not done**.
