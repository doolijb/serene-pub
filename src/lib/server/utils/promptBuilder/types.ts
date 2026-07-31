export type TemplateContextCharacter = {
	name: string
	nickname?: string
	description: string
	personality?: string
	loreEntries?: SelectCharacterLoreEntry[]
	category?: string
	lorebookBindingId?: number | null
	year?: number
	month?: number
	day?: number
}

export type TemplateContextPersona = {
	name: string
	description: string
}

/**
 * The unified Post-History block's template-facing shape — one namespaced
 * object instead of loose top-level fields, so a template only ever needs
 * `../postHistory` once (via `{{#with}}`) rather than a `../` prefix on
 * every individual field. `targetIndex`/`hasContent` are precomputed
 * decisions (index math, "is there anything to show" existence checks),
 * not lookups — the template has no variadic `or` helper to express
 * "any of these 3 fields populated" itself, and the index depends on the
 * final message array a template can't see, so both are resolved here
 * rather than in Handlebars. See PostHistoryContext.ts.
 */
export type PostHistoryTemplateContext = {
	/** Index into the (already-reversed, oldest-first) chatMessages array
	 * where the block should render. */
	targetIndex: number
	/** Prompt config's own reinforcement text — gated by postHistoryTokenTrigger. */
	instructions?: string
	/** Character's own authored reinforcement text — always rendered when populated. */
	charInstructions?: string
	/** Character's example dialogue — always rendered when populated. */
	exampleDialogue?: string
	/** True if any of the three fields above are populated — the template
	 * renders the whole block's wrapper only when this is true. */
	hasContent: boolean
}

export type TemplateContext = {
	instructions: string
	characters: TemplateContextCharacter[] | string // can be JSON stringified
	personas: TemplateContextPersona[] | string // can be JSON stringified
	scenario: string
	/** Deprecated in favor of the unified Post-History block (postHistory
	 * below) — kept populated for backward compatibility with custom
	 * context configs still referencing {{exampleDialogue}}/
	 * {{postHistoryInstructions}} directly. */
	exampleDialogue?: string
	postHistoryInstructions?: string
	postHistory?: PostHistoryTemplateContext
	chatMessages: any[]
	char: string
	character: string
	user: string
	persona: string
	/** "A, B, and C" — every active, non-hidden character's display name. */
	characterNames: string
	/** "A, B, and C" — every persona's display name. */
	personaNames: string
	worldLore?: string
	characterLore?: SelectCharacterLoreEntry[]
	history?: string
	currentDate?: string
	narrativeGraph?: string
	__promptBuilderInstance?: any
}

export type RagDiagnostics = {
	used: true
	lore: {
		worldLore: { pinned: number; rag: number }
		characterLore: { pinned: number; rag: number }
		history: { pinned: number; rag: number }
	}
	graphPairs: number
	messages: {
		guaranteed: number
		ragOlder: number
		filledIn: number
		total: number
	}
	scores: {
		messageScores: number[]
		loreScores: number[]
		thresholdUsed: number
		queryMessageCount: number
	}
	postHistory?: PostHistoryDiag
}

export type PostHistoryDiag = {
	included: boolean
	reason: "included" | "below_token_trigger" | "empty"
}

export type InclusionReason =
	| "reserved_constant" // pinned/constant entry
	| "reserved_guaranteed" // message in last MIN_GUARANTEED_MESSAGES window
	| "filled_scored" // added in fill phase, score.total > 0
	| "filled_zero_score" // added in fill phase, score.total === 0, budget remained
	| "excluded_budget" // score > 0 but type cap exhausted
	| "excluded_token_limit" // would have been included but hit token limit
	| "excluded_zero_score" // score === 0 and budget was consumed
	| "excluded_visibility" // filtered by character visibility rules
	| "excluded_disabled" // entry.enabled === false

export interface ScoreBreakdown {
	total: number
	keyword: number
	nameMatch: number
	entityCooccurrence: number
	tfidf: number
	sceneAffinity: number
	lastRefRecency: number
	recency: number
	density: number
	/** Additive bonus from the entry's authored priority tier (worldLore/characterLore only). */
	priorityBonus?: number
	includedReason: InclusionReason
}

export interface ScoredEntry {
	type: "worldLore" | "characterLore" | "history" | "message"
	id: number
	name: string
	score: ScoreBreakdown
}

interface LoreTypeDiag {
	pinned: number
	candidates: number
	included: number
	budget: number
	topScore: number
}

interface HistoryTypeDiag extends LoreTypeDiag {
	mostRecentDate: string | undefined
}

interface MessagesDiag {
	guaranteed: number
	candidates: number
	filledIn: number
	budget: number
	total: number
}

export type NonRagDiagnostics = {
	used: false
	lore: {
		worldLore: LoreTypeDiag
		characterLore: LoreTypeDiag
		history: HistoryTypeDiag
	}
	messages: MessagesDiag
	tokens: { reserve: number; total: number; limit: number; threshold: number }
	entries: ScoredEntry[] // ALL candidates sorted by score.total descending
	postHistory?: PostHistoryDiag
}

export type CompiledPrompt = {
	prompt: string | undefined
	messages: any[] | undefined
	meta: {
		promptFormat: string
		templateName: string | null
		timestamp: string
		truncationReason: string | null
		currentTurnCharacterId: number | null
		tokenCounts: {
			total: number
			limit: number
		}
		chatMessages: {
			included: number
			total: number
			includedIds: number[]
			excludedIds: number[]
		}
		sources: any
		rag?: RagDiagnostics | NonRagDiagnostics
	}
}

export type InterpolationContext = {
	char: string
	character: string
	user: string
	persona: string
}

export type AssembledContent = {
	templateContext: TemplateContext
	includedWorldLoreEntries: SelectWorldLoreEntry[]
	includedCharacterLoreEntries: SelectCharacterLoreEntry[]
	includedHistoryEntries: SelectHistoryEntry[]
	chatMessages: any[]
}

export type CompileOptions = {
	useChatFormat?: boolean
}

export type InfillContentOptions = {
	charName: string
	/**
	 * Name used to seed the trailing placeholder assistant turn that primes
	 * the LLM to continue as a given speaker (e.g. "Cassian Vharo:"). Distinct
	 * from charName, which is the joined cast list ("Cassian Vharo and
	 * Elowyn") used for {{char}}/{{character}} template interpolation in
	 * no-single-perspective (Narrator response) mode — that joined text is a
	 * reasonable stand-in inside descriptive prose, but using it as the seed
	 * primes the model to write joint dialogue AS those characters instead of
	 * narrating as the Narrator. Empty string when there's no single character
	 * to seed as (Narrator response mode).
	 */
	seedName: string
	personaName: string
	templateContext: TemplateContext
	useChatFormat?: boolean
	tokenLimit: number
	contextThresholdPercent: number
	tokenCounter: any
	handlebars: any
	contextConfig: any
	/** Number of messages back from the last message the Post-History block
	 * is positioned at. 0 = immediately after the last message. */
	postHistoryDepth: number
	/** Minimum chat-history token count required before
	 * promptPostHistoryInstructions is included. 0 = always included. */
	postHistoryTokenTrigger: number
}

export type InfillResult = {
	renderedPrompt: string | undefined
	renderedMessages: any[] | undefined
	totalTokens: number
	chatMessages: {
		included: number
		includedIds: number[]
		excludedIds: number[]
	}
	rag?: RagDiagnostics | NonRagDiagnostics
}
