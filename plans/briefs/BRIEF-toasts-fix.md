# BRIEF — `toasts-fix` (one lane-worker, spawned by the lead) — 2026-11-08

Follow-up to lane `toasts` (`plans/REPORT-toasts-2026-11-08.md`) after its scope review. Three jobs, all in Svelte client files. Read `src/lib/client/utils/notify.ts` (whole, ~90 lines) first.

## 1. Undo prettier's visible spaces before punctuation (the main job)

The `toasts` lane ran `prettier --write` on whole files. With this repo's `htmlWhitespaceSensitivity: "ignore"`, prettier moved punctuation that touched a closing tag onto its own line, and Svelte renders that line break as a **visible space**: "Change to **X** ?" instead of "Change to **X**?". Known cases (the floor, not the full list):

- `src/lib/client/lorebooks/BookRulesCard.svelte:132-133` ("**X** ?")
- `src/lib/client/lorebooks/BookWritesCard.svelte:145-150` ("**label** ," and "**mode** .")
- `src/lib/client/lorebooks/time/BranchChip.svelte:395-400` ("**moment** ,", "**with no fork date** ,")
- `src/lib/client/components/library/LibraryView.svelte:715-724` ("tag:name , -exclude , … "exact phrase" , e.g. … .")
- `src/lib/client/components/componentEditor/ImportComponentDialog.svelte:212-216` ("( .component.json )", ".svelte , .ts")
- `src/lib/client/admin/sections/rulesets/IdPage.svelte:817-827` ("( id ).", "id , which")
- `src/lib/client/components/sessionForms/StartSessionForm.svelte:2459-2460` and `2806-2807` ("Label : why")

**Fix each** so the text renders exactly as `git show HEAD:<file>` rendered it: put the punctuation (and any opening bracket) back against its tag on the same line, and put `<!-- prettier-ignore -->` on the line before the containing element so the next prettier run can't undo it. Compare against HEAD for each paragraph. Don't change words.

**Then find the rest:** across the files listed under "Changed files" in `plans/REPORT-toasts-2026-11-08.md`, find every place where a line in markup begins with `,` `.` `?` `!` `:` `;` `)` (after optional whitespace) and the previous non-blank line ends with a closing inline tag (`</strong>`, `</em>`, `</code>`, `</span>`, `</a>`, `</kbd>`, `</b>`, `</i>`) or a `}` expression; and every line that ends with `(` followed by an inline tag on the next line. For each, check HEAD: if HEAD had no space there, fix it the same way. A line that already had a space at HEAD stays. List every fix (file:line, before → after rendered text) in your report. The scope review's spacing diff is at `/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/rev/ws.out` — use it.

## 2. ★T2 (owner ruled): `silent` on three success toasts whose control already shows the value

- `UserSettingsTab.svelte`: *Language set to …* and *Time zone set to …* → add `silent: true`.
- The bulk *made available / hidden* successes in `src/lib/client/admin/sections/{session-presets,session-genres,prompts}/Page.svelte` → add `silent: true` **only if** the rows visibly change state after the press (check the markup: a badge/label that flips). If a row shows nothing, leave it and say so.
- **Leave** `MediaManagerTab` (cache policy) and `AccountsCard` (*User accounts turned on*) as they are: their description explains a consequence the switch doesn't show.

## 3. ★T4 (owner ruled): one key rule for shared handlers

A handler that serves several events gets `source: "<area>:refusal"` (for errors) — the rule W1 used. Apply it to W2's unkeyed ones: `admin/sections/updates/Page` `handleError`; `admin/sections/network/Page`; `admin/sections/scripts/IdPage`; `admin/sections/session-presets/IdPage`; `admin/sections/components/Page` and `IdPage`; `admin/sections/completion-templates/IdPage`; `admin/sections/pipelines/SlugPage` `onDetailError`; `src/routes/pipelines/library` `onRefusal`. `<area>` = the section slug (e.g. `"admin:network:refusal"`, matching W1's style — look at W1's keys in `/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/done1.txt` and match them). **Leave** `Layout.svelte` `handleError`/`handleSuccess` and `TemplateChangeForm.svelte:172` unkeyed (distinct messages must not replace each other). ★T5: press handlers get no `source`.

## Files owned

Only the files named above. Other lanes are editing `EditSessionForm.svelte`, `LorebooksWorkspace.svelte`, `LorebookActions.svelte`, `SummarizeLoreModal.svelte` and server files right now — never touch them; if a punctuation case is in one of those, list it in the report instead.

## Rules

- **Never run `prettier --write` on a whole file.** Run `npx prettier --check <file>` at the end and report the result; a failure caused by your `prettier-ignore` regions or by lines you didn't touch is fine — say so.
- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- Never `git checkout`/`restore` any file.

## Done means

- Every known case and every case your search finds renders as HEAD did (no space before the punctuation).
- `npm run check` (capped: `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=8192; npm run check > toastsfix-check.log 2>&1; echo exit=$? >> toastsfix-check.log'`, log in your scratchpad) — 0 errors.
- Test files next to the changed files pass (`npx vitest run <files> --maxWorkers=2` in a `MemoryMax=6G` scope, logged; never pipe into `head`). If a test matched the spaced text, fix the assertion back to the unspaced text.

## Report

Put the full report in your final message (the lead saves it as `plans/REPORT-toasts-fix-2026-11-08.md`): every punctuation fix with before → after, the T2/T4 edits, check and test results, anything left and why.
