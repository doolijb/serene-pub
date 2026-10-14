import { describe, expect, test } from "vitest"
import { EditorState } from "@codemirror/state"
import { ensureSyntaxTree, HighlightStyle } from "@codemirror/language"
import { highlightTree, Tag, tags } from "@lezer/highlight"
import {
	CORE_LIQUID_ENGINE,
	CORE_TEMPLATE_ENGINE
} from "$lib/shared/pipelines/templateEngines"
import { handlebarsLanguage, liquidLanguage, templateLanguageFor } from "./templateLanguage"

/** Every tag by its own name, so a paint reads as the grammar's intent. */
const byName = HighlightStyle.define([
	...Object.entries(tags)
		.filter((e): e is [string, Tag] => e[1] instanceof Tag)
		.map(([name, tag]) => ({ tag, class: name })),
	{ tag: tags.function(tags.variableName), class: "function" },
	{ tag: tags.special(tags.variableName), class: "special" }
])

/** The styled stretches of `src`, as `[text, classes]`. */
function paint(language: typeof handlebarsLanguage, src: string): [string, string][] {
	const state = EditorState.create({ doc: src, extensions: [language] })
	const tree = ensureSyntaxTree(state, src.length, 1000)!
	const out: [string, string][] = []
	highlightTree(tree, byName, (from, to, classes) =>
		out.push([src.slice(from, to), classes])
	)
	return out
}
const texts = (p: [string, string][]) => p.map(([t]) => t)
const styleOf = (p: [string, string][], text: string) => p.find(([t]) => t === text)?.[1]

describe("the Handlebars grammar", () => {
	test("tags are coloured and prose is left alone", () => {
		const p = paint(handlebarsLanguage, 'Hello {{name}}, {{{raw}}} and {{helper arg "x" 3}}')
		expect(texts(p)).not.toContain("Hello ")
		expect(styleOf(p, "{{")).toBe("bracket")
		expect(styleOf(p, "}}}")).toBe("bracket")
		expect(styleOf(p, "name")).toBe("variableName")
		expect(styleOf(p, "raw")).toBe("variableName")
		expect(styleOf(p, "helper")).toBe("function")
		expect(styleOf(p, "arg")).toBe("variableName")
		expect(styleOf(p, '"x"')).toBe("string")
		expect(styleOf(p, "3")).toBe("number")
	})

	test("blocks, data variables, brackets and comments", () => {
		const p = paint(
			handlebarsLanguage,
			"{{#each items}}{{@index}} {{[extra lore]}}{{/each}}{{! note }}{{!-- long --}}"
		)
		expect(styleOf(p, "#each")).toBe("keyword")
		expect(styleOf(p, "/each")).toBe("keyword")
		expect(styleOf(p, "items")).toBe("variableName")
		expect(styleOf(p, "@index")).toBe("special")
		expect(styleOf(p, "[extra lore]")).toBe("propertyName")
		// Adjacent comments paint as one stretch.
		expect(styleOf(p, "{{! note }}{{!-- long --}}")).toBe("comment")
	})

	test("an unclosed tag stops at its line", () => {
		const p = paint(handlebarsLanguage, "{{oops\nplain prose here")
		expect(texts(p).join("")).not.toContain("plain")
	})
})

describe("the Liquid grammar", () => {
	test("tags, filters and comments", () => {
		const p = paint(
			liquidLanguage,
			'{% for m in messages %}{{ m.name | upcase | default: "x" }}{% endfor %}{% comment %}hidden{% endcomment %}'
		)
		expect(styleOf(p, "for")).toBe("keyword")
		expect(styleOf(p, "endfor")).toBe("keyword")
		expect(styleOf(p, "in")).toBe("keyword")
		expect(styleOf(p, "| upcase")).toBe("function")
		expect(styleOf(p, "| default")).toBe("function")
		expect(styleOf(p, "m")).toBe("variableName")
		const comment = p.find(([t]) => t.includes("hidden"))!
		expect(comment[1]).toBe("comment")
	})
})

test("the language follows the engine id; a plugin's engine gets none", () => {
	expect(templateLanguageFor(CORE_TEMPLATE_ENGINE)).toBe(handlebarsLanguage)
	expect(templateLanguageFor(undefined)).toBe(handlebarsLanguage)
	expect(templateLanguageFor(CORE_LIQUID_ENGINE)).toBe(liquidLanguage)
	expect(templateLanguageFor("acme:template/jinja@1")).toBeNull()
})
