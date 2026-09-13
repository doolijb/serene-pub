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

import {
	CHARACTER_LORE_TYPE_ID,
	type LorebookEntry
} from "$lib/shared/entries/types"

export type TemplateContextCharacter = {
	name: string
	nickname?: string
	description: string
	personality?: string
	loreEntries?: LorebookEntry<typeof CHARACTER_LORE_TYPE_ID>[]
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
	/** Index into the (already-reversed, oldest-first) sessionMessages array
	 * where the block should render. */
	targetIndex: number
	/** Prompt config's own reinforcement text. */
	instructions?: string
	/** Character's own authored reinforcement text. */
	charInstructions?: string
	/** Character's example dialogue. */
	exampleDialogue?: string
	/** True when the block renders: any of the three fields above are
	 * populated and the trigger admits it. The three are one block, so they
	 * are present together or not at all. */
	hasContent: boolean
	/**
	 * Which node gates this copy.
	 *
	 * The context builder ships the reminder whether or not the trigger admits
	 * it: the history it is measured against is not assembled yet. Assemble
	 * makes the decision and publishes it as diagnostics, so a reader of the
	 * builder's output needs to know this copy is the INPUT to that decision
	 * rather than its outcome. Absent on the copy assemble hands the template,
	 * which is the decision.
	 */
	gatedBy?: "assemble"
}

/**
 * What `core:query/session-state@1` publishes, as a template sees it.
 *
 * Declared here rather than imported from `$lib/server/state` so this type file
 * stays free of the resolution module's imports; the two are kept honest by
 * `stateFor`'s own return type, which is the same shape.
 */
export type ResolvedSessionState = {
	world: Record<string, unknown>
	cast: Record<string, Record<string, unknown>>
	possessions: Record<
		string,
		{ entryId: number; name: string; quantity: number }[]
	>
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
	sessionMessages: any[]
	char: string
	character: string
	user: string
	persona: string
	/** "A, B, and C" — every active, non-hidden character's display name. */
	characterNames: string
	/** "A, B, and C" — every persona's display name. */
	personaNames: string
	worldLore?: string
	characterLore?: LorebookEntry<typeof CHARACTER_LORE_TYPE_ID>[]
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
	/**
	 * The session's resolved stats, states and possessions — `state.world.weather`,
	 * `state.cast.verity.hp`.
	 *
	 * ⚠ **Structure, not a rendered string**, unlike every value above it. A
	 * template tests it (`{{#if (eq state.world.weather "storm")}}`) and reads
	 * single values out of it, which a rendered block could not offer. That is
	 * also why it has no variable layout: there is nothing to lay out until an
	 * author decides which of these to say out loud.
	 *
	 * Absent on every pipeline that does not wire `core:query/session-state@1`,
	 * which is all of them today — so a chat's context is exactly what it was.
	 */
	state?: ResolvedSessionState
	__promptBuilderInstance?: any
}

/**
 * What the post-history decision was, and the numbers that made it.
 *
 * Published on the assemble node's output so the receipt answers "why is there
 * no reminder in this prompt" without a re-run. The numbers ride along because
 * a verdict without them ("suppressed") is a claim a reader has to take on
 * trust — with them it is "278 tokens is below the 100000 trigger", which is
 * checkable against the settings screen.
 */
export type PostHistoryDiag = {
	included: boolean
	reason: "included" | "below_token_trigger" | "empty"
	/** The measured size of the history. Absent when no trigger made it be
	 *  measured — a trigger of 0 admits every session. */
	historyTokens?: number
	/** The trigger the decision ran against. 0 always adds the reminder. */
	trigger: number
	/** How many messages back from the newest the block is placed. */
	depth: number
	/** Where it lands in the final message array. */
	targetIndex: number
	/** The block carries the card author's own reminder. A fact about its
	 *  contents: the trigger governs the whole block, this part included. */
	hasCharInstructions: boolean
	/** The block carries the card's example dialogue. Governed the same way. */
	hasExampleDialogue: boolean
}
