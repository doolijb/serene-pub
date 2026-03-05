/**
 * Server-side Assistant Function Registry
 *
 * Attaches handler functions to the function definitions.
 * This should only be imported on the server side.
 */

import { assistantFunctionRegistry } from "$lib/shared/assistantFunctions/registry"
import {
	listCharactersHandler,
	draftCharacterHandler
} from "./handlers/characterHandlers"

// Attach handlers to function definitions
if (assistantFunctionRegistry.listCharacters) {
	assistantFunctionRegistry.listCharacters.handler = listCharactersHandler
}

if (assistantFunctionRegistry.draftCharacter) {
	assistantFunctionRegistry.draftCharacter.handler = draftCharacterHandler
}

// Export the registry with handlers attached
export {
	assistantFunctionRegistry,
	getFunction
} from "$lib/shared/assistantFunctions/registry"
