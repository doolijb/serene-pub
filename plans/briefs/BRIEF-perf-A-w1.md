# BRIEF — perf-A worker w1 — the content-only mirror, and the throttled message body

Repository root: /home/jody/github/serene-pub. Use absolute paths. Another Claude session and another worker (w2)
are editing other files in this checkout at the same time; touch ONLY the files below.

## Goal

Streaming a reply re-persists its row every 120 ms. Each persist runs the store's full mirror today. You add a
cheaper, opt-in mirror for mid-stream frames, and throttle the client's markdown render while a body streams.
The owner's rule for this whole plan (2026-11-13): **change how often, never what.** What a reader sees must stay
exactly as today.

## Files owned (edit only these)

- `src/lib/server/messages/store.ts` — ONLY `updateLegacyWhere` (~line 535) and a NEW private helper beside the
  mirror (~line 673+). Do not change `mirrorRow`, `upsertProjection`, `updateLegacy`, `insertLegacy` or anything else.
- `src/lib/client/components/hostElements/SpMessageBody.svelte`
- New test files: `src/lib/server/messages/store.contentMirror.int.test.ts`,
  optionally `src/lib/client/components/hostElements/spMessageBody.dom.test.svelte.ts` (or `.dom.test.ts`).

## Task 1 — `updateLegacyWhere(db, where, patch, opts?: { mirror?: "content" | "full" })`

- Default (`opts` absent, or `mirror: "full"`): exactly today's behaviour — every written row → `mirrorRow`.
  Every one of the ~17 existing callers passes nothing and must behave identically.
- `mirror: "content"`: for each written row, call a NEW private function (suggested name `mirrorShownRevision`)
  instead of `mirrorRow`. It:
  1. runs `projectLegacy(row)` — the SAME projection the full mirror uses (never build parts from `row.content`
     yourself: a row with swipes takes its shown text from `metadata.swipes.history[currentIdx]`, and the content
     mirror must write the same values the full mirror would);
  2. takes `shown = message.activeRevisions["0"]` and the parts whose `revision === shown`;
  3. ONE delete: this message's step-0 parts on revision `shown` with `ordinal < NATIVE_ORDINAL_BASE` and ordinal
     NOT IN the kept ordinals (so a reasoning part that went empty leaves, as the full mirror would make it);
  4. ONE upsert of the kept parts with the same `onConflictDoUpdate` target and `set` (`type`, `content`, `data`)
     `upsertProjection` uses (copy the clause; do not refactor `upsertProjection`).
  It skips: the `messages` row select and upsert, the select of existing parts, and every other revision.
  Write its doc comment: what it skips and why that is honest — it is for a mid-stream frame whose patch changes only
  `content` / `metadata.reasoning` (the row's `messages` fields — status, queue item, active revision, speaker — do
  not move mid-stream, and the settle write that always follows mirrors fully). Also add one sentence to
  `updateLegacyWhere`'s doc comment naming the option and that only the live row's frames use it.
- If `movesSpeaker(patch)` is true, ignore `"content"` and mirror fully (a speaker move is not a frame).
- The header of store.ts (lines 1–25) states every legacy write re-derives the new-model rows; leave it, the
  content mode still re-derives the text a reader can see.

## Task 2 — test `store.contentMirror.int.test.ts`

Pattern: copy the setup of `src/lib/server/pipelines/runtime/liveRow.reasoning.int.test.ts` (createTestDb,
createTestUser, a session, `insertLegacy` a generating placeholder; `vi.setConfig({ testTimeout: 60_000,
hookTimeout: 60_000 })`). Cover:
- content mode: after `updateLegacyWhere(db, where, { content: "abc", isGenerating: true }, { mirror: "content" })`
  the shown revision's `core:markdown` part reads "abc", and the parts equal what a full mirror of the same row
  writes (compare against `projectLegacy(row).parts` for that revision);
- a row with swipes (`metadata.swipes = { history: ["one", "two"], currentIdx: 1 }`): content mode leaves revision
  0's parts untouched and writes revision 1 as `projectLegacy` says;
- a reasoning part that becomes empty is deleted in content mode;
- default (no opts) still runs the full mirror: the `messages` row's `status` moves (e.g. patch
  `{ isGenerating: false }` → `messages.status === "settled"`).
- statement count: build a second drizzle handle over the same client with a logger, e.g.
  `drizzle(db.$client, { schema, logger: { logQuery: (q) => queries.push(q) } })` (import `drizzle` from
  `drizzle-orm/pglite`; check how `testDb.ts` builds its own), and record the number of statements one
  `updateLegacyWhere` issues in full mode vs content mode for the same streaming patch. Assert content < full and
  print both numbers (`console.log`) — put them in your report.

## Task 3 — `SpMessageBody.svelte`: markdown on a 50 ms throttle while streaming

Today `html` is `$derived` from `attrs.text` on every change. The element marks streaming with
`const streaming = $derived(flag(attrs.streaming))`.
- Not streaming: NO change — `html` derives synchronously from `attrs.text` exactly as now.
- Streaming: the rendered text updates at most every 50 ms, and a trailing update always lands (the last chunk is
  never left unrendered). When streaming ends, the full current text renders at once.
- Same HTML: the throttled path calls the same `renderMarkdownWithQuotedText` (+ `strictSanitize` for plugin
  owners). NO plain-text fallback.
- Suggested shape: `let shown = $state(attrs.text ?? "")`; a `$effect` that, while streaming, reads `attrs.text`,
  and either sets `shown` at once (≥50 ms since the last set) or schedules a `setTimeout` for the remainder, whose
  cleanup clears the timer; then `const source = $derived(streaming ? shown : (attrs.text ?? ""))` and `html` derives
  from `source`. Use `untrack` where an effect would otherwise read state it writes. Keep the last-set time in a
  plain variable, not `$state`.
- Optional test (`*.dom.test.svelte.ts` runs in happy-dom; see `spElement.dom.test.svelte.ts` for mount/flushSync):
  with fake timers, streaming text changes several times inside 50 ms render once, and the final text renders after
  the timer / when streaming turns off. Skip it if mounting the host element is disproportionate; say so.

## Rules (quoted from the canon; they bind you)

- CLAUDE.md Hard rules: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite
  silently." / "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`."
- CLAUDE.md Standing ruling: "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no
  `navigator.clipboard`."
- CLAUDE.md Decisions: do what was asked, at the size asked. Findings go under **Noticed, not done**, never fixed in
  passing. No option, hook or extension point nobody asked for. A new user-visible name, setting, event, migration,
  or a payload change is NOT yours to make: stop and report it.
- The mirror's contract tests `src/lib/server/messages/store.int.test.ts` and
  `src/lib/server/messages/rewindMirror.int.test.ts` must pass UNCHANGED. If one would have to change, stop and
  report.
- Style: tabs, no semicolons, double quotes (prettier). Comments explain why, in the file's existing voice.
- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report "blocked on your dev server". (You should not need `sdk:build`.)
- Never pipe vitest into `head`. An int test that opens a DB inside an `it` needs a 60 s timeout.
- Never `git checkout` / `restore` anything.

## Done means

From the repo root:
`npx vitest run src/lib/server/messages/store.contentMirror.int.test.ts src/lib/server/messages/store.int.test.ts src/lib/server/messages/rewindMirror.int.test.ts src/lib/server/messages/writes.int.test.ts`
green (plus your DOM test if written), and `npx prettier --check` on each file you changed. Do not run the whole
suite, `npm run check` or `tsc` over the repo (the lead does); you may run `npx tsc --noEmit -p .` once if you need
to, filtering its output to your files with grep.

## Report (your final message)

Changed files; tests run with results; the full-vs-content statement counts; anything you could not do as briefed and
why; **Noticed, not done**.
