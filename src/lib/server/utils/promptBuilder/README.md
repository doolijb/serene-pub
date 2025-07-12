# Prompt Builder Modularization

This directory contains the modularized prompt builder system, breaking down the monolithic `PromptBuilder` class into focused, reusable components.

## Architecture Overview

The new modular architecture follows these principles:
- **Single Responsibility**: Each class has one clear purpose
- **Dependency Injection**: Components can be easily tested and swapped
- **Strategy Pattern**: Different implementations for different use cases
- **Clear Interfaces**: Well-defined contracts between components

## Core Modules

### 1. **TemplateEngine.ts**
Handles Handlebars template compilation and helper registration.
- Manages Handlebars instance
- Registers role-specific helpers (systemBlock, assistantBlock, userBlock)
- Provides string interpolation utilities

### 2. **TokenManager.ts**
Manages token counting and limits.
- Token counting operations
- Threshold and limit checking
- Encapsulates token-related logic

### 3. **ContentMatchers.ts**
Strategy pattern for matching content against lore entries.
- `LorebookMatcher`: Handles world/character lore matching
- `HistoryMatcher`: Handles history entry matching
- Supports regex and case-sensitive matching

### 4. **ContentProviders.ts**
Priority-based content provision system.
- `MessageProvider`: Provides chat messages by priority
- `WorldLoreProvider`: Provides world lore entries
- `CharacterLoreProvider`: Provides character lore entries  
- `HistoryProvider`: Provides history entries

### 5. **ContextBuilders.ts**
Builder pattern for constructing different context types.
- `CharacterContextBuilder`: Builds character context data
- `PersonaContextBuilder`: Builds persona context data
- `ScenarioContextBuilder`: Builds scenario context with interpolation

### 6. **ContentAssembler.ts**
Orchestrates content assembly with token limits.
- Priority-based content inclusion
- Token-aware assembly process
- Lore matching and inclusion logic

### 7. **Renderers.ts**
Strategy pattern for different output formats.
- `TextPromptRenderer`: Renders standard text prompts
- `ChatCompletionRenderer`: Renders OpenAI chat completion format
- `RendererFactory`: Creates appropriate renderer based on options

### 8. **PromptConfiguration.ts**
Encapsulates all configuration data.
- Centralizes configuration access
- Provides typed getters for configuration values
- Simplifies configuration management

### 9. **PromptCompiler.ts**
Main orchestrator that uses all modules.
- Coordinates the compilation process
- Manages dependencies between modules
- Provides clean public API

### 10. **types.ts**
Shared type definitions.
- Common interfaces and types
- Ensures type consistency across modules

## Usage

### New Modular API
```typescript
const config = new PromptConfiguration(connection, sampling, contextConfig, promptConfig, tokenLimit, threshold)
const compiler = new PromptCompiler(config, chat, currentCharacterId, tokenCounter)
const result = await compiler.compile({ useChatFormat: true })
```

### Legacy API (still supported)
```typescript
const builder = new PromptBuilder({ /* existing constructor args */ })
const result = await builder.compilePrompt({ useChatFormat: true })
```

### Modular API on existing instance
```typescript
const builder = new PromptBuilder({ /* existing constructor args */ })
const result = await builder.compilePromptModular({ useChatFormat: true })
```

## Migration Strategy

The migration follows a gradual approach:

1. ✅ **Phase 1**: Extract core modules (Template, Token, Config)
2. ✅ **Phase 2**: Create content strategies (Providers, Matchers, Builders)
3. ✅ **Phase 3**: Build orchestrator (Assembler, Renderers, Compiler)
4. 🔄 **Phase 4**: Integrate with existing class (current)
5. ⏳ **Phase 5**: Move complex assembly logic to modules
6. ⏳ **Phase 6**: Deprecate legacy methods
7. ⏳ **Phase 7**: Full migration to modular system

## Benefits

### Testability
Each component can be unit tested in isolation:
```typescript
const tokenManager = new TokenManager(mockTokenCounter, 1000, 0.8)
expect(tokenManager.isOverLimit(1200)).toBe(true)
```

### Extensibility
New content types or renderers can be added easily:
```typescript
class CustomRenderer implements PromptRenderer {
  render(context: TemplateContext, template: string) {
    // Custom rendering logic
  }
}
```

### Performance
Components can be optimized independently and cached:
```typescript
const templateEngine = new TemplateEngine()
templateEngine.registerHelpers({ useChatFormat: true }) // Cache helpers
```

### Maintainability
Bugs are isolated to specific modules, making debugging easier.

## Error Handling

Each module handles its own errors and provides meaningful error messages:
- Template compilation errors include template context
- Token counting errors specify the content that failed
- Content matching errors identify the problematic entry

## Performance Considerations

- Template engines are created once and reused
- Handlebars helpers are registered once per format type
- Content providers use iterators for memory efficiency
- Token counting is batched where possible

## Future Enhancements

1. **Caching Layer**: Add caching for compiled templates and token counts
2. **Plugin System**: Allow custom content providers and matchers
3. **Async Streaming**: Support streaming content assembly for large contexts
4. **Metrics Collection**: Built-in performance and usage metrics
5. **Configuration Validation**: Runtime validation of configuration objects
