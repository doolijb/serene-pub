# BRIEF vl-S — Variable layouts: the SDK half

You are a **lane supervisor**. Read `.claude/guides/multi-agent.md` first, then the plan `plans/PLAN-variable-layouts-2026-11-10.md` in full. The plan is the contract; this brief scopes your part. Every ★ is ruled (plan header). Delegate typing to at most 2 `lane-worker`s with briefs at `plans/briefs/BRIEF-vl-S-w<n>.md`; quote into each the rules below that its work depends on.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

Plan § What gets built › SDK, items 9–12:

1. **`templateCheck` knows `layout`** (`../serene-pub-sdk/sdk/src/templateCheck.ts`): the Handlebars helper `{{{layout <key> "<reference>"}}}` and the Liquid filter `{{ <key> | layout: "<reference>" }}`.
   - First argument: a key in the template's scope that is a **laid-out variable** (the scope must be able to say which keys are; add what the scope needs to carry that, typed).
   - Second argument: a **string literal**. Anything else (a path, a subexpression) is an error with a plain-words message.
   - The reference is checked against a host-supplied list of the layouts each variable offers (`layoutsByVariable` or a better-named input; name it per NOMENCLATURE §24 and report it). Unknown reference → error with a near-miss suggestion, the same finding shape the check already uses for unknown names. When the host supplies no list (no host in view), an unknown reference is a warning, matching how the library editor treats unknown names.
   - Expose what the app's completion and hover need: the references a variable offers, with each layout's display name.
   - Also expose, for the app's render pre-pass, a function that returns every `layout` call in a source as `{ key, reference }` (both engines). The pre-pass is `vl-D`'s; the parse belongs here so check and render never disagree.
2. **Reference grammar**: `<owner>/<slug>@<major>`: owner in the plugin-slug grammar or `core`, slug kebab-case, major a positive integer, always present. One parser and one formatter, exported, used by everything below.
3. **`TemplateSeed.slug`** (`../serene-pub-sdk/sdk/src/templateIds.ts:104`): optional, `kind: 'variables'` only, kebab-case; `templateSeedProblems` refuses it on other kinds and refuses a malformed one. Additive, `@experimental`.
4. **`PresetDecl.variableLayouts?: Record<VariableId, string>`** (`../serene-pub-sdk/sdk/src/announce.ts:334`): variable id → layout reference, `@experimental`, 🚧. Validated where a preset's other keys are validated: a key that isn't a variable id in grammar, or a malformed reference, is refused with a message naming the preset and key. A reference to a layout not installed is **accepted** (the host handles it). Never `layouts`: a genre's `layouts` are session layouts.
5. **`variableLayout(variable, { slug, major, label, engine, source })`** (★7): takes the variable object returned by `defineVariable` / `definePluginVariable`, returns a `TemplateSeed` with `kind: 'variables'`, `variableId`, `slug`, and an id `<owner>:template/<variable name>-<slug>@<major>` where owner is supplied the way other plugin-facing builders get it (follow the existing pattern; report which). Check `source` against the variable's `scope` with the template check at define time; a finding that is an error throws. Export it where `defineVariable` is exported.

## Files owned

- `../serene-pub-sdk/sdk/src/templateCheck.ts` and its tests
- `../serene-pub-sdk/sdk/src/templateIds.ts` and its tests
- `../serene-pub-sdk/sdk/src/announce.ts` (the `PresetDecl` field and its validation only) and its tests
- `../serene-pub-sdk/sdk/src/variables.ts` (only if `variableLayout` lives here) or one new file `../serene-pub-sdk/sdk/src/variableLayouts.ts` + test
- `../serene-pub-sdk/sdk/src/index.ts` (exports only) and whatever API-report / exports-snapshot file the SDK's tests require for new exports

## Files readable

Anything in `../serene-pub-sdk/` and `src/`. Especially `src/lib/server/pipelines/entities/variableLayouts.ts`, `objectVariableLayouts.ts`, `src/lib/shared/utils/templateDiagnostics.ts`, `src/lib/shared/utils/contextHandlebarsHelpers.ts`, `src/lib/shared/utils/contextLiquid.ts`, `../serene-pub-sdk/INTEGRATING.md` §2a and §5.

## Rules your work depends on (quote into worker briefs)

- **NOMENCLATURE §24**: grep a new name across `src`, the SDK and the schema first; qualify it (R3); say what it is not when a near-neighbour exists. Record every new name in your report for `vl-N`, who owns `NOMENCLATURE.md`. **Do not edit NOMENCLATURE.md.**
- **SDK should feel like Drizzle**: typed, one way to do a thing.
- Removing or renaming a published SDK name is the owner's call: add only.
- **Never `git checkout` / `restore` / `stash` in `../serene-pub-sdk`**: most of it is uncommitted.

## Out of scope

The app: engines' helper/filter registration, rendering, storage, UI (other lanes). Core-catalog changes. Any change to `defineVariable`'s existing behaviour.

## Stop and ask when

CLAUDE.md § Decisions applies; a name you need is new and has a near-neighbour you can't resolve; the template check's existing finding shape can't carry what item 1 needs without a breaking change.

## Never

- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
- **Additionally, do not run `npm run sdk:build` at all.** Another session's tests run against the dist. Finish with `npm run sdk:test` (from the app root) and report "ready for sdk:build"; the lead coordinates the build.

## Done means

- Targeted SDK tests for items 1–5 pass, run from the app root through `npm run sdk:test` (or the SDK workspace's own vitest invocation for just your files, from `../serene-pub-sdk/sdk/`).
- `npx tsc --noEmit -p ../serene-pub-sdk/sdk` (or the SDK's typecheck script) clean for your files.
- A `scope-reviewer` run on your diff, findings answered.

Known, not yours: `npm run sdk:test` has 5 failures from before this build (deriveDontSpell on `factories/turnOrder.ts` + `shared/speakMessage.ts`; surface: `STORY_CREATE_SPEC_ID` and `CREATE_SESSION_PERSONA_*_MAX` untagged; `your-first-plugin.md` vocabulary; widget-parts guide for chronicle/messages). Another session is editing core-catalog and conformance right now; don't touch those.

## Report

`plans/REPORT-vl-S-2026-11-10.md`: changed files, tests run with results, every new exported name with a one-line meaning (for `vl-N`), the exact inputs `vl-D` and `vl-E` must call (signatures), "ready for sdk:build", open questions, **Noticed, not done**.
