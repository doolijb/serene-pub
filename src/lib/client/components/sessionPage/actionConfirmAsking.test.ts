/** 🚧 pr-6: a confirm sentence split for `ActionConfirm`. */
import { describe, expect, test } from "vitest"
import { askingOf } from "./actionConfirmAsking"

describe("askingOf", () => {
	test("the question is up to its first '? ', the rest is under it", () => {
		expect(askingOf("Archive this session? It becomes read-only until you unarchive it.", "Archive")).toEqual({
			question: "Archive this session?",
			description: "It becomes read-only until you unarchive it.",
			confirmLabel: "Archive"
		})
	})
	test("no question mark: the whole sentence is the question", () => {
		expect(askingOf("Share it.", "Share")).toEqual({ question: "Share it.", confirmLabel: "Share" })
	})
	test("a sentence that ends on its question has no description", () => {
		expect(askingOf("Close out this session?", "Close out")).toEqual({ question: "Close out this session?", confirmLabel: "Close out" })
	})
})
