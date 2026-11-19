# BRIEF — fix lane `time-t7d-fix` — six scope-review findings on the structured dates lane

Repo `/home/jody/github/serene-pub` (app) and `/home/jody/github/serene-pub-sdk` (SDK: edit it there; never
`git checkout / restore / stash` in it). Supervisor: read `.claude/guides/multi-agent.md`, then
`plans/briefs/BRIEF-time-t7d.md` (design v2) and `plans/REPORT-time-t7d-2026-11-15.md`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never `git stash`; `npx prettier --check` only, never `--write`. Never commit. Never `npm test` / `npm run build`
at the SDK root. Delete only your own `/tmp/serene-pub-vitest-*` dirs by name. Before any `sdk:build`, check
`pgrep -af "vite"` and `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep`; if one is up, don't build.
No migration. Read-only agents share the checkout; they run nothing.

## Fixes (each with a test)

1. **`shape-mismatch` fires on shipped context templates, wrongly** (`../serene-pub-sdk/sdk/src/templateCheck.ts`
   ~789, ~817, ~1087–1098). The checks were asked for the variable-layout check only. Chat's
   `core-catalog/src/genres/chat/respond.ts:142` and `shared/toolLoop.ts:113` print a prompts-slot string
   correctly; the checker reads Assemble's optional `postHistory: object` (`contracts/src/tasks.ts` ~1248) over
   the prompts field `postHistory: text` (~1324; `templateScopeAt.ts` ~318–336). Limit the new checks to
   variable layouts, **and** add a test that every shipped core-catalog template and layout checks with no
   `shape-mismatch`.
2. **History's printed key lost its escaping (a regression) and repeats on equal dates**
   (`src/lib/server/pipelines/entities/variableLayouts.ts` ~387–410). The shipped History layout and its code
   fallback print each row as an escaped object, the way Earlier scenes does:
   `{"date":<json string of formatDate date>,"dateDelta":"…" (only when present),"content":<json>}` in a JSON
   list, newest first. A calendar name containing `"` or `\` must print valid JSON; two rows on one date are two
   objects. Fix the comment that states the breakage as the rule. Liquid twin and parity fixtures follow.
   Report the before / after text (★ for the owner: History's printed form changes).
3. **The delta can return negative parts** when a date does not land in a declared calendar
   (`src/lib/shared/lorebooks/storySpan.ts` ~75–90; example row `{412,1,200}` vs now `{412,2,1}`, four months).
   Use the free-form rule when either date fails `storyTimeProblem(…, calendar)` (the check `storyDateValueOf`
   uses, `storyDate.ts` ~280) and loop the month borrow. Property-style test: for a spread of dates and
   calendars no part is ever negative and the sign matches `compareDates`.
4. **The current date is not byte-identical for a date that does not land**: under a declared calendar it
   printed `Year 412, Mo. 13, Day 5` (`formatStoryTime`), now `412-13-05`. Restore the old text for that case.
5. **Stale names in SDK guides**: `guides/time.md` ~216 (`relativeDate`), `guides/writing-lore-from-a-pipeline.md`
   ~120–124 (History "keyed by date"; `currentDate.label`; the sample `Now: {{currentDate.label}}`). Rewrite to
   `date` / `dateDelta`, the row list and `{{{formatDate currentDate}}}`; any `ts` / `playground` / recipe fence
   touched must still pass its test.
6. **The render-time guard** (`variableLayouts.ts` ~1377–1394) writes the raw value with no wrapper; the brief
   said the variable falls back to its floor. Make it the floor (the variable's plain default rendering, with
   its heading) and keep the receipt line; if the floor cannot render that value either, print nothing and say
   so in the receipt. Add `HistoryRow` and `renderVariable`'s `report` to NOMENCLATURE §25; note
   `sockets/pipelines.ts` (`validateTemplateDraft`) in the changed files.

Docs that describe History's printed form (`docs/context-templates.md`, `docs/lorebook-time.md`,
`INTEGRATING.md` §1p) follow fix 2.

## Done means

- `npm run sdk:build` (after the checks), then `npm run sdk:test` in the capped form
  (`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npm run sdk:test > plans/time-t7d-fix-sdk.log 2>&1"`):
  only the four known failures.
- App tests in that capped form with `npx vitest run --maxWorkers=3 <paths>`, one run at a time: the lane's
  dated-rows tests, `variableLayouts*.test.ts`, the liquid parity tests, `contextConfigCards*.test.ts`,
  `storySpan.test.ts`, `storyDateValue.test.ts`, `assemble.test.ts`, `guideRecipes.int.test.ts`,
  `registryHashes.test.ts`, `specHashes.test.ts`.
- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` 0 errors; `NODE_OPTIONS=--max-old-space-size=12288 npm run check` 0 errors.

## Report

Final message = the report (lead appends it to `plans/REPORT-time-t7d-2026-11-15.md`): each fix, file:line,
before / after output for fix 2, tests with results, anything not done. Under about 500 words.
