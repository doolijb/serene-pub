import type { InterpolationContext } from './InterpolationEngine'
import type { 
	ContentInclusionConfig, 
	ContentInclusionState, 
	ContentInclusionStrategy
} from './ContentInclusionStrategy'
import { defaultContentInclusionConfig } from './ContentInclusionStrategy'
import type { ProcessedChatMessage } from './ContentProcessors'
import { 
	ChatMessageProcessor,
	WorldLoreProcessor,
	CharacterLoreProcessor,
	HistoryEntryProcessor,
	LoreMatchingEngine
} from './ContentProcessors'
import type { LoreMatchingStrategy, MatchingStrategyConfig } from './LoreMatchingStrategies'
import { MatchingStrategyFactory, KeywordMatchingStrategy } from './LoreMatchingStrategies'
import { parseSplitChatPrompt } from './utils'
import { attachCharacterLoreToCharacters } from './LorebookBindingUtils'

/**
 * Modular content infill engine that handles the complex logic
 * of including chat messages, world lore, character lore, and history
 * in a configurable, priority-based manner.
 */
export class ContentInfillEngine {
	private chatMessageProcessor: ChatMessageProcessor
	private worldLoreProcessor: WorldLoreProcessor
	private characterLoreProcessor: CharacterLoreProcessor
	private historyEntryProcessor: HistoryEntryProcessor
	private loreMatchingEngine: LoreMatchingEngine
	private currentInterpolationContext?: InterpolationContext
	
	constructor(
		private chat: any, // BasePromptChat type
		private interpolationEngine: any, // InterpolationEngine type
		private populateLorebookEntryBindings: any,
		private isHistoryEntry: any,
		private chatMessageIterator: any,
		private worldLoreEntryIterator: any,
		private characterLoreEntryIterator: any,
		private historyEntryIterator: any,
		private matchingStrategy?: LoreMatchingStrategy
	) {
		this.chatMessageProcessor = new ChatMessageProcessor(chat, interpolationEngine)
		this.worldLoreProcessor = new WorldLoreProcessor(chat, populateLorebookEntryBindings)
		this.characterLoreProcessor = new CharacterLoreProcessor(chat, populateLorebookEntryBindings)
		this.historyEntryProcessor = new HistoryEntryProcessor(chat, populateLorebookEntryBindings, isHistoryEntry)
		
		// Use provided strategy or default to keyword matching
		const strategy = matchingStrategy || new KeywordMatchingStrategy()
		this.loreMatchingEngine = new LoreMatchingEngine(strategy)
	}

	/**
	 * Update the matching strategy at runtime
	 */
	async setMatchingStrategy(strategy: LoreMatchingStrategy): Promise<void> {
		if (strategy.initialize) {
			await strategy.initialize()
		}
		this.loreMatchingEngine.setStrategy(strategy)
	}

	/**
	 * Create a new ContentInfillEngine with a matching strategy from config
	 */
	static async createWithStrategy(
		chat: any,
		interpolationEngine: any,
		populateLorebookEntryBindings: any,
		isHistoryEntry: any,
		chatMessageIterator: any,
		worldLoreEntryIterator: any,
		characterLoreEntryIterator: any,
		historyEntryIterator: any,
		strategyConfig: MatchingStrategyConfig
	): Promise<ContentInfillEngine> {
		const strategy = await MatchingStrategyFactory.createStrategy(strategyConfig)
		return new ContentInfillEngine(
			chat,
			interpolationEngine,
			populateLorebookEntryBindings,
			isHistoryEntry,
			chatMessageIterator,
			worldLoreEntryIterator,
			characterLoreEntryIterator,
			historyEntryIterator,
			strategy
		)
	}

	/**
	 * Get the current matching strategy name for debugging
	 */
	getMatchingStrategyName(): string {
		return this.loreMatchingEngine.getStrategyName()
	}
	
	/**
	 * Simplified infillContent method that uses the modular architecture
	 */
	async infillContent({
		charName,
		personaName,
		templateContext,
		useChatFormat = false,
		tokenLimit,
		contextThresholdPercent,
		tokenCounter,
		handlebars,
		contextConfig,
		strategy,
		config = defaultContentInclusionConfig
	}: {
		charName: string
		personaName: string
		templateContext: any
		useChatFormat?: boolean
		tokenLimit: number
		contextThresholdPercent: number
		tokenCounter: any
		handlebars: any
		contextConfig: any
		strategy?: ContentInclusionStrategy
		config?: ContentInclusionConfig
	}) {
		// Initialize state and processors
		const state = strategy ? strategy.initializeState(config) : this.initializeDefaultState(config)
		
		// Set the character name for the placeholder message
		state.chatMessages[0].name = charName
		
		// Create interpolation context
		const interpolationContext = this.interpolationEngine.createInterpolationContext({
			currentCharacterName: charName,
			currentPersonaName: personaName
		})
		
		// Store for use in template context building
		this.currentInterpolationContext = interpolationContext
		
		// Debug timing
		const debugTimings: any[] = []
		
		// Main processing loop
		while (!state.completed) {
			const iterStart = Date.now()
			state.iterationCount++
			
			// Process content for current priority level
			await this.processContentAtPriority(state, config, {
				interpolationContext,
				charName,
				personaName
			})
			
			// Check if we should render and count tokens
			const shouldRender = this.shouldRenderAtIteration(state, config)
			if (shouldRender) {
				const renderResult = await this.renderAndCountTokens(
					state,
					templateContext,
					{
						useChatFormat,
						tokenCounter,
						handlebars,
						contextConfig,
						tokenLimit,
						contextThresholdPercent,
						charName
					}
				)
				
				state.totalTokens = renderResult.totalTokens
				state.isBelowThreshold = renderResult.isBelowThreshold
				state.isAboveThreshold = renderResult.isAboveThreshold
				state.isOverLimit = renderResult.isOverLimit
			}
			
			// Handle over-limit condition
			if (state.isOverLimit) {
				this.handleOverLimit(state)
			}
			
			// Check completion conditions
			if (this.shouldComplete(state, config, tokenLimit)) {
				state.completed = true
			}
			
			// Update priority if needed
			if (this.shouldUpdatePriority(state, config)) {
				const oldPriority = state.priority
				state.priority = strategy ? strategy.getNextPriority(state, config) : this.getNextPriority(state, config)
				if (state.priority < 0) {
					state.completed = true
				}
			}
			
			const iterEnd = Date.now()
			debugTimings.push({
				priority: state.priority,
				chatMessagesCount: state.chatMessages.length,
				totalTokens: state.totalTokens,
				iterationMs: iterEnd - iterStart
			})
			
			// Safety check to prevent infinite loops
			if (state.iterationCount > 1000) {
				console.error(`ContentInfillEngine: Too many iterations (${state.iterationCount}), breaking`)
				state.completed = true
			}
		}
		
		// Final render
		const finalResult = await this.renderFinalResult(
			state,
			templateContext,
			{
				useChatFormat,
				tokenCounter,
				handlebars,
				contextConfig,
				charName
			}
		)
		
		return finalResult
	}
	
	/**
	 * Process content for the current priority level
	 */
	private async processContentAtPriority(
		state: ContentInclusionState,
		config: ContentInclusionConfig,
		context: {
			interpolationContext: InterpolationContext
			charName: string
			personaName: string
		}
	) {
		// Initialize iterators if needed
		this.initializeIteratorsForPriority(state, config)
		
		// Process chat messages
		if (!state.isOverLimit) {
			this.processChatMessages(state, context)
		}
		
		// Process lore content if below threshold
		if (state.isBelowThreshold && !state.isOverLimit) {
			this.processWorldLore(state, context)
			this.processCharacterLore(state, context)
			this.processHistory(state, context)
			
			// Perform lore matching
			await this.performLoreMatching(state, context)
		}
	}
	
	/**
	 * Initialize iterators for the current priority level
	 */
	private initializeIteratorsForPriority(state: ContentInclusionState, config: ContentInclusionConfig) {
		const { priority } = state
		
		// Check if we need to initialize iterators
		if (state.messagesIterator === undefined) {
			// First time setup
			if (config.priorities.chatMessages.includes(priority)) {
				state.messagesIterator = this.chatMessageIterator({ priority })
			}
			if (config.priorities.worldLore.includes(priority)) {
				state.worldLoreIterator = this.worldLoreEntryIterator({ priority })
			}
			if (config.priorities.characterLore.includes(priority)) {
				state.characterLoreIterator = this.characterLoreEntryIterator({ chat: this.chat, priority })
			}
			if (config.priorities.history.includes(priority)) {
				state.historyIterator = this.historyEntryIterator({ chat: this.chat, priority })
			}
		} else if (this.allIteratorsNull(state)) {
			// Reset iterators for new priority level
			if (config.priorities.chatMessages.includes(priority)) {
				state.messagesIterator = this.chatMessageIterator({ priority })
			}
			if (config.priorities.worldLore.includes(priority)) {
				state.worldLoreIterator = this.worldLoreEntryIterator({ priority })
			}
			if (config.priorities.characterLore.includes(priority)) {
				state.characterLoreIterator = this.characterLoreEntryIterator({ chat: this.chat, priority })
			}
			if (config.priorities.history.includes(priority)) {
				state.historyIterator = this.historyEntryIterator({ chat: this.chat, priority })
			}
		}
	}
	
	/**
	 * Process chat messages from iterator
	 */
	private processChatMessages(
		state: ContentInclusionState,
		context: {
			interpolationContext: InterpolationContext
			charName: string
			personaName: string
		}
	) {
		if (!state.messagesIterator) {
			return
		}
		
		// Process multiple messages when we're not at token limits
		const batchSize = state.isBelowThreshold ? 5 : state.isOverLimit ? 1 : 2
		
		for (let i = 0; i < batchSize; i++) {
			const nextMessageVal = state.messagesIterator.next()
			
			if (nextMessageVal.done) {
				state.messagesIterator = null
				break
			} else if (nextMessageVal.value) {
				const processedMessage = this.chatMessageProcessor.processItem(nextMessageVal.value, {
					...context,
					priority: state.priority
				})
				
				if (processedMessage) {
					state.chatMessages.push(processedMessage)
				}
			}
		}
	}
	
	/**
	 * Process world lore entries from iterator
	 */
	private processWorldLore(
		state: ContentInclusionState,
		context: {
			interpolationContext: InterpolationContext
			charName: string
			personaName: string
		}
	) {
		if (!state.worldLoreIterator) return
		
		const nextVal = state.worldLoreIterator.next()
		
		if (nextVal.done) {
			state.worldLoreIterator = null
		} else if (nextVal.value) {
			if (state.priority === 4) {
				// High priority - include immediately
				const processed = this.worldLoreProcessor.processItem(nextVal.value, {
					...context,
					priority: state.priority
				})
				if (processed) {
					state.includedWorldLore.push(processed)
				}
			} else {
				// Lower priority - add to considered list for matching
				state.consideredWorldLore.push(nextVal.value)
			}
		}
	}
	
	/**
	 * Process character lore entries from iterator
	 */
	private processCharacterLore(
		state: ContentInclusionState,
		context: {
			interpolationContext: InterpolationContext
			charName: string
			personaName: string
		}
	) {
		if (!state.characterLoreIterator) return
		
		const nextVal = state.characterLoreIterator.next()
		
		if (nextVal.done) {
			state.characterLoreIterator = null
		} else if (nextVal.value) {
			if (state.priority === 4) {
				// High priority - include immediately
				const processed = this.characterLoreProcessor.processItem(nextVal.value, {
					...context,
					priority: state.priority
				})
				if (processed) {
					state.includedCharacterLore.push(processed)
				}
			} else {
				// Lower priority - add to considered list for matching
				state.consideredCharacterLore.push(nextVal.value)
			}
		}
	}
	
	/**
	 * Process history entries from iterator
	 */
	private processHistory(
		state: ContentInclusionState,
		context: {
			interpolationContext: InterpolationContext
			charName: string
			personaName: string
		}
	) {
		if (!state.historyIterator) return
		
		const nextVal = state.historyIterator.next()
		
		if (nextVal.done) {
			state.historyIterator = null
		} else if (nextVal.value) {
			if (state.priority === 4) {
				// High priority - include immediately
				const processed = this.historyEntryProcessor.processItem(nextVal.value, {
					...context,
					priority: state.priority
				})
				if (processed) {
					state.includedHistory.push(processed)
				}
			} else {
				// Lower priority - add to considered list for matching
				state.consideredHistory.push(nextVal.value)
			}
		}
	}
	
	/**
	 * Perform lore matching against chat messages
	 */
	private async performLoreMatching(
		state: ContentInclusionState,
		context: {
			interpolationContext: InterpolationContext
			charName: string
			personaName: string
		}
	) {
		// Match world lore
		const worldLoreResult = await this.loreMatchingEngine.processMatching(
			state.chatMessages,
			state.consideredWorldLore,
			state.messageFailedWorldLoreMatches,
			this.worldLoreProcessor,
			{ ...context, priority: state.priority }
		)
		state.includedWorldLore.push(...worldLoreResult.matched)
		state.consideredWorldLore = worldLoreResult.remaining
		
		// Match character lore
		const characterLoreResult = await this.loreMatchingEngine.processMatching(
			state.chatMessages,
			state.consideredCharacterLore,
			state.messageFailedCharacterLoreMatches,
			this.characterLoreProcessor,
			{ ...context, priority: state.priority }
		)
		state.includedCharacterLore.push(...characterLoreResult.matched)
		state.consideredCharacterLore = characterLoreResult.remaining
		
		// Match history
		const historyResult = await this.loreMatchingEngine.processMatching(
			state.chatMessages,
			state.consideredHistory,
			state.messageFailedHistoryMatches,
			this.historyEntryProcessor,
			{ ...context, priority: state.priority }
		)
		state.includedHistory.push(...historyResult.matched)
		state.consideredHistory = historyResult.remaining
	}
	
	// Helper methods
	private initializeDefaultState(config: ContentInclusionConfig): ContentInclusionState {
		return {
			priority: 4,
			iterationCount: 0,
			completed: false,
			isBelowThreshold: true,
			isAboveThreshold: false,
			isOverLimit: false,
			totalTokens: 0,
			weightCounters: {
				chatMessages: 0,
				worldLore: 0,
				characterLore: 0,
				history: 0
			},
			
			messagesIterator: undefined,
			worldLoreIterator: undefined,
			characterLoreIterator: undefined,
			historyIterator: undefined,
			
			consideredWorldLore: [],
			consideredCharacterLore: [],
			consideredHistory: [],
			
			messageFailedWorldLoreMatches: {},
			messageFailedCharacterLoreMatches: {},
			messageFailedHistoryMatches: {},
			
			chatMessages: [{
				id: -2,
				role: "assistant",
				name: "",
				message: ""
			}],
			includedWorldLore: [],
			includedCharacterLore: [],
			includedHistory: []
		}
	}
	
	private allIteratorsNull(state: ContentInclusionState): boolean {
		return state.messagesIterator === null &&
		       state.worldLoreIterator === null &&
		       state.characterLoreIterator === null &&
		       state.historyIterator === null
	}
	
	private shouldRenderAtIteration(state: ContentInclusionState, config: ContentInclusionConfig): boolean {
		const iterationRate = state.isBelowThreshold
			? config.iterationRates.belowThreshold
			: state.isAboveThreshold
				? config.iterationRates.aboveThreshold
				: state.isOverLimit
					? config.iterationRates.overLimit
					: 1
		
		return (state.priority !== 4 && state.iterationCount % iterationRate === 0) || state.isOverLimit
	}
	
	private async renderAndCountTokens(
		state: ContentInclusionState,
		templateContext: any,
		options: {
			useChatFormat: boolean
			tokenCounter: any
			handlebars: any
			contextConfig: any
			tokenLimit: number
			contextThresholdPercent: number
			charName: string
		}
	) {
		// Build template context with current state
		const updatedTemplateContext = this.buildTemplateContext(state, templateContext, options.charName, this.currentInterpolationContext)
		
		// Render prompt
		const renderedPrompt = options.handlebars.compile(options.contextConfig.template)({
			...updatedTemplateContext,
			chatMessages: [...state.chatMessages].reverse()
		})
		
		let finalPrompt = renderedPrompt
		if (options.useChatFormat) {
			// Parse chat format if needed
			finalPrompt = JSON.stringify(this.parseSplitChatPrompt(renderedPrompt))
		}
		
		// Count tokens
		const totalTokens = typeof options.tokenCounter.countTokens === "function"
			? await options.tokenCounter.countTokens(finalPrompt)
			: 0
		
		// Update threshold states
		const isBelowThreshold = totalTokens < options.tokenLimit * options.contextThresholdPercent
		const isAboveThreshold = totalTokens >= options.tokenLimit * options.contextThresholdPercent
		const isOverLimit = totalTokens > options.tokenLimit
		
		return {
			totalTokens,
			isBelowThreshold,
			isAboveThreshold,
			isOverLimit,
			renderedPrompt: finalPrompt
		}
	}
	
	private buildTemplateContext(
		state: ContentInclusionState, 
		baseContext: any, 
		charName: string,
		interpolationContext?: InterpolationContext
	) {
		// Build a complete template context similar to the original method
		const context = { ...baseContext }
		
		// Add processed chat messages to context  
		context.chatMessages = state.chatMessages
		context.characterLore = state.includedCharacterLore
		
		// If we have an interpolation context, build characters and personas with lore
		if (interpolationContext) {
			// Get interpolated characters from the chat's characters
			const assistantCharacters = this.getInterpolatedCharacters(interpolationContext)
			const assistantCharactersWithLore = attachCharacterLoreToCharacters(
				assistantCharacters,
				state.includedCharacterLore,
				this.chat
			)
			context.characters = JSON.stringify(assistantCharactersWithLore, null, 2)
			
			// Get interpolated personas from the chat's personas
			const userCharacters = this.getInterpolatedPersonas(interpolationContext)
			const userCharactersWithLore = attachCharacterLoreToCharacters(
				userCharacters,
				state.includedCharacterLore,
				this.chat
			)
			context.personas = JSON.stringify(userCharactersWithLore, null, 2)
		}
		
		// Build world lore object
		const worldLoreObj: Record<string, string> = {}
		for (const entry of state.includedWorldLore) {
			if (entry && entry.name && entry.content) {
				worldLoreObj[entry.name] = entry.content
			}
		}
		context.worldLore = Object.keys(worldLoreObj).length 
			? JSON.stringify(worldLoreObj, null, 2) 
			: undefined
		
		// Build history object and track most recent date
		const historyObj: Record<string, string> = {}
		state.includedHistory.forEach((entry) => {
			if (entry.content.trim()) {
				// Only populate bindings if the entry has the required lorebook fields
				let populatedEntry = entry
				if ((entry as any).name && (entry as any).keys) {
					const lorePopulated = this.populateLorebookEntryBindings(
						entry as any,
						this.chat
					)
					if (
						lorePopulated &&
						typeof lorePopulated.content === "string"
					) {
						populatedEntry = {
							...entry,
							content: lorePopulated.content
						}
					}
				}
				// Format date as year-month-day, year-month, or year only
				const y = entry.year
				const m = entry.month
				const d = entry.day
				let dateKey = String(y)
				if (m !== undefined && m !== null)
					dateKey += `-${String(m).padStart(2, "0")}`
				if (d !== undefined && d !== null)
					dateKey += `-${String(d).padStart(2, "0")}`
				historyObj[dateKey] = populatedEntry.content
			}
		})
		
		// Set current date from most recent history entry
		let mostRecentDate: {
			year: number
			month: number | undefined
			day: number | undefined
		} | null = null
		if (state.includedHistory.length) {
			mostRecentDate = {
				year: state.includedHistory[0].year,
				month: !!state.includedHistory[0].month
					? state.includedHistory[0].month
					: undefined,
				day: !!state.includedHistory[0].day
					? state.includedHistory[0].day
					: undefined
			}
		}
		// Format currentDate as year-month-day, year-month, or year only
		if (mostRecentDate) {
			const y = mostRecentDate.year
			const m = mostRecentDate.month
			const d = mostRecentDate.day
			let dateKey = String(y)
			if (m !== undefined && m !== null)
				dateKey += `-${String(m).padStart(2, "0")}`
			if (d !== undefined && d !== null)
				dateKey += `-${String(d).padStart(2, "0")}`
			context.currentDate = dateKey
		} else {
			context.currentDate = undefined
		}
		
		context.history = Object.keys(historyObj).length 
			? JSON.stringify(historyObj) 
			: undefined
		
		return context
	}
	
	/**
	 * Get interpolated characters similar to the original method
	 */
	private getInterpolatedCharacters(interpolationContext: InterpolationContext) {
		const chatCharacters = this.chat.chatCharacters as
			| (SelectChatCharacter & { character: SelectCharacter })[]
			| undefined
		const assistantCharacters = (chatCharacters || []).map((cc) =>
			this.compileCharacterData(cc.character)
		)
		return assistantCharacters.map((c: any) => 
			this.interpolationEngine.interpolateObject(c, interpolationContext, ['name', 'nickname', 'description', 'personality'])
		)
	}
	
	/**
	 * Get interpolated personas similar to the original method
	 */
	private getInterpolatedPersonas(interpolationContext: InterpolationContext) {
		const userCharacters = (this.chat.chatPersonas || []).map((cp: any) =>
			this.compilePersonaData(cp.persona)
		)
		return userCharacters.map((p: any) => 
			this.interpolationEngine.interpolateObject(p, interpolationContext, ['name', 'description'])
		)
	}
	
	/**
	 * Compile character data similar to the original method
	 */
	private compileCharacterData(character: SelectCharacter) {
		const char = {
			name: character.name,
			nickname: character.nickname || undefined,
			description: character.description,
			personality: character.personality || undefined
		}

		// delete any undefined/null properties
		Object.keys(char).forEach((key) => {
			if (char[key as keyof typeof char] == null) {
				delete char[key as keyof typeof char]
			}
		})

		return char
	}
	
	/**
	 * Compile persona data similar to the original method
	 */
	private compilePersonaData(persona: SelectPersona) {
		const personaData = {
			name: persona.name,
			description: persona.description
		}
		// delete any undefined/null properties
		Object.keys(personaData).forEach((key) => {
			if (personaData[key as keyof typeof personaData] == null) {
				delete personaData[key as keyof typeof personaData]
			}
		})
		return personaData
	}
	
	private handleOverLimit(state: ContentInclusionState) {
		if (state.chatMessages.length > 1) {
			state.chatMessages.pop()
		} else {
			state.completed = true
		}
	}
	
	private shouldComplete(state: ContentInclusionState, config: ContentInclusionConfig, tokenLimit: number): boolean {
		// Complete if:
		// 1. We're over the token limit and have successfully included some content
		// 2. All iterators are exhausted and we've reached the lowest priority
		// 3. We have a token count and are within the limit (successful completion)
		
		if (state.isOverLimit && state.totalTokens <= tokenLimit) {
			return true // Successfully reduced to within limits
		}
		
		if (this.allIteratorsNull(state) && state.priority <= 0) {
			return true // Exhausted all content
		}
		
		return false
	}
	
	private shouldUpdatePriority(state: ContentInclusionState, config: ContentInclusionConfig): boolean {
		return this.allIteratorsNull(state)
	}
	
	private getNextPriority(state: ContentInclusionState, config: ContentInclusionConfig): number {
		const currentPriority = state.priority
		
		for (let p = currentPriority - 1; p >= 0; p--) {
			const hasContent = config.priorities.chatMessages.includes(p) ||
			                  config.priorities.worldLore.includes(p) ||
			                  config.priorities.characterLore.includes(p) ||
			                  config.priorities.history.includes(p)
			if (hasContent) {
				return p
			}
		}
		
		return -1
	}
	
	private parseSplitChatPrompt(prompt: string) {
		return parseSplitChatPrompt(prompt)
	}
	
	private async renderFinalResult(state: ContentInclusionState, templateContext: any, options: any) {
		// Final render and return the complete result
		const finalContext = this.buildTemplateContext(state, templateContext, options.charName, this.currentInterpolationContext)
		
		const renderedPrompt = options.handlebars.compile(options.contextConfig.template)({
			...finalContext,
			chatMessages: [...state.chatMessages].reverse()
		})
		
		let finalPrompt = renderedPrompt
		let renderedMessages: any[] | undefined
		
		if (options.useChatFormat) {
			renderedMessages = this.parseSplitChatPrompt(renderedPrompt)
			finalPrompt = JSON.stringify(renderedMessages)
		}
		
		const totalTokens = typeof options.tokenCounter.countTokens === "function"
			? await options.tokenCounter.countTokens(finalPrompt)
			: 0
		
		const includedChatMessages = state.chatMessages.length - 1
		const includedChatMessageIds = state.chatMessages
			.filter((m) => m.id !== -2)
			.map((m) => m.id)
		
		// Calculate excluded IDs
		const excludedChatMessageIds = (this.chat.chatMessages || [])
			.map((m: any) => m.id)
			.filter((id: number) => !includedChatMessageIds.includes(id))
		
		return {
			renderedPrompt: !options.useChatFormat ? finalPrompt : undefined,
			renderedMessages,
			totalTokens,
			chatMessages: {
				included: includedChatMessages,
				includedIds: includedChatMessageIds,
				excludedIds: excludedChatMessageIds
			}
		}
	}
}
