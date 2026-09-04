import { describe, it, expect } from "vitest"
import {
	SHIPPED_VARIABLE_TEMPLATES,
	renderVariable,
	shippedByKey,
	wrapFor
} from "$lib/server/pipelines/entities/variableLayouts"
import { CORE_TEMPLATE_ENGINE } from "$lib/server/pipelines/prompt/renderers"
import { getVariable } from "@serene-pub/sdk"
import type { VarField } from "@serene-pub/sdk"

/**
 * The gate on the whole feature: **selecting a shipped layout changes nothing.**
 *
 * Context variables used to be stringified in TypeScript. They are now rendered
 * through a template row, and the shipped rows are supposed to reproduce the old
 * code byte for byte — so an install that has customized nothing gets exactly
 * the prompt it got before.
 *
 * This is not covered by the nine-fixture byte-parity corpus, and it is worth
 * being precise about why rather than assuming otherwise. That harness calls
 * `buildWorld` with no `specId`, so `applyPipelineLayer` never runs, the slot
 * resolves to `{}`, and every fixture exercises the *floor* — the in-code
 * default — rather than a selected layout. Measured, not reasoned about:
 * changing the shipped characters layout from indent 2 to indent 4 leaves the
 * entire corpus green. So the corpus proves the floor is right, and this file
 * proves the shipped rows agree with it.
 */

const layoutFor = (source: string, key: string) => ({
	[key]: { engine: CORE_TEMPLATE_ENGINE, source }
})

/**
 * Values chosen to break a naive equivalence, per shape.
 *
 * The string cases matter as much as the JSON ones: a passthrough layout that
 * HTML-escaped, or that coerced `undefined` to `"undefined"`, would corrupt
 * every prompt on the instance in a way no shape check would catch.
 */
const STRING_CASES: Array<[string, unknown]> = [
	["ordinary text", "You are Ash. Stay in character."],
	["empty", ""],
	["undefined", undefined],
	["null", null],
	["quotes and angle brackets", `She said "no" & <left> 'quickly'`],
	["newlines and tabs", "one\ntwo\tthree\r\nfour"],
	["braces that look like macros", "You are {{char}} talking to {{user}}."],
	["a non-BMP emoji", "🜁 ash 👩‍🚒 rider"],
	["a number", 42],
	["an array", ["Ash", "Brannoc"]]
]

const JSON_CASES: Array<[string, unknown]> = [
	["an empty cast", []],
	["one character", [{ name: "Ash", description: 'A rider who said "no".' }]],
	[
		"lore with a spaced key",
		// LorebookBindingUtils emits `extra lore` — a key with a space in it.
		[{ name: "Ash", lore: { "extra lore": "Carries a brand." } }]
	],
	["undefined-valued keys", [{ name: "Ash", nickname: undefined }]],
	["nested and escaped", [{ a: { b: ["<&>", "line\nbreak", "🜁"] } }]],
	["undefined", undefined],
	["null", null]
]

/**
 * The same nasty values, kept inside the shape the variable declares.
 *
 * An explicit layout names the keys `core:var/characters@1` declares, so
 * feeding it `[{ a: { b: … } }]` tests a promise it never made — the
 * passthrough rows are the ones that promise identical bytes for *any* value,
 * and they still get `JSON_CASES`. What must not weaken is the escaping: every
 * character that could break a JSON string is still here, now sitting in a key
 * the layout actually renders.
 */
/**
 * Which shape a variable declares, read from the registry rather than guessed
 * from its key. Slices 1 and 2 made this knowable; the test has no business
 * restating it.
 */
const declaredType = (variableId: string, key: string): string | undefined => {
	const decl = getVariable(variableId)?.scope[key]
	return decl && decl !== "any" && !Array.isArray(decl)
		? (decl as VarField).type
		: undefined
}

/**
 * A record's keys come from the data, so the nasty characters have to be tried
 * in the *key* as well as the value — a lore entry named `She said "no"` is an
 * entry name somebody can type, and it is the key position that the naive
 * `"{{@key}}"` spelling would have broken.
 */
const recordCases = (): Array<[string, unknown]> => [
	["an empty record", {}],
	["one entry", { "The Gate": "Alice has held the gate since the winter." }],
	["several entries", { A: "one", B: "two", C: "three" }],
	["quotes and angle brackets in the value", { A: `She said "no" & <left>` }],
	["quotes in the key", { 'She said "no"': "x" }],
	["newlines and tabs", { "A\tkey": "one\ntwo\tthree\r\nfour" }],
	["a non-BMP emoji", { "🜁 ash 👩‍🚒": "🜁" }],
	[
		"braces that look like macros",
		{ A: "You are {{char}} talking to {{user}}." }
	],
	["an empty-string value", { A: "" }],
	["undefined", undefined]
]

/**
 * An object with a fixed set of optional sections, exercised in every
 * combination of present and absent.
 *
 * The combinations are the point: the commas between sections are what the
 * template has to get right and each one is guarded separately, so "first and
 * last, skipping the middle" is a distinct shape from "two adjacent". Generated
 * from the section list rather than written out, because the list changed once
 * already — `relationshipsKnown` has two sections where `speakerRelationships`
 * had three — and a hand-written table would have quietly kept testing the old
 * one.
 */
const sectionCases = (
	sections: readonly string[],
	bodies: Record<string, unknown>
): Array<[string, unknown]> => {
	const rel = [{ type: "wary respect", secrecy: "Only I know" }]
	const out: Array<[string, unknown]> = []

	// Every subset, in ascending size, so a failure names the smallest shape
	// that breaks rather than the first one listed.
	for (let mask = 0; mask < 1 << sections.length; mask++) {
		const present = sections.filter((_, i) => mask & (1 << i))
		const value: Record<string, unknown> = {}
		for (const name of present) value[name] = bodies[name]
		out.push([
			present.length === 0 ? "no sections at all" : present.join(" + "),
			value
		])
	}

	const first = sections[0]!
	return [
		...out,
		[
			"quotes and angle brackets in a name and a note",
			{
				[first]: {
					'She said "no" & <left>': [
						{
							type: "debt",
							secrecy: "We both know",
							note: "line\nbreak\ttab 🜁"
						}
					]
				}
			}
		],
		[
			"every optional entry field",
			{
				[first]: {
					Brannoc: [
						{
							type: "wary respect",
							secrecy: "Only I know",
							status: "evolved",
							theirState: "dead",
							note: "Ash has never forgotten."
						}
					]
				}
			}
		],
		["undefined", undefined],
		["null", null]
	]

	// `rel` is referenced through `bodies`, which each caller builds.
	void rel
}

/** The graph's two halves, and the dated value, each with their own shapes. */
const REL = [{ type: "wary respect", secrecy: "Only I know" }]

const OBJECT_CASES: Record<string, () => Array<[string, unknown]>> = {
	relationshipsKnown: () =>
		sectionCases(["howOthersRegardYou", "legendaryFigures"], {
			howOthersRegardYou: { Rell: REL },
			legendaryFigures: {
				"The Ashguard": {
					summary: "Riders.",
					relationships: { Rell: REL }
				}
			}
		}),
	/**
	 * A date is not a set of sections — it is three parts joined by a rule, and
	 * what can break is the padding and which parts are present. Its own table
	 * because feeding it `{ yourRelationships: … }` would test nothing.
	 */
	currentDate: () => [
		["year, month and day", { year: 412, month: 3, day: 5 }],
		["a month that needs padding", { year: 412, month: 3 }],
		["a month that does not", { year: 412, month: 11, day: 30 }],
		["a day that needs padding", { year: 412, month: 11, day: 4 }],
		["year only", { year: 412 }],
		[
			"a zeroth month, which `{{#if}}` alone would drop",
			{ year: 412, month: 0 }
		],
		["a zeroth day", { year: 412, month: 3, day: 0 }],
		["a year of zero", { year: 0 }],
		["a negative year", { year: -50, month: 1 }],
		["undefined", undefined],
		["null", null]
	]
}

const shapedCases = (key: string): Array<[string, unknown]> => {
	const shared: Array<[string, unknown]> = [
		["an empty list", []],
		["one entry", [{ name: "Ash", description: "A rider." }]],
		[
			"quotes and angle brackets",
			[
				{
					name: `She said "no" & <left>`,
					description: "'quickly' & </br>"
				}
			]
		],
		[
			"newlines and tabs",
			[{ name: "Ash", description: "one\ntwo\tthree\r\nfour" }]
		],
		["a non-BMP emoji", [{ name: "🜁 ash 👩‍🚒", description: "🜁" }]],
		[
			"braces that look like macros",
			[
				{
					name: "Ash",
					description: "You are {{char}} talking to {{user}}."
				}
			]
		],
		// The distinction the guards are written for: absent is not empty, and
		// neither is null.
		["an empty-string value", [{ name: "Ash", description: "" }]],
		["a null value", [{ name: "Ash", description: null }]],
		["an absent optional", [{ name: "Ash" }]],
		[
			"an explicitly-undefined optional",
			[{ name: "Ash", description: undefined }]
		],
		[
			"several entries",
			[{ name: "Ash" }, { name: "Bran", description: "x" }]
		],
		["undefined", undefined]
	]
	if (key !== "characters") return shared
	return [
		...shared,
		// A key with a space in it, which is the one `attachCharacterLoreToCharacters`
		// really writes — and the one an author cannot reach without brackets.
		[
			"a spaced key holding a nested record",
			[
				{
					name: "Ash",
					"extra lore": {
						"The Ashguard brand": 'Carries a brand & said "no".'
					}
				}
			]
		],
		[
			"every declared key at once",
			[
				{
					name: "Ash",
					nickname: "Ash",
					description: "A rider.",
					personality: "Terse.",
					"extra lore": { "A\tkey": "line\nbreak" }
				}
			]
		]
	]
}

describe("shipped variable layouts reproduce the code they replaced", () => {
	for (const t of SHIPPED_VARIABLE_TEMPLATES) {
		const cases = t.explicit
			? ({
					record: recordCases(),
					object:
						OBJECT_CASES[t.key]?.() ??
						sectionCases(["a", "b"], { a: {}, b: {} }),
					list: shapedCases(t.key)
				}[declaredType(t.variableId, t.key) ?? "list"] ??
				shapedCases(t.key))
			: t.source.includes("json")
				? JSON_CASES
				: STRING_CASES

		describe(`${t.key} (${t.name})`, () => {
			for (const [label, value] of cases) {
				it(`matches the in-code default for ${label}`, async () => {
					const viaTemplate = await renderVariable(
						layoutFor(t.source, t.key),
						t.key,
						value
					)
					expect(viaTemplate).toBe(t.codeDefault(value))
				})
			}
		})
	}
})

describe("the floor", () => {
	const value = [{ name: "Ash", description: "A rider." }]

	/**
	 * Written out rather than read back off `codeDefault`, which would assert
	 * that the code equals itself. This is the byte sequence 0.5 put in a
	 * prompt, heading and fence included — the floor's whole job is to keep
	 * emitting it when no layout resolves.
	 */
	const AS_0_5 =
		"Assistant Characters (AI-controlled):\n```json\n" +
		JSON.stringify(value, null, 2) +
		"\n```"

	it("is used when no layout resolved at all", async () => {
		expect(await renderVariable(undefined, "characters", value)).toBe(
			AS_0_5
		)
	})

	it("is used when the slot resolved but this key did not", async () => {
		// A dangling reference drops to `undefined` in `world.ts` rather than
		// erroring, so this is the shape a deleted row actually produces.
		expect(
			await renderVariable({ personas: undefined }, "characters", value)
		).toBe(AS_0_5)
	})

	it("is used when the selected row has an empty source", async () => {
		// The engine is named even though the source is empty: `ResolvedLayouts`
		// requires it now, because a resolved layout always came off a row whose
		// engine column is NOT NULL. An optional one was how a layout could be
		// rendered in core's language rather than its own.
		expect(
			await renderVariable(
				{ characters: { engine: CORE_TEMPLATE_ENGINE, source: "" } },
				"characters",
				value
			)
		).toBe(AS_0_5)
	})

	it("refuses rather than degrading when a selected layout throws", async () => {
		// The other direction from the three above, and deliberately so: a
		// *selected* layout that cannot render must not quietly produce default
		// output, or the panel shows one thing and the prompt contains another.
		await expect(
			renderVariable(
				{
					characters: {
						engine: CORE_TEMPLATE_ENGINE,
						source: "{{#each characters}}"
					}
				},
				"characters",
				value
			)
		).rejects.toThrow(/layout selected for 'characters'/)
	})

	it("names an unknown engine rather than rendering it as Handlebars", async () => {
		await expect(
			renderVariable(
				{
					characters: {
						engine: "someone-elses:template/thing@1",
						source: "x"
					}
				},
				"characters",
				value
			)
		).rejects.toThrow(/someone-elses:template\/thing@1/)
	})
})

describe("the shipped set", () => {
	it("covers every key any node declares", async () => {
		// Walked across the whole registry rather than named node by node: this
		// test was written against the context builder alone, and went red the
		// moment Assemble declared three of its own — which is the test working,
		// but the fix is to stop enumerating nodes. A variable added anywhere
		// without a shipped layout now fails loudly instead of falling through
		// to a floor nobody wrote.
		await import("@serene-pub/contracts")
		const { allTypes } = await import("@serene-pub/sdk")

		const renders: Record<string, string> = {}
		for (const d of allTypes())
			for (const slot of Object.values((d.slots ?? {}) as any))
				for (const [key, variableId] of Object.entries(
					((slot as any).renders ?? {}) as Record<string, string>
				)) {
					// One key, one variable — across every node. Two nodes
					// rendering `history` as different variables would make
					// "the history layout" ambiguous in a picker.
					if (renders[key]) expect(renders[key]).toBe(variableId)
					renders[key] = variableId
				}

		expect(Object.keys(renders).sort()).toEqual(
			[...new Set(SHIPPED_VARIABLE_TEMPLATES.map((t) => t.key))].sort()
		)
		for (const [key, variableId] of Object.entries(renders))
			expect(shippedByKey.get(key)?.variableId).toBe(variableId)
	})

	it("declares every variable it ships a layout for", async () => {
		// The other direction: a layout whose variable nobody registered would
		// render with an unlabelled picker and no declared scope to lint against.
		const { getVariable } = await import("@serene-pub/sdk")
		for (const t of SHIPPED_VARIABLE_TEMPLATES)
			expect(
				getVariable(t.variableId),
				`${t.variableId} is not registered`
			).toBeTruthy()
	})

	it("marks exactly one row per variable as the default", async () => {
		// `defaultVariableTemplateFor` resolves by this flag's seed key, and
		// `renderVariable`'s floor reads the flagged row's expression. Two
		// flagged rows would make both of those answer arbitrarily.
		const byKey = new Map<string, number>()
		for (const t of SHIPPED_VARIABLE_TEMPLATES)
			if (t.isDefault) byKey.set(t.key, (byKey.get(t.key) ?? 0) + 1)
		for (const key of new Set(SHIPPED_VARIABLE_TEMPLATES.map((t) => t.key)))
			expect(byKey.get(key), `${key} has no single default`).toBe(1)
	})

	it("names each variable's layouts uniquely", async () => {
		// `(variable_id, name)` is a unique index, so a duplicate here is a seed
		// that throws at boot on a fresh install.
		const seen = new Set<string>()
		for (const t of SHIPPED_VARIABLE_TEMPLATES) {
			const key = `${t.variableId} ${t.name}`
			expect(seen.has(key)).toBe(false)
			seen.add(key)
		}
	})
})

/**
 * The heading moved out of the template's `{{#if}}` and into the value, so the
 * guard that used to keep it off an absent variable had to move with it.
 *
 * These are the cases that guard exists for. Each one was reachable before the
 * absence rule went into `renderVariable`: a template asking for world lore an
 * install has none of would have shown a `World lore: ` heading above an empty
 * fence, in every turn, on the pipeline path only.
 */
describe("a heading never appears above nothing", () => {
	const wrapped = SHIPPED_VARIABLE_TEMPLATES.filter(
		(t) => t.isDefault && wrapFor(t.key)
	)

	it("covers every variable core wrapped", async () => {
		// So this block cannot silently stop testing anything if the shipped
		// set is rearranged.
		expect(wrapped.map((t) => t.key).sort()).toEqual([
			"characters",
			"currentDate",
			"history",
			"instructions",
			"personas",
			"relationshipsKnown",
			"relationshipsPerspectives",
			"scenario",
			"worldLore"
		])
	})

	/**
	 * What counts as absent is per variable, and deliberately not unified.
	 *
	 * `JSON.stringify(null)` is `"null"` and `JSON.stringify("")` is `'""'` —
	 * both truthy strings, so 0.5's `{{#if characters}}` rendered the heading
	 * over them. Only `undefined` produced nothing. A passthrough variable has
	 * the opposite rule: `""`, `null` and `undefined` all rendered nothing.
	 * Making these agree would change one of them.
	 */
	const absentFor = (key: string): Array<[string, unknown]> => {
		const bare = SHIPPED_VARIABLE_TEMPLATES.find(
			(t) => t.key === key && !t.isDefault
		)
		// Read off the code default rather than off the source's spelling. It
		// used to test `source.startsWith("{{{json ")`, which stopped being a
		// reliable signal the moment a JSON layout was written out explicitly —
		// and would have silently started asserting the *other* variable's rule.
		// The absence rule lives in `renderVariable` and is defined by exactly
		// this: the values whose code default is empty.
		return (
			[
				["undefined", undefined],
				["null", null],
				["an empty string", ""]
			] as Array<[string, unknown]>
		).filter(([, v]) => (bare?.codeDefault(v) ?? "") === "")
	}

	for (const t of wrapped)
		describe(t.key, () => {
			for (const [label, value] of absentFor(t.key))
				it(`renders nothing for ${label}`, async () => {
					expect(
						await renderVariable(
							layoutFor(t.source, t.key),
							t.key,
							value
						)
					).toBe("")
				})

			it("renders nothing when no layout resolved either", async () => {
				expect(await renderVariable(undefined, t.key, undefined)).toBe(
					""
				)
			})

			it("renders nothing through a layout of someone's own", async () => {
				// The rule is the render path's, not the shipped source's. A
				// user who rewrites a layout as prose cannot reintroduce a
				// heading above an absent value by forgetting a guard they
				// were never asked to write.
				expect(
					await renderVariable(
						layoutFor(`Their own words: {{{${t.key}}}}`, t.key),
						t.key,
						undefined
					)
				).toBe("")
			})
		})

	it("still renders an empty cast, which is not the same as no cast", async () => {
		// `JSON.stringify([])` is `"[]"`, a truthy string, so 0.5 rendered the
		// heading and an empty array for a session with no assistant characters.
		// Handlebars' own `{{#if}}` calls an empty array empty — which is
		// exactly why the absence rule is in code and not in the source.
		expect(
			await renderVariable(
				layoutFor(shippedByKey.get("characters")!.source, "characters"),
				"characters",
				[]
			)
		).toBe("Assistant Characters (AI-controlled):\n```json\n[]\n```")
	})
})

/**
 * The bare rows are what an install with a hand-written context template gets
 * pinned to, so "writes no heading" is a property somebody depends on.
 */
describe("the bare rows", () => {
	const value = [{ name: "Ash", description: "A rider." }]

	it("write the content and nothing else", async () => {
		const bare = SHIPPED_VARIABLE_TEMPLATES.find(
			(t) => t.key === "characters" && !t.isDefault
		)!
		expect(
			await renderVariable(
				layoutFor(bare.source, "characters"),
				"characters",
				value
			)
		).toBe(JSON.stringify(value, null, 2))
	})

	it("are what the shipped row wraps", async () => {
		// One function produces both, so this cannot drift — asserted anyway,
		// because the day someone hand-writes one of the two sources is the day
		// it starts being able to.
		for (const t of SHIPPED_VARIABLE_TEMPLATES) {
			const wrap = wrapFor(t.key)
			if (!wrap || t.isDefault) continue
			const shipped = shippedByKey.get(t.key)!
			expect(wrap(t.source)).toBe(shipped.source)
		}
	})
})

/**
 * What an explicit layout promises, and — just as importantly — what it does not.
 *
 * Naming the keys is the entire point of slice 4: "drop `personality`" becomes a
 * deletion and "rename `nickname` to `alias`" becomes a rename, where both used
 * to be code changes. The cost is that a key nobody declared is no longer
 * passed through, and a value that is not the declared shape renders as that
 * shape's empty form.
 *
 * Asserted here rather than left to be discovered in somebody's prompt. Neither
 * case is reachable from core — `compileCharacter` builds exactly these keys and
 * `resolveContextInput` always produces a list — but a plugin node that
 * enriched a character would previously have seen its extra field in the
 * prompt, and would now not. The answer for anyone who needs the old behaviour
 * is the passthrough, which is still a layout you can select or type.
 */
describe("an explicit layout renders the declared shape and nothing else", () => {
	const explicit = SHIPPED_VARIABLE_TEMPLATES.filter(
		(t) => t.explicit && !t.isDefault
	)

	it("covers the layouts that were made explicit", async () => {
		// So this block cannot quietly stop testing anything.
		expect(explicit.map((t) => t.key).sort()).toEqual([
			"characters",
			"currentDate",
			"history",
			"personas",
			"relationshipsKnown",
			"relationshipsPerspectives",
			"worldLore"
		])
	})

	it("drops a key the variable does not declare", async () => {
		const bare = explicit.find((t) => t.key === "characters")!
		const value = [{ name: "Ash", favouriteColour: "ash grey" }]
		expect(
			await renderVariable(
				layoutFor(bare.source, "characters"),
				"characters",
				value
			)
		).toBe('[\n  {\n    "name": "Ash"\n  }\n]')
		// And this is the divergence from the floor, stated rather than implied.
		expect(bare.codeDefault(value)).toContain("favouriteColour")
	})

	it("renders the empty form for a value that is not the declared shape", async () => {
		const bare = explicit.find((t) => t.key === "characters")!
		// `null` is not a list. The floor stringifies it as `null`; the layout
		// has no shape to render and produces the empty list.
		expect(
			await renderVariable(
				layoutFor(bare.source, "characters"),
				"characters",
				null
			)
		).toBe("[]")
		expect(bare.codeDefault(null)).toBe("null")
	})

	it("the passthrough is still available, and still passes anything through", async () => {
		// The escape hatch the two cases above point at. Not a shipped row for
		// these keys any more — it is a layout somebody can select or type.
		const value = [{ name: "Ash", favouriteColour: "ash grey" }]
		expect(
			await renderVariable(
				layoutFor("{{{json characters 2}}}", "characters"),
				"characters",
				value
			)
		).toBe(JSON.stringify(value, null, 2))
	})
})

/**
 * `jsonValue` is the one new helper this needed, and the indent argument is the
 * part that is easy to get subtly wrong.
 */
describe("jsonValue reproduces a nested position", () => {
	const render = (source: string, value: unknown) =>
		renderVariable(layoutFor(source, "characters"), "characters", value)

	it("offsets every line but the first, which is what nesting means", async () => {
		// `JSON.stringify({ a: { b: 1 } }, null, 2)` renders the inner object as
		// its own stringify with two spaces added to lines 2..n. The offset
		// argument is that addition, so a record nested two levels deep uses 4.
		const inner = { "The Ashguard brand": "Carries a brand." }
		const value = [{ name: "Ash", "extra lore": inner }]
		expect(
			await render(shippedByKey.get("characters")!.source, value)
		).toBe(
			"Assistant Characters (AI-controlled):\n```json\n" +
				JSON.stringify(value, null, 2) +
				"\n```"
		)
	})

	it("renders nothing for undefined rather than the text 'undefined'", async () => {
		expect(await render("{{{jsonValue characters}}}", undefined)).toBe("")
	})

	it("escapes as JSON, not as HTML", async () => {
		// The render path has escaping on. A helper returning a plain string
		// would turn every quote in the prompt into `&quot;`.
		expect(await render("{{jsonValue characters}}", ['a "b" & <c>'])).toBe(
			JSON.stringify(['a "b" & <c>'], null, 2)
		)
	})
})

/**
 * The declaration's own `sample`, run through the shipped layout.
 *
 * Slice 1 made every `sample` validate against its variable's `scope`, so this
 * is the one value in the system that is *known* to be the declared shape. If
 * an explicit layout and the floor ever disagree about it, the layout is wrong
 * about the shape it was written for — which is the failure the hand-written
 * cases can only approximate.
 */
describe("the shipped layouts agree with the floor on each variable's own sample", () => {
	it("holds for every shipped row", async () => {
		const { getVariable, sampleValues } = await import("@serene-pub/sdk")
		for (const t of SHIPPED_VARIABLE_TEMPLATES) {
			const decl = getVariable(t.variableId)
			if (!decl) continue
			const value = sampleValues(decl)[t.key]
			expect(
				await renderVariable(layoutFor(t.source, t.key), t.key, value),
				`${t.key} (${t.name})`
			).toBe(t.codeDefault(value))
		}
	})
})
