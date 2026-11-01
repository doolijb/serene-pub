import { describe, expect, it } from "vitest"
import {
	descriptionCopy,
	dialsOf,
	emptyVoiceDraft,
	settingsForTryout,
	speedBoundsOf,
	voiceDraftOfEntry,
	voiceDraftOfTimbre,
	voiceDraftToEntryParts,
	voiceDraftToTimbreParts
} from "./voiceFields"

describe("voice draft adapters", () => {
	it("entry round-trips every field", () => {
		const settings = { speed: 1.1, seed: 9, stability: 0.4, similarity: 0.7, style: 0.2, speakerBoost: true }
		const d = voiceDraftOfEntry({ description: "warm", language: "en", settings })
		expect(d).toEqual({ description: "warm", language: "en", speed: 1.1, seed: 9, stability: 0.4, similarity: 0.7, style: 0.2, speakerBoost: true })
		expect(voiceDraftToEntryParts(d, settings)).toEqual({ description: "warm", language: "en", settings })
	})
	it("entry keeps settings the form does not edit, and drops cleared ones", () => {
		const base = { speed: 1.2, extra: 3 } as never
		const d = { ...emptyVoiceDraft(), stability: 0.5 }
		expect(voiceDraftToEntryParts(d, base).settings).toEqual({ extra: 3, stability: 0.5 })
		expect(voiceDraftToEntryParts(emptyVoiceDraft(), base).settings).toEqual({ extra: 3 })
	})
	it("entry blanks become null", () => {
		expect(voiceDraftToEntryParts({ ...emptyVoiceDraft(), description: "  ", language: " " })).toEqual({ description: null, language: null, settings: {} })
	})
	it("timbre round-trips and omits blanks", () => {
		const t = { description: "low alto", language: "ja", settings: { speed: 0.9, seed: 4, speakerBoost: false } }
		const d = voiceDraftOfTimbre(t)
		expect(d.speakerBoost).toBe(false)
		expect(voiceDraftToTimbreParts(d, t.settings)).toEqual(t)
		expect(voiceDraftToTimbreParts(emptyVoiceDraft())).toEqual({})
		expect(voiceDraftOfTimbre(undefined)).toEqual(emptyVoiceDraft())
	})
	it("timbre keeps untouched keys", () => {
		const base = { extra: 0.3 } as never
		expect(voiceDraftToTimbreParts({ ...emptyVoiceDraft(), speed: 1.5 }, base).settings).toEqual({ extra: 0.3, speed: 1.5 })
	})
})

describe("what the model lists", () => {
	it("dials come from controls.settings only", () => {
		expect(dialsOf(null)).toEqual([])
		expect(dialsOf({})).toEqual([])
		expect(dialsOf({ settings: ["stability", "speakerBoost"] })).toEqual(["stability", "speakerBoost"])
	})
	it("speed bounds: the model's, else 0.25-4 when known, else none", () => {
		expect(speedBoundsOf(null)).toBeNull()
		expect(speedBoundsOf({})).toEqual({ min: 0.25, max: 4 })
		expect(speedBoundsOf({ speed: { min: 0.7, max: 1.2 } })).toEqual({ min: 0.7, max: 1.2 })
	})
	it("description copy changes on a designing model", () => {
		expect(descriptionCopy(null).label).toBe("Description")
		expect(descriptionCopy({ designsVoice: true }).label).toBe("The voice itself")
	})
	it("try-out settings carry speed and only the honoured dials, never the seed", () => {
		const d = { ...emptyVoiceDraft(), speed: 1.1, seed: 5, stability: 0.4, style: 0.9 }
		expect(settingsForTryout(d, { settings: ["stability"] })).toEqual({ speed: 1.1, stability: 0.4 })
		expect(settingsForTryout(d, null)).toEqual({ speed: 1.1 })
	})
})
