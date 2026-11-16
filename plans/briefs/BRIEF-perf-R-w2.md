# BRIEF perf-R-w2 — the character picker's list and two home-page modals load on first open

Supervisor: perf-R (performance plan round 5, R5-3; owner go 2026-11-14). You are a worker: do exactly this, nothing more.

## Goal
The home page (`src/routes/+page.svelte`) statically imports modals its first screen never shows. Make their code load
when it is first needed, with **no visible change** and **no change to when any component's script runs relative to its
gate** (listeners and interests stay as they are). Three parts.

## Part A — `CharacterSelectModal`: the list loads when the dialog opens
`src/lib/client/components/modals/CharacterSelectModal.svelte` stays mounted wherever it is used (the home page, the
session forms, the cast workspace, the reassign modal) with the same props and the same module script
(`PickMember`, `castPickMembers` stay exported from it). Split it:

1. **The modal keeps**: both `<script>` blocks' props and module exports, `search`, `searchInput`, the `<Dialog {open}
   {onOpenChange} initialFocusEl={() => searchInput}>` frame (Portal, Backdrop, Positioner, Content), the `<header>`
   (title, close button) and the search `<input>` — so the search box takes focus on open exactly as now and the search
   text survives closing and reopening exactly as now.
2. **New `src/lib/client/components/modals/CharacterSelectList.svelte`** holds everything in `Dialog.Content` after the
   search input, moved **verbatim** (same elements, classes, text, attributes; do not reword or restyle): the multi-mode
   room line (`{#if multiSelect && selectedLimit != null}`), the empty state / `cardRows` + `castRows` snippets / grouped
   and ungrouped lists / **New character** button, and the multi-mode `<footer>`. **No wrapper element** — the pieces must
   stay direct children of `Dialog.Content` (it is a flex column; the lists' `min-h-0 overflow-y-auto` depend on it).
   Its script takes the derived state and the ticking with them: `Row`, `CastEntry`, `offered`, `filtered`,
   `castEntries`, `filteredCast`, `otherCards`, `grouped`, `picked`, `pickedMembers`, `total`, `atLimit`, `emptyMessage`,
   `addLabel`, `toggle`, `toggleMember`, `confirmMulti`, and the imports they use (`CharacterPickRow` + `pickRowMatches`,
   `EmptyState`, `ListGroupLabel`, `* as Icons`, `import type { PickMember } from "./CharacterSelectModal.svelte"`).
   Props, exactly these 12, same names and defaults as the modal's: `characters`, `excludeIds`, `castMembers`,
   `excludeCastMemberIds`, `castGroupLabel`, `multiSelect`, `selectedLimit`, `search`, `onSelect`, `onCreateNew`,
   `onMultiSelect`, `onOpenChange`. A short top doc comment: the picker's list, loaded by `CharacterSelectModal` when it
   opens; it mounts with each opening, so every opening starts with nothing ticked.
3. **The reset `$effect`** (`if (open) { picked = []; pickedMembers = [] }`) goes: the list mounts with each opening, so
   `picked` / `pickedMembers` start empty each time. Keep the modal's doc comment about multi mode true.
4. In the modal, after the search input:
   ```svelte
   {#if open}
       {#await import("./CharacterSelectList.svelte")}
           <LoadingState />
       {:then { default: CharacterSelectList }}
           <CharacterSelectList {characters} {excludeIds} {castMembers} {excludeCastMemberIds} {castGroupLabel}
               {multiSelect} {selectedLimit} {search} {onSelect} {onCreateNew} {onMultiSelect} {onOpenChange} />
       {/await}
   {/if}
   ```
   (format to the file's style, tabs). Import `LoadingState from "../LoadingState.svelte"`; drop the imports only the
   list uses now.
5. Tests: `characterSelectModal.dom.test.svelte.ts` and `CharacterSelectModal.castMembers.dom.test.ts` mount the modal
   open and read the list right after `settle()`. Make them wait for the list without weakening any assertion — preferred:
   warm the module once (`beforeAll(async () => { await import("./CharacterSelectList.svelte") })`) so the modal's import
   resolves in a microtask; if a test still races, make `render()` wait until the list has mounted. Add one test in
   `characterSelectModal.dom.test.svelte.ts`: a closed picker (`open: false`) has the search box (hidden) but no list
   rows and no **New character** button in the document — the list loads only when it opens. Do not change what the
   other tests assert. Update a test file's top comment only if it would otherwise be untrue.

## Part B — `+page.svelte`: two modals load inside their existing gates
Edit **only** the import lines (`:40–51`) and the mount sites (`:3736–3800`) of `src/routes/+page.svelte`.

1. Remove the static imports of `PersonaSelectModal` and `BindingLinkerModal` (`:46–47`). Keep
   `CharacterCreator` and `CharacterSelectModal` imports as they are. Add `import LoadingState from
   "$lib/client/components/LoadingState.svelte"` beside them (only if the page does not import it already — it does not
   today).
2. Persona picker (`:3778`): inside the existing `{#if dataReady && !setupComplete && currentWizardStep === "persona"}`,
   wrap the unchanged `<PersonaSelectModal …/>` in
   `{#await import("$lib/client/components/modals/PersonaSelectModal.svelte") then { default: PersonaSelectModal }}` …
   `{/await}`. **No pending branch**: the picker opens only on a later click inside that step.
3. Binding linker (`:3792`): inside the existing `{#if bindingLinkerData}`, wrap the unchanged `<BindingLinkerModal …/>`
   in `{#await import("$lib/client/components/modals/BindingLinkerModal.svelte")}<LoadingState />{:then { default:
   BindingLinkerModal }}` … `{/await}`. It **has** a `<LoadingState />` pending branch because it opens at the moment its
   gate does (`handleBindingCheckResult` sets `bindingLinkerData` and `bindingLinkerOpen` together, `:1603–1604`).
4. Every prop and binding on the two components stays as it is. Comments above the mount sites stay; you may add one
   short line at each saying the modal's code loads when its gate mounts it (comment ratchet below).
5. Done check: `grep -n "^\s*import .*modals/" src/routes/+page.svelte` shows only `CharacterCreatorModal` and
   `CharacterSelectModal`.

## Files owned (edit only these)
- `src/lib/client/components/modals/CharacterSelectModal.svelte`
- new `src/lib/client/components/modals/CharacterSelectList.svelte`
- `src/lib/client/components/modals/characterSelectModal.dom.test.svelte.ts`
- `src/lib/client/components/modals/CharacterSelectModal.castMembers.dom.test.ts`
- `src/routes/+page.svelte` — **only** the import lines `:40–51` and the mount sites `:3736–3800`

## Files readable
`PersonaSelectModal.svelte`, `BindingLinkerModal.svelte` (their scripts do not change), `LoadingState.svelte`,
`sessionForms/CharacterPickRow.svelte`, `EmptyState.svelte`, `panels/ListGroupLabel.svelte`,
`personaSelectModal.dom.test.svelte.ts`.

## Out of scope — never built
`CharacterCreatorModal.svelte` and its test (another worker), `NOMENCLATURE.md` (the supervisor), anything else in
`+page.svelte`, `PersonaSelectModal.svelte`, `BindingLinkerModal.svelte`, `Layout.svelte`, the pipelines modals; rewording
or restyling; a generic lazy-mount helper; module-scope prefetch or caching of an import.

## Rules
- P1: the lazy import sits where the body renders; no module-scope prefetch, no cache.
- Sockets ruling: "one domain context per event family is the only listener" — no `socket.on`, `requestWithInterest`,
  `useInterest` or store subscription changes its mount timing (the persona picker's standing `characters:list` interest
  mounts when the persona step mounts the picker, as now). If a change would, stop and report.
- Comment ratchet: say what the code does now; avoid "no longer", "used to", "previously".
- `socket.off(event)` with no handler removes every listener app-wide — not expected here; never write one.
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- **Never run `prettier --write`** (not on a directory, not on a file: on 2026-11-14 it reformatted another session's
  uncommitted hunks). `npx prettier --check <file>`, then fix only your own hunks by hand. `+page.svelte` may already fail
  the check from other hunks — leave those.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You need no sdk:build and no `npm run build`.)
- Never `git checkout` / `restore` any file.

## Stop and ask (in your report) when
The list needs props beyond the 12 above; a test can only pass by weakening an assertion; anything would change visibly;
anything outside the owned files seems needed.

## Done means
- `pgrep -af vitest` shows no other run (wait and re-check if one is up — another worker may be running its test), then
  `systemd-run --user --scope -p MemoryMax=6G --quiet npx vitest run src/lib/client/components/modals/characterSelectModal.dom.test.svelte.ts src/lib/client/components/modals/CharacterSelectModal.castMembers.dom.test.ts src/lib/client/components/modals/personaSelectModal.dom.test.svelte.ts`
  green. Never pipe vitest into `head`.
- The grep in Part B step 5.
- `npx prettier --check` on the new file and the two tests clean; your hunks in the modal and the page clean.
- Report (your final message): changed files, the list's props as built, how the tests wait, test output summary,
  anything you were unsure of.
