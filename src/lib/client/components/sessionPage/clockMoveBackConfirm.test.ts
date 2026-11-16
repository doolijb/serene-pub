/** 🚧 The words a clock moved back asks in, for each On revision mode. */
import { describe, expect, test } from "vitest"
import { clockMoveBackAsking } from "./clockMoveBackConfirm"

const notice = (mode: "overwrite" | "branch") => ({
	mode,
	count: 3,
	latestLabel: "Year 412",
	toLabel: "Year 400",
	sentence: "This passes 3 dated writes."
})

describe("clockMoveBackAsking", () => {
	test("overwrite names the mode and offers Move back", () => {
		expect(clockMoveBackAsking(notice("overwrite"))).toEqual({
			question: "Move the story back?",
			description: "This passes 3 dated writes. On revision: Overwrite.",
			confirmLabel: "Move back"
		})
	})
	test("branch names the mode and offers Branch and move back", () => {
		expect(clockMoveBackAsking(notice("branch"))).toEqual({
			question: "Move the story back?",
			description: "This passes 3 dated writes. On revision: Branch.",
			confirmLabel: "Branch and move back"
		})
	})
})
