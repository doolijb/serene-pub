# BRIEF — adv-B-w1: start form gates (StartSessionForm)

Supervisor: lane adv-B. Plan: `plans/PLAN-advanced-controls-2026-11-10.md` §2 (items 5–6, "Kept") and §6. All ★ there are RULED (owner, 2026-11-10).

## The rule (quoted from the plan)

> With advanced controls off, the controls that tune *how* a session ... works are hidden ... It never hides: content a person made or reads; anything a genre needs to play; the off switch of an automatic action (P1); the session preset switch; accessibility; repair prompts; anything that explains a refusal.
>
> Wherever a form hides something, one line says so and turns the switch on in place (★C). Advanced controls is a **preference, never a permission**.
>
> **Hidden never means changed.** A hidden control keeps its stored value, and the session keeps using it.

## Goal

In `src/lib/client/components/sessionForms/StartSessionForm.svelte`, with advanced controls **off** the rules controls below are not rendered; with it **on** everything renders exactly as today. One `AdvancedHiddenLine` replaces them.

1. Read the switch once, reactively, from the context the form already holds (`settingsCtx`, lines 124-128):
   `const advanced = $derived(showsAdvancedControls(settingsCtx?.settings))` — import `showsAdvancedControls` from `$lib/client/advancedControls` and `AdvancedHiddenLine` from `$lib/client/components/AdvancedHiddenLine.svelte`. No other new names beyond small derived values for the line's condition.
2. **Rules-card path** (`{#if flow.mode !== "branch" && showRules && rulesOffer && !bookPickShown}`, ~3073): inside that same `#if`, render the `<section aria-labelledby="start-rules-heading">` card only when `advanced`; `{:else}` render `<AdvancedHiddenLine class="px-1" />`. The whole card goes, including its notes and its inline How strict.
3. **Book-pick path** (`{#if bookPickShown && rulesOffer}`, ~2449). Hide, when `!advanced`:
   - every render of the `rulesRows` snippet, with its wrapper:
     - in `bookPickRow`: the `data-book-rules-under` div ("Play it with") → `{#if advanced && selected && fit.rulesId === null}`;
     - in `kitUnder`: pass `under={advanced ? kitUnder : undefined}` to the book-pick `StarterKitPicker` (~2814);
     - the **Start blank** block (`start-book-blank-heading`, its sentence and its `rulesRows`, ~2785-2803) → `{#if advanced && flow.mode !== "new-world"}`;
   - the rules-in-words list (`data-rules-in-words`, ~2832-2845);
   - the separate **How strict** card after the pick (`{#if presetRigourUnplayed || howStrictShown}`, ~2848-2897) → `{#if advanced && (…)}`.
   - The admin *Why?* fit audit lives inside `rulesRows`, so it goes with them.
   - Then, right after where the How strict card sits (still inside the book-pick `#if`), render `<AdvancedHiddenLine class="px-1" />` when `!advanced && bookPickHides`, where `bookPickHides` is true iff at least one of the hidden pieces would have rendered with the switch on, using **the same conditions as today**:
     - `flow.mode !== "new-world"` (Start blank), or
     - the chosen book is a `bookPickRow` row (own books or a plugin book group row) and `bookRulesFit(offer, book.primaryRuleset, flow.genre?.name).rulesId === null`, or
     - a starter kit is chosen and `bookRulesFit(offer, chosenKit.rulesId, flow.genre?.name).rulesId === null`, and the kit picker is shown (`kits?.length`), or
     - the in-words condition, or `presetRigourUnplayed || howStrictShown`.
     Read the code to confirm each condition before writing it; keep it as one `$derived` near `howStrictShown`.
4. **Keep, untouched:** the lorebook choice, own books, plugin book groups, shared/surfaced books, starter kits (the picker and its rules line), the book row's rules line and refusal text, `playsBestWith`, the `start-rules-fixed` note in the book-pick card, the creation mode picker, start asks, preset, name, genre, scenario.
5. **Must hold:** the payload does not change. `createSession.svelte.ts` derives `rulesNowId` (person's pick, else `rulesDefault`) and `rigour` (pick, else preset's, else genre's) whether or not the controls render. Do not touch `createSession.svelte.ts`.
6. The line shows **once**: the two paths are exclusive (`bookPickShown` vs `!bookPickShown`). A genre with no rules offer (Chat) shows no line.

## Tests

- **Existing start dom tests** (`startSessionRules`, `startSessionBookSources`, `startSessionApplet`, `startSessionCast`, `startSessionModes`, `startSessionAsks` `.dom.test.svelte.ts`): any that assume the rules controls are visible mount the form with the switch **on**: `context: new Map([["userSettingsCtx", { settings: { showAdvancedControls: true } }]])` (merge with any existing context entries). Change nothing else in their assertions. Run all six.
- **New file** `src/lib/client/components/sessionForms/startSessionAdvanced.dom.test.svelte.ts`, copying the mock/feed harness of `startSessionRules.dom.test.svelte.ts`. The settings context is a reactive `$state` object (the file is `.svelte.ts`) so a test can flip it. Cases:
  1. book-pick path, off: no `[data-rules-choice]`, `[data-book-rules-choice]`, `#start-book-blank-heading`, `[data-rules-in-words]`, `[data-how-strict]`, `[data-rules-audit]` (with an admin `userCtx`); book rows still render; exactly one hidden line (text "Some controls are hidden.").
  2. book-pick path, on: those render as today; no hidden line.
  3. Rules-card path (a shape without `lorebook`), off: no `#start-rules-heading`; exactly one line. On: the card renders; no line.
  4. A genre with no `rules` offer, off: no line.
  5. **Payload, off:** pressing Start without touching anything sends the same `primaryRuleset` and `rigour` in `sessions:create` as the same fixture with the switch on — with a preset carrying `settings: { ruleset: …, rigour: … }`, and with none (genre default). Assert the concrete values too.
  6. **Reactivity:** mounted off, set `settings.showAdvancedControls = true` on the context object, settle: the controls appear and the line goes, no remount.

## Files owned

- `src/lib/client/components/sessionForms/StartSessionForm.svelte`
- `src/lib/client/components/sessionForms/start*.dom.test.svelte.ts` (existing six, fixture only) and the new `startSessionAdvanced.dom.test.svelte.ts`

## Files readable

Anything: `createSession.svelte.ts`, `src/lib/client/advancedControls.ts`, `src/lib/client/components/AdvancedHiddenLine.svelte`, `../lorebookForms/StarterKitPicker.svelte`, the plan.

## Out of scope (never build)

- `createSession.svelte.ts`, `EditSessionForm.svelte` (another worker), any other file.
- Copy changes (headings such as "Lorebook and rules" stay as they are; write wording observations in your report).
- New settings, props, events or names beyond `advanced` and the line's derived condition.

## Stop and ask when

Hiding a control would change what the start payload sends; a condition can't be matched exactly; a name beyond the above is needed. Put the question in your report and stop that part.

## Rules you must follow

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report "blocked on your dev server". (You need no `sdk:build`.)
- Never `git checkout`, `restore` or `clean` in either repo.
- Never pipe vitest into `head`. Run vitest in a capped scope: `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run <files>; echo test-exit=$?'`.
- `$state(new Set())` / `new Map()` is not reactive on mutation; use `SvelteSet` / `SvelteMap`.
- It is a **session**, never a *chat*.
- Scratch files start with `adv-B-w1-`.
- Run `npx prettier --check` on the files you changed (fix with `--write` on your own files only).

## Done means

- The six existing start dom tests and the new file pass.
- `npx prettier --check` clean on your files.

## Report

Reply with: changed files; each condition you used for `bookPickHides` with its source line; tests run and results; wording notes; questions; Noticed, not done.
