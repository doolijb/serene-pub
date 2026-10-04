import { describe, expect, it } from "vitest"
import {
	applyChangelist,
	changelistQuery,
	compareSortValues,
	countNoun,
	facetOptions,
	paginate,
	deletionFor,
	capList,
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
	it("always lists a fixed option set, counting the ones no row carries at zero", () => {
		const f: AdminChangelistFilter<Row> = {
			...filters[0],
			options: [
				{ value: "openai", label: "OpenAI" },
				{ value: "kobold", label: "KoboldCPP" }
			]
		}
		expect(facetOptions(rows, f, base, opts)).toEqual([
			{ value: "openai", label: "OpenAI", count: 1 },
			{ value: "kobold", label: "KoboldCPP", count: 0 },
			{ value: "anthropic", label: "anthropic", count: 1 },
			{ value: "ollama", label: "ollama", count: 2 }
		])
	})
})

describe("a server-applied facet (counted: false)", () => {
	const when: AdminChangelistFilter<Row> = {
		key: "when",
		label: "When",
		counted: false,
		options: [
			{ value: "today", label: "Today" },
			{ value: "week", label: "Past 7 days" }
		]
	}
	const withWhen = { ...opts, filters: [...filters, when] }
	it("lists its fixed options in order, with no counts", () => {
		expect(facetOptions(rows, when, base, withWhen)).toEqual([
			{ value: "today", label: "Today", count: null },
			{ value: "week", label: "Past 7 days", count: null }
		])
	})
	it("keeps a picked value outside the set listed, so it can be cleared", () => {
		const out = facetOptions(rows, when, { ...base, active: { when: "decade" } }, withWhen)
		expect(out.map((o) => o.value)).toEqual(["today", "week", "decade"])
	})
	it("is not matched in the browser: the rows arrive narrowed", () => {
		const state = { ...base, active: { when: "today" } }
		expect(applyChangelist(rows, state, withWhen)).toHaveLength(rows.length)
		// …and does not narrow the other facets' counts either.
		const types = facetOptions(rows, filters[0], state, withWhen)
		expect(types.find((o) => o.value === "ollama")?.count).toBe(2)
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

describe("paginate", () => {
	const many = Array.from({ length: 23 }, (_, i) => i + 1)
	it("cuts pages of pageSize and reports the count", () => {
		const r = paginate(many, 2, 10)
		expect(r).toMatchObject({ page: 2, pageCount: 3, start: 10 })
		expect(r.rows).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20])
	})
	it("clamps a stale page to the last one that exists", () => {
		expect(paginate(many, 9, 10).page).toBe(3)
		expect(paginate(many, 9, 10).rows).toEqual([21, 22, 23])
		expect(paginate(many, 0, 10).page).toBe(1)
	})
	it("one page when everything fits or pageSize is 0 (show all)", () => {
		expect(paginate(many, 2, 50)).toMatchObject({ page: 1, pageCount: 1 })
		expect(paginate(many, 2, 0).rows).toHaveLength(23)
	})
	it("rides the query as 1-based ?p=, absent on page 1", () => {
		expect(changelistQuery({ ...base, page: 3 })).toBe("?p=3")
		expect(changelistQuery({ ...base, page: 1 })).toBe("")
		expect(parseChangelistQuery("?p=3", []).page).toBe(3)
		expect(parseChangelistQuery("?p=x", []).page).toBeUndefined()
	})
})

describe("deletionFor", () => {
	const noun = { singular: "prompt", plural: "prompts" }
	const items = [
		{ name: "Reply", builtIn: true, used: [] as string[] },
		{ name: "Mine", builtIn: false, used: ["Chat"] },
		{ name: "Spare", builtIn: false, used: [] as string[] }
	]
	it("keeps protected rows out of the list and names them", () => {
		const d = deletionFor(items, {
			noun,
			label: (r) => r.name,
			protect: (r) => (r.builtIn ? "built-in prompts cannot be deleted" : null),
			related: (r) => [{ label: "Picked by", items: r.used }]
		})
		expect(d.title).toBe("Delete 2 prompts?")
		expect(d.objects.map((o) => o.label)).toEqual(["Mine", "Spare"])
		expect(d.objects[0].related).toEqual([{ label: "Picked by", items: ["Chat"] }])
		expect(d.objects[1].related).toEqual([])
		expect(d.summary).toMatch(/^Reply stays: built-in/)
		expect(d.confirmLabel).toBe("Delete 2 prompts")
	})
	it("offers nothing to delete when every row is protected", () => {
		const d = deletionFor([items[0]], { noun, label: (r) => r.name, protect: () => "built in" })
		expect(d.objects).toEqual([])
		expect(d.title).toBe("Reply cannot be deleted")
	})
	it("one row: the name in the title, the singular on the button", () => {
		const d = deletionFor([items[2]], { noun, label: (r) => r.name })
		expect(d.title).toBe("Delete Spare?")
		expect(d.confirmLabel).toBe("Delete prompt")
		expect(d.summary).toBe("This cannot be undone.")
	})
	it("caps a long cascade list", () => {
		expect(capList(["a", "b", "c"], 2)).toEqual(["a", "b", "and 1 more"])
	})
})
