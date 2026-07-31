import { describe, expect, test } from "vitest"
import {
	buildConnectionServiceItems,
	groupConnectionServiceItems,
	filterConnectionServiceItems,
	CATEGORY_ORDER
} from "./connectionServiceItems"
import { CONNECTION_TYPE, CONNECTION_TYPES } from "../constants/ConnectionTypes"
import { OPENAI_CHAT_PRESETS } from "./connectionDefaults"

describe("buildConnectionServiceItems", () => {
	const items = buildConnectionServiceItems()

	test("has one item per native type (except OPENAI_CHAT and KOBOLDCPP_MANAGED) plus one per preset", () => {
		const expectedCount =
			(CONNECTION_TYPES.length - 2) + OPENAI_CHAT_PRESETS.length
		expect(items.length).toBe(expectedCount)
	})

	test("KoboldCPP Manager is never manually creatable — it's auto-created from the Manager page", () => {
		expect(
			items.find((i) => i.type === CONNECTION_TYPE.KOBOLDCPP_MANAGED)
		).toBeUndefined()
	})

	test("every item has a unique key", () => {
		const keys = items.map((i) => i.key)
		expect(new Set(keys).size).toBe(keys.length)
	})

	test("no two items in the same category share a label (picker must disambiguate collisions)", () => {
		const seen = new Map<string, Set<string>>()
		for (const item of items) {
			const labels = seen.get(item.category) ?? new Set<string>()
			expect(labels.has(item.label)).toBe(false)
			labels.add(item.label)
			seen.set(item.category, labels)
		}
	})

	test("the bare OPENAI_CHAT type is not present on its own — represented via the Empty preset", () => {
		expect(
			items.find(
				(i) => i.type === CONNECTION_TYPE.OPENAI_CHAT && i.presetValue === undefined
			)
		).toBeUndefined()
	})

	test("the Empty preset becomes a single 'Custom (OpenAI-Compatible)' entry", () => {
		const custom = items.find((i) => i.category === "custom")
		expect(custom).toBeDefined()
		expect(custom!.label).toBe("Custom (OpenAI-Compatible)")
		expect(custom!.type).toBe(CONNECTION_TYPE.OPENAI_CHAT)
		expect(custom!.presetValue).toBe(0)
	})

	test("every native adapter type (other than OPENAI_CHAT and KOBOLDCPP_MANAGED) is present with type === its own value and no presetValue", () => {
		for (const t of CONNECTION_TYPES) {
			if (
				t.value === CONNECTION_TYPE.OPENAI_CHAT ||
				t.value === CONNECTION_TYPE.KOBOLDCPP_MANAGED
			)
				continue
			const item = items.find((i) => i.key === `type:${t.value}`)
			expect(item).toBeDefined()
			expect(item!.type).toBe(t.value)
			expect(item!.presetValue).toBeUndefined()
			expect(item!.category).toBe(t.category)
		}
	})

	test("every non-Empty preset is present with type === OPENAI_CHAT and its own presetValue", () => {
		for (const preset of OPENAI_CHAT_PRESETS) {
			if (preset.value === 0) continue
			const item = items.find((i) => i.key === `preset:${preset.value}`)
			expect(item).toBeDefined()
			expect(item!.type).toBe(CONNECTION_TYPE.OPENAI_CHAT)
			expect(item!.presetValue).toBe(preset.value)
		}
	})

	test("the two name-colliding presets (Ollama, KoboldCPP) get a disambiguated label distinct from their native counterpart", () => {
		const nativeOllama = items.find((i) => i.key === `type:${CONNECTION_TYPE.OLLAMA}`)!
		const presetOllama = items.find((i) => i.label.startsWith("Ollama") && i.presetValue !== undefined)!
		expect(presetOllama.label).not.toBe(nativeOllama.label)

		const nativeKobold = items.find((i) => i.key === `type:${CONNECTION_TYPE.KOBOLDCPP}`)!
		const presetKobold = items.find((i) => i.label.startsWith("KoboldCPP") && i.presetValue !== undefined)!
		expect(presetKobold.label).not.toBe(nativeKobold.label)
	})
})

describe("groupConnectionServiceItems", () => {
	test("groups follow CATEGORY_ORDER and omit empty categories", () => {
		const groups = groupConnectionServiceItems(buildConnectionServiceItems())
		const orderIndexes = groups.map((g) => CATEGORY_ORDER.indexOf(g.category))
		expect(orderIndexes).toEqual([...orderIndexes].sort((a, b) => a - b))
		for (const g of groups) expect(g.items.length).toBeGreaterThan(0)
	})

	test("items within a group are sorted alphabetically by label", () => {
		const groups = groupConnectionServiceItems(buildConnectionServiceItems())
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
		expect(filterConnectionServiceItems(items, "totally-not-a-provider")).toEqual([])
	})

	test("a substring match finds providers regardless of position in the label", () => {
		const result = filterConnectionServiceItems(items, "experimental")
		// All 11 new presets carry the "(Experimental)" suffix.
		expect(result.length).toBe(11)
	})
})
