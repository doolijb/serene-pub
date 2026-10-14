/**
 * **A key is a local name; a variable id is what the value is** (owner rulings
 * 2026-10-13, PROPOSAL-variable-layout-accounting).
 *
 * Rows, the picker and the default were always per variable. The render was
 * per key string: core's absence rule, core's floor and core's band shapes
 * were handed to anything under a core key — a plugin node rendering its own
 * `currentDate`, a spec re-pointing Assemble's `characterLore`. These pin the
 * render to the variable the key resolved to, and pin core's own meaning to
 * exactly what it was.
 */
import { describe, it, expect } from "vitest"
import { definePluginVariable } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import {
	renderVariable,
	variableOfKey,
	type ResolvedLayouts
} from "$lib/server/pipelines/entities/variableLayouts"
import { CORE_TEMPLATE_ENGINE } from "$lib/server/pipelines/prompt/renderers"
import {
	allocate,
	declaredBandKeys,
	meansCoreBand,
	render
} from "$lib/server/pipelines/prompt/assemble"
import type { Decision } from "$lib/server/pipelines/ranking/select"
import { isForeignPackageRow } from "$lib/server/pipelines/boot/seedVariableTemplates"

const RANKED_LORE = definePluginVariable("acme", {
	id: "acme:var/ranked-lore@1",
	scope: { characterLore: { type: "record", of: { type: "string" } } },
	sample: { Oath: "Sworn at the gate." }
}).id
const PLAIN_DATE = definePluginVariable("acme", {
	id: "acme:var/plain-date@1",
	scope: { currentDate: { type: "string" } },
	sample: "the third day of Thaw"
}).id
const PLAIN_TEXT = definePluginVariable("acme", {
	id: "acme:var/plain-text@1",
	scope: { instructions: { type: "string" } },
	sample: "Be brief."
}).id
const OTHER_ROOT = definePluginVariable("acme", {
	id: "acme:var/other-root@1",
	scope: { lore: { type: "record", of: { type: "string" } } },
	sample: {}
}).id

const as = (variableId: string, source?: string): ResolvedLayouts[string] => ({
	variableId,
	engine: CORE_TEMPLATE_ENGINE,
	...(source !== undefined ? { source } : {})
})

describe("the render takes its rules from the variable, not the key", () => {
	it("a plugin string under `currentDate` gets its own floor, not core's date parts", async () => {
		// Core's floor reads year/month/day off an object and finds nothing in
		// a string — so core's absence rule would have dropped this entirely.
		expect(
			await renderVariable({ currentDate: as(PLAIN_DATE) }, "currentDate", "the third day of Thaw")
		).toBe("the third day of Thaw")
	})

	it("a plugin variable under `instructions` gets no core heading or fence", async () => {
		expect(
			await renderVariable({ instructions: as(PLAIN_TEXT) }, "instructions", "Be brief.")
		).toBe("Be brief.")
	})

	it("a plugin object with no row floors to minified JSON — its automatic layout's bytes", async () => {
		expect(
			await renderVariable({ characterLore: as(RANKED_LORE) }, "characterLore", { Oath: "Sworn." })
		).toBe('{"Oath":"Sworn."}')
	})

	it("a variable core ships nothing for renders nothing for an absent value, heading included", async () => {
		expect(
			await renderVariable(
				{ instructions: as(PLAIN_TEXT, "Rules:\n{{{instructions}}}") },
				"instructions",
				undefined
			)
		).toBe("")
	})

	it("a single-root variable bound under another key renders under its own root", async () => {
		// The layout is written against the variable's scope — `lore` — which is
		// what its lint and its automatic `{{{json lore}}}` row both use.
		expect(
			await renderVariable(
				{ characterLore: as(OTHER_ROOT, "{{#each lore}}{{@key}};{{/each}}") },
				"characterLore",
				{ A: "1", B: "2" }
			)
		).toBe("A;B;")
	})

	it("core's own keys are what they were when nothing names a variable", async () => {
		expect(variableOfKey(undefined, "instructions")).toBe("core:var/instructions@1")
		expect(await renderVariable(undefined, "instructions", "Stay in character.")).toBe(
			'Instructions:\n"""\nStay in character.\n"""'
		)
		expect(
			await renderVariable({ instructions: as("core:var/instructions@1") }, "instructions", "x")
		).toBe('Instructions:\n"""\nx\n"""')
	})
})

const lore = (id: number, name: string, content: string): Decision => ({
	candidate: {
		id,
		source: "characterLore",
		tokens: 10,
		signals: {},
		payload: { name, content, castMember: "Verity" }
	},
	score: 0.5,
	reason: "filled_scored",
	included: true,
	why: "scored"
})

const renderLore = async (variables?: ResolvedLayouts) =>
	(
		await render({
			allocation: allocate([lore(1, "Oath", "Sworn."), lore(2, "Scar", "Old.")], {
				budgetTotal: 1000
			}),
			engine: CORE_TEMPLATE_ENGINE,
			template: "[{{{characterLore}}}]",
			messages: [{ id: 1, role: "user", content: "hello" }],
			variables
		})
	).rendered

describe("Assemble lays a band out by what its key means", () => {
	it("core's characterLore is core's anchored list, titled, exactly as before", async () => {
		const expected =
			'[Character lore:\n```json\n[{"title":"Oath","castMember":"Verity","content":"Sworn."},' +
			'{"title":"Scar","castMember":"Verity","content":"Old."}]\n```]'
		expect(await renderLore()).toBe(expected)
		expect(await renderLore({ characterLore: as("core:var/character-lore@1") })).toBe(expected)
	})

	it("re-pointed by the spec, it is a declared band: the title-keyed object through its own floor", async () => {
		expect(await renderLore({ characterLore: as(RANKED_LORE) })).toBe(
			'[{"Oath":"Sworn.","Scar":"Old."}]'
		)
	})

	it("re-pointed with a row selected, it renders through that row", async () => {
		expect(
			await renderLore({
				characterLore: as(RANKED_LORE, "{{#each characterLore}}{{@key}}={{this}};{{/each}}")
			})
		).toBe("[Oath=Sworn.;Scar=Old.;]")
	})

	it("core's recalled-lines shape is for core's variable only", async () => {
		const line = (id: number): Decision => ({
			candidate: {
				id,
				source: "recalledLines",
				tokens: 10,
				signals: {},
				payload: { name: "Mira", content: "We met at the ford." }
			},
			score: 0.5,
			reason: "filled_scored",
			included: true,
			why: "scored"
		})
		const PLUGIN_LINES = definePluginVariable("acme", {
			id: "acme:var/recalled-lines@1",
			scope: { recalledLines: "any" },
			sample: null
		}).id
		const renderLines = async (variables: ResolvedLayouts) =>
			(
				await render({
					allocation: allocate([line(1)], { budgetTotal: 1000 }),
					engine: CORE_TEMPLATE_ENGINE,
					template: "[{{{recalledLines}}}]",
					messages: [{ id: 1, role: "user", content: "hello" }],
					variables
				})
			).rendered
		expect(await renderLines({ recalledLines: as("core:var/recalled-lines@1") })).toMatch(
			/^\[Earlier \(turn .*\) — Mira: We met at the ford\.\]$/
		)
		// A plugin's own band of that name is a declared band: no core shape.
		const plugin = await renderLines({ recalledLines: as(PLUGIN_LINES) })
		expect(plugin).not.toContain("Earlier")
		expect(plugin).toContain("We met at the ford.")
	})

	it("says which keys mean core's band", () => {
		expect(meansCoreBand(undefined, "characterLore")).toBe(true)
		expect(meansCoreBand({ characterLore: as(RANKED_LORE) }, "characterLore")).toBe(false)
		expect(meansCoreBand(undefined, "secretEntry")).toBe(false)
	})

	it("a plugin band named like a core variable is still a band", () => {
		const CHARS = definePluginVariable("acme", {
			id: "acme:var/characters@1",
			scope: { characters: "any" },
			sample: null
		}).id
		expect(declaredBandKeys({ characters: as(CHARS) })).toEqual(["characters"])
		// …and core's own `characters`, as a preview's bare layouts hand it in, is not.
		expect(declaredBandKeys({ characters: as("core:var/characters@1") })).toEqual([])
	})
})

describe("a package's row for a variable it does not own is never the default (★4)", () => {
	it("a plugin's row for a core variable is foreign; a user's own row never is", () => {
		expect(
			isForeignPackageRow({ ownerPluginId: 7, templateId: "acme:template/prose-cast@1" }, "core:var/characters@1")
		).toBe(true)
		expect(isForeignPackageRow({ ownerPluginId: null, templateId: null }, "core:var/characters@1")).toBe(false)
	})

	it("a package's row for its own variable is not foreign; another package's is", () => {
		expect(
			isForeignPackageRow({ ownerPluginId: 7, templateId: "acme:template/lore-json@1" }, "acme:var/ranked-lore@1")
		).toBe(false)
		expect(
			isForeignPackageRow({ ownerPluginId: 8, templateId: "other:template/lore@1" }, "acme:var/ranked-lore@1")
		).toBe(true)
	})
})
