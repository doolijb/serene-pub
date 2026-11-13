/**
 * 🚧 Turn order names a member by the cast in hand (plan §27, S3): the
 * `refOfMember` lookup the SDK's `senderRefOf`, `spokenRefsSince` and
 * `roundRobinOrder` take, built from the `session_cast` read's seat rows
 * (`seatRefLookupOfCast`). It changes only WHO a row names, never whether it
 * counts; with no lookup (or one that finds nothing) the output is what it was.
 */
import { describe, expect, it } from "vitest"
import {
	narratorEntries,
	roundRobinEntries,
	sentSinceReply,
	seatRefLookupOfCast,
	senderRefOf,
	spokenRefsSince,
	standingTurnPlan,
	turnOrderSelection,
	userSplitEntries,
	type CastRead,
	type RotationMessage,
	type TurnCandidate
} from "./speakerRotation"

/** S4-shaped refs: a seat's ref is its member. */
const s4Cast: CastRead = {
	sessionCharacters: [
		{
			enabled: true,
			position: 0,
			character: { id: 11 },
			ref: "seated-member:5",
			castMemberId: 5,
			seatId: 1
		},
		{
			enabled: true,
			position: 1,
			character: { id: 22 },
			ref: "seated-member:6",
			castMemberId: 6,
			seatId: 2
		}
	],
	sessionPersonas: [
		{
			position: 0,
			persona: { id: 7 },
			ref: "seated-member:9",
			castMemberId: 9,
			seatId: 3
		},
		{
			position: 1,
			persona: null,
			ref: "seated-member:10",
			castMemberId: 10,
			seatId: 4,
			seatName: "Wren"
		}
	]
}
/** Today's: the card form. */
const todayCast: CastRead = {
	sessionCharacters: [
		{
			enabled: true,
			position: 0,
			character: { id: 11 },
			ref: "character:11",
			castMemberId: 5,
			seatId: 1
		},
		{
			enabled: true,
			position: 1,
			character: { id: 22 },
			ref: "character:22",
			castMemberId: 6,
			seatId: 2
		}
	],
	sessionPersonas: [
		{
			position: 0,
			persona: { id: 7 },
			ref: "character:7",
			castMemberId: 9,
			seatId: 3
		},
		{
			position: 1,
			persona: null,
			ref: "player-seat:4",
			castMemberId: 10,
			seatId: 4,
			seatName: "Wren"
		}
	]
}

const person = (
	personaId: number | null,
	castMemberId: number | null,
	speaker?: string
): RotationMessage => ({
	role: "user",
	personaId,
	castMemberId,
	...(speaker ? { speaker } : {})
})
const reply = (
	characterId: number,
	castMemberId: number | null
): RotationMessage => ({
	role: "assistant",
	characterId,
	castMemberId
})
const candidate = (
	ref: string,
	kind: string,
	position: number
): TurnCandidate => ({
	ref: ref as TurnCandidate["ref"],
	kind,
	name: ref,
	position
})

describe("seatRefLookupOfCast", () => {
	it("answers a member with the ref of the seat that stores it", () => {
		const refOf = seatRefLookupOfCast(s4Cast)
		expect(refOf(5)).toBe("seated-member:5")
		expect(refOf(9)).toBe("seated-member:9")
		expect(refOf(10)).toBe("seated-member:10")
		expect(refOf(404)).toBeUndefined()
	})

	it("a seat with no ref or no member answers nobody; no cast answers nobody", () => {
		const refOf = seatRefLookupOfCast({
			sessionCharacters: [
				{
					character: { id: 1 },
					ref: "character:1",
					castMemberId: null
				},
				{ character: { id: 2 }, castMemberId: 3 }
			]
		})
		expect(refOf(3)).toBeUndefined()
		expect(seatRefLookupOfCast(null)(1)).toBeUndefined()
		expect(seatRefLookupOfCast({})(1)).toBeUndefined()
	})

	it("a member two seats share goes to the live seat, character seats before player seats", () => {
		const refOf = seatRefLookupOfCast({
			sessionCharacters: [
				{
					character: { id: 1 },
					ref: "character:1",
					castMemberId: 5,
					removedAt: new Date()
				},
				{ character: { id: 2 }, ref: "character:2", castMemberId: 5 }
			],
			sessionPersonas: [
				{ persona: { id: 3 }, ref: "character:3", castMemberId: 5 }
			]
		})
		expect(refOf(5)).toBe("character:2")
	})
})

describe("turn order on S4-shaped history", () => {
	const lookup = seatRefLookupOfCast(s4Cast)
	const history = [person(7, 9), reply(11, 5)]

	it("senderRefOf names a person's line by the member's seat", () => {
		expect(senderRefOf(person(7, 9), lookup)).toBe("seated-member:9")
		expect(senderRefOf(person(null, 10, "player-seat:4"), lookup)).toBe(
			"seated-member:10"
		)
		// Never whether a row is a sender: an assistant row still is not one.
		expect(senderRefOf(reply(11, 5) as any, lookup)).toBeNull()
	})

	it("spokenRefsSince and roundRobinEntries name the member refs", () => {
		expect([...spokenRefsSince(history, lookup)].sort()).toEqual([
			"seated-member:5",
			"seated-member:9"
		])
		const candidates = [
			candidate("seated-member:5", "character", 0),
			candidate("seated-member:6", "character", 1),
			candidate("seated-member:9", "persona", 2)
		]
		expect(roundRobinEntries(candidates, history, lookup)).toEqual([
			{ ref: "seated-member:6", via: "strategy" }
		])
	})

	it("userSplitEntries and turnOrderSelection read the sender through the lookup", () => {
		const candidates = [
			{ ...candidate("seated-member:5", "character", 0), ownerUserId: 1 },
			{ ...candidate("seated-member:9", "persona", 1), ownerUserId: 1 },
			{ ...candidate("seated-member:6", "character", 2), ownerUserId: 2 }
		]
		expect(
			userSplitEntries(candidates, [person(7, 9)], lookup).map(
				(e) => e.ref
			)
		).toEqual(["seated-member:5"])
		const selection = turnOrderSelection(candidates, [person(7, 9)], lookup)
		expect(selection.order.map((e) => e.ref)).toEqual([
			"seated-member:5",
			"seated-member:6"
		])
	})

	it("sentSinceReply keys the senders by member ref", () => {
		expect(
			sentSinceReply(
				[person(7, 9), person(null, 10, "player-seat:4")],
				lookup
			)
		).toEqual({
			main: ["seated-member:10", "seated-member:9"]
		})
	})

	it("a standing plan's waits are met by a sender named through the lookup", () => {
		const plan: RotationMessage = {
			role: "assistant",
			turnPlan: {
				turns: ["seated-member:9", "seated-member:5"],
				waits: ["seated-member:9"]
			}
		}
		expect(
			standingTurnPlan([plan, person(7, 9)], undefined, lookup)
		).not.toBeNull()
		expect(standingTurnPlan([plan, person(7, 9)])).toBeNull()
		expect(
			narratorEntries([plan, person(7, 9)], lookup).map((e) => e.ref)
		).toEqual(["seated-member:5"])
	})
})

describe("today's history is unchanged", () => {
	const history = [person(7, 9), reply(11, 5)]
	const candidates = [
		candidate("character:11", "character", 0),
		candidate("character:22", "character", 1)
	]

	it("with no lookup, the output is what it was", () => {
		expect([...spokenRefsSince(history)].sort()).toEqual([
			"character:11",
			"character:7"
		])
		expect(roundRobinEntries(candidates, history)).toEqual([
			{ ref: "character:22", via: "strategy" }
		])
		expect(senderRefOf(person(7, 9))).toBe("character:7")
	})

	it("a lookup that gives the card form, or finds nothing, changes nothing", () => {
		const today = seatRefLookupOfCast(todayCast)
		expect([...spokenRefsSince(history, today)].sort()).toEqual([
			"character:11",
			"character:7"
		])
		expect(roundRobinEntries(candidates, history, today)).toEqual(
			roundRobinEntries(candidates, history)
		)
		const nothing = seatRefLookupOfCast({})
		expect(roundRobinEntries(candidates, history, nothing)).toEqual(
			roundRobinEntries(candidates, history)
		)
		expect(senderRefOf(person(null, 10, "player-seat:4"), today)).toBe(
			"player-seat:4"
		)
		expect(sentSinceReply([person(7, 9)], today)).toEqual(
			sentSinceReply([person(7, 9)])
		)
	})

	it("rows without a castMemberId are read as before, even through an S4 lookup", () => {
		const lookup = seatRefLookupOfCast(s4Cast)
		const old = [person(7, null), reply(11, null)]
		expect([...spokenRefsSince(old, lookup)].sort()).toEqual([
			"character:11",
			"character:7"
		])
	})
})
