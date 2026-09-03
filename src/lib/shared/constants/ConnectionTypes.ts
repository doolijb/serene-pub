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
<p>Serene Pub supports OpenAI's chat completion API.</p>
<p>It provides a powerful API for generating chat completions and supports various models.</p>
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
	/**
	 * Image generation through the KoboldCPP Manager.
	 *
	 * A second type rather than a flag on KOBOLDCPP_MANAGED, because a
	 * connection names exactly ONE model and a text GGUF is not an image one.
	 * Which model is RESIDENT in the process at any moment is the model
	 * manager's business, not this row's — see `planResidency`.
	 */
	static readonly KOBOLDCPP_MANAGED_IMAGE = "koboldcpp_managed_image"
	static ANTHROPIC = "anthropic"
	/**
	 * Image generation over the A1111-compatible wire (`/sdapi/v1/txt2img`).
	 *
	 * One type for four backends — KoboldCPP, AUTOMATIC1111, Forge and SD.Next all
	 * speak it — which is the whole argument for scoping an adapter by API format
	 * rather than by vendor. Replaces the Fooocus type: that project is abandoned
	 * upstream, and its adapter went with it.
	 */
	static A1111 = "a1111"

	static options: {
		value: string
		label: string
		description: string
		difficulty: string
		/**
		 * Which model modality this connection type is for. Absent = "text-gen"
		 * (every existing type). Image types carry "image-gen" so the New
		 * Connection picker's Text/Image button-group can filter them.
		 */
		modality?: "text-gen" | "image-gen"
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
			label: "OpenAI Chat",
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
			value: CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE,
			label: "KoboldCPP Manager (Image)",
			description:
				"Image generation through the KoboldCPP Manager. One connection per " +
				"image model, loaded on demand exactly as an LLM is — KoboldCPP holds " +
				"one model at a time today, so drawing a picture swaps the chat model out.",
			difficulty: "Beginner - Managed for you",
			category: "local",
			modality: "image-gen"
		},
		{
			value: CONNECTION_TYPE.ANTHROPIC,
			label: "Anthropic (Claude)",
			description: anthropicDesc,
			difficulty: anthropicDiff,
			category: "cloud"
		},
		{
			value: CONNECTION_TYPE.A1111,
			label: "Stable Diffusion (A1111-compatible)",
			description:
				"Local image generation over the A1111 API — KoboldCPP with an " +
				"image model loaded, AUTOMATIC1111, Forge or SD.Next. Point this " +
				"at whichever is running; they all speak the same endpoints.",
			difficulty: "Beginner (with KoboldCPP) - Simple setup",
			category: "local",
			modality: "image-gen"
		}
	]

	/** The modality a connection type is for; absent option ⇒ "text-gen". */
	static modalityOf(type: string): "text-gen" | "image-gen" {
		return (
			CONNECTION_TYPE.options.find((o) => o.value === type)?.modality ??
			"text-gen"
		)
	}

	/** True for image-generation connection types (route to getImageAdapter). */
	static isImage(type: string): boolean {
		return CONNECTION_TYPE.modalityOf(type) === "image-gen"
	}
}

/**
 * A modality as the shape id the pipeline knows it by.
 *
 * The two vocabularies are the same fact spelled twice — `connections.modality`
 * is what a row stores, `core:shape/<modality>@1` is what a descriptor declares —
 * and this is the one place that translation lives, so a slot's declared shape
 * and a connection's stored modality can be compared without either side
 * learning the other's spelling.
 *
 * Takes the modality rather than the connection type so it also serves a row
 * whose `modality` column was set directly.
 */
export function shapeOfModality(modality?: string | null): string {
	return `core:shape/${modality || "text-gen"}@1`
}

/**
 * The inverse: the modality a shape id names.
 *
 * `shapeOfModality` above builds `core:shape/<modality>@<version>` from a
 * template, which is what makes reading the modality back out a PARSE rather
 * than a guess — the grammar is asserted by the writer in this same file. Kept
 * beside it for that reason: the two must be edited together or not at all.
 *
 * Deliberately NOT in `capabilities/samplingShape.ts`. That module maps a shape
 * to a CAPABILITY, and its own doc comment explains at length why one scalar
 * must not be made to carry both meanings — a modality is a coarse filing
 * category ("text gen", "image gen") and says nothing about what a connection
 * can multimodally do.
 *
 * Version-tolerant by construction, so `@2` still buckets with `@1`, and an
 * unrecognised plugin shape buckets into its own namespace rather than being
 * folded into text — which is the safe failure direction for anything scoped by
 * this (a name is then unique within that plugin's own modality instead of
 * silently competing with chat).
 *
 * ⚠ The expression is mirrored in SQL as
 * `split_part(split_part(shape, '/', 2), '@', 1)` — migration 0179's unique
 * index on `sampling_configs`. The two must agree character for character: a
 * shape with no `/` yields `""` on both sides, not a fallback to "text-gen".
 */
export function modalityOfShape(shape?: string | null): string {
	return ((shape ?? "").split("/")[1] ?? "").split("@")[0]
}

/** A modality as it should read to a person, e.g. in an error message. */
export function modalityLabel(modality: string): string {
	if (modality === "text-gen") return "text generation"
	if (modality === "image-gen") return "image generation"
	return modality || "this modality"
}

export const CONNECTION_TYPES = CONNECTION_TYPE.options
