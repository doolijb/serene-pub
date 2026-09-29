import { getContext, setContext } from "svelte"
import type { PoolItem } from "../poolFilter"
import type { RefLink } from "../editor/refs"
import type { PoolSource } from "./types"

/**
 * What a curated row or editor may ask the workspace to do.
 *
 * The workspace owns the socket, the modals and the scene list; a section's
 * row and editor own their markup and nothing else. This is the seam between
 * them, so a curated piece never reaches for a socket of its own and the
 * modals exist once rather than once per door.
 */
export interface LorePoolCtx {
	/**
	 * Every row the BOOK holds, which is where a parent, a reference and a
	 * count are all resolved. Read rather than copied: it changes with every
	 * write the list receives.
	 *
	 * ⚠ **The book, not the open scope.** Filing crosses kinds — a history
	 * entry can be filed under a world entry — so a pool narrowed to one kind
	 * answers "nothing is filed under this" about a row that has children, and
	 * offers a Part of picker missing most of the book.
	 */
	readonly pool: readonly PoolItem[]
	/**
	 * The book's typed edges, as the Refs board reads them.
	 *
	 * Empty until the graph read lands, which is a different fact from a
	 * book nobody has drawn an edge in — and both are drawn the same way,
	 * because a board that claimed an entry has no links while the read is
	 * in flight would be wrong more often than it was right.
	 */
	readonly links: readonly RefLink[]
	/**
	 * The line a row written here lands on — the line being read (null =
	 * main). A new row may only be filed under an entry it can see from
	 * there: never another line's own entry (`canFileUnder`).
	 */
	readonly newRowBranchId: number | null
	/**
	 * Which conversation is reading this book, for the copy that names it.
	 * Both null when none is.
	 */
	readonly reading: { sessionId: number | null; sessionName: string | null }
	/**
	 * Files one row under another, or at the top level — the `anchorEntryId`
	 * write a drag makes. The workspace owns the socket, so a row dropped on a
	 * row never reaches for one of its own.
	 */
	reparent(childKey: string, parentKey: string | null): void
	/** Scenes compiled into one history entry, in list order. */
	scenesOf(historyEntryId: number): Sockets.Scenes.SceneWithMeta[]
	/** Whether this entry holds the latest date the book knows about. */
	isCurrentDate(historyEntryId: number): boolean
	/** A cast member's name, for a scene's participant and mention chips. */
	bindingName(bindingId: number): string
	/**
	 * The name a `{{char:N}}` slot stands for, or null when nobody fills it.
	 *
	 * ⚠ Keyed on the TOKEN, not on a row id: the N in `{{char:1}}` is the
	 * book's own slot number and a binding's id is a database key, and the two
	 * are the same number only by coincidence.
	 */
	bindingForTag(tag: string): string | null
	/** Opens the compile flow for a history entry, resuming a pending run. */
	openCompile(entry: PoolSource): void
	/** Opens the scene processing flow, resuming a pending run. */
	openProcess(sceneId: number, activityId?: string | null): void
	/** Re-reads the book's scenes after a write the socket does not echo. */
	refreshScenes(): void
	/** Opens the Graphs section. Absent when the book has graphs off. */
	onNavigateToGraph?: () => void
}

const KEY = Symbol("lorePool")

export function setLorePoolCtx(ctx: LorePoolCtx): void {
	setContext(KEY, ctx)
}

/**
 * The workspace always provides this, so a missing context means a curated
 * piece is being rendered outside the workspace — an inert one is a better
 * answer there than a crash.
 */
const INERT: LorePoolCtx = {
	pool: [],
	links: [],
	newRowBranchId: null,
	reading: { sessionId: null, sessionName: null },
	reparent: () => {},
	scenesOf: () => [],
	isCurrentDate: () => false,
	bindingName: (id) => `#${id}`,
	bindingForTag: () => null,
	openCompile: () => {},
	openProcess: () => {},
	refreshScenes: () => {}
}

export function getLorePoolCtx(): LorePoolCtx {
	return getContext<LorePoolCtx>(KEY) ?? INERT
}
