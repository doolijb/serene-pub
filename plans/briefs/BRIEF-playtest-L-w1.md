# BRIEF playtest-L-w1 — Indexing notice: scoped status, single-flight, live count (plan item 8, correctness only)

Supervisor: lane `playtest-L`. Repo: `/home/jody/github/serene-pub`. Report back in your final message (no report file).

## Goal
The composer's indexing notice ("Indexing 26 of 27 lorebook entries") sticks one behind and can show another session's
figures. Causes (from code): (1) every `fetchStatus()` in `RagNotice.svelte` subscribes to the BARE
`vectorization:checkRagStatus` key and the reply carries no `sessionId`, so the first reply to land settles every pending
fetch and a newer reply finds nobody; (2) the lane broadcasts `running` before each item, and the after-item
`vectorization:itemUpdated` is not listened to by the notice. Fix:

1. **Server** (`src/lib/server/sockets/vectorization.ts`, handler `vectorizationCheckRagStatus`, ~line 349–476): ALL THREE
   `emitToUser("vectorization:checkRagStatus", res)` arms — the no-model early return, the ≤10-messages early return and the
   final one — must put `sessionId: params.sessionId` and `lorebookId` on `res`. `lorebookId` is `session?.lorebookId ?? null`
   where the session row is read; the no-model arm returns before that read, so it sends `lorebookId: null` (do not add a
   query to it). The supervisor has ALREADY added both fields to the type
   (`src/lib/shared/sockets/types.ts`, `Sockets.Vectorization.CheckRagStatus.Response`: `sessionId: number`,
   `lorebookId: number | null`) and ALREADY added `["vectorization:checkRagStatus", (payload) => payload?.sessionId]` to
   `SCOPED_EVENTS` in `src/lib/shared/sockets/interest.ts`. Do not edit those two files; tell me if they need anything.
2. **Pure helper** in `src/lib/client/components/sessionPage/ragNotice.ts`: a single-flight, trailing-throttled asker,
   e.g. `export function statusAsker(send: () => void, opts?: { throttleMs?: number; setTimer?; clearTimer? })` returning
   `{ now(), soon(), answered(), reset(), dispose() }`:
   - `now()` sends at once unless an ask is in flight, in which case it marks the answer **dirty** (no second send).
   - `answered()` (call on every reply) clears in-flight; if dirty, clears dirty and sends exactly once more.
   - `soon()` is a trailing throttle (default ~500 ms, export the constant): the first call starts a timer, later calls in
     the window do nothing, the timer's end calls `now()`.
   - `reset()` forgets in-flight and dirty and cancels a pending timer, sending nothing. `dispose()` = reset for good.
   - Timers injectable so the pure test needs no fake timers (or use `vi.useFakeTimers()` — your choice).
   Name it as you like within NOMENCLATURE R1–R4 (no bare nouns like `fetcher`/`manager` clashing with a canon word; it is
   internal code, not a user-facing term). A short doc comment says what it is for and why (single-flight: one reply per
   ask, so an older reply can never be the last word).
3. **Component** `src/lib/client/components/sessionPage/RagNotice.svelte`:
   - Replace the one-shot `requestWithInterest` status fetch with ONE standing scoped interest:
     `$effect(() => declareInterest<"vectorization:checkRagStatus">(interestKey("vectorization:checkRagStatus", id), onStatus))`
     keyed on the `id` derived (re-declared when the session changes, released on destroy by the effect's return).
     `onStatus` sets `ragStatus` and calls `asker.answered()`.
   - The ask itself is `socket.emit("vectorization:checkRagStatus", { sessionId: id })` through `useTypedSocket()` from
     `$lib/client/sockets/typedSocket` (its `emit` flushes the pending interest sync first, so the server already holds the
     scoped key when it answers — "ruling 3"). The declare effect must be declared BEFORE the effect that asks, so the key is
     declared first on mount.
   - The existing `$effect` on `id` + `messageCount` asks with `asker.now()`. When `id` differs from the last one seen,
     first `asker.reset()` and `ragStatus = null` (another session's figures must never show under this one).
     ⚠ It must still send EXACTLY ONE `checkRagStatus` on mount, and none per streamed token: the guard test
     `src/lib/client/components/sessionPage/sessionStream.dom.test.svelte.ts` ("RagNotice: checkRagStatus is asked once, not
     per token") must stay green — read it, do not edit it.
   - Refetch on scoped `vectorization:itemUpdated`: once `ragStatus.lorebookId` is known, a `$effect` keyed on that id
     declares `interestKey("vectorization:itemUpdated", lorebookId)` and calls `asker.soon()`.
     (`vectorization:itemUpdated` is already in `SCOPED_EVENTS` by `payload.lorebookId`; it is emitted after each item by
     the indexing lane — `src/lib/server/indexing/lane.ts` ~962, payload built in
     `src/lib/server/embedding/vectorizationQueue.ts` ~377 with `lorebookId: item.lorebookId`. Read-only; do not edit lane.ts
     unless the payload truly lacks the key, and then stop and tell me first.)
   - `vectorization:progress` (admin-only, stays so): refetch only when `status === "idle"` and `ragStatus?.applicable`,
     through `asker.soon()`. Keep it a `useInterest` (bare).
   - `vectorization:checkRagStatus:error` (bare `useInterest`): `asker.reset()` only (never re-ask on an error — that could
     loop). Layout already toasts it; views never call `toaster`.
   - Reconnect: `onConnect(() => { asker.reset(); asker.now() })` from `$lib/client/sockets/interest.svelte`, released in
     `onDestroy` (a reply lost to a disconnect would otherwise freeze the single-flight forever).
   - `handleMoveToTop`'s reply calls `asker.now()` instead of `fetchStatus()`. `addToQueue` and `setSessionRagIgnored`
     keep their one-shot `requestWithInterest` as they are.
   - `onDestroy`: `asker.dispose()` plus the existing pending release.
   - Update the file's header comment (it says "Every request is a requestWithInterest whose handler IS the reply"): the
     status ask is now a standing scoped interest plus a plain emit; still no ack callback.
   - Placement, wording, markup and styles of the notice do NOT change (ruled §0-C: it stays where it is).
4. **Docs** `docs/embeddings-and-rag.md` §"Understanding indexing notices" (~lines 151–159): add one plain sentence
   saying when the count moves, e.g. *"The count moves as each entry is indexed for the lorebook's owner; anyone else
   sees it catch up when the session gets a new message."* (Accurate: `vectorization:itemUpdated` goes only to the
   item's owner — `registerOwnerEmitter` in `sockets/vectorization.ts` ~641.) Sentence case, plain words, it is a
   *session*, never a *chat*.

## Files owned (the only files you may edit)
- `src/lib/client/components/sessionPage/RagNotice.svelte`
- `src/lib/client/components/sessionPage/ragNotice.ts`
- `src/lib/client/components/sessionPage/ragNotice.test.ts`
- `src/lib/client/components/sessionPage/ragNotice.dom.test.ts`
- `src/lib/server/sockets/vectorization.ts` (the checkRagStatus handler only)
- `src/lib/server/sockets/vectorization.checkRagStatus.int.test.ts`
- `docs/embeddings-and-rag.md` (the one sentence)

## Files readable
Anything. Especially `src/lib/client/sockets/interest.svelte.ts` (declareInterest, requestWithInterest, onConnect,
`_resetInterestForTests`), `src/lib/shared/sockets/interest.ts`, `src/lib/server/sockets/index.ts` ~225–285 (how
`emitToUser` gates by scope), `src/lib/client/sockets/typedSocket.ts` ~5335 (emit flushes sync).

## Out of scope — never build
Moving the notice (to Activity or anywhere); non-admin progress (`vectorization:progress` stays admin-only); cutting the
per-item status-check cost beyond the throttle; any new setting; any edit outside Files owned (another lane is editing
widget-host / session-layout / SDK files at the same time).

## Rules your work depends on (quoted)
- CLAUDE.md, Standing rulings: *"Sockets: one domain context per event family (provided by both shells) is the only
  listener, and the only place that toasts; views register listeners for local state and never call `toaster`. An event in
  `SCOPED_EVENTS` must carry its scope key (`sessionId`, `lorebookId`…) in the payload, or `emitToUser` silently sends
  nothing."*
- CLAUDE.md Hard rules: *"`socket.off(event)` with no handler removes every listener app-wide; always pass the
  handler."* · *"`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`."* ·
  *"Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`."*
- `useInterest` reads its KEY ONCE (interest.svelte.ts doc): a key that moves (session id, lorebook id) is declared in your
  own `$effect` with the id as a dependency, returning the release.
- NOMENCLATURE §11 vocabulary (ragNotice.ts header): the feature is **Search by meaning**; an entry is **indexed**, **not
  indexed yet** or **needs re-indexing**; never say vectors, embedded or RAG in UI copy.
- STYLE-GUIDE §10: sentence case, plain words, a session never a chat. Help is one sentence.
- Decisions: implementation choices inside this brief are yours — name each in your report. Anything a user sees beyond
  the doc sentence, a new setting, a file outside Files owned, or an unclear reading: STOP that part and report it.
  Do not fix things you notice in passing — list them under "Noticed, not done".

## Done means — tests (all green)
- `ragNotice.test.ts`: the asker — single-flight (a `now()` while in flight sends nothing; `answered()` then sends once);
  coalesce (several `now()`/`soon()` in flight → exactly one re-ask); `soon()` trailing throttle (several calls → one send at
  the window's end); `reset()` drops in-flight and dirty and sends nothing.
- `ragNotice.dom.test.ts`: update its `reply()` helper so replies carry `sessionId: 7` (and a `lorebookId`) — a scoped
  listener does not hear a payload without its key. Add: (a) out-of-order — a trigger while an ask is in flight sends no
  second ask until the reply lands, then exactly one; the notice ends on the NEWEST reply's figures; (b) a reply with
  `sessionId: 8` changes nothing on session 7's notice; (c) a scoped `vectorization:itemUpdated` with the reply's
  `lorebookId` asks again (after the throttle window — fake timers or a wait) and one for another lorebook does not.
  Keep every existing test passing.
- `vectorization.checkRagStatus.int.test.ts`: the reply carries `sessionId` (and `lorebookId`) on the ≤10-messages arm and
  the full arm; if you can switch the mocked `resolveEmbeddingTarget` per test (e.g. a `vi.hoisted` variable), also the
  no-model arm (`lorebookId: null`). DB-opening tests keep the 60 s timeout already set in that file.
- Regression, read-only: `src/lib/client/components/sessionPage/sessionStream.dom.test.svelte.ts`,
  `src/lib/server/sockets/interest.test.ts`, `src/lib/client/sockets/interest.test.ts`.

Run tests ONLY like this (capped scope; one log per run, numbered):
```
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run <files> > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest-L-w1-<n>.log 2>&1; echo exit=$?'
```
(if `systemd-run` is refused, `timeout 900` with the same NODE_OPTIONS). Never pipe vitest into `head`. Never a full
`npm test`, `npm run check` or project-wide `tsc`. Never hand a DOM node to an assertion (compare `x === null` to `true`,
not `assert.equal(node, null)`). Format with `npx prettier --write <file>` only on files you own, and only if the file was
prettier-clean before you touched it (check with `npx prettier --check <file>` first); otherwise match the surrounding style.

## Verbatim lines (multi-agent guide)
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."*
- Also: never `git checkout`, `git restore` or `git clean` in either repo. No SDK edits are needed for this brief.

## Report (final message)
Changed files · what you chose and why (names of new functions/constants) · tests run with exact command and pass/fail
counts per file · anything stopped · Noticed, not done. Under 600 words.
