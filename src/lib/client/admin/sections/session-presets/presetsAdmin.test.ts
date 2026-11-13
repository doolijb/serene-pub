import { describe, expect, it } from "vitest"
import { PRESET_STATUS_ORDER, presetDeletion, presetStatus } from "./presetsAdmin"

const base = { id: 1, name: "Chat", genreId: "core:chat", enabled: true, isDefault: false, isImmutable: false }

describe("presetStatus", () => {
	it("puts an unavailable binding before hidden and available", () => {
		expect(presetStatus({ ...base, staleBindings: [{ event: "e", bound: "x", reason: "gone", fallbackSpec: null }] })).toBe("stale")
		expect(presetStatus({ ...base, danglingVariableLayouts: [{ variableId: "core:var/characters@1", reference: "gone/x@1" }] })).toBe("layouts")
		expect(
			presetStatus({
				...base,
				enabled: false,
				staleBindings: [{ event: "e", bound: "x", reason: "gone", fallbackSpec: null }],
				danglingVariableLayouts: [{ variableId: "v", reference: "r" }]
			})
		).toBe("stale")
		expect(
			presetStatus({ ...base, enabled: false, danglingVariableLayouts: [{ variableId: "v", reference: "r" }] })
		).toBe("layouts")
		expect(PRESET_STATUS_ORDER.indexOf("layouts")).toBeGreaterThan(PRESET_STATUS_ORDER.indexOf("stale"))
		expect(PRESET_STATUS_ORDER.indexOf("layouts")).toBeLessThan(PRESET_STATUS_ORDER.indexOf("hidden"))
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
