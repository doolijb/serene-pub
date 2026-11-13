# BRIEF vl-D-w1 — Variable layouts: data (references, pub's layout, boot pass, data upgrade)

You are a `lane-worker` under supervisor `vl-D`. Repo: `/home/jody/github/serene-pub` (SDK at `/home/jody/github/serene-pub-sdk`, read only for you). Use absolute paths. Read `plans/PLAN-variable-layouts-2026-11-10.md` § "The rule this plan applies", § Data (items 1–4) and § Names before starting. The plan is the contract; this brief is your slice.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Already done (by the supervisor, don't redo)

- Migration `drizzle/0151_shallow_marvel_zombies.sql` (generated): `pipeline_variable_templates.reference text NULL` (unique with `variable_id`), `pipeline_variable_templates.pub_default boolean NOT NULL DEFAULT false` (partial unique on `variable_id` where true), `session_presets.variable_layouts json NOT NULL DEFAULT '{}'` (`{ [variableId]: reference }`). Schema: `src/lib/server/db/schema.ts` (`pipelineVariableTemplates.reference/pubDefault`, `sessionPresets.variableLayouts`). **Do not touch schema.ts or drizzle/.**
- `src/lib/server/pipelines/entities/variableTemplates.ts`: `VariableTemplateRecord` gained `reference` and `pubDefault`; new read functions `pubLayoutOf(db, variableId)`, `layoutByReference(db, variableId, reference)`, `presetVariableLayoutsOf(db, presetId)`. Keep their signatures (worker w2 codes against them).
- `src/lib/server/pipelines/entities/variableLayouts.ts`: `type LayoutReason = "leftover" | "preset" | "pub" | "default" | "template"`. (w2 owns the rest of that file; you may add ONE pure export to it — see task 2.)

## Goal

### 1. Reference helpers (local, provisional)
The SDK lane (`vl-S`) is writing the canonical parser/formatter for **layout reference** `<owner>/<slug>@<major>` (owner in plugin-slug grammar or `core`, slug kebab-case, major a positive integer, always present). Its dist is not built yet, so write a small local pair in `variableTemplates.ts`: `formatLayoutReference({ owner, slug, major })` and `parseLayoutReference(ref) → { owner, slug, major } | null`, plus `layoutSlugOf(name)` (kebab-case: lower-case, runs of non-`[a-z0-9]` → `-`, trimmed). Mark each with a `// ⏳ replaced by the SDK's once vl-S's dist is built` comment. Keep them tiny; the supervisor swaps them later.

### 2. Boot pass: stamp references, idempotent
Stamp `reference` **only where it is NULL**; never rewrite one (fixed once set). A person's rows (no seed key, no owner plugin) stay NULL.
- **Core's shipped rows** (`seedVariableTemplates.ts`: `SHIPPED_VARIABLE_TEMPLATES`, the catalogue's `SHIPPED_SPEECH_VARIABLE_LAYOUTS`): `core/<layoutSlugOf(code name)>@<variable major>`. Use the **code name** (`t.name`), never the stored name (it can carry a "(Built-in)" suffix). This yields `titled-json`, `json`, `titled`, `as-written`, `sentence`, `numeric`, `lines`, and `bracket-tag` for the speech catalogue's `Bracket tag` (accepted by the lead).
- **Automatic rows** (`objectVariableLayouts.ts`, `coreObjectLayouts()` for core; the plugin ones wherever they are projected, probably `boot/registrySync.ts`): `<owner>/json@<variable major>`, owner = the owner segment of the row's template id.
- **Plugin rows** (projected in `boot/registrySync.ts`; find exactly where): `<plugin owner>/<slug>@<major from the id>`, slug = the seed's `slug` (SDK `TemplateSeed.slug`, **not in the built SDK yet**) else the id's name segment (`acme:template/omens-prose@1` → `omens-prose`). Write the "else" path now; leave a clearly marked `// ⏳ TemplateSeed.slug once vl-S's dist is built` where the seed's slug will be read, and a **pending** test (`it.todo`) for it.
- Put the pure mapping for core rows in ONE exported pure function the data upgrade can import too (no schema, no db): e.g. `coreLayoutReferenceFor(seedKey): string | null` in `variableLayouts.ts` (pure module, imports no schema) or `objectVariableLayouts.ts`. Name it in your report.
- **Collision**: if the reference is already held by another row of the same variable, leave this row NULL and `console.warn` once naming both. Deterministic order (by id). Never let the unique index crash the boot.
- Tests: references stamped on a booted test DB (core shipped, core automatic, a plugin row if a fixture exists); **a second boot changes nothing** (compare full row sets).

### 3. Write side in `variableTemplates.ts` (sockets build on these; keep names plain and say them in your report)
- `setPubLayout(db, variableId, templateId | null)`: in one transaction (use only `tx`), clear `pub_default` on the variable's rows, then set it on the given row (must belong to that variable and not be withdrawn; refuse in words otherwise). `null` = back to the package default.
- Create/update take an optional `reference` input built from `{ ownerSlug, slug }` + major (`1` for a new row unless the variable's major says otherwise — use the variable's major from its id). Refuse a malformed or taken reference in words. **Fixed once saved**: update refuses changing a non-null reference. Create takes `useEverywhere?: boolean` → `setPubLayout` in the same transaction.
- `stampReference(db, templateId, ownerSlug)` for an older row that has none (slug from its name, refusing a collision in words).
- `deleteVariableTemplate`: add refusals, in words, while the row is **the pub's layout**, **chosen by a preset** (any `session_presets.variable_layouts` value equal to its reference for its variable; name the presets), or **held by a leftover pick** (the existing registration-value reference scan already finds stored picks: keep it). "Named by a context template" needs the SDK's call collector: leave a marked `// ⏳` and an `it.todo`.
- `variableSlotNames` reads `declarations()` for `control === "variable-template-ref"`. Worker w2 is **removing those declarations** in parallel. Change `variableSlotNames` to read the slot names from the node registry's slot declarations of `kind === "variables"` directly (`pipeline_definition_registry.slots` for every active spec's nodes, the way `config/panel/declarations.ts` `declarations()` reads them), so it no longer depends on the panel's controls.

### 4. Data upgrade `src/lib/server/db/dataUpgrades/0151_shallow_marvel_zombies.ts` + its `index.ts` entry (`afterMigration: "0151_shallow_marvel_zombies"`)
Read `dataUpgrades/index.ts` top comment and `0149_familiar_silk_fever.ts` first: runs once, inside the migration transaction, **raw SQL through `tx` only**, never on a fresh install, no app modules whose queries drift (pure constants like `variableLayouts.ts`'s are fine).

**The invariant (plan): no prompt changes, anywhere.** For every preset and every step it runs, the layout each variable renders through after is the one it rendered through before.

Structure: **loader** (raw SQL → a plain snapshot) → **pure planner** (snapshot → actions) → **applier** (raw SQL). The planner is a pure, exported function; unit-test it heavily.

Stored per-step picks: `registrations.values[nodeKey][<variables slot>][key] = <pipeline_variable_templates.id>` on rows with `scope_kind` `genre` or `preset` (also `session` rows and `pipeline_specs.instance_values`, which may hold older ones). Read `src/lib/server/pipelines/registrations/{values,rows,resolve}.ts` for how a preset's/genre's rows apply to a pipeline (base keys, registering rows, `dropped`). The variable a step's key renders: the node's registry slot of kind `variables`, `renders[key]` (see `declarations()` in `config/panel/declarations.ts` for how a spec's `renders` and open renders / `bandKeys` fold in).

Algorithm (write it, exactly as you implement it, in the file's header and your report):
1. **Snapshot**: layout rows (id, variable_id, seed_key, template_id, owner_plugin_id, withdrawn_at); active specs' steps rendering each variable V `(spec, nodeKey, key) → V`; registrations rows; presets (id, genre_id, seed_key, owner_plugin_id, is_immutable, variable_layouts); instance values; existing `pub_default` rows.
2. **Package default** `D(V)`: the same rule as `defaultVariableTemplateFor` (`boot/seedVariableTemplates.ts`), by seed key, written in SQL.
3. **Contexts**: each genre with no preset (its registered pipelines' steps), each preset (its genre's registered pipelines plus its own registering rows; **over-including a pipeline is safe, missing one is not**), and pipelines nothing registers (instance values then `D`).
4. **Resolution** in a context at step s for V: preset pick → genre pick → instance pick → preset's variable layout → pub's layout → `D(V)`. (Session picks sit above everything before and after; leave them untouched and out of the decision.) "Before" is this resolution on the current state, so a second run sees the first run's results.
5. **Unpromotable V** (no change at all to V's picks): a pick at an address that isn't in the static universe (open renders, a key the spec re-pointed), conflicting picks for one address within one scope, a pipeline-author-named layout for V in the active version's declared values (`pipeline_preset_values`), or anything else you can't model with certainty. **When unsure, leave it alone.**
6. **Pub level**, per promotable V with no pub's layout yet: if every genre-level context's every step rendering V resolves to the same row X and X ≠ D(V), mark X `pub_default`.
7. **Preset level**, per preset P and promotable V, only for presets an admin owns (`seed_key`, `owner_plugin_id` NULL and not immutable) and only if P has no variable layout for V yet: if every step P runs that renders V resolves to the same row X: if X ≠ (pub's layout ?? D(V)) **and X is a core shipped row** (its reference comes from task 2's pure function, since the boot pass hasn't run yet; lead-accepted rule), set `variable_layouts[V] = reference(X)`.
8. **Remove a pick only if every context that reads it resolves identically without it** (given the state so far). Apply this to the promoted picks and then as a sweep over every remaining genre/preset pick, in a fixed order (registration row id, node key, key), until nothing more can go. Note that a genre pick outranks a preset's variable layout, so a preset keeps its own pick on a step where a different genre pick sits below it.
9. **Verify before applying**: recompute every context/step resolution after the actions; any difference ⇒ drop all actions for that V and log. Then apply (remove the picks from `values`, dropping emptied objects; set `pub_default`; write `variable_layouts`). Log a one-line summary like 0149's.

Tests (`0151_shallow_marvel_zombies.test.ts` for the planner, `.int.test.ts` for loader+applier on a booted DB; follow `0149_familiar_silk_fever.int.test.ts`):
- a pub with **one pick on one step** renders every other step as before (planner: no pub promotion, pick kept as leftover or removed only if redundant; every resolution unchanged);
- a preset whose steps **all picked one core layout** ends with a preset variable layout and **no leftovers**;
- every genre step picked the same non-default row → pub's layout, picks gone;
- a pick equal to what resolves anyway is removed; one that matters is kept;
- **a second run changes nothing**;
- planner property: for random small snapshots, every resolution before == after.

## Files owned (edit only these)

- `src/lib/server/pipelines/entities/variableTemplates.ts` (+ tests)
- `src/lib/server/pipelines/entities/objectVariableLayouts.ts` (+ tests)
- `src/lib/server/pipelines/boot/seedVariableTemplates.ts`, `src/lib/server/pipelines/boot/registrySync.ts` (the plugin variable-row projection only) (+ tests)
- `src/lib/server/pipelines/entities/variableLayouts.ts`: **only** the one pure reference export from task 2 (w2 edits this file too: keep your edit a single added block near `seedKeyFor`; re-read the file right before editing)
- `src/lib/server/db/dataUpgrades/0151_shallow_marvel_zombies.ts`, its tests, and its one entry in `src/lib/server/db/dataUpgrades/index.ts`

## Files readable

Everything. Especially `config/world.ts:760-1250` (how layouts resolve today), `config/panel/declarations.ts` (`declarations()`), `registrations/*`, `config/named.ts` (`refDefaults`, `reconcileConfigs`), `NOMENCLATURE.md` §15 and §24.

## Rules your work depends on (quoted from CLAUDE.md and the lane brief)

- "**0.6 is in users' hands**: a change to stored data ships with a forward migration or boot pass and **a test that a second boot changes nothing**."
- "Migrations are **generated** (`db:generate`). A new migration's index must exceed the highest applied or it is *silently skipped*. Never seed a row at a hardcoded id."
- "Inside `db.transaction(async (tx) => …)` use only `tx`; the outer `db` deadlocks PGlite silently."
- "Never add a top-level `await` to `src/lib/server/db/index.ts`; await `dbReady`."
- "`defaults.ts` imports stay leaf; pass `db` explicitly (a `defaultDb()` dynamic import bypasses `vi.mock`)."
- "**P1**: every automatic action shows its cause and how to undo it. **P2**: the layouts module owns its rows and every write to them." The registrations module owns registration rows: inside the data upgrade raw SQL is the doctrine; outside it, write registration values only through its existing functions.
- "**NOMENCLATURE §24**: grep every new name (socket, column, type) across `src`, the SDK and the schema first." List every new exported name in your report. Don't edit NOMENCLATURE.md, STYLE-GUIDE.md or docs/.
- "Int tests that open a DB inside an `it` need a 60 s timeout. Never pipe vitest into `head`."
- Code identifiers keep `variable template` (★1); user-facing strings say **variable layout**, never bare *layout*.

## Out of scope

`config/world.ts`, `config/named.ts`, `config/panel/*`, `prompt/*`, sockets, client code, the SDK, docs. If you find you need a change there, stop and say so in your report.

## Stop and ask when

CLAUDE.md § Decisions applies; a name is new and has a near-neighbour; the invariant can't be held for some stored shape you find (describe the shape); a test needs a file you don't own.

## Never

- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
- Additionally: don't run `npm run sdk:build` or `npm run db:generate` at all. Never `kill -9` anything. Never `git checkout` / `restore` / `stash` in `../serene-pub-sdk`.

## Done means

Run only your targeted files: `npx vitest run <files>` for each test you wrote or touched (seedVariableTemplates, variableTemplates, the 0151 tests, registrySync's if you changed it). `npx tsc --noEmit -p .` shows no errors in your files (filter the output to your paths; other lanes' errors aren't yours).

## Report

Return it as your final message (don't write a report file): changed files, each test file run with its result, the reference function's name, every new exported name, the data upgrade's exact algorithm, the ⏳ pending spots, open questions, **Noticed, not done**.
