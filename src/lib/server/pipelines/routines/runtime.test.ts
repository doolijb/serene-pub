/**
 * 🚧 The routine runtime's pure parts (PLAN-layering R11, R15, R21; lane 6):
 * the cron caps (min of system, the owner's and the routine's), their
 * sentences, the 5-minute grid, what a turn is, and what a moment carries.
 */
import { describe, expect, it } from "vitest"
import { afterEachRound, everyNTurns, systemCron, type EffectiveRegistration } from "@serene-pub/sdk"
import { capsOf, capsPause, spanWords } from "./interaction"
import { gridPoint, msToNextTick, TICK_MS } from "./tick"
import { takesTurn, lineSpeaker, laneOf } from "./moments"
import { causeOf, wakesOf } from "./evaluate"

describe("the cron caps (R11)", () => {
	it("the effective cap is the lowest layer that states one — system ≥ the owner's ≥ the routine's", () => {
		expect(capsOf({ idleTimeoutMinutes: 4320, maxRunsInRow: 12 }, null, null)).toEqual({ idleTimeoutMinutes: 4320, maxRunsInRow: 12 })
		expect(capsOf({ idleTimeoutMinutes: 4320, maxRunsInRow: 12 }, { idleTimeoutMinutes: 60 }, { maxRunsInRow: 3 })).toEqual({
			idleTimeoutMinutes: 60,
			maxRunsInRow: 3
		})
		// A layer can lower a cap, never raise it past the one above.
		expect(capsOf({ idleTimeoutMinutes: 60, maxRunsInRow: 12 }, { idleTimeoutMinutes: 600 }, { maxRunsInRow: 50 })).toEqual({
			idleTimeoutMinutes: 60,
			maxRunsInRow: 12
		})
		expect(capsOf(null, null, null)).toEqual({ idleTimeoutMinutes: null, maxRunsInRow: null })
	})

	it("past either cap a routine pauses, and says why", () => {
		const caps = { idleTimeoutMinutes: 4320, maxRunsInRow: 12 }
		const now = 10 * 24 * 60 * 60_000
		expect(capsPause(now, { lastInteractionAt: now - 60_000, runsSinceInteraction: 0 }, caps)).toBeNull()
		expect(capsPause(now, { lastInteractionAt: now - 4321 * 60_000, runsSinceInteraction: 0 }, caps)).toBe(
			"Paused: no one has played for 3 days"
		)
		expect(capsPause(now, { lastInteractionAt: now, runsSinceInteraction: 12 }, caps)).toBe("Paused after 12 runs in a row")
		expect(capsPause(now, { lastInteractionAt: now, runsSinceInteraction: 11 }, caps)).toBeNull()
	})

	it("spans in the largest whole unit", () => {
		expect(spanWords(4320)).toBe("3 days")
		expect(spanWords(1440)).toBe("1 day")
		expect(spanWords(120)).toBe("2 hours")
		expect(spanWords(90)).toBe("90 minutes")
		expect(spanWords(5)).toBe("5 minutes")
	})
})

describe("the 5-minute grid (R15)", () => {
	it("the next tick is the next whole 5 minutes, never now", () => {
		expect(TICK_MS).toBe(5 * 60_000)
		const at = Date.parse("2026-10-21T09:02:30Z")
		expect(at + msToNextTick(at)).toBe(Date.parse("2026-10-21T09:05:00Z"))
		const onGrid = Date.parse("2026-10-21T09:05:00Z")
		expect(msToNextTick(onGrid)).toBe(TICK_MS)
		expect(gridPoint(Date.parse("2026-10-21T09:07:59Z"))).toBe(onGrid)
	})
})

describe("what a turn is", () => {
	const row = (over: Record<string, unknown> = {}) => ({
		role: "assistant",
		channel: "main",
		metadata: {},
		characterId: 4,
		personaId: null,
		isNarratorResponse: false,
		...over
	})
	it("every speaker's line on a lane (R51) — a member's line, a reply, the narrator's, on any lane", () => {
		expect(takesTurn(row())).toBe(true)
		expect(takesTurn(row({ role: "user", characterId: null, personaId: 9 }))).toBe(true)
		expect(takesTurn(row({ characterId: null, isNarratorResponse: true }))).toBe(true)
		expect(takesTurn(row({ channel: "main:1" }))).toBe(true)
		expect(takesTurn(row({ channel: "sanctum" }))).toBe(true)
		expect(takesTurn(row({ channel: "main:2" }))).toBe(true)
	})
	it("not a greeting, a host's announcement or a system row", () => {
		expect(takesTurn(row({ metadata: { isGreeting: true } }))).toBe(false)
		expect(takesTurn(row({ metadata: { goalReached: true } }))).toBe(false)
		expect(takesTurn(row({ role: "system" }))).toBe(false)
	})
	it("each lane is its own count — the story's lane is `main` however it is spelled", () => {
		expect(laneOf("main")).toBe("main")
		expect(laneOf("main:1")).toBe("main")
		expect(laneOf(null)).toBe("main")
		expect(laneOf("main:2")).toBe("main:2")
		expect(laneOf("sanctum")).toBe("sanctum")
	})
	it("whose turn it was, as a participant reference — nobody's for narration", () => {
		expect(lineSpeaker(row())).toBe("character:4")
		expect(lineSpeaker(row({ role: "user", characterId: null, personaId: 9 }))).toBe("character:9")
		expect(lineSpeaker(row({ characterId: null, metadata: { speaker: "envoy:guide" } }))).toBe("envoy:guide")
		expect(lineSpeaker(row({ role: "user", characterId: null, metadata: { speaker: "player-seat:3" } }))).toBe("player-seat:3")
		expect(lineSpeaker(row({ role: "user", characterId: null, userId: 7 }))).toBe("user:7")
		expect(lineSpeaker(row({ characterId: null, isNarratorResponse: true }))).toBeNull()
	})
})

describe("what a moment carries (R9)", () => {
	it("the moment's own facts, one port each — nothing opinionated", () => {
		expect(causeOf({ kind: "turn-ended", turn: 3 }, { at: 5, event: "core:event/turn-ended@1", payload: { messageId: 12, speaker: "character:4", turn: 3 } })).toEqual({
			moment: "turn-ended",
			at: 5,
			event: "core:event/turn-ended@1",
			payload: { messageId: 12, speaker: "character:4", turn: 3 },
			messageId: 12,
			speaker: "character:4",
			turn: 3
		})
		// R51, R52: the lane, the round and each speaker's turns ride along.
		const turnsBy = { "character:4": 1, "character:9": 1 }
		expect(
			causeOf({ kind: "turn-ended", turn: 4 }, { at: 6, payload: { messageId: 13, speaker: "character:4", lane: "main", turn: 4, round: 2, turnsBy } })
		).toMatchObject({ lane: "main", turn: 4, round: 2, turnsBy })
		expect(
			causeOf({ kind: "round-ended", round: 2 }, { at: 7, payload: { lane: "main", turn: 4, round: 2, speakers: ["character:9", "character:4"] } })
		).toMatchObject({ round: 2, speakers: ["character:9", "character:4"] })
		expect(causeOf({ kind: "system-tick", at: 300_000 }, { at: 300_000 })).toEqual({ moment: "system-tick", at: 300_000, scheduledFor: 300_000 })
		expect(
			causeOf(
				{ kind: "story-clock-moved", from: { year: 1 }, to: { year: 2 } },
				{ at: 1, payload: { clock: { from: { year: 1 }, to: { year: 2 } } } }
			).clock
		).toEqual({ from: { year: 1 }, to: { year: 2 } })
		expect(causeOf({ kind: "event", event: "e", payload: { ref: "character:2", userId: 5 } }, { at: 1, payload: { ref: "character:2", userId: 5 } })).toMatchObject({
			castMember: "character:2",
			user: "user:5"
		})
	})

	it("the moments a session's routines wake on — nothing is read for any other", () => {
		const reg = (cadence: unknown) => ({ key: "k", trigger: { family: "routine", cadence }, pipeline: "p", origin: "genre" }) as EffectiveRegistration
		expect([...wakesOf([reg(everyNTurns({ n: 5 })), reg(afterEachRound()), reg(systemCron({ every: 1, unit: "hours" }))])].sort()).toEqual([
			"round-ended",
			"system-tick",
			"turn-ended"
		])
	})
})
