/**
 * 🚧 Who the round waits on (PLAN-dc-after-walk2 Q3-3): read off the seats
 * and the Story's lines since its newest reply.
 */
import { describe, expect, test } from "vitest"
import { roundWaitingFor } from "./roundWaiting"

const seats = [
	{ id: 1, personaId: 7, persona: { name: "Maren Holt" }, userId: 1, position: 0 },
	{ id: 2, seatName: "Rook Valen", userId: 2, position: 1 },
	{ id: 3, seatName: "Pip", userId: 3, position: 2 }
]
const reply = { role: "assistant", channel: "main", isNarratorResponse: false }
const line = (userId: number, speaker: string) => ({ role: "user", channel: "main", userId, metadata: { speaker } })

describe("roundWaitingFor", () => {
	test("the guest has had their say: the round waits for the others, by name", () => {
		const rows = [reply, line(2, "player-seat:2")]
		expect(roundWaitingFor({ seats, rows, viewerUserId: 2, preparedOnStory: 0 })).toEqual(["Maren Holt", "Pip"])
	})

	test("nobody is waited for before the viewer speaks, once a turn is prepared, or for a seat out of the fight or still being made", () => {
		expect(roundWaitingFor({ seats, rows: [reply], viewerUserId: 2, preparedOnStory: 0 })).toEqual([])
		expect(roundWaitingFor({ seats, rows: [reply, line(2, "player-seat:2")], viewerUserId: 2, preparedOnStory: 1 })).toEqual([])
		expect(
			roundWaitingFor({
				seats,
				rows: [reply, line(2, "player-seat:2")],
				viewerUserId: 2,
				preparedOnStory: 0,
				fateOf: (ref) => (ref === "character:7" ? "dead" : "alive"),
				storyClosedFor: (uid) => uid === 3
			})
		).toEqual([])
	})

	test("a solo seat waits on nobody", () => {
		expect(roundWaitingFor({ seats: [seats[1]!], rows: [reply, line(2, "player-seat:2")], viewerUserId: 2, preparedOnStory: 0 })).toEqual([])
	})
})

describe("roundWaitingFor reads seats by the ref they carry (s27 S3)", () => {
	const people = [
		{ id: 1, personaId: 7, ref: "player-seat:1", castMemberId: 11, persona: { name: "Maren Holt" }, userId: 1, position: 0 },
		{ id: 2, ref: "player-seat:2", castMemberId: 12, seatName: "Rook Valen", userId: 2, position: 1 },
		{ id: 3, ref: "player-seat:3", castMemberId: 13, seatName: "Pip", userId: 3, position: 2 }
	]
	const said = (castMemberId: number, userId = 2) => ({ role: "user", channel: "main", userId, castMemberId })

	test("a line stamped with the speaker is the seat's, whatever the seat's card", () => {
		const rows = [reply, line(1, "player-seat:1"), line(2, "player-seat:2")]
		expect(roundWaitingFor({ seats: people, rows, viewerUserId: 2, preparedOnStory: 0 })).toEqual(["Pip"])
	})

	test("a line with a member and no stamp is the seat holding that member's", () => {
		expect(roundWaitingFor({ seats: people, rows: [reply, said(12), said(11, 1)], viewerUserId: 2, preparedOnStory: 0 })).toEqual(["Pip"])
	})

	test("a seat's fate is asked of its own ref, not its card's", () => {
		const asked: string[] = []
		const out = roundWaitingFor({
			seats: people,
			rows: [reply, said(12)],
			viewerUserId: 2,
			preparedOnStory: 0,
			fateOf: (ref) => {
				asked.push(ref)
				return ref === "player-seat:1" ? "dead" : "alive"
			}
		})
		expect(asked).toEqual(["player-seat:1", "player-seat:3"])
		expect(out).toEqual(["Pip"])
	})

	test("today's rows (no member) name the speaker as before", () => {
		const rows = [reply, { role: "user", channel: "main", userId: 1, personaId: 7 }, line(2, "player-seat:2")]
		expect(roundWaitingFor({ seats, rows, viewerUserId: 2, preparedOnStory: 0 })).toEqual(["Pip"])
	})

	test("an unstamped old row finds the seat on its card by that seat's member-form ref", () => {
		// Card 7 on seat 1; member 7 holds seat 2: the card is not the member.
		const seatsM = [
			{ id: 1, personaId: 7, ref: "player-seat:1", castMemberId: 11, persona: { name: "Maren Holt" }, userId: 1, position: 0 },
			{ id: 2, ref: "player-seat:2", castMemberId: 7, seatName: "Rook Valen", userId: 2, position: 1 },
			{ id: 3, ref: "player-seat:3", castMemberId: 13, seatName: "Pip", userId: 3, position: 2 }
		]
		const rows = [reply, { role: "user", channel: "main", userId: 1, personaId: 7 }, line(2, "player-seat:2")]
		expect(roundWaitingFor({ seats: seatsM, rows, viewerUserId: 2, preparedOnStory: 0 })).toEqual(["Pip"])
	})
})
