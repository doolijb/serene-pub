# BRIEF vl-D-w2 — Variable layouts: the render path (resolution by variable, reason, safe values, pickers out)

You are a `lane-worker` under supervisor `vl-D`. Repo: `/home/jody/github/serene-pub` (SDK at `/home/jody/github/serene-pub-sdk`, read only for you). Use absolute paths. Read `plans/PLAN-variable-layouts-2026-11-10.md` § "The rule this plan applies", § Render path (items 5–8) and § W4 before starting. The plan is the contract; this brief is your slice.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Already done (by the supervisor, don't redo)

- Migration 0151 (generated): `pipeline_variable_templates.reference` (🚧 **layout reference** `<owner>/<slug>@<major>`, unique per variable), `pipeline_variable_templates.pub_default` (🚧 **pub's layout**, at most one per variable), `session_presets.variable_layouts` json (🚧 **preset's variable layouts**, `{ [variableId]: reference }`). Don't touch `schema.ts` or `drizzle/`.
- `src/lib/server/pipelines/entities/variableTemplates.ts` (worker w1 owns it; you only import): `pubLayoutOf(db, variableId) → id | null`, `layoutByReference(db, variableId, reference) → id | null`, `presetVariableLayoutsOf(db, presetId) → Record<variableId, reference>`, and the existing `resolveVariableTemplate(db, id)`. `boot/seedVariableTemplates.ts` `defaultVariableTemplateFor(db, variableId)` is the **package default** (w1 owns that file too; import only).
- `src/lib/server/pipelines/entities/variableLayouts.ts`: `export type LayoutReason = "leftover" | "preset" | "pub" | "default" | "template"`. w1 adds one pure export near `seedKeyFor`; re-read the file right before each edit and keep yours out of that spot.

## Goal

### 1. Pickers out (plan W4, "What is wrong" 1)
Remove the `variable-template-ref` declarations (`config/panel/declarations.ts:415-445`) and choices (`config/panel/choices.ts:575-578`) and their readers in `config/named.ts` (`refDefaults` branch ~225-253, `isSeedRef`, `repointedLayoutPicks` and its use in `reconcileConfigs`), `config/panel/provenance.ts:71`, `config/panel/write.ts` (`variableOptionGate` and anything writing a layout pick), `config/panel/types.ts` (the option fields that only served the picker), and `config/library.ts:519` (which builds the library's variable labels from those declarations: read the variables from the slot declarations or the variable registry instead, so the library still lists every variable's layouts). The panel must no longer offer or write a per-step layout pick. `vl-E` removes the client branch; list in your report every payload field you removed so it can.

Hold all of these while doing it:
- The run still knows, per node, which variable each key of a `variables` slot renders, **including open renders / declared bands** (`bandKeys`, `rendersAt`). `config/world.ts` uses `varDecls` for this and for pushing a resolved entry for every key ("the resolved keys are how Assemble learns which bands to render at the top level"). Give world.ts that mapping from the node's slot declarations directly (an exported helper in `declarations.ts` is fine; name it in the report).
- **Stored per-step picks are now leftover picks (⏳) and must keep working exactly as before**: still read at every layer they're stored at (session, preset, genre, instance), still dereferenced, and **never culled** by `reconcileConfigs` or any boot pass as "orphaned" because their declaration went away. Check `reconcileConfigs` and `addressedValues` carefully; write a test that a stored pick survives a reconcile.
- `config/panel/read.ts` is **not** yours. If removing the declarations leaves a dead branch there (it reads `variableTemplateRow` at ~453), leave it (it just never fires) and list it under Noticed. If something there would *break* (a type error, a runtime throw), stop and tell the supervisor.

### 2. Resolution by variable (Render item 5), replacing the per-step deref
In `config/world.ts` (`applyPipelineLayer`, ~760-1250), per variables-slot key rendering variable V:
1. **leftover pick** ⏳: any stored value at the key's address (session/preset/genre/instance layers, as now) → `reason: "leftover"`;
2. the **session's preset's variable layout**: the session's `sessions.preset_id` → `presetVariableLayoutsOf` → `[V]` → `layoutByReference`. A reference that doesn't resolve is **skipped** (falls to 3) and reported for the notice (task 4) → `reason: "preset"`;
3. the **pub's layout** (`pubLayoutOf`) → `reason: "pub"`;
4. the **package default**: a layout the pipeline author named in its declared defaults for this step, if any (today `refDefaults` resolves those by seed key/template id; keep that resolution, but feed it here rather than at the `author` layer), else `defaultVariableTemplateFor(V)` → `reason: "default"`;
5. none → the floor entry `{ variableId, engine }` (no source) → `reason: "default"`.

Tiers 2–5 replace today's `defaults`-scope floor push, so a stored pick (tier 1) still wins by scope order. Make sure tier 4 no longer arrives at the `author` scope: there it would hide tiers 2–3. The absence rule stays in `renderVariable` (`entities/variableLayouts.ts`); don't move it.

Add `reason?: LayoutReason` to `ResolvedLayouts` entries and `reason: LayoutReason | null` to `LayoutUse` / `layoutUseOf`, so what the run inspector records (`layouts` on the node output) says why. Find where assemble records `layouts` and make sure the reason travels. (`template` is set by the pre-pass the supervisor builds later; just allow it.)

Tests (`config/world` tests or a new `*.int.test.ts` beside it): all five tiers and the reason (leftover beats preset beats pub beats default beats floor); a dangling preset reference skipped to the pub's; a plugin variable with no row floors.

### 3. Laid-out values print the same in `{{x}}` and `{{{x}}}` (★6, Render item 7)
For a context template rendered by **core's Handlebars engine only**, every laid-out key's value (Assemble's own laid-out variables and the bands: what `layout()` / `bandValue` produce in `prompt/assemble.ts:751-790`; the same laying-out in `prompt/templateContext.ts` ~309 and `prompt/preview.ts` ~138) reaches the template as a `Handlebars.SafeString` **when it is a non-empty string**; an empty string stays `""` so `{{#if key}}` is still false. No other key changes escaping; Liquid already doesn't escape; a plugin engine receives plain strings exactly as now. Find how assemble reaches the Handlebars class (`prompt/renderers.ts` is **not** yours; if the only clean way is through it, stop and say so). Tests: for a laid-out key whose value contains `"`, `<`, `&`, `{{x}}` output equals `{{{x}}}` output; a non-laid-out key still escapes in `{{y}}`; an empty laid-out key keeps `{{#if}}` false; a plugin engine gets a plain string.

### 4. Dangling preset reference notice (Render item 8, second half)
Export a function (in `config/world.ts` or a small helper in the preset code; say which) that, for a preset, lists `{ variableId, reference }` entries of its variable layouts that don't resolve (`layoutByReference` null). The supervisor wires it into the preset payload with the sockets; you only need the function and a test.

## Files owned (edit only these)

- `src/lib/server/pipelines/config/world.ts`, `config/named.ts`, `config/library.ts` (the variables-labels reader only), `config/panel/{declarations,choices,provenance,write,types}.ts` + their tests
- `src/lib/server/pipelines/entities/variableLayouts.ts` (except w1's one block) + tests
- `src/lib/server/pipelines/prompt/{assemble,templateContext,preview}.ts` + tests

## Files readable

Everything. Especially `registrations/values.ts` (`registrationValueLayers`, `addressedValues`), `entities/variableTemplates.ts`, `boot/seedVariableTemplates.ts`, `prompt/renderers.ts`, `src/lib/shared/utils/contextHandlebarsHelpers.ts` (the `json` helper's SafeString note), `client/components/pipelines/inspector/receiptView.ts` (`layoutsView`: what the inspector reads), `NOMENCLATURE.md` §6 (misfit, value cascade) and §15.

## Rules your work depends on (quoted from CLAUDE.md and the lane brief)

- "**0.6 is in users' hands**: a change to stored data ships with a forward migration or boot pass and a test that a second boot changes nothing." You change no stored data. **Leftover picks must survive and render as before.**
- "Inside `db.transaction(async (tx) => …)` use only `tx`; the outer `db` deadlocks PGlite silently."
- "Never add a top-level `await` to `src/lib/server/db/index.ts`; await `dbReady`."
- "`defaults.ts` imports stay leaf; pass `db` explicitly (a `defaultDb()` dynamic import bypasses `vi.mock`)."
- "**P1**: every automatic action shows its cause and how to undo it": hence the `reason`. "**P2**: the layouts module owns its rows and every write to them": you only read layout rows.
- "**NOMENCLATURE §24**: grep every new name across `src`, the SDK and the schema first." List every new exported name in your report. Don't edit NOMENCLATURE.md, STYLE-GUIDE.md or docs/.
- "Int tests that open a DB inside an `it` need a 60 s timeout. Never pipe vitest into `head`."
- "Accounted by variable, never by key" (NOMENCLATURE §15): a layout belongs to the variable it renders; a row written for another variable than the key renders is dropped (keep `derefLayout`'s check).
- "A foreign package's layout is offered, never the default" (`isForeignPackageRow`): don't change `defaultVariableTemplateFor`'s rule.

## Out of scope

The sockets, `entities/variableTemplates.ts`, boot passes, the data upgrade (w1), the `layout` helper/filter and explicit-reference pre-pass (later, needs the SDK), client code, the SDK, docs.

## Stop and ask when

CLAUDE.md § Decisions applies; a name is new and has a near-neighbour; you need a file you don't own; removing the declarations would change what any stored data renders.

## Never

- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
- Additionally: don't run `npm run sdk:build` or `npm run db:generate` at all. Never `kill -9` anything. Never `git checkout` / `restore` / `stash` in `../serene-pub-sdk`.

## Done means

Run only targeted files: the tests you wrote, plus the existing tests of every file you touched (e.g. `config/panel/*.test.ts`, `config/panel/index.int.test.ts`, `prompt/assemble*.test.ts`, `entities/variableLayouts*.test.ts`, `config/named*.test.ts`, and the int tests that grep shows referencing `variable-template-ref` or `variableTemplateRow`; update tests that asserted the old pickers). `npx tsc --noEmit -p .` shows no errors in your files (filter to your paths).

## Report

Return it as your final message (don't write a report file): changed files, each test file run with its result, removed payload fields (for `vl-E`), the helper names, every new exported name, open questions, **Noticed, not done**.
