import type { InterpolationContext } from './InterpolationEngine'
import type { LoreMatchingStrategy } from './LoreMatchingStrategies'

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
export class ChatMessageProcessor implements ContentProcessor<SelectChatMessage, ProcessedChatMessage> {
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
		
		// Handle character-specific context
		if (message.characterId && this.chat.chatCharacters) {
			const foundChar = this.chat.chatCharacters.find(
				(cc: any) => cc.character.id === message.characterId
			)?.character
			let foundName: string | undefined
			if (foundChar) {
				foundName = foundChar.nickname || foundChar.name
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
			role: message.role === "user" || message.role === "assistant" ? message.role : "assistant",
			name: message.role === "assistant" ? assistantName : userName,
			message: this.interpolationEngine.interpolateString(message.content, msgInterpolationContext)
		}
	}
	
	shouldInclude(message: SelectChatMessage, priority: number): boolean {
		// Messages can be included at any priority
		return true
	}
}

/**
 * Processes world lore entries with lorebook binding population
 */
export class WorldLoreProcessor implements ContentProcessor<SelectWorldLoreEntry> {
	constructor(
		private chat: any, // BasePromptChat type
		private populateLorebookEntryBindings: (entry: SelectWorldLoreEntry, chat: any) => SelectWorldLoreEntry
	) {}
	
	processItem(
		entry: SelectWorldLoreEntry,
		context: {
			interpolationContext: InterpolationContext
			charName: string
			personaName: string
			priority: number
		}
	): SelectWorldLoreEntry | null {
		return this.populateLorebookEntryBindings(entry, this.chat)
	}
	
	shouldInclude(entry: SelectWorldLoreEntry, priority: number): boolean {
		// High priority entries are always included
		if (priority === 4) return true
		
		// Lower priority entries need to pass additional checks
		return true // Can be extended with more sophisticated logic
	}
}

/**
 * Processes character lore entries with lorebook binding population
 */
export class CharacterLoreProcessor implements ContentProcessor<SelectCharacterLoreEntry> {
	constructor(
		private chat: any, // BasePromptChat type
		private populateLorebookEntryBindings: (entry: SelectCharacterLoreEntry, chat: any) => SelectCharacterLoreEntry
	) {}
	
	processItem(
		entry: SelectCharacterLoreEntry,
		context: {
			interpolationContext: InterpolationContext
			charName: string
			personaName: string
			priority: number
		}
	): SelectCharacterLoreEntry | null {
		return this.populateLorebookEntryBindings(entry, this.chat)
	}
	
	shouldInclude(entry: SelectCharacterLoreEntry, priority: number): boolean {
		// High priority entries are always included
		if (priority === 4) return true
		
		// Lower priority entries need to pass additional checks
		return true // Can be extended with more sophisticated logic
	}
}

/**
 * Processes history entries with lorebook binding population and date validation
 */
export class HistoryEntryProcessor implements ContentProcessor<SelectHistoryEntry> {
	constructor(
		private chat: any, // BasePromptChat type
		private populateLorebookEntryBindings: (entry: SelectHistoryEntry, chat: any) => SelectHistoryEntry,
		private isHistoryEntry: (entry: any) => entry is SelectHistoryEntry
	) {}
	
	processItem(
		entry: SelectHistoryEntry,
		context: {
			interpolationContext: InterpolationContext
			charName: string
			personaName: string
			priority: number
		}
	): SelectHistoryEntry | null {
		if (!this.isHistoryEntry(entry)) {
			return null
		}
		
		const populated = this.populateLorebookEntryBindings(entry, this.chat)
		
		// Validate that it's still a history entry after population
		if ("date" in populated) {
			return populated as SelectHistoryEntry
		}
		
		return null
	}
	
	shouldInclude(entry: SelectHistoryEntry, priority: number): boolean {
		// High priority entries are always included
		if (priority === 4) return true
		
		// Check if entry has valid date information
		return entry.year !== undefined && entry.year !== null
	}
}

/**
 * Handles matching logic for lore entries against chat messages
 * Now uses pluggable matching strategies
 */
export class LoreMatchingEngine {
	constructor(private strategy: LoreMatchingStrategy) {}

	/**
	 * Update the matching strategy at runtime
	 */
	setStrategy(strategy: LoreMatchingStrategy): void {
		this.strategy = strategy
	}

	/**
	 * Get the current strategy name for debugging
	 */
	getStrategyName(): string {
		return this.strategy.getName()
	}

	/**
	 * Check if a lore entry matches a chat message using the current strategy
	 */
	async matchesMessage(
		entry: SelectWorldLoreEntry | SelectCharacterLoreEntry | SelectHistoryEntry,
		message: { id: number; message: string | undefined },
		context?: {
			interpolationContext: InterpolationContext
			chatMessages: Array<{ id: number; message: string | undefined }>
			failedMatches: Record<number, number[]>
		}
	): Promise<boolean> {
		return await this.strategy.matchesMessage(entry, message, context)
	}
	
	/**
	 * Process all matching for a set of messages against considered entries
	 */
	async processMatching<TInput, TOutput = TInput>(
		chatMessages: Array<{ id: number; message: string | undefined }>,
		consideredEntries: TInput[],
		failedMatches: Record<number, number[]>,
		processor: ContentProcessor<TInput, TOutput>,
		context: {
			interpolationContext: InterpolationContext
			charName: string
			personaName: string
			priority: number
		}
	): Promise<{
		matched: TOutput[]
		remaining: TInput[]
	}> {
		const matched: TOutput[] = []
		const remaining: TInput[] = []
		
		// Create enhanced context for strategy
		const strategyContext = {
			interpolationContext: context.interpolationContext,
			chatMessages,
			failedMatches
		}
		
		for (const entry of consideredEntries) {
			let wasMatched = false
			
			for (const message of chatMessages) {
				const isMatch = await this.matchesMessage(entry as any, message, strategyContext)
				if (isMatch) {
					const processedEntry = processor.processItem(entry, context)
					if (processedEntry) {
						matched.push(processedEntry)
						wasMatched = true
						break
					}
				}
			}
			
			if (!wasMatched) {
				remaining.push(entry)
			}
		}
		
		return { matched, remaining }
	}
}
