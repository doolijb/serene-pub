/**
 * The one pool, as arithmetic.
 *
 * Every section of the lorebook workspace draws the same list of the same
 * rows; a section is a preset over this, not a list of its own. So the
 * narrowing, the ordering and the nesting live here as pure functions over a
 * flat shape, and the components above only render what comes back. A rule
 * about which rows a user can see is a rule worth being able to test without
 * a browser.
 */

/** The kind a scene's rows are filed under; every other kind is a type id. */
export const SCENE_KIND = "scene"

/**
 * One row of the pool, whatever table it came from.
 *
 * `key` and not `id`: entries and scenes are separate id spaces, and the tree
 * resolves an anchor by key, so an entry id 3 and a scene id 3 have to be
 * distinguishable or a scene nests under the wrong parent.
 */
export interface PoolItem {
	key: string
	id: number
	/** The declared type id, or `SCENE_KIND`. Never shown as "entry type". */
	kind: string
	name: string
	content: string
	/** Comma-delimited, as authored. */
	keys: string
	pinned: boolean
	/**
	 * Switched off and kept in front of the author. Listed like any other row,
	 * because a switch is a thing to see and change.
	 */
	off: boolean
	/**
	 * Put out of the way and kept. The pool hides these until asked, because a
	 * book that shows everything it has ever held is a book nobody can read.
	 */
	archived: boolean
	/** Written by a summarizer or a graph build rather than by a person. */
	machineWritten: boolean
	/** The row this one hangs off, by key, or null for a root. */
	parentKey: string | null
	/** The `order` role's value — History's date. Its position elsewhere. */
	order: number
	position: number
	/** 0 for a kind that declares no priority, which earns no bonus. */
	priority: number
	createdAt: number
	updatedAt: number
}

/** Whether the pool shows rows that have keywords, rows that do not, or both. */
export type KeywordFilter = "any" | "has" | "none"

export interface PoolFilters {
	search: string
	/** Empty is every kind, never no kinds. */
	kinds: string[]
	pinned: boolean
	off: boolean
	archived: boolean
	machineWritten: boolean
	/** What the attached session's newest run read into the prompt. */
	readIn: boolean
	/** No keywords and never read in: nothing can reach it. */
	looseEnds: boolean
	keywords: KeywordFilter
}

export function emptyFilters(): PoolFilters {
	return {
		search: "",
		kinds: [],
		pinned: false,
		off: false,
		archived: false,
		machineWritten: false,
		readIn: false,
		looseEnds: false,
		keywords: "any"
	}
}

/** What the compact layout's Filter badge counts: the narrowings in force. */
export function activeFilterCount(filters: PoolFilters): number {
	let n = 0
	if (filters.kinds.length) n++
	if (filters.pinned) n++
	if (filters.off) n++
	if (filters.archived) n++
	if (filters.machineWritten) n++
	if (filters.readIn) n++
	if (filters.looseEnds) n++
	if (filters.keywords !== "any") n++
	return n
}

export const hasKeywords = (item: PoolItem) => item.keys.trim().length > 0

/**
 * The pool, narrowed.
 *
 * Search matches name, keywords and content, which is the behaviour the three
 * toolbars had; an empty query returns the pool unfiltered rather than an
 * empty one. `readInKeys` is what the attached session's newest run reached,
 * which is the one facet that is not a fact about the row itself.
 */
export function filterPool(
	items: readonly PoolItem[],
	filters: PoolFilters,
	readInKeys: ReadonlySet<string> = new Set()
): PoolItem[] {
	const needle = filters.search.trim().toLowerCase()
	const kinds = filters.kinds.length ? new Set(filters.kinds) : null
	return items.filter((item) => {
		if (kinds && !kinds.has(item.kind)) return false
		if (item.archived !== filters.archived) return false
		if (filters.pinned && !item.pinned) return false
		if (filters.off && !item.off) return false
		if (filters.machineWritten && !item.machineWritten) return false
		if (filters.readIn && !readInKeys.has(item.key)) return false
		if (
			filters.looseEnds &&
			(hasKeywords(item) || readInKeys.has(item.key))
		)
			return false
		if (filters.keywords === "has" && !hasKeywords(item)) return false
		if (filters.keywords === "none" && hasKeywords(item)) return false
		if (!needle) return true
		return (
			item.name.toLowerCase().includes(needle) ||
			item.keys.toLowerCase().includes(needle) ||
			item.content.toLowerCase().includes(needle)
		)
	})
}

/**
 * The list toolbar's comparator, over the pool's flat shape.
 *
 * ⚠ **Pinned wins over priority, and only over priority.** A pinned row is in
 * the prompt whatever it scored, so a list sorted by importance that buries it
 * is lying; the date and position orderings say nothing about importance and
 * so do not reorder for it. The two date orderings read the `order` role,
 * which is what makes them mean anything for History and nothing elsewhere.
 */
export function comparePoolBy(
	orderBy: string
): (a: PoolItem, b: PoolItem) => number {
	const pinned = (i: PoolItem) => (i.pinned ? 1 : 0)
	return (a, b) => {
		switch (orderBy) {
			case "position-asc":
				return a.position - b.position
			case "position-desc":
				return b.position - a.position
			case "priority-desc":
				if (pinned(a) !== pinned(b)) return pinned(b) - pinned(a)
				return b.priority - a.priority
			case "priority-asc":
				if (pinned(a) !== pinned(b)) return pinned(a) - pinned(b)
				return a.priority - b.priority
			case "created-desc":
				return b.createdAt - a.createdAt
			case "created-asc":
				return a.createdAt - b.createdAt
			case "updated-desc":
				return b.updatedAt - a.updatedAt
			case "updated-asc":
				return a.updatedAt - b.updatedAt
			case "entry-date-desc":
				return b.order - a.order
			case "entry-date-asc":
				return a.order - b.order
			default:
				return 0
		}
	}
}

export interface PoolTreeNode {
	item: PoolItem
	children: PoolTreeNode[]
}

/**
 * The pool as a forest, nested by each row's anchor.
 *
 * Roots come first and each row's children follow it. A row whose anchor
 * names something not in the pool is a root, and so is a row whose anchors
 * lead back to itself: an unreachable row is worse than a mis-placed one, and
 * the list is the only place some of these rows can be repaired from.
 */
export function buildTree(items: readonly PoolItem[]): PoolTreeNode[] {
	const byKey = new Map<string, PoolItem>()
	for (const item of items) byKey.set(item.key, item)

	const parentOf = (item: PoolItem): PoolItem | null => {
		if (!item.parentKey) return null
		const parent = byKey.get(item.parentKey)
		if (!parent || parent.key === item.key) return null
		// Walk up from the candidate parent; meeting this row again means the
		// anchors form a ring and nothing in it is anybody's child.
		const seen = new Set<string>([item.key])
		let cursor: PoolItem | undefined = parent
		while (cursor) {
			if (seen.has(cursor.key)) return null
			seen.add(cursor.key)
			cursor = cursor.parentKey ? byKey.get(cursor.parentKey) : undefined
		}
		return parent
	}

	const nodes = new Map<string, PoolTreeNode>()
	for (const item of items) nodes.set(item.key, { item, children: [] })

	const roots: PoolTreeNode[] = []
	for (const item of items) {
		const node = nodes.get(item.key)!
		const parent = parentOf(item)
		if (parent) nodes.get(parent.key)!.children.push(node)
		else roots.push(node)
	}
	return roots
}

/** Whether the tree view has anything to show that the list does not. */
export function hasNesting(items: readonly PoolItem[]): boolean {
	const keys = new Set(items.map((i) => i.key))
	return items.some((i) => i.parentKey && keys.has(i.parentKey))
}

export interface PoolTreeRow {
	item: PoolItem
	depth: number
	hasChildren: boolean
	collapsed: boolean
}

/** The forest as rows to render, with everything under a collapsed row left out. */
export function flattenTree(
	nodes: readonly PoolTreeNode[],
	collapsed: ReadonlySet<string>,
	depth = 0
): PoolTreeRow[] {
	const rows: PoolTreeRow[] = []
	for (const node of nodes) {
		const isCollapsed = collapsed.has(node.item.key)
		rows.push({
			item: node.item,
			depth,
			hasChildren: node.children.length > 0,
			collapsed: isCollapsed
		})
		if (!isCollapsed && node.children.length)
			rows.push(...flattenTree(node.children, collapsed, depth + 1))
	}
	return rows
}
