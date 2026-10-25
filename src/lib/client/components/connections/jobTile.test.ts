import { describe, expect, test } from "vitest"
import { buildJobTiles, chatFacts, jobTileState } from "./jobTile"
import { readinessRows } from "./readiness"
import { defaultsSummary, type DefaultsSummaryEntry } from "./defaultsSummary"

const entry = (
	over: Partial<DefaultsSummaryEntry> = {}
): DefaultsSummaryEntry => ({
	capability: "text->image",
	label: "Images",
	outputKind: "image",
	connection: { id: 1, name: "KoboldCPP", models: [] },
	model: { id: 11, name: "SDXL", enabled: true, missingSince: null },
	set: true,
	state: "ok",
	stateWord: "ready",
	...over
})

describe("buildJobTiles — a tile's state is the connection state", () => {
	test("a bare install: every optional job is idle, never gold", () => {
		const summary = defaultsSummary([], {})
		const tiles = buildJobTiles(
			summary.entries,
			readinessRows(summary.entries),
			[]
		)
		// One tile per SDK transform but Chat: eleven, with Hearing
		// (`text+audio->text`, O4) and Spoken reply (`text->text+audio`, O6).
		expect(tiles).toHaveLength(11)
		expect(tiles.every((t) => t.state === "idle")).toBe(true)
		// Chat is the strip, not a tile.
		expect(tiles.some((t) => t.capability === "text->text")).toBe(false)
		expect(
			tiles
				.filter((t) => t.capability.includes("audio"))
				.map((t) => [t.capability, t.label])
		).toEqual(
			expect.arrayContaining([
				["text+audio->text", "Hearing"],
				["text->text+audio", "Spoken reply"]
			])
		)
	})

	test("a pair that runs is ready; one that cannot is broken, with its sentence", () => {
		const ok = entry()
		const gone = entry({
			capability: "text->embedding",
			label: "Embeddings",
			outputKind: "embedding",
			state: "warning",
			stateWord: "not listed"
		})
		const tiles = buildJobTiles([ok, gone], readinessRows([ok, gone]), [])
		expect(tiles.map((t) => [t.capability, t.state])).toEqual([
			["text->image", "ready"],
			["text->embedding", "broken"]
		])
		expect(tiles[1].problem).toBe("SDXL · KoboldCPP · not listed")
	})

	test("a download in flight is busy", () => {
		const arriving = entry({ state: "pending", stateWord: "downloading" })
		const [tile] = buildJobTiles([arriving], readinessRows([arriving]), [])
		expect(tile.state).toBe("busy")
	})
})

describe("jobTileState — a tile without a state reads one off what it says", () => {
	test("problem is broken, a model is ready, nothing is idle", () => {
		const tile = { capability: "x", label: "X" }
		expect(jobTileState(tile)).toBe("idle")
		expect(jobTileState({ ...tile, modelName: "M" })).toBe("ready")
		expect(
			jobTileState({ ...tile, modelName: "M", problem: "not listed" })
		).toBe("broken")
		expect(jobTileState({ ...tile, state: "busy" })).toBe("busy")
	})
})

describe("chatFacts — the strip's state", () => {
	const chat = (over: Partial<DefaultsSummaryEntry> = {}) =>
		entry({
			capability: "text->text",
			label: "Chat",
			outputKind: "text",
			...over
		})

	test("unset chat is unfinished — it blocks play, so it is gold", () => {
		const unset = chat({
			set: false,
			state: "unset",
			stateWord: "not set",
			connection: undefined,
			model: undefined
		})
		expect(chatFacts([unset], readinessRows([unset])).state).toBe(
			"unfinished"
		)
	})

	test("set and failing is broken, with the problem; downloading is busy", () => {
		const gone = chat({ state: "warning", stateWord: "not listed" })
		const facts = chatFacts([gone], readinessRows([gone]))
		expect(facts.state).toBe("broken")
		expect(facts.problem).toBe("SDXL · KoboldCPP · not listed")

		const arriving = chat({ state: "pending", stateWord: "downloading" })
		expect(chatFacts([arriving], readinessRows([arriving])).state).toBe(
			"busy"
		)
	})
})
