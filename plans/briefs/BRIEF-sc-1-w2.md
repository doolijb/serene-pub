# BRIEF — worker `sc-1-w2`: the writers of a scene's cast pass a `redline` (compiler, a person's save, graph Apply)

Repo `/home/jody/github/serene-pub` (app). Supervisor: lane `sc-1`. Owner ruling SC1 (2026-11-17): "Go: add a
scene as a subject of change history, and a cause for the compiler's writes". B2: "hand edits aren't treated
differently. Just keep a change history so a user can overwrite."

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no sdk:build in this task.)

The repo is staged by the lead: run **no git command that changes the index or the working tree**. Never run
prettier with `--write` or pipe its output into a file. Never run `db:generate` or touch `drizzle/`.

## What exists (done by worker w1; read it, do not change it)

- `lore_redlines.scene_id` (migration `drizzle/0170_scene_redlines.sql`), cause `scene-compiler` in
  `REDLINE_CAUSES` (`src/lib/server/lorebooks/redlines.ts`).
- `writeSceneCast(sceneId, cast, db?, redline?: SceneCastRedline)` in `src/lib/server/utils/sceneCast.ts`, with
  `SceneCastRedline = { by: RedlineAuthor; cause: RedlineCause; before?: Partial<SceneCast> }`. With `redline` it
  records one row when a written role's **sorted id set** changed (keys `participantCharacters` /
  `mentionedCharacters`), nothing otherwise. A role whose `before` the caller supplies is not read; otherwise the cast
  is read once on the same handle. Cost when it records: recordRedline's insert + `keepNewest`'s select (+ a delete
  once the scene holds more than 50 rows).
- `RedlineAuthor`: `{ userId, sessionId? }` (a person) · `{ run: {...} }` (a run) · `{ sessionId }` (made by
  itself; the reader shows it as "By itself, from ‹session›").

## Goal — recording happens only inside `writeSceneCast`; callers only pass the optional argument

1. **The compiler** (`src/lib/server/scenes/liveScenes.ts`; re-verify every line number):
   - `writeProposedCast` (~1294–1335) takes an optional `redline?: SceneCastRedline` and passes it to its
     `writeSceneCast` call (~1329). Nothing else in it changes.
   - `refreshOpenSceneCast` (~1401–1481) and `refreshFromTags` (~1344–1386) already hold `stored` (the stored
     participants): pass `{ by: { sessionId }, cause: "scene-compiler", before: { participantCharacters: stored } }`
     (their own session id) so no extra read happens.
   - `proposeAndWriteCast` (~1253–1261) takes an optional `redline` and passes it on. Its callers:
     ~2139 (the scene an opening closed) → pass `{ by: { sessionId: <that scene's session> }, cause: "scene-compiler" }`;
     ~2140 (the **new** scene's first write, live or filed as a range) → **pass nothing** (a new scene records nothing);
     ~2246 (close), ~2392 (move), ~2447 (merge) → pass `{ by: { sessionId }, cause: "scene-compiler" }`
     (no `before`: these recomputes do not hold the earlier cast, so `writeSceneCast` reads it once: one extra read
     per close / move / merge, never per line).
   - A locked scene: `writeProposedCast` already returns before writing; nothing to add.
2. **A person's save** (`src/lib/server/sockets/scenes.ts`, `saveSceneSummary` ~608): its input gains
   `cause?: "save" | "restore"` (default `"save"`; doc: "Why a person's write was made: their own save, or a Restore
   from the scene's Edit history."). The cast write in the transaction (~876–882) passes
   `{ by: { userId }, cause: input.cause ?? "save" }` on `tx`. `sceneUpdateHandler` passes nothing new (so `save`).
   **`scenes:create` (~514–520) passes no `redline`** (a new scene records nothing). The routine path writes no cast;
   leave it.
3. **The graph build's Apply** (`src/lib/server/sockets/narrativeGraph.apply.ts` ~1711) passes
   `{ by: { userId }, cause: "save" }` on `tx`, `userId` being the person whose Apply it is (read the handler for the
   variable; ~586).
4. **No edit** at: import (`sockets/lorebooks.ts` ~4468), the merge's undo (`sockets/narrativeGraph.merge.ts` ~1678),
   `repointSceneCast` (merge), `lorebooks/foldInParent.ts` (fold). Those are structural id remaps or a new scene and
   record nothing.

## Files owned

`src/lib/server/scenes/liveScenes.ts` (the cast functions and the five call sites above only),
`src/lib/server/sockets/scenes.ts` (`saveSceneSummary`'s input and its one cast write only),
`src/lib/server/sockets/narrativeGraph.apply.ts` (the one call only), `src/lib/server/scenes/liveScenes.castRule.int.test.ts`
(the ceilings), and new tests `src/lib/server/scenes/liveScenes.castRedlines.int.test.ts`,
`src/lib/server/sockets/scenes.castRedlines.int.test.ts`. Plus one added case in whichever existing graph-apply test
drives an Apply (`sockets/narrativeGraph.buildReadsStoredCast.int.test.ts` or
`sockets/narrativeGraph.reviewRoundTrip.int.test.ts`) and one in `sockets/narrativeGraph.absorb.int.test.ts` (a merge
records no scene row).

Another worker (w3) is editing at the same time: `lorebooks/redlines.ts`, `sockets/redlines.ts`,
`lorebooks/tableRegistry.ts`, `shared/sockets/types.ts`, `shared/sockets/interest.ts`, `client/sockets/typedSocket.ts`,
`sockets/lorebooks.roundTrip.int.test.ts`. Never touch those. Live lane `gs-3a3b-2` owns `sessions/seats.ts`,
`sessions/seatKeys.ts`, `sessions/guestSeats.ts`, `sockets/sessions.update.ts`, `state/write.ts`,
`lorebooks/entryKnowledge.ts`, `pipelines/runtime/bindings.outlets.ts`: never touch them.

## Rules you work under (quoted)

- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- Cold review (lane brief): "Record in the one low-level writer (P2) … No call-site recording." · "No row when
  nothing changed, and none for a new scene … Creating a scene, importing one, and the compiler's first write when a
  scene opens record nothing." · "Structural id remaps are exempt … None records a row (the cast did not change: its
  members' ids did)." · "A listed speaker's line stays ≤ 5."
- Comments state the rule, never history (no "was", "used to", "now", "previously", dates, lane names).
  `src/lib/shared/conformance/commentHistory.test.ts` enforces it.
- Do what is asked, at the size asked; findings go under Noticed, not done.

## Tests (Done means)

- `liveScenes.castRedlines.int.test.ts` (reuse `liveScenes.castRule.int.test.ts`'s world helpers by copying the few
  you need): opening a scene records nothing (live open, and a range filed with an end); a refresh that adds a new
  speaker records one row — cause `scene-compiler`, `user_id` null, `session_id` the session, `participantCharacters`
  before = the stored list, after = stored + the new member; a listed speaker's line records nothing; a narrator line
  tagging a new member records one row; a close whose recompute changes the set records one row, a close whose
  recompute yields the same members in another order records nothing; a move and a merge that change the set record
  one row each; a locked scene's refresh and close record nothing.
- `liveScenes.castRule.int.test.ts`: `LISTED_CEILING` stays 5; re-measure and re-pin `NEWCOMER_CEILING` (expected 51+2)
  and the narrator new-tag ceiling (53 → expected 55), with the comment saying what the two extra statements are; add
  one case pinning the eviction cost: a scene already holding 50 rows, a new speaker costs one more statement than
  without them. Report every number you measured.
- `scenes.castRedlines.int.test.ts`: `scenes:update` with a changed cast records one `save` row with `user_id`; the
  same members reordered, a rename only and a summary only record nothing; `scenes:create` with a cast records nothing;
  `saveSceneSummary({ …, cause: "restore" })` records a `restore` row. Drive the handlers as the existing
  `sockets/scenes.*.int.test.ts` files do.
- The graph Apply case (a changed participant list records one `save` row with the applier's id) and the absorb case
  (a merge leaves no `scene_id` row).
- Also run: `src/lib/server/scenes/liveScenes.castMembers.int.test.ts`, `src/lib/server/scenes/sceneLock.int.test.ts`,
  `src/lib/server/scenes/sceneBoundaries.int.test.ts`, `src/lib/server/sockets/scenes.reviewSeed.int.test.ts`,
  the two prompt baselines `src/lib/server/pipelines/runtime/unknownEntries.reply.int.test.ts` and
  `src/lib/server/sockets/sessions.lairUnknownEntries.int.test.ts` (must pass unchanged: they open no scene),
  `src/lib/shared/conformance/commentHistory.test.ts`.

How to run tests: first `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`, then exactly
`cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/sc-1-w2-<n>.log 2>&1"`
(always at least one path; one run at a time; never pipe vitest into `head`). An int test that opens a DB inside an
`it` needs a 60 s timeout under load. Type check: `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . 2>&1 | grep -E "liveScenes|sockets/scenes|narrativeGraph"`.

## Stop and ask when

a writer of `scene_characters` not listed here turns up; recording would add a statement to a listed speaker's line;
a new name, setting or abstraction seems needed; a test outside your files fails because of your change.

## Report

Your final message: changed files; each call site and what it passes; the measured statement numbers (listed speaker;
new speaker; new narrator tag; with eviction; and the close's count if you measured it); tests run with pass/fail
counts; Noticed, not done.
