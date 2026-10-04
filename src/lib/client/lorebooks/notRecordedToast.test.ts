/**
 * The toast a scene save or a session delete shows when recording the
 * session onto the world's timeline left values out (plan A18).
 */
import { describe, expect, test } from "vitest"
import { notRecordedToast } from "./notRecordedToast"

describe("notRecordedToast", () => {
	test("nothing left out is the action's own success", () => {
		expect(notRecordedToast("Scene saved", undefined)).toEqual({ kind: "success", title: "Scene saved" })
		expect(notRecordedToast("Scene saved", [])).toEqual({ kind: "success", title: "Scene saved" })
	})

	test("a value left out is a warning that names it, and whose it was", () => {
		expect(
			notRecordedToast("Session deleted", [
				"Verity · Born does not fit this book's calendar: Ember has 28 days."
			])
		).toEqual({
			kind: "warning",
			title: "Session deleted, but a value wasn't recorded",
			description:
				"The lorebook's timeline didn't take it: Verity · Born does not fit this book's calendar: Ember has 28 days."
		})
	})

	test("many are named three at a time, with a count of the rest", () => {
		const five = ["A · one.", "B · two.", "C · three.", "D · four.", "E · five."]
		const toast = notRecordedToast("Scene saved", five)
		expect(toast.title).toBe("Scene saved, but 5 values weren't recorded")
		expect(toast.description).toBe(
			"The lorebook's timeline didn't take them: A · one. B · two. C · three. And 2 more."
		)
	})
})
