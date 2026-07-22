import { registerContextHandlebarsHelpers } from "$lib/shared/utils/contextHandlebarsHelpers"
import Handlebars from "handlebars"
import type { TokenCounters } from "../TokenCounterManager"
import type { BasePromptChat } from "../../connectionAdapters/BaseConnectionAdapter"
import {
	attachCharacterLoreToCharacters,
	populateLorebookEntryBindings
} from "./LorebookBindingUtils"
import { PromptFormats } from "$lib/shared/constants/PromptFormats"
import { ChatCharacterVisibility } from "$lib/shared/constants/ChatCharacterVisibility"
import { joinWithAnd } from "$lib/shared/utils/joinWithAnd"
import { resolveCharacterName } from "$lib/shared/utils/resolveCharacterName"

// Import modular components
import { InterpolationEngine } from "./InterpolationEngine"
import { KeywordInfillEngine } from "./KeywordInfillEngine"
import { RagInfillEngine } from "./RagInfillEngine"
import type {
	CompiledPrompt,
	CompileOptions,
	InfillResult,
	TemplateContext
} from "./types"
import "./utils"
import { isModelReady } from "$lib/server/embedding"

export class PromptBuilder {
	connection: SelectConnection
	sampling: SelectSamplingConfig
	contextConfig: SelectContextConfig
	promptConfig: SelectPromptConfig
	chat: BasePromptChat
	currentCharacterId: number | null
	tokenCounter: TokenCounters
	tokenLimit: number
	contextThresholdPercent: number
	isAssistantMode: boolean
	diagnosticsEnabled: boolean = true

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
		contextThresholdPercent,
		isAssistantMode = false
	}: {
		connection: SelectConnection
		sampling: SelectSamplingConfig
		contextConfig: SelectContextConfig
		promptConfig: SelectPromptConfig
		chat: BasePromptChat
		currentCharacterId: number | null
		tokenCounter: TokenCounters
		tokenLimit: number
		contextThresholdPercent: number
		isAssistantMode?: boolean
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
		this.isAssistantMode = isAssistantMode

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
		const promptFormat = useChatFormat
			? PromptFormats.SPLIT_CHAT
			: this.connection?.promptFormat || PromptFormats.VICUNA

		registerContextHandlebarsHelpers(this.handlebars, { promptFormat })
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
		character: SelectCharacter | null
	): string | undefined {
		if (!character?.scenario) return undefined
		return character.scenario
	}
	contextBuildPersonaDescription(persona: any): string {
		return persona.description
	}
	contextBuildSystemPrompt(): string {
		return this.promptConfig.systemPrompt
	}
	contextBuildCharacterExampleDialogues(
		character: SelectCharacter | null
	): string | undefined {
		if (
			!character?.exampleDialogues ||
			!Array.isArray(character.exampleDialogues)
		)
			return undefined
		const validDialogues = character.exampleDialogues.filter(Boolean)
		if (validDialogues.length === 0) return undefined
		// Select 1 random example dialogue
		const randomIndex = Math.floor(Math.random() * validDialogues.length)
		return validDialogues[randomIndex]
	}
	contextBuildPostHistoryInstructions(
		character: SelectCharacter | null
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

	compileCharacterData(
		character: SelectCharacter,
		visibility?: string
	): {
		name: string
		nickname?: string
		aliases?: string[]
		description: string
		personality?: string
	} | null {
		// If character is hidden, return null to exclude from prompt entirely
		if (visibility === ChatCharacterVisibility.HIDDEN) {
			return null
		}

		const char: any = {
			name: this.contextBuildCharacterName(character),
			nickname: this.contextBuildCharacterNickname(character),
			aliases: character.aliases?.length
				? character.aliases.filter((a) => a.trim())
				: undefined
		}

		// For minimal visibility, only include name/nickname and description
		if (visibility === ChatCharacterVisibility.MINIMAL) {
			char.description = this.contextBuildCharacterDescription(character)
		}
		// For visible (default) or undefined, include all character data
		else {
			char.description = this.contextBuildCharacterDescription(character)
			char.personality = this.contextBuildCharacterPersonality(character)
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
		return resolveCharacterName(character)
	}

	/** Display names of every active, non-hidden character in the chat —
	 * source list for the {{characterNames}}/{{char}} joined-list value. */
	getVisibleCharacterNames(): string[] {
		const chatCharacters = this.chat.chatCharacters as
			| (SelectChatCharacter & { character: SelectCharacter })[]
			| undefined
		return (chatCharacters || [])
			.filter(
				(cc) =>
					cc.isActive &&
					cc.visibility !== ChatCharacterVisibility.HIDDEN
			)
			.map((cc) => this.getCharacterDisplayName(cc.character))
	}

	/** Display names of every persona in the chat — source list for the
	 * {{personaNames}}/{{user}} joined-list value. */
	getPersonaNames(): string[] {
		return (this.chat.chatPersonas || []).map((cp) =>
			this.contextBuildPersonaName(cp.persona)
		)
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

	buildContextData(currentCharacter: SelectCharacter | null) {
		const chatCharacters = this.chat.chatCharacters as
			| (SelectChatCharacter & { character: SelectCharacter })[]
			| undefined

		// Build assistant characters with visibility filtering
		this.assistantCharacters = (chatCharacters || [])
			.filter((cc) => {
				// Always include the current character
				const isCurrentCharacter =
					cc.character.id === this.currentCharacterId
				// Filter out hidden characters unless they're the current character
				return (
					isCurrentCharacter ||
					cc.visibility !== ChatCharacterVisibility.HIDDEN
				)
			})
			.map((cc) => {
				// Always show the current character with full visibility
				const isCurrentCharacter =
					cc.character.id === this.currentCharacterId
				const visibility = isCurrentCharacter
					? ChatCharacterVisibility.VISIBLE
					: cc.visibility

				return this.compileCharacterData(cc.character, visibility)
			})

		this.userCharacters = (this.chat.chatPersonas || []).map((cp) =>
			this.compilePersonaData(cp.persona)
		)
		this.instructions = this.contextBuildSystemPrompt()
		this.exampleDialogue =
			this.contextBuildCharacterExampleDialogues(currentCharacter)
		this.postHistoryInstructions =
			this.contextBuildPostHistoryInstructions(currentCharacter)
	}

	// --- Modularized section: scenario interpolation and source ---
	private getScenarioInterpolated(
		currentCharacter: SelectCharacter | null,
		interpolationContext: any
	): {
		scenarioInterpolated: string
		scenarioSource: null | "character" | "chat"
	} {
		let scenarioInterpolated = ""
		let scenarioSource: null | "character" | "chat" = null

		if (this.chat && (this.chat as any).scenario) {
			scenarioInterpolated =
				this.interpolationEngine.interpolateString(
					(this.chat as any).scenario,
					interpolationContext
				) || ""
			scenarioSource = "chat"
		} else if (this.chat && (this.chat as any).isGroup) {
			scenarioInterpolated = ""
			scenarioSource = null
		} else {
			const charScenario =
				this.contextBuildCharacterScenario(currentCharacter) || ""
			scenarioInterpolated =
				this.interpolationEngine.interpolateString(
					charScenario,
					interpolationContext
				) || ""
			scenarioSource = charScenario ? "character" : null
		}
		return { scenarioInterpolated, scenarioSource }
	}

	// --- Modularized section: interpolate characters/personas ---
	private getInterpolatedCharacters(interpolationContext: any) {
		return this.assistantCharacters.map((c: any) =>
			this.interpolationEngine.interpolateObject(
				c,
				interpolationContext,
				["name", "nickname", "aliases", "description", "personality"]
			)
		)
	}
	private getInterpolatedPersonas(interpolationContext: any) {
		return this.userCharacters.map((p: any) =>
			this.interpolationEngine.interpolateObject(
				p,
				interpolationContext,
				["name", "description"]
			)
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
			// Plain, human-readable "A, B, and C" joined lists — distinct from
			// the `characters`/`personas` JSON blobs above (those are consumed
			// as raw JSON in default context templates, see defaults.ts). The
			// long-term migration path away from singular {{char}}/{{user}} is
			// meant to go through these, plus {{character}}/{{persona}}, which
			// already alias the current single character/persona.
			characterNames: joinWithAnd(this.getVisibleCharacterNames()),
			personaNames: joinWithAnd(this.getPersonaNames()),
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

	async infillContent({
		templateContext,
		charName,
		seedName,
		personaName,
		useChatFormat
	}: {
		templateContext: TemplateContext
		charName: string
		seedName: string
		personaName: string
		useChatFormat: boolean
	}) {
		const engine = new KeywordInfillEngine(
			this.chat,
			this.interpolationEngine,
			populateLorebookEntryBindings,
			this.currentCharacterId
		)
		return await engine.infillContent({
			charName,
			seedName,
			personaName,
			templateContext,
			useChatFormat,
			tokenLimit: this.tokenLimit,
			contextThresholdPercent: this.contextThresholdPercent,
			tokenCounter: this.tokenCounter,
			handlebars: this.handlebars,
			contextConfig: this.contextConfig
		})
	}

	// --- Modularized section: sources reporting ---
	private buildSources(scenarioSource: null | "character" | "chat") {
		const chatCharactersArr = this.chat.chatCharacters || []
		const chatPersonasArr = this.chat.chatPersonas || []

		// Filter characters based on visibility settings (same logic as buildContextData)
		const visibleChatCharacters = chatCharactersArr.filter((cc: any) => {
			// Always include the current character
			const isCurrentCharacter =
				cc.character.id === this.currentCharacterId
			// Filter out hidden characters unless they're the current character
			return (
				isCurrentCharacter ||
				cc.visibility !== ChatCharacterVisibility.HIDDEN
			)
		})

		return {
			characters: visibleChatCharacters.map((cc: any) => {
				const c = cc.character
				return {
					id: c.id,
					name: c.name,
					nickname: c.nickname,
					description: Boolean(c.description),
					personality: Boolean(c.personality),
					exampleDialogue: Boolean(
						c.exampleDialogues &&
							Array.isArray(c.exampleDialogues) &&
							c.exampleDialogues.length > 0
					),
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

	// --- Load tagged entities for assistant mode ---
	private async loadTaggedEntities(): Promise<string> {
		if (!this.isAssistantMode) {
			return ""
		}

		const metadata = this.chat.metadata as any
		if (!metadata || !metadata.taggedEntities) {
			return ""
		}

		const sections: string[] = []

		// Load tagged characters
		if (
			metadata.taggedEntities.characters &&
			Array.isArray(metadata.taggedEntities.characters)
		) {
			const { db } = await import("../../db")
			const characterIds = metadata.taggedEntities.characters

			if (characterIds.length > 0) {
				const characters = await db.query.characters.findMany({
					where: (c: any, { inArray, eq, and }: any) =>
						and(
							inArray(c.id, characterIds),
							eq(c.userId, this.chat.userId)
						),
					columns: {
						id: true,
						name: true,
						nickname: true,
						description: true,
						avatar: true,
						createdAt: true
					}
				})

				if (characters.length > 0) {
					sections.push("## Tagged Characters\n")
					for (const char of characters) {
						sections.push(
							`### ${char.name}${char.nickname ? ` (${char.nickname})` : ""}`
						)
						sections.push(`- ID: ${char.id}`)
						if (char.description) {
							sections.push(`- Description: ${char.description}`)
						}
						if (char.avatar) {
							sections.push(`- Avatar: ${char.avatar}`)
						}
						sections.push(
							`- Created: ${new Date(char.createdAt).toLocaleDateString()}\n`
						)
					}
				}
			}
		}

		return sections.length > 0 ? "\n" + sections.join("\n") + "\n" : ""
	}

	// --- Main compilePrompt ---
	async compilePrompt({
		useChatFormat = false,
		extraInstructions
	}: {
		useChatFormat?: boolean
		/** Ad hoc text appended to the system prompt for this compile only —
		 * e.g. the Narrator's optional per-trigger focus note. Not persisted
		 * on the prompt config itself. */
		extraInstructions?: string
	}): Promise<CompiledPrompt> {
		this.registerHandlebarsHelpers({ useChatFormat })
		const chatCharacters = this.chat.chatCharacters as
			| (SelectChatCharacter & { character: SelectCharacter })[]
			| undefined
		// A null currentCharacterId is a deliberate "no single perspective" mode
		// (Narrator response) rather than a missing-character error — only a
		// non-null id that fails to resolve is a real data-integrity problem.
		const currentCharacter: SelectCharacter | null =
			this.currentCharacterId != null
				? (chatCharacters?.find(
						(cc) => cc.character.id === this.currentCharacterId
					)?.character ?? null)
				: null
		if (this.currentCharacterId != null && !currentCharacter) {
			throw new Error(
				`compilePrompt: No character found with ID ${this.currentCharacterId}`
			)
		}

		this.buildContextData(currentCharacter)
		if (extraInstructions) {
			this.instructions = this.instructions
				? `${this.instructions}\n\nAdditional focus for this response: ${extraInstructions}`
				: extraInstructions
		}

		// No single current character/persona to name in no-perspective mode —
		// {{char}}/{{user}} (and {{character}}/{{persona}}) resolve to the full
		// joined cast lists instead, same convention as {{characterNames}}/
		// {{personaNames}} below.
		const charName = currentCharacter
			? resolveCharacterName(currentCharacter)
			: joinWithAnd(this.getVisibleCharacterNames())
		// Unlike charName, seedName must NOT fall back to the joined cast list —
		// it primes the trailing assistant placeholder turn ("Name:"), and a
		// multi-name seed teaches the model to write joint dialogue as those
		// characters instead of narrating as the Narrator. "Narrator" matches
		// the same default ContentProcessors.ts uses for already-saved Narrator
		// response messages in history (narratorName metadata || "Narrator"),
		// so the seed is consistent with how every other narration line reads.
		const seedName = currentCharacter
			? resolveCharacterName(currentCharacter)
			: "Narrator"
		const personaName = currentCharacter
			? (this.chat.chatPersonas &&
					this.chat.chatPersonas[0]?.persona?.name) ||
				"user"
			: joinWithAnd(this.getPersonaNames())
		const interpolationContext =
			this.interpolationEngine.createInterpolationContext({
				currentCharacterName: charName,
				currentPersonaName: personaName
			})

		const instructions = this.interpolationEngine.interpolateString(
			this.instructions,
			interpolationContext
		)
		const exampleDialogue = this.interpolationEngine.interpolateString(
			this.exampleDialogue,
			interpolationContext
		)
		const postHistoryInstructions =
			this.interpolationEngine.interpolateString(
				this.postHistoryInstructions,
				interpolationContext
			)

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

		// Dispatch to RagInfillEngine when vectorization is active and model is ready
		const ragIgnored = !!(this.chat.metadata as any)?.ragIgnored
		let infillResult: InfillResult | null = null

		if (!ragIgnored && isModelReady()) {
			try {
				const { db } = await import("../../db")
				const settings = await db.query.systemSettings.findFirst({
					columns: { vectorizationEnabled: true }
				})
				if (settings?.vectorizationEnabled) {
					const ragEngine = new RagInfillEngine(
						this.chat,
						this.interpolationEngine,
						populateLorebookEntryBindings,
						this.diagnosticsEnabled
					)
					infillResult = await ragEngine.infillContent({
						charName,
						seedName,
						personaName,
						templateContext,
						useChatFormat,
						tokenLimit: this.tokenLimit,
						contextThresholdPercent: this.contextThresholdPercent,
						tokenCounter: this.tokenCounter,
						handlebars: this.handlebars,
						contextConfig: this.contextConfig
					})
				}
			} catch (err) {
				console.warn(
					"[PromptBuilder] RagInfillEngine failed, falling back to keyword infill:",
					err
				)
				infillResult = null
			}
		}

		// Fall back to keyword-based infill
		if (!infillResult) {
			infillResult = await this.infillContent({
				templateContext,
				charName,
				seedName,
				personaName,
				useChatFormat
			})
		}

		const {
			renderedPrompt,
			renderedMessages,
			totalTokens,
			chatMessages: {
				included: includedChatMessages,
				includedIds,
				excludedIds
			},
			rag
		} = infillResult

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
				sources,
				...(rag ? { rag } : {})
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
export type {
	InterpolationContext,
	CharacterData,
	PersonaData
} from "./InterpolationEngine"

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
