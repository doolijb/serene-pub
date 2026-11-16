# BRIEF — perf-F worker w1 — the session store patches a streamed row in place

Repository root: `/home/jody/github/serene-pub`. Use absolute paths. Your supervisor is the `perf-F` lane. Report back in
your final message (the supervisor reads it); write no report file.

## Goal

While a reply streams, the server sends a `sessionMessage` socket frame about every 120 ms. Each frame carries the
**whole** row, with `content`, `metadata` (its `reasoning`) and `updatedAt` moved. The client calls
`sessionStore.upsertMessage(row)`, which does `messages.set(row.id, row)` (a `SvelteMap`). That replaces the row object,
so `messagesOf()` (and the page's `rows` derived) rebuilds a new array. Every derived reading the array then reruns and
scans all N rows, and so do the composed `session` object and everything that reads it (`sessionPageData.svelte.ts` ~100–103,
~401–418, ~432, ~459–476, ~482; `openSessionView.svelte.ts` ~14–21; `SessionHostViews.svelte` ~471–474).

Make a frame that patches a row the store already holds **keep the row object and the rows array identical**, so only
what reads one of that row's moved fields reruns. **Every value anyone reads stays exactly what it is today.** (Owner
2026-11-13: "change how often, never what".)

## Design (decided by the supervisor; follow it)

1. **Live rows** in `src/lib/client/sessions/store/sessionStore.svelte.ts`. Every row the store holds is a *live row*:
   a plain object (prototype `Object.prototype`) whose own fields are each an **enumerable, configurable getter**
   (no setter) over its own `$state.raw` cell. A small factory inside the file does this, e.g.
   `function cell<T>(v: T) { let s = $state.raw(v); return { get: () => s, set: (n: T) => { s = n } } }`.
   Getters keep every existing reader working: spread, `JSON.stringify`, `structuredClone`, `postMessage`,
   `$state.snapshot` and socket.io all read through `[[Get]]`. Keep the type as `SessionMessageRecord`.
   - The live row also carries a **non-enumerable** symbol-keyed getter over one more cell holding the latest plain
     incoming object (the "source"). Export `sourceOf(row)`, which returns it (or the row itself for a non-live
     object). Reading it tracks that one cell. The next worker uses it to reuse per-row projections. Name it in your
     report.
2. **Patch in place.** In `upsertMessage`, and wherever `load`, `merge` and `prependMessages` meet a row id the store
   already holds: when the incoming row has exactly the same own keys as the held one, set each field's cell, but only
   when the value differs. Primitives compare with `Object.is`. Objects and arrays use a structural deep-equal written
   in the file (JSON-shaped data, short-circuits on the first difference). Then set the source cell. Call **no**
   `messages.set` for a patched row. When the key sets differ, replace the row with a new live row (`messages.set`), as
   today.
   - `upsertMessage` keeps its return shape. `previous` must be a **plain snapshot** (`{ ...held }`) taken *before*
     the patch. `surfaceManager.witnessMessage(next, previous)` compares `previous.content` and
     `previous.isGenerating` with the new values (`sessionPageData.svelte.ts` ~1007–1024).
   - `merge`: `mergeRefreshedRows` (`refreshMerge.ts`, read only) returns held and incoming rows mixed. For each
     result: held and identical → keep; held under that id → patch or replace; new → a new live row. `added` returns
     the live rows. `windows` is rewritten only when the ids actually change. Today it is always rewritten, which is
     harmless but wakes `rows`. Keep the window object unchanged when the id list is equal.
3. **`rewindStateWith`** (`src/lib/shared/sessions/rewind.ts` ~139–175; only this function). Replace
   `[...messages].reverse().filter(...)` with one backward index loop that finds `newestStory`, `newestPerson` and
   whether any story-lane row has `id > takes.throughId`. Allocate nothing. Stop as soon as everything needed is
   known. The result must be identical for **every** input, including unsorted arrays: do not assume ids ascend.
4. Page deriveds: once 1–2 hold, re-check each derived in `sessionPageData.svelte.ts` ~100–103, ~392–482,
   `openSessionView.svelte.ts` ~14–21 and `SessionHostViews.svelte` ~466–476 against the counting test (below). Change
   one only if the test shows it still reruns on a content-only frame and you can make it stop without changing its
   value. Read narrower fields, or scan from the end. Do **not** touch markup or styling in `SessionHostViews.svelte`
   beyond the expressions at ~471–474, and do not touch its `import * as Icons` (another worker's concern, not
   yours: leave it).

## Counting test: write it FIRST, against the current code

New file `src/lib/client/sessions/store/sessionStore.streaming.svelte.test.ts`. Use `$effect.root` + `flushSync` with
the real `createSessionStore()` and the real `createOpenSessionView`. Build the page's derived chain with a counter in
each derived: `rows` (= `messagesOf`), the composed `session` object (`{ ...record, ...cast, sessionMessages: rows }`),
`lastMessage`, `hasGeneratingMessage` (`some(isGenerating)`), `generating` (`generatingOf`), `lastAuthorLine`
(`$lib/client/components/sessionPage/swipeControls`), `rewind` (`rewindOf`), `lorebookFixedOf`,
`lastSettledMessageKey`, plus openSessionView's `isGenerating` and `lorebookFixed`. Mirror the expressions in
`sessionPageData.svelte.ts` ~100–482. Load a session of 40 rows. The newest row must be `isGenerating: true` and carry
a `rewind` on the record, so `rewindOf` runs. Then deliver **50** `upsertMessage` frames for that row, each a fresh
object with longer `content`, a new `metadata` object (`{ reasoning: "…n" }`) and a new `updatedAt`, calling
`flushSync()` after each. Record every counter.
- Run it on the **unchanged** code first and put the numbers in your report as "before". Expected: about 50 reruns
  each.
- After your change, assert: the rows array is the same reference before and after the 50 frames; `rows`, `session`,
  `lastMessage`, `hasGeneratingMessage`, `generating`, `lastAuthorLine`, `rewind`, `lorebookFixed` run **0** more
  times; `lastSettledMessageKey` may rerun (it reads content); and every derived's final **value** equals what a
  fresh plain computation over plain copies of the rows gives. Add a case for a frame that changes a non-content field
  (`isGenerating: false`, the settle): the deriveds that read it rerun and their values are right. Add a case for a
  frame whose keys differ (replace path). Also test that `previous` is the pre-patch snapshot and that
  `sourceOf(row)` is the latest incoming object.

## Files owned (edit only these)

- `src/lib/client/sessions/store/sessionStore.svelte.ts`, `derive.ts`, `records.ts`, `openSessionView.svelte.ts`,
  and the tests beside them (new `sessionStore.streaming.svelte.test.ts`; you may adjust existing store tests only
  where they assert object **identity** (`toBe(row)`) that live rows change, never a value)
- `src/lib/client/components/sessionPage/sessionPageData.svelte.ts`, `sessionPageProjections.ts`,
  `SessionHostViews.svelte` (only the expressions at ~466–476)
- `src/lib/shared/sessions/rewind.ts`: `rewindStateWith` only

These files hold another session's fresh uncommitted work (`mergeRunStatus` keeps a `routine` field; the first-load
branch drops held routine runs; `rewind` carries an optional `step`). Build on what is on disk now. Re-read before
editing; never revert anything you didn't write.

## Files readable

Anything. In particular `refreshMerge.ts`, `pendingReply.svelte.ts`, `swipeControls.ts`,
`src/lib/client/surfaces/panelManager.svelte.ts` (`witnessMessage`), `src/lib/server/pipelines/runtime/liveRow.ts`
(what a frame carries).

## Rules that bind (quoted)

- CLAUDE.md Hard rules: "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`."
- CLAUDE.md Standing rulings: "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`."
- Sockets: "views register listeners for local state and never call `toaster`." Add no socket listener and no event.
- Lane ruling: "★P1 (delta frames) and ★P7 (lazy-loaded views) are unruled: no new event, and no view becomes lazy."
- CLAUDE.md Decisions: no new setting, flag, user-facing name or event. Internal helpers are fine; name each one in your report.
- The store's own rule (file header): "Every write runs untracked, so a caller inside an effect never subscribes to what the write reads. Reads are plain and tracked." Keep it.

## Stop and ask (stop, and report the question instead of deciding) when

- A derived can't stop rerunning without changing its value.
- A reader anywhere relies on a row's object identity changing in order to see new content. Grep
  `src/lib/client` for `untrack` and identity comparisons near rows before you finish, and list what you checked.
- You would need to edit a file outside the owned list.

## Done means

- Counting test before/after numbers in your report, and the test green after.
- Green: `npx vitest run src/lib/client/sessions/store/ src/lib/shared/sessions/ src/lib/client/components/sessionPage/sessionPageProjections*.test.ts src/lib/client/components/sessionPage/streamedSessionReads.test.ts src/lib/client/components/sessionPage/sessionStream.dom.test.svelte.ts src/lib/client/components/sessionPage/pendingReply*.test*.ts src/lib/client/components/sessionPage/castReadIsOwners.test.ts`
  (use the project's vitest config; if a path matches nothing, say so)
- `npx prettier --check` on every file you changed. `npx tsc --noEmit -p . 2>&1 | grep -E "sessions/store|sessionPage/(sessionPageData|sessionPageProjections|SessionHostViews)|shared/sessions/rewind"`
  prints nothing new.
- Report: changed files; the design as built; the helper names; before/after counts; tests run with results; what
  you grepped for identity reliance; anything noticed but not done.

## Verbatim rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report "blocked on your dev server". (You need no `sdk:build`; don't run one.)
- Never pipe vitest into `head`.
- Never `git checkout` / `restore` / `stash` in either repo.
