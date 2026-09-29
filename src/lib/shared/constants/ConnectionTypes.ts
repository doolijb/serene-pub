// Use html to explain the connection types and any helpful information/links

const llamaCppDesc = `
<p>Serene Pub supports Llama.cpp through <a class="text-primary-500 hover:underline" href="https://github.com/ggml-org/llama.cpp" target="_blank">llama-server</a> — its native completion API by default, and its chat API if you switch the wire mode on the connection.</p>
<p>Llama.cpp is a high-performance C++ library for running LLaMA models.</p>
<p>It supports various model formats and provides efficient inference capabilities.</p>
<p>For more information, visit the <a class="text-primary-500 hover:underline" href="https://github.com/ggml-org/llama.cpp" target="_blank">Llama.cpp GitHub repository</a>.</p>
`

const llamaCppDiff = "Intermediate - Not for beginners"

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

const koboldCppDesc = `
<p>Serene Pub supports KoboldCPP through its <a class="text-primary-500 hover:underline" href="https://github.com/LostRuins/koboldcpp/wiki" target="_blank">native API</a>.</p>
<p>KoboldCPP is a simple one-file way to run various GGML and GGUF models with a KoboldAI-like interface.</p>
<p>KoboldCPP has a built-in GUI and is relatively easy to set up and use.</p>
<p>It offers great performance and additional configuration options outside of Serene Pub.</p>
<p>You can download KoboldCPP from the <a class="text-primary-500 hover:underline" href="https://github.com/LostRuins/koboldcpp/releases" target="_blank">GitHub releases page</a>.</p>
`

const koboldCppDiff = "Beginner (GUI) - Simple setup"

const koboldCppManagedDesc = `
<p><b>KoboldCPP, run by Serene Pub</b>: a KoboldCPP that Serene Pub installs, starts and stops.</p>
<p>Serene Pub handles model loading and swapping for you — pick a model here and it's loaded via KoboldCPP's admin API (spawning a managed subprocess, or using your own already-running KoboldCPP instance with the admin API enabled).</p>
<p>Turned on from Connections → Add → KoboldCPP, run by Serene Pub.</p>
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
	/**
	 * llama.cpp's llama-server — the SERVICE, not one of its two wires.
	 *
	 * The id was `llamacpp_completion` and it was the only one in this class
	 * that encoded a WIRE MODE. That is now a connection capability graded
	 * through the same four layers as everything else (`wire_chat` /
	 * `wire_completion`), so a type spelling it too was the same fact in two
	 * places — and the place that could not be switched. Ruling 2026-09-08:
	 * one connection type per service, wire mode as a property.
	 *
	 * Its own type rather than an `openai` preset pointed at the same server,
	 * because llama-server's native `/completion` is not the OpenAI wire with a
	 * different URL: `id_slot`/`cache_prompt` (prompt-cache slot reuse),
	 * `n_probs`, `samplers` (explicit sampler ORDER), `t_max_predict_ms` and
	 * `dry_sequence_breakers` have no OpenAI field to be carried in, and
	 * `llamaCppSamplingKeyMap` names them. Its `testConnection` and
	 * `listModels` are `/health` and `/show`, not `/v1/models`. A preset would
	 * drop all of it silently.
	 *
	 * ⚠ Renaming the id needed a data migration — `drizzle/0105_llamacpp_service_type.sql`.
	 */
	static LLAMACPP = "llamacpp"
	static LM_STUDIO = "lmstudio"
	static OLLAMA = "ollama"
	/**
	 * The OpenAI-compatible wire format, and the two dozen services behind it.
	 *
	 * Was `OPENAI_CHAT`. The `_CHAT` was a misnomer once wire mode became a
	 * capability: this type declares BOTH `wire_chat` and `wire_completion`,
	 * and a connection of it can be switched to either. The id string is
	 * unchanged, so nothing was migrated.
	 */
	static OPENAI = "openai"
	static KOBOLDCPP = "koboldcpp"
	static KOBOLDCPP_MANAGED = "koboldcpp_managed"
	/**
	 * ⏳ Retired: image generation through KoboldCPP, run by Serene Pub is the managed
	 * endpoint's own image models (`KOBOLDCPP_MANAGED`, each model carrying its
	 * `modality`). Rows of this type are folded into that endpoint at boot
	 * (`koboldCppManagedFold.ts`); the id stays declared so a row the fold has
	 * not reached still resolves. Nothing creates one.
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

	/**
	 * Embeddings from an in-process ONNX model (`@huggingface/transformers`).
	 *
	 * The id predates this type existing as a `CONNECTION_TYPE`: the boot-time
	 * projection of the old `vectorization_configs` singleton has been writing
	 * `local-onnx` into `connections.type` since 20 §14, so naming it anything
	 * else here would strand every row that migration produced.
	 *
	 * No base URL — the model is a HuggingFace id and the weights live in the app
	 * data directory, which is why its `listModels` answers from `EMBEDDING_MODELS`
	 * and the `local_models` rows whose modality is `embeddings` rather than from a
	 * host.
	 */
	static LOCAL_ONNX_EMBEDDINGS = "local-onnx"
	/**
	 * Any OpenAI-compatible `/embeddings` endpoint — OpenAI itself, LM Studio,
	 * llama.cpp server, vLLM.
	 *
	 * Its own type rather than a capability on {@link OPENAI}, because
	 * `OpenAIChatAdapter`
	 * speaks `/v1/chat/completions` and nothing else; `/embeddings` is a different
	 * route, hence a different adapter.
	 *
	 * ⚠ Id fixed by the same migration that fixes `local-onnx` above.
	 */
	static OPENAI_EMBEDDINGS = "openai-embeddings"
	/**
	 * Ollama's native embedding route, `POST /api/embed`.
	 *
	 * Not the OpenAI preset pointed at Ollama: `/api/embed` takes `input` and
	 * answers `{embeddings: number[][]}`, and it is the route Ollama's own docs
	 * name — the `/v1/embeddings` shim exists but is the compatibility layer, not
	 * the API. Same reasoning {@link OLLAMA} is its own type for.
	 */
	static OLLAMA_EMBEDDINGS = "ollama-embeddings"
	/**
	 * Named-entity recognition from an in-process ONNX model
	 * (`@huggingface/transformers`, `token-classification`).
	 *
	 * The same shape as {@link LOCAL_ONNX_EMBEDDINGS} and for the same reasons:
	 * no base URL and no key, because the model is a HuggingFace id whose weights
	 * live in the app data directory, so its `listModels` answers from
	 * `NER_MODELS` and the `local_models` rows whose modality is `ner` rather
	 * than from a host.
	 *
	 * Its own type rather than a second capability on the embeddings type: a
	 * token-classification checkpoint loads and runs through a different
	 * pipeline from a sentence-embedding one, so it is a different adapter. The API variant (a hosted entity endpoint)
	 * is a further type when one exists, not a flag here.
	 */
	static LOCAL_ONNX_NER = "local-onnx-ner"

	static options: {
		value: string
		label: string
		description: string
		difficulty: string
		/**
		 * Which model modality this connection type is for. Absent = "text-gen".
		 *
		 * ⚠ An OPEN string, not a union, and deliberately so. It is the same
		 * vocabulary `connections.modality` and `local_models.modality` document
		 * — `text-gen | embeddings | image-gen | ner | tts | …` — and a closed
		 * union here would be a second, narrower spelling of it: adding a
		 * modality would mean editing this line as well as the section table,
		 * and the two could disagree. What a modality MEANS to a person (its
		 * label, its star, its picker) is one entry in
		 * `$lib/shared/constants/connectionSections`; what a TYPE is for is this
		 * field, and neither constrains the other's spelling.
		 */
		modality?: string
		/** Used to group this type alongside OPENAI_COMPATIBLE_PRESETS entries in the
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
			value: CONNECTION_TYPE.OPENAI,
			label: "OpenAI Chat",
			description: openaiChatDesc,
			difficulty: openaiChatDiff,
			category: "cloud"
		},
		{
			value: CONNECTION_TYPE.LLAMACPP,
			label: "Llama.cpp",
			description: llamaCppDesc,
			difficulty: llamaCppDiff,
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
			label: "KoboldCPP, run by Serene Pub",
			description: koboldCppManagedDesc,
			difficulty: koboldCppManagedDiff,
			category: "local"
		},
		{
			value: CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE,
			label: "KoboldCPP, run by Serene Pub (Image)",
			description:
				"Image generation through KoboldCPP, run by Serene Pub. One connection per " +
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
		},
		{
			value: CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS,
			label: "Local embeddings (ONNX)",
			description:
				"<p>Runs a small embedding model in this process, on the CPU, " +
				"through <b>@huggingface/transformers</b>. One download, then no " +
				"network and no API key.</p>" +
				"<p>Not available on Android, and not on every desktop build of " +
				"onnxruntime-node — the connection says so when it cannot load.</p>",
			difficulty: "Beginner - One download",
			category: "local",
			modality: "embeddings"
		},
		{
			value: CONNECTION_TYPE.OPENAI_EMBEDDINGS,
			label: "Embeddings (OpenAI-compatible)",
			description:
				"<p>Any OpenAI-compatible <b>/embeddings</b> endpoint — OpenAI " +
				"itself, LM Studio, llama.cpp server, vLLM, a hosted gateway.</p>" +
				"<p>Point it at the base URL and name the embedding model; the " +
				"vector width is read back from the endpoint rather than assumed.</p>",
			difficulty: "Beginner - Nothing to install",
			category: "cloud",
			modality: "embeddings"
		},
		{
			value: CONNECTION_TYPE.OLLAMA_EMBEDDINGS,
			label: "Ollama embeddings",
			description:
				"<p>Ollama's own embedding route, <b>POST /api/embed</b>.</p>" +
				"<p>Pull an embedding model (<code>ollama pull nomic-embed-text</code>) " +
				"and pick it here. Ollama loads and unloads it for you.</p>",
			difficulty: "Beginner (No GUI) - Minimal setup required",
			category: "local",
			modality: "embeddings"
		},
		{
			value: CONNECTION_TYPE.LOCAL_ONNX_NER,
			label: "Local named entities (ONNX)",
			description:
				"<p>Runs a small entity model in this process, on the CPU, " +
				"through <b>@huggingface/transformers</b>. One download, then no " +
				"network and no API key.</p>" +
				"<p>It reads the people, places and organisations out of your " +
				"messages and lore, so an entry can be matched by the names it " +
				"uses even when nobody set a keyword for it.</p>" +
				"<p>Not available on Android, and not on every desktop build of " +
				"onnxruntime-node — the connection says so when it cannot load.</p>",
			difficulty: "Beginner - One download",
			category: "local",
			modality: "ner"
		}
	]

	/**
	 * The modality a connection type DECLARES; an absent option ⇒ "text-gen".
	 *
	 * ⚠ Returns `string`, not a union, and must stay that way. The vocabulary is
	 * open — the SDK's connection shapes are its contract — and a union here
	 * would have to be edited alongside `CONNECTION_SECTIONS` for every modality
	 * added, which is one fact in two places that can disagree. A caller asking
	 * what a modality is FOR asks `sectionForModality`; this answers only what
	 * the type declared.
	 *
	 * A type nobody declared answers "text-gen", which is what every type that
	 * predates the field is, and what an out-of-tree type most likely is.
	 */
	static modalityOf(type: string): string {
		return (
			CONNECTION_TYPE.options.find((o) => o.value === type)?.modality ??
			"text-gen"
		)
	}

	/** True for image-generation connection types (route to getImageAdapter). */
	static isImage(type: string): boolean {
		return CONNECTION_TYPE.modalityOf(type) === "image-gen"
	}

	/**
	 * True for the KoboldCPP this pub runs: its base URL comes from its settings, not the row, and
	 * its image model loads on demand through the model manager.
	 *
	 * ⏳ Both ids, because `KOBOLDCPP_MANAGED_IMAGE` rows are folded into the
	 * managed row at boot (`koboldCppManagedFold.ts`) and a render can still
	 * arrive for one between an upgrade and that fold.
	 */
	static isManagedKoboldCpp(type: string | null | undefined): boolean {
		return (
			type === CONNECTION_TYPE.KOBOLDCPP_MANAGED ||
			type === CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE
		)
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
	if (modality === "embeddings") return "embeddings"
	if (modality === "ner") return "entity extraction"
	return modality || "this modality"
}

export const CONNECTION_TYPES = CONNECTION_TYPE.options
