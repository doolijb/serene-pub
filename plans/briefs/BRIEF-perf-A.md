# BRIEF — build lane `perf-A` — streaming writes and broadcasts once per settle, not once per frame

**You are a lane supervisor.** Read `.claude/guides/multi-agent.md` first. Then: `plans/PLAN-performance-2026-11-13.md`
Part 1 and W1; `plans/REVIEW-performance-2026-11-13.md` rows B1, B2, B3; CLAUDE.md Principles, Hard rules (PGlite
transaction rule, sockets rule) and Standing rulings; `docs/sessions.md` ~60–75 (what a person sees while a reply
streams). Line numbers below are from 2026-11-13; re-read before editing.

## Rulings that bind

- Owner 2026-11-13: the plan's one rule — change how often, never what. A frame's visible result (the text a member
  sees growing, the status line, the sidebar row) stays exactly as today.
- Sockets: one domain context per event family is the only listener and the only place that toasts (CLAUDE.md).
- ★P1 (the mid-stream delta frame) is **unruled**. This lane does NOT change the frame's event or payload shape.
  Frames keep going out as `sessionMessage` with the full row. What this lane removes is the per-frame database and
  roster work behind that frame.

## What is true today

- `pipelines/runtime/liveRow.ts:72` throttles persists to 120 ms; `:375–393` fire `pending = persist()` without
  awaiting the previous one, so persists overlap (`messages/store.ts:759–761` says so).
- `persist` (`liveRow.ts:292–316`) calls `updateLegacyWhere` (`store.ts:535–551`), which always runs `mirrorRow`
  (`:673`) → `upsertProjection` (`:697`): a select, an upsert, a parts select, deletes, and an upsert of every part
  of every swipe revision. Per frame.
- `announce` (`liveRow.ts:254–268`) calls `broadcastToSessionUsers` (`sockets/utils/broadcastHelpers.ts:230–275`),
  which per call queries the session owner, the guests, and `laneScopedRecipients`, then deep-walks the payload
  in `withoutConnectionIdentity` (`:96`).
- Client: `client/components/hostElements/SpMessageBody.svelte:27–30` derives `marked.parse` + `DOMPurify` from the
  whole text on every change; `client/utils/markdownToHTML.ts:40–49`.

## Build

1. **One persist in flight.** In `liveRow.ts`, replace the overwritten `pending` with a dirty flag and a single loop:
   a chunk marks dirty; if no persist is running and the throttle has elapsed, one starts; when it ends and the flag
   is dirty again, it runs once more. `flush()` and `finish()` await the loop, as they await `pending` today, and
   still persist the final text. The 120 ms throttle and the fence stay.
2. **Mirror: honest content per persist, parts on settle.** The store's rule (`messages/store.ts:1-25`) is that every
   legacy write re-derives the `messages` / `message_parts` rows, and readers of those tables exist today
   (`state/resolve.ts`, `messages/liveHistory.ts`, `sessions/rewind.ts`, `scenes/boundaryWatcher.ts` — grep for
   more). **First list, in your report, every reader that can see a row still generating and what it reads.** Then
   do the smallest honest thing: the mid-stream persist still updates the `messages` row's content (and reasoning
   metadata) so no reader sees stale text, but skips the per-revision `message_parts` re-projection
   (`upsertProjection`, `store.ts:697`) until the settle, if `upsertProjection` can be split that way behind an
   option on `updateLegacyWhere` (e.g. `{ mirror: "content" | "full" }`, default today's full). If it cannot be split
   without touching a reader's expectations, keep the full mirror per persist and say so: step 1 alone still removes
   the overlap. The final save path (`finish`, and the flush before it) always mirrors fully, once.
   `rewindMirror.int.test.ts` and `store.int.test.ts` define the mirror's contract and must pass unchanged.
3. **Recipients once per run.** In `liveRow.ts`, resolve the recipient list the first time `announce` runs and reuse
   it for the run's frames; the final announce after `finish` resolves fresh (a guest added mid-reply sees the
   settled row). Do this *inside* liveRow (a memoised thunk handed to a broadcast helper that accepts precomputed
   recipients), not by caching inside `broadcastToSessionUsers`, whose other callers want the live roster. If
   `broadcastHelpers.ts` needs a new exported entry point for "emit to these recipients", add it beside
   `emitRedacted` and name it in the report.
4. **Markdown on a throttle while streaming.** In `SpMessageBody.svelte`, while the element carries the streaming
   attribute (find how the host marks it; `grep -n "data-streaming\|streaming" src/lib/client/components/hostElements`)
   re-render at most every 50 ms and once more when streaming ends. No change when not streaming. Plain-text fallback
   is NOT wanted: the throttled render keeps the same HTML.

## Files owned

`src/lib/server/pipelines/runtime/liveRow.ts` · `src/lib/server/messages/store.ts` (only `updateLegacyWhere` and
its mirror call) · `src/lib/server/sockets/utils/broadcastHelpers.ts` (additive only) ·
`src/lib/client/components/hostElements/SpMessageBody.svelte` · new/changed tests beside those files.

**Not yours, another session is editing them:** `src/lib/client/sessions/store/sessionStore.svelte.ts`,
`src/lib/client/components/sessionPage/sessionPageData.svelte.ts`, anything under `src/lib/server/scenes/`,
`src/lib/server/pipelines/routines/`. Do not open them for writing.

## Files readable

Everything. `docs/sessions.md`, `messages/projectLegacy.ts`, `channels/lanePush.ts`, `sessions/rowPush.ts`.

## Out of scope

The delta frame (★P1). The client store deriveds (B5). Widgets (B4). Any change to what a frame carries.
`broadcastSessionRow` debounce. Anything in `sockets/sessions.ts`.

## Stop and ask when

A step needs a new socket event, a new name a user sees, a migration, or a change to a payload shape; a test that
defines the mirror's contract has to change to pass; `updateLegacyWhere` cannot skip the mirror without touching a
caller outside your files.

## Done means

`npx vitest run src/lib/server/pipelines/runtime/liveRow.reasoning.int.test.ts src/lib/server/messages/store.int.test.ts
src/lib/server/messages/rewindMirror.int.test.ts src/lib/server/messages/writes.int.test.ts` green, plus one new test:
a streamed row with N chunks runs `mirrorRow` once (spy), and a second `updateLegacyWhere` caller still mirrors.
`npx prettier --check` on each changed file. Report the per-frame statement count before and after (count queries
with a Drizzle logger in the new test), and the reader list from step 2.

## Report path

`plans/REPORT-perf-A-2026-11-13.md`: changed files, tests run with results, the before/after statement count, open ★,
**Noticed, not done**.

## Verbatim rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report "blocked on your dev server".
- Never pipe vitest into `head`. An int test that opens a DB inside an `it` needs a 60 s timeout.
- Inside `db.transaction(async (tx) => …)` use only `tx`.
- At most 2 workers at once. Workers get these rules inline.
