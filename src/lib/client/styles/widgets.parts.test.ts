/**
 * Widget parts that once had no rule (2026-11-06): the Author's note's
 * Scenario section, the Composer's "Writing to" line, the sheet faces'
 * anchor, and the hand cursor on whatever a widget offers to press.
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
const names = (r: { selector: string }, token: string) =>
	r.selector.includes(`"${token}"`)
const sets = (r: { body: string }, prop: string) =>
	new RegExp(`(^|[;\\s])${prop}\\s*:`).test(r.body)

describe("widget parts with their own rule", () => {
	it("the scenario textarea is drawn like the note's, in the same rules", () => {
		const own = rules.filter((r) => names(r, "authors-note.scenario-text"))
		expect(
			own.some(
				(r) => sets(r, "box-shadow") && sets(r, "background-color")
			)
		).toBe(true)
		const resize = rules.find(
			(r) => names(r, "authors-note.text") && sets(r, "resize")
		)
		expect(resize !== undefined).toBe(true)
		expect(names(resize!, "authors-note.scenario-text")).toBe(true)
	})

	it("the scenario section is a column with a gap", () => {
		expect(
			rules.some(
				(r) =>
					names(r, "authors-note.scenario") &&
					/display:\s*flex/.test(r.body) &&
					sets(r, "gap")
			)
		).toBe(true)
	})

	it("the Writing to line has a type size", () => {
		expect(
			rules.some(
				(r) => names(r, "composer.writing-to") && sets(r, "font-size")
			)
		).toBe(true)
	})

	it("whatever a widget offers to press shows the hand, at zero specificity", () => {
		expect(
			rules.some(
				(r) =>
					r.selector.startsWith(":where(") &&
					r.selector.includes("button") &&
					r.selector.includes(":not(:disabled") &&
					/cursor:\s*pointer/.test(r.body)
			)
		).toBe(true)
	})

	it("the sheet faces anchor to the top of the portrait", () => {
		const base = rules.find(
			(r) => names(r, "stats.face-img") && sets(r, "object-fit")
		)
		expect(base !== undefined).toBe(true)
		expect(/object-position:\s*top/.test(base!.body)).toBe(true)
	})

	it("a portraits stage never draws taller than 40% of the screen", () => {
		expect(
			rules.some(
				(r) =>
					names(r, "scene-portraits.root") &&
					r.selector.includes('data-arrangement="stage"') &&
					/max-block-size:\s*40svh/.test(r.body)
			)
		).toBe(true)
	})

	it("a stage picture's box hugs the picture, so its corners are rounded at every width", () => {
		const img = rules.find(
			(r) =>
				r.selector.includes("scene-portraits.stage") &&
				names(r, "scene-portraits.face-img") &&
				/object-fit:\s*contain/.test(r.body)
		)
		expect(img !== undefined).toBe(true)
		expect(/inline-size:\s*auto/.test(img!.body)).toBe(true)
		expect(/max-inline-size:\s*100%/.test(img!.body)).toBe(true)
		expect(/(^|[^-])inline-size:\s*100%/.test(img!.body)).toBe(false)
	})
})

describe("speaker focus and the Dialogue box", () => {
	const RAW = readFileSync(
		fileURLToPath(new URL("./widgets.css", import.meta.url)),
		"utf8"
	)
	it("a portrait that is not speaking dims while speaker focus is on", () => {
		const dim = rules.find(
			(r) =>
				names(r, "scene-portraits.root") &&
				r.selector.includes("[data-speaker-focus]") &&
				r.selector.includes(":not([data-speaking])")
		)
		expect(dim !== undefined).toBe(true)
		expect(sets(dim!, "filter")).toBe(true)
	})
	it("the reading bar is a positioned flex row", () => {
		const bar = rules.find(
			(r) => names(r, "dialogue-box.bar") && sets(r, "position")
		)
		expect(/position:\s*relative/.test(bar!.body)).toBe(true)
		expect(/display:\s*flex/.test(bar!.body)).toBe(true)
		expect(/cursor:\s*pointer/.test(bar!.body)).toBe(true)
	})
	it("Next line stretches over the bar from its ::after, and is not positioned itself", () => {
		const after = rules.find((r) =>
			r.selector.includes('"dialogue-box.next"]::after')
		)
		expect(/inset:\s*0/.test(after!.body)).toBe(true)
		expect(sets(after!, "content")).toBe(true)
		const own = rules.filter((r) =>
			r.selector
				.split(",")
				.some((x) => x.trim().endsWith('"dialogue-box.next"]'))
		)
		expect(own.some((r) => sets(r, "position"))).toBe(false)
	})
	it("Pause sits above the stretch", () => {
		expect(
			rules.some(
				(r) =>
					r.selector === '[data-widget-part~="dialogue-box.pause"]' &&
					sets(r, "z-index")
			)
		).toBe(true)
	})
	it("the progress bar has no transition", () => {
		const own = rules.filter((r) => names(r, "dialogue-box.progress"))
		expect(own.length > 0).toBe(true)
		expect(own.some((r) => sets(r, "transition"))).toBe(false)
	})
	it("the line's arrival animates only under no-preference reduced motion", () => {
		const animated = rules.filter(
			(r) => names(r, "dialogue-box.line") && sets(r, "animation")
		)
		expect(animated.length).toBe(1)
		const at = RAW.indexOf("animation: sp-dialogue-arrive")
		const media = RAW.lastIndexOf("@media", at)
		expect(RAW.slice(media, at)).toContain(
			"(prefers-reduced-motion: no-preference)"
		)
	})
	it("the name plate has a dark ground and is never gold", () => {
		const plate = rules.find(
			(r) =>
				r.selector.includes("dialogue-box.root") &&
				names(r, "messages.message-name")
		)
		expect(plate !== undefined).toBe(true)
		expect(sets(plate!, "background")).toBe(true)
		expect(/warning|gold|tertiary/.test(plate!.body)).toBe(false)
	})
})
