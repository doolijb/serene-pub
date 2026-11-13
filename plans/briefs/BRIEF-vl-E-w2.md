# BRIEF vl-E-w2 — W4 in the pipeline panel, the per-step picker removed, the run inspector's reasons

You are a `lane-worker` for lane `vl-E` (supervisor: the vl-E lane supervisor). Repo: `/home/jody/github/serene-pub`. Use absolute paths. Read this whole brief before editing.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Background

Variable layouts moved from per-step pickers to one choice per variable for the whole pub (plan `plans/PLAN-variable-layouts-2026-11-10.md` § W4). The server (lane vl-D, done) removed the `variable-template-ref` option and the events `pipelines:cloneVariableTemplate`, `:updateVariableTemplate`, `:deleteVariableTemplate`. Stored per-step picks the upgrade couldn't fold away remain as ⏳ **leftover picks**. New server events (admin-only, unscoped, answered on the same event name; refusals on `<event>:error` as `{ error }` in words; types in `src/lib/shared/sockets/types.ts`):

- `pipelines:leftoverPicks` `Sockets.Pipelines.LeftoverPicks.Params` `{ slug, sessionId?, presetId? }` → `LeftoverPicks.Response` `{ slug?, steps?: [{ nodeKey, slot, contextTemplate: {id,name}|null, canMoveIntoTemplate, picks: [{ nodeKey, slot, key, variableId, variableLabel, templateId, layoutName, scope }] }], error? }`
- `pipelines:clearLeftoverPick` `ClearLeftoverPick.Params` `{ slug, scope, nodeKey, slot, key, sessionId?, presetId? }` → the fresh `LeftoverPicks.Response`
- `pipelines:moveLeftoversIntoTemplate` `MoveLeftoversIntoTemplate.Params` `{ slug, nodeKey, slot, ownerSlug?, sessionId?, presetId? }` → `LeftoverPicks.Response` + `{ templateId?, templateName?, moved?: [{key, reference, reads}], kept?: [{key, why}], stamped? }`. It refuses in words; one refusal is "‘‹layout›’ has no reference yet, and a template names a layout by its reference. Say whose name to file it under (your owner name, for example 'acme') and it will be given one." — the only way to tell that refusal apart is its text (match `has no reference yet`). It does NOT re-send `pipelines:get`.
- `pipelines:templateVariableLayouts` `Sockets.Pipelines.VariableLayouts.ForTemplate.Params` `{ specSlug, nodeKey }` (or `{ nodeType }`) → `ForTemplate.Response` `{ keys?: TemplateKey[], error? }`. **Its answer does not echo the target**, so a page with several template editors can't tell answers apart unless only one request is in flight at a time.

None of these events is in the client's typed socket map yet (`src/lib/client/sockets/typedSocket.ts` `SocketEventMap`), and they are already in the interest list (`src/lib/shared/sockets/interest.ts`).

## Files owned (edit only these, only the parts named)

- `src/lib/client/components/pipelines/PipelineConfigOptions.svelte` — the layout branch and the W4 row only (plus the imports/state/listeners they need).
- `src/lib/client/components/Layout.svelte` — lines ~287–290 only (the three `pipelines:*VariableTemplate:error` entries in the catch-all's quiet list).
- `src/lib/client/sockets/typedSocket.ts` — the three loose ⏳ entries (~2907–2939) only, replaced by the entries listed below in the same place.
- `src/lib/shared/sockets/types.ts` — the one doc comment above `variableTemplate?:` (~10275–10284) only.
- `src/lib/client/components/pipelines/inspector/receiptView.ts`, `receiptView.test.ts`, `RunInspector.svelte` — the layouts part only.
- New: `src/lib/client/components/pipelines/StepVariableLayouts.svelte`, `src/lib/client/components/pipelines/leftoverPicks.svelte.ts`, `src/lib/client/components/pipelines/templateVariableLayouts.svelte.ts`, and dom/unit tests beside them (e.g. `stepVariableLayouts.dom.test.ts`, `templateVariableLayouts.test.ts`).

Readable: everything. Harness to copy for a panel dom test: `src/lib/client/components/pipelines/loadoutRow.dom.test.ts` (fake socket + `setSocket` + `setInterestUser`) and `settingsGroups.fixture.ts` (`option(...)`). Interest API: `src/lib/client/sockets/interest.svelte.ts` (`useInterest`, `declareInterest`, `requestWithInterest`).

Another worker is editing `TemplateEditor.svelte`, `ScopeTree.svelte` and `src/lib/shared/utils/template*` at the same time. Do not touch them. Another lane (vl-A) may be adding its own entries to `typedSocket.ts` and `Layout.svelte` right now: **re-read the region immediately before each edit, edit by exact unique string, and if an entry you are told to add already exists, don't add a duplicate** (say so in your report).

## Goal

### 1. Remove the per-step picker (client)

In `PipelineConfigOptions.svelte`: the `/* --- layout clone / edit / delete --- */` functions (`cloneLayout`, `layoutDraftOf`, `layoutSource`, `layoutName`, `startLayoutDraft`, `editLayout`, `layoutDirty`, `saveLayout`, `deleteLayout`, ~615–703), the `layoutDrafts` state and its doc, `cloningLayoutFor`, `onLayoutCloned` and its comment (~869–884), the `useInterest` calls for `pipelines:cloneVariableTemplate` and the three `*VariableTemplate:error` events (~945–1001), and the whole `{:else if option.control === "variable-template-ref"}` branch (~1847–1975). Fix comments that now mention layouts as a sibling sub-editor (e.g. the `templateDrafts` doc says "folded into `layoutDrafts`"; the prompt-mutation doc says "Exactly the move the layout mutations made") so they don't point at removed code — keep such edits to the words that name the removed code.

The paragraph under the template editor (~1810–1820) says layouts are "set per variable below" and "a double brace escapes the fences a layout writes"; both are now false (layouts aren't per step; laid-out values print the same in `{{ }}` and `{{{ }}}`). Cut it to: `Message blocks, placement and loops. Read variables with {{{x}}}.` (keep the existing `<code>` markup for `{{{x}}}`). Nothing else changes in that branch except the W4 row below.

`typedSocket.ts`: delete the three ⏳ entries and their `:error` siblings (6 keys, ~2907–2939) and in their place add, typed from `Sockets.Pipelines.*` (no loose `Record<string, unknown>`):
`"pipelines:templateVariableLayouts"` (`VariableLayouts.ForTemplate.Params` / `.Response`), `"pipelines:leftoverPicks"` (`LeftoverPicks.Params` / `.Response`), `"pipelines:clearLeftoverPick"` (`ClearLeftoverPick.Params` / `.Response`), `"pipelines:moveLeftoversIntoTemplate"` (`MoveLeftoversIntoTemplate.Params` / `.Response`), each with its `":error"` (`params: never`, `response: { error?: string }`), following the file's existing pattern.

`Layout.svelte` ~287–290: replace the three `"pipelines:*VariableTemplate:error"` entries with `"pipelines:templateVariableLayouts:error"`, `"pipelines:leftoverPicks:error"`, `"pipelines:clearLeftoverPick:error"`, `"pipelines:moveLeftoversIntoTemplate:error"`, with a one-line comment: the pipeline panel and the template editor say these in place (variable layouts, W4/W5). Without this the catch-all toasts each refusal a second time.

`types.ts`: rewrite only the doc comment above `variableTemplate?:` (~10275) to say it is ⏳ unused: the per-step layout picker was retired with variable layouts (2026-11-10), no client reads it, and it goes with the server's dead `variableTemplateRow` (`config/panel/read.ts`). Do not remove the field (the server still writes it).

### 2. W4 in the panel

**a. `templateVariableLayouts.svelte.ts`** (module store, used by the panel now and by other template editors later):
```ts
export type TemplateLayoutsTarget = Sockets.Pipelines.VariableLayouts.ForTemplate.Params
export function requestTemplateVariableLayouts(target: TemplateLayoutsTarget): void
export function templateVariableLayoutsOf(target: TemplateLayoutsTarget): { keys?: Sockets.Pipelines.VariableLayouts.TemplateKey[]; error?: string } | undefined
```
A `SvelteMap` keyed by a stable string of the target. **One request in flight at a time**, a FIFO queue behind it (dedupe a target already queued or in flight); the next answer (or `:error`) belongs to the request in flight. Use `requestWithInterest` for the answer and `declareInterest` for `:error`; release both when the answer arrives; drop the in-flight request after 15 s with no answer and move on. An answer with nothing in flight is ignored. Unit-test it with the fake socket (two targets requested back to back → each gets its own answer, in order; an `:error` lands on the one in flight; a stray answer is ignored).

**b. `leftoverPicks.svelte.ts`**: `useLeftoverPicks(opts: { slug: () => string; sessionId: () => number | undefined; enabled: () => boolean; onMoved?: () => void })`, called during the panel's initialisation. It declares `useInterest` for `pipelines:leftoverPicks`, `pipelines:clearLeftoverPick`, `pipelines:moveLeftoversIntoTemplate` and their three `:error`s (bare keys, as the panel's other listeners — these events aren't scoped); takes an answer only when `res.slug === slug()`; takes an `:error` only while this panel has an action pending (and attributes it to that step). Exposes: `steps` (reactive), `refresh()` (emits `pipelines:leftoverPicks` `{ slug, sessionId }`; no-op when not `enabled()`), `clear(step, pick)` (emits `clearLeftoverPick` with the pick's `scope`, `nodeKey`, `slot`, `key`), `move(step, ownerSlug?)` (emits `moveLeftoversIntoTemplate` with the step's `nodeKey`, `slot`), and per step (keyed `nodeKey + slot`): `refusal?: string`, `needsOwner: boolean` (the refusal matched `has no reference yet`), `kept: { key, why }[]` from the last successful move, `busy: boolean`. After a successful move it calls `onMoved()`. It never toasts.

**c. `StepVariableLayouts.svelte`** (the W4 row; STYLE-GUIDE §6.17's provenance-line shape: 12px, muted). Props: `href: string`, `steps` (the leftover steps attached to this option), per-step state, `onclear`, `onmove`, and `templateUnsaved: boolean`. Renders, in order:
- One line in `text-surface-600-400 text-xs`: `Each variable is written out by its variable layout, shared by every pipeline.` then a link `Change layouts` (`<a class="underline" href={href}>`, the panel's existing link style).
- For each attached step, for each pick, one read-only line: `‹variableLabel› uses ‹layoutName› here (set before layouts moved).` with a `btn btn-sm preset-tonal-surface` **Use the pub's** button beside it.
- When `canMoveIntoTemplate`, one **Move into the template** button (`btn btn-sm preset-tonal-surface`) for the step. If `templateUnsaved` is true, pressing it does not send; it shows `Save or cancel your changes to the template first.` (role="alert") — Move rewrites the stored template, so an open draft would otherwise overwrite it on Save.
- A refusal: one `role="alert"` line in `text-error-600-400 text-xs`, the server's words. When `needsOwner`, under it: a labelled text input **Owner name** (placeholder `acme`) and the **Move into the template** button again, which sends with that `ownerSlug`.
- After a move with `kept` entries: one `role="status"` line per entry, the server's `why`.
- `busy` disables nothing; it only prevents a double send.

**d. The panel.** Call `useLeftoverPicks({ slug: () => slug, sessionId: () => sessionId, enabled: () => isAdmin, onMoved: () => socket.emit("pipelines:get", { slug, sessionId }) })`. Refresh it on mount and in `onGet` after a fresh view for this panel lands. In the `{:else if option.control === "context-template-ref"}` branch, right after the picker row's closing `</div>` and before `{#if option.contextTemplate && editors}`, when `isAdmin`: `<StepVariableLayouts href="/admin/variable-layouts?step={encodeURIComponent(`${slug}:${option.step.key}`)}" ... />`. Attach leftover steps to template options like the server does: a step whose `nodeKey` equals the option's `option.step.key` (first such template option only); and a step whose `nodeKey` has no context-template option of its own goes to the pipeline's only context-template option when there is exactly one (the context builder's picks show under the respond step's template). Compute the context-template options from the whole view (`optionsOf(detail.groups)`), not the `stepKey`-filtered one. `templateUnsaved` = `templateDirty(option)`.

Also, for each context-template option with a `contextTemplate` row, when `isAdmin`, call `requestTemplateVariableLayouts({ specSlug: slug, nodeKey: option.step.key })` from an `$effect` keyed on the joined list of those targets (so it doesn't re-run on every keystroke), and pass `variableLayouts={templateVariableLayoutsOf({ specSlug: slug, nodeKey: option.step.key })?.keys}` to the panel's `<TemplateEditor>`. The other worker is adding that `variableLayouts` prop to `TemplateEditor`; until they land, tsc reports it as unknown — expected; list it, don't work around it. When the entry has an `error`, show it under the editor as one `text-surface-600-400 text-xs` line: the server's words.

### 3. The run inspector

`receiptView.ts` `layoutsView`: each recorded use may now carry `reason` (`"leftover" | "preset" | "pub" | "default" | "template"` or null) and `missingReference` (string). `LayoutLine` gains `why: string | null` — the reason in words: `leftover` → `leftover pick`, `preset` → `the preset's`, `pub` → `the pub's`, `default` → `the default`, `template` → `named by the template`, else null — and `missingReference: string | null`. When `missingReference` is set, `line` becomes `named ‹ref›, which wasn't found; used ‹layout name, or "built-in default" with none›`. Keys can now repeat (one line per `layout` call), so `RunInspector.svelte`'s `{#each layoutLines as l (l.key)}` must key by index. Render `why` after `line` in `text-surface-600-400` (e.g. `· the pub's`). Update `receiptView.test.ts` (the `layoutsView (2026-10-13)` describe) for the new fields and add cases for each reason and for `missingReference`.

## Rules your work depends on (quoted from the lane brief and CLAUDE.md)

- **Sockets:** one domain context per event family is the only listener and the only place that toasts; views register listeners for local state and **never call `toaster`**. `socket.off(event)` without a handler removes every listener app-wide: always pass the handler. (Listen only through the interest registry; the typed socket has no `on`/`off`.)
- "An event in `SCOPED_EVENTS` must carry its scope key in the payload, or `emitToUser` silently sends nothing." (None of these is scoped: use bare keys, as the panel's comment explains.)
- "`$state(new Set())` / `new Map()` is not reactive on mutation: use `SvelteSet` / `SvelteMap`. Untrack reads of state an effect-called method writes." (The `$effect` that requests layouts must not read state the request writes; use `untrack` where needed.)
- "Browser code runs on plain-http LAN addresses and phones: **no `crypto.randomUUID`, no `navigator.clipboard`**."
- "A refusal is shown in words where it applies. A read-only value is words, never a disabled control."
- "Members never see or touch model plumbing." The W4 row, its requests and the layout fetch are admin-only (`isAdmin`).
- STYLE-GUIDE §9: real buttons with accessible names, never an interactive inside an interactive, nothing hover-only, 44px targets on touch. §10: sentence case; a button says what happens.
- Use exactly the UI words in this brief. Any other word a user sees: don't invent it — list it in your report.
- "Heavy DOM tests: never pipe vitest into `head`; keep CodeMirror DOM tests small (a failing happy-dom assert has OOM-killed VS Code)." In the panel dom test, give the context-template option **no** `contextTemplate` row, so no CodeMirror editor mounts. Assert on strings/booleans you pulled out, never `expect(element)` on a happy-dom node.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. **Additionally: do not run `npm run sdk:build` at all, and do not start any dev server.**
- Do not edit server or SDK files, and nothing outside "Files owned".

## Done means

Tests (each with `npx vitest run <file>` from the repo root; never pipe into `head`):
- A panel dom test (e.g. `src/lib/client/components/pipelines/stepVariableLayouts.dom.test.ts`, harness from `loadoutRow.dom.test.ts`): a view with a `context-template-ref` option and a stray `variable-template-ref` option renders no layout picker (no "Duplicate this layout" control, no layout select); an admin sees `Each variable is written out by its variable layout, shared by every pipeline.` and **Change layouts** with `href="/admin/variable-layouts?step=<encoded slug:nodeKey>"`; on mount the panel emits `pipelines:leftoverPicks`; dispatching an answer with a pick shows `Characters uses JSON here (set before layouts moved).` with **Use the pub's** (click → emits `pipelines:clearLeftoverPick` with the pick's scope/nodeKey/slot/key) and **Move into the template** (click → emits `pipelines:moveLeftoversIntoTemplate`); dispatching a `:error` with the `has no reference yet` text after a move shows the words and an **Owner name** input, and sending again carries `ownerSlug`; an answer with `kept` shows its `why`; a builder step's pick (nodeKey with no template option of its own) shows under the only template option; a non-admin sees none of it and nothing is requested.
- `templateVariableLayouts` store unit test as above.
- `receiptView.test.ts` passes, with the new cases.
- The existing panel dom tests still pass: `loadoutRow.dom.test.ts`, `settingsGroups.dom.test.ts`.
- `npx tsc --noEmit -p .`: no errors in your files except the expected unknown `variableLayouts` prop until the other worker lands (list everything else).
- `npx prettier --check` on every file you touched.

## Report

Return in your final message: files changed; each test file run with pass/fail counts; the exact UI strings you added; anything you couldn't do or decided yourself (and whether another lane had already added a `typedSocket.ts`/`Layout.svelte` entry); anything noticed but not done.
