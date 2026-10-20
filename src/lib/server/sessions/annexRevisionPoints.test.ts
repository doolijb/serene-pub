/**
 * 🚧 Annex revision points (PLAN-dc-after-walk2 Q1-4): a revision puts the
 * story's keys back where they stood, and leaves a person's preference about
 * the session — "Don't ask again" on Regenerate — as it is now.
 */
import { describe, expect, test } from "vitest"
import { REVISION_POINTS_OWNER, revisedAnnex } from "./annexRevisionPoints"

describe("revisedAnnex", () => {
	const annex = (now: Record<string, unknown>, point: Record<string, unknown>) => ({
		...now,
		[REVISION_POINTS_OWNER]: { "7": point }
	})

	test("the story's keys go back to the revision point", () => {
		const out = revisedAnnex(annex({ core: {}, dc: { leads: ["new"] } }, { dc: { leads: ["old"] } }), 6)
		expect(out).toEqual({ dc: { leads: ["old"] } })
	})

	test("'Don't ask again' set after the point survives the revision; cleared after it, it stays cleared", () => {
		const set = revisedAnnex(annex({ core: { "retake-quietly": true }, dc: { leads: ["new"] } }, { dc: { leads: ["old"] } }), 6)
		expect(set).toEqual({ dc: { leads: ["old"] }, core: { "retake-quietly": true } })
		const cleared = revisedAnnex(annex({ dc: { leads: ["new"] } }, { core: { "retake-quietly": true }, dc: { leads: ["old"] } }), 6)
		expect(cleared).toEqual({ dc: { leads: ["old"] } })
	})
})
