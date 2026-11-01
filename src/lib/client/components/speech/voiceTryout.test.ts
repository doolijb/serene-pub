import { describe, expect, test } from "vitest"
import {
	bytesToBlob,
	clipCaption,
	parseSeedInput,
	previewParams,
	rerollSeed,
	seedHint
} from "./voiceTryout"

const o = { requestId: "r1", text: "Hi", seed: null, inflection: null }

describe("previewParams", () => {
	test("a seed is merged into settings; null removes the base's", () => {
		expect(previewParams({ settings: { speed: 1.1 } }, { ...o, seed: 7 }).settings).toEqual({ speed: 1.1, seed: 7 })
		expect(previewParams({ settings: { speed: 1.1, seed: 3 } }, o).settings).toEqual({ speed: 1.1 })
		expect(previewParams({ settings: { seed: 3 } }, o).settings).toBeUndefined()
	})
	test("blank text and fields are omitted", () => {
		const p = previewParams({ voiceId: " ", description: " ", language: "", voice: "" }, { ...o, text: "  " })
		expect(p).toEqual({ requestId: "r1" })
	})
	test("filled fields pass; text is trimmed; mood passes", () => {
		const p = previewParams({ voiceId: " af ", description: "warm", language: "en" }, { ...o, text: " Hi ", inflection: "joy" })
		expect(p).toMatchObject({ voiceId: "af", description: "warm", language: "en", text: "Hi", inflection: "joy" })
	})
})

describe("seeds", () => {
	test("rerollSeed is an in-range integer", () => {
		expect(rerollSeed(() => 0)).toBe(0)
		expect(rerollSeed(() => 0.999999999999)).toBeLessThanOrEqual(2147483647)
		expect(Number.isInteger(rerollSeed())).toBe(true)
	})
	test("parseSeedInput", () => {
		expect(parseSeedInput(5)).toBe(5)
		expect(parseSeedInput(null)).toBeNull()
		expect(parseSeedInput(1.5)).toBeNull()
		expect(parseSeedInput(-1)).toBeNull()
		expect(parseSeedInput(2147483648)).toBeNull()
		expect(parseSeedInput("4")).toBeNull()
	})
	test("hint depends on designsVoice", () => {
		expect(seedHint(true)).toMatch(/picks which person/)
		expect(seedHint(false)).toMatch(/Blank sends none/)
	})
})

describe("clipCaption", () => {
	test("voice, model, seed", () => {
		expect(clipCaption({ spokenAs: { voice: "af", model: "kokoro" }, seed: 9 })).toBe("Spoken as af · kokoro · seed 9")
		expect(clipCaption({ spokenAs: { voice: "af", model: "" } })).toBe("Spoken as af")
		expect(clipCaption({ spokenAs: null, seed: 0 })).toBe("seed 0")
		expect(clipCaption({ spokenAs: null })).toBe("")
	})
})

test("bytesToBlob keeps size and type", () => {
	const b = bytesToBlob(Buffer.from([1, 2, 3]).toString("base64"), "audio/wav")
	expect(b.size).toBe(3)
	expect(b.type).toBe("audio/wav")
})

import { formatClock, seedChipLabel } from "./voiceTryout"
describe("clip clock and seed chip", () => {
	test("formatClock", () => {
		expect(formatClock(0)).toBe("0:00")
		expect(formatClock(7.9)).toBe("0:07")
		expect(formatClock(65)).toBe("1:05")
		expect(formatClock(NaN)).toBe("0:00")
		expect(formatClock(null)).toBe("0:00")
	})
	test("seedChipLabel", () => {
		expect(seedChipLabel(355260212)).toBe("person #355260212")
	})
})
