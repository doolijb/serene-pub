import { describe, it, expect } from "vitest"
import { slotFor } from "$lib/server/pipelines/runtime/tools/stateTools"
import { ToolError } from "$lib/server/pipelines/runtime/tools"

/**
 * `slotFor` matches a name against the session's OWN vocabulary.
 *
 * The declaration registry is global: an instance that merely has an
 * adventure genre installed declares hp and weather for every session. A
 * name resolved against it lands a stat on a session that does not track it,
 * and the refusal listed every declaration as "this session tracks".
 */

const TRACKED = [
	"core:slot/hp@1",
	"core:slot/mood@1",
	"acme:slot/sanity@2"
]

describe("slotFor", () => {
	it("matches a local name, in any case, within the session's vocabulary", () => {
		expect(slotFor("hp", TRACKED)).toBe("core:slot/hp@1")
		expect(slotFor(" Sanity ", TRACKED)).toBe("acme:slot/sanity@2")
	})

	it("accepts a full id the session tracks", () => {
		expect(slotFor("core:slot/mood@1", TRACKED)).toBe("core:slot/mood@1")
	})

	it("refuses a slot declared elsewhere but not tracked here, full id or name", () => {
		expect(() => slotFor("core:slot/weather@1", TRACKED)).toThrow(ToolError)
		expect(() => slotFor("weather", TRACKED)).toThrow(ToolError)
	})

	it("names only what this session tracks when it refuses", () => {
		let message = ""
		try {
			slotFor("weather", TRACKED)
		} catch (e) {
			message = (e as Error).message
		}
		expect(message).toBe(
			"there is no 'weather' to set here. This session tracks: hp, mood, sanity."
		)
	})

	it("says 'nothing' for a session with no vocabulary", () => {
		expect(() => slotFor("hp", [])).toThrow(
			"there is no 'hp' to set here. This session tracks: nothing."
		)
	})
})
