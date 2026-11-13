# REPORT — lane `sense-lay` — 2026-11-11

Written by the lead from the supervisor's final message.

Review rows A3, A4, A5 and the stale message in E were each confirmed against the code first. The code's resolution
order matches the numbered list in `docs/context-templates.md`: a layout a template names · a ⏳ leftover pick · the
preset's choice · the pub's layout · the author's pick for the step · the variable's default row (which may be the
automatic one) · no row.

## Built

- **A3 — Where this differs.** `src/lib/server/pipelines/config/variableLayoutsView.ts`: `variableLayoutView` returns
  `differs: VariableLayoutDifference[]` (`differencesOf`). Presets and templates come from `layoutRowUses` (no second
  rule); leftover picks from the module's own `leftoverAddresses`; author's picks from `declaredVariableLayouts`,
  only while the pub has no layout of its own. Steps are addressed by `stepKeyFor(secret, nodeKey)`; no node key in
  the payload. `isAutomaticRow` exported. The false header claim is gone.
  `src/lib/client/admin/sections/variable-layouts/VariablePage.svelte`: a **Where this differs** fieldset, absent
  when empty; `variableLayoutWords.ts` `differenceLine`. `src/lib/server/sockets/pipelinesVariableLayouts.ts` and
  `src/lib/shared/sockets/types.ts` carry it.
- **A4.** `src/lib/client/components/pipelines/StepVariableLayouts.svelte`: **Use the pub's** → **Remove this pick**.
- **A5.** `src/lib/server/pipelines/config/world.ts` (layout-reason block only) and
  `src/lib/server/pipelines/entities/variableLayouts.ts`: `LayoutReason` is now
  `leftover | preset | pub | template | authored | default | automatic | no-layout` (app-only type; no SDK build).
  `inspector/receiptView.ts`: one label per value.
- **The stale render error** in `entities/variableLayouts.ts` now points at the variable's page.
- Docs: `docs/context-templates.md`, `docs/pipelines.md`.

Scope note: `src/lib/server/pipelines/entities/variableAccounting.int.test.ts:124` changed one expectation
(`currentDate` now `"no-layout"`); the file asserts the `world.ts` reason.

## Tests

Capped scope. Client: 5 files, 121/121. Server: 3 files 45/45 (supervisor) and 8 files 114/114 (worker). Full
project `tsc`: 0 errors. `svelte-check --threshold error`: 0 errors. Fail-before shown by reading, not by running on
old code. Prettier clean on changed Svelte files and new code; older lines left alone.

## Open ★

None.

## Provisional copy 🚧

- Step button: **Remove this pick** (was **Use the pub's**, from `plans/PLAN-variable-layouts-2026-11-10.md`).
- Heading: **Where this differs**. Description: _These write this variable out with another layout than the one in use._
- Lines: _The context template ‹name› names ‹layout›._ · _‹step heading› in ‹pipeline› keeps ‹layout›, picked before
  layouts moved._ · _The ‹name› preset chooses ‹layout›._ · _‹step heading› in ‹pipeline› uses ‹layout›, the
  pipeline's choice for that step._ · a step with no heading reads _A step in ‹pipeline›…_
- Inspector: _named by the template_ · _leftover pick_ · _the preset's_ · _the pub's_ · _the pipeline's choice for
  this step_ · _the variable's default_ (was _the default_) · _automatic_ · _no layout for it_.
- Render error: "the layout selected for '‹key›' could not be rendered: ‹error›. Fix it on its variable's page in
  Admin › Variable layouts, which also says who chose it."

## Queued for other owners (handed to `sense-doc`)

- `src/lib/server/pipelines/config/leftoverPicks.ts`: two refusals people read still say "Use the pub's" (about
  lines 719 and 756); comments at 13 and 456.
- Comments and a test name: `src/lib/client/components/pipelines/leftoverPicks.svelte.ts:4`,
  `src/lib/server/sockets/pipelines.leftoverPicks.int.test.ts:5` and `:333`.
- STYLE-GUIDE §6.11 (the **Where this differs** fieldset) and §6.17 ("a tonal **Use the pub's**").
- NOMENCLATURE §15 (leftover pick row, about line 959) and §25: the new reason values (`authored`, `automatic`,
  `no-layout`; `default` narrowed), the inspector words, the heading, description and lines,
  `VariableLayoutDifference`, `differs`, `differenceLine`.

## Noticed, not done

- Dev receipts recorded before this change with `reason: "default"` now read _the variable's default_ whatever the
  real cause was (variable layouts are unshipped; dev data only).
- `variableLayoutView` walks every active pipeline's steps twice.
- A leftover difference does not say whose pick it is (genre, preset or pipeline); picks at two levels with one
  layout show as one line.
- `layoutRowUses` counts a context template naming a layout even when no step uses that template.
- `"automatic"` is tested only on a plugin-shaped row; no core pipeline reaches it.
