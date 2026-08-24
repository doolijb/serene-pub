/**
 * Flattens CONNECTION_TYPES (native adapters) and OPENAI_CHAT_PRESETS (all
 * backed by the generic OpenAI Session adapter) into one list of pickable
 * "services" for the New Connection modal's searchable picker — so a user
 * looking for Groq/Mistral/DeepSeek/etc. sees them directly instead of
 * having to first guess that they live two levels deep under "OpenAI Session".
 */
import { CONNECTION_TYPE, CONNECTION_TYPES } from "../constants/ConnectionTypes"
import { OPENAI_CHAT_PRESETS } from "./connectionDefaults"

export type ConnectionServiceCategory = "cloud" | "local" | "custom"

export interface ConnectionServiceItem {
	/** Unique across the whole flattened list — used as the collection's item value. */
	key: string
	label: string
	category: ConnectionServiceCategory
	/** The CONNECTION_TYPE value to store on the connection. */
	type: string
	/** Set only for OPENAI_CHAT_PRESETS-backed entries. */
	presetValue?: number
	difficulty: string
	description: string
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

// Two OPENAI_CHAT_PRESETS entries share a name with a native adapter type
// that talks to the same underlying software via a different wire protocol
// (Ollama's/KoboldCPP's own native API vs. their OpenAI-compatible endpoint)
// — disambiguate just the picker label, not the preset's own `name` field
// (which connectionDefaults.test.ts and the existing preset <select> still
// key off of).
const PRESET_LABEL_OVERRIDES: Record<string, string> = {
	Ollama: "Ollama (via OpenAI-Compatible API)",
	KoboldCPP: "KoboldCPP (via OpenAI-Compatible API)"
}

export function buildConnectionServiceItems(): ConnectionServiceItem[] {
	const items: ConnectionServiceItem[] = []

	for (const t of CONNECTION_TYPES) {
		// Represented below by the "Empty" preset (identical connectionDefaults)
		// as the single "Custom (OpenAI-Compatible)" entry instead.
		if (t.value === CONNECTION_TYPE.OPENAI_CHAT) continue
		// KoboldCPP Manager connections are never manually created — they're
		// auto-created by koboldcpp:connectModel when a model is activated
		// from the KoboldCPP Manager page (src/lib/server/sockets/koboldcpp.ts),
		// same reasoning /document-view/connections/new already excludes it for.
		if (t.value === CONNECTION_TYPE.KOBOLDCPP_MANAGED) continue
		items.push({
			key: `type:${t.value}`,
			label: t.label,
			category: t.category,
			type: t.value,
			difficulty: t.difficulty,
			description: t.description
		})
	}

	const openaiType = CONNECTION_TYPES.find(
		(t) => t.value === CONNECTION_TYPE.OPENAI_CHAT
	)!

	for (const preset of OPENAI_CHAT_PRESETS) {
		const isCustom = preset.category === "custom"
		items.push({
			key: `preset:${preset.value}`,
			label: isCustom
				? "Custom (OpenAI-Compatible)"
				: (PRESET_LABEL_OVERRIDES[preset.name] ?? preset.name),
			category: preset.category as ConnectionServiceCategory,
			type: CONNECTION_TYPE.OPENAI_CHAT,
			presetValue: preset.value,
			difficulty: openaiType.difficulty,
			description: openaiType.description
		})
	}

	return items
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
