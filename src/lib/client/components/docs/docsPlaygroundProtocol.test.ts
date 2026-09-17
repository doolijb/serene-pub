import { describe, expect, it } from "vitest"
import {
	FRAME_MAX_HEIGHT,
	FRAME_MIN_HEIGHT,
	PlaygroundProtocol,
	clampFrameHeight,
	parsePlaygroundBlock,
	type PlaygroundBlock
} from "./docsPlaygroundProtocol"

/**
 * A stand-in for one compiled `.doc-playground` element, built without a DOM.
 *
 * `parsePlaygroundBlock` asks an element three things — a `data-lang`, a child
 * matching one selector, and that child's `textContent` — so the tests state
 * those three and nothing else. The alternative is jsdom for a function whose
 * whole job is to read two strings off a node.
 */
function block(
	options: { lang?: string | null; source?: string | null } = {}
): Element {
	const { lang = "ts", source = "const a = 1" } = options
	return {
		getAttribute: (name: string) => (name === "data-lang" ? lang : null),
		querySelector: (selector: string) =>
			selector === "script.doc-playground-source" && source !== null
				? { textContent: source }
				: null
	} as unknown as Element
}

const sample: PlaygroundBlock = { lang: "ts", code: "run()" }

describe("parsePlaygroundBlock", () => {
	it("reads the language and the source", () => {
		expect(parsePlaygroundBlock(block({ lang: "json" }))).toEqual({
			lang: "json",
			code: "const a = 1"
		})
	})

	it("is null for a block the compiler emitted without a source", () => {
		// Pages compiled before the source script existed: still a code block,
		// never a button.
		expect(parsePlaygroundBlock(block({ source: null }))).toBeNull()
	})

	it("is null for a source with nothing in it", () => {
		expect(parsePlaygroundBlock(block({ source: "  \n\t " }))).toBeNull()
	})

	it("falls back to ts when the fence named no language", () => {
		expect(parsePlaygroundBlock(block({ lang: null }))?.lang).toBe("ts")
		expect(parsePlaygroundBlock(block({ lang: "  " }))?.lang).toBe("ts")
	})

	it("resolves the entities the compiler escaped", () => {
		// `<script type="text/plain">` is a raw-text element, so the parser
		// leaves these alone and every `<` in a generic would otherwise reach
		// the frame as `&lt;`.
		const parsed = parsePlaygroundBlock(
			block({
				source: "const xs: Array&lt;string&gt; = [&quot;a&quot;, &#39;b&#39;]\nif (a &amp;&amp; b) {}"
			})
		)
		expect(parsed?.code).toBe(
			"const xs: Array<string> = [\"a\", 'b']\nif (a && b) {}"
		)
	})

	it("keeps an escaped literal entity escaped", () => {
		// `&amp;lt;` is source that says `&lt;`, not source that says `<`.
		expect(
			parsePlaygroundBlock(block({ source: "x = '&amp;lt;'" }))?.code
		).toBe("x = '&lt;'")
	})
})

describe("clampFrameHeight", () => {
	it("keeps a height inside the bounds", () => {
		expect(clampFrameHeight(320)).toBe(320)
	})

	it("floors and ceilings", () => {
		expect(clampFrameHeight(10)).toBe(FRAME_MIN_HEIGHT)
		expect(clampFrameHeight(99_999)).toBe(FRAME_MAX_HEIGHT)
	})

	it("rounds", () => {
		expect(clampFrameHeight(320.6)).toBe(321)
	})

	it("is null for anything that is not a real number", () => {
		for (const bad of ["320", NaN, Infinity, null, undefined, {}]) {
			expect(clampFrameHeight(bad)).toBeNull()
		}
	})
})

describe("PlaygroundProtocol", () => {
	it("holds the load until the frame says it is ready", () => {
		const p = new PlaygroundProtocol("light")
		expect(p.load(sample)).toEqual([])
		expect(p.ready).toBe(false)

		const signal = p.receive({ t: "playground:ready", v: 1 })
		expect(signal.ready).toBe(true)
		expect(signal.post).toEqual([
			{
				t: "playground:load",
				v: 1,
				lang: "ts",
				code: "run()",
				theme: "light"
			}
		])
	})

	it("posts the load straight away once ready", () => {
		const p = new PlaygroundProtocol("dark")
		p.receive({ t: "playground:ready", v: 1 })
		expect(p.load(sample)).toEqual([
			{
				t: "playground:load",
				v: 1,
				lang: "ts",
				code: "run()",
				theme: "dark"
			}
		])
	})

	it("carries autorun only when it was asked for", () => {
		const p = new PlaygroundProtocol("light")
		p.receive({ t: "playground:ready", v: 1 })
		expect(p.load(sample)[0]).not.toHaveProperty("autorun")
		expect(p.load(sample, true)[0]).toMatchObject({ autorun: true })
	})

	it("rewrites the held load rather than queueing a theme message", () => {
		// A theme post would reach an unready frame before the load it is meant
		// to correct — i.e. never.
		const p = new PlaygroundProtocol("light")
		p.load(sample)
		expect(p.setTheme("dark")).toEqual([])
		expect(p.receive({ t: "playground:ready", v: 1 }).post).toEqual([
			{
				t: "playground:load",
				v: 1,
				lang: "ts",
				code: "run()",
				theme: "dark"
			}
		])
	})

	it("posts a theme message once ready", () => {
		const p = new PlaygroundProtocol("light")
		p.load(sample)
		p.receive({ t: "playground:ready", v: 1 })
		expect(p.setTheme("dark")).toEqual([
			{ t: "playground:theme", theme: "dark" }
		])
		expect(p.theme).toBe("dark")
	})

	it("says nothing when the theme did not actually change", () => {
		const p = new PlaygroundProtocol("light")
		p.receive({ t: "playground:ready", v: 1 })
		expect(p.setTheme("light")).toEqual([])
	})

	it("re-posts the load to a frame that announced itself again", () => {
		// A reloaded frame document has lost its code and cannot ask for it.
		const p = new PlaygroundProtocol("light")
		p.load(sample)
		p.receive({ t: "playground:ready", v: 1 })
		expect(p.receive({ t: "playground:ready", v: 1 }).post).toHaveLength(1)
	})

	it("clamps a reported height", () => {
		const p = new PlaygroundProtocol("light")
		expect(p.receive({ t: "playground:height", px: 4000 })).toEqual({
			post: [],
			height: FRAME_MAX_HEIGHT
		})
	})

	it("ignores a height that is not a number", () => {
		const p = new PlaygroundProtocol("light")
		expect(p.receive({ t: "playground:height", px: "tall" })).toEqual({
			post: []
		})
	})

	it("tracks the run state", () => {
		const p = new PlaygroundProtocol("light")
		expect(p.receive({ t: "playground:state", running: true })).toEqual({
			post: [],
			running: true
		})
		expect(p.running).toBe(true)
		expect(p.receive({ t: "playground:state", running: false })).toEqual({
			post: [],
			running: false
		})
	})

	it("ignores anything it does not recognise", () => {
		const p = new PlaygroundProtocol("light")
		for (const junk of [null, undefined, "ready", 7, { t: "nope" }, {}]) {
			expect(p.receive(junk)).toEqual({ post: [] })
		}
		expect(p.ready).toBe(false)
	})
})
