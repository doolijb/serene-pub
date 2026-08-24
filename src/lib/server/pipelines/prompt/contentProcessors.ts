/**
 * Turning a stored session row's text into the text a model sees.
 *
 * Two transforms, both applied on the way *out* of the database and never on
 * the way in: macro interpolation ({{char}}, {{user}}) against the speaking
 * character, and swipe selection — a message row carries every swipe, and only
 * the active one is rendered. The stored row is left alone so a swipe can be
 * re-picked and a macro re-resolved against a renamed character.
 *
 * Used by `messages.ts` for the session transcript and by `postHistory.ts` for the
 * block that follows it, which is why it lives apart from either.
 */
import type { InterpolationContext } from "$lib/server/utils/interpolation/InterpolationEngine"
import {
	resolveCharacterName,
	resolvePersonaName
} from "$lib/shared/utils/resolveCharacterName"

// Define processed session message format
export interface ProcessedSessionMessage {
	id: number
	role: "assistant" | "user"
	name: string
	message: string | undefined
}

/**
 * Base interface for content processors that handle specific content types
 */
export interface ContentProcessor<TInput, TOutput = TInput> {
	/**
	 * Process an individual content item
	 */
	processItem(
		item: TInput,
		context: {
			interpolationContext: InterpolationContext
			charName: string
			personaName: string
			priority: number
		}
	): TOutput | null

	/**
	 * Check if an item should be included based on priority and other criteria
	 */
	shouldInclude(item: TInput, priority: number): boolean
}

/**
 * Processes session messages with interpolation and role/name assignment
 */
export class SessionMessageProcessor
	implements ContentProcessor<SelectSessionMessage, ProcessedSessionMessage>
{
	constructor(
		private session: any, // BasePromptSession type
		private interpolationEngine: any // InterpolationEngine type
	) {}

	processItem(
		message: SelectSessionMessage,
		context: {
			interpolationContext: InterpolationContext
			charName: string
			personaName: string
			priority: number
		}
	): ProcessedSessionMessage | null {
		const { interpolationContext, charName, personaName } = context

		// Create message-specific interpolation context
		let msgInterpolationContext = { ...interpolationContext }
		let assistantName = charName
		let userName = personaName

		// Narrator response messages have no characterId/personaId of their own
		// to resolve a name from — without this, they fall through to
		// whichever name this call's default happens to be (the *current*
		// speaking character, or the joined cast list in no-perspective
		// mode), mislabeling every past narration line in history with the
		// wrong speaker. Use the name snapshotted on the message itself
		// (set once at trigger time, matching how it's displayed) instead.
		if ((message as any).isNarratorResponse) {
			const narratorName =
				(message.metadata as any)?.narratorName || "Narrator"
			assistantName = narratorName
			msgInterpolationContext = {
				...msgInterpolationContext,
				char: narratorName,
				character: narratorName
			}
		}
		// Handle character-specific context
		else if (message.characterId) {
			// Active participants first; a removed participant's row won't
			// be in this.session.sessionCharacters (getPromptSessionFromDb filters it
			// out for every "who's active" consumer), but their past
			// messages still need to resolve a name — fall back to the
			// separately-supplied removed list, then to the removedAt-time
			// name snapshot if the entity itself has since been deleted
			// globally too.
			const foundChar = this.session.sessionCharacters?.find(
				(cc: any) => cc.character.id === message.characterId
			)?.character
			let foundName: string | undefined
			if (foundChar) {
				foundName = resolveCharacterName(foundChar)
			} else {
				const removedCC = this.session.removedSessionCharacters?.find(
					(cc: any) => cc.characterId === message.characterId
				)
				if (removedCC) {
					foundName = resolveCharacterName(
						removedCC.character,
						removedCC.removedName ?? "Unknown"
					)
				}
			}
			if (message.role === "assistant") {
				assistantName = foundName || charName
			}
			msgInterpolationContext = {
				...msgInterpolationContext,
				char: foundName || charName,
				character: foundName || charName
			}
		}

		// Handle persona-specific context
		if (message.personaId) {
			const foundPersona = this.session.sessionPersonas?.find(
				(cp: any) => cp.persona.id === message.personaId
			)?.persona
			let foundName: string | undefined
			if (foundPersona) {
				foundName = resolvePersonaName(foundPersona)
			} else {
				const removedCP = this.session.removedSessionPersonas?.find(
					(cp: any) => cp.personaId === message.personaId
				)
				if (removedCP) {
					foundName = resolvePersonaName(
						removedCP.persona,
						removedCP.removedName ?? "Unknown"
					)
				}
			}
			if (foundName) {
				userName = foundName
				msgInterpolationContext = {
					...msgInterpolationContext,
					user: userName,
					persona: userName
				}
			}
		}

		return {
			id: message.id,
			role:
				message.role === "user" || message.role === "assistant"
					? message.role
					: "assistant",
			name: message.role === "assistant" ? assistantName : userName,
			message: this.interpolationEngine.interpolateString(
				message.content,
				msgInterpolationContext
			)
		}
	}

	shouldInclude(message: SelectSessionMessage, priority: number): boolean {
		// Messages can be included at any priority
		return true
	}
}
