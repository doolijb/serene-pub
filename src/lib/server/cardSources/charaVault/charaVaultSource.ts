import type { LibraryCatalogItem } from "$lib/shared/library/types"
import type {
	CardKind,
	CardSource,
	CardSourceContext,
	CardSourceSearchParams,
	CardSourceSearchResult
} from "../types"
import { CardSourceRateLimitedError, CardSourceUnavailableError } from "../types"
import { acquire } from "./rateLimiter"
import { hasActiveSession, withCharaVaultSession } from "./session"
import { getOrFetchCardBytes } from "../diskCache"
import { parseCharacterCard } from "$lib/server/utils/characterCardParser"
import {
	applyDefaultContentFilter,
	hasExcludedTag,
	hasExcludedNameMatch
} from "./contentFilter"

const API_BASE = "https://charavault.net"
const DEFAULT_LIMIT = 24

interface CharaVaultCardRef {
	folder: string
	file: string
}

// folder/file ultimately come from client-supplied data (socket params,
// URL path segments in the image-proxy route) and get interpolated
// straight into a CharaVault URL path. encodeURIComponent doesn't escape
// "." — a folder of ".." survives encoding intact, and WHATWG URL parsing
// (used internally by fetch()) collapses ../ path segments before the
// request leaves the process. Without this check, a crafted ref could
// make the server issue an authenticated request (using the shared admin
// session cookie) to ANY path on charavault.net, with the image-proxy
// route streaming the raw response back to whoever asked — a
// confused-deputy/SSRF vector reachable by any authenticated user, not
// just admins.
//
// Real CharaVault folder/file values are NOT restricted to a tidy
// alphanumeric charset (a live sample confirmed this session) — they
// routinely contain spaces, parentheses, quotes, plus signs, and unicode/
// emoji (eg. `"00 - INFO + REQUEST_...png"`, `'+˚｡ᡣ🍔  007n7
// (RobloxForsaken)_....png'`). An allowlist regex narrow enough to stop
// traversal ended up rejecting the vast majority of real cards. The actual
// exploit only needs a literal "/" (to add path segments) or an exact ".."
// / "." segment (special-cased by URL normalization) — encodeURIComponent
// already safely escapes everything else (spaces, unicode, parens, etc.)
// into a single opaque path segment. So block only those, not the rest of
// the printable character space.
function isSafeCardRefSegment(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= 512 &&
		!value.includes("/") &&
		!value.includes("\\") &&
		// eslint-disable-next-line no-control-regex
		!/[\x00-\x1f]/.test(value) &&
		value !== "." &&
		value !== ".."
	)
}

function toCharaVaultCardRef(ref: unknown): CharaVaultCardRef {
	const { folder, file } = (ref ?? {}) as Partial<CharaVaultCardRef>
	if (!isSafeCardRefSegment(folder) || !isSafeCardRefSegment(file)) {
		throw new CardSourceUnavailableError("Invalid CharaVault card reference")
	}
	return { folder, file }
}

/**
 * charavault.net's exact list-response JSON shape isn't publicly
 * documented (only the query params and detail-endpoint description are).
 * This mapper is deliberately defensive — it tries several plausible key
 * names per field and skips entries it can't extract a folder+file
 * reference from (those can't be downloaded, so they're not useful in the
 * catalog anyway) rather than throwing and failing the whole search.
 */
function mapCharaVaultItem(raw: any): LibraryCatalogItem | null {
	const folder: string | undefined = raw.folder ?? raw.dir ?? raw.directory
	const file: string | undefined = raw.file ?? raw.filename ?? raw.png

	if (!folder || !file) return null

	const ref: CharaVaultCardRef = { folder, file }

	return {
		name: raw.name ?? raw.title ?? "Untitled",
		// The list endpoint's field is `description_preview` (confirmed live
		// against a real /api/cards response) — a truncated preview, not the
		// full description. `description`/`desc`/`summary` kept as fallbacks
		// in case a differently-shaped payload ever comes through.
		description:
			raw.description_preview ?? raw.description ?? raw.desc ?? raw.summary ?? "",
		tags: Array.isArray(raw.tags) ? raw.tags : [],
		author: raw.creator ?? raw.author ?? "",
		version: raw.version ?? raw.card_version ?? "",
		spec: raw.spec ?? "V3",
		file: `${folder}/${file}`,
		category: raw.folder ?? raw.category ?? "Uncategorized",
		source: "charavault",
		sourceRef: ref,
		// Confirmed live field name is `has_lorebook`, not `has_book` (that's
		// only the outbound ?has_book= query param name, not the response
		// field) — `has_book` kept as a defensive fallback.
		hasLorebook:
			typeof raw.has_lorebook === "boolean"
				? raw.has_lorebook
				: typeof raw.has_book === "boolean"
					? raw.has_book
					: undefined
	}
}

function extractItems(payload: any): any[] {
	if (Array.isArray(payload)) return payload
	if (Array.isArray(payload?.cards)) return payload.cards
	if (Array.isArray(payload?.items)) return payload.items
	if (Array.isArray(payload?.results)) return payload.results
	if (Array.isArray(payload?.data)) return payload.data
	return []
}

async function charaVaultFetch(path: string): Promise<Response> {
	return withCharaVaultSession(
		async (cookie) => {
			await acquire(hasActiveSession())
			return fetch(`${API_BASE}${path}`, {
				headers: cookie ? { Cookie: cookie } : undefined
			})
		},
		async (response) => response
	)
}

/**
 * Fetches a card's raw PNG response (session/rate-limit-aware, same as
 * every other CharaVault call) without buffering the body — callers that
 * just want to stream bytes through (eg. the image proxy route) get the
 * live Response back directly instead of paying for a full in-memory copy
 * via getCardBytes()'s Buffer conversion, which exists for callers that
 * genuinely need the complete bytes up front (import, which parses/embeds
 * the file).
 */
export async function fetchCharaVaultCardResponse(ref: unknown): Promise<Response> {
	const { folder, file } = toCharaVaultCardRef(ref)
	const response = await charaVaultFetch(
		`/cards/${encodeURIComponent(folder)}/${encodeURIComponent(file)}`
	)

	if (response.status === 429) {
		const retryAfterHeader = response.headers.get("Retry-After")
		const retryAfterMs = retryAfterHeader
			? Number(retryAfterHeader) * 1000
			: 60_000
		throw new CardSourceRateLimitedError(retryAfterMs)
	}
	if (!response.ok) {
		throw new CardSourceUnavailableError(
			`Failed to fetch CharaVault card: ${response.status}`
		)
	}

	return response
}

export const charaVaultSource: CardSource = {
	id: "charavault",
	label: "CharaVault",
	description:
		"A community character-card site with a large searchable catalog and account-based higher rate limits.",
	url: "https://charavault.net",
	requiresAuthForBestResults: true,
	supports(kind: CardKind) {
		// CharaVault has no persona catalog per its public API.
		return kind === "character"
	},
	async search(
		params: CardSourceSearchParams,
		_ctx: CardSourceContext
	): Promise<CardSourceSearchResult> {
		// Clamped once, up front — used both for the outbound request and
		// for the hasMore comparison below, so a caller requesting >200
		// can't end up comparing rawItems.length against a ceiling CharaVault
		// was never actually asked (or able) to honor.
		const limit = Math.min(params.cursor?.limit ?? DEFAULT_LIMIT, 200)
		const offset = params.cursor?.offset ?? 0

		const query = new URLSearchParams()
		// Once a user has actually opted into NSFW-inclusive browsing
		// (env var + their own toggle — already resolved into this boolean
		// by the caller), suppressing borderline-but-technically-SFW tags
		// would be redundant with what they've explicitly asked to see.
		const q = params.nsfw
			? params.searchTerm
			: applyDefaultContentFilter(params.searchTerm)
		if (q) query.set("q", q)
		if (params.category) query.set("folder", params.category)
		if (params.sort) query.set("sort", params.sort)
		if (params.hasBook) query.set("has_book", "true")
		if (params.creatorFilter) query.set("creator", params.creatorFilter)
		query.set("nsfw", params.nsfw ? "true" : "false")
		query.set("limit", String(limit))
		query.set("offset", String(offset))

		const response = await charaVaultFetch(`/api/cards?${query.toString()}`)

		if (response.status === 429) {
			const retryAfterHeader = response.headers.get("Retry-After")
			const retryAfterMs = retryAfterHeader
				? Number(retryAfterHeader) * 1000
				: 60_000
			throw new CardSourceRateLimitedError(retryAfterMs)
		}
		if (!response.ok) {
			throw new CardSourceUnavailableError(
				`CharaVault API error: ${response.status}`
			)
		}

		const payload = await response.json()
		const rawItems = extractItems(payload)
		let items = rawItems
			.map(mapCharaVaultItem)
			.filter((item): item is LibraryCatalogItem => item !== null)

		// The query-string exclusion above is a courtesy, not a guarantee —
		// this is the actual enforcement, checked against each card's real
		// CharaVault-assigned tags rather than trusting their undocumented
		// "-word" query grammar to have matched everything it should have.
		// Also checks the name directly (hasExcludedNameMatch) for terms
		// that reliably signal content on their own even without a matching
		// tag (eg. "milf"/"milfy" shows up in plenty of untagged card names).
		if (!params.nsfw) {
			items = items.filter(
				(item) => !hasExcludedTag(item.tags) && !hasExcludedNameMatch(item.name)
			)
		}

		return {
			items,
			hasMore: rawItems.length >= limit
		}
	},
	async getCardBytes(ref: unknown, _ctx: CardSourceContext): Promise<Buffer> {
		const { folder, file } = toCharaVaultCardRef(ref)
		return getOrFetchCardBytes(`charavault:${folder}/${file}`, async () => {
			const response = await fetchCharaVaultCardResponse(ref)
			return Buffer.from(await response.arrayBuffer())
		})
	},
	async getCardDetail(
		ref: unknown,
		ctx: CardSourceContext
	): Promise<Partial<LibraryCatalogItem>> {
		// CharaVault's JSON detail endpoint (/api/cards/{folder}/{file}) has
		// an undocumented, unverified response shape — guessing at its field
		// names (description/desc/summary/about) turned out not to work.
		// The PNG itself is a much more reliable source: it's a standard
		// Character Card V2/V3 file, the exact format parseCharacterCard()
		// already fully understands (same parser the import flow uses), so
		// read the description straight out of the card's own embedded
		// data instead. Reuses getCardBytes()'s disk cache — this doesn't
		// cost an extra CharaVault request for a card that's already been
		// viewed/downloaded.
		const buffer = await charaVaultSource.getCardBytes(ref, ctx)
		// Deliberately NOT caught-and-swallowed into a resolved {} — a
		// resolved value gets cached by cachedCardDetail()'s TtlCache for
		// 24h, so a transient parse failure (eg. a half-written disk-cache
		// file) would otherwise wrongly cache "no description" long after
		// the real issue is gone. Let it reject; the cache correctly skips
		// caching a rejection, and the client's existing "No description
		// provided" fallback already degrades gracefully either way.
		const { card, lorebook } = await parseCharacterCard(buffer)
		const data = card.toSpecV3().data
		return {
			description: data.description || undefined,
			hasLorebook: !!lorebook
		}
	}
}
