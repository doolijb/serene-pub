import type { InterpolationContext } from './InterpolationEngine'
import type { ProcessedChatMessage } from './ContentProcessors'

/**
 * Base interface for lore matching strategies
 */
export interface LoreMatchingStrategy {
	/**
	 * Check if a lore entry matches a chat message
	 */
	matchesMessage(
		entry: SelectWorldLoreEntry | SelectCharacterLoreEntry | SelectHistoryEntry,
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
		return 'keyword'
	}
	
	matchesMessage(
		entry: SelectWorldLoreEntry | SelectCharacterLoreEntry | SelectHistoryEntry,
		message: { id: number; message: string | undefined },
		context?: {
			interpolationContext: InterpolationContext
			chatMessages: Array<{ id: number; message: string | undefined }>
			failedMatches: Record<number, number[]>
		}
	): boolean {
		// Skip if this combination has already failed
		if (context?.failedMatches[message.id] && context.failedMatches[message.id].includes(entry.id)) {
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
 * Vector similarity-based matching strategy (future implementation)
 */
export class VectorMatchingStrategy implements LoreMatchingStrategy {
	private embeddings: Map<number, number[]> = new Map()
	private isInitialized = false
	
	getName(): string {
		return 'vector'
	}
	
	async initialize(): Promise<void> {
		// TODO: Initialize embedding model
		// TODO: Pre-compute embeddings for lore entries
		this.isInitialized = true
		console.log('VectorMatchingStrategy initialized')
	}
	
	async cleanup(): Promise<void> {
		this.embeddings.clear()
		this.isInitialized = false
	}
	
	async matchesMessage(
		entry: SelectWorldLoreEntry | SelectCharacterLoreEntry | SelectHistoryEntry,
		message: { id: number; message: string | undefined },
		context?: {
			interpolationContext: InterpolationContext
			chatMessages: Array<{ id: number; message: string | undefined }>
			failedMatches: Record<number, number[]>
		}
	): Promise<boolean> {
		if (!this.isInitialized) {
			throw new Error('VectorMatchingStrategy must be initialized before use')
		}
		
		if (!message.message) {
			return false
		}
		
		// TODO: Implement vector similarity matching
		// 1. Generate embedding for message content
		// 2. Calculate similarity with lore entry embedding
		// 3. Return true if similarity exceeds threshold
		
		// Placeholder implementation - fallback to keyword matching for now
		const keywordStrategy = new KeywordMatchingStrategy()
		return keywordStrategy.matchesMessage(entry, message, context)
	}
}

/**
 * Configuration for matching strategies
 */
export interface MatchingStrategyConfig {
	strategy: 'keyword' | 'vector'
	
	// Vector strategy options
	vectorOptions?: {
		model?: string
		threshold?: number
		maxResults?: number
	}
	
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
	static async createStrategy(config: MatchingStrategyConfig): Promise<LoreMatchingStrategy> {
		switch (config.strategy) {
			case 'keyword':
				return new KeywordMatchingStrategy()
			
			case 'vector':
				const vectorStrategy = new VectorMatchingStrategy()
				await vectorStrategy.initialize()
				return vectorStrategy
			
			default:
				throw new Error(`Unknown matching strategy: ${config.strategy}`)
		}
	}
	
	static getAvailableStrategies(): string[] {
		return ['keyword', 'vector']
	}
}
