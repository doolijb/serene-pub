# BRIEF — adv-D: characters and lorebooks

Plan: `plans/PLAN-advanced-controls-2026-11-10.md`. Read **§ The rule this plan applies**, **§5 items 18–21 and "Kept"**, **§6**, **★B** (all ★ RULED as recommended, 2026-11-10). You are a lane supervisor: read `.claude/guides/multi-agent.md` first, delegate the typing to at most 2 `lane-worker` agents inside the files below, and quote into their briefs the rules they need. Lane adv-A's report (`plans/REPORT-adv-A-2026-11-10.md`) describes the helper `showsAdvancedControls` (`src/lib/client/advancedControls.ts`) and `AdvancedHiddenLine.svelte`.

## Goal

With advanced controls off (`showsAdvancedControls(userSettingsCtx.settings)` is false):

18. **Character form** (`src/lib/client/components/characterForms/CharacterForm.svelte`):
    - every read of `userSettingsCtx.settings?.showAllCharacterFields` becomes `showsAdvancedControls(userSettingsCtx.settings)`: 1769 card metadata, 1866 scenario, 1883/1905 greetings, 1932 examples and instructions, 2015 `languages`;
    - the inline *Show all fields* switch (2068-2098) and its handler are removed. In its place, on the same tabs where it showed (not on stats, likeness or speech), `AdvancedHiddenLine` renders when the switch is off. When the switch is on, nothing is shown there;
    - **tabs stay as they are:** Notes and Stats are not hidden. Card versions stay (~2144);
    - `CastMemberForm.svelte` is not touched;
    - update `cardVersions.dom.test.svelte.ts` and any test that sets `showAllCharacterFields` so it sets `showAdvancedControls` instead.
19. **Book settings** (`src/lib/client/lorebooks/BookSettings.svelte`): `BookRulesCard` (:290) and `StoryCalendarEditor` (:299) are not rendered. `AdvancedHiddenLine` shows once at the foot when at least one of them would have rendered. **Keep:** `BookWritesCard` (:294, a P1 off switch), `StoryClockEditor` (:297), *What this book holds*, and *Reading into a session*.
20. **Lenses** (`src/lib/client/lorebooks/lenses/registry.ts:39-130`, `LensTrack.svelte`, `LorebooksWorkspace.svelte` :2724/:2756):
    - **Graph** and **Lives** are left out of the lens track (both desk and compact) and out of their Alt+Shift shortcuts;
    - a route naming a hidden lens opens **List** (with no redirect loop, and no toast);
    - List, Cards, Tree, Map and Time stay;
    - prefer one pure function, e.g. `lensesShown(advanced)`, in the registry with a unit test over scattering conditions;
    - no hidden line here (plan item 23).
21. **The entry tuning fold** (`src/lib/client/lorebooks/sections/EntryAdvancedFields.svelte:78`, summary "Regex, case, keyword chains, priority, conditions"): the whole fold, including its `extra` slot content, is not rendered. `AdvancedHiddenLine` renders in its place. This one gate covers every editor that mounts the fold: CharacterLore, Derived, History, Item, Place and WorldLore. Check that HistoryEditor's extra *Completed* switch (passed as `extra`, HistoryEditor:158) is fine to hide. If it's an everyday control, stop and report instead of hiding it.

Hidden never means changed: no stored value is touched, and entries keep reading in by their stored regex, priority and conditions.

**Reactivity:** flipping the switch redraws open forms and the lens track without a reload.

## Files owned

- `src/lib/client/components/characterForms/CharacterForm.svelte` + `cardVersions.dom.test.svelte.ts` and any characterForms test that references `showAllCharacterFields`
- `src/lib/client/lorebooks/BookSettings.svelte`
- `src/lib/client/lorebooks/lenses/registry.ts` (+ test), `src/lib/client/lorebooks/LensTrack.svelte`, `src/lib/client/lorebooks/LorebooksWorkspace.svelte` (lens filtering and fallback only)
- `src/lib/client/lorebooks/sections/EntryAdvancedFields.svelte`
- new dom/unit tests for the above

## Files readable

Anything. In particular: the plan, `formTabs.ts`, `CastMemberForm.svelte`, `loreRoute.svelte.ts`, `shared/lorebooks/loreRoute.ts`, the lens mounts, lane A's report.

## Out of scope (write down, never build)

- `CharactersSidebar.svelte` and *Easy character creation*, which stays its own setting.
- Character tabs; `CastMemberForm`; the lore rail's rules group; Loose ends; the moment bar; retrieval marks.
- Session forms (lane B); session view (lane C); docs and NOMENCLATURE (lane E). Queue wording notes in your report.
- Dropping `showAllCharacterFields` from the server or wire (it stays, unread).

## Stop and ask when

CLAUDE.md §Decisions applies; a hidden control turns out to be an everyday one (like History's *Completed*); a route fallback needs a new route param or name; a name beyond those in the plan is needed.

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`. Never `git checkout`, `restore` or `clean` in either repo.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report "blocked on your dev server". (This lane needs no `sdk:build`.)
- Never pipe vitest into `head`. Run vitest in a capped scope: `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'NODE_OPTIONS=--max-old-space-size=4096 npx vitest run <files>; echo test-exit=$?'`.
- `$state(new Set())` / `new Map()` is not reactive on mutation; use `SvelteSet` / `SvelteMap`. Views never call `toaster`.
- Scratch files start with `adv-D-`.

## Done means

- **Targeted tests pass:** the characterForms tests touched; a new CharacterForm off/on test (the show-all fields and the line); the BookSettings off/on test; the lens registry unit test plus a fallback test; the EntryAdvancedFields off/on test; existing lorebook workspace tests that touch lenses (`lorebooksWorkspace*.dom.test.ts`, `loreRail.dom.test.ts`) still green.
- **Typecheck:** `npx tsc --noEmit -p .` clean for your files (capped, `NODE_OPTIONS=--max-old-space-size=8192`, `MemoryMax=12G`).
- **No full suite.**

## Report

`plans/REPORT-adv-D-2026-11-10.md`: changed files, tests and results, wording notes for lane E, open ★, **Noticed, not done**.
