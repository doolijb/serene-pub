import { describe, expect, test } from "vitest"
import {
	onnxFacts,
	onnxModelHeadline,
	onnxSizeLabel,
	tierOrder,
	splitByPresence,
	type LocalOnnxState
} from "./onnxModelFacts"

function local(over: Partial<LocalOnnxState> = {}): LocalOnnxState {
	return {
		state: "not_downloaded",
		sizeBytes: null,
		loaded: false,
		addedByUser: false,
		...over
	}
}

describe("onnxModelHeadline — the active model", () => {
	test("resident reads as loaded, with the success dot", () => {
		expect(
			onnxModelHeadline(local({ state: "on_disk", loaded: true }), true)
		).toEqual({ text: "Active · loaded", tone: "success", percent: null })
	})

	test("on disk but not resident is not an alarm", () => {
		expect(
			onnxModelHeadline(local({ state: "on_disk", loaded: false }), true)
		).toEqual({
			text: "Active · on disk, not loaded",
			tone: "muted",
			percent: null
		})
	})

	test("active with no files is a warning — the next job stalls", () => {
		expect(onnxModelHeadline(local(), true)).toEqual({
			text: "Active · not downloaded",
			tone: "warning",
			percent: null
		})
	})

	test("a failed download is a warning even while active", () => {
		expect(
			onnxModelHeadline(local({ state: "error", error: "404" }), true)
		).toEqual({
			text: "Active · download failed",
			tone: "warning",
			percent: null
		})
	})

	test("an active model still fetching says so, with the bar", () => {
		expect(
			onnxModelHeadline(
				local({ state: "downloading", percent: 42 }),
				true
			)
		).toEqual({
			text: "Active · downloading 42%",
			tone: "warning",
			percent: 42
		})
	})
})

describe("onnxModelHeadline — every other model", () => {
	test("on disk is the whole headline", () => {
		expect(
			onnxModelHeadline(local({ state: "on_disk", sizeBytes: 1 }), false)
		).toEqual({ text: "On disk", tone: "success", percent: null })
	})

	test("not downloaded names the size the list quotes", () => {
		expect(
			onnxModelHeadline(local({ catalog: { sizeMb: 133 } }), false)
		).toEqual({
			text: "Not downloaded · 133 MB",
			tone: "muted",
			percent: null
		})
	})

	test("not downloaded with no size quoted drops the clause", () => {
		expect(onnxModelHeadline(local(), false).text).toBe("Not downloaded")
	})

	test("a percent is derived from the bytes when the server sends none", () => {
		expect(
			onnxModelHeadline(
				local({
					state: "downloading",
					downloadedBytes: 50,
					totalBytes: 200
				}),
				false
			)
		).toEqual({ text: "Downloading 25%", tone: "muted", percent: 25 })
	})

	test("a percent outside 0–100 is clamped rather than printed", () => {
		expect(
			onnxModelHeadline(
				local({ state: "downloading", percent: 140 }),
				false
			).percent
		).toBe(100)
	})

	test("a failed download is a warning", () => {
		expect(onnxModelHeadline(local({ state: "error" }), false)).toEqual({
			text: "Download failed",
			tone: "warning",
			percent: null
		})
	})

	test("silence from the server is not a state", () => {
		expect(onnxModelHeadline(undefined, false)).toEqual({
			text: "Not checked yet",
			tone: "muted",
			percent: null
		})
	})
})

describe("onnxSizeLabel", () => {
	test("on disk quotes the bytes actually there", () => {
		expect(
			onnxSizeLabel(
				local({
					state: "on_disk",
					sizeBytes: 133_000_000,
					catalog: { sizeMb: 999 }
				})
			)
		).toBe("133 MB")
	})

	test("before the download it quotes the list", () => {
		expect(onnxSizeLabel(local({ catalog: { sizeMb: 1200 } }))).toBe(
			"1.2 GB"
		)
	})

	test("nothing to quote is null, not a zero", () => {
		expect(onnxSizeLabel(local())).toBeNull()
		expect(onnxSizeLabel(null)).toBeNull()
	})
})

describe("onnxFacts", () => {
	test("an embedding model's grid, in order", () => {
		expect(
			onnxFacts(
				{
					tier: "balanced",
					dimensions: 768,
					maxInputTokens: 8192,
					pooling: "mean",
					prefixes: { query: "query: ", document: "passage: " },
					languages: "English",
					license: "MIT",
					parameterSize: "109M",
					released: "2024"
				},
				"embeddings"
			)
		).toEqual([
			{ label: "Tier", value: "Balanced" },
			{ label: "Dimensions", value: "768" },
			{ label: "Max input", value: "8k tokens" },
			{ label: "Pooling", value: "mean" },
			{ label: "Query prefix", value: '"query: "' },
			{ label: "Document prefix", value: '"passage: "' },
			{ label: "Languages", value: "English" },
			{ label: "Licence", value: "MIT · 109M · 2024" }
		])
	})

	test("an entity model shows labels where dimensions would be, and no pooling", () => {
		expect(
			onnxFacts(
				{
					tier: "fast",
					dimensions: 384,
					pooling: "mean",
					labels: ["PER", "LOC", "ORG"],
					maxInputTokens: 512
				},
				"ner"
			)
		).toEqual([
			{ label: "Tier", value: "Fast" },
			{ label: "Labels", value: "PER · LOC · ORG" },
			{ label: "Max input", value: "512 tokens" }
		])
	})

	test("the provenance line joins only what exists", () => {
		expect(onnxFacts({ license: "Apache-2.0" }, "embeddings")).toEqual([
			{ label: "Licence", value: "Apache-2.0" }
		])
		expect(
			onnxFacts({ parameterSize: "33M", released: "2023" }, "embeddings")
		).toEqual([{ label: "Licence", value: "33M · 2023" }])
	})

	test("no catalog is an empty grid, never a grid of blanks", () => {
		expect(onnxFacts(undefined, "embeddings")).toEqual([])
		expect(onnxFacts({}, "ner")).toEqual([])
	})
})

describe("tierOrder", () => {
	interface Row {
		name: string
		local?: LocalOnnxState
	}
	const row = (name: string, over: Partial<LocalOnnxState> = {}): Row => ({
		name,
		local: local(over)
	})

	test("Fast, Balanced, Best, then Added by you", () => {
		const groups = tierOrder([
			row("added", { addedByUser: true }),
			row("best", { catalog: { tier: "best", sizeMb: 500 } }),
			row("fast", { catalog: { tier: "fast", sizeMb: 30 } }),
			row("balanced", { catalog: { tier: "balanced", sizeMb: 130 } })
		])
		expect(groups.map((g) => g.label)).toEqual([
			"Fast",
			"Balanced",
			"Best",
			"Added by you"
		])
		expect(groups.map((g) => g.rows[0].name)).toEqual([
			"fast",
			"balanced",
			"best",
			"added"
		])
	})

	test("an empty tier gets no header row", () => {
		expect(
			tierOrder([row("a", { catalog: { tier: "best", sizeMb: 1 } })]).map(
				(g) => g.label
			)
		).toEqual(["Best"])
	})

	test("rows inside a tier climb by size", () => {
		const groups = tierOrder([
			row("big", { catalog: { tier: "fast", sizeMb: 90 } }),
			row("small", { catalog: { tier: "fast", sizeMb: 20 } }),
			row("mid", { catalog: { tier: "fast", sizeMb: 45 } })
		])
		expect(groups[0].rows.map((r) => r.name)).toEqual([
			"small",
			"mid",
			"big"
		])
	})

	test("a size nobody quoted sorts last, not first", () => {
		const groups = tierOrder([
			row("unsized", { catalog: { tier: "fast" } }),
			row("sized", { catalog: { tier: "fast", sizeMb: 400 } })
		])
		expect(groups[0].rows.map((r) => r.name)).toEqual(["sized", "unsized"])
	})

	test("added by hand wins over whatever tier the Hub config implied", () => {
		const groups = tierOrder([
			row("mine", { addedByUser: true, catalog: { tier: "fast" } })
		])
		expect(groups.map((g) => g.tier)).toEqual(["added"])
	})

	test("a row the list says nothing about lands in a headerless group, last", () => {
		const groups = tierOrder<Row>([
			{ name: "silent" },
			row("fast", { catalog: { tier: "fast", sizeMb: 1 } })
		])
		expect(groups.map((g) => g.label)).toEqual(["Fast", null])
		expect(groups[1].rows.map((r) => r.name)).toEqual(["silent"])
	})

	test("no rows is no groups", () => {
		expect(tierOrder([])).toEqual([])
	})
})

describe("splitByPresence — here, and available to download", () => {
	const row = (
		id: number,
		state: "on_disk" | "downloading" | "error" | "not_downloaded" | null,
		tier: "fast" | "balanced" | "best" = "fast",
		sizeMb = 100
	) => ({
		id,
		local:
			state == null
				? undefined
				: ({
						state,
						sizeBytes: null,
						loaded: false,
						addedByUser: false,
						catalog: { tier, sizeMb }
					} as any)
	})

	test("every state but not_downloaded is here", () => {
		const split = splitByPresence([
			row(1, "on_disk"),
			row(2, "downloading"),
			row(3, "error"),
			row(4, "not_downloaded"),
			row(5, null)
		])
		expect(split.here.map((r) => r.id).sort()).toEqual([1, 2, 3, 5])
		expect(split.availableCount).toBe(1)
		expect(split.available.flatMap((g) => g.rows).map((r) => r.id)).toEqual(
			[4]
		)
	})

	test("the active model leads; the rest keep tier then size order", () => {
		const split = splitByPresence(
			[
				row(1, "on_disk", "best", 500),
				row(2, "on_disk", "fast", 50),
				row(3, "on_disk", "fast", 20)
			],
			(r) => r.id === 1
		)
		expect(split.here.map((r) => r.id)).toEqual([1, 3, 2])
	})

	test("available is grouped by tier", () => {
		const split = splitByPresence([
			row(1, "not_downloaded", "best"),
			row(2, "not_downloaded", "fast")
		])
		expect(split.available.map((g) => g.tier)).toEqual(["fast", "best"])
	})
})
