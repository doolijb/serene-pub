import { describe, expect, test } from "vitest"
import {
	groupLoadouts,
	ledgerRows,
	loadoutTile,
	replyStrip,
	tileLabel
} from "./loadoutsGrid"
import { summary } from "./loadoutFixtures"

const TRANSFORMS = [
	{ id: "text->text", label: "Chat", output: "text", defaultLoadoutId: 1 },
	{ id: "text->image", label: "Images", output: "image", defaultLoadoutId: null },
	{ id: "text->embedding", label: "Embeddings", output: "embedding", defaultLoadoutId: 9 }
]

describe("a tile's words", () => {
	test("a filled loadout names its pair, sampling and consequence", () => {
		const t = loadoutTile(
			summary({
				filled: true,
				modelName: "Nemo 12B",
				connectionName: "KoboldCPP",
				samplingName: "Default",
				consequence: "JSON by instruction (no schema door)",
				defaultFor: "text->text"
			})
		)
		expect(t.pair).toBe("Nemo 12B on KoboldCPP")
		expect(t.sampling).toBe("Default")
		expect(t.consequence).toBe("JSON by instruction (no schema door)")
		expect(t.isDefault).toBe(true)
		expect(tileLabel(t)).toBe("Open Reply, the default, Nemo 12B on KoboldCPP")
	})

	test("an unfilled one falls back, and says it once", () => {
		const t = loadoutTile(
			summary({
				id: 2,
				name: "Tool calling",
				fallbackName: "Reply",
				consequence: "Unfilled — falls back to Reply"
			})
		)
		expect(t.pair).toBe("Unfilled — falls back to Reply")
		expect(t.consequence).toBeNull()
	})

	test("the chip: merged first, else a plugin owner", () => {
		expect(
			loadoutTile(summary({ mergedInto: 1, mergedIntoName: "Reply" })).chip
		).toBe("merged into Reply")
		expect(loadoutTile(summary({ owner: "acme.rp" })).chip).toBe("acme.rp")
		expect(loadoutTile(summary({ owner: "pub" })).chip).toBeNull()
	})

	test("a plugin switched off keeps its loadout, chipped plugin off", () => {
		expect(loadoutTile(summary({ owner: "acme.rp", pluginOff: true })).chip).toBe(
			"acme.rp · plugin off"
		)
		// Merged still says where it went.
		expect(
			loadoutTile(summary({ owner: "acme.rp", pluginOff: true, mergedInto: 1, mergedIntoName: "Reply" })).chip
		).toBe("merged into Reply")
	})
})

describe("a tile's price line", () => {
	test("a filled pair whose model facts carry a per-picture price says it quietly", () => {
		const t = loadoutTile(
			summary({
				name: "Images",
				transform: "text->image",
				filled: true,
				connectionName: "OpenAI",
				modelName: "gpt-image-2",
				perImagePrice: { each: 0.05, currency: "USD" }
			})
		)
		expect(t.price).toBe("≈ $0.05 per picture")
	})
	test("no price in the facts, or an unfilled pair: no line", () => {
		expect(loadoutTile(summary({ filled: true, modelName: "x" })).price).toBeNull()
		expect(
			loadoutTile(summary({ filled: false, perImagePrice: { each: 0.05, currency: "USD" } })).price
		).toBeNull()
	})
	test("the price is read from facts.pricing.perImage, medium first", async () => {
		const { perImagePriceOf } = await import("$lib/shared/connections/imagePrice")
		expect(
			perImagePriceOf({ pricing: { perImage: { low: 0.01, medium: 0.04, high: 0.17 }, currency: "USD" } })
		).toEqual({ each: 0.04, currency: "USD" })
		expect(perImagePriceOf({ pricing: { perImage: { default: 0.08 } } })).toEqual({
			each: 0.08,
			currency: "USD"
		})
		expect(perImagePriceOf({ pricing: { inPerMTok: 1 } })).toBeNull()
		expect(perImagePriceOf(null)).toBeNull()
	})
})

describe("the grid's groups", () => {
	test("by output kind, in IO order, defaults first", () => {
		const groups = groupLoadouts(
			[
				summary({ id: 3, name: "Images", transform: "text->image" }),
				summary({ id: 2, name: "Extraction" }),
				summary({ id: 1, name: "Reply", defaultFor: "text->text" }),
				summary({ id: 9, name: "Embeddings", transform: "text->embedding" })
			],
			TRANSFORMS
		)
		expect(groups.map((g) => g.label)).toEqual(["Text", "Images", "Embeddings"])
		expect(groups.map((g) => g.icon)).toEqual(["Type", "Image", "Zap"])
		expect(groups[0].tiles.map((t) => t.title)).toEqual(["Reply", "Extraction"])
	})
})

describe("the defaults ledger", () => {
	test("every job, Change for a filled default, Fill otherwise", () => {
		const rows = ledgerRows(
			TRANSFORMS,
			[
				summary({
					id: 1,
					filled: true,
					modelName: "Nemo",
					connectionName: "KCPP",
					defaultFor: "text->text"
				}),
				summary({ id: 9, name: "Embeddings", transform: "text->embedding" })
			],
			(job) => (job === "text->image" ? 3 : null)
		)
		expect(rows.map((r) => [r.label, r.line, r.verb, r.loadoutId])).toEqual([
			["Chat", "Reply · Nemo on KCPP", "Change", 1],
			["Images", "No default yet", "Fill", 3],
			["Embeddings", "Embeddings · unfilled", "Fill", 9]
		])
	})
})

describe("the status strip", () => {
	test("Sessions can reply = Reply filled", () => {
		const loadouts = [
			summary({ id: 1, filled: true, modelName: "Nemo", connectionName: "KCPP" })
		]
		expect(
			replyStrip({ loadouts, transforms: TRANSFORMS, canReply: true })
		).toEqual({ state: "ready", modelName: "Nemo", connectionName: "KCPP" })
		expect(
			replyStrip({ loadouts, transforms: TRANSFORMS, canReply: false }).state
		).toBe("unfinished")
	})
})
