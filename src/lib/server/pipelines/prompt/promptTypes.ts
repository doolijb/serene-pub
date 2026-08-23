/**
 * The shapes a context template renders against.
 *
 * Lifted out of `promptBuilder/types.ts`, which is being dismantled: these five
 * describe what the *pipeline* produces, so they live beside the code that
 * produces them. `promptBuilder/types.ts` re-exports them so the legacy engines
 * keep compiling until they are deleted — the surviving half owns the
 * definition, the dying half borrows it, which is the same direction
 * `PRIORITY_SCORE_BONUS` moved for the same reason.
 *
 * `CompiledPrompt` deliberately did **not** come along. It is the *adapter*
 * payload contract, used by seven adapters, and `app.d.ts` declares two
 * unrelated ambient globals of that name — `BaseConnectionAdapter` already
 * aliases around the collision. Moving it means repointing every adapter
 * explicitly, never by dropping an import specifier, because the bare name
 * would then resolve to a global with a different shape that still typechecks.
 * That belongs with the adapter work, not here.
 */

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
	/**
	 * The speaker-centric relationship summary from
	 * graphContextFormatter.buildGraphContext — JSON, rendered in its own
	 * template block.
	 *
	 * Distinct from `narrativeGraph` above, which NarrativeGraphContext.ts
	 * populates from the infill engines. This one used to be spliced into
	 * `instructions` and both post-history fields as prose
	 * ("Additional focus for this response: {...}"), which put a fenced JSON
	 * blob at the most recency-weighted point of the prompt and had models
	 * closing their replies with a stray ``` — and duplicated the payload
	 * three times per message.
	 */
	relationshipsPerspectives?: string
	relationshipsKnown?: string
	__promptBuilderInstance?: any
}

export type PostHistoryDiag = {
	included: boolean
	reason: "included" | "below_token_trigger" | "empty"
}
