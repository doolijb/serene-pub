# BRIEF m2e-C2-w1 — four small client + vocabulary fixes (2026-11-04)

Supervisor: lane **m2e-C2**. Work from `/home/jody/github/serene-pub`. Use absolute paths. Report to `plans/briefs/REPORT-m2e-C2-w1.md`: changed files, each item done or not and why, tests run with pass counts, anything you could not do, Noticed-not-done. Do not decide anything outside this brief; if a step does not fit what you find on disk, stop that step and say so in the report.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (This task needs no `sdk:build`.)

Also: never `git checkout` / `restore` anything (other lanes' uncommitted work lives in these files); never pipe vitest into `head`; never edit `src/lib/server/**` (lane m2e-D2 is editing it right now), `src/app.d.ts`, or any file not listed under Files owned.

## Files owned (the only files you may edit)
- `src/lib/client/admin/sections/starter-kits/Page.svelte`
- `src/lib/client/admin/sections/starter-kits/starterKitsAdmin.dom.test.svelte.ts`
- `src/lib/client/components/AppletCard.svelte`
- `src/lib/client/components/listItems/LorebookListItem.svelte`
- `src/lib/client/lorebooks/BookSettings.svelte`
- `NOMENCLATURE.md` — only the two row edits in item 2.

## Files readable
Anything. Useful: `src/lib/client/components/InlineError.svelte`, `src/lib/client/sockets/typedSocket.ts:501–516`, `src/lib/server/sockets/plugins.ts:678–720` (read only), `git diff -- <file>` for the two files in item 4.

## Rules you work under (quoted)
- CLAUDE.md Decisions: *"Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing. Nothing 'for later'."*
- CLAUDE.md Standing ruling, Sockets: *"one domain context per event family (provided by both shells) is the only listener, and the only place that toasts; views register listeners for local state and never call `toaster`."* — the line you add is NOT a toast; do not add any `toaster` call.
- CLAUDE.md Hard rule: *"`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`."* Browser code: *"no `crypto.randomUUID`, no `navigator.clipboard`."*
- STYLE-GUIDE §6.11: *"A blocked action says why in one line beside it and links to the fix."*
- STYLE-GUIDE §6.4 Field help: *"What went wrong is **`InlineError`** (`components/InlineError.svelte`): `role="alert"`, `text-error-600-400`, 13px, a 14px alert icon."* Its doc: *"mount it only while there is an error."*
- STYLE-GUIDE §10: *"errors say what went wrong and what to do."* No new copy beyond the error line itself (the server's sentence).
- STYLE-GUIDE §9: every control keeps its accessible name; nothing hover-only.
- NOMENCLATURE R1 one word one meaning; R3 qualify, never the bare noun; R6 mark ⏳ transitional / 🚧 provisional. No new names in this task beyond the two local variables named below.

## Item 1 — a refused switch says why (Admin › Starter lorebooks)
Today `Page.svelte:80–87` hears `plugins:disableProvidedBook:error` and `plugins:enableProvidedBook:error` with `() => {}`, so a refusal is silent. The error payload is `{ error?: string }` and carries no slug; the server sends it to every tab of the admin, so only the tab that pressed may claim it (same idea as `pendingClone`).
Build exactly this:
- Two locals beside `pendingClone`: `let pendingSwitch: string | null = null` (the `row.id` of the switch this tab pressed, plain `let`, like `pendingClone`) and `let switchError = $state<{ rowId: string; text: string } | null>(null)`. Comment each in one line, 🚧 (M2e).
- `setDisabled` sets `pendingSwitch = row.id` before it emits.
- Both `:error` listeners: if `pendingSwitch === null` return; else `switchError = { rowId: pendingSwitch, text: res?.error || <fallback> }` and `pendingSwitch = null`. The fallback is the server's own fallback sentence, unchanged: `"The lorebook could not be disabled."` for the disable event, `"The lorebook could not be enabled."` for enable.
- Both success listeners (`plugins:disableProvidedBook`, `plugins:enableProvidedBook`), now `() => {}`: when `pendingSwitch !== null`, set `pendingSwitch = null` and, if `switchError` is set, clear it (`switchError = null`). That is "cleared on the next successful re-send". Keep the existing comment that the server's `starterKits:list` re-send is what shows the switch's state.
- Markup: in the `actions` cell, wrap the existing `<span ... data-kit-actions={row.id}>` in `<div class="flex flex-col items-end gap-1">`, and after the span render `{#if switchError?.rowId === row.id}<InlineError data-kit-switch-error>{switchError.text}</InlineError>{/if}`. Import `InlineError` from `$lib/client/components/InlineError.svelte`. Do not change the switch, its copy, or the other buttons. No toast.
- Do NOT touch the plugin page (`admin/sections/plugins/IdPage.svelte`): its refusal already lands in `formErrors` via `awaitReply`'s `errorEvent`.

Tests — add a `describe` block (or tests inside the existing "provided books (M2e)" block) in `starterKitsAdmin.dom.test.svelte.ts`, using the file's `feed`/`settle`/`render` harness and its `PRIMER` fixture (a row may draw twice, table and stacked: query the first):
1. Press the switch, `feed("plugins:disableProvidedBook:error", { error: "Only admin users can manage plugins." })`: an element `[data-kit-switch-error]` with `role="alert"` and that text sits inside the row's actions (`[data-kit-actions="book:7"]`'s parent), and no other row has one.
2. After 1, press again and `feed("plugins:disableProvidedBook", { pluginId: "core", slug: PRIMER.provided.slug, disabled: true, lorebookId: 7 })`: no `[data-kit-switch-error]` remains.
3. Without pressing, `feed("plugins:enableProvidedBook:error", { error: "x" })` (another tab's refusal): no `[data-kit-switch-error]`.
4. An error with no `error` field after pressing a disabled row's switch (enable) shows "The lorebook could not be enabled."

## Item 2 — two NOMENCLATURE charters (re-read before editing)
Another programme appends rows at NOMENCLATURE.md's tail at the same time. Immediately before each edit, re-read the exact line (`grep -n` then `sed -n`), and edit by exact string with the Edit tool (never by line number, never by rewriting the file). Change nothing else in the file.

(a) The `plugins.provided` row (today ~line 3156, starts `| _(new)_ — a provided book an administrator deleted came back at the next sync |`). Replace ONLY its purpose and owns clauses inside the Charter. Old text:
`**Charter:** purpose, remember a deleted provided book so it stays deleted; why, it came back at the next sync; owns, `plugins.provided` dismissal marks; not, an admin's swap choices or the plugin's settings.`
New text:
`**Charter:** purpose, ⏳ transitional — it once remembered a deleted provided book so it stayed deleted; the boot pass `turnTombstonesIntoDisabled` turns each `dismissed` into the book's own disabled mark (`lorebooks.extra_json.provided.disabled`, row **disabled** below), which owns it now; why, it came back at the next sync; owns, each slug's last import outcome (`failed` · `refused`) and the `disabled[slug]` mark of a book that has no row yet (the next sync moves it onto the book); not, an admin's swap choices or the plugin's settings.`
Leave the rest of the row (its term list and its third cell) exactly as it is.

(b) The **starter lorebook** row (today ~line 386, starts `| **starter lorebook** 🚧 |`). Old fragment:
`Two sources, one card (`Sockets.StarterKits.Card`, id `primer:<id>` · `book:<id>`, `source` `core` · `plugin` · `admin`): a ruleset's or plugin's **primer** (SDK, read straight from the catalogue, immutable by construction; Freeform's empty Blank is not a kit) and an **admin kit**`
New fragment:
`Three sources, one card (`Sockets.StarterKits.Card`, id `book:<id>`, `source` `core` · `plugin` · `admin`; the id `primer:<id>` is kept only for API callers that still name a primer, `{ primerId }`): a ruleset's or plugin's **primer**, imported at boot as an immutable **primer row** (§25; ★M2e-1, owner 2026-11-04: an administrator disables it, never deletes it; Freeform's empty Blank is not a kit), and an **admin kit**`
Leave the rest of the row exactly as it is. Do NOT add anything to §23 (retiring `dismissed` is the owner's call).

## Item 3 — drop a cast
`src/lib/client/components/AppletCard.svelte:53` reads `state: { appletFrom: from } as App.PageState`. `src/app.d.ts` now declares `appletFrom?: "apps" | "home"` on `App.PageState`. Remove ` as App.PageState` so it reads `state: { appletFrom: from }`. If `from`'s type is not assignable to `"apps" | "home"`, stop and report (do not edit app.d.ts).

## Item 4 — drop formatting-only hunks
Lane C ran prettier over two files that were already not prettier-clean at HEAD, so their diffs carry re-wrapped lines no change needed. Make each file's `git diff` show only the real change. Use `git diff -- <file>` and `git show HEAD:<file>` to see the HEAD text; restore HEAD's text for each formatting-only hunk by hand with the Edit tool (never `git checkout`/`restore`).

`src/lib/client/components/listItems/LorebookListItem.svelte` — the real change is: importing `isProvidedBook`, the `canDelete` derived value and its comment, and `onDelete &&` → `canDelete &&` on the separator and the Delete entry. Restore HEAD's text for:
- the import: make it one line, HEAD's style: `import { isProvidedBook, isStarterKit } from "$lib/client/lorebooks/starterKitCards"`;
- the `sessionNotesOf?:` prop type (one line, as at HEAD);
- the World lore entry of `kindChips` (one line, as at HEAD);
- the "Starter lorebook" badge's class order (HEAD: `badge preset-tonal-surface shrink-0 px-1.5 py-0 text-meta`);
- the two `<div class="text-surface-600-400 truncate text-left text-xs">` wraps (one line each, as at HEAD);
- `onSelect: () => onDuplicate?.(lorebook.id!, lorebook.name)` (one line, as at HEAD);
- the Export (paused) entry's indentation (HEAD's indent), keeping `canDelete &&` on the two lines after it.

`src/lib/client/lorebooks/BookSettings.svelte` — the real change is the `isProvided` prop (type + default) and the two `{#if !isProvided}` wraps (their re-indent is part of the change; keep it). Restore HEAD's line wrap of the paragraph at ~321–325 (HEAD: `starter lorebook. Each one started gets its own copy, so what you` / `change here reaches the ones started next.`).

When done, `git diff -- <file>` for each must show only the real change. `npx prettier --check` on both may fail (they failed at HEAD); that is expected — report the result, do not re-run prettier `--write` on them. Run `npx prettier --check` on `Page.svelte`, the test file and `AppletCard.svelte`, and `npx prettier --write` only on those three if needed (they were prettier-clean before your edit — check first with `--check`; if one was not clean before your edit, do not `--write` it).

## Done means (targeted tests only; run each with `npx vitest run <file>`, never piped into `head`)
- `src/lib/client/admin/sections/starter-kits/starterKitsAdmin.dom.test.svelte.ts` — all pass, including your new tests.
- `src/lib/client/admin/sections/plugins/providedBooks.dom.test.svelte.ts` — pass (unchanged file; regression check).
- `src/lib/client/components/AppletCard.dom.test.ts` and `src/lib/client/shell/leaveDestination.test.ts` — pass.
- `src/lib/client/lorebooks/providedBooks.dom.test.svelte.ts` — pass (covers LorebookListItem/BookSettings Delete gating after your de-churn).
- Do not run `tsc`, `svelte-check`, `npm test` or a build: the lead runs one grouped verification.

## Stop and ask (in your report) when
A step's old text is not found as quoted; a type does not line up; anything would need a new name, new copy, or a file outside Files owned.
