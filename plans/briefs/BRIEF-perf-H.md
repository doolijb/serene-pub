# BRIEF — lane `perf-H` — the mid-stream frame is a delta, and widgets receive a row patch

**Supervisor:** read `.claude/guides/multi-agent.md` first, then `.claude/guides/review.md` §2. Plan:
`plans/PLAN-performance-2026-11-13.md` — Part 1, W1-b/c/d rows, Part 3 **rulings table** (★P1, ★P12, ★P14 are ruled;
the "original questions" table below it is history), §4.2b row perf-H. Previous lane reports you build on:
`plans/REPORT-perf-A-2026-11-13.md` (liveRow, recipients memo) and `plans/REPORT-perf-F-2026-11-13.md` (cell rows,
`patchCells`, widgetWire identity skip, `createRemoteMessages`).

## Goal

1. **★P1 (ruled 2026-11-13):** while a reply streams, each frame goes out as a new scoped event
   **`sessionMessageDelta`** carrying `{ sessionId, id, content, reasoning }` — nothing else. The settled row (after
   `flush`/`finish`, the error row, the cancel) still goes out as `sessionMessage` with the full row through the live
   roster, exactly as today. The recipients memo built by perf-A stays (★P12 accepted: a guest removed mid-reply still
   gets that reply's deltas).
2. **W1-c:** the client applies a delta as a row patch through the store's existing `patchCells` — never a new row,
   never a list replacement. A delta for an id the store does not hold is dropped (the full `sessionMessage` that
   follows, or the next refresh, lands it). The client registers the new event in the sessions **domain context**
   that already owns the `sessionMessage` family (`sessionPageInbox.svelte.ts`, `SESSION_SCOPED_EVENTS`) — one
   listener per event family, views never listen themselves, nothing toasts.
3. **★P14 (ruled):** SDK `sdk/src/componentWire.ts` gains `case 'message'` for the existing
   `HostFrameMessage` member `{ t: 'message'; message: MessageV1 }` (`sdk/src/surfaces.ts:225`): replace the row by
   id in `data.messages` and in the held channel list; no row found → ignore. Core's `widgetWire.svelte.ts` posts
   `{ t: 'message' }` for a streaming frame **only when the peer declared it understands it**: a new boolean on
   `WidgetWireOptions` that `ComponentMount` (worker path) sets and `PluginFrame`/`RemoteWidget` iframe path does not
   (iframes keep full `{ t: 'messages' }` lists). Name the option per NOMENCLATURE §24 and record it, with the event,
   in §25 in the same change.

## Rules you quote into every worker brief

- CLAUDE.md **Sockets** ruling: an event in `SCOPED_EVENTS` must carry its scope key (`sessionId`) in the payload or
  `emitToUser` silently sends nothing. `broadcastHelpers.ts:66-85` reads the scope from the payload when the caller
  passes none. The delta's payload carries `sessionId` — test it.
- One domain context per event family is the only listener and the only place that toasts (memory
  `feedback_sockets_and_toasts_centralized`). `socket.off(event)` without the handler removes every listener.
- P1: same inputs, same result. The delta changes **how often and how much** travels, never what the settled row
  says. After the settle, the client row must equal the server row field for field (test it: stream N deltas, then
  the full row; compare to a fresh load).
- P2: the store owns row writes; the delta handler calls the store's method, it never pokes cells itself.
- NOMENCLATURE §1 R1–R6, §9 (session vocabulary; "message", "row", "frame" are taken — read before naming), §24,
  and append to §25. "It is a session, never a chat."
- `$state(new Map())` is not reactive — `SvelteMap`. No `crypto.randomUUID`.
- SDK edits land in `../serene-pub-sdk/`; never `git checkout`/`restore`/`stash` there. `sdk:build` only at the end
  of the lane, only after `pgrep -af "vite dev"` shows no serene-pub server, and only after **you (the supervisor)
  message the lead** and the lead has told the peer. The peer session `serene-pub-c4` has no rebuild planned.
- `shared/sockets/types.ts`: the peer added `Sockets.Entries.Earmark` near the Entries types — add the new session
  event type beside the Sessions types; do not rewrite anything else in that file.
- Determinism budget: this lane adds no timer and no cache. The 120 ms persist throttle and the 50 ms markdown
  throttle already exist and are not touched.

## Challenger corrections (accepted 2026-11-13, [C9])

- `SCOPED_EVENTS` lives in `src/lib/shared/sockets/interest.ts:80`, **not** `types.ts`; `sessionMessage` is also in
  `GATED_EVENTS` (`interest.ts:581`, its entry at `:1256`, guarded by `gatedEvents.test.ts`). A gated event no client
  subscribes to "receives nothing at all, with no error" (`interest.ts:60-65`); left ungated it goes to every socket of
  every session user. So `sessionMessageDelta` goes in **both** tables, with the client subscription in
  `SESSION_SCOPED_EVENTS` (`sessionPageInbox.svelte.ts:129`) and the handler beside `sessionMessage`'s at
  `sessionPageData.svelte.ts:1170`. The peer session released the session-page/store files on 2026-11-13; they are yours.
- `ComponentMount` is core code (`src/lib/client/components/host/`), not SDK; `{ t: 'message' }` already exists in
  `sdk/src/surfaces.ts:225`, so no contracts change is expected.
- `LorebooksWorkspace.svelte:2282` and `composerFlow.svelte.ts:320` ignore generating rows and stay on the settled
  `sessionMessage` — do not subscribe them to the delta.

## Files owned

`src/lib/shared/sockets/interest.ts` (the two table entries), `src/lib/shared/sockets/gatedEvents.test.ts`,
`src/lib/client/components/sessionPage/sessionPageData.svelte.ts` (the delta handler beside the `sessionMessage` one),
`src/lib/server/pipelines/runtime/liveRow.ts` (announce path only), `src/lib/server/sockets/utils/broadcastHelpers.ts`
(only if the delta needs a helper; prefer the existing `broadcastToSessionUsers` with the memo), `src/lib/shared/sockets/types.ts`
(additive: the delta event type beside the Sessions types), `src/lib/client/components/sessionPage/sessionPageInbox.svelte.ts`,
`src/lib/client/sessions/store/sessionStore.svelte.ts` (one new method that calls `patchCells`, or reuse it directly),
`src/lib/client/components/frames/widgetWire.svelte.ts`, `src/lib/client/components/host/RemoteWidget.svelte`,
`src/lib/client/components/host/ComponentMount*.svelte` (the worker path only, to set the option), `src/lib/client/components/host/ComponentMount*.svelte` is core (see above); SDK
`../serene-pub-sdk/sdk/src/componentWire.ts`, `../serene-pub-sdk/sdk/src/surfaces.ts` (doc comment on the `message`
member only), `../serene-pub-sdk/sdk-tests/componentWireT.test.ts` (+ a new test file if cleaner), `docs/sessions.md`
(the streaming paragraph), `NOMENCLATURE.md` §25 (append only), and the new test files named under Done.

## Files readable

Anything. Especially `plans/REPORT-perf-A-2026-11-13.md`, `plans/REPORT-perf-F-2026-11-13.md`,
`src/lib/server/sockets/index.ts:230-260` (how scoped events are routed), `src/lib/client/components/host/remoteMessages.svelte.ts`.

## Out of scope (written down, never built)

- Any change to what the settled row carries, to `messages/store.ts`, or to the persist cadence.
- A delta for anything but `content` and `reasoning` (no status, no parts, no speaker).
- Iframe (`PluginFrame`) row patches — iframes keep full lists.
- Removing or renaming `sessionMessage`, or any published SDK name.
- Compression, batching across messages, or coalescing deltas on the server.

## Stop and ask (message the lead) when

CLAUDE.md §Decisions applies: a new name beyond the event and the one option, a new setting/flag/table/migration,
a file outside **Files owned**, a reader of `sessionMessage` on the client that cannot be satisfied by a patch (list
it in the report instead of widening the delta), or `sdk:build` is needed before the end.

## Done means

- New `src/lib/server/pipelines/runtime/liveRow.delta.int.test.ts`: N frames emit N `sessionMessageDelta` with
  `sessionId`, `id`, `content`, `reasoning` and no other keys; `flush`+`finish` emits exactly one `sessionMessage`
  with the full row; the error and cancel paths still emit the full row; the interest-gate test for a scoped event
  with a missing `sessionId` fails loudly (or is impossible by type).
- `src/lib/server/sockets/index.interestGate.test.ts` extended: the delta is scoped on `sessionId`.
- Client: a `.dom.test` or unit test on the inbox/store: N deltas then the full row → row equals a fresh projection;
  a delta for an unknown id is dropped; the rows array keeps its reference across deltas (perf-F's guarantee).
- `widgetWire` test: with the option set, a streaming frame posts `{ t: 'message' }` once and no `{ t: 'messages' }`;
  without it, behaviour is byte-identical to today; add/remove still posts the full list.
- SDK `sdk-tests`: `case 'message'` replaces by id in `data.messages` and the held channel list; unknown id ignored;
  held frames before the patch are unchanged.
- Existing files green: `liveRow.perframe.int`, `liveRow.recipients.int`, `runStatus.int`, `sessions.*.int` that
  touch streaming, `spMessageBody.dom`, `widgetWire*`, `remoteMessages*`, `sessionStore*`, SDK `componentWireT`,
  `surfaces`, `conversationRowFacts`. `npx tsc --noEmit -p .` clean on touched files. `npx prettier --check` on each
  touched file.
- `docs/sessions.md` streaming paragraph says: deltas while streaming, the full row at settle.
- `NOMENCLATURE.md` §25 row appended for `sessionMessageDelta` and the wire option.

## Report

`plans/REPORT-perf-H-2026-11-13.md`: changed files, tests run with counts, measured payload per frame before/after
(bytes for a 2 KB and a 20 KB reply with 3 swipes), open ★, **Noticed, not done**.

Every worker brief carries verbatim:
- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."
- "Never pipe vitest into `head`. Run int tests in a capped scope: `systemd-run --user --scope -p MemoryMax=6G npx vitest run <files>`."
- "Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk`."
