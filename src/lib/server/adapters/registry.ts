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
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

/** The modules that serve one connection type. At least one is always present. */
export interface AdapterModules {
	/** Loads the text-family module — the one that can implement `generateText`. */
	text?: () => Promise<AdapterExports>
	/** Loads the image-family module — the one that can implement `generateImage`. */
	image?: () => Promise<ImageAdapterExports>
}

export const ADAPTER_REGISTRY: Record<string, AdapterModules> = {
	[CONNECTION_TYPE.LM_STUDIO]: {
		text: async () =>
			(await import("../connectionAdapters/LMStudioAdapter")).default
	},

	[CONNECTION_TYPE.OLLAMA]: {
		text: async () =>
			(await import("../connectionAdapters/OllamaAdapter")).default
	},

	[CONNECTION_TYPE.OPENAI_CHAT]: {
		text: async () =>
			(await import("../connectionAdapters/OpenAIChatAdapter")).default
		// No `image`, and the manifest no longer claims `text->image` for this
		// type either. It used to: the `openai-official` preset asserted it, the
		// declaration was `probed`, so it resolved to `native`, the bind guard
		// passed — and then `getImageAdapter` threw `No image adapter for
		// connection type` minutes into a session. An image slot binding a
		// connection with no image code at all is exactly the disagreement this
		// registry now makes unmergeable.
	},

	[CONNECTION_TYPE.LLAMACPP_COMPLETION]: {
		text: async () =>
			(await import("../connectionAdapters/LlamaCppAdapter")).default
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
		image: async () => (await import("../imageAdapters/A1111Adapter")).default
	},

	[CONNECTION_TYPE.KOBOLDCPP_MANAGED]: {
		text: async () =>
			(await import("../connectionAdapters/KoboldCppManagedAdapter"))
				.default
		// ⚠ No `image`, deliberately, and this absence is now CI-enforced rather
		// than remembered. A managed text connection NAMES A TEXT MODEL and cannot
		// draw, whatever the process happens to be holding at the time. The
		// manifest entry has the matching note ("the key is absent from `supports`
		// on purpose … Do not 'restore' it"); with the derivation in place, adding
		// an image thunk here without also adding the key — or the key without the
		// thunk — fails the conformance test. Image generation through the Manager
		// is KOBOLDCPP_MANAGED_IMAGE, below.
	},

	[CONNECTION_TYPE.ANTHROPIC]: {
		text: async () =>
			(await import("../connectionAdapters/AnthropicAdapter")).default
	},

	// One adapter, four backends — KoboldCPP, AUTOMATIC1111, Forge and SD.Next
	// all speak the same `/sdapi/v1` surface.
	[CONNECTION_TYPE.A1111]: {
		image: async () => (await import("../imageAdapters/A1111Adapter")).default
	},

	// The MANAGED image type renders through that same A1111 wire — its module
	// re-exports the adapter class unchanged — but it is not the same module,
	// because two things around the render differ: its base URL lives in the
	// Manager's settings rather than on the row, and its model is a file on disk
	// the Manager loads on demand rather than a checkpoint the server already
	// holds. Testing and listing have to ask those questions instead of
	// `/sdapi/v1/sd-models`, which 404s whenever the process is holding a text
	// model — i.e. most of the time.
	[CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE]: {
		image: async () =>
			(await import("../imageAdapters/KoboldCppManagedImageAdapter"))
				.default
	}
}

/** Every connection type some adapter module serves. */
export const REGISTERED_CONNECTION_TYPES = Object.keys(ADAPTER_REGISTRY)
