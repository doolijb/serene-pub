/**
 * The lens contract — what a lens IS (its descriptor) and what it is handed
 * (its props). DESIGN-lorebooks-ui-modularity §4; plan B4's last unit.
 *
 * A lens is how the scope's set is drawn. Before this, a lens was ten touch
 * points across seven files (the id union, a label map, an icon map, the
 * canvas map, the dispatch ladder, the day-one bypass list, the saved-scope
 * list, the queue's lens…). Now it is one descriptor in `registry.ts`, and —
 * when it draws a screen no other lens draws — one mount in `mounts.ts`.
 *
 * ⚠ Two halves on purpose. The descriptor is pure data (no component), so the
 * route's helpers, `scopes.ts` and a lens screen reading its own empty copy
 * can import it without importing every lens screen — `registry.ts` → a lens
 * screen → `scopes.ts` → `registry.ts` would be a cycle through the whole
 * workspace. The descriptor names its mount by id; `mounts.ts` holds the
 * components.
 */

import type { Component } from "svelte"
import type { Line } from "$lib/shared/lorebooks/lineReading"
import type { LoreLens, LoreRoute, LoreScope } from "$lib/shared/lorebooks/loreRoute"
import type { StoryDate } from "$lib/shared/lorebooks/storyDate"
import type { LoreLayoutMode } from "../layoutMode"
import type { LoreDrawing } from "../graphs"
import type { CastPoolItem } from "../castPool"
import type { RefLink } from "../editor/refs"
import type { ChoreField, LooseEnd } from "../looseEnds"
import type { EntryDecisions } from "../markers"
import type { PoolFilters, PoolItem } from "../poolFilter"
import type { PoolSource } from "../sections/types"
import type { TimeSessionRow } from "../time/storyTime"

/**
 * What a lens does with the scope the reader is in.
 *
 * - `draws` — the lens draws the scope's set (List draws World lore's rows,
 *   Time its dated ones, Graph narrows its denominator to them).
 * - `ignores` — the lens draws its own set whatever the scope: Places draws
 *   every place, Lives every member. Choosing a scope under it would change
 *   nothing on screen (the Cast × Places dead click, design §2), so choosing
 *   one opens it in the default lens instead (`scopeRoute`).
 *
 * ⚠ The design's third value, `overrides`, is not here: the Cast board is the
 * pool lenses' own page for the Cast scope (`PoolMount`), so no scope
 * overrides a lens.
 */
export type LensScopeRule = "draws" | "ignores"

/**
 * The book's lists a lens reads from `BookData`. Declared so a lens's reads
 * are a contract the mount test checks (`lensMounts.dom.test.ts`), not a
 * habit: a lens that starts reading a list it does not declare fails it.
 */
export type LensReads =
	| "rows"
	| "rawRows"
	| "cast"
	| "scenes"
	| "allScenes"
	| "suggestions"
	| "duplicates"

/**
 * Which mount draws a lens (`mounts.ts`). Several lenses can share one: List,
 * Cards and Tree are one pool drawn three ways, Graph and Places one canvas
 * drawing two things — so moving between them never remounts the screen.
 */
export type LensMountId = "pool" | "drawing" | "time" | "lives"

/** What a lens says when it has nothing to draw. */
export interface LensEmptyCopy {
	message: string
}

export interface LensDescriptor {
	/** The route's spelling (`?lens=`); the registry holds every `LORE_LENSES` id. */
	readonly id: LoreLens
	/** The lens row's label, and the button's name. */
	readonly label: string
	/** NOMENCLATURE §22: the lens's icon is canon here (I2, declared source). */
	readonly icon: Component<any>
	/** Which screen draws it. */
	readonly mount: LensMountId
	/** What it does with each scope. */
	drawsScope(scope: LoreScope): LensScopeRule
	/**
	 * Whether it draws the pool as a list a saved scope (Pinned) can narrow.
	 * A saved scope chosen under a lens that does not opens the default lens.
	 */
	readonly listsPool: boolean
	/** The lens the Loose ends queue is drawn on — exactly one has it. */
	readonly holdsQueue?: true
	/**
	 * Whether it draws its own empty state rather than standing behind day
	 * one: a lens that draws something other than the pool (#82). The pool
	 * lenses meet day one in an empty book, as Everything / List always has.
	 */
	readonly bypassesDayOne: boolean
	/** The canvas it asks the drawing mount for, when it is a drawing. */
	readonly drawing?: LoreDrawing
	/** The book's lists it reads (see `LensReads`). */
	readonly reads: readonly LensReads[]
	/**
	 * Its own empty state's sentence. Absent on the pool lenses: an empty
	 * pool says the SCOPE's empty copy (`SectionDescriptor.emptyCopy`).
	 */
	readonly empty?: LensEmptyCopy
	/**
	 * The keyboard shortcut, in `aria-keyshortcuts` spelling. Heard while
	 * focus is inside the workspace and not in a field (`lensForKey`).
	 */
	readonly shortcut: string
	/**
	 * Why it cannot be drawn yet, or null while it can. Every lens is
	 * drawable today; this is the one seam a future gate belongs in, rather
	 * than being re-derived in markup (was `graphs.ts` `lensReason`).
	 */
	reason?(): string | null
}

/**
 * The workspace's state and verbs every lens is drawn with — the **lens
 * bench**, one stable object of getters the workspace builds once, so a lens
 * reading `bench.filters` follows the filters and nothing else (a spread of
 * a derived object would re-run every reader on any change).
 *
 * ⚠ Not the book: the book's lists are `BookData` (context). The bench is
 * what the workspace holds that is not book data — the reading, the layout,
 * the pool's narrowing, the session's marks, the queue — plus the verbs that
 * leave through the workspace (lens, member, filters, queue). It is the
 * dispatch ladder's wiring, typed in one place; the design's `LensProps`
 * (reading / data / pool / select / layout) is where it narrows to next.
 */
export interface LensBench {
	readonly route: LoreRoute
	readonly mode: LoreLayoutMode
	/** The line being read, ancestor chain and fork cuts included. */
	readonly line: Line
	/** The moment being read, as a date; null at now. */
	readonly moment: StoryDate | null
	/** The branch being read's name; null on main. */
	readonly branchName: string | null
	/** Every row in the book, as the pool reads them (Everything's list). */
	readonly bookPool: PoolItem[]
	/** The cast on this line, as Everything lists them. */
	readonly castItems: CastPoolItem[]
	/** The links the line being read draws, for the editor's references. */
	readonly bookLinks: RefLink[]
	readonly filters: PoolFilters
	/** What the newest run read in, by pool key; null when nobody is reading. */
	readonly readInKeys: ReadonlySet<string> | null
	readonly decisions: EntryDecisions | null
	/** What the same run did with the graph, for the graph lens's ceiling. */
	readonly runRelationships:
		| Sockets.Entries.RecentDecisions.Response["relationships"]
		| null
	/** The session reading this book, for the Time lens. */
	readonly timeSession: TimeSessionRow | null
	readonly presences: readonly Sockets.Amendments.Presence[]
	/** The cast, named as the rest of the workspace names them, for Lives. */
	readonly livesMembers: readonly { id: number; name: string }[]
	/** The Loose ends queue, while it is open. */
	readonly queue: {
		rows: LooseEnd[]
		currentId: string | null
		onOpen: (row: LooseEnd) => void
		onNext: () => void
		onLeave: () => void
	} | null
	/** Ask the entry editor to focus a field (a loose end's fix). */
	readonly focusField: { entryId: number; field: ChoreField; n: number } | null
	/** Ask the Cast board to open Suggestions or Duplicates. */
	readonly suggestionsRequest: {
		tab: "suggestions" | "duplicates"
		n: number
	} | null
	/** A save in the entry editor while the queue is open: on to the next. */
	readonly onSaved: ((entryId: number) => void) | undefined
	/** The one resolver: rows as they read at the moment, on the line. */
	readonly resolveRows: (rows: readonly PoolSource[]) => PoolSource[]
	readonly resolveCast: <T extends { id: number }>(rows: readonly T[]) => T[]
	readonly amendmentsFor: (entryId: number) => Sockets.Amendments.EntryRow[]
	readonly castAmendmentsFor: (castId: number) => Sockets.Amendments.CastRow[]
	openLens(lens: LoreLens): void
	openMember(castId: number): void
	applyFilters(next: PoolFilters): void
	leaveQueue(): void
}

/** What the workspace hands every mount. */
export interface LensProps {
	/** The lens being drawn — List, Cards and Tree share one mount. */
	lens: LensDescriptor
	lorebookId: number
	bench: LensBench
	/** Whether the lens holds an edit not yet saved — the guard's question. */
	hasUnsavedChanges: boolean
}
