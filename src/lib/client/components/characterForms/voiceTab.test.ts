import { describe, expect, it } from "vitest"
import {
	EMPTY_TIMBRE_DRAFT,
	extensionsForSave,
	timbreDraftOf,
	timbreOfDraft,
	narratorTryRequest,
	voiceTryRequest,
	type TimbreDraft
} from "./voiceTab"

const stored = {
	other: { keep: 1 },
	serenepub: { keepToo: true, timbre: { description: "warm", voice: "bruno", language: "en", settings: { speed: 1.2 } } }
}
const admin = { canPickVoice: true }
const member = { canPickVoice: false }

describe("timbre draft", () => {
	it("reads the stored timbre; an absent one is the empty draft", () => {
		expect(timbreDraftOf(stored)).toEqual({
			description: "warm",
			voice: "bruno",
			narrationVoice: null,
			language: "en",
			settings: { speed: 1.2 },
			spoken: true
		})
		expect(timbreDraftOf({ serenepub: { timbre: { silent: true } } }).spoken).toBe(false)
		expect(timbreDraftOf(null)).toEqual(EMPTY_TIMBRE_DRAFT)
		expect(timbreDraftOf({})).toEqual(EMPTY_TIMBRE_DRAFT)
	})
	it("writes only non-empty parts; voice only for an admin; language lower-cased", () => {
		const d: TimbreDraft = { description: "  d ", voice: "v", narrationVoice: null, language: " EN ", settings: { speed: 2 }, spoken: true }
		expect(timbreOfDraft(d, admin)).toEqual({ description: "d", voice: "v", language: "en", settings: { speed: 2 } })
		expect(timbreOfDraft(d, member)).toEqual({ description: "d", language: "en", settings: { speed: 2 } })
		expect(timbreOfDraft(EMPTY_TIMBRE_DRAFT, admin)).toEqual({})
	})
	it("narration: the voice only for an admin; a stored narrationDescription is not read and a save drops it", () => {
		const d: TimbreDraft = { ...EMPTY_TIMBRE_DRAFT, narrationVoice: "nora" }
		expect(timbreOfDraft(d, admin)).toEqual({ narrationVoice: "nora" })
		expect(timbreOfDraft(d, member)).toEqual({})
		const ext = { serenepub: { timbre: { narrationVoice: "nora", narrationDescription: "dry" } } }
		const orig = timbreDraftOf(ext)
		expect(orig.narrationVoice).toBe("nora")
		expect("narrationDescription" in orig).toBe(false)
		const out = extensionsForSave(ext, { ...orig, narrationVoice: null }, orig, admin) as any
		expect(out.serenepub.timbre).toEqual({})
	})
	it("speakerBoost round-trips through the draft", () => {
		const draft = timbreDraftOf({ serenepub: { timbre: { settings: { speakerBoost: true } } } })
		expect(draft.settings).toEqual({ speakerBoost: true })
		expect(timbreOfDraft(draft, member)).toEqual({ settings: { speakerBoost: true } })
	})
	it("a character switched off writes `silent: true`; on writes nothing", () => {
		expect(timbreOfDraft({ ...EMPTY_TIMBRE_DRAFT, spoken: false }, member)).toEqual({ silent: true })
		expect(timbreOfDraft({ ...EMPTY_TIMBRE_DRAFT, spoken: true }, member)).toEqual({})
	})
})

describe("extensionsForSave", () => {
	const original = timbreDraftOf(stored)
	it("sends nothing when the timbre did not move", () => {
		expect(extensionsForSave(stored, { ...original }, original, admin)).toBeUndefined()
		expect(extensionsForSave(stored, structuredClone(original), original, member)).toBeUndefined()
	})
	it("sends the whole stored extensions with only the timbre replaced", () => {
		const out = extensionsForSave(stored, { ...original, description: "cold" }, original, admin)!
		expect(out.other).toEqual({ keep: 1 })
		expect(out.serenepub).toEqual({
			keepToo: true,
			timbre: { description: "cold", voice: "bruno", language: "en", settings: { speed: 1.2 } }
		})
		// the stored value is never mutated
		expect((stored.serenepub.timbre as { description: string }).description).toBe("warm")
	})
	it("dials the form does not edit survive a save", () => {
		const orig = timbreDraftOf({ serenepub: { timbre: { settings: { style: 0.3 } } } })
		const out = extensionsForSave(null, { ...orig, description: "x" }, orig, admin)!
		expect(out.serenepub).toEqual({ timbre: { description: "x", settings: { style: 0.3 } } })
	})
	it("a seed round-trips through the draft", () => {
		const draft = timbreDraftOf({ serenepub: { timbre: { description: "x", settings: { seed: 99 } } } })
		expect(draft.settings).toEqual({ seed: 99 })
		expect(timbreOfDraft(draft, admin)).toEqual({ description: "x", settings: { seed: 99 } })
	})
	it("clearing everything stores an empty timbre ({}), not a stale one", () => {
		const out = extensionsForSave(stored, { ...EMPTY_TIMBRE_DRAFT }, original, admin)!
		expect((out.serenepub as { timbre: unknown }).timbre).toEqual({})
	})
	it("a member never sends a voice", () => {
		const out = extensionsForSave(stored, { ...original, description: "cold" }, original, member)!
		expect("voice" in (out.serenepub as { timbre: object }).timbre).toBe(false)
	})
	it("works from no stored extensions at all", () => {
		const out = extensionsForSave(undefined, { ...EMPTY_TIMBRE_DRAFT, description: "d" }, EMPTY_TIMBRE_DRAFT, admin)!
		expect(out).toEqual({ serenepub: { timbre: { description: "d" } } })
	})
})

describe("try-out requests", () => {
	const d: TimbreDraft = {
		...EMPTY_TIMBRE_DRAFT,
		description: "warm alto",
		voice: "bruno",
		narrationVoice: "ada",
		language: "EN",
		settings: { speed: 1.1, seed: 7 }
	}
	it("the voice try sends only the picked voice (admins); the shared fields add the rest", () => {
		expect(voiceTryRequest(d, true)).toEqual({ voice: "bruno" })
		expect(voiceTryRequest(d, false)).toEqual({})
		expect(voiceTryRequest({ ...d, voice: null }, true)).toEqual({})
	})
	it("the narrator try is the picked voice and language only: no prose, no dials", () => {
		expect(narratorTryRequest(d, true)).toEqual({ voice: "ada", language: "en" })
		expect(narratorTryRequest({ ...d, language: "" }, true)).toEqual({ voice: "ada" })
	})
	it("no narrator try for a member or with no narrator picked", () => {
		expect(narratorTryRequest(d, false)).toBeNull()
		expect(narratorTryRequest({ ...d, narrationVoice: null }, true)).toBeNull()
	})
})
