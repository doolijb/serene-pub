import { describe, expect, test } from "vitest"
import {
	assignCallMedia,
	missingKeys,
	planImageCalls,
	sanitiseSeriesKeys,
	type RenderedSeriesItem
} from "./packing"
import { A1111_SHEET, KOBOLDCPP_SHEET } from "$lib/server/imageAdapters/A1111Adapter"
import type { DrawingSheet } from "$lib/shared/imageGen/types"

/**
 * The host's packing (DESIGN-image-generation §4.7): a series becomes calls by
 * the sheet, never by the spec, and keys come from the plan, never from the
 * pixels (§4.11).
 */

const sheet = (perCall: number): DrawingSheet => ({ ...A1111_SHEET, perCall })
const item = (key: string, prompt = `a ${key} face`): RenderedSeriesItem => ({
	key,
	label: key,
	prompt
})
const same = (n: number) =>
	Array.from({ length: n }, (_, i) => item(String(i + 1), "a portrait"))

describe("planImageCalls", () => {
	test("different prompts loop: one call per item", () => {
		const plan = planImageCalls([item("joy"), item("anger"), item("calm")], sheet(8))
		expect(plan.packing).toBe("loop")
		expect(plan.pictures).toBe(3)
		expect(plan.calls.map((c) => [c.keys, c.count])).toEqual([
			[["joy"], 1],
			[["anger"], 1],
			[["calm"], 1]
		])
	})

	test("identical prompts batch into one call when perCall covers them", () => {
		const plan = planImageCalls(same(4), sheet(8))
		expect(plan.packing).toBe("batch")
		expect(plan.calls).toEqual([{ index: 0, keys: ["1", "2", "3", "4"], count: 4 }])
	})

	test("identical prompts above perCall split into perCall-sized calls", () => {
		const plan = planImageCalls(same(10), sheet(4))
		expect(plan.packing).toBe("batch")
		expect(plan.calls.map((c) => c.count)).toEqual([4, 4, 2])
		expect(plan.calls[2]!.keys).toEqual(["9", "10"])
	})

	test("perCall 1 (KoboldCPP) loops even identical prompts", () => {
		const plan = planImageCalls(same(3), KOBOLDCPP_SHEET)
		expect(plan.packing).toBe("loop")
		expect(plan.calls).toHaveLength(3)
		expect(plan.calls.every((c) => c.count === 1)).toBe(true)
	})

	test("a different negative breaks the batch", () => {
		const items = same(2)
		items[1] = { ...items[1]!, negative: "blurry" }
		expect(planImageCalls(items, sheet(8)).packing).toBe("loop")
	})

	test("one item is one loop call", () => {
		const plan = planImageCalls([item("1")], sheet(8))
		expect(plan.packing).toBe("loop")
		expect(plan.calls).toHaveLength(1)
	})

	test("the keyed-graph seam is asked first, and null falls through", () => {
		const asked: string[][] = []
		const nullAdapter = {
			packKeyedGraph: (items: readonly RenderedSeriesItem[]) => {
				asked.push(items.map((i) => i.key))
				return null
			}
		}
		const plan = planImageCalls([item("joy"), item("anger")], sheet(8), nullAdapter)
		expect(asked).toEqual([["joy", "anger"]])
		expect(plan.packing).toBe("loop")

		const graph = {
			packKeyedGraph: (items: readonly RenderedSeriesItem[]) => [
				{ index: 0, keys: items.map((i) => i.key), count: items.length }
			]
		}
		const keyed = planImageCalls([item("joy"), item("anger")], sheet(1), graph)
		expect(keyed.packing).toBe("keyed-graph")
		expect(keyed.calls).toHaveLength(1)
	})
})

describe("keying what comes back", () => {
	test("surplus inside a one-key call is variants of that key", () => {
		expect(assignCallMedia({ keys: ["joy"] }, 3)).toEqual(["joy", "joy", "joy"])
	})

	test("a batch call keys by order; surplus past the last key is unkeyed", () => {
		expect(assignCallMedia({ keys: ["1", "2"] }, 4)).toEqual(["1", "2", null, null])
	})

	test("a short batch keys what it has, in order", () => {
		expect(assignCallMedia({ keys: ["1", "2", "3"] }, 2)).toEqual(["1", "2"])
	})

	test("shortfall is reported per missing key", () => {
		const items = [item("joy"), item("anger"), item("calm")]
		const got = new Map([
			["joy", 2],
			["calm", 1]
		])
		expect(missingKeys(items, got)).toEqual([{ key: "anger", wanted: 1, got: 0 }])
	})

	test("a key wanted several times counts each", () => {
		const items = [item("1"), item("1"), item("1")]
		expect(missingKeys(items, new Map([["1", 1]]))).toEqual([
			{ key: "1", wanted: 3, got: 1 }
		])
	})
})

describe("sanitiseSeriesKeys", () => {
	test("trims, case-folds, dashes spaces, drops unsafe characters, suffixes collisions", () => {
		expect(
			sanitiseSeriesKeys([" Joy ", "Very Angry!", "joy", "JOY", "été", "../x", ""])
		).toEqual(["joy", "very-angry", "joy-2", "joy-3", "t", "x", "7"])
	})
})
