import { PromptBlockFormatter } from "../PromptBlockFormatter"
import Handlebars from "handlebars"
import type { TokenCounters } from "../TokenCounterManager"
import type { BasePromptChat } from "../../connectionAdapters/BaseConnectionAdapter"
import {
	attachCharacterLoreToCharacters,
	populateLorebookEntryBindings
} from "./LorebookBindingUtils"
import {
	characterLoreEntryIterator,
	historyEntryIterator
} from "./PromptIterators"
import { PromptFormats } from "$lib/shared/constants/PromptFormats"

// Import modular components
import { InterpolationEngine } from "./InterpolationEngine"
import { ContentInfillEngine } from "./ContentInfillEngine"
import type { LoreMatchingStrategy, MatchingStrategyConfig } from "./LoreMatchingStrategies"
import { MatchingStrategyFactory, KeywordMatchingStrategy } from "./LoreMatchingStrategies"
import type { ContentInclusionConfig, ContentInclusionStrategy } from "./ContentInclusionStrategy"
import { defaultContentInclusionConfig } from "./ContentInclusionStrategy"
import type { CompiledPrompt, CompileOptions, TemplateContext } from "./types"
import { parseSplitChatPrompt, isHistoryEntry } from "./utils"

export class PromptBuilder {
	connection: SelectConnection
	sampling: SelectSamplingConfig
	contextConfig: SelectContextConfig
	promptConfig: SelectPromptConfig
	chat: BasePromptChat
	currentCharacterId: number
	tokenCounter: TokenCounters
	tokenLimit: number
	contextThresholdPercent: number
	
	// Legacy properties (gradually being moved to modules)
	assistantCharacters: any[] = []
	userCharacters: any[] = []
	instructions?: string
	exampleDialogue?: string
	postHistoryInstructions?: string

	handlebars: typeof Handlebars

	// Interpolation engine for template processing
	private interpolationEngine: InterpolationEngine

	constructor({
		connection,
		sampling,
		contextConfig,
		promptConfig,
		chat,
		currentCharacterId,
		tokenCounter,
		tokenLimit,
		contextThresholdPercent
	}: {
		connection: SelectConnection
		sampling: SelectSamplingConfig
		contextConfig: SelectContextConfig
		promptConfig: SelectPromptConfig
		chat: BasePromptChat
		currentCharacterId: number
		tokenCounter: TokenCounters
		tokenLimit: number
		contextThresholdPercent: number
	}) {
		this.connection = connection
		this.sampling = sampling
		this.contextConfig = contextConfig
		this.promptConfig = promptConfig
		this.chat = chat
		this.currentCharacterId = currentCharacterId
		this.handlebars = Handlebars.create()
		this.tokenCounter = tokenCounter
		this.tokenLimit = tokenLimit
		this.contextThresholdPercent = contextThresholdPercent

		// Initialize the interpolation engine with the same handlebars instance
		this.interpolationEngine = new InterpolationEngine(this.handlebars)
	}

	getInterpolationEngine(): InterpolationEngine {
		return this.interpolationEngine
	}

	private registerHandlebarsHelpers({
		useChatFormat = false
	}: {
		useChatFormat?: boolean
	}) {
		const handlebars = this.handlebars

		// Common helpers
		if (!handlebars.helpers.eq)
			handlebars.registerHelper("eq", (a, b) => a === b)
		if (!handlebars.helpers.ne)
			handlebars.registerHelper("ne", (a, b) => a !== b)
		if (!handlebars.helpers.and)
			handlebars.registerHelper("and", (a, b) => a && b)
		if (!handlebars.helpers.or)
			handlebars.registerHelper("or", (a, b) => a || b)

		// Precompute prompt format ONCE for this registration
		const precomputedPromptFormat = useChatFormat
			? PromptFormats.SPLIT_CHAT
			: this.connection?.promptFormat || PromptFormats.VICUNA

		const getPromptFormat = () => precomputedPromptFormat

		if (!handlebars.helpers.systemBlock) {
			handlebars.registerHelper(
				"systemBlock",
				function (this: any, options: any) {
					const promptFormat = getPromptFormat()
					return PromptBlockFormatter.makeBlock({
						format: promptFormat,
						role: "system",
						content: options.fn(this)
					})
				}
			)
		}
		if (!handlebars.helpers.assistantBlock) {
			handlebars.registerHelper(
				"assistantBlock",
				function (this: any, options: any) {
					const promptFormat = getPromptFormat()
					// If available, check for id property in the context
					// Handlebars context for each message should have id
					const messageId =
						this.id !== undefined
							? this.id
							: options.data && options.data.id
					return PromptBlockFormatter.makeBlock({
						format: promptFormat,
						role: "assistant",
						content: options.fn(this),
						includeClose: messageId !== -2
					})
				}
			)
		}
		if (!handlebars.helpers.userBlock) {
			handlebars.registerHelper(
				"userBlock",
				function (this: any, options: any) {
					const promptFormat = getPromptFormat()
					return PromptBlockFormatter.makeBlock({
						format: promptFormat,
						role: "user",
						content: options.fn(this)
					})
				}
			)
		}
	}

	// --- Context builders ---
	contextBuildCharacterDescription(character: SelectCharacter): string {
		return character.description
	}
	contextBuildCharacterPersonality(
		character: SelectCharacter
	): string | undefined {
		if (!character?.personality) return undefined
		return character.personality
	}
	contextBuildCharacterScenario(
		character: SelectCharacter
	): string | undefined {
		if (!character?.scenario) return undefined
		return character.scenario
	}
	contextBuildCharacterExampleDialogue(): string | undefined {
		return undefined
	}
	contextBuildCharacterPostHistoryInst(): string | undefined {
		return undefined
	}
	contextBuildPersonaDescription(persona: any): string {
		return persona.description
	}
	contextBuildSystemPrompt(): string {
		return this.promptConfig.systemPrompt
	}
	contextBuildCharacterExampleDialogues(
		character: SelectCharacter
	): string | undefined {
		if (!character?.exampleDialogues) return undefined
		return character.exampleDialogues
	}
	contextBuildPostHistoryInstructions(
		character: SelectCharacter
	): string | undefined {
		if (!character?.postHistoryInstructions) return undefined
		return character.postHistoryInstructions
	}
	contextBuildCharacterName(character: SelectCharacter): string {
		return character.name
	}
	contextBuildCharacterNickname(
		character: SelectCharacter
	): string | undefined {
		return character.nickname || undefined
	}
	contextBuildPersonaName(persona: SelectPersona): string {
		return persona.name
	}

	compileCharacterData(character: SelectCharacter): {
		name: string
		nickname?: string
		description: string
		personality?: string
	} {
		const char = {
			name: this.contextBuildCharacterName(character),
			nickname: this.contextBuildCharacterNickname(character),
			description: this.contextBuildCharacterDescription(character),
			personality: this.contextBuildCharacterPersonality(character)
		}

		// delete any undefined/null properties
		Object.keys(char).forEach((key) => {
			if (
				char[key as keyof typeof char] === undefined ||
				char[key as keyof typeof char] === null
			) {
				delete char[key as keyof typeof char]
			}
		})

		return char
	}

	compilePersonaData(persona: SelectPersona): {
		name: string
		description: string
	} {
		const personaData = {
			name: this.contextBuildPersonaName(persona),
			description: this.contextBuildPersonaDescription(persona)
		}
		// delete any undefined/null properties
		Object.keys(personaData).forEach((key) => {
			if (
				personaData[key as keyof typeof personaData] === undefined ||
				personaData[key as keyof typeof personaData] === null
			) {
				delete personaData[key as keyof typeof personaData]
			}
		})
		return personaData
	}

	getCharacterDisplayName(character: SelectCharacter): string {
		return character.nickname || character.name || "assistant"
	}

	async compileHandlebarsData(character: SelectCharacter): Promise<{
		assistant: string
		char: string
		character: string
		persona: string
		user: string
	}> {
		const name = this.getCharacterDisplayName(character)
		return {
			assistant: name,
			char: name,
			character: name,
			persona: "user",
			user: "user"
		}
	}

	buildContextData(currentCharacter: SelectCharacter) {
		const chatCharacters = this.chat.chatCharacters as
			| (SelectChatCharacter & { character: SelectCharacter })[]
			| undefined
		this.assistantCharacters = (chatCharacters || []).map((cc) =>
			this.compileCharacterData(cc.character)
		)
		this.userCharacters = (this.chat.chatPersonas || []).map((cp) =>
			this.compilePersonaData(cp.persona)
		)
		this.instructions = this.contextBuildSystemPrompt()
		this.exampleDialogue = this.contextBuildCharacterExampleDialogue()
		this.postHistoryInstructions = this.contextBuildCharacterPostHistoryInst()
	}

	// --- Modularized section: scenario interpolation and source ---
	private getScenarioInterpolated(
		currentCharacter: SelectCharacter,
		interpolationContext: any
	): {
		scenarioInterpolated: string
		scenarioSource: null | "character" | "chat"
	} {
		let scenarioInterpolated = ""
		let scenarioSource: null | "character" | "chat" = null
		
		if (this.chat && (this.chat as any).scenario) {
			scenarioInterpolated =
				this.interpolationEngine.interpolateString((this.chat as any).scenario, interpolationContext) || ""
			scenarioSource = "chat"
		} else if (this.chat && (this.chat as any).isGroup) {
			scenarioInterpolated = ""
			scenarioSource = null
		} else {
			const charScenario =
				this.contextBuildCharacterScenario(currentCharacter) || ""
			scenarioInterpolated = this.interpolationEngine.interpolateString(charScenario, interpolationContext) || ""
			scenarioSource = charScenario ? "character" : null
		}
		return { scenarioInterpolated, scenarioSource }
	}

	// --- Modularized section: interpolate characters/personas ---
	private getInterpolatedCharacters(interpolationContext: any) {
		return this.assistantCharacters.map((c: any) => 
			this.interpolationEngine.interpolateObject(c, interpolationContext, ['name', 'nickname', 'description', 'personality'])
		)
	}
	private getInterpolatedPersonas(interpolationContext: any) {
		return this.userCharacters.map((p: any) => 
			this.interpolationEngine.interpolateObject(p, interpolationContext, ['name', 'description'])
		)
	}

	// --- Modularized section: build template context ---
	private buildTemplateContext({
		instructions,
		charactersInterpolated,
		personasInterpolated,
		scenarioInterpolated,
		exampleDialogue,
		postHistoryInstructions,
		charName,
		personaName
	}: any): TemplateContext {
		return {
			instructions,
			characters: charactersInterpolated,
			personas: personasInterpolated,
			scenario: scenarioInterpolated,
			exampleDialogue,
			postHistoryInstructions,
			chatMessages: [],
			char: charName,
			character: charName,
			user: personaName,
			persona: personaName,
			__promptBuilderInstance: this
		}
	}


	/**
	 * Enhanced modular version of infillContent using ContentInfillEngine
	 * This demonstrates how the content inclusion logic can be simplified and made configurable
	 * Now supports pluggable matching strategies for future vectorization
	 */
	async infillContent({
		templateContext,
		charName,
		personaName,
		useChatFormat,
		config = defaultContentInclusionConfig,
		strategy,
		matchingStrategy,
		matchingStrategyConfig
	}: {
		templateContext: TemplateContext
		charName: string
		personaName: string
		useChatFormat: boolean
		config?: ContentInclusionConfig
		strategy?: ContentInclusionStrategy
		matchingStrategy?: LoreMatchingStrategy
		matchingStrategyConfig?: MatchingStrategyConfig
	}) {
		// Create the content infill engine with optional matching strategy
		let infillEngine: ContentInfillEngine

		if (matchingStrategyConfig) {
			// Create engine with strategy from config
			infillEngine = await ContentInfillEngine.createWithStrategy(
				this.chat,
				this.interpolationEngine,
				populateLorebookEntryBindings,
				isHistoryEntry,
				this.chatMessageIterator.bind(this),
				this.worldLoreEntryIterator.bind(this),
				characterLoreEntryIterator,
				historyEntryIterator,
				matchingStrategyConfig
			)
		} else {
			// Create engine with explicit strategy or default
			infillEngine = new ContentInfillEngine(
				this.chat,
				this.interpolationEngine,
				populateLorebookEntryBindings,
				isHistoryEntry,
				this.chatMessageIterator.bind(this),
				this.worldLoreEntryIterator.bind(this),
				characterLoreEntryIterator,
				historyEntryIterator,
				matchingStrategy // Will default to keyword if undefined
			)
		}

		// Use the engine to process content
		return await infillEngine.infillContent({
			charName,
			personaName,
			templateContext,
			useChatFormat,
			tokenLimit: this.tokenLimit,
			contextThresholdPercent: this.contextThresholdPercent,
			tokenCounter: this.tokenCounter,
			handlebars: this.handlebars,
			contextConfig: this.contextConfig,
			strategy,
			config
		})
	}

	/**
	 * Set the matching strategy for lore matching
	 * Allows runtime switching between keyword, vector, and hybrid matching
	 */
	private _infillEngine: ContentInfillEngine | null = null

	async setMatchingStrategy(strategy: LoreMatchingStrategy): Promise<void> {
		if (this._infillEngine) {
			await this._infillEngine.setMatchingStrategy(strategy)
		}
	}

	async setMatchingStrategyFromConfig(config: MatchingStrategyConfig): Promise<void> {
		const strategy = await MatchingStrategyFactory.createStrategy(config)
		await this.setMatchingStrategy(strategy)
	}

	getMatchingStrategyName(): string | null {
		return this._infillEngine?.getMatchingStrategyName() || null
	}

	// --- Original infillContent method remains for backward compatibility ---
	// --- Modularized section: sources reporting ---
	private buildSources(scenarioSource: null | "character" | "chat") {
		const chatCharactersArr = this.chat.chatCharacters || []
		const chatPersonasArr = this.chat.chatPersonas || []
		return {
			characters: chatCharactersArr.map((cc: any) => {
				const c = cc.character
				return {
					id: c.id,
					name: c.name,
					nickname: c.nickname,
					description: Boolean(c.description),
					personality: Boolean(c.personality),
					exampleDialogue: Boolean(this.contextBuildCharacterExampleDialogue()),
					postHistoryInstructions: Boolean(c.postHistoryInstructions)
				}
			}),
			personas: chatPersonasArr.map((cp: any) => {
				const p = cp.persona
				return {
					id: p.id,
					name: p.name,
					description: Boolean(p.description)
				}
			}),
			scenario: scenarioSource
		}
	}

	// --- Modularized section: meta reporting ---
	private buildMeta({
		excludedIds,
		useChatFormat = false
	}: {
		excludedIds: number[]
		useChatFormat?: boolean
	}) {
		return {
			promptFormat: useChatFormat
				? "N/A - Chat Completions"
				: (this.connection.promptFormat || "").toLowerCase(),
			templateName: this.contextConfig?.name || null,
			timestamp: new Date().toISOString(),
			truncationReason: excludedIds.length ? "token_limit" : null,
			currentTurnCharacterId: this.currentCharacterId
		}
	}

	// --- Main compilePrompt ---
	async compilePrompt({
		useChatFormat = false
	}: {
		useChatFormat?: boolean
	}): Promise<CompiledPrompt> {
		this.registerHandlebarsHelpers({ useChatFormat })
		const chatCharacters = this.chat.chatCharacters as
			| (SelectChatCharacter & { character: SelectCharacter })[]
			| undefined
		const currentCharacter = chatCharacters?.find(
			(cc) => cc.character.id === this.currentCharacterId
		)?.character
		if (!currentCharacter) {
			throw new Error(
				`compilePrompt: No character found with ID ${this.currentCharacterId}`
			)
		}

		this.buildContextData(currentCharacter)

		const charName = currentCharacter.nickname || currentCharacter.name
		const personaName =
			(this.chat.chatPersonas &&
				this.chat.chatPersonas[0]?.persona?.name) ||
			"user"
		const interpolationContext = this.interpolationEngine.createInterpolationContext({
			currentCharacterName: charName,
			currentPersonaName: personaName
		})

		const instructions = this.interpolationEngine.interpolateString(this.instructions, interpolationContext)
		const exampleDialogue = this.interpolationEngine.interpolateString(this.exampleDialogue, interpolationContext)
		const postHistoryInstructions = this.interpolationEngine.interpolateString(this.postHistoryInstructions, interpolationContext)

		const { scenarioInterpolated, scenarioSource } =
			this.getScenarioInterpolated(currentCharacter, interpolationContext)
		const assistantCharacters =
			this.getInterpolatedCharacters(interpolationContext)
		const assistantCharactersWithLore = attachCharacterLoreToCharacters(
			assistantCharacters,
			[], // Character lore is now handled by ContentInfillEngine
			this.chat
		)
		const charactersInterpolated = JSON.stringify(
			assistantCharactersWithLore,
			null,
			2
		)
		const userCharactersWithLore = attachCharacterLoreToCharacters(
			this.getInterpolatedPersonas(interpolationContext),
			[], // Character lore is now handled by ContentInfillEngine
			this.chat
		)
		const personasInterpolated = JSON.stringify(
			userCharactersWithLore,
			null,
			2
		)
		const templateContext: TemplateContext = this.buildTemplateContext({
			instructions,
			charactersInterpolated,
			personasInterpolated,
			scenarioInterpolated,
			exampleDialogue,
			postHistoryInstructions,
			charName,
			personaName
		})

		const {
			renderedPrompt,
			renderedMessages,
			totalTokens,
			chatMessages: {
				included: includedChatMessages,
				includedIds,
				excludedIds
			}
		} = await this.infillContent({
			templateContext,
			charName,
			personaName,
			useChatFormat,
			config: defaultContentInclusionConfig,
			strategy: undefined,
			matchingStrategy: undefined,
			matchingStrategyConfig: undefined
		})

		const sources = this.buildSources(scenarioSource)
		const meta = this.buildMeta({
			excludedIds,
			useChatFormat
		})

		// --- Lorebook entry totals ---
		const lorebook = this.chat.lorebook
		let worldLoreTotal = 0
		let characterLoreTotal = 0
		let historyTotal = 0
		if (hasLorebookEntries(lorebook)) {
			worldLoreTotal = lorebook.worldLoreEntries.length
			characterLoreTotal = lorebook.characterLoreEntries.length
			historyTotal = lorebook.historyEntries.length
		}

		// console.log("Prompt messages:" + JSON.stringify(renderedMessages))

		// Default: return as before
		return {
			prompt: renderedPrompt,
			messages: renderedMessages,
			meta: {
				...meta,
				tokenCounts: {
					total: totalTokens as number,
					limit: this.tokenLimit
				},
				chatMessages: {
					included: includedChatMessages,
					total: this.chat.chatMessages.length,
					includedIds,
					excludedIds
				},
				sources
			}
		}
	}

	*chatMessageIterator({
		priority
	}: {
		priority: number
	}): IterableIterator<SelectChatMessage> {
		const messages = this.chat.chatMessages || []
		if (priority === 4) {
			// If there are 3 or fewer messages, yield all in reverse order
			if (messages.length <= 3) {
				for (const msg of messages.slice().reverse()) {
					yield msg
				}
			} else {
				for (const msg of messages.slice(-3).reverse()) {
					yield msg
				}
			}
		} else if (priority === 2) {
			// If there are 3 or fewer messages, yield none
			if (messages.length <= 3) {
				// yield nothing
			} else {
				for (const msg of messages.slice(0, -3).reverse()) {
					yield msg
				}
			}
		}
	}

	*worldLoreEntryIterator({
		priority
	}: {
		priority: number
	}): IterableIterator<SelectWorldLoreEntry> {
		const chatWithLorebook = this.chat as typeof this.chat & {
			lorebook?: { worldLoreEntries: SelectWorldLoreEntry[] }
		}
		const entries: SelectWorldLoreEntry[] =
			chatWithLorebook.lorebook?.worldLoreEntries || []
		let filtered: SelectWorldLoreEntry[] = []
		if (priority === 4) {
			filtered = entries.filter(
				(e: SelectWorldLoreEntry) => e.constant === true
			)
		} else if ([3, 2, 1].includes(priority)) {
			filtered = entries.filter(
				(e: SelectWorldLoreEntry) => e.priority === priority
			)
		}
		filtered.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
		for (const entry of filtered) {
			// TODO: populate lorebook bindings
			yield entry
		}
	}
}

// Re-export types for backward compatibility
export type {
	TemplateContextCharacter,
	TemplateContextPersona, 
	TemplateContext,
	CompiledPrompt,
	CompileOptions
} from "./types"

// Re-export InterpolationEngine and its utilities for external use
export { 
	InterpolationEngine,
	createInterpolationEngine,
	interpolateTemplate,
	createBasicContext
} from "./InterpolationEngine"
export type { InterpolationContext, CharacterData, PersonaData } from "./InterpolationEngine"

// Helper type guard for extended lorebook
function hasLorebookEntries(lorebook: any): lorebook is SelectLorebook & {
	worldLoreEntries: SelectWorldLoreEntry[]
	characterLoreEntries: SelectCharacterLoreEntry[]
	historyEntries: SelectHistoryEntry[]
} {
	return (
		lorebook &&
		Array.isArray(lorebook.worldLoreEntries) &&
		Array.isArray(lorebook.characterLoreEntries) &&
		Array.isArray(lorebook.historyEntries)
	)
}
