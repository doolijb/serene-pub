# BRIEF playtest-A-w1 — Stop reaches an action on its way (item 1)

Lane `playtest-A`, worker 1. Supervisor reads your final message (your report); do not write a report file.
Work in `/home/jody/github/serene-pub`. Use absolute paths.

## Goal

Story's **Ask** (and Rest, Image, any action shaped the same) calls the model before it writes a row, so its run has
no live row. The page draws a **waiting row** for it (id −1, `metadata.pendingReplyRun = runId`,
`src/lib/client/components/sessionPage/pendingReply.ts`). Its Stops send `sessionMessages:cancel {id:-1}`, and
`runRegistry.cancelSession` (`src/lib/server/pipelines/runtime/runRegistry.ts`) skips an `action` run with no row on
purpose (an image render must survive a guest's Stop on a reply). The handler then still answers
"Cancelled 1 generating message(s)". Fix, in the smaller shape the lead accepted:

1. **Client — a waiting row's Stop stops its run by id.** The client already stops a run by id: `pipelines:cancelRun
   { runId }`. In `pendingReply.ts` add one exported helper `pendingReplyRunOf(row: { id: number; metadata?: unknown }):
   string | null` — the run id a waiting row stands for (`isPendingReplyRow(row)` and a non-empty string at
   `metadata[PENDING_REPLY_KEY]`), else null. Update the file's header comment: Stop on a waiting row is
   `pipelines:cancelRun { runId }` (the run it stands for), no longer the session's Stop.
   - `messageControls.svelte.ts` `handleAbortMessage` (~line 165): if `pendingReplyRunOf(msg)` gives a run id, emit
     `socket.emit("pipelines:cancelRun", { runId })` and return; otherwise the existing `sessionMessages:cancel`.
   - `turnFlow.svelte.ts` `handleAbortLastMessage` (~line 225): the same on `lastMessage`.
   - `pressRouting.svelte.ts` `stop` verb (~line 240): it already routes a named message through `handleAbortMessage`
     and an unnamed one through `handleAbortLastMessage`, and `messageById` reads `d.data.session`, which is the
     session **plus** the waiting rows (`sessionPageData.svelte.ts` `sessionView`). So it needs no change — confirm by
     reading, and change it only if you find it does not reach the two handlers above.
2. **Server — the session owner may also stop a run in their session** (★1a's default, named by the owner's go:
   "the person who pressed it and the session owner"). Anyone else is refused with the existing shape
   `{ ok: false, found: true, error: "Not your run." }`.
   - `runRegistry.ts`: add `export function runSessionOf(runId: string): number | undefined` (the session a registered
     run is in; undefined when none is registered or it has no session), and give `cancel` a third, optional argument
     `opts: { ownedSessionId?: number } = {}` — "the caller checked that `userId` owns this session". `allowed` is
     `handle.userId === userId || (opts.ownedSessionId !== undefined && handle.sessionId === opts.ownedSessionId)`.
     The stop still goes through the module's one `stop()` (one-source cancellation rule — never abort a controller
     directly). Update `cancel`'s doc comment and the file header's "a run can only be stopped by whoever started it"
     sentence to say: or by the session's owner. Do **not** change `cancelSession`.
   - `src/lib/server/sockets/pipelines.ts` `pipelinesCancelRun` (~line 5856) — **its access check only**: before calling
     `cancel`, `const sessionId = runSessionOf(params.runId)`; when defined, `(await checkSessionAccess(sessionId,
     userId)).isOwner` (already imported in that file, line 59) decides whether to pass `{ ownedSessionId: sessionId }`.
     Nothing else in that file changes.
3. **Server — `sessionMessages:cancel` stops claiming what it didn't do.** `src/lib/server/sockets/sessions.ts`
   `sessionMessagesCancelHandler` (~line 8973–9143), **that handler only**: keep `runRegistry.cancelSession(...)`'s
   return value (`stoppedRuns`), count the rows the fenced `updateLegacyWhere` actually released (`released`, the
   `if (updated)` branch). Answer `success` only when `released + stoppedRuns > 0`:
   `` success: `Stopped ${stoppedRuns} run(s) and released ${released} message(s)` ``; otherwise answer `{}` (no
   `success`, no `error` — a Stop that arrived late is not an error, as `pipelines:cancelRun`'s `found: false` isn't).
   Nothing on the client reads this string (checked: no listener), so this is a server diagnostic. Keep every other
   line of the handler, including the row scoping.
4. **Docs** `docs/genre-story.md`, section `## Actions` (line 66–68): add one new paragraph right after the long
   Actions paragraph (line 68), exactly:
   `**Stop** works on an action on its way as well as on a reply: pressed while **Ask**, **Rest** or **Image** is still thinking, it stops the action and nothing is posted. You can stop your own; the session's owner can stop anyone's.`

## Files owned (edit only these)

- `src/lib/client/components/sessionPage/pendingReply.ts`, `pendingReply.test.ts`
- `src/lib/client/components/sessionPage/messageControls.svelte.ts`, `turnFlow.svelte.ts`, `pressRouting.svelte.ts`
- `src/lib/server/pipelines/runtime/runRegistry.ts`, `runRegistry.test.ts`
- `src/lib/server/sockets/pipelines.ts` — the `pipelinesCancelRun` handler only
- `src/lib/server/sockets/sessions.ts` — the `sessionMessagesCancelHandler` only. Other lanes depend on this file;
  use precise Edit calls inside that handler, never rewrite or reformat the file.
- NEW `src/lib/server/sockets/pipelines.cancelRunAction.int.test.ts`
- `docs/genre-story.md` — the one paragraph above

## Files readable

Anything. Templates: `src/lib/server/sockets/sessions.fireCancelled.int.test.ts` (fires a probe action through
`sessionsFireActionHandler` with `runSpec` mocked — copy its setup), `src/lib/server/utils/replyRoad.int.test.ts:864-1110`
(Stop tests), `runRegistry.test.ts:329` (an image render survives a Stop on another reply — must still pass).
`src/lib/server/utils/sessionAccess.ts` (`checkSessionAccess` → `{ isOwner, isGuest, hasAccess }`; guests are
`schema.sessionGuests` rows).

## Out of scope (never build)

No `runId` on `Sockets.SessionMessages.Cancel.Params`; no `cancelRunInSession`; no change to `cancelSession`'s scoping;
no edit to `runtime/host.ts`, `story/ask.ts`, `SessionHostViews.svelte`, `RunProgressCard.svelte` (the hidden progress
card X stays hidden); no `docs/sessions.md`; no change to `shared/sockets/types.ts`. Anything else you find goes in your
report under **Noticed, not done**.

## Stop and ask (in your report, don't decide) when

A new name beyond `pendingReplyRunOf`, `runSessionOf` and `cancel`'s `ownedSessionId`; a user-visible string beyond the
docs paragraph above; a migration; a file outside Files owned; anything that would need the progress card or the SDK.

## Tests — Done means these are green

1. `runRegistry.test.ts` — add: an `action` run with no live row is stopped by `cancel(runId, userId)` (its signal
   aborted, `cancellation(handle)` reads `user:<id>`); `cancel` by another user with `{ ownedSessionId: S }` stops a
   run in session S; with `{ ownedSessionId: S }` a run in another session T is **not** stopped (`allowed: false`,
   signal not aborted); `runSessionOf` returns the session, and undefined for an unknown id; the existing `:329`
   image-render test still passes unchanged.
2. `pendingReply.test.ts` — add: `pendingReplyRunOf` of a waiting row from `pendingReplyRows` is its run id; of a
   server row (positive id, or no `pendingReplyRun`) is null.
3. NEW `pipelines.cancelRunAction.int.test.ts` (copy `sessions.fireCancelled.int.test.ts`'s mocks and setup: mocked
   `$lib/server/db` with `createTestDb`, mocked `runSpec`, a probe action registered for the session). The mocked
   `runSpec` behaves like Ask: it waits on the run's abort signal (the request carries `signal`; check
   `fireAction.ts:1029`) and returns a cancelled receipt when aborted, never writing a message. Cases:
   - the presser's `pipelinesCancelRun.handler(socket, { runId })` while the fire is pending → `{ ok: true, found: true }`,
     the fire answers `cancelled: true`, and the session has **zero** `sessionMessages` rows;
   - a guest (a `schema.sessionGuests` row) runs it (fire it as the guest if the fire handler lets a guest fire the probe;
     otherwise register the guest's run with `runRegistry.start({ runId, userId: guest, sessionId, kind: "action" })`
     and say which you did) → the **session owner**'s `pipelinesCancelRun` stops it (`ok: true`);
   - a third user (no access) → `{ ok: false, found: true, error: "Not your run." }` and the run is still running
     (signal not aborted); clean up after;
   - `sessionMessagesCancelHandler.handler(socket, { sessionId, id: -1 })` while that action run is pending and no row
     is generating → the answer has no `success` (and the action run is not stopped — `cancelSession`'s scoping).
   Every `it`/`test` that opens or writes the DB gets a 60 s timeout; `beforeAll` too.

Run (capped scope; never pipe vitest into `head`; never a full `npm test`, `npm run check` or project-wide `tsc`):

```
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run src/lib/server/pipelines/runtime/runRegistry.test.ts src/lib/client/components/sessionPage/pendingReply.test.ts src/lib/server/sockets/pipelines.cancelRunAction.int.test.ts src/lib/server/sockets/sessions.fireCancelled.int.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest-A-w1-1.log 2>&1; echo exit=$?'
```
(If `systemd-run` is refused, use `timeout 900` with the same NODE_OPTIONS. Increase the log number on each rerun.)
Also run `npx prettier --check` on each file you changed, and fix only what you changed.

## Rules your work depends on (quoted by the supervisor)

- **One-source cancellation** (`runRegistry.ts`): "The one way a run is stopped: record who and why, *then* abort …
  Every stop in this module comes through here." and "the signal object never crosses a boundary it cannot cross; the
  fact does". Never add a second `AbortController`, never call `.abort()` outside `stop()`.
- **Sockets** (CLAUDE.md): "one domain context per event family (provided by both shells) is the only listener, and
  the only place that toasts; views register listeners for local state and never call `toaster`." Add no listener and
  no toast. "`socket.off(event)` with no handler removes **every** listener app-wide; always pass the handler."
- Browser code: "no `crypto.randomUUID`, no `navigator.clipboard`."
- **DB:** "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." Never
  seed a row at a hardcoded id (use `.returning()` ids).
- **Names** (NOMENCLATURE §1): one word, one meaning; it is a **session**, never a *chat*; a **run**, a **waiting row**.
  Copy (STYLE-GUIDE §10): sentence case, plain words.
- **Decisions** (CLAUDE.md): "Do what was asked, at the size asked. Findings along the way go under **Noticed, not
  done**, never fixed in passing. Nothing 'for later'."
- An int test that opens a DB inside an `it` needs a 60 s timeout. Never hand a DOM node to an assertion.

## Verbatim (multi-agent guide)

- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You need no `sdk:build`.)
- Also: never `git checkout`, `git restore` or `git clean` in either repo.

## Report (your final message)

Changed files · each change in one line · tests run with the exact command and pass/fail counts (quote the vitest
summary line) · anything you stopped on · Noticed, not done. Under 600 words.
