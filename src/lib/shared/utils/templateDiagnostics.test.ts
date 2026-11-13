import { describe, expect, test } from "vitest"
import { laidOutScope, type TemplateScope } from "@serene-pub/sdk"
import { templateDiagnostics } from "./templateDiagnostics"

const HB = "core:template/handlebars@1"
const LQ = "core:template/liquid@1"
const ID = "core:var/characters@1"

const SCOPE: TemplateScope = {
	characters: {
		type: "list",
		of: { type: "object", fields: { name: { type: "string" } } }
	},
	scenario: { type: "string" }
}
const laid = laidOutScope(SCOPE, { characters: ID })
const offers = {
	[ID]: [
		{ reference: "acme.dice/prose@1", label: "Prose" },
		{ reference: "core/json@1", label: "JSON" }
	]
}

describe("layout findings in the editor's lint", () => {
	test("a near miss on a dotted owner is fixed by replacing the whole reference", () => {
		const src = `x {{{layout characters "acme.dice/prse@1"}}} y`
		const { diagnostics } = templateDiagnostics(HB, src, laid, {
			variableLayoutOffers: offers
		})
		const d = diagnostics.find((x) => x.kind === "unknown-layout")!
		expect(d.severity).toBe("error")
		expect(d.fix?.text).toBe("acme.dice/prose@1")
		expect(d.fix?.label).toBe('Use "acme.dice/prose@1"')
		expect(src.slice(d.fix!.start, d.fix!.end)).toBe("acme.dice/prse@1")
	})

	test("Liquid: the same fix", () => {
		const src = `{{ characters | layout: "acme.dice/prse@1" }}`
		const { diagnostics } = templateDiagnostics(LQ, src, laid, {
			variableLayoutOffers: offers
		})
		const d = diagnostics.find((x) => x.kind === "unknown-layout")!
		expect(src.slice(d.fix!.start, d.fix!.end)).toBe("acme.dice/prse@1")
		expect(d.fix?.text).toBe("acme.dice/prose@1")
	})

	test("with offers absent a well-formed reference passes silently", () => {
		const src = `{{{layout characters "acme.dice/prose@1"}}}`
		expect(templateDiagnostics(HB, src, laid).diagnostics).toEqual([])
	})

	test("a layout call on a key that is not laid out is a layout-argument error", () => {
		const src = `{{{layout scenario "core/json@1"}}}`
		const { diagnostics } = templateDiagnostics(HB, src, laid, {
			variableLayoutOffers: offers
		})
		const d = diagnostics.find((x) => x.kind === "layout-argument")
		expect(d?.severity).toBe("error")
	})
})
