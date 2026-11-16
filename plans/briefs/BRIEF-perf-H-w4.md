# BRIEF — perf-H worker 4 — a personal lane's streamed deltas reach only the lane's readers

Supervisor: lane `perf-H` (`plans/briefs/BRIEF-perf-H.md`). Report back in your final message (the supervisor reads it); do not write a report file.

## Context (built — read, do not change)

`src/lib/server/pipelines/runtime/liveRow.ts` `announce`: a frame goes out as the full `sessionMessage` row until the
run's recipients memo (`SessionRecipientsMemo`) is filled, then as `sessionMessageDelta`
`{ sessionId, id, content, reasoning }` reusing that memo. The memo is filled inside `broadcastToSessionUsers`
(`src/lib/server/sockets/utils/broadcastHelpers.ts` ~190-300) from the first broadcast that passes the interest gate,
through `laneScopedRecipients` (`src/lib/server/channels/lanePush.ts:46-51`), which narrows a personal-lane row to its
person and the owner — but ONLY for event `sessionMessage` (it reads the row's `channel`). The delta has no channel:
the rule "the full row fills the memo" is what keeps a personal lane private. The lead asked for a test that proves it.

## Task — ONE new test file, nothing else

NEW `src/lib/server/pipelines/runtime/liveRow.deltaLane.int.test.ts`, using the REAL `broadcastToSessionUsers`,
`laneScopedRecipients` and interest gate (do NOT mock broadcastHelpers or lanePush):

- Setup: copy the pattern from `src/lib/server/channels/lanes.int.test.ts` lines 20-82 (the `$lib/server/db` mock to a
  test db, the `sessionGenres` mock with a genre whose `shape.channels` has `{ slug: "parley", lanes: "personal" }`,
  the data-dir env, `table()` = owner + guests ann and bo) and get ann's lane with `laneFor(db, session.id, "parley", ann.id)`.
  Mock `$lib/server/sessions/rowPush` to `{ broadcastSessionRow: () => {} }`.
- A recording fake io for THREE users (owner, ann, bo), one socket each, every socket's `interest` holding
  `sessionMessage#<sessionId>` and `sessionMessageDelta#<sessionId>`. Model it on `recordingIo` in
  `src/lib/server/sockets/sessions.lairWhisper.int.test.ts` ~264-292, extended to three users and to RECORD emits:
  `to(target).emit(event, payload)` pushes `{ target, event, payload }`. Read `src/lib/server/sockets/interest.ts`
  (`anyInterestAnywhere`, `hasInterest`, `interestedSockets`, `socketsInUserRoom`) to see exactly what the fake must
  answer (rooms `user_<id>`, `sockets.sockets.get/values`, maybe more) — make the fake satisfy the real functions.
- A placeholder row on ann's lane (`insertLegacy(db, { sessionId, role: "assistant", content: "", isGenerating: true,
  channel: <ann's lane>, metadata: {} })`, see `liveRow.delta.int.test.ts` `start()` for the live-row harness and its
  140 ms frame spacing), `createLiveRow({ db, io, sessionId, streamingNodes: new Set(["generate"]) })`, `opened`,
  `attach`, then ≥ 4 frames, `flush()`, `finish({ kind: "ok" })`.
- Assert: every `sessionMessage` and every `sessionMessageDelta` emit went to the owner's and ann's sockets only —
  bo's socket received NOTHING; at least one emit was a `sessionMessageDelta` (so deltas really flowed) and the first
  emit to each recipient was a full `sessionMessage`.
- A control case: the same run on `main` → bo receives the deltas too (so the test can tell the two apart).
- If the fake io turns out to need something unexpected, say what in your report; never change `interest.ts`,
  `broadcastHelpers.ts`, `lanePush.ts` or `liveRow.ts`.

## Run

`systemd-run --user --scope -p MemoryMax=6G npx vitest run src/lib/server/pipelines/runtime/liveRow.deltaLane.int.test.ts src/lib/server/pipelines/runtime/liveRow.delta.int.test.ts`
then `npx tsc --noEmit -p . 2>&1 | grep deltaLane` (prints nothing) and `npx prettier --check` the new file (you may
`npx prettier --write` THAT NEW FILE ONLY).

## Files owned

NEW `src/lib/server/pipelines/runtime/liveRow.deltaLane.int.test.ts` only.

## Report (final message)

The file, the tests with pass counts, what the fake io needed, anything you could not do; **Noticed, not done**.

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
