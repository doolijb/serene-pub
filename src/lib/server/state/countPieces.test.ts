/**
 * 🚧 Counted pieces (DC walk 6): a second "gains Potion of healing" merges
 * into the potion already held — a count, never a lost gain or a second row.
 */
import { describe, expect, test } from "vitest"
import { applyListOp, type SlotListItem } from "@serene-pub/sdk"
import { countPieces } from "./write"

const potion = (count?: number): SlotListItem =>
	({
		kind: "compendium",
		compendiumId: "core:ruleset/vis-itineris@1",
		pieceId: "potion-of-healing",
		version: "1.0.0",
		...(count ? { count } : {})
	}) as SlotListItem
const ropePiece = { kind: "inline", name: "Rope" } as const
const rope = ropePiece as SlotListItem

const apply = (held: SlotListItem[], op: "add" | "remove", items: SlotListItem[]) => {
	const c = countPieces(held, op, items)
	return applyListOp(c.held, c.op, c.items, {}).value
}

describe("countPieces", () => {
	test("a second gain of the same piece is a count of two", () => {
		expect(apply([potion()], "add", [potion()])).toEqual([potion(2)])
		expect(apply([potion(2)], "add", [potion(3)])).toEqual([potion(5)])
	})

	test("a new piece is added; other items go on to applyListOp as before", () => {
		expect(apply([], "add", [potion(), rope])).toEqual([potion(), rope])
	})

	test("a remove takes one (or its count) and drops the holding at zero", () => {
		expect(apply([potion(2), rope], "remove", [potion()])).toEqual([potion(), rope])
		expect(apply([potion()], "remove", [potion()])).toEqual([])
		expect(apply([potion(2)], "remove", [potion(5)])).toEqual([])
	})

	test("🚧 an inline piece is held by its name: a second of the same name is a count (Give to…, 2026-10-19)", () => {
		expect(apply([rope], "add", [{ kind: "inline", name: "rope ", count: 2 } as SlotListItem])).toEqual([{ ...ropePiece, count: 3 }])
		expect(apply([{ ...ropePiece, count: 3 } as SlotListItem], "remove", [rope])).toEqual([{ ...ropePiece, count: 2 }])
	})

	test("a set, or a change with no counted piece, passes through untouched", () => {
		const held = [potion()]
		expect(countPieces(held, "set", [potion()])).toEqual({ held, op: "set", items: [potion()] })
		expect(countPieces(held, "add", ["torch"]).held).toBe(held)
	})
})
