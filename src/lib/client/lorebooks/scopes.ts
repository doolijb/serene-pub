/**
 * Scope, saved scope and facet — the rail's arithmetic, over one pool.
 *
 * A scope is what is in the set, drawn through whichever lens is chosen. Every
 * scope is offered in every book: one with nothing in it sorts last and shows
 * its 0 rather than disappearing, because a facet that vanishes teaches the
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
	DEFAULT_LENS,
	LORE_SCOPES,
	reduce,
	SCOPE_KIND,
	SCOPE_LABELS,
	momentKey,
	type LoreRoute,
	type LoreScope
} from "$lib/shared/lorebooks/loreRoute"
import type { StoryDate } from "$lib/shared/lorebooks/storyDate"
import {
	CAST_KIND,
	emptyFilters,
	needsKeywords,
	SCENE_KIND,
	type PoolFilters,
	type PoolItem
} from "./poolFilter"
import { lensDrawsScope, lensListsPool } from "./lenses/registry"

/** The kind the count of cast members is filed under, beside the type ids. */
export { CAST_KIND }

/**
 * The kinds the pool draws.
 *
 * Places are a pool kind (places plan B5): a place is a pool entry with its
 * own door, so All lists it, search finds it, and the canvas is never the
 * only way to reach one.
 */
export const POOL_KINDS = [
	WORLD_LORE_TYPE_ID,
	CHARACTER_LORE_TYPE_ID,
	HISTORY_TYPE_ID,
	LOCATION_TYPE_ID,
	ITEM_TYPE_ID,
	SCENE_KIND
] as const

/**
 * The entry types the workspace loads for the whole book: every kind the
 * pool draws that is an entry. Derived from `POOL_KINDS`, so the rail's copy
 * of the book cannot drift from the pool's again (#89: items were drawn by
 * the pool and never loaded).
 */
export const BOOK_ENTRY_TYPES: readonly EntryTypeId[] = POOL_KINDS.filter(
	(kind) => kind !== SCENE_KIND
) as EntryTypeId[]

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
	if (scope === "all") return POOL_KINDS.filter((kind) => kind !== SCENE_KIND)
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
	/** Known to hold nothing, which is last rather than hidden. */
	empty: boolean
}

/**
 * The kinds one scope narrows to.
 *
 * Empty for `all`, which is every kind. `places` is its location entries —
 * the one definition of a place (decided 2026-09-28).
 */
export function scopeKinds(scope: LoreScope): string[] {
	const kind = SCOPE_KIND[scope]
	return kind ? [kind] : []
}

/**
 * One scope's figure.
 *
 * `all` is every kind the pool draws summed, the people included (note 12:
 * All lists the cast too), rather than a count of its own. `cast` is the
 * people, because the Cast board lists people; the lore anchored to them is
 * counted under its own kind like any other row.
 */
function countOf(scope: LoreScope, counts: Record<string, number>): number {
	if (scope === "all")
		return [...POOL_KINDS, CAST_KIND].reduce(
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
 * A count that has not arrived is not a count of none: nothing moves until
 * the server has answered.
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
	return countOf("all", counts) === 0
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
	// Standing where the session stands is a reading, so Book settings,
	// which is not one, is left for the route beneath it.
	return reduce(
		reduce(
			reduce(route, {
				type: "setMoment",
				moment: sessionMomentKey(session.clock)
			}),
			{ type: "setBranch", branch: session.branchId ?? undefined }
		),
		{ type: "closeSettings" }
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

/**
 * The saved scopes — the rail's Saved group, each a row like a scope's.
 * The book's chores are the Loose ends queue (note 5, `looseEnds.ts`), never
 * a saved scope; the keyword chore is also the pool's Needs keywords chip.
 */
export type SavedScopeId = "pinned"

export const SAVED_SCOPES: {
	id: SavedScopeId
	label: string
	title: string
}[] = [{ id: "pinned", label: "Pinned", title: "Always in the prompt" }]

/**
 * Whether one row answers a saved scope. Archived rows answer none: they are
 * out of the book's way on purpose.
 */
export function matchesSaved(id: SavedScopeId, item: PoolItem): boolean {
	if (item.archived) return false
	switch (id) {
		case "pinned":
			return item.pinned
	}
}

/**
 * Where choosing a saved scope takes the reader: Everything, in the same
 * lens when it lists the pool and the default lens when it does not, with
 * Book settings left. A saved scope is a row of the rail like a scope's and
 * is current INSTEAD of one, so the list it opens is the whole book: a
 * narrowing to the scope underneath would be a filter nobody can see. Which
 * lenses list the pool is the lens registry's (`listsPool`).
 *
 * Returns the route itself when nothing moves (an entry open in Everything
 * stays open), so a caller can tell a move from a stay by identity.
 */
export function savedScopeRoute(route: LoreRoute): LoreRoute {
	let next = route
	if (next.scope !== "all")
		next = reduce(next, { type: "openScope", scope: "all" })
	if (next.lens && !lensListsPool(next.lens))
		next = reduce(next, { type: "setLens", lens: DEFAULT_LENS })
	if (next.settings) next = reduce(next, { type: "closeSettings" })
	return next
}

/**
 * Each saved scope's figure — over the whole book, which is the list choosing
 * it opens (`savedScopeRoute`), so badge = list length (note 6).
 */
export function savedScopeCounts(
	items: readonly PoolItem[]
): Record<SavedScopeId, number> {
	return Object.fromEntries(
		SAVED_SCOPES.map((s) => [s.id, savedScopeCount(s.id, items)])
	) as Record<SavedScopeId, number>
}

/**
 * The words of the one chip that says which scope is chosen, under the
 * compact find row (STYLE-GUIDE §6.3: an active choice is one dismissible
 * chip). Null at Everything with no saved scope, which is no narrowing and
 * draws no chip; its × returns to Everything.
 */
export function scopeChipLabel(
	scope: LoreScope,
	saved: SavedScopeId | null
): string | null {
	if (saved) return SAVED_SCOPES.find((s) => s.id === saved)?.label ?? null
	return scope === "all" ? null : SCOPE_LABELS[scope]
}

/** "3 loose ends", the rail foot's line and the scope popout's. */
export function looseEndsLabel(count: number): string {
	return plural(count, "loose end", "loose ends")
}

/**
 * Where choosing a scope takes the reader: that scope, through the same
 * lens — unless the lens draws its own set whatever the scope (Places every
 * place, Lives every member: `drawsScope` "ignores"), where the choice would
 * change nothing on screen (the Cast × Places dead click). There it opens
 * the scope in the default lens, so a scope chosen is a scope shown.
 *
 * ⚠ Only a CHOICE moves the lens. An address that pairs a scope with such a
 * lens (`#lore=12/history?lens=places`) still draws that lens: a deep link
 * lands where it says.
 */
export function scopeRoute(route: LoreRoute, scope: LoreScope): LoreRoute {
	let next = reduce(route, { type: "openScope", scope })
	const lens = next.lens ?? DEFAULT_LENS
	if (lensDrawsScope(lens, scope) === "ignores")
		next = reduce(next, { type: "setLens", lens: DEFAULT_LENS })
	return next
}

export function savedScopeCount(
	id: SavedScopeId,
	items: readonly PoolItem[]
): number {
	return items.filter((item) => matchesSaved(id, item)).length
}

/** The same question as a narrowing, so the count and the list agree. */
export function savedScopeFilters(
	id: SavedScopeId | null
): Pick<PoolFilters, "keywords" | "needsKeywords" | "pinned"> {
	const base = {
		keywords: emptyFilters().keywords,
		needsKeywords: false,
		pinned: false
	}
	switch (id) {
		case "pinned":
			return { ...base, pinned: true }
		default:
			return base
	}
}

export interface FacetCounts {
	readIn: number
	pinned: number
	off: number
	archived: number
	machineWritten: number
	/** The Needs keywords chip's figure — `needsKeywords`, the queue's rule. */
	needsKeywords: number
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
	const out: FacetCounts = {
		readIn: 0,
		pinned: 0,
		off: 0,
		archived: 0,
		machineWritten: 0,
		needsKeywords: 0,
		total: items.length
	}
	for (const item of items) {
		if (readInKeys.has(item.key)) out.readIn++
		if (item.pinned) out.pinned++
		if (item.off) out.off++
		if (item.archived) out.archived++
		if (item.machineWritten) out.machineWritten++
		// The same rule the Loose ends queue's keyword chore uses, so the
		// chip and the queue never disagree about how many there are.
		if (!item.archived && needsKeywords(item)) out.needsKeywords++
	}
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
