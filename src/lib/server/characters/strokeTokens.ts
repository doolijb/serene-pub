/**
 * Token counts for a card's strokes, as the card form shows them
 * (DESIGN-card-strokes §A.5).
 *
 * Counted against the instance's default text connection (the `text->text`
 * capability default, `connection_defaults`) — its chosen tokenizer, with the
 * model server's own counts over it where that server publishes a tokenizer
 * and has already counted the same text. Never ENQUEUES a backend count: the
 * form asks on every debounced edit and a card holds up to
 * `STROKE_LIMITS.maxStrokes` strokes, which would otherwise be that many
 * requests to the model's server per keystroke pause (the composer preview's
 * rule, `backendCounter`'s `enqueue: false`).
 *
 * **Stored nowhere.** A token count is a property of a tokenizer, not of a
 * card.
 *
 * ⚠ `model` names a connection's model only to an administrator — to anyone
 * else connections do not exist (`connections/visibility.ts`), so they are
 * told the tokenizer's name instead. `null` means the rough estimate counted.
 */

import { eq } from "drizzle-orm"
import { compileStrokes, type Stroke } from "@serene-pub/sdk"
import { loadTokenizer, ROUGH_TOKENIZER_ID } from "@serene-pub/sdk/tokenizers"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
import { capabilityDefault } from "$lib/server/connections/capabilityDefaults"
import { TEXT_CAPABILITY } from "$lib/server/connections/capabilityTarget"
import {
	backendCounter,
	backendTokenCountsFor,
	tokenCountEndpointFor
} from "$lib/server/connections/backendTokenCount"
import { connectionsVisibleTo } from "$lib/server/connections/visibility"
import { strokeCompiledText } from "./strokes"

export interface StrokeTokenCounts {
	perStroke: number[]
	perKind: { description: number; personality: number }
	model: string | null
}

interface Counter {
	count: (text: string) => number
	model: string | null
}

const tokenizerLabel = (id: string): string =>
	TokenCounterOptions.options.find((o) => o.value === id)?.label ?? id

/** The default text connection's counter, or the rough estimate. */
async function defaultTextCounter(
	db: any,
	viewer: { isAdmin?: boolean | null }
): Promise<Counter> {
	const rough = await loadTokenizer(undefined)
	const estimate: Counter = { count: (t) => rough.count(t), model: null }
	try {
		const registered = await capabilityDefault(db, TEXT_CAPABILITY)
		const connectionId = registered?.connectionId
		if (connectionId == null) return estimate
		const [row] = await db
			.select({
				type: schema.connections.type,
				baseUrl: schema.connections.baseUrl,
				tokenCounter: schema.connections.tokenCounter,
				name: schema.connections.name
			})
			.from(schema.connections)
			.where(eq(schema.connections.id, connectionId))
			.limit(1)
		if (!row) return estimate

		const loaded = await loadTokenizer(row.tokenCounter)
		// A managed KoboldCPP answers at the manager's address; the row's own
		// is a fallback (`KoboldCppManagedAdapter`'s rule, as the run's counter
		// reads it).
		let baseUrl: string | null = row.baseUrl ?? null
		if (row.type === CONNECTION_TYPE.KOBOLDCPP_MANAGED) {
			const [settings] = await db
				.select({ url: schema.koboldCppSettings.koboldCppManagerBaseUrl })
				.from(schema.koboldCppSettings)
				.limit(1)
			baseUrl = settings?.url || baseUrl || "http://localhost:5001"
		}
		const endpoint = tokenCountEndpointFor(row.type, baseUrl)
		const count = endpoint
			? (() => {
					const c = backendCounter(
						backendTokenCountsFor(endpoint),
						loaded.count,
						{ enqueue: false }
					)
					return (t: string) => c(t)
				})()
			: (t: string) => loaded.count(t)

		// The rough estimate names nothing: the backend's counts are only
		// READ here, so with no tokenizer chosen nearly every number is still
		// the estimate.
		if (loaded.id === ROUGH_TOKENIZER_ID) return { count, model: null }

		let model: string
		if (connectionsVisibleTo(viewer)) {
			let modelName: string | null = null
			if (registered?.connectionModelId != null) {
				const [m] = await db
					.select({
						name: schema.connectionModels.name,
						model: schema.connectionModels.model
					})
					.from(schema.connectionModels)
					.where(eq(schema.connectionModels.id, registered.connectionModelId))
					.limit(1)
				modelName = m?.name || m?.model || null
			}
			model = modelName ?? row.name
		} else model = tokenizerLabel(loaded.id)
		return { count, model }
	} catch {
		return estimate
	}
}

export async function countStrokeTokens(
	db: any,
	viewer: { isAdmin?: boolean | null },
	strokes: readonly Stroke[]
): Promise<StrokeTokenCounts> {
	const counter = await defaultTextCounter(db, viewer)
	const measure = (text: string | null) => (text ? counter.count(text) : 0)
	return {
		perStroke: strokes.map((s) => measure(strokeCompiledText(s))),
		perKind: {
			description: measure(compileStrokes(strokes, "description")),
			personality: measure(compileStrokes(strokes, "personality"))
		},
		model: counter.model
	}
}
