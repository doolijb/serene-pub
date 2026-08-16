import { sortKeysDeep } from "$lib/server/utils/contentHash"
import {
	getOrStartAbortable,
	type PendingAbortableEntry
} from "./pendingAbortableFetch"

/**
 * Small generic TTL cache — Map + lazy expiry-on-read, no per-entry
 * timers. Used to avoid hammering upstream sources (a courtesy to
 * CharaVault's infra, and a fix for the GitHub adapter's previous
 * "re-fetch + re-parse the whole YAML on every debounced keystroke"
 * behavior).
 */
export class TtlCache<T> {
	private entries = new Map<string, { value: T; expiresAt: number }>()
	// In-flight de-dup: concurrent getOrFetch() calls for the same not-yet-
	// cached key share one fetcher() call instead of each kicking off their
	// own (a "cache stampede" — eg. several rapid keystroke-triggered
	// searches landing before the first has finished). Reference-counted via
	// pendingAbortableFetch.ts so a caller's own cancellation (eg. a
	// superseded search) only aborts the shared fetcher() once every
	// attached caller has given up, not on the first one.
	private pending = new Map<string, PendingAbortableEntry<T>>()

	constructor(private ttlMs: number) {}

	get(key: string): T | undefined {
		const entry = this.entries.get(key)
		if (!entry) return undefined
		if (entry.expiresAt <= Date.now()) {
			this.entries.delete(key)
			return undefined
		}
		return entry.value
	}

	set(key: string, value: T): void {
		this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs })
	}

	async getOrFetch(
		key: string,
		fetcher: (signal: AbortSignal) => Promise<T>,
		signal?: AbortSignal
	): Promise<T> {
		const cached = this.get(key)
		if (cached !== undefined) return cached

		return getOrStartAbortable(
			this.pending,
			key,
			async (groupSignal) => {
				const value = await fetcher(groupSignal)
				this.set(key, value)
				return value
			},
			signal
		)
	}
}

export function stableSearchKey(params: Record<string, unknown>): string {
	return JSON.stringify(sortKeysDeep(params))
}

export const searchCache = new TtlCache<unknown>(60 * 60_000)
export const cardDetailCache = new TtlCache<unknown>(24 * 60 * 60_000)
