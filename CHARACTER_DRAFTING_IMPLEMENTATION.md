# Character Drafting System - Implementation Documentation

## Overview

The character drafting system enables AI-assisted character creation through iterative field-by-field generation, validation, and auto-correction. This document provides a complete technical overview of the implementation.

## Architecture

### Component Structure

```
characterHandlers.ts (Entry Point)
    └── draftCharacterHandler
        └── draftOrchestrator.ts (High-Level Coordination)
            ├── characterDraftGenerator.ts (Field Logic)
            ├── llmFieldGenerator.ts (LLM API Calls)
            └── validationRetryHandler.ts (Auto-Correction)
```

### Data Flow

```
1. User Request → draftCharacterHandler
2. Load existing draft from chat.metadata
3. Orchestrator determines fields to populate
4. For each field:
   a. Generate prompt with context
   b. Call LLM API
   c. Parse response
   d. Emit progress via socket
5. Validate complete draft
6. Auto-correct errors (up to 3 attempts)
7. Save to chat.metadata
8. Return result to assistant
```

## Module Documentation

### 1. draftCharacterHandler (Entry Point)

**Location:** `/lib/server/assistantFunctions/handlers/characterHandlers.ts`

**Purpose:** Main entry point for character draft creation function.

**Responsibilities:**
- Load chat and existing draft from database
- Call orchestrator to generate/update draft
- Save result back to chat.metadata
- Return structured response to assistant

**Function Signature:**
```typescript
draftCharacterHandler: AssistantFunctionHandler = async ({
  userId: number,
  chatId: number,
  args: { userRequest: string, additionalFields?: string[] },
  socket: Socket
}) => Promise<AssistantFunctionResult>
```

**Return Format:**
```typescript
{
  success: true,
  data: {
    draft: Partial<AssistantCreateCharacter>,
    isValid: boolean,
    validationErrors: FormattedValidationError[],
    generatedFields: string[],
    validationAttempts: number,
    message: string
  }
}
```

### 2. draftOrchestrator.ts (Coordination Layer)

**Location:** `/lib/server/assistantFunctions/utils/draftOrchestrator.ts`

**Purpose:** High-level orchestration of draft generation process.

**Key Functions:**

#### `generateCharacterDraft(options)`

Main orchestration function that coordinates all steps.

**Process:**
1. Determine fields to populate (required + requested optional)
2. Generate each field using LLM (with progress callbacks)
3. Validate complete draft with Zod schema
4. Auto-correct validation errors (retry up to 3 times)
5. Emit socket progress events at each step

**Progress Events Emitted:**
- `started` - Draft generation begins
- `generating_field` - Currently generating a specific field
- `field_complete` - Field generated successfully
- `field_error` - Field generation failed
- `validating` - Starting validation
- `correcting` - Auto-correcting validation errors
- `complete` - Draft fully generated and valid
- `validation_failed` - Draft generated but has unfixable errors

**Example Socket Event:**
```typescript
socket.emit('assistant:draftProgress', {
  chatId: 123,
  status: 'generating_field',
  field: 'name',
  fieldStatus: 'generating',
  message: 'Generating name...',
  currentField: 1,
  totalFields: 4,
  timestamp: 1234567890
})
```

### 3. llmFieldGenerator.ts (LLM Integration)

**Location:** `/lib/server/assistantFunctions/utils/llmFieldGenerator.ts`

**Purpose:** Low-level LLM API calls for field generation.

**Key Functions:**

#### `generateFieldWithLLM(options)`

Direct LLM API call for generating a single field value.

**Parameters:**
```typescript
{
  userId: number,           // For loading user's LLM configuration
  systemPrompt: string,     // System-level instructions
  userPrompt: string,       // Field-specific generation prompt
  maxTokens?: number        // Token limit (default: 500)
}
```

**Supported Connection Types:**
- `openai` - OpenAI-compatible APIs (uses chat completion)
- `ollama` - Ollama API
- `lmstudio` - LMStudio
- `koboldcpp` - KoboldCpp
- `llamacpp` - Llama.cpp

**Implementation Details:**

Each connection type has a dedicated API caller:

```typescript
callOpenAIAPI()     // POST /chat/completions
callOllamaAPI()     // POST /api/chat
callCompletionAPI() // POST /v1/completions (LMStudio, Kobold, Llama.cpp)
```

**Error Handling:**
- Network errors → Thrown with descriptive message
- API errors → Extracted from response and thrown
- Empty responses → Returns empty string

#### `generateFieldWithProgress(options)`

Wrapper around `generateFieldWithLLM` that adds progress callbacks.

**Progress Callback Format:**
```typescript
(update: {
  field: string,
  status: 'generating' | 'validating' | 'complete' | 'error',
  message?: string,
  value?: any,
  error?: string
}) => void
```

### 4. validationRetryHandler.ts (Auto-Correction)

**Location:** `/lib/server/assistantFunctions/utils/validationRetryHandler.ts`

**Purpose:** Automatic validation error correction using LLM.

**Key Functions:**

#### `retryValidationWithLLM(options)`

Validates draft and auto-corrects errors using LLM.

**Process:**
1. Validate draft with Zod schema
2. If valid → Return success
3. If invalid → Extract correctable errors
4. For each correctable error:
   a. Build correction prompt with error context
   b. Call LLM to fix the field
   c. Parse corrected value
5. Re-validate (repeat up to maxAttempts)

**Correctable Error Types:**
- `too_big` - String/array too long (LLM shortens it)
- `too_small` - String/array too short (LLM expands it)
- `invalid_string` - Format issues (LLM rephrases)
- `invalid_type` - Type mismatch (LLM converts)

**Non-Correctable Errors:**
- Errors on fields with no value (requires user input)
- Complex structural errors
- Missing required fields

**Example Correction Prompts:**

For `too_big` string error:
```
The field "description" has a validation error:
String must contain at most 500 character(s)

Current value (750 characters):
"[long description text]"

Please rewrite this to be 500 characters or less while preserving 
the core meaning and character voice. Return ONLY the shortened text, 
nothing else.
```

For `too_small` array error:
```
The field "alternateGreetings" has a validation error:
Array must contain at least 2 element(s)

Current array (1 items):
["Hello there!"]

Please add 1 more items in a similar style to reach at least 2 items. 
Return ONLY a JSON array with the complete result (including original items), 
nothing else.
```

#### `extractCorrectableErrors(errors, draft)`

Filters validation errors to find those that can be auto-corrected.

**Criteria:**
- Field must exist in draft (has a value)
- Error code must be correctable type
- Error must be on a simple field (not deeply nested)

#### `correctFieldError(options)`

Corrects a single field using LLM.

**Parameters:**
```typescript
{
  error: FormattedValidationError,
  currentValue: any,
  draft: Record<string, any>,
  userId: number
}
```

**Returns:** Corrected value (same type as input)

**Parsing Logic:**
- Array fields → Extract JSON array from response
- String fields → Trim and return text
- Fallback → Return original value if parsing fails

### 5. characterDraftGenerator.ts (Field Logic)

**Location:** `/lib/server/assistantFunctions/utils/characterDraftGenerator.ts`

**Purpose:** Field-specific generation logic and prompts.

**Key Constants:**

#### `REQUIRED_CHARACTER_FIELDS`
```typescript
['name', 'description']
```

#### `OPTIONAL_CHARACTER_FIELDS`
```typescript
[
  'nickname', 'personality', 'scenario', 'firstMessage',
  'alternateGreetings', 'characterVersion', 'systemPrompt',
  'postHistoryInstructions', 'tags', 'creator', 'creatorNotes',
  'exampleDialogues'
]
```

#### `FIELD_GENERATION_GUIDANCE`

Object mapping each field to generation instructions:

```typescript
{
  name: {
    prompt: 'Generate a character name. Keep it concise (1-50 characters)...',
    maxLength: 50,
    isArray: false
  },
  description: {
    prompt: 'Generate a detailed character description...',
    maxLength: 2000,
    isArray: false
  },
  alternateGreetings: {
    prompt: 'Generate 2-3 alternative greeting messages...',
    isArray: true
  },
  // ... all 13 fields
}
```

**Key Functions:**

#### `generateFieldPrompt(field, userRequest, existingDraft)`

Creates context-aware prompt for generating a specific field.

**Prompt Structure:**
```
[Field-Specific Guidance]

User Request:
[userRequest]

[If existingDraft has related fields:]
Existing Character Details:
- name: [value]
- description: [value]
...

Generate the [field] field following the guidance above.
```

**Example for 'personality' field:**
```
Generate a personality description for this character. Consider their 
background, role, and how they typically behave. Be specific about traits, 
mannerisms, and emotional tendencies. Maximum 500 characters.

User Request:
Create a detective character named Alice who is brilliant but struggles 
with social situations

Existing Character Details:
- name: Alice Sterling
- description: A 35-year-old detective with a photographic memory

Generate the personality field following the guidance above.
```

#### `determineFieldsToPopulate(userRequest, additionalFields, existingDraft)`

Determines which fields need to be generated.

**Logic:**
1. Always include missing required fields
2. Add requested optional fields (if valid and not present)
3. Skip fields that already exist in draft

**Returns:** `string[]` - Array of field names to generate

#### `parseFieldValue(field, response)`

Parses LLM response based on field type.

**For Array Fields:**
```typescript
// Extract JSON array from response
const jsonMatch = response.match(/\[[\s\S]*\]/)
if (jsonMatch) {
  return JSON.parse(jsonMatch[0])
}
return [] // Fallback
```

**For String Fields:**
```typescript
return response.trim()
```

## Storage & Persistence

### Chat Metadata Structure

Drafts are stored in `chats.metadata` as JSON:

```typescript
{
  dataEditor: {
    create: {
      characters: [
        {
          // Active draft at index 0
          name: "Alice Sterling",
          description: "A brilliant detective...",
          personality: "Sharp, observant...",
          // ... other fields
        }
      ],
      personas: []
    },
    edit: {
      // Future: editing existing entities
    }
  }
}
```

### Helper Functions

**From:** `/lib/shared/types/chatMetadata.ts`

```typescript
parseChatMetadata(json)        // Parse JSON string to ChatMetadata
serializeChatMetadata(obj)     // Convert ChatMetadata to JSON string
getActiveCharacterDraft(meta)  // Get meta.dataEditor?.create?.characters?.[0]
setActiveCharacterDraft(meta)  // Set characters[0] immutably
clearActiveCharacterDraft(meta) // Remove characters[0]
```

## Socket Integration

### Event: `assistant:draftProgress`

**Emitted By:** draftOrchestrator.ts  
**Listened By:** Frontend draft UI component (to be implemented)

**Event Payload:**
```typescript
{
  chatId: number,
  timestamp: number,
  status: 'started' | 'generating_field' | 'field_complete' | ... ,
  message?: string,
  field?: string,
  currentField?: number,
  totalFields?: number,
  draft?: Partial<AssistantCreateCharacter>,
  errors?: FormattedValidationError[]
}
```

**Status Flow:**
```
started
  ↓
generating_field (field 1)
  ↓
field_complete (field 1)
  ↓
generating_field (field 2)
  ↓
... (repeat for all fields)
  ↓
validating
  ↓
[If validation fails:]
correcting (attempt 1)
  ↓
validating
  ↓
[If still fails, repeat up to 3 attempts]
  ↓
[Final status:]
complete (if valid) OR validation_failed (if unfixable errors)
```

## Error Handling

### Field Generation Errors

**Handled By:** draftOrchestrator.ts

**Strategy:**
- Log error
- Emit `field_error` event with details
- Continue with remaining fields
- Don't block entire draft creation

### Validation Errors

**Handled By:** validationRetryHandler.ts

**Strategy:**
- Extract correctable errors
- Auto-fix with LLM (up to 3 attempts)
- Return remaining errors to user
- Save draft even if invalid (user can fix)

### LLM API Errors

**Handled By:** llmFieldGenerator.ts

**Strategy:**
- Throw descriptive error with API status
- Catch in orchestrator
- Emit error event
- Fail gracefully

## Configuration

### LLM Settings

Uses user's active connection and sampling config:

```typescript
const { connection, sampling } = await getUserConfigurations(userId)
```

**Applied Settings:**
- `temperature` - Creativity level (default: 0.7)
- `top_p` - Nucleus sampling (default: 1.0)
- `max_tokens` - Per-field token limit (varies by field)

### Field Token Limits

**Logic:** `min(fieldMaxLength * 2, 1000)`

Examples:
- name (50 chars max) → 100 tokens
- description (2000 chars max) → 1000 tokens
- personality (500 chars max) → 1000 tokens

## Testing Considerations

### Unit Testing

**llmFieldGenerator.ts:**
- Mock fetch for each connection type
- Test error handling (network, API errors)
- Verify correct endpoint/payload for each type

**validationRetryHandler.ts:**
- Mock LLM calls
- Test each error type correction
- Verify retry logic (max 3 attempts)
- Test extraction of correctable errors

**characterDraftGenerator.ts:**
- Test field determination logic
- Verify prompt generation includes context
- Test parsing (arrays vs strings)

### Integration Testing

**draftOrchestrator.ts:**
- Mock all dependencies
- Verify socket events emitted correctly
- Test full flow (happy path)
- Test partial failures (some fields fail)
- Test validation retry flow

### End-to-End Testing

**Full Flow:**
1. Call draftCharacterHandler
2. Verify LLM called for each field
3. Check validation runs
4. Verify auto-correction if needed
5. Confirm draft saved to metadata
6. Check socket events emitted

## Performance Considerations

### Sequential Field Generation

**Current:** Fields generated one at a time  
**Why:** Each field uses context from previous fields  
**Future:** Could parallelize independent fields

### Token Usage

**Per Draft:**
- Name: ~100 tokens
- Description: ~500-1000 tokens
- Other fields: ~200-500 tokens each
- **Total:** ~2000-4000 tokens for full character

**Optimization:**
- Only generate requested fields
- Reuse existing draft values
- Skip optional fields by default

### Validation Retries

**Cost:** Up to 3 LLM calls per correctable error  
**Mitigation:**
- Only correct simple errors
- User fixes complex issues
- Cache correction prompts

## Future Enhancements

### 1. Streaming Responses

Replace single LLM calls with streaming for real-time updates:
```typescript
for await (const chunk of llmStream) {
  currentValue += chunk
  emitProgress({ status: 'generating', partialValue: currentValue })
}
```

### 2. Parallel Field Generation

Generate independent fields simultaneously:
```typescript
const fieldPromises = independentFields.map(field => generateField(field))
await Promise.all(fieldPromises)
```

### 3. User Preferences

Allow users to configure:
- Default optional fields to include
- Field generation style (verbose vs concise)
- Auto-save vs manual review

### 4. Template System

Pre-defined character templates:
```typescript
templates: {
  detective: ['personality', 'scenario', 'firstMessage'],
  fantasy: ['systemPrompt', 'alternateGreetings', 'tags'],
  // ...
}
```

### 5. Incremental Updates

Support editing specific fields without regenerating:
```typescript
draftCharacter({
  userRequest: "Make her more sarcastic",
  fieldsToUpdate: ['personality', 'exampleDialogues']
})
```

## Troubleshooting

### Common Issues

**Issue:** Field generation returns empty string  
**Cause:** LLM response doesn't match expected format  
**Fix:** Check parsing logic in parseFieldValue()

**Issue:** Validation never succeeds  
**Cause:** Auto-correction not fixing the right errors  
**Fix:** Check buildCorrectionPrompt() for that error type

**Issue:** Socket events not received  
**Cause:** Socket disconnected or event name mismatch  
**Fix:** Verify event name matches type definition

**Issue:** LLM API errors  
**Cause:** Wrong URL, missing API key, or unsupported connection type  
**Fix:** Check connection configuration in database

### Debug Logging

All modules include comprehensive console.log statements:

```typescript
[draftCharacterHandler] Starting for chat 123, user 456
[DraftOrchestrator] Fields to populate: ['name', 'description']
[DraftOrchestrator] Generated field "name": Alice Sterling
[ValidationRetry] Attempt 1/3
[ValidationRetry] Corrected field: description
```

Filter logs by module prefix for targeted debugging.

## API Reference

See inline JSDoc comments in each module for detailed API documentation.

## Related Files

- `/lib/server/db/zodSchemas.ts` - Validation schemas
- `/lib/server/utils/assistantValidation.ts` - Error formatting
- `/lib/shared/types/chatMetadata.ts` - Metadata type system
- `/lib/shared/sockets/types.ts` - Socket event types
- `/lib/shared/assistantFunctions/definitions/characterFunctions.ts` - Function definition

---

**Last Updated:** 2025-10-24  
**Version:** 1.0.0 (Initial Implementation)
