import { describe, expect, test } from "vitest"
import {
	countConnections,
	filterConnections,
	foldManagedImage,
	indexTotals,
	isCustomOpenAiPreset,
	needsAttention,
	parseIndexFilter,
	servesCapability,
	type IndexConnection
} from "./connectionIndexFilter"

const rows: IndexConnection[] = [
	{
		id: 1,
		name: "Ollama (local)",
		type: "ollama",
		baseUrl: "http://localhost:11434",
		notes: "the fast box",
		modelsSync: { at: "2026-09-14T10:00:00Z", error: null },
		models: [
			{
				id: 11,
				name: "llama3.1:8b",
				model: "llama3.1:8b",
				enabled: true,
				missingSince: null,
				satisfiableCapabilities: ["text->text"]
			},
			{
				id: 12,
				name: "nomic-embed",
				model: "nomic-embed-text",
				enabled: true,
				missingSince: null,
				satisfiableCapabilities: ["text->embedding"]
			},
			{
				id: 13,
				name: "old-model",
				model: "old:latest",
				enabled: true,
				missingSince: "2026-09-12T00:00:00Z",
				satisfiableCapabilities: []
			}
		]
	},
	{
		id: 2,
		name: "OpenRouter",
		type: "openai",
		baseUrl: "https://openrouter.ai/api/v1/",
		notes: null,
		modelsSync: { at: "2026-09-14T10:00:00Z", error: "401 Unauthorized" },
		models: [
			{
				id: 21,
				name: "gpt-4o",
				model: "openai/gpt-4o",
				enabled: false,
				missingSince: null,
				satisfiableCapabilities: []
			}
		]
	},
	{
		id: 3,
		name: "Empty endpoint",
		type: "llamacpp",
		baseUrl: null,
		notes: null,
		modelsSync: { at: null, error: null },
		models: []
	}
]

const opts = {
	query: "",
	filter: "all" as const,
	serviceLabel: (c: IndexConnection) =>
		c.type === "ollama"
			? "Ollama"
			: c.type === "openai"
				? (c.preset ?? "OpenAI Session")
				: "Llama.cpp"
}

const ids = (out: readonly IndexConnection[]) => out.map((c) => c.id)

describe("filterConnections — the unit is the connection", () => {
	test("all keeps every connection, including one with no models", () => {
		expect(ids(filterConnections(rows, opts))).toEqual([1, 2, 3])
	})

	test("attention keeps a failed listing and a connection with a missing model", () => {
		expect(
			ids(filterConnections(rows, { ...opts, filter: "attention" }))
		).toEqual([1, 2])
	})

	test("a local file that failed to download needs attention too", () => {
		const onnx: IndexConnection = {
			id: 9,
			name: "Embeddings",
			type: "local_onnx_embeddings",
			baseUrl: null,
			notes: null,
			modelsSync: { at: null, error: null },
			models: [
				{
					id: 91,
					name: "bge-small",
					model: "bge-small",
					enabled: true,
					missingSince: null,
					local: { state: "error" }
				}
			]
		}
		expect(needsAttention(onnx)).toBe(true)
		// A model somebody switched off is a choice, not a fault.
		expect(needsAttention(rows[2])).toBe(false)
	})

	test("a preset-less OpenAI-compatible row is the custom one", () => {
		expect(isCustomOpenAiPreset(null)).toBe(true)
		expect(isCustomOpenAiPreset(undefined)).toBe(true)
		expect(isCustomOpenAiPreset("")).toBe(true)
		expect(isCustomOpenAiPreset("openrouter")).toBe(false)
	})

	test("a capability keeps a connection with at least one model that serves it", () => {
		expect(
			ids(
				filterConnections(rows, {
					...opts,
					filter: "cap:text->embedding"
				})
			)
		).toEqual([1])
		expect(servesCapability(rows[0], "text->text")).toBe(true)
		expect(servesCapability(rows[1], "text->text")).toBe(false)
	})

	test("defaults narrows nothing — it is a mode, not a predicate", () => {
		expect(
			ids(filterConnections(rows, { ...opts, filter: "defaults" }))
		).toEqual([1, 2, 3])
	})
})

describe("filterConnections — search", () => {
	test("a model's name or identifier keeps its whole connection", () => {
		expect(
			ids(filterConnections(rows, { ...opts, query: "nomic-embed-TEXT" }))
		).toEqual([1])
	})

	test("matches a connection by name, note, service or host", () => {
		for (const query of ["fast box", "ollama (local)", "11434"])
			expect(ids(filterConnections(rows, { ...opts, query }))).toEqual([
				1
			])
		expect(
			ids(filterConnections(rows, { ...opts, query: "openai session" }))
		).toEqual([2])
	})

	test("a preset's name is what somebody types to find that connection", () => {
		const presetRows = [{ ...rows[1], baseUrl: null, preset: "openrouter" }]
		expect(
			ids(filterConnections(presetRows, { ...opts, query: "openrouter" }))
		).toEqual([2])
	})

	test("never widens what the filter narrowed", () => {
		expect(
			filterConnections(rows, {
				...opts,
				filter: "cap:text->embedding",
				query: "openrouter"
			})
		).toEqual([])
	})
})

describe("countConnections", () => {
	test("counts what each filter row would keep, ignoring the query", () => {
		expect(countConnections(rows, "all")).toBe(3)
		expect(countConnections(rows, "attention")).toBe(2)
		expect(countConnections(rows, "cap:text->text")).toBe(1)
		expect(countConnections(rows, "defaults")).toBe(0)
	})
})

describe("foldManagedImage", () => {
	const isText = (t: string | null | undefined) => t === "koboldcpp_managed"
	const isImage = (t: string | null | undefined) =>
		t === "koboldcpp_managed_image"
	const managed: IndexConnection[] = [
		{ ...rows[2], id: 4, type: "koboldcpp_managed" },
		{ ...rows[2], id: 5, type: "koboldcpp_managed_image" }
	]

	test("drops the image row when the text row is there", () => {
		expect(ids(foldManagedImage(managed, isText, isImage))).toEqual([4])
	})

	test("keeps a lone image row — a connection nothing can reach is worse", () => {
		expect(ids(foldManagedImage([managed[1]], isText, isImage))).toEqual([
			5
		])
	})
})

describe("parseIndexFilter / indexTotals", () => {
	test("parses the known values and falls back to all", () => {
		expect(parseIndexFilter("defaults")).toBe("defaults")
		expect(parseIndexFilter("attention")).toBe("attention")
		expect(parseIndexFilter("cap:text->text")).toBe("cap:text->text")
		expect(parseIndexFilter("cap:")).toBe("all")
		expect(parseIndexFilter("nonsense")).toBe("all")
		expect(parseIndexFilter(null)).toBe("all")
	})

	test("totals count what the summary line says", () => {
		expect(indexTotals(rows)).toEqual({
			connections: 3,
			models: 4,
			missing: 1,
			unreachable: 1
		})
	})
})
