/** 🚧 Back · Forward's shared half (RF fix 5): the strip's state as the page reads it. */
import { describe, expect, test } from "vitest"
import { REWIND_STRIP_REASONS } from "@serene-pub/core-catalog/conversation"
import {
	REWIND_REFUSALS,
	regeneratePress,
	rewindStateOf,
	rewindStateWith,
	withStackReplaced
} from "./rewind"

describe("the strip's state off the session", () => {
	test("reads the server's state, and nothing from a host that sends none", () => {
		expect(rewindStateOf({ rewind: { ahead: 2, back: null, forward: null } })).toEqual({ ahead: 2, back: null, forward: null, regenerate: null })
		expect(rewindStateOf({})).toBeNull()
		expect(rewindStateOf({ rewind: { ahead: -1, back: 3, forward: "x" } })).toEqual({ ahead: 0, back: null, forward: "x", regenerate: null })
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

	test("the refusal module quotes the SDK's two strip reasons", () => {
		expect(REWIND_REFUSALS.notOwner).toBe(REWIND_STRIP_REASONS.notOwner)
		expect(REWIND_REFUSALS.busy).toBe(REWIND_STRIP_REASONS.generating)
	})

	test("Back: the settled sentence lifts only for a person's line past the settle line", () => {
		const served = (settledLine?: number) => ({
			settledLine,
			rewind: { ahead: 0, back: REWIND_REFUSALS.settled, forward: null }
		})
		expect(rewindStateWith(served(20), [{ id: 21, role: "user", channel: "main" }])?.back).toBeNull()
		expect(rewindStateWith(served(20), [{ id: 19, role: "user", channel: "main" }])?.back).toBe(REWIND_REFUSALS.settled)
		expect(rewindStateWith(served(), [{ id: 21, role: "user", channel: "main" }])?.back).toBe(REWIND_REFUSALS.settled)
	})

	test("Back: every-turn-kept and any other served sentence stand against a person's line", () => {
		const line = [{ id: 3, role: "user", channel: "main" }]
		const kept = { rewind: { ahead: 0, back: REWIND_REFUSALS.everyTurnKept, forward: null } }
		const archived = { rewind: { ahead: 0, back: "This session is archived.", forward: null } }
		expect(rewindStateWith(kept, line)?.back).toBe(REWIND_REFUSALS.everyTurnKept)
		expect(rewindStateWith(archived, line)?.back).toBe("This session is archived.")
	})

	test("Regenerate: refused on an empty story and on a person's newest line; lifted off an assistant's", () => {
		const of = (regenerate: string | null) => ({ rewind: { ahead: 0, back: null, forward: null, regenerate } })
		expect(rewindStateWith(of(null), [])?.regenerate).toBe(REWIND_REFUSALS.empty)
		expect(rewindStateWith(of(null), [{ role: "assistant", channel: "main" }, { role: "user", channel: "main" }])?.regenerate).toBe(
			REWIND_REFUSALS.ownLine
		)
		expect(rewindStateWith(of(REWIND_REFUSALS.ownLine), [{ role: "user" }, { role: "assistant" }])?.regenerate).toBeNull()
		expect(rewindStateWith(of("x"), [{ role: "user" }, { role: "assistant" }])?.regenerate).toBe("x")
		// A line on a side channel is no story line.
		expect(rewindStateWith(of(null), [{ role: "user", channel: "parley:2" }])?.regenerate).toBe(REWIND_REFUSALS.empty)
	})

	test("withStackReplaced empties what is ahead and keeps the rest", () => {
		expect(withStackReplaced({ ahead: 2, back: "b", forward: null, regenerate: "r" })).toEqual({
			ahead: 0,
			back: "b",
			forward: REWIND_REFUSALS.noneAhead,
			regenerate: "r"
		})
	})

	test("regeneratePress: the first reason that holds", () => {
		const rewind = { ahead: 0, back: null, forward: null, regenerate: "from the session" }
		const base = { offered: true, generating: false, listedReason: null, rewind }
		expect(regeneratePress({ ...base, offered: false })).toBeNull()
		expect(regeneratePress({ ...base, generating: true })).toEqual({ disabled: true, reason: REWIND_REFUSALS.busy })
		expect(regeneratePress({ ...base, listedReason: "from the list" })).toEqual({ disabled: true, reason: "from the list" })
		expect(regeneratePress(base)).toEqual({ disabled: true, reason: "from the session" })
		expect(regeneratePress({ ...base, rewind: null })).toEqual({ disabled: false })
	})
})
