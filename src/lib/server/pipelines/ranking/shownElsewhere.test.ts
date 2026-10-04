import { describe, expect, it } from "vitest"
import {
	markShownElsewhere,
	shownEntryIds,
	SHOWN_ELSEWHERE_REASON
} from "./shownElsewhere"
import { select } from "./select"
import { withDefaults } from "./weights"

const lore = (id: number, source = "worldLore") => ({
	id,
	source,
	tokens: 10,
	signals: { keyword: 1 }
})

describe("the room rule (rank-hybrid `shownElsewhere`)", () => {
	it("reads one id, a list, or nested lists, and skips everything else", () => {
		expect([...shownEntryIds(7)]).toEqual([7])
		expect([...shownEntryIds([7, null, [8, "9", 1.5]])].sort()).toEqual([7, 8])
		expect(shownEntryIds(null).size).toBe(0)
		expect(shownEntryIds(undefined).size).toBe(0)
	})

	it("marks the lore entry the prompt shows, in either spelling of history", () => {
		const { items, marked } = markShownElsewhere(
			[lore(1), lore(2, "characterLore"), lore(1, "historyEntry"), lore(3)],
			[1, 2]
		)
		expect(marked).toBe(3)
		expect(items.map((c: any) => c.ineligible?.reason ?? null)).toEqual([
			SHOWN_ELSEWHERE_REASON,
			SHOWN_ELSEWHERE_REASON,
			SHOWN_ELSEWHERE_REASON,
			null
		])
	})

	it("never touches a message or relationship that shares the number", () => {
		const { items, marked } = markShownElsewhere(
			[lore(1, "messages"), lore(1, "relationships"), lore(1, "message")],
			1
		)
		expect(marked).toBe(0)
		expect(items.every((c: any) => !c.ineligible)).toBe(true)
	})

	it("keeps a reason that was already there, and changes nothing unwired", () => {
		const earlier = { ...lore(1), ineligible: { reason: "Not in the world." } }
		expect(markShownElsewhere([earlier], 1).items[0].ineligible).toEqual({
			reason: "Not in the world."
		})
		const plain = [lore(1)]
		expect(markShownElsewhere(plain, undefined)).toEqual({ items: plain, marked: 0 })
	})

	it("leaves selection as excluded_ineligible, spending nothing", () => {
		const { items } = markShownElsewhere([lore(1), lore(2)], 1)
		const selection = select(items as any, {
			availableTokens: 1000,
			params: withDefaults({})
		})
		expect(selection.included.map((d) => d.candidate.id)).toEqual([2])
		const out = selection.excluded.find((d) => d.candidate.id === 1)
		expect(out?.reason).toBe("excluded_ineligible")
	})
})
