import { describe, expect, it } from "vitest"
import { scriptDeletion } from "./scriptsAdmin"

describe("scriptDeletion", () => {
	it("keeps built-in and chained scripts", () => {
		const d = scriptDeletion([
			{ id: 1, name: "Trim", isImmutable: true, usedBy: [] },
			{ id: 2, name: "Mine", isImmutable: false, usedBy: ["Chat"] },
			{ id: 3, name: "Spare", isImmutable: false, usedBy: [] }
		])
		expect(d.objects.map((o) => o.label)).toEqual(["Spare"])
		expect(d.summary).toContain("Mine stays: still in the chain of Chat")
		expect(d.title).toBe("Delete Spare?")
	})
})
