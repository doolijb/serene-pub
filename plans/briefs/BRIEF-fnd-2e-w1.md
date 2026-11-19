# BRIEF — worker `fnd-2e-w1` — EditSessionForm split, steps 1–3 (visibility, actions, tags)

Repo `/home/jody/github/serene-pub`. Supervisor: lane `fnd-2e`. You do three sequential moves out of
`src/lib/client/components/sessionForms/EditSessionForm.svelte` into new child components beside it. Each step
ends green (checks below) before the next starts. Stop at the first step you cannot make green and report.

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

The `$bindable` precedent to follow: `SessionLorebookReading.svelte` lines ~63–64 (`branchId = $bindable(),
clock = $bindable()`), bound by this very form as `bind:branchId={lorebookBranchId}`.

CLAUDE.md hard rules that apply: `$state(new Set())` / `new Map()` is not reactive on mutation (use `SvelteSet` /
`SvelteMap`) — you should not need either; no `socket.on` / `useInterest` / `socket.emit` in a child (listeners and
emits stay in the parent); views never call `toaster`.

## Files owned

- `src/lib/client/components/sessionForms/EditSessionForm.svelte` (edit only the moved blocks, the new imports and
  the child tags)
- new: `src/lib/client/components/sessionForms/SessionVisibilityPanel.svelte`,
  `src/lib/client/components/sessionForms/SessionActions.svelte`,
  `src/lib/client/components/sessionForms/SessionTags.svelte`

## Files readable

Anything. Style precedent for a child: `sessionForms/BenchedSeatRow.svelte` (doc comment at the top of the script
saying what the part draws and that the form owns every decision; `interface Props` with a doc line per
non-obvious prop; `let { … }: Props = $props()`; `import * as Icons from "@lucide/svelte"`). Tabs, no semicolons,
double quotes, ~80 columns. `StartSessionForm.svelte` defines its own `const CARD_CLASS = "panel-card"`: a child
that needs `CARD_CLASS` / `FIELD_CLASS` defines the same local const with the same value (do not remove them
from the parent while the parent still uses them).

## Steps (re-derive every line range from the file as it is; another lane may have edited elsewhere)

1. **`SessionVisibilityPanel.svelte`** — the inner `<div class="flex flex-col gap-3 pt-3">` of
   `<div id="session-panel-visibility" …>` (≈ lines 3881–4026). The tabpanel `<div>` itself stays in the parent.
   Prop: `accountVisibility` (type `Sockets.Sessions.AccountVisibility.Response | undefined`, as declared in the
   parent ≈ line 370). Needs `Badge` and `Icons` imports.
2. **`SessionActions.svelte`** — the Actions card (≈ 3457–3581). Keep the `{#if advanced && session && !isGuest &&
   sessionFunctions.length > 0}` guard **in the parent** around the child tag; the child draws the `<section>`.
   Keep the block's HTML comment with the moved markup (or above the child tag in the parent — your choice; say
   which). Props: `presetActions`, `outsideActions`, `functionsBusy`, `canAddOutsidePreset`, and callback
   `onToggle` (or the parent's `toggleSessionFunction` passed as a prop under its own name — prefer passing
   it as `toggleSessionFunction` so the moved expressions are unchanged). Types from the parent's declarations.
3. **`SessionTags.svelte`** — the Tags `<section class="{CARD_CLASS} mb-10">` (≈ 3768–3850). `tagSearchInput` and
   `showTagSuggestions` are parent state (read by the parent's `filteredTags` and written by `addTag`): make them
   `$bindable` props bound from the parent (`bind:tagSearchInput`, `bind:showTagSuggestions`) per the precedent.
   Other props: `filteredTags`, `selectedTags`, `tagsList`, `isGuest`, `addTag`, `removeTag`.

Leave `sessions:setCastSeatEnabled` lines in the parent (a test reads the parent source for that string).

## Checks after EACH step (all three must pass before the next step)

a. HTML comparison: `bash plans/fnd-2e-snap.sh step<N>` (it waits for other lanes' vitest itself). It must print
   `Test Files  12 passed (12)` and `HTML IDENTICAL to base2`. If it differs, read the `.diff` it names, fix the
   move until identical. A diff you cannot remove: stop and report it with the diff excerpt.
b. Unit tests that read the source:
   `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done; systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/client/components/sessionForms/noCharacterVisibility.test.ts src/lib/client/components/sessionForms/applyPresetDefaults.test.ts > plans/fnd-2e-w1-<N>.log 2>&1"` — all green.
c. Types: `NODE_OPTIONS=--max-old-space-size=10240 npm run check > plans/fnd-2e-w1-check-<N>.log 2>&1`, then
   grep the log for `sessionForms/EditSessionForm.svelte`, `SessionVisibilityPanel`, `SessionActions`,
   `SessionTags`: **0 errors and no new warnings** in those files (compare warnings for EditSessionForm with the
   count before your first edit — run check once before step 1 and save that log as `plans/fnd-2e-w1-check-0.log`).
   Errors in other files belong to other lanes: name them, don't fix them.
d. `npx prettier --check` on the new file(s); report the result (the parent already fails prettier before you
   start; don't reformat it).

## Stop and ask (report, don't decide) when

A move needs the parent's state reshaped, a new store, or a context; a listener or emit would have to move; the
HTML differs and you cannot make it identical; anything outside the files owned.

## Report (your final message, ≤ 300 words)

Per step: new file and line count, parent line count after, props / callbacks / bindables, the snap result line,
the unit test result, the check result for the lane's files; local state held in a child (expect none); anything
noticed but not done.
