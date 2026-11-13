# BRIEF — adv-B: sessions (start and edit forms)

Plan: `plans/PLAN-advanced-controls-2026-11-10.md`. Read **§ The rule this plan applies**, **§2 items 5–6 and "Kept"**, **§3 items 7–14 and "Kept"**, **§6** and **★A** (all ★ RULED as recommended, 2026-11-10). You are a lane supervisor: read `.claude/guides/multi-agent.md` first, delegate the typing to at most 2 `lane-worker` agents inside the files below, and quote into their briefs the rules they need. Lane adv-A's report (`plans/REPORT-adv-A-2026-11-10.md`) describes the helper and the line you use.

## Goal

With advanced controls off (`showsAdvancedControls(userSettingsCtx.settings)` from `src/lib/client/advancedControls.ts` returns false), these session-form controls are not rendered. With it on, everything renders exactly as today.

**`src/lib/client/components/sessionForms/StartSessionForm.svelte`** (the form already reads `userSettingsCtx` at 125-128):
- the **Rules card** (`start-rules-heading`, 3073-3262), including its inline *How strict* (3232-~3258);
- inside the **book pick** card (2684-2846): the rules rows (snippet 2451-2558, which includes the admin fit audit at 2542), *Start blank on these rules* (2785-2803), the rules-in-words list (2832-2845) and the book-pick *How strict* (2848-2897);
- **must hold:** with these hidden, the session is still created with the same rules and rigour it would get if the person never touched them. That means `rulesDefault` and the preset's or genre's rigour (`createSession.svelte.ts` ~755-764). Prove it with a test of what the start payload sends when the switch is off;
- **keep:** the lorebook choice, own books, plugin book groups, shared books, starter kits, the creation mode picker, start asks, preset, name, genre, scenario.

**`src/lib/client/components/sessionForms/EditSessionForm.svelte`**, Settings tab (2700-3331):
- hide **Actions** (2925-3042), **PipelineCards** (3047-3053), **On revision** (3141-3167), **RulesOptions** (3172-3178), **PipelineConfigOptions** (3192-3227), **RetakeAskSetting** (3317-3323) and **SessionAnnexPanel** (3324-3329);
- **Where this session's story stands:** `SessionLorebookReading` at 2873 and 2884 gets `readOnly` when off, i.e. `readOnly={isGuest || !advanced}`, using its existing branch (`SessionLorebookReading.svelte:216`);
- **keep:** the session preset switch (3090-3105), SessionSettingsForm and its Advanced fold, untouched (★A: the fold stays in both modes; never hide it), name, genre upgrade, The story, attributes, player label, tags, the Participants tab and the Privacy tab.

**The hidden line** (`AdvancedHiddenLine.svelte`, from lane A):
- **Start form:** shown once, where the hidden rules controls would have appeared. Shown only when at least one of them would have rendered with the switch on, so it uses the same conditions as today.
- **Edit form:** shown once, at the foot of the Settings tab, only when at least one hidden control would have rendered for this viewer.
- Never shown to a viewer who wouldn't have seen any of those controls anyway. A guest sees no line for owner-only controls.

**Reactivity:** flipping the switch, including from the line itself, redraws the open form without a reload. Read the setting in a `$derived`.

## Files owned

- `src/lib/client/components/sessionForms/StartSessionForm.svelte`, `EditSessionForm.svelte`
- `src/lib/client/components/sessionForms/SessionLorebookReading.svelte` (only if `readOnly` truly needs a change; it likely doesn't)
- dom tests in `src/lib/client/components/sessionForms/` (existing ones that assume the controls are visible must set the switch **on** in their settings fixture; add new off/on tests)

## Files readable

Anything. In particular: the plan, `createSession.svelte.ts`, `RulesOptions.svelte`, `PipelineCards.svelte`, `SessionPresetControl.svelte`, lane A's report, `src/lib/client/advancedControls.ts`, `AdvancedHiddenLine.svelte`.

## Out of scope (write down, never build)

- `SessionSettingsForm.svelte`, `SchemaForm.svelte` and the Advanced fold (★A).
- The session view, Header, Layout (lane C). Characters and lorebooks (lane D).
- Docs and NOMENCLATURE (lane E). Queue wording notes in your report.
- Any new setting, prop name beyond what the gating needs, or event.

## Stop and ask when

CLAUDE.md §Decisions applies; hiding a control would change what the session sends or stores; a name beyond those in the plan is needed; a ★ seems unruled.

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`. Never `git checkout`, `restore` or `clean` in either repo.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report "blocked on your dev server". (This lane needs no `sdk:build`.)
- Never pipe vitest into `head`. Run vitest in a capped scope: `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'NODE_OPTIONS=--max-old-space-size=4096 npx vitest run <files>; echo test-exit=$?'`.
- `$state(new Set())` / `new Map()` is not reactive on mutation; use `SvelteSet` / `SvelteMap`. Untrack reads in effect-called store methods.
- Scratch files start with `adv-B-`.

## Done means

- **Targeted tests pass:** every `src/lib/client/components/sessionForms/*.dom.test.*` and `*.test.ts` you touched or that renders these two forms (`startSession*.dom.test.svelte.ts`, `editSession*.dom.test.svelte.ts`).
- **New tests:** off hides each listed control and shows the line; on renders as today; off still sends the default rules and rigour on start; a guest sees no line.
- **Typecheck:** `npx tsc --noEmit -p .` clean for your files (capped scope, `NODE_OPTIONS=--max-old-space-size=8192`, `MemoryMax=12G`).
- **No full suite.**

## Report

`plans/REPORT-adv-B-2026-11-10.md`: changed files, tests and results, wording notes for lane E, open ★, **Noticed, not done**.
