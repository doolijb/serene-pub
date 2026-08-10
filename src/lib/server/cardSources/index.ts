import type {
	CardSourceId,
	LibraryCatalogItem
} from "$lib/shared/library/types"
import type {
	CardSource,
	CardSourceContext,
	CardSourceSearchParams,
	CardSourceSearchResult
} from "./types"
import { githubYamlCardSource } from "./githubYamlCardSource"
import { charaVaultSource } from "./charaVault/charaVaultSource"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import { isUnsafeCharacterBrowsingEnabled } from "$lib/server/utils"
import { searchCache, stableSearchKey, cardDetailCache } from "./cache"

const sources: Partial<Record<CardSourceId, CardSource>> = {
	"github-serenepub": githubYamlCardSource,
	charavault: charaVaultSource
}

export function resolveCardSource(id: CardSourceId): CardSource {
	const source = sources[id]
	if (!source) throw new Error(`Unknown card source: ${id}`)
	return source
}

export function listCardSources(): CardSource[] {
	return Object.values(sources) as CardSource[]
}

/**
 * The env-gate + per-user preference policy decision, computed once here
 * rather than trusting a client-supplied `nsfw` param — NSFW visibility
 * must be server-authoritative, never a client-computed check.
 */
export async function resolveNsfwParam(userId: number): Promise<boolean> {
	if (!isUnsafeCharacterBrowsingEnabled()) return false
	const settings = await db.query.userSettings.findFirst({
		where: eq(schema.userSettings.userId, userId),
		columns: { charaVaultIncludeNsfw: true }
	})
	return settings?.charaVaultIncludeNsfw ?? false
}

/** Courtesy TTL cache in front of source.search(), shared across users (not keyed by userId) since identical queries can share a result. */
export async function cachedSearch(
	sourceId: CardSourceId,
	params: CardSourceSearchParams,
	ctx: CardSourceContext
): Promise<CardSourceSearchResult> {
	const key = stableSearchKey({ sourceId, ...params } as Record<
		string,
		unknown
	>)
	// ctx.signal (this caller's own) drives attach/detach on the shared
	// cache entry; the group signal getOrFetch hands back is what actually
	// reaches source.search() — only fires once every attached caller has
	// given up, so one caller's cancellation can't cut off another caller
	// still waiting on an identical in-flight search.
	return searchCache.getOrFetch(
		key,
		(signal) => resolveCardSource(sourceId).search(params, { ...ctx, signal }),
		ctx.signal
	) as Promise<CardSourceSearchResult>
}

/**
 * Fetches richer per-card fields (currently: description, hasLorebook) for
 * sources whose search() results don't already include everything — eg.
 * CharaVault's list endpoint doesn't return a description, only its
 * single-card detail endpoint does. Returns {} for sources with no
 * getCardDetail (their search results are already complete), so callers
 * can merge the result unconditionally.
 */
export async function cachedCardDetail(
	sourceId: CardSourceId,
	ref: unknown,
	ctx: CardSourceContext
): Promise<Partial<LibraryCatalogItem>> {
	const source = resolveCardSource(sourceId)
	if (!source.getCardDetail) return {}

	const key = stableSearchKey({ sourceId, ref } as Record<string, unknown>)
	return cardDetailCache.getOrFetch(
		key,
		(signal) => source.getCardDetail!(ref, { ...ctx, signal }),
		ctx.signal
	) as Promise<Partial<LibraryCatalogItem>>
}

export * from "./types"
