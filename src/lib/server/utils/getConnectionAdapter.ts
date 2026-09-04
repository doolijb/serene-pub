import type { AdapterExports } from "../connectionAdapters/BaseConnectionAdapter"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

// Dynamic imports, not static ones: each adapter module is only parsed the
// first time a connection of that type is actually used. Some third-party
// SDKs (e.g. @lmstudio/sdk, which uses \p{Lu} Unicode regex property
// escapes) fail to even parse under nodejs-mobile's Android build of V8,
// which lacks full ICU support — a static import here would pull every
// adapter (used or not) into the server's startup module graph and crash
// Node before it could even boot on Android, regardless of whether the user
// configured that connection type.
export async function getConnectionAdapter(
	connectionType: string
): Promise<AdapterExports> {
	switch (connectionType) {
		case CONNECTION_TYPE.LM_STUDIO:
			return (await import("../connectionAdapters/LMStudioAdapter"))
				.default
		case CONNECTION_TYPE.OLLAMA:
		// llmman speaks the Ollama API (on port 17434), so it shares the adapter.
		case CONNECTION_TYPE.LLMMAN:
			return (await import("../connectionAdapters/OllamaAdapter")).default
		case CONNECTION_TYPE.OPENAI_CHAT:
			return (await import("../connectionAdapters/OpenAIChatAdapter"))
				.default
		case CONNECTION_TYPE.LLAMACPP_COMPLETION:
			return (await import("../connectionAdapters/LlamaCppAdapter"))
				.default
		case CONNECTION_TYPE.KOBOLDCPP:
			return (await import("../connectionAdapters/KoboldCppAdapter"))
				.default
		case CONNECTION_TYPE.KOBOLDCPP_MANAGED:
			return (
				await import("../connectionAdapters/KoboldCppManagedAdapter")
			).default
		case CONNECTION_TYPE.ANTHROPIC:
			return (await import("../connectionAdapters/AnthropicAdapter"))
				.default
		default:
			throw new Error(`Unsupported connection type: ${connectionType}`)
	}
}
