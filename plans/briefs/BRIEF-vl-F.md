# BRIEF vl-F — Variable layouts: cross-lane fix-ups

You are a **lane supervisor**. Read `.claude/guides/multi-agent.md` first, then the plan `plans/PLAN-variable-layouts-2026-11-10.md`, then the four lane reports `plans/REPORT-vl-{S,D,A,E}-2026-11-10.md`. This lane closes the requests the UI lanes raised. Every ★ is ruled; ★A, ★E-3, ★E-4 are with the owner and are **not** yours. Delegate typing to at most 2 `lane-worker`s (suggested: w1 server, w2 client) with briefs at `plans/briefs/BRIEF-vl-F-w<n>.md`; quote into each the rules below.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

### Server (`src/lib/server/**`, `src/lib/shared/sockets/types.ts`)

1. `pipelines:templateVariableLayouts` echoes its target (`{ specSlug, nodeKey }` or `{ nodeType }`) in its response **and** its `:error` (vl-E request 1).
2. `pipelines:moveLeftoversIntoTemplate:error` carries a machine code for "needs an owner slug" (e.g. `code: "needs-owner-slug"`; name it per NOMENCLATURE §24) beside the words (vl-E request 2).
3. `pipelines:leftoverPicks` answers and errors echo `sessionId` / `presetId` (vl-E request 3).
4. `pipelines:presetVariableLayouts` returns `candidates: variableId[]`, the variables the preset's pipelines render (vl-A request 3).
5. `VariableLayouts.ListRow` (W1) carries `key`, the template key the variable renders under (its first scope root) (vl-A request 4).
6. `referenceOf` (`entities/variableTemplates.ts` ~308) refuses `core` as a person's owner slug, in words (vl-A request 5).
7. Remove the dead `variableTemplate?:` field from `shared/sockets/types.ts` together with `config/panel/read.ts`'s dead `variableTemplateRow` (~452, ~584) (vl-E queued 5, vl-D noticed).

### Client (`src/lib/client/**`, `src/lib/shared/**`, `src/routes/pipelines/library/+page.svelte`)

8. `Layout.svelte` `HANDLED_ERROR_EVENTS`: add the nine `:error` events in vl-A's request 1.
9. `typedSocket.ts` `SocketEventMap`: add the seven events (+ `:error`) in vl-A's request 2; then drop the casts in `admin/sections/variable-layouts/variableLayoutsSockets.ts` and call the registry directly (delete the bridge if nothing is left in it).
10. Match answers by the echoes from items 1 and 3: `pipelines/templateVariableLayouts.svelte.ts` (drop the one-in-flight queue and the 15 s timeout and the ⏳ once matching by target works), `leftoverPicks.svelte.ts`, and vl-A's W1 (`variable-layouts/Page.svelte` ~84–96). Use item 2's code instead of matching words.
11. **Wire W5 in the library editors** (vl-E queued 1): `src/routes/pipelines/library/+page.svelte:1005` and `components/admin/TemplateChangeForm.svelte` (the context-template path) call `requestTemplateVariableLayouts({ nodeType })` and pass `variableLayouts={templateVariableLayoutsOf({ nodeType })?.keys}` to `TemplateEditor`.
12. `shared/utils/templateCheckOptions.ts`: add `layout` (`VARIABLE_LAYOUT_HELPER`) to `CONTEXT_HANDLEBARS_HELPERS` and the filter to `CONTEXT_LIQUID_FILTERS`; then `templateCheckOptions.test.ts` drops its `+ VARIABLE_LAYOUT_HELPER`.
13. vl-E's owner field label **Owner name** (placeholder `acme`) becomes **Owner slug**, the label Genres, Rulesets and vl-A's W3 use; validate with the same `OWNER_SLUG` from `canvas/draft.svelte.ts`.
14. W6's variable picker offers `candidates` (item 4), on shelves. W1 shows `key` in mono (item 5) instead of the variable id.
15. `src/lib/shared/adminLogbook.ts:81`: link `/admin/variable-layouts/…` (the W3 form address for that row, or the variable's page if the row's variable isn't known there) and label it *variable layout* (vl-A request 6).

## Files owned

Exactly the files named in items 1–15 and their tests; plus `src/lib/server/sockets/pipelinesVariableLayouts.ts`, `src/lib/server/pipelines/config/{variableLayoutsView,leftoverPicks}.ts`, `src/lib/server/sessions/presetEditor.ts`, `src/lib/server/sockets/{pipelines,presetEditor}.ts` (these items only), `src/lib/client/components/pipelines/StepVariableLayouts.svelte`, `src/lib/client/admin/sections/session-presets/PresetVariableLayouts.svelte`, and their tests.

## Files readable

Everything. STYLE-GUIDE §6.11, §6.12, §6.17, §10; NOMENCLATURE §24.

## Rules your work depends on (quote into worker briefs)

- **Sockets:** one domain context per event family is the only listener and the only place that toasts; views never call `toaster`. `socket.off(event)` without a handler removes every listener app-wide. An event in `SCOPED_EVENTS` must carry its scope key (these admin events are not scoped).
- `$state(new Set())` / `new Map()` is not reactive on mutation: `SvelteSet` / `SvelteMap`.
- No `crypto.randomUUID`, no `navigator.clipboard` in browser code.
- Inside `db.transaction(async (tx) => …)` use only `tx`. Pass `db` explicitly in tests. Int tests opening a DB inside an `it` need 60 s.
- **NOMENCLATURE §24**: list new names (the error code, `candidates`, `key`) in your report. **Do not edit NOMENCLATURE.md, STYLE-GUIDE.md or docs/.**
- Never pipe vitest into `head`; keep DOM tests small.

## Out of scope

★A (W1 shelf headings), ★E-3, ★E-4 (owner's call). Docs. Any new behaviour not listed. The SDK.

## Stop and ask when

CLAUDE.md § Decisions applies; an item can't be done without touching a file not listed.

## Never

- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
- **Additionally: do not run `npm run sdk:build`, and do not start any dev server or `vite dev`.**

## Done means

- Targeted tests for each item pass (server int tests for 1–7; client tests for 8–15, including two views requesting `templateVariableLayouts` for different targets at once and each getting its own answer).
- The previously passing lane tests you touched still pass: rerun `src/lib/client/admin/sections/variable-layouts/`, `session-presets/`, `components/pipelines/stepVariableLayouts.dom.test.ts`, `templateVariableLayouts.test.ts`, `components/templates/`, and the vl-D socket int tests you changed.
- `npx tsc --noEmit -p .` clean. A `scope-reviewer` run on your diff, findings answered.

## Report

Return it as your final message (the lead saves it to `plans/REPORT-vl-F-2026-11-10.md`): changed files, tests run with results, new names, **Noticed, not done**.
