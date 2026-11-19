# BRIEF — worker `el-1a-w3` — the scene lock: no run writes a locked scene's notes, summary, name or cast; its door

App repo `/home/jody/github/serene-pub`. SDK repo is read-only. Supervisor: lane `el-1a`. Report: your final message
(under ~600 words) — changed files with the line of each check, tests run with results, every new sentence you
wrote, Noticed-not-done.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build` at all.)

## Rules you work under (quoted from CLAUDE.md and the lane brief)

- The repo is staged by the lead: run **no git command that changes the index or the working tree**. Never run
  prettier with `--write` and never pipe its output into a file. No migration, no schema change (done: column
  `scenes.scene_lock`, TS `sceneLock`, boolean default false, migration 0169).
- "Inside `db.transaction(async (tx) => …)` use only `tx`."
- "Sockets: … An event in `SCOPED_EVENTS` must carry its scope key (`sessionId`, `lorebookId`…) in the payload, or
  `emitToUser` silently sends nothing." Views never toast.
- Comments state the rule, never history. Run `src/lib/shared/conformance/commentHistory.test.ts` before you finish.
- Tests only as
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/el-1a-w3-<n>.log 2>&1"`
  (always at least one path), one at a time, each after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`
  (other lanes share vitest; waits can be long). Never pipe vitest into `head`. 60 s timeout on an `it` that opens a DB.
  `NODE_OPTIONS=--max-old-space-size=10240` for `npx tsc --noEmit -p .` (once, at the end).
- Another worker (`el-1a-w2`) edits `pipelines/runtime/host.ts`, `lorebooks/ownBook.ts`, `lorebooks/imprints.ts` at the
  same time: never edit those. `shared/sockets/types.ts` is shared with other lanes: re-read right before the edit and
  change only your line. Re-read any file right before each edit.

## The rule (owner, ruled EL1, 2026-11-17; the lane brief)

"A manual lock to all entry types so pipelines can't make edits to individual locked entries" — scenes are one of the
lorebook's kinds (`docs/lorebooks.md:56`), so a scene row gets its own lock (`sceneLock`). While it is true **no run**
writes the scene: the run's note (`core:outlet/note-scene@1`), the scene summaries routine's summary and the model's
name for it, the summaries that start by themselves (summary mode *On close*, Close out's), and the scene's cast as
the code derives it from the lines (`writeProposedCast`: open, close, move, merge, the open scene's refresh). **Not
stopped:** a person's own edit of the scene (`scenes:update` by a person: name, summary, cast), a person's
**Summarize** press and the review they save, scene boundaries (open, close, move, merge — a close by the boundary
watcher still lands, so closing never fails; only the cast it would derive is left as it is), Compile. Read the lock
only through `sceneLockedAgainstRuns(row)` (`src/lib/shared/lorebooks/runLocks.ts`) and word a run's note with
`RUN_LOCK_SENTENCES.scene(name)` (the scene's shown name; `sceneDisplayNames` in `scenes/liveScenes.ts`, called on the
locked path only). From the cold review, verbatim: "**A refused write never halts the reply.** … a write to a locked
row returns `written: false` and one note naming the row; it never throws `HostScopeError` or `StateRefusal` and never
rolls back the step's transaction." No extra statement on a reply: read the lock from a row the code already selects
(add `sceneLock` to an existing column list rather than a new select).

## Build

1. `src/lib/server/scenes/liveScenes.ts`
   - `appendSceneNote` (~1878): add `sceneLock` (and what the name needs) to both existing selects; locked → write
     nothing and return `{ sceneId, notes: <the stored notes>, lockedNote: RUN_LOCK_SENTENCES.scene(<shown name>) }`.
     New return type `Promise<{ sceneId: number; notes: NonNullable<SceneRow["notes"]>; lockedNote?: string }>` —
     worker w2 codes the host outlet against exactly this; do not edit `host.ts`.
   - `writeProposedCast` (~1286): locked `scene` → write nothing (no `scene_characters`, no `castResolvedAt`) and return
     `null`; its three callers (`proposeAndWriteCast` ~1250 → `[]`; the two refreshes ~1372 and ~1463 → `false`, so
     nothing reports a moved cast). Make sure each caller passes a row selected whole after the write it follows (the
     `closed` row from `closeWithin` is, via `.returning()`).
2. `src/lib/server/sockets/scenes.ts`
   - `startRoutineSceneSummary` (~3005): after the scene is loaded, locked → `{ started: false, note: <scene sentence> }`.
   - `summarizeOnClose` (~3052) and Close out's summaries (`sockets/sessionArchive.ts:65`, `runSceneSummaries(… { via })`):
     leave locked scenes out (one select of the closed ids' locks there is fine: it runs on a close, not a reply).
     `scenes:processAll` and `scenes:process` are a person's presses: untouched.
   - `saveSceneSummary` routine branch (~810): the guarded update also requires `scene_lock = false`; when it lands
     nothing because the scene is locked, the returned `note` is the scene sentence (not the "summary changed" one).
   - **The door** (prefer the existing update door over a new event): `Sockets.Scenes.Update.Params.scene` gains
     `sceneLock?: boolean` (`src/lib/shared/sockets/types.ts`; also the `typedSocket.ts` map only if it restates the
     shape). In `saveSceneSummary` by a person: take `sceneLock` from the allowlisted params (the explicit
     destructure ~650) and write it with the rest; same access as any edit (`findOwnedBook`, `primerRowEditProblem`).
     An update that carries **only** `sceneLock` (with `id`) is not a lore write: it skips the lore-writes-Off refusal,
     writes no summary, no apply, no settle, no Edit history; it changes no name. The reply and `scenes:list` /
     `scenes:listByLorebook` rows carry `sceneLock` (check the list builders `buildSceneListFull` ~221 and the
     `listByLorebook` handler ~1136 select it or the whole row; add it to their wire `Item` types if they list fields).
     Locking or unlocking writes no history row.

## Tests

New file `src/lib/server/scenes/sceneLock.int.test.ts` (patterns: `scenes/sceneNotes.int.test.ts`,
`scenes/liveScenes.castRule.int.test.ts`, `scenes/liveScenes.routineSummary.int.test.ts`,
`sockets/scenes*.int.test.ts` for the socket):
- `appendSceneNote` on a locked scene: notes unchanged, `lockedNote` names it, no throw; unlocked: appended.
- The open scene locked: a line that would add someone to its cast leaves `scene_characters` as it was; the boundary
  watcher's / a person's close of a locked open scene closes it (no throw) and leaves its cast.
- `startRoutineSceneSummary` on a locked scene: `{ started: false, note }`, status stays `none`; the routine save on a
  scene locked while running lands nothing and returns the scene sentence.
- On close: a locked scene is not summarized by itself; a person's `scenes:update` with a summary and cast on a locked
  scene saves them.
- `scenes:update` with `{ id, sceneLock: true }` by the lorebook's owner sets it (and `false` clears it), even with lore
  writes Off; by someone else it is refused as any edit is; the list row carries `sceneLock`.
Then the existing files you touched the code of: `scenes/sceneNotes.int.test.ts`, `scenes/liveScenes.castRule.int.test.ts`,
`scenes/liveScenes.castMembers.int.test.ts`, `scenes/liveScenes.routineSummary.int.test.ts`,
`scenes/sceneBoundaries.int.test.ts`, the `sockets/scenes*.int.test.ts` files that cover update and the routine, the
close-out test (find it: `sessionArchive*` / `closeOut*`), and `src/lib/shared/conformance/commentHistory.test.ts`.

## Files owned

`src/lib/server/scenes/liveScenes.ts` (the two functions and their three callers only), `src/lib/server/sockets/scenes.ts`
(the four places above and the list rows), `src/lib/server/sockets/sessionArchive.ts` (the one filter),
`src/lib/shared/sockets/types.ts` (the `Scenes.Update` / scene list item lines only), `src/lib/client/sockets/typedSocket.ts`
(only if needed for the type), the new test file.

## Out of scope

Entries (w2), the host outlet, client components, docs, NOMENCLATURE, Back of a scene's notes or boundaries
(`takeSceneNotesAt`, `takeSceneBoundariesAt`: untouched), graph-build Apply.

## Stop and ask (in your report) when

A run's write to a scene cannot be told from a person's at the writer; a check needs a new statement on every reply;
closing a locked scene would have to fail; a check belongs in a file not listed here.

## Done means

The new file and every existing file named above green; `tsc` 0 errors in your files.
