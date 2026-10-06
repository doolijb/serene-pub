/**
 * Flattens CONNECTION_TYPES (native adapters) and OPENAI_COMPATIBLE_PRESETS (all
 * backed by the generic OpenAI Chat adapter) into one list of pickable
 * "services" for the New Connection modal's searchable picker — so a user
 * looking for Groq/Mistral/DeepSeek/etc. sees them directly instead of
 * having to first guess that they live two levels deep under "OpenAI Chat".
 */
import { CONNECTION_TYPE, CONNECTION_TYPES } from "../constants/ConnectionTypes"
import { PRESET_CAPABILITIES } from "$lib/shared/connectionAdapters/manifest"
import { OPENAI_COMPATIBLE_PRESETS } from "./connectionDefaults"

export type ConnectionServiceCategory = "cloud" | "local" | "custom"

export interface ConnectionServiceItem {
	/** Unique across the whole flattened list — used as the collection's item value. */
	key: string
	label: string
	category: ConnectionServiceCategory
	/** The CONNECTION_TYPE value to store on the connection. */
	type: string
	/** Set only for OPENAI_COMPATIBLE_PRESETS-backed entries. */
	presetValue?: number
	/**
	 * The preset's capability slug, stored on the connection so the preset layer
	 * of capability resolution has something to key on. Absent for a native type
	 * and for the custom entry — absent means "custom", which is what a bare
	 * OpenAI-compatible URL genuinely is.
	 */
	presetSlug?: string
	difficulty: string
	description: string
	/**
	 * Model modality — drives the picker's modality button-group filter.
	 *
	 * An OPEN string, like `connections.modality` and `CONNECTION_TYPE.options`
	 * are: the group is built from `CONNECTION_SECTIONS`, so a new modality is
	 * one entry there and nothing here.
	 */
	modality: string
	/**
	 * Why this service can't be created here, as a sentence the card shows in
	 * place of its difficulty — the option stays listed, disabled, so a person
	 * looking for it learns why rather than finding nothing. Absent when it can
	 * be created. Only the local ONNX types set it today
	 * (`localOnnxDisabledReason`).
	 */
	disabledReason?: string
}

/**
 * Whether this machine can run local ONNX models: `systemSettings:get`'s
 * `localOnnxAvailability`, one verdict for both ONNX types because they load
 * one runtime. `reason` is a lower-case clause, null when available.
 */
export interface LocalOnnxAvailability {
	available: boolean
	reason: string | null
}

/** The connection types that run in this process on the ONNX runtime. */
const LOCAL_ONNX_SERVICE_TYPES: readonly string[] = [
	CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS,
	CONNECTION_TYPE.LOCAL_ONNX_NER
]

/**
 * The sentence every surface shows on a local ONNX option this machine can't
 * run — the picker's card, the finder's destination, Admin › Defaults, the
 * ONNX views — or null when it can.
 *
 * Settings not yet arrived read as available, the way `canRunLocalRuntimes`
 * reads them: the server refuses the action either way, and a flash of every
 * ONNX option disabled on a machine that runs them would be the wrong guess
 * far more often than the right one.
 */
export function localOnnxDisabledReason(
	availability: LocalOnnxAvailability | null | undefined
): string | null {
	if (!availability || availability.available) return null
	return `Not available on this machine: ${availability.reason ?? "the ONNX runtime didn't load"}`
}

/**
 * Why a connection of this type can't be created, or fetch a model, on this
 * machine — `localOnnxDisabledReason` for the local ONNX types, null for every
 * other type. The one question each surface that offers a type, or a model
 * download on a connection of one, asks before it offers it.
 */
export function connectionTypeDisabledReason(
	type: string | null | undefined,
	availability: LocalOnnxAvailability | null | undefined
): string | null {
	if (!type || !LOCAL_ONNX_SERVICE_TYPES.includes(type)) return null
	return localOnnxDisabledReason(availability)
}

/**
 * The connection types of KoboldCPP, run by Serene Pub.
 *
 * The managed endpoint is created FROM the managed KoboldCPP (Models tab → Use for chat
 * or Use for images), never from the generic New Connection picker, and is not
 * usable while the managed KoboldCPP is switched off. ⏳ Two ids until the boot fold has
 * retired `KOBOLDCPP_MANAGED_IMAGE`; a set, so every consumer asks of both.
 */
export const KOBOLDCPP_MANAGED_TYPES: readonly string[] = [
	CONNECTION_TYPE.KOBOLDCPP_MANAGED,
	CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE
]

export function isKoboldCppManagedType(
	type: string | null | undefined
): boolean {
	return !!type && KOBOLDCPP_MANAGED_TYPES.includes(type)
}

export const CATEGORY_ORDER: ConnectionServiceCategory[] = [
	"cloud",
	"local",
	"custom"
]

export const CATEGORY_LABELS: Record<ConnectionServiceCategory, string> = {
	cloud: "Cloud APIs",
	local: "Local / Self-hosted",
	custom: "Custom"
}

// Two OPENAI_COMPATIBLE_PRESETS entries share a name with a native adapter type
// that talks to the same underlying software via a different wire protocol
// (Ollama's/KoboldCPP's own native API vs. their OpenAI-compatible endpoint)
// — disambiguate just the picker label, not the preset's own `name` field
// (which connectionDefaults.test.ts and the existing preset <select> still
// key off of).
const PRESET_LABEL_OVERRIDES: Record<string, string> = {
	Ollama: "Ollama (via OpenAI-Compatible API)",
	KoboldCPP: "KoboldCPP (via OpenAI-Compatible API)"
}

export function buildConnectionServiceItems(
	opts: {
		/** This machine's local ONNX verdict; absent reads as available. */
		localOnnx?: LocalOnnxAvailability | null
	} = {}
): ConnectionServiceItem[] {
	const items: ConnectionServiceItem[] = []

	for (const t of CONNECTION_TYPES) {
		// Represented below by the "Empty" preset (identical connectionDefaults)
		// as the single "Custom (OpenAI-Compatible)" entry instead.
		if (t.value === CONNECTION_TYPE.OPENAI) continue
		// Connections of KoboldCPP, run by Serene Pub, are never manually created — they're
		// auto-created by koboldcpp:connectModel / koboldcpp:connectImageModel
		// when a model is activated from the page of KoboldCPP, run by Serene Pub
		// (src/lib/server/sockets/koboldcpp.ts), same reasoning
		// /document-view/connections/new already excludes them for.
		if (isKoboldCppManagedType(t.value)) continue
		// Merged into `ollama` (owner ruling 2026-09-25): one Ollama connection
		// per host serves every modality it has, and the boot sync renames any
		// old row. Its option entry stays so a straggler still has a label.
		if (t.value === CONNECTION_TYPE.OLLAMA_EMBEDDINGS) continue
		// Merged into `openai` the same way (owner ruling 2026-10-05).
		if (t.value === CONNECTION_TYPE.OPENAI_EMBEDDINGS) continue
		const disabledReason = connectionTypeDisabledReason(
			t.value,
			opts.localOnnx
		)
		items.push({
			key: `type:${t.value}`,
			label: t.label,
			category: t.category,
			type: t.value,
			difficulty: t.difficulty,
			description: t.description,
			modality: t.modality ?? "text-gen",
			...(disabledReason ? { disabledReason } : {})
		})
	}

	// Ollama under Embeddings too. The picker shows one section at a time and
	// Ollama's own entry files under text generation, so without this a person
	// who opened Embeddings to add Ollama would find nothing there. It creates the SAME plain `ollama`
	// connection; only the section it is listed under differs.
	//
	// ⚠ Its own key. Two items keyed `type:ollama` is the duplicate-key crash
	// an `{#each}` throws, whichever section renders them together.
	const ollamaType = CONNECTION_TYPES.find(
		(t) => t.value === CONNECTION_TYPE.OLLAMA
	)
	if (ollamaType)
		items.push({
			key: `type:${CONNECTION_TYPE.OLLAMA}@embeddings`,
			label: ollamaType.label,
			category: ollamaType.category,
			type: CONNECTION_TYPE.OLLAMA,
			difficulty: ollamaType.difficulty,
			description:
				"<p>Ollama's own embedding route, <b>POST /api/embed</b>, on the " +
				"same connection that serves chat — one per host.</p>" +
				"<p>Pull an embedding model (<code>ollama pull nomic-embed-text</code>) " +
				"and pick it. Ollama loads and unloads it for you.</p>",
			modality: "embeddings"
		})

	const openaiType = CONNECTION_TYPES.find(
		(t) => t.value === CONNECTION_TYPE.OPENAI
	)!

	for (const preset of OPENAI_COMPATIBLE_PRESETS) {
		const isCustom = preset.category === "custom"
		items.push({
			key: `preset:${preset.value}`,
			label: isCustom
				? "Custom (OpenAI-Compatible)"
				: (PRESET_LABEL_OVERRIDES[preset.name] ?? preset.name),
			category: preset.category as ConnectionServiceCategory,
			type: CONNECTION_TYPE.OPENAI,
			presetValue: preset.value,
			presetSlug: (preset as { slug?: string }).slug,
			difficulty: openaiType.difficulty,
			description: openaiType.description,
			// Every preset is listed under text generation; the ones that
			// also embed are listed again below.
			modality: "text-gen"
		})
	}

	// The presets whose service embeds, under Embeddings too — the way Ollama
	// is, and for the same reason: `openai-embeddings` merged into `openai`
	// (owner ruling 2026-10-05), so without these that section has no
	// OpenAI-compatible service at all. Each creates the SAME `openai`
	// connection with the same preset as its text generation entry; only the
	// section differs. Read from the manifest's preset layer, where
	// `"text->embedding": true` is the claim that the service serves
	// `/embeddings` — never a second list kept here. Pushed after the text
	// entries, so a lookup by type and preset finds those first.
	for (const preset of OPENAI_COMPATIBLE_PRESETS) {
		const slug = (preset as { slug?: string }).slug
		if (!slug || PRESET_CAPABILITIES[slug]?.["text->embedding"] !== true)
			continue
		items.push({
			// ⚠ Its own key, as Ollama's: `preset:<n>` is already taken.
			key: `preset:${preset.value}@embeddings`,
			label: PRESET_LABEL_OVERRIDES[preset.name] ?? preset.name,
			category: preset.category as ConnectionServiceCategory,
			type: CONNECTION_TYPE.OPENAI,
			presetValue: preset.value,
			presetSlug: slug,
			difficulty: openaiType.difficulty,
			description:
				"<p>The service's OpenAI-compatible embedding route, " +
				"<b>POST /embeddings</b>, on the same connection that serves " +
				"chat — one per service.</p>" +
				"<p>Pick one of its embedding models. Not every service's " +
				"model list says which models embed.</p>",
			modality: "embeddings"
		})
	}

	return items
}

/** Keep only the items for one modality — the picker's section toggle. */
export function filterConnectionServiceItemsByModality(
	items: ConnectionServiceItem[],
	modality: string
): ConnectionServiceItem[] {
	return items.filter((i) => i.modality === modality)
}

export interface ConnectionServiceGroup {
	category: ConnectionServiceCategory
	label: string
	items: ConnectionServiceItem[]
}

export function groupConnectionServiceItems(
	items: ConnectionServiceItem[]
): ConnectionServiceGroup[] {
	return CATEGORY_ORDER.map((category) => ({
		category,
		label: CATEGORY_LABELS[category],
		items: items
			.filter((i) => i.category === category)
			.sort((a, b) => a.label.localeCompare(b.label))
	})).filter((g) => g.items.length > 0)
}

export function filterConnectionServiceItems(
	items: ConnectionServiceItem[],
	query: string
): ConnectionServiceItem[] {
	const q = query.trim().toLowerCase()
	if (!q) return items
	return items.filter((i) => i.label.toLowerCase().includes(q))
}
