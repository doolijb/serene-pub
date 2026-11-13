import { describe, expect, test } from "vitest"
import { asksToJoin, benchedOnly, BENCHED_ONLY_GUEST, BENCHED_ONLY_OWNER, composerWritingAs, isCardlessPlayerSeat, isLivePlayerSeat, isOwnPlayerSeat, offersSeat, ownCardlessPlayerSeats } from "./playerSeat"

const card = { id: 1, personaId: 9, persona: { userId: 1, name: "Ann" }, userId: 1 }
const named = { id: 2, personaId: null, persona: null, userId: 2, seatName: "Bo" }
const blank = { id: 3, personaId: null, persona: null, userId: 2, seatName: " " }
const gone = { ...named, id: 4, removedAt: new Date() }

describe("a player seat as a person's voice", () => {
	test("their card, or their named card-less seat", () => {
		expect(isOwnPlayerSeat(card, 1)).toBe(true)
		expect(isOwnPlayerSeat(card, 2)).toBe(false)
		expect(isOwnPlayerSeat(named, 2)).toBe(true)
		expect(isOwnPlayerSeat(named, 1)).toBe(false)
		expect(isOwnPlayerSeat(blank, 2)).toBe(false)
		expect(isOwnPlayerSeat(gone, 2)).toBe(false)
	})
	test("anyone's live voice; their card-less seats in order", () => {
		expect([card, named, blank, gone].map(isLivePlayerSeat)).toEqual([true, true, false, false])
		expect(ownCardlessPlayerSeats([card, blank, gone, named], 2).map((s) => s.id)).toEqual([2])
	})
})

describe("🚧 a benched seat is never a person's voice (owner 2026-11-10)", () => {
	const benchedCard = { ...card, id: 5, isActive: false }
	const benchedNamed = { ...named, id: 6, isActive: false }
	test("isOwnPlayerSeat and isLivePlayerSeat are false for isActive: false", () => {
		expect(isOwnPlayerSeat(benchedCard, 1)).toBe(false)
		expect(isOwnPlayerSeat(benchedNamed, 2)).toBe(false)
		expect([benchedCard, benchedNamed].map(isLivePlayerSeat)).toEqual([false, false])
		expect(ownCardlessPlayerSeats([benchedNamed, named], 2).map((s) => s.id)).toEqual([2])
		expect(ownCardlessPlayerSeats([benchedNamed], 2)).toEqual([])
	})
	test("isCardlessPlayerSeat stays a shape test: a benched seat is still one", () => {
		expect(isCardlessPlayerSeat(benchedNamed)).toBe(true)
		expect(isCardlessPlayerSeat(gone)).toBe(false)
	})
	// ★L2-1 (open): a guest whose only seat is benched has no voice, so the
	// join gates ask again — pinned here so a change to it is a decision.
	test("a guest whose only seat is benched is asked to join, or offered a seat", () => {
		expect(asksToJoin({ isGuest: true, personasInMode: true, seats: [benchedCard], userId: 1 })).toBe(true)
		expect(
			offersSeat({ isGuest: true, personasInMode: true, seats: [benchedNamed], userId: 2, playerLabel: "Dungeon Master" })
		).toBe(true)
	})
})

describe("whom the composer says the viewer writes as (composer.playerLabel)", () => {
	test("their own card-less seat by its name, no article — over the genre's label", () => {
		expect(composerWritingAs({ ownSeat: { seatName: "Ann" }, playerLabel: "Adventurer" })).toBe("Ann")
	})
	test("else the genre's label with its article; nothing when neither", () => {
		expect(composerWritingAs({ ownSeat: null, playerLabel: "Adventurer" })).toBe("the Adventurer")
		expect(composerWritingAs({ ownSeat: { seatName: "  " }, playerLabel: "Dungeon Master" })).toBe("the Dungeon Master")
		expect(composerWritingAs({ ownSeat: null, playerLabel: " " })).toBeUndefined()
	})
})

describe("a guest's join prompt (round 2, 2026-10-15)", () => {
	const ask = (seats: any[], userId = 2, isGuest = true, personasInMode = true) =>
		asksToJoin({ isGuest, personasInMode, seats, userId })
	test("a guest with a live named seat is not asked to add a persona", () => {
		expect(ask([named])).toBe(false)
		expect(ask([card], 1)).toBe(false)
	})
	test("a guest with no voice here is asked", () => {
		expect(ask([])).toBe(true)
		expect(ask([blank])).toBe(true)
		expect(ask([gone])).toBe(true)
		expect(ask([card])).toBe(true)
	})
	test("never the owner, never a genre with no personas", () => {
		expect(ask([], 2, false)).toBe(false)
		expect(ask([], 2, true, false)).toBe(false)
	})
})

describe("🚧 a genre of player seats never asks a player for a persona (2026-10-16)", () => {
	const ask = (o: { playerLabel?: string; isPlayer?: boolean }) =>
		asksToJoin({ isGuest: true, personasInMode: true, seats: [], userId: 2, ...o })
	test("a guest who plays opens a seat by name, not a card", () => {
		expect(ask({ playerLabel: "Adventurer", isPlayer: true })).toBe(false)
		expect(ask({ playerLabel: "Adventurer" })).toBe(false)
	})
	test("a watcher, or a genre with no player label, is still asked", () => {
		expect(ask({ playerLabel: "Adventurer", isPlayer: false })).toBe(true)
		expect(ask({ isPlayer: true })).toBe(true)
	})
})

describe("🚧 a genre of player seats offers a guest who plays a seat (Lair rewrite D5, 2026-10-21)", () => {
	const offer = (o: Partial<Parameters<typeof offersSeat>[0]> = {}) =>
		offersSeat({ isGuest: true, personasInMode: true, seats: [], userId: 2, playerLabel: "Dungeon Master", ...o })
	test("a seatless guest who plays is offered a seat — exactly where asksToJoin keeps quiet", () => {
		expect(offer()).toBe(true)
		expect(asksToJoin({ isGuest: true, personasInMode: true, seats: [], userId: 2, playerLabel: "Dungeon Master" })).toBe(false)
	})
	test("a seat of their own — a card or a named card-less seat — ends the offer", () => {
		expect(offer({ seats: [{ id: 4, personaId: null, seatName: "Maren", userId: 2 }] })).toBe(false)
		expect(offer({ seats: [{ id: 5, personaId: 9, persona: { userId: 2 } }] })).toBe(false)
		// Somebody else's seat is not theirs.
		expect(offer({ seats: [{ id: 6, personaId: null, seatName: "Kit", userId: 3 }] })).toBe(true)
	})
	test("never the owner, a watcher, a genre with no player label or no personas", () => {
		expect(offer({ isGuest: false })).toBe(false)
		expect(offer({ isPlayer: false })).toBe(false)
		expect(offer({ playerLabel: null })).toBe(false)
		expect(offer({ personasInMode: false })).toBe(false)
	})
})

describe("🚧 benchedOnly (owner 2026-11-11)", () => {
	const mine = { id: 7, personaId: 9, persona: { userId: 1, name: "Ann" }, userId: 1 }
	const benched = { ...mine, isActive: false }
	test("a viewer whose only seat is benched", () => {
		expect(benchedOnly({ seats: [benched], userId: 1 })).toBe(true)
		expect(benchedOnly({ seats: [benched, named], userId: 1 })).toBe(true)
	})
	test("unchanged with a seat in play, no seat, a gone seat or someone else's bench", () => {
		expect(benchedOnly({ seats: [benched, { ...mine, id: 8 }], userId: 1 })).toBe(false)
		expect(benchedOnly({ seats: [], userId: 1 })).toBe(false)
		expect(benchedOnly({ seats: null, userId: 1 })).toBe(false)
		expect(benchedOnly({ seats: [{ ...benched, removedAt: new Date() }], userId: 1 })).toBe(false)
		expect(benchedOnly({ seats: [benched], userId: 2 })).toBe(false)
		expect(benchedOnly({ seats: [benched], userId: null })).toBe(false)
	})
	test("a benched-only guest is neither asked to join nor offered a seat", () => {
		const guest = { isGuest: true, personasInMode: true, seats: [benched], userId: 1 }
		expect(benchedOnly(guest)).toBe(true)
		expect(BENCHED_ONLY_GUEST).toBe("You're on the bench — the owner can bring you back.")
		expect(BENCHED_ONLY_OWNER).toBe("You're on the bench — bring yourself back in Participants.")
	})
})
