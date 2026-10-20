/**
 * 🚧 *Mark goals reached* reads a tick (lane 2 of PLAN-genre-restructure,
 * 2026-10-19): which goals a write of the goals note newly ticked.
 */
import { describe, expect, it } from "vitest"
import { newlyReached, reachedGoals } from "./goalsReached"

describe("the goals note's ticks", () => {
	it("reads ticked goals in any checklist spelling, by their words", () => {
		const note = "- [x] Find the key\n* [X]  Reach   the tower \n- [ ] Free Rell\n[✓] Light the beacon\nplain line"
		expect([...reachedGoals(note).values()]).toEqual(["Find the key", "Reach the tower", "Light the beacon"])
		expect(reachedGoals(undefined).size).toBe(0)
	})

	it("only what this write ticked counts — not a goal already ticked, nor one unticked", () => {
		const before = "- [x] Find the key\n- [ ] Free Rell"
		expect(newlyReached(before, "- [x] Find the key\n- [x] Free Rell")).toEqual(["Free Rell"])
		expect(newlyReached(before, "- [x] find the KEY\n- [ ] Free Rell")).toEqual([])
		expect(newlyReached(before, "- [ ] Find the key")).toEqual([])
		expect(newlyReached(undefined, "- [x] First")).toEqual(["First"])
	})
})
