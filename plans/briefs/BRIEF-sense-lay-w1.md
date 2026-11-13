# BRIEF — worker `sense-lay-w1` (server half) — variable layout truth fixes

You are a `lane-worker` under supervisor `sense-lay`. Repo: `/home/jody/github/serene-pub`. Use absolute paths.
Another worker (`sense-lay-w2`) is editing the client files and docs at the same time; never touch them.

## Verbatim rules (from the lane guide)

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You should not need an SDK build: `LayoutReason` is declared in the app.)
- Never `prettier --write` on a directory (only on a single file you changed, if at all). Never `git checkout` / `restore` / `stash`. Inside `db.transaction(async (tx) => …)` use only `tx`. It is a **session**, never a *chat*.
- No reference to any other project or product in code, comments or tests.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done** in your report, never fixed in passing.
- Run only the targeted tests below, capped: `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files>"`. An int test that opens a DB inside an `it` needs a 60 s timeout. Never pipe vitest into `head`.

## Rules this work depends on (quoted from the handover, plans/HANDOVER-variable-layouts-2026-11-11.md)

- "**Name a step with its opaque handle, never its node key.** Step-addressed sockets take `stepKeyFor(secret, nodeKey)` and find the step by search (`locateStep`). The node key never appears in a panel payload (05 §0a). Lane tests that used raw keys hid this bug."
- "**One rule for who uses a layout:** `layoutRowUses`. The variable page's counts, the library's *Used by* and the delete refusal all read it. Don't add a second rule." — Do NOT change what `layoutRowUses` returns or who calls it.
- "**References are unique per variable only.** Look a row up by `(variable_id, reference)`, never by reference alone."
- NOMENCLATURE R1: one word, one meaning. "floor" is §9's word (the action model) — never use it as a new value. Every new value/field name is listed below; add no others.

## Files owned (edit only these)

1. `src/lib/server/pipelines/config/variableLayoutsView.ts`
2. `src/lib/server/pipelines/config/world.ts` — ONLY the layout-reason code (the "resolution by variable" block, ~1229–1400, and the `LayoutReason` import).
3. `src/lib/server/pipelines/entities/variableLayouts.ts` — ONLY the `LayoutReason` type + its doc comment (~1040–1052), and the stale error message (~1203–1209).
4. `src/lib/server/sockets/pipelinesVariableLayouts.ts`
5. `src/lib/shared/sockets/types.ts` — ONLY inside `namespace VariableLayouts` (~12146) and the one doc comment at ~12003 (`/** **Use the pub's**: removes one leftover pick…`).
6. Tests: `src/lib/server/sockets/pipelinesVariableLayouts.int.test.ts`, `src/lib/server/pipelines/config/variableResolution.int.test.ts`; and in `src/lib/server/pipelines/entities/variableAccounting.int.test.ts`, `src/lib/server/pipelines/entities/variableTemplates.int.test.ts`, `src/lib/server/pipelines/prompt/builderExplicitLayouts.int.test.ts` ONLY a `reason` assertion line that the new values make wrong (expected: `variableAccounting.int.test.ts:124` `currentDate` floor becomes `"no-layout"`; the other two probably stay `"default"` — run them and see).

## Task A5 — one reason value per real cause

Today `world.ts` (~1372–1397) records `reason: "default"` for four outcomes. Change `LayoutReason` to:

```ts
export type LayoutReason =
	| "leftover" | "preset" | "pub" | "template"
	| "authored"   // the layout the pipeline's author named for this step (declaredVariableLayouts)
	| "default"    // the variable's own default row (defaultVariableTemplateFor), when it is NOT the automatic row
	| "automatic"  // that default row is the variable's automatic object layout
	| "no-layout"  // no row at all: the variable's in-code default wrote it
```

Rewrite the doc comment over the type to say each value in one line (keep the 🚧 mark). In `world.ts`:
- author's named row resolves → `"authored"`;
- else the variable's default row → `"automatic"` when it is the automatic row, else `"default"`;
- no row → `"no-layout"` on the floor entry (replace `reason: "default" as const`).
- "Is it the automatic row" must use the ONE existing rule: `isAutomaticRow` in `variableLayoutsView.ts`. Export it from there (same name) and import it dynamically in `world.ts`. It needs the full table row (`name`, `source`, `seedKey`, `templateId`, `variableId`) and the decl (`getVariable(V)`), so read that row by id inside the cached `once("default", …)` lookup and cache the flag with it (per variable, as now). Do not duplicate the rule.
- Update the comment block above (the numbered list at ~1236–1243) to name the new values. Change nothing else in `world.ts`.

## Task 4 — the stale error (`variableLayouts.ts` ~1205–1209)

Replace the sentence "Fix it in the pipeline's settings, or switch that setting back to the one Serene Pub ships." so the whole message reads:

`the layout selected for '${key}' could not be rendered: ${err?.message ?? err}. Fix it on its variable's page in Admin › Variable layouts, which also says who chose it.`

## Task A3 — **Where this differs** (server side)

`layoutInUse` answers the pub-level layout only (pub's, else the variable's default, else none). A session's run may use another (`world.ts`: a template's name, a leftover pick, the preset's choice, the pipeline's choice for a step). Add to the W2 view (`variableLayoutView`) a list of everything that writes this variable out with a different layout row than the one **In use**.

Payload — add to `VariableLayoutView` (server) and `Sockets.Pipelines.VariableLayouts.Variable` (types.ts) a field `differs: Difference[]`, with `Difference` declared in both places (server: `export type VariableLayoutDifference`; types.ts namespace: `type Difference`) exactly as:

```ts
/** One thing that writes this variable out with another layout than the one in use. */
type Difference =
	| { kind: "template"; id: number; name: string; layout: { id: number; name: string } }
	| { kind: "leftover"; specSlug: string; pipelineLabel: string; stepKey: string; stepHeading?: string; layout: { id: number; name: string } }
	| { kind: "preset"; id: number; name: string; layout: { id: number; name: string } }
	| { kind: "authored"; specSlug: string; pipelineLabel: string; stepKey: string; stepHeading?: string; layout: { id: number; name: string } }
```

`stepKey` is the opaque handle `stepKeyFor(secret, nodeKey)`; a node key never appears in the payload. So `variableLayoutView(db, variableId, secret)` gains a required `secret` argument; the socket file passes `await pubSecret()` at both call sites (`pipelinesLibraryVariable`, and the two calls in `pipelinesLibrarySetPubLayout`).

How each kind is read (no new "who uses" rule):
- **preset** and **template**: from the `uses` map `variableLayoutView` already gets from `layoutRowUses(db, mine)`. For every row of the variable whose id is not the in-use row's id: each `uses.presets` entry → a `preset` difference, each `uses.namedBy` entry → a `template` difference, with `layout` = that row's `{ id, name }`.
- **leftover**: the leftover picks this module already reads for W3 (`leftoverAddresses`). Change it to also keep the picked row id(s) per address (e.g. `Map<address, Set<number>>`; a numeric string counts as its number, as today) so `useEverywhereCounts` keeps working unchanged in behaviour. For each rendering step of this variable (`renderingSteps`) whose address holds a pick naming a row of THIS variable among the live rows (`mine`) that is not the in-use row → a `leftover` difference.
- **authored**: only while the pub has NO layout of its own for the variable (a pub's layout beats the author's pick in `world.ts`, so then it writes nothing). Per active pipeline with steps rendering the variable, call `declaredVariableLayouts(db, specSlug, specVersionId, keys)` (`config/named.ts`, the run's own read — import dynamically) with those steps' keys; each named row that is in `mine` and is not the in-use row → an `authored` difference.
- Steps: `pipelineLabel` from `pipelineLabelsById(db)` (`entities/pipelineLabels.ts`) by spec id, falling back to the spec's `name`. `stepHeading` = the panel's rule `decl.stepHeading ?? decl.typeLabel` for the step's node (see how `templateVariableLayouts` does it); omit when no decl. You may extend `RenderingStep` / `renderingSteps` with what you need (spec id, version id, heading); keep its existing callers' behaviour.
- One entry per (kind, thing, layout): a step rendering the variable at two keys or slots with the same pick is listed once. Order: `template`, `leftover`, `preset`, `authored` (the run's order), then by name / pipeline label + heading.
- Empty array when nothing differs (also when the variable has no rows).

Also correct the module header (lines 8–11). Replace "and shares the run's own resolution (pub's layout, then the package default, then the floor) so the screen and the run cannot disagree about what a variable is written out with." with words to this effect: "**In use** is the pub-level answer — the pub's layout, else the variable's default, else none (`layoutInUse`). A session's run can use another (`config/world.ts`): a layout a template names, a ⏳ leftover pick, the preset's choice, or, with no pub's layout, the pipeline's choice for a step. The variable page lists each of those under **Where this differs**, so the screen says where the run departs from it." Fix the `layoutInUse` doc comment the same way if it repeats the claim.

## Tests (Done means — each must fail before your change and pass after)

In `pipelinesVariableLayouts.int.test.ts` (shares DB state across tests; build your own fixtures inside the test and clean up in `finally`, as the existing "Used by" test does):
1. A variable whose pub's layout is set to row A, overridden by a preset choosing B (`sessionPresets.variableLayouts` by reference), a context template naming C with `layout <key> "<ref>"` for a key that renders the variable (the earlier W3 tests create such templates — see "Named reader"), and a leftover pick holding D (a `pipelineNodeOverrides` row with the row id at a rendering step's address, as the W3 leftover test does) → `variable.differs` lists all three kinds with the right names and layouts; the leftover entry's `stepKey` equals `stepKeyFor(SECRET, nodeKey)` and `JSON.stringify(res)` does not contain the raw node key as a value nor the property `"nodeKey"`.
2. With no pub's layout and an author preset value naming a non-default row at a step (see how `variableResolution.int.test.ts` inserts into `pipelinePresetValues` on the default `pipelinePresets` row) → one `authored` entry, addressed by handle; with a pub's layout set, it is gone.
3. Nothing differing → `differs: []`.

In `variableResolution.int.test.ts`: the four former `"default"` outcomes each record their own value — `"default"` (package default), `"authored"` (the author's pick test), `"automatic"` (find or make a variable whose default row is its automatic object row — read `entities/objectVariableLayouts.ts` and `boot/seedVariableTemplates.ts`; if that cannot be reached through `buildWorld` cleanly, say why in your report and test it as close to `world.ts` as you can), `"no-layout"` (the floor test).

Run, capped: those two files plus `variableAccounting.int.test.ts`, `variableTemplates.int.test.ts`, `builderExplicitLayouts.int.test.ts`, `pipelines.leftoverBytes.int.test.ts`, `pipelines.leftoverPicks.int.test.ts`, `sessions.layoutCopy.int.test.ts`, `sessions.layoutPresetVerbs.int.test.ts`. Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` filtered to your files (`| grep -E "variableLayoutsView|world.ts|variableLayouts.ts|pipelinesVariableLayouts|sockets/types.ts"` is fine; do not pipe vitest). `npx prettier --check` each file you changed.

## Report (return as your final message)

Changed files with one line each; tests run with pass/fail counts; anything failing that was already failing (say how you know); any decision you made; every new or changed user-facing sentence verbatim; **Noticed, not done**.
