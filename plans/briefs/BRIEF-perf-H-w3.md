# BRIEF — perf-H worker 3 — the session page applies `sessionMessageDelta` as a row patch

Supervisor: lane `perf-H` (`plans/briefs/BRIEF-perf-H.md`). Report back in your final message (the supervisor reads it); do not write a report file.

## Context (already built by worker 1 and the supervisor — read, do not change)

- Server: while a reply streams, `src/lib/server/pipelines/runtime/liveRow.ts` sends the first frame as the full
  `sessionMessage` row and every later frame as the scoped, gated event **`sessionMessageDelta`** with payload exactly
  `Sockets.SessionMessageDelta.Response` = `{ sessionId: number; id: number; content: string; reasoning: string | null }`
  (`src/lib/shared/sockets/types.ts`, beside `SessionMessage`). `reasoning: null` = the frame wrote no reasoning: the
  server left `metadata.reasoning` untouched (its write is `jsonb_set(coalesce(metadata,'{}'), '{reasoning}', …)`), so
  the client must leave it untouched too. A string = the server set `metadata.reasoning` to it (on `metadata` null →
  `{ reasoning }`). The settled row (and status changes) still arrive as `sessionMessage` full rows.
- `interest.ts` already lists `sessionMessageDelta` in `SCOPED_EVENTS` (scope `payload.sessionId`) and `GATED_EVENTS`.
- `src/lib/client/sockets/typedSocket.ts` `SocketEventMap` has (or will have, by the supervisor) the
  `sessionMessageDelta` entry — if `tsc` says it is missing, report that; never edit `typedSocket.ts` yourself.

## Goal (owner ruling ★P1 2026-11-13; plan W1-c)

The client applies a delta as a row patch through the store's existing cell-row patch (`patchCells`) — never a new row,
never a list replacement. A delta for an id the store does not hold is dropped (the full `sessionMessage` that follows,
or the next refresh, lands it).

1. `src/lib/client/sessions/store/sessionStore.svelte.ts` — ONE new store method, beside `upsertMessage`:
   `applyMessageDelta(delta: Sockets.SessionMessageDelta.Response): { row: SessionMessageRecord; previous: SessionMessageRecord } | null`
   (one-line doc comment). Inside `untrack` like every other write:
   - `sessions.has(delta.sessionId)` false → null; held = `messages.get(delta.id)`; no held, `held.sessionId !==
     delta.sessionId`, or held is not a cell row (`live.has(held)` false) → null.
   - held not generating (`held.isGenerating !== true`) → null: a late frame never repaints a settled row (P1).
   - `previous = { ...held }` (snapshot before the patch, like `upsertMessage`).
   - build `incoming = { ...sourceOf(held), content: delta.content }` and, only when `delta.reasoning` is a string,
     `metadata: { ...(source.metadata as object | null ?? {}), reasoning: delta.reasoning }`. A NEW plain object per
     delta, so `sourceOf` moves and `createRemoteMessages`' per-source cache re-projects exactly that row.
   - `patchCells(held, incoming)` (same key set, so it patches); false → null. Return `{ row: held, previous }`.
   It never adds an id to a window, never calls `messages.set`, never replaces `windows`.
2. `src/lib/client/components/sessionPage/sessionPageInbox.svelte.ts` — add `"sessionMessageDelta"` to
   `SESSION_SCOPED_EVENTS` right after `"sessionMessage"` with a one-line comment (the mid-stream frame; the settled
   row still comes as `sessionMessage`). That makes the inbox declare `sessionMessageDelta#<sessionId>`. Nothing else.
3. `src/lib/client/components/sessionPage/sessionPageData.svelte.ts` — a handler beside `handleSessionMessage`
   (~line 1001) and its registration beside `d.inbox.on("sessionMessage", handleSessionMessage)` (~line 1170):
   ```ts
   function handleSessionMessageDelta(msg: Sockets.SessionMessageDelta.Response) {
       if (!session || msg.sessionId !== sessionId) return
       const done = sessionStore.applyMessageDelta(msg)
       if (!done) return
       surfaceManager.witnessMessage(done.row, done.previous)
   }
   ```
   with a short comment: a mid-stream frame patches the held row in place (an unknown id or a settled row is
   dropped; the full row that follows lands it), and `witnessMessage` gets the row it replaced so widgets still hear
   `message:delta` exactly as from a full frame. No toast, no other listener. Do NOT touch `composerFlow.svelte.ts`,
   `LorebooksWorkspace.svelte`, or the document-view page: they ignore generating rows and stay on `sessionMessage`.

## Tests

NEW `src/lib/client/sessions/store/sessionStore.delta.dom.test.svelte.ts` (model on
`sessionStore.streaming.dom.test.svelte.ts`: its `payload()`, `opened()`, `flushSync` technique):
- a held generating row; N=20 deltas with growing content and a reasoning string on some (null on others) → the rows
  array (`messagesOf(1)`) keeps its reference and the row object keeps its identity across every delta; after each,
  `content` equals the delta's and `metadata.reasoning` equals the last string sent (null deltas leave it).
- then the full settled row (`upsertMessage` of a row built the way the server would send it: same keys, final
  content, `isGenerating: false`, metadata with reasoning and swipes) → `{ ...messagesOf(1).at(-1) }` deep-equals a
  FRESH store loaded with that same final row (`createSessionStore()` + `open` + `load`) — P1: field for field.
- `sourceOf(row)` is a new object after each delta.
- a delta for an id the store does not hold → null, nothing changes (rows reference, window ids).
- a delta for another session's id → null.
- a delta for a held row that is NOT generating → null, its content unchanged.
- a delta with `reasoning: null` on a row whose metadata is null → metadata stays null.

## Run (targeted only)

`systemd-run --user --scope -p MemoryMax=6G npx vitest run src/lib/client/sessions/store/ src/lib/client/components/sessionPage/ src/lib/client/components/hostElements/spMessageBody.dom.test.svelte.ts src/lib/client/components/host/remoteMessages.dom.test.svelte.ts`
Then `npx tsc --noEmit -p . 2>&1 | grep -E "sessionStore|sessionPageData|sessionPageInbox"` must print nothing, and
`npx prettier --check` each file you touched (sessionStore and sessionPageData were unclean at HEAD: shape only your
own lines by hand; your new test file must pass `--check` — you may `npx prettier --write` THAT NEW FILE ONLY).

## Files owned (edit only these)

`src/lib/client/sessions/store/sessionStore.svelte.ts` (the one method), `src/lib/client/components/sessionPage/sessionPageInbox.svelte.ts`
(the one list entry), `src/lib/client/components/sessionPage/sessionPageData.svelte.ts` (the handler + registration),
NEW `src/lib/client/sessions/store/sessionStore.delta.dom.test.svelte.ts`.

Note the new store method name `applyMessageDelta` is an internal method of the store object (not a wire, label or
type id); it is the only name you add.

## Report (final message)

Changed files with one line each; tests run with pass counts; anything you could not do; **Noticed, not done**.

## Verbatim rules (from the lane brief and `.claude/guides/multi-agent.md`)

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (This lane does NOT run `sdk:build` at all — the supervisor arranges it at the end.)
- "Never pipe vitest into `head`. Run int tests in a capped scope: `systemd-run --user --scope -p MemoryMax=6G npx vitest run <files>`."
- "Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk`."
- Never `npx prettier --write` on a file or a directory: most owned files already fail `--check` at HEAD and a `--write` reformats other people's lines. Bring only YOUR new/changed lines to prettier's form by hand (diff `npx prettier <file>` output against the file if you need to see it).

## Rules your work depends on (quoted from CLAUDE.md and the lane brief)

- CLAUDE.md **Sockets** ruling: "one domain context per event family (provided by both shells) is the only listener, and the only place that toasts; views register listeners for local state and never call `toaster`. An event in `SCOPED_EVENTS` must carry its scope key (`sessionId`, `lorebookId`…) in the payload, or `emitToUser` silently sends nothing." `socket.off(event)` without the handler removes every listener app-wide.
- P1 (owner principle): "Code decides what code can; the model only judges. Same inputs, same result." The delta changes **how often and how much** travels, never what the settled row says. After the settle the client row must equal the server row field for field.
- P2: "A module owns its data and every write to it." The session store owns row writes; a socket handler calls the store's method and never pokes cells itself.
- Determinism budget: this lane adds **no timer and no cache**. The 120 ms persist throttle (`liveRow.ts`) and the 50 ms markdown throttle (`SpMessageBody.svelte`) exist and are not touched.
- NOMENCLATURE: "message", "row", "frame", "live row", "cell row" are taken words. `RowPatch` is taken (`client/sessions/sessionRowPatches.svelte.ts`, session LIST rows). The ONLY new names this lane may introduce are the event **`sessionMessageDelta`** (type `Sockets.SessionMessageDelta.Response`) and the wire option **`peerTakesOneMessage`**. Any other new exported name, setting, flag, event or abstraction: stop and say so in your report instead of adding it. Local (non-exported) helper names inside a function are fine.
- "It is a session, never a chat."
- `$state(new Map())` / `new Set()` is not reactive on mutation — `SvelteMap` / `SvelteSet`. Browser code: no `crypto.randomUUID`, no `navigator.clipboard`.
- Out of scope, never built: any change to what the settled row carries, to `messages/store.ts`, or to the persist cadence; a delta for anything but `content` and `reasoning`; iframe (`PluginFrame`) row patches; removing/renaming `sessionMessage` or any published SDK name; compression, batching or coalescing.
- Findings outside your task go under **Noticed, not done** in your report, never fixed in passing.
