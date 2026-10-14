/**
 * The readiness strip's words (lane D): shown only while the chat job has no
 * model; an admin gets **Fill the Reply loadout**, a member is told who to ask.
 */
import { describe, expect, it } from "vitest"
import { readinessStripState } from "./readinessStrip"

const set = { connectionId: 1, connectionModelId: 2, samplingConfigId: null }

describe("readinessStripState", () => {
	it("says nothing before the defaults arrive", () => {
		expect(readinessStripState(undefined, false)).toBeNull()
		expect(readinessStripState(null, true)).toBeNull()
	})

	it("says nothing once chat has a model", () => {
		expect(readinessStripState({ "text->text": set }, false)).toBeNull()
		expect(readinessStripState({ "text->text": set }, true)).toBeNull()
	})

	it("shows when chat is not registered at all", () => {
		const s = readinessStripState({}, false)
		expect(s).toEqual({
			headline: "Sessions can't reply yet.",
			sentence: "No model is set up to reply. Ask your administrator."
		})
	})

	it("treats a connection without a model as unset (incomplete pair)", () => {
		const s = readinessStripState(
			{ "text->text": { ...set, connectionModelId: null } },
			true
		)
		expect(s?.action?.label).toBe("Fill the Reply loadout")
	})

	it("ignores other jobs' defaults", () => {
		expect(
			readinessStripState({ "text->image": set }, false)
		).not.toBeNull()
	})

	it("gives an admin the button and no 'ask your administrator'", () => {
		const s = readinessStripState({}, true)
		expect(s).toEqual({
			headline: "Sessions can't reply yet.",
			sentence: "The Reply loadout has no model.",
			action: { label: "Fill the Reply loadout" }
		})
	})

	it("gives a member no button", () => {
		expect(readinessStripState({}, false)?.action).toBeUndefined()
	})
})
