# BRIEF vl-S-w2 — layout references: seed slug, a preset's variable layouts, `variableLayout()`

You are a `lane-worker` under lane supervisor `vl-S` (variable layouts, SDK half). Your supervisor has read the plan and the rules; everything you need is quoted here.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Background (one paragraph)

A variable is written out by one **variable layout**, chosen once for the pub; a **preset** may choose differently per variable for its sessions; a context template may name one in place. Each layout is named by a **layout reference** `<owner>/<slug>@<major>`: owner a plugin slug (`acme.dice`) or `core`, slug kebab-case, major a positive integer, always written. ⚠ Not a **template id** (`acme:template/omens-prose@1`, the row's app-wide identity). ⚠ A genre's `layouts` are *session* layouts — never reuse that word for this.

## Already in place (supervisor wrote these; read, do not change what exists)

`/home/jody/github/serene-pub-sdk/sdk/src/variableLayouts.ts` (already exported from the barrel by `export *` in `index.ts`): `VARIABLE_LAYOUT_SLUG`, `VARIABLE_LAYOUT_REFERENCE`, `VariableLayoutReferenceParts`, `parseVariableLayoutReference`, `formatVariableLayoutReference`, `VARIABLE_LAYOUT_HELPER`, `VariableLayoutOffer`. `sdk/src/template.ts` has `VarField.laidOutBy?: string` and `TemplateCheckOptions.variableLayoutOffers`. Use these; never re-spell the reference grammar.

## Goal

### A. `sdk/src/variableLayouts.ts` — append (you may add imports at the top)

1. `variableIdParts(id: unknown): { owner: string; name: string; major: number } | null` — **`@internal`**. Grammar `^([a-z0-9]+(?:[.-][a-z0-9]+)*):var\/([A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)@(\d+)$` (camelCase names are tolerated because the variable registry does not refuse them and the app's `objectLayoutTemplateId` kebabs them). Used by B and D.
2. `laidOutScope(scope: TemplateScope, renders: Readonly<Record<string, string>>): TemplateScope` — **`@experimental`**. Returns a NEW scope (never mutates the input) in which each root key that `renders` maps (key → variable id, exactly what the SDK's `rendersAt()` returns) carries `laidOutBy: <variable id>`: a `VarField` root → `{ ...decl, laidOutBy }`; an `'any'` or `string[]` root → `{ type: 'string', optional: true, laidOutBy }` (a laid-out value is a string). A `renders` key that is not a root of `scope` is skipped — the scope is the authority on names. Doc: this is how a host tells the check and the editor which keys are laid out.
3. `variableLayoutOffersFor(scope: TemplateScope, key: string, offers: TemplateCheckOptions['variableLayoutOffers']): readonly VariableLayoutOffer[]` — **`@experimental`**. The offers of the variable that writes `key` out (`scope[key].laidOutBy`); `[]` when the key isn't laid out, offers are absent, or the variable has none. For the app's completion inside `layout characters "` and hover.
4. `variableLayout(pluginId, variable, input)` — **`@experimental`** — the typed builder of a variable layout's `TemplateSeed`:
   ```ts
   /** @experimental */
   export interface VariableLayoutInput { slug: string; major: number; label: string; engine: EngineId; source: string }
   export function variableLayout(pluginId: string, variable: VariableDecl, input: VariableLayoutInput): TemplateSeed
   ```
   - `pluginId` first and positional: the pattern every plugin-facing builder follows (`definePluginVariable(pluginId, …)`, `definePluginFunction(pluginId, …)`, `definePluginRuleset(pluginId, …)`).
   - `variable` is the object `defineVariable` / `definePluginVariable` returns, so a typo is a compile error; it may be another package's variable (a plugin may lay out `core:var/characters@1`).
   - Returns `{ id, kind: 'variables', variableId: variable.id, slug, engine, body: source, label }` with `id = <pluginId>:template/<variable name>-<slug>@<major>`, where `<variable name>` is `variableIdParts(variable.id).name` kebabed exactly as the app does: `.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()`.
   - Throws, in plain words naming the plugin and the variable: variable id not in grammar; slug not `VARIABLE_LAYOUT_SLUG`; major not a positive integer; label not a non-empty string; engine not a non-empty string; source not a string. Then runs `templateSeedProblems(seed, pluginId)` and throws its problems joined — one rule, never re-derived.
   - **It does not run the template check on `source`.** The checker carries the engines (`handlebars`, `liquidjs`) and lives at `@serene-pub/sdk/template-check`; this module is on the dependency-free barrel. Say in the doc comment that the packager (`variableSeedFindings`, `E_TEMPLATE_SCOPE`) and the instance's install check the source against the variable's scope. (Your supervisor is raising the define-time check with the lead.)

### B. `sdk/src/templateIds.ts`

- `TemplateSeed` gains `slug?: string`, documented: 🚧 `variables` only — the slug of this layout's reference `<owner>/<slug>@<major>`, whose owner and major are the id's; kebab-case; absent, the reference's slug is the id's name segment. Additive.
- `templateSeedProblems` refuses (accumulating, like the rest): a `slug` on a `prompts` or `template` row (only a variable layout has a layout reference); a `slug` that is not a string matching `VARIABLE_LAYOUT_SLUG`. Import `VARIABLE_LAYOUT_SLUG` from `./variableLayouts.js`.

### C. `sdk/src/announce.ts` — the `PresetDecl` field and its validation only

- `PresetDecl.variableLayouts?: Readonly<Record<VariableId, string>>` and the same on `PresetInput`. Doc: 🚧 variable id → layout reference: this preset's sessions write that variable out with that layout instead of the pub's. A reference to a layout that isn't installed is accepted; the host skips it, renders the pub's layout and says so. ⚠ Not a genre's `layouts` (session layouts) and not `settings`.
- `presetVariableLayoutFindings(preset: { slug?: string; variableLayouts?: unknown } | null | undefined): string[]` — **`@experimental`** — the one statement of the rule, as sentences, for a preset that arrives as data (a manifest, a row) and for the builder: not a plain object → one sentence with the shape (`{ 'core:var/characters@1': 'core/json@1' }`); each key not `variableIdParts`-able → a sentence naming the preset and the key; each value not `parseVariableLayoutReference`-able → a sentence naming the preset, the key and the value. Every sentence starts `preset '<slug>'` like the file's other refusals.
- `preset()` throws the first finding (it throws first-mistake today; keep that), and stores `variableLayouts` **only when non-empty**, as a fresh copy, placed after `settings` in the returned object — so every existing preset stores and hashes exactly as before.
- Touch nothing else in `announce.ts`.

### D. Tests (new files, plus additions to `templateIds.test.ts`)

- `sdk-tests/variableLayouts.test.ts`: the grammar (parse: good refs incl. dotted owner and `core`; refuses missing major, `@0`, uppercase, a template id, `owner:slug@1`, non-strings; format round-trips and throws per bad part); `variableIdParts`; `laidOutScope` (VarField, `'any'`, `string[]`, skipped key, input not mutated); `variableLayoutOffersFor`; `variableLayout` (the id for a plugin variable and for `core:var/characters@1`, camelCase variable name kebabed, every refusal, a `templateSeedProblems` problem surfaces, the returned seed passes `templateSeedProblems`).
- `sdk-tests/templateIds.test.ts`: add cases for the slug rules (accepted on `variables`, refused on `prompts` and `template`, refused when malformed). Don't change existing cases.
- `sdk-tests/presetVariableLayouts.test.ts`: `preset()` stores the map; omits it when absent or `{}`; refuses a bad key and a bad reference with the preset's slug and the key in the message; accepts a well-formed reference to a layout nobody installed; `presetVariableLayoutFindings` on raw data (non-object, bad key, bad value, clean). Build presets the way `sdk-tests/announce.test.ts` / `presetsAsChanges.test.ts` do.

## Files owned (the only files you may edit)

- `/home/jody/github/serene-pub-sdk/sdk/src/variableLayouts.ts` (append only, plus imports)
- `/home/jody/github/serene-pub-sdk/sdk/src/templateIds.ts`
- `/home/jody/github/serene-pub-sdk/sdk/src/announce.ts` (the field, its doc, `presetVariableLayoutFindings`, and the two lines in `preset()`)
- `/home/jody/github/serene-pub-sdk/sdk-tests/variableLayouts.test.ts` (new), `/home/jody/github/serene-pub-sdk/sdk-tests/presetVariableLayouts.test.ts` (new), `/home/jody/github/serene-pub-sdk/sdk-tests/templateIds.test.ts` (additions)

## Files readable

Anything under `/home/jody/github/serene-pub-sdk/`. `sdk/src/variables.ts` (defineVariable, `VariableDecl`, `VariableId`) — **read only: another session is editing it right now.** `sdk/src/engines.ts` (`EngineId`), `sdk/src/bands.ts` (`rendersAt`), `/home/jody/github/serene-pub/src/lib/server/pipelines/entities/objectVariableLayouts.ts` (`objectLayoutTemplateId`).

## Rules your work depends on (quoted by your supervisor)

- **SDK should feel like Drizzle**: typed, predictable, one way to do a thing, refuses early.
- **The barrel stays dependency-free**: no module you touch may import `templateCheck.ts`, `handlebars` or `liquidjs`.
- **Removing or renaming a published SDK name is the owner's call: add only.** Every addition is optional/additive; no existing behaviour changes; every existing test passes unchanged.
- **NOMENCLATURE §24**: introduce no exported name beyond those listed above (`variableIdParts`, `laidOutScope`, `variableLayoutOffersFor`, `variableLayout`, `VariableLayoutInput`, `presetVariableLayoutFindings`, and the two fields). Every export carries exactly one TSDoc stability tag or `sdk-tests/surface.test.ts` fails.
- **Catalogue ids evolve in place at `@1` until 0.7.** Don't touch any id.
- Messages: plain words, say the fix, match the file's existing refusals.
- Formatting: `templateIds.ts` and `announce.ts` are NOT prettier-clean today — **never** run `prettier --write` on them (it would reformat other people's lines); match the surrounding style by hand. New files must pass `cd /home/jody/github/serene-pub-sdk && npx prettier --check <file>` (you may `--write` your new files and `variableLayouts.ts`).
- **Never `git checkout` / `restore` / `stash` / `clean` in `../serene-pub-sdk`**: most of it is uncommitted.

## Out of scope

`templateCheck.ts` (another worker owns it right now), `template.ts`, `index.ts`, `variables.ts`, `declarations.ts`, `templateFit.ts`, core-catalog, conformance, the app. If you need a change there, stop and say so.

## Stop and ask when

A rule can't be met; a name you need isn't listed; `preset()`'s existing validation path (e.g. `assertDisplayText`) objects to the new field in a way that needs a design choice.

## Never

- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* — and in this lane, **never run `sdk:build` at all**.
- Never pipe a test run into `head`.

## Done means

- `cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsx --test variableLayouts.test.ts presetVariableLayouts.test.ts templateIds.test.ts announce.test.ts presetsAsChanges.test.ts presets.test.ts coreGenreDefaults.test.ts` — all pass.
- `cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsc --noEmit` clean (the other worker is editing `templateCheck.ts` concurrently; if an error is only in that file, note it and move on).
- prettier check clean on your new files and `variableLayouts.ts`.

## Report

Reply with (your final message, not a file): changed files; tests run with pass/fail counts; message wording chosen; anything that differed from this brief; open questions; **Noticed, not done**.
