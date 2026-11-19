# BRIEF — worker `sc-1-w3`: a scene's Edit history on the wire (read, Restore), and the book's count, clear and Share

Repo `/home/jody/github/serene-pub` (app). Supervisor: lane `sc-1`. Owner ruling SC1 (2026-11-17): "Go: add a
scene as a subject of change history, and a cause for the compiler's writes" (as described to him: every change to
a scene's cast is kept; a person opens the history and brings a version back). B2: "hand edits aren't treated
differently. Just keep a change history so a user can overwrite."

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no sdk:build in this task.)

The repo is staged by the lead: run **no git command that changes the index or the working tree**. Never run
prettier with `--write` or pipe its output into a file. Never run `db:generate` or touch `drizzle/`.

## What exists (read it; do not change it)

- `lore_redlines.scene_id` (FK `scenes`, cascade; `drizzle/0170_scene_redlines.sql`); cause `scene-compiler`.
  A scene row's `changes` is `{ participantCharacters?: { before: { v: number[] }, after: { v: number[] } },
  mentionedCharacters?: … }`: member (`lorebook_bindings`) ids, in stored order, only the roles that changed.
- `recordRedline` / `keepNewest` take `{ sceneId }` (`src/lib/server/lorebooks/redlines.ts`); `writeSceneCast`
  records (`src/lib/server/utils/sceneCast.ts`).
- **Being written right now by worker w2** (do not edit; assume it): `saveSceneSummary` in
  `src/lib/server/sockets/scenes.ts` gains `cause?: "save" | "restore"` on its input (default `"save"`), passed to
  its cast write. If it is not there yet when you type-check, write your call as if it were and say so; do not add it
  yourself.
- The entry and version history wire: `src/lib/server/sockets/redlines.ts` (`whoReader`, `buildRedlines`,
  `entryRestoreRedlineHandler`, `buildVersionRedlines`, `registerRedlineHandlers`).

## Goal

1. **Scope, count, clear** (`src/lib/server/lorebooks/redlines.ts`): `scopeWhere`'s lorebook scope (~561–576) adds a
   third subquery `inArray(T.sceneId, sql\`(select ${schema.scenes.id} from ${schema.scenes} where ${schema.scenes.lorebookId} = ${scope.lorebookId})\`)`;
   update its and `RedlineScope`'s comments (a lorebook's rows: its entries', cast versions' and scenes'). This makes
   Share as a lorebook (`lorebooks/ownBook.ts` ~1296, no edit there) and Book settings' count and clear
   (`entries:redlineCount` / `entries:clearRedlines` with `lorebookId`) include scene rows.
2. **The registry** (`src/lib/server/lorebooks/tableRegistry.ts` ~667–681; a shared file another lane finished in
   an hour ago: re-read it right before editing, touch only this entry): the `loreRedlines` entry's `purge` and
   `count` also take scene rows (`sceneIdsOf(lorebookId)` exists in that file): `entry_id IN … OR scene_id IN …`.
   Comment and `notCopied`: "edit history never travels" (entries' and scenes').
3. **Reading a scene's history** (`src/lib/server/sockets/redlines.ts`): new request **`scenes:redlines`**
   `{ sceneId }` → `{ sceneId, lorebookId, canRestore, redlines: RedlineView[] }`, newest first, rows
   `where scene_id = sceneId`.
   - **Access = whoever may edit the scene**: the scene's lorebook passes `findOwnedBook(db, userId, lorebookId)`
     (write access); otherwise refuse with `"Scene not found or access denied."` (the string `saveSceneSummary`
     uses). `canRestore` = `!(await primerRowEditProblem(db, lorebookId))`.
   - Each row: `who` from `whoReader` (a compiler row reads "By itself, from ‹session›"), `cause`, `mine`, `at`,
     `amendmentId: null`, `version: null`, and `changes` with labels **"Present"** (`participantCharacters`) and
     **"Mentioned"** (`mentionedCharacters`) — the scene form's own labels — and `before` / `after` as **arrays of
     names**, never ids: one read of `lorebook_bindings` (`id`, `name`, `binding`) for every id on the page, scoped to
     the scene's lorebook, shown as `name || binding`; an id with no member there reads
     **"a cast member no longer in this lorebook"** (🚧 copy). `wasAbsent` / `nowAbsent` as the entry reader sets them.
4. **Restore** (`src/lib/server/sockets/redlines.ts`): new request **`scenes:restoreRedline`** `{ redlineId }`.
   - The row must have `scene_id` (else `"That edit is no longer kept."`, the existing `NOT_KEPT`); same access as
     reading.
   - Build the cast to write: for each role the row holds, its `before.v`; for a role it does not hold, the scene's
     **current** list (`readSceneCast`), so a restore of participants keeps the mentioned list and vice versa.
   - Write it **through the person's save path**: `saveSceneSummary({ by: "person", userId, params: { scene: { id,
     participantCharacters, mentionedCharacters } }, io: socket.io, emitToUser, cause: "restore" })` (import
     `./scenes` at call time, as `entryRestoreRedlineHandler` imports `./entries`). That path drops ids no longer in the
     lorebook (`filterCharacterIdsToLorebook`), applies the lore-writes-Off and primer refusals, and records the
     restore itself (cause `restore`) — add no check of your own that duplicates them.
   - Then emit `scenes:update` with `{ scene }` (the saved scene, as `sceneUpdateHandler` replies; no `requestId`)
     so open lorebook views patch the row, then `scenes:restoreRedline` `{ redlineId, sceneId, lorebookId }`, then
     the fresh `scenes:redlines` list. Return the restore reply.
   - Both handlers use `refusable(…)` with the fallback sentences the entry handlers use and an echo of the param.
   - Register both in `registerRedlineHandlers`; update the file's header comment (a scene's history; no per-scene
     clear: the book's clear covers it).
5. **Wire declarations** (each a shared file: re-read right before editing; add only):
   - `src/lib/shared/sockets/types.ts`: in `namespace Scenes` (~15595) add `Redlines` and `RestoreRedline`
     (Params / Response / ErrorResponse, documented like `CharacterVersions.Redlines`); the `RedlineView` comment says
     four subjects.
   - `src/lib/shared/sockets/interest.ts`: scope entries `["scenes:redlines", (p) => p?.lorebookId]` and
     `["scenes:restoreRedline", (p) => p?.lorebookId]` beside the version ones (~306), and both names in the consumer
     list (~994) with a "🚧 Consumer: client/lorebooks/ (the scene's Edit history, through `awaitReply`)" line.
     CLAUDE.md: "An event in `SCOPED_EVENTS` must carry its scope key (`sessionId`, `lorebookId`…) in the payload, or
     `emitToUser` silently sends nothing." — every reply of both events carries `lorebookId` top-level.
   - `src/lib/client/sockets/typedSocket.ts`: the four entries (`scenes:redlines`, `:error`, `scenes:restoreRedline`,
     `:error`) beside the version ones (~4442).
6. **The column guard** (`src/lib/server/sockets/lorebooks.roundTrip.int.test.ts`, lane io-1's guard): classify
   `lore_redlines.sceneId` in every map that lists `lore_redlines` columns (~245, ~591, ~2350) the way
   `characterVersionId` / `entryId` are classified, read what each map means first; make the row label (~1003) name a
   scene row; add one scene redline row to the seeded book (~2024) so the guard sees one; and assert that importing the
   file records no scene row (history is not exported: the file carries none). Keep the existing allowances
   (`D_EDIT_HISTORY`) working.

## Files owned

`src/lib/server/lorebooks/redlines.ts` (`scopeWhere` and comments only), `src/lib/server/lorebooks/tableRegistry.ts`
(the `loreRedlines` entry only), `src/lib/server/sockets/redlines.ts`, `src/lib/shared/sockets/types.ts` (additions
above), `src/lib/shared/sockets/interest.ts` (additions above), `src/lib/client/sockets/typedSocket.ts` (additions
above), `src/lib/server/sockets/lorebooks.roundTrip.int.test.ts`, and new test
`src/lib/server/sockets/scenes.redlines.int.test.ts`.

Worker w2 is editing at the same time: `scenes/liveScenes.ts`, `sockets/scenes.ts`, `sockets/narrativeGraph.apply.ts`,
`scenes/liveScenes.castRule.int.test.ts` and its own new tests. Never touch those. Live lane `gs-3a3b-2` owns
`sessions/seats.ts`, `sessions/seatKeys.ts`, `sessions/guestSeats.ts`, `sockets/sessions.update.ts`, `state/write.ts`,
`lorebooks/entryKnowledge.ts`, `pipelines/runtime/bindings.outlets.ts`: never touch them. No client component work.

## Rules you work under (quoted)

- CLAUDE.md Sockets ruling: "one domain context per event family … is the only listener, and the only place that
  toasts; views register listeners for local state and never call `toaster`." (server side: replies only, nothing
  pushed beyond what is listed.)
- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx`."
- Cold review: "Restore must survive ids that no longer exist: send Restore through the `scenes:update` save path …
  pass the stored mentioned list along … On the read side resolve ids to names … an id whose member is gone shows as
  a member no longer in the lorebook."
- `whoReader` names a session only to someone who may open it; never send a run id, a model or a connection.
- Comments state the rule, never history (no "was", "used to", "now", "previously", dates, lane names).
  `src/lib/shared/conformance/commentHistory.test.ts` enforces it.

## Tests (Done means)

- `scenes.redlines.int.test.ts` (drive handlers as `sockets/entries.redlines.int.test.ts` and
  `sockets/characterVersions.redlines.int.test.ts` do): the list shows names, "Present"/"Mentioned", a compiler row's
  `who` "By itself, from ‹session name›", newest first; a gone member's id reads "a cast member no longer in this
  lorebook"; a person who may not edit the scene's lorebook is refused reading and restoring (a shared reader and a
  stranger); Restore brings the earlier participants back, keeps the mentioned list, drops an id whose member was
  deleted, records one `restore` row, and replies with `lorebookId`; Restore on a lore-writes-Off session's scene is
  refused with that sentence; `entries:redlineCount` / `entries:clearRedlines` with `lorebookId` count and clear scene
  rows; Share as a lorebook clears them (if an existing test drives Share cheaply; otherwise call `clearRedlines` with
  the lorebook scope and say so).
- Also run: `src/lib/server/sockets/lorebooks.roundTrip.int.test.ts`, `src/lib/server/sockets/entries.redlines.int.test.ts`,
  `src/lib/server/sockets/characterVersions.redlines.int.test.ts`, `src/lib/server/sockets/lorebooks.duplicate.int.test.ts`,
  `src/lib/shared/sockets/scopedReplies.test.ts`, `src/lib/shared/sockets/gatedEvents.test.ts`,
  `src/lib/shared/conformance/socketEgress.test.ts`, `src/lib/shared/conformance/commentHistory.test.ts`.

How to run tests: first `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`, then exactly
`cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/sc-1-w3-<n>.log 2>&1"`
(always at least one path; one run at a time; never pipe vitest into `head`). An int test that opens a DB inside an
`it` needs a 60 s timeout under load. Type check: `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . 2>&1 | grep -E "redlines|tableRegistry|types.ts|interest.ts|typedSocket|roundTrip"`.

## Stop and ask when

a name beyond `scenes:redlines`, `scenes:restoreRedline`, `Sockets.Scenes.Redlines`, `Sockets.Scenes.RestoreRedline`
seems needed; Restore cannot go through `saveSceneSummary` as described; the column guard needs a classification you
cannot justify from its own definitions; a test outside your files fails because of your change.

## Report

Your final message: changed files; the two requests' shapes; how access and `canRestore` are decided; how names are
resolved; what Restore writes and emits; the guard's classification of `sceneId`; tests run with pass/fail counts;
Noticed, not done.
