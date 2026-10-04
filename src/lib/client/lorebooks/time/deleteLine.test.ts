/**
 * What the delete confirmation for a line says (BranchChip), sentence by
 * sentence — the server's `amendments:deleteBranch` is what it describes.
 */
import { describe, expect, it } from "vitest"
import { deleteLineWarning } from "./deleteLine"
import type { StoryDate } from "$lib/shared/lorebooks/storyDate"

const spell = (d: StoryDate) => `Year ${d.year}`

describe("deleteLineWarning", () => {
	it("names what goes, the stats recorded on the line included, and where a dated line's sessions and clocks go", () => {
		expect(
			deleteLineWarning(
				{ name: "Exile", leftFrom: "main", forkDate: { year: 3, month: null, day: null }, hasForks: false },
				spell
			)
		).toEqual([
			"removes everything written on it: its amendments, its own entries, its scenes, the relationships drawn on it, the placements made on it and the stats recorded on it.",
			"A place written only on it takes all its stats with it, wherever they were recorded.",
			"Shared entries stay.",
			"Sessions played on it move to main, the line it forked from.",
			"A session's story clock stays where it is, unless it is later than Year 3, where Exile forked; then it goes back to Year 3."
		])
	})

	it("a line forked at now keeps every clock", () => {
		expect(
			deleteLineWarning({ name: "Exile", leftFrom: "Crown", forkDate: null, hasForks: false }, spell).slice(3)
		).toEqual(["Sessions played on it move to Crown, the line it forked from, and keep their story clock."])
	})

	it("a line with forks says where they go and what they keep", () => {
		expect(
			deleteLineWarning({ name: "Exile", leftFrom: "main", forkDate: null, hasForks: true }, spell).slice(4)
		).toEqual([
			"Lines forked from it will fork straight from main, at the earlier of the two fork dates.",
			"They lose what was written on Exile and what they wrote about its entries.",
			"A history entry of Exile that something of theirs is dated by, filed under or written about moves to them instead, so their stats, links and scenes keep their dates."
		])
	})
})
