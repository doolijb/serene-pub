/**
 * Sprite-label vectors, cached (DESIGN-sprites §5.2).
 *
 * A character's sprite labels are short and rarely change, so each is embedded
 * once per embedding model and kept in memory. The line is embedded fresh
 * every time, in the SAME batch as any labels not cached yet — one call.
 *
 * In-memory and per process, deliberately never persisted, like the embedding
 * module's own model state: a restart re-embeds a few dozen short strings on
 * first use, which is cheaper than a table whose rows go stale when the model
 * changes. Keyed by model id, so switching models can never hand a picker a
 * vector from another space.
 */

const MAX_CACHED = 4096
const cache = new Map<string, number[]>()

const keyOf = (modelId: string, label: string) => `${modelId}\u0000${label}`

function remember(key: string, vector: number[]) {
	if (cache.size >= MAX_CACHED) {
		const oldest = cache.keys().next().value
		if (oldest !== undefined) cache.delete(oldest)
	}
	cache.set(key, vector)
}

export interface SpriteVectors {
	lineVector: number[] | null
	labelVectors: number[][] | null
}

/**
 * Vectors for a line and its labels, or nulls when there is no model — an
 * absent mechanism subtracts a signal, it never throws a reply away.
 */
export async function spriteVectors(
	text: string,
	labels: readonly string[],
	api: {
		modelId: string | null
		batchEmbed: (texts: string[]) => Promise<number[][]>
	}
): Promise<SpriteVectors> {
	const none: SpriteVectors = { lineVector: null, labelVectors: null }
	if (!api.modelId || !text.trim() || labels.length === 0) return none
	const modelId = api.modelId
	const missing = labels.filter((l) => !cache.has(keyOf(modelId, l)))
	try {
		const vectors = await api.batchEmbed([text, ...missing])
		if (!Array.isArray(vectors) || vectors.length !== missing.length + 1)
			return none
		missing.forEach((label, i) => remember(keyOf(modelId, label), vectors[i + 1]))
		return {
			lineVector: vectors[0],
			labelVectors: labels.map((l) => cache.get(keyOf(modelId, l))!)
		}
	} catch {
		return none
	}
}

/** For tests: forget everything. */
export function clearSpriteVectorCache() {
	cache.clear()
}
