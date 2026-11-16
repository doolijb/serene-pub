# BRIEF — perf-H worker 1 — the server sends a mid-stream frame as `sessionMessageDelta`

Supervisor: lane `perf-H` (`plans/briefs/BRIEF-perf-H.md`). Report back in your final message (the supervisor reads it); do not write a report file.

## Goal

While a reply streams, `liveRow.ts` announces each persisted frame. Today every frame goes out as `sessionMessage` with
the full row. After this change a frame goes out as the new scoped, gated event **`sessionMessageDelta`** with payload
exactly `{ sessionId, id, content, reasoning }` — but see the lane-privacy rule below. The settled row (finish's
release, the error row, the cancel) still goes out as `sessionMessage` with the full row through the live roster,
exactly as today. Owner ruling ★P1 (2026-11-13): "New scoped event `sessionMessageDelta` (`sessionId, id, content,
reasoning`)". ★P12 accepted: the per-run recipients memo (`SessionRecipientsMemo`, perf-A) stays.

### The lane-privacy rule (supervisor's decision — implement exactly)

`laneScopedRecipients` (`src/lib/server/channels/lanePush.ts:46-51`, read-only for you) narrows a personal-lane row's
recipients ONLY for event `sessionMessage`, by reading `payload.sessionMessage.channel`. `broadcastToSessionUsers`
fills the run's memo from the FIRST broadcast that passes the gate and reuses it for later ones
(`broadcastHelpers.ts` ~190-300). A delta carries no channel, so if a delta filled the memo, a personal lane's reply
would stream to every member. Therefore, in `liveRow.ts`'s frame announce, decided INSIDE the `announcing` chain
callback (so it sees the previous broadcast's effect on the memo):

- `frameRecipients.value === null` → send the frame as today: `"sessionMessage"`, `{ sessionMessage: row }`,
  `{ recipients: frameRecipients }` (this fills the memo off the row, lane-scoped as today);
- otherwise → `"sessionMessageDelta"`, `{ sessionId, id: row.id, content: row.content, reasoning }`,
  `{ recipients: frameRecipients }`.

`reasoning` is `string | null`: the reasoning the frame WROTE (`now.reasoning` in `persist`), or `null` when the frame
wrote none (`now.reasoning === undefined` — then the server leaves `metadata.reasoning` untouched, and the client
must too). No other key, ever. `broadcastSessionRow(io, sessionId)` stays on every frame as today. The release
(`announce(released, true)`) stays a full `sessionMessage` with no memo. `flush()` persists a frame, so it follows the
frame rule. Do NOT add exports to `broadcastHelpers.ts` (106 test files mock it with factories; perf-A lost a run to
that) — you should not need to touch it at all. Keep the `announcing` chain and its ordering comment; update the
file-header and `announce` comments so they say what is true now (frames: delta once the run's recipients are known;
settle: full row).

## Files owned (edit only these)

1. `src/lib/shared/sockets/interest.ts` — two entries only: `["sessionMessageDelta", (payload) => payload?.sessionId]`
   in `SCOPED_EVENTS` right after `sessionMessage` (~line 85) with a one-line comment of its payload; and
   `"sessionMessageDelta"` in `GATED_EVENTS` right after `"sessionMessage"` (~line 1256), extending the comment above
   (~1240) to name its one consumer: the session page's inbox (`client/components/sessionPage/sessionPageInbox.svelte.ts`,
   handler in `sessionPageData.svelte.ts`). Why both tables: a gated event no client subscribes to "receives nothing at
   all, with no error" (`interest.ts:60-65`); ungated, it goes to every socket of every session user.
2. `src/lib/shared/sockets/gatedEvents.test.ts` — add `"sessionMessageDelta"` to `MIGRATED_EVENTS` (with a comment
   like its neighbours), a `scopeOfPayload` case reading `sessionId` (and `null` when `sessionId` is missing), an
   `isScopedEvent` case, and the "streamed reply" describe asserting the delta is gated.
3. `src/lib/shared/sockets/types.ts` — ADDITIVE ONLY: beside `namespace SessionMessage` (~line 15605) add
   `namespace SessionMessageDelta { interface Response { sessionId: number; id: number; content: string; reasoning: string | null } }`
   with a doc comment (what it is, that the full row still settles as `sessionMessage`, that `reasoning: null` means
   "unchanged"). The peer added `Sockets.Entries.Earmark` elsewhere in this file: do not touch anything else.
   (The client's `SocketEventMap` in `client/sockets/typedSocket.ts` is NOT yours; the supervisor handles it.)
4. `src/lib/server/pipelines/runtime/liveRow.ts` — the announce path only (above).
5. NEW `src/lib/server/pipelines/runtime/liveRow.delta.int.test.ts` — model it on
   `liveRow.recipients.int.test.ts` (its `vi.mock` of broadcastHelpers) and `liveRow.perframe.int.test.ts` (harness).
   Cases:
   - N frames (N ≥ 4, past the 120 ms throttle — use the existing tests' technique) → the first frame broadcast is
     `sessionMessage` with the memo; every later frame is `sessionMessageDelta` with the SAME memo object, payload keys
     exactly `["content","id","reasoning","sessionId"]`, `sessionId` = the session, `id` = the row, `content` = the
     persisted content.
   - the memo cleared (simulate a failed lookup: set `memo.value = null` from the mock between frames) → the next
     frame goes as a full `sessionMessage` again (the lane rule's fallback).
   - reasoning: a native-reasoning frame carries the reasoning string; a frame with no reasoning carries `null`.
   - `flush()` + `finish({ kind: "cancelled" })` → exactly ONE `sessionMessage` after the frames, carrying the full
     released row (`isGenerating: false`), called with no memo.
   - the error path (`finish({ kind: "err" })`) still emits a full `sessionMessage` row (through
     `persistGenerationErrorRow` → `broadcastToSessionUsers`, `utils/generationStatus.ts:222`).
   - type-level: a `// @ts-expect-error` object of type `Sockets.SessionMessageDelta.Response` without `sessionId`
     (the missing-scope case is impossible by type).
6. `src/lib/server/sockets/index.interestGate.test.ts` — EXTEND (no rewrite): a describe proving the delta is scoped on
   `sessionId` through the REAL table. The file mocks the interest module through a `vi.hoisted` seam with invented
   events; read how, then either add `sessionMessageDelta` to the seam with the real extractor pulled through
   `vi.importActual("$lib/shared/sockets/interest")`, or assert directly against the actual module — whichever keeps
   the existing tests untouched. Show: a delta reaches the socket that declared `sessionMessageDelta#42` and not one
   that declared `#9`; a delta payload without `sessionId` reaches no scoped declaration.

## Measurement (for the lane report)

Write a throwaway script under `/tmp/claude-1000/-home-jody-github-serene-pub/c46dc447-41a1-4f0c-98ce-0f42e7756232/scratchpad/perf-H-measure.*`
(never in the repo) that builds a `session_messages` row shaped as the server returns it (every column of
`schema.sessionMessages.$inferSelect`, realistic values; `metadata` holding 3 swipes in the shape
`buildReasoningMetadata` / `swipes.history` use — read `messages/reasoningMetadata.ts`) and prints
`Buffer.byteLength(JSON.stringify(payload))` for the full frame `{ sessionMessage: row }` vs the delta, for a 2 KB and
a 20 KB reply (content length; the other two swipes the same size). Report the four numbers.

## Run (targeted only)

`systemd-run --user --scope -p MemoryMax=6G npx vitest run src/lib/server/pipelines/runtime/liveRow.delta.int.test.ts src/lib/server/pipelines/runtime/liveRow.perframe.int.test.ts src/lib/server/pipelines/runtime/liveRow.recipients.int.test.ts src/lib/server/pipelines/runtime/liveRow.reasoning.int.test.ts src/lib/server/pipelines/runtime/runStatus.int.test.ts src/lib/shared/sockets/gatedEvents.test.ts src/lib/shared/sockets/scopedReplies.test.ts src/lib/server/sockets/index.interestGate.test.ts`
— `liveRow.perframe` / `liveRow.recipients` may assert "every frame is `sessionMessage`"; if one does, update only the
assertion that the lane rule changes (first frame full, later frames delta) and list each such edit in your report.
Also grep `src/lib/server` for other tests asserting per-frame `sessionMessage` from liveRow (`grep -rln "sessionMessage" src/lib/server --include=*.int.test.ts | xargs grep -l "liveRow\|createLiveRow"`) and run those too.
Then `npx tsc --noEmit -p . 2>&1 | grep -E "liveRow|interest|gatedEvents|types.ts|interestGate"` must print nothing, and
`npx prettier --check` each file you touched (pre-existing drift is fine; your hunks must be prettier-shaped).

## Report (final message)

Changed files with one line each; tests run with pass counts; the four byte numbers; any test assertion you changed
and why; anything you could not do; **Noticed, not done**.

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
