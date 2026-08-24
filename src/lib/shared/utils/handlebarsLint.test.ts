import { describe, expect, test } from "vitest"
import { lintHandlebarsText } from "./handlebarsLint"

describe("lintHandlebarsText — @@decorator detection", () => {
	test("flags a bare @@decorator line", () => {
		const issues = lintHandlebarsText(
			"@@position before_char\nActual content."
		)
		expect(issues).toHaveLength(1)
		expect(issues[0].kind).toBe("decorator")
		expect(issues[0].match).toBe("@@position before_char")
	})

	test("flags a @@@ fallback-chain line too", () => {
		const issues = lintHandlebarsText("@@primary value\n@@@fallback value")
		expect(issues.filter((i) => i.kind === "decorator")).toHaveLength(2)
	})

	test("does not flag ordinary text or mid-line @ usage", () => {
		const issues = lintHandlebarsText(
			"Contact: user@@example.com\nNormal paragraph text."
		)
		expect(issues).toHaveLength(0)
	})
})

describe("lintHandlebarsText — unsupported macro detection", () => {
	test("does not flag {{char}}/{{user}}/{{persona}}/{{character}}", () => {
		const issues = lintHandlebarsText(
			"{{char}} greets {{user}}, {{persona}} and {{character}}."
		)
		expect(issues).toHaveLength(0)
	})

	test("does not flag known CBS macros", () => {
		const issues = lintHandlebarsText(
			"{{random:A,B,C}} {{roll:d6}} {{reverse:abc}} {{comment: hi}} {{// hidden}} {{hidden_key:x}}"
		)
		expect(issues).toHaveLength(0)
	})

	test("does not flag a {{char:N}} numbered binding", () => {
		const issues = lintHandlebarsText("Lives near {{char:5}}.")
		expect(issues).toHaveLength(0)
	})

	test("flags an unrecognized macro", () => {
		const issues = lintHandlebarsText("{{formatDate currentDate}}")
		expect(issues).toHaveLength(1)
		expect(issues[0].kind).toBe("unsupported-macro")
		expect(issues[0].match).toBe("{{formatDate currentDate}}")
	})

	test("flags an unrecognized bare variable", () => {
		const issues = lintHandlebarsText("{{someUnknownField}}")
		expect(issues).toHaveLength(1)
		expect(issues[0].kind).toBe("unsupported-macro")
	})

	test("handles both {{x}} and {{{x}}} forms", () => {
		const issues = lintHandlebarsText("{{unknownA}} and {{{unknownB}}}")
		expect(issues).toHaveLength(2)
		expect(issues.map((i) => i.match)).toEqual([
			"{{unknownA}}",
			"{{{unknownB}}}"
		])
	})

	test("is case-insensitive for known macro names", () => {
		const issues = lintHandlebarsText("{{RANDOM:A,B}}")
		expect(issues).toHaveLength(0)
	})
})

describe("lintHandlebarsText — combined", () => {
	test("reports both kinds of issues, sorted by position", () => {
		const text = "{{unknownField}}\n@@dont_activate\nActual content."
		const issues = lintHandlebarsText(text)
		expect(issues.map((i) => i.kind)).toEqual([
			"unsupported-macro",
			"decorator"
		])
		expect(issues[0].start).toBeLessThan(issues[1].start)
	})
})
