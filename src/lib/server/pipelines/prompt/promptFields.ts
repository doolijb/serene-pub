/**
 * From cast rows to the template context's inputs.
 *
 * `buildTemplateContext` deliberately resolves nothing (see its header). This
 * is where the resolving happens: which characters appear in the cards, which
 * of them get named in `{{characterNames}}`, which scenario wins, and which of
 * the six prompt texts each field draws from.
 *
 * Every rule below is the legacy rule, and the ones that are *only* expressible
 * as a rule — the detail and enabled filters — are reproduced here with their
 * asymmetry intact. They look like duplicates and are not:
 *
 * - the **cards** include a character who is switched off (`enabled: false`),
 *   and at `characterDetail: speaker-only` exclude everyone but the speaker;
 * - the **names** exclude a character who is switched off, and at
 *   `speaker-only` exclude everyone — with no exception for the speaker.
 *
 * So a switched-off character can appear in the `characters` blob while being
 * absent from `{{characterNames}}`. Collapsing the two filters into one — the
 * obvious cleanup — changes prompts.
 *
 * ⚠ `characterDetail` replaced the per-character `session_characters.visibility`
 * (retired 2026-09-27): the same three levels, now one genre field for the
 * whole cast rather than a switch per seat. The levels keep the old rules
 * exactly — `brief` is the old *minimal* (name, nickname and description; no
 * personality), `speaker-only` the old *hidden* — so a session that never
 * touched the old switch renders byte for byte what it did.
 */

import { resolveCharacterName } from "$lib/shared/utils/resolveCharacterName"
import { joinWithAnd } from "$lib/shared/utils/joinWithAnd"
import * as F from "$lib/server/pipelines/prompt/contextFields"
import { resolveSeedLine } from "$lib/server/pipelines/prompt/seedLine"
import { ownVoiceName } from "$lib/shared/sessions/ownVoiceName"
import type { ChannelVoice } from "$lib/server/messages/channels"
import type { BuildContextInput } from "$lib/server/pipelines/prompt/templateContext"

/**
 * How much of a non-speaking character's card the prompt shows — the stored
 * values of the genre field `characterDetail` (Chat, Adventure; 2026-09-27).
 * The speaker's own card is always `full`, whatever the level.
 */
export const CHARACTER_DETAIL = {
	/** Name, nickname, description and personality. The default. */
	FULL: "full",
	/** Name, nickname and description — who they are, not how they behave. */
	BRIEF: "brief",
	/** No card and no name for anyone but the speaker. */
	SPEAKER_ONLY: "speaker-only"
} as const

export type CharacterDetail =
	(typeof CHARACTER_DETAIL)[keyof typeof CHARACTER_DETAIL]

/** A stored value read as a level; anything unrecognised is `full`. */
export function characterDetailOf(value: unknown): CharacterDetail {
	return value === CHARACTER_DETAIL.BRIEF ||
		value === CHARACTER_DETAIL.SPEAKER_ONLY
		? value
		: CHARACTER_DETAIL.FULL
}

export interface SessionCharacterRow {
	/** The seat is switched on in the cast list. Absent reads as on. */
	enabled?: boolean | null
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
	/**
	 * The cast read's envoys — seated (`envoys`) and declared-only
	 * (`declaredEnvoys`) — for the one thing this resolver takes from them:
	 * the own voice's name on the seed line (lair re-plan R5), which is the
	 * genre's fallback envoy when it declares one.
	 */
	envoys?: ReadonlyArray<{ name?: unknown; fallback?: boolean }>
	declaredEnvoys?: ReadonlyArray<{ name?: unknown; fallback?: boolean }>
	/**
	 * The side character speaking this turn (ruling 2026-09-07) — a
	 * **participant without a turn slot**.
	 *
	 * Read only when `currentCharacterId` names nobody in the cast, which is
	 * the whole of "not a cast member": if the pick happens to be a cast member
	 * the ordinary branch finds them and this is never consulted, so there is
	 * one answer for a speaker rather than two that could disagree.
	 *
	 * It supplies `{{char}}` and the seed line, and nothing else. It is
	 * deliberately **not** added to `characterNames`: that list is the cast
	 * roster — the people this speaker must not write dialogue for — and a
	 * side character is not on it. The shipped side-character prompt says so in
	 * as many words, which it could not if the two collapsed.
	 */
	speakerName?: string | null
	/**
	 * That side character's card, when the trigger picked a real character
	 * rather than typing a name.
	 *
	 * Rendered in full beside the cast's cards, because a model
	 * asked to speak as somebody needs to know who they are — that is what
	 * "first-class presence" means in a prompt. Absent for a free-form name,
	 * where there is no card to render and the name is all there is.
	 */
	speakerCharacter?: (F.CharacterFields & { id?: number }) | null
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
	/**
	 * The voice of the channel this turn was **triggered on** (R-C,
	 * 2026-09-17) — `narrator` puts the narrator's name on the seed line
	 * whoever is seated, `character` and absence leave it where it was.
	 *
	 * Arrives on the cast read, because that is the one value both this node
	 * and `core:task/process-messages@1` are wired to; the host resolves it
	 * from the turn's channel and the genre's declarations. Absent for every
	 * genre that shapes no channel, which is what keeps the resolved name
	 * byte-identical for them.
	 */
	turnChannelVoice?: ChannelVoice
	/**
	 * The session's `characterDetail` genre field, on the cast read (host,
	 * `case "session_cast"`). Absent — a genre that declares no such field —
	 * is `full`, which is what every character rendered at before it existed.
	 */
	characterDetail?: unknown
}

/** Card data for one character, at the detail they are shown at. */
function compileCharacter(
	character: F.CharacterFields,
	detail: CharacterDetail
): Record<string, unknown> | null {
	if (detail === CHARACTER_DETAIL.SPEAKER_ONLY) return null

	const card: Record<string, unknown> = {
		name: F.characterName(character),
		nickname: F.characterNickname(character)
	}
	// BRIEF shows who they are and nothing about how they behave.
	card.description = F.characterDescription(character)
	if (detail !== CHARACTER_DETAIL.BRIEF)
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

	const detail = characterDetailOf(input.characterDetail)

	// Cards: the speaker is always present and always in full.
	const characters = sessionCharacters
		.map((cc) =>
			compileCharacter(
				cc.character,
				cc.character.id === currentId ? CHARACTER_DETAIL.FULL : detail
			)
		)
		.filter(Boolean) as Record<string, unknown>[]

	// The side character's card, first, in full — the same terms the
	// speaking cast member gets. Only when they are genuinely outside the
	// cast: `current` finding them means the loop above already rendered them,
	// and rendering twice would put one person in the prompt as two.
	const sideCard =
		!current && input.speakerCharacter
			? compileCharacter(input.speakerCharacter, CHARACTER_DETAIL.FULL)
			: null
	if (sideCard) characters.unshift(sideCard)

	// Names: switched on, and not at `speaker-only` — no exception for the
	// speaker (the old *hidden* rule, kept exactly).
	const characterNames =
		detail === CHARACTER_DETAIL.SPEAKER_ONLY
			? []
			: sessionCharacters
					.filter((cc) => cc.enabled !== false)
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
		// The speaker's name, then the side character's, then the cast list.
		// The middle rung is what makes `{{char}}` mean the shopkeeper on a
		// side-character turn instead of "Alice and Cara" — which is the joined
		// list the no-perspective narrator wants and the one thing a turn
		// spoken by a person must not say.
		charName: current
			? resolveCharacterName(current as any)
			: input.speakerName || joinWithAnd(characterNames),
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
		// The name half of the seed decision (`prompt/seedLine.ts`). The
		// other half — whether the row is written at all — is read off the
		// same rule by `processMessages`, which is the node that writes it.
		seedName: resolveSeedLine({
			voice: input.turnChannelVoice,
			characterName: current
				? resolveCharacterName(current as any)
				: null,
			speakerName: input.speakerName,
			// The pipeline's own voice (R5): the genre's fallback envoy —
			// seated or only declared, off the cast read — else this
			// prompt's narrator name. English: the prompt is what the
			// model reads, and `en` is the entry every locale map has.
			ownVoiceName: ownVoiceName({
				envoys: [...(input.envoys ?? []), ...(input.declaredEnvoys ?? [])],
				narratorName: input.narratorName
			})
		}).name
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
