import type { InterpolationContext } from './InterpolationEngine'
import type { ProcessedChatMessage } from './ContentProcessors'

/**
 * Configuration for content inclusion strategies
 */
export interface ContentInclusionConfig {
	/** Priority levels for different content types */
	priorities: {
		chatMessages: number[]
		worldLore: number[]
		characterLore: number[]
		history: number[]
	}
	/** 
	 * Weights for content inclusion iteration frequency (0-1+)
	 * - 1.0 = check every iteration
	 * - 0.5 = check every 2nd iteration  
	 * - 2.0 = check twice per iteration
	 * - 0.0 = never check
	 * 
	 * At the end, if there's still room, all content types are checked regardless of weight.
	 */
	weights: {
		chatMessages: number
		worldLore: number
		characterLore: number
		history: number
	}
	/** Iteration rates for different threshold states */
	iterationRates: {
		belowThreshold: number
		aboveThreshold: number
		overLimit: number
	}
	/** Whether to enable content matching for lore */
	enableMatching: {
		worldLore: boolean
		characterLore: boolean
		history: boolean
	}
}

/**
 * Default content inclusion configuration
 */
export const defaultContentInclusionConfig: ContentInclusionConfig = {
	priorities: {
		chatMessages: [4, 3, 2, 1, 0],
		worldLore: [4, 3, 2, 1],
		characterLore: [4, 3, 2, 1],
		history: [4, 2, 0]
	},
	weights: {
		chatMessages: 1.0,
		worldLore: 0.8,
		characterLore: 0.9,
		history: 0.6
	},
	iterationRates: {
		belowThreshold: 10,
		aboveThreshold: 2,
		overLimit: 1
	},
	enableMatching: {
		worldLore: true,
		characterLore: true,
		history: true
	}
}

/**
 * Result of content processing for a single iteration
 */
export interface ContentProcessingResult {
	chatMessages: ProcessedChatMessage[]
	includedWorldLore: SelectWorldLoreEntry[]
	includedCharacterLore: SelectCharacterLoreEntry[]
	includedHistory: SelectHistoryEntry[]
	shouldContinue: boolean
	iteratorsExhausted: boolean
}

/**
 * State for tracking content inclusion iterations
 */
export interface ContentInclusionState {
	priority: number
	iterationCount: number
	completed: boolean
	isBelowThreshold: boolean
	isAboveThreshold: boolean
	isOverLimit: boolean
	totalTokens: number
	
	// Iterator states
	messagesIterator: IterableIterator<SelectChatMessage> | null | undefined
	worldLoreIterator: IterableIterator<SelectWorldLoreEntry> | null | undefined
	characterLoreIterator: IterableIterator<SelectCharacterLoreEntry> | null | undefined
	historyIterator: IterableIterator<SelectHistoryEntry> | null | undefined
	
	// Weight-based iteration tracking
	weightCounters: {
		chatMessages: number
		worldLore: number
		characterLore: number
		history: number
	}
	
	// Tracking arrays
	consideredWorldLore: SelectWorldLoreEntry[]
	consideredCharacterLore: SelectCharacterLoreEntry[]
	consideredHistory: SelectHistoryEntry[]
	
	// Failed match tracking
	messageFailedWorldLoreMatches: Record<number, number[]>
	messageFailedCharacterLoreMatches: Record<number, number[]>
	messageFailedHistoryMatches: Record<number, number[]>
	
	// Included content
	chatMessages: ProcessedChatMessage[]
	includedWorldLore: SelectWorldLoreEntry[]
	includedCharacterLore: SelectCharacterLoreEntry[]
	includedHistory: SelectHistoryEntry[]
}

/**
 * Interface for content inclusion strategies
 */
export interface ContentInclusionStrategy {
	/**
	 * Initialize the inclusion state
	 */
	initializeState(config: ContentInclusionConfig): ContentInclusionState
	
	/**
	 * Process a single iteration of content inclusion
	 */
	processIteration(
		state: ContentInclusionState, 
		config: ContentInclusionConfig,
		context: {
			interpolationContext: InterpolationContext
			charName: string
			personaName: string
		}
	): Promise<ContentProcessingResult>
	
	/**
	 * Check if iterators should be reset for the current priority level
	 */
	shouldResetIterators(state: ContentInclusionState, config: ContentInclusionConfig): boolean
	
	/**
	 * Determine the next priority level
	 */
	getNextPriority(state: ContentInclusionState, config: ContentInclusionConfig): number
	
	/**
	 * Check if content should be processed at current threshold state
	 */
	shouldProcessContent(
		contentType: 'worldLore' | 'characterLore' | 'history',
		state: ContentInclusionState,
		config: ContentInclusionConfig
	): boolean
}

/**
 * Default implementation of content inclusion strategy
 */
export class DefaultContentInclusionStrategy implements ContentInclusionStrategy {
	initializeState(config: ContentInclusionConfig): ContentInclusionState {
		// Normalize weights so the highest weight is 1.0 while maintaining relative proportions
		const normalizedWeights = this.normalizeWeights(config.weights)
		
		return {
			priority: 4,
			iterationCount: 0,
			completed: false,
			isBelowThreshold: true,
			isAboveThreshold: false,
			isOverLimit: false,
			totalTokens: 0,
			
			messagesIterator: undefined,
			worldLoreIterator: undefined,
			characterLoreIterator: undefined,
			historyIterator: undefined,
			
			// Initialize weight counters with normalized weights
			weightCounters: {
				chatMessages: 0,
				worldLore: 0,
				characterLore: 0,
				history: 0
			},
			
			consideredWorldLore: [],
			consideredCharacterLore: [],
			consideredHistory: [],
			
			messageFailedWorldLoreMatches: {},
			messageFailedCharacterLoreMatches: {},
			messageFailedHistoryMatches: {},
			
			chatMessages: [{
				id: -2, // Placeholder for current character's empty message
				role: "assistant",
				name: "", // Will be set by caller
				message: ""
			}],
			includedWorldLore: [],
			includedCharacterLore: [],
			includedHistory: []
		}
	}
	
	/**
	 * Normalize weights so the highest weight is 1.0 while maintaining relative proportions
	 */
	protected normalizeWeights(weights: ContentInclusionConfig['weights']): ContentInclusionConfig['weights'] {
		const weightValues = [
			weights.chatMessages,
			weights.worldLore,
			weights.characterLore,
			weights.history
		]
		
		// Find the maximum weight
		const maxWeight = Math.max(...weightValues)
		
		// If max weight is 0, return original weights to avoid division by zero
		if (maxWeight === 0) {
			return weights
		}
		
		// Calculate normalization factor
		const normalizationFactor = 1.0 / maxWeight
		
		// Return normalized weights
		return {
			chatMessages: weights.chatMessages * normalizationFactor,
			worldLore: weights.worldLore * normalizationFactor,
			characterLore: weights.characterLore * normalizationFactor,
			history: weights.history * normalizationFactor
		}
	}
	
	async processIteration(
		state: ContentInclusionState,
		config: ContentInclusionConfig,
		context: {
			interpolationContext: InterpolationContext
			charName: string
			personaName: string
		}
	): Promise<ContentProcessingResult> {
		// This will be implemented by the caller who has access to iterators and matching logic
		throw new Error('processIteration should be implemented by PromptBuilder')
	}
	
	shouldResetIterators(state: ContentInclusionState, config: ContentInclusionConfig): boolean {
		const { priority } = state
		const { priorities } = config
		
		// Check if current priority level supports any content types
		const hasMessagesAtPriority = priorities.chatMessages.includes(priority)
		const hasWorldLoreAtPriority = priorities.worldLore.includes(priority)
		const hasCharacterLoreAtPriority = priorities.characterLore.includes(priority)
		const hasHistoryAtPriority = priorities.history.includes(priority)
		
		// Reset if we have content types for this priority but iterators are null
		return (hasMessagesAtPriority || hasWorldLoreAtPriority || hasCharacterLoreAtPriority || hasHistoryAtPriority) &&
			   (state.messagesIterator === null && state.worldLoreIterator === null && 
			    state.characterLoreIterator === null && state.historyIterator === null)
	}
	
	getNextPriority(state: ContentInclusionState, config: ContentInclusionConfig): number {
		const currentPriority = state.priority
		
		// Find the next lower priority that has content types configured
		for (let p = currentPriority - 1; p >= 0; p--) {
			const hasContent = config.priorities.chatMessages.includes(p) ||
			                  config.priorities.worldLore.includes(p) ||
			                  config.priorities.characterLore.includes(p) ||
			                  config.priorities.history.includes(p)
			if (hasContent) {
				return p
			}
		}
		
		return -1 // No more priorities
	}
	
	/**
	 * Check if content should be processed at current threshold state
	 * Weights control iteration frequency: 1.0 = every iteration, 0.5 = every 2nd iteration, etc.
	 */
	shouldProcessContent(
		contentType: 'worldLore' | 'characterLore' | 'history',
		state: ContentInclusionState,
		config: ContentInclusionConfig
	): boolean {
		// Check if content type is enabled for matching
		if (!config.enableMatching[contentType]) {
			return false
		}
		
		// Get normalized weight for this content type
		const normalizedWeights = this.normalizeWeights(config.weights)
		const weight = normalizedWeights[contentType]
		
		// If we're filling remaining space at the end, ignore weights and process everything
		if (!state.isBelowThreshold && this.isInFinalFillMode(state)) {
			return true
		}
		
		// Only process lore content when below threshold (unless in final fill mode)
		if (!state.isBelowThreshold) {
			return false
		}
		
		// Increment the counter for this content type
		state.weightCounters[contentType] += weight
		
		// Check if counter has reached 1.0 (time to process)
		if (state.weightCounters[contentType] >= 1.0) {
			state.weightCounters[contentType] -= 1.0 // Reset counter, keeping remainder
			return true
		}
		
		return false
	}
	
	/**
	 * Check if we're in final fill mode (iterators exhausted but still have token space)
	 */
	protected isInFinalFillMode(state: ContentInclusionState): boolean {
		// This would be implemented to detect when we should ignore weights
		// and try to fill remaining space
		return false // Placeholder - should be implemented based on iterator states
	}
}

/**
 * Weighted content inclusion strategy that uses adaptive iteration frequencies
 */
export class WeightedContentInclusionStrategy extends DefaultContentInclusionStrategy {
	shouldProcessContent(
		contentType: 'worldLore' | 'characterLore' | 'history',
		state: ContentInclusionState,
		config: ContentInclusionConfig
	): boolean {
		// Check basic conditions first
		if (!config.enableMatching[contentType]) {
			return false
		}
		
		// Get normalized weight for this content type
		const normalizedWeights = this.normalizeWeights(config.weights)
		const baseWeight = normalizedWeights[contentType]
		
		// If we're filling remaining space at the end, ignore weights and process everything
		if (!state.isBelowThreshold && this.isInFinalFillMode(state)) {
			return true
		}
		
		// Only process lore content when below threshold (unless in final fill mode)
		if (!state.isBelowThreshold) {
			return false
		}
		
		// Adaptive weight based on token usage - process more aggressively when below threshold
		const tokenUsageRatio = state.totalTokens > 0 ? state.totalTokens / (state.totalTokens + 1000) : 0
		const adaptiveWeight = state.isBelowThreshold 
			? baseWeight 
			: baseWeight * (1 - tokenUsageRatio * 0.5) // Reduce frequency as tokens increase
		
		// Increment the counter for this content type with adaptive weight
		state.weightCounters[contentType] += adaptiveWeight
		
		// Check if counter has reached 1.0 (time to process)
		if (state.weightCounters[contentType] >= 1.0) {
			state.weightCounters[contentType] -= 1.0 // Reset counter, keeping remainder
			return true
		}
		
		return false
	}
}

/**
 * Priority-first content inclusion strategy
 */
export class PriorityFirstContentInclusionStrategy extends DefaultContentInclusionStrategy {
	getNextPriority(state: ContentInclusionState, config: ContentInclusionConfig): number {
		// Always process highest priority content first, regardless of weights
		return super.getNextPriority(state, config)
	}
	
	shouldProcessContent(
		contentType: 'worldLore' | 'characterLore' | 'history',
		state: ContentInclusionState,
		config: ContentInclusionConfig
	): boolean {
		// Check basic conditions first
		if (!config.enableMatching[contentType]) {
			return false
		}
		
		// If we're filling remaining space at the end, ignore weights and process everything
		if (!state.isBelowThreshold && this.isInFinalFillMode(state)) {
			return true
		}
		
		// Only process lore content when below threshold (unless in final fill mode)
		if (!state.isBelowThreshold) {
			return false
		}
		
		// Always include content if we're at high priority levels (ignore weights)
		if (state.priority >= 3) {
			return true
		}
		
		// For lower priorities, use weight-based iteration frequency
		const normalizedWeights = this.normalizeWeights(config.weights)
		const weight = normalizedWeights[contentType]
		
		// Increment the counter for this content type
		state.weightCounters[contentType] += weight
		
		// Check if counter has reached 1.0 (time to process)
		if (state.weightCounters[contentType] >= 1.0) {
			state.weightCounters[contentType] -= 1.0 // Reset counter, keeping remainder
			return true
		}
		
		return false
	}
}
