# BRIEF — perf-M worker 1 — the app wire reads a frame's `ready.takes`

Supervisor: lane `perf-M` (report to it). Your report path: `plans/REPORT-perf-M-w1.md`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
Never pipe vitest into `head`. Run int and dom tests in a capped scope: `systemd-run --user --scope -p MemoryMax=6G npx vitest run <files>`.
Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk`. Never `prettier --write` a file that was unclean at HEAD.

(You do not run `sdk:build` at all: nothing you touch needs it — the wire reads `m.takes` off an untyped message.)

## Goal

Owner ruling ★M-1 (2026-11-14): "a frame may declare on its `ready` message that it takes single-row posts; a frame
that says nothing is unchanged." The SDK (worker 2, in parallel) adds an optional field to the frame→host `ready`
message: `{ t: 'ready', takes?: 'message'[] }`. When a peer's `ready` carries `takes` containing `'message'`, the
widget wire must behave exactly as if it had been built with `peerTakesOneMessage: true` (perf-H's rule, already in
the file): a streamed update — exactly one input row is a new object, it is generating (`isGenerating === true`),
and ids / order / channels are unchanged — posts that row alone as `{ t: "message", message }`; every other push
(settle, edit, add, remove, reorder, nothing moved) posts the full list(s). A frame that says nothing keeps full lists
forever, byte-identical to today.

## Files owned (edit only these)

- `src/lib/client/components/frames/widgetWire.svelte.ts` — ONLY: (a) one new wire-local variable + a tiny helper
  beside `deliveredLog` (~:225-235), (b) the two `opts.peerTakesOneMessage` reads inside `push()`'s messages branch
  (~:372 and ~:413), (c) the `ready` branch of `handle()` (~:577-589), (d) `attach()` (~:834-842), (e) the doc comment
  of `WidgetWireOptions.peerTakesOneMessage` (~:182-189), which now says something false ("a frame never does: an
  iframe has no receiver and keeps full lists"). Touch nothing else in this file (perf-N's hunks stay as they are).
- New test file `src/lib/client/components/frames/pluginFrame.oneMessage.dom.test.svelte.ts`.
- `src/lib/client/components/frames/widgetWire.oneMessage.dom.test.svelte.ts` — append one `describe` block only.

`PluginFrame.svelte` stays UNCHANGED (it only reads `wire.ready`). `ComponentMount.svelte` unchanged.

## Files readable

`PluginFrame.svelte`, `pluginFrame.dom.test.ts` (how a test stands in for the frame document: overriding
`iframe.contentWindow` and dispatching `load` to capture the port), `WidgetWireFixture.svelte`,
`widgetWire.oneMessage.dom.test.svelte.ts` (perf-H's test of the option), `plans/REPORT-perf-H-2026-11-13.md`.

## The change (shape fixed by the supervisor; wording of comments is yours, keep it plain)

```ts
/**
 * The peer declared on its `ready` that it takes `{ t: "message" }` (SDK `FrameHostMessage`
 * `ready.takes`, ★M-1 2026-11-14) — an iframe has no SDK-run receiver, so only its own word
 * turns the one-row post on. Read afresh on every `ready` (a replayed one without it turns it
 * off), cleared on a new port. A declaration of understanding, never a grant: nothing crosses
 * but the row the frame already receives in its lists.
 */
let peerDeclaredOneMessage = false
const takesOneMessage = () => opts.peerTakesOneMessage === true || peerDeclaredOneMessage
```
- `push()`: replace both `opts.peerTakesOneMessage` reads with `takesOneMessage()`. Nothing else in `push()` moves.
- `ready` branch: set `peerDeclaredOneMessage = Array.isArray(m.takes) && m.takes.includes("message")` BEFORE
  `push()` runs (beside `deliveredLog = null`). Unknown entries are ignored; a non-array is "said nothing".
- `attach()`: `peerDeclaredOneMessage = false` beside `deliveredLog = null`.
- Option doc: say `ComponentMount` sets it (its worker runs the SDK's receiver); a frame sets nothing here — it
  declares `takes: ['message']` on its `ready`, which has the same effect for that port (see the variable).

## Rules this work depends on (quoted by the supervisor)

- P1 (CLAUDE.md): "Deterministic, never hidden … Same inputs, same result." Lane rule: the settled row and every
  add/remove/reorder still arrive as the full list; **a frame that declares nothing sees byte-identical traffic to
  today (test it).**
- P5 / P3: a declaration from the plugin, never a host setting; no setting.
- "The frame boundary is a security boundary: nothing new crosses but the row the frame already received in lists."
  The `message` row goes through `projectMessageRow` (host fields such as `embedding`, `debugMeta`, `userId` stripped)
  exactly as list rows do — the existing code already does this; your test proves it for a declared frame.
- Hard rule: `$state(new Set())` / `new Map()` is not reactive on mutation. (The new variable is a plain `let`, read
  only inside `push()`; it must NOT be `$state` — no reader should track it.)
- "It is a session, never a chat" — in comments and test names.

## Tests to write

1. **`pluginFrame.oneMessage.dom.test.svelte.ts`** — mounts the real `PluginFrame` (copy the stand-in technique from
   `pluginFrame.dom.test.ts`; the frame's `ready` is posted by the test on the captured port, with or without
   `takes`). Feed `messages` reactively: `let msgs = $state.raw(rows)` and pass props with a getter
   (`get messages() { return msgs }`) so unchanged rows keep their reference — check this actually re-runs the push;
   if getter props don't work with `mount`, use a tiny fixture component, and say which in your report.
   Sequence, for BOTH a declaring frame (`{ t: "ready", takes: ["message"] }`) and a silent one (`{ t: "ready" }`):
   ready → 5 streamed frames on the last row (new object each, `isGenerating: true`, content growing) → settle
   (`isGenerating: false`) → add a row → remove a row. Record only the `messages` / `message` / `channel` posts and
   assert the whole sequence explicitly (`toEqual` on a mapped summary such as `["messages:3", "message:3:Hel", …]`,
   written out literally in the test — this is the "snapshot" the lane report quotes):
   - declared: `messages` (initial), 5 × `message`, `messages` (settle), `messages` (add), `messages` (remove);
   - silent: `messages` × 1 + 5 + 3, and each silent post's payload deep-equals the full projected list
     (byte-identical: compare `JSON.stringify` of each post with the expected list).
   Plus: a declared frame's `message` row has no host fields (give the row `embedding: [1,2]`, `debugMeta: {...}`
   and check they are absent); `takes: []` and `takes: ["something-else"]` and `takes: "message"` (not an array)
   behave as silent.
2. **Append to `widgetWire.oneMessage.dom.test.svelte.ts`** one `describe("declared on ready (★M-1)")` using the
   file's own `open()` with NO option: declared ready → a streamed frame is one `message`; a replayed `ready`
   without `takes` → the next streamed frame is the full list; `attach()` of a new port + silent `ready` → full
   lists; declared + `channels` where the generating row's lane is not held → nothing posted for it (as the option
   does). You may need to post the ready yourself instead of the helper's default silent one — extend the helper
   with an optional ready payload argument only if it stays backward compatible for the existing tests.

## Done means

- `systemd-run --user --scope -p MemoryMax=6G npx vitest run src/lib/client/components/frames/` — all green
  (report counts; this covers `frames/*` dom tests, `widgetWire*`, `spFrame*` if present there).
  Also run `src/lib/client/components/host/` the same way (ComponentMount still sets the option).
- `npx tsc --noEmit -p .` filtered to the files you touched: clean (`2>&1 | grep -E "widgetWire|pluginFrame"`).
- `npx prettier --check` on the two test files (must pass; the new file must be clean). `widgetWire.svelte.ts` was
  unclean at HEAD: do NOT `--write` it; hand-format your hunks to match the surrounding code (tabs, double quotes,
  no semicolons).

## Stop and ask (write it in your report and stop) when

Anything outside the files above would have to change; the getter/fixture approach can't make the PluginFrame test
deterministic; an existing test in `frames/` or `host/` goes red because of your change.

## Report

`plans/REPORT-perf-M-w1.md`: changed files with the hunks' line ranges, the two literal sequences your test asserts,
tests run with pass counts, anything you could not do, Noticed-not-done.
