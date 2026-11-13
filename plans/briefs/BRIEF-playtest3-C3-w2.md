# BRIEF playtest3-C3-w2 — client: the app-made ONNX rows show no Delete on any device

Lane `playtest3-C3`, worker 2 (client half). Supervisor checks your diff against this brief. Report back in your final message (changed files, tests run with exact command and pass/fail counts, anything you could not do, Noticed-not-done). Do not write a report file.

## Goal (owner ruling 2026-11-04, final — do not reinterpret)
**★C-4:** "only the default onnx connection, not the model" — the two app-made local ONNX connection ROWS are undeletable everywhere (the earlier "deletable where the runtime can't load" exception is reversed); models are what a person deletes (Delete from disk). The server refusal is changed by worker 1 in parallel; you change the client so the sidebar and Admin › Connections follow.

## Build exactly this (supervisor's decision: drop the parameter, fix the callers)
1. **`src/lib/client/components/connections/modelManagement.ts` (~79-93).** `connectionComesWithApp(type: string | null | undefined): boolean` → `isLocalOnnxType(type)`. Keep the NAME (it is canon); drop the `availability` parameter. Rewrite the JSDoc: the two local ONNX connections come with Serene Pub on every device — fixed name, no delete; a person removes a model's files instead; where the runtime can't load the row reads *Unavailable* and stays (owner ★C-4, 2026-11-04). Remove `connectionTypeDisabledReason` and `type LocalOnnxAvailability` from this file's imports ONLY if nothing else in the file uses them (grep first).
2. **Callers** — pass the type only, nothing else changes:
   - `src/lib/client/components/sidebars/ConnectionsSidebar.svelte` (~238-243, `const comesWithApp = $derived(connectionComesWithApp(connection?.type))`). Leave `newConnectionBlocked` and every other `localOnnxAvailability` read alone.
   - `src/lib/client/admin/sections/connections/IdPage.svelte` (~412-417). Leave `localOnnxBlocked` alone.
   - `src/lib/client/admin/sections/connections/Page.svelte` `splitComesWithApp` (~184-193): drop the `availability` local and the second argument. If `systemSettingsCtx` becomes unused in the file, say so in your report (don't remove the context read unless it is truly dead — grep).
   No copy changes: every visible string stays byte-identical.
3. **Tests (Done means — all green):**
   - `src/lib/client/components/connections/modelManagement.test.ts` `describe("connectionComesWithApp")` (~308-333): both ONNX types → true (one-arg calls); other types / null / undefined → false. Remove the "not where the runtime can't load" case (the parameter is gone).
   - `src/lib/client/admin/sections/connections/comesWithApp.dom.test.svelte.ts`: the test "the same row where the runtime can't load: Delete, and the name is an input" becomes "…where the runtime can't load: still no Delete, the name read-only" (asserts no `Delete` button, `input#connection-admin-name` absent, the name shown as text). Add one bulk-delete case with the UNAVAILABLE context: the app-made row is still named as kept (`"Local embeddings comes with Serene Pub and stays."`) and only the others' ids are emitted on `connections:delete`. Update the file header comment if it states the old exception.
   - `src/lib/client/components/sidebars/connectionsList.dom.test.svelte.ts` `describe("a local ONNX connection comes with Serene Pub")` (~889): add a case mounting the sidebar with `localOnnxAvailability: { available: false, reason: "…" }` in the systemSettings context (see how the test at ~337-365 builds such a context with `shell({...})`) → the name input is read-only, the "Comes with Serene Pub. To free space, use Delete from disk on a model in its Models tab." line shows, and there is no "Delete connection Local embeddings" button.
   Run (n = 1, 2, …):
   `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run <files> > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest3-C3-w2-<n>.log 2>&1; echo exit=$?'` then read the log (tail/grep). Never pipe vitest into `head`. Also `npx prettier --check` on each changed file. Also grep the whole `src/` for any other `connectionComesWithApp(` call with two arguments and report it (do not edit files outside your list).

## Files owned (only these)
`src/lib/client/components/connections/modelManagement.ts`, `modelManagement.test.ts` (same dir), `src/lib/client/components/sidebars/ConnectionsSidebar.svelte` (the one `$derived`), `src/lib/client/admin/sections/connections/IdPage.svelte` (the one `$derived`), `src/lib/client/admin/sections/connections/Page.svelte` (`splitComesWithApp`), `src/lib/client/admin/sections/connections/comesWithApp.dom.test.svelte.ts`, `src/lib/client/components/sidebars/connectionsList.dom.test.svelte.ts`. Re-read each file immediately before editing it (other lanes work in the tree); use Edit, never Write, on existing files.
NOT yours: every server file, docs, `NOMENCLATURE.md`, `STYLE-GUIDE.md`.

## Rules your work depends on (quoted from CLAUDE.md)
- "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing. Nothing 'for later'."
- "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`." · "`socket.off(event)` with no handler removes **every** listener app-wide; always pass the handler." (if you touch listeners — you shouldn't need to)
- "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`."
- No new names, labels, settings or events. A behaviour change beyond "no Delete / read-only name for the two ONNX rows on every device" is out of scope.

## Stop and report (don't decide) when
Anything outside these files needs changing; a visible string would have to change; a test fails for a reason outside your files.

## Verbatim lane rules
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Also never `git checkout`, `git restore` or `git clean`.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You need no SDK build.)
- Never a full `npm test`, `npm run check`, or project-wide `tsc`.
