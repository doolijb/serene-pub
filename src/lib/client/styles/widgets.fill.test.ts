/**
 * The fill rule (STYLE-GUIDE §5.3, ruled 2026-09-29): a widget fills the width
 * its zone grants. The conversation's reading measure is the messages widget's
 * Line width setting — Column (the default since ★R1, 2026-10-24) or
 * Comfortable (`data-line-width`) — never a cap every conversation wears: the
 * hidden 696px column this guards against is what "the messages aren't taking
 * the width they are granted" was, and Full still fills the box.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const CSS = readFileSync(
	fileURLToPath(new URL("./widgets.css", import.meta.url)),
	"utf8"
).replace(/\/\*[\s\S]*?\*\//g, "")

/** Every innermost `selector { declarations }` block, at-rules unwrapped. */
function leafRules(css: string): { selector: string; body: string }[] {
	const out: { selector: string; body: string }[] = []
	const stack: number[] = []
	let lastBoundary = 0
	for (let i = 0; i < css.length; i++) {
		const c = css[i]
		if (c === "{") {
			stack.push(lastBoundary)
			stack.push(i)
			lastBoundary = i + 1
		} else if (c === "}") {
			const open = stack.pop()!
			const start = stack.pop()!
			const body = css.slice(open + 1, i)
			if (!body.includes("{"))
				out.push({ selector: css.slice(start, open).trim(), body })
			lastBoundary = i + 1
		} else if (c === ";" && stack.length) {
			lastBoundary = i + 1
		}
	}
	return out
}

const rules = leafRules(CSS)
/** A selector list's members: split on the commas outside `:is(…)` and its kin. */
function selectors(s: string): string[] {
	const out: string[] = []
	let depth = 0
	let from = 0
	for (let i = 0; i < s.length; i++) {
		if (s[i] === "(") depth++
		else if (s[i] === ")") depth--
		else if (s[i] === "," && depth === 0) {
			out.push(s.slice(from, i).trim())
			from = i + 1
		}
	}
	out.push(s.slice(from).trim())
	return out
}

describe("widgets.css — a widget fills its granted width", () => {
	it("parses the sheet into rules", () => {
		expect(rules.length).toBeGreaterThan(100)
	})

	it("caps the conversation's column only under a Line width that says so (Column, Comfortable)", () => {
		const capping = rules.filter((r) =>
			/(max-inline-size|max-width|inline-size)\s*:[^;]*--sp-column-width/.test(
				r.body
			)
		)
		expect(capping.length).toBeGreaterThan(0)
		for (const r of capping)
			for (const sel of selectors(r.selector)) {
				expect(sel).toContain('[data-line-width="comfortable"]')
				expect(sel).toContain('[data-line-width="column"]')
			}
	})

	it("defines the column only for Column and Comfortable", () => {
		const defining = rules.filter((r) => /--sp-column-width\s*:/.test(r.body))
		expect(defining.length).toBe(1)
		expect(defining[0].selector).toContain('[data-line-width="comfortable"]')
		expect(defining[0].selector).toContain('[data-line-width="column"]')
	})

	it("sets Column's measure to 76ch of the story's body, never wider than the box", () => {
		const measure = rules.filter((r) => /--sp-measure\s*:/.test(r.body))
		expect(measure.length).toBe(1)
		expect(measure[0].selector).toContain('[data-line-width="column"]')
		expect(measure[0].selector).not.toContain('"comfortable"')
		expect(measure[0].body).toMatch(/--sp-measure:\s*min\(100%,\s*calc\(76 \* /)
		// The person's story text size moves it, as it moves the prose.
		expect(measure[0].body).toContain("var(--sp-prose-scale, 1)")
	})

	it("lets the log's rows and the compose block take the whole box by default", () => {
		const base = rules.find(
			(r) =>
				r.selector.includes('[data-widget-part~="messages.stage"]') &&
				r.selector.includes('[data-widget-part~="messages.compose"]') &&
				!r.selector.includes("data-line-width") &&
				!r.selector.includes("data-sp-backing")
		)
		expect(base).toBeDefined()
		expect(base!.body).toMatch(/inline-size:\s*100%/)
		expect(base!.body).not.toMatch(/max-inline-size|max-width/)
	})
})
