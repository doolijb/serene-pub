# BRIEF — adv-C-w1: leave *Branch from here* out of the session's action list when advanced controls are off

Supervisor: lane adv-C. Repo `/home/jody/github/serene-pub`. Report back in your final message (no report file).

## Goal

With the viewer's **advanced controls** switch off, core's message action *Branch from here* (`specSlug === "core" && key === "branch"`) is left out of every venue the session page's action list hands out — `main`'s venues and every other channel's — and comes back the moment the switch turns on, **without waiting for a new `sessions:actions` push**. So: keep what the server sent as stored state, and filter at read time in a `$derived`.

### Exactly what to change in `src/lib/client/components/sessionPage/actionList.svelte.ts`

1. Add a dep to `ActionListDeps`:
   ```ts
   /** 🚧 Advanced controls (2026-11-10): this viewer's switch (`showsAdvancedControls`). Off leaves core's *Branch from here* out of every venue. */
   advancedControls(): boolean
   ```
   Required, a function, like `sessionId()`. Read it as `const advancedControls = $derived(d.advancedControls())`.
2. Rename the stored `$state` `actionVenues` to `listedVenues` and `channelVenues` to `listedChannelVenues` ("what the server listed"). Every **write** goes to these: `handleSessionsActions` (both branches) and `markActionsSeen` (which must iterate and rewrite `listedVenues`).
3. A module-level (non-exported) pure helper in the same file, e.g. `withoutBranch(venues)`, that returns a copy of a venues record with core's `branch` removed from `primary` and `overflow` of every venue, **keeping every venue key** (an emptied venue stays `{ primary: [], overflow: [] }`, never deleted). Match the action as `a.specSlug === "core" && a.key === "branch"` — the same shape `extraAction` uses.
4. `let actionVenues = $derived(advancedControls ? listedVenues : withoutBranch(listedVenues))` and `let channelVenues = $derived(advancedControls ? listedChannelVenues : <each channel's venues through withoutBranch>)`. Every existing **read** (`venueOf`, `venueOn`, the legend, `runActionTitle`, `listedAction`, the `actionVenues` getter) keeps reading `actionVenues` / `channelVenues`, so nothing else changes.
5. A one-paragraph comment above the derived explaining: hidden, never changed; derived at read time so the switch flipping mid-session needs no new push; venue keys are kept so the conversation's message menu never sees a missing list (which would make `MessageControls` fall back to its built-in Stop/Edit/Branch floors).

Do not touch `audienceVenues.ts`, the page (`routes/sessions/[id]/+page.svelte`), or anything else. The page's wiring line is queued for the lead by the supervisor.

## Files owned

- `src/lib/client/components/sessionPage/actionList.svelte.ts`
- `src/lib/client/components/sessionPage/audienceVenues.dom.test.svelte.ts` — existing; only add `advancedControls: () => true` to its `createActionList({...})` deps so it keeps passing.
- New: `src/lib/client/components/sessionPage/actionList.advancedControls.dom.test.svelte.ts`

## Files readable

Anything. Copy the harness of `audienceVenues.dom.test.svelte.ts` (the `vi.mock("$app/environment")`, the fake `inbox.on` capturing handlers, `flushSync`).

## The new test must show

Use a `$state` boolean in the test file (it is `.svelte.ts`, so runes compile) and pass `advancedControls: () => advanced`.
1. Off: after a push whose `message` venue holds core `edit` (itemGated) and core `branch` (`audience.act: ["participant"]`, `canAct: true`, `quick: false`), `list.actionVenues.message` lists `edit` but not `branch` (check primary and overflow; put `branch` in overflow in at least one case).
2. Flip `advanced = true`, `flushSync()`, **no new push**: `branch` is listed. Flip back: gone again.
3. A push whose `message` venue holds only `branch`: with the switch off, `list.actionVenues.message` is still present and equals `{ primary: [], overflow: [] }`.
4. Another channel: push `{ sessionId, channel: "sanctum", venues: { message: { primary: [BRANCH], overflow: [] } } }` with `sessionChannels: ["main", "sanctum"]`; `list.venueOn("message", "sanctum")` drops `branch` when off and lists it when on.
5. A genre action whose key happens to be `branch` but whose `specSlug` is not `core` is never filtered.

## Rules you work under (quoted by the supervisor)

- CLAUDE.md: "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`." (Plain object reassignment, as the file does today, is fine.)
- CLAUDE.md Decisions: "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing. Nothing 'for later'." No new exported name; the helper stays file-local.
- Plan (ruled 2026-11-10): "Hidden never means changed. A hidden control keeps its stored value, and the session keeps using it." and "Advanced controls is a **preference, never a permission**." — the server still lists and would accept Branch; this only leaves it out of what is drawn.
- Plan item 23: no "Some controls are hidden" line in the message menu.
- CLAUDE.md: "`socket.off(event)` with no handler removes **every** listener app-wide; always pass the handler. Views never call `toaster`." (You should not need either.)

## Done means

- `npx prettier --check` clean on your files.
- Run, capped: `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run src/lib/client/components/sessionPage/actionList.advancedControls.dom.test.svelte.ts src/lib/client/components/sessionPage/audienceVenues.dom.test.svelte.ts; echo test-exit=$?'` — green.
- Report: the diff summary, the test output tail (counts and exit), anything you noticed but did not do.

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`.)
- Never `git checkout`, `restore` or `clean` in either repo.
- Never pipe vitest into `head`. Never hand a DOM node to an assertion (compare `x === null` to `true`).
- Scratch files start with `adv-C-`.
