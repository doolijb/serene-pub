# BRIEF — `time-t7d-fix-w1`: `shape-mismatch` for variable layouts only (fix 1), and the stale SDK guide names (fix 5)

Supervisor: lane `time-t7d-fix`. App `/home/jody/github/serene-pub`, SDK `/home/jody/github/serene-pub-sdk`
(edit the SDK there). Report back in your final message.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

Also: never `prettier --write`; never `git checkout / restore / stash` in either repo; never `kill -9`; no
migration. Comments state the rule, not the story. No other product's name in any file. Another worker
(`w2`) edits `entities/variableLayouts.ts`, `liquidParity.fixtures.ts`, `storySpan.ts`, `storyDate*.ts`, the
dated-rows test, `docs/*.md`, `INTEGRATING.md` and `sdk/src/storyTime.ts` at the same time, and a peer session
shares the checkout: touch **only** the files below. Do not edit `NOMENCLATURE.md` (the supervisor records the
new option there).

## One run at a time (the whole lane shares one machine)

Before **every** test run, `tsc` or `sdk:build`, wait for the machine to be free:
`timeout 900 bash -c 'while ps -eo args | grep -E "node.*vitest|tsx --test|tsc -p tsconfig.build|svelte-check|npm run (sdk:)?build" | grep -v grep >/dev/null; do sleep 10; done'`
then run. Every test run is capped:

- SDK, one or two files, no build needed (tsx reads the sources through `sdk-tests/tsconfig.json` paths):
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsx --test templateCheck.test.ts templateFit.test.ts > /home/jody/github/serene-pub/plans/time-t7d-fix-w1-sdk.log 2>&1"`
- App (from the app root), only after the `sdk:build` below:
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/time-t7d-fix-w1.log 2>&1"`
  Never pipe vitest into `head`. Note `ls -d /tmp/serene-pub-vitest-*` before and after; remove by name only
  the ones your run created.
- `sdk:build` (app root, `npm run sdk:build`): only when the wait above passes **and** `pgrep -af "vite"` shows
  no `vite dev` / `vite preview` (the Svelte language server's esbuild is not one). Run it once, after your
  SDK edits are done and their SDK tests pass.

## Fix 1 — the shape checks fire on shipped context templates, wrongly

The four `shape-mismatch` checks in `../serene-pub-sdk/sdk/src/templateCheck.ts` (`printedBare` ~425,
`loopOver` ~447, `listKey` ~457, `dateInput` ~468; called at ~688, ~767, ~789, ~817, ~1087–1098) were asked
for the **variable-layout** check only (the lane's design: "warnings in the existing layout check"). The
checker cannot tell a layout from a context template today, so they also fire on context templates, where they
are wrong twice: a laid-out key reaches a context template as **text** while `laidOutScope`
(`sdk/src/variableLayouts.ts` ~163) keeps its declared object/list type, and Chat's
`core-catalog/src/genres/chat/respond.ts:142` and `shared/toolLoop.ts:113` print `{{{postHistory}}}` (a
prompts-slot string) while the scope reads Assemble's optional `postHistory: object`.

Build (supervisor's decision on the mechanism):

1. `sdk/src/template.ts` `TemplateCheckOptions` (~334): add one option, 🚧 `variableLayout?: boolean`,
   doc: the source is a variable layout, checked against its variable's own scope; only then are
   `shape-mismatch` findings reported (a context template receives laid-out keys as text, so the declared
   shapes do not describe what it prints). Mark it `@experimental`. Update the `shape-mismatch` line of the
   `TemplateFindingKind` doc (~312) to say "in a variable layout".
2. `templateCheck.ts`: the four checks run only when `options.variableLayout` is true (thread it into
   `FindingSink` the way `offers` is, and make the four methods return early; keep the `eachOverList`
   bookkeeping harmless). Nothing else in the checker changes.
3. `sdk/src/templateFit.ts` `variableSeedFindings` (~486): check with `{ ...checking.options, variableLayout: true }`.
4. App callers that check a **variable layout** pass it; context-template callers do not:
   - `src/lib/shared/utils/templateValidation.ts` `validateTemplateContext` (~128): add an optional last
     parameter (an options object `{ variableLayout?: boolean }` is fine) passed into the check;
   - `src/lib/server/sockets/pipelines.ts` `validateTemplateDraft` (~1627): pass it when `draft.kind === "variable"`;
   - `src/lib/shared/utils/contextConfigCards.ts` `lintVariableTemplate` (~538) → `lintSource` (~459): pass it;
     `lintContextTemplate` does not;
   - `src/lib/shared/utils/templateDiagnostics.ts` `templateDiagnostics` (~140): a `variableLayout` option
     passed through;
   - `src/lib/client/components/templates/TemplateEditor.svelte`: a `variableLayout = false` prop passed to
     both `templateDiagnostics` calls (~209, ~294); set it in
     `src/lib/client/admin/sections/variable-layouts/VariableLayoutForm.svelte` (~604) and in
     `src/routes/pipelines/library/+page.svelte` (~1015, `variableLayout={tab !== "templates"}`).
   Inventory any other caller that checks a layout (`grep -rn "decl.scope\|variable.scope" src/lib`), and say
   in your report which you changed and which you left (a context template caller is left).
5. Tests:
   - `sdk-tests/templateCheck.test.ts` (~339–460): the existing shape tests pass `variableLayout: true` in
     `OPTS`; add one test that the same sources checked **without** it report no `shape-mismatch`.
   - `sdk-tests/templateFit.test.ts` ~128 asserts a shape-mismatch on a context-template fit: rewrite it to
     assert none (a context template is not a layout), keeping its "never refuses" half by checking a layout
     through `variableSeedFindings` instead if that reads naturally.
   - **New**: every shipped core-catalog context template checks with no `shape-mismatch` at every node that
     renders it. Find where the shipped templates live (the spec presets' template slot values in
     `CORE_SPECS`, and the context template seeds in `core-catalog/src/seed/` — grep for `kind: 'context'` or
     how `templateSeedFindings` is fed) and check each with `templateFit(doc, nodeKey, template, checking)` at
     each node of each `CORE_SPECS` doc that has a template slot; assert no warning or refusal of kind
     `shape-mismatch`, and assert something was checked. Put it in `templateFit.test.ts` beside the
     "every shipped core spec" test (~250).
   - **New (app)**: in `src/lib/shared/utils/templateValidation.test.ts`, every row of
     `SHIPPED_VARIABLE_TEMPLATES` (`$lib/server/pipelines/entities/variableLayouts`) and every twin in
     `LIQUID_LAYOUTS` (`$lib/server/pipelines/prompt/liquidParity.fixtures`, keyed `<key>/<variant>`) checked
     **as a layout** (`variableLayout: true`) against `getVariable(row.variableId).scope` has no
     `shape-mismatch` warning, and a context template with `{{{postHistory}}}` against a scope declaring
     `postHistory` as an object has none either. ⚠ `w2` is rewriting the History layout at the same time; if
     only History fails, say so and leave it to the supervisor rather than editing `w2`'s files.

## Fix 5 — stale names in the SDK guides

- `../serene-pub-sdk/guides/time.md` ~216: "The distance a History day shows in the prompt (`relativeDate` on
  `core:var/history@1`)" — `relativeDate` is retired. Say: each History row's `dateDelta` (its distance from
  the story's now, printed by its layout with `formatDateDelta`) is independent of Decay.
- `../serene-pub-sdk/guides/writing-lore-from-a-pipeline.md` ~116–126: "the `history` band (entries keyed by
  date)" → a list of rows `{ date, dateDelta, content }`, newest first, which a context template reads as
  `{{{history}}}`, already laid out. The current-date bullet: `currentDate` is a date value
  (`year`, `month`, `day`, `time`, each part `{ number, name? }`); its layout prints it with
  `{{{formatDate currentDate}}}`. ⚠ In a **context template** a laid-out key is already text (its layout
  ran), so the sample is `{{{currentDate}}}` then `{{{history}}}` — not `{{{formatDate currentDate}}}`, which
  would get text and print nothing there. Write the sample that way and say in one sentence that
  `formatDate` belongs in the variable's layout. Use triple stashes in the sample.
- `grep -rn "relativeDate\|currentDate.label\|keyed by date" ../serene-pub-sdk/guides ../serene-pub-sdk/docs`
  (not `INTEGRATING.md`, which is `w2`'s) and fix any other stale hit in the guides; list them.
- Any `ts` / `playground` / `recipe` fence you touch must still pass its test: find which test reads the
  guide fences (`grep -rln "writing-lore-from-a-pipeline\|guides/" ../serene-pub-sdk/sdk-tests src/lib/server/pipelines/scripts/guideRecipes.int.test.ts`)
  and run it (a `handlebars` fence may be untested; say so).

## Files owned

SDK: `sdk/src/template.ts`, `sdk/src/templateCheck.ts`, `sdk/src/templateFit.ts`,
`sdk-tests/templateCheck.test.ts`, `sdk-tests/templateFit.test.ts`, `guides/time.md`,
`guides/writing-lore-from-a-pipeline.md` (and another guide only for a stale hit you list).
App: `src/lib/shared/utils/templateValidation.ts`, `templateValidation.test.ts`, `templateDiagnostics.ts`,
`contextConfigCards.ts` (the variable-layout lint only), `src/lib/server/sockets/pipelines.ts`
(`validateTemplateDraft` only), `TemplateEditor.svelte`, `VariableLayoutForm.svelte`,
`src/routes/pipelines/library/+page.svelte`.

## Out of scope

Changing what `laidOutScope` or `templateScopeAt` declare; the wording of the warnings; any other finding kind;
the History layout; `NOMENCLATURE.md`; docs under `docs/`. Note anything else under **Noticed, not done**.

## Stop and ask (in your report) when

A second new name seems needed; a shipped layout (not History) reports a `shape-mismatch` as a layout; a
caller's role (layout or context template) is unclear; anything outside the files above needs a change.

## Done means

- SDK: `templateCheck.test.ts` and `templateFit.test.ts` pass (tsx form above); the guide-fence test passes.
- `npm run sdk:build` once (checks above), then app:
  `npx vitest run --maxWorkers=3 src/lib/shared/utils/templateValidation.test.ts src/lib/shared/utils/contextConfigCards.test.ts src/lib/shared/utils/contextConfigCards.templateFields.test.ts src/lib/server/pipelines/scripts/guideRecipes.int.test.ts`
  (capped form), and the template editor's dom tests if you changed its props
  (`src/lib/client/components/templates/*.dom.test*.ts`, `variableLayoutForm.dom.test.svelte.ts`).
- `npx prettier --check` on every file you touched.

## Report (final message, under about 400 words)

Each change with file:line; the new option's name and doc sentence; the callers changed and left; tests run
with results; when you ran `sdk:build`; anything not done; **Noticed, not done**.
