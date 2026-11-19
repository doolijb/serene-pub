# BRIEF — lane `aud-1`, worker w1 — three client defects (audit findings 2, 3 client half, 4)

Repo `/home/jody/github/serene-pub` (SvelteKit 5, Svelte 5 runes, TypeScript, Vitest 4, happy-dom DOM tests).
Supervisor: lane `aud-1`. Report to your supervisor with your final message (changed files, tests run with
results, anything you could not do, **Noticed, not done**). Do not write a report file.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You have no reason to run `sdk:build` at all: the SDK is not touched.)

Also: never `git checkout` / `restore`; never `prettier --write`; never `pkill -f` a generic pattern; no migration;
no `npm run build`; no full test run. Read files by line range, not whole large files.

## Goal

Fix three confirmed client defects, each with a test that fails before the fix and passes after.

### A. Admin › Network "Copy link" (finding 2)

`src/lib/client/admin/sections/network/Page.svelte` ~312–317, `copyLink()` calls `navigator.clipboard.writeText`
unguarded. Standing ruling (CLAUDE.md): *"Browser code runs on plain-http LAN addresses and phones: no
`crypto.randomUUID`, no `navigator.clipboard`."* — meaning never unguarded. On plain http `navigator.clipboard` is
undefined, so the click throws and shows nothing.

Fix: use the guarded pattern of `src/lib/client/components/admin/pub/SupportReportCard.svelte` lines 92–117
(`writeClipboard`: `navigator.clipboard && window.isSecureContext` inside try, else the hidden-textarea
`document.execCommand("copy")` fallback, returning a boolean). Copy that function locally into `Page.svelte` (do
not create a shared util module, do not edit `SupportReportCard.svelte`). On success keep the existing toast
`notify.success({ title: "Link copied" })`. On failure use the existing message, verbatim:
`notify.error({ title: "Could not reach the clipboard. Select the text and copy it." })`. **No new copy.**
Check the public address is shown on the page as selectable text (so "Select the text" is true); if it is not,
say so in your report and change nothing about the copy.

Test: a DOM test (e.g. `src/lib/client/admin/sections/network/copyLink.dom.test.svelte.ts`) that mounts the page
with a running tunnel/public URL and presses **Copy link** with `navigator.clipboard` undefined (or
`isSecureContext` false) and asserts the error message is raised through `notify` (mocked) and nothing throws;
and with a secure clipboard asserts `writeText` got the URL and "Link copied" is raised. Follow the mock pattern
of `src/lib/client/admin/sections/connections/modelLeversSave.dom.test.svelte.ts` (mocks of `typedSocket`,
`interest.svelte`, toaster/notify, `adminRouter.svelte`, `$app/environment`). Check what `Page.svelte` actually
imports (`useTypedSocket` from `loadSockets.client`, `getAdminInterestContext`) and mock those. If the page truly
cannot mount in happy-dom, stop and report why rather than testing something else.

### B. Plugin user settings card (finding 3, client half)

`src/lib/client/components/settingsTabs/PluginUserSettingsCard.svelte`. Today `handleList` clears **every** draft
on any `pluginUserSettings:list`, and clears **all** errors and toasts "Settings saved" once a counter reaches 0.
The server answers a failed write on `pluginUserSettings:set:error` (`{ pluginId, error }`), and a success by
emitting a fresh `pluginUserSettings:list` (which names no plugin). So a failed save for plugin B can be wiped and
reported as saved when plugin A's save succeeds after it. A `:list` from another tab also wipes this tab's typed
values.

The server half (another worker, in `src/lib/server/sockets/plugins.ts`) is being changed so that a SUCCESSFUL
`pluginUserSettings:set` also emits **`pluginUserSettings:set`** with the handler's existing
`Sockets.PluginUserSettings.Set.Response` = `{ pluginId, settings }`, AFTER the `:list` emit. The event and its
response type already exist in `src/lib/client/sockets/typedSocket.ts` (~642). It is not in `GATED_EVENTS`, so it
reaches every tab of the user; a tab acts only on plugins it has a save pending for.

Required behaviour (brief rule): *"a reply clears only the draft and the error of the plugin it answers; a failed
save keeps its typed values and its error on screen; 'Settings saved' is said only of what saved. Keep one
listener per event family, each `socket.off` with its handler."*

Implement:
- Track pending saves **per plugin** (a plain `$state` record of counts, or `SvelteMap`/`SvelteSet` from
  `svelte/reactivity` — never `$state(new Map())`/`new Set()`, which is not reactive on mutation).
- `handleList`: replace `plugins` only; never touch `drafts` or `errors`.
- New `handleSet` (listen with `useInterest<"pluginUserSettings:set">("pluginUserSettings:set", handleSet)`,
  the same registry the card already uses — no raw `socket.on`): if this tab has a save pending for
  `res.pluginId`, decrement it; when it reaches 0 delete `drafts[res.pluginId]` and clear `errors[res.pluginId]`.
  If nothing is pending for that plugin (another tab), do nothing.
- `handleSetError`: if `res.pluginId` is pending, set `errors[pluginId]`, decrement, keep `drafts[pluginId]`. The
  socket wrapper's generic refusal (`"An error occurred while processing your request."`) arrives **without** a
  `pluginId`: then mark every plugin still pending as failed with that error, keeping their drafts, and clear
  their pending.
- Toast: one "round" = the saves in flight from the moment pending goes from 0 to >0. When the last pending reply
  lands, raise the existing `notify.success({ source: "socket:pluginUserSettings:list", title: "Settings saved" })`
  **only if at least one save in the round succeeded and none failed**; a round with any failure raises no toast
  (the inline `role="alert"` error speaks). No new copy anywhere.
- `save()` / `useDefault()`: when (re)sending for a plugin, clear that plugin's old error (it is being retried).
- Keep the component's doc comment true; adjust comments you invalidate.

Test: a DOM test (e.g. `src/lib/client/components/settingsTabs/pluginUserSettingsCard.dom.test.svelte.ts`)
mocking `$lib/client/sockets/interest.svelte` (capture the `requestWithInterest` and `useInterest` handlers by
event name), `$lib/client/sockets/loadSockets.client` (`useTypedSocket` returning `{ emit: vi.fn() }`) and
`$lib/client/utils/notify`. Cases, at least:
1. Two plugins A and B, both edited, Save: B's `:set:error` arrives, then A's `:list` + `:set`. B's typed value is
   still in its field and B's error is shown; A's draft is gone; no "Settings saved" toast.
2. A alone saves successfully (`:list` then `:set`): draft cleared, "Settings saved" raised once.
3. A `:list` arriving with nothing pending (another tab) leaves this tab's typed values in place.
4. A generic `:set:error` with no `pluginId` keeps the pending plugin's typed value and shows the error.
Case 1 and 3 must fail on the current code. Look at how `PluginSettingsFields.svelte` renders inputs to find them.

### C. Admin › Models › Connections delete releases managers (finding 4)

`src/lib/client/admin/sections/connections/connectionsAdmin.ts` ~107–142, `managerFlagsReleased`. It releases
only KoboldCPP (on the last `koboldcpp_managed` row, ignoring `koboldcpp_managed_image`) and Ollama. The
Connections view's own Remove (`src/lib/client/components/sidebars/ConnectionsSidebar.svelte` 545–570, read only)
switches audio.cpp off with `socket.emit("audiocpp:updateSettings", { enabled: false })`, and treats the KoboldCPP
install as both rows via `managedConnectionIds(kind, rows)` in
`src/lib/client/components/connections/managedConnectionView.ts` 403–416 (read only).

Brief rule: *"the last `audiocpp_managed` row switches audio.cpp off; the last KoboldCPP managed row counts
`koboldcpp_managed_image` too. Reuse the existing switch-off calls; no second writer."*

Fix: in `managerFlagsReleased`, decide "last of" per install by reusing `managedConnectionIds("koboldcpp" |
"audiocpp" | "ollama", rows)` (import it; do not duplicate the type lists), and add `"audiocpp:updateSettings"` to
the returned union for the last audio.cpp row. Every returned event takes `{ enabled: false }`, which the two
callers already send (`Page.svelte` ~82, `IdPage.svelte` ~378–379). Touch those two callers only if `tsc` needs it
(e.g. the union's typing at `socket.emit`). Update the doc comment above the function.

Test: extend `src/lib/client/admin/sections/connections/connectionsAdmin.test.ts` (`describe("managerFlagsReleased")`
~64): deleting the only `audiocpp_managed` row returns `"audiocpp:updateSettings"`; deleting `koboldcpp_managed`
while a `koboldcpp_managed_image` row stays returns no KoboldCPP release; deleting both returns it. Keep the
existing cases passing (adjust an existing expectation only if it encoded the bug, and say so).

## Files owned (edit only these)

- `src/lib/client/admin/sections/network/Page.svelte` + one new test file beside it
- `src/lib/client/components/settingsTabs/PluginUserSettingsCard.svelte` + one new test file beside it
- `src/lib/client/admin/sections/connections/connectionsAdmin.ts`, `connectionsAdmin.test.ts`; `Page.svelte` and
  `IdPage.svelte` in that folder only if typing requires

## Files readable

Anything. Notably `SupportReportCard.svelte`, `ConnectionsSidebar.svelte`, `managedConnectionView.ts`,
`src/lib/server/sockets/plugins.ts` 1430–1480, `src/lib/client/sockets/interest.svelte.ts`, `typedSocket.ts`,
`PluginSettingsFields.svelte`, existing `*.dom.test.svelte.ts` files for mock patterns.

## Out of scope

The server (`src/lib/server/**`), `src/lib/shared/**`, docs, `interest.ts` `GATED_EVENTS`, the other unguarded
`navigator.clipboard` call sites (list them under Noticed), any new user-facing words, any new setting/flag.

## Stop and ask when

A fix needs wording a user sees beyond the existing messages quoted above; a name/setting/event beyond what this
brief states; a finding turns out false (report it, change nothing for it).

## Rules quoted for this work

- `socket.off(event)` with no handler removes every listener app-wide; always pass the handler. (Use
  `useInterest`/`requestWithInterest`; they release themselves.)
- `$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`.
- STYLE-GUIDE §6.21: a toast is raised through `src/lib/client/utils/notify.ts`, never the raw toaster; a `source`
  key replaces the previous toast from the same source; another tab's broadcast never toasts.
- STYLE-GUIDE §10: errors say what went wrong and what to do; no new copy here anyway.

## Tests — exact form, one run at a time

Before each run wait until no other vitest and no sdk:build is running:

```
until ! pgrep -f "vitest" >/dev/null && ! pgrep -f "sdk:build" >/dev/null; do sleep 5; done
```

(run that as its own Bash call with a long timeout). Then, from the repo root:

```
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/aud-1-w1-<n>.log 2>&1"
```

and read the log. Never pipe vitest into `head`. Run the new tests against the unfixed code first if practical
(to show they fail), then after. Type check the touched files with
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` (filter the output for your files) and
`npx prettier --check <your files>`.

## Done means

Green: the two new DOM test files, `connectionsAdmin.test.ts`, and existing tests touching these files
(`src/lib/client/admin/sections/connections/*.test.ts`, `comesWithApp.dom.test.svelte.ts`,
`modelLeversSave.dom.test.svelte.ts`); no tsc errors in your files; prettier --check clean on your files.
