# Quick Reference: Switching Matching Strategies

## TL;DR

You can now easily switch between keyword matching and vector matching (when implemented) for lore entries. Here's how:

## Default Behavior (No Changes Needed)
```typescript
// This continues to work as before - uses keyword matching
const result = await promptBuilder.infillContentModular({
  templateContext,
  charName,
  personaName,
  useChatFormat: false
})
```

## Switch to Vector Matching
```typescript
// Use semantic vector matching instead of keywords
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

## Available Strategies

1. **`'keyword'`** - Fast, traditional string matching (default)
2. **`'vector'`** - Semantic similarity via embeddings (placeholder - falls back to keyword for now)

## Key Benefits

✅ **Backward Compatible** - Existing code works unchanged  
✅ **Easy Switching** - One parameter change to switch strategies  
✅ **Future Ready** - Vector implementation can be added without code changes  
✅ **Configurable** - Tune thresholds and weights per use case  
✅ **Runtime Flexible** - Can change strategies while running  

## What's Ready Now

- ✅ Full architecture and interfaces
- ✅ Keyword strategy (existing logic) 
- ✅ Strategy factory and configuration
- ✅ Integration with PromptBuilder
- 🔄 Vector strategy (placeholder - needs embedding implementation)

## Next Step: Vector Implementation

When vector matching is implemented, it will provide semantic understanding beyond simple keyword matching, allowing for more intelligent lore selection based on meaning rather than exact words.
