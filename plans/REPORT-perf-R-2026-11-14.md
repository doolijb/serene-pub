# REPORT perf-R — home page: modal bodies off the first page (R5-3) — 2026-11-14

(Saved by the lead from the supervisor's hand-back; the harness refused the supervisor's own write.)

## Changed files
- `src/lib/client/components/modals/CharacterCreatorModal.svelte` — the step panes moved to a new file; the
  `<article class="min-h-[400px]">` holds `{#await import("./CharacterCreatorSteps.svelte")}<LoadingState />{:then}`.
  Removed imports: `Avatar`, `FileDropzone`, `AvatarCropEditor`, `avatarSrc`. Script, `characters:create` interest,
  props and Dialog frame unchanged.
- new `src/lib/client/components/modals/CharacterCreatorSteps.svelte` — the five step panes + `AvatarCropEditor`, no
  wrapper element, owns the per-instance ids; 10 props (`characterData`, `cropOpen` bindable).
- `src/lib/client/components/modals/CharacterSelectModal.svelte` — keeps exports, props, `search`, Dialog frame, header,
  search box; after the search box `{#if open}{#await import("./CharacterSelectList.svelte")}<LoadingState />{:then}`.
  The reset `$effect` is gone: the list mounts on each opening, so it starts with nothing ticked.
- new `src/lib/client/components/modals/CharacterSelectList.svelte` — room line, rows, snippets, empty state, New
  character, multi-mode footer; derived state and ticking; 12 props.
- `src/routes/+page.svelte` — `PersonaSelectModal` and `BindingLinkerModal` imports removed, `LoadingState` added;
  persona picker `{#await import() then}` inside its step gate; binding linker `{#await}<LoadingState />{:then}` inside
  `{#if bindingLinkerData}`. Modal imports left: `CharacterCreatorModal` (`:45`), `CharacterSelectModal` (`:46`).
- Tests: `CharacterCreatorModal.ssr.test.ts` (ids tests render `CharacterCreatorSteps`; new test: open frame renders at
  once with `role="status"` where the steps go); `characterSelectModal.dom.test.svelte.ts`,
  `CharacterSelectModal.castMembers.dom.test.ts` (`beforeAll` warms the list module; new test: closed picker has no rows).
- `NOMENCLATURE.md` §25: one bullet for both new files.

Moved markup compared with HEAD ignoring whitespace and class order: identical.

## Pattern per modal
| Modal | Pattern | Why |
|---|---|---|
| Creator | stays mounted; step panes load inside its own `{#if open}` | 10 props; header/footer read most state; weight is the panes + `AvatarCropEditor` |
| Select | stays mounted; list loads inside `Dialog.Content` when `open` | gating the whole component would clear `search` between openings; Skeleton 5 `Dialog.Content` has no exit animation; no listeners or interests |
| Persona | `{#await import()}` inside its existing step gate, no pending branch | interest mounts with the step as before; opens only on a later click |
| Binding linker | `{#await import()}` with `<LoadingState />` inside its gate | opens the moment its gate opens (`+page.svelte:1603–1604`) |

## Tests
- Green, 61 tests in a 6G scope: `CharacterCreatorModal.ssr.test.ts`, `characterSelectModal.dom.test.svelte.ts`,
  `CharacterSelectModal.castMembers.dom.test.ts`, `personaSelectModal.dom.test.svelte.ts`,
  `charactersSidebar.dom.test.svelte.ts`, `sceneRunSaidOnce.dom.test.ts`.
- `npx tsc --noEmit -p .` 0 errors (needed `NODE_OPTIONS=--max-old-space-size=5600`).
- `prettier --check` clean on new files and the select modal/tests; `CharacterCreatorModal.svelte` + its SSR test warn
  only on hunks untouched by this lane (also at HEAD). svelte-check left to the lead.

## Open ★
None. ★R5-4/5/6 untouched.

## Noticed, not done
- zod stays on the first page: the creator's script imports it at module scope (`CharacterCreatorModal.svelte:7`,
  `validateFinalForm`, two non-empty-after-trim checks). The plan's "zod leaves if R5-3 and R5-5 land" needs this too.
- The picker change reaches every consumer (`StartSessionForm`, `EditSessionForm`, `CastWorkspace`,
  `ReassignSessionParticipantModal`): one spinner inside the opened dialog on the first open per page load.
- The binding linker's pending spinner renders in page flow below the fold for one chunk fetch; dropping the pending
  branch is a one-line flip.
- `SummarizeLoreModal.svelte` and its writes test in the same folder carry another session's uncommitted changes.
- `charactersSidebar.dom.test.svelte.ts` mocks the creator and does not mount the select modal.

Worker briefs: `plans/briefs/BRIEF-perf-R-w1.md`, `plans/briefs/BRIEF-perf-R-w2.md`.

## Scope review + lead fixes (2026-11-14)
Scope review: no blocking objection; three low notes, all taken by the lead: the binding linker's pending branch
dropped (the dialog appears once its chunk lands; nothing renders in page flow), the ids comment in
`CharacterCreatorSteps.svelte` reworded (per creator instance via `$props.id()`), and a reopen test added to
`characterSelectModal.dom.test.svelte.ts` ("each opening starts with nothing ticked": tick, close, reopen → "Add" with no
count). Reviewer confirmed: the dropped reset `$effect` is reproduced by the per-opening mount, `bind:` props keep the
creator's flow, no interest changed its mount timing (the persona picker's `characters:list` mounts one chunk fetch
after its step gate, as the pattern implies). 11/11 on the select test file after the fixes.

## Full-run fallout (lead, 2026-11-15)
The shared full vitest (peer serene-pub-72's run) showed four files failing because they mount the now-lazy
`CharacterSelectModal` list and clicked its rows after one `tick()`: `sessionForms/editSessionBench`,
`editSessionCastMembers`, `editSessionSaveParity`, `startSessionCast` (all `.dom.test.svelte.ts`). Fixed in the tests only:
a `beforeAll` warms `CharacterSelectList.svelte`, and the three that click rows wait one macrotask after opening the
picker. 49/49 green afterwards; no component changed.
