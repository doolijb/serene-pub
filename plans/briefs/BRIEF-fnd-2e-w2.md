# BRIEF — worker `fnd-2e-w2` — EditSessionForm split, steps 4–6 (benched, characters + personas, `.ts`)

Repo `/home/jody/github/serene-pub`. Supervisor: lane `fnd-2e`. Worker `fnd-2e-w1` already moved steps 1–3
(`SessionVisibilityPanel.svelte`, `SessionActions.svelte`, `SessionTags.svelte` — read them: they are the style to
follow). You do three more sequential moves out of `src/lib/client/components/sessionForms/EditSessionForm.svelte`.
Each step ends green (checks below) before the next starts. Stop at the first step you cannot make green and
report; a partial split is acceptable.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

(This lane never runs `sdk:build`, `npm test`, `npm run build`, `git checkout`/`restore`, or `prettier --write`. Do not pipe prettier's output into a file either.)

## Goal — the rule (quoted from the lane brief)

> **No behaviour change and no visible change**: the rendered markup (elements, classes, attributes, order, text,
> ids, `data-*`, aria) is the same before and after, for every state of the form.
> - **State, effects and socket listeners stay in the parent** (`EditSessionForm.svelte`). A child receives values
>   as props and reports through callback props; a child holds only purely local UI state it already owned (an
>   open / closed fold, a text draft that never leaves it).
> - A two-way binding the parent had (`bind:value` on its own state) becomes a value prop plus a callback, or a
>   `$bindable` prop where that is the existing pattern in this codebase.
> - Moved markup is copied verbatim (indentation aside); expressions change only where a name becomes a prop.

`$bindable` precedent: `SessionLorebookReading.svelte` ~63–64 (`branchId = $bindable()`), bound by the form as
`bind:branchId={lorebookBranchId}`; and w1's `SessionTags.svelte`.

CLAUDE.md hard rules that apply: `$state(new Set())` / `new Map()` is not reactive on mutation (use `SvelteSet` /
`SvelteMap`); no `socket.on` / `useInterest` / `socket.emit` in a child; views never call `toaster`.
`noCharacterVisibility.test.ts` reads the parent's source for the string `sessions:setCastSeatEnabled`: those
lines stay in the parent.

How to pass things (decided by the supervisor; follow it):
- A parent **function** a moved expression calls (`moveSeat`, `handleSeatDrag`, `savedCharacterSeat`,
  `confirmRemovePersona`, `fallenNote`, `castMemberHref`, `seatPlayerWords`, `openReassignModal`, …) is passed as a
  prop **under its own name**, so the moved expression is unchanged (w1 did this with `toggleSessionFunction`).
- A parent **value** is passed under its own name (`{session}`, `{dragging}`, `{isGuest}`, `{userCtx}` — pass the
  `userCtx` object itself so `userCtx.user?.id` stays verbatim).
- A moved expression that **assigns parent state** (not a `bind:`) becomes a callback prop, the one place an
  expression changes:
  - step 4: `onSelect: () => (benchedPlayerSeats = benchedPlayerSeats.filter(...))` → a callback prop
    `onRemoveBenchedPlayerSeat(id: number)`; the parent passes
    `onRemoveBenchedPlayerSeat={(id) => (benchedPlayerSeats = benchedPlayerSeats.filter((p) => p.id !== id))}`.
  - step 5: `onclick={() => (showCharacterModal = true)}` → callback prop `onAddCharacter`; likewise
    `onAddPersona` for `showPersonaModal`.
- `bind:value={seat.name}` (step 5, `playerSeats` rows) mutates parent state: make `playerSeats` a `$bindable`
  prop bound with `bind:playerSeats`, so Svelte's ownership check stays quiet; the `bind:value={seat.name}` line
  itself is unchanged.
- Guards stay in the parent around the child tag (`{#if hasSavedSeat}`, `{#if showCharactersSection}`,
  `{#if showPersonasSection}`); the child draws the `<section>`. HTML comments above a moved block stay in the
  parent above the guard.
- Shared **types** a child needs (`SeatCard`, `PlayerSeatDraft`, `SeatKind`, and any other the props need) move
  out of the parent into the new `editSessionForm.ts` beside the form (created in step 4, filled further in step
  6), exported, imported by parent and children. Moving a type changes no runtime. Do not re-declare a type in
  a child.

## Files owned

- `src/lib/client/components/sessionForms/EditSessionForm.svelte`
- `src/lib/client/components/sessionForms/SessionVisibilityPanel.svelte`, `SessionActions.svelte`,
  `SessionTags.svelte` (only to swap a local `CARD_CLASS` / `FIELD_CLASS` for the import in step 6)
- new: `sessionForms/SessionBenchedSeats.svelte` (step 4), `sessionForms/SessionCharacters.svelte`,
  `sessionForms/SessionPersonas.svelte`, `sessionForms/SeatBenchButton.svelte`,
  `sessionForms/SeatBringBackNote.svelte` (step 5), `sessionForms/editSessionForm.ts` (steps 4 and 6)

Nothing else. Not `BenchedSeatRow.svelte`, not `benchedSeats.ts`, not `SessionsSidebar.svelte`, not
`PipelineConfigOptions` (another lane's).

## Steps (re-derive every line range from the file as it is)

4. **`SessionBenchedSeats.svelte`** — the Benched card: the `<section>` inside `{#if hasSavedSeat}` (now ≈ lines
   2556–2835; it starts `<h3 class="mb-1 text-sm font-medium">Benched</h3>`). Both `use:dndzone` lists move with
   it (import `dndzone` in the child; `TRIGGERS` stays with `handleSeatDrag` in the parent). Expected props:
   `showCharactersSection`, `showPersonasSection`, `benchedCharacters`, `benchedMembers`, `benchedPersonas`,
   `benchedPlayerSeats`, `dragging`, `session`, `isGuest`, `userCtx`, and the functions it calls by name, plus
   `onRemoveBenchedPlayerSeat`. Keep `{#key session?.sessionCharacters}` verbatim inside the child.
5. **Characters and personas, with the two snippets.**
   - `SeatBenchButton.svelte` — the body of the `{#snippet benchButton(kind, id, label)}` (≈ 2362–2377), props
     `kind`, `id`, `label`, `moveSeat`. Every `{@render benchButton(a, b, c)}` becomes
     `<SeatBenchButton kind={a} id={b} label={c} {moveSeat} />`.
   - `SeatBringBackNote.svelte` — the body of `{#snippet bringBackNote(saved, label)}`, props `saved`, `label`,
     `castMemberHref`. Its `{@const href = castMemberHref(saved)}` becomes `const href = $derived(castMemberHref(saved))`
     in the child's script (a component has no top-level `{@const}`); the `<p>` is verbatim.
   - `SessionCharacters.svelte` — the Characters `<section>` inside `{#if showCharactersSection}` (≈ 2405–2606):
     the seated characters' dndzone list and the cast members list and the **Add a character** button.
   - `SessionPersonas.svelte` — the Personas `<section>` inside `{#if showPersonasSection}` (≈ 2693–2877): the
     personas' dndzone list, the card-less player seats, **Add a persona**.
   - The Envoys card between them stays in the parent. The two `{#snippet}` definitions are deleted from the
     parent once nothing renders them.
6. **`editSessionForm.ts`** — move into it, exported, and import back: `sessionSchema` (with its `z` import),
   `type ValidationErrors`, `STANDARD_GENRE_ID`, `FIELD_CLASS`, `CARD_CLASS` (keep their doc comments), the types
   still declared in the parent that nothing reactive needs (`GuestRow`, `BenchChange`, …), and the **pure**
   helpers: a function that reads no component state, prop, context, `socket`, or other component-scope
   variable — at least `seatedThenBenchedIds`, `characterPositionsOf`, `cardLabel`. Scan the script for any other
   such function and move it too; list each one. Do not change a function's body. The children from steps 1–5
   import `CARD_CLASS` / `FIELD_CLASS` from it in place of their local consts.

## Checks after EACH step (all must pass before the next step)

a. HTML comparison: `bash plans/fnd-2e-snap.sh step<N>` (it waits for other lanes' vitest itself). It must print
   `Test Files  12 passed (12)`, `Tests  81 passed (81)` and `HTML IDENTICAL to base2`. If it differs, read the
   `.diff` it names and fix the move until identical. A diff you cannot remove: stop and report it with the diff
   excerpt.
b. Unit tests that read the source:
   `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done; systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/client/components/sessionForms/noCharacterVisibility.test.ts src/lib/client/components/sessionForms/applyPresetDefaults.test.ts > plans/fnd-2e-w2-<N>.log 2>&1"` — all green.
c. Types: `NODE_OPTIONS=--max-old-space-size=10240 npm run check > plans/fnd-2e-w2-check-<N>.log 2>&1`; grep the
   log for `sessionForms/` and every lane file name: **0 errors and 0 warnings** in the lane's files (w1 measured
   0 / 0 before it started). Errors in other files belong to other lanes: name them, don't fix them. Pay
   attention to `ownership_invalid_mutation` / `binding_property_non_reactive` style warnings: there must be none.
d. `npx prettier --check` on the new files; report the result (don't reformat; the parent already fails it).

## Stop and ask (report, don't decide) when

A move needs the parent's state reshaped, a new store, or a context; a listener or emit would have to move; the
HTML differs and you cannot make it identical; a needed change falls outside the files owned.

## Report (your final message, ≤ 350 words)

Per step: new files and line counts, parent line count after, props / callbacks / bindables, the snap result
line, the unit test result, the check result for the lane's files; the list of helpers and types moved in step 6;
local state held in a child (expect none); anything noticed but not done.
