# BRIEF — lane `sense-b2`, worker w2 — wire Apply to its sockets and to the moments it happens by itself

You are a `lane-worker` under the `sense-b2` supervisor, in `/home/jody/github/serene-pub`. Worker w1 has built the
server domain in `src/lib/server/lorebooks/ownBook.ts` (read it, do not edit it); worker w3 has built the client card.
You wire the two together: the sockets, the room push after every Apply and take-back, and the calls at the moments
held changes apply by themselves.

## Verbatim rules (bind you word for word)

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You need none.)
- Never `git checkout` / `restore` / `stash` in either repo. Never `kill -9`. Never `prettier --write` a directory (and not on these large files either: they are not prettier-clean at HEAD; keep your own lines in their style). No migration, no schema change. Inside `db.transaction(async (tx) => …)` use only `tx`. `socket.off(event)` always with its handler. It is a **session**, never a *chat*. Every session has a lorebook. No reference to any other project or product.
- **Sockets ruling (CLAUDE.md):** "one domain context per event family (provided by both shells) is the only listener, and the only place that toasts; views register listeners for local state and never call `toaster`. An event in `SCOPED_EVENTS` must carry its scope key (`sessionId`, `lorebookId`…) in the payload, or `emitToUser` silently sends nothing." `sessions:overlayItems` and `sessions:appliedBatches` are now in `SCOPED_EVENTS` (scope `sessionId`) and in `GATED_EVENTS`; so is `sessions:takeBackApply` (gated, not scoped). Every payload you send on them carries `sessionId`.
- Tests only like this, never the whole suite, never piped into `head`: `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files>"`. An int test that opens a DB inside an `it` needs a 60 s timeout. Typecheck: `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` (only errors in your files count; other sessions are editing). `npx prettier --check` on new files.
- Do what is asked, at the size asked. Findings go under **Noticed, not done**. Re-read the cited lines before changing anything.

## Files owned

- `src/lib/server/sockets/sessions.ts` — only the overlay handlers (~8105–8180: `sessionsOverlayItemsHandler`, `sessionsApplyOverlayHandler`), the two new handlers and their registration in `registerSessionHandlers`, and two new exported helpers (below).
- `src/lib/server/scenes/liveScenes.ts` — only one after-commit call at each of the two close sites (`openScene` after `noteScene(… opened: false …)` ~1467; `closeScene` after its `noteScene` ~1548).
- `src/lib/server/sockets/scenes.ts` — only `sceneUpdateHandler`'s after-commit call (~760–815), and the summary's release paths: `setSummaryStatus` inside the `scenes:process` handler (~1810) and the `activityStore.setSceneReviewDiscarded` callback (~2266).
- `src/lib/server/sockets/sessionArchive.ts` — `closeOutSession`'s call and its place, an optional `io` in its options, and its two callers in this file passing `socket.io`.
- Tests: new `src/lib/server/sockets/sessions.applyLists.int.test.ts`, new `src/lib/server/scenes/liveScenes.autoApply.int.test.ts`, and `src/lib/server/sockets/sessions.closeOut.int.test.ts` (extend).

Not yours: `ownBook.ts`, `settle.ts`, `types.ts`, `interest.ts`, `typedSocket.ts`, any client file, `boundaryWatcher.ts`, `pipelines/runtime/host.ts`, `state/write.ts`. If you need one, stop and report.

## Files readable

`src/lib/server/lorebooks/ownBook.ts`: `applyOverlayItems` (returns `ApplyOverlayResult`: `lorebookId, applied,
appliedChanges, stillHeld, batch, dropped, settled`; `settled` is `settleThrough`'s result or null — the caller must
announce it after commit), `takeBackApply(db, { batch, userId, sessionId? })` (throws `OwnBookRefusal` with a
sentence), `applyHeldAutomatically(db, { sessionId, automatic, sceneId? })` (never throws; null when it ran nothing;
else the result plus `userId`, the session's owner), `appliedBatchesOf(db, sessionId)`, `overlayAccessOf(db,
sessionId, userId)` → `{ mayApply, appliesItself }`. `src/lib/server/sessions/settle.ts` `announceHistorySettled`
(takes `io`; re-sends the session to its members when `io` is given, so Back's state follows). `src/lib/shared/
sockets/types.ts` (`Sockets.Sessions.OverlayItems`, `AppliedBatches`, `TakeBackApply` — the wire you must send).
`src/lib/server/sockets/sessions.ts` 740–760 (`relistSessionMembers`: the per-member push with
`emitToUserRedacted` and `getSessionUserIds`), 6240–6280 (`pushSessionToParticipants`). `src/lib/server/launcher/
controlRoutes.ts` 190–205 (reading the one Socket.IO server off `globalThis.__SERENE_PUB_SOCKET_STATE__` without
importing `loadSockets.server.ts` — the precedent for a caller with no socket). `src/lib/server/scenes/
boundaryWatcher.ts` 558–790 and 878–945 (the watcher closes scenes through `openScene`, with no `io` to pass).
`src/lib/server/scenes/summaryStatus.ts` (`restoreDiscardedReview` returns whether a row moved).
`src/lib/server/sockets/scenes.ts` 600–815 (`sceneUpdateHandler`: `applied` is true when this save made the summary
`done`), 1740–1900 and 2070–2200 (`scenes:process`: `setSummaryStatus`, `failRun`, the cancel and catch paths).

## The owner's rules (quoted by the supervisor)

- When held changes apply by themselves (owner, 2026-11-12): "At scene close, unless a summary waits" — "Changes apply when a scene closes. If that scene's summary is being written or is waiting for your review, they apply when you save it instead. Default play stays seamless; a reviewed summary still gates its scene." (The waiting test is inside `applyHeldAutomatically`; you call it at the right moments.)
- Close out (`closeOutSession`, which also serves Archive and the next chapter): apply **before** its `notRegistered` / `busy` / `nothing` early returns; only `missing` and `notOwner` stop it.
- It runs after the triggering commit, never with the outer `db` inside another transaction, and **its failure never fails the trigger**.
- P1: every automatic action shows its cause and how to undo it — the room push is what makes the card show it.
- One access rule: both lists are readable by every member of the session (as `sessions:overlayItems` is today); Apply and Take back are the lorebook owner's only, and the list payloads carry `mayApply`.

## Build

1. **`export async function tellApplyMoved(io: unknown, sessionId: number): Promise<void>`** in `sockets/sessions.ts`.
   Never throws. Resolve the server: the `io` given, else `globalThis.__SERENE_PUB_SOCKET_STATE__?.io` (the
   controlRoutes precedent; nothing when neither). Build the items (`overlayItemsOf`) and batches
   (`appliedBatchesOf`) once; then for every user of the session (`getSessionUserIds`) send each their own
   `sessions:overlayItems` `{ sessionId, items, mayApply, appliesItself }` and `sessions:appliedBatches`
   `{ sessionId, batches, mayApply }` with `emitToUserRedacted`, access from `overlayAccessOf(…, uid)`.
2. **`export async function applyHeldAutomaticallyAndTell(handle: Db, input: { sessionId: number; automatic:
   AutomaticApplyCause; sceneId?: number; io?: unknown }): Promise<void>`** in `sockets/sessions.ts`. Never throws.
   `applyHeldAutomatically`; when it returns null, or nothing was applied and nothing dropped, stop. Otherwise, with
   the resolved server: `announceHistorySettled(handle, { sessionId, userId: result.userId, ...result.settled, io,
   cause: { kind: "system" } })` when `settled` is set, then `tellApplyMoved`.
3. **`sessions:overlayItems`**: add `mayApply` and `appliesItself` (`overlayAccessOf` for the asker).
4. **`sessions:applyOverlay`** (pressed): after `applyOverlayItems` returns (its transaction committed),
   `announceHistorySettled(db, { sessionId, userId, ...done.settled, io: socket.io })` when `settled` is set; keep
   its own response as it is; replace its `emitToUser("sessions:overlayItems", …)` with `tellApplyMoved(socket.io,
   sessionId)` so every member's card moves (the presser is a member).
5. **`sessions:appliedBatches`** (new, `refusable` like the overlay handler): refuse with the overlay handler's
   sentence when the asker is not in the session; answer `{ sessionId, batches, mayApply }` with `emitToUser`.
6. **`sessions:takeBackApply`** (new, `refusable`): `takeBackApply(db, { batch, userId, sessionId })`. An
   `OwnBookRefusal` is **not** an error: answer `{ sessionId, batch, refused: <its message> }` (the card says it in
   place; an `:error` would reach the shells' catch-all toast). Success: `{ sessionId, batch, refused: null }`, then
   `tellApplyMoved(socket.io, sessionId)`. The settle line is never touched (take-back leaves it). Validate `batch`
   is a non-empty string and `sessionId` an integer; anything else refuses as an error. Register both handlers where
   the overlay handlers are registered.
7. **Scene close** (`liveScenes.ts`): right after each `noteScene(… opened: false …)` — `openScene` closing the open
   scene, `closeScene` — `await` a guarded dynamic import of `$lib/server/sockets/sessions` and call
   `applyHeldAutomaticallyAndTell(db, { sessionId, automatic: "scene-close", sceneId: <the closed scene> })`. These
   run after the close's transaction committed (confirm). The boundary watcher's closes go through `openScene`, so
   they count. A scene filed already closed (`openScene` with `closeAt`, *Mark as scene*) emits no `scene-closed` and
   is not a trigger — say so in the report.
8. **Summary saved** (`sceneUpdateHandler`): after the commit (and after the existing announce block), when
   `applied` and the scene has a session: `applyHeldAutomaticallyAndTell(db, { sessionId, automatic:
   "scene-summary", sceneId, io: socket.io })`.
9. **The wait released** — decision taken by the supervisor: **apply then.** When a summary of a closed scene stops
   waiting without being saved — it **failed**, a person **cancelled** it (the status put back), or a person
   **dismissed / discarded** its review (`restoreDiscardedReview` returned true) — call
   `applyHeldAutomaticallyAndTell(db, { sessionId, automatic: "scene-close", sceneId, io })` (the function itself
   returns null for an open scene or one still waiting). In `setSummaryStatus`, after its write, for any status
   other than `running`, `review` and `done`; in the discard callback, after a moved row (read the scene's
   `sessionId`; no `io` there, the fallback serves). Never let it change what those paths return or throw.
10. **Close out** (`sessionArchive.ts`): `closeOutSession` takes an optional `io`; right after the `notOwner` return,
    `await applyHeldAutomaticallyAndTell(handle, { sessionId, automatic: "close-out", io: opts.io })`; the two
    callers in this file pass `socket.io`. (The next-chapter caller in `sockets/sessions.ts` ~1542 is not yours;
    it falls back to the global server — say so.)

## Done means — tests that fail before and pass after

`sessions.applyLists.int.test.ts` (drive the handlers' `.handler(socket, params, emitToUser)` with a fake socket
whose `io` records emits — find a fake-io pattern in an existing `src/lib/server/sockets/*.int.test.ts` first):
the lists' access rules — a member reads both with `mayApply: false`, the lorebook owner with `mayApply: true`,
someone outside the session is refused, `appliesItself` true only under Full for the owner's own session; a
member's take-back answers `refused` with the owner-only sentence and changes nothing; the owner's take-back answers
`refused: null` and both lists reach a second member; a pressed Apply announces `history-settled` (or moves
`settled_message_id`) and both lists reach a second member; **a second member's lists refresh after an automatic
Apply** (`applyHeldAutomaticallyAndTell` with a fake `io`).

`liveScenes.autoApply.int.test.ts`: automatic Apply on a scene closed by a person (`closeScene`), by `openScene`
closing the open scene, and by the boundary watcher in Automatic mode (`watchSceneBoundaries` or
`followEndedScene` — whichever closes a scene without a model); held while that scene's summary is `running` or in
`review`; applied when its summary is saved through `sceneUpdateHandler`; released and applied when the review is
dismissed (the discard callback) and when the summary fails; a failing automatic Apply leaves the scene closed and
saved (make the apply fail — say how — and assert the close still resolved and the scene row is closed); nothing for
a session whose lorebook mode in force is Review.

`sessions.closeOut.int.test.ts`: applied at Close out with nothing to close out (`nothing` refusal) and with no
close-out registration (`notRegistered`), not for `notOwner`.

Then run, capped, and report counts: your three files; `src/lib/server/lorebooks/heldApply.int.test.ts`,
`applyTakeBack.int.test.ts`, `autoApply.int.test.ts`; `src/lib/server/sessions/settle.int.test.ts`,
`src/lib/server/sessions/rewind.int.test.ts`, `src/lib/server/sockets/sessions.retraction.int.test.ts` (if it
exists; else find the retraction suite), `src/lib/server/state/heldAmendments.*.int.test.ts`; the scene suites
`src/lib/server/scenes/liveScenes.*.int.test.ts`, `src/lib/server/scenes/boundaryWatcher*.int.test.ts`,
`src/lib/server/sockets/scenes.*.int.test.ts` (in two or three batches if memory is tight);
`src/lib/shared/sockets/gatedEvents.test.ts`. A failure that is not caused by this lane (speech, visual-novel
layout, other sessions' files): report it with its first error line, do not fix it. `tsc` clean in your files.

## Stop and ask (in your report) when

Automatic Apply would have to run inside a scene handler's transaction; a scene can close on a path you cannot
reach from the owned files; you need a file not listed; a published SDK name or payload would change other than
additively. Do not decide those.

## Report

Your final message: changed files (with the line ranges you touched in the large ones); decisions inside scope;
any new sentence (there should be none) verbatim; tests run with counts and any failure not yours; **Noticed, not
done**.
