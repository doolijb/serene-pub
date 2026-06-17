# Assistant Entity Creation/Editing Framework Plan

## Overview

A framework to allow the Serene Pub AI assistant to create and edit entities (characters, personas, lorebooks, etc.) with automatic validation, error correction, and user confirmation.

## Core Principles

1. **Zod Validation**: All entity schemas use Zod for validation
2. **Auto-generated Types**: Drizzle's `createInsertSchema` and `createSelectSchema` generate Zod schemas from database schema
3. **Self-Correction Loop**: When validation fails, errors are fed back to the LLM for correction
4. **User Confirmation**: All create/edit actions require user approval before execution
5. **Type Safety**: Full TypeScript typing from DB → Zod → LLM prompts

---

## Architecture

### 1. Schema Layer (`/lib/server/db/schema.ts`)

Already exists - Drizzle schema definitions for all entities.

### 2. Validation Layer (`/lib/server/db/zodSchemas.ts`) **[NEW]**

Generate and export Zod schemas from Drizzle schemas using `drizzle-zod`.

```typescript
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import * as schema from './schema'
import { z } from 'zod'

// Base schemas from Drizzle
export const insertCharacterSchema = createInsertSchema(schema.characters)
export const selectCharacterSchema = createSelectSchema(schema.characters)

// Refined schemas for assistant use (with custom validation)
export const assistantCreateCharacterSchema = insertCharacterSchema
  .omit({ 
    id: true,
    userId: true,  // Will be set by system
    createdAt: true,
    updatedAt: true,
    isDeleted: true 
  })
  .extend({
    // Add custom validation rules
    name: z.string().min(1, "Name is required").max(100, "Name too long"),
    description: z.string().min(10, "Description must be at least 10 characters"),
    personality: z.string().optional(),
    scenario: z.string().optional(),
    tags: z.array(z.string()).optional(), // Tags handled separately in DB
    // ... other refinements
  })

export const assistantUpdateCharacterSchema = assistantCreateCharacterSchema
  .partial() // All fields optional for updates
  .extend({
    id: z.number().int().positive() // ID required for updates
  })

// Generate JSON Schema for LLM consumption
export const characterSchemaForLLM = {
  create: zodToJsonSchema(assistantCreateCharacterSchema),
  update: zodToJsonSchema(assistantUpdateCharacterSchema)
}

// Similarly for other entities
export const assistantCreatePersonaSchema = createInsertSchema(schema.personas)
  .omit({ id: true, userId: true, createdAt: true, updatedAt: true })
  .extend({
    name: z.string().min(1, "Name is required"),
    description: z.string().min(10, "Description required"),
    // ...
  })

// Export all schemas
export const assistantSchemas = {
  character: {
    create: assistantCreateCharacterSchema,
    update: assistantUpdateCharacterSchema,
    select: selectCharacterSchema
  },
  persona: {
    create: assistantCreatePersonaSchema,
    update: assistantUpdatePersonaSchema,
    select: selectPersonaSchema
  },
  // ... more entities
}
```

### 3. Function Definitions (`/lib/shared/assistantFunctions/definitions/entityFunctions.ts`) **[NEW]**

```typescript
import type { AssistantFunction } from '../types'
import { characterSchemaForLLM } from '$lib/server/db/zodSchemas'

export const entityFunctions: Record<string, AssistantFunction> = {
  
  createCharacter: {
    name: 'createCharacter',
    description: 'Create a new character. Returns a preview of the character for user confirmation.',
    requiresConfirmation: true, // User must approve before execution
    requiresAdmin: false,
    parameters: characterSchemaForLLM.create, // Direct from Zod → JSON Schema
    handler: undefined // Attached on server side
  },
  
  updateCharacter: {
    name: 'updateCharacter',
    description: 'Update an existing character. Returns a preview showing changes.',
    requiresConfirmation: true,
    requiresAdmin: false,
    parameters: characterSchemaForLLM.update,
    handler: undefined
  },
  
  createPersona: {
    name: 'createPersona',
    description: 'Create a new persona (user identity).',
    requiresConfirmation: true,
    requiresAdmin: false,
    parameters: personaSchemaForLLM.create,
    handler: undefined
  },
  
  // ... more entity CRUD functions
}
```

### 4. Server-side Handlers (`/lib/server/assistantFunctions/handlers/entityHandlers.ts`) **[NEW]**

```typescript
import type { AssistantFunctionHandler } from '$lib/shared/assistantFunctions/types'
import { assistantSchemas } from '$lib/server/db/zodSchemas'
import { db } from '$lib/server/db'
import * as schema from '$lib/server/db/schema'
import { ZodError } from 'zod'

/**
 * Handler for creating characters
 * Returns validation result - either success preview or errors
 */
export const createCharacterHandler: AssistantFunctionHandler = async ({
  userId,
  args
}) => {
  try {
    // Step 1: Validate with Zod
    const validatedData = assistantSchemas.character.create.parse(args)
    
    // Step 2: Extract tags (handled separately in DB)
    const tags = validatedData.tags || []
    const characterData = { ...validatedData, tags: undefined, userId }
    
    // Step 3: Return preview for confirmation (don't create yet)
    return {
      success: true,
      preview: characterData,
      message: 'Character ready for creation. Please confirm.',
      requiresConfirmation: true,
      tags // Include tags in response
    }
    
  } catch (error) {
    if (error instanceof ZodError) {
      // Step 4: Return validation errors to LLM for self-correction
      return {
        success: false,
        validationErrors: error.errors.map(err => ({
          field: err.path.join('.'),
          message: err.message,
          received: err.input
        })),
        message: 'Validation failed. Please correct the following errors and try again.'
      }
    }
    
    throw error
  }
}

/**
 * Handler for updating characters
 */
export const updateCharacterHandler: AssistantFunctionHandler = async ({
  userId,
  args
}) => {
  try {
    // Validate update data
    const validatedData = assistantSchemas.character.update.parse(args)
    
    // Fetch existing character
    const existing = await db.query.characters.findFirst({
      where: (c, { eq, and }) => and(
        eq(c.id, validatedData.id),
        eq(c.userId, userId),
        eq(c.isDeleted, false)
      )
    })
    
    if (!existing) {
      return {
        success: false,
        message: 'Character not found or access denied.'
      }
    }
    
    // Show preview of changes
    const changes = Object.keys(validatedData).reduce((acc, key) => {
      if (key !== 'id' && validatedData[key] !== existing[key]) {
        acc[key] = {
          old: existing[key],
          new: validatedData[key]
        }
      }
      return acc
    }, {} as Record<string, any>)
    
    return {
      success: true,
      preview: changes,
      characterId: existing.id,
      characterName: existing.name,
      message: 'Character update ready. Please confirm changes.',
      requiresConfirmation: true
    }
    
  } catch (error) {
    if (error instanceof ZodError) {
      return {
        success: false,
        validationErrors: error.errors.map(err => ({
          field: err.path.join('.'),
          message: err.message
        }))
      }
    }
    throw error
  }
}

/**
 * Actually execute the creation (called after user confirms)
 */
export const executeCreateCharacter = async (
  userId: number,
  characterData: any,
  tags: string[]
) => {
  // Create character in transaction
  return await db.transaction(async (tx) => {
    const [character] = await tx
      .insert(schema.characters)
      .values({ ...characterData, userId })
      .returning()
    
    // Handle tags
    if (tags.length > 0) {
      // ... tag creation logic
    }
    
    return character
  })
}
```

### 5. Validation Error Handling (`/lib/server/utils/assistantValidation.ts`) **[NEW]**

```typescript
import { ZodError } from 'zod'

/**
 * Format Zod errors for LLM consumption
 */
export function formatValidationErrorsForLLM(error: ZodError): string {
  const errors = error.errors.map(err => {
    const field = err.path.join('.')
    return `- **${field}**: ${err.message}${err.received ? ` (received: ${JSON.stringify(err.received)})` : ''}`
  }).join('\n')
  
  return `# Validation Errors

Please correct the following errors and try again:

${errors}

**Instructions:**
1. Fix each error listed above
2. Call the same function again with corrected data
3. Do not change fields that were not mentioned in errors`
}

/**
 * Extract correctable errors (as opposed to system errors)
 */
export function getCorrectableErrors(error: ZodError): Array<{
  field: string
  message: string
  code: string
  received?: any
}> {
  return error.errors
    .filter(err => 
      // Filter to only errors the LLM can fix
      !['invalid_type'].includes(err.code) || err.path.length > 0
    )
    .map(err => ({
      field: err.path.join('.'),
      message: err.message,
      code: err.code,
      received: err.input
    }))
}
```

### 6. Socket Handler Updates (`/lib/server/sockets/assistantFunctions.ts`)

```typescript
/**
 * Handle assistant function execution with validation loop
 */
socket.on('assistant:executeFunction', async (data: {
  messageId: number
  functionName: string
  args: any
  isRetry?: boolean
}) => {
  const func = getFunction(data.functionName)
  if (!func || !func.handler) return
  
  // Execute handler (returns validation result)
  const result = await func.handler({
    userId,
    args: data.args,
    socket
  })
  
  if (!result.success && result.validationErrors) {
    // Send errors back to LLM for self-correction
    socket.emit('assistant:validationErrors', {
      messageId: data.messageId,
      functionName: data.functionName,
      errors: result.validationErrors,
      originalArgs: data.args,
      errorMessage: formatValidationErrorsForLLM(result.validationErrors)
    })
    
    // LLM will retry with corrected data
    return
  }
  
  if (result.requiresConfirmation) {
    // Show preview to user for confirmation
    socket.emit('assistant:confirmationRequired', {
      messageId: data.messageId,
      functionName: data.functionName,
      preview: result.preview,
      message: result.message,
      data: data.args // Store for execution after confirmation
    })
    return
  }
  
  // If no confirmation needed, execute immediately
  // ... execute logic
})

/**
 * Handle user confirmation
 */
socket.on('assistant:confirmAction', async (data: {
  messageId: number
  functionName: string
  confirmed: boolean
  data: any
}) => {
  if (!data.confirmed) {
    socket.emit('assistant:actionCancelled', {
      messageId: data.messageId,
      message: 'Action cancelled by user.'
    })
    return
  }
  
  // Execute the confirmed action
  switch (data.functionName) {
    case 'createCharacter':
      const character = await executeCreateCharacter(
        userId,
        data.data,
        data.data.tags || []
      )
      socket.emit('assistant:actionComplete', {
        messageId: data.messageId,
        result: character,
        message: `Character "${character.name}" created successfully!`
      })
      break
    // ... other cases
  }
})
```

### 7. Frontend UI Components

#### AssistantConfirmation.svelte **[NEW]**

```svelte
<script lang="ts">
  import { Modal } from '@skeletonlabs/skeleton-svelte'
  
  interface Props {
    show: boolean
    functionName: string
    preview: any
    message: string
    onConfirm: () => void
    onCancel: () => void
  }
  
  let { show, functionName, preview, message, onConfirm, onCancel }: Props = $props()
</script>

<Modal open={show}>
  {#snippet content()}
    <div class="space-y-4">
      <h2 class="h2">Confirm Action</h2>
      <p>{message}</p>
      
      {#if functionName === 'createCharacter'}
        <div class="card p-4 space-y-2">
          <h3 class="h3">Character Preview</h3>
          <p><strong>Name:</strong> {preview.name}</p>
          {#if preview.nickname}
            <p><strong>Nickname:</strong> {preview.nickname}</p>
          {/if}
          <p><strong>Description:</strong> {preview.description}</p>
          <!-- ... more fields -->
        </div>
      {/if}
      
      <div class="flex gap-2 justify-end">
        <button class="btn variant-ghost" onclick={onCancel}>
          Cancel
        </button>
        <button class="btn variant-filled-primary" onclick={onConfirm}>
          Confirm
        </button>
      </div>
    </div>
  {/snippet}
</Modal>
```

### 8. LLM Prompt Updates

Add to system prompt:

```typescript
static readonly ENTITY_CREATION_CONTEXT = `# Entity Creation & Editing

You can create and edit entities using the following functions:

## Available Functions

${getFunctionDefinitionsForPrompt()} // Includes createCharacter, updateCharacter, etc.

## Validation & Self-Correction

When you call a creation/update function:

1. **If validation succeeds**: User will see a preview and must confirm
2. **If validation fails**: You will receive error details. You MUST:
   - Analyze the errors carefully
   - Fix ONLY the fields mentioned in errors
   - Call the same function again with corrected data
   - Continue until validation succeeds

Example error response:
\`\`\`
Validation Errors:
- **name**: Name is required (received: undefined)
- **description**: Description must be at least 10 characters (received: "Short")
\`\`\`

Your retry:
\`\`\`
{reasoning: "Fixing validation errors", functions: [createCharacter(name:"Sara", description:"A kind-hearted warrior from the northern kingdoms...")]}
\`\`\`

## Best Practices

1. Always provide complete, detailed information
2. For descriptions: minimum 50 characters, rich and detailed
3. For personalities: be specific and nuanced
4. If user provides partial info, ask clarifying questions first
5. When validation fails, analyze errors carefully and fix them

## Schema Documentation

Character schema:
- name: string (required, 1-100 chars)
- nickname: string (optional)
- description: string (required, min 10 chars)
- personality: string (optional)
- scenario: string (optional)
- firstMessage: string (optional)
- tags: string[] (optional)

// ... more schemas
`
```

---

## Implementation Phases

### Phase 1: Foundation (Characters Only)
1. Create `/lib/server/db/zodSchemas.ts`
2. Generate Zod schemas from Drizzle for characters
3. Create JSON Schema conversion utility
4. Add `createCharacter` function definition
5. Implement `createCharacterHandler` with validation
6. Add socket handlers for validation errors

### Phase 2: Self-Correction Loop
1. Format validation errors for LLM
2. Implement retry mechanism
3. Add error context to chat messages
4. Test self-correction with various error scenarios

### Phase 3: User Confirmation
1. Create `AssistantConfirmation.svelte` component
2. Implement confirmation socket handlers
3. Add execution logic after confirmation
4. Test full create → validate → preview → confirm → execute flow

### Phase 4: Character Updates
1. Add `updateCharacter` function
2. Implement diff preview
3. Test update validation and confirmation

### Phase 5: Expand to Other Entities
1. Add Persona creation/editing
2. Add Lorebook creation/editing
3. Add Lore entry creation/editing

### Phase 6: Advanced Features
1. Batch operations
2. Validation warnings (non-blocking suggestions)
3. Template-based creation
4. Import/export through assistant

---

## Testing Strategy

### Unit Tests
- Zod schema validation
- Error formatting
- JSON Schema generation

### Integration Tests
- Function call → validation → error return → retry
- Function call → validation → preview → confirm → execute
- Edge cases: missing fields, invalid types, constraint violations

### E2E Tests
- User asks to create character → assistant calls function → validation errors → retries → success → user confirms → character created
- User asks to edit character → assistant retrieves → calls update → shows diff → user confirms → updated

---

## Benefits

1. **Type Safety**: Database → Zod → TypeScript → JSON Schema → LLM prompts all aligned
2. **Self-Healing**: LLM automatically corrects validation errors
3. **User Control**: All actions require confirmation
4. **Maintainability**: Single source of truth (Drizzle schema)
5. **Extensibility**: Easy to add new entity types
6. **Documentation**: Schema = validation = documentation
7. **Consistency**: Same validation rules everywhere (API, UI, Assistant)

---

## Example Flow

```
User: "Create a character named Sara, a kind warrior"
Assistant (Step 1 - Reasoning): 
{reasoning: "User wants to create character, need more details", functions: []}

Assistant Response to User:
"I'd be happy to create Sara! To make her a complete character, I need a bit more information:
- A detailed description (personality, appearance, background)
- What kind of scenario should she be in?
- Any specific personality traits you want to emphasize?
- Should she have a first message/greeting?"

User: "She's a 25-year-old knight from the northern kingdoms, brave but compassionate. She believes in protecting the weak. For a greeting, have her introduce herself to a new recruit."

Assistant (Step 2 - Function Call):
{reasoning: "User provided details, creating character", functions: [createCharacter(
  name:"Sara",
  description:"Sara is a 25-year-old knight from the northern kingdoms. She is brave and skilled in combat, but what truly sets her apart is her compassion for others. She has dedicated her life to protecting the weak and upholding justice. Despite the harsh realities of her duties, she maintains a warm heart and believes in the power of kindness even in dark times.",
  personality:"Brave, compassionate, protective, just, warm-hearted, idealistic yet pragmatic",
  scenario:"Sara serves as a knight in the northern kingdoms, defending villages from threats and training new recruits.",
  firstMessage:"*Sara stands before you in gleaming armor, her hand resting on the pommel of her sword. Despite her imposing appearance, her smile is warm and welcoming.* Welcome, recruit. I'm Sara, one of the knights serving the northern kingdoms. I've heard good things about you. *She extends her hand for a handshake.* We protect those who cannot protect themselves - it's an honor and a responsibility I take seriously. Ready to begin your training?"
)]}

Server: *Validates with Zod*
✅ All fields valid
→ Returns preview for confirmation

UI Shows Confirmation Modal:
"Preview Character: Sara
- Name: Sara
- Description: Sara is a 25-year-old knight...
- Personality: Brave, compassionate...
- Scenario: Sara serves as a knight...
- First Message: *Sara stands before you...*

[Cancel] [Confirm]"

User: *Clicks Confirm*

Server: *Executes creation*
→ Inserts into database
→ Returns created character

Assistant Response:
"✅ Character created successfully! Sara, the brave and compassionate knight, is now ready for roleplay. You can find her in your character list and start chatting with her anytime."
```

### Example with Validation Errors & Self-Correction

```
User: "Create character Bob"

Assistant (Attempt 1):
{reasoning: "Creating Bob", functions: [createCharacter(name:"Bob", description:"Bob")]}

Server: ❌ Validation failed
Errors:
- **description**: Description must be at least 10 characters (received: "Bob")

Assistant (Attempt 2 - Auto-retry):
{reasoning: "Fixing description length error", functions: [createCharacter(
  name:"Bob",
  description:"Bob is a friendly adventurer who loves exploring new places and meeting interesting people."
)]}

Server: ✅ Validation success
→ Returns preview for confirmation

User: *Confirms*

Server: Creates character
```

---

## Additional Features

### Schema Documentation Generator

```typescript
/**
 * Generate human-readable schema documentation for LLM
 */
export function generateSchemaDocumentation(
  schema: z.ZodObject<any>
): string {
  const shape = schema.shape
  const docs = Object.entries(shape).map(([key, zodType]: [string, any]) => {
    const isOptional = zodType.isOptional()
    const typeName = zodType._def.typeName || 'unknown'
    
    // Extract description from Zod if exists
    const description = zodType.description || ''
    
    return `- **${key}** (${typeName}${isOptional ? ', optional' : ', required'}): ${description}`
  }).join('\n')
  
  return docs
}

// Usage in prompts:
const characterSchema = generateSchemaDocumentation(assistantCreateCharacterSchema)
```

### Validation Severity Levels

```typescript
export enum ValidationSeverity {
  ERROR = 'error',     // Blocks creation/update
  WARNING = 'warning', // Shows warning but allows creation
  INFO = 'info'        // Informational only
}

export interface ValidationResult {
  success: boolean
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
  info: ValidationIssue[]
}

// Example: Warn if description is short but allow
export const assistantCreateCharacterSchema = insertCharacterSchema
  .extend({
    description: z.string()
      .min(10, "Description must be at least 10 characters") // ERROR
      .refine(
        (val) => val.length >= 50,
        { message: "Consider adding more detail (50+ chars recommended)", severity: 'warning' }
      )
  })
```

### Field Dependencies

```typescript
// Example: If firstMessage is provided, ensure it's in character
export const assistantCreateCharacterSchema = insertCharacterSchema
  .extend({
    firstMessage: z.string().optional()
  })
  .refine(
    (data) => {
      if (data.firstMessage && data.name) {
        // Could check if firstMessage mentions character name, etc.
        return data.firstMessage.length > 20
      }
      return true
    },
    {
      message: "First message should be detailed (20+ characters)",
      path: ['firstMessage']
    }
  )
```

---

## Future Enhancements

1. **Batch Operations**: Create multiple entities in one action
2. **Templates**: Pre-defined character/persona templates
3. **Import/Export**: "Import this character from JSON"
4. **Guided Creation**: Multi-turn conversation to gather all fields
5. **Smart Defaults**: AI fills in missing optional fields intelligently
6. **Validation Suggestions**: "Did you mean...?" for common mistakes
7. **Preview Rendering**: Show actual character card preview
8. **Version Control**: Track changes to entities over time
9. **Collaboration**: Multiple users contributing to entity creation
10. **AI-Assisted Refinement**: "Make this description more detailed"

---

## API Reference

### Zod Schema Utilities

```typescript
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'

// Generate schemas from Drizzle
const insertSchema = createInsertSchema(drizzleTable, {
  // Optional: Override specific fields
  email: z.string().email(),
  age: z.number().min(0).max(150)
})

// Convert to JSON Schema for LLM
const jsonSchema = zodToJsonSchema(insertSchema)

// Parse and validate
const result = insertSchema.safeParse(data)
if (!result.success) {
  console.log(result.error.errors)
}
```

### Assistant Function Type Definitions

```typescript
export interface AssistantFunction {
  name: string
  description: string
  requiresConfirmation: boolean
  requiresAdmin: boolean
  parameters: any // JSON Schema
  handler?: AssistantFunctionHandler
}

export type AssistantFunctionHandler = (context: {
  userId: number
  args: any
  socket: Socket
}) => Promise<{
  success: boolean
  preview?: any
  validationErrors?: ValidationIssue[]
  message: string
  requiresConfirmation?: boolean
  [key: string]: any
}>

export interface ValidationIssue {
  field: string
  message: string
  code?: string
  received?: any
  severity?: 'error' | 'warning' | 'info'
}
```

---

## Migration Guide

### From Manual Zod to Drizzle-Generated

**Before:**
```typescript
// Manual Zod schema
export const characterSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(10),
  // ... 20+ fields manually defined
})
```

**After:**
```typescript
// Generated from Drizzle, refined as needed
export const assistantCreateCharacterSchema = createInsertSchema(schema.characters)
  .omit({ id: true, userId: true, createdAt: true, updatedAt: true })
  .extend({
    // Only override where custom validation needed
    description: z.string().min(10, "Description too short")
  })
```

**Benefits:**
- Single source of truth
- Automatic updates when DB schema changes
- Less code to maintain
- Type safety guaranteed

---

## Troubleshooting

### Common Issues

1. **"Type mismatch between Drizzle and Zod"**
   - Solution: Use `.extend()` to override specific fields
   
2. **"Validation passes but DB insert fails"**
   - Solution: Check for DB constraints not captured in Zod (unique indexes, foreign keys)
   
3. **"LLM keeps failing validation"**
   - Solution: Improve error messages, add examples to prompt
   
4. **"Preview doesn't match final entity"**
   - Solution: Ensure preview logic matches execution logic exactly

---

## Security Considerations

1. **Authorization**: Always verify userId owns the entity being modified
2. **Rate Limiting**: Limit number of creation attempts per user per timeframe
3. **Input Sanitization**: Zod handles type safety, but consider XSS for text fields
4. **Sensitive Data**: Never include sensitive fields in previews/errors
5. **Admin Functions**: Properly gate admin-only functions

---

## Performance Optimization

1. **Schema Caching**: Generate JSON schemas once at build time
2. **Validation Batching**: Validate multiple entities in parallel
3. **Preview Generation**: Use database views for efficient preview queries
4. **Error Formatting**: Cache formatted error messages

---

## Metrics & Monitoring

Track:
- Validation success rate per function
- Average retries before success
- User confirmation rate (confirm vs cancel)
- Time from function call to entity creation
- Most common validation errors

This helps identify:
- Confusing validation rules
- LLM prompt improvements needed
- User experience issues

---

## References

- [Drizzle Zod Integration](https://orm.drizzle.team/docs/zod)
- [Zod Documentation](https://zod.dev/)
- [Zod to JSON Schema](https://github.com/StefanTerdell/zod-to-json-schema)
- [OpenAI Function Calling](https://platform.openai.com/docs/guides/function-calling)

