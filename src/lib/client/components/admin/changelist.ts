/**
 * The mechanics behind `AdminChangelist` (Django admin's changelist): search,
 * facet filters with counts, column sort, and the address that carries them.
 * Pure so the rules are pinned by node tests (`changelist.test.ts`); the
 * component only draws what these return.
 *
 * Vocabulary (NOMENCLATURE §25, 2026-09-27): a **changelist** lists one kind
 * of admin object; a **changelist filter** is one facet of it (Django's
 * `list_filter`); a **bulk action** runs on the selected rows (Django's
 * "actions" — qualified, because _action_ is the session vocabulary's word).
 */
import type { Component } from "svelte"

export type AdminSortValue = string | number | boolean | null | undefined

export interface AdminChangelistColumn<R> {
	key: string
	label: string
	/** The cell as text; also the fact a stacked (narrow) row shows. */
	text?: (row: R) => string | null | undefined
	/** Sort key. Absent → the header is not a sort control. */
	sortValue?: (row: R) => AdminSortValue
	/**
	 * The title column: a link to the row's change form, and the heading of
	 * the stacked row. Exactly one column should be primary.
	 */
	primary?: boolean
	/** Drawn by the changelist's `cell` snippet instead of `text`. */
	custom?: boolean
	/** Left out of the stacked row's facts (default: shown when it has text). */
	hideWhenStacked?: boolean
	/** Right-aligned (counts). */
	numeric?: boolean
	/** Extra classes on the th and td. */
	class?: string
}

export interface AdminChangelistFilter<R> {
	/** The query parameter it rides on: `?type=ollama`. */
	key: string
	/** "Type" — shown as "By type" in the rail. */
	label: string
	/** The row's value(s) for this facet; several means it matches each. */
	values: (row: R) => string | readonly string[] | null | undefined
	optionLabel?: (value: string) => string
	/** A fixed order for the options; unlisted values follow, by label. */
	order?: readonly string[]
}

export interface AdminFacetOption {
	value: string
	label: string
	/** Rows that would show with this option picked (other facets held). */
	count: number
}

/** One object a deletion takes, and what goes or changes with it. */
export interface AdminDeletionObject {
	label: string
	related?: { label: string; items: readonly string[] }[]
}

/** What a delete confirmation lists (Django's "Are you sure?" page). */
export interface AdminDeletion {
	/** "Delete 2 connections?" */
	title: string
	/** One sentence on the consequence, in the reader's words. */
	summary?: string
	objects: readonly AdminDeletionObject[]
	/** The destructive button's words: "Delete 2 connections". */
	confirmLabel: string
}

export interface AdminBulkAction<R> {
	key: string
	/** "Delete selected connections…" */
	label: string
	icon?: Component<any>
	destructive?: boolean
	/** Present → the changelist asks first, listing what this takes. */
	confirm?: (rows: R[]) => AdminDeletion
	run: (rows: R[]) => void
}

export type SortDir = "asc" | "desc"

export interface ChangelistState {
	search: string
	/** Facet key → picked value. Absent key = All. */
	active: Record<string, string>
	sortKey: string | null
	sortDir: SortDir
}

function asList(v: string | readonly string[] | null | undefined): string[] {
	if (v == null || v === "") return []
	return typeof v === "string" ? [v] : v.filter((x) => x !== "")
}

/** Nulls last, numbers numerically, everything else by locale, case-blind. */
export function compareSortValues(a: AdminSortValue, b: AdminSortValue): number {
	const an = a == null || a === ""
	const bn = b == null || b === ""
	if (an && bn) return 0
	if (an) return 1
	if (bn) return -1
	if (typeof a === "number" && typeof b === "number") return a - b
	if (typeof a === "boolean" && typeof b === "boolean")
		return a === b ? 0 : a ? -1 : 1
	return String(a).localeCompare(String(b), undefined, {
		sensitivity: "base",
		numeric: true
	})
}

function matchesSearch<R>(
	row: R,
	q: string,
	searchText?: (row: R) => string
): boolean {
	if (!q || !searchText) return true
	const hay = searchText(row).toLowerCase()
	// Every word must appear somewhere, in any order: "ollama chat".
	return q
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean)
		.every((w) => hay.includes(w))
}

function matchesFacets<R>(
	row: R,
	filters: readonly AdminChangelistFilter<R>[],
	active: Record<string, string>,
	skip?: string
): boolean {
	for (const f of filters) {
		if (f.key === skip) continue
		const want = active[f.key]
		if (want == null || want === "") continue
		if (!asList(f.values(row)).includes(want)) return false
	}
	return true
}

/** The rows on screen: searched, filtered, sorted. */
export function applyChangelist<R>(
	rows: readonly R[],
	state: ChangelistState,
	opts: {
		columns: readonly AdminChangelistColumn<R>[]
		filters?: readonly AdminChangelistFilter<R>[]
		searchText?: (row: R) => string
	}
): R[] {
	const q = state.search.trim()
	let out = rows.filter(
		(r) =>
			matchesSearch(r, q, opts.searchText) &&
			matchesFacets(r, opts.filters ?? [], state.active)
	)
	const col = opts.columns.find((c) => c.key === state.sortKey)
	if (col?.sortValue) {
		const dir = state.sortDir === "asc" ? 1 : -1
		const key = col.sortValue
		out = [...out].sort((a, b) => {
			const av = key(a)
			const bv = key(b)
			// Blanks stay last in both directions.
			const blankA = av == null || av === ""
			const blankB = bv == null || bv === ""
			if (blankA || blankB) return compareSortValues(av, bv)
			return compareSortValues(av, bv) * dir
		})
	}
	return out
}

/**
 * One facet's options, each counted against the rows the OTHER facets and
 * the search leave — so a count says what picking it would show. A picked
 * value that no row carries any more stays listed (count 0), so the reader
 * can see and clear it.
 */
export function facetOptions<R>(
	rows: readonly R[],
	filter: AdminChangelistFilter<R>,
	state: ChangelistState,
	opts: {
		filters: readonly AdminChangelistFilter<R>[]
		searchText?: (row: R) => string
	}
): AdminFacetOption[] {
	const q = state.search.trim()
	const counts = new Map<string, number>()
	for (const row of rows) {
		for (const v of asList(filter.values(row))) {
			if (!counts.has(v)) counts.set(v, 0)
		}
		if (!matchesSearch(row, q, opts.searchText)) continue
		if (!matchesFacets(row, opts.filters, state.active, filter.key)) continue
		for (const v of new Set(asList(filter.values(row))))
			counts.set(v, (counts.get(v) ?? 0) + 1)
	}
	const picked = state.active[filter.key]
	if (picked && !counts.has(picked)) counts.set(picked, 0)
	const label = (v: string) => filter.optionLabel?.(v) ?? v
	const order = filter.order ?? []
	return [...counts.entries()]
		.map(([value, count]) => ({ value, label: label(value), count }))
		.sort((a, b) => {
			const ia = order.indexOf(a.value)
			const ib = order.indexOf(b.value)
			if (ia !== -1 || ib !== -1) {
				if (ia === -1) return 1
				if (ib === -1) return -1
				return ia - ib
			}
			return a.label.localeCompare(b.label, undefined, {
				sensitivity: "base"
			})
		})
}

/**
 * Read a changelist's state from its query: `q` is the search, `o` the sort
 * (`o=name`, `o=-models` for descending), and each filter its own key.
 */
export function parseChangelistQuery(
	search: string,
	filterKeys: readonly string[],
	fallback: { sortKey?: string | null; sortDir?: SortDir } = {}
): ChangelistState {
	const p = new URLSearchParams(search)
	const o = p.get("o")
	const active: Record<string, string> = {}
	for (const k of filterKeys) {
		const v = p.get(k)
		if (v) active[k] = v
	}
	return {
		search: p.get("q") ?? "",
		active,
		sortKey: o ? o.replace(/^-/, "") : (fallback.sortKey ?? null),
		sortDir: o ? (o.startsWith("-") ? "desc" : "asc") : (fallback.sortDir ?? "asc")
	}
}

/** The query string for a state, `""` when everything is at rest. */
export function changelistQuery(
	state: ChangelistState,
	fallback: { sortKey?: string | null; sortDir?: SortDir } = {}
): string {
	const p = new URLSearchParams()
	if (state.search.trim()) p.set("q", state.search.trim())
	for (const [k, v] of Object.entries(state.active)) if (v) p.set(k, v)
	const atRest =
		state.sortKey === (fallback.sortKey ?? null) &&
		state.sortDir === (fallback.sortDir ?? "asc")
	if (state.sortKey && !atRest)
		p.set("o", (state.sortDir === "desc" ? "-" : "") + state.sortKey)
	const s = p.toString()
	return s ? `?${s}` : ""
}

/** "1 connection" / "3 connections". */
export function countNoun(
	n: number,
	noun: { singular: string; plural: string }
): string {
	return `${n} ${n === 1 ? noun.singular : noun.plural}`
}
