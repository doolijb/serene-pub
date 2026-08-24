/**
 * From cast rows to the template context's inputs.
 *
 * `buildTemplateContext` deliberately resolves nothing (see its header). This
 * is where the resolving happens: which characters appear in the cards, which
 * of them get named in `{{characterNames}}`, which scenario wins, and which of
 * the six prompt texts each field draws from.
 *
 * Every rule below is the legacy rule, and the ones that are *only* expressible
 * as a rule — the visibility filters — are reproduced here with their asymmetry
 * intact. They look like duplicates and are not:
 *
 * - the **cards** include a character who is inactive, and exclude a hidden one
 *   unless they are the speaker (index.ts:288-306);
 * - the **names** exclude a character who is inactive *or* hidden, with no
 *   exception for the speaker (index.ts:260-271).
 *
 * So an inactive character can appear in the `characters` blob while being
 * absent from `{{characterNames}}`, and the speaker can appear in the blob
 * while hidden from the joined list. Collapsing the two filters into one — the
 * obvious cleanup — changes prompts.
 */

import { SessionCharacterVisibility } from "$lib/shared/constants/SessionCharacterVisibility"
import { resolveCharacterName } from "$lib/shared/utils/resolveCharacterName"
import { joinWithAnd } from "$lib/shared/utils/joinWithAnd"
import * as F from "$lib/server/pipelines/prompt/contextFields"
import type { BuildContextInput } from "$lib/server/pipelines/prompt/templateContext"

export interface SessionCharacterRow {
	isActive?: boolean | null
	visibility?: string | null
	character: F.CharacterFields & { id?: number }
}

export interface SessionPersonaRow {
	persona: { id?: number; name: string; description: string }
}

export interface ResolveInput {
	sessionCharacters?: readonly SessionCharacterRow[]
	sessionPersonas?: readonly SessionPersonaRow[]
	promptConfig: F.PromptConfigFields
	/** Null in no-perspective (narrator) mode. */
	currentCharacterId?: number | null
	/** The session's own scenario, which wins over the character's when set. */
	sessionScenario?: string | null
	isGroup?: boolean
	narratorName?: string
	/** The narrative graph's two halves, as structure. */
	relationshipsPerspectives?: unknown
	relationshipsKnown?: unknown
	/**
	 * Which example dialogue to use, given how many there are.
	 *
	 * Supplied by the caller so the choice is recorded in the run rather than
	 * rolled inside the prompt build — see `contextFields.characterExampleDialogue`.
	 *
	 * **Defaults to the first, not to a random one.** This resolver is a Task
	 * and a Task is a function of its inputs; a `Math.random()` in here would
	 * make two runs of one pipeline produce two prompts with nothing in the
	 * receipt to explain the difference. The binding seeds this from the run id,
	 * which restores the variety without giving up the replay.
	 */
	pickExample?: (count: number) => number
	/** Lore already selected by retrieval, and the session its bindings live on. */
	characterLore?: readonly unknown[]
	session?: unknown
}

/** Card data for one character, at the visibility they are shown at. */
function compileCharacter(
	character: F.CharacterFields,
	visibility?: string | null
): Record<string, unknown> | null {
	if (visibility === SessionCharacterVisibility.HIDDEN) return null

	const card: Record<string, unknown> = {
		name: F.characterName(character),
		nickname: F.characterNickname(character)
	}
	// MINIMAL shows who they are and nothing about how they behave.
	card.description = F.characterDescription(character)
	if (visibility !== SessionCharacterVisibility.MINIMAL)
		card.personality = F.characterPersonality(character)

	// Dropped rather than left null, because these cards are stringified into
	// the prompt: a `"personality": null` is a line the model reads.
	for (const key of Object.keys(card))
		if (card[key] === undefined || card[key] === null) delete card[key]
	return card
}

export interface ResolvedContextInput extends BuildContextInput {
	/** Which example dialogue was chosen, for the receipt. */
	exampleDialogueIndex: number | null
	/**
	 * The name on the trailing assistant line the model continues from.
	 *
	 * **Not `charName`**, and the difference only shows in narrator mode.
	 * `charName` falls back to the joined cast list; this one falls back to the
	 * narrator's configured name, because the seed primes the model's next turn
	 * — and seeding it with "Alice and Cara:" teaches the model to write joint
	 * dialogue as those characters instead of narrating (index.ts:618-629).
	 */
	seedName: string
}

export function resolveContextInput(input: ResolveInput): ResolvedContextInput {
	const sessionCharacters = input.sessionCharacters ?? []
	const sessionPersonas = input.sessionPersonas ?? []
	const currentId = input.currentCharacterId ?? null
	const current =
		sessionCharacters.find((cc) => cc.character.id === currentId)
			?.character ?? null

	// Cards: the speaker is always present and always at full visibility.
	const characters = sessionCharacters
		.filter(
			(cc) =>
				cc.character.id === currentId ||
				cc.visibility !== SessionCharacterVisibility.HIDDEN
		)
		.map((cc) =>
			compileCharacter(
				cc.character,
				cc.character.id === currentId
					? SessionCharacterVisibility.VISIBLE
					: cc.visibility
			)
		)
		.filter(Boolean) as Record<string, unknown>[]

	// Names: active and not hidden, no exception for the speaker.
	const characterNames = sessionCharacters
		.filter(
			(cc) =>
				cc.isActive &&
				cc.visibility !== SessionCharacterVisibility.HIDDEN
		)
		.map((cc) => resolveCharacterName(cc.character as any))

	const personaNames = sessionPersonas.map((cp) => F.personaName(cp.persona))

	// The example dialogue is picked once and reported, so the same run
	// replayed produces the same prompt.
	let exampleDialogueIndex: number | null = null
	const dialogues = Array.isArray(current?.exampleDialogues)
		? (current!.exampleDialogues as unknown[]).filter(Boolean)
		: []
	const exampleDialogue = F.characterExampleDialogue(current, (n) => {
		const chosen = input.pickExample ? input.pickExample(n) : 0
		exampleDialogueIndex = Math.min(Math.max(chosen, 0), n - 1)
		return exampleDialogueIndex
	})
	if (!dialogues.length) exampleDialogueIndex = null

	return {
		characters: characters as any,
		personas: sessionPersonas.map((cp) => ({
			name: F.personaName(cp.persona),
			description: F.personaDescription(cp.persona)
		})),
		characterNames,
		personaNames,
		// No single speaker in narrator mode: `{{char}}` becomes the cast list,
		// the same convention `{{characterNames}}` follows (index.ts:623-625).
		charName: current
			? resolveCharacterName(current as any)
			: joinWithAnd(characterNames),
		// One persona when someone is speaking; the whole list when nobody is.
		// The `"user"` fallback is the legacy default rather than an empty
		// string — a card that says "you are talking to {{user}}" should not
		// render "you are talking to ." (index.ts:630-633).
		personaName: current
			? (personaNames[0] ?? "user")
			: joinWithAnd(personaNames),
		narratorName: input.narratorName,
		scenario: resolveScenario(input, current),
		relationshipsPerspectives: input.relationshipsPerspectives,
		relationshipsKnown: input.relationshipsKnown,
		texts: {
			instructions: F.systemPrompt(input.promptConfig),
			exampleDialogue,
			// The same value as `exampleDialogue` today (index.ts:340), kept as
			// its own field because they render in different places.
			charExampleDialogue: exampleDialogue,
			postHistoryInstructions: F.postHistoryInstructions(
				input.promptConfig,
				current
			),
			promptPostHistoryInstructions: F.promptPostHistoryInstructions(
				input.promptConfig
			),
			charPostHistory: F.charPostHistory(current)
		},
		characterLore: input.characterLore as any,
		session: input.session,
		exampleDialogueIndex,
		seedName: current
			? resolveCharacterName(current as any)
			: input.narratorName || "Narrator"
	}
}

/**
 * Session scenario, then group-means-none, then the character's.
 *
 * The middle case is not a fallthrough: a group session with no scenario of its
 * own renders **no** scenario rather than one member's, because one member's
 * scenario describes a situation the rest of the cast is not in
 * (index.ts:364-383).
 */
function resolveScenario(
	input: ResolveInput,
	current: F.CharacterFields | null
): string {
	if (input.sessionScenario) return input.sessionScenario
	if (input.isGroup) return ""
	return F.characterScenario(current) ?? ""
}
