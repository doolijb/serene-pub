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
	ENTRY_TYPE_IDS,
	HISTORY_TYPE_ID,
	ITEM_TYPE_ID,
	LOCATION_TYPE_ID,
	WORLD_LORE_TYPE_ID,
	type EntryTypeId
} from "$lib/shared/entries/types"
import {
	LORE_SCOPES,
	reduce,
	SCOPE_KIND,
	SCOPE_LABELS,
	type LoreRoute,
	type LoreScope
} from "$lib/shared/lorebooks/loreRoute"
import type { StoryDate } from "$lib/shared/lorebooks/storyDate"
import { momentKey } from "./timelineStrip"
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
	ITEM_TYPE_ID,
	SCENE_KIND
] as const

/**
 * The entry types the workspace loads for the whole book.
 *
 * Derived from `POOL_KINDS`, so the rail's copy of the book cannot drift from
 * the pool's again (#89: items were drawn by the pool and never loaded), plus
 * places — `core:entry/location` entries, the one definition the rail's
 * Places count and the Places board share — which the Places scope and the
 * Time lens narrow to without the pool drawing them.
 */
export const BOOK_ENTRY_TYPES: readonly EntryTypeId[] = [
	...(POOL_KINDS.filter((kind) => kind !== SCENE_KIND) as EntryTypeId[]),
	LOCATION_TYPE_ID
]

/**
 * How many entries the book holds on the line being read, from the server's
 * figures: every entry type, archived rows out. Undefined while the figures
 * are on their way.
 */
export function entryTotal(
	counts: Record<string, number> | null
): number | undefined {
	if (!counts) return undefined
	return ENTRY_TYPE_IDS.reduce((total, t) => total + (counts[t] ?? 0), 0)
}

/**
 * The kinds of entry the Time lens draws for a scope (#88).
 *
 * The line is the scope's, as every other lens is: World draws world lore,
 * Places its location entries, Cast the lore anchored to members. `all` is
 * every kind the pool draws, and Scenes keeps History — a scene has no date
 * of its own and sits at its history entry's.
 */
export function timeLensKinds(scope: LoreScope): readonly string[] {
	if (scope === "all")
		return POOL_KINDS.filter((kind) => kind !== SCENE_KIND)
	if (scope === "scenes") return [HISTORY_TYPE_ID]
	return scopeKinds(scope)
}

/** The rows the Time lens draws for a scope. */
export function timeLensEntries<T extends { typeId?: string | null }>(
	rows: readonly T[],
	scope: LoreScope
): T[] {
	const kinds = timeLensKinds(scope)
	return rows.filter((row) => kinds.includes(row.typeId ?? ""))
}

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
 * The kinds one scope narrows to.
 *
 * Empty for `all`, which is every kind. `places` is its location entries —
 * the one definition of a place (decided 2026-09-28), which the pool does
 * not draw as a door of its own.
 */
export function scopeKinds(scope: LoreScope): string[] {
	if (scope === "places") return [LOCATION_TYPE_ID]
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
 * ⚠ **Where the session stands is not decoration.** Retrieval reads the book
 * on the session's line AT its story clock when the session has one, and at
 * the head of the line ("now") when it does not (owner ruling 3,
 * 2026-09-28) — never at the moment the author has dragged to. The sentence
 * names that date because an author standing at Y2 needs to know whether the
 * model is standing there with them. `at` is the session's clock, spelled,
 * or null when it follows the line's present.
 */
export function readingIntoSentence(
	lineName: string,
	reached: number | null,
	at: string | null = null
): string {
	const read =
		reached === null || reached === 0
			? "nothing reached the last turn"
			: `${plural(reached, "entry", "entries")} reached the last turn`
	const when = at ? `as of ${at}, the session's clock` : "as of now"
	return `Reading this book on ${lineName}, ${when} · ${read}`
}

/**
 * The moment address a session reads its book at: its story clock, or
 * undefined (now, the head of the line) when it follows the line's present.
 */
export function sessionMomentKey(
	clock: StoryDate | null | undefined
): string | undefined {
	return clock ? momentKey(clock) : undefined
}

/**
 * The route that stands where the session stands: its line, at its clock.
 *
 * ONE route from both actions, so the workspace can go there in one guarded
 * transition (`loreRoute.navigateTo`) — two navigations raced and left the
 * reader at the old moment (#81).
 */
export function matchSessionRoute(
	route: LoreRoute,
	session: { branchId: number | null; clock: StoryDate | null }
): LoreRoute {
	return reduce(
		reduce(route, {
			type: "setMoment",
			moment: sessionMomentKey(session.clock)
		}),
		{ type: "setBranch", branch: session.branchId ?? undefined }
	)
}

/** The verbs for reading a book into the open session (NOMENCLATURE §8). */
export const READ_INTO_SESSION = "Read into this session"
export const STOP_READING = "Stop reading"

/** The one action a book offers the open session, named. */
export function readingActionLabel(readingHere: boolean): string {
	return readingHere ? STOP_READING : READ_INTO_SESSION
}

/**
 * The confirmation shown when reading this book would stop the session
 * reading another one — a session reads one book at a time.
 */
export function replaceReadingSentence(
	sessionName: string,
	currentBook: string,
	nextBook: string
): string {
	return (
		`${sessionName} reads ${currentBook}. Reading ${nextBook} into it ` +
		`instead stops reading ${currentBook}; nothing in either book changes.`
	)
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
	/** The saved scopes' questions, so their chips can stand in compact too. */
	needsKeywords: number
	looseEnds: number
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
		needsKeywords: 0,
		looseEnds: 0,
		total: items.length
	}
	for (const item of items) {
		byKind.set(item.kind, (byKind.get(item.kind) ?? 0) + 1)
		if (readInKeys.has(item.key)) out.readIn++
		if (item.pinned) out.pinned++
		if (item.off) out.off++
		if (item.archived) out.archived++
		if (item.machineWritten) out.machineWritten++
		// The same rule the rail's saved-scope figures use, so the chip and
		// the rail never disagree about how many there are.
		if (matchesSaved("needs-keywords", item, readInKeys)) out.needsKeywords++
		if (matchesSaved("loose-ends", item, readInKeys)) out.looseEnds++
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

/**
 * What a list says when its search and filters leave nothing — a different
 * fact from a scope with nothing in it, which is what the first-run copy is
 * for. The search is quoted back when there is one.
 */
export function nothingMatchesLine(search: string): string {
	const q = search.trim()
	return q
		? `Nothing matches “${q}” with these filters.`
		: "Nothing matches these filters."
}
