/** 🚧 `core:task/clock-step@1` (live scenes §6): the step decided — pure, never the clock. */
import { describe, expect, test } from "vitest"
import { clockStepOf } from "./clockStep"

describe("clockStepOf", () => {
	test("a press's collected step wins over the parameters", () => {
		expect(clockStepOf({ by: 3, unit: "days" }, { by: 1, unit: "minutes" })).toEqual({
			moves: true,
			by: 3,
			unit: "days"
		})
		expect(clockStepOf({ by: -2, unit: "years" }, undefined)).toEqual({ moves: true, by: -2, unit: "years" })
	})

	test("no step: the parameters — By 0, the reply tick's default, moves nothing", () => {
		expect(clockStepOf(undefined, undefined)).toEqual({ moves: false, by: 0, unit: "minutes" })
		expect(clockStepOf(undefined, { by: 0, unit: "hours" })).toEqual({ moves: false, by: 0, unit: "hours" })
		expect(clockStepOf(undefined, { by: 5, unit: "minutes" })).toEqual({ moves: true, by: 5, unit: "minutes" })
		// A step that does not read is not a step.
		expect(clockStepOf({ by: 1.5, unit: "days" }, { by: 1, unit: "hours" })).toEqual({
			moves: true,
			by: 1,
			unit: "hours"
		})
	})

	test("unless — a re-driven row — holds the clock: a regenerate never ticks twice", () => {
		expect(clockStepOf(undefined, { by: 1, unit: "minutes" }, 42).moves).toBe(false)
		expect(clockStepOf(undefined, { by: 1, unit: "minutes" }, [42]).moves).toBe(false)
		expect(clockStepOf(undefined, { by: 1, unit: "minutes" }, null).moves).toBe(true)
		expect(clockStepOf(undefined, { by: 1, unit: "minutes" }, []).moves).toBe(true)
	})
})
