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

const openaiChatDesc = `
<p>Serene Pub supports OpenAI's chat completion API.</p>
<p>It provides a powerful API for generating chat completions and supports various models.</p>
<p>To use OpenAI's API, you need to create an account and obtain an API key from <a class="text-primary-500 hover:underline" href="https://platform.openai.com/signup" target="_blank">OpenAI's website</a> or another service.</p>
<p>OpenAI's API is well-documented and widely used, making it a good choice for many applications.</p>
`

const openaiChatDiff = "Beginner - Nothing to install"

export class CONNECTION_TYPE {
	static LLAMACPP_COMPLETION = "llamacpp_completion"
	static LM_STUDIO = "lmstudio"
	static OLLAMA = "ollama"
	static OPENAI_CHAT = "openai"

	static options: {
		value: string
		label: string
		description: string
		difficulty: string
	}[] = [
		{
			value: CONNECTION_TYPE.LM_STUDIO,
			label: "LM Studio",
			description: lmStudioDesc,
			difficulty: lmStudioDiff
		},
		{
			value: CONNECTION_TYPE.OLLAMA,
			label: "Ollama",
			description: ollamaDesc,
			difficulty: ollamaDiff
		},
		{
			value: CONNECTION_TYPE.OPENAI_CHAT,
			label: "OpenAI Chat",
			description: openaiChatDesc,
			difficulty: openaiChatDiff
		},
        {
			value: CONNECTION_TYPE.LLAMACPP_COMPLETION,
			label: "Llama.cpp",
			description: llamaCppCompletionDesc,
			difficulty: llamaCppCompletionDiff
		}
	]
}

export const CONNECTION_TYPES = CONNECTION_TYPE.options
