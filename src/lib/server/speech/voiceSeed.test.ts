import { describe, expect, it } from "vitest"
import { seedFor, stableVoiceSeed } from "./voiceSeed"

describe("voice seed", () => {
	it("is stable for the same description, case and whitespace aside; different for another", () => {
		const a = stableVoiceSeed(["Sweet and seductive woman", null])
		expect(stableVoiceSeed(["  sweet AND seductive woman ", ""])).toBe(a)
		expect(stableVoiceSeed(["Gruff old sailor", null])).not.toBe(a)
		expect(a).toBeGreaterThanOrEqual(0)
		expect(a).toBeLessThanOrEqual(2147483647)
	})
	it("the entry's seed wins; a designing model derives one; others send none", () => {
		expect(seedFor({ designsVoice: true, entrySeed: 42, description: "x", voiceId: null })).toBe(42)
		expect(seedFor({ designsVoice: true, entrySeed: null, description: "x", voiceId: null })).toBe(
			stableVoiceSeed(["x", null])
		)
		expect(seedFor({ designsVoice: false, entrySeed: null, description: "x", voiceId: "af" })).toBeUndefined()
		expect(seedFor({ designsVoice: false, entrySeed: 7, description: "x", voiceId: "af" })).toBe(7)
	})
})
