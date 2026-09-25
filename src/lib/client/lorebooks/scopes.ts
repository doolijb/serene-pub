/**
 * Scope, saved scope and facet — the rail's arithmetic, over one pool.
 *
 * A scope is what is in the set, drawn through whichever lens is chosen. Every
 * scope is offered in every book: one with nothing in it goes dim and sorts
 * last rather than disappearing, because a facet that vanishes teaches the
 * reader the capability does not exist.
 */

import {
	CHARACTER_LORE_TYPE_ID,
	HISTORY_TYPE_ID,
	WORLD_LORE_TYPE_ID
} from "$lib/shared/entries/types"
import {
	LORE_SCOPES,
	SCOPE_KIND,
	SCOPE_LABELS,
	type LoreScope
} from "./loreRoute"
import {
	emptyFilters,
	hasKeywords,
	SCENE_KIND,
	type PoolFilters,
	type PoolItem
} from "./poolFilter"

/** The kind the count of cast members is filed under, beside the type ids. */
export const CAST_KIND = "cast"

/** The kinds the pool draws, in the order the chips read them. */
export const POOL_KINDS = [
	WORLD_LORE_TYPE_ID,
	CHARACTER_LORE_TYPE_ID,
	HISTORY_TYPE_ID,
	SCENE_KIND
] as const

/** The two orderings the pool header offers. */
export const POOL_SORTS = [
	{ value: "updated-desc", label: "Recently changed" },
	{ value: "entry-date-asc", label: "Story order" }
]

export const DEFAULT_POOL_SORT = "updated-desc"

export interface ScopeFacet {
	id: LoreScope
	label: string
	/** Undefined while the server's figures are still on their way. */
	count: number | undefined
	/** Known to hold nothing, which is dim and last rather than hidden. */
	empty: boolean
}

/**
 * The kinds one scope's pool draws.
 *
 * Empty for `all`, which is every kind, and for `places`, which no declared
 * kind carries a role for yet.
 */
export function scopeKinds(scope: LoreScope): string[] {
	const kind = SCOPE_KIND[scope]
	return kind ? [kind] : []
}

/**
 * One scope's figure.
 *
 * `all` is every kind the pool draws summed, rather than a count of its own.
 * `cast` is the people, because the Cast board lists people; the lore anchored
 * to them is counted under its own kind like any other row.
 */
function countOf(scope: LoreScope, counts: Record<string, number>): number {
	if (scope === "all")
		return POOL_KINDS.reduce(
			(total, kind) => total + (counts[kind] ?? 0),
			0
		)
	if (scope === "cast") return counts[CAST_KIND] ?? 0
	if (scope === "places") return counts.places ?? 0
	const kind = SCOPE_KIND[scope]
	return kind ? (counts[kind] ?? 0) : 0
}

/**
 * The rail's scopes, with their figures, empty ones last.
 *
 * A count that has not arrived is not a count of none: nothing dims and
 * nothing moves until the server has answered.
 */
export function railScopes(
	counts: Record<string, number> | null
): ScopeFacet[] {
	const facets = LORE_SCOPES.map((id) => ({
		id,
		label: SCOPE_LABELS[id],
		count: counts ? countOf(id, counts) : undefined,
		empty: !!counts && countOf(id, counts) === 0
	}))
	return [...facets.filter((f) => !f.empty), ...facets.filter((f) => f.empty)]
}

/**
 * A book with nothing in it at all, which is the one book day one is for.
 *
 * Cast members are content: a book a session has read its people into has
 * something to draw, whether or not an entry has been written yet. An
 * unanswered count is not a count of none, so figures still on their way are
 * not an empty book.
 */
export function bookIsEmpty(counts: Record<string, number> | null): boolean {
	if (!counts) return false
	return countOf("all", counts) === 0 && countOf(CAST_KIND, counts) === 0
}

/**
 * The cast figure, taken from the list of bindings the server just sent.
 *
 * The cast is counted as the book's bindings, so the list the server sends is
 * the figure and nothing has to ask for the same number a second time. The
 * other kinds are left exactly as they were: one kind's answer says nothing
 * about the rest, and figures that have not arrived stay absent.
 */
export function mergeCastCount(
	counts: Record<string, number> | null,
	bindings: readonly { id: number }[]
): Record<string, number> | null {
	if (!counts) return null
	return { ...counts, [CAST_KIND]: bindings.length }
}

const plural = (n: number, one: string, many: string) =>
	`${n} ${n === 1 ? one : many}`

/** "30 entries · 4 reached the last turn", which is the pool said out loud. */
export function poolSummary(count: number, reached: number | null): string {
	const entries = plural(count, "entry", "entries")
	if (reached === null) return entries
	if (reached === 0) return `${entries} · nothing reached the last turn`
	return `${entries} · ${reached} reached the last turn`
}

/** Which session this book is read into, and what reached it last turn. */
export function readingLine(
	sessionName: string | null,
	reached: number | null
): string {
	if (!sessionName) return "No session is reading this book"
	if (reached === null || reached === 0)
		return `Reading into ${sessionName} · nothing reached the last turn`
	return `Reading into ${sessionName} · ${plural(
		reached,
		"entry",
		"entries"
	)} reached the last turn`
}

/**
 * What the session reading this book is doing with it.
 *
 * ⚠ "as of now" is not decoration. Retrieval never reads as-of, so the session
 * is always at now on its own line — the sentence says it because the author
 * standing at Y2 needs to know the model is not standing there with them.
 */
export function readingIntoSentence(
	lineName: string,
	reached: number | null
): string {
	const read =
		reached === null || reached === 0
			? "nothing reached the last turn"
			: `${plural(reached, "entry", "entries")} reached the last turn`
	return `Reading this book on ${lineName}, as of now · ${read}`
}

export type SavedScopeId = "needs-keywords" | "loose-ends" | "pinned"

export const SAVED_SCOPES: {
	id: SavedScopeId
	label: string
	title: string
}[] = [
	{
		id: "needs-keywords",
		label: "Needs keywords",
		title: "Nothing in a message can match these yet"
	},
	{
		id: "loose-ends",
		label: "Loose ends",
		title: "No keywords, and the newest run never read them in"
	},
	{ id: "pinned", label: "Pinned", title: "Always in the prompt" }
]

/**
 * Whether one row answers a saved scope.
 *
 * Archived rows answer none of them: they are out of the book's way on
 * purpose, and a list of chores that keeps offering them is not a list of
 * chores.
 */
export function matchesSaved(
	id: SavedScopeId,
	item: PoolItem,
	readInKeys: ReadonlySet<string>
): boolean {
	if (item.archived) return false
	switch (id) {
		case "needs-keywords":
			return !hasKeywords(item)
		case "loose-ends":
			return !hasKeywords(item) && !readInKeys.has(item.key)
		case "pinned":
			return item.pinned
	}
}

export function savedScopeCount(
	id: SavedScopeId,
	items: readonly PoolItem[],
	readInKeys: ReadonlySet<string>
): number {
	return items.filter((item) => matchesSaved(id, item, readInKeys)).length
}

/** The same question as a narrowing, so the count and the list agree. */
export function savedScopeFilters(
	id: SavedScopeId | null
): Pick<PoolFilters, "keywords" | "looseEnds" | "pinned"> {
	const base = {
		keywords: emptyFilters().keywords,
		looseEnds: false,
		pinned: false
	}
	switch (id) {
		case "needs-keywords":
			return { ...base, keywords: "none" }
		case "loose-ends":
			return { ...base, looseEnds: true }
		case "pinned":
			return { ...base, pinned: true }
		default:
			return base
	}
}

export interface FacetCounts {
	/** Only the kinds the pool actually holds, in the declared order. */
	kinds: { kind: string; count: number }[]
	readIn: number
	pinned: number
	off: number
	archived: number
	machineWritten: number
	total: number
}

/**
 * What each chip under the pool header says.
 *
 * Counted over the scope's whole pool rather than over what the chips have
 * already narrowed, so pressing one never rewrites the figure beside another.
 */
export function facetCounts(
	items: readonly PoolItem[],
	readInKeys: ReadonlySet<string>
): FacetCounts {
	const byKind = new Map<string, number>()
	const out: FacetCounts = {
		kinds: [],
		readIn: 0,
		pinned: 0,
		off: 0,
		archived: 0,
		machineWritten: 0,
		total: items.length
	}
	for (const item of items) {
		byKind.set(item.kind, (byKind.get(item.kind) ?? 0) + 1)
		if (readInKeys.has(item.key)) out.readIn++
		if (item.pinned) out.pinned++
		if (item.off) out.off++
		if (item.archived) out.archived++
		if (item.machineWritten) out.machineWritten++
	}
	const declared = POOL_KINDS.filter((kind) => byKind.has(kind))
	const others = [...byKind.keys()].filter(
		(kind) => !(POOL_KINDS as readonly string[]).includes(kind)
	)
	out.kinds = [...declared, ...others].map((kind) => ({
		kind,
		count: byKind.get(kind) ?? 0
	}))
	return out
}
