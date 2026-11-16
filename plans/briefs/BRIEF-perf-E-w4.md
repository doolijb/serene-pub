# BRIEF perf-E-w4 — pushes per user, exports to the asker (lane perf-E steps 7 and 8, review rows F7, F8)

Repository: /home/jody/github/serene-pub. Supervisor: lane perf-E.

Standing ruling (CLAUDE.md, Sockets): one domain context per event family is the only listener and the only place
that toasts; an event in `SCOPED_EVENTS` must carry its scope key in the payload. Same events, same payloads here.

## Step 7 — pushes (verified by the supervisor 2026-11-13)

`src/lib/server/sockets/utils/userPush.ts` `installUserPush` (~49–75): every push to any user goes through ONE global
promise `chain`; inside, it reads `users.isAdmin` from the DB and builds the payload (a thunk, run after the gate) even
when the user has **no socket connected**.

1. **Empty room → return** before anything else in that push's chain step: when `user_<id>` has no sockets
   (`io.sockets.adapter.rooms.get("user_" + userId)` empty or absent — extend the local `PushIo` type as needed), no DB
   query and no payload build. Checked inside the chain step (delivery time), as the gate is today.
2. **`isAdmin` from a connected socket** of that user when one exists (`socket.user?.isAdmin` on a socket in the room,
   as `ADMINS_KEY` already reads it ~79–84 — demotion force-disconnects a user's sockets, so it cannot go stale); fall
   back to today's query only when no socket carries a user. Pass the same `{ isAdmin }` shape to `redactConnections`.
3. **One chain per user**: `Map<number, Promise<unknown>>` instead of the module `chain`; call order stays delivery order
   *per user* (the guarantee in the header comment is per recipient — say so in the comment). Remove a user's entry once
   its tail settles and is still the map's value, so the map cannot grow without bound.
4. Keep the gate (`isGatedEvent` / `interestedSockets`), the thunk semantics, the `.catch` logging, `globalThis` keys,
   `pushToConnectedAdmins` and `pushToUser` exactly as they are.

`src/lib/server/sockets/vectorization.ts` (~608–611, **the emitter registration only**): every admin socket calls
`registerProgressEmitter(emitToUser)`, and each `emitToUser` emits to the whole `user_<id>` room, so k admin tabs → each
progress event delivered k times to each of k tabs. Make it **one progress emitter per user**: a module
`Map<userId, Map<socketId, EmitFn>>`; the first socket of a user registers its `emitToUser`; later sockets of that user
are only recorded; on disconnect remove the socket, and if it was the registered one, unregister it and register the
next remaining socket's emitter (if any). Each tab must still receive exactly one copy. Do not change
`registerProgressEmitter`/`unregisterProgressEmitter` in `embedding/vectorizationQueue.ts` (another worker's file). Keep
`registerOwnerEmitter` lines as they are (out of scope).

`src/lib/server/notifications/store.ts` `pushChanged` (~378): it already passes a thunk, so with item 1 an offline user
pays nothing — **no change expected**; confirm in your report (edit only if you find otherwise, and say why).

## Step 8 — exports

1. `src/lib/server/sockets/characters.ts` — **the three success emits of `characters:exportCard` only** (~2281 charx,
   ~2295 json, ~2342 png): send to the asking socket, not every tab. `answerAsker` in `sockets/index.ts` is private and
   not yours; follow the precedent `replyToAsker` in `src/lib/server/sockets/connections.ts` ~143–147 (skip when
   `socket.disconnected`; honour the interest gate with `isGatedEvent`/`socketWants`; `socket.emit(event,
   redactConnections(data, socket.user))`) as a small local helper in characters.ts — check where `socketWants` and
   `isGatedEvent` are imported from in connections.ts. Leave the `:error` emit alone (the wrapper already routes
   `${event}:error` to the asker). Keep `return res`.
2. `src/lib/server/sprites/charx.ts` `buildCharx` (~119): `zipSync(files)` → fflate's async `zip` (promisified) with
   per-entry options: image entries (`assets/**`, already-compressed png/jpeg/webp/gif) at `level: 0`; `card.json` at
   the level it gets today (fflate's default). Same entry names, same uncompressed contents, same order.
3. `src/lib/server/plugins/exportPackage.ts` `zipPackage` (~613–621, **the zip call only**): it is **sync** and its caller
   `sockets/pluginPackages.ts:117` (not this lane's file) uses it synchronously, so do NOT make it async (the supervisor
   queues that for the owner). Only: entries whose path ends in an already-compressed extension (`.png .jpg .jpeg .webp
   .gif .woff2 .zip .gz .mp3 .ogg .mp4 .webm`) are stored at `level: 0`; everything else stays `level: 6`.

## Files owned

- `src/lib/server/sockets/utils/userPush.ts`
- `src/lib/server/sockets/vectorization.ts` (the progress-emitter registration block only)
- `src/lib/server/notifications/store.ts` (`pushChanged` only, and only if needed)
- `src/lib/server/sockets/characters.ts` (the three export success emits + one local helper only)
- `src/lib/server/sprites/charx.ts`
- `src/lib/server/plugins/exportPackage.ts` (the zip call only)
- new tests beside them (e.g. `src/lib/server/sockets/utils/userPush.test.ts`)

## Files readable

`src/lib/server/sockets/index.ts` (emitToUser ~204, answerAsker ~527), `sockets/interest.ts`, `sockets/connections.ts`,
`embedding/vectorizationQueue.ts` ~400–420, the existing tests `sockets/vectorization.registerHandlers.test.ts`,
`embedding/vectorizationQueue.emitterFanout.test.ts`, `sprites/charx.int.test.ts`, `plugins/exportPackage.int.test.ts`,
`notifications/store.int.test.ts`.

## Out of scope

`sockets/index.ts`, `sockets/pluginPackages.ts`, `sockets/sessions.ts`, `embedding/vectorizationQueue.ts`, any client file,
any new event.

## Done means

- New test (7): a push to a user with no socket in `user_<id>` makes **no DB query** (mock/spy `$lib/server/db`) and never
  calls the data thunk; a connected user's admin flag comes from the socket (no query); pushes to one user still arrive in
  call order; two users' chains are independent.
- New test (7, emitter): two admin sockets of one user → `registerProgressEmitter` called once; closing the registered one
  hands over to the other; closing both unregisters.
- New test (8): an export answers only the asking socket — one emit, to that socket id, none to the room. Unzip the charx
  and package outputs and compare entry names and contents with the sync version's.
- Existing: `npx vitest run src/lib/server/sockets/vectorization.registerHandlers.test.ts src/lib/server/embedding/vectorizationQueue.emitterFanout.test.ts src/lib/server/sprites/charx.int.test.ts src/lib/server/plugins/exportPackage.int.test.ts src/lib/server/notifications/store.int.test.ts` plus any existing test that covers `characters:exportCard` (grep `exportCard` under `src/lib/server`) — green, counts reported.
- `npx prettier --check` on changed files — **but** if a file you only touched in one block (characters.ts, vectorization.ts,
  store.ts, exportPackage.ts) was not prettier-clean before you started, do not reformat the whole file; report it. Filtered
  `tsc` clean for your files.

## Rules you work under (quoted from the lane brief, CLAUDE.md and the multi-agent guide)

- **Owner 2026-11-13: change how often, never what.** Every job still processes the same rows in the same order; every response carries the same bytes and headers except where your step names a header it adds. If you find yourself changing an answer rather than how often it is computed, stop and say so in your report.
- **P1:** a cache is keyed so a stale answer is impossible, not merely unlikely. Name the key and its invalidation in your report.
- **Decisions (CLAUDE.md):** decide implementation inside the asked scope (structure, helpers, tests) and name each choice in your report. Do NOT add any user-facing name, setting, flag, event, table, migration or SDK change. Findings outside your step go under "Noticed, not done", never fixed in passing.
- Edit ONLY the files listed under "Files owned". Other uncommitted files in the tree belong to other lanes and a peer session: never touch them. Never `git checkout` / `git restore` / `git stash` in either repo.
- Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently.
- Never add a top-level `await` to `src/lib/server/db/index.ts`.
- `socket.off(event)` with no handler removes every listener app-wide; always pass the handler.
- It is a **session**, never a *chat*, in any new comment or string.
- `npx prettier --write <file>` only on your own files, by path; never on a directory.
- Typecheck: `cd /home/jody/github/serene-pub && npx tsc --noEmit -p . 2>&1 | grep -E "<your files>"` must print nothing for your files.
- Tests: `cd /home/jody/github/serene-pub && npx vitest run <file> [<file>…]` — targeted files only. No full `npm test`.

Verbatim (multi-agent guide / lane brief):
- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report "blocked on your dev server".
- Never pipe vitest into `head`. An int test that opens a DB inside an `it` needs a 60 s timeout. Image assets never in `/tmp`.
- Inside `db.transaction(async (tx) => …)` use only `tx`.

## Report (your final message)

Changed files; each design choice you made; tests run with exact pass/fail counts; `prettier --check` and filtered `tsc` results; anything you could not do and why; Noticed, not done.
