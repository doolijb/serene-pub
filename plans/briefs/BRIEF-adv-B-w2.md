# BRIEF — adv-B-w2: edit form gates (EditSessionForm, Settings tab)

Supervisor: lane adv-B. Plan: `plans/PLAN-advanced-controls-2026-11-10.md` §3 (items 7–14, "Kept") and §6. All ★ there are RULED (owner, 2026-11-10); ★A: the Advanced fold inside `SessionSettingsForm` stays in both modes, never hide it.

## The rule (quoted from the plan)

> With advanced controls off, the controls that tune *how* a session ... works are hidden ... It never hides: content a person made or reads; anything a genre needs to play; the off switch of an automatic action (P1); the session preset switch; accessibility; repair prompts; anything that explains a refusal.
>
> Wherever a form hides something, one line says so and turns the switch on in place (★C). Advanced controls is a **preference, never a permission**. It never shows a member anything their role hides.
>
> **Hidden never means changed.** A hidden control keeps its stored value, and the session keeps using it.

## Goal

In `src/lib/client/components/sessionForms/EditSessionForm.svelte`, Settings tab (~2700-3331): with advanced controls **off** these are not rendered; with it **on** everything renders exactly as today.

1. Read the switch once, reactively, from the context the form already holds (`userSettingsCtx`, ~581): `const advanced = $derived(showsAdvancedControls(userSettingsCtx?.settings))`. Import `showsAdvancedControls` from `$lib/client/advancedControls` and `AdvancedHiddenLine` from `$lib/client/components/AdvancedHiddenLine.svelte`.
2. Add `advanced &&` to the existing `{#if}` of each (keep the existing conditions as they are):
   - **Actions** card (`{#if session && !isGuest && sessionFunctions.length > 0}`, ~2925-3042);
   - **PipelineCards** (`{#if session}`, ~3047-3053);
   - **On revision** (~3141-3167);
   - **RulesOptions** (~3172-3178);
   - the **Pipelines** section with its `PipelineConfigOptions` (`{#if session?.id && sessionPipelines.length}`, ~3192-3227);
   - **RetakeAskSetting** (~3317-3323);
   - **SessionAnnexPanel** (~3324-3329).
3. **Where this session's story stands:** both `SessionLorebookReading` (~2873 and ~2884) get `readOnly={isGuest || !advanced}`. Do not edit `SessionLorebookReading.svelte`.
4. **The hidden line:** at the foot of the Settings tab, after the annex's place and inside the same `flex flex-col gap-3` column, render `<AdvancedHiddenLine class="px-1" />` once when `!advanced && settingsHides`, where `settingsHides` is one `$derived` that is true iff at least one hidden control would have rendered **for this viewer** with the switch on, from the same outer conditions:
   - an owner (`session?.id && !isGuest`): On revision always renders, so the line shows;
   - a guest: only if the Pipelines section would render (`session?.id && sessionPipelines.length > 0`) or the annex would (`userCtx.user?.isAdmin`), or the reading would have been editable — it would not, a guest's is already read-only.
   - A guest never sees a line for owner-only controls. `PipelineCards`' own cards are fetched inside it, so the form can't know them; do not add a prop or callback to learn it — note the gap in your report.
   - Also count the reading: an owner with a `SessionLorebookReading` on screen loses its editing, which is covered by the owner branch already.
5. **Keep, untouched:** the session preset switch (`SessionPresetControl`, ~3090-3105), `SessionSettingsForm` and its Advanced fold, name, genre upgrade, The story card, scenes, attributes, player label, tags, the Participants tab and the Privacy tab, the tab's intro paragraph (copy stays; note wording in your report).
6. Never change what Save sends: the hidden On revision `select` binds `onRevision`; with it unmounted the value stays as loaded. Confirm the save path sends the same `onRevision` (and branch/clock) as before when the switch is off — read the save code and say so in your report.

## Tests

- **Existing edit dom tests** (`editSessionCastMembers`, `editSessionGenreFields`, `editSessionGuestOwnNotesReading`, `editSessionHowStrict`, `editSessionLorebookLine`, `editSessionOwnNotesReading`, `editSessionPlayerSeats`, `editSessionSaveParity` `.dom.test.svelte.ts`): any that assume the hidden controls or an editable reading are visible add the switch **on** to their mount context: `["userSettingsCtx", { settings: { showAdvancedControls: true } }]` beside the existing `userCtx` entry. Change nothing else in their assertions. Run all eight.
- **New file** `src/lib/client/components/sessionForms/editSessionAdvanced.dom.test.svelte.ts`, copying the harness of the closest existing edit test. The settings context is a reactive `$state` object (the file is `.svelte.ts`) so a test can flip it. Cases:
  1. owner, off: no Actions heading, no `#session-on-revision`, no `#session-pipelines`, no "How replies are made", no rules options / retake / annex markers (feed the socket replies the children need so that each one *would* render with the switch on, and prove it in case 2); the reading is read-only (`[data-testid="session-story-clock-readonly"]`); the preset switch and the session settings form still render; exactly one line ("Some controls are hidden.") inside `#session-panel-settings`.
  2. owner, on: each of those renders as today; the reading is editable; no line.
  3. guest (session `userId` ≠ viewer), off, not admin, no session pipelines: no line.
  4. guest, off, with session pipelines: one line. (If the harness can't feed pipelines cleanly, say so and skip with a reason.)
  5. **Reactivity:** mounted off, set `settings.showAdvancedControls = true` on the context object, settle: the controls appear and the line goes, no remount.
  6. **Save parity, off:** saving after editing a kept field (e.g. the name) sends the same `onRevision` and reading values as with the switch on.

## Files owned

- `src/lib/client/components/sessionForms/EditSessionForm.svelte`
- `src/lib/client/components/sessionForms/editSession*.dom.test.svelte.ts` (existing eight, fixture only) and the new `editSessionAdvanced.dom.test.svelte.ts`

## Files readable

Anything: `SessionLorebookReading.svelte`, `PipelineCards.svelte`, `RulesOptions.svelte`, `RetakeAskSetting.svelte`, `SessionAnnexPanel.svelte`, `SessionPresetControl.svelte`, `src/lib/client/advancedControls.ts`, `src/lib/client/components/AdvancedHiddenLine.svelte`, the plan.

## Out of scope (never build)

- `StartSessionForm.svelte` (another worker), `SessionLorebookReading.svelte`, `SessionSettingsForm.svelte`, `SchemaForm.svelte`, any child component, any other file.
- Copy changes; new settings, props, events or names beyond `advanced` and `settingsHides`.

## Stop and ask when

Hiding a control would change what Save sends or stores; a name beyond the above is needed; a condition can't be matched. Put the question in your report and stop that part.

## Rules you must follow

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report "blocked on your dev server". (You need no `sdk:build`.)
- Never `git checkout`, `restore` or `clean` in either repo.
- Never pipe vitest into `head`. Run vitest in a capped scope: `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run <files>; echo test-exit=$?'`.
- `$state(new Set())` / `new Map()` is not reactive on mutation; use `SvelteSet` / `SvelteMap`.
- `socket.off(event)` with no handler removes every listener app-wide; always pass the handler.
- It is a **session**, never a *chat*.
- Scratch files start with `adv-B-w2-`.
- Run `npx prettier --check` on the files you changed (fix with `--write` on your own files only).

## Done means

- The eight existing edit dom tests and the new file pass.
- `npx prettier --check` clean on your files.

## Report

Reply with: changed files; the `settingsHides` condition with its source lines; the save-path confirmation; tests run and results; wording notes; questions; Noticed, not done.
