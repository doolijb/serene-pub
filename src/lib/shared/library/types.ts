/**
 * Shared browsing-library types, used both server-side (CardSource
 * implementations, socket handlers) and client-side (library pages,
 * LibraryPortraitCard/LibraryDetailsModal).
 */

/** Identifies which CardSource produced a given catalog entry. */
export type CardSourceId = "github-serenepub" | "charavault"

export type CardKind = "character" | "persona"

/**
 * Sort order for a browse query. Not every source supports every value —
 * currently only CharaVault does anything with this (its /api/cards
 * ?sort= param); sources that ignore it just return their natural order.
 */
export type CardSourceSort =
	| "newest"
	| "oldest"
	| "name_asc"
	| "name_desc"
	| "most_downloaded"
	| "top_rated"
	| "token_count_asc"
	| "token_count_desc"
	| "most_commented"

export type LibraryCatalogItem = {
	name: string
	description: string
	tags: string[]
	author: string
	version: string
	spec: string
	file: string
	category: string
	source: CardSourceId
	/** Opaque, source-specific reference used to fetch the card's bytes later (eg. via getCardBytes). */
	sourceRef: unknown
	/** Whether this card has an embedded lorebook. Undefined when the source can't tell without a detail fetch. */
	hasLorebook?: boolean
}
