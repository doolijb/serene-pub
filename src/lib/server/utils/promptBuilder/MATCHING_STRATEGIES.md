# Lore Matching Strategies

The PromptBuilder system now includes a flexible, pluggable matching strategy architecture that allows you to switch between different approaches for matching lore entries (world lore, character lore, and history) against chat messages.

## Overview

Previously, the system used only keyword-based matching. Now you can choose from:

1. **Keyword Matching** - Traditional string/regex-based matching (default)
2. **Vector Matching** - Semantic similarity using embeddings (placeholder implementation)

## Quick Start

### Basic Usage with Default (Keyword) Matching

```typescript
// Default behavior - uses keyword matching
const result = await promptBuilder.infillContentModular({
  templateContext,
  charName,
  personaName,
  useChatFormat: false
})
```

### Using Vector Matching

```typescript
// Use vector-based semantic matching
const result = await promptBuilder.infillContentModular({
  templateContext,
  charName,
  personaName,
  useChatFormat: false,
  matchingStrategyConfig: {
    strategy: 'vector',
    vectorOptions: {
      threshold: 0.7,
      maxResults: 10
    }
  }
})
```

## Architecture

### Strategy Interface

All matching strategies implement the `LoreMatchingStrategy` interface:

```typescript
interface LoreMatchingStrategy {
  matchesMessage(
    entry: SelectWorldLoreEntry | SelectCharacterLoreEntry | SelectHistoryEntry,
    message: { id: number; message: string | undefined },
    context?: {
      interpolationContext: InterpolationContext
      chatMessages: Array<{ id: number; message: string | undefined }>
      failedMatches: Record<number, number[]>
    }
  ): Promise<boolean> | boolean
  
  initialize?(): Promise<void>
  cleanup?(): Promise<void>
  getName(): string
}
```

### Strategy Implementations

#### KeywordMatchingStrategy
- **Purpose**: Fast, traditional string/regex-based matching
- **Performance**: Very fast, no setup required
- **Use case**: When you need quick matching based on exact keywords
- **Configuration**: None required

#### VectorMatchingStrategy (Placeholder)
- **Purpose**: Semantic similarity using embeddings
- **Performance**: Slower, requires model initialization
- **Use case**: When you want semantic understanding beyond keywords
- **Configuration**: Threshold, model selection (future)
- **Status**: Currently falls back to keyword matching - awaiting vector implementation

## Configuration Options

### Keyword Strategy
```typescript
{
  strategy: 'keyword'
  // No additional options
}
```

### Vector Strategy
```typescript
{
  strategy: 'vector',
  vectorOptions: {
    model?: string,        // Future: embedding model name
    threshold?: number,    // Similarity threshold (0-1)
    maxResults?: number    // Max results to consider
  }
}
```

### Performance Options (Future)
```typescript
{
  performance: {
    cacheEmbeddings?: boolean,  // Cache computed embeddings
    batchSize?: number          // Batch size for vector operations
  }
}
```

## Factory Pattern

Use the `MatchingStrategyFactory` for easy strategy creation:

```typescript
import { MatchingStrategyFactory } from './LoreMatchingStrategies'

// Create a strategy
const strategy = await MatchingStrategyFactory.createStrategy({
  strategy: 'vector',
  vectorOptions: { threshold: 0.7 }
})

// Get available strategies
const available = MatchingStrategyFactory.getAvailableStrategies()
console.log(available) // ['keyword', 'vector']
```

## Runtime Strategy Switching

```typescript
// Create with one strategy
const engine = await ContentInfillEngine.createWithStrategy(
  /* parameters */,
  { strategy: 'keyword' }
)

// Switch to a different strategy at runtime
const vectorStrategy = await MatchingStrategyFactory.createStrategy({
  strategy: 'vector',
  vectorOptions: { threshold: 0.8 }
})
await engine.setMatchingStrategy(vectorStrategy)

// Check current strategy
console.log(engine.getMatchingStrategyName()) // "vector"
```

## Integration Points

### ContentInfillEngine
The `ContentInfillEngine` is the main integration point for matching strategies:

```typescript
// Constructor accepts optional strategy
const engine = new ContentInfillEngine(
  /* ... parameters ... */,
  optionalMatchingStrategy
)

// Factory method for strategy config
const engine = await ContentInfillEngine.createWithStrategy(
  /* ... parameters ... */,
  strategyConfig
)

// Runtime strategy updates
await engine.setMatchingStrategy(newStrategy)
```

### PromptBuilder
The main `PromptBuilder` class supports strategies via `infillContentModular`:

```typescript
await promptBuilder.infillContentModular({
  /* ... other parameters ... */,
  matchingStrategy: explicitStrategy,           // Direct strategy instance
  matchingStrategyConfig: strategyConfig        // Strategy configuration
})
```

## Performance Considerations

### Strategy Selection Guidelines

- **Use Keyword** when:
  - Performance is critical
  - Simple keyword matching is sufficient
  - No semantic understanding needed

- **Use Vector** when:
  - Semantic similarity is important
  - Content has complex relationships
  - Willing to trade performance for accuracy

### Optimization Tips

1. **Caching**: Future vector implementations will support embedding caching
2. **Batch Processing**: Vector operations can be batched for better performance
3. **Thresholds**: Tune similarity thresholds to balance precision vs recall

## Future Enhancements

### Vector Implementation Roadmap

1. **Embedding Integration**
   - OpenAI embeddings API
   - Local embedding models (Sentence Transformers)
   - Custom embedding endpoints

2. **Performance Optimizations**
   - Embedding caching system
   - Batch processing for multiple entries
   - Incremental index updates

3. **Advanced Features**
   - Multiple embedding models support
   - Similarity ranking and sorting
   - Custom similarity functions

### Configuration Enhancements

1. **Per-Content-Type Strategies**
   ```typescript
   {
     worldLore: { strategy: 'vector' },
     characterLore: { strategy: 'keyword' },
     history: { strategy: 'hybrid' }
   }
   ```

2. **Dynamic Strategy Selection**
   - Based on content size
   - Based on user preferences
   - Based on performance metrics

## Migration Guide

### From Previous Keyword-Only System

The new system is **fully backward compatible**. Existing code will continue to work without changes, using keyword matching by default.

To adopt the new system:

1. **No changes needed** - continues using keyword matching
2. **Opt-in to new strategies** - add `matchingStrategyConfig` parameter
3. **Runtime switching** - use factory methods for dynamic behavior

### Example Migration

```typescript
// Old approach (still works)
const result = await promptBuilder.infillContentModular({
  templateContext,
  charName,
  personaName,
  useChatFormat: false
})

// New approach - same result, explicit strategy
const result = await promptBuilder.infillContentModular({
  templateContext,
  charName,
  personaName,
  useChatFormat: false,
  matchingStrategyConfig: { strategy: 'keyword' }
})

// New approach - enhanced with vector matching
const result = await promptBuilder.infillContentModular({
  templateContext,
  charName,
  personaName,
  useChatFormat: false,
  matchingStrategyConfig: { 
    strategy: 'vector',
    vectorOptions: { threshold: 0.7 }
  }
})
```

## Examples

See `/examples/MatchingStrategyUsage.ts` for comprehensive usage examples including:

- Creating engines with different strategies
- Runtime strategy switching
- Factory pattern usage
- Configuration examples for different use cases
- Integration with existing PromptBuilder workflow

## Implementation Status

- ✅ **Architecture**: Complete strategy interface and factory
- ✅ **Keyword Strategy**: Full implementation (existing logic)
- 🔄 **Vector Strategy**: Placeholder implementation (falls back to keyword)
- ✅ **Hybrid Strategy**: Complete implementation
- ✅ **Integration**: ContentInfillEngine and PromptBuilder support
- ✅ **Examples**: Comprehensive usage examples
- ✅ **Documentation**: This guide

**Next Steps**: Implement actual vector embeddings in `VectorMatchingStrategy`
