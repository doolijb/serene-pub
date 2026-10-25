/** 🚧 Back · Forward's shared half (RF fix 5): the strip's state as the page reads it. */
import { describe, expect, test } from "vitest"
import { REWIND_REFUSALS, replaceNote, rewindStateOf, rewindStateWith, turnsAhead } from "./rewind"

describe("the strip's state off the session", () => {
	test("reads the server's state, and nothing from a host that sends none", () => {
		expect(rewindStateOf({ rewind: { ahead: 2, back: null, forward: null } })).toEqual({ ahead: 2, back: null, forward: null })
		expect(rewindStateOf({})).toBeNull()
		expect(rewindStateOf({ rewind: { ahead: -1, back: 3, forward: "x" } })).toEqual({ ahead: 0, back: null, forward: "x" })
	})

	test("a person's line on the story the page holds enables Back at once; a branch's copy is the fork", () => {
		const session = { rewind: { ahead: 0, back: REWIND_REFUSALS.nothing, forward: REWIND_REFUSALS.noneAhead } }
		expect(rewindStateWith(session, [{ role: "assistant", channel: "main" }])?.back).toBe(REWIND_REFUSALS.nothing)
		expect(rewindStateWith(session, [{ role: "assistant" }, { role: "user", channel: "main" }])?.back).toBeNull()
		// A side channel's line is no turn of the story.
		expect(rewindStateWith(session, [{ role: "user", channel: "parley:2" }])?.back).toBe(REWIND_REFUSALS.nothing)
		expect(rewindStateWith(session, [{ role: "user", channel: "main", metadata: { copyOf: 4 } }])?.back).toBe(REWIND_REFUSALS.fork)
		expect(rewindStateWith({}, [{ role: "user" }])).toBeNull()
	})

	test("words", () => {
		expect(turnsAhead(1)).toBe("1 turn ahead")
		expect(replaceNote(2)).toBe("2 turns ahead will be replaced if you write now.")
	})
})
