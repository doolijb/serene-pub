# BRIEF vl-G — Variable layouts: address steps by the panel's opaque handle

You are a **lane supervisor**. Read `.claude/guides/multi-agent.md` first, then `plans/PLAN-variable-layouts-2026-11-10.md` (§ W4, W5) and the reports `plans/REPORT-vl-{D,E,F}-2026-11-10.md`. One focused bug from the lead's walk. Delegate typing to at most 2 `lane-worker`s (server, client) with briefs at `plans/briefs/BRIEF-vl-G-w<n>.md`; quote the rules below into each.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## The bug (found walking a real instance, 2026-11-10)

The pipeline panel never sees node keys: by rule (`src/lib/server/pipelines/config/panel/ids.ts` header, "05 §0a": "the payload carries **no topology** — not the node key"), a step is named by its opaque handle `stepKeyFor(secret, nodeKey)` (`ConfigOption.step.key`, `panel/types.ts:60`), and the server resolves a handle by *search* (`locate` in `panel/write.ts:55`).

The variable-layout step events were built on raw node keys:
- `PipelineConfigOptions.svelte` ~210–224 sends `pipelines:templateVariableLayouts` `{ specSlug, nodeKey: option.step.key }`, i.e. the opaque handle under the name `nodeKey`; the server (`config/variableLayoutsView.ts` ~855–871) looks it up as a node key and answers `:error` *"The pipeline 'core:spec/story-respond' has no step '694ff0a079d37191'."* So on every real pipeline the editor gets no layout data: no *Written as*, no **Write as … here**, no reference completion, no **Layouts in this template**.
- `pipelines:leftoverPicks` returns raw `nodeKey` on steps and picks (a topology leak against the same rule), and `leftoverStepsFor` (~197–205) compares that raw key with `option.step.key`, which never matches. Leftovers only appear when a pipeline happens to have exactly one template option.
- `pipelines:clearLeftoverPick` / `:moveLeftoversIntoTemplate` take raw `nodeKey`.
- W1's `?step=<specSlug>:<stepKey>` filter (`variable-layouts/Page.svelte`) sends the handle through `templateVariableLayouts`, so it fails the same way.

## Goal

1. **Server:** the four step-addressed events take and return the opaque step handle, never a node key.
   - `pipelines:templateVariableLayouts` step target becomes `{ specSlug, stepKey }`: resolved by minting `stepKeyFor(secret, nodeKey)` over the published spec's nodes (same secret and search as the panel; find how `pipelines:get` obtains it). Echo `{ specSlug, stepKey }`. The library form `{ nodeType }` is unchanged. An unknown handle answers in words like `locate`'s.
   - `pipelines:leftoverPicks` steps and picks carry `stepKey` instead of `nodeKey` (keep `slot` and `key` only if they aren't topology: `key` is the template variable name, which the panel already shows; `slot` is a slot name: check the rule and drop it if it counts).
   - `pipelines:clearLeftoverPick` and `pipelines:moveLeftoversIntoTemplate` take `stepKey`, resolved by the same search.
   - Types in `shared/sockets/types.ts` follow (`ForTemplate` target, `Echo`, `LeftoverPicks.*`, `ClearLeftoverPick.Params`, `MoveLeftoversIntoTemplate.Params`).
2. **Client:** send and match by `stepKey` throughout: `templateVariableLayouts.svelte.ts`, `leftoverPicks.svelte.ts`, `StepVariableLayouts.svelte`, `PipelineConfigOptions.svelte` (`layoutTargetKeys` effect, `leftoverStepsFor`), W1's `?step=` reader in `admin/sections/variable-layouts/Page.svelte`.
3. **The missing test:** an int test that reads a real published spec's panel (`pipelines:get` or the panel reader), takes a context-template option's `step.key`, and gets a non-error `templateVariableLayouts` answer with `characters` in `keys`; and one that a leftover pick's step pairs with its option by `stepKey` on a spec with more than one template option. Existing tests that fed raw node keys switch to handles.

## Files owned

`src/lib/server/pipelines/config/{variableLayoutsView,leftoverPicks}.ts`, `src/lib/server/sockets/{pipelinesVariableLayouts,pipelines}.ts` (these events only), `src/lib/shared/sockets/types.ts` (these types only), `src/lib/client/sockets/typedSocket.ts` (these entries only), `src/lib/client/components/pipelines/{templateVariableLayouts.svelte.ts,leftoverPicks.svelte.ts,StepVariableLayouts.svelte,PipelineConfigOptions.svelte}` (these parts only), `src/lib/client/admin/sections/variable-layouts/Page.svelte` (the `?step=` reader only), and the tests of all of these. `NOMENCLATURE.md` §25: only the variable-layouts rows that name these params (`nodeKey` → `stepKey`).

## Files readable

Everything. `panel/ids.ts`, `panel/write.ts` (`locate`), `panel/read.ts` (~500–510).

## Rules (quote into worker briefs)

- **No topology in a panel payload** (`panel/ids.ts`, 05 §0a): no node key reaches the browser; resolve handles by search over the published version's nodes.
- Sockets: one domain context per event family is the only listener and toaster; views never call `toaster`; `socket.off(event)` needs the handler. These admin events are not scoped.
- Inside `db.transaction(async (tx) => …)` use only `tx`. Pass `db` explicitly in tests. Int tests opening a DB inside an `it` need 60 s. Never pipe vitest into `head`.
- **Never run `npx prettier --write` on a directory or glob.** Only on a file you changed, by name, or not at all (`npx prettier --check <file>` to inspect). The last lane's worker reformatted 151 files of other people's work this way.

## Out of scope

Anything else. Docs beyond the §25 rows named.

## Stop and ask when

CLAUDE.md § Decisions applies; resolving a handle needs a file not listed.

## Never

- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
- **Additionally: do not run `npm run sdk:build`, and do not start any dev server or `vite dev`.**

## Done means

- The two new int tests pass; every test you touched passes: `src/lib/server/sockets/{pipelinesVariableLayouts,pipelines.leftoverPicks,pipelines.leftoverBytes}.int.test.ts`, `src/lib/client/components/pipelines/{stepVariableLayouts.dom,templateVariableLayouts}.test.ts`, `src/lib/client/admin/sections/variable-layouts/`, `src/lib/client/components/templates/`.
- `npx tsc --noEmit -p .` clean. A `scope-reviewer` run on your diff, findings answered.

## Report

Return it as your final message (the lead saves it to `plans/REPORT-vl-G-2026-11-10.md`): changed files, tests run with results, the payload shapes after the change, **Noticed, not done**.
