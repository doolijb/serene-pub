# BRIEF vl-E-w1 — W5: variable layouts in the context template editor

You are a `lane-worker` for lane `vl-E` (supervisor: the vl-E lane supervisor). Repo: `/home/jody/github/serene-pub`. Use absolute paths. Read this whole brief before editing.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Background (what exists already; do not change it)

A context template can now name a **variable layout** in place: Handlebars `{{{layout characters "core/json@1"}}}`, Liquid `{{ characters | layout: "core/json@1" }}`. The reference format is `<owner>/<slug>@<major>`. The SDK (`@serene-pub/sdk`, already built) gives:

```ts
// @serene-pub/sdk
laidOutScope(scope: TemplateScope, renders: Readonly<Record<string, string>>): TemplateScope
  // renders = key → variable id; marks those root keys `laidOutBy`
variableLayoutOffersFor(scope, key, offers: TemplateCheckOptions['variableLayoutOffers']): readonly VariableLayoutOffer[]  // { reference, label }
parseVariableLayoutReference(value: unknown): { owner; slug; major } | null
VARIABLE_LAYOUT_HELPER // 'layout'
// @serene-pub/sdk/template-check
checkTemplateSourceReport(engine, src, laidOutScope(scope, renders), { ...CONTEXT_TEMPLATE_CHECK, variableLayoutOffers: { [variableId]: [{ reference, label }] } })
```
Finding kinds `layout-argument` (bad call shape, or the key isn't laid out — `name`/`path` = the key, may carry `suggestion`) and `unknown-layout` (`name`/`path` = the reference; the span `[start, end)` is inside the quotes; may carry `suggestion`). With no offers, a well-formed reference passes silently.

The server (`pipelines:templateVariableLayouts`) answers, per template, a list of
```ts
Sockets.Pipelines.VariableLayouts.TemplateKey = {
  key: string; variableId: string; variableLabel: string
  inUse: { id: number; name: string; reference: string | null; reason: "pub" | "default" | "automatic" } | null
  offers: { reference: string; label: string }[]
}
```
(the global `Sockets` namespace is ambient; see `src/lib/shared/sockets/types.ts` ~12087). You do NOT fetch it: another worker writes the fetch and passes it to `TemplateEditor` as a prop (below). The server's save check uses `laidOutScope(scope, { [key]: variableId for each TemplateKey })` and `variableLayoutOffers: { [variableId]: offers }`; **the editor must use exactly that**, so the editor and the save never disagree.

## Files owned (edit only these)

- `src/lib/shared/utils/templateAssist.ts` + `templateAssist.test.ts`, `templateCompletions.test.ts`
- `src/lib/shared/utils/templateDiagnostics.ts` + a new `templateDiagnostics.test.ts` if you need one
- `src/lib/shared/utils/templateCheckOptions.test.ts` (NOT `templateCheckOptions.ts`)
- `src/lib/client/components/codeField/templateAssistBridge.ts` + `templateAssistBridge.test.ts`
- `src/lib/client/components/templates/TemplateEditor.svelte`, `ScopeTree.svelte`
- New files beside them: `src/lib/client/components/templates/templateLayoutRewrite.ts` + `templateLayoutRewrite.test.ts`, `src/lib/client/components/templates/TemplateLayoutsList.svelte`, and a dom test `src/lib/client/components/templates/templateEditorLayouts.dom.test.svelte.ts`

Readable: everything. Model the dom test on `src/lib/client/components/templates/templateEditorField.dom.test.svelte.ts` (it builds a real reply-step scope with `templateScopeReport`).

## Goal

### 1. Pure layer

**a. `templateLayoutRewrite.ts` (new).** Pure functions, both engines (`CORE_TEMPLATE_ENGINE` / `CORE_LIQUID_ENGINE` from `$lib/shared/pipelines/templateEngines`):

```ts
export interface LaidOutOccurrence {
  key: string
  start: number; end: number   // the whole tag, braces included
  reference: string | null     // null = a bare read; else the call's reference
}
export function laidOutOccurrences(engine: string, source: string, keys: readonly string[]): LaidOutOccurrence[] // source order
export function occurrenceAt(engine: string, source: string, caret: number, keys: readonly string[]): LaidOutOccurrence | null // start <= caret <= end
export function writeOccurrence(engine: string, source: string, o: LaidOutOccurrence, reference: string | null): string // the replacement text for [o.start, o.end)
export function rewriteChanges(engine: string, source: string, keys: readonly string[], choose: (o: LaidOutOccurrence) => string | null | undefined): { from: number; to: number; insert: string }[] // undefined = leave that occurrence; skip no-op changes
export function bareOffer(offers: readonly { reference: string; label: string }[]): { reference: string; label: string } | undefined   // slug `json` or `as-written`
export function titledOffer(offers: readonly { reference: string; label: string }[]): { reference: string; label: string } | undefined // slug `titled-json` or `titled`
```
Recognised occurrences — and only these; everything else (`{{#if characters}}`, `{{#each characters}}`, `characters.name`, a call inside a subexpression, a Liquid call with more filters, an escaped `\{{…}}`) is left alone:
- Handlebars bare read: `{{{characters}}}` and `{{characters}}` (not preceded by `{` or `\`, not followed by `}`), with optional `~` whitespace control and inner spaces. This mirrors the server's `nameLayoutAtBareReads` (`src/lib/server/pipelines/config/leftoverPicks.ts`, read it) so Move-into-the-template and the editor agree.
- Handlebars call: `{{{layout characters "ref"}}}` or `{{layout characters "ref"}}`, either quote, optional `~`.
- Liquid bare read `{{ characters }}` and call `{{ characters | layout: "ref" }}`, optional `-`.
`writeOccurrence` keeps the occurrence's own whitespace control. With a reference: Handlebars always writes triple braces, `{{{layout characters "ref"}}}` (with `~` kept: `{{{~layout characters "ref"~}}}`); Liquid `{{ characters | layout: "ref" }}` (`{{- characters | layout: "ref" -}}`). With `null` (back to the pub's layout): `{{{characters}}}` / `{{ characters }}`.

**b. `templateDiagnostics.ts`.** `TemplateDiagnosticsOptions` gains `variableLayoutOffers?: TemplateCheckOptions["variableLayoutOffers"]`, passed into the check as `{ ...templateCheckWith(options.untyped), ...(offers ? { variableLayoutOffers: offers } : {}) }` (spreading keeps the same inner `liquid` object, which the SDK caches by identity). The caller passes the laid-out scope. `quickFix` for kind `unknown-layout`: replace the whole `[f.start, f.end)` span with `f.suggestion` verbatim, label `Use "<suggestion>"` — the current `.`-segment logic breaks a dotted owner like `acme.dice/prose@1`. Leave every other kind's fix as it is.

**c. `templateAssist.ts`.**
- Add `layout` to `HANDLEBARS_HELPER_DOCS`: `{ signature: 'layout variable "reference"', description: "The variable written out by the named layout, in this template only." }` and to `LIQUID_FILTER_DOCS`: `'layout: "reference" — the variable written out by the named layout, in this template only'`.
- `AssistOptions` gains `layoutOffers?: TemplateCheckOptions["variableLayoutOffers"]` (variable id → offers). The caller passes the laid-out scope.
- **Completion inside the reference's quotes**: in `completionsAt`, before the engine branches, when the text from the open tag to the caret ends in `layout <key> "<typed>` (Handlebars, also inside a subexpression `(layout key "`) or `<key> | layout: "<typed>` (Liquid), either quote, return that key's offers via `variableLayoutOffersFor(scope, key, options.layoutOffers)`: `label` = reference, `detail` = the offer's label, `insert` = reference, `kind: "placeholder"` (or add a kind only if the bridge's `CM_TYPE` map gets it too), replacing `[start of typed, caret)`, ranked with the existing `rank`. Nothing else is offered there.

**d. `templateCheckOptions.test.ts`.** Today it excludes `layout` from the "every Handlebars helper core registers is on the list" comparison (vl-D, pending this). Put it back: compare the registered helpers (minus Handlebars built-ins) with `[...CONTEXT_HANDLEBARS_HELPERS, VARIABLE_LAYOUT_HELPER]`, and assert `HANDLEBARS_HELPER_DOCS[VARIABLE_LAYOUT_HELPER]` and `LIQUID_FILTER_DOCS[VARIABLE_LAYOUT_HELPER]` exist. Do not edit `templateCheckOptions.ts`.

**e. `templateAssistBridge.ts`**: no change expected; add a test that a reference completion comes through `toCompletionResult` with its label and detail.

### 2. The editor (`TemplateEditor.svelte`, `ScopeTree.svelte`, `TemplateLayoutsList.svelte`)

New optional prop on `TemplateEditor`:
```ts
/**
 * W5: each laid-out key this template can read, with the layout it is written
 * with and the layouts it may name (`pipelines:templateVariableLayouts`). Absent:
 * no layout help, exactly as today.
 */
variableLayouts?: readonly Sockets.Pipelines.VariableLayouts.TemplateKey[]
```
From it derive `renders` (`{ [key]: variableId }`), `layoutOffers` (`{ [variableId]: offers }`) and `checkScope = laidOutScope(scope, renders)`; use `checkScope` and the offers **everywhere** the editor checks or completes (the `allDiagnostics` derived, the linter closure, `completionsAt`, `describeAt`, `scopeTreeNodes`). With no `variableLayouts`, behaviour is byte-for-byte today's.

- **ScopeTree**: new optional prop `writtenAs?: Readonly<Record<string, string>>` (root node id → layout name; root ids are the key names). A root row in that map adds a meta line `Written as ‹name›` in `text-surface-600-400`, after the *From …* line. TemplateEditor passes `{ [key]: inUse.name }` for keys with an `inUse`.
- **The caret line** (today the `hover` paragraph, `TemplateEditor.svelte` ~367–388): when the caret is on a laid-out occurrence (`occurrenceAt` with the `variableLayouts` keys), add a line: `Written as ‹name› (‹reason›)`. Name and reason: a call whose reference is one of the key's offers → that offer's label, reason `named by the template`; a bare read with `inUse` → `inUse.name`, reason by `inUse.reason`: `pub` → `this pub's choice`, `default` → `the default`, `automatic` → `automatic`. A bare read with no `inUse`, or a call whose reference isn't offered (the lint already says so), shows no *Written as* words. Keep the words in a polite live region; put the buttons **outside** it, right after. Then, unless `readonly`, one real `<button type="button">` per **other** offer (every offer except the one written there: the call's reference, or for a bare read `inUse.reference`): label `Write as ‹offer label› here`, class `btn btn-sm preset-tonal-surface`. Pressing it replaces that one occurrence with `writeOccurrence(...)` through `field.replace(o.start, o.end, text)` — new plumbing, NOT the lint-fix mechanism (`applyFix` / the `Mod-.` key stays for errors only).
- **Layouts in this template** (`TemplateLayoutsList.svelte`, new): a `btn btn-sm preset-tonal-surface` button beside the field (put it in a small row above the field, right-aligned, so it never covers the text), `aria-expanded`/`aria-controls`, shown only when not `readonly`, `variableLayouts` is present, and the template reads at least one laid-out key (`laidOutOccurrences` non-empty). It opens an inline short list (not a modal): one row per laid-out key the template reads, in first-occurrence order: the variable's label and its key in mono, and a select (use `$lib/client/components/inputs/Select.svelte` as `PipelineConfigOptions.svelte` does) whose options are `The pub's layout` (value: bare read) then each offer by its label. A row's initial value is what the template writes now: all occurrences bare → the pub's layout; all one reference → that offer; anything else → an extra first option `Mixed — leave as it is` (selected), which leaves those occurrences alone on Apply. Above the rows, two shortcut buttons **All bare** and **All titled**: set every row that has such an offer (`bareOffer`/`titledOffer`) to it; hide a shortcut no row can take. **Apply** (`btn btn-sm preset-filled-primary-500`) rewrites every occurrence of every changed row in ONE CodeMirror transaction: `field.editor()?.dispatch({ changes: rewriteChanges(...) })` (CodeField exports `editor()` returning the `EditorView`), then closes the list. The list never toasts and never touches the socket.
- **Lint**: pass `variableLayoutOffers` into `templateDiagnostics` (both call sites). The issue list and fix buttons need no other change: `unknown-layout` gets its fix from the pure layer.
- **Read-only** (a shipped template): the caret line still shows *Written as …*, but no **Write as** buttons and no **Layouts in this template**.

Look at STYLE-GUIDE §6.12 (`/home/jody/github/serene-pub/STYLE-GUIDE.md` line 1703) for the field's surroundings. Sizes: 12px (`text-xs`) lines, muted `text-surface-600-400`.

## Rules your work depends on (quoted from the lane brief and CLAUDE.md)

- **Sockets:** one domain context per event family is the only listener and the only place that toasts; views register listeners for local state and **never call `toaster`**. `socket.off(event)` without a handler removes every listener app-wide: always pass the handler. (This worker touches no socket.)
- "`$state(new Set())` / `new Map()` is not reactive on mutation: use `SvelteSet` / `SvelteMap`. Untrack reads of state an effect-called method writes."
- "Browser code runs on plain-http LAN addresses and phones: **no `crypto.randomUUID`, no `navigator.clipboard`**. Buttons, never a keyboard-only shortcut, for anything W5 offers."
- "A refusal is shown in words where it applies. A read-only value is words, never a disabled control."
- "The editor and the save must never disagree: use the SDK check with the same scope and offers the server uses."
- STYLE-GUIDE §9: every interactive element is a real `button` or input with an accessible name; never an interactive inside an interactive; nothing hover-only; 44px targets on touch (`pointer-coarse:` sizing as nearby code does).
- STYLE-GUIDE §10: sentence case; a button says what happens.
- Use exactly the UI words in this brief. Any other word a user sees: don't invent it — list it in your report.
- "Heavy DOM tests: never pipe vitest into `head`; keep CodeMirror DOM tests small (a failing happy-dom assert has OOM-killed VS Code)." Assert on strings/booleans you pulled out (`expect(text).toContain(...)`), never `expect(element)...` on a happy-dom node.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. **Additionally: do not run `npm run sdk:build` at all, and do not start any dev server.**
- Do not edit any file outside "Files owned". Another worker is editing `PipelineConfigOptions.svelte`, `typedSocket.ts` and the inspector at the same time; don't touch them.

## Done means

Tests (run each file with `npx vitest run <file>` from the repo root; never pipe into `head`):
- `templateLayoutRewrite.test.ts`: occurrences in both engines (bare triple, bare double, `~`/`-` kept, calls with either quote, and the ignored forms: `{{#if characters}}`, `{{#each characters}}`, `characters.name`, subexpression call, escaped); `occurrenceAt`; `writeOccurrence` both directions both engines; `rewriteChanges` with a mixed template; `bareOffer`/`titledOffer`.
- `templateDiagnostics` (new test file or an existing one): an `unknown-layout` near-miss on a dotted owner (`acme.dice/prose@1` offered, `acme.dice/prse@1` written) gets a fix that replaces the whole reference; with offers absent nothing is reported for a well-formed reference; a `layout` call on a key that isn't laid out is a `layout-argument` error.
- `templateCompletions.test.ts` / `templateAssist.test.ts`: completion inside `{{{layout characters "` and inside `{{ characters | layout: "` lists that key's references with their labels; `layout` appears among the inline helpers / filters.
- `templateCheckOptions.test.ts` passes with `layout` back in the comparison.
- `templateAssistBridge.test.ts` passes.
- `templateEditorLayouts.dom.test.svelte.ts` (keep it small, a handful of tests): the caret on `{{{characters}}}` shows `Written as Titled JSON block (this pub's choice)` and a **Write as JSON here** button that rewrites that one occurrence to `{{{layout characters "core/json@1"}}}` (a second occurrence untouched); the same in Liquid to `{{ characters | layout: "core/json@1" }}`; **Layouts in this template** → **All bare** → **Apply** rewrites every occurrence in one go; a read-only template shows the *Written as* words but no **Write as** button and no **Layouts in this template** button; the ScopeTree root shows `Written as Titled JSON block`. Fake the `variableLayouts` prop with a `characters` key (`variableId: "core:var/characters@1"`, `inUse: { id: 1, name: "Titled JSON block", reference: "core/titled-json@1", reason: "pub" }`, offers `core/titled-json@1` "Titled JSON block" and `core/json@1` "JSON"). Place the caret with `view.dispatch({ selection: { anchor } })`.
- The existing `templateEditorField.dom.test.svelte.ts` and `templateVariables.dom.test.ts` still pass.
- `npx tsc --noEmit -p .` shows no error in your files (errors elsewhere from the other worker's in-flight work: list, don't fix).
- `npx prettier --check` on every file you touched.

## Report

Return in your final message: files changed; each test file run with pass/fail counts; the exact UI strings you added; anything you could not do or decided yourself; anything noticed but not done.
