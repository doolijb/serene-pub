/**
 * The one room rule — which listed row a name stands for (places plan B6
 * review round; shared since B7).
 *
 * The Lair's Answer the door (`here`), `{{locationEntry}}` and the place
 * editor's **Read links from the Exits line** all find a room by it, so the
 * room a door links, the room a prompt describes and the room an Exits line
 * names are always the same room. The name rule underneath (articles,
 * punctuation, NFKC) is the SDK's `sameName`, pinned in the SDK's own tests.
 */
import { describe, expect, it } from "vitest"
import { describingRow, keyTerms, locationRowOf } from "./describingRow"
// New in the review round: read off the module, so its absence fails its own cases only.
import * as rowRule from "./describingRow"

const HALL = { id: 1, name: "Drowned Hall", keys: [] as string[] }
const THE_HALL = { id: 2, name: "The Drowned Hall", keys: [] as string[] }
const VAULT = { id: 3, name: "The Deep Vault", keys: ["vault, strongroom"] }

describe("describingRow — strongest answer first, over the whole list", () => {
	it("an exact name (case and space aside) beats a looser spelling of another row", () => {
		expect(describingRow("the drowned hall ", [HALL, THE_HALL])).toBe(THE_HALL)
		expect(describingRow("Drowned Hall", [THE_HALL, HALL])).toBe(HALL)
	})

	it("then the name as sameName reads it, a leading article aside", () => {
		expect(describingRow("the Drowned Hall", [HALL, VAULT])).toBe(HALL)
	})

	it("then a key term, never before another row's name", () => {
		expect(describingRow("strongroom", [HALL, VAULT])).toBe(VAULT)
		const keyed = { id: 4, name: "Cellar", keys: ["Drowned Hall"] }
		expect(describingRow("Drowned Hall", [keyed, HALL])).toBe(HALL)
	})

	it("answers null when nothing does, and reads the lists in order", () => {
		expect(describingRow("The Old Well", [HALL, VAULT])).toBeNull()
		expect(describingRow("Drowned Hall", [VAULT], [HALL])).toBe(HALL)
		expect(describingRow("Drowned Hall", "not a list", null)).toBeNull()
	})
})

describe("locationRowOf — a location value's room", () => {
	it("a name is describingRow's; a lore reference is the listed row with its id", () => {
		expect(locationRowOf("the drowned hall", [HALL, THE_HALL])).toBe(THE_HALL)
		expect(
			locationRowOf({ entryId: 1, name: "The Deep Vault" }, [VAULT, HALL])
		).toBe(HALL)
		expect(locationRowOf("   ", [HALL])).toBeNull()
		expect(locationRowOf("Drowned Hall", undefined)).toBeNull()
	})
})

describe("keyTerms", () => {
	it("splits comma-separated keys, trimmed, blanks dropped", () => {
		expect(keyTerms("vault, the Deep Vault ,, ")).toEqual(["vault", "the Deep Vault"])
		expect(keyTerms(["a,b", "c"])).toEqual(["a", "b", "c"])
		expect(keyTerms(undefined)).toEqual([])
	})
})

/**
 * B7 review round: which rows answer a name ALIKE — the tie the room rule's
 * first hit hides. The Exits line's links name the others rather than
 * silently taking the first.
 */
describe("answeringRows — every row that answers at the winning strength", () => {
	const hall = { id: 1, name: "The Hall" }
	const hallAgain = { id: 2, name: "the hall" }
	const looser = { id: 3, name: "Hall" }
	const keyed = { id: 4, name: "Kitchen", keys: ["the hall"] }

	it("lists each row tied at the first tier any row answers, and only those", () => {
		expect(rowRule.answeringRows("The Hall", [hall, looser, hallAgain, keyed])).toEqual([
			hall,
			hallAgain
		])
		expect(rowRule.answeringRows("Hall", [hall, keyed])).toEqual([hall])
		expect(rowRule.answeringRows("Nowhere", [hall])).toEqual([])
	})

	it("takes the lists in order, and describingRow is the first of them", () => {
		expect(rowRule.answeringRows("Hall", [keyed], [looser])).toEqual([keyed])
		expect(rowRule.answeringRows("Hall", [], [looser, hall])).toEqual([looser])
		expect(describingRow("The Hall", [hall, hallAgain])).toBe(hall)
	})
})
