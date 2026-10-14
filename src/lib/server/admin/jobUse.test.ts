import { describe, expect, it } from "vitest"
import { neededJobs } from "./jobUse"

const site = (definitionId: string, version = 1) => ({
	definitionId,
	version,
	slot: "connection"
})

const COMBOS = [
	{ id: "text->text", demanded: true, requiredBy: [site("core:task/reply")] },
	{
		id: "text->image",
		demanded: true,
		requiredBy: [site("core:oracle/generate-image")]
	},
	{ id: "text->entities", demanded: false, requiredBy: [] }
]

describe("neededJobs", () => {
	it("chat is needed before anything has run; a job only the catalog could use is not", () => {
		expect(neededJobs(COMBOS, new Set())).toEqual({ "text->text": "replies" })
	})

	it("a job is needed once a step that requires it failed in a run", () => {
		expect(
			neededJobs(COMBOS, new Set(["core:oracle/generate-image@1"]))
		).toEqual({ "text->text": "replies", "text->image": "failedRun" })
	})

	it("matches the receipt's id@version, so another version's failure does not count", () => {
		expect(
			neededJobs(COMBOS, new Set(["core:oracle/generate-image@2"]))
		).toEqual({ "text->text": "replies" })
	})
})
