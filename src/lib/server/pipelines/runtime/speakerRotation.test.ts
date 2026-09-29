/**
 * The next-speaker rules (plans/19 §5; 2026-09-21), as pure functions.
 *
 * What is pinned: round robin is once per turn of the person's — every seat
 * in order after each user message, nobody when all have spoken, a fresh
 * round on the next send; hidden and narrator rows are outside the
 * rotation; an envoy's reply marks no seat; user-split narrows to the
 * sender's own seats and falls back rather than starving; the envoy rule is
 * unchanged from U5g; and the selection a script is handed names the
 * round-robin answer as `due`.
 */

import { describe, it, expect } from "vitest"
import type { ParticipantRef } from "@serene-pub/sdk"
import {
	inTurnEnvoys,
	mentionedFirst,
	lastSpeakerRef,
	nextEnvoyTurn,
	rotationPersonas,
	rotationSeats,
	roundRobinSpeaker,
	turnSelection,
	userSplitSpeaker,
	type RotationMessage,
	type RotationSeat,
	type TurnCandidate,
	spokenRefsSince,
	roundRobinEntries
} from "./speakerRotation"

const seat = (
	characterId: number,
	position: number,
	ownerUserId = 1
): RotationSeat => ({ characterId, position, ownerUserId })
const alice = seat(11, 0)
const bram = seat(22, 1)
const cleo = seat(33, 2)

const user = (personaId = 7): RotationMessage => ({ role: "user", personaId })
const reply = (characterId: number): RotationMessage => ({
	role: "assistant",
	characterId
})

describe("round robin", () => {
	it("seats every character once, in order, after a user message", () => {
		const seats = [alice, bram, cleo]
		const history: RotationMessage[] = [user()]
		expect(roundRobinSpeaker(seats, history)).toBe(11)
		history.push(reply(11))
		expect(roundRobinSpeaker(seats, history)).toBe(22)
		history.push(reply(22))
		expect(roundRobinSpeaker(seats, history)).toBe(33)
		history.push(reply(33))
		// Everyone has spoken: the person's turn.
		expect(roundRobinSpeaker(seats, history)).toBeNull()
	})

	it("starts a fresh round on the next user message", () => {
		const seats = [alice, bram]
		const history = [user(), reply(11), reply(22), user()]
		expect(roundRobinSpeaker(seats, history)).toBe(11)
	})

	it("an out-of-turn trigger counts as that seat's turn for the round", () => {
		const seats = [alice, bram, cleo]
		// The person spoke, then Cleo was triggered by hand.
		const history = [user(), reply(33)]
		expect(roundRobinSpeaker(seats, history)).toBe(11)
		history.push(reply(11))
		// Bram is still owed; Cleo is not offered again this round.
		expect(roundRobinSpeaker(seats, history)).toBe(22)
		history.push(reply(22))
		expect(roundRobinSpeaker(seats, history)).toBeNull()
	})

	it("two sends in a row open a new round — nobody is skipped, nobody starves", () => {
		const seats = [alice, bram]
		const history = [user(), reply(11), user(), user()]
		expect(roundRobinSpeaker(seats, history)).toBe(11)
	})

	it("hidden rows and narrator responses are outside the rotation", () => {
		const seats = [alice, bram]
		const history: RotationMessage[] = [
			user(),
			{ role: "assistant", characterId: 11, isHidden: true },
			{ role: "assistant", characterId: null, isNarratorResponse: true }
		]
		// Alice's hidden reply does not count as her turn.
		expect(roundRobinSpeaker(seats, history)).toBe(11)
	})

	it("an envoy's reply marks no seat as having spoken", () => {
		const seats = [alice]
		const history: RotationMessage[] = [
			user(),
			{ role: "assistant", characterId: null, metadata: { speaker: "envoy:mascot" } }
		]
		expect(roundRobinSpeaker(seats, history)).toBe(11)
	})

	it("before the person has spoken, a seat with a greeting is not due and one without is", () => {
		const seats = [alice, bram]
		expect(roundRobinSpeaker(seats, [])).toBe(11)
		expect(roundRobinSpeaker(seats, [reply(11)])).toBe(22)
		expect(roundRobinSpeaker(seats, [reply(11), reply(22)])).toBeNull()
	})

	it("decides nobody on an empty cast", () => {
		expect(roundRobinSpeaker([], [user()])).toBeNull()
	})
})

describe("user-split", () => {
	const personas = [
		{ personaId: 7, ownerUserId: 1 },
		{ personaId: 8, ownerUserId: 2 }
	]
	const mine = [seat(11, 0, 1), seat(22, 1, 1)]
	const theirs = [seat(33, 2, 2)]
	const seats = [...mine, ...theirs]

	it("the last sender's own seats complete a turn before anyone else's", () => {
		const history = [user(8)]
		expect(userSplitSpeaker(seats, personas, history)).toBe(33)
		history.push(reply(33))
		expect(userSplitSpeaker(seats, personas, history)).toBeNull()
		history.push(user(7))
		expect(userSplitSpeaker(seats, personas, history)).toBe(11)
		history.push(reply(11))
		expect(userSplitSpeaker(seats, personas, history)).toBe(22)
	})

	it("falls back to the flat rotation when the sender owns no seat", () => {
		const history = [user(9)] // a persona nobody listed
		expect(userSplitSpeaker(seats, personas, history)).toBe(11)
		const lonely = [{ personaId: 8, ownerUserId: 3 }]
		expect(userSplitSpeaker(seats, lonely, [user(8)])).toBe(11)
	})

	it("a persona-less send falls back too", () => {
		expect(userSplitSpeaker(seats, personas, [{ role: "user" }])).toBe(11)
	})
})

describe("the cast read, reduced to seats", () => {
	const cast = {
		sessionCharacters: [
			{ enabled: true, position: 2, character: { id: 3, name: "C", userId: 1 } },
			{ enabled: false, position: 0, character: { id: 1, name: "A", userId: 1 } },
			{ enabled: true, position: 1, removedAt: new Date(), character: { id: 2, userId: 1 } },
			{ enabled: true, position: 0, character: { id: 4, name: "D", userId: 2 } },
			{ enabled: true, position: 5, character: null }
		],
		sessionPersonas: [
			{ persona: { id: 7, userId: 1 } },
			{ persona: { id: 8, userId: 2 }, removedAt: new Date() }
		],
		envoys: [
			{ slug: "mascot", position: 1, speaks: "in-turn" },
			{ slug: "judge", position: 0, speaks: "on-action" },
			{ slug: "gone", position: 2, speaks: "in-turn", removedAt: new Date() }
		]
	}

	it("keeps active, present, backed rows in position order", () => {
		expect(rotationSeats(cast).map((s) => s.characterId)).toEqual([4, 3])
		expect(rotationSeats(cast)[0]).toMatchObject({ ownerUserId: 2, name: "D" })
	})

	it("keeps live personas with their owner", () => {
		expect(rotationPersonas(cast)).toEqual([{ personaId: 7, ownerUserId: 1 }])
	})

	it("offers only live in-turn envoys", () => {
		expect(inTurnEnvoys(cast).map((e) => e.slug)).toEqual(["mascot"])
	})
})

describe("the envoy's turn", () => {
	const envoys = [
		{ slug: "a", position: 0 },
		{ slug: "b", position: 1 }
	]
	it("is due when the person spoke last, never after a reply", () => {
		expect(nextEnvoyTurn(envoys, [user()])).toBe("a")
		expect(
			nextEnvoyTurn(envoys, [
				user(),
				{ role: "assistant", metadata: { speaker: "envoy:a" } }
			])
		).toBeNull()
	})
	it("goes to whoever replied longest ago", () => {
		const history: RotationMessage[] = [
			user(),
			{ role: "assistant", metadata: { speaker: "envoy:a" } },
			user(),
			{ role: "assistant", metadata: { speaker: "envoy:b" } },
			user()
		]
		expect(nextEnvoyTurn(envoys, history)).toBe("a")
	})
})

describe("the selection a script is handed", () => {
	it("names the candidates, the round-robin answer as due, and the last speaker", () => {
		const sel = turnSelection(
			[alice, bram],
			[{ slug: "mascot", position: 9 }],
			[user(), reply(11)]
		)
		expect(sel.speaker).toBeNull()
		expect(sel.candidates.map((c) => c.speaker)).toEqual([
			"character:11",
			"character:22",
			"envoy:mascot"
		])
		expect(sel.due).toBe("character:22")
		expect(sel.lastSpeaker).toBe("character:11")
		expect(sel.sinceUser).toBe(1)
	})

	it("falls to the envoy for due when no seat is, and reads an envoy's reply as the last speaker", () => {
		const sel = turnSelection([], [{ slug: "mascot", position: 0 }], [user()])
		expect(sel.due).toBe("envoy:mascot")
		expect(sel.lastSpeaker).toBeNull()
		expect(
			lastSpeakerRef([{ role: "assistant", metadata: { speaker: "envoy:mascot" } }])
		).toBe("envoy:mascot")
	})
})

/**
 * The mentioned orderer (PLAN-turn-order §4.4, R8): whoever the person
 * named goes first. A composable node rather than a seventh strategy, so
 * the rule lives here with the others it composes with.
 */
describe("mentionedFirst", () => {
	const c = (
		ref: string,
		name: string,
		nickname?: string
	): TurnCandidate => ({
		ref: ref as ParticipantRef,
		kind: "character",
		name,
		position: 0,
		...(nickname ? { nickname } : {})
	})
	const cast = [
		c("character:11", "Alice"),
		c("character:12", "Bram", "Bee"),
		c("character:13", "Cyd")
	]
	const said = (content: string) => [{ role: "user", content }]

	it("moves a named candidate to the front and keeps the rest in order", () => {
		const { candidates, mentioned } = mentionedFirst(cast, said("Cyd, wait."))
		expect(candidates.map((x) => x.ref)).toEqual([
			"character:13",
			"character:11",
			"character:12"
		])
		expect(mentioned).toEqual(["character:13"])
	})

	it("orders several by first mention, not by candidate order", () => {
		const { candidates } = mentionedFirst(cast, said("Cyd and Alice argue."))
		expect(candidates.map((x) => x.ref)).toEqual([
			"character:13",
			"character:11",
			"character:12"
		])
	})

	it("matches case-insensitively", () => {
		const { mentioned } = mentionedFirst(cast, said("ALICE!"))
		expect(mentioned).toEqual(["character:11"])
	})

	it("matches a nickname", () => {
		const { mentioned } = mentionedFirst(cast, said("Bee, over here"))
		expect(mentioned).toEqual(["character:12"])
	})

	it("is whole-word: a name inside a longer word is not a mention", () => {
		expect(mentionedFirst(cast, said("malice everywhere")).mentioned).toEqual(
			[]
		)
		// …and beside punctuation it still is.
		expect(mentionedFirst(cast, said("(Alice)")).mentioned).toEqual([
			"character:11"
		])
	})

	it("no match leaves the order exactly as it was", () => {
		const { candidates, mentioned } = mentionedFirst(cast, said("nobody"))
		expect(candidates.map((x) => x.ref)).toEqual(cast.map((x) => x.ref))
		expect(mentioned).toEqual([])
	})

	it("reads the person's rows only, and only as far back as `lookback`", () => {
		const messages = [
			{ role: "user", content: "Cyd?" },
			{ role: "assistant", characterId: 13, content: "Alice is here" },
			{ role: "user", content: "go on" }
		]
		// Default lookback of 1: the newest user row alone, which names nobody
		// — the reply naming Alice is the model's business, not the person's.
		expect(mentionedFirst(cast, messages).mentioned).toEqual([])
		// Two back reaches "Cyd?".
		expect(mentionedFirst(cast, messages, 2).mentioned).toEqual([
			"character:13"
		])
	})
})

describe("an envoy's reply read off session-history (M3 fix)", () => {
	// The shape `session-history@1` publishes: the host's `toMessage`, which
	// carries the row's participant reference as `speaker` — not `metadata`.
	const history = [
		{ role: "user", characterId: null, personaId: null, content: "hi" },
		{ role: "assistant", characterId: null, speaker: "envoy:mascot", content: "hello" }
	]

	it("counts as the envoy's turn, so round robin does not seat it again", () => {
		expect(spokenRefsSince(history as any).has("envoy:mascot")).toBe(true)
		expect(
			roundRobinEntries(
				[{ ref: "envoy:mascot", kind: "envoy", name: "Guide", position: 0 }] as any,
				history as any
			)
		).toEqual([])
	})
})
