/**
 * The single connection-type → adapter-module map.
 *
 * There used to be two of these, written as `switch` statements inside
 * `getConnectionAdapter` and `getImageAdapter`. That was fine while nothing else
 * needed to know the mapping — and stopped being fine the moment the manifest
 * became a CACHE of what the adapters implement, because the conformance test
 * that checks the two agree has to walk exactly the same map the loaders use. A
 * third spelling of it would be one more thing that can drift, in the file whose
 * entire job is to stop drift.
 *
 * ⚠ **Importing this module loads NO adapter module.** The values are THUNKS,
 * not imports, and that is not a performance nicety: `@lmstudio/sdk` uses
 * `\p{Lu}` regex property escapes that fail to PARSE under nodejs-mobile's build
 * of V8, so a static import of it crashes server boot on Android — before any
 * code runs, regardless of whether the user ever configured LM Studio. Every
 * `import()` below must stay inside a thunk, and nothing in this file may be
 * changed to a top-level import to "simplify" it.
 *
 * ## A type's actions are the UNION across its modules
 *
 * KOBOLDCPP has BOTH a text module and an image one, so it derives
 * `{text->text, text->image}` between them. That union is the reason the two
 * adapter families never had to be merged to make the derivation work: once the
 * actions are named, `KoboldCppAdapter.generateText` and
 * `A1111Adapter.generateImage` cannot collide. Two classes each implementing
 * DIFFERENT actions at FIXED signatures is coherent; it was only ever incoherent
 * while both classes exposed a method called `generate`.
 */

import type { AdapterExports } from "$lib/server/connectionAdapters/BaseConnectionAdapter"
import type { ImageAdapterExports } from "$lib/server/imageAdapters/BaseImageAdapter"
import type { EmbeddingAdapterExports } from "$lib/server/embeddingAdapters/BaseEmbeddingAdapter"
import type { NerAdapterExports } from "$lib/server/nerAdapters/BaseNerAdapter"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

/** The modules that serve one connection type. At least one is always present. */
export interface AdapterModules {
	/** Loads the text-family module — the one that can implement `generateText`. */
	text?: () => Promise<AdapterExports>
	/** Loads the image-family module — the one that can implement `generateImage`. */
	image?: () => Promise<ImageAdapterExports>
	/** Loads the embedding-family module — the one that can implement `embedText`. */
	embedding?: () => Promise<EmbeddingAdapterExports>
	/** Loads the NER-family module — the one that can implement `extractEntities`. */
	ner?: () => Promise<NerAdapterExports>
}

export const ADAPTER_REGISTRY: Record<string, AdapterModules> = {
	[CONNECTION_TYPE.LM_STUDIO]: {
		text: async () =>
			(await import("../connectionAdapters/LMStudioAdapter")).default,
		// `POST /v1/embeddings` on LM Studio's own server, over plain HTTP —
		// not through `@lmstudio/sdk`, so embedding never needs the module
		// Android cannot parse. Which models embed is per model: LM Studio's
		// listing says `type: "embedding"`.
		embedding: async () =>
			(await import("../embeddingAdapters/LMStudioEmbeddingAdapter"))
				.default
	},

	[CONNECTION_TYPE.OLLAMA]: {
		text: async () =>
			(await import("../connectionAdapters/OllamaAdapter")).default,
		// One Ollama host, every modality it serves (owner ruling 2026-09-25).
		// `ollama-embeddings` was a second connection to the SAME host that
		// existed only because a connection had one modality, and since plan
		// 2026-09-24 B4 made every Ollama connection its own host, the two rows
		// could not be folded into one view without risking two hosts in it.
		// Declaring the family the host really has — `POST /api/embed` — makes
		// the second row unnecessary instead. Not the "load-bearing absence"
		// the entity block warns about: that is a family a type CANNOT serve.
		embedding: async () =>
			(await import("../embeddingAdapters/OllamaEmbeddingAdapter")).default
	},

	[CONNECTION_TYPE.OPENAI]: {
		text: async () =>
			(await import("../connectionAdapters/OpenAIChatAdapter")).default,
		// `/embeddings` on the same service (owner ruling 2026-10-05): one
		// OpenAI-compatible connection per service, so `openai-embeddings` rows
		// merge into this type (`connections/openAIMultiModality.ts`) and embed
		// through the very module they used before. Whether a service embeds is
		// its preset's claim or the person's switch, not this map's.
		embedding: async () =>
			(await import("../embeddingAdapters/OpenAIEmbeddingAdapter"))
				.default
		// No `image`, and the manifest no longer claims `text->image` for this
		// type either. It used to: the `openai-official` preset asserted it, the
		// declaration was `probed`, so it resolved to `native`, the bind guard
		// passed — and then `getImageAdapter` threw `No image adapter for
		// connection type` minutes into a session. An image slot binding a
		// connection with no image code at all is exactly the disagreement this
		// registry now makes unmergeable.
	},

	[CONNECTION_TYPE.LLAMACPP]: {
		text: async () =>
			(await import("../connectionAdapters/LlamaCppAdapter")).default,
		// One module, BOTH wires. `LlamaCppAdapter` branches on `isChatWire`
		// between llama-server's native `/completion` and its OpenAI-compatible
		// `/v1/chat/completions`, which is why this stayed one type when the id
		// lost its `_completion` suffix: the service is the type, the wire is a
		// capability.
		//
		// `POST /v1/embeddings` — answered only by a llama-server started with
		// `--embeddings`, which the text module's probe finds out on Test.
		embedding: async () =>
			(await import("../embeddingAdapters/LlamaCppEmbeddingAdapter"))
				.default
	},

	[CONNECTION_TYPE.KOBOLDCPP]: {
		text: async () =>
			(await import("../connectionAdapters/KoboldCppAdapter")).default,
		// Plain KOBOLDCPP genuinely is one process doing both — an external
		// instance the user started with `--sdmodel` — and this app neither
		// started it nor manages what it holds. Its own type tag says text, its
		// probe says whether it can draw, and the probe is the honest authority.
		// Nothing here has to be started or loaded first, which is why it draws
		// through the same `/sdapi/v1` adapter every other A1111-compatible
		// backend uses.
		image: async () =>
			(await import("../imageAdapters/A1111Adapter")).default,
		// `POST /v1/embeddings` with whatever model the instance was started
		// with — offered only because KoboldCPP names that model in every
		// response, and the adapter refuses one that is not the pair's.
		embedding: async () =>
			(await import("../embeddingAdapters/KoboldCppEmbeddingAdapter"))
				.default
	},

	[CONNECTION_TYPE.KOBOLDCPP_MANAGED]: {
		text: async () =>
			(await import("../connectionAdapters/KoboldCppManagedAdapter"))
				.default,
		// The same managed KoboldCPP draws too — one process, whose model manager swaps
		// the text or image model it holds. Which one a request may use is the
		// MODEL's modality (`capabilityRefusal`), not the type's.
		image: async () =>
			(await import("../imageAdapters/KoboldCppManagedImageAdapter"))
				.default,
		// And embeds, from koboldcpp's co-resident embeddings slot: the
		// adapter loads the pair's GGUF there first, beside whatever chat or
		// image model is resident, and refuses an answer from any other model.
		embedding: async () =>
			(
				await import(
					"../embeddingAdapters/KoboldCppManagedEmbeddingAdapter"
				)
			).default
	},

	[CONNECTION_TYPE.ANTHROPIC]: {
		text: async () =>
			(await import("../connectionAdapters/AnthropicAdapter")).default
	},

	// One adapter, four backends — KoboldCPP, AUTOMATIC1111, Forge and SD.Next
	// all speak the same `/sdapi/v1` surface.
	[CONNECTION_TYPE.A1111]: {
		image: async () =>
			(await import("../imageAdapters/A1111Adapter")).default
	},

	// The MANAGED image type renders through that same A1111 wire — its module
	// re-exports the adapter class unchanged — but it is not the same module,
	// because two things around the render differ: its base URL lives in the
	// the managed KoboldCPP's settings rather than on the row, and its model is a file on disk
	// the managed KoboldCPP loads on demand rather than a checkpoint the server already
	// holds. Testing and listing have to ask those questions instead of
	// `/sdapi/v1/sd-models`, which 404s whenever the process is holding a text
	// model — i.e. most of the time.
	[CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE]: {
		image: async () =>
			(await import("../imageAdapters/KoboldCppManagedImageAdapter"))
				.default
	},

	// ── Embeddings ──────────────────────────────────────────────────────────
	//
	// Three types, one action each, and no `text` module between them — which is
	// the load-bearing absence here. An embedding endpoint that derived
	// `text->text` from a text module would be offerable as the chat default and
	// would fail every Send; `modalityAllows` closes the same hole from the
	// other side for a row whose capabilities nobody has resolved yet.

	[CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS]: {
		// ⚠ The thunk matters more here than anywhere else in this map:
		// `LocalOnnxEmbeddingAdapter` reaches `@huggingface/transformers`, whose
		// `onnxruntime-node` native addon has no Android build at all.
		embedding: async () =>
			(await import("../embeddingAdapters/LocalOnnxEmbeddingAdapter"))
				.default
	},

	// ⏳ Merged into `openai` at boot (owner ruling 2026-10-05); kept so a row
	// the merge has not reached still embeds. The same module `openai` uses.
	[CONNECTION_TYPE.OPENAI_EMBEDDINGS]: {
		embedding: async () =>
			(await import("../embeddingAdapters/OpenAIEmbeddingAdapter"))
				.default
	},

	[CONNECTION_TYPE.OLLAMA_EMBEDDINGS]: {
		// `POST /api/embed`, not the `/v1/embeddings` shim — see the adapter.
		embedding: async () =>
			(await import("../embeddingAdapters/OllamaEmbeddingAdapter"))
				.default
	},

	// ── Named entities ──────────────────────────────────────────────────────
	//
	// One type, one action, and no module from any other family — the same
	// load-bearing absence the embedding block above has. An entity endpoint that
	// derived `text->text` would be offerable as the chat default and would fail
	// every Send.

	[CONNECTION_TYPE.LOCAL_ONNX_NER]: {
		// ⚠ The thunk matters as much here as for local embeddings:
		// `LocalOnnxNerAdapter` reaches `@huggingface/transformers`, whose
		// `onnxruntime-node` native addon has no Android build at all.
		ner: async () =>
			(await import("../nerAdapters/LocalOnnxNerAdapter")).default
	}
}

/** Every connection type some adapter module serves. */
export const REGISTERED_CONNECTION_TYPES = Object.keys(ADAPTER_REGISTRY)
