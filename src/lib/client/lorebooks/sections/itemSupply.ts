/**
 * 🚧 An item's **supply** as the lorebook's item editor edits it (attributes
 * phase 3c): how many of the thing the world has — one (`unique`), a stated
 * number (`limited`, `supplyLimit` of them) or as many as anybody likes
 * (`unlimited`). The other half of the count is on the holder (a list item's
 * held count); nothing here enforces either — genre pipelines read
 * `core:query/item-supply@1` and decide.
 *
 * Mirrors `core-catalog`'s `itemSupplyOf` reading on the way in, so the
 * editor opens on the answer a pipeline would read: a `limited` row with no
 * whole limit reads unlimited there, and the editor says it needs one here.
 */
import type { EntryFieldsByType, ITEM_TYPE_ID } from "$lib/shared/entries/types"

export type ItemSupplyMode = EntryFieldsByType[typeof ITEM_TYPE_ID]["supply"]

/** In the order the editor offers them. */
export const ITEM_SUPPLY_MODES: readonly ItemSupplyMode[] = ["unique", "limited", "unlimited"]

export const ITEM_SUPPLY_LABELS: Record<ItemSupplyMode, string> = {
	unique: "One of a kind",
	limited: "Limited",
	unlimited: "Unlimited"
}

/** The line under the control, per mode. */
export const ITEM_SUPPLY_HINTS: Record<ItemSupplyMode, string> = {
	unique: "There is exactly one. Whoever holds it, nobody else can.",
	limited: "The world has this many, all told, across everybody who holds one.",
	unlimited: "As many as anybody likes: rations, arrows, coins."
}

const isMode = (v: unknown): v is ItemSupplyMode =>
	typeof v === "string" && (ITEM_SUPPLY_MODES as readonly string[]).includes(v)

/** The mode a draft is in; a missing or unknown one is the declared default, unlimited. */
export const supplyModeOf = (draft: Record<string, any>): ItemSupplyMode =>
	isMode(draft.supply) ? draft.supply : "unlimited"

const isWholeLimit = (v: unknown): v is number =>
	typeof v === "number" && Number.isInteger(v) && v >= 1

/**
 * Switch a draft's mode. A limited supply opens on the limit it had, or one;
 * any other mode drops the limit, since nothing reads it there.
 */
export function setSupplyMode(draft: Record<string, any>, mode: ItemSupplyMode): void {
	draft.supply = mode
	if (mode === "limited") draft.supplyLimit = isWholeLimit(draft.supplyLimit) ? draft.supplyLimit : 1
	else draft.supplyLimit = null
}

/**
 * Why a draft's supply cannot be saved, in words; null when it can. Only a
 * limited supply has a rule: a whole number of at least one — `bind:value`
 * on an emptied number field is `null`, which is not a limit.
 */
export function supplyProblem(draft: Record<string, any>): string | null {
	if (supplyModeOf(draft) !== "limited") return null
	return isWholeLimit(draft.supplyLimit) ? null : "A limited supply needs how many exist: a whole number, 1 or more."
}

/**
 * What a row says of its supply, or "" for an unlimited one — the common
 * case, which says nothing rather than filling every row with the default.
 */
export function supplySummary(source: Record<string, any>): string {
	const mode = supplyModeOf(source)
	if (mode === "unique") return "One of a kind"
	if (mode === "limited" && isWholeLimit(source.supplyLimit))
		return source.supplyLimit === 1 ? "1 exists" : `${source.supplyLimit} exist`
	return ""
}
