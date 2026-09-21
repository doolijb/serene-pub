import { describe, expect, it } from "vitest"
import { zoneIsFull } from "./zoneFull"
import type { GsLayout } from "./GridStackZone.svelte"

const at = (x: number, y: number, w: number, h: number, id = `w${x}${y}`) => ({
	id,
	x,
	y,
	w,
	h
})

describe("zoneIsFull", () => {
	it("is not full when there is no arrangement, or nothing in it", () => {
		expect(zoneIsFull(undefined)).toBe(false)
		expect(zoneIsFull({ cols: 4, rows: 4, items: [] })).toBe(false)
	})

	it("is not full while cells are left over", () => {
		const l: GsLayout = {
			cols: 4,
			rows: 4,
			items: [at(0, 0, 4, 2), at(0, 2, 2, 2)]
		}
		expect(zoneIsFull(l)).toBe(false)
	})

	it("is full when the items account for every cell", () => {
		// The middle zone's normal state: one GROW widget over the whole grid.
		expect(
			zoneIsFull({ cols: 15, rows: 16, items: [at(0, 0, 15, 16)] })
		).toBe(true)
		expect(
			zoneIsFull({
				cols: 4,
				rows: 4,
				items: [at(0, 0, 4, 2), at(0, 2, 2, 2), at(2, 2, 2, 2)]
			})
		).toBe(true)
	})
})
