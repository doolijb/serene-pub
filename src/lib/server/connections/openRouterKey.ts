/**
 * What an OpenRouter key can spend: has its account ever bought credit?
 *
 * ## Why this exists
 *
 * An OpenRouter key whose account has never bought credit is refused on every
 * paid model, yet OpenRouter lists hundreds of them. A person pasting such a
 * key meets a long list, picks a famous model and gets a refusal. OpenRouter
 * answers the question in one call (`GET /api/v1/key` → `is_free_tier`), so we
 * ask it, remember the answer, and let the connection screen say "free models
 * first" instead of leaving the person to find that out by failing.
 *
 * ## Where the facts live
 *
 * `connections.extra_json.openrouter` — server-owned, exactly as `comfy` is
 * (`imageGen/comfy/serverCheck.ts`): a client's copy is never written and a
 * save keeps the stored bag, except that a changed key drops it (the fact
 * belonged to the old key). No table, no migration.
 *
 * ## What it is not
 *
 * Not a gate: a free-tier key is never blocked from a paid model, the model
 * list is only ordered and the next step reworded. Not a price list: model
 * prices come from the listing (`ModelFacts.pricing`). Not a quota meter: the
 * daily figure is OpenRouter's stated limit, not a count of ours.
 *
 * The key is sent ONLY to the fixed openrouter.ai addresses below, never to the
 * connection's own base URL (which may be a proxy). Every function here
 * answers "unknown" (null) rather than throwing: a failed look must never fail
 * a test or a sync.
 */
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { decryptApiKeyField } from "$lib/server/utils/tokenCrypto"

export const OPENROUTER_KEY_URL = "https://openrouter.ai/api/v1/key"
/** The older address, tried once and only when the first answers 404. */
export const OPENROUTER_KEY_LEGACY_URL = "https://openrouter.ai/api/v1/auth/key"
export const OPENROUTER_KEY_TIMEOUT_MS = 5000
/** The server-owned key under `extra_json`. */
export const OPENROUTER_KEY_FACTS_KEY = "openrouter"

export interface OpenRouterKeyFacts {
	/** OpenRouter's `is_free_tier`: the account has never bought credit. */
	freeTier: boolean
	/** `free_model_daily_requests.limit`, when OpenRouter states a positive one. */
	freeRequestsPerDay?: number
	/** When OpenRouter was asked (ISO 8601). */
	checkedAt: string
}

/** Preset `openrouter`, or an address on openrouter.ai whatever the preset. */
export function isOpenRouterConnection(c: {
	preset?: string | null
	baseUrl?: string | null
}): boolean {
	if (c.preset === "openrouter") return true
	try {
		return (
			new URL(String(c.baseUrl ?? "")).hostname.toLowerCase() ===
			"openrouter.ai"
		)
	} catch {
		return false
	}
}

/** The facts in a `/key` reply; null unless it says `is_free_tier` as a boolean. */
export function parseOpenRouterKeyResponse(
	body: unknown,
	now: Date = new Date()
): OpenRouterKeyFacts | null {
	const data = (body as { data?: Record<string, unknown> } | null | undefined)
		?.data
	if (
		!data ||
		typeof data !== "object" ||
		typeof data.is_free_tier !== "boolean"
	)
		return null
	const limit = (
		data.free_model_daily_requests as { limit?: unknown } | undefined
	)?.limit
	return {
		freeTier: data.is_free_tier,
		...(typeof limit === "number" && Number.isFinite(limit) && limit > 0
			? { freeRequestsPerDay: limit }
			: {}),
		checkedAt: now.toISOString()
	}
}

/** Ask OpenRouter about a key. Never throws; null when it cannot say. */
export async function readOpenRouterKey(
	apiKey: string,
	deps: { fetch?: typeof fetch; timeoutMs?: number; now?: Date } = {}
): Promise<OpenRouterKeyFacts | null> {
	const doFetch = deps.fetch ?? fetch
	const get = (url: string) =>
		doFetch(url, {
			headers: {
				Authorization: `Bearer ${apiKey}`,
				Accept: "application/json"
			},
			signal: AbortSignal.timeout(
				deps.timeoutMs ?? OPENROUTER_KEY_TIMEOUT_MS
			)
		})
	try {
		let res = await get(OPENROUTER_KEY_URL)
		if (res.status === 404) res = await get(OPENROUTER_KEY_LEGACY_URL)
		if (!res.ok) return null
		return parseOpenRouterKeyResponse(await res.json(), deps.now)
	} catch {
		return null
	}
}

/** The stored facts, validated; null when absent or malformed. */
export function openRouterKeyFactsOf(
	connection: { extraJson?: unknown } | null | undefined
): OpenRouterKeyFacts | null {
	const v = (
		connection?.extraJson as Record<string, unknown> | null | undefined
	)?.[OPENROUTER_KEY_FACTS_KEY] as Record<string, unknown> | null | undefined
	if (!v || typeof v !== "object" || typeof v.freeTier !== "boolean")
		return null
	if (typeof v.checkedAt !== "string") return null
	const n = v.freeRequestsPerDay
	return {
		freeTier: v.freeTier,
		...(typeof n === "number" && Number.isFinite(n) && n > 0
			? { freeRequestsPerDay: n }
			: {}),
		checkedAt: v.checkedAt
	}
}

/**
 * Look at the connection's key and record the answer on the row.
 *
 * Not OpenRouter: nothing happens. No usable key: the stored bag goes (it
 * described a key that is not there). A failed look: the stored bag stays, a
 * blip must not erase a fact. Never throws.
 */
export async function recordOpenRouterKey(
	db: Db,
	connection: SelectConnection,
	deps: { fetch?: typeof fetch; timeoutMs?: number; now?: Date } = {}
): Promise<OpenRouterKeyFacts | null> {
	try {
		if (!isOpenRouterConnection(connection)) return null
		const apiKey = decryptApiKeyField(
			(connection.extraJson as Record<string, unknown> | null | undefined)
				?.apiKey
		)
		const write = async (facts: OpenRouterKeyFacts | null) => {
			// Re-read: other writers touch other keys of `extra_json`.
			const row = await db.query.connections.findFirst({
				where: (c, { eq }) => eq(c.id, connection.id),
				columns: { extraJson: true }
			})
			if (!row) return
			const { [OPENROUTER_KEY_FACTS_KEY]: had, ...rest } =
				(row.extraJson ?? {}) as Record<string, unknown>
			if (!facts && had === undefined) return
			await db
				.update(schema.connections)
				.set({
					extraJson: facts
						? { ...rest, [OPENROUTER_KEY_FACTS_KEY]: facts }
						: rest
				})
				.where(eq(schema.connections.id, connection.id))
		}
		if (!apiKey) {
			await write(null)
			return null
		}
		const facts = await readOpenRouterKey(apiKey, deps)
		if (!facts) return null
		await write(facts)
		return facts
	} catch (e) {
		console.warn("[openRouterKey] could not record the key's tier:", e)
		return null
	}
}

/** Free by name (`:free`) or by price (both sides exactly 0). */
export function isFreeModel(row: {
	model: string
	facts?: { pricing?: { inPerMTok?: number; outPerMTok?: number } } | null
}): boolean {
	if (row.model.endsWith(":free")) return true
	const p = row.facts?.pricing
	return p?.inPerMTok === 0 && p?.outPerMTok === 0
}

/** Stable partition: the free rows first, each side in the given order. */
export function freeModelsFirst<T>(
	rows: readonly T[],
	isFree: (r: T) => boolean
): T[] {
	const free: T[] = []
	const paid: T[] = []
	for (const r of rows) (isFree(r) ? free : paid).push(r)
	return [...free, ...paid]
}
