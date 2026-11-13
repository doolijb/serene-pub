/** The one retraction rule, pure (`retractionAct`). */
import { describe, expect, it } from "vitest"
import { retractionAct, wrap } from "./imprints"

const after = wrap({ n: 2 })

describe("retractionAct", () => {
	it("splices when the later imprint began where this one ended", () => {
		expect(
			retractionAct({
				after,
				later: { before: wrap({ n: 2 }) },
				alwaysRevert: true,
				now: undefined
			})
		).toBe("spliced")
	})
	it("drops when a later imprint began somewhere else (a person overwrote it)", () => {
		expect(
			retractionAct({
				after,
				later: { before: wrap({ n: 9 }) },
				alwaysRevert: false,
				now: { n: 2 }
			})
		).toBe("dropped")
	})
	it("a later imprint with no value before matches an absent after", () => {
		expect(
			retractionAct({
				after: null,
				later: { before: null },
				alwaysRevert: false,
				now: 1
			})
		).toBe("spliced")
	})
	it("reverts always when asked, whatever the field holds", () => {
		expect(
			retractionAct({
				after,
				later: null,
				alwaysRevert: true,
				now: { n: 5 }
			})
		).toBe("reverted")
	})
	it("reverts a real book's field only while it holds what the run wrote", () => {
		expect(
			retractionAct({
				after,
				later: null,
				alwaysRevert: false,
				now: { n: 2 }
			})
		).toBe("reverted")
		expect(
			retractionAct({
				after,
				later: null,
				alwaysRevert: false,
				now: { n: 3 }
			})
		).toBe("kept")
	})
	it("an absent value written compares with an absent value now", () => {
		expect(
			retractionAct({
				after: null,
				later: null,
				alwaysRevert: false,
				now: undefined
			})
		).toBe("reverted")
	})
})
