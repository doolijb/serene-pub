/**
 * The template context, built from Query results instead of a hydrated chat.
 *
 * This is the last coupling in the prompt path. `PromptBuilder.buildTemplateContext`
 * reads `this.assistantCharacters`, `this.userCharacters`, `this.chat` and
 * `this.interpolationEngine`, so it can only run where all four already exist —
 * which is the reason the whole prompt path has to be constructed before any of
 * it can be used.
 *
 * Here the same object is produced from explicit arguments. The rule applied
 * throughout is: **this builder resolves nothing.** Which characters are
 * visible, which scenario wins between the chat's and the character's, which
 * post-history text belongs to the speaker — every one of those is a decision
 * with its own rules, and every one of them is made upstream and handed in. The
 * builder interpolates, joins, stringifies and assembles a shape. That is what
 * makes it a Task (F11 — a Task is handed no services), and it is also what
 * makes a parity failure localisable: if the output differs, either an input
 * differed or the interpolation differed, and those are separable.
 *
 * **Interpolation is the legacy engine, deliberately.** `InterpolationEngine`
 * expands `{{char}}`, `{{user}}` and the card macros, and reimplementing that
 * would produce a context that differs from the legacy path in ways only a user
 * with an unusual character card would find. Same engine, same fields, same JSON
 * formatting — so a difference in output is a difference in *inputs*.
 */

import { InterpolationEngine } from "$lib/server/utils/interpolation/InterpolationEngine"
import { attachCharacterLoreToCharacters } from "$lib/server/pipelines/prompt/characterLore"
import { joinWithAnd } from "$lib/shared/utils/joinWithAnd"
import type { TemplateContext } from "$lib/server/pipelines/prompt/promptTypes"
import { renderVariable, type ResolvedLayouts } from "$lib/server/pipelines/entities/variableLayouts"

export interface CharacterRow {
	id?: number
	name: string
	nickname?: string | null
	description?: string | null
	personality?: string | null
	[key: string]: unknown
}

export interface PersonaRow {
	id?: number
	name: string
	description?: string | null
	[key: string]: unknown
}

/**
 * The six prompt texts, already resolved.
 *
 * They are six rather than three because the legacy path keeps three pairs
 * apart, and collapsing any pair changes the prompt:
 *
 * - `exampleDialogue` / `charExampleDialogue` — the top-level variable and the
 *   copy that travels inside `postHistory`. Today the builder assigns them the
 *   same value (index.ts:340), but they are read by different templates and a
 *   character-specific example set is the obvious next thing to diverge.
 * - `postHistoryInstructions` / `promptPostHistoryInstructions` — the prompt
 *   *config's* instructions and the ones the renderer places next to the seed.
 *   `postHistory.instructions` is the second one. Feeding it the first is the
 *   mistake this split exists to prevent.
 * - `charPostHistory` — the speaking character's own reinforcement text, which
 *   is resolved from the current character, not looked up by name from the cast.
 */
export interface PromptTexts {
	instructions?: string
	exampleDialogue?: string
	postHistoryInstructions?: string
	charExampleDialogue?: string
	promptPostHistoryInstructions?: string
	charPostHistory?: string
}

export interface BuildContextInput {
	/** Characters the assistant speaks as, compiled and carrying visibility. */
	characters: readonly CharacterRow[]
	personas: readonly PersonaRow[]
	/**
	 * Display names for `{{characterNames}}` — **the visible, active subset**,
	 * resolved upstream.
	 *
	 * Deliberately not derived from `characters`: the blob above includes
	 * hidden characters (carrying their visibility), while the joined list must
	 * not name them. Deriving one from the other would silently leak a hidden
	 * character's name into every prompt.
	 */
	characterNames: readonly string[]
	/** Display names for `{{personaNames}}`, resolved upstream. */
	personaNames: readonly string[]
	/** Whose turn it is — `{{char}}` and `{{character}}`. */
	charName: string
	/** Who they are speaking to — `{{user}}` and `{{persona}}`. */
	personaName: string
	/** Narrator mode's configured display name, for `{{narratorName}}`. */
	narratorName?: string
	texts?: PromptTexts
	/** The winning scenario text, already chosen between chat and character. */
	scenario?: string | null
	/**
	 * The narrative graph, as structure, in two halves.
	 *
	 * Was one `speakerRelationships` string, because `buildGraphContext`
	 * stringified before this saw it. The layouts do that now, so what arrives
	 * here is the shape — which is what makes a prose rendering of somebody's
	 * relationships possible at all — and it arrives as two values, because
	 * "how they see everyone" and "how everyone sees them" are opposite claims
	 * that shared one heading, one layout and one switch.
	 */
	relationshipsPerspectives?: unknown
	relationshipsKnown?: unknown
	/** Character lore to fold into the cards. Empty on the current path. */
	characterLore?: readonly SelectCharacterLoreEntry[]
	/** Needed only to map lore bindings onto cast members. */
	chat?: unknown
	/**
	 * The `variables` slot, resolved through the scope chain and dereferenced
	 * into template sources by `world.ts`.
	 *
	 * Absent, empty, or missing a key all mean the same thing — use the in-code
	 * expression — so this stays optional and every render site keeps its
	 * default. See `variableLayouts.ts`.
	 */
	variables?: ResolvedLayouts
}

export class TemplateContextError extends Error {}

/** A chat with no cast: the lore attachment finds nothing, and says nothing. */
const EMPTY_CHAT = { chatCharacters: [], chatPersonas: [] }

/**
 * Build the context a context template renders against.
 *
 * Returns the legacy `TemplateContext` shape exactly, minus
 * `__promptBuilderInstance` — that field is a back-reference the infill engines
 * used to reach back into the builder, and its absence here is the coupling
 * being removed rather than an omission. A pipeline node cannot reach back into
 * anything; everything it needs arrived on a port.
 */
export function buildTemplateContext(
	input: BuildContextInput
): TemplateContext {
	const interpolation = new InterpolationEngine()
	const texts = input.texts ?? {}

	// The legacy context, built by the legacy method rather than reproduced as
	// an object literal — so that a field added to it arrives here too instead
	// of quietly going missing.
	const interpolationContext = interpolation.createInterpolationContext({
		currentCharacterName: input.charName,
		currentPersonaName: input.personaName,
		additionalContext: {
			characterNames: joinWithAnd([...input.characterNames]),
			personaNames: joinWithAnd([...input.personaNames]),
			narratorName: input.narratorName
		}
	})

	const characters = input.characters.map((c) =>
		interpolation.interpolateObject(c as any, interpolationContext, [
			"name",
			"nickname",
			"description",
			"personality"
		])
	)
	const personas = input.personas.map((p) =>
		interpolation.interpolateObject(p as any, interpolationContext, [
			"name",
			"description"
		])
	)

	// Personas go through the *character* helper, matching index.ts:720. A
	// sibling `attachCharacterLoreToPersonas` used to exist and was called from
	// nowhere at all; it was deleted in the dead-code sweep rather than wired in
	// here, because using it would have been a behaviour change wearing the
	// costume of a bug fix. Persona lore still never attaches on any live path.
	const lore = input.characterLore ?? []
	if (lore.length && !input.chat)
		throw new TemplateContextError(
			`character lore was supplied without a chat. The bindings that say which ` +
				`character a lore entry belongs to live on the chat's lorebook, so without ` +
				`it every entry would be silently dropped and the prompt would come out ` +
				`short with nothing to show for it.`
		)
	const chat = (input.chat ?? EMPTY_CHAT) as any

	const charactersWithLore = attachCharacterLoreToCharacters(
		characters,
		lore as any,
		chat
	)
	const personasWithLore = attachCharacterLoreToCharacters(
		personas as any,
		lore as any,
		chat
	)

	const interpolate = (s: string | null | undefined): string =>
		interpolation.interpolateString(s ?? "", interpolationContext) ?? ""

	const postHistoryInstructions = interpolate(texts.postHistoryInstructions)
	const promptPostHistoryInstructions = interpolate(
		texts.promptPostHistoryInstructions
	)
	const charPostHistory = interpolate(texts.charPostHistory)
	const charExampleDialogue = interpolate(texts.charExampleDialogue)

	/**
	 * Each top-level variable now goes through its selected layout, and the
	 * expression that used to be here is that layout's floor.
	 *
	 * The shipped layouts reproduce the old code byte for byte — `characters`
	 * was `JSON.stringify(x, null, 2)` and its shipped source is
	 * `{{{json characters 2}}}`, which is the same bytes — so an install that
	 * has changed nothing gets exactly the prompt it got before. The
	 * indentation is not a formatting detail: the default context templates
	 * consume these as raw JSON and the whitespace goes to the model.
	 *
	 * These stay **strings**. Not for a test's sake: every existing install has
	 * `context_configs.template` rows containing `{{{characters}}}`, and handing
	 * that an array would render `[object Object],[object Object]` in every
	 * user's template. Presentation moves into the layout; the type on the way
	 * out does not move at all.
	 */
	const layout = (key: string, value: unknown) =>
		renderVariable(input.variables, key, value)

	return {
		instructions: layout("instructions", interpolate(texts.instructions)),
		relationshipsPerspectives: layout(
			"relationshipsPerspectives",
			input.relationshipsPerspectives
		),
		relationshipsKnown: layout(
			"relationshipsKnown",
			input.relationshipsKnown
		),
		characters: layout("characters", charactersWithLore),
		personas: layout("personas", personasWithLore),
		characterNames: layout(
			"characterNames",
			interpolationContext.characterNames
		),
		personaNames: layout("personaNames", interpolationContext.personaNames),
		scenario: layout("scenario", interpolate(input.scenario)),
		// Empty string rather than undefined. The legacy path leaves these
		// `undefined` when the config has no text; both render as nothing and
		// both are falsy under `{{#if}}`, so the prompt is unchanged — but a
		// context that is inspected before it renders should not show a hole
		// where "the config has no example dialogue" is the actual answer.
		exampleDialogue: layout(
			"exampleDialogue",
			interpolate(texts.exampleDialogue)
		),
		postHistoryInstructions: layout(
			"postHistoryInstructions",
			postHistoryInstructions
		),
		// `targetIndex` is a placeholder here exactly as it is in the legacy
		// builder: the final message array is not known until allocation has
		// run, so Assemble overwrites it. Left in rather than omitted so the
		// shape is stable for a template that reads it.
		postHistory: {
			targetIndex: 0,
			instructions: promptPostHistoryInstructions || undefined,
			charInstructions: charPostHistory || undefined,
			exampleDialogue: charExampleDialogue || undefined,
			hasContent: Boolean(
				promptPostHistoryInstructions ||
					charPostHistory ||
					charExampleDialogue
			)
		},
		chatMessages: [],
		char: input.charName,
		character: input.charName,
		user: input.personaName,
		persona: input.personaName
	}
}
