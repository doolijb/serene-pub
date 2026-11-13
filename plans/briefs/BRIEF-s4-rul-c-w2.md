# BRIEF — s4-rul-c-w2 (2026-11-10) — the start form's books grouped by source

Supervisor: lane `s4-rul-c` (it read the rules and quotes what you need below). Repo: `/home/jody/github/serene-pub`. Use absolute paths. `StartSessionForm.svelte` is 3,261 lines: read line ranges, never the whole file.

## Owner's words (never reinterpret)

- c-3, approved: *"Categorize them by source, i.e. a plugin name, another user, a template"*. A template book is a **starter lorebook** in the canon.
- 2026-11-09: *"Own: start on; shared: copy"* (already built; keep it).

## Goal — move rows, never change what a row does

In `src/lib/client/components/sessionForms/StartSessionForm.svelte`, the books that aren't the asker's own are grouped by where they come from. **Your own books stay first, as today**, with **How it starts** under an own surfaced book (`surfacedStartChoice`). Every existing start rule stays exactly as it is: a provided book's row calls `chooseLorebook(l.id)` (read directly), a shared surfaced book's row calls `chooseSurfacedBook(l.id)` (copy only, switches to `new-world`), starter lorebooks stay in `StarterKitPicker`. Same buttons, same `data-book-row`, same fit lines, same disabling. Only where a row sits, and its heading, change.

What the list already carries (no server change needed): each `lorebooks:list` row may have `provided?: { disabled: boolean; pluginName: string | null }` (`pluginName` null = core, worded **Serene Pub**; see `src/lib/client/lorebooks/starterKitCards.ts` ~35–47) and `ownerName?: string | null` on shared rows (`src/lib/shared/sockets/types.ts` ~8154–8188). Do not edit `types.ts` or any server file.

Today (read these ranges): `handleLorebooksList` ~252–265 puts own books **and provided books** in `lorebookList` and shared surfaced books in `sharedSurfacedList`; `lorebookOptions` ~742–749; `sharedSurfacedOptions` ~757–759; snippets `surfacedStartChoice` ~2268–2330 and `surfacedBooksGroup` ~2332–2402; the **book pick** layout (**Lorebook and rules** card) ~2541–2800, whose **Your lorebooks** group is ~2598–2734; the plain **Lorebook** card (Chat, Guide) ~2855–2970, whose one radiogroup holds **None** and every book.

Build:

1. Split `lorebookOptions` (derived, no new state) into **own** rows (no `provided`) and **plugin** groups: rows with `provided`, grouped by `provided.pluginName ?? null`, the group label the plugin's name (null → `Serene Pub`), groups sorted by label (`localeCompare`), rows in list order. A provided book goes in its plugin's group whoever owns the row (an admin's too). Keep `lorebookOptions` itself (other code reads it: `ownSurfacedChosen`, the empty-state test `lorebookOptions.length === 0` — leave that condition as it is).
2. Group `sharedSurfacedOptions` by person: `ownerName` (null/empty → one group labelled `Shared with you`), groups sorted by name.
3. **Book pick layout**: extract the existing own-book `<li>` (row button, fit line, Freeform **Play it with**, `surfacedStartChoice`) into one snippet and render it for the own group and for each plugin group, so the rows are identical. Order: **Your lorebooks** (own rows, heading shown only when there are own rows, as now) → one group per plugin → one group per person (shared) → **Start blank** → **Start from a starter lorebook** (unchanged).
4. **Plain Lorebook card**: the first radiogroup keeps **None** and the own rows; then one group per plugin (same row markup as today's book row there, also extracted into a snippet), then the person groups, then the starter lorebooks as now.
5. Each group: a heading `<p id=… class="text-chip mt-4 font-medium">` (the form's existing group-heading recipe) and a `<ul class="mt-2 flex flex-col gap-1" role="radiogroup" aria-labelledby=…>`. Ids must be unique and stable: index-based is fine (`start-book-plugin-heading-{i}`, `start-book-shared-heading-{i}`; the plain card's own prefix so the two layouts never share an id). Hooks for tests: the group wrapper gets `data-book-group="plugin"` or `data-book-group="shared"` and `data-book-group-label={label}`. Keep the existing `data-surfaced-books` attribute on one wrapper around all the person groups (existing tests use it).
6. Copy (★ for the owner — build exactly this; the supervisor proposes it):
   - plugin group heading: **Comes with ‹plugin name›** (core: **Comes with Serene Pub**) — the canon's existing source wording (`starterKitCards.ts`).
   - person group heading: **Shared by ‹name›** (no name: **Shared with you**), and under it one muted line `class="text-surface-600-400 mt-1 text-xs"`: *Their session's lorebook. The new session starts on a copy; theirs stays as it is.* The per-row *Shared by ‹owner›* line is dropped (the heading says it).
   - the old shared heading *Start from a shared session's lorebook* and its note are replaced by the above.
   - **Your lorebooks**, **Start blank**, **Start from a starter lorebook** are unchanged.

## Tests

- New `src/lib/client/components/sessionForms/startSessionBookSources.dom.test.svelte.ts`, modelled on `startSessionModes.dom.test.svelte.ts` (its socket mocks and how it feeds `lorebooks:list`). With a genre that shows the book pick AND with one that shows the plain Lorebook card (see `startSessionRules.dom.test.svelte.ts` / `startSessionModes` for how each is reached): feed own books, provided books from two plugins plus one core (`pluginName: null`), shared surfaced books from two people and one with no `ownerName`, and starter kits. Assert each book's row (`data-book-row`) sits inside the group whose `data-book-group-label` is its source, the heading texts, group order (own first, then plugins sorted, then people sorted), and that a plugin row still sends `chooseLorebook` behaviour (mode unchanged) while a shared row switches to `new-world` — whatever the existing tests already observe for those, observe the same.
  ⚠ Assert on strings, numbers and booleans (`textContent`, `getAttribute`, `.length`, `closest(...)?.getAttribute(...)`), **never pass a happy-dom element to `expect`** — a failing assert that prints an element has OOM-killed VS Code.
- Existing start-form tests stay green; update only text expectations that this goal changes (e.g. the old shared heading or the per-row *Shared by* line in `startSessionModes`), and say which.

Run only these, in a capped scope, logged (scratch dir `/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/`, names start `s4-rul-c-w2`):
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; cd /home/jody/github/serene-pub; npx vitest run <files> --maxWorkers=2 > <scratch>/s4-rul-c-w2-tests.log 2>&1; echo test-exit=$? >> <scratch>/s4-rul-c-w2-tests.log'`
Files: the new test and the five `src/lib/client/components/sessionForms/startSession*.dom.test.svelte.ts`. Never pipe vitest into `head`.

## Docs (same change)

`docs/sessions.md` step 6 bullets (~24–29): replace the **Start from a shared session's lorebook** bullet with two bullets in order after **Your lorebooks**: **Comes with ‹plugin›** — lorebooks a plugin (or Serene Pub) provides, one group per plugin, read directly like your own; **Shared by ‹name›** — lorebooks people shared from their sessions, one group per person; the new session starts on a copy; theirs stays as it is. Plain second-person words, no code names; never frame a session as having no lorebook.

## Files owned (edit nothing else)

`src/lib/client/components/sessionForms/StartSessionForm.svelte` (the lorebook groups only); the new test file; the five existing `startSession*.dom.test.svelte.ts` (text expectations this goal changes only); `docs/sessions.md` (step 6 bullets only).

## Rules your work depends on (quoted by the supervisor)

- STYLE-GUIDE §1/§6.4: a picker says why you'd choose a row; keep each row's existing second line (fit / rules). Rows stay ≥ 44px (`min-h-11`, as today). The selected row keeps `sidebar-row-active` + the check icon.
- CLAUDE.md: *"`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`."* Use `$derived` for the groups (plain arrays/Maps built inside the derived are fine). Browser code: no `crypto.randomUUID`, no `navigator.clipboard`. Views never call `toaster`/`notify`.
- *"It is a session, never a chat."* Never write copy that frames a session as having no lorebook.
- No new socket, field, setting or name beyond the snippet/derived names you need inside the component (mark them 🚧 in a comment). If the payload turns out to lack something, stop and say so.
- Do what was asked, at the size asked. Findings go under **Noticed, not done**, never fixed in passing.
- **Prettier:** run `npx prettier --check` on changed files, but **only `--write` the lines you changed** — never reformat a whole file you didn't otherwise edit (a whole-file `--write` re-sorts classes and reflows markup other work owns). This file was whole-file-written once already by mistake; don't do it again. If a file fails the check only on lines you didn't touch, leave it and say so.

## Verbatim rules

- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no `sdk:build`; the owner's dev server is up.)

## Report (your final message)

Changed files with line ranges; each decision; tests run with pass/fail counts and the log path; which existing expectations you changed and why; Noticed, not done.
