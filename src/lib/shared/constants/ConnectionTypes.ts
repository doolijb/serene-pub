// Use html to explain the connection types and any helpful information/links

const llamaCppCompletionDesc = `
<p>Serene Pub supports Llama.cpp through <a class="text-primary-500 hover:underline" href="https://github.com/ggml-org/llama.cpp" target="_blank">llama-server's completion API.</a></p>
<p>Llama.cpp is a high-performance C++ library for running LLaMA models.</p>
<p>It supports various model formats and provides efficient inference capabilities.</p>
<p>For more information, visit the <a class="text-primary-500 hover:underline" href="https://github.com/ggml-org/llama.cpp" target="_blank">Llama.cpp GitHub repository</a>.</p>
`

const llamaCppCompletionDiff = "Intermediate - Not for beginners"

const lmStudioDesc = `
<p>Serene Pub supports LM Studio through their <a class="text-primary-500 hover:underline" href="https://lmstudio.ai/docs/app/api/endpoints/rest" target="_blank">"LM Studio REST API (beta)"</a>.</p>
<p>It provides a user-friendly interface and supports various model formats.</p>
<p>You can download LM Studio <a class="text-primary-500 hover:underline" href="https://lmstudio.ai/" target="_blank">here</a>.</p>
<p>PS: You will have to enable the REST API in LM Studio settings.</p>
`

const lmStudioDiff = "Beginner (GUI) - Minimal setup required"

const ollamaDesc = `
<p>Serene Pub supports Ollama through its <a class="text-primary-500 hover:underline" href="https://github.com/ollama/ollama/blob/main/docs/api.md" target="_blank">native API.</a></p>
<p>It provides a simple API for generating completions and supports various model formats.</p>
<p>To download Ollama, visit their <a class="text-primary-500 hover:underline" href="https://ollama.com/" target="_blank">official website</a>.</p>
<p>Ollama is simple to setup and run, manages your models automatically, but requires minimal command line usage.</p>
<p>Models can be downloaded from <a class="text-primary-500 hover:underline" href="https://ollama.com/library" target="_blank">Ollama's model library</a> or via GGUF releases on <a class="text-primary-500 hover:underline" href="https://huggingface.co/" target="_blank">Hugging Face</a>.</p>
`

const ollamaDiff = "Beginner (No GUI) - Minimal setup required"

const openaiSessionDesc = `
<p>Serene Pub supports OpenAI's session completion API.</p>
<p>It provides a powerful API for generating session completions and supports various models.</p>
<p>To use OpenAI's API, you need to create an account and obtain an API key from <a class="text-primary-500 hover:underline" href="https://platform.openai.com/signup" target="_blank">OpenAI's website</a> or another service.</p>
<p>OpenAI's API is well-documented and widely used, making it a good choice for many applications.</p>
`

const openaiSessionDiff = "Beginner - Nothing to install"

const koboldCppDesc = `
<p>Serene Pub supports KoboldCPP through its <a class="text-primary-500 hover:underline" href="https://github.com/LostRuins/koboldcpp/wiki" target="_blank">native API</a>.</p>
<p>KoboldCPP is a simple one-file way to run various GGML and GGUF models with a KoboldAI-like interface.</p>
<p>KoboldCPP has a built-in GUI and is relatively easy to set up and use.</p>
<p>It offers great performance and additional configuration options outside of Serene Pub.</p>
<p>You can download KoboldCPP from the <a class="text-primary-500 hover:underline" href="https://github.com/LostRuins/koboldcpp/releases" target="_blank">GitHub releases page</a>.</p>
`

const koboldCppDiff = "Beginner (GUI) - Simple setup"

const koboldCppManagedDesc = `
<p>A KoboldCPP connection managed by Serene Pub's built-in <b>KoboldCPP Manager</b>.</p>
<p>The manager handles model loading and swapping for you — pick a model here and it's loaded via KoboldCPP's admin API (spawning a managed subprocess, or using your own already-running KoboldCPP instance with the admin API enabled).</p>
<p>Requires the KoboldCPP Manager to be enabled in Settings.</p>
`

const koboldCppManagedDiff = "Beginner (GUI) - Managed by Serene Pub"

const anthropicDesc = `
<p>Serene Pub supports Anthropic's Claude API directly.</p>
<p>Claude models support native extended thinking, streaming, and long context windows.</p>
<p>To use Anthropic's API, obtain an API key from <a class="text-primary-500 hover:underline" href="https://console.anthropic.com/" target="_blank">Anthropic's console</a>.</p>
<p>Extended thinking is supported on Claude 3.7+ models and requires setting a thinking budget in the connection settings.</p>
`

const anthropicDiff = "Beginner - Nothing to install"

export class CONNECTION_TYPE {
	static LLAMACPP_COMPLETION = "llamacpp_completion"
	static LM_STUDIO = "lmstudio"
	static OLLAMA = "ollama"
	static OPENAI_CHAT = "openai"
	static KOBOLDCPP = "koboldcpp"
	static KOBOLDCPP_MANAGED = "koboldcpp_managed"
	static ANTHROPIC = "anthropic"

	static options: {
		value: string
		label: string
		description: string
		difficulty: string
		/** Used to group this type alongside OPENAI_CHAT_PRESETS entries in the
		 * unified "New Connection" service picker — "local" for anything that
		 * talks to a process running on the user's own machine/network,
		 * "cloud" for a hosted third-party API. */
		category: "cloud" | "local"
	}[] = [
		{
			value: CONNECTION_TYPE.LM_STUDIO,
			label: "LM Studio",
			description: lmStudioDesc,
			difficulty: lmStudioDiff,
			category: "local"
		},
		{
			value: CONNECTION_TYPE.OLLAMA,
			label: "Ollama",
			description: ollamaDesc,
			difficulty: ollamaDiff,
			category: "local"
		},
		{
			value: CONNECTION_TYPE.OPENAI_CHAT,
			label: "OpenAI Session",
			description: openaiSessionDesc,
			difficulty: openaiSessionDiff,
			category: "cloud"
		},
		{
			value: CONNECTION_TYPE.LLAMACPP_COMPLETION,
			label: "Llama.cpp",
			description: llamaCppCompletionDesc,
			difficulty: llamaCppCompletionDiff,
			category: "local"
		},
		{
			value: CONNECTION_TYPE.KOBOLDCPP,
			label: "KoboldCPP",
			description: koboldCppDesc,
			difficulty: koboldCppDiff,
			category: "local"
		},
		{
			value: CONNECTION_TYPE.KOBOLDCPP_MANAGED,
			label: "KoboldCPP Manager",
			description: koboldCppManagedDesc,
			difficulty: koboldCppManagedDiff,
			category: "local"
		},
		{
			value: CONNECTION_TYPE.ANTHROPIC,
			label: "Anthropic (Claude)",
			description: anthropicDesc,
			difficulty: anthropicDiff,
			category: "cloud"
		}
	]
}

export const CONNECTION_TYPES = CONNECTION_TYPE.options
