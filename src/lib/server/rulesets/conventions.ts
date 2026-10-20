/**
 * 🚧 A session's ruleset settings → the conventions it plays by.
 *
 * The SDK owns the rule (`rulesetSettingValues`, `rulesetPresetOf`,
 * `rulesetConventionsFor`: each setting's default, a preset's values, the
 * session's own, then each chosen choice's `conventions` laid over the
 * ruleset's key by key); these are the handler's names for them.
 *
 * A session's values live on `sessions.ruleset_settings` (0105, keyed by
 * ruleset; written by `sessions:setRulesetSettings` — `settings.ts`); the
 * handler reads them for the session's ruleset and plays a setting the
 * session left unsaid at its default.
 */

import {
	rulesetConventionsFor,
	rulesetPresetOf,
	rulesetSettingValues,
	type RulesetConventions,
	type RulesetDecl
} from "@serene-pub/sdk"

/** Each setting's default, then a preset's values, then the session's own — unknown names and choices fall through. */
export const settingValues = (
	decl: RulesetDecl,
	chosen: { preset?: string; values?: Readonly<Record<string, string>> } = {}
): Record<string, string> => rulesetSettingValues(decl, chosen)

/** The preset whose values these are exactly, if any. */
export const presetOf = (decl: RulesetDecl, values: Readonly<Record<string, string>>): string | undefined =>
	rulesetPresetOf(decl, values)

/** The ruleset's conventions with each chosen setting's choice laid over. */
export const conventionsFor = (decl: RulesetDecl, values: Readonly<Record<string, string>> = {}): RulesetConventions =>
	rulesetConventionsFor(decl, values)
