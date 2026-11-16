# BRIEF — perf-M worker 2 — SDK: `ready.takes`, and the component harness posts one row

Supervisor: lane `perf-M` (report to it). Your report path: `plans/REPORT-perf-M-w2.md` (in the APP repo,
`/home/jody/github/serene-pub/plans/`).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
Never pipe vitest into `head`. Run int and dom tests in a capped scope: `systemd-run --user --scope -p MemoryMax=6G npx vitest run <files>`.
Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk`. Never `prettier --write` a file that was unclean at HEAD.

**You do not run `sdk:build` at all** — the supervisor coordinates the one build with the lead. `sdk-tests` run
against the SDK sources (`tsx`), so you don't need a build to test.

## Goal

Owner ruling ★M-1 (2026-11-14): "a frame may declare on its `ready` message that it takes single-row posts; a frame
that says nothing is unchanged." Builds on ★P14 (2026-11-13): the `{ t: 'message' }` host→frame member exists,
`@experimental`, and the SDK's `componentWire.ts` already receives it (replace the held row by id in `messages` and in
every `channel` list holding it; unknown id ignored). Three pieces:

1. `sdk/src/surfaces.ts`: the frame→host `ready` member gains the optional field `takes`, and the docs around it.
2. `cli/src/testing.ts` (`mountComponent`, the component harness — it plays the PAGE and posts to a component in a
   Node worker): it must post a streamed update as `{ t: 'message' }`, exactly as core's `ComponentMount` does, so a
   plugin author's harness test exercises what core really sends. The harness does NOT read `takes` (a component's
   receiver is the SDK's `componentWire.ts`, which always handles `message`; core's `ComponentMount` posts it
   unconditionally).
3. `guides/frames.md`: one paragraph (+ two table cells) telling frame authors how to declare it and what then arrives.

## Files owned (edit only these; all in `/home/jody/github/serene-pub-sdk/`)

- `sdk/src/surfaces.ts` — the `ready` member of `FrameHostMessage` (~:383), the doc comment on the `{ t: 'message' }`
  member of `HostFrameMessage` (~:228-236), and the `FRAME_PROTOCOL` doc comment (~:455-470) by one sentence.
- `cli/src/testing.ts` — `pushSection` (~:845-877) and whatever file-local state it needs; the file's header doc
  comment by one sentence (what the page adds/keeps).
- `sdk-tests/surfaces.test.ts` — extend the existing `FrameHostMessage` read test (~:463-486) by one assertion.
- New `sdk-tests/componentHarnessMessage.test.ts`.
- `guides/frames.md` — the "Talking to Serene Pub" section only (~:55-130).

Not yours: `componentWire.ts`, `ComponentMount`, `ui-preview/**` (its `framePort.ts` is the frame preview harness —
note anything there under Noticed), `cli/src/scaffoldComponent.ts`, generated docs, NOMENCLATURE (the supervisor
records the name).

## 1. `surfaces.ts` — exact shape

```ts
export type FrameHostMessage =
	| {
			t: 'ready'
			/** …doc below… */
			takes?: 'message'[]
	  }
	| …
```
No named type alias (that would be a second new name). Doc comment content (wording yours, keep it plain and short):
- 🚧 The host messages this frame takes beyond the ones every frame gets — one entry today, `'message'`: declared,
  a streamed update to a row the frame already holds arrives as `{ t: 'message' }` (that one row, replaced by id),
  instead of the whole list again.
- What it is NOT: not a grant (it asks for nothing the frame is not already sent — the row is the same row the
  lists carry, under the same lane scoping) and not a read (it says nothing about which sections the frame wants).
- Absent, empty, or without `'message'`: full lists, always — exactly as before. Read on every `ready`: a replayed
  `ready` without it turns it off; a new port starts without it.
- A frame may ignore `message` only by not declaring it. A host that predates this field ignores it and keeps
  posting full lists, so a declaring frame still handles `messages` / `channel`.
- `@experimental` and `@ruling ★P14 (2026-11-13), ★M-1 (2026-11-14)` (match how other members cite rulings — look at
  the `@ruling` tags already in the file).

`{ t: 'message' }` member doc — replace the "an iframe (`PluginFrame`) always gets full lists" sentence. Say: a host
sends it only to a peer that takes it — a component's wire (core's `WidgetWireOptions.peerTakesOneMessage`), or a
frame that declared `takes: ['message']` on its `ready`. When: exactly one held row changed, it is still generating,
and ids, order and lanes are unchanged. Everything else arrives as full `messages` / `channel` lists: the row's first
appearance (a row joining the log is an add), every add / remove / reorder / lane move, and the settled row (no longer
generating). It only ever replaces a row the receiver already holds. (Do NOT write "the first frame of a run is
always a full list": a retake of a held row may stream as `message` from its first frame. Describe the rule as above.)

`FRAME_PROTOCOL` doc: one sentence — `ready`'s optional `takes` is part of 2; it needs no new version because a host
that does not read it keeps the old behaviour.

## 2. `testing.ts` — the rule the harness must post by

Mirror core's wire (`src/lib/client/components/frames/widgetWire.svelte.ts` `push()` messages branch, app repo,
readable), compared by CONTENT instead of by reference (a test author builds fresh objects; projected JSON per row is
fine at test scale):

- **`messages` push:** if the harness holds the last `messages` list it posted (projected rows), the new value is an
  array of the same length, every index has the same `id` and the same `channel ?? 'main'`, exactly ONE row's
  projected JSON differs, and that row has `isGenerating === true` → post `{ t: 'message', message: <projected row> }`
  and update the held list. Otherwise post the full `{ t: 'messages', messages }` exactly as today and hold it. A
  non-array value: post as today and drop the hold.
- **`channels` push** (`Record<channel, rows>`): the same channel keys in the same order, each list the same length
  with the same ids/channels, exactly ONE differing row across all lists, generating → one `{ t: 'message' }`.
  Otherwise the full `{ t: 'channel' }` posts exactly as today, held.
- Initial context goes through `pushSection` too, so the hold starts with the first post. A section the widget does
  not read is still never posted (the existing guard runs first) and holds nothing.
- Rows stay projected with `projectMessageRow` on BOTH roads (host bookkeeping stripped) — the boundary rule: nothing
  new crosses but the row the component already received in lists.
- No new public option, export or property on `MountedComponent`/`MountComponentOptions` (a new public name needs a
  ruling). File-local helpers only.

## 3. `guides/frames.md`

- In "What a frame can send", the `ready` row: mention `{ takes? }`.
- In the received-messages table, the `messages`, `message`, `channel` row currently says "one new message" for
  `message`, which is wrong: `message` replaces one message you already hold, and comes only if you declared it.
- One short paragraph (after the "What a frame can send" table, before "The older `action` message…"): how to
  declare (`port.postMessage({ t: 'ready', takes: ['message'] } satisfies FrameHostMessage)`), what then arrives
  (a streamed update as one row, replace it by `id` in your list and in any channel list holding it; adds, removes and
  the finished message still come as full lists), and that a frame that doesn't declare it gets full lists as before.
  If you add a code block, it is compiled by `sdk-tests/guideSnippets.test.ts` (see the `<!-- prelude: … -->`
  convention above the existing block) — run that test. Plain words, short sentences, "session" never "chat".

## Tests

- **New `sdk-tests/componentHarnessMessage.test.ts`** (`node:test` + `node:assert/strict`, import `mountComponent`
  and `test` from `./harnessGuard.js`; copy the temp-root setup pattern from `componentHarnessPage.test.ts` ~:1-60).
  A tiny component that renders each message's `id:content` (and reads `messages`). Capture what the harness posts by
  spying on `MessagePort.prototype.postMessage` from `node:worker_threads` (restore it after) — no new harness API.
  Cases: (a) a streamed update to the last row (`isGenerating: true`, new content) → exactly one `{ t: 'message' }`
  post, no `messages` post, and the mirrored DOM shows the new content (componentWire replaced by id);
  (b) 5 streamed frames → 5 `message` posts; (c) settle (`isGenerating: false`) → `messages`; (d) an add, a remove,
  an id change, two rows changed at once → `messages` each; (e) the `channels` section: a streamed update → one
  `message`, the component's channel list shows it; a lane move → full `channel` posts; (f) a `message` row is
  projected (give the pushed row a host field from `MESSAGE_HOST_FIELDS` — grep for it — and assert it is absent).
- **`sdk-tests/surfaces.test.ts`**: the existing `read(m: FrameHostMessage)` test accepts `{ t: 'ready', takes:
  ['message'] }` (a compile-time + runtime check that the field is optional and typed).
- Run: from `/home/jody/github/serene-pub-sdk/sdk-tests`:
  `systemd-run --user --scope -p MemoryMax=6G npx tsx --test componentHarnessMessage.test.ts componentHarnessPage.test.ts componentWireMessage.test.ts surfaces.test.ts framePort.test.ts guideSnippets.test.ts receiverRules.test.ts`
  plus two existing harness-heavy files that push generating rows if you find any (`grep -l "isGenerating" *.test.ts`
  among the files that call `mountComponent`; run up to 4 of them and name them).
  And `npx tsc --noEmit -p .` in `sdk-tests` (slow, ~4 min: run it once at the end, `systemd-run` capped too).
- `npx prettier --check` from `/home/jody/github/serene-pub-sdk` on the new test file (must pass). `surfaces.ts`,
  `testing.ts`, `guides/frames.md`, `surfaces.test.ts` may be unclean at HEAD — check first; do NOT `--write` an
  unclean file; hand-format your hunks to match (tabs, single quotes, no semicolons).

## Rules this work depends on (quoted by the supervisor)

- P1: "Deterministic, never hidden." Lane rule: the settled row and every add/remove/reorder still arrive as the
  full list.
- P5 / P3: a declaration from the plugin, never a host setting. No setting, no option.
- "The frame boundary is a security boundary: nothing new crosses but the row the frame already received in lists."
- "Removing or renaming a published SDK name is the owner's call — this lane only adds." Do not rename or remove
  anything; the only new name is the field `takes` on `ready` (ruled by ★M-1; the supervisor records it).
- NOMENCLATURE R3 "qualify, never the bare noun"; §24 step 5 "Say what it is **not**, in the declaration, if a
  near-neighbour exists" — hence the not-a-grant / not-a-read lines.
- "It is a session, never a chat."

## Stop and ask (in your report, then stop) when

The `ready` member cannot take the field without breaking an existing consumer (a `switch` that destructures it, a
`satisfies` on an exact type…) — name the consumer; any existing test goes red because the harness now posts
`message`; anything outside the owned files must change.

## Report

`/home/jody/github/serene-pub/plans/REPORT-perf-M-w2.md`: changed files with line ranges, the final `ready` type and
its doc comment verbatim, tests run with pass counts, the prettier state of each file before/after, anything you
could not do, Noticed-not-done.
