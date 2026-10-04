/**
 * **Character lore is a variable the template places** — Assemble lays out the
 * admitted rows as `characterLore`, and the shipped context template renders
 * it.
 *
 * The shape is one list of `{ title, castMember?, content }`, in rank order:
 * the entry, whose it is, and what it says. Nothing folds it into a character
 * card; a template that wants it writes `{{{characterLore}}}`.
 */

import { describe, it, expect } from "vitest"
import { allocate, render } from "$lib/server/pipelines/prompt/assemble"
import type { Decision } from "$lib/server/pipelines/ranking/select"
import { CORE_TEMPLATE_ENGINE } from "$lib/server/pipelines/prompt/renderers"
import { SHIPPED_CONTEXT_TEMPLATE } from "$lib/server/pipelines/entities/contextTemplateDefaults"
import {
	renderVariable,
	shippedRowsByKey
} from "$lib/server/pipelines/entities/variableLayouts"
import { getVariable, type VarField } from "@serene-pub/sdk"
import { assemble as assembleContract } from "@serene-pub/contracts"
import "@serene-pub/core-catalog"
import { entryDeclaration } from "$lib/server/entries/declarations"
import { CHARACTER_LORE_TYPE_ID } from "$lib/shared/entries/types"

const lore = (
	id: number,
	name: string,
	content: string,
	castMember: string | null,
	included = true
): Decision => ({
	candidate: {
		id,
		source: "characterLore",
		tokens: 10,
		signals: {},
		payload: { name, content, castMember }
	},
	score: 0.5,
	reason: included ? "filled_scored" : "excluded_token_limit",
	included,
	why: "scored"
})

const renderWith = async (decisions: Decision[], template = SHIPPED_CONTEXT_TEMPLATE) =>
	(
		await render({
			allocation: allocate(decisions, { budgetTotal: 1000 }),
			engine: CORE_TEMPLATE_ENGINE,
			template,
			messages: [{ id: 1, role: "user", content: "hello" }]
		})
	).rendered ?? ""

describe("the declarations say so", () => {
	it("Assemble renders characterLore through core:var/character-lore@1", () => {
		const slot = assembleContract.descriptor.slots?.variables
		expect(slot?.renders?.characterLore).toBe("core:var/character-lore@1")
		expect(slot?.rendersBands).toEqual({ from: "candidates" })
	})

	it("the variable is a list of entries naming their cast member", () => {
		const scope = getVariable("core:var/character-lore@1")?.scope.characterLore as VarField
		expect(scope.type).toBe("list")
		expect(Object.keys(scope.of?.fields ?? {})).toEqual(["title", "castMember", "content"])
	})

	it("the character-lore entry type renders as that variable", () => {
		expect(entryDeclaration(CHARACTER_LORE_TYPE_ID)?.render).toBe("core:var/character-lore@1")
	})
})

describe("allocation carries whose lore it is", () => {
	it("a character-lore allocation keeps its cast member", () => {
		const a = allocate([lore(1, "Verity's secret", "She burned it.", "Verity")], {
			budgetTotal: 100
		})
		expect(a.blocks[0]!.meta).toEqual({ castMember: "Verity" })
	})

	it("an entry bound to nobody carries no cast member", () => {
		const a = allocate([lore(1, "A note", "Forged.", null)], { budgetTotal: 100 })
		expect(a.blocks[0]!.meta).toBeUndefined()
	})
})

describe("the shipped template renders admitted character lore", () => {
	it("places it under its heading, each entry beside its cast member", async () => {
		const text = await renderWith([
			lore(1, "Verity's secret", "Verity burned the ledger.", "Verity"),
			lore(2, "A note", "The ledger was forged.", null)
		])
		expect(text).toContain("Character lore:")
		expect(text).toContain(
			'[{"title":"Verity\'s secret","castMember":"Verity","content":"Verity burned the ledger."},' +
				'{"title":"A note","content":"The ledger was forged."}]'
		)
	})

	it("renders an excluded entry nowhere", async () => {
		const text = await renderWith([
			lore(1, "Verity's secret", "Verity burned the ledger.", "Verity"),
			lore(2, "Brask's secret", "Brask saw it.", "Brask", false)
		])
		expect(text).toContain("Verity burned the ledger.")
		expect(text).not.toContain("Brask saw it.")
	})

	it("writes no heading when nothing was admitted", async () => {
		const text = await renderWith([lore(1, "Verity's secret", "x", "Verity", false)])
		expect(text).not.toContain("Character lore:")
	})

	it("is the template's own placement: a template without the variable renders none", async () => {
		const text = await renderWith(
			[lore(1, "Verity's secret", "Verity burned the ledger.", "Verity")],
			"{{#systemBlock}}only this{{/systemBlock}}"
		)
		expect(text).not.toContain("Verity burned the ledger.")
	})
})

describe("the shipped layouts for characterLore", () => {
	const value = [
		{ title: "Verity's secret", castMember: "Verity", content: 'She said "no".' },
		{ title: "A note", content: "Forged." }
	]

	it("ships a titled block (the default) and the bare JSON", () => {
		const rows = shippedRowsByKey.get("characterLore") ?? []
		expect(rows.map((r) => [r.variant, r.isDefault])).toEqual([
			["wrapped", true],
			["content", false]
		])
	})

	it("each row's source renders what its code floor does", async () => {
		for (const row of shippedRowsByKey.get("characterLore") ?? []) {
			const viaSource = await renderVariable(
				{ characterLore: { source: row.source, engine: CORE_TEMPLATE_ENGINE } } as any,
				"characterLore",
				value
			)
			expect(viaSource, row.name).toBe(row.codeDefault(value))
		}
	})
})
