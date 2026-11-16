# BRIEF perf-R-w1 — the character creator's steps load on first open

Supervisor: perf-R (performance plan round 5, R5-3; owner go 2026-11-14). You are a worker: do exactly this, nothing more.

## Goal
`src/lib/client/components/modals/CharacterCreatorModal.svelte` is on the home page's first load with its five step
panes, `AvatarCropEditor` (22 KB) and their text. Move the **step panes** into a new sibling component
`CharacterCreatorSteps.svelte`, loaded with `{#await import(...)}` inside the modal's existing `{#if open}`, so they load
on first open. **No visible change, and no change to when the modal's script runs**: the modal component, its script
(state, functions, the `characters:create` `useInterest` at `:376`), its props and its `<Dialog>` frame (Portal, Backdrop,
Positioner, Content, the cancel-confirmation view, the header, the progress bar, the footer) stay where they are.

## Exactly what to do
1. Create `src/lib/client/components/modals/CharacterCreatorSteps.svelte`. Its markup is the **children** of
   `<article class="min-h-[400px]">` in the modal (today lines 490–1022: the `{#if currentStep === 0}` … `{/if}` chain),
   moved **verbatim** (same elements, classes, text, attributes, bindings — do not reword or restyle anything). **No
   wrapper element** around it: the `<article>` stays in the modal.
2. The Steps component's script:
   - Imports what the moved markup uses: `* as Icons from "@lucide/svelte"`, `Avatar from "../Avatar.svelte"`,
     `FileDropzone from "../FileDropzone.svelte"`, `AvatarCropEditor from "../media/AvatarCropEditor.svelte"`,
     `avatarSrc` from `$lib/client/utils/media`, `type MediaFrame` from `$lib/shared/media/frame`.
   - Owns the per-instance ids: move `const uid = $props.id()` and `const ids = { … }` (modal `:54–63`) here together with
     their doc comment (the comment says why ids are per instance; keep its substance, adjust only so it is true where it
     sits now — say what the code does now; never "no longer", "used to", "previously"). The ids are read only by the
     step markup.
   - Declares a local (not exported) `interface CharacterData` identical to the modal's (`:68–77`).
   - Props, exactly these 10, with these names (they are the modal's own names, so the moved markup needs no edits):
     `currentStep: number`, `characterData: CharacterData` (**`$bindable()`** — the inputs `bind:value` into its fields),
     `validationErrors: Record<string, string>`, `cropOpen: boolean` (**`$bindable()`** — the markup sets it),
     `cropSrc: string`, `cropFrame: MediaFrame | null`, `handleAvatarChange: (details: FileAcceptDetails) => void`,
     `onCropSaved: (frame: MediaFrame | null) => void`, `clearAvatarSelection: () => void`,
     `clearValidationError: (field: string) => void`. (`FileAcceptDetails` is the ambient global the modal already uses.)
   - A short top doc comment: what the component is (the creator's step panes, loaded by `CharacterCreatorModal` when it
     opens so they stay off the first page) and that the modal owns all state.
3. In the modal:
   - Replace the article's children with:
     ```svelte
     {#await import("./CharacterCreatorSteps.svelte")}
         <LoadingState />
     {:then { default: CharacterCreatorSteps }}
         <CharacterCreatorSteps
             {currentStep}
             bind:characterData
             {validationErrors}
             bind:cropOpen
             {cropSrc}
             {cropFrame}
             {handleAvatarChange}
             {onCropSaved}
             {clearAvatarSelection}
             {clearValidationError}
         />
     {/await}
     ```
     inside the unchanged `<article class="min-h-[400px]">` (so the dialog keeps its height while the steps load). Use the
     file's tab indentation.
   - Imports: add `LoadingState from "../LoadingState.svelte"`; remove `Avatar`, `FileDropzone`, `AvatarCropEditor` and
     `avatarSrc` (now only used by the Steps). Keep `type MediaFrame` (the script uses it), keep `z` from zod (the script's
     `validateFinalForm` uses it — do not touch the validation).
   - Remove `uid`/`ids` and their comment from the modal (moved). Change nothing else in the script.
4. Update `src/lib/client/components/modals/CharacterCreatorModal.ssr.test.ts`:
   - The ids tests render `CharacterCreatorSteps` directly with `svelte/server`'s `render(…, { props, idPrefix })`
     (props: `currentStep: 0`, an empty draft, `validationErrors: {}`, `cropOpen: false`, `cropSrc: ""`, `cropFrame: null`,
     no-op functions). Keep every assertion they make today (the label points at the per-instance id, exactly one element
     carries it, none of the old literals, two instances get two ids).
   - Keep the "a closed creator leaves no dialog" test on the modal as it is.
   - Add one test on the modal rendered open: its frame renders at once (`Create Character`, `Step 1 of 5: Name`) and the
     step panes are not in the server markup — the loading status (`role="status"`) is in their place.
   - Update the file's top comment so it is true (the ids live in the steps component; the steps load on first open).
     Comment ratchet: what the code does now, no "no longer / used to / previously".

## Files owned (edit only these)
- `src/lib/client/components/modals/CharacterCreatorModal.svelte`
- new `src/lib/client/components/modals/CharacterCreatorSteps.svelte`
- `src/lib/client/components/modals/CharacterCreatorModal.ssr.test.ts`

## Files readable
`src/lib/client/components/LoadingState.svelte`, `src/lib/client/components/media/AvatarCropEditor.svelte`,
`src/lib/client/components/Avatar.svelte`, `src/lib/client/components/FileDropzone.svelte`.

## Out of scope — never built
Any other file (`+page.svelte`, `CharacterSelectModal.svelte`, `NOMENCLATURE.md` — the supervisor does those); rewording,
restyling or restructuring anything; removing zod or changing validation; a generic lazy-mount helper; module-scope
prefetch or caching of the import.

## Rules
- P1: the lazy import sits where the body renders; no module-scope prefetch, no cache.
- Sockets ruling: "one domain context per event family is the only listener" — the modal's `useInterest` stays exactly
  where and as it is. If anything you do would change when a `socket.on`, `useInterest`, `requestWithInterest` or store
  subscription mounts, stop and report.
- Comment ratchet: say what the code does now; avoid "no longer", "used to", "previously".
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- **Never run `prettier --write`** (not on a directory, not on a file). `npx prettier --check <file>`, then fix only your
  own hunks by hand.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You need no sdk:build and no `npm run build`.)
- Never `git checkout` / `restore` any file.

## Stop and ask (in your report) when
The moved markup needs more than the 10 props above; anything would change visibly; anything outside the owned files
seems needed.

## Done means
- `pgrep -af vitest` shows no other run (wait and re-check if one is up), then
  `systemd-run --user --scope -p MemoryMax=6G --quiet npx vitest run src/lib/client/components/modals/CharacterCreatorModal.ssr.test.ts`
  green. Never pipe vitest into `head`.
- `npx prettier --check` on the three files: the new file and the test clean; in the modal, your hunks clean.
- Report (your final message): changed files, the props as built, test output summary, anything you were unsure of.
