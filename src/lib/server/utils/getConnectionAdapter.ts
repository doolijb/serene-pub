import ollamaAdapter from "../connectionAdapters/OllamaAdapter"
import openAIChatAdapter from "../connectionAdapters/OpenAIChatAdapter"
import lmStudioAdapter from "../connectionAdapters/LMStudioAdapter"
import llamaCppAdapter from "../connectionAdapters/LlamaCppAdapter"
import type { AdapterExports } from "../connectionAdapters/BaseConnectionAdapter"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

export function getConnectionAdapter(connectionType: string): AdapterExports {
	switch (connectionType) {
		case CONNECTION_TYPE.LM_STUDIO:
			return lmStudioAdapter
		case CONNECTION_TYPE.OLLAMA:
			return ollamaAdapter
		case CONNECTION_TYPE.OPENAI_CHAT:
			return openAIChatAdapter
		case CONNECTION_TYPE.LLAMACPP_COMPLETION:
			return llamaCppAdapter
		default:
			throw new Error(`Unsupported connection type: ${connectionType}`)
	}
}
