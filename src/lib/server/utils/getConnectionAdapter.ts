import ollamaAdapter from "../connectionAdapters/OllamaAdapter"
import openAIChatAdapter from "../connectionAdapters/OpenAIChatAdapter"
import lmStudioAdapter from "../connectionAdapters/LMStudioAdapter"
import llamaCppAdapter from "../connectionAdapters/LlamaCppAdapter"
import koboldCppAdapter from "../connectionAdapters/KoboldCppAdapter"
import koboldCppManagedAdapter from "../connectionAdapters/KoboldCppManagedAdapter"
import anthropicAdapter from "../connectionAdapters/AnthropicAdapter"
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
		case CONNECTION_TYPE.KOBOLDCPP:
			return koboldCppAdapter
		case CONNECTION_TYPE.KOBOLDCPP_MANAGED:
			return koboldCppManagedAdapter
		case CONNECTION_TYPE.ANTHROPIC:
			return anthropicAdapter
		default:
			throw new Error(`Unsupported connection type: ${connectionType}`)
	}
}
