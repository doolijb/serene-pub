# BRIEF — scope review of lane `perf-J`

Read-only. Follow `.claude/guides/review.md` §2 and "Rules for both": at most 5 findings, ranked, each with severity,
file:line evidence and the fix it suggests; **"no objection" is a valid answer**. Never edit.

Compare the lane's diff with its brief, `plans/briefs/BRIEF-perf-J.md` (and the worker briefs
`plans/briefs/BRIEF-perf-J-w1.md`, `BRIEF-perf-J-w2.md`, which the supervisor wrote from it). Owner rulings
2026-11-13 in `plans/PLAN-performance-2026-11-13.md` Part 3 table: **★P7** "Lazy sidebars and views; shell's existing
loading affordance." **★P15** "Curated list static in the entry + lazy per-icon import for every other declared name,
a minimal fixed-size placeholder while loading so nothing shifts. No warning."

The working tree holds many other sessions' uncommitted changes (`git diff` against HEAD shows them too). The lane's
own changes are only these:

- New: `src/lib/client/components/icons/{curatedIcons.ts,curatedIcons.test.ts,declaredIcon.svelte.ts,declaredIcon.dom.test.svelte.ts,DeclaredIconFixture.svelte,DeclaredIconPlaceholder.svelte,lucideIconModules.ts,lucideIconModules.test.ts}`
  (`KoboldCppIcon.svelte` / `OllamaIcon.svelte` in that folder pre-exist and are not the lane's).
- `src/lib/client/sessionLayout/sessionLayoutModel.svelte.ts`, `editorMembership.svelte.ts`,
  `src/lib/client/components/surfaces/Panel.svelte`, `SurfaceGrid.svelte`,
  `src/lib/client/components/sessionPage/pressRouting.svelte.ts`: the icon import and the `declaredIconOf` lines.
- `src/lib/client/components/Layout.svelte`: the `LoadingState` import, the removed sidebar/view static imports, the
  `{#snippet sidebarView}` chain's `{#await import()}` branches and the new `{#snippet viewLoadFailed()}`. **Not**
  the `HANDLED_ERROR_EVENTS` entries (other sessions' work).
- `src/routes/+layout.svelte`: the `HelpSidebar` import → `{#await}` in the `startupError && isDocsRoute` branch and
  the `LoadingState` import (the `X` named import is perf-F's earlier work).
- `src/lib/client/components/CustomThemeManager.svelte`: `CustomThemeEditor` mount.
- `src/lib/client/components/pipelines/SchemaForm.svelte`: `CodeField` mount; `schemaFormObject.dom.test.ts`: one
  `json field` case.
- `STYLE-GUIDE.md` §7: one added sentence. `NOMENCLATURE.md`: the last bullet (lane perf-J), appended.

Check: files outside the brief's **Files owned** (note the brief allows "the lazy-loading wrappers for the
editors/fields where they are mounted"); new names not in that §25 bullet; new settings, flags, abstractions, events
or copy nobody asked for (the `{:catch}` blocks reuse `AdminView.svelte`'s existing load-failed sentence — judge
whether that is reuse or new copy); fixes beyond the brief; any change to which icon a site draws (P1); any warning
or console output for an unknown icon name. Also check the deviations the supervisor made on purpose and judge them
against the brief: (1) no single "lazy icon component taking a name" — a resolver function `declaredIconOf` returns a
component value instead (the brief said "the lazy component is what is passed"); (2) only the `SchemaForm`
`CodeField` mount and the `CustomThemeEditor` mount were wrapped, not the other ten `CodeField` mounts and three
TipTap mounts (the supervisor's reason: they leave the entry with their now-lazy views, and wrapping them reaches
~18 dom test files including another session's live `entryEarmark` test); (3) `vite.config.ts` untouched.

Report in your final message: findings or "no objection".
