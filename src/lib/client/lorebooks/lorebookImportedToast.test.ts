import { describe, expect, test } from "vitest"
import { lorebookImportedToast } from "./lorebookImportedToast"

describe("lorebookImportedToast", () => {
	test("a book that finished importing is a plain success", () => {
		expect(lorebookImportedToast(undefined)).toEqual({
			kind: "success",
			title: "Lorebook imported"
		})
		expect(lorebookImportedToast([])).toEqual({
			kind: "success",
			title: "Lorebook imported"
		})
	})

	test("a book saved with something unfinished is imported, with the warnings said", () => {
		expect(
			lorebookImportedToast([
				"The lorebook list could not be refreshed. Reload to see the new book.",
				"1 link from the file could not be restored."
			])
		).toEqual({
			kind: "warning",
			title: "Lorebook imported with warnings",
			description:
				"The lorebook list could not be refreshed. Reload to see the new book. 1 link from the file could not be restored."
		})
	})
})
