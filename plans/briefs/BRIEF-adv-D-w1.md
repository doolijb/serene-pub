# BRIEF — adv-D-w1: character form and the entry tuning fold

Supervisor: lane adv-D (characters + lorebooks) of `plans/PLAN-advanced-controls-2026-11-10.md`. Owner gave the build go 2026-11-10 and ruled ★A–★D as the plan recommends. Lane adv-B works at the same time in `src/lib/client/components/sessionForms/` — never touch it. Lane adv-D-w2 works at the same time on `BookSettings.svelte` and the lenses — never touch those.

## Background you need (already built by lane adv-A)

- `src/lib/client/advancedControls.ts` exports `showsAdvancedControls(settings)` → `settings?.showAdvancedControls ?? false`. It is the **only** way to read the switch.
- `src/lib/client/components/AdvancedHiddenLine.svelte`: one muted line *"Some controls are hidden. Show advanced controls"*; the link emits `userSettings:updateShowAdvancedControls { enabled: true }` through `useTypedSocket()` from `$lib/client/sockets/loadSockets.client`. Optional prop `class`. It never listens and never toasts. Use it as is; do not edit it.
- The switch lives on `userSettingsCtx.settings.showAdvancedControls` (`getContext("userSettingsCtx")`, type `UserSettingsCtx` in `src/app.d.ts:398`). The shell's ctx is a `$state` proxy, so reading `ctx?.settings` inside `$derived` redraws when it flips — no reload.

Plan rule (quoted): *"With advanced controls off, the controls that tune how a session, a book entry or a session's look works are hidden … Hidden never means changed. A hidden control keeps its stored value, and the session keeps using it."* And: *"Wherever a form hides something, one line says so and turns the switch on in place."*

## Goal

With advanced controls off (`showsAdvancedControls(...)` false):

### A. `src/lib/client/components/characterForms/CharacterForm.svelte`
1. Add one `const advanced = $derived(showsAdvancedControls(userSettingsCtx?.settings))` (import the helper) and replace **every** read of `userSettingsCtx.settings?.showAllCharacterFields` with `advanced`: card metadata (~1769), scenario (~1866), greetings list vs first greeting (~1883, the `{:else}` branch stays as is), examples + instructions (~1932), `languages={…}` on `CreatorNotesFields` (~2015).
2. Remove the inline *Show all fields* switch block (~2058-2099, the `<div … title={SHOW_ALL_FIELDS_HINT}>` with its comment), the `onShowAllCharacterFieldsClick` handler (~772) and the `SHOW_ALL_FIELDS_HINT` const (~384). Keep the `Switch` import if anything else still uses it (the Default persona switch does).
3. In the removed block's place: `AdvancedHiddenLine` renders **only when `advanced` is false**, on the same tabs the switch showed on — i.e. hidden when `activeFormTab` is `"stats"`, `"likeness"` or `"speech"` (keep the same `hidden={…}` condition shape on a wrapper, and keep the `pt-2` spacing). When `advanced` is true, render nothing there. Replace the old comment with one short comment saying what the line is.
4. Tabs stay exactly as they are (Notes, Stats, everything). Card versions (`versionLine`, ~2144) stay; reword its comment's "which sits under 'show every field'" so it names advanced controls instead. Grep the file for any other comment mentioning show-all / "show every field" and reword only those comments.
5. Do not touch `CastMemberForm.svelte` or anything outside the files below.

### B. `src/lib/client/lorebooks/sections/EntryAdvancedFields.svelte`
1. Read the switch with `getContext<UserSettingsCtx | undefined>("userSettingsCtx")` and `showsAdvancedControls(ctx?.settings)` in a `$derived`.
2. When off, the **whole** `<details>` fold (summary *"Regex, case, keyword chains, priority, conditions"*, all its contents **including** `{@render extra?.()}`) is not rendered; `<AdvancedHiddenLine />` renders in its place. When on, the fold renders exactly as today and no line.
3. Update the file's top doc comment: the "⚠ One fold, in the same place, whatever is set … always drawn" paragraph must now say that it is always drawn **while advanced controls are on**, and that with them off the hidden line stands in its place (a preference; the stored values still decide how the entry reads in). Keep it short.
4. No editor that mounts the fold changes (CharacterLore, Derived, History, Item, Place, WorldLore). The supervisor has judged History's *Completed* switch (passed as `extra`) fine to hide — do not special-case it.

## Files owned (the only files you may edit or create)

- `src/lib/client/components/characterForms/CharacterForm.svelte`
- `src/lib/client/components/characterForms/cardVersions.dom.test.svelte.ts`
- new `src/lib/client/components/characterForms/characterFormAdvanced.dom.test.svelte.ts`
- `src/lib/client/lorebooks/sections/EntryAdvancedFields.svelte`
- new `src/lib/client/lorebooks/sections/entryAdvancedFields.dom.test.svelte.ts`
- an existing test that now fails **only because** it mounts the fold or the form without the switch on (e.g. `src/lib/client/lorebooks/sections/derivedEntryEditor.dom.test.svelte.ts`): the minimal fix is to add `["userSettingsCtx", { settings: { showAdvancedControls: true } }]` to its context. List every such file in your report. Anything more than that: stop and report.

## Files readable

Anything. Useful: `cardVersions.dom.test.svelte.ts` (its mount harness and socket mocks are the model for the new CharacterForm test), `src/lib/client/components/AdvancedHiddenLine.dom.test.svelte.ts`, `derivedEntryEditor.dom.test.svelte.ts`, `HistoryEditor.svelte`.

## Tests to write

- `characterFormAdvanced.dom.test.svelte.ts` (copy the harness from `cardVersions.dom.test.svelte.ts`):
  - off: on the Profile tab no *Card metadata*, the line *"Some controls are hidden."* is shown; on Voice no Scenario, no Examples/Instructions, the single *First greeting* textarea is shown; no `show-all-character-fields` switch anywhere; the line is not shown on Stats/Likeness/Speech (its wrapper is `hidden`).
  - on: the metadata, scenario, greetings list, examples, instructions show; no hidden line.
  - flip: mount with a `$state({ settings: { showAdvancedControls: false } })` ctx, then set `ctx.settings.showAdvancedControls = true`, flush, and assert the fields appear and the line goes — no remount.
  - the line's link emits `userSettings:updateShowAdvancedControls` with `{ enabled: true }`.
- `cardVersions.dom.test.svelte.ts`: rename the `showAll` render option to `advanced` and make it set `{ showAdvancedControls: … }` instead of `showAllCharacterFields`; its three `render({ showAll: true })` calls become `render({ advanced: true })`. No other change.
- `entryAdvancedFields.dom.test.svelte.ts`: mount `EntryAdvancedFields` (with an `extra` snippet if simple; otherwise mount `HistoryEditor` or a tiny fixture) — off: no `<details>`, no *Use regex*, no `extra` content, the line shows; on: the fold and its summary show, no line; flip via a `$state` ctx without remount; and a draft's stored values (`useRegex`, `priority`, `selectiveLogic`) are unchanged after mounting off.

Run (never pipe into `head`):

```
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'NODE_OPTIONS=--max-old-space-size=4096 npx vitest run src/lib/client/components/characterForms/ src/lib/client/lorebooks/sections/ src/lib/client/components/AdvancedHiddenLine.dom.test.svelte.ts; echo test-exit=$?'
```

Also grep `src/` tests for anything else that mounts `CharacterForm` or an entry editor (`grep -rln "CharacterForm\|EntryAdvancedFields\|HistoryEditor\|PlaceEditor\|ItemEditor\|WorldLoreEditor\|CharacterLoreEditor\|DerivedEntryEditor" src --include=*.test.*`) and run those too. Do **not** run `npx tsc` or `npm run check`; the supervisor runs typecheck once.

## Rules (quoted from CLAUDE.md, the STYLE-GUIDE and the lane brief)

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You need no `sdk:build`.)
- Never `git checkout`, `restore` or `clean` in either repo.
- **Prettier:** `CharacterForm.svelte` and `cardVersions.dom.test.svelte.ts` are prettier-clean today; keep them clean (`npx prettier --check <file>`; you may `--write` those two and your new files). `EntryAdvancedFields.svelte` is **not** prettier-clean today: never `prettier --write` it; format only your own hunks by hand (tabs, no semicolons, double quotes).
- "`$state(new Set())` / `new Map()` is not reactive on mutation; use `SvelteSet` / `SvelteMap`. Views never call `toaster`." No socket listeners in these components for this change.
- "It is a **session**, never a *chat*." No new user-facing copy beyond what `AdvancedHiddenLine` already says; no new names, settings, props or events. If you think one is needed, stop and report.
- Browser code: no `crypto.randomUUID`, no `navigator.clipboard`.
- Scratch files start with `adv-D-w1-`, in `/tmp/claude-1000/-home-jody-github-serene-pub/c1ff1652-0bf9-4b2c-bd9d-ed98fac4505f/scratchpad/`.

## Stop and ask (in your report) when

CLAUDE.md §Decisions applies; a hidden control turns out to be needed everyday; a new name/prop/setting seems needed; an existing test fails for a reason other than the missing switch.

## Report

Return in your final message: changed files (with a one-line summary each), tests run with pass/fail counts, prettier results per file, anything you stopped on, and **Noticed, not done**.
