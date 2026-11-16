# BRIEF — perf-A worker w2 — one persist in flight, content-only frames, recipients once per run

Repository root: /home/jody/github/serene-pub. Use absolute paths. Another Claude session and another worker (w1)
are editing other files in this checkout at the same time; touch ONLY the files below.

## Goal

While a reply streams, `createLiveRow` (`src/lib/server/pipelines/runtime/liveRow.ts`) persists and broadcasts the
row every 120 ms. Today each frame (a) fires `persist()` without awaiting the previous one, so persists overlap,
(b) runs the store's full mirror, and (c) re-queries the session roster before emitting. You make each frame do
less database work. The owner's rule for this whole plan (2026-11-13): **change how often, never what.** The frame's
visible result — the `sessionMessage` event carrying the full row, the status, the sidebar row — stays exactly as
today. The frame's event name and payload shape do NOT change (★P1, unruled).

## Files owned (edit only these)

- `src/lib/server/pipelines/runtime/liveRow.ts`
- `src/lib/server/sockets/utils/broadcastHelpers.ts` — **additive only**: new exports; do not change any existing
  function's body or signature.
- New test file: `src/lib/server/pipelines/runtime/liveRow.perframe.int.test.ts`

Not yours: `src/lib/server/messages/store.ts` — w1 is adding, in parallel,
`updateLegacyWhere(db, where, patch, opts?: { mirror?: "content" | "full" })` (default `"full"` = today). `"content"`
re-projects only the shown revision's `message_parts` (one delete of that revision's stale slots + one upsert) and
skips the `messages` row select/upsert, the existing-parts select and other revisions. Use that signature; if it is
not in store.ts yet when you need to run tests, finish everything else, then check again
(`grep -n "mirror" /home/jody/github/serene-pub/src/lib/server/messages/store.ts`); if still absent at the end,
report what you could not run.

## Step 0 — measure BEFORE you edit liveRow.ts

Write the counting harness of the new test first and run it against the unchanged `liveRow.ts`, to record today's
statements per persisted frame. Counting: pass `createLiveRow` a drizzle handle over the test DB's client with a
logger, e.g. `drizzle(db.$client, { schema, logger: { logQuery: (q) => queries.push(q) } })` (import from
`drizzle-orm/pglite`; see `src/lib/server/utils/testDb.ts`). Stream N chunks (e.g. 5) spaced > 140 ms so each is a
frame (no `io`, so no broadcast), count statements between frames, and record the per-frame number. Put the before
number in your report; the test file keeps the after assertion.

## Step 1 — one persist in flight (liveRow.ts)

Replace `let pending: Promise<void> | null` (overwritten per chunk, `:213`, `:382`, `:393`) with a dirty flag and a
single loop:
- a chunk or reasoning chunk marks dirty; if no persist is running and `STREAM_PERSIST_THROTTLE_MS` (120, unchanged)
  has elapsed since the last persist STARTED, the loop starts;
- the loop persists, and when that persist ends and the flag is dirty again AND the throttle has elapsed, it runs
  once more; otherwise it stops (the next chunk, or `flush`, picks it up — as a chunk inside the throttle window does
  today). Never two `persist()` calls at once from the stream; never more often than today's 120 ms;
- a persist error is swallowed as today (`.catch(() => {})`) and never wedges the loop (clear "running" in a
  `finally`);
- `flush()` and `finish()` await the running loop where they await `pending` today; `flush()` still persists the
  final text afterwards (`if (streamed || nativeReasoning)`). The fence (`fence(id)`) and the header comment's
  promises stay; update the comments that describe fire-and-forget overlap (`:381`, and the header if it says so).
- `onPhase` keeps firing from `persist` exactly as now.

## Step 2 — frames mirror content only (liveRow.ts)

`persist()` (the per-frame write, used by the loop AND by `flush()`) passes `{ mirror: "content" }` to
`updateLegacyWhere`. Every other write in this file keeps the default full mirror: `claim`, the release in `finish`,
and everything outside the file. Reason (write it in a comment): a frame's patch moves only `content` and
`metadata.reasoning` on a row that stays generating; the row always settles through a write that mirrors fully —
the outlet's update after `flush`, or `finish`'s release, or `persistGenerationErrorRow`.

## Step 3 — recipients once per run

In `broadcastHelpers.ts`, add beside `emitRedacted` (additive, exported, each with a doc comment in the file's
voice):
- `sessionMessageRecipients(sessionId: number, row: { channel?: string | null }): Promise<number[]>` — who a
  `sessionMessage` frame of this row reaches: `getSessionUserIds(sessionId)` (already in the file) narrowed by
  `laneScopedRecipients(db, sessionId, "sessionMessage", { sessionMessage: row }, ids)` (dynamic import, as
  `broadcastToSessionUsers` does), mapped to user ids. For `sessionMessage`, lane scoping only filters users and
  never varies the payload per user (read `src/lib/server/channels/lanePush.ts:37–51` to confirm), which is what
  makes a list reusable across frames of one row.
- `emitToRecipients(io, sessionId, event, data, recipients: () => Promise<number[]>)` — the same gate
  `broadcastToSessionUsers` applies first (`isGatedEvent` / `scopeOfPayload(event, data) ?? String(sessionId)` /
  `anyInterestAnywhere`; eager payload only, no LazyPayload), then `await recipients()`, then
  `emitRedacted(io, event, ids.map((userId) => ({ userId, data })), scope)`. The thunk is called only when the gate
  passes, so a session nobody watches costs no roster read at all.
In `liveRow.ts`, `announce` uses `emitToRecipients` with a memoised thunk: the first frame resolves
`sessionMessageRecipients(sessionId, row)` and later frames of the run reuse that promise (reset the memo if it
rejects, so one failed lookup does not silence the run). The announce after `finish`'s release resolves FRESH
through `broadcastToSessionUsers` as today (a guest added mid-reply sees the settled row). Keep the `announcing`
chain (ordering) and `broadcastSessionRow(io, sessionId)` exactly as they are. Do NOT cache inside
`broadcastToSessionUsers` — its other callers want the live roster.

## Step 4 — the test `liveRow.perframe.int.test.ts`

Setup: copy `liveRow.reasoning.int.test.ts` (createTestDb, createTestUser, session, `insertLegacy` generating
placeholder, `vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })`). Cases:
1. **Statements per frame after**: same harness as step 0; assert the per-frame count equals the new number and
   print before/after in a comment at the top of the test.
2. **Full mirror once**: stream N chunks (N ≥ 4, spaced > 140 ms), `flush()`, then `finish({ kind: "cancelled" })`.
   The full mirror ran exactly once. `vi.spyOn` cannot see `mirrorRow` called from inside `store.ts` (an ESM
   internal call), so count its signature instead: the full mirror's first statement is a select from `"messages"`
   by id (`upsertProjection`), which the content mirror never issues. Assert that signature appears once, and that
   the `message_parts` markdown part holds the final text after `flush` (content kept honest mid-stream) and the
   `messages.status` is `settled` after `finish`.
3. **A second caller still mirrors**: after that, call `updateLegacyWhere` (no opts) on the row and see the full
   signature again (and/or a `messages` field change).
4. **Recipients once**: in this file `vi.mock("$lib/server/sockets/utils/broadcastHelpers", …)` with
   `sessionMessageRecipients`, `emitToRecipients` (calling its thunk) and `broadcastToSessionUsers` as `vi.fn`s,
   and mock `$lib/server/sessions/rowPush` (`broadcastSessionRow` no-op); pass a fake `io` (`{} as any`). Stream N
   frames: `sessionMessageRecipients` called once; after `finish({ kind: "cancelled" })`, `broadcastToSessionUsers`
   called once with the released row. If other modules liveRow imports need exports from the mocked module, add
   them to the factory. If the mock forces a separate file to keep cases 1–3 honest, use
   `liveRow.recipients.int.test.ts` for case 4 (also yours).
5. **No overlap**: chunks arriving faster than a persist completes never run two persists at once (e.g. wrap the
   logger or `$client.query` to track in-flight `update "session_messages"` statements, max 1), and the final text
   lands after `flush()`.

## Rules (quoted from the canon; they bind you)

- CLAUDE.md Hard rules: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite
  silently." / "`socket.off(event)` with no handler removes every listener app-wide; always pass the handler."
- CLAUDE.md Standing ruling (Sockets): "one domain context per event family … is the only listener, and the only
  place that toasts … An event in `SCOPED_EVENTS` must carry its scope key (`sessionId`, `lorebookId`…) in the
  payload, or `emitToUser` silently sends nothing." Do not change what any event carries.
- CLAUDE.md P2: "A module owns its data and every write to it." The store stays the only writer of
  `session_messages` / `messages` / `message_parts`; liveRow writes only through `updateLegacyWhere`.
- CLAUDE.md Decisions: do what was asked, at the size asked. Findings go under **Noticed, not done**, never fixed in
  passing. No option, hook or extension point nobody asked for. A new socket event, a user-visible name, a setting,
  a migration or a payload change is NOT yours: stop and report it.
- Style: tabs, no semicolons, double quotes (prettier). Comments explain why, in the file's existing voice.
- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report "blocked on your dev server". (You should not need `sdk:build`.)
- Never pipe vitest into `head`. An int test that opens a DB inside an `it` needs a 60 s timeout.
- Never `git checkout` / `restore` anything.

## Done means

From the repo root:
`npx vitest run src/lib/server/pipelines/runtime/liveRow.perframe.int.test.ts src/lib/server/pipelines/runtime/liveRow.reasoning.int.test.ts`
(plus `liveRow.recipients.int.test.ts` if you made it) green, and `npx prettier --check` on each file you changed.
Do not run the whole suite, `npm run check`, or repo-wide `tsc` output unfiltered; you may run
`npx tsc --noEmit -p . 2>&1 | grep -E "liveRow|broadcastHelpers"` once.

## Report (your final message)

Changed files; the names of the new broadcastHelpers exports; tests run with results; statements per frame before
and after (and what the remaining ones are); anything you could not do as briefed and why; **Noticed, not done**.
