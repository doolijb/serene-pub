import { describe, expect, it } from "vitest"
import { isPresent, worldRoster, worldRosterLine } from "./worldRoster"

const row = (over: Partial<Parameters<typeof worldRoster>[0][number]> = {}) =>
	({ id: 1, name: "Verity", ...over }) as any

describe("presence", () => {
	it("an untouched state is present — a book that never used the field shows its cast", () => {
		expect(isPresent(row({ nodeState: null }))).toBe(true)
		expect(isPresent(row({ nodeState: "" }))).toBe(true)
		expect(isPresent(row({ nodeState: "active" }))).toBe(true)
	})

	it("departed and dead are not in the world", () => {
		expect(isPresent(row({ nodeState: "departed" }))).toBe(false)
		expect(isPresent(row({ nodeState: "dead" }))).toBe(false)
		expect(isPresent(row({ nodeState: "DEPARTED" }))).toBe(false)
	})

	it("a state nobody has heard of counts as present", () => {
		// A future genre's invention must not quietly empty the room.
		expect(isPresent(row({ nodeState: "bewitched" }))).toBe(true)
	})
})

describe("the roster", () => {
	it("leaves out whoever is not here", () => {
		const out = worldRoster([
			row({ id: 1, name: "Verity" }),
			row({ id: 2, name: "Tomas", nodeState: "departed" })
		])
		expect(out.map((i) => i.name)).toEqual(["Verity"])
	})

	it("orders by name, so the room reads alphabetically", () => {
		const out = worldRoster([
			row({ id: 2, name: "Tomas" }),
			row({ id: 1, name: "Mirene" })
		])
		expect(out.map((i) => i.name)).toEqual(["Mirene", "Tomas"])
	})

	it("two of one person are two entries, and both are marked", () => {
		const out = worldRoster([
			row({ id: 1, name: "Verity", personalPosition: 34 }),
			row({ id: 1, name: "Verity", personalPosition: 50 })
		])
		expect(out).toHaveLength(2)
		expect(out.every((i) => i.alsoHere)).toBe(true)
		// The younger first: a life read in the order it was lived.
		expect(out.map((i) => i.aspect)).toEqual(["age 34", "age 50"])
	})

	it("one of someone is not marked", () => {
		const out = worldRoster([row({ id: 1, personalPosition: 34 })])
		expect(out[0].alsoHere).toBe(false)
	})

	it("keys are per appearance, never per member", () => {
		const out = worldRoster([
			row({ id: 1, personalPosition: 34 }),
			row({ id: 1, personalPosition: 50 })
		])
		expect(new Set(out.map((i) => i.key)).size).toBe(2)
	})

	it("a carded member is NAMED by their card", () => {
		// So an amendment that swaps the card shows a different person here.
		const out = worldRoster(
			[row({ id: 1, name: "Verity, novice", characterId: 7 })],
			() => "Verity, keeper"
		)
		expect(out[0].name).toBe("Verity, keeper")
	})

	it("falls back to their own name when no card draws them", () => {
		const out = worldRoster([row({ id: 1, name: "The stranger" })])
		expect(out[0].name).toBe("The stranger")
	})

	it("the aspect is the point of their life, when there is one", () => {
		const out = worldRoster(
			[row({ id: 1, personalPosition: 34, characterId: 7 })],
			() => "Verity, keeper"
		)
		expect(out[0].aspect).toBe("age 34")
	})
	it("an unnamed member still appears", () => {
		const out = worldRoster([row({ id: 3, name: "  " })])
		expect(out[0].name).toBe("Unnamed")
		expect(out[0].initial).toBe("U")
	})
})

describe("the chip's sentence", () => {
	it("says nobody when the world is empty", () => {
		expect(worldRosterLine([])).toBe("nobody here")
	})

	it("is a plain count when nobody is doubled", () => {
		const out = worldRoster([row({ id: 1 }), row({ id: 2, name: "Tomas" })])
		expect(worldRosterLine(out)).toBe("2 in the world")
	})

	it("leads with the remarkable thing", () => {
		const out = worldRoster([
			row({ id: 1, personalPosition: 34 }),
			row({ id: 1, personalPosition: 50 }),
			row({ id: 2, name: "Tomas" })
		])
		expect(worldRosterLine(out)).toBe("3 in the world · 2 of Verity")
	})

	it("counts them when more than one person is doubled", () => {
		const out = worldRoster([
			row({ id: 1, personalPosition: 10 }),
			row({ id: 1, personalPosition: 40 }),
			row({ id: 2, name: "Tomas", personalPosition: 9 }),
			row({ id: 2, name: "Tomas", personalPosition: 30 })
		])
		expect(worldRosterLine(out)).toBe("4 in the world · 2 doubled")
	})
})
