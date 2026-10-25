/**
 * Narrow panels (DC walkthrough 2026-10-15): a side panel's Planner lane, or
 * a phone. Nothing in a message may run past its panel's edge — a choice's or
 * a submit's label wraps inside the button, an answered line wraps, a stat
 * label wraps rather than being clipped mid-word — and the `minimal` pill
 * gives its field the whole first row in a box under 22rem, so the
 * placeholder is never a sliver (STYLE-GUIDE §5.3).
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const CSS = readFileSync(
	fileURLToPath(new URL("./widgets.css", import.meta.url)),
	"utf8"
).replace(/\/\*[\s\S]*?\*\//g, "")

/** The LAST declaration of `prop` among top-level rules whose selector list is exactly `selector`, in source order. */
function lastValue(selector: string, prop: string): string | undefined {
	let found: string | undefined
	const re = /([^{}]+)\{([^{}]*)\}/g
	for (const m of CSS.matchAll(re)) {
		const sels = m[1]!.split(",").map((s) => s.trim())
		if (!sels.includes(selector)) continue
		for (const d of m[2]!.split(";")) {
			const [k, ...v] = d.split(":")
			if (k?.trim() === prop) found = v.join(":").trim()
		}
	}
	return found
}

describe("narrow panels", () => {
	it("a choice and a submit wrap their label inside the button", () => {
		for (const part of ["messages.block-choice", "messages.block-submit"]) {
			const sel = `[data-widget-part~="${part}"]`
			expect(lastValue(sel, "white-space"), part).toBe("normal")
			expect(lastValue(sel, "max-inline-size"), part).toBe("100%")
		}
	})

	it("Save beside Cancel keeps its one line", () => {
		expect(lastValue('[data-widget-part~="messages.message-save"]', "white-space")).toBe("nowrap")
	})

	it("🚧 a roll form's fields stack in a narrow box, and a dice result wraps (Lair rewrite D3)", () => {
		expect(lastValue('[data-widget-part~="messages.block-roll-fields"]', "grid-template-columns")).toBe(
			"repeat(auto-fit, minmax(10rem, 1fr))"
		)
		expect(lastValue('[data-widget-part~="messages.block-dice-head"]', "flex-wrap")).toBe("wrap")
		expect(lastValue('[data-widget-part~="messages.block-dice-explain"]', "overflow-wrap")).toBe("anywhere")
		expect(lastValue('[data-widget-part~="messages.block-roll"]', "max-width")).toBe("var(--container-sm)")
	})

	it("an answered line wraps", () => {
		expect(lastValue('[data-widget-part~="messages.block-answered"]', "flex-wrap")).toBe("wrap")
	})

	it("a stat label wraps, never clipped", () => {
		const sel = '[data-widget-part~="stat-slot.label"]'
		expect(lastValue(sel, "white-space")).toBeUndefined()
		expect(lastValue(sel, "text-overflow")).toBeUndefined()
	})

	it("a stat's text value wraps; a number and a bar's figure keep one line", () => {
		expect(lastValue('[data-widget-part~="stat-slot.line"]', "white-space")).toBe("normal")
		expect(lastValue('[data-widget-part~="stat-slot.line"]', "overflow-wrap")).toBe("anywhere")
		expect(
			lastValue('[data-widget-part~="stat-slot.root"][data-slot-shape="number"] [data-widget-part~="stat-slot.line"]', "white-space")
		).toBe("nowrap")
		expect(lastValue('[data-widget-part~="stat-slot.bar-value"]', "white-space")).toBe("nowrap")
	})

	it("the minimal pill gives its field the first row in a narrow box", () => {
		const at = CSS.indexOf("@container sp-widget (width < 22rem)")
		expect(at).toBeGreaterThan(-1)
		const block = CSS.slice(at, CSS.indexOf("@media", at))
		expect(block).toMatch(/\[data-composer-skin="minimal"\] \[data-widget-part~="messages\.composer-card"\]\s*\{\s*flex-wrap: wrap;/)
		expect(block).toMatch(/messages\.composer-body"\]\s*\{\s*order: -2;\s*flex-basis: 100%;/)
	})
})
