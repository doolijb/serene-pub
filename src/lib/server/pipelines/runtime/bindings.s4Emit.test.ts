/**
 * 🚧 ⏳ Seat-cast S4 (the flip), lane s4-f-emit, worker w2: bindings, turn
 * rotation and the state tools read and emit a seat in member form once
 * `state/memberForm.ts` is on — and are today's behaviour with it off.
 *
 * Unit level: the turn pool and strategies and the turn-advise oracle at the
 * binding, `seatRefLookupOfCast`'s seat-kind hint, the rotation rules over a
 * member-form lookup, `castOwnerOfRef`'s three forms, and the state tools'
 * owner. The switch is set explicitly and restored.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { castOwnerOfRef } from "$lib/server/pipelines/runtime/bindings.state"
import { ownerFor } from "$lib/server/pipelines/runtime/tools/stateTools"
import {
	lastSpeakerRef,
	roundRobinEntries,
	sentSinceReply,
	seatRefLookupOfCast,
	spokenRefsSince,
	turnOrderSelection,
	unpromptedEntries,
	type CastRead,
	type TurnCandidate
} from "$lib/server/pipelines/runtime/speakerRotation"
import { memberFormSwitch } from "$lib/server/state/memberForm"

let was = false
beforeEach(() => {
	was = memberFormSwitch.on
	memberFormSwitch.on = true
})
afterEach(() => {
	memberFormSwitch.on = was
})

const bindings = coreBindings() as Record<
	string,
	(input: any, ctx?: any) => Promise<any>
>

/** Two character seats with members (5, 6), a carded player seat (member 9, card 7) and a card-less one (member 10). */
const cast = {
	sessionCharacters: [
		{
			enabled: true,
			position: 0,
			character: { id: 11, name: "Alice", userId: 1 },
			ref: "seated-member:5",
			castMemberId: 5,
			seatId: 1
		},
		{
			enabled: true,
			position: 1,
			character: { id: 22, name: "Bram", userId: 2 },
			ref: "seated-member:6",
			castMemberId: 6,
			seatId: 2
		}
	],
	sessionPersonas: [
		{
			position: 0,
			persona: { id: 7, name: "You", userId: 1 },
			ref: "player-seat:3",
			castMemberId: 9,
			seatId: 3
		},
		{
			position: 1,
			persona: null,
			ref: "player-seat:4",
			castMemberId: 10,
			seatId: 4,
			seatName: "Wren",
			seatUserId: 2
		}
	]
}

const person = (
	personaId: number | null,
	castMemberId: number | null,
	speaker?: string
) => ({
	role: "user",
	content: "hi",
	personaId,
	castMemberId,
	...(speaker ? { speaker } : {})
})
const reply = (characterId: number, castMemberId: number | null) => ({
	role: "assistant",
	characterId,
	castMemberId
})

describe("turn pool candidates", () => {
	it("carry the host-filled member-form ref and the seat's member", async () => {
		const out = await bindings["core:task/turn-pool@1"]!({
			cast,
			messages: []
		})
		expect(out.value.main).toEqual([
			{
				ref: "seated-member:5",
				kind: "character",
				name: "Alice",
				position: 0,
				ownerUserId: 1,
				castMemberId: 5
			},
			{
				ref: "seated-member:6",
				kind: "character",
				name: "Bram",
				position: 1,
				ownerUserId: 2,
				castMemberId: 6
			},
			{
				ref: "player-seat:3",
				kind: "persona",
				name: "You",
				position: 0,
				ownerUserId: 1,
				castMemberId: 9
			},
			{
				ref: "player-seat:4",
				kind: "persona",
				name: "Wren",
				position: 1,
				ownerUserId: 2,
				castMemberId: 10
			}
		])
	})

	it("flip off: the card form, no member key", async () => {
		memberFormSwitch.on = false
		const offCast = {
			sessionCharacters: [
				{
					enabled: true,
					position: 0,
					character: { id: 11, name: "Alice" },
					ref: "character:11",
					castMemberId: 5,
					seatId: 1
				}
			],
			sessionPersonas: [
				{
					position: 0,
					persona: { id: 7, name: "You" },
					ref: "character:7",
					castMemberId: 9,
					seatId: 3
				}
			]
		}
		const out = await bindings["core:task/turn-pool@1"]!({
			cast: offCast,
			messages: []
		})
		expect(out.value.main.map((c: any) => c.ref)).toEqual([
			"character:11",
			"character:7"
		])
		expect(out.value.main.some((c: any) => "castMemberId" in c)).toBe(false)
	})
})

describe("turn strategies over member-form candidates", () => {
	const candidates = [
		{
			ref: "seated-member:5",
			kind: "character",
			name: "Alice",
			position: 0,
			castMemberId: 5
		},
		{
			ref: "seated-member:6",
			kind: "character",
			name: "Bram",
			position: 1,
			castMemberId: 6
		},
		{
			ref: "player-seat:3",
			kind: "persona",
			name: "You",
			position: 0,
			castMemberId: 9
		}
	]

	it("round robin leaves out the seat that replied, by cast member", async () => {
		const out = await bindings["core:task/turn-round-robin@1"]!({
			candidates,
			messages: [person(7, 9), reply(11, 5)]
		})
		expect(out.value.main).toEqual([
			{ ref: "seated-member:6", via: "strategy" }
		])
	})

	it("a member holding both seats: the person's line is the player seat, the reply the character seat (K-2)", async () => {
		const both = [
			{
				ref: "seated-member:5",
				kind: "character",
				name: "Alice",
				position: 0,
				castMemberId: 5
			},
			{
				ref: "player-seat:3",
				kind: "persona",
				name: "Alice (you)",
				position: 0,
				castMemberId: 5
			}
		]
		const out = await bindings["core:task/turn-round-robin@1"]!({
			candidates: both,
			messages: [person(7, 5), reply(11, 5)]
		})
		// Both have spoken: the sender is the player seat, the replier the character seat.
		expect(out.value.main).toEqual([])
		const onlyPerson = await bindings["core:task/turn-round-robin@1"]!({
			candidates: both,
			messages: [person(7, 5)]
		})
		expect(onlyPerson.value.main).toEqual([
			{ ref: "seated-member:5", via: "strategy" }
		])
	})
})

describe("core:oracle/turn-advise@1 over member-form candidates", () => {
	const candidates = [
		{
			ref: "seated-member:5",
			kind: "character",
			name: "Alice",
			position: 0,
			castMemberId: 5
		},
		{
			ref: "seated-member:6",
			kind: "character",
			name: "Bram",
			position: 1,
			castMemberId: 6
		},
		{
			ref: "player-seat:3",
			kind: "persona",
			name: "Wren",
			position: 0,
			castMemberId: 5
		}
	]

	const advise = async (messages: unknown[]) => {
		let asked: any = null
		const out = await bindings["core:oracle/turn-advise@1"]!(
			{ candidates, messages },
			{
				log: () => {},
				call: async (req: any) => {
					asked = req
					return { json: { order: ["seated-member:6"] } }
				}
			}
		)
		return { out, asked }
	}

	it("asks only about the seats not heard from (by castMemberId), and names lines by seat", async () => {
		const { out, asked } = await advise([
			{
				role: "user",
				content: "who is next",
				personaId: 7,
				castMemberId: 5
			},
			{
				role: "assistant",
				content: "I answer",
				characterId: 11,
				castMemberId: 5
			}
		])
		// Member 5 holds both seats: its reply is the character seat, its line the player seat.
		expect(asked.userPrompt).toContain("- seated-member:6: Bram")
		expect(asked.userPrompt).not.toContain("- seated-member:5:")
		expect(asked.userPrompt).not.toContain("- player-seat:3:")
		// The person's line is named by the player seat, the reply by the character seat.
		expect(asked.userPrompt).toContain("Wren: who is next")
		expect(asked.userPrompt).toContain("Alice: I answer")
		expect(out.value.order).toEqual([
			{ ref: "seated-member:6", via: "model" }
		])
	})
})

describe("seatRefLookupOfCast with a seat kind", () => {
	const both: CastRead = {
		sessionCharacters: [
			{
				position: 0,
				ref: "seated-member:5",
				castMemberId: 5,
				character: { id: 1 },
				removedAt: new Date()
			},
			{
				position: 1,
				ref: "seated-member:5",
				castMemberId: 5,
				character: { id: 2 }
			}
		],
		sessionPersonas: [
			{
				position: 0,
				ref: "player-seat:3",
				castMemberId: 5,
				persona: { id: 3 }
			}
		]
	}

	it("no hint keeps today's order: live, character before player", () => {
		expect(seatRefLookupOfCast(both)(5)).toBe("seated-member:5")
	})

	it("'player-seat' answers the member's player seat, 'character-seat' its character seat", () => {
		const refOf = seatRefLookupOfCast(both)
		expect(refOf(5, "player-seat")).toBe("player-seat:3")
		expect(refOf(5, "character-seat")).toBe("seated-member:5")
	})

	it("a hint with no seat of that kind falls back to any seat of the member", () => {
		const onlyChar = seatRefLookupOfCast({
			sessionCharacters: [
				{
					ref: "seated-member:6",
					castMemberId: 6,
					character: { id: 9 }
				}
			]
		})
		expect(onlyChar(6, "player-seat")).toBe("seated-member:6")
		const onlyPlayer = seatRefLookupOfCast({
			sessionPersonas: [
				{ ref: "player-seat:4", castMemberId: 10, persona: null }
			]
		})
		expect(onlyPlayer(10, "character-seat")).toBe("player-seat:4")
	})

	it("within a kind, the live seat comes first; the kind outranks liveness", () => {
		const refOf = seatRefLookupOfCast({
			sessionCharacters: [
				{
					position: 0,
					ref: "character:1",
					castMemberId: 5,
					character: { id: 1 },
					removedAt: new Date()
				},
				{
					position: 1,
					ref: "character:2",
					castMemberId: 5,
					character: { id: 2 }
				}
			],
			sessionPersonas: [
				{
					position: 0,
					ref: "player-seat:3",
					castMemberId: 5,
					persona: { id: 3 }
				}
			]
		})
		expect(refOf(5, "character-seat")).toBe("character:2")
		const departedOnly = seatRefLookupOfCast({
			sessionCharacters: [
				{
					ref: "character:1",
					castMemberId: 5,
					character: { id: 1 },
					removedAt: new Date()
				}
			],
			sessionPersonas: [
				{ ref: "player-seat:3", castMemberId: 5, persona: { id: 3 } }
			]
		})
		expect(departedOnly(5, "character-seat")).toBe("character:1")
	})
})

describe("turnOrderSelection and the rotation rules in member form", () => {
	const lookup = seatRefLookupOfCast(cast)
	const candidates = [
		{
			ref: "seated-member:5",
			kind: "character",
			name: "Alice",
			position: 0
		},
		{
			ref: "seated-member:6",
			kind: "character",
			name: "Bram",
			position: 1
		},
		{ ref: "player-seat:3", kind: "persona", name: "You", position: 0 }
	] as TurnCandidate[]
	const history = [person(7, 9), reply(11, 5)] as any[]

	it("the order and the last speaker read the seat's member form", () => {
		const selection = turnOrderSelection(candidates, history, lookup)
		expect(selection.order).toEqual([
			{ ref: "seated-member:6", via: "strategy" }
		])
		expect(selection.lastSpeaker).toBe("seated-member:5")
		expect(lastSpeakerRef(history, lookup)).toBe("seated-member:5")
		expect(lastSpeakerRef(history)).toBe("character:11")
	})

	it("sentSinceReply names the sender's seat", () => {
		const sent = [reply(11, 5), person(7, 9)] as any[]
		expect(sentSinceReply(sent, lookup)).toEqual({
			main: ["player-seat:3"]
		})
		expect(
			turnOrderSelection(candidates, sent, lookup).sentSinceReply
		).toEqual({
			main: ["player-seat:3"]
		})
		expect([...spokenRefsSince(history, lookup)].sort()).toEqual([
			"player-seat:3",
			"seated-member:5"
		])
		expect(roundRobinEntries(candidates, history, lookup)).toEqual([
			{ ref: "seated-member:6", via: "strategy" }
		])
	})

	it("unprompted side-cast reads a reply as the candidate carrying its member", () => {
		const cands = [
			{
				ref: "seated-member:5",
				kind: "character",
				name: "Alice",
				position: 0,
				castMemberId: 5
			},
			{
				ref: "seated-member:6",
				kind: "character",
				name: "Bram",
				position: 1,
				castMemberId: 6
			},
			{
				ref: "player-seat:3",
				kind: "persona",
				name: "You",
				position: 2,
				castMemberId: 9
			}
		] as TurnCandidate[]
		const out = unpromptedEntries(
			[],
			cands,
			[person(7, 9), reply(11, 5), reply(22, 6)] as any[],
			{ "side-cast": "full" }
		)
		// Bram spoke last, so Alice (the earliest) speaks up again.
		expect(out).toEqual([{ ref: "seated-member:5", via: "unprompted" }])
	})
})

describe("castOwnerOfRef", () => {
	it("flip on: character: → session_cast, seated-member: → seated_member, player-seat: → player_seat", () => {
		expect(castOwnerOfRef("character:11")).toEqual({
			kind: "session_cast",
			id: 11
		})
		expect(castOwnerOfRef("seated-member:5")).toEqual({
			kind: "seated_member",
			id: 5
		})
		expect(castOwnerOfRef("player-seat:3")).toEqual({
			kind: "player_seat",
			id: 3
		})
		expect(castOwnerOfRef("envoy:x")).toBeNull()
		expect(castOwnerOfRef(5)).toBeNull()
	})

	it("flip off: seated-member: is not read here (the door turns it to card form first)", () => {
		memberFormSwitch.on = false
		expect(castOwnerOfRef("character:11")).toEqual({
			kind: "session_cast",
			id: 11
		})
		expect(castOwnerOfRef("seated-member:5")).toBeNull()
		expect(castOwnerOfRef("player-seat:3")).toEqual({
			kind: "player_seat",
			id: 3
		})
	})
})

describe("state tools: the owner of a named seat", () => {
	const ctx = {
		sessionId: 1,
		read: async () => ({
			sessionCharacters: [
				{ character: { id: 11, name: "Alice" }, castMemberId: 5 },
				{ character: { id: 22, name: "Bram" }, castMemberId: null }
			]
		})
	} as any

	it("flip on: a seated member's owner; a member-less seat keeps its card's session_cast", async () => {
		expect(await ownerFor(ctx, "alice")).toEqual({
			kind: "seated_member",
			id: 5
		})
		expect(await ownerFor(ctx, "Bram")).toEqual({
			kind: "session_cast",
			id: 22
		})
	})

	it("flip off: the card's session_cast", async () => {
		memberFormSwitch.on = false
		expect(await ownerFor(ctx, "Alice")).toEqual({
			kind: "session_cast",
			id: 11
		})
	})
})
