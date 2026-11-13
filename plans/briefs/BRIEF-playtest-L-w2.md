# BRIEF playtest-L-w2 — Lorebook Views counts stay live (plan item 9, client + branchId)

Supervisor: lane `playtest-L`. Repo: `/home/jody/github/serene-pub`. Report back in your final message (no report file).

## Goal
The lorebook rail's **Views** list (Everything, Cast, World lore, History, Scenes, Places, Items — `LoreRail.svelte`,
figures from `railScopes(counts)` in `LorebooksWorkspace.svelte` ~1236) does not refresh its counts after an entry is
archived/unarchived, changes type or moves line, nor after a re-list cascade. The figures are the server's
(`entries:counts`); today they are re-asked only on create/delete/scene writes/cast removal. Fix, all in
`src/lib/client/lorebooks/LorebooksWorkspace.svelte` unless said otherwise:

1. **Coalesced re-ask.** Add a trailing-throttled wrapper over the existing `refreshCounts()` (~line 1796), e.g.
   `scheduleCounts()`: the first call starts a short timer (≈150 ms, a named constant with a one-line comment saying why:
   a re-list arrives as one `entries:list` per type, a burst of separate socket events), later calls inside the window do
   nothing, the timer's end calls `refreshCounts()` (which reads the CURRENT route, so a closed book asks nothing). Clear
   the timer in the existing `onDestroy` (~2543). Existing direct `refreshCounts()` callers stay as they are.
2. **`handleEntryUpdated`** (~2013) calls `scheduleCounts()` (archive/unarchive, a type change and a line move all move
   the figures; the server count excludes archived rows — `server/sockets/entries.ts` ~1818).
   **On an entry-type change, drop the row from the old type's list**: today the handler only maps
   `bookRows[entry.typeId]`, so a row whose type changed stays in its old list and is missing from the new one. Remove the
   row (by `id`) from every other type's list that holds it, and in the new type's list replace it if present, else
   append it (the `handleEntryCreated` precedent, `...(bookRows[entry.typeId] ?? [])`). Entry ids are unique across types
   (one `lorebook_entries` table). Keep the whole-record replace (`bookRows = { ...bookRows, … }`) — that is what keeps it
   reactive.
3. **`handleEntriesList`** (~1961) calls `scheduleCounts()`, so a re-list cascade (amendments, graph merges,
   settle-imprint, shared-book readers) moves the figures. A burst of `entries:list` asks ONCE. (On book open this adds one
   counts ask after the lists land; acceptable — say so in your report.)
4. **`branchId` echo.** Server: in `src/lib/server/sockets/entries.ts` `entryCountsHandler` (~1765–1852), the reply
   becomes `{ lorebookId: params.lorebookId, branchId: params.branchId ?? null, counts }` — that one field and nothing
   else in that file. The supervisor has ALREADY added `branchId: number | null` to `Sockets.Entries.Counts.Response` in
   `src/lib/shared/sockets/types.ts`; do not edit that file. Client: `handleEntryCounts` (~2106) ignores a reply whose
   `(msg.branchId ?? null)` differs from the line being read (`route.branch ?? null` — the same value `refreshCounts`
   sends), so a late reply for a line you left never overwrites the one you are on.

## Files owned (the only files you may edit or create)
- `src/lib/client/lorebooks/LorebooksWorkspace.svelte`
- `src/lib/server/sockets/entries.ts` (the counts reply's `branchId` only)
- NEW `src/lib/client/lorebooks/lorebooksWorkspace.counts.dom.test.ts` (the workspace DOM test)
- `src/lib/client/lorebooks/loreRail.dom.test.ts`, `src/lib/client/lorebooks/LoreRail.svelte` — only if truly needed
  (they should not be).

## Files readable
Anything. Precedents for the DOM test: `src/lib/client/lorebooks/cast/memberPage.dom.test.ts` (fake client socket,
`setSocket`, `setInterestUser`, `_resetInterestForTests`, `loreRoute.set(...)`, `settle()`), `loreRail.dom.test.ts`
(mocks `$app/environment`, `$lib/client/utils/toaster`, and stubs a heavy child with
`vi.mock("…/LoreContentField.svelte", () => ({ default: () => {} }))`), `bookOpens.svelte.ts`. The workspace reads
contexts `panelsCtx`, `openSessionCtx`, `systemSettingsCtx`, `userCtx` (~188–193) and `JUMP_CONTEXT` (~1838); its route
is `loreRoute` (`./loreRoute.svelte`, `branch?: number`).

## Out of scope — never build
The server re-list after pipeline lore writes (★9a, unruled: no edits to `runtime/host.ts`, `scenes/liveScenes.ts`,
`state/write.ts`); any change to what the counts count; any new setting, label or copy; anything outside Files owned
(another lane is editing widget-host / session-layout / SDK files at the same time).

## Rules your work depends on (quoted)
- CLAUDE.md, Standing rulings: *"An event in `SCOPED_EVENTS` must carry its scope key (`sessionId`, `lorebookId`…) in the
  payload, or `emitToUser` silently sends nothing."* `entries:counts` is scoped by `payload.lorebookId` — keep it on the
  reply. *"…views register listeners for local state and never call `toaster`."*
- CLAUDE.md Hard rules: *"`socket.off(event)` with no handler removes every listener app-wide; always pass the
  handler."* · *"`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`."* ·
  *"Inside `db.transaction(async (tx) => …)` use only `tx`."* · no `crypto.randomUUID` / `navigator.clipboard` in browser
  code.
- The workspace's own ⚠ notes: effects keyed on primitives, route reads `untrack`ed where an effect would otherwise
  re-run per navigation (see ~1809–1823). Do not add tracked `route` reads to effects.
- NOMENCLATURE R1–R4 for any new identifier (internal names only; no new user-facing words are needed).
- Decisions: implementation choices inside this brief are yours — name each in your report. Anything a user sees, a new
  setting, a file outside Files owned, or an unclear reading: STOP that part and report it. Do not fix things you notice
  in passing — list them under "Noticed, not done".

## Done means — tests (all green)
New `lorebooksWorkspace.counts.dom.test.ts`, mounting the real `LorebooksWorkspace.svelte` with a book open (stub heavy
child components with `vi.mock(..., () => ({ default: () => {} }))` as needed; provide the contexts; drive the fake socket
with `dispatch`). Use fake timers or a wait past the throttle window. Cases:
1. a scoped `entries:update` whose entry comes back `archived: true` re-asks `entries:counts` (one more emit, with the
   book's `lorebookId` and the route's `branchId`);
2. a burst of `entries:list` replies (say 5, different `typeId`s) re-asks counts exactly ONCE;
3. a stale-branch reply is ignored: reading branch 3, an `entries:counts` reply with `branchId: null` leaves the rail's
   figures as they were, and one with `branchId: 3` replaces them (assert on the rendered Views figures);
4. an `entries:update` that changes a row's `typeId` drops it from the old type's list (assert through what the
   workspace renders, or the counts/rows the rail shows — whichever is observable).
If mounting the full workspace proves infeasible after a fair attempt (say it hangs or needs edits outside Files owned),
STOP and report exactly what blocks it, with the error; do not create helper files outside Files owned. (A fallback I may
then approve: export the pure pieces from a `<script module>` block of `LorebooksWorkspace.svelte` and test those.)
Regression, read-only: `src/lib/client/lorebooks/loreRail.dom.test.ts`, `src/lib/shared/sockets/scopedReplies.test.ts`,
`src/lib/server/sockets/entries.lines.int.test.ts` (DB-opening: the file already sets its timeouts).

Run tests ONLY like this (capped scope; one log per run, numbered):
```
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run <files> > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest-L-w2-<n>.log 2>&1; echo exit=$?'
```
(if `systemd-run` is refused, `timeout 900` with the same NODE_OPTIONS). Never pipe vitest into `head`. Never a full
`npm test`, `npm run check` or project-wide `tsc`. Never hand a DOM node to an assertion (compare `x === null` to `true`,
not `assert.equal(node, null)`). An int test that opens a DB inside an `it` needs a 60 s timeout. Format with
`npx prettier --write <file>` only on files you own and only if the file was prettier-clean before (check with
`npx prettier --check <file>` first); otherwise match the surrounding style.

## Verbatim lines (multi-agent guide)
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."*
- Also: never `git checkout`, `git restore` or `git clean` in either repo. No SDK edits are needed for this brief.

## Report (final message)
Changed files · what you chose and why (names of new functions/constants, the throttle window) · tests run with exact
command and pass/fail counts per file · anything stopped · Noticed, not done. Under 600 words.
