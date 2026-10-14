import { describe, expect, it } from "vitest"
import {
	connectionChip,
	filterModels,
	flatModels,
	MODEL_SCOPES,
	modelsSummaryLine,
	scopeCounts
} from "./modelsList"
import type { CapabilityConnection } from "./jobPicker"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

function model(
	id: number,
	name: string,
	caps: string[],
	extra: Partial<CapabilityConnection["models"][number]> = {}
): CapabilityConnection["models"][number] {
	return {
		id,
		name,
		model: name.toLowerCase().replace(/\s+/g, "-"),
		enabled: true,
		missingSince: null,
		satisfiableCapabilities: caps,
		...extra
	}
}

function connection(
	id: number,
	name: string,
	type: string,
	models: CapabilityConnection["models"]
): CapabilityConnection {
	return {
		id,
		name,
		type,
		models,
		modelsSync: { at: null, error: null }
	}
}

const rows: CapabilityConnection[] = [
	connection(1, "Kobold", CONNECTION_TYPE.KOBOLDCPP_MANAGED, [
		model(11, "Zephyr", ["text->text"]),
		model(12, "Anima", ["text->text", "text->image"])
	]),
	connection(2, "Embeddings", CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS, [
		model(21, "bge small", ["text->embedding"], {
			local: { state: "on_disk" }
		})
	]),
	connection(3, "OpenRouter", "openai", [
		model(31, "Hidden one", ["text->text"], { enabled: false }),
		model(32, "Gone", ["text->text"], {
			missingSince: "2026-10-01T00:00:00Z"
		}),
		model(33, "Mistral", ["text->text"])
	])
]

describe("flatModels", () => {
	it("is one entry per model across every connection", () => {
		const flat = flatModels(rows)
		expect(flat).toHaveLength(6)
		const anima = flat.find((e) => e.model.id === 12)!
		expect(anima.connectionId).toBe(1)
		expect(anima.connectionName).toBe("Kobold")
		expect(anima.capabilities).toEqual(["text->text", "text->image"])
		expect(anima.isLocal).toBe(false)
	})

	it("sorts by display name, set-aside models last", () => {
		const names = flatModels(rows).map((e) => e.model.id)
		// Anima, Bge Small, Mistral, Zephyr — then Gone, Hidden one.
		expect(names.slice(0, 4)).toEqual([12, 21, 33, 11])
		expect(names.slice(4).sort()).toEqual([31, 32])
	})

	it("marks a local ONNX file as local", () => {
		const bge = flatModels(rows).find((e) => e.model.id === 21)!
		expect(bge.isLocal).toBe(true)
		expect(bge.local?.state).toBe("on_disk")
	})

	it("names an unnamed connection", () => {
		const flat = flatModels([
			connection(9, "", "openai", [model(1, "X", [])])
		])
		expect(flat[0].connectionName).toBe("Untitled connection")
	})
})

describe("filterModels", () => {
	const flat = flatModels(rows)

	it("keeps everything at All with no query", () => {
		expect(filterModels(flat, { query: "", scope: "all" })).toHaveLength(6)
	})

	it("narrows by the scope's job", () => {
		expect(
			filterModels(flat, { query: "", scope: "images" }).map(
				(e) => e.model.id
			)
		).toEqual([12])
		expect(
			filterModels(flat, { query: "", scope: "embeddings" }).map(
				(e) => e.model.id
			)
		).toEqual([21])
		expect(filterModels(flat, { query: "", scope: "entities" })).toEqual([])
	})

	it("matches the name, the identifier and the connection", () => {
		expect(
			filterModels(flat, { query: "mistral", scope: "all" }).map(
				(e) => e.model.id
			)
		).toEqual([33])
		expect(
			filterModels(flat, { query: "kobold", scope: "all" }).map(
				(e) => e.model.id
			)
		).toEqual([12, 11])
		expect(
			filterModels(flat, { query: "kobold zeph", scope: "chat" }).map(
				(e) => e.model.id
			)
		).toEqual([11])
	})
})

describe("counts and words", () => {
	it("counts each scope", () => {
		const counts = scopeCounts(flatModels(rows))
		expect(counts).toEqual({
			all: 6,
			chat: 5,
			images: 1,
			embeddings: 1,
			entities: 0
		})
		expect(MODEL_SCOPES.map((s) => s.label)).toEqual([
			"All",
			"Chat",
			"Images",
			"Embeddings",
			"Entities"
		])
	})

	it("says the summary line", () => {
		expect(modelsSummaryLine(12, "all")).toBe("12 models")
		expect(modelsSummaryLine(1, "all")).toBe("1 model")
		expect(modelsSummaryLine(4, "chat")).toBe("4 can chat")
		expect(modelsSummaryLine(1, "images")).toBe("1 can draw")
		expect(modelsSummaryLine(2, "embeddings")).toBe("2 can embed")
		expect(modelsSummaryLine(0, "entities")).toBe("0 can find entities")
	})

	it("chips the connection, the service in the tooltip", () => {
		expect(
			connectionChip({
				connectionName: "Work key",
				serviceLabel: "OpenRouter"
			})
		).toEqual({ label: "Work key", title: "Work key · OpenRouter" })
		expect(
			connectionChip({
				connectionName: "OpenRouter",
				serviceLabel: "OpenRouter"
			})
		).toEqual({ label: "OpenRouter", title: "OpenRouter" })
	})
})
