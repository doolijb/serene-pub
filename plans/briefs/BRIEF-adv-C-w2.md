# BRIEF — adv-C-w2: the session header's two layout editor entries hide when advanced controls are off

Supervisor: lane adv-C. Repo `/home/jody/github/serene-pub`. Report back in your final message (no report file).

## Goal

In `src/lib/client/components/Header.svelte`, with the viewer's **advanced controls** switch off, these two entries into the session layout editor are **not rendered**; with it on they are exactly as today:

1. the wide bar's **Layout** button (`aria-label="Customize layout"`, the `<button>` calling `requestLayoutEditor()` around line 380-391);
2. the phone `⋯` menu's **Customize layout** entry in `phoneMenu` (around line 167-171).

### Exactly what to change

- `import { showsAdvancedControls } from "$lib/client/advancedControls"` (exists: `showsAdvancedControls(settings)` returns `settings?.showAdvancedControls ?? false`).
- Read the shell's settings context the way other shell components do: `const userSettingsCtx = getContext<UserSettingsCtx | undefined>("userSettingsCtx")` (`UserSettingsCtx` is a global type in `src/app.d.ts`; Layout.svelte sets the context, and its `settings` is `$state`, so reads stay reactive). Then `const advancedControls = $derived(showsAdvancedControls(userSettingsCtx?.settings))`.
- Phone menu: `advancedControls && { label: "Customize layout", … }` — the `RowMenuEntries` list already takes falsy entries (`rewind && {…}`).
- Wide bar: wrap the Layout `<button>` (and its comment) in `{#if advancedControls}…{/if}`.
- Comments: the file's header comment says the Layout button is "the ONE way into the session layout editor at every width", and the `phoneMenu` comment lists "Settings, Layout". Amend both in a few words: shown with advanced controls on (🚧 2026-11-10); with it off a person keeps the layout they have. No other edits; nothing else in this file changes. Copy, labels and classes stay.

No "Some controls are hidden" line in the header (plan item 23).

## Files owned

- `src/lib/client/components/Header.svelte` — only the two entries, the import/context/derived above, and the two comments.
- `src/lib/client/components/headerFurl.dom.test.ts` — existing; its `mountHeader()` context gets `["userSettingsCtx", { settings: { showAdvancedControls: true } }]` so its "Settings, Layout and Full screen" test keeps finding the Layout button. Nothing else in it changes.
- New: `src/lib/client/components/headerLayoutEntry.dom.test.ts` — copy `headerFurl.dom.test.ts`'s harness (memory storage stub, `vi.resetModules()`, mount with a context `Map`, unmount in `afterEach`).

## The new test must show

1. No `userSettingsCtx` in context → `document.querySelector('button[aria-label="Customize layout"]') === null` is `true`.
2. `{ settings: { showAdvancedControls: false } }` → same, `null`.
3. `{ settings: { showAdvancedControls: true } }` → the button is present (`=== null` is `false`), and the Full screen button (`aria-label="Full screen (Ctrl+Shift+F)"`) is present in all three cases.
4. Reactive: mount with a `$state`-free plain object is not reactive, so for the flip case build the context value with Svelte's reactivity — either make this test file `headerLayoutEntry.dom.test.svelte.ts` and use `let ctx = $state({ settings: { showAdvancedControls: false } })`, flip `ctx.settings.showAdvancedControls = true`, `flushSync()`, and see the button appear. Use whichever import of `svelte` the harness loads (it resets modules per test: take `flushSync` from the same `svelte` import as `mount`; if `$state` from a reset runtime cannot drive the remounted component, drop case 4 and say so in your report rather than fight it).
5. The phone menu is a `RowMenu` opened by a button; if opening it in happy-dom is simple, assert *Customize layout* is absent when off and present when on. If it is not simple, assert at source level instead: read `Header.svelte` with `node:fs` and check the `phoneMenu` entry for "Customize layout" is guarded by `advancedControls &&` — and say which you did.

## Rules you work under (quoted by the supervisor)

- Lane brief: the entries "are not rendered" — hiding is not rendering (`{#if}`), never `display:none` or a disabled button.
- Plan (ruled 2026-11-10): "Advanced controls is a **preference, never a permission**." and "Everyone keeps the layout they have."
- CLAUDE.md Decisions: "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing." Do not touch `Layout.svelte`, `FullscreenExit.svelte`, `SessionLayout.svelte` or `layoutEditor.svelte.ts`.
- CLAUDE.md: "`socket.off(event)` with no handler removes **every** listener app-wide; always pass the handler. Views never call `toaster`." (You need neither.)

## Done means

- `npx prettier --check` clean on your files.
- Run, capped: `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run src/lib/client/components/headerFurl.dom.test.ts src/lib/client/components/headerLayoutEntry.dom.test<.ts or .svelte.ts> src/lib/client/components/headerBackTakes.dom.test.svelte.ts src/lib/client/components/headerNotice.dom.test.svelte.ts; echo test-exit=$?'` — green.
- Report: the diff summary, the test output tail (counts and exit), what you did for cases 4 and 5, anything you noticed but did not do.

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`.)
- Never `git checkout`, `restore` or `clean` in either repo.
- Never pipe vitest into `head`. Never hand a DOM node to an assertion (compare `x === null` to `true`).
- Scratch files start with `adv-C-`.
