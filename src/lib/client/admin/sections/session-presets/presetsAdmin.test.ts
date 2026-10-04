import { describe, expect, it } from "vitest"
import { presetDeletion, presetStatus } from "./presetsAdmin"

const base = { id: 1, name: "Chat", genreId: "core:chat", enabled: true, isDefault: false, isImmutable: false }

describe("presetStatus", () => {
	it("puts an unavailable binding before hidden and available", () => {
		expect(presetStatus({ ...base, staleBindings: [{ event: "e", bound: "x", reason: "gone", fallbackSpec: null }] })).toBe("stale")
		expect(presetStatus({ ...base, enabled: false })).toBe("hidden")
		expect(presetStatus(base)).toBe("available")
	})
})

describe("presetDeletion", () => {
	it("keeps built-ins and names the default a delete releases", () => {
		const d = presetDeletion(
			[
				{ ...base, isImmutable: true },
				{ ...base, id: 2, name: "Mine", isDefault: true }
			],
			() => "Chat"
		)
		expect(d.objects).toEqual([
			{ label: "Mine", related: [{ label: "No longer the default for", items: ["Chat"] }] }
		])
		expect(d.summary).toContain("keep running")
	})
})
