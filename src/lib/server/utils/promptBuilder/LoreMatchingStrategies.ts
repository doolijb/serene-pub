import type { InterpolationContext } from "./InterpolationEngine"
import type { ProcessedChatMessage } from "./ContentProcessors"

/**
 * Base interface for lore matching strategies
 */
export interface LoreMatchingStrategy {
	/**
	 * Check if a lore entry matches a chat message
	 */
	matchesMessage(
		entry:
			| SelectWorldLoreEntry
			| SelectCharacterLoreEntry
			| SelectHistoryEntry,
		message: { id: number; message: string | undefined },
		context?: {
			interpolationContext: InterpolationContext
			chatMessages: Array<{ id: number; message: string | undefined }>
			failedMatches: Record<number, number[]>
		}
	): Promise<boolean> | boolean

	/**
	 * Initialize the strategy (e.g., load models, prepare indices)
	 */
	initialize?(): Promise<void>

	/**
	 * Clean up resources
	 */
	cleanup?(): Promise<void>

	/**
	 * Get strategy name for debugging/logging
	 */
	getName(): string
}

/**
 * Traditional keyword-based matching strategy
 */
export class KeywordMatchingStrategy implements LoreMatchingStrategy {
	getName(): string {
		return "keyword"
	}

	matchesMessage(
		entry:
			| SelectWorldLoreEntry
			| SelectCharacterLoreEntry
			| SelectHistoryEntry,
		message: { id: number; message: string | undefined },
		context?: {
			interpolationContext: InterpolationContext
			chatMessages: Array<{ id: number; message: string | undefined }>
			failedMatches: Record<number, number[]>
		}
	): boolean {
		// Skip if this combination has already failed
		if (
			context?.failedMatches[message.id] &&
			context.failedMatches[message.id].includes(entry.id)
		) {
			return false
		}

		if (!message.message) {
			return false
		}

		let msgContent = entry.caseSensitive
			? message.message
			: message.message.toLowerCase()

		const matchFound = entry.keys.split(",").some((key) => {
			const keyToCheck = entry.caseSensitive
				? key.trim()
				: key.toLowerCase().trim()

			if (entry.useRegex) {
				try {
					const regex = new RegExp(keyToCheck, "g")
					return regex.test(msgContent)
				} catch (e) {
					// Invalid regex, fall back to string matching
					return msgContent.includes(keyToCheck)
				}
			} else {
				return msgContent.includes(keyToCheck)
			}
		})

		// Track failed matches for future optimization
		if (!matchFound && context?.failedMatches) {
			if (!context.failedMatches[message.id]) {
				context.failedMatches[message.id] = []
			}
			context.failedMatches[message.id].push(entry.id)
		}

		return matchFound
	}
}

/**
 * NOTE: A `VectorMatchingStrategy` used to live here as scaffolding for
 * semantic/embedding-based lore matching, but it was never implemented —
 * `initialize()`/`matchesMessage()` were TODO stubs that just fell back to
 * `KeywordMatchingStrategy`, and nothing in the codebase ever selected it
 * (see git history if you need the old code). Real semantic/vector lore
 * retrieval already exists under `RagInfillEngine.ts` using pgvector
 * embeddings — that's the actual implementation, not this. Don't recreate
 * a vector strategy here; extend `RagInfillEngine.ts` instead.
 */

/**
 * Configuration for matching strategies
 */
export interface MatchingStrategyConfig {
	strategy: "keyword"

	// Performance options
	performance?: {
		cacheEmbeddings?: boolean
		batchSize?: number
	}
}

/**
 * Factory for creating matching strategies
 */
export class MatchingStrategyFactory {
	static async createStrategy(
		config: MatchingStrategyConfig
	): Promise<LoreMatchingStrategy> {
		switch (config.strategy) {
			case "keyword":
				return new KeywordMatchingStrategy()

			default:
				throw new Error(`Unknown matching strategy: ${config.strategy}`)
		}
	}

	static getAvailableStrategies(): string[] {
		return ["keyword"]
	}
}
