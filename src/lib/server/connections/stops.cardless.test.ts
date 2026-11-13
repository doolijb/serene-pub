/**
 * A card-less character seat's speaker (seat-cast S4): its own label must not
 * end its own reply. The seat's entry carries NO `id` (a card id and a member
 * id share one id range), so it is matched by `castMemberId`.
 */
import { describe, expect, test } from "vitest"
import { composeStops, composeStopsFor, ownLabelsFor } from "./stops"

// Card ids and member ids deliberately overlap: member 1 and card 1.
const characters = [
	{ id: 1, name: "Vell", nickname: null },
	{ castMemberId: 1, name: "Ash", nickname: "A" },
	{ castMemberId: 2, name: "Nox", nickname: null }
] as any[]
const personas = [{ name: "Rook" }] as any[]

const values = (input: Record<string, unknown>) =>
	composeStops({
		template: null,
		characters,
		personas,
		explicit: [],
		wire: "completion",
		...input
	} as any).sent.map((s) => s.value)

describe("a card-less speaker's stops", () => {
	test("the speaking member's own label is not a stop", () => {
		const sent = values({ currentCastMemberId: 1 })
		expect(sent).not.toContain("Ash:")
		expect(sent).not.toContain("A:")
	})

	test("another card-less seat's label still is, and so is a card's whose id equals the member id", () => {
		const sent = values({ currentCastMemberId: 1 })
		expect(sent).toContain("Nox:")
		expect(sent).toContain("Vell:")
	})

	test("a carded speaker is unchanged", () => {
		const sent = values({ currentCharacterId: 1 })
		expect(sent).not.toContain("Vell:")
		expect(sent).toContain("Ash:")
		expect(sent).toContain("Nox:")
	})

	test("a narrator turn (no speaker) stops on everyone", () => {
		const sent = values({})
		expect(sent).toContain("Ash:")
		expect(sent).toContain("Nox:")
		expect(sent).toContain("Vell:")
	})

	test("composeStopsFor maps the seat's member and skips only the speaker", () => {
		const session = {
			sessionCharacters: [
				{ character: { id: 1, name: "Vell" }, castMemberId: null },
				{ character: { cardless: true, name: "Ash" }, castMemberId: 1 },
				{ character: { cardless: true, name: "Nox" }, castMemberId: 2 }
			],
			sessionPersonas: []
		}
		const sent = composeStopsFor({ wireMode: "completion" }, session, {
			currentCastMemberId: 1
		}).sent.map((s) => s.value)
		expect(sent).not.toContain("Ash:")
		expect(sent).toContain("Nox:")
		expect(sent).toContain("Vell:")
	})
})

describe("a card-less speaker's own labels", () => {
	const session = {
		sessionCharacters: [
			{ character: { id: 1, name: "Vell" }, castMemberId: null },
			{
				character: { cardless: true, name: "Ash", nickname: "A" },
				castMemberId: 1
			},
			{ character: { cardless: true, name: "Nox" }, castMemberId: 2 }
		]
	}

	test("the speaking member's name and nickname are own labels", () => {
		expect(ownLabelsFor(session, null, null, null, 1)).toEqual(["Ash", "A"])
	})

	test("a card speaker is read by card id, not by member", () => {
		expect(ownLabelsFor(session, 1, null, null, 2)).toEqual(["Vell"])
	})
})
