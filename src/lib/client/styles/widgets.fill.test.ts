/**
 * The fill rule (STYLE-GUIDE §5.3, ruled 2026-09-29): a widget fills the width
 * its zone grants. The conversation's reading measure is the messages widget's
 * Line width: Comfortable setting (`data-line-width="comfortable"`), never a
 * cap every conversation wears — the hidden 696px column this guards against
 * is what "the messages aren't taking the width they are granted" was.
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
const selectors = (s: string) => s.split(",").map((x) => x.trim())

describe("widgets.css — a widget fills its granted width", () => {
	it("parses the sheet into rules", () => {
		expect(rules.length).toBeGreaterThan(100)
	})

	it("caps the conversation's column only under Line width: Comfortable", () => {
		const capping = rules.filter((r) =>
			/(max-inline-size|max-width|inline-size)\s*:[^;]*--sp-column-width/.test(
				r.body
			)
		)
		expect(capping.length).toBeGreaterThan(0)
		for (const r of capping)
			for (const sel of selectors(r.selector))
				expect(sel).toContain('[data-line-width="comfortable"]')
	})

	it("defines the measure only for Comfortable", () => {
		const defining = rules.filter((r) => /--sp-column-width\s*:/.test(r.body))
		expect(defining.length).toBe(1)
		expect(defining[0].selector).toContain('[data-line-width="comfortable"]')
	})

	it("lets the log's rows and the compose block take the whole box by default", () => {
		const base = rules.find(
			(r) =>
				r.selector.includes('[data-widget-part~="messages.stage"]') &&
				r.selector.includes('[data-widget-part~="messages.compose"]') &&
				!r.selector.includes("data-line-width") &&
				!r.selector.includes("data-backdrop")
		)
		expect(base).toBeDefined()
		expect(base!.body).toMatch(/inline-size:\s*100%/)
		expect(base!.body).not.toMatch(/max-inline-size|max-width/)
	})
})
