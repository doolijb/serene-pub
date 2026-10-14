import { describe, expect, test } from "vitest"
import {
	buildConnectionServiceItems,
	groupConnectionServiceItems,
	filterConnectionServiceItems,
	isKoboldCppManagedType,
	connectionTypeDisabledReason,
	localOnnxDisabledReason,
	presetKeyUrl,
	serviceSetupNeed,
	CATEGORY_ORDER,
	CUSTOM_SERVICE_LABEL,
	KOBOLDCPP_MANAGED_TYPES,
	SETUP_NEED_LABELS
} from "./connectionServiceItems"
import { CONNECTION_TYPE, CONNECTION_TYPES } from "../constants/ConnectionTypes"
import { OPENAI_COMPATIBLE_PRESETS } from "./connectionDefaults"
import { PRESET_CAPABILITIES } from "$lib/shared/connectionAdapters/manifest"
import { credentialPolicy } from "../connections/credentials"

/** The presets whose service the manifest says embeds. */
const EMBEDDING_PRESETS = OPENAI_COMPATIBLE_PRESETS.filter(
	(p) =>
		PRESET_CAPABILITIES[(p as { slug?: string }).slug ?? ""]?.[
			"text->embedding"
		] === true
)
/** The presets whose service draws — listed again under Images. */
const IMAGE_PRESETS = OPENAI_COMPATIBLE_PRESETS.filter(
	(p) =>
		PRESET_CAPABILITIES[(p as { slug?: string }).slug ?? ""]?.[
			"text->image"
		] === true
)

describe("buildConnectionServiceItems", () => {
	const items = buildConnectionServiceItems()

	test("has one item per native type (except OPENAI, the managed types and the two merged embedding types) plus one per preset, plus Ollama and the embedding presets under Embeddings, plus the drawing presets under Images", () => {
		const expectedCount =
			CONNECTION_TYPES.length -
			1 -
			KOBOLDCPP_MANAGED_TYPES.length -
			2 +
			OPENAI_COMPATIBLE_PRESETS.length +
			1 +
			EMBEDDING_PRESETS.length +
			IMAGE_PRESETS.length
		expect(items.length).toBe(expectedCount)
	})

	// Both of them, not just the text one. A manually-created managed image
	// connection would look plausible in the picker and then fail at render
	// time with a base URL and a model the managed KoboldCPP never agreed to — the
	// the managed KoboldCPP is the only thing that knows which files are actually on disk.
	test("neither managed KoboldCPP type is manually creatable — both are made by Add → KoboldCPP, run by Serene Pub", () => {
		expect(
			items.find((i) => i.type === CONNECTION_TYPE.KOBOLDCPP_MANAGED)
		).toBeUndefined()
		expect(
			items.find(
				(i) => i.type === CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE
			)
		).toBeUndefined()
		expect(
			items.find((i) => isKoboldCppManagedType(i.type))
		).toBeUndefined()
	})

	test("every item has a unique key", () => {
		const keys = items.map((i) => i.key)
		expect(new Set(keys).size).toBe(keys.length)
	})

	test("no two items in the same category share a label (picker must disambiguate collisions)", () => {
		// Keyed by SECTION as well as category, because the picker never shows
		// two sections at once: `ConnectionServicePicker` always holds a
		// modality (defaulting to text generation) and filters by it before it
		// groups. So a type listed under two sections — Ollama under text AND
		// embeddings (owner ruling 2026-09-25) — shares a label with itself
		// without the two ever being on screen together. Two items in ONE
		// section with one label would still be indistinguishable, and still fail.
		const seen = new Map<string, Set<string>>()
		for (const item of items) {
			const bucket = `${item.category}::${item.modality}`
			const labels = seen.get(bucket) ?? new Set<string>()
			expect(labels.has(item.label), `${item.label} in ${bucket}`).toBe(
				false
			)
			labels.add(item.label)
			seen.set(bucket, labels)
		}
	})

	test("Ollama is offered under Embeddings, and creates the same plain connection", () => {
		// One Ollama connection per host serves every modality it has, so the
		// type that used to answer under Embeddings is gone — and without this
		// entry that section would have no Ollama at all.
		const embed = items.find(
			(i) =>
				i.type === CONNECTION_TYPE.OLLAMA && i.modality === "embeddings"
		)
		expect(embed).toBeDefined()
		expect(embed!.presetValue).toBeUndefined()
		// Its own key: a duplicate `type:ollama` is a duplicate-key crash.
		expect(embed!.key).not.toBe(`type:${CONNECTION_TYPE.OLLAMA}`)
		expect(new Set(items.map((i) => i.key)).size).toBe(items.length)
	})

	test("the presets that embed are offered under Embeddings, each creating its own openai connection", () => {
		// `openai-embeddings` merged into `openai` (owner ruling 2026-10-05),
		// so these are that section's OpenAI-compatible services. The list is
		// the manifest's preset layer, never a second copy.
		expect(
			EMBEDDING_PRESETS.map((p) => (p as { slug?: string }).slug).sort()
		).toEqual(
			[
				"google-gemini",
				"local-ai",
				"mistral-ai",
				"openai-official",
				"openrouter",
				"together-ai"
			].sort()
		)
		const embeddings = items.filter(
			(i) =>
				i.modality === "embeddings" && i.type === CONNECTION_TYPE.OPENAI
		)
		expect(embeddings.map((i) => i.presetValue).sort()).toEqual(
			EMBEDDING_PRESETS.map((p) => p.value).sort()
		)
		for (const preset of EMBEDDING_PRESETS) {
			const embed = embeddings.find(
				(i) => i.presetValue === preset.value
			)!
			const text = items.find((i) => i.key === `preset:${preset.value}`)!
			// The SAME connection as the text entry: type, preset, slug.
			expect(embed.type).toBe(text.type)
			expect(embed.presetSlug).toBe(text.presetSlug)
			expect(embed.label).toBe(text.label)
			expect(embed.category).toBe(text.category)
			// Its own key: a duplicate `preset:<n>` is a duplicate-key crash.
			expect(embed.key).not.toBe(text.key)
		}
		// A lookup by type and preset finds the text entry first.
		for (const preset of EMBEDDING_PRESETS)
			expect(
				items.find(
					(i) =>
						i.type === CONNECTION_TYPE.OPENAI &&
						i.presetValue === preset.value
				)!.modality
			).toBe("text-gen")
	})

	test("a preset whose service doesn't embed is not offered under Embeddings", () => {
		for (const slug of ["groq", "deepseek", "vllm"]) {
			const preset = OPENAI_COMPATIBLE_PRESETS.find(
				(p) => (p as { slug?: string }).slug === slug
			)!
			expect(
				items
					.filter((i) => i.presetValue === preset.value)
					.map((i) => i.modality),
				slug
			).toEqual(["text-gen"])
		}
		// Nor the custom entry: the format can't tell whether an endpoint
		// embeds, so the generic type leaves it off.
		expect(
			items.filter((i) => i.presetValue === 0).map((i) => i.modality)
		).toEqual(["text-gen"])
	})

	test("the merged ollama-embeddings type is never offered", () => {
		expect(
			items.find((i) => i.type === CONNECTION_TYPE.OLLAMA_EMBEDDINGS)
		).toBeUndefined()
	})

	test("the merged openai-embeddings type is never offered", () => {
		// Merged into `openai` (owner ruling 2026-10-05); an OpenAI-compatible
		// service embeds from its one `openai` connection.
		expect(
			items.find((i) => i.type === CONNECTION_TYPE.OPENAI_EMBEDDINGS)
		).toBeUndefined()
	})

	test("the bare OPENAI type is not present on its own — represented via the Empty preset", () => {
		expect(
			items.find(
				(i) =>
					i.type === CONNECTION_TYPE.OPENAI &&
					i.presetValue === undefined
			)
		).toBeUndefined()
	})

	test("the Empty preset becomes a single 'Custom (OpenAI-Compatible)' entry", () => {
		const custom = items.find((i) => i.category === "custom")
		expect(custom).toBeDefined()
		expect(custom!.label).toBe("Custom (OpenAI-Compatible)")
		expect(custom!.type).toBe(CONNECTION_TYPE.OPENAI)
		expect(custom!.presetValue).toBe(0)
	})

	test("every native adapter type (other than OPENAI and the managed types) is present with type === its own value and no presetValue", () => {
		for (const t of CONNECTION_TYPES) {
			if (
				t.value === CONNECTION_TYPE.OPENAI ||
				isKoboldCppManagedType(t.value) ||
				// Merged into `ollama` (2026-09-25) and `openai` (2026-10-05):
				// never created by hand, for the same reason the managed types
				// above are not.
				t.value === CONNECTION_TYPE.OLLAMA_EMBEDDINGS ||
				t.value === CONNECTION_TYPE.OPENAI_EMBEDDINGS
			)
				continue
			const item = items.find((i) => i.key === `type:${t.value}`)
			expect(item).toBeDefined()
			expect(item!.type).toBe(t.value)
			expect(item!.presetValue).toBeUndefined()
			expect(item!.category).toBe(t.category)
		}
	})

	test("every non-Empty preset is present with type === OPENAI and its own presetValue", () => {
		for (const preset of OPENAI_COMPATIBLE_PRESETS) {
			if (preset.value === 0) continue
			const item = items.find((i) => i.key === `preset:${preset.value}`)
			expect(item).toBeDefined()
			expect(item!.type).toBe(CONNECTION_TYPE.OPENAI)
			expect(item!.presetValue).toBe(preset.value)
		}
	})

	test("the two name-colliding presets (Ollama, KoboldCPP) get a disambiguated label distinct from their native counterpart", () => {
		const nativeOllama = items.find(
			(i) => i.key === `type:${CONNECTION_TYPE.OLLAMA}`
		)!
		const presetOllama = items.find(
			(i) => i.label.startsWith("Ollama") && i.presetValue !== undefined
		)!
		expect(presetOllama.label).not.toBe(nativeOllama.label)

		const nativeKobold = items.find(
			(i) => i.key === `type:${CONNECTION_TYPE.KOBOLDCPP}`
		)!
		const presetKobold = items.find(
			(i) =>
				i.label.startsWith("KoboldCPP") && i.presetValue !== undefined
		)!
		expect(presetKobold.label).not.toBe(nativeKobold.label)
	})
})

describe("groupConnectionServiceItems", () => {
	test("groups follow CATEGORY_ORDER and omit empty categories", () => {
		const groups = groupConnectionServiceItems(
			buildConnectionServiceItems()
		)
		const orderIndexes = groups.map((g) =>
			CATEGORY_ORDER.indexOf(g.category)
		)
		expect(orderIndexes).toEqual([...orderIndexes].sort((a, b) => a - b))
		for (const g of groups) expect(g.items.length).toBeGreaterThan(0)
	})

	test("items within a group are sorted alphabetically by label", () => {
		const groups = groupConnectionServiceItems(
			buildConnectionServiceItems()
		)
		for (const g of groups) {
			const labels = g.items.map((i) => i.label)
			expect(labels).toEqual(
				[...labels].sort((a, b) => a.localeCompare(b))
			)
		}
	})

	test("an empty input list produces no groups", () => {
		expect(groupConnectionServiceItems([])).toEqual([])
	})
})

describe("filterConnectionServiceItems", () => {
	const items = buildConnectionServiceItems()

	test("empty query returns every item unchanged", () => {
		expect(filterConnectionServiceItems(items, "")).toEqual(items)
		expect(filterConnectionServiceItems(items, "   ")).toEqual(items)
	})

	test("filters case-insensitively by substring", () => {
		const result = filterConnectionServiceItems(items, "groq")
		expect(result.length).toBe(1)
		expect(result[0].label).toBe("Groq")

		const upper = filterConnectionServiceItems(items, "GROQ")
		expect(upper).toEqual(result)
	})

	test("a query matching nothing returns an empty array", () => {
		expect(
			filterConnectionServiceItems(items, "totally-not-a-service")
		).toEqual([])
	})

	test("a substring match finds services regardless of position in the label", () => {
		const result = filterConnectionServiceItems(
			items.filter((i) => i.modality === "text-gen"),
			"experimental"
		)
		// All 11 new presets carry the "(Experimental)" suffix. Counted in
		// text generation: Mistral and Gemini are listed again under
		// Embeddings.
		expect(result.length).toBe(11)
	})
})

describe("local ONNX types on a machine that can't run them", () => {
	const ONNX = [
		CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS,
		CONNECTION_TYPE.LOCAL_ONNX_NER
	]
	const verdict = {
		available: false,
		reason: "the Android app can't run the ONNX runtime"
	}

	test("are still listed, each disabled with the machine's reason", () => {
		const items = buildConnectionServiceItems({ localOnnx: verdict })
		for (const type of ONNX) {
			const item = items.find((i) => i.type === type)
			// Listed, not hidden: a missing option reads as "not built".
			expect(item, type).toBeDefined()
			expect(item!.disabledReason).toBe(
				"Not available on this machine: the Android app can't run the ONNX runtime"
			)
		}
	})

	test("disable nothing else", () => {
		const items = buildConnectionServiceItems({ localOnnx: verdict })
		const disabled = items.filter((i) => i.disabledReason)
		expect(disabled.map((i) => i.type).sort()).toEqual([...ONNX].sort())
	})

	test("a machine that runs them, or settings not yet arrived, disables none", () => {
		for (const localOnnx of [
			{ available: true, reason: null },
			null,
			undefined
		]) {
			const items = buildConnectionServiceItems({ localOnnx })
			expect(items.some((i) => i.disabledReason)).toBe(false)
		}
		expect(
			buildConnectionServiceItems().some((i) => i.disabledReason)
		).toBe(false)
	})

	test("the sentence still reads when the server sent no reason", () => {
		expect(
			localOnnxDisabledReason({ available: false, reason: null })
		).toBe("Not available on this machine: the ONNX runtime didn't load")
		expect(localOnnxDisabledReason({ available: true, reason: null })).toBe(
			null
		)
	})

	test("asked by type: the ONNX types answer with the reason, others never", () => {
		for (const type of ONNX)
			expect(connectionTypeDisabledReason(type, verdict)).toBe(
				"Not available on this machine: the Android app can't run the ONNX runtime"
			)
		for (const type of [
			CONNECTION_TYPE.OLLAMA,
			CONNECTION_TYPE.OPENAI,
			null,
			undefined
		])
			expect(connectionTypeDisabledReason(type, verdict)).toBe(null)
		for (const type of ONNX) {
			expect(
				connectionTypeDisabledReason(type, {
					available: true,
					reason: null
				})
			).toBe(null)
			expect(connectionTypeDisabledReason(type, undefined)).toBe(null)
		}
	})
})

/**
 * The New connection dialog describes the service you picked (plan
 * 2026-10-06 §D). Every OpenAI-compatible preset used to inherit OpenAI
 * Chat's description, so OpenRouter sent people to OpenAI's website for a key.
 */
describe("what each service asks of the person", () => {
	const items = buildConnectionServiceItems()
	const byKey = (key: string) => items.find((i) => i.key === key)!
	const presetItem = (name: string) => {
		const preset = OPENAI_COMPATIBLE_PRESETS.find((p) => p.name === name)!
		return { preset, item: byKey(`preset:${preset.value}`) }
	}
	const openaiDescription = CONNECTION_TYPES.find(
		(t) => t.value === CONNECTION_TYPE.OPENAI
	)!.description

	test("no preset inherits OpenAI Chat's description", () => {
		for (const item of items.filter((i) => i.presetValue !== undefined)) {
			expect(item.description, item.label).not.toBe(openaiDescription)
			expect(item.description, item.label).not.toContain(
				"OpenAI's website"
			)
		}
	})

	test("a keyed preset says who hands out the key, and links there", () => {
		const { item } = presetItem("OpenRouter")
		expect(item.setupNeed).toBe("key")
		expect(item.description).toBe(
			'<p>OpenRouter — needs an API key from <a class="anchor" ' +
				'href="https://openrouter.ai/keys" target="_blank" ' +
				'rel="noopener noreferrer">openrouter.ai</a></p>'
		)
	})

	test("every keyed preset in the list has a key page — a slug added later can't lose its link quietly", () => {
		for (const preset of OPENAI_COMPATIBLE_PRESETS) {
			const item = byKey(`preset:${preset.value}`)
			if (item.setupNeed !== "key") continue
			const url = presetKeyUrl(preset)
			expect(url, preset.name).toMatch(/^https:\/\//)
			expect(item.description, preset.name).toContain(`href="${url}"`)
			expect(
				item.description.startsWith(
					`<p>${item.label} — needs an API key from <a `
				),
				preset.name
			).toBe(true)
		}
	})

	test("every keyed preset carries a slug that finds its key page", () => {
		for (const preset of OPENAI_COMPATIBLE_PRESETS) {
			if (presetItem(preset.name).item.setupNeed !== "key") continue
			expect((preset as { slug?: string }).slug, preset.name).toBeTruthy()
			expect(presetKeyUrl(preset), preset.name).toMatch(/^https:\/\//)
		}
		for (const [name, url] of [
			["DeepInfra", "https://deepinfra.com/dash/api_keys"],
			["Perplexity AI", "https://console.perplexity.ai/"],
			["xAI Grok (Experimental)", "https://console.x.ai/"],
			["Cohere (Experimental)", "https://dashboard.cohere.com/api-keys"],
			["AnyScale", "https://www.anyscale.com/"]
		] as const)
			expect(presetKeyUrl(presetItem(name).preset), name).toBe(url)
		// The link names the page it opens, without the www.
		expect(presetItem("AnyScale").item.description).toContain(
			">anyscale.com</a>"
		)
	})

	test("a local preset runs on the person's machine and needs no key", () => {
		for (const name of ["vLLM (Experimental)", "LocalAI", "Ollama"]) {
			const { item } = presetItem(name)
			expect(item.setupNeed, name).toBe("local")
			expect(item.description, name).toBe(
				"<p>Runs on your own machine · no key</p>"
			)
		}
	})

	test("the custom entry asks for an address only", () => {
		const custom = byKey("preset:0")
		expect(custom.label).toBe(CUSTOM_SERVICE_LABEL)
		expect(custom.setupNeed).toBe("address")
		expect(custom.description).toBe(
			"<p>Any OpenAI-compatible server · paste its address, and a key only if it asks for one</p>"
		)
	})

	test("an embeddings entry opens with the same line as its text entry", () => {
		for (const item of items.filter(
			(i) => i.presetValue !== undefined && i.modality === "embeddings"
		)) {
			const text = byKey(`preset:${item.presetValue}`)
			expect(item.setupNeed).toBe(text.setupNeed)
			expect(
				item.description.startsWith(text.description),
				item.label
			).toBe(true)
		}
	})

	test("native types: keyed, local, from credentialPolicy and the category", () => {
		expect(byKey(`type:${CONNECTION_TYPE.ANTHROPIC}`).setupNeed).toBe("key")
		for (const type of [
			CONNECTION_TYPE.OLLAMA,
			CONNECTION_TYPE.LM_STUDIO,
			CONNECTION_TYPE.LLAMACPP,
			CONNECTION_TYPE.KOBOLDCPP,
			CONNECTION_TYPE.A1111,
			CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS,
			CONNECTION_TYPE.LOCAL_ONNX_NER
		])
			expect(byKey(`type:${type}`).setupNeed, type).toBe("local")
		// A native type keeps its own prose.
		expect(byKey(`type:${CONNECTION_TYPE.OLLAMA}`).description).toBe(
			CONNECTION_TYPES.find((t) => t.value === CONNECTION_TYPE.OLLAMA)!
				.description
		)
	})

	test("the chip and the index agree: Needs an API key exactly when a key is required", () => {
		for (const item of items) {
			const preset = OPENAI_COMPATIBLE_PRESETS.find(
				(p) => p.value === item.presetValue
			)
			const required =
				credentialPolicy({
					type: item.type,
					preset: item.presetSlug,
					baseUrl: preset?.connectionDefaults.baseUrl
				}) === "required"
			expect(item.setupNeed === "key", item.key).toBe(required)
		}
	})

	test("a cloud service that may take a key but needn't is address only", () => {
		expect(
			serviceSetupNeed({
				type: CONNECTION_TYPE.OPENAI,
				baseUrl: "http://192.168.1.20:8000/v1",
				category: "cloud"
			})
		).toBe("address")
	})

	test("the chips read as the plan names them", () => {
		expect(SETUP_NEED_LABELS).toEqual({
			key: "Needs an API key",
			local: "Runs locally",
			address: "Address only",
			free: "Free · queued"
		})
	})

	test("AI Horde is free and queued; NovelAI and BFL need a key", () => {
		const need = (type: string) => items.find((i) => i.type === type)?.setupNeed
		expect(need(CONNECTION_TYPE.HORDE)).toBe("free")
		expect(need(CONNECTION_TYPE.NOVELAI)).toBe("key")
		expect(need(CONNECTION_TYPE.BFL)).toBe("key")
	})

	test("the presets that draw are listed under Images too", () => {
		const gemini = items.find(
			(i) => i.presetSlug === "google-gemini" && i.modality === "image-gen"
		)
		expect(gemini?.type).toBe(CONNECTION_TYPE.OPENAI)
	})

	test("no item carries a difficulty any more", () => {
		for (const item of items) expect(item).not.toHaveProperty("difficulty")
	})
})
