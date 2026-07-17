export type TemplateContextCharacter = {
	name: string
	nickname?: string
	aliases?: string[]
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

export type TemplateContext = {
	instructions: string
	characters: TemplateContextCharacter[] | string // can be JSON stringified
	personas: TemplateContextPersona[] | string // can be JSON stringified
	scenario: string
	exampleDialogue?: string
	postHistoryInstructions?: string
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
}

export type InclusionReason =
	| "reserved_constant"    // pinned/constant entry
	| "reserved_guaranteed"  // message in last MIN_GUARANTEED_MESSAGES window
	| "filled_scored"        // added in fill phase, score.total > 0
	| "filled_zero_score"    // added in fill phase, score.total === 0, budget remained
	| "excluded_budget"      // score > 0 but type cap exhausted
	| "excluded_token_limit" // would have been included but hit token limit
	| "excluded_zero_score"  // score === 0 and budget was consumed
	| "excluded_visibility"  // filtered by character visibility rules
	| "excluded_disabled"    // entry.enabled === false

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
		worldLore:     LoreTypeDiag
		characterLore: LoreTypeDiag
		history:       HistoryTypeDiag
	}
	messages: MessagesDiag
	tokens: { reserve: number; total: number; limit: number; threshold: number }
	entries: ScoredEntry[]   // ALL candidates sorted by score.total descending
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
	personaName: string
	templateContext: TemplateContext
	useChatFormat?: boolean
	tokenLimit: number
	contextThresholdPercent: number
	tokenCounter: any
	handlebars: any
	contextConfig: any
}

export type InfillResult = {
	renderedPrompt: string | undefined
	renderedMessages: any[] | undefined
	totalTokens: number
	chatMessages: { included: number; includedIds: number[]; excludedIds: number[] }
	rag?: RagDiagnostics | NonRagDiagnostics
}
