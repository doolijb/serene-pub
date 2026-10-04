/**
 * Where the lorebook workspace is — one object, one reducer, one address.
 *
 * Three controls over one pool, and the route is all three: the **scope** is
 * what is in the set, the **lens** is how the set is drawn, the **moment** is
 * when it is being read from. Any scope can be drawn through any lens at any
 * moment, so they are independent fields rather than a tree of modes. It is
 * pure so the whole navigation model can be tested without a component, and so
 * the same object can arrive from a click, from the URL hash, or from another
 * panel's deep link and mean exactly one thing.
 */

import {
	CHARACTER_LORE_TYPE_ID,
	HISTORY_TYPE_ID,
	ITEM_TYPE_ID,
	LOCATION_TYPE_ID,
	WORLD_LORE_TYPE_ID
} from "$lib/shared/entries/types"
import type { StoryDate } from "./storyDate"

/**
 * The kind facets, which are the navigation. Character Lore is not among them:
 * a cast member's page lists the lore anchored to them, so the facet is Cast
 * and the lore is inside it. `all` is the one pool every other scope narrows.
 */
export const LORE_SCOPES = [
	"all",
	"cast",
	"world",
	"history",
	"scenes",
	"places",
	"items"
] as const

export type LoreScope = (typeof LORE_SCOPES)[number]

/**
 * How the set is drawn — the route's spelling of each lens (`?lens=`), in the
 * lens row's order. Everything else a lens is (its label, icon, mount, what
 * it does with a scope) is its descriptor in the client's lens registry
 * (`client/lorebooks/lenses/registry.ts`), which the compiler holds to this
 * list: a lens added here and not there does not build.
 */
export const LORE_LENSES = [
	"list",
	"cards",
	"tree",
	"graph",
	"time",
	"lives",
	"places"
] as const

export type LoreLens = (typeof LORE_LENSES)[number]

/** Where a book opens when nothing says otherwise. */
export const DEFAULT_SCOPE: LoreScope = "all"
export const DEFAULT_LENS: LoreLens = "list"

/**
 * The pool kind a scope narrows to, where it has one.
 *
 * `all` has none, which is what makes it the same list with nothing narrowed.
 * `places` is its `core:entry/location` entries — the one definition of a
 * place (2026-09-28), a pool kind since places plan B5.
 */
export const SCOPE_KIND: Partial<Record<LoreScope, string>> = {
	cast: CHARACTER_LORE_TYPE_ID,
	world: WORLD_LORE_TYPE_ID,
	history: HISTORY_TYPE_ID,
	scenes: "scene",
	places: LOCATION_TYPE_ID,
	items: ITEM_TYPE_ID
}

export interface LoreRoute {
	/** null is the list of books, which is the workspace's own root. */
	lorebookId: number | null
	scope: LoreScope
	/** Entry, history entry or scene's parent — the row's kind says which. */
	entryId?: number
	/**
	 * The cast member Cast or the graph lens is on.
	 *
	 * Its own field rather than `entryId`, because Cast addresses two things
	 * at once — the member, and whichever of their anchored lore entries is
	 * open — and a cast id and an entry id are separate id spaces that would
	 * otherwise collide at the same number.
	 */
	castId?: number
	/**
	 * Scenes are a table, not an entry type, so a scene is addressed under the
	 * history entry it was compiled into rather than in `entryId`.
	 */
	sceneId?: number
	inspector?: string
	lens?: LoreLens
	/** A story-date key. Absent is now, which is the default reading. */
	moment?: string
	branch?: number
	/**
	 * Drawing this line beside main, rather than reading it.
	 *
	 * ⚠ Only meaningful with a `branch`: main has nothing to compare against
	 * itself, so leaving a branch drops it (see `setBranch`).
	 */
	compare?: boolean
}

export const SCOPE_LABELS: Record<LoreScope, string> = {
	all: "Everything",
	cast: "Cast",
	world: "World lore",
	history: "History",
	scenes: "Scenes",
	places: "Places",
	items: "Items"
}

export type LoreAction =
	| { type: "openBook"; lorebookId: number | null; scope?: LoreScope }
	| { type: "openScope"; scope: LoreScope }
	| {
			type: "openEntry"
			entryId: number
			scope?: LoreScope
			sceneId?: number
			/**
			 * The member the entry hangs off. Absent keeps the one already
			 * open (lore opened from a member's panel); `null` lets go of it
			 * (an entry node picked on the graph is not that member's).
			 */
			castId?: number | null
			inspector?: string
	  }
	| {
			type: "openCastMember"
			castId: number | null
			scope?: LoreScope
	  }
	| { type: "back" }
	| { type: "setLens"; lens: LoreLens }
	/** An absent moment is now, which is what clears the cursor. */
	| { type: "setMoment"; moment?: string }
	/**
	 * Which line is being read. Absent is `main`, which is the absence of a
	 * branch and not a branch called main.
	 */
	| { type: "setBranch"; branch?: number }
	| { type: "setCompare"; compare: boolean }

export function emptyRoute(): LoreRoute {
	return { lorebookId: null, scope: DEFAULT_SCOPE }
}

function isScope(value: string): value is LoreScope {
	return (LORE_SCOPES as readonly string[]).includes(value)
}

function isLens(value: string): value is LoreLens {
	return (LORE_LENSES as readonly string[]).includes(value)
}

/**
 * An absent field and a field set to `undefined` are the same address, so one
 * of them has to be the spelling. Absent is: it is what a hash parses to and
 * what `toEqual` compares against.
 */
function normalize(route: LoreRoute): LoreRoute {
	const next: LoreRoute = {
		lorebookId: route.lorebookId,
		scope: route.scope
	}
	if (route.entryId != null) next.entryId = route.entryId
	if (route.castId != null) next.castId = route.castId
	if (route.sceneId != null) next.sceneId = route.sceneId
	if (route.inspector) next.inspector = route.inspector
	if (route.lens) next.lens = route.lens
	if (route.moment) next.moment = route.moment
	if (route.branch != null) next.branch = route.branch
	// Only ever set alongside a branch: comparing main with main is nothing.
	if (route.compare && route.branch != null) next.compare = true
	return next
}

export function sameRoute(a: LoreRoute, b: LoreRoute): boolean {
	const x = normalize(a)
	const y = normalize(b)
	return (
		x.lorebookId === y.lorebookId &&
		x.scope === y.scope &&
		x.entryId === y.entryId &&
		x.castId === y.castId &&
		x.sceneId === y.sceneId &&
		x.inspector === y.inspector &&
		x.lens === y.lens &&
		x.moment === y.moment &&
		x.branch === y.branch &&
		x.compare === y.compare
	)
}

/**
 * Every transition, in one place. What survives a move is the rule worth
 * stating: the lens is a way of reading and outlives both the scope and the
 * book; the moment and the branch belong to one story, so they are left behind
 * with it; a selection belongs to the scope it was made in.
 */
export function reduce(route: LoreRoute, action: LoreAction): LoreRoute {
	switch (action.type) {
		case "openBook":
			return normalize({
				lorebookId: action.lorebookId,
				scope: action.scope ?? DEFAULT_SCOPE,
				lens: route.lens
			})
		case "openScope":
			return normalize({
				lorebookId: route.lorebookId,
				scope: action.scope,
				lens: route.lens,
				moment: route.moment,
				branch: route.branch
			})
		case "openEntry": {
			const base =
				action.scope && action.scope !== route.scope
					? reduce(route, {
							type: "openScope",
							scope: action.scope
						})
					: route
			return normalize({
				...base,
				entryId: action.entryId,
				sceneId: action.sceneId,
				castId:
					action.castId === null
						? undefined
						: (action.castId ?? base.castId),
				inspector: action.inspector
			})
		}
		case "openCastMember": {
			// Cast and the graph lens draw the same people, so a member
			// survives the crossing between them and nothing else does.
			const base =
				action.scope && action.scope !== route.scope
					? reduce(route, {
							type: "openScope",
							scope: action.scope
						})
					: route
			return normalize({
				...base,
				castId: action.castId ?? undefined,
				entryId: undefined,
				sceneId: undefined,
				inspector: undefined
			})
		}
		case "back":
			// The anchored entry hangs off the member, so it pops first.
			if (route.entryId != null)
				return normalize({
					...route,
					entryId: undefined,
					sceneId: undefined,
					inspector: undefined
				})
			if (route.castId != null)
				return normalize({
					...route,
					castId: undefined,
					inspector: undefined
				})
			if (route.lorebookId === null) return normalize(route)
			return reduce(route, { type: "openBook", lorebookId: null })
		case "setLens":
			return normalize({ ...route, lens: action.lens })
		case "setMoment":
			return normalize({ ...route, moment: action.moment })
		case "setBranch":
			// Leaving a line leaves its comparison with it; `normalize` drops
			// the flag anyway, and saying so here is what makes that deliberate.
			return normalize({
				...route,
				branch: action.branch,
				compare: action.branch == null ? false : route.compare
			})
		case "setCompare":
			return normalize({ ...route, compare: action.compare })
	}
}

/** Which of the compact layout's three columns-in-one is drawn. */
export type CompactStep = "list" | "editor" | "inspector"

/**
 * The compact layout walks the desk layout's columns as steps: list, then the
 * editor, then the inspector.
 *
 * Which step is drawn is a function of the address and of what is being
 * written, never of what has arrived: a row that is addressed is a step to be
 * on whether or not the list holding it has landed yet. A row being created is
 * the editor and nothing else, because an inspector reports on a stored row.
 */
export function compactStep(
	route: LoreRoute,
	state: { hasSelection: boolean; isNew: boolean }
): CompactStep {
	if (state.isNew) return "editor"
	if (!state.hasSelection) return "list"
	return route.inspector ? "inspector" : "editor"
}

/**
 * A story date as an address — the route's `moment`: `Y3`, `Y3-2`, `Y3-2-12`.
 * Lossless, the one identity a date has on the axis, and the one spelling a
 * server link and the workspace both write (`time/moment.ts` reads it back).
 */
export function momentKey(date: StoryDate): string {
	const parts = [`Y${date.year}`]
	if (date.month != null) parts.push(String(date.month))
	if (date.month != null && date.day != null) parts.push(String(date.day))
	return parts.join("-")
}

/**
 * Whether two readings are the same line (null = main) at the same moment
 * (null = now), by the moment's address — so `{ year: 3 }` and
 * `{ year: 3, month: null, day: null }` are one moment.
 */
export function sameLineAndMoment(
	a: { branchId: number | null; moment: StoryDate | null },
	b: { branchId: number | null; moment: StoryDate | null }
): boolean {
	if ((a.branchId ?? null) !== (b.branchId ?? null)) return false
	if (!a.moment || !b.moment) return !a.moment && !b.moment
	return momentKey(a.moment) === momentKey(b.moment)
}

/**
 * `#lore=12/world?lens=graph&as=Y2-harvest`. The list of books has no address —
 * it is the workspace with nothing open — so it writes an empty fragment.
 */
export function toHash(route: LoreRoute): string {
	if (route.lorebookId === null) return ""
	const r = normalize(route)
	const path = [r.lorebookId, r.scope, r.entryId]
		.filter((p) => p != null)
		.join("/")
	const query = new URLSearchParams()
	if (r.lens) query.set("lens", r.lens)
	if (r.moment) query.set("as", r.moment)
	if (r.branch != null) query.set("branch", String(r.branch))
	if (r.compare) query.set("compare", "1")
	if (r.inspector) query.set("inspector", r.inspector)
	if (r.castId != null) query.set("cast", String(r.castId))
	if (r.sceneId != null) query.set("scene", String(r.sceneId))
	const q = query.toString()
	return `#lore=${path}${q ? `?${q}` : ""}`
}

/** The drawing an address written before lenses asked for. */
const LEGACY_GRAPH_LENS: Record<string, LoreLens> = {
	relationships: "graph",
	timeline: "time",
	places: "places"
}

/**
 * A scope named before scopes were, or nothing when the segment is already one.
 *
 * The Overview is a readout on the book chip rather than a place, and Graphs is
 * three lenses rather than a place, so both land on the pool they were a view
 * of. An address that named one still names somewhere.
 */
function legacyScope(segment: string): LoreScope | null {
	if (segment === "overview" || segment === "graphs") return "all"
	return null
}

/**
 * Reads a fragment that is not ours, or is not an address at all, as "no
 * route" rather than as a default one: the panel's own state is a better
 * answer than a guess.
 */
export function fromHash(hash: string): LoreRoute | null {
	const raw = hash.startsWith("#") ? hash.slice(1) : hash
	if (!raw.startsWith("lore=")) return null
	const [path, search] = raw.slice("lore=".length).split("?")
	const [bookPart, scopePart, entryPart] = path.split("/")
	const lorebookId = Number(bookPart)
	if (!bookPart || !Number.isFinite(lorebookId)) return null
	if (!scopePart) return null
	const legacy = legacyScope(scopePart)
	if (!legacy && !isScope(scopePart)) return null
	const query = new URLSearchParams(search ?? "")
	const branch = query.get("branch")
	const scene = query.get("scene")
	const cast = query.get("cast")
	const scope = legacy ?? (scopePart as LoreScope)
	const chipped =
		scope === "all"
			? scopeForKinds(
					query.get("kinds")?.split(",").filter(Boolean) ?? []
				)
			: null
	return normalize({
		lorebookId,
		scope: chipped ?? scope,
		entryId: entryPart ? Number(entryPart) : undefined,
		castId: cast ? Number(cast) : undefined,
		sceneId: scene ? Number(scene) : undefined,
		inspector: query.get("inspector") ?? undefined,
		lens: lensFromQuery(scopePart, query),
		moment: query.get("as") ?? undefined,
		compare: query.get("compare") === "1",
		branch: branch ? Number(branch) : undefined
	})
}

/**
 * The lens an address asks for, however it spelled it.
 *
 * `lens` is the spelling; `view` named the three pool readings and `graph`
 * named the three drawings, and both are lenses now. The Graphs path with no
 * drawing named is still a graph, because that is what the reader was looking
 * at.
 */
function lensFromQuery(
	scopePart: string,
	query: URLSearchParams
): LoreLens | undefined {
	const lens = query.get("lens")
	if (lens && isLens(lens)) return lens
	const view = query.get("view")
	if (view && isLens(view)) return view
	const graph = query.get("graph")
	if (graph && LEGACY_GRAPH_LENS[graph]) return LEGACY_GRAPH_LENS[graph]
	if (scopePart === "graphs") return "graph"
	return undefined
}

/**
 * The scope a legacy kind chip narrows to, when it narrows to exactly one.
 *
 * The chips were a facet over the pool and the facet is the scope now. Several
 * kinds at once name no single scope, so the pool stands.
 */
export function scopeForKinds(kinds: readonly string[]): LoreScope | null {
	if (kinds.length !== 1) return null
	const found = (Object.keys(SCOPE_KIND) as LoreScope[]).find(
		(scope) => SCOPE_KIND[scope] === kinds[0]
	)
	return found ?? null
}

/** The breadcrumb, which is the route said out loud. */
export function describeRoute(
	route: LoreRoute,
	names?: { book?: string; entry?: string }
): string[] {
	if (route.lorebookId === null) return ["Lorebooks"]
	const crumbs = [names?.book || "Lorebook", SCOPE_LABELS[route.scope]]
	if (route.entryId != null && names?.entry) crumbs.push(names.entry)
	return crumbs
}

/**
 * What a panel hands over when it wants the workspace opened somewhere.
 *
 * One key, holding one address. A deep link that arrived as a handful of
 * co-operating keys had no single reader — every consumer re-derived where
 * "lorebook 12, history scope, entry 340" meant, and two of them could
 * disagree.
 */
export interface LoreDigestKeys {
	lore?: LoreRoute
}

/** Translates a deep link into a route, or says it was not addressed here. */
export function routeFromDigest(digest: LoreDigestKeys): LoreRoute | null {
	return digest.lore ? normalize(digest.lore) : null
}
