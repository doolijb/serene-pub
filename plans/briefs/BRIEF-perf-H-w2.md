# BRIEF — perf-H worker 2 — widgets receive one streamed row, not the whole log (★P14)

Supervisor: lane `perf-H` (`plans/briefs/BRIEF-perf-H.md`). Report back in your final message (the supervisor reads it); do not write a report file.

## Goal

Owner ruling ★P14 (2026-11-13): "Build the `{t:'message'}` row patch in `componentWire.ts` behind a
`WidgetWireOptions` flag." The SDK's host→frame union `HostFrameMessage` already has the member
`{ t: 'message'; message: MessageV1 }` (`../serene-pub-sdk/sdk/src/surfaces.ts:225`) with no receiver. Two halves:

### A. SDK receiver — `../serene-pub-sdk/sdk/src/componentWire.ts`

In `createComponentContext`'s `port.onmessage` switch (~line 176), add `case 'message'`:
- read `m.message`; no object or no numeric `id` → return (ignore).
- `data.messages` holds a row with that id → `data.messages` becomes a NEW array (copy, row replaced at the same
  index), then `notify('messages')`. The old array is never mutated (a component may still hold it).
- each `data.channels[ch]` list that holds that id → replaced the same way in a NEW `data.channels` object (copy of the
  record, new list for that channel), then `notify('channels')` once if any list changed.
- no row found anywhere → nothing changes, nothing is notified.
Comment it in the file's voice (one short paragraph: replaces one held row by id; a host sends it only to a peer it
knows receives it, and the full `messages`/`channel` posts still carry adds and removes).

`../serene-pub-sdk/sdk/src/surfaces.ts` — ONLY a doc comment on the existing `{ t: 'message'; message: MessageV1 }`
member: what it means (replace the held row with this id in `messages` and in any `channel` list holding it; an id not
held is ignored), and that a host sends it only over a component's wire whose host declared it (core's
`WidgetWireOptions.peerTakesOneMessage`) — a frame (iframe) always gets full lists. Do not change the type.

Tests: NEW `../serene-pub-sdk/sdk-tests/componentWireMessage.test.ts` (node:test + assert, same `fakePort` as
`componentWireT.test.ts`; read the context's sections through its public getters `ctx.messages` / `ctx.channels` and
its subscribe API — read `componentClient.ts`'s `ComponentContext` for the exact names):
- `{t:'messages'}` of 3 rows, then `{t:'message'}` for row 2 → `ctx.messages[1]` is the new row, rows 1 and 3 are the
  same objects, the array is a new reference, the PREVIOUS array still holds the old row 2 (held frames unchanged),
  one `messages` notification.
- `{t:'channel', channel:'main', …}` and `{t:'channel', channel:'side', …}` then a patch for a row on `side` → only
  `side`'s list is replaced, `main`'s list keeps its reference, one `channels` notification.
- an unknown id → `ctx.messages` and `ctx.channels` keep their references, no notification.
- a malformed `{t:'message'}` (no message / no id) → ignored, no throw.
Run from the sdk-tests dir only: `cd ../serene-pub-sdk/sdk-tests && npx tsx --test componentWireMessage.test.ts componentWireT.test.ts surfaces.test.ts conversationRowFacts.test.ts`
and `npx tsc --noEmit -p ../serene-pub-sdk/sdk-tests` (or `npm run typecheck` inside `sdk-tests`) — NEVER `npm test`
or any build at the SDK root, and NO `sdk:build` (the supervisor arranges it at the lane's end).

### B. Core sender — `src/lib/client/components/frames/widgetWire.svelte.ts`

Add to `WidgetWireOptions` (the only new name, recorded in NOMENCLATURE by the supervisor):

```ts
/**
 * The peer receives `{ t: "message" }` — one held row replaced by id (SDK
 * `componentWire.ts`) — so a push that changed exactly one row sends that row
 * alone. `ComponentMount` sets it (its worker runs the SDK's receiver); a
 * frame never does: an iframe has no receiver and keeps full lists.
 */
peerTakesOneMessage?: boolean
```

In `push()`'s `reads.has("messages")` branch, when `opts.peerTakesOneMessage` is true:
- keep, beside `sent`/`heldFrom`, the INPUT rows last delivered (`i.messages` array elements, by reference) and the
  `i.channels` it was delivered for (a plain variable, not `$state`, no reader tracks it). Clear it wherever `sent` is
  cleared (`ready`, `attach`) and after any full post re-record it.
- if a list was delivered before, the new `i.messages` has the same length, the same `id` at every index, the same
  `i.channels` (by value), and EXACTLY ONE index whose element is a different reference, and that row's `channel`
  (`?? "main"`) equals the delivered row's → post `{ t: "message", message: projectMessageRow(row) }` once (with
  `i.channels` set, only if the row's channel is one of them; otherwise post nothing — the widget does not hold it).
  Record the new input rows. No `messages`/`channel` list post.
- zero changed references (a push woken by another section) → post nothing for the log.
- anything else (first post, length/id/order change, channels change, two or more rows changed, a channel move) →
  today's full post, unchanged.
When `peerTakesOneMessage` is falsy the branch must be **byte-identical in behaviour to today** (every push posts the
full list). Never JSON-compare rows; never clone the log to decide. Update the branch's comment ("Posted as they are,
never diffed…") so it says what is true for both peers.

`src/lib/client/components/host/ComponentMount.svelte` — pass `peerTakesOneMessage: true` in its `createWidgetWire({…})`
call with a one-line comment (the remote's worker runs the SDK's `componentWire`, which receives it). Nothing else in
that file. `PluginFrame.svelte` and `RemoteWidget.svelte` are NOT changed (iframes keep full lists; RemoteWidget mounts
`ComponentMount`).

Tests: NEW `src/lib/client/components/frames/widgetWire.oneMessage.dom.test.svelte.ts`, modelled on
`widgetWire.perToken.dom.test.svelte.ts` (`WidgetWireFixture.svelte` takes `options`):
- with `options: { peerTakesOneMessage: true }`, 40 rows, then 10 streaming frames that replace only the last row's
  object (new content) → after the first full `messages` post, each frame posts exactly one `{ t: "message" }` whose
  row equals the projected new row, and NO `messages` post.
- same option: append a row → one full `messages` post; remove a row → one full post; reorder → full post.
- same option with `channels: ["main","side"]`: a frame on a `side` row → one `{t:"message"}`; a frame on a row of a
  channel not listed → nothing; a row whose channel moves → full `channel` posts.
- same option: `ready` again → the full list again, then the next frame is a single `message`.
- without the option: the same 10 frames → 10 full `messages` posts and no `message` post (today's behaviour).
Also run the existing: `npx vitest run src/lib/client/components/frames/ src/lib/client/components/host/` — dom tests,
in a capped scope (`systemd-run --user --scope -p MemoryMax=6G npx vitest run …`). Then
`npx tsc --noEmit -p . 2>&1 | grep -E "widgetWire|ComponentMount"` must print nothing; `npx prettier --check` on each
app file you touched (widgetWire and ComponentMount were unclean at HEAD: shape only your own lines). SDK `.ts` files:
match the surrounding style (tabs, single quotes, no semicolons).

## Files owned (edit only these)

`../serene-pub-sdk/sdk/src/componentWire.ts` (the new case + its comment), `../serene-pub-sdk/sdk/src/surfaces.ts` (doc
comment on the `message` member only), NEW `../serene-pub-sdk/sdk-tests/componentWireMessage.test.ts`,
`src/lib/client/components/frames/widgetWire.svelte.ts`, `src/lib/client/components/host/ComponentMount.svelte` (the
one option line), NEW `src/lib/client/components/frames/widgetWire.oneMessage.dom.test.svelte.ts`.

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
