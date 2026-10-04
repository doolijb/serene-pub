import { describe, expect, test } from "vitest"
import { importCompletionOf } from "./importCompletion"

describe("what the SillyTavern import's completion screen says", () => {
	test("a clean import is complete, in the success tone", () => {
		expect(importCompletionOf("complete")).toEqual({
			heading: "Import complete",
			toast: "Import completed",
			tone: "success"
		})
	})

	test("an item that failed, a stop and nothing landed are never a success", () => {
		expect(importCompletionOf("partial")).toEqual({
			heading: "Import finished with errors",
			toast: "Import finished with errors",
			tone: "warning"
		})
		expect(importCompletionOf("stopped")).toEqual({
			heading: "Import stopped early",
			toast: "Import stopped early",
			tone: "warning"
		})
		expect(importCompletionOf("nothing")).toEqual({
			heading: "Nothing was imported",
			toast: "Nothing was imported",
			tone: "warning"
		})
	})
})
