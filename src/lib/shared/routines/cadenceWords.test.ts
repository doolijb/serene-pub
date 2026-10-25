/**
 * 🚧 When a routine runs, in words (lane 7): every core cadence reads as one
 * sentence a member understands, from the ids the SDK declares.
 */
import { describe, expect, test } from "vitest"
import {
	afterEachRound,
	afterEachScene,
	afterEachTurn,
	everyNTurns,
	onEvent,
	schedule,
	systemCron,
	timelineCron,
	whenIdle,
	coreEvents
} from "@serene-pub/sdk"
import { cadenceWords, jumpCeilingWords, minutesInWords } from "./cadenceWords"

describe("cadenceWords", () => {
	test("turn, round and scene cadences", () => {
		expect(cadenceWords(afterEachTurn())).toBe("After each turn")
		expect(cadenceWords(afterEachRound())).toBe("After each round")
		expect(cadenceWords(afterEachScene())).toBe("After each scene")
		expect(cadenceWords(everyNTurns({ n: 5 }))).toBe("Every 5 turns")
		expect(cadenceWords(everyNTurns({ n: 1 }))).toBe("After each turn")
	})

	test("the clocks: real time and story time", () => {
		expect(cadenceWords(systemCron({ every: 30, unit: "minutes" }))).toBe("Every 30 minutes")
		expect(cadenceWords(systemCron({ every: 1, unit: "hours" }))).toBe("Every hour")
		expect(cadenceWords(timelineCron({ every: 30, unit: "minutes" }))).toBe("Every 30 minutes of story time")
		expect(cadenceWords(timelineCron({ every: 1, unit: "days" }))).toBe("Every day of story time")
		expect(cadenceWords(whenIdle({ minutes: 120 }))).toBe("When nobody has played for 2 hours")
	})

	test("a schedule says when, on which clock", () => {
		expect(cadenceWords(schedule({ clock: "system", at: { daily: "09:00" } }))).toBe("Daily at 09:00")
		expect(cadenceWords(schedule({ clock: "system", at: { weekly: { weekday: 0, time: "18:30" } } }))).toBe(
			"Weekly on Monday at 18:30"
		)
		expect(cadenceWords(schedule({ clock: "story", at: { monthly: { day: 5, time: "06:00" } } }))).toBe(
			"Monthly on day 5 at 06:00 (story time)"
		)
	})

	test("an event names itself when the caller can say it", () => {
		const ref = onEvent(coreEvents.sceneOpened)
		expect(cadenceWords(ref)).toBe("When something happens")
		expect(cadenceWords(ref, { eventName: () => "Scene opened" })).toBe("On scene opened")
	})

	test("a cadence this module does not know reads as its declared name", () => {
		expect(cadenceWords({ id: "acme.dice:cadence/on-a-six@1", options: {}, name: "On a six" })).toBe("On a six")
		expect(cadenceWords({ id: "acme.dice:cadence/on-a-six@1" })).toBe("On its own schedule")
	})

	test("the jump ceiling, and quiet spans", () => {
		expect(jumpCeilingWords(timelineCron({ every: 30, unit: "minutes", maxJump: { every: 12, unit: "hours" } }))).toBe(
			"Skips when the clock jumps more than 12 hours"
		)
		expect(jumpCeilingWords(timelineCron({ every: 30, unit: "minutes" }))).toBeNull()
		expect(minutesInWords(4320)).toBe("3 days")
		expect(minutesInWords(45)).toBe("45 minutes")
	})
})
