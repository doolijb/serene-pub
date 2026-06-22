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
		rag?: RagDiagnostics
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
