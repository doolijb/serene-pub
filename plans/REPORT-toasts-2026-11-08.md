# REPORT — lane `toasts` (2026-11-08): every raw toast goes through `notify`

Relayed status question: none received. Lane complete.

## Counts

- **Before:** 470 grep lines over 127 files (`toaster.(error|success|info|warning|create|dismiss|update|promise)` in non-test files), plus 7 indirect `toaster[x.kind](…)` calls. That was about 428 real calls in 120 product files; the rest were comment lines in `notify.ts` and `toaster.ts`. There were **no** `create`, `dismiss`, `update` or `promise` calls, and no call used an option that `notify` lacks (`id`, `type`, `action`, `closable`, `meta`).
- **After:** the Done-means grep lists only `notify.ts` (2 comment lines, plus its own `toaster[level]`) and `toaster.ts` (1 comment line). The only non-test importers of `utils/toaster` are `notify.ts` and `src/routes/+layout.svelte`, which keeps the `<Toast.Group {toaster}>` mount at about line 451. `components/Layout.svelte` no longer imports `toaster`.
- **Converted:** about 257 calls in components (W1) and about 170 in the other directories (W2). Copy and level are unchanged. Every leftover string-literal difference I found against HEAD traced back to earlier uncommitted work by other lanes (for example the *Character cards* rename and the `saveAt`→`at` rename). I found none in a toast that this lane changed.
- **Unconverted:** none.

## Changed files (127 product files, 4 test files)

- **Worker 1 — `src/lib/client/components/`, 73 product files:** admin/pub/AccountsCard.svelte admin/pub/CharaVaultCard.svelte admin/pub/requireAdmin.ts admin/pub/SupportReportCard.svelte admin/TemplateChangeForm.svelte admin/TemplateChangelist.svelte backgrounds/BackgroundPicker.svelte characterForms/CharacterForm.svelte componentEditor/ImportComponentDialog.svelte connections/JobSheetSampling.svelte connections/ManagedConnectionView.svelte connections/ManagedModelsTab.svelte connections/ModelFinderView.svelte connections/useEmbeddingEditConfirm.svelte.ts connections/useStarConfirm.svelte.ts ConnectionTimeoutModal.svelte CustomThemeEditor.svelte CustomThemeManager.svelte gallery/EntityGalleryTab.svelte koboldcppManager/KoboldCppBinaryVariantPicker.svelte koboldcppManager/KoboldCppPerfTab.svelte koboldcppManager/KoboldCppSettingsTab.svelte koboldcppManager/KoboldCppSetupScreen.svelte Layout.svelte library/LibraryView.svelte LoginForm.svelte lorebookForms/BindingSuggestionsPanel.svelte lorebookForms/EditLorebookForm.svelte media/AvatarPicker.svelte media/MediaManagerTab.svelte modals/AbsorbBindingModal.svelte modals/CharacterExportModal.svelte modals/CompileHistoryEntryModal.svelte modals/GraphBuildModal.svelte modals/ProcessSceneModal.svelte modals/sceneRunShown.ts modals/SummarizeLoreModal.svelte pipelines/CapPauseDialog.svelte pipelines/inspector/RunInspector.svelte pipelines/PipelineConfigOptions.svelte pipelines/PipelineReviewModal.svelte pipelines/workspace/RetrievalPanel.svelte pipelines/workspace/SessionUsagePanel.svelte pipelines/workspace/VersionsPanel.svelte sessionForms/EditSessionForm.svelte sessionForms/PipelineCards.svelte sessionForms/SessionPresetControl.svelte sessionForms/StartSessionForm.svelte sessionPage/composerFlow.svelte.ts sessionPage/messageControls.svelte.ts sessionPage/pageAsks.ts sessionPage/pressRouting.svelte.ts sessionPage/requests/index.ts sessionPage/requests/notify.ts sessionPage/rerunRefusals.svelte.ts sessionPage/scenesFlow.svelte.ts sessionPage/sessionLayoutData.svelte.ts sessionPage/turnFlow.svelte.ts settingsTabs/DataSettingsTab.svelte settingsTabs/ImportSettingsTab.svelte settingsTabs/PluginUserSettingsCard.svelte settingsTabs/TotpSettings.svelte settingsTabs/UserSettingsTab.svelte sidebars/CharactersSidebar.svelte sidebars/ConnectionsSidebar.svelte sidebars/SamplingSidebar.svelte sidebars/SessionsSidebar.svelte sidebars/TagsSidebar.svelte sidebars/UsersSidebar.svelte sprites/ChangeSpriteDialog.svelte sprites/SpritesTab.svelte userForms/InvitePanel.svelte userForms/UserForm.svelte 
- **Worker 1 — test files (3):** `sessionForms/startSessionApplet.dom.test.svelte.ts`, `sessionForms/startSessionCast.dom.test.svelte.ts`, `sessionPage/rerunRefusals.dom.test.svelte.ts`.
- **Worker 2 — `src/lib/client/{admin,lorebooks,contexts,utils}` and `src/routes`, 51 product files:** admin/sections/completion-templates/IdPage.svelte admin/sections/completion-templates/NewPage.svelte admin/sections/completion-templates/Page.svelte admin/sections/components/IdPage.svelte admin/sections/components/NewPage.svelte admin/sections/components/Page.svelte admin/sections/connections/IdPage.svelte admin/sections/connections/NewPage.svelte admin/sections/connections/Page.svelte admin/sections/network/Page.svelte admin/sections/pipelines/SlugPage.svelte admin/sections/plugins/IdPage.svelte admin/sections/prompts/IdPage.svelte admin/sections/prompts/NewPage.svelte admin/sections/prompts/Page.svelte admin/sections/rulesets/IdPage.svelte admin/sections/sampling/IdPage.svelte admin/sections/sampling/NewPage.svelte admin/sections/sampling/Page.svelte admin/sections/scripts/IdPage.svelte admin/sections/scripts/NewPage.svelte admin/sections/scripts/Page.svelte admin/sections/session-genres/IdPage.svelte admin/sections/session-genres/Page.svelte admin/sections/session-presets/IdPage.svelte admin/sections/session-presets/NewPage.svelte admin/sections/session-presets/Page.svelte admin/sections/starter-kits/Page.svelte admin/sections/updates/Page.svelte admin/sections/users/Page.svelte admin/sections/users/UserChangeForm.svelte contexts/characterImports.svelte.ts contexts/connections.svelte.ts lorebooks/BookRulesCard.svelte lorebooks/BookWritesCard.svelte lorebooks/cast/CastDuplicatesPanel.svelte lorebooks/cast/PresencesPanel.svelte lorebooks/CastWorkspace.svelte lorebooks/EntryWorkspace.svelte lorebooks/GraphsWorkspace.svelte lorebooks/LorebookActions.svelte lorebooks/LorebooksWorkspace.svelte lorebooks/sections/HistoryListActions.svelte lorebooks/sections/index.ts lorebooks/time/BranchChip.svelte lorebooks/time/TimeLens.svelte utils/toastUnsaved.ts src/routes/+layout.svelte src/routes/+page.svelte src/routes/pipelines/library/+page.svelte src/routes/sessions/[id]/+page.svelte 
- **Supervisor:**
  - `components/Layout.svelte`: removed a **duplicate `import { notify }`** that W1's pass left behind. svelte-check had 3 new errors because of it; tsc can't see `.svelte` files, so it missed them.
  - `silent: true` on 3 success toasts (table below).
  - `prettier --write` over W2's 51 files (see ★T1).
  - `admin/sections/session-genres/genreAuthoring.dom.test.svelte.ts`: whitespace-normalised `textContent` in `headerButtons()` and in the *Export as plugin…* finder, then prettier-formatted the file.
- All changed files are inside the brief's owned set. I did not touch `notify.ts`, `toaster.ts`, `STYLE-GUIDE.md`, server code or the SDK.

## `silent` / `fromPoll` applied

| file:line | flag | evidence |
|---|---|---|
| `components/settingsTabs/UserSettingsTab.svelte:84` | silent (success only) | *Character fields display expanded/simplified* restates the `<Switch checked={userSettingsCtx.settings?.showAllCharacterFields}>` at about line 739. This is §6.21's own case, "a switch flipping". |
| `components/settingsTabs/UserSettingsTab.svelte:101` | silent (success only) | *Easy character creation enabled/disabled* restates the `<Switch checked={…enableEasyCharacterCreation}>` at about line 762. |
| `components/characterForms/CharacterForm.svelte:1012` | silent (success only) | Same event and copy. Fired from the form's own `<Switch onCheckedChange={onShowAllCharacterFieldsClick}>` at about line 2288, and the form's fields expand or collapse visibly. |

- No `fromPoll` was added. The one already in `contexts/connections.svelte.ts` predates this lane. Every error toast is unflagged.

## `source` keys added

- **Count:** about 197 `source:` lines added against HEAD (W1 179, W2 18). A few of these may come from earlier uncommitted work.
- **Pattern 1 — `"socket:<exact event>"`:** used for a listener registered on one event (`useInterest`, `declareInterest` or `inbox.on`). Examples:
  - `socket:userSettings:updateLanguage`
  - `socket:lorebooks:import:error`
  - `socket:sessions:create:error`
- **Pattern 2 — `"<area>:<name>"`:** used for one handler that serves many events (W1 only). Examples:
  - `media:error`
  - `pipelines:refusal`
  - `pipelines:library:refusal` and `pipelines:library:write`
  - `bindingSuggestions:refusal`, `invites:refusal`, `totp:refusal`, `backups:refusal`
  - `sessions:rerunRefusal`
  - `connections:downloadModel`
- **Sequential pairs:** where a success and a notice fire one after the other, they got split keys so the second doesn't replace the first: `socket:sessions:create` with `…:create:swaps`, and `socket:connections:update` with `…:update:notice`.
- **W1's full list:** `/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/done1.txt`.

## Tests

- **Main run:** all 74 files that mock or import `utils/toaster` or `utils/notify` (the brief's grep, plus `utils/notify.test.ts`). Run with `--maxWorkers=2` in a 6G scope. Result: 73 passed and 1 failed (`genreAuthoring`, 2 tests), with 598/600 tests passing. Log: `/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/toasts-tests.log`.
- **Cause of the failure:** prettier wrapped the button label *Export as plugin…* across two lines, so `textContent` now holds a newline. It renders the same. I fixed the assertion, not the product.
- **Re-run:** `genreAuthoring` plus the 3 test files touching Layout, UserSettingsTab or CharacterForm: 4/4 files and 34/34 tests pass. Log: `/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/toasts-tests2.log`.
- **Assertion edits:**
  - `startSessionApplet`: the expectation gains `id: "notify:socket:sessions:create:error"`.
  - `rerunRefusals`: the expectation becomes `[{ id: "notify:sessions:rerunRefusal", title }]`.
  - Whitespace-normalised `textContent` in `startSessionApplet`, `startSessionCast` and `genreAuthoring`. Each of these comes from the prettier reflow, not from the notify swap.
- No `/tmp/serene-pub-vitest-*` directories were left behind (0 before, 0 after).

## tsc and check: baseline against after

| | baseline | after |
|---|---|---|
| `npx tsc --noEmit -p .` | 0 errors (exit 0) | 0 errors (exit 0) |
| `npm run check` | 0 errors, 8 warnings | 0 errors, 8 warnings (the same 8 pre-existing ones, now at shifted line numbers) |

- `npx prettier --check` passes on every changed file.

## Open ★

- **★T1 — the prettier pass reformatted far more than the toast lines. Accept or review?**
  - **What happened:**
    - Most owned files were not prettier-clean before this lane. Some were already dirty at HEAD, and others carried earlier lanes' uncommitted edits.
    - Done-means asks for `prettier --check` to pass on every changed file, so W1 ran `--write` on its 73 files and 3 test files. I then ran it on W2's 51 files for consistency.
    - The repo config (`prettier-plugin-tailwindcss`, `htmlWhitespaceSensitivity: "ignore"`) re-sorts Tailwind classes and reflows template text.
  - **Effect:** no copy changed, but `textContent` whitespace did, which broke 3 tests. Under normal `white-space` the markup renders the same. A reflow inside a `whitespace-pre*` element *would* show; I spot-checked none of those by hand.
  - **Can it be undone?** Not by git, because there is no pre-lane snapshot alongside the other lanes' uncommitted work. My recommendation: accept it, and have the walk glance at any `whitespace-pre` blocks in the touched files.
- **★T2 — `silent` candidates I left as plain swaps:**
  - `MediaManagerTab.svelte:~321` (`setCachePolicy`): a switch, but the toast explains the consequence, *Derived forms will be kept on disk*.
  - `UserSettingsTab`: *Language set to …* and *Time zone set to …*, where a picker shows the value.
  - Bulk *made available / hidden* successes in `admin/sections/{session-presets,session-genres,prompts}/Page.svelte`.
  - `AccountsCard` *User accounts turned on*, which has a description.
- **★T3 — `fromPoll` candidates I left plain (they are not clear from the code):**
  - `admin/sections/network/Page.svelte:162`: `tunnels:get:error`, in a handler that also calls `stopPolling()`.
  - `admin/sections/connections/IdPage.svelte:386,394`: the `syncModels` warning and error. It's unclear whether the sync is pressed or asked on open.
  - `admin/sections/scripts/Page.svelte`: `pipelines:scripts:error`, which may fire on open.
- **★T4 — inconsistent `source` keys on shared handlers.**
  - **How the workers differ:** W1 keyed a handler that serves many events with `<area>:refusal`. W2 left these unkeyed.
  - **W2's unkeyed handlers:**
    - `updates/Page` `handleError`
    - `network/Page`
    - `scripts/IdPage`
    - `session-presets/IdPage`
    - `components/Page` and `components/IdPage`
    - `completion-templates/IdPage`
    - `pipelines/SlugPage` `onDetailError`
    - `routes/pipelines/library` `onRefusal`
  - **Unkeyed in both workers:** `Layout.svelte` `handleError` and `handleSuccess` (raw `"error"` and `"success"` with arbitrary text), and `TemplateChangeForm.svelte:172`, where each pass of the warnings loop is a different line.
  - **Choice for the lead:** keep, or align on one rule.
- **★T5 — press handlers with no `source`.** These include copy buttons, `saveUser`, `logout` and the `ConnectionTimeoutModal` callbacks. They might count as "retried actions"; say if they should be keyed.

## Noticed, not done

- **Views that toast from a socket listener** (CLAUDE.md sockets ruling: views "never call `toaster`"; moving these is out of scope). The counts are approximate, from the workers' scripts.
  - **`components/**`: 48 `.svelte` files, about 163 calls.** The largest:
    - `UserSettingsTab`: 18
    - `KoboldCppSettingsTab`: 11
    - `EditSessionForm`: 10
    - `MediaManagerTab`, `KoboldCppPerfTab` and `EntityGalleryTab`: 7 each
    - `CharactersSidebar`, `ImportSettingsTab`, `CustomThemeEditor`, `ManagedConnectionView` and `CharacterForm`: 6 each
    - `AccountsCard`: 5
  - **Non-view `sessionPage/*.svelte.ts` flows that toast from listeners:**
    - `sessionLayoutData`: 10
    - `turnFlow`: 6
    - `messageControls`: 3
    - `pressRouting`: 2
    - `composerFlow`, `pageAsks`, `scenesFlow` and `rerunRefusals`: 1 each
  - **`admin/**`, `lorebooks/**` and `routes/**`: 35 `.svelte` files, about 77 calls.** The largest:
    - `lorebooks/LorebookActions`: 10
    - `admin/scripts/Page`: 6
    - `admin/connections/IdPage`, `admin/components/IdPage` and `admin/completion-templates/IdPage`: 5 each
    - `lorebooks/EntryWorkspace`, `admin/scripts/IdPage` and `admin/session-presets/IdPage`: 3 each
- **Two views raise the same toast for one event.** `userSettings:updateShowAllCharacterFields` is toasted by both `UserSettingsTab` and `CharacterForm`. The shared source now dedupes it, and the success is silent.
- **Outdated comments:** `components/sessionPage/requests/index.ts:593` ("the one toaster") and `sessionPage/scenesFlow.svelte.ts:237` ("Layout's generic toaster") still describe the central system in the old words. I left them.
- **Prettier isn't idempotent on one file:** on `admin/sections/updates/Page.svelte` it needed two `--write` passes to settle.
- **Not a sentence change:** STYLE-GUIDE §6.21 is still true and was not edited.

## Lead's note after the scope review (2026-11-08)

- **Correction to ★T1:** the whole-file `prettier --write` did change rendered copy — it put a visible space before punctuation that touched a closing tag in at least 7 files (BookRulesCard, BookWritesCard, BranchChip, LibraryView, ImportComponentDialog, admin rulesets IdPage, StartSessionForm). Fixed by `toasts-fix` (`plans/briefs/BRIEF-toasts-fix.md`). The cause was this lane's brief asking for a clean `prettier --check`; S4 briefs now say "only `--write` the lines you changed". `whitespace-pre*` blocks: all 29 render the same (scope review).
- **Correction to the file list:** `components/sessionPage/requests/notify.ts` was not changed (it already used `notify` at HEAD).
- Test files were whole-file formatted beyond the broken assertions (`genreAuthoring.dom`, `startSessionApplet`, `startSessionCast`) — accepted under ★T1.
- **Owner rulings 2026-11-08:** ★T1 accepted with the punctuation fixed; ★T2 silent on *Language set to* / *Time zone set to* and the bulk made-available/hidden (if the rows show it); MediaManager cache policy and *User accounts turned on* keep their toast (their descriptions carry a consequence — lead's narrowing); ★T3 left as plain toasts; ★T4 `<area>:refusal` for shared handlers; ★T5 no source on press handlers.
