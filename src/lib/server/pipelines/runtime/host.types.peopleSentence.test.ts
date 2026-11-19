/**
 * The people-sentence marker and the run's record of marked halts
 * (`host.types.ts`): the raise site marks, never a text match.
 */
import { describe, expect, it } from "vitest"
import {
	forPeople,
	HostScopeError,
	notePeopleHalt,
	peopleSentenceOf,
	takePeopleSentence
} from "./host.types"

describe("forPeople / peopleSentenceOf", () => {
	it("marks an error and a returned halt, returning the same value", () => {
		const e = new HostScopeError("save: You can only name your own seat.")
		expect(forPeople(e, "You can only name your own seat.")).toBe(e)
		expect(peopleSentenceOf(e)).toBe("You can only name your own seat.")
		expect(e.message).toBe("save: You can only name your own seat.")
		expect(peopleSentenceOf(forPeople({ halt: "h" }, "h"))).toBe("h")
	})

	it("an unmarked error class, a non-object or an empty sentence reads undefined", () => {
		expect(peopleSentenceOf(new HostScopeError("x"))).toBeUndefined()
		expect(peopleSentenceOf("text")).toBeUndefined()
		expect(peopleSentenceOf(null)).toBeUndefined()
		expect(peopleSentenceOf(forPeople(new Error("x"), ""))).toBeUndefined()
		expect(peopleSentenceOf(forPeople(new Error("x"), undefined))).toBeUndefined()
	})
})

describe("notePeopleHalt / takePeopleSentence", () => {
	it("the equality picks the entry (the last such); the run is forgotten after take", () => {
		notePeopleHalt("run-a", "one", "sentence one")
		notePeopleHalt("run-a", "two", "sentence two")
		notePeopleHalt("run-a", "two", "sentence two again")
		expect(takePeopleSentence("run-a", "two")).toBe("sentence two again")
		expect(takePeopleSentence("run-a", "one")).toBeUndefined()
	})

	it("a reason nobody recorded, or no reason, reads undefined and still forgets", () => {
		notePeopleHalt("run-b", "one", "s")
		expect(takePeopleSentence("run-b", "other")).toBeUndefined()
		expect(takePeopleSentence("run-b", "one")).toBeUndefined()
		notePeopleHalt("run-c", "one", "s")
		expect(takePeopleSentence("run-c", undefined)).toBeUndefined()
		expect(takePeopleSentence("run-c", "one")).toBeUndefined()
	})

	it("no run id records nothing", () => {
		notePeopleHalt(undefined, "one", "s")
		expect(takePeopleSentence("undefined", "one")).toBeUndefined()
	})
})
