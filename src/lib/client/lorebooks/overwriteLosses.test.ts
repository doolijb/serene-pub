import { describe, expect, test } from "vitest"
import { describeOverwriteLosses } from "./overwriteLosses"

describe("describeOverwriteLosses", () => {
	test("says nothing when nothing would be lost", () => {
		expect(describeOverwriteLosses(undefined)).toBeNull()
		expect(
			describeOverwriteLosses({
				amendments: 0,
				presences: 0,
				branches: 0,
				sceneLinks: 0
			})
		).toBeNull()
	})

	test("counts each kind, singular and plural", () => {
		expect(
			describeOverwriteLosses({
				amendments: 3,
				presences: 1,
				branches: 2,
				sceneLinks: 1
			})
		).toBe(
			"Overwriting also deletes 3 dated changes, 1 presence, 2 branches and 1 scene captured from a session. The file does not carry them, so they cannot come back."
		)
		expect(
			describeOverwriteLosses({
				amendments: 0,
				presences: 0,
				branches: 1,
				sceneLinks: 0
			})
		).toBe(
			"Overwriting also deletes 1 branch. The file does not carry it, so it cannot come back."
		)
	})
})
