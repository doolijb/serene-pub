/**
 * 🚧 The duties steps' modes (PLAN-layering §4) and what a reply that carries
 * changes takes over (PLAN-genres-seams S2, ★B, 2026-10-23): while the
 * session's reply carries changes at Full, the reckoning's *Keep the sheets*
 * and *Track conditions* read Off and say why; nothing else moves.
 */
import { describe, expect, it } from "vitest"
import * as C from "@serene-pub/contracts"
import { CEDED_TO_REPLY_CHANGES, dutyModes } from "./duties"

const ALL_ON = { attributes: true, conditions: true, time: true, placesOnMove: true, timedExpiry: true }

describe("dutyModes", () => {
	it("each duty at the routine's mode, off when its switch is", () => {
		const out = dutyModes(C.reckoningDuties.id, { ...ALL_ON, time: false }, { mode: "review" })
		expect(out.modes).toEqual({ attributes: "review", conditions: "review", time: "off", "places-on-move": "review", "timed-expiry": "review" })
		expect(out.any).toBe(true)
		expect(out.main).toEqual({ modes: out.modes, any: true })
	})

	it("S2: replies carrying changes at Full take the sheets and the conditions; the receipt says why", () => {
		const out = dutyModes(C.reckoningDuties.id, ALL_ON, { mode: "full" }, { replyChanges: "full" })
		expect(out.modes).toEqual({ attributes: "off", conditions: "off", time: "full", "places-on-move": "full", "timed-expiry": "full" })
		expect(out.main.ceded).toEqual({ attributes: CEDED_TO_REPLY_CHANGES, conditions: CEDED_TO_REPLY_CHANGES })
		expect(CEDED_TO_REPLY_CHANGES).toBe("off: replies carry changes")
		// Something is still on: the routine runs for the rest.
		expect(out.any).toBe(true)
	})

	it("S2: a duty already off is not said to be ceded; replies off take nothing; other contracts cede nothing", () => {
		const off = dutyModes(C.reckoningDuties.id, { ...ALL_ON, conditions: false }, null, { replyChanges: "full" })
		expect(off.main.ceded).toEqual({ attributes: CEDED_TO_REPLY_CHANGES })
		expect(dutyModes(C.reckoningDuties.id, ALL_ON, null, { replyChanges: "off" }).main.ceded).toBeUndefined()
		expect(dutyModes(C.reckoningDuties.id, ALL_ON, null).modes.attributes).toBe("full")
		const sweep = dutyModes(C.sweepDuties.id, { summary: true, worldState: true }, null, { replyChanges: "full" })
		expect(sweep.modes).toEqual({ summary: "full", "world-state": "full" })
		expect(sweep.main.ceded).toBeUndefined()
	})

	it("S2: with only the two on, the reckoning has nothing left to do", () => {
		const out = dutyModes(C.reckoningDuties.id, { attributes: true, conditions: true, time: false, placesOnMove: false, timedExpiry: false }, null, { replyChanges: "full" })
		expect(out.any).toBe(false)
	})

	it("the reply's own duties publish `reply-changes`", () => {
		expect(dutyModes(C.replyDuties.id, { lore: true, scene: false, changes: true }, null).modes).toEqual({
			"lore-retrieval": "full",
			"scene-reading": "off",
			"reply-changes": "full"
		})
	})
})
