# BRIEF — worker `gs-2a-w1` (server + its tests): an administrator inside someone else's session is a guest (G6); a reply's compiled prompt (`debugMeta`) is the session owner's (G5)

Repo `/home/jody/github/serene-pub` (app). Supervisor: lane `gs-2a`. You type the server half and its tests. No SDK change.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build` here: don't run one.)

Also: never `git checkout / restore`; never `prettier --write`; no migration; inside `db.transaction(async (tx) => …)` use only `tx`. Lane `tm-1` is editing `pipelines/runtime/host.read.sessionCast.ts`, `pipelines/prompt/assemble.ts`, `scenes/earlierScenes.ts`, `state/statTrail.ts`, `lorebooks/loreMatch.ts`, `tools/coreTools.ts`: never edit those. Re-read any file right before editing it (other lanes edit nearby files).

**Tests only like this**, one run at a time, each preceded by the wait:
```
until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/gs-2a-w1-<n>.log 2>&1"
```
Never pipe vitest into `head`. `tsc`: `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` (report errors in your files only; errors in `tm-1`'s files are in flight). No full test run, no `npm run build`.

## The rulings (owner, 2026-11-16) and the lead's reading

- G6: "In another person's session an administrator is a guest."
- G5: "The session's owner and administrators only." Read together with G6 (lead's reading, recorded as D64): inside a session, a reply's prompt is the **owner's**; an administrator reads any run, prompt included, from the **administrator** run inspector (R55), never from inside someone else's session.
- Standing: enforce at the server, not by hiding in the client.
- `utils/sessionAccess.ts` `checkSessionAccess` gives **owner**, **guest** (a `session_guests` row) or **no access**. There is no administrator bypass and none is added. "An administrator is a guest" means: where a handler lets someone in through `checkSessionAccess` and then adds `|| isAdmin`, that addition goes, so an administrator who is a guest gets exactly a guest's answer.
- **Not touched:** administrator tools that take a `sessionId` only as a filter: `receiptsAdminOnly` (`sockets/pipelines.ts` ~672, run inspector, R55), `pipelines:eventMap`, the admin session list, diagnostics, the support report.

## Files owned (edit only these, only where named)

1. `src/lib/server/sockets/pipelines.ts` — **`viewerFor` and `readerFor` only** (~131–170, and their doc comments).
   - `readerFor`: with a `sessionId`, the reader is `"owner"` or `null` (an administrator who does not own that session is `null`, refused with the existing `noReaderSentence(sessionId)` like a guest); without a `sessionId`, unchanged (administrator or `null`). `pipelineReaderOf` lives in `pipelines/config/panel/scopes.ts`, **not your file**: do not edit it; express the rule in `readerFor` (e.g. pass `isAdmin: isAdmin && sessionId == null`) with a comment quoting G6.
   - `viewerFor`: when a `sessionId` is given and the asker does not own that session (or it does not exist), return `{ userId, isAdmin: false }` so the write path refuses as for a guest (`writeScopeFor` picks config scope and `resolveWriteScope` refuses a non-administrator with "Only an administrator edits a configuration, …") and **nothing is stored at either scope**. Without a `sessionId`, and in a session the asker owns, unchanged. Update the doc comment.
   - Do **not** touch `pipelines:previewRetrieval` (~5263, ~5403): list only.
2. `src/lib/server/sockets/sessions.pipelines.ts` — line ~1101 (`sessions:pipelines`): `access.hasAccess && access.isOwner` (drop `|| socket.user!.isAdmin`); fix its comment ("D58 + G6: the owner's; a guest, administrators included, gets none"). **Do not change line ~404** (the `"admin"` origin): leave it; the supervisor reports on it.
3. `src/lib/server/sessions/annexInspect.ts` — `inspectAnnex` (~121): only the session's owner is answered (administrators included in the refusal, whether a guest of the session or not in it). Drop `isAdmin` from the `viewer` type. Change `ANNEX_INSPECT_REFUSAL` to `"Only the session's owner can see its stored data."` (🚧 provisional copy). Fix the doc comments there. And in `src/lib/server/sockets/sessions.ts` **only** the `sessionsAnnexInspectHandler` (~1123–1150): stop passing `isAdmin`, fix its doc comment ("The session's owner only").
4. **`debugMeta` (the compiled prompt a reply was written from) reaches only the session's owner.** Nothing else about a row changes for anyone.
   - New file `src/lib/server/messages/debugMeta.ts` with one exported pure function `withoutDebugMeta<T>(payload: T): T` (header comment quoting G5/G6 and D64): returns the **same reference** when no row in the payload carries a non-null `debugMeta`; otherwise a copy with `debugMeta: null` on those rows (keep the key, null, so the row's shape is that of a reply with no recorded prompt). Shapes it understands: an array of rows; `{ sessionMessage: row }`; `{ rows: [...] }`; `{ messages: [...] }`; `{ session: { sessionMessages: [...] } }` (both of the last two may be present together); anything else comes back unchanged. Check whether `attachParts` (`messages/store.ts`) output carries a `debugMeta` anywhere besides the row itself; if it does, report it (don't edit `store.ts`).
   - `src/lib/server/sockets/sessions.messages.ts`:
     - `sessions:messagesPage` (~80–130): rows for anyone not the session's owner go through `withoutDebugMeta`.
     - the by-id branch of `sessionMessageHandler` (~2007–2050): same, using the `sessionAccess` it already reads.
     - `promptTokenCountHandler` (~2410–2416): the prompt text (`prompt`, `messages`) goes to the session's **owner** only: `sessionAccess.isOwner ? promptResult : { …, prompt: undefined, messages: undefined }`. Do **not** refuse anyone (a guest's composer reads the counts for its over-limit warning). Update the comment. Leave the commented-out admin block alone.
   - `src/lib/server/sockets/sessions.ts` — `buildSessionGetResponse` (~933–1075) only: after `attachParts`, when `!sessionAccess.isOwner`, pass `sessionMessages` through `withoutDebugMeta` (it is both `session.sessionMessages` and `messages` in the reply; both branches, first page and `beforeId` cursor page).
   - `src/lib/server/sockets/sessions.shared.ts` — `buildSessionRefresh` (~1283–1316) only: when `laneFilter` is true (the caller-only resend, `resendSession`) and the caller is not the session's owner (`sessionData.userId !== userId`), strip the rows. The members' push (`laneFilter` false) is stripped per recipient by the broadcast below.
   - `src/lib/server/sockets/utils/broadcastHelpers.ts` — `broadcastToSessionUsers` only: after `recipients` is settled (both the memo path and `resolve()`), if `withoutDebugMeta(payload) !== payload` (or any recipient's `data` differs from its stripped form), read the session's owner id once — with `db.select({ userId: schema.sessions.userId }).from(schema.sessions)…` (not `db.query.sessions.findFirst({ columns: { userId } })`: the sockets' interest-gate test tells the access read apart by that shape) — and give every recipient who is not the owner `withoutDebugMeta(r.data)`. When nothing carries a `debugMeta` (every streamed chunk of a new reply), no query and no copy: say so in a comment. This covers every `sessionMessage` push (live row, edits, swipes, attachments, `liveRow.ts`, `host.ts`, `fireAction.ts`, `generationStatus.ts`…) and the `sessions:refresh` members' push, without editing those callers.
   - Sweep: list any other reply or push that sends a full `session_messages` / `messages` row (with `debugMeta`) to a person, through `emitToUser` or otherwise, that the points above do not cover (e.g. `sessions:create` / `sessions:branch` replies, `sessions:list`). Don't fix those: report file:line and who receives it.

## Tests (every closed path asserts on the serialised payload: `JSON.stringify(reply)` holds none of what was closed)

- **New** `src/lib/server/sockets/sessions.debugMeta.int.test.ts`: owner; guest; an administrator who is a guest (`isAdmin: true` + a `session_guests` row); one session; several rows on `main`, one of them with `debugMeta: { prompt: "<SENTINEL-PROMPT>", messages: [{ role: "system", content: "<SENTINEL-MESSAGE>" }] }`. Assert, for guest and administrator-guest: `sessions:messagesPage`, `sessions:get` (first page **and** a `beforeId` page), and `sessionMessage` by id hold no sentinel; each of their rows equals the owner's row with `debugMeta: null` (nothing else differs). For the owner: the same three replies carry the `debugMeta` exactly. A `withoutDebugMeta` unit block: same reference back when nothing to strip; each shape above. A broadcast case: a `sessionMessage` push and a `sessions:refresh` push (`pushSessionToParticipants`) reach the owner with the `debugMeta` and the guest / administrator-guest without it. Find how existing tests capture a broadcast's per-socket emits (look at `channels/lanes.int.test.ts`, `sockets/sessions.sanctum.int.test.ts`, `sockets/utils/userPush.test.ts`, and how interest is declared in tests); if the broadcast cannot be driven in a test without a new seam, say so and test `broadcastToSessionUsers`'s recipient shaping at the smallest real seam you can.
- `promptTokenCount`: in `src/lib/server/sockets/promptTokenCount.int.test.ts` add, if its setup allows a second user, "an administrator who is a guest gets the counts and no prompt text" and "a guest gets the counts and no prompt text"; the owner's reply unchanged. If its setup cannot, say why.
- **Re-pin lane gs-1's three G6 tests** in `src/lib/server/sockets/pipelines.promptReaders.int.test.ts` (old → new), and the file's header comment (G6 is now ruled and pinned):
  - ~192 "an administrator in someone else's session — unchanged until G6 is ruled" → refused with `SESSION_SENTENCE` like a guest, `poolLeaks` empty.
  - ~405 "an administrator who is not the owner still writes at configuration scope — unchanged until G6" → setOption, setOptions and clearOption from the administrator with the session's id are refused exactly as the guest's are (same sentence the guest test asserts) and `storedValues()` is unchanged at **both** scopes. (The administrator can no longer mint an option id from their own in-session view; mint it the way the guest test does, from the owner's view.)
  - ~478 "an administrator who is a guest keeps the list — G6" → gets `pipelines: []` and no `presetFallbacks`.
  - Add: an administrator **outside** a session still reads every row (already pinned at ~160: keep green) and still writes at configuration scope with no `sessionId` (add a short case if none exists).
- `src/lib/server/sessions/annexInspect.int.test.ts` (and `secretAnnexField.int.test.ts` if it relies on an administrator reading another's annex): re-pin "answers an administrator who is not in the session" → refused with the new sentence; add an administrator who is a guest → refused; the owner who is also an administrator → answered; the owner unchanged. Fix the refusal-text assertions.
- Owner's and guest's ordinary play unchanged: run `sessions.messagesPage.int.test.ts`, `pipelines.previewRetrievalAdmin.int.test.ts` (must stay green: you do not touch it), `sessions.promptTokenCount.cardless.int.test.ts`, `channels/lanes.int.test.ts`.

Done means: those files green (logs `plans/gs-2a-w1-<n>.log`), `tsc` 0 errors in your files, `npx prettier --check` on each file you touched (report pre-existing failures as such).

## Stop and ask (write it in your report and stop that part) when

A guest's page would need something from `debugMeta` to render; a push shares one payload between owner and guests in a way you cannot shape per recipient without a new event; anything would need a new socket event, setting, migration or a file outside this list.

## Report

To the supervisor, as your final message: changed files (with what changed), every test run with pass counts and log path, the old → new of each re-pinned test, the sweep's list (file:line, who receives), any sentence you wrote, Noticed-not-done.
