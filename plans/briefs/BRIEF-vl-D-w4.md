# BRIEF vl-D-w4 — Variable layouts: sockets part 2 (W4 leftover picks, W6 presets, library writes) + declared presets at install

You are a `lane-worker` under supervisor `vl-D`. Repo: `/home/jody/github/serene-pub` (SDK at `/home/jody/github/serene-pub-sdk`, read only for you). Use absolute paths. Read `plans/PLAN-variable-layouts-2026-11-10.md` § "The rule this plan applies", § W3, § W4, § W6, § Data items 3–4 and § SDK item 12 before starting. A sibling worker `w3` builds W1/W2/W3-preview/W5 in a **new** module `src/lib/server/sockets/pipelinesVariableLayouts.ts` at the same time: don't touch that module.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## What exists (built earlier in this lane)

- Migration 0151: `pipeline_variable_templates.reference` (🚧 **layout reference** `<owner>/<slug>@<major>`, unique per variable, fixed once set), `.pub_default` (🚧 **pub's layout**), `session_presets.variable_layouts` json `{ [variableId]: reference }` (🚧 **preset's variable layouts**).
- `entities/variableTemplates.ts` (import, don't edit): `createVariableTemplate` (`reference?: { ownerSlug, slug }`, `useEverywhere?`), `updateVariableTemplate` (`reference?`, fixed once set), `setPubLayout`, `stampReference(db, templateId, ownerSlug)`, `deleteVariableTemplate` (refuses in words while pub's layout / chosen by a preset / held by a leftover pick), `presetVariableLayoutsOf`, `layoutByReference`, `pubLayoutOf`, `formatLayoutReference`/`parseLayoutReference`/`layoutSlugOf` (provisional local copies).
- `config/world.ts`: run resolution `leftover → preset → pub → default → floor`, and `danglingPresetLayouts(db, presetId) → { variableId, reference }[]`.
- **Leftover picks** ⏳ are the stored per-step values at `registrations.values[nodeKey][<variables slot>][key] = <row id>` (genre and preset scope; also `pipeline_specs.instance_values`). The migration's data upgrade (`db/dataUpgrades/0151_shallow_marvel_zombies.ts`, read its header) kept only the ones that change output. Nothing new ever writes one. `config/panel/declarations.ts` `declarationsAndVariableKeys(db, versionId)` → `variableKeys` says which variable each step key renders.
- The panel no longer offers a per-step layout pick: the `variable-template-ref` declarations and `variableOptionGate` are gone. `sockets/pipelines.ts:~1053` (`layoutForOption`) still destructures `variableOptionGate` and doesn't type-check.
- **SDK dist is rebuilt** with: `presetVariableLayoutFindings(preset) → string[]`, `PresetDecl.variableLayouts?: Record<VariableId, string>`, `TemplateSeed.slug`, `parseVariableLayoutReference`, `formatVariableLayoutReference`, `variableLayoutCalls` (`@serene-pub/sdk/template-check`). See `plans/REPORT-vl-S-2026-11-10.md` "Signatures". Another rebuild (core-catalog/contracts only) may happen while you work: if a test fails with a dist read error, retry once.

## Goal

Admin-only request/response events in the `pipelines:` family, following its library patterns (admin gate, `emitToUser` success / `:error` with `{ error }` in words, `{ library, warnings? }`-style write answers, types in `shared/sockets/types.ts` under `Sockets.Pipelines` in your own namespace blocks, every success event listed in `shared/sockets/interest.ts` beside `pipelines:library*`). Not scoped events. Name each per NOMENCLATURE §24 (grep across `src`, the SDK, the schema first); code identifiers keep `variable template` where they name rows (★1). Proposed: `pipelines:leftoverPicks`, `pipelines:clearLeftoverPick`, `pipelines:moveLeftoversIntoTemplate`, `pipelines:presetVariableLayouts`, `pipelines:setPresetVariableLayout`, `pipelines:stampVariableTemplateReference`; refine if a grep finds a near-neighbour (say so).

### 1. `sockets/pipelines.ts`: remove the per-step layout path
Remove `layoutForOption` and the handlers that created/edited/selected a layout **through a panel option** (find every reader of it); keep `cloneVariableTemplate`/`updateVariableTemplate`/`deleteVariableTemplate` only if something other than the removed picker uses them (grep the client: `src/lib/client`), else remove them with their types and interest entries, and list what you removed for `vl-E`.

### 2. W3 library writes (`pipelines:libraryCreateTemplate` / `UpdateTemplate` / `DeleteTemplate`, `kind: "variable"`)
Extend `LibraryTemplateWrite.CreateParams`/`UpdateParams` with `reference?: { ownerSlug: string; slug: string }` and (create) `useEverywhere?: boolean`, passed to the entity. The library's `variableTemplates` rows (built in `config/library.ts`) gain `reference: string | null` and `pubDefault: boolean`. Delete answers the entity's refusal in words. Int test: create with a reference + use everywhere; update refusing a changed reference; delete refused while it's the pub's layout.

### 3. W4 leftover picks
- **Read** (`pipelines:leftoverPicks`): for a pipeline at the scope the panel is viewing (mirror how `pipelines:get` / the panel identifies scope: genre, preset, instance), each step's leftover picks: `{ nodeKey, key, variableId, variableLabel, templateId, layoutName, scope }`, plus per step `canMoveIntoTemplate` (true only when the step's resolved context template is **the pub's own copy**: not immutable, no owner plugin) and the template's id/name.
- **Use the pub's** (`pipelines:clearLeftoverPick`): removes one leftover (by scope + nodeKey + slot + key) through the registrations module's existing value-write functions (find what the panel's `write.ts` used for preset/genre values; P2: never write `registrations` directly from a socket).
- **Move into the template** (`pipelines:moveLeftoversIntoTemplate`, params include `ownerSlug` for rows that need a reference): only on the pub's own copy (refuse in words on a shipped or plugin template). In **one transaction (only `tx` inside)**: stamp a reference on each picked row that lacks one (`stampReference` with `ownerSlug`; refuse in words if none was passed and one is needed); rewrite every bare read of each picked key in the template to name its layout explicitly (Handlebars `{{{key}}}` / `{{key}}` → `{{{layout key "<ref>"}}}`; Liquid `{{ key }}` → `{{ key | layout: "<ref>" }}`; leave reads already inside a `layout` call, block helpers (`{{#if key}}`) and sub-paths alone); save through the context-template entity's update function (check it accepts `tx`; if not, stop and say so); clear the step's leftovers. After the rewrite, `variableLayoutCalls` on the new source must list exactly the calls you wrote (assert it in the test). Output must be unchanged: test that the step's rendered context is byte-identical before and after on a booted DB, if a render helper makes that practical; else assert the resolution of each key.
- Int tests: read lists a stored leftover; Use the pub's removes it; Move into the template rewrites a pub copy and clears; **refused on a shipped template**; refused without an owner slug when a row needs a reference.

### 4. W6 a preset's variable layouts
Find the server code that stores and reads pub presets and declared presets (start at `src/lib/server/sessions/presetEditor.ts`, `src/lib/server/sockets/presetEditor.ts`, `src/lib/server/sockets/sessionAdmin.ts` `sessionPresets:*`, `pipelines/boot/registrySync.ts` `syncPluginPresets` ~960, `pipelines/registrations/project.ts` ~134 for core's) and **list every file in your report**.
- **Read** (`pipelines:presetVariableLayouts`, by preset id): `{ presetId, editable, rows: [{ variableId, variableLabel, reference, templateId | null, layoutName | null, pubLayout: { templateId, name } }], dangling: [{ variableId, reference }] }`. `editable` false for a declared preset (seed key or owner plugin or immutable).
- **Write** (`pipelines:setPresetVariableLayout`): set `{ presetId, variableId, reference }` or clear (`reference: null`); refuses on a declared preset, an unknown variable, or a reference that doesn't resolve for that variable; refuses a row with no reference (W6: it must be stamped first).
- **Stamp** (`pipelines:stampVariableTemplateReference`): `{ templateId, ownerSlug }` → `stampReference`.
- **The dangling notice** "on the path presets already use for a missing requirement": find where the preset list/form surfaces `session_preset_notices` (unbound slots) and add the `danglingPresetLayouts` result beside it as computed entries (no new table, no new stored row; lead-accepted). Name the field in your report.
- **Copying a preset** (wherever "Copy…" / duplicate is implemented) carries `variable_layouts`.
- **Declared presets at install and boot**: where a plugin's `preset()` declarations and core's are projected into `session_presets`, write `variableLayouts` from `PresetDecl.variableLayouts` (empty `{}` when absent) the way `settings`/`castFloor` are written, so a re-projection keeps it in step; call `presetVariableLayoutFindings` at install where the other preset findings are checked (`plugins/install.ts`, near `genrePresetFindings`), refusing like those do. A reference to a layout not installed is accepted (it's skipped at run time, with the notice). Test: a plugin preset declaring `variableLayouts` lands in the column; a malformed one is refused at install; **a second boot changes nothing**.

## Files owned (edit only these)

- `src/lib/server/sockets/pipelines.ts` + its tests
- `src/lib/server/pipelines/config/library.ts` (the variable template rows' new fields only)
- `src/lib/shared/sockets/types.ts` (your namespaces + `LibraryTemplateWrite` + `LibraryTemplate` only; w3 edits other blocks: re-read before every edit)
- `src/lib/shared/sockets/interest.ts` (your events only; w3 too: re-read before every edit)
- preset code: `src/lib/server/sessions/presetEditor.ts`, `src/lib/server/sockets/presetEditor.ts`, `src/lib/server/sockets/sessionAdmin.ts` (the `sessionPresets:*` handlers only), `src/lib/server/pipelines/registrations/project.ts` and `src/lib/server/pipelines/boot/registrySync.ts` (preset projection only), `src/lib/server/plugins/install.ts` (preset findings only) + tests
- a new `src/lib/server/pipelines/config/leftoverPicks.ts` for the W4 logic (keeps the socket thin) + tests

## Files readable

Everything. Especially `config/panel/write.ts` and `config/panel/read.ts` (scope handling), `registrations/{values,rows,resolve,instanceValues}.ts`, `entities/contextTemplates.ts`, `entities/variableTemplates.ts`, `config/world.ts`, `NOMENCLATURE.md` §6, §9 (presets), §15, §24; `docs/pipelines.md` § Presets.

## Rules your work depends on (quoted from CLAUDE.md and the lane brief)

- "**Sockets:** one domain context per event family … is the only listener, and the only place that toasts. An event in `SCOPED_EVENTS` must carry its scope key." These are admin events, not scoped.
- "**0.6 is in users' hands**: a change to stored data ships with a forward migration or boot pass and **a test that a second boot changes nothing**."
- "Inside `db.transaction(async (tx) => …)` use only `tx`; the outer `db` deadlocks PGlite silently."
- "`defaults.ts` imports stay leaf; pass `db` explicitly (a `defaultDb()` dynamic import bypasses `vi.mock`)."
- "**P1**: every automatic action shows its cause and how to undo it. **P2**: the layouts module owns its rows and every write to them." Layout rows only through `entities/variableTemplates.ts`; registration values only through the registrations module; context templates only through their entity.
- "**Genres expect, never lock**" and "**Members never see or touch model plumbing**": every event here refuses a non-admin.
- "**NOMENCLATURE §24**: grep every new name first." List every new name. Don't edit NOMENCLATURE.md, STYLE-GUIDE.md or docs/.
- User-facing strings say **variable layout**, never bare *layout*.
- "Int tests that open a DB inside an `it` need a 60 s timeout. Never pipe vitest into `head`."

## Out of scope

`sockets/pipelinesVariableLayouts.ts` and W1/W2/W5 (w3); the entity/world/panel/prompt files; the `layout` helper and render pre-pass (later); client code; the SDK; docs.

## Stop and ask when

CLAUDE.md § Decisions applies; a name has a near-neighbour you can't resolve; you need a file you don't own or an entity function that doesn't exist (describe it); the context-template entity can't write inside a transaction.

## Never

- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
- Additionally: don't run `npm run sdk:build` or `npm run db:generate` at all. Never `kill -9` anything. Never `git checkout` / `restore` / `stash` in `../serene-pub-sdk`.

## Done means

Int tests per event (happy path + refusals listed above), the install/boot tests, `pipelines.interestGate.test.ts` green, existing tests of every file you touched green (grep for them), `npx tsc --noEmit -p .` no errors in your files (filter to your paths).

## Report

Return it as your final message (don't write a report file): changed files; each test file run with its result; **every event with its full params, response shape and refusals** (`vl-A` and `vl-E` build from this); removed events/fields (for `vl-E`); the preset code files; every new name; open questions; **Noticed, not done**.
