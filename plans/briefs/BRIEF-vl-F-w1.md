# BRIEF vl-F-w1 — Variable layouts fix-ups, server half

You are a `lane-worker` for lane vl-F (supervisor). Repo: `/home/jody/github/serene-pub`. Use absolute paths.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Context (read these sections only, by range)

- `plans/REPORT-vl-D-2026-11-10.md` § Sockets (the events as built).
- The shared socket types are ALREADY edited by the supervisor (do not re-edit unless a type is wrong; if it is, say so in your report):
  `src/lib/shared/sockets/types.ts` — `Sockets.Pipelines.VariableLayouts.ForTemplate.{Echo,Response,Refusal}`, `LeftoverPicks.{Response,Refusal}` (both extend `View` = `{ sessionId?, presetId? }`), `MoveLeftoversIntoTemplate.{RefusalCode,Refusal}`, `PresetVariableLayouts.Response.candidates?: string[]`, `VariableLayouts.ListRow.key: string | null`. The dead `ConfigOption.variableTemplate?` field is already removed. `grep -n` these names to read them.

## Goal (items 1–7)

1. `pipelines:templateVariableLayouts` (`src/lib/server/sockets/pipelinesVariableLayouts.ts`) echoes the asked target on the answer AND on its `:error` (every path: not-admin, bad params, thrown refusal). Echo what was sent: `nodeType` when the params carry a non-empty string `nodeType`, else `specSlug` + `nodeKey` (each when a string). Answer shape: `{ ...echo, keys }`; error `{ ...echo, error }`. The other four events in that file stay as they are (the `answer` helper may grow an optional echo argument).
2. `pipelines:moveLeftoversIntoTemplate:error` carries `code: "needs-owner-slug"` beside the words when the refusal is "a picked layout has no reference yet, send an `ownerSlug`" (`src/lib/server/pipelines/config/leftoverPicks.ts` ~686). Carry the code on the refusal object (e.g. an optional `code` on `LeftoverPickRefusal`, typed `Sockets.Pipelines.MoveLeftoversIntoTemplate.RefusalCode`), and have the socket put it on the `:error` payload. Also change that refusal's words from "your owner name, for example 'acme'" to "your owner slug, for example 'acme'" (the field is being relabelled **Owner slug**). No other refusal gets a code.
3. `pipelines:leftoverPicks`, `pipelines:clearLeftoverPick` and `pipelines:moveLeftoversIntoTemplate` (`src/lib/server/sockets/pipelines.ts` ~1885–2002) echo the asker's `slug`, `sessionId` and `presetId` (each only when it was sent) on every answer AND every `:error`, including the admin-gate refusal.
4. `pipelines:presetVariableLayouts` (and `pipelines:setPresetVariableLayout`, which answers the same view) returns `candidates: variableId[]` — the variables this preset's pipelines render: the preset's effective registrations (the preset's own rows over its genre's — find the existing helper the preset editor already uses, e.g. in `src/lib/server/sessions/presetEditor.ts` `presetEditorView`, don't write a second resolver) → their pipeline slugs → the variables those pipelines' active versions render (`renderingSteps` in `src/lib/server/pipelines/config/variableLayoutsView.ts` already walks `(specSlug, nodeKey, slot, path, variableId)`; export a small helper from that file rather than duplicating the walk). Distinct, sorted by variable id (stable). Built in `presetVariableLayoutsView` (`sessions/presetEditor.ts` ~425).
5. `variableLayoutsList` (`variableLayoutsView.ts` ~284) sets `key` on each row: `rootOf(decl) ?? null` (the existing `rootOf`, ~125). Update the `VariableLayoutListRow` interface there.
6. `referenceOf` (`src/lib/server/pipelines/entities/variableTemplates.ts` ~309) refuses the owner slug `core` for a **person's** row, in words, as `VariableTemplateNotUsableError` — same idea as the client's sentence: *"core is Serene Pub's own. Use an owner slug of your own."* Check every caller first (~369 create, ~489 `stampReference`, ~576 update) and the boot seeding (`boot/seedVariableTemplates.ts`, `stampReferenceIfFree`, plugin sync): a shipped or package row that legitimately gets `core/…` must still pass. If the function cannot tell a person's row from a shipped one, pass that in from the callers (a person's create = no `seedKey`, not `isImmutable`; `stampReference`/update act on an existing row you can read). Say in your report exactly where the refusal applies.
7. Remove the dead `variableTemplateRow` and the writes of `variableTemplate` in `src/lib/server/pipelines/config/panel/read.ts` (~452, ~584) — the type field is gone, so `tsc` will point at them. Remove only what becomes dead.

## Files owned (edit only these)

`src/lib/server/sockets/pipelinesVariableLayouts.ts`, `src/lib/server/sockets/pipelines.ts` (the three leftover handlers and the shared helpers they use only), `src/lib/server/sockets/presetEditor.ts` (only if the preset-layouts handlers live there), `src/lib/server/pipelines/config/variableLayoutsView.ts`, `src/lib/server/pipelines/config/leftoverPicks.ts`, `src/lib/server/sessions/presetEditor.ts`, `src/lib/server/pipelines/entities/variableTemplates.ts` (`referenceOf` and its callers' arguments only), `src/lib/server/pipelines/config/panel/read.ts` (item 7 only), and the tests of these: `src/lib/server/sockets/pipelinesVariableLayouts.int.test.ts`, `src/lib/server/sockets/pipelines.leftoverPicks.int.test.ts`, `src/lib/server/sockets/presetEditor.variableLayouts.int.test.ts`, `src/lib/server/pipelines/entities/variableTemplates.writes.int.test.ts` (find them with `ls`; add cases to these files rather than new files where they fit).

Not yours: anything under `src/lib/client/`, `src/routes/`, `src/lib/shared/` (types already done), NOMENCLATURE.md, STYLE-GUIDE.md, docs/, the SDK.

## Rules (quoted from CLAUDE.md and the lane brief)

- "Sockets: one domain context per event family is the only listener and the only place that toasts … An event in `SCOPED_EVENTS` must carry its scope key (these admin events are not scoped)." Do not add these events to `SCOPED_EVENTS`.
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." "Pass `db` explicitly in tests." "Int tests opening a DB inside an `it` need 60 s."
- New names: the field `code` and value `needs-owner-slug`, `candidates`, `key` are the agreed names. Introduce no other new exported name except one small helper in `variableLayoutsView.ts` for item 4 — list it in your report.
- "Never pipe vitest into `head`" (SIGPIPE leaks PGlite temp dirs).
- Do what was asked, at the size asked. Anything else you notice goes under **Noticed, not done**, never fixed in passing.

## Tests (Done means)

Add assertions for each item:
- 1: answer and `:error` (not-admin, bad params, unknown target) echo the target, both shapes.
- 2: the owner-slug refusal carries `code: "needs-owner-slug"`; another refusal carries no `code`.
- 3: answers and errors of the three events echo `slug`/`sessionId`/`presetId`.
- 4: `candidates` lists exactly the variables the preset's pipelines render (a variable rendered only by a pipeline the preset doesn't register is absent).
- 5: `key` on a list row equals the variable's first scope root.
- 6: create, stamp and update with owner `core` on a person's row refused in words; seeding/second boot still pass (run `src/lib/server/pipelines/boot/layoutReferences.int.test.ts`).
- 7: `npx tsc --noEmit -p .` shows nothing in your files.

Run only: `npx vitest run <each test file above> src/lib/server/pipelines/boot/layoutReferences.int.test.ts src/lib/server/pipelines/config/variableResolution.int.test.ts` and any existing test of `panel/read.ts` (`ls src/lib/server/pipelines/config/panel/`). Then `npx tsc --noEmit -p .` (client errors from the parallel client worker may appear; report only yours). Note which `/tmp/serene-pub-vitest-*` dirs your runs created (`ls -dt /tmp/serene-pub-vitest-* | head` before and after — that `head` is on `ls`, fine) and delete only those, by name.

## Never

- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
- Additionally: do not run `npm run sdk:build`, `npm test`, or any dev server.

## Stop and ask (in your report) when

An item needs a file not listed above, a new setting/table/migration, or a name not listed; or a caller of `referenceOf` cannot be told apart safely.

## Report

Return as your final message: changed files (with what changed), the exact test commands and pass/fail counts, the helper name(s) added, where the `core` refusal applies, Noticed-not-done.
