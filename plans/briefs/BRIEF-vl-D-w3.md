# BRIEF vl-D-w3: Variable layouts sockets, part 1 (W1, W2, W3 preview and counts, W5)

You are a `lane-worker` under supervisor `vl-D`. The repo is `/home/jody/github/serene-pub` (the SDK is at `/home/jody/github/serene-pub-sdk` and is read-only for you). Use absolute paths.

Before starting, read `plans/PLAN-variable-layouts-2026-11-10.md` § "The rule this plan applies" and § The workflows W1, W2, W3 and W5. The plan is the contract; this brief is your slice. A sibling worker, `w4`, builds W4 and W6 and the library-write extensions in `sockets/pipelines.ts` at the same time. Stay out of that file.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## What exists (built earlier in this lane)

**Migration 0151.**
- `pipeline_variable_templates.reference` is the 🚧 **layout reference** `<owner>/<slug>@<major>`. It is unique per variable and fixed once set.
- `pipeline_variable_templates.pub_default` is the 🚧 **pub's layout**, at most one per variable.
- `session_presets.variable_layouts` is a json map `{ [variableId]: reference }`.

**`entities/variableTemplates.ts`.** Import from it, don't edit it. Read its exports:
- `VariableTemplateRecord` with `reference` and `pubDefault`
- `listVariableTemplates`
- `pubLayoutOf`
- `layoutByReference`
- `presetVariableLayoutsOf`
- `setPubLayout(db, variableId, templateId | null)`
- `createVariableTemplate` with `reference?: { ownerSlug, slug }` and `useEverywhere?`
- `updateVariableTemplate` with `reference?`
- `stampReference`
- `deleteVariableTemplate`, which refuses in words while the row is the pub's layout, chosen by a preset, or held by a leftover pick
- `formatLayoutReference`, `parseLayoutReference`, `layoutSlugOf`

**`boot/seedVariableTemplates.ts`.**
- `defaultVariableTemplateFor(db, variableId)` gives the **package default**.
- `isForeignPackageRow`: a foreign package's row is offered but never the default.

**`config/world.ts`.** It resolves each variable for a run as:

leftover pick (`reason: "leftover"`) → session's preset's variable layout (`"preset"`) → pub's layout (`"pub"`) → package default (`"default"`) → floor.

- `danglingPresetLayouts(db, presetId)` lists preset references that don't resolve.
- `config/panel/declarations.ts` exports `declarationsAndVariableKeys(db, specVersionId)`, which returns `{ decls, variableKeys: VariableKey[] }`. A `VariableKey` is `{ nodeKey, slot, path, variableId, band?, engines }`, one entry per key a step's `variables` slot renders. Use it for "which steps render V".

**Elsewhere.**
- `entities/variableLayouts.ts`: `LayoutReason`, `renderVariable`, `shippedByVariable`, `SHIPPED_VARIABLE_TEMPLATES`.
- The variable registry: `getVariable(variableId)` gives a variable's `scope`, `sample`, `description`, `i18n`, shelf and owner. Find where *Variables available here* gets its shelves; the client tree uses the same data.

**SDK.** The SDK lane finished (`plans/REPORT-vl-S-2026-11-10.md`, read its "Signatures" section) and **its dist is rebuilt**, so you may import its new exports: `variableLayoutCalls(engine, src) → { key, reference }[]` from `@serene-pub/sdk/template-check`; `parseVariableLayoutReference`, `formatVariableLayoutReference`, `laidOutScope`, `variableLayoutOffersFor`, `VARIABLE_LAYOUT_HELPER` from `@serene-pub/sdk`. Another rebuild (core-catalog/contracts only) may happen while you work: if a test fails with a dist read error, retry once before investigating. Use `variableLayoutCalls` for "how many context templates name it" (W2) and for the explicit/bare split in W3's template count,. Leave a ⏳ only where something genuinely still waits.

## Goal: admin-only request/response events in the existing `pipelines:` family

Follow that family's library patterns exactly:
- the admin gate (`libraryGate` / the `pipelines:library` handler in `sockets/pipelines.ts`);
- `emitToUser("<event>", res)` on success and `"<event>:error"` on refusal, with `{ error }` in words;
- the client's `requestWithInterest` pairing: list every success event in `src/lib/shared/sockets/interest.ts` beside `pipelines:library*`, and keep `server/sockets/pipelines.interestGate.test.ts` (or its sibling for your module) green;
- types in `src/lib/shared/sockets/types.ts` under `Sockets.Pipelines`, in your own `namespace` blocks.

These are admin events, not scoped, so they don't go in `SCOPED_EVENTS`.

Put the handlers in **one new module**, `src/lib/server/sockets/pipelinesVariableLayouts.ts`, with a `registerPipelinesVariableLayoutsHandlers` registered in `src/lib/server/sockets/index.ts` the way `registerPipelineHandlers` is. Put the reading logic in a server module beside the entities, `src/lib/server/pipelines/config/variableLayoutsView.ts`, so the sockets stay thin. That way the logic can be unit-tested and the sockets get an int test each.

### Names

Name every event per NOMENCLATURE §24. Code identifiers keep `variable template` / `variableTemplate` where they name rows (ruling ★1: code names unchanged). Events about *variables* say `Variable`. Proposed names, which you may refine if a grep finds a near-neighbour (say so):

| Event | Purpose |
|---|---|
| `pipelines:libraryVariables` | W1 |
| `pipelines:libraryVariable` | W2 |
| `pipelines:librarySetPubLayout` | W2 |
| `pipelines:libraryPreviewVariableTemplate` | W3 live preview |
| `pipelines:libraryUseEverywhereCounts` | W3 sentence |
| `pipelines:templateVariableLayouts` | W5 |

Grep each across `src`, the SDK and the schema first.

### W1: every registered variable
Include variables with **no layout row** (a plugin's plain-text variable reads *As written*) and plugin variables. For each:
- id
- label
- description
- shelf, the same shelves as *Variables available here*
- supplier (Serene Pub, or the plugin's name)
- the layout in use: id, name, reference, and why. Why is one of:
  - `pub`: a pub's layout is set;
  - `default`: the package default row;
  - `automatic`: the automatic object row;
  - `as-written`: no row at all.
- how many presets differ: presets whose `variable_layouts` names a different resolvable reference for it
- how many layouts it has

### W2: one variable
Return:
- description, `scope`, `sample`, supplier, the package default's id and name
- whether the pub's choice differs from the default, for the *Chosen for this pub. Back to the default* line

And its rows, each with:
- id, name
- owner label: Serene Pub, the plugin's name, or *This pub*
- reference, engine, `isImmutable`
- whether it is editable: a person's own row only
- a **preview rendered server-side** through `renderVariable` against the variable's `sample`. Plugin engines only run here. An engine error becomes a `previewError` string, never a thrown handler.
- `inUse`: it is the pub's layout, or the package default when no pub's layout is set
- how many context templates name it: scan every context template with `variableLayoutCalls` (engine-aware) and count those naming this row's reference for a key that renders this variable
- which presets chose it: id and name

Set or clear the pub's layout goes through `setPubLayout`. It answers with the refreshed W2 view and `warnings?`, mirroring `libraryAnswer`'s `{ library, warnings? }` shape.

### W3 extras
w4 extends the library create/update/delete writes in `sockets/pipelines.ts`.

You build two things:
- **Live preview** of unsaved `{ variableId, engine, source }` against the sample. Reuse the existing `pipelines:previewTemplate` variable path if it already renders against the declared sample server-side; then say so and skip the new event.
- **The counts for the *Use it everywhere* sentence**: for a variable, how many pipelines would change and how many context templates would change.
  - Pipelines: count steps rendering V via `variableKeys`, by distinct pipeline, minus steps where a leftover pick holds the address.
  - Templates: context templates that read V's key bare somewhere (a read of the key that is not inside a `layout` call). Use the template check's report of names read plus `variableLayoutCalls` to tell bare reads from explicit ones; say exactly how you counted.

### W5: for the template editor
For the library (by node type, no step in view) and per step (spec slug + node key), give each laid-out key:
- its variable
- its in-use layout and reason, using the same resolution as the run with no session in view: pub's → default → floor
- the references it offers: every non-withdrawn row of that variable with a reference, as `{ reference, label }`, the shape the SDK's `variableLayoutOffers` takes

Rows without a reference are not offered.

### Retire the picker tests
`src/lib/server/pipelines/entities/variableTemplates.int.test.ts` has 14 tests built on the removed per-step picker:
- `layoutOptions`
- `option.variableTemplate`
- `variableOptionGate`
- "points the shipped config at one"
- "offers only layouts for this option's own variable"
- "mutation gate"

Delete the cases that only tested the picker. Rewrite any that tested a rule that still holds (selection by variable, delete refusals, shipped rows immutable) against the entity functions directly. List which cases you deleted and which you rewrote.

## Files owned (edit only these)

- `src/lib/server/sockets/pipelinesVariableLayouts.ts` (new) + its int test(s)
- `src/lib/server/pipelines/config/variableLayoutsView.ts` (new) + tests
- `src/lib/server/sockets/index.ts`: one import and one register line only
- `src/lib/shared/sockets/types.ts`: your own new namespaces only. w4 edits other blocks; re-read before every edit.
- `src/lib/shared/sockets/interest.ts`: your events in the `pipelines:` list only. w4 adds there too; re-read before every edit.
- `src/lib/server/pipelines/entities/variableTemplates.int.test.ts`

## Files readable

Everything. Read at least:
- `sockets/pipelines.ts`: library handlers ~1580–1700, the preview path ~1520–1580, registration at the end
- `config/library.ts`
- `config/world.ts`
- `entities/variableTemplates.ts`
- `entities/objectVariableLayouts.ts`
- `NOMENCLATURE.md` §15 and §24
- an existing socket int test for the pattern, e.g. one in `src/lib/server/sockets/*.int.test.ts` that drives a handler with a fake socket

## Rules your work depends on (quoted from CLAUDE.md and the lane brief)

- "**Sockets:** one domain context per event family (provided by both shells) is the only listener, and the only place that toasts; views register listeners for local state and never call `toaster`. An event in `SCOPED_EVENTS` must carry its scope key." These are admin events, not scoped.
- "Inside `db.transaction(async (tx) => …)` use only `tx`; the outer `db` deadlocks PGlite silently."
- "`defaults.ts` imports stay leaf; pass `db` explicitly (a `defaultDb()` dynamic import bypasses `vi.mock`)."
- "**P1**: every automatic action shows its cause and how to undo it. **P2**: the layouts module owns its rows and every write to them." Every write goes through `entities/variableTemplates.ts`; never write the table from a socket.
- "**NOMENCLATURE §24**: grep every new name (socket, column, type) across `src`, the SDK and the schema first." List every new name in your report. Don't edit `NOMENCLATURE.md`, `STYLE-GUIDE.md` or `docs/`.
- User-facing strings say **variable layout**, never bare *layout*. *Variable*, not *section*.
- "Members never see or touch model plumbing." Every event here refuses a non-admin.
- "Int tests that open a DB inside an `it` need a 60 s timeout. Never pipe vitest into `head`."

## Out of scope

- `sockets/pipelines.ts`, presets, leftover picks (all w4)
- the entity, world, panel and prompt files
- client code, the SDK, docs

## Stop and ask when

- CLAUDE.md § Decisions applies.
- A socket name has a near-neighbour you can't resolve.
- You need a file you don't own, or an entity function that doesn't exist. Describe the function's signature; don't write it.

## Never

- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
- Additionally: don't run `npm run sdk:build` or `npm run db:generate` at all. Never `kill -9` anything. Never `git checkout` / `restore` / `stash` in `../serene-pub-sdk`.

## Done means

- An int test per event covering its happy path and its refusals: non-admin, unknown variable, setting the pub's layout to another variable's row.
- `variableTemplates.int.test.ts` green.
- `pipelines.interestGate.test.ts` (and `index.interestGate.test.ts` if it checks registration) green.
- `npx tsc --noEmit -p .` shows no errors in your files. Filter to your paths.

## Report

Return it as your final message; don't write a report file. Include:
- changed files
- each test file run, with its result
- **every event with its full params and response shape and its refusals.** `vl-A` and `vl-E` build the UI from this.
- every new name
- the ⏳ spots
- open questions
- **Noticed, not done**
