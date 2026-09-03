/**
 * What each API format can express, declared as static data.
 *
 * ## Why this is a separate module from the adapters
 *
 * Two reasons, and the second is load-bearing.
 *
 * The picker needs to know what a connection type can do *before* anything is
 * chosen — it renders capability badges on types the user has not created a
 * connection for yet. Reaching into an adapter module for that would import
 * every backend's SDK at startup, which is exactly what the lazy `import()` in
 * `getConnectionAdapter` exists to avoid.
 *
 * And that lazy loading is not a performance nicety: `@lmstudio/sdk` uses
 * `\p{Lu}` regex property escapes that **fail to parse under nodejs-mobile's V8
 * on Android**, so a static import of it crashes server boot on that platform
 * regardless of configuration. Today the capability declaration lives inside
 * that un-importable module. Moving it here makes the declaration reachable
 * everywhere and leaves the implementation lazy — strictly better than before.
 *
 * ## The layering this participates in
 *
 *   THIS FILE (what the wire protocol can express)  ← a gate, not a default
 *     → preset  (what this named service does)
 *     → probe   (what the live backend answered)
 *     → user    (the final toggle)
 *
 * A capability absent from an entry's `supports` can never be switched on by any
 * of the three layers below it, because the protocol has no field for it. That
 * is the whole reason an adapter is scoped by API FORMAT rather than by vendor:
 * Claude reached through an OpenAI-compatible endpoint and Claude reached
 * through the native Anthropic API differ in precisely this.
 */

import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import type { AdapterCapabilities } from "@serene-pub/sdk"

export interface AdapterManifestEntry {
	/** The `CONNECTION_TYPE` value this describes. */
	id: string
	/** What this wire protocol can express, and what is on by default. */
	capabilities: AdapterCapabilities
}

/**
 * Per-API-format declarations.
 *
 * `probed` entries carry what to assume until something answers, and the two
 * fallbacks differ for a reason: tool calling degrades to `emulated` because the
 * app can format and parse it for a model that never heard of tools, while image
 * generation degrades to `none` because nothing fakes a picture.
 */
export const ADAPTER_MANIFEST: Record<string, AdapterManifestEntry> = {
	/**
	 * OpenAI Chat Completions — and the twenty-four services behind it.
	 *
	 * The widest `supports` and the most `probed` entries, because "an
	 * OpenAI-compatible endpoint" says almost nothing about what is actually
	 * serving it. `json_object` is native while `json_schema` is probed
	 * deliberately: the compatible zoo supports the loose mode far more widely
	 * than the strict one, which is a difference presets exist to record.
	 */
	[CONNECTION_TYPE.OPENAI_CHAT]: {
		id: CONNECTION_TYPE.OPENAI_CHAT,
		capabilities: {
			supports: {
				"text->text": "native",
				"text+image->text": { tier: "probed", until: "none" },
				"text+document->text": { tier: "probed", until: "none" },
				"text->image": { tier: "probed", until: "none" },
				json_object: "native",
				json_schema: { tier: "probed", until: "none" },
				strict_schema: { tier: "probed", until: "none" },
				tools: "native",
				streaming: "native"
			},
			defaults: ["text->text", "json_object", "tools", "streaming"]
		}
	},

	/**
	 * The Anthropic Messages API.
	 *
	 * Three deliberate absences: no `json_object`, no `json_schema`, no
	 * `grammar`. The adapter has never implemented any of them, and a
	 * `responseSchema` set on an Anthropic connection is silently ignored today.
	 * Declaring the gap turns that silence into a refusal at bind time with a
	 * sentence naming the capability.
	 */
	[CONNECTION_TYPE.ANTHROPIC]: {
		id: CONNECTION_TYPE.ANTHROPIC,
		capabilities: {
			supports: {
				"text->text": "native",
				"text+image->text": "native",
				"text+document->text": "native",
				tools: "native",
				streaming: "native"
			},
			defaults: [
				"text->text",
				"text+image->text",
				"text+document->text",
				"tools",
				"streaming"
			]
		}
	},

	/**
	 * Ollama's native API.
	 *
	 * Vision is probed and costs no extra request: `ollama.list()` already
	 * returns `details.families`, and a `clip`/`mmproj` family there is the
	 * answer. Tools degrade to `emulated` rather than `none` because the grammar
	 * path works regardless of the model.
	 */
	[CONNECTION_TYPE.OLLAMA]: {
		id: CONNECTION_TYPE.OLLAMA,
		capabilities: {
			supports: {
				"text->text": "native",
				"text+image->text": { tier: "probed", until: "none" },
				"text->embedding": "native",
				json_object: "native",
				json_schema: "native",
				tools: { tier: "probed", until: "emulated" },
				streaming: "native"
			},
			defaults: [
				"text->text",
				"json_object",
				"json_schema",
				"tools",
				"streaming"
			]
		}
	},

	/**
	 * KoboldCPP, native API.
	 *
	 * The one backend that genuinely does everything from one process — and it
	 * already reports which of them over `/api/extra/version`, which is why all
	 * four extras are probed rather than guessed. `grammar` is native (GBNF), so
	 * the schema forms come back as `emulated` through `EMULATABLE_VIA` without
	 * being declared here.
	 */
	[CONNECTION_TYPE.KOBOLDCPP]: {
		id: CONNECTION_TYPE.KOBOLDCPP,
		capabilities: {
			supports: {
				"text->text": "native",
				"text+image->text": { tier: "probed", until: "none" },
				"text->image": { tier: "probed", until: "none" },
				"text->audio": { tier: "probed", until: "none" },
				"audio->text": { tier: "probed", until: "none" },
				"text->embedding": { tier: "probed", until: "none" },
				grammar: "native",
				tools: "emulated",
				streaming: "native"
			},
			defaults: ["text->text", "grammar", "tools", "streaming"]
		}
	},

	/** The same wire format, with the admin API assumed. */
	[CONNECTION_TYPE.KOBOLDCPP_MANAGED]: {
		id: CONNECTION_TYPE.KOBOLDCPP_MANAGED,
		capabilities: {
			supports: {
				"text->text": "native",
				"text+image->text": { tier: "probed", until: "none" },
				// No text->image, and its absence is structural rather than a default.
				// resolveCapabilities iterates `supports` only, so a key that is not here
				// cannot be granted by a preset, a probe or an override — which is what makes
				// the reported bug (an LLM connection offered in the image picker)
				// unreproducible rather than merely un-triggered. A managed text connection
				// names a text model and cannot draw, whatever the process happens to hold.
				// Image generation through the Manager is KOBOLDCPP_MANAGED_IMAGE.
				"text->audio": { tier: "probed", until: "none" },
				"audio->text": { tier: "probed", until: "none" },
				"text->embedding": { tier: "probed", until: "none" },
				grammar: "native",
				tools: "emulated",
				streaming: "native"
			},
			defaults: ["text->text", "grammar", "tools", "streaming"]
		}
	},

	/** llama.cpp's llama-server completion API. Grammar, and text, and no more. */
	[CONNECTION_TYPE.LLAMACPP_COMPLETION]: {
		id: CONNECTION_TYPE.LLAMACPP_COMPLETION,
		capabilities: {
			supports: {
				"text->text": "native",
				"text+image->text": { tier: "probed", until: "none" },
				grammar: "native",
				tools: "emulated",
				streaming: "native"
			},
			defaults: ["text->text", "grammar", "tools", "streaming"]
		}
	},

	/** The LM Studio SDK. Native structured output, emulated tools. */
	[CONNECTION_TYPE.LM_STUDIO]: {
		id: CONNECTION_TYPE.LM_STUDIO,
		capabilities: {
			supports: {
				"text->text": "native",
				"text+image->text": { tier: "probed", until: "none" },
				json_object: "native",
				json_schema: "native",
				tools: "emulated",
				streaming: "native"
			},
			defaults: [
				"text->text",
				"json_object",
				"json_schema",
				"tools",
				"streaming"
			]
		}
	},

	/**
	 * The A1111-compatible image API — KoboldCPP with an image model, plus
	 * AUTOMATIC1111, Forge and SD.Next.
	 *
	 * Image only, and no text of any kind: `/sdapi/v1/txt2img` is the whole
	 * surface. A connection of this type pointed at a text node fails at bind
	 * rather than at the request, which is the point of declaring the absence.
	 */
	[CONNECTION_TYPE.A1111]: {
		id: CONNECTION_TYPE.A1111,
		capabilities: {
			supports: {
				"text->image": "native",
				"text+image->image": "native",
				"image->image": "native"
			},
			defaults: ["text->image"]
		}
	},

	/**
	 * An image connection by construction, which is why it needs no probe.
	 *
	 * KOBOLDCPP declares text->image as `probed`, because it points at somebody
	 * else's instance and whether that process can draw depends on what they
	 * loaded. KOBOLDCPP_MANAGED declares it NOWHERE AT ALL — see its entry above,
	 * where the key is absent from `supports` on purpose: a key the adapter does
	 * not declare can never appear, whatever any other layer says, and that
	 * asymmetry is the structural half of stopping a managed LLM connection from
	 * turning up in the image picker. Do not "restore" it. This type names an
	 * image model in `connection.model` and the Manager loads it on demand, so the
	 * answer is known before anything is running — which is what dissolves the
	 * refused→never-loaded→never-probed cycle that imageCapability.ts existed to
	 * break.
	 *
	 * Deliberately NOT A1111's three transforms: A1111Adapter is txt2img-only (it
	 * declares `init` unsupported), so claiming image->image here would refuse at
	 * request time instead of at bind time.
	 */
	[CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE]: {
		id: CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE,
		capabilities: {
			supports: {
				"text->image": "native"
			},
			defaults: ["text->image"]
		}
	}
}

/**
 * What a named service adds to, or takes away from, its API format.
 *
 * Keyed by preset slug. Absent means "the adapter's own defaults", which is the
 * right answer for a custom endpoint — and is why the `preset` column is left
 * NULL rather than guessed from a base URL.
 *
 * `true` is an assertion: the preset names a specific service and therefore
 * knows more than the generic protocol does, so it resolves at full strength
 * rather than inheriting the adapter's pessimistic `until`.
 */
export const PRESET_CAPABILITIES: Record<
	string,
	Partial<Record<string, boolean>>
> = {
	// Reaching Claude through an OpenAI-compatible endpoint. Vision works;
	// image generation does not, and this is the case the whole model was
	// designed around — the toggle EXISTS here (the protocol can express it)
	// and is off, whereas on the native Anthropic type it does not exist at all.
	anthropic: { "text+image->text": true, "text->image": false },

	"openai-official": {
		"text+image->text": true,
		"text->image": true,
		json_schema: true,
		strict_schema: true
	},
	openrouter: { "text+image->text": true, json_schema: true },
	"google-gemini": { "text+image->text": true, json_schema: true },
	groq: { json_schema: true },
	"together-ai": { json_schema: true },
	"mistral-ai": { json_schema: true },
	deepseek: { json_object: true },
	// The local OpenAI-compatible servers: schema support varies by build, so
	// the loose mode stays on and the strict one stays off until probed.
	"local-ai": { json_schema: false },
	vllm: { json_schema: true },
	sglang: { json_schema: true },
	"aphrodite-engine": { json_schema: true },
	"text-generation-webui": { json_schema: false }
}

/** What a connection type can express, or `undefined` for one nobody declared. */
export const adapterCapabilities = (
	type: string
): AdapterCapabilities | undefined => ADAPTER_MANIFEST[type]?.capabilities
