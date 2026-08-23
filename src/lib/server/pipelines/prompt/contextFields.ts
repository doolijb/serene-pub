/**
 * The rules that decide *which text* goes in each prompt field.
 *
 * These were methods on `PromptBuilder` reading `this.promptConfig` and the
 * current character. They are extracted here as functions over their actual
 * inputs so the pipeline path and the legacy path can share one implementation
 * rather than each carrying a copy — two copies of "which post-history text
 * wins in narrator mode" is the kind of divergence that shows up as a user
 * saying the new path "feels different" with nothing in a diff to point at.
 *
 * `PromptBuilder` now delegates to these, so it stays the single caller-facing
 * surface while the rules live in one place.
 *
 * Nothing here interpolates, reads a database, or picks a scenario source.
 * Field selection only.
 */

/** The subset of a prompt config these rules read. */
export interface PromptConfigFields {
	systemPrompt?: string
	/** Present on character *and* narrator configs; both carry the column. */
	postHistoryInstructions?: string
}

/** The subset of a character these rules read. */
export interface CharacterFields {
	name?: string
	nickname?: string | null
	description?: string
	personality?: string | null
	scenario?: string | null
	postHistoryInstructions?: string | null
	exampleDialogues?: unknown
}

export const characterDescription = (c: CharacterFields): string =>
	c.description as string

export const characterPersonality = (c: CharacterFields): string | undefined =>
	c?.personality || undefined

export const characterScenario = (
	c: CharacterFields | null
): string | undefined => c?.scenario || undefined

export const characterName = (c: CharacterFields): string => c.name as string

export const characterNickname = (c: CharacterFields): string | undefined =>
	c.nickname || undefined

export const personaName = (p: { name: string }): string => p.name

export const personaDescription = (p: { description: string }): string =>
	p.description

export const systemPrompt = (config: PromptConfigFields): string =>
	config.systemPrompt as string

/**
 * How one example dialogue is chosen from the character's set.
 *
 * **The pick is a parameter, not a call to `Math.random()`.** The legacy method
 * rolled the die itself, which has two costs the pipeline cannot absorb: two
 * compilations of the same turn produce different prompts, so a parity check
 * against the legacy path can never be byte-for-byte; and a run's receipt
 * cannot explain the prompt it produced, because the deciding input was never
 * recorded anywhere.
 *
 * Passing the chooser in keeps the behaviour — a uniform pick over the valid
 * dialogues — while letting the pipeline seed it from the run id and write the
 * index into the receipt. The default is the legacy behaviour exactly, so the
 * old path is unchanged by this extraction.
 */
export function characterExampleDialogue(
	c: CharacterFields | null,
	pick: (count: number) => number = (n) => Math.floor(Math.random() * n)
): string | undefined {
	if (!c?.exampleDialogues || !Array.isArray(c.exampleDialogues))
		return undefined
	const valid = (c.exampleDialogues as unknown[]).filter(Boolean)
	if (valid.length === 0) return undefined
	const index = Math.min(Math.max(pick(valid.length), 0), valid.length - 1)
	return valid[index] as string
}

/**
 * The top-level `postHistoryInstructions` variable.
 *
 * A character's own field wins. With no current character the mode is narrator
 * (no-perspective), and the narrator config's field is the fallback — the
 * config row at runtime is `narratorPromptConfigs`, which carries the column
 * even though the declared type does not.
 */
export function postHistoryInstructions(
	config: PromptConfigFields,
	character: CharacterFields | null
): string | undefined {
	if (character?.postHistoryInstructions)
		return character.postHistoryInstructions
	if (!character) return config.postHistoryInstructions || undefined
	return undefined
}

/**
 * The prompt config's own reinforcement text — the one placed next to the seed.
 *
 * Distinct from `postHistoryInstructions` above: this one never falls back to
 * the character, and applies uniformly to character and narrator configs. The
 * two land in different places in the rendered prompt, which is why they are
 * resolved separately even though they often carry the same string.
 */
export const promptPostHistoryInstructions = (
	config: PromptConfigFields
): string | undefined => config.postHistoryInstructions || undefined

/** The character's own authored reinforcement field, with no config fallback. */
export const charPostHistory = (
	character: CharacterFields | null
): string | undefined => character?.postHistoryInstructions || undefined
