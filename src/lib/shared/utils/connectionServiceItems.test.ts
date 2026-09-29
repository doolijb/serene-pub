import { describe, expect, test } from "vitest"
import {
	buildConnectionServiceItems,
	groupConnectionServiceItems,
	filterConnectionServiceItems,
	isKoboldCppManagedType,
	CATEGORY_ORDER,
	KOBOLDCPP_MANAGED_TYPES
} from "./connectionServiceItems"
import { CONNECTION_TYPE, CONNECTION_TYPES } from "../constants/ConnectionTypes"
import { OPENAI_COMPATIBLE_PRESETS } from "./connectionDefaults"

describe("buildConnectionServiceItems", () => {
	const items = buildConnectionServiceItems()

	test("has one item per native type (except OPENAI and the managed types) plus one per preset", () => {
		const expectedCount =
			CONNECTION_TYPES.length -
			1 -
			KOBOLDCPP_MANAGED_TYPES.length +
			OPENAI_COMPATIBLE_PRESETS.length
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
			expect(labels.has(item.label), `${item.label} in ${bucket}`).toBe(false)
			labels.add(item.label)
			seen.set(bucket, labels)
		}
	})

	test("Ollama is offered under Embeddings, and creates the same plain connection", () => {
		// One Ollama connection per host serves every modality it has, so the
		// type that used to answer under Embeddings is gone — and without this
		// entry that section would have no Ollama at all.
		const embed = items.find(
			(i) => i.type === CONNECTION_TYPE.OLLAMA && i.modality === "embeddings"
		)
		expect(embed).toBeDefined()
		expect(embed!.presetValue).toBeUndefined()
		// Its own key: a duplicate `type:ollama` is a duplicate-key crash.
		expect(embed!.key).not.toBe(`type:${CONNECTION_TYPE.OLLAMA}`)
		expect(new Set(items.map((i) => i.key)).size).toBe(items.length)
	})

	test("the merged ollama-embeddings type is never offered", () => {
		expect(
			items.find((i) => i.type === CONNECTION_TYPE.OLLAMA_EMBEDDINGS)
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
				// Merged into `ollama` (2026-09-25): never created by hand, for
				// the same reason the managed types above are not.
				t.value === CONNECTION_TYPE.OLLAMA_EMBEDDINGS
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
		const result = filterConnectionServiceItems(items, "experimental")
		// All 11 new presets carry the "(Experimental)" suffix.
		expect(result.length).toBe(11)
	})
})
