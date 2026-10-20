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
