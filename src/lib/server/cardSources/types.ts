import type {
	CardKind,
	CardSourceId,
	CardSourceSort,
	LibraryCatalogItem
} from "$lib/shared/library/types"

export type { CardKind, CardSourceId, CardSourceSort }

/** Context passed through to a CardSource for a given request. */
export interface CardSourceContext {
	userId: number
}

export interface CardSourceSearchParams {
	kind: CardKind
	searchTerm?: string
	category?: string
	/** Whether to include NSFW results. Callers must apply the env-gate + user-preference policy before setting this — sources trust it as-is. */
	nsfw?: boolean
	sort?: CardSourceSort
	cursor?: { limit: number; offset: number }
}

export interface CardSourceSearchResult {
	items: LibraryCatalogItem[]
	hasMore: boolean
}

export interface CardSource {
	id: CardSourceId
	label: string
	/** Short, one-line description shown in the library UI when this source is active. */
	description: string
	/** Link to the source's own site/repository, shown alongside its description. */
	url: string
	supports(kind: CardKind): boolean
	requiresAuthForBestResults: boolean
	search(
		params: CardSourceSearchParams,
		ctx: CardSourceContext
	): Promise<CardSourceSearchResult>
	/** Fetch the raw card bytes (PNG or JSON) for a given item's sourceRef, ready to hand to the existing *ImportCard handlers. */
	getCardBytes(ref: unknown, ctx: CardSourceContext): Promise<Buffer>
	/**
	 * Optional: fetch richer per-card fields not present on search results
	 * (eg. CharaVault's list endpoint doesn't document returning
	 * `description` — only its single-card detail endpoint does). Sources
	 * that already return everything from search() don't need to implement
	 * this.
	 */
	getCardDetail?(
		ref: unknown,
		ctx: CardSourceContext
	): Promise<Partial<LibraryCatalogItem>>
}

export class CardSourceUnavailableError extends Error {
	constructor(message = "Card source is unreachable") {
		super(message)
		this.name = "CardSourceUnavailableError"
	}
}

export class CardSourceRateLimitedError extends Error {
	constructor(public retryAfterMs: number) {
		super("Rate limited")
		this.name = "CardSourceRateLimitedError"
	}
}
