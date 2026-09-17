import { describe, expect, test } from "vitest"
import {
	filterIndex,
	indexTotals,
	parseIndexFilter,
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
	isDefault: (c: number, m: number) => c === 1 && m === 11,
	serviceLabel: (t: string | null | undefined) =>
		t === "ollama"
			? "Ollama"
			: t === "openai"
				? "OpenAI Session"
				: "Llama.cpp"
}

describe("filterIndex — the one filter", () => {
	test("all shows every endpoint with every model, empty endpoints included", () => {
		const out = filterIndex(rows, opts)
		expect(out.map((g) => [g.connection.id, g.models.length])).toEqual([
			[1, 3],
			[2, 1],
			[3, 0]
		])
	})

	test("defaults keeps only models a default points at, and drops endpoints left empty", () => {
		const out = filterIndex(rows, { ...opts, filter: "defaults" })
		expect(
			out.map((g) => [g.connection.id, g.models.map((m) => m.id)])
		).toEqual([[1, [11]]])
	})

	test("attention keeps missing models and endpoints whose listing failed", () => {
		const out = filterIndex(rows, { ...opts, filter: "attention" })
		expect(
			out.map((g) => [g.connection.id, g.models.map((m) => m.id)])
		).toEqual([
			[1, [13]],
			[2, [21]]
		])
	})

	test("a capability keeps the models that may serve it", () => {
		const out = filterIndex(rows, {
			...opts,
			filter: "cap:text->embedding"
		})
		expect(
			out.map((g) => [g.connection.id, g.models.map((m) => m.id)])
		).toEqual([[1, [12]]])
	})
})

describe("filterIndex — search", () => {
	test("matches a model by name or identifier and keeps only that model", () => {
		const out = filterIndex(rows, { ...opts, query: "nomic-embed-TEXT" })
		expect(
			out.map((g) => [g.connection.id, g.models.map((m) => m.id)])
		).toEqual([[1, [12]]])
	})

	test("matches an endpoint by name, note, service or host and keeps all its models", () => {
		for (const query of ["fast box", "ollama (local)", "11434"]) {
			const out = filterIndex(rows, { ...opts, query })
			expect(out.map((g) => [g.connection.id, g.models.length])).toEqual([
				[1, 3]
			])
		}
		// The service LABEL, not the type id.
		const byService = filterIndex(rows, {
			...opts,
			query: "openai session"
		})
		expect(byService.map((g) => g.connection.id)).toEqual([2])
	})

	test("never widens what the filter narrowed", () => {
		const out = filterIndex(rows, {
			...opts,
			filter: "cap:text->text",
			query: "nomic"
		})
		expect(out).toEqual([])
	})

	test("an empty endpoint matches by its own fields under all", () => {
		const out = filterIndex(rows, { ...opts, query: "empty" })
		expect(out.map((g) => g.connection.id)).toEqual([3])
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
