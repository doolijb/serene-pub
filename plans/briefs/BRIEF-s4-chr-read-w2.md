# BRIEF — worker `s4-chr-read-w2` — the 🚧 `characters:page` socket, its types, the interest gate and the egress allowlist — 2026-11-08

Supervisor: lane `s4-chr-read` (plan `plans/PLAN-sdk-creation-seams-2026-10-30.md` §34.4). Worker w1 is writing the read module `src/lib/server/cast/characterRows.ts` **in parallel**; you build the socket around it against this signature (it may not exist on disk yet — mock it in your tests; never edit it):

```ts
// src/lib/server/cast/characterRows.ts (w1's)
export class CharacterRowsRefusal extends Error {}
export async function characterRowsPage(
	db: Db,
	askerId: number,
	ask: { cursor?: string | null; limit?: number; filters?: CharacterRowsFilters }
): Promise<{ rows: CharacterRow[]; nextCursor: string | null }>
```

The row/filter types are in `src/lib/shared/characters/characterRows.ts` (the supervisor's contract — read it; do not edit it).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal (plan §34.4, quoted: "🚧 `characters:page {cursor, limit, filters, requestId}` → `{rows, nextCursor, requestId}` to the asking socket only; in `GATED_EVENTS` + `socketEgress`; not in `SCOPED_EVENTS` (per user, no scope key); no page pushes — re-ask on open, on `characters:list` pushes, after own actions.")

1. **New `src/lib/server/sockets/characterRows.ts`**: a `Handler` (`import type { Handler } from "$lib/shared/events"`) for event `"characters:page"` and `export function registerCharacterRowsHandlers(socket, emitToUser, register)` (copy the shape of `registerCharacterFolderHandlers`, `sockets/characterFolders.ts:274`). The handler:
   - Validates `params` is an object and `params.requestId` is a non-empty string; otherwise `emitToUser("characters:page:error", { error: "A page of characters needs a requestId." })` and return.
   - Calls `characterRowsPage(db, socket.user!.id, { cursor: params.cursor, limit: params.limit, filters: params.filters })` with `db` from `$lib/server/db`.
   - Replies `{ rows, nextCursor, requestId }` **to the asking socket only**, through a file-private `replyToAsker(socket, event, data)` that is exactly the pattern of `sockets/connections.ts:144` (quote): `if (socket.disconnected) return; if (isGatedEvent(event) && !socketWants(socket, event)) return; socket.emit?.(event, redactConnections(data, socket.user))` — imports from `$lib/shared/sockets/interest` (`isGatedEvent`), `./interest` (`socketWants`), and wherever `connections.ts` imports `redactConnections` from. Never `emitToUser` for the success reply (that reaches every tab). Return the response from the handler too (as other handlers do).
   - On `CharacterRowsRefusal`: `emitToUser("characters:page:error", { error: e.message, requestId })` (the wrapper routes a request's own `:error` to the asking socket, `sockets/index.ts:480-485`) and return. Any other error: emit `{ error: "Couldn't load the characters.", requestId }` the same way, then rethrow so the wrapper logs it (the pattern in `sockets/attachments.ts:193-202`).
   - No server push of pages anywhere.
2. **Registration** — `src/lib/server/sockets/index.ts`: one import line beside `registerCharacterFolderHandlers`' import (`:32`) and one call line right after `registerCharacterFolderHandlers(socket, emitToUser, register)` (`:316`). Nothing else in that file.
3. **Types** — `src/lib/shared/sockets/types.ts`: lane s4-seat owns this file this wave; you may only **append one block**. Append, inside `declare global { namespace Sockets {`, immediately after the closing brace of the last namespace (`namespace Voicebank`, ends just before `export interface SyncDetails` near the file's end), a merging block:
   ```ts
   		/** 🚧 The Characters view's rows, one page at a time (plan §34.4); answered to the asking socket only. */
   		namespace Characters {
   			namespace Page {
   				interface Params {
   					/** The `nextCursor` of the page before; absent for the first page. */
   					cursor?: string | null
   					/** Rows wanted; clamped to 1…100, 50 when absent. */
   					limit?: number
   					filters?: import("$lib/shared/characters/characterRows").CharacterRowsFilters
   					/** Echoed on the reply and on `characters:page:error`. */
   					requestId: string
   				}
   				interface Response {
   					rows: import("$lib/shared/characters/characterRows").CharacterRow[]
   					/** Null when there are no more rows. */
   					nextCursor: string | null
   					requestId: string
   				}
   				interface ErrorResponse {
   					error: string
   					requestId?: string
   				}
   			}
   		}
   ```
   (`namespace Characters` already exists at `:166`; TypeScript merges the two.) Check first that `Sockets.Characters.Page` does not already exist. Check whether the repo has a typed event-name map/union for socket events (grep `src/lib/shared` for where e.g. `"characterFolders:list"` or `"voicebank:preview"` appears as a type key, not in `interest.ts`); if one exists, add the `characters:page` entry there **only if it is inside `types.ts`**, otherwise report it. Touch nothing else in `types.ts`, and report the exact lines you appended (line numbers before/after).
4. **Gate** — `src/lib/shared/sockets/interest.ts` `GATED_EVENTS`: add `"characters:page"` as its own family group with the comment convention the set requires (quote, rule 3: "Grouped by family, with its consumers on one line."): `// characters:page — consumers: none yet (the Characters view, plan §34.4 wave 6, on the client registry). Answered to the asking socket only (sockets/characterRows.ts replyToAsker).` Place it near the other `characters` family entries (`characterFolders:list`/`characters:list`, ~`:851-861`). Do **not** add it to `SCOPED_EVENTS` (per user, no scope key). Rule 1 (quote): "Never gate an `:error` event." — `characters:page:error` stays ungated.
5. **Egress** — `src/lib/shared/conformance/socketEgress.test.ts`: add one entry to `REDACTING_EMITTERS` (`:480`) for `"src/lib/server/sockets/characterRows.ts :: replyToAsker → socket.emit(<computed>)"` with a reason in the style of the `connections.ts` / `attachments.ts` entries above it: the page answers the socket that asked and no other (a second tab paging its own list must not receive a sibling's page); the room is that socket and the subject is its own `socket.user`, so recipient and subject are the same person — redacted per socket; the payload is character rows (names, lines, faces, reach counts) and holds no connection. Run the test and match the exact `subject` string it reports.

## Tests

New `src/lib/server/sockets/characterRows.interestGate.test.ts`, driven through the real `connectSockets` with the fake-io harness used by `sockets/backups.interestGate.test.ts` (copy its `harness()`), with `vi.mock("$lib/server/cast/characterRows", …)` returning a fixed page (and `$lib/server/db` mocked to a stub object if the import needs it). Cases:
1. `"characters:page"` is in `GATED_EVENTS` (`isGatedEvent` true) and not a scoped event (`isScopedEvent` false); `"characters:page:error"` is not gated.
2. A socket that declared `characters:page` (via `interest:sync`, as the harness does) and asks gets `{ rows, nextCursor, requestId }` with **its** `requestId` echoed; a second tab of the same user that also declared it receives nothing; the read was called with the asker's user id and the sent cursor/limit/filters.
3. A socket that did not declare the key receives no reply (the gate).
4. A `CharacterRowsRefusal` → `characters:page:error` `{ error: <its message>, requestId }` to the asking socket only (never gated: arrives even without a declaration).
5. A missing `requestId` → `characters:page:error` with the sentence above, and the read is never called.
Plus run the existing conformance and interest tests listed below (they must stay green).

## Files owned (edit only these)

- `src/lib/server/sockets/characterRows.ts` (new)
- `src/lib/server/sockets/characterRows.interestGate.test.ts` (new)
- `src/lib/server/sockets/index.ts` — the two lines only
- `src/lib/shared/sockets/types.ts` — the one appended block only
- `src/lib/shared/sockets/interest.ts` — the one `GATED_EVENTS` group only
- `src/lib/shared/conformance/socketEgress.test.ts` — the one `REDACTING_EMITTERS` entry only

## Out of scope

The read module and its tests (w1). Any client code, any UI, any store. `SCOPED_EVENTS`. Any other socket file (`sockets/sessions.ts`, `pipelines.ts`, `scenes.ts`, `characters.ts` belong to other lanes). No migration, no setting, no new exported name beyond `registerCharacterRowsHandlers` and the handler const (name it `charactersPage`, matching `charactersList` in `sockets/characters.ts`).

## Rules you work under (quoted)

- CLAUDE.md Standing ruling, Sockets: "one domain context per event family (provided by both shells) is the only listener, and the only place that toasts … An event in `SCOPED_EVENTS` must carry its scope key … in the payload, or `emitToUser` silently sends nothing." (This event is deliberately NOT scoped.)
- CLAUDE.md Hard rule: "`socket.off(event)` with no handler removes **every** listener app-wide; always pass the handler." (Tests' teardown too.)
- NOMENCLATURE R1/R3: no new names beyond those above; mark the handler and register function 🚧 in JSDoc with one sentence of purpose. It is a **session**, never a chat.
- Decisions: implementation inside your files is yours — name each choice in your report. Anything a user would see beyond the two error sentences given above → stop and write a ★ question.
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no `sdk:build`.)
- **Prettier:** run `npx prettier --check` on changed files, but **only `--write` the lines you changed** — never reformat a whole file you didn't otherwise edit (`types.ts`, `interest.ts`, `index.ts`, `socketEgress.test.ts` are shared). Your two new files you may `--write` whole.
- Never `kill -9`. Never `git checkout`/`restore`/`stash`.

## How to run tests (capped scope, logged; never pipe vitest into `head`)

```
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run src/lib/server/sockets/characterRows.interestGate.test.ts src/lib/shared/conformance/socketEgress.test.ts src/lib/shared/conformance/wiring.test.ts src/lib/server/sockets/index.interestGate.test.ts src/lib/server/sockets/cast.interestGate.test.ts src/lib/shared/sockets --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-chr-read-w2-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-chr-read-w2-tests.log'
```
(If `wiring.test.ts` doesn't exist at that path, find the conformance tests that read socket registrations and run those.) For type errors in your files only: `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=8192; npx tsc --noEmit -p . > <scratch>/s4-chr-read-w2-tsc.log 2>&1'` then grep the log for your files. Baseline tsc today: 1 error, `pipelines/runtime/host.ts(10390,7)` (another lane's, in flight) — ignore it. Errors from w1's not-yet-written module may appear while it is in progress; note them, don't work around them.

## Done means

The new gate test green; socketEgress and the other listed tests green; no tsc error in your files; prettier clean on your lines.

## Report (your final message — no report file)

Changed files with the exact lines added in each shared file; tests run with pass/fail counts; each implementation choice; any ★; Noticed, not done.
