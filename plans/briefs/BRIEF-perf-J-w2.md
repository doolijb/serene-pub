# BRIEF — perf-J worker w2 — the shell's views, the theme editor and the review form's code field load on first open

Repository root: `/home/jody/github/serene-pub`. Use absolute paths. Report back in your final message (the
supervisor reads it); write no report file.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

Owner ruling **★P7 (2026-11-13), verbatim:** "Lazy sidebars and views; shell's existing loading affordance." The
plan's wording: sidebars, Admin and Library views, `CustomThemeEditor`, `CodeField` and the TipTap fields load on
first open, and the first-open beat uses the shell's **existing** loading affordance — **no new spinner**.

The supervisor traced the static import graph from `src/routes/+layout.svelte`: once the sidebar views are lazy,
TipTap, CodeMirror and `CustomThemeEditor` leave the entry except for one edge,
`Layout.svelte → PipelineReviewModal.svelte → SchemaForm.svelte → CodeField.svelte`. So this brief covers the views,
that one `CodeField` mount, and the one `CustomThemeEditor` mount. The other ten `CodeField` mounts and the three
TipTap (`LoreContentField`) mounts already load with their (now lazy) view; they are **out of scope** (the
supervisor raises them as a ★).

## The loading affordance (decided by the supervisor — use exactly this)

STYLE-GUIDE §6.7, verbatim: "Loading is `LoadingState` (2026-10-09): a centred 20px spinner at `py-8`,
`role="status"`, muted on the icon; never bare _Loading…_ text and never a blank pane". So the pending branch is
`<LoadingState />` (`$lib/client/components/LoadingState.svelte`, default props). Nothing else: no new spinner, no new
words, no delay timer.

A failed import (a stale chunk after an update) must not leave a blank pane. The `{:catch}` branch reuses, verbatim,
the existing block `AdminView.svelte` draws when a section's chunk fails (`AdminView.svelte` ~393–410: the
`role="alert"` wrapper, the sentence "This page did not load. If Serene Pub was just updated, reload to get the new
version." and the **Reload** button calling `location.reload()`, same classes). In `Layout.svelte` define it once as a
snippet and render it from each branch's `{:catch}`.

## What to change

1. **`src/lib/client/components/Layout.svelte`** — the `{#snippet sidebarView(key: string)}` chain (~3651–3694)
   and the static imports it uses (~19, 29–41, 61–62: `AdminView`, the sidebars, `LibraryView`, `SettingsSidebar`,
   `ActivitySidebar`, `HelpSidebar`, `ConversationsSidebar`). Each branch becomes:

   ```svelte
   {:else if key === "models"}
   	{#await import("./sidebars/ModelsSidebar.svelte")}
   		<LoadingState />
   	{:then { default: ModelsSidebar }}
   		<ModelsSidebar bind:onclose={viewCloseGates[key]} />
   	{:catch}
   		{@render viewLoadFailed()}
   	{/await}
   ```

   Keep the `{#if}` chain, every `key === "…"` test, every prop, `bind:onclose` / `bind:onescape`, and every comment.
   **Destructure to the original component name** — `src/lib/client/shell/railViews.test.ts` (not yours) reads the
   source and asserts the literal strings `<HelpSidebar />`, `<ModelsSidebar bind:onclose`,
   `<LoadoutsSidebar bind:onclose` and the `key === "x"` chain after `{#snippet sidebarView(`. Remove the static
   imports that become unused (grep each name in the file first: a sidebar used anywhere else in `Layout.svelte`
   keeps its static import and you report it). Add the `LoadingState` import.
   **Do not touch `HANDLED_ERROR_EVENTS` (~133)** — a peer session may add an `entries:earmark:error` entry there;
   do not reshape, reorder or reformat that set. Re-read the file right before editing; other sessions edit it.
2. **`src/routes/+layout.svelte`** — `HelpSidebar` is drawn only in the `startupError && isDocsRoute` branch
   (~380–385). Make that branch `{#await import(...)}` the same way (pending `LoadingState`, catch: the same block
   in plain markup) and drop the static import. Leave `Layout`, `LoginForm`, `SetupGate`, `AccessibleShell`,
   `AccessibleLoginForm` static (not in the ruling).
3. **`src/lib/client/components/CustomThemeManager.svelte`** ~199–206 — the `CustomThemeEditor` mount, same shape;
   drop its static import.
4. **`src/lib/client/components/pipelines/SchemaForm.svelte`** ~252 — the `CodeField` mount inside the JSON-field
   snippet, same shape; drop the static import if no other use remains (check).
5. **`src/lib/client/admin/AdminView.svelte`** — read only. Its sections already load by `import()`. Report whether
   any static import there is a whole section or a heavy editor; change nothing unless one is (then stop and ask).

The shell's nav reactivity and the "shell knows the user before pages mount" gate (`shouldShowApp`) stay exactly as
they are: you are changing only how a view's code arrives, never when or whether it mounts.

## Tests

- Extend an existing SchemaForm dom test (`src/lib/client/components/pipelines/schemaFormObject.dom.test.ts`,
  `schemaFormChoiceLabels.dom.test.ts` or `schemaFormUnset.dom.test.svelte.ts` — pick the one that already renders a
  JSON-shaped field, or the closest) with one case: the JSON field shows `[role=status]` first and the code field
  (`.cm-editor` or the field's id) after the import settles (`await vi.waitFor(...)` or `await tick()` loops).
  If an existing case in those files now fails because the field is no longer synchronous, adapt that case with an
  await and say which.
- If `src/lib/client/components/sidebars/settingsImportSection.dom.test.svelte.ts` opens the theme editor, add an
  await the same way; if it doesn't, add nothing there.
- Run, capped: `systemd-run --user --scope -p MemoryMax=6G npx vitest run src/lib/client/components/headerBackTakes.dom.test.svelte.ts src/lib/client/components/layoutHandledErrors.test.ts src/lib/client/shell/railViews.test.ts src/lib/client/admin/adminView.dom.test.svelte.ts src/lib/client/components/modals/sceneRunSaidOnce.dom.test.ts src/lib/client/components/pipelines src/lib/client/components/sidebars/settingsImportSection.dom.test.svelte.ts`. Report counts.
- `npx tsc --noEmit -p .` — report only errors in your files. `npx prettier --check` on each file you touch.

## Files owned (edit only these)

`src/lib/client/components/Layout.svelte`, `src/routes/+layout.svelte`,
`src/lib/client/components/CustomThemeManager.svelte`, `src/lib/client/components/pipelines/SchemaForm.svelte`, and
the one SchemaForm dom test you extend (plus `settingsImportSection.dom.test.svelte.ts` only if it needs an await).
Nothing else. `Layout.svelte` and `SchemaForm.svelte` were prettier-unclean before you: format only your own lines by
hand, never `prettier --write` them. Never touch `sessionStore`, `widgetWire`, `RemoteWidget`, `liveRow.ts`,
`broadcastHelpers.ts`, `sessionPageData`/`sessionPageInbox` (another lane's).

## Rules that bind (quoted by the supervisor)

- P1: nothing hidden — the wait is the house `LoadingState`, the failure says what to do. P5: no new setting.
- STYLE-GUIDE §6.7 (above). No new component, snippet name beyond `viewLoadFailed`, copy, event or setting.
- Svelte 5 runes. `{#await}` with destructured `{:then { default: X }}`; binding props on `X` works as on a static import.
- `socket.off(event)` with no handler removes every listener app-wide — you should have no reason to touch socket
  code; if you find yourself there, stop.
- No `crypto.randomUUID`, no `navigator.clipboard`.

## Stop and ask (in your report) when

A sidebar is used outside the chain so its import can't go; a test that mounts the shell breaks in a way an await
doesn't fix; nav or the user gate would change; AdminView has a heavy static import; you'd need any new name or copy.

## Verbatim

- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."
- "Never pipe vitest into `head`. Run int tests in a capped scope: `systemd-run --user --scope -p MemoryMax=6G npx vitest run <files>`."
- "Never run `prettier --write` on a directory; only on the files you edited, and only if they were prettier-clean before your edit (`git stash` is banned — check with `git diff --stat`)."
- You do not need `sdk:build` or `npm run build`; don't run either.

## Report

Changed files with line ranges; which static imports went and which stayed (why); AdminView finding; tests with
counts; tsc/prettier results; anything noticed, not done.
