import { describe, expect, test } from "vitest"
import { rulesetOriginOf } from "./origin"

const none = new Set<string>()
describe("rulesetOriginOf", () => {
	test("core: ids are core", () => {
		expect(rulesetOriginOf("core:ruleset/x@1", undefined, none)).toBe("core")
	})
	test("no row is a plugin's code", () => {
		expect(rulesetOriginOf("acme:ruleset/x@1", undefined, none)).toBe("plugin")
	})
	test("an owner that is an installed plugin is plugin", () => {
		const row = { ownerSlug: "acme", createdBy: 3, retiredAt: null }
		expect(rulesetOriginOf("acme:ruleset/x@1", row, new Set(["acme"]))).toBe("plugin")
	})
	test("a package row left retired is plugin", () => {
		const row = { ownerSlug: "acme", createdBy: null, retiredAt: new Date() }
		expect(rulesetOriginOf("acme:ruleset/x@1", row, none)).toBe("plugin")
	})
	test("otherwise pub", () => {
		const row = { ownerSlug: "me", createdBy: 1, retiredAt: null }
		expect(rulesetOriginOf("me:ruleset/x@1", row, none)).toBe("pub")
	})
})
