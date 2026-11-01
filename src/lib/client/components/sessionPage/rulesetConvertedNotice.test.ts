import { describe, expect, test } from "vitest"
import { rulesetConvertedHeaderNotice } from "./rulesetConvertedNotice"

const opts = { dismissed: false, dismiss: () => {} }

describe("rulesetConvertedHeaderNotice", () => {
	test("nothing converted: no notice", () => {
		expect(rulesetConvertedHeaderNotice(null, opts)).toBeNull()
	})
	test("dismissed: no notice", () => {
		expect(rulesetConvertedHeaderNotice({ from: "1.0.0", to: "2.0.0" }, { ...opts, dismissed: true })).toBeNull()
	})
	test("else the sentence, with no link and no action", () => {
		const n = rulesetConvertedHeaderNotice({ from: "1.0.0", to: "2.0.0" }, opts)
		expect(n?.text).toBe("The rules were updated from v1.0.0 to v2.0.0 when this session opened.")
		expect(n?.link).toBeNull()
		expect(n?.action).toBeUndefined()
	})
})
