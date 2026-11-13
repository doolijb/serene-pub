# BRIEF vl-F-w2 — Variable layouts fix-ups, client half

You are a `lane-worker` for lane vl-F (supervisor). Repo: `/home/jody/github/serene-pub`. Use absolute paths.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Context

- `plans/REPORT-vl-A-2026-11-10.md` (§ Requests) and `plans/REPORT-vl-E-2026-11-10.md` (§ Server/SDK requests, § Queued) — the requests you close.
- The shared socket types are ALREADY edited (supervisor). Read them with `grep -n` in `src/lib/shared/sockets/types.ts`:
  - `Sockets.Pipelines.VariableLayouts.ForTemplate.Echo` `{ nodeType?, specSlug?, nodeKey? }`; `ForTemplate.Response extends Echo` (`keys?`, `error?`); `ForTemplate.Refusal extends Echo` (`error`). The server echoes the asked target on the answer AND the `:error`.
  - `LeftoverPicks.Response` and `LeftoverPicks.Refusal` both carry `slug?`, `sessionId?`, `presetId?` (echoed as sent; `ClearLeftoverPick.Response` / `MoveLeftoversIntoTemplate.Response` extend it). `MoveLeftoversIntoTemplate.Refusal` adds `code?: "needs-owner-slug"` (`MoveLeftoversIntoTemplate.RefusalCode`).
  - `PresetVariableLayouts.Response.candidates?: string[]` — the variables the preset's pipelines render.
  - `VariableLayouts.ListRow.key: string | null` — the template key the variable renders under (first scope root); null when it declares none.
- A parallel worker builds the server half at the same time; you do not touch `src/lib/server/**`.

## Goal (items 8–15)

8. `src/lib/client/components/Layout.svelte` `HANDLED_ERROR_EVENTS` (~133; the `pipelines:` group ~279–297): add `pipelines:libraryVariables:error`, `pipelines:libraryVariable:error`, `pipelines:librarySetPubLayout:error`, `pipelines:libraryUseEverywhereCounts:error`, `pipelines:presetVariableLayouts:error`, `pipelines:setPresetVariableLayout:error`, `pipelines:stampVariableTemplateReference:error`, `pipelines:libraryDeleteTemplate:error` (`pipelines:templateVariableLayouts:error` is already there — don't duplicate). Before quieting each, confirm every view that sends the event shows its refusal itself (e.g. `routes/pipelines/library/+page.svelte` `onRefusal`, `components/admin/TemplateChangelist.svelte`, the variable-layouts views). If one doesn't, don't add that one; report it.
9. `src/lib/client/sockets/typedSocket.ts` `SocketEventMap` (near ~2907): add `pipelines:libraryVariables`, `pipelines:libraryVariable`, `pipelines:librarySetPubLayout`, `pipelines:libraryUseEverywhereCounts`, `pipelines:presetVariableLayouts`, `pipelines:setPresetVariableLayout`, `pipelines:stampVariableTemplateReference`, each with its `:error` (`params: never`, `response: { error?: string }` like its neighbours). Check none is already listed. Retype the existing `:error`s of `pipelines:templateVariableLayouts` (→ `ForTemplate.Refusal`), `pipelines:leftoverPicks` and `pipelines:clearLeftoverPick` (→ `LeftoverPicks.Refusal`), `pipelines:moveLeftoversIntoTemplate` (→ `MoveLeftoversIntoTemplate.Refusal`). Then `src/lib/client/admin/sections/variable-layouts/variableLayoutsSockets.ts`: with the map complete its casts serve nothing — replace its callers' uses with the registry and socket directly (`requestWithInterest`, `useInterest` from `$lib/client/sockets/interest.svelte`, `useTypedSocket().emit`, `awaitReply` from `$lib/client/utils/awaitReply`) and delete the file. The callers are `variable-layouts/Page.svelte`, `VariablePage.svelte`, `VariableLayoutForm.svelte`, `session-presets/PresetVariableLayouts.svelte`: change only their imports and call sites, nothing else in those files beyond what items 10 and 14 ask.
10. Match answers by the echoes:
    - `src/lib/client/components/pipelines/templateVariableLayouts.svelte.ts`: drop the one-in-flight FIFO queue, `ANSWER_TIMEOUT_MS` and the ⏳ comment. Each request listens for the answer and the `:error` and takes only the one whose echo maps to its own key (`keyOf` built from the echo: `nodeType` → type key; `specSlug` + `nodeKey` → step key), then releases both. Requests for different targets run at once; a target already in flight is not asked twice. Keep the exported API (`requestTemplateVariableLayouts`, `templateVariableLayoutsOf`, `_resetTemplateVariableLayoutsForTests`, `TemplateLayoutsTarget`). Update the module doc.
    - `src/lib/client/components/pipelines/leftoverPicks.svelte.ts`: every answer and `:error` handler first checks the echo is this view's (`res.slug === opts.slug()` and `res.sessionId === opts.sessionId()`; the view sends no `presetId`, so one echoed means another view's). Within the view, a press's answer still settles the oldest pending press (the server does not echo the step). `needsOwner` becomes `res.code === "needs-owner-slug"`; delete the `NO_REFERENCE` regex and its ⏳ comment. Update the module doc.
    - `src/lib/client/admin/sections/variable-layouts/Page.svelte` ~55–100: the `?step=` narrowing uses the shared store (`requestTemplateVariableLayouts({ specSlug, nodeKey })` + `templateVariableLayoutsOf(...)`) instead of its own `requestWithInterest` and its own `:error` listener, so W1 and the pipeline panel can't take each other's answers. Behaviour (narrowing, *could not be found* line, Show all) stays as it is.
11. Wire W5 in the library editors (vl-E queued 1): `src/routes/pipelines/library/+page.svelte` ~1005 (the `TemplateEditor` — context templates only, i.e. `tab === "templates"`; a variable layout's editor gets nothing) and `src/lib/client/components/admin/TemplateChangeForm.svelte` ~473 (its context-template path): call `requestTemplateVariableLayouts({ nodeType })` (the template's pool / node type — find what the page already uses for `scopeFor`/`poolId`) when the editor shows, and pass `variableLayouts={templateVariableLayoutsOf({ nodeType })?.keys}` to `TemplateEditor`. Look at how `components/pipelines/PipelineConfigOptions.svelte` does it for a step and copy that shape.
12. `src/lib/shared/utils/templateCheckOptions.ts`: add `layout` to `CONTEXT_HANDLEBARS_HELPERS` and to `CONTEXT_LIQUID_FILTERS`. ⚠ The file is a run-time leaf ("imports nothing at run time"): write the literal `"layout"`, never a run-time import of `VARIABLE_LAYOUT_HELPER` from `@serene-pub/sdk` (a type-only check is fine). ⚠ Both renderers read these lists (`src/lib/shared/utils/contextHandlebarsHelpers.ts`, `contextLiquid.ts` — not your files): read how; if adding `layout` would register or refuse it twice, or break their tests, STOP and report instead of changing those files. Then `templateCheckOptions.test.ts` drops its `+ VARIABLE_LAYOUT_HELPER` from the comparison and asserts the listed `"layout"` equals `VARIABLE_LAYOUT_HELPER`.
13. `src/lib/client/components/pipelines/StepVariableLayouts.svelte` ~96–110: the label **Owner name** becomes **Owner slug** (placeholder `acme` stays). Validate it with `ownerSlugProblem` from `src/lib/client/admin/sections/variable-layouts/variableLayoutWords.ts` (it uses `OWNER_SLUG` from `components/pipelines/workspace/canvas/draft.svelte.ts` and refuses `core` — the same rule and words as W3). A problem shows in words under the field (the `text-error-600-400 text-xs` line shape already used in this file, tied to the input with `aria-describedby`) and the press does not send. Don't show the problem before the person has typed or pressed.
14. `src/lib/client/admin/sections/session-presets/PresetVariableLayouts.svelte` ~219: **Change a variable's layout** offers only the preset's `candidates` (from the `pipelines:presetVariableLayouts` / `setPresetVariableLayout` answer) that have a layout (`layoutCount > 0`), grouped by shelf as now. Until the view has answered, offer nothing. `variable-layouts/Page.svelte` ~219: the Variable cell's mono line shows `r.key` instead of `r.variableId` (fall back to `r.variableId` when `key` is null); keep `variableId` in `searchText` and add `key` to it.
15. `src/lib/shared/adminLogbook.ts` ~78: the `"variable-template"` object type is labelled **variable layout** and links to `/admin/variable-layouts/…`. The record's id is either a layout row id (digits) or a variable id (when the pub went back to its default). A variable id → the variable's page (`/admin/variable-layouts/<encodeURIComponent(id)>`). A row id: the logbook doesn't know the row's variable, so link the old address `/admin/variable-templates/<id>`, which the router already redirects to that row's W3 form (`LegacyIdRedirect.svelte`); say so in a comment. Null id → `/admin/variable-layouts`. Keep `adminLogbook.ts` a leaf (it is shared; import nothing from `client/`). Update any test of it (`ls src/lib/shared/adminLogbook*`).

## Files owned (edit only these)

`src/lib/client/components/Layout.svelte` (item 8 only), `src/lib/client/sockets/typedSocket.ts` (item 9 only), `src/lib/client/admin/sections/variable-layouts/{variableLayoutsSockets.ts (delete), Page.svelte, VariablePage.svelte, VariableLayoutForm.svelte}`, `src/lib/client/components/pipelines/{templateVariableLayouts.svelte.ts, leftoverPicks.svelte.ts, StepVariableLayouts.svelte}`, `src/routes/pipelines/library/+page.svelte` (item 11 only), `src/lib/client/components/admin/TemplateChangeForm.svelte` (item 11 only), `src/lib/shared/utils/templateCheckOptions.ts`, `src/lib/client/admin/sections/session-presets/PresetVariableLayouts.svelte`, `src/lib/shared/adminLogbook.ts`, and the tests of these (existing: `components/pipelines/templateVariableLayouts.test.ts`, `components/pipelines/stepVariableLayouts.dom.test.ts`, `admin/sections/variable-layouts/*.test.*`, `admin/sections/session-presets/presetVariableLayouts.dom.test.svelte.ts`, `shared/utils/templateCheckOptions.test.ts`, any `adminLogbook` test).

Not yours: `src/lib/server/**`, `src/lib/shared/sockets/types.ts` (done; if a type is wrong, report it), NOMENCLATURE.md, STYLE-GUIDE.md, docs/, the SDK, any other file.

## Rules (quoted from CLAUDE.md, STYLE-GUIDE and the lane brief)

- "Sockets: one domain context per event family is the only listener, and the only place that toasts; views register listeners for local state and never call `toaster`." No new `notify`/`toaster` calls. Listen through the interest registry (`useInterest`, `declareInterest`, `requestWithInterest`), never a raw `socket.on`.
- "`socket.off(event)` with no handler removes every listener app-wide; always pass the handler."
- "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`."
- "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`."
- STYLE-GUIDE §10: "Sentence case everywhere." "Labels are nouns, hints are sentences … errors say what went wrong and what to do." Every control has a name, a focus ring and a 44px target on touch (`pointer-coarse:min-h-11`, as the file already does).
- New names: only the agreed ones (`candidates`, `key`, `code`/`needs-owner-slug`). Add no exported name, prop, setting or abstraction beyond what an item asks; list any you had to add.
- "Never pipe vitest into `head`; keep DOM tests small." A failing assert on a happy-dom element has OOM-killed VS Code: keep each DOM test narrow.
- Do what was asked, at the size asked. Anything else you notice goes under **Noticed, not done**, never fixed in passing.

## Tests (Done means)

- `templateVariableLayouts.test.ts`: two requests for different targets in flight at once (one `nodeType`, one `specSlug`+`nodeKey`), answers delivered in reverse order → each target gets its own keys; an `:error` echoing one target lands only on it; a second request for a target in flight sends nothing.
- A leftover-picks test (add to `stepVariableLayouts.dom.test.ts` or a small new `leftoverPicks.svelte.test.ts` — whichever fits how the store can be driven): an answer/error echoing another `sessionId` or `slug` is ignored; an error with `code: "needs-owner-slug"` sets `needsOwner`, one without doesn't.
- `stepVariableLayouts.dom.test.ts`: the field is labelled **Owner slug**; `core` and a malformed slug show the words and send nothing; a good one sends.
- W1: the Variable cell shows the key in mono (add to `variableLayoutsPage.dom.test.svelte.ts`). W6: the picker offers only candidates (add to `presetVariableLayouts.dom.test.svelte.ts`).
- `templateCheckOptions.test.ts` passes; also run `src/lib/shared/utils/contextHandlebarsHelpers.test.ts` and any `contextLiquid` test to prove the renderers are unharmed.
- `adminLogbook`: the two id shapes link as described.

Run only: `npx vitest run src/lib/client/admin/sections/variable-layouts/ src/lib/client/admin/sections/session-presets/ src/lib/client/components/pipelines/stepVariableLayouts.dom.test.ts src/lib/client/components/pipelines/templateVariableLayouts.test.ts src/lib/client/components/templates/ src/lib/shared/utils/templateCheckOptions.test.ts src/lib/shared/utils/contextHandlebarsHelpers.test.ts` plus any new test file and the adminLogbook / contextLiquid tests you find. Then `npx tsc --noEmit -p .` (server errors from the parallel worker may appear; report only yours).

## Never

- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
- Additionally: do not run `npm run sdk:build`, `npm test`, `npm run check`, or any dev server.

## Stop and ask (in your report) when

An item needs a file not listed above, a new name/setting not listed, or a renderer change (item 12); or a view that sends one of item 8's events doesn't show its refusal.

## Report

Return as your final message: changed files (with what changed), the exact test commands with pass/fail counts, any name you added, item-8 events you left out and why, Noticed-not-done.
