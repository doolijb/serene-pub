/**
 * A run's toast is titled with the action's name, never its identity
 * (lair pass W-GATE: "/room" with no knock toasted `core:spec/lair-room-answer#room`).
 */
import { describe, expect, test } from "vitest"
import { actionTitle } from "./actionTitle"

const listed = [
	{ specSlug: "core:spec/lair-room-answer", key: "room", name: "Answer the door" },
	{ specSlug: "core:spec/lair-nudge", key: "nudge", name: "Nudge" },
	{ key: "summarize", name: "Summarize" }
]

describe("actionTitle", () => {
	test("an identity reads as the listed action's name", () => {
		expect(actionTitle("core:spec/lair-room-answer#room", listed)).toBe("Answer the door")
	})

	test("a bare key reads as the listed keyless action's name", () => {
		expect(actionTitle("summarize", listed)).toBe("Summarize")
	})

	test("the same key on another spec is not a match", () => {
		expect(actionTitle("plugin:spec/other#nudge", listed)).toBe("nudge")
	})

	test("an unlisted identity falls back to its key, never the whole identity", () => {
		expect(actionTitle("core:spec/lair-trap#trap", [])).toBe("trap")
	})

	test("nothing named reads as a plain word", () => {
		expect(actionTitle(undefined, listed)).toBe("Action")
	})
})
