# REPORT — lane `perf-A` — 2026-11-13

Brief: `plans/briefs/BRIEF-perf-A.md`. Workers: `plans/briefs/BRIEF-perf-A-w1.md` (store mirror, message body) and
`plans/briefs/BRIEF-perf-A-w2.md` (liveRow, recipients). I checked both workers' diffs against their briefs and fixed
two small things myself (below). Nothing is committed.

**Result:** a streamed frame now costs **3 database statements instead of 5**. The roster is read **once per run instead
of 2–3 times per frame**. Persists no longer overlap. The client renders markdown at most every 50 ms while a body
streams. Every frame still goes out as `sessionMessage` with the full row. No event, payload, name, setting or migration
changed.

## Changed files

| file | change |
|---|---|
| `src/lib/server/pipelines/runtime/liveRow.ts` | Step 1: `pending` replaced by a `dirty` flag, a `running` promise and a `kick()` loop. At most one persist runs at a time, the 120 ms throttle is measured from when a persist starts, errors are swallowed, and `running` is cleared in a `finally`. `flush()` and `finish()` await `running`. Step 2: `persist()` (frames and `flush`) passes `{ mirror: "content" }`. Step 3: `announce` sends frames through `emitToRecipients` with a run-memoised `sessionMessageRecipients` thunk, which is reset if it rejects. The announce after `finish`'s release calls `broadcastToSessionUsers` fresh. The `announcing` chain and `broadcastSessionRow` are unchanged. |
| `src/lib/server/messages/store.ts` | `updateLegacyWhere(db, where, patch, opts?: { mirror?: "content" \| "full" })`. The default stays the full mirror, so all ~17 existing callers are unchanged. `"content"` calls a new private `mirrorShownRevision`: it runs the same `projectLegacy`, then issues one delete of the shown revision's stale step-0 slots below `NATIVE_ORDINAL_BASE` and one upsert of that revision's parts. A patch that moves the speaker always gets the full mirror. `mirrorRow`, `upsertProjection` and every other function are untouched. `notInArray` was added to the drizzle import. |
| `src/lib/server/sockets/utils/broadcastHelpers.ts` | Additive only. **New exports:** `sessionMessageRecipients(sessionId, row): Promise<number[]>` (`getSessionUserIds` narrowed by `laneScopedRecipients`) and `emitToRecipients(io, sessionId, event, data, recipients: () => Promise<number[]>)` (the same interest gate as `broadcastToSessionUsers`, then the thunk, then `emitRedacted`). No existing function changed. |
| `src/lib/client/components/hostElements/SpMessageBody.svelte` | While `streaming`, the render source is a `shown` state that a `$effect` updates at most every 50 ms; a trailing timer always lands the last text. When not streaming, the source is `attrs.text` directly, as today. It uses the same `renderMarkdownWithQuotedText` and `strictSanitize`, with no plain-text fallback. I added one thing: while idle the effect keeps `shown` in step with the text and resets the clock. Without that, a stream starting within 50 ms on the same body could show the previous stream's text for one tick. |
| new `src/lib/server/messages/store.contentMirror.int.test.ts` | 5 tests: content mode writes the shown revision exactly as `projectLegacy` says; a swiped row leaves revision 0 untouched; a reasoning part that goes empty is deleted; the default still runs the full mirror (`messages.status` moves); statement count full 5 vs content 3. |
| new `src/lib/server/pipelines/runtime/liveRow.perframe.int.test.ts` | 3 tests: 3 statements per frame (`[3,3,3,3,3]` over 5 frames); a reply of N chunks + `flush` + `finish(cancelled)` runs the full mirror **once**, at the release; after `flush` the `core:markdown` part holds the final text and after `finish` `messages.status` is `settled`; a second `updateLegacyWhere` caller still mirrors fully; never two in-flight `update "session_messages"`, and the final text lands after `flush`. |
| new `src/lib/server/pipelines/runtime/liveRow.recipients.int.test.ts` | 1 test: `sessionMessageRecipients` is called once over 4 frames; `broadcastToSessionUsers` is called once, with the released row, after `finish`. It is a separate file because its `vi.mock` would distort the perframe cases. |
| new `src/lib/client/components/hostElements/spMessageBody.dom.test.svelte.ts` | 3 tests (happy-dom, fake timers): changes inside 50 ms render once and the trailing text lands; turning streaming off renders the full text at once; when not streaming, every change renders at once. |

**"mirrorRow once (spy)":** `vi.spyOn` cannot see `mirrorRow` when it is called from inside `store.ts` (an internal ESM
call). The test counts the full mirror's signature instead: its first statement is a `select … from "messages" where`
(from `upsertProjection`), and the content mirror never issues that. The intent is the same.

## Tests run

- `npx vitest run src/lib/server/pipelines/runtime/liveRow.reasoning.int.test.ts src/lib/server/messages/store.int.test.ts src/lib/server/messages/rewindMirror.int.test.ts src/lib/server/messages/writes.int.test.ts src/lib/server/pipelines/runtime/liveRow.perframe.int.test.ts src/lib/server/pipelines/runtime/liveRow.recipients.int.test.ts src/lib/server/messages/store.contentMirror.int.test.ts src/lib/client/components/hostElements/spMessageBody.dom.test.svelte.ts`: **8 files, 47 tests passed.**
  - `store.int.test.ts` and `rewindMirror.int.test.ts` (the mirror's contract) pass **unchanged**.
- After the type fixes I re-ran `store.contentMirror`, `liveRow.perframe` and `rewindMirror`: 3 files, 10 tests passed.
- `npx tsc --noEmit -p . | grep` on the lane's files: **clean**. The peer session's heads-up flagged two errors: store.ts `notInArray` received `(number | undefined)[]`, and the test's sort used possibly-undefined `ordinal`. I fixed both with `?? 0`; `projectLegacy` always sets `ordinal`, and the field is optional only on the insert type.
- `svelte-check` was not run (left for the lead's grouped verification). `SpMessageBody.svelte` is covered by the DOM test.
- `npx prettier --check`: clean on `SpMessageBody.svelte` and all four new test files.
  - `store.ts`, `liveRow.ts` and `broadcastHelpers.ts` already failed `--check` at `HEAD`. I diffed prettier's output against each file and brought every **new** hunk to prettier's form. The rest of the drift is pre-existing, and I did not reformat it, so the diff stays reviewable.
  - One borderline line: store.ts:27, the drizzle import, which was already too long at HEAD and gained `notInArray`.
- One `/tmp/serene-pub-vitest-*` dir appeared during my run (`h1AdYB`). The peer session's `fireTurn` vitest was running at the same moment, so I can't tell it is mine and left it.

## Statements per frame (Drizzle logger, no `io`)

- **Before: 5.** The `session_messages` update, then the full mirror: `messages` select, `messages` upsert, `message_parts` select, `message_parts` upsert.
- **After: 3.** The `session_messages` update, then the content mirror: one delete of stale slots on the shown revision and one `message_parts` upsert.
- **Roster** (not in the counts above, because the harness has no `io`): before, every frame that passed the interest gate cost the owner query, the guests query and, on a personal lane, the lane-readers query. After, the first frame costs those 2–3 queries and later frames cost 0. The settled row's announce reads the live roster as before.
- The delete is there to stay honest: it removes a reasoning part that went empty. The full mirror would remove it too, and skipping it would leave a stale part until settle. Dropping it would make 2 statements per frame. I kept it.

## Step 2: every reader that can see a generating row, and what it reads

This comes from a read-only sweep of every server reader of `messages` / `message_parts`. **No reader sees anything
different mid-stream.** Most readers read only identity columns of `messages` (id, sessionId, createdAt, role, channel,
speaker ids, rewindOrdinal). These are written by the placeholder's full mirror and don't move while a reply streams:
`createdAt` is not in the upsert's `set`. No server code reads `messages.status`, `queueItemId`, `updatedAt`, `error` or
`extras` as a column.

| reader | reads | sees generating rows? | affected? |
|---|---|---|---|
| `messages/store.ts` `attachParts` (callers: `sockets/sessions.ts` load / refresh / send, `host.ts`, `fireAction.ts`, `sessions/tableLine.ts`, `sessions/goalsReached.ts`, `sockets/attachments.ts`, `speech/onMessageSettled.ts`) | full `messages` row + all parts, every revision | **yes** (session load mid-stream) | no: the shown revision's parts stay fresh, other revisions and the `messages` row don't move mid-stream |
| `messages/store.ts` `getMessage` (via `appendParts`, `appendStep`, `host.ts` attach-media) | row + parts, picks `activeRevisions[step]` | can | no: `activeRevisions` doesn't move mid-stream |
| `attachments/history.ts:44-80` | native attachment parts (ordinal ≥ 10), filtered by `activeRevisions` | in principle | no: native range untouched |
| `pipelines/runtime/host.ts:1212-70` (`replaceSpokenAudio`) | full row + `core:audio` on the active revision | normally after settle | no |
| `attachments/references.ts`, `attachments/tray.ts`, `sockets/media.ts`, `messages/blocks.ts`, `sessions/seatKeys.ts` | parts by `data.assetId` / `data.blocks` (native) | yes | no: mirror parts carry neither |
| `annotations/index.ts`, `bindingSuggestions/index.ts`, `utils/sceneMentions.ts` | `messages` as a join; text from `session_messages` | yes | no |
| `annotations/queue.ts` | id / sessionId / rewindOrdinal | no (filters `isGenerating = false`) | no |
| `scenes/boundaryWatcher.ts`, `scenes/liveScenes.ts`, `state/resolve.ts` | `messages.createdAt` (+ speaker ids, rewindOrdinal) | yes | no: fixed at insert |
| `rulesets/rounds.ts` | counts by role / channel / rewindOrdinal | yes | no |
| `lorebooks/ownBook.ts`, `sessions/dcCairns.ts`, `state/write.ts`, `utils/forkHistory.ts`, `sockets/narrativeGraph.ts`, `sessions/rewind.ts` | id / sessionId / speaker ids / rewindOrdinal | yes, or on user action | no |
| `attachments/remove.ts`, `attachments/send.ts`, `sessions/branch.ts` | user actions, native parts | no | no |

Why the split is safe:
- Only `liveRow`'s `persist` asks for `"content"`. The regenerate, extend and swipe writes also set `isGenerating: true`, but they move `activeRevisions` and the swipe set, so they keep the default full mirror. The mode is chosen by the caller, never by "the row is generating".
- The content mirror reuses `projectLegacy`. A swiped row's shown text therefore still comes from `swipes.history[currentIdx]`, exactly as the full mirror writes it today.
- Every way a reply settles mirrors fully: the outlet's update after `flush`, `finish`'s release, `persistGenerationErrorRow`, the client's cancel, and the derelict sweep (`sessions/derelictReplies.ts`, via `updateLegacyWhere` with the default).

## Decisions I made (name them; none is a ★ in my reading)

1. **`flush()` uses the content mirror too**, which differs from the brief's literal wording: "The final save path (`finish`, and the flush before it) always mirrors fully, once".
   - Why: `flush` leaves the row generating, so it is a frame. The host always follows it with a write that mirrors fully (`host.ts:7594`, then the outlet's update; or `finish`).
   - If `flush` also mirrored fully, the ok path would mirror fully twice, and the brief's "N chunks → mirrorRow once" test could not pass.
   - The settle still mirrors fully, exactly once.
2. **`broadcastToSessionUsers` is left untouched** ("additive only"). The new `sessionMessageRecipients` reuses the existing `getSessionUserIds` and `laneScopedRecipients`, so the roster rule is not duplicated.
   - It is specific to `sessionMessage`, because only for that event does lane scoping filter users without varying the payload (`channels/lanePush.ts:46-51`). That is what makes the list safe to reuse across frames.
3. **The frame loop stops** when the row is dirty but the throttle hasn't elapsed. The next chunk or `flush` picks it up, which matches today's behaviour for a chunk inside the window, and no timer was added. Cadence is therefore max(120 ms, persist duration).

## Open ★

- None raised by this lane's build. ★P1 (the delta frame) is untouched, as briefed.
- **For the owner, from step 3:** the plan's W1-b said recipients are "invalidated by guest and lane changes". The brief rules "once per run, fresh at the end". As a result, **a guest removed (or a lane reader dropped) mid-reply keeps receiving that one reply's frames until it settles.** The settled row goes to the live roster.
  - If the owner wants removal to cut the stream at once, the fix is small: clear the memo when guests or lanes change for that session. That needs a hook from the guest and lane writers, which is outside this lane's files.

## Noticed, not done

- `emitRedacted` still deep-walks every frame's payload in `withoutConnectionIdentity` (`broadcastHelpers.ts:96`). This is B2's other half. It wasn't in this lane's build list, and removing it per run would mean caching a redaction decision.
- `flush()` persists once more after awaiting the loop, so the final frame can be written twice with identical content if the last loop persist already carried it. This also happens today.
- While a reply streams, the content mirror leaves `messages.updatedAt` as of the last full mirror. No reader uses it, and the settle rewrites it.
- `store.ts`, `liveRow.ts` and `broadcastHelpers.ts` already fail `prettier --check` at HEAD, and a `--write` on any of them touches unrelated lines.
- `persistGenerationStatus` (the status line) still broadcasts with the live roster for each status change. That is per status, not per frame, so it's out of scope.

Relayed status question: none received.


---

## Lead's acceptance note (2026-11-13)

Scope review: in scope, four low/medium findings. Resolution:

- **Recipients memo moved into `broadcastToSessionUsers`** (lead edit, after the lane reported). 106 test files mock
  `$lib/server/sockets/utils/broadcastHelpers` with a factory that predates any new export, and `runStatus.int.test.ts`
  failed on `emitToRecipients` the moment `liveRow` imported it. So the two new exports (`sessionMessageRecipients`,
  `emitToRecipients`) are gone; `broadcastToSessionUsers` takes an optional fifth argument
  `{ recipients?: SessionRecipientsMemo }` (`{ value: Promise<...> | null }`, owned by the caller), fills it on the first
  broadcast that passes the gate and reuses it after; `liveRow` passes one memo per run for frames and none for the
  released row. The frame path therefore goes through the original interest gate again (scope-review finding 1 moot,
  finding 4 moot), every old mock keeps working, and `liveRow.recipients.int.test.ts` asserts the memo's identity across
  frames and its absence on the release. Re-run after the change: `runStatus.int.test.ts`, `liveRow.recipients`,
  `liveRow.perframe`, `liveRow.reasoning`, `store.contentMirror` — 5 files, 22 tests passed.
- **`flush()` uses the content mirror** (finding 2): accepted as the lane decided; every settle path that follows
  mirrors fully, and the brief's own "mirrorRow once" test requires it.
- **Noticed, not done** (finding 3, added): `mirrorShownRevision` restates the parts-address predicate and the parts
  upsert's conflict target from `upsertProjection` (`store.ts` ~716, ~730–740 vs ~840, ~859–869) — a later pass that
  owns `upsertProjection` should extract one shared parts-upsert helper; the store header's "Re-projection is
  wholesale" (`store.ts:12–15`) and the "Streaming fires overlapping `updateLegacyWhere` calls" comment (~818–821) are
  now stale and sit outside the lane's owned range.
- **For the owner (now a ★, P12):** a guest removed mid-reply keeps receiving that reply's remaining frames until it
  settles, because the recipient list is read once per run. ★ Recommend: accept for 0.6 (the window is one reply;
  the released row already asks the live roster); the alternative is an invalidation hook in the guest and lane
  writers.
