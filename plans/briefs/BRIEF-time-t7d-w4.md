# BRIEF — `time-t7d-w4`: layout-shape warnings in the SDK template checker

Supervisor: lane `time-t7d`. SDK repo `/home/jody/github/serene-pub-sdk` (edit there); app repo
`/home/jody/github/serene-pub` (read; app tests only as listed). Report back in your final message.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You do not run `sdk:build`: the supervisor does, after you.)

Also: never `prettier --write`; never `git checkout / restore / stash` in either repo. Comments state the rule,
not the story. No other product's name in any file. Another worker writes docs at the same time; a peer session
shares the checkout: touch only your files.

## Owner ruling, 2026-11-15 (his words)

"The context template and variable layouts decide how to represent the data, nothing should be handed down
flat. A custom node could flatten data, but it should be highly discouraged in the documentation, and if that
new shape is trying to use an existing variable layout, it should be flagged as a missmatch, and refused at the
configuration layer if an object is will cause an exception on execution during template rendering."
"Break existing custom layouts, we are in pre-release, we don't care."

Facts: both engines render non-strict, so only a syntax error (and, in Handlebars, an unregistered helper)
throws; a save refuses only those and that stays so. **Add no refusal.** Everything here is a **warning**.

## Context

- `sdk/src/templateCheck.ts` (`checkTemplateSourceReport`, `walkHandlebars` ~541–715, `walkLiquid` ~871,
  `resolveLiquidPath` ~834; sink methods ~290–470), `sdk/src/template.ts` (`TemplateFinding`,
  `TemplateFindingKind` ~314, `VarField`, `elementOf`), `sdk/src/templateScopeAt.ts` / `resolveHandlebarsPath` /
  `typeOfHandlebarsPath` / `enterHandlebarsBlock` (the reach machinery).
- Already built: `FORMAT_DATE_HELPER = 'formatDate'`, `FORMAT_DATE_DELTA_HELPER = 'formatDateDelta'`
  (`sdk/src/variableLayouts.ts`), `STORY_DATE_FIELD`, `STORY_DATE_DELTA_FIELD` (`sdk/src/variables.ts`).
  `core:var/history@1` is a list of `{ date?, dateDelta?, content }`; `core:var/earlier-scenes@1` rows
  `{ name, summary, date?, dateDelta? }`; `core:var/current-date@1` is a date value. The app hands its helper /
  filter names to the checker (`src/lib/shared/utils/templateCheckOptions.ts`; both new names are in it).
- The app's layout editor lints with the variable's typed scope; a layout save now passes the typed scope too
  (warnings only). Context templates are checked against their step's typed scope (`contextTemplateFit.ts`,
  law T1, `templateFit.ts` in the SDK).

## Goal

Add one finding kind, 🚧 `'shape-mismatch'` (to `TemplateFindingKind`, with a doc line like its neighbours),
always `severity: 'warning'`, reported where the scope is typed (never for `'any'` / `string[]` / unchecked
paths — stop where the schema stops talking). Four cases, each with a message that says what will print and
what to write instead:

1. **A value printed bare** whose declared type is `object`, `record` or `list` (Handlebars: a
   `MustacheStatement` with no params whose path resolves to one; Liquid: an output `{{ x }}` with no filter that
   resolves to one): "'<path>' is an object, so printing it writes [object Object]. Print one of its fields, loop
   over it, or pass it to a helper (formatDate for a date)." (list / record worded accordingly).
2. **`each` over a non-list**: `{{#each x}}` / `{% for i in x %}` where `x` resolves to `string`, `number`,
   `boolean` or a fixed-field `object` (a `record` and a `list` are fine).
3. **`@key` inside an `each` over a declared list** (Handlebars; printed or passed to a helper): "a list's
   entries have positions, not keys, so '@key' is the position. A layout written for a keyed value reads like
   this; read the entry's own fields instead." (This is how a saved layout written for the old keyed History
   is flagged.) Liquid has no `@key`: skip.
4. **`formatDate` / `formatDateDelta` given the wrong field**: the helper (Handlebars call or subexpression) or
   filter (Liquid `x | formatDate`) applied to a path that resolves to a typed field that is not a date value
   (resp. not a date delta). Recognise them structurally (an internal predicate: a date value is an `object` whose
   `year` field is an `object` with a `number` field; a delta is an `object` with a `sign` field) so a plugin's
   JSON-declared scope is recognised too. An unchecked argument is never flagged.

Make sure, and prove with tests, that `shape-mismatch` never refuses anything: grep every place findings turn
into refusals or misfits (SDK `templateFit.ts` / law T1, `validate.ts`, the app's `contextTemplateFit.ts`,
`templateDiagnostics.ts` lenient handling, `templateValidation.ts`) and exclude it wherever only errors should
count. If a place treats every finding of a typed scope as a misfit, stop and report rather than redesign it.

## Tests

- SDK (`sdk-tests/`, the template-check test file — grep `checkTemplateSource`): each case fires in Handlebars;
  cases 1, 2, 4 in Liquid where the walker resolves the path (say which do not); nothing fires for `'any'`; the
  shipped-style layouts (`{{{formatDate date}}}` inside `{{#each history}}`, `{{{pad currentDate.month.number 2}}}`,
  `{{{jsonValue content indent=0}}}`) give no finding; the old keyed History layout
  (`{{#each history}}{{{jsonValue @key indent=0}}}:{{{jsonValue this indent=0}}}{{/each}}`) gives a case-3 warning.
- Run, capped, strictly one at a time (check `ps -eo pid,args | grep -E "node.*(vitest|tsx --test)" | grep -v grep`
  first; if one runs, do other work and check again):
  `cd /home/jody/github/serene-pub-sdk/sdk-tests && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c "npx tsx --test <files> > /home/jody/github/serene-pub/plans/time-t7d-w4.log 2>&1"`
  on the template-check, template-fit, validate and template-scope test files; then `npx tsc --noEmit -p .` there.
- You cannot see your change from the app until the supervisor rebuilds the SDK: do not run app tests.

## Files owned (only these)

`sdk/src/templateCheck.ts`, `sdk/src/template.ts` (the kind union and its doc only), `sdk/src/templateFit.ts` /
`sdk/src/validate.ts` only if a refusal path must exclude the new kind, and the matching `sdk-tests/*.test.ts`.

## Out of scope

Any app file. Any refusal. Docs (another worker; it will describe the four warnings as written here). Other new
names (internal function names are yours).

## Stop and ask when

A case cannot be a warning without also becoming a refusal somewhere; a shipped core context template or
shipped layout would gain a finding (grep the shipped sources you can run through the checker in a test:
`core-catalog/src/genres/**` templates are reachable in sdk-tests? if not, say so); a new exported name seems
needed.

## Done means

Tests above green; report changed files, the kind and messages as written, which Liquid cases are covered,
every refusal path you checked (file:line) and what you changed there, tests with counts.
