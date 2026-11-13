# REPORT m2e-D-w4

Status question: n/a. All three parts built; one everyday-field gap sits in a file I do not own (see Noticed).

## Changed files
- SDK `contracts/src/tasks.ts`: one description sentence on `core:task/read-library-draft@1` (the task also turns a plain `See: /docs/<path>` line into a markdown link). No snapshot of it exists.
- SDK `sdk/src/settings.ts` (exported via the existing `export * from './settings.js'`): `undescribedSettingParts`.
- SDK `cli/src/compiler.ts`: both `W_SETTING_UNDESCRIBED` call sites use it (+ import).
- SDK `core-catalog/src/registry/genres.ts`, `core-catalog/src/shared/speechFields.ts`: declarations (below).
- SDK tests: `sdk-tests/settings.test.ts` (+4 predicate tests), `sdk-tests/coreCatalog.test.ts` (golden pin moved).
- App: `src/lib/shared/sessions/declaredFieldRefusal.ts` (+ `.test.ts`, new, prettier-clean), `src/lib/server/sockets/appletSessions.ts` (function removed, imports the shared one; no other server file imported it), `src/lib/server/sessions/settingsForm.ts`, `settingsForm.int.test.ts` (+3 tests).

## Predicate
`undescribedSettingParts(decl, { reach?: boolean }): Array<'description'|'group'|'reach'>` 🚧 (empty = described).
- An `reach: 'admin'` decl returns `[]` (not user-facing). Description counts via `isI18n` (non-blank, English face).
- `{ reach: false }` is for kinds with no reach (plugin settings, scope 'user'): the compiler's second call site. The plugin `scope === 'user'` filter stays local in the compiler (it is about who sees the plugin setting, not about the declaration).
- §25 draft: "`undescribedSettingParts` — which of purpose (`description`), `group`, `reach` a user-facing setting lacks; the one test behind `W_SETTING_UNDESCRIBED` and the Advanced fold. Not a validator of values, not `settingsSchemaFindings`."

## Deriver (`settingsForm.ts`)
- Genre fields (was line 277): `advanced: true` when `decl.advanced` OR the predicate flags the decl. Additive; nothing else changed.
- Pipeline fields (was 667): kept `!quick && !exposed && !fdecl.reach`; added `|| predicate({description, group: "step", reach}, {reach:false})`. A pipeline field's group is its step (always present) and its reach is the rule beside it, so only description is asked. Measured over core's story pipelines as admin: this clause folds **zero** extra fields (287 folded before and after, identical), so it is a guard for future declarations only. Ordering unchanged (the client draws the fold from `advanced`; the deriver never sorted advanced last).
- Decision: group names are not drawn (the genre group is one group), they exist for the predicate.

## Core fields: which would move, which I fixed
Before: every core genre field lacked `group`, most lacked `reach` (only `group: "Advanced"` on the author's-note `role`, a nested field, is not a top-level field). All had descriptions. Everyday fields -> fixed by declaration (group added, `reach: "owner"` added where absent; `"owner"` is the existing default, so no behaviour change):
- `registry/genres.ts` AUTO_ADVANCE_FIELD (~l.71) group Turns + reach; TURN_MODE_FIELD (~l.95) Turns + reach; CHARACTER_DETAIL_FIELD (~l.129) Reply + reach; AUTHORS_NOTE_FIELD (~l.174) Reply + reach; SIDE_CAST_FIELD (~l.236) Turns; NARRATOR_INTERJECTIONS_FIELD (~l.254) Turns; HONOR_MODE_FIELD (~l.279) Players + reach; SHOW_OUTCOMES_FIELD (~l.303) Checks + reach; chat `tools` (~l.592) Tools + reach; Lair `tone` (~l.1092), `roomsLayer`, `sanctumSteers` Story + reach; Lair `askBeforeRolling`, `autoRoll` Checks + reach.
- `shared/speechFields.ts`: `speechReadAloud`, `speechTemplate`, `speechNarratorVoice`, `sessionLanguage` group Speech (reach already owner).
Still fold (deliberately): story `tone` and `difficulty` (already `advanced: true`; tuning knobs the presets set, not changed in play). Verified by a scan of all five core genres: only those two are flagged.
New group strings (Turns, Reply, Players, Checks, Tools, Story, Speech) are 🚧 provisional names, not drawn today.

## Tests
- SDK `settings.test.ts` + `permissionGroups.test.ts` (compiler warning): 46 pass. `coreCatalog`, `presetsAsChanges`, `envoys`, `catalogueVocabulary`, `docsGraph`, `authorLaws`: pass. `tsc --noEmit` in sdk-tests clean. `sdk:build` clean (no vite dev running).
- Golden pin in `coreCatalog.test.ts` moved `6bfc98fb75e478fe` -> `b13f9eebbcb8ea4f`; proven: deleting exactly my group/reach keys from the document digests back to the old pin. Comment added in the file.
- App: `settingsForm.int.test.ts` 23/23; `appletSessions.int.test.ts` 9/9; `declaredFieldRefusal.test.ts` 3/3; app `tsc` shows no errors in my files.

## Noticed, not done
- **Everyday fields still fold: `ruleset` ("Rules") and `rigour` ("How strict")** are declared in `src/lib/server/sessions/exposure.ts` (`rulesFieldsOf`, ~l.73-93), not in core-catalog, with a description and `reach: "owner"` but no `group`. exposure.ts is not mine. Fix: add `group: "Rules"` to both. Until then they fold in every rules-playing genre. My story test filters them out with a comment; remove that filter after the fix.
- Compiler/`W_SETTING_UNDESCRIBED` still never checks `FieldDecl` inside widget settings or nested object fields (unchanged).
- `settingsForm.ts`, `settingsForm.int.test.ts`, `appletSessions.ts` fail `prettier --check` (pre-existing style, I did not format them).
- `navigation.ts` (lane C) still has its mirrored copy and comment pointing at appletSessions.ts.

## Foreign hunks
`git diff` of core-catalog showed `shared/ui/conversation/rewindStrip.ts` changes that are not mine; untouched. No edits to actingPerson.ts, sessions.ts, storyTime.ts, ask.ts.
