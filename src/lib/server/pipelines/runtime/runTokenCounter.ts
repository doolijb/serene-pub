/**
 * The counter a run budgets with, when the model's server can count (B2,
 * 2026-10-03) — `connections/backendTokenCount.ts` over the run's estimate.
 *
 * Resolved for the connection the BUDGET is sized for (`budgetConnectionOf`,
 * the same resolution `tokenizerFor` reads its tokenizer off), so the counts
 * and the window describe one model. `undefined` when that connection's
 * server publishes no tokenizer — the run then passes its tokenizer id to the
 * SDK exactly as before, and nothing about its counting changes.
 *
 * ⚠ The estimate underneath is the connection's chosen tokenizer, loaded here
 * because a counter handed to the SDK as a function bypasses its own loading
 * (`RunOptions.countTokens` wins over `tokenizer`). A degraded load comes back
 * as `degraded`, for the caller to put on the receipt the way the SDK would.
 */

import { eq } from "drizzle-orm"
import type { ConfigWorld, SpecDocument } from "@serene-pub/sdk"
import { loadTokenizer } from "@serene-pub/sdk/tokenizers"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import {
	backendCounter,
	backendTokenCountsFor,
	tokenCountEndpointFor
} from "$lib/server/connections/backendTokenCount"
import { budgetConnectionOf } from "$lib/server/pipelines/runtime/tokenizers"

export interface RunTokenCounter {
	count: (v: unknown) => number
	degraded?: string
}

export async function runTokenCounterFor(
	db: any,
	world: ConfigWorld,
	doc: SpecDocument,
	opts: { tokenizer: string | undefined; preview: boolean }
): Promise<RunTokenCounter | undefined> {
	try {
		const descriptor = budgetConnectionOf(world, doc)
		const id = Number(descriptor?.id)
		if (!Number.isInteger(id)) return undefined
		const [row] = await db
			.select({
				type: schema.connections.type,
				baseUrl: schema.connections.baseUrl
			})
			.from(schema.connections)
			.where(eq(schema.connections.id, id))
			.limit(1)
		if (!row) return undefined
		// A managed KoboldCPP answers at the manager's address; the row's own
		// is a fallback (`KoboldCppManagedAdapter`'s rule).
		let baseUrl: string | null = row.baseUrl ?? null
		if (row.type === CONNECTION_TYPE.KOBOLDCPP_MANAGED) {
			const [settings] = await db
				.select({ url: schema.koboldCppSettings.koboldCppManagerBaseUrl })
				.from(schema.koboldCppSettings)
				.limit(1)
			baseUrl = settings?.url || baseUrl || "http://localhost:5001"
		}
		const endpoint = tokenCountEndpointFor(row.type, baseUrl)
		if (!endpoint) return undefined
		const loaded = await loadTokenizer(opts.tokenizer)
		return {
			count: backendCounter(backendTokenCountsFor(endpoint), loaded.count, {
				enqueue: !opts.preview
			}),
			...(loaded.degraded ? { degraded: loaded.degraded } : {})
		}
	} catch {
		return undefined
	}
}
