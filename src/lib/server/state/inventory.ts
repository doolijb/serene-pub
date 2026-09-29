/**
 * 🚧 The `inventory` stat, as the item writers address it.
 *
 * ⚠ **Not a feature** (owner ruling 2026-09-25): inventory is the list-shaped
 * stat `core:slot/inventory@1`, and an item moving is an ordinary list change
 * on it — `add` / `remove` of a lore reference with a held count. This module
 * holds only the one translation every item writer shares (the
 * `give_item` / `take_item` tools, the keeper's item arm in
 * `resolve-state-changes`, and the boot move of old proposals), so a signed
 * delta means the same list change wherever it is written.
 *
 * Pure: no database, no registry, no core-catalog import (its side effects are
 * the registry's business), so the expression evaluator can key on it too.
 */

import type { StateOwner } from "$lib/server/state/owners"

/** `core:slot/inventory@1` — core-catalog's `inventorySlot.id`, pinned by test. */
export const INVENTORY_SLOT_ID = "core:slot/inventory@1"

/** The list change a signed delta of one item is: + adds, − removes. */
export interface InventoryChange {
	owner: StateOwner
	slotId: typeof INVENTORY_SLOT_ID
	op: "add" | "remove"
	items: [{ entryId: number; count: number }]
	base?: number | null
}

/**
 * `{ owner, entryId, delta }` → an `add` or `remove` on the owner's inventory,
 * by the delta's size. A delta of zero is not a change and returns null; a
 * fraction is truncated toward zero, as the edge writer did.
 */
export function inventoryChange(
	owner: StateOwner,
	entryId: number,
	delta: number,
	base?: number | null
): InventoryChange | null {
	const d = Math.trunc(delta)
	if (!Number.isFinite(d) || d === 0) return null
	return {
		owner,
		slotId: INVENTORY_SLOT_ID,
		op: d > 0 ? "add" : "remove",
		items: [{ entryId, count: Math.abs(d) }],
		...(base != null ? { base } : {})
	}
}
