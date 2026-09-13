/**
 * An inventory, read two ways.
 *
 * A possession is an edge — this owner is carrying this entry, this many — so
 * an inventory is those edges grouped, never a list of its own. Both readings
 * here are of the same edges: down the owners (who has what) or down the items
 * (who has this). Neither may invent a line or lose one.
 *
 * An owner carrying nothing is still a group, because the empty group is where
 * you drop something to give it to them.
 */

/** One edge, as the resolved state publishes it. */
export interface PossessionLine {
	entryId: number
	name: string
	quantity: number
}

/** An owner a possession can belong to: a cast member, or the world. */
export interface InventoryOwner {
	key: string
	label: string
	kind: "session" | "session_cast"
	id: number
}

export interface OwnerGroup {
	key: string
	label: string
	/**
	 * The owner a write names, or `null` for a key no owner answers to — a
	 * character who has left the cast still shows what they were carrying, and
	 * nothing may be moved onto or off them until they are back.
	 */
	owner: InventoryOwner | null
	items: PossessionLine[]
}

export interface ItemHolder {
	key: string
	label: string
	quantity: number
}

export interface ItemGroup {
	entryId: number
	name: string
	total: number
	holders: ItemHolder[]
}

const held = (lines: PossessionLine[] | undefined): PossessionLine[] =>
	(lines ?? []).filter((l) => l.quantity > 0)

const byName = (a: { name: string }, b: { name: string }) =>
	a.name.localeCompare(b.name)

/**
 * One group per owner, in the order the owners were given, followed by any key
 * the owner list does not name.
 *
 * Stable ordering matters more than it looks: a group that reshuffled on every
 * write would move the row under the pointer mid-drag.
 */
export function groupByOwner(
	possessions: Record<string, PossessionLine[]>,
	owners: InventoryOwner[],
	opts: { showWorld?: boolean } = {}
): OwnerGroup[] {
	const showWorld = opts.showWorld ?? true
	const shown = owners.filter((o) => showWorld || o.kind !== "session")
	const groups: OwnerGroup[] = shown.map((owner) => ({
		key: owner.key,
		label: owner.label,
		owner,
		items: held(possessions[owner.key]).sort(byName)
	}))
	for (const [key, lines] of Object.entries(possessions)) {
		if (owners.some((o) => o.key === key)) continue
		const items = held(lines)
		if (!items.length) continue
		groups.push({ key, label: key, owner: null, items: items.sort(byName) })
	}
	return groups
}

/** One row per item, naming every owner holding it and how many. */
export function groupByItem(
	possessions: Record<string, PossessionLine[]>,
	owners: InventoryOwner[]
): ItemGroup[] {
	const labelOf = new Map(owners.map((o) => [o.key, o.label]))
	// Owner order first, so an item's holders read in the same order the owner
	// groups do; the items themselves are then sorted by name.
	const keys = [
		...owners.map((o) => o.key).filter((k) => k in possessions),
		...Object.keys(possessions).filter(
			(k) => !owners.some((o) => o.key === k)
		)
	]
	const items = new Map<number, ItemGroup>()
	for (const key of keys)
		for (const line of held(possessions[key])) {
			const group = items.get(line.entryId) ?? {
				entryId: line.entryId,
				name: line.name,
				total: 0,
				holders: []
			}
			group.total += line.quantity
			group.holders.push({
				key,
				label: labelOf.get(key) ?? key,
				quantity: line.quantity
			})
			items.set(line.entryId, group)
		}
	return [...items.values()].sort(byName)
}
