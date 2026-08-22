import { describe, it, expect } from "vitest"
import Handlebars from "handlebars"
import { registerContextHandlebarsHelpers } from "./contextHandlebarsHelpers"
import { PromptFormats } from "$lib/shared/constants/PromptFormats"

/**
 * The `json` helper exists for one reason: to let a variable template reproduce,
 * in template source, exactly what TypeScript stringifies in code today. If the
 * two ever differ by a byte, every prompt on the instance changes — silently,
 * because both sides look correct in isolation.
 *
 * So the test is not "does it look like JSON". It is `render(...) === JSON.stringify(...)`,
 * character for character, over inputs chosen to break the naive implementations:
 * HTML escaping (which is ON in the render path), `JSON.stringify(undefined)`
 * returning a non-string, the optional indent argument colliding with the
 * options object Handlebars appends, and surrogate pairs.
 */

function render(template: string, context: Record<string, unknown>): string {
	const handlebars = Handlebars.create()
	registerContextHandlebarsHelpers(handlebars, {
		promptFormat: PromptFormats.VICUNA
	})
	return handlebars.compile(template)(context)
}

// Every one of these has broken a stringify-in-a-template at some point.
const FIXTURES: Array<[string, unknown]> = [
	["a plain object", { name: "Ash", role: "rider" }],
	["an empty object", {}],
	["an empty array", []],
	["an array of objects", [{ name: "Ash" }, { name: "Brannoc" }]],
	// LorebookBindingUtils.ts:139 emits a key with a space in it. Anything that
	// round-trips through a path or a key-splitting helper loses this one.
	["a key containing a space", { "extra lore": "Riders patrol the wastes." }],
	// JSON.stringify drops undefined-valued keys entirely; a hand-rolled
	// serializer emits `"k":undefined`, which is not even valid JSON.
	["undefined-valued keys", { kept: "yes", dropped: undefined }],
	["a null value", { nothing: null }],
	["quotes and backslashes", { line: 'She said "no" \\ then left' }],
	["newlines and tabs", { line: "one\ntwo\tthree\r\nfour" }],
	// Escaping is on in the render path; these are what it would mangle.
	["angle brackets and ampersands", { html: "<b>a & b</b> 'q' \"d\"" }],
	["a non-BMP emoji", { mood: "🜁 ash 👩‍🚒 rider" }],
	["nested objects", { a: { b: { c: [1, 2, { d: "e" }] } } }],
	["a date-keyed record", { "2024-01-02": "one", "2023-12-31": "two" }],
	["numbers and booleans", { n: 1, f: 1.5, neg: -0.25, t: true, f2: false }],
	["a bare string", "just a string"],
	["a bare number", 42],
	["a bare null", null]
]

describe("the json helper", () => {
	// The three indents the shipped variable templates need, plus the omitted
	// form. `undefined` here means the argument is left off entirely, which is
	// where the options-object collision shows up.
	for (const indent of [2, 1, 0, undefined]) {
		describe(
			indent === undefined
				? "with no indent argument"
				: `at indent ${indent}`,
			() => {
				const expr =
					indent === undefined
						? "{{{json v}}}"
						: `{{{json v ${indent}}}}`

				for (const [label, value] of FIXTURES) {
					it(`matches JSON.stringify for ${label}`, () => {
						expect(render(expr, { v: value })).toBe(
							JSON.stringify(value, null, indent ?? 0)
						)
					})
				}
			}
		)
	}

	it("renders nothing for a missing variable", () => {
		// JSON.stringify(undefined) is the *value* undefined, not a string.
		// Wrapped in a SafeString unguarded, that renders the word "undefined"
		// into the prompt.
		expect(render("{{{json v}}}", {})).toBe("")
		expect(render("{{{json v 2}}}", { v: undefined })).toBe("")
	})

	it("does not HTML-escape through the double stash", () => {
		// Escaping is on in the real render path (renderers.ts sets no noEscape),
		// so without SafeString every quote in every JSON payload becomes &quot;.
		const v = { html: "<b>a & b</b>", q: 'say "hi"' }
		expect(render("{{json v}}", { v })).toBe(JSON.stringify(v, null, 0))
	})

	it("is falsy-guardable the way the templates guard it", () => {
		// The shipped templates wrap each variable in {{#if x}}. That has to keep
		// working against the string the code path produces.
		const t = "{{#if v}}LORE:{{{json v 0}}}{{/if}}"
		expect(render(t, { v: undefined })).toBe("")
		expect(render(t, { v: { a: "b" } })).toBe('LORE:{"a":"b"}')
	})

	it("survives being registered twice", () => {
		// Registration is guarded, and PromptBuilder registers into a long-lived
		// instance.
		const handlebars = Handlebars.create()
		registerContextHandlebarsHelpers(handlebars, {
			promptFormat: PromptFormats.VICUNA
		})
		registerContextHandlebarsHelpers(handlebars, {
			promptFormat: PromptFormats.VICUNA
		})
		expect(handlebars.compile("{{{json v 2}}}")({ v: { a: 1 } })).toBe(
			JSON.stringify({ a: 1 }, null, 2)
		)
	})
})

describe("assemble's shapes render identically through the helper", () => {
	// The exact three call sites the shipped variable templates have to replace,
	// at the exact indents they use today.
	it("reproduces the minified world-lore object", () => {
		const worldLore = {
			"The Ashguard": "Riders who patrol the ash wastes."
		}
		expect(render("{{{json worldLore 0}}}", { worldLore })).toBe(
			JSON.stringify(worldLore)
		)
	})

	it("reproduces the 2-space character array", () => {
		const characters = [
			{
				name: "Ash",
				description: "A rider.",
				lore: { "extra lore": "x" }
			}
		]
		expect(render("{{{json characters 2}}}", { characters })).toBe(
			JSON.stringify(characters, null, 2)
		)
	})

	it("reproduces the 1-space relationships object", () => {
		const speakerRelationships = { Ash: { Brannoc: "rival" } }
		expect(
			render("{{{json speakerRelationships 1}}}", {
				speakerRelationships
			})
		).toBe(JSON.stringify(speakerRelationships, null, 1))
	})
})
