# BRIEF vl-S-w1 — the template check learns `layout` (Handlebars helper, Liquid filter)

You are a `lane-worker` under lane supervisor `vl-S` (variable layouts, SDK half). Your supervisor has read the plan and the rules; everything you need is quoted here.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Background (one paragraph)

A context template may name, in place, which **variable layout** writes a variable out: Handlebars `{{{layout characters "core/json@1"}}}`, Liquid `{{ characters | layout: "core/json@1" }}`. The second argument is a **layout reference** `<owner>/<slug>@<major>`. The SDK's one template checker (`sdk/src/templateCheck.ts`, entry `@serene-pub/sdk/template-check`) must check these calls, and must expose a parse that lists every call so the app's render pre-pass and the check can never disagree.

## Already in place (supervisor wrote these; read, do not change)

- `sdk/src/template.ts`: `VarField.laidOutBy?: string` (root only: the variable id whose layout writes this key out); `TemplateFindingKind` gains `'layout-argument'` and `'unknown-layout'`; `TemplateCheckOptions.variableLayoutOffers?: Readonly<Record<variableId, readonly VariableLayoutOffer[]>>`.
- `sdk/src/variableLayouts.ts`: `VARIABLE_LAYOUT_HELPER = 'layout'`, `parseVariableLayoutReference(value) → { owner, slug, major } | null`, `VariableLayoutOffer { reference, label }`. Import these; never re-spell the grammar.

## Goal

In `sdk/src/templateCheck.ts`:

1. **`layout` is always known.** Handlebars: never an unknown-helper finding, even when `options.helpers` omits it (do not add it to the exported `HANDLEBARS_BUILTIN_HELPERS`, which lists Handlebars' own). Liquid: `makeLiquid` always registers a `layout` filter (parse only, like the others), so `strictFilters` parses it.

2. **Check every `layout` call** (Handlebars: a `MustacheStatement` or `SubExpression` whose path is the simple name `layout`, with or without params; Liquid: any filter named `layout` in any value, in `{{ }}` output and in tag arguments such as `{% assign x = characters | layout: "core/json@1" %}`). One shared function judges the key and the reference for both engines. Findings, in this order of precedence:
   - **Shape → `layout-argument`, severity error.**
     - Handlebars: not exactly two params, or any hash pair; first param not a one-segment, unclimbed, unscoped, non-`@data` path (use the existing `simpleName`); second param not a `StringLiteral`. `{{#layout …}}` (block form) and a bare `{{layout}}` are `layout-argument` too.
     - Liquid: `layout` not the first filter; the value's initial expression not a bare one-segment variable (`characters.name | layout`, a literal, a range); not exactly one positional argument; the argument not a quoted string literal; a `key: value` argument.
     - Messages in plain words, each with the correct example. Suggested wording: `layout takes a variable in scope and a quoted layout reference: {{{layout characters "core/json@1"}}}.` · `layout's second argument is a layout reference in quotes, such as "core/json@1" — a path or a subexpression can't be checked, or laid out before the template runs.` · Liquid: `layout comes straight after the variable's name: {{ characters | layout: "core/json@1" }}.`
   - **The key.** Its existence is the ordinary walk's job: Handlebars, keep calling `ref()` on the first param so a missing key is the usual `unknown-name` finding (with the usual severity rules); Liquid, the analyser already reports it. Do not report it twice. When the key IS a root of `scope` but its decl is not a `VarField` with `laidOutBy` → `layout-argument`, error: `"sessionMessages" is not written out by a variable layout, so it has no layout to name. Write {{{sessionMessages}}}.` with `available` = the scope's laid-out keys and `suggestion` = `nearestName(key, laidOutKeys)` when there is one.
   - **The reference** (only when shape and key are fine):
     - Not `parseVariableLayoutReference`-able → `unknown-layout`, **always an error**: `"json" isn't a layout reference — write <owner>/<slug>@<major>, such as "core/json@1".` plus a did-you-mean from the offers when offers exist for that variable.
     - `options.variableLayoutOffers` given: refs = `offers[laidOutBy] ?? []`; reference not among them → `unknown-layout`, **error**, the same shape the check uses for unknown names: `message` with ` Did you mean "core/json@1"?` when `nearestName` finds one, `fix` (`use "…"` / `layouts here: a, b` / `characters offers no layouts here`), `available` = refs, `suggestion`.
     - `options.variableLayoutOffers` absent (no host in view, e.g. the packager): every well-formed reference is `unknown-layout` with **severity warning**, saying it can't be checked here and renders only where a layout with that reference exists.
   - **Positions.** For `unknown-layout`: `name` and `path` = the reference string; `start`/`end` = the reference's text **inside the quotes** (so `source.slice(start, end) === reference`, which the app's quick fix relies on); `line`/`column` of that start; `tag` = the enclosing `{{ … }}` span. For `layout-argument`: the offending argument's span (or the `layout` name's for arity/block). Liquid tokens carry `begin`/`end` offsets into the input — use them; add a small offset→line/column helper next to `offsetOf` if needed.

3. **Export `variableLayoutCalls(engine, src, options?)`** from `templateCheck.ts`, and its type:
   ```ts
   /** One `layout` call in a source, as the render pre-pass reads it. @experimental */
   export interface VariableLayoutCall { key: string; reference: string }
   /** Every `layout` call in `src`, in source order, duplicates kept … @experimental */
   export function variableLayoutCalls(engine: string, src: string, options?: TemplateCheckOptions): VariableLayoutCall[]
   ```
   - Both engines, same parser and same AST walk as the check (Liquid parsed with the host's vocabulary from `options.liquid`, via `liquidFor`).
   - A call is listed when its key is a simple root name and its reference a string literal, **whether or not the reference is grammatical or offered** — the pre-pass must see every call it will meet; the check is what refuses. Calls inside blocks are listed. Shape errors (path key, non-literal reference, wrong arity, Liquid `layout` not first) are not listed.
   - A source that doesn't parse, or an engine `canCheckTemplateEngine` refuses → `[]`.

4. Update the module doc comment's **What it reports** list with the two new kinds (one line each).

## Files owned (the only files you may edit)

- `/home/jody/github/serene-pub-sdk/sdk/src/templateCheck.ts`
- `/home/jody/github/serene-pub-sdk/sdk-tests/templateCheckLayout.test.ts` (new)

## Files readable

Anything under `/home/jody/github/serene-pub-sdk/` (notably `sdk/src/template.ts`, `sdk/src/variableLayouts.ts`, `sdk/src/handlebarsReach.ts`, `sdk-tests/templateCheck.test.ts` for test style, `node_modules/liquidjs/dist/liquid.node.mjs` — `analyze`/`analyzeSync` at ~line 2768 shows how liquidjs walks `children(partials, sync)` and `arguments()`; walk the same way). `/home/jody/github/serene-pub/src/lib/shared/utils/templateDiagnostics.ts` shows how the app turns a finding into a quick fix.

## Rules your work depends on (quoted by your supervisor)

- **SDK should feel like Drizzle**: typed, predictable, one way to do a thing, refuses early.
- **The barrel stays dependency-free**: `templateCheck.ts` is the `/template-check` entry and is the only module that imports `handlebars` / `liquidjs`. Never import `templateCheck.ts` from a barrel module.
- **Removing or renaming a published SDK name is the owner's call: add only.** Don't change existing exports' signatures or behaviour; all 23 existing tests in `sdk-tests/templateCheck.test.ts` must still pass unchanged.
- **NOMENCLATURE §24**: introduce no exported name beyond `variableLayoutCalls` and `VariableLayoutCall`. Internal helpers are fine. Every export carries exactly one TSDoc stability tag (`@experimental` here) or `sdk-tests/surface.test.ts` fails.
- Messages are plain words, one sentence or two, and say the fix (CLAUDE.md copy rules; match the existing findings' voice).
- Formatting: `templateCheck.ts` passes `npx prettier --check` today; keep it passing (`cd /home/jody/github/serene-pub-sdk && npx prettier --check sdk/src/templateCheck.ts sdk-tests/templateCheckLayout.test.ts`; you may `--write` those two files only).
- **Never `git checkout` / `restore` / `stash` / `clean` in `../serene-pub-sdk`**: most of it is uncommitted.

## Out of scope

Everything else: `template.ts`, `variableLayouts.ts`, `index.ts`, `templateFit.ts`, the app, rendering, registering the helper in the app's engines. If you find you need a change there, stop and say so in your report.

## Stop and ask when

A rule above can't be met; liquidjs or Handlebars exposes the AST differently from what this brief assumes in a way that changes behaviour (say what you found); you would need a new exported name.

## Never

- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* — and in this lane, **never run `sdk:build` at all**.
- Never pipe a test run into `head`.

## Done means

- `cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsx --test templateCheck.test.ts templateCheckLayout.test.ts` — all pass. The new file covers, for both engines where it applies: a valid call → no findings; key not laid out; key missing (one `unknown-name`, not two); non-literal reference (path; Handlebars subexpression); wrong arity; hash / keyword argument; block form; Liquid filter not first and `characters.name | layout`; Liquid inside `{% assign %}`; malformed reference (error even without offers); unknown reference with offers → error with suggestion and `source.slice(start,end) === reference`; offers absent → warning; `layout` inside a subexpression (`{{pad (layout characters "core/json@1") 2}}` with helpers `['pad']`) checked; `layout` not flagged unknown when `helpers` omits it; `variableLayoutCalls` for both engines (order, duplicates, nested in blocks, ungrammatical reference still listed, shape errors not listed, `[]` on syntax error and on an unknown engine).
- `cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsc --noEmit` clean.
- prettier check clean on your two files.

## Report

Reply with (this is your final message, not a file): changed files; the tests you ran with pass/fail counts; anything in the AST that differed from this brief and what you did; any message wording you chose; open questions; **Noticed, not done**.
