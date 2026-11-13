import { describe, expect, test } from "vitest"
import {
	bareOffer,
	laidOutOccurrences,
	occurrenceAt,
	rewriteChanges,
	titledOffer,
	writeOccurrence
} from "./templateLayoutRewrite"

const HB = "core:template/handlebars@1"
const LQ = "core:template/liquid@1"
const KEYS = ["characters"]

const apply = (
	src: string,
	ch: { from: number; to: number; insert: string }[]
) =>
	[...ch]
		.reverse()
		.reduce((s, c) => s.slice(0, c.from) + c.insert + s.slice(c.to), src)

describe("laidOutOccurrences", () => {
	test("Handlebars: bare triple, bare double, ~ kept, calls with either quote", () => {
		const src = `{{{characters}}} {{characters}} {{{~ characters ~}}} {{{layout characters "a/b@1"}}} {{layout characters 'a/c@1'}} {{{~layout characters "a/d@1"~}}}`
		const found = laidOutOccurrences(HB, src, KEYS)
		expect(found.map((o) => o.reference)).toEqual([
			null,
			null,
			null,
			"a/b@1",
			"a/c@1",
			"a/d@1"
		])
		expect(found.map((o) => src.slice(o.start, o.end))).toEqual([
			"{{{characters}}}",
			"{{characters}}",
			"{{{~ characters ~}}}",
			`{{{layout characters "a/b@1"}}}`,
			`{{layout characters 'a/c@1'}}`,
			`{{{~layout characters "a/d@1"~}}}`
		])
	})

	test("Handlebars: other uses are left alone", () => {
		const src = [
			"{{#if characters}}x{{/if}}",
			"{{#each characters}}{{name}}{{/each}}",
			"{{characters.name}}",
			`{{#if (layout characters "a/b@1")}}x{{/if}}`,
			"\\{{characters}}",
			"\\{{{characters}}}"
		].join("\n")
		expect(laidOutOccurrences(HB, src, KEYS)).toEqual([])
	})

	test("Liquid: bare, call, - kept; more filters and other uses are left alone", () => {
		const src = `{{ characters }} {{- characters -}} {{ characters | layout: "a/b@1" }} {{- characters | layout: 'a/c@1' -}} {{ characters | layout: "a/b@1" | upcase }} {% for c in characters %}{% endfor %} {{ characters.size }}`
		const found = laidOutOccurrences(LQ, src, KEYS)
		expect(found.map((o) => o.reference)).toEqual([
			null,
			null,
			"a/b@1",
			"a/c@1"
		])
	})

	test("source order across keys", () => {
		const src = "{{{scenario}}} {{{characters}}} {{{persona}}}"
		expect(
			laidOutOccurrences(HB, src, ["persona", "characters"]).map(
				(o) => o.key
			)
		).toEqual(["characters", "persona"])
	})
})

describe("occurrenceAt", () => {
	const src = 'ab {{{characters}}} cd {{{layout characters "a/b@1"}}}'
	test("the caret inside, at either edge, and outside", () => {
		expect(occurrenceAt(HB, src, 5, KEYS)?.reference).toBeNull()
		expect(occurrenceAt(HB, src, 3, KEYS)?.start).toBe(3)
		expect(occurrenceAt(HB, src, 19, KEYS)?.end).toBe(19)
		expect(occurrenceAt(HB, src, 21, KEYS)).toBeNull()
		expect(occurrenceAt(HB, src, 30, KEYS)?.reference).toBe("a/b@1")
	})
})

describe("writeOccurrence", () => {
	const one = (engine: string, src: string) =>
		laidOutOccurrences(engine, src, KEYS)[0]!
	test("Handlebars both directions, ~ kept, always triple braces", () => {
		for (const [src, withRef, bare] of [
			[
				"{{characters}}",
				`{{{layout characters "x/y@1"}}}`,
				"{{{characters}}}"
			],
			[
				"{{{ characters }}}",
				`{{{layout characters "x/y@1"}}}`,
				"{{{characters}}}"
			],
			[
				"{{{~characters~}}}",
				`{{{~layout characters "x/y@1"~}}}`,
				"{{{~characters~}}}"
			],
			[
				`{{layout characters "a/b@1"}}`,
				`{{{layout characters "x/y@1"}}}`,
				"{{{characters}}}"
			]
		] as const) {
			const o = one(HB, src)
			expect(writeOccurrence(HB, src, o, "x/y@1")).toBe(withRef)
			expect(writeOccurrence(HB, src, o, null)).toBe(bare)
		}
	})
	test("Liquid both directions, - kept", () => {
		for (const [src, withRef, bare] of [
			[
				"{{ characters }}",
				`{{ characters | layout: "x/y@1" }}`,
				"{{ characters }}"
			],
			[
				"{{- characters -}}",
				`{{- characters | layout: "x/y@1" -}}`,
				"{{- characters -}}"
			],
			[
				`{{ characters | layout: "a/b@1" }}`,
				`{{ characters | layout: "x/y@1" }}`,
				"{{ characters }}"
			]
		] as const) {
			const o = one(LQ, src)
			expect(writeOccurrence(LQ, src, o, "x/y@1")).toBe(withRef)
			expect(writeOccurrence(LQ, src, o, null)).toBe(bare)
		}
	})
})

describe("rewriteChanges", () => {
	const src = `A {{{characters}}} B {{layout characters "a/b@1"}} C {{#each characters}}{{/each}} D {{{characters}}}`
	test("undefined leaves an occurrence; the rest are rewritten in one list", () => {
		const ch = rewriteChanges(HB, src, KEYS, (o) =>
			o.reference === null ? "x/y@1" : undefined
		)
		expect(ch).toHaveLength(2)
		expect(apply(src, ch)).toBe(
			`A {{{layout characters "x/y@1"}}} B {{layout characters "a/b@1"}} C {{#each characters}}{{/each}} D {{{layout characters "x/y@1"}}}`
		)
	})
	test("no-ops are skipped", () => {
		expect(rewriteChanges(HB, src, KEYS, (o) => o.reference)).toEqual([])
		expect(rewriteChanges(HB, "{{characters}}", KEYS, () => null)).toEqual(
			[]
		)
	})
	test("every occurrence back to the pub's layout", () => {
		expect(
			apply(
				src,
				rewriteChanges(HB, src, KEYS, () => null)
			)
		).toBe(
			`A {{{characters}}} B {{{characters}}} C {{#each characters}}{{/each}} D {{{characters}}}`
		)
	})
})

describe("bareOffer / titledOffer", () => {
	const offers = [
		{ reference: "core/titled-json@1", label: "Titled JSON block" },
		{ reference: "core/json@1", label: "JSON" }
	]
	test("pick by slug", () => {
		expect(bareOffer(offers)?.reference).toBe("core/json@1")
		expect(titledOffer(offers)?.reference).toBe("core/titled-json@1")
		expect(
			bareOffer([{ reference: "acme/as-written@2", label: "As written" }])
				?.label
		).toBe("As written")
		expect(
			titledOffer([{ reference: "acme/titled@1", label: "Titled" }])
				?.label
		).toBe("Titled")
		expect(
			bareOffer([{ reference: "acme/prose@1", label: "P" }])
		).toBeUndefined()
		expect(titledOffer([])).toBeUndefined()
	})
})
