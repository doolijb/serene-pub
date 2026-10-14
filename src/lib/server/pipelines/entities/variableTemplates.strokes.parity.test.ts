/**
 * The characters rows with card strokes ON (`STROKES_ENABLED`, paused by the
 * owner 2026-10-11 — see `strokesFlag.ts`). Split from
 * `variableTemplates.parity.test.ts` because the layout reads the flag once,
 * at import: this file loads it ON, that one as shipped.
 */

import { describe, it, expect, vi } from "vitest"

vi.mock("$lib/shared/characters/strokesFlag", () => ({ STROKES_ENABLED: true }))

import {
	SHIPPED_VARIABLE_TEMPLATES,
	renderVariable,
	shippedRowsByKey
} from "$lib/server/pipelines/entities/variableLayouts"
import { CORE_TEMPLATE_ENGINE } from "$lib/server/pipelines/prompt/renderers"

const layoutFor = (source: string, key: string) => ({
	[key]: { engine: CORE_TEMPLATE_ENGINE, source }
})

/**
 * A card painted in strokes (DESIGN-card-strokes A.4): the shipped characters
 * rows render a stroked field as the LIST of its pieces — labelled ones as
 * `{ "Label": "text" }` — and never the `strokes` array itself, and the floor
 * says the same thing through the same `strokeList`.
 */
describe("characters painted in strokes", () => {
	const piece = (kind: string, text: string, label?: string, slug?: string) => ({
		kind,
		...(slug ? { slug } : {}),
		...(label ? { label } : {}),
		text,
		fired: true
	})
	const CASES: Array<[string, unknown]> = [
		[
			"both fields stroked, one labelled",
			[
				{
					name: "Ash",
					description: "A rider.\n\nOwes a debt.",
					personality: "Temper: slow",
					strokes: [
						piece("description", "A rider."),
						piece("description", "Owes a debt.", undefined, "debt"),
						piece("personality", "slow", "Temper")
					]
				}
			]
		],
		[
			"one field stroked, the other its column",
			[
				{
					name: "Ash",
					nickname: "A",
					description: "A rider.",
					personality: "Steady.",
					strokes: [piece("personality", "Steady.")]
				}
			]
		],
		[
			"nothing fired: the pieces empty, the fields absent",
			[{ name: "Ash", strokes: [] }]
		],
		[
			"escaping inside a labelled piece",
			[
				{
					name: "Ash",
					description: `She said "no": <left>`,
					strokes: [piece("description", '"no": <left>', `She said`)]
				}
			]
		],
		[
			"a stroked card beside a plain one",
			[
				{
					name: "Ash",
					description: "A rider.",
					strokes: [piece("description", "A rider.", "Role")]
				},
				{ name: "Bran", description: "x", personality: "y" }
			]
		]
	]
	for (const t of SHIPPED_VARIABLE_TEMPLATES.filter(
		(t) => t.key === "characters"
	))
		for (const [label, value] of CASES)
			it(`${t.name}: matches the floor for ${label}`, async () => {
				const via = await renderVariable(
					layoutFor(t.source, t.key),
					t.key,
					value
				)
				expect(via).toBe(t.codeDefault(value))
				expect(via).not.toContain('"strokes"')
			})

	it("renders the list form", async () => {
		const row = shippedRowsByKey
			.get("characters")!
			.find((t) => t.variant === "content")!
		const out = await renderVariable(
			layoutFor(row.source, "characters"),
			"characters",
			CASES[0]![1]
		)
		expect(JSON.parse(out)).toEqual([
			{
				name: "Ash",
				description: ["A rider.", "Owes a debt."],
				personality: [{ Temper: "slow" }]
			}
		])
	})
})
