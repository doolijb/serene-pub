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
import * as F from "./contextFields"
import { KeywordInfillEngine } from "./KeywordInfillEngine"
import { RagInfillEngine } from "./RagInfillEngine"
import type {
	CompiledPrompt,
	CompileOptions,
	InfillResult,
	TemplateContext
} from "./types"
import "./utils"
import {
	isModelReady,
	loadConfiguredEmbeddingModelOpportunistically
} from "$lib/server/embedding"

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
	diagnosticsEnabled: boolean = true

	// Legacy properties (gradually being moved to modules)
	assistantCharacters: any[] = []
	userCharacters: any[] = []
	instructions?: string
	exampleDialogue?: string
	postHistoryInstructions?: string
	charExampleDialogue?: string
	promptPostHistoryInstructions?: string
	charPostHistory?: string
	postHistoryDepth: number = 0
	postHistoryTokenTrigger: number = 0

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
		currentCharacterId: number | null
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
		const promptFormat = useChatFormat
			? PromptFormats.SPLIT_CHAT
			: this.connection?.promptFormat || PromptFormats.VICUNA

		registerContextHandlebarsHelpers(this.handlebars, { promptFormat })
	}

	// --- Context builders ---
	// The rules themselves live in `contextFields.ts` so the pipeline path can
	// call them without constructing a builder. These stay as the methods the
	// rest of this class and its callers already use — same names, same
	// signatures, one implementation underneath.
	contextBuildCharacterDescription(character: SelectCharacter): string {
		return F.characterDescription(character)
	}
	contextBuildCharacterPersonality(
		character: SelectCharacter
	): string | undefined {
		return F.characterPersonality(character)
	}
	contextBuildCharacterScenario(
		character: SelectCharacter | null
	): string | undefined {
		return F.characterScenario(character)
	}
	contextBuildPersonaDescription(persona: any): string {
		return F.personaDescription(persona)
	}
	contextBuildSystemPrompt(): string {
		return F.systemPrompt(this.promptConfig as F.PromptConfigFields)
	}
	contextBuildCharacterExampleDialogues(
		character: SelectCharacter | null
	): string | undefined {
		return F.characterExampleDialogue(character)
	}
	contextBuildPostHistoryInstructions(
		character: SelectCharacter | null
	): string | undefined {
		return F.postHistoryInstructions(
			this.promptConfig as F.PromptConfigFields,
			character
		)
	}
	/** The prompt config's own reinforcement text — works uniformly for
	 * character AND narrator prompt configs, both of which carry this
	 * column. Distinct from contextBuildCharPostHistory below, which reads
	 * only the character's own authored field with no config fallback. */
	contextBuildPromptPostHistoryInstructions(): string | undefined {
		return F.promptPostHistoryInstructions(
			this.promptConfig as F.PromptConfigFields
		)
	}
	contextBuildCharPostHistory(
		character: SelectCharacter | null
	): string | undefined {
		return F.charPostHistory(character)
	}
	contextBuildCharacterName(character: SelectCharacter): string {
		return F.characterName(character)
	}
	contextBuildCharacterNickname(
		character: SelectCharacter
	): string | undefined {
		return F.characterNickname(character)
	}
	contextBuildPersonaName(persona: SelectPersona): string {
		return F.personaName(persona)
	}

	compileCharacterData(
		character: SelectCharacter,
		visibility?: string
	): {
		name: string
		nickname?: string
		description: string
		personality?: string
	} | null {
		// If character is hidden, return null to exclude from prompt entirely
		if (visibility === ChatCharacterVisibility.HIDDEN) {
			return null
		}

		const char: any = {
			name: this.contextBuildCharacterName(character),
			nickname: this.contextBuildCharacterNickname(character)
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

	/**
	 * Speaker-centric relationship JSON, rendered as its own template block.
	 * Set from compilePrompt; see TemplateContext.speakerRelationships.
	 */
	speakerRelationships?: string

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
		this.charExampleDialogue = this.exampleDialogue
		this.promptPostHistoryInstructions =
			this.contextBuildPromptPostHistoryInstructions()
		this.charPostHistory =
			this.contextBuildCharPostHistory(currentCharacter)
		this.postHistoryDepth =
			(this.promptConfig as { postHistoryDepth?: number })
				.postHistoryDepth ?? 0
		this.postHistoryTokenTrigger =
			(this.promptConfig as { postHistoryTokenTrigger?: number })
				.postHistoryTokenTrigger ?? 0
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
				["name", "nickname", "description", "personality"]
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
		charExampleDialogue,
		promptPostHistoryInstructions,
		charPostHistory,
		charName,
		personaName
	}: any): TemplateContext {
		return {
			instructions,
			// Flows to both infill engines, which spread this object.
			speakerRelationships: this.speakerRelationships,
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
			// targetIndex/hasContent are placeholders — the final message array
			// isn't known yet at this point, so each infill engine overwrites
			// this whole object with the real values from
			// resolvePostHistoryContext() right before render.
			postHistory: {
				targetIndex: 0,
				instructions: promptPostHistoryInstructions,
				charInstructions: charPostHistory,
				exampleDialogue: charExampleDialogue,
				hasContent: Boolean(
					promptPostHistoryInstructions ||
						charPostHistory ||
						charExampleDialogue
				)
			},
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
			contextConfig: this.contextConfig,
			postHistoryDepth: this.postHistoryDepth,
			postHistoryTokenTrigger: this.postHistoryTokenTrigger
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

	// --- Main compilePrompt ---
	async compilePrompt({
		useChatFormat = false,
		extraInstructions,
		speakerRelationships
	}: {
		useChatFormat?: boolean
		/** Ad hoc text appended to the system prompt for this compile only —
		 * e.g. the Narrator's optional per-trigger focus note. Not persisted
		 * on the prompt config itself. */
		extraInstructions?: string
		/** Rendered in its own block — NOT merged into instructions. */
		speakerRelationships?: string
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

		this.speakerRelationships = speakerRelationships
		this.buildContextData(currentCharacter)
		if (extraInstructions) {
			this.instructions = this.instructions
				? `${this.instructions}\n\nAdditional focus for this response: ${extraInstructions}`
				: extraInstructions
			// Also reinforce it right before the generation point, not just at
			// the top of the prompt — the same reasoning as
			// postHistoryInstructions generally: a per-trigger note (e.g. the
			// Narrator's optional "focus on X" field) is exactly the kind of
			// instruction that needs to be near the seed to actually be
			// followed after a long conversation history, not buried in the
			// system prompt alongside everything else. Combines with the
			// config's own postHistoryInstructions when both are present
			// rather than one replacing the other.
			this.postHistoryInstructions = this.postHistoryInstructions
				? `${this.postHistoryInstructions}\n\nAdditional focus for this response: ${extraInstructions}`
				: `Additional focus for this response: ${extraInstructions}`
			this.promptPostHistoryInstructions = this
				.promptPostHistoryInstructions
				? `${this.promptPostHistoryInstructions}\n\nAdditional focus for this response: ${extraInstructions}`
				: `Additional focus for this response: ${extraInstructions}`
		}

		// No single current character/persona to name in no-perspective mode —
		// {{char}}/{{user}} (and {{character}}/{{persona}}) resolve to the full
		// joined cast lists instead, same convention as {{characterNames}}/
		// {{personaNames}} below.
		const charName = currentCharacter
			? resolveCharacterName(currentCharacter)
			: joinWithAnd(this.getVisibleCharacterNames())
		// this.promptConfig is actually the narratorPromptConfigs row at
		// runtime in no-perspective mode (see BaseConnectionAdapter's
		// constructor), which — unlike the base prompt config type it's
		// declared as — carries a user-configurable narratorName (e.g. "The
		// GM", default "Narrator"). Cast rather than widen the field's type
		// project-wide for one narrator-only property.
		const narratorName =
			(this.promptConfig as { narratorName?: string }).narratorName ||
			"Narrator"
		// Unlike charName, seedName must NOT fall back to the joined cast list —
		// it primes the trailing assistant placeholder turn ("Name:"), and a
		// multi-name seed teaches the model to write joint dialogue as those
		// characters instead of narrating as the Narrator. Uses the actual
		// configured narratorName (not a hardcoded "Narrator" literal) so a
		// renamed narrator (e.g. "The GM") seeds and reads consistently with
		// ContentProcessors.ts's handling of already-saved Narrator response
		// messages in history (narratorName metadata || "Narrator") and with
		// every other place narratorName is surfaced (UI, message metadata).
		const seedName = currentCharacter
			? resolveCharacterName(currentCharacter)
			: narratorName
		const personaName = currentCharacter
			? (this.chat.chatPersonas &&
					this.chat.chatPersonas[0]?.persona?.name) ||
				"user"
			: joinWithAnd(this.getPersonaNames())
		// characterNames/personaNames must be available here, not just in
		// buildTemplateContext() below — this.instructions (the prompt config's
		// raw systemPrompt, e.g. the built-in Narrator config's "Do not speak or
		// act as {{characterNames}} or {{personaNames}}") is interpolated with
		// this exact context a few lines down. Omitting them here left those
		// placeholders resolving to "" (Handlebars' default for an unknown key)
		// by the time buildTemplateContext's copy became available — too late,
		// since the instructions string was already finalized.
		const interpolationContext =
			this.interpolationEngine.createInterpolationContext({
				currentCharacterName: charName,
				currentPersonaName: personaName,
				additionalContext: {
					characterNames: joinWithAnd(
						this.getVisibleCharacterNames()
					),
					personaNames: joinWithAnd(this.getPersonaNames()),
					// Lets a Narrator prompt config's own text reference its
					// configured display name directly, e.g. "You are
					// {{narratorName}}, narrating this scene..." — meaningful
					// in narrator/no-perspective mode only; a plain character
					// response just gets the "Narrator" default back, same as
					// every unused placeholder resolves to its passed value.
					narratorName
				}
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
		const charExampleDialogue = this.interpolationEngine.interpolateString(
			this.charExampleDialogue,
			interpolationContext
		)
		const promptPostHistoryInstructions =
			this.interpolationEngine.interpolateString(
				this.promptPostHistoryInstructions,
				interpolationContext
			)
		const charPostHistory = this.interpolationEngine.interpolateString(
			this.charPostHistory,
			interpolationContext
		)

		const { scenarioInterpolated, scenarioSource } =
			this.getScenarioInterpolated(currentCharacter, interpolationContext)
		const assistantCharacters =
			this.getInterpolatedCharacters(interpolationContext)
		const assistantCharactersWithLore = attachCharacterLoreToCharacters(
			assistantCharacters,
			[], // Character lore is now handled by KeywordInfillEngine/RagInfillEngine
			this.chat
		)
		const charactersInterpolated = JSON.stringify(
			assistantCharactersWithLore,
			null,
			2
		)
		const userCharactersWithLore = attachCharacterLoreToCharacters(
			this.getInterpolatedPersonas(interpolationContext),
			[], // Character lore is now handled by KeywordInfillEngine/RagInfillEngine
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
			charExampleDialogue,
			promptPostHistoryInstructions,
			charPostHistory,
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
						this.currentCharacterId,
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
						contextConfig: this.contextConfig,
						postHistoryDepth: this.postHistoryDepth,
						postHistoryTokenTrigger: this.postHistoryTokenTrigger
					})
				}
			} catch (err) {
				console.warn(
					"[PromptBuilder] RagInfillEngine failed, falling back to keyword infill:",
					err
				)
				infillResult = null
			}
		} else if (!ragIgnored && !isModelReady()) {
			// Model isn't warm for THIS turn — don't block the response
			// waiting for it (a local model load can take real seconds).
			// Fall through to keyword-mode below same as always, but kick
			// off a background load so a *following* turn has a warm model
			// instead of staying cold until the vectorization queue happens
			// to load it as a side effect of an unrelated embedding write
			// (which, post-generation auto-enqueue aside, could be the next
			// periodic scan — up to 15 minutes away). Bounded/cooldown-
			// limited internally (see loadConfiguredEmbeddingModelOpportunistically's
			// own doc comment) so a sustained slow-paced session doesn't
			// load-then-idle-unload on every single turn for no benefit.
			try {
				const { db } = await import("../../db")
				const settings = await db.query.systemSettings.findFirst({
					columns: { vectorizationEnabled: true }
				})
				if (settings?.vectorizationEnabled) {
					void loadConfiguredEmbeddingModelOpportunistically().catch(
						(err) => {
							console.warn(
								"[PromptBuilder] Background embedding model load failed:",
								err
							)
						}
					)
				}
			} catch (err) {
				console.warn(
					"[PromptBuilder] Failed to check vectorization settings for background model load:",
					err
				)
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
