import { describe, expect, it } from "vitest"
import {
	applyChangelist,
	changelistQuery,
	compareSortValues,
	countNoun,
	facetOptions,
	parseChangelistQuery,
	type AdminChangelistColumn,
	type AdminChangelistFilter,
	type ChangelistState
} from "./changelist"

interface Row {
	name: string
	type: string
	models: number
	caps: string[]
}

const rows: Row[] = [
	{ name: "Ollama box", type: "ollama", models: 3, caps: ["chat"] },
	{ name: "Claude", type: "anthropic", models: 9, caps: [] },
	{ name: "ollama laptop", type: "ollama", models: 0, caps: ["chat", "embed"] },
	{ name: "OpenRouter", type: "openai", models: 120, caps: ["embed"] }
]

const columns: AdminChangelistColumn<Row>[] = [
	{ key: "name", label: "Name", primary: true, sortValue: (r) => r.name },
	{ key: "models", label: "Models", sortValue: (r) => r.models },
	{ key: "notes", label: "Notes" }
]
const filters: AdminChangelistFilter<Row>[] = [
	{ key: "type", label: "Type", values: (r) => r.type },
	{ key: "cap", label: "Default for", values: (r) => r.caps }
]
const base: ChangelistState = { search: "", active: {}, sortKey: null, sortDir: "asc" }
const opts = { columns, filters, searchText: (r: Row) => `${r.name} ${r.type}` }

describe("applyChangelist", () => {
	it("searches every word, in any order, case-blind", () => {
		const out = applyChangelist(rows, { ...base, search: "LAPTOP ollama" }, opts)
		expect(out.map((r) => r.name)).toEqual(["ollama laptop"])
	})
	it("filters by a facet, including a multi-valued one", () => {
		expect(
			applyChangelist(rows, { ...base, active: { cap: "embed" } }, opts).map((r) => r.name)
		).toEqual(["ollama laptop", "OpenRouter"])
	})
	it("sorts numbers numerically in both directions", () => {
		const asc = applyChangelist(rows, { ...base, sortKey: "models" }, opts)
		expect(asc.map((r) => r.models)).toEqual([0, 3, 9, 120])
		const desc = applyChangelist(rows, { ...base, sortKey: "models", sortDir: "desc" }, opts)
		expect(desc.map((r) => r.models)).toEqual([120, 9, 3, 0])
	})
	it("ignores a sort on a column that is not sortable", () => {
		const out = applyChangelist(rows, { ...base, sortKey: "notes" }, opts)
		expect(out).toEqual(rows)
	})
})

describe("facetOptions", () => {
	it("counts each option against the other facets and the search", () => {
		const state = { ...base, active: { cap: "chat" } }
		const types = facetOptions(rows, filters[0], state, opts)
		expect(types).toEqual([
			{ value: "anthropic", label: "anthropic", count: 0 },
			{ value: "ollama", label: "ollama", count: 2 },
			{ value: "openai", label: "openai", count: 0 }
		])
	})
	it("keeps a picked value nobody carries, at zero, so it can be cleared", () => {
		const out = facetOptions(rows, filters[0], { ...base, active: { type: "gone" } }, opts)
		expect(out.find((o) => o.value === "gone")?.count).toBe(0)
	})
	it("honours a fixed order", () => {
		const f = { ...filters[0], order: ["openai", "ollama"] }
		expect(facetOptions(rows, f, base, opts).map((o) => o.value)).toEqual([
			"openai",
			"ollama",
			"anthropic"
		])
	})
})

describe("the changelist's query", () => {
	it("round-trips search, filters and a descending sort", () => {
		const state: ChangelistState = {
			search: "box",
			active: { type: "ollama" },
			sortKey: "models",
			sortDir: "desc"
		}
		const q = changelistQuery(state)
		expect(q).toBe("?q=box&type=ollama&o=-models")
		expect(parseChangelistQuery(q, ["type", "cap"])).toEqual(state)
	})
	it("leaves the default sort out of the address", () => {
		const fallback = { sortKey: "name", sortDir: "asc" as const }
		expect(changelistQuery({ ...base, sortKey: "name" }, fallback)).toBe("")
		expect(parseChangelistQuery("", [], fallback).sortKey).toBe("name")
	})
})

describe("small helpers", () => {
	it("puts blanks last", () => {
		expect([3, null, 1].sort(compareSortValues)).toEqual([1, 3, null])
	})
	it("counts a noun", () => {
		const noun = { singular: "connection", plural: "connections" }
		expect(countNoun(1, noun)).toBe("1 connection")
		expect(countNoun(0, noun)).toBe("0 connections")
	})
})
