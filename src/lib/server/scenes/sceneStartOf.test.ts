import { describe, expect, it } from "vitest"
import { sceneStartOf } from "./historyEntryOfDate"

describe("sceneStartOf", () => {
	it("starts at the opening line, even when a selection is smaller", () => {
		expect(
			sceneStartOf({ openedAtMessageId: 40, selectedMessageIds: [5, 9] })
		).toBe(40)
	})

	it("starts at the smallest selected line when there is no opening line", () => {
		expect(
			sceneStartOf({
				openedAtMessageId: null,
				selectedMessageIds: [30, 12, 21]
			})
		).toBe(12)
	})

	it("starts nowhere with neither an opening line nor a selection", () => {
		expect(
			sceneStartOf({ openedAtMessageId: null, selectedMessageIds: null })
		).toBeNull()
		expect(
			sceneStartOf({ openedAtMessageId: null, selectedMessageIds: [] })
		).toBeNull()
	})
})
