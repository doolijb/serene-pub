import { describe, expect, it } from "vitest"
import { connectionGuardsLine, groupSeams, seamHref } from "./scriptMap"

type Option = Sockets.Pipelines.Option

const opt = (over: Partial<Option> & Pick<Option, "id">): Option =>
	({
		label: "Scripts · before text",
		control: "scripts-chain",
		step: { key: "s-reply", heading: "Reply" },
		value: [],
		source: "default",
		writable: true,
		overriddenHere: false,
		scripts: [],
		...over
	}) as Option

const fixture: Option[] = [
	opt({ id: "o-temp", control: "number", label: "Temperature" }),
	opt({
		id: "o-retr-in",
		step: { key: "s-retr", heading: "Retrieval" },
		at: "in:text",
		seamKind: "in"
	}),
	opt({
		id: "o-reply-in",
		at: "in:text",
		seamKind: "in",
		scripts: [
			{ id: 1, name: "Trim", enabled: true, typeLabel: "Transform", blastRadius: "", operation: "transform" }
		]
	}),
	opt({
		id: "o-gone",
		label: "Scripts · no longer here (old-point)",
		at: "old-point",
		seamKind: "point",
		unplaced: true
	}),
	opt({
		id: "o-reply-out",
		label: "Scripts · after text",
		at: "out:text",
		seamKind: "out",
		acceptsLabels: ["Stop"],
		connectionScripts: {
			connectionName: "Local KCPP",
			entries: [
				{ id: 7, name: "No user lines", enabled: true },
				{ id: 8, name: "Cut at ###", enabled: false }
			]
		}
	})
]

describe("groupSeams", () => {
	it("keeps only chains, groups by step in first-seen order, seams in payload order", () => {
		const map = groupSeams(fixture)
		expect(map.steps.map((s) => [s.stepKey, s.heading])).toEqual([
			["s-retr", "Retrieval"],
			["s-reply", "Reply"]
		])
		expect(map.steps[1]!.rows.map((r) => r.id)).toEqual(["o-reply-in", "o-reply-out"])
	})

	it("files an unplaced chain under Unplaced only", () => {
		const map = groupSeams(fixture)
		expect(map.unplaced.map((r) => r.id)).toEqual(["o-gone"])
		expect(map.steps.flatMap((s) => s.rows).some((r) => r.id === "o-gone")).toBe(false)
	})

	it("is empty for a pipeline with no seams", () => {
		expect(groupSeams([fixture[0]!])).toEqual({ steps: [], unplaced: [] })
	})
})

describe("connectionGuardsLine", () => {
	it("names the connection and its guards on a text/stop seam", () => {
		expect(connectionGuardsLine(fixture[4]!)).toBe(
			"Also here: Local KCPP's stop guards: No user lines, Cut at ###"
		)
	})
	it("is null with no guards", () => {
		expect(connectionGuardsLine(fixture[2]!)).toBeNull()
		expect(
			connectionGuardsLine({ connectionScripts: { connectionName: "X", entries: [] } })
		).toBeNull()
	})
})

describe("seamHref", () => {
	it("lands on the configure tab, configuration, step and option", () => {
		expect(seamHref("core:chat", 3, fixture[2]!)).toBe(
			"/admin/pipelines/core%3Achat?tab=configure&config=3&step=s-reply&option=o-reply-in"
		)
	})
	it("omits the configuration when none is selected", () => {
		expect(seamHref("p", null, fixture[2]!)).toBe(
			"/admin/pipelines/p?tab=configure&step=s-reply&option=o-reply-in"
		)
	})
})
