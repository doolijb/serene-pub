import type { InterpolationContext } from "./InterpolationEngine"
import { resolveCharacterName } from "$lib/shared/utils/resolveCharacterName"

// Define processed chat message format
export interface ProcessedChatMessage {
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
 * Processes chat messages with interpolation and role/name assignment
 */
export class ChatMessageProcessor
	implements ContentProcessor<SelectChatMessage, ProcessedChatMessage>
{
	constructor(
		private chat: any, // BasePromptChat type
		private interpolationEngine: any // InterpolationEngine type
	) {}

	processItem(
		message: SelectChatMessage,
		context: {
			interpolationContext: InterpolationContext
			charName: string
			personaName: string
			priority: number
		}
	): ProcessedChatMessage | null {
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
		else if (message.characterId && this.chat.chatCharacters) {
			const foundChar = this.chat.chatCharacters.find(
				(cc: any) => cc.character.id === message.characterId
			)?.character
			let foundName: string | undefined
			if (foundChar) {
				foundName = resolveCharacterName(foundChar)
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
		if (message.personaId && this.chat.chatPersonas) {
			const foundPersona = this.chat.chatPersonas.find(
				(cp: any) => cp.persona.id === message.personaId
			)?.persona
			if (foundPersona) {
				userName = foundPersona.name
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

	shouldInclude(message: SelectChatMessage, priority: number): boolean {
		// Messages can be included at any priority
		return true
	}
}
