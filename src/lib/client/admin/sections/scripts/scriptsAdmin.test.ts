import { describe, expect, it } from "vitest"
import { scriptDeletion, useFacets, useHref } from "./scriptsAdmin"

const chain = (over: Partial<Extract<Sockets.Pipelines.Scripts.UseRow, { kind: "pipeline" }>> = {}) =>
	({
		kind: "pipeline",
		pipelineSlug: "core:chat",
		pipelineLabel: "Reply · Chat",
		nodeKey: "extract",
		stepLabel: "Extract cast",
		at: "out:cast",
		stepKey: "abc",
		optionId: "def",
		unplaced: false,
		...over
	}) as const

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

describe("useFacets", () => {
	it("an unattached script is Unused, and only that", () => {
		expect(useFacets([])).toEqual(["unused"])
	})

	it("holds every place at once, in filter order; an unplaced chain is still in a pipeline", () => {
		expect(
			useFacets([
				{ kind: "connection", connectionId: 4, connectionName: "Kobold" },
				chain({ unplaced: true })
			])
		).toEqual(["pipeline", "connection", "unplaced"])
		expect(useFacets([chain()])).toEqual(["pipeline"])
	})
})

describe("useHref", () => {
	it("a chain opens its step, scrolled to the chain", () => {
		expect(useHref(chain())).toBe("/admin/pipelines/core%3Achat?tab=configure&step=abc&option=def")
	})

	it("a connection opens its stop scripts", () => {
		expect(useHref({ kind: "connection", connectionId: 4, connectionName: "K" })).toBe(
			"/admin/connections/4#stop-scripts"
		)
	})
})
