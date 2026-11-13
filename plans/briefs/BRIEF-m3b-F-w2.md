# BRIEF m3b-F-w2 — a provided row says "Comes with <plugin>", in a Ready-made group (client)

Lane **m3b-F**, worker 2 of 2. Supervisor: the m3b-F lane-supervisor. Work from `/home/jody/github/serene-pub`. Use absolute paths.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (No SDK edit is in scope: you should never need `sdk:build`.)

## Goal
Owner ruling 2026-11-05: a member sees a plugin's provided lorebook (readable pub-wide) in the Lorebooks view under **Shared with you**, "Shared by admin" — it should say **"Comes with Mundi"**, the plugin's name, as the admin's Starter lorebooks page says "Comes with Serene Pub" for a core primer. "The admin who enabled it is not the point; the plugin is."

The server (worker 1, in parallel) adds to each `lorebooks:list` row's `provided` a field **`pluginName: string | null`**: the plugin's display name; **`null` means core** (Serene Pub) — the same meaning `readOnly.pluginName` already has. A row without `provided` is not a provided book. Write against that shape; read it loosely (`provided?: unknown` style, as `isProvidedBook` does) so your code does not depend on worker 1's type landing first.

The supervisor's ★ recommendation, which you build: provided rows leave **Shared with you** for a group of their own, **Ready-made** — the word the Layouts tab already uses (owner-ruled 2026-10-14) for things that come with the pub or a plugin rather than from a person ("A pub genre's layout, mislabelled _Shared with you_, reads _This pub_").

1. `src/lib/client/lorebooks/starterKitCards.ts` — add one pure export beside `isProvidedBook`/`primerRowLine`:
   `providedRowLine(book: { provided?: unknown } | null | undefined): string | null` — `null` when the row has no `provided`; else `pluginName === null` → `"Comes with Serene Pub"`; a non-empty string → `` `Comes with ${pluginName}` ``; anything else (missing/empty, e.g. an older reply) → `"Comes with a plugin"`. JSDoc: 🚧 (m3b-F), what it is, and that it is not `primerRowLine` (the primer row's clone-only sentence) and not `sharedFromLine` (a person's share). These are the exact strings `kitSourceLine` already uses for core/plugin — reuse those words, do not invent new ones.
2. `src/lib/client/lorebooks/LorebooksWorkspace.svelte`:
   a. `sharedSubtitle` snippet (~line 2783–2790): the line reads `providedRowLine(book)` when it is non-null, else today's `Shared by <ownerName>` / `Shared with you`; then ` · read only` as today. Keep `data-lore-shared`.
   b. The list (~3165–3190, the `{#if shelf.shared.length}` group): split `shelf.shared` into provided rows (`isProvidedBook`) and the rest, as two `$derived` next to `ownBooks`/`ownKits` (~1591). Draw a new group **before** "Shared with you": `<ListGroupLabel label="Ready-made" id="loreReadyMade" />` and a `role="list" aria-labelledby="loreReadyMade"` div, each row a `LorebookListItem` with **exactly the props the Shared group passes today** (no new behaviour: no attach, no clone, no delete). The "Shared with you" group then lists only the non-provided shared rows and is drawn only when there are any. One short comment on the new group: a book that comes with the pub or a plugin, readable by everyone (m3b-F); read and Duplicate here, like a share.
   c. Import `providedRowLine` in the existing `./starterKitCards` import. Nothing else in this file changes.
3. Tests:
   a. `src/lib/client/lorebooks/starterKitCards.test.ts` — one `test(...)` for `providedRowLine`: no `provided` → null; `pluginName: "Mundi"` → "Comes with Mundi"; `null` → "Comes with Serene Pub"; missing / `""` → "Comes with a plugin".
   b. A new dom test `src/lib/client/lorebooks/providedRow.dom.test.ts` that mounts `LorebooksWorkspace` — copy the harness (mocks, socket/interest setup, mount, `client.dispatch("lorebooks:list", …)`) from `src/lib/client/lorebooks/lorebooksWorkspace.counts.dom.test.ts`. Dispatch a list with: one own book; one book shared by a person (`isSharedWithMe: true, ownerName: "Ada"`); one provided book (`isSharedWithMe: true, ownerName: "admin", bookAccess: "shared", provided: { disabled: false, pluginName: "Mundi" }`). Assert: the list labelled by "Ready-made" holds the provided row and not Ada's; the list labelled "Shared with you" holds Ada's and not the provided row. Then, if the harness can open a book (see how the counts test routes to a book), open the provided book and assert the `[data-lore-shared]` line reads `Comes with Mundi · read only` (whitespace-normalised) and contains no "Shared by". If opening a book in this harness proves impractical, say so in the report and keep the list assertions — don't build a new harness.
   Note: the row's own second line under its name ("From admin") is drawn by `src/lib/client/components/listItems/LorebookListItem.svelte`, which is **not yours** — do not assert on it and do not edit it; the supervisor queues that change.

## Files owned
`src/lib/client/lorebooks/starterKitCards.ts`, `src/lib/client/lorebooks/starterKitCards.test.ts`, `src/lib/client/lorebooks/LorebooksWorkspace.svelte` (the hunks above only), `src/lib/client/lorebooks/providedRow.dom.test.ts` (new).
`LorebooksWorkspace.svelte` and `starterKitCards.ts` are dirty at HEAD and other programmes edit this tree: **re-read the exact lines immediately before each edit**, additive hunks only, never reformat (no prettier `--write` on them). Run `npx prettier --check` on your NEW test file only (and `--write` it if needed).

## Files readable
Anything. Useful: `src/lib/shared/utils/sharedRows.ts` (`splitSharedRows`, `sharedFromLine`), `src/lib/client/components/listItems/LorebookListItem.svelte`, `src/lib/client/lorebooks/providedBooks.dom.test.svelte.ts`.

## Out of scope
`LorebookListItem.svelte`, `sharedRows.ts`, the start/edit session forms (their book pickers draw names only — no share words), the admin's Starter lorebooks page, any server file, docs, NOMENCLATURE, any new setting, behaviour (attach/clone) on the new group.

## Rules (quoted; obey them)
- CLAUDE.md Decisions: "Decide implementation inside the asked scope (structure, helpers, tests, existing patterns); name the choice in your report." "Propose and wait … on anything a user sees …: behaviour, layout, copy, a new name …" — the only new user-visible words are **Ready-made** (group label) and the **Comes with …** lines above; the only new export is `providedRowLine`. Nothing else.
- "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing."
- STYLE-GUIDE §10 Writing: "Sentence case everywhere." "One name per thing, across the whole flow." "Labels are nouns, hints are sentences …" "No filler: a screen with nothing to say says nothing."
- NOMENCLATURE R1 "One word, one meaning." R3 "Qualify, never abbreviate to the bare noun." — `pluginName: null` is core (Serene Pub), never "unknown".
- Sockets standing ruling: "one domain context per event family … is the only listener, and the only place that toasts; views register listeners for local state and never call `toaster`." Add no listener and no toast.
- "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`." (Use `$derived` arrays here; no Sets needed.)
- "`socket.off(event)` with no handler removes **every** listener app-wide; always pass the handler."
- Browser code: "no `crypto.randomUUID`, no `navigator.clipboard`."
- Tests: run only `npx vitest run src/lib/client/lorebooks/starterKitCards.test.ts src/lib/client/lorebooks/providedRow.dom.test.ts src/lib/client/lorebooks/providedBooks.dom.test.svelte.ts src/lib/client/lorebooks/lorebooksWorkspace.counts.dom.test.ts`. **Never pipe vitest into `head`**; redirect to `/tmp/claude-1000/-home-jody-github-serene-pub/66e86768-ea43-4e92-bc4d-5f956a670b22/scratchpad/m3b-F-w2-*.log` and read it. A failing `assert` on a happy-dom element has OOM-killed VS Code: assert on strings/booleans you extracted (e.g. `textContent`), not on elements.
- Typecheck: `npx tsc --noEmit -p . > <scratchpad>/m3b-F-w2-tsc.log 2>&1`, grep for your files. svelte-check is the lead's; you may run `npx svelte-check --threshold error 2>&1 > <scratchpad>/m3b-F-w2-check.log` and grep for `LorebooksWorkspace`.

## Stop and ask (in your report) when
A ★ would be needed, a name beyond the ones above seems needed, or a file outside your list must change.

## Done means
The four test files above green; no tsc/svelte-check error in your files.

## Report
Write `plans/REPORT-m3b-F-w2-2026-11-05.md`: changed files with the hunks' line ranges, the tests run with pass/fail counts, the tsc/check result, whether the dom test opens the book, Noticed-not-done. Then end.
