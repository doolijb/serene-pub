# BRIEF vl-D — Variable layouts: the server half

You are a **lane supervisor**. Read `.claude/guides/multi-agent.md` first, then the plan `plans/PLAN-variable-layouts-2026-11-10.md` in full. The plan is the contract; this brief scopes your part. Every ★ is ruled (plan header). Delegate typing to at most 2 `lane-worker`s with briefs at `plans/briefs/BRIEF-vl-D-w<n>.md` (suggested split: w1 data + render, w2 sockets); quote into each the rules below that its work depends on.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

Plan § What gets built › Data (items 1–4) and Render path (items 5–8), plus every server socket W1–W6 need. `vl-S` builds the SDK half beside you (`plans/briefs/BRIEF-vl-S.md`): the reference grammar, `templateCheck`'s `layout` support and the call-collecting parse, `TemplateSeed.slug`, `PresetDecl.variableLayouts`. **Build everything that doesn't need those first.** The parts that do (the pre-pass parse, T1 for references, reading `TemplateSeed.slug` and `PresetDecl.variableLayouts` at install) wait until the lead tells you the SDK dist is rebuilt. Until then, write against `vl-S`'s report signatures (`plans/REPORT-vl-S-2026-11-10.md`, once it exists) and keep those tests pending, not faked.

### Data

1. Two columns on `pipeline_variable_templates` (`src/lib/server/db/schema.ts:6551`): `reference` (text, nullable, unique with `variable_id`) and `pub_default` (boolean, default false, partial unique on `variable_id` where true). Storage for a **pub preset's variable layouts** (`{ [variableId]: reference }`) beside the preset's other changes (`session_presets`, schema.ts:8129): reuse an existing jsonb column if one already holds a preset's changes, else one new column in the same migration. Say which in your report.
2. **One generated migration** (`npm run db:generate`). **Before running it, stop and ask the lead**: another session (serene-pub-d9) also generates migrations, and the lead confirms with it that `schema.ts` holds no ungenerated change of theirs. Their latest is `0150`; yours must be higher than the highest applied. Never hand-write it; never seed a row at a hardcoded id.
3. **Boot pass, idempotent**: stamp `reference` on core's shipped rows (slugs per plan Data item 2), automatic rows, and plugin rows (`TemplateSeed.slug`, else the id's name segment). A person's rows stay NULL.
4. **Data upgrade** (`src/lib/server/db/dataUpgrades/`, anchored to your migration the way `0149_familiar_silk_fever.ts` is, with its `index.ts` entry): plan Data item 4, held to its invariant (**no prompt changes anywhere**). Write the exact algorithm in the file's header and your report.

### Render path

5. Resolution by variable, replacing the per-step deref (`config/world.ts:812-835`): leftover pick (⏳) → the session's preset's variable layouts → the pub's layout → package default → automatic/floor. Keep the absence rule in `renderVariable` (`entities/variableLayouts.ts:1081`). Add the **reason** to what the run inspector already records about which layout each value used (`the preset's` / `the pub's` / `the default` / `named by the template` / `leftover pick`); `vl-E` shows it.
6. **Pre-pass for explicit references** (plan Render item 6): parse with `vl-S`'s call collector, render each `{ key, reference }` through `renderVariable` in the existing laying-out loop (`prompt/assemble.ts:751-773`; also `templateContext.ts:309` and `preview.ts:138`, which lay out the same way), and register the `layout` helper (Handlebars, `src/lib/shared/utils/contextHandlebarsHelpers.ts`) and filter (Liquid, `contextLiquid.ts`) so they return the pre-rendered text. How a call finds its pre-rendered text is yours to decide; name it in the report.
7. **Laid-out values arrive marked safe** (★6): `{{x}}` prints the same as `{{{x}}}` for a laid-out key. Only laid-out keys; nothing else changes escaping.
8. **T1 covers references**: an unknown reference is refused at save and select of a context template; a stored template with one gets the existing **misfit** notice naming it; at run time the variable's in-use layout renders and the reason says so. A pub preset's or declared preset's reference that doesn't resolve is skipped (the pub's layout renders) with a notice on the path presets already use for a missing requirement.
9. Plugin install and boot: carry `TemplateSeed.slug` into `reference`; read `PresetDecl.variableLayouts` into the preset's storage for declared presets.

### Sockets (for `vl-A` and `vl-E`)

Admin-only, request/response in the existing `pipelines:` library family (follow its patterns: `requestWithInterest`, `declareInterest`, `{ library, warnings? }` write answers). Name them per NOMENCLATURE §24 and list each with its payload in your report. They must cover:

- **W1** every registered variable (including ones with no layout row, and plugin variables), each with: label, description, shelf, supplier, the layout in use and why (pub's / default / automatic / as written), count of presets that differ, count of layouts.
- **W2** one variable: description, `scope`, `sample`, and its rows, each with name, owner label, reference, a preview rendered **server-side** against the sample (plugin engines only run here), in use or not, how many context templates name it, which presets chose it (id + name). Set or clear the pub's layout.
- **W3** create / update / delete a row with name, owner slug + slug (→ reference, fixed once saved), engine, source, and *use it everywhere*. A live preview of unsaved source against the sample. The counts for the switch's sentence (pipelines and templates that would change). Delete refuses in words while the row is the pub's layout, named by a template, chosen by a preset, or held by a leftover pick.
- **W4** in the pipeline panel payload: a step's leftover picks (variable, layout name); **Use the pub's** (removes one); **Move into the template** (only when the step's context template is the pub's own copy: rewrites it to name the picked layouts explicitly, stamps references on rows that lack one, which needs an owner slug passed in, and clears the step's leftovers, in one transaction).
- **W5** for the template editor, per step and in the library: each laid-out key's in-use layout + reason and the references it offers (with names), so completion, hover, the caret line and **Layouts in this template** have their data.
- **W6** read and write a pub preset's variable layouts; declared presets' read-only; stamp a reference on an older row.

Remove the `variable-template-ref` declarations and choices (`config/panel/declarations.ts:415-445`, `choices.ts:575-578`, and their readers in `named.ts`, `provenance.ts`, `write.ts`) so the panel no longer offers per-step picks. `vl-E` removes the client branch; coordinate through your report.

## Files owned

`src/lib/server/db/schema.ts` (these columns only); `drizzle/<your migration>` + `drizzle/meta/*` it generates; `src/lib/server/db/dataUpgrades/<yours>.ts` + its `index.ts` entry + tests; `src/lib/server/pipelines/entities/{variableLayouts,variableTemplates,objectVariableLayouts}.ts` + tests; `src/lib/server/pipelines/boot/{seedVariableTemplates,registrySync}.ts` + tests; `src/lib/server/pipelines/config/{world,named,library}.ts`, `config/panel/{declarations,choices,provenance,write,types}.ts` + tests; `src/lib/server/pipelines/prompt/{assemble,templateContext,preview}.ts` + tests; `src/lib/shared/utils/{contextHandlebarsHelpers,contextLiquid}.ts` + tests; `src/lib/server/sockets/pipelines.ts` and one new socket module if the family warrants it, its registration, `src/lib/shared/sockets/types.ts` (these sockets only); the server code that stores and reads pub presets and declared presets (find it; list it in the report); `src/lib/server/plugins/install.ts` (seed slug and preset field only); the config-notice code for misfit.

## Files readable

Everything. Read before building: `../serene-pub-sdk/INTEGRATING.md` Step 2 (boot sync), Step 3 including "⚠ The seam this step actually hit", Step 7, Step 8, §1i; `NOMENCLATURE.md` §6 (misfit, value cascade), §15, §24; `docs/context-templates.md`, `docs/pipelines.md` (§ Presets).

## Rules your work depends on (quote into worker briefs)

- **0.6 is in users' hands**: a change to stored data ships with a forward migration or boot pass and **a test that a second boot changes nothing**.
- Migrations are generated; a new index must exceed the highest applied or it is silently skipped. Never seed a row at a hardcoded id. `0000`–`0093` are byte-identical forever.
- Inside `db.transaction(async (tx) => …)` use only `tx`; the outer `db` deadlocks PGlite silently.
- Never add a top-level `await` to `src/lib/server/db/index.ts`; await `dbReady`.
- `defaults.ts` imports stay leaf; pass `db` explicitly (a `defaultDb()` dynamic import bypasses `vi.mock`).
- A new column on an existing table breaks tests until `db:generate` runs.
- **Sockets**: one domain context per event family is the only listener and the only place that toasts. An event in `SCOPED_EVENTS` must carry its scope key. These are admin events, not scoped.
- **P1**: every automatic action shows its cause and how to undo it. **P2**: the layouts module owns its rows and every write to them.
- **NOMENCLATURE §24**: grep every new name (socket, column, type) across `src`, the SDK and the schema first. List new names in your report for `vl-N`, who owns `NOMENCLATURE.md`. **Do not edit NOMENCLATURE.md, STYLE-GUIDE.md or docs/.**
- Int tests that open a DB inside an `it` need a 60 s timeout. Never pipe vitest into `head`.

## Out of scope

All client code (`vl-A`, `vl-E`), the SDK (`vl-S`), docs (`vl-N`). Renaming the table or `variable template` identifiers (★1: code names unchanged).

## Stop and ask when

CLAUDE.md § Decisions applies; before `db:generate` (always); the data upgrade's invariant can't be held for some stored shape you find; a socket needs a name with a near-neighbour you can't resolve.

## Never

- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
- **Additionally, do not run `npm run sdk:build` at all**; the lead coordinates it with the other session.
- Never `kill -9` a dev server. Never `git checkout` / `restore` / `stash` in `../serene-pub-sdk`.

## Done means

Targeted tests pass, each named in the report:
- boot: references stamped; **a second boot changes nothing**;
- data upgrade: a pub with one pick on one step renders every other step byte for byte as before; a preset whose steps all picked one layout ends with a preset variable layout and no leftovers; a second run changes nothing;
- resolution order (all five tiers) and the reason;
- pre-pass: an explicit reference renders through its layout in Handlebars and Liquid; a non-literal is refused; `{{x}}` equals `{{{x}}}` for a laid-out key;
- T1: unknown reference refused at save; misfit notice on a stored one; a dangling preset reference skipped with its notice;
- each socket: an int test for its happy path and its refusals (delete in use, Move into the template on a shipped template).
- `npx tsc --noEmit -p .` clean for your files. A `scope-reviewer` run on your diff, findings answered.

Known, not yours: `npm run sdk:test` has 5 failures from before this build (deriveDontSpell on `factories/turnOrder.ts` + `shared/speakMessage.ts`; surface: `STORY_CREATE_SPEC_ID` and `CREATE_SESSION_PERSONA_*_MAX` untagged; `your-first-plugin.md` vocabulary; widget-parts guide for chronicle/messages).

## Report

`plans/REPORT-vl-D-2026-11-10.md`: changed files, tests run with results, the migration's name, the data-upgrade algorithm, every socket with its payload and refusals (`vl-A` and `vl-E` build from this), every new name for `vl-N`, open questions, **Noticed, not done**.
