/**
 * The frame half of the widget skin (PLAN 25, ruled 2026-08-30).
 *
 * Two things are asserted, and they are the two halves of one hop: what the
 * HOST puts on the wire (`buildStyleMessage` — the sanitiser boundary, unscoped
 * because the frame is a document of its own) and what the FRAME does with it.
 *
 * The frame half is tested against the SHIPPED sample rather than a reference
 * copy of it: `frames/devFramePanel.fixture.html` (the retired sample frame's document, R74) is the only frame in the tree that
 * speaks this message, and a reference implementation next to it would be the
 * thing under test while the real one drifted. The script is lifted out of the
 * file and run against a hand-built DOM — the repo has no jsdom, and the ten
 * DOM calls this needs do not justify one.
 */
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import { describe, expect, test } from "vitest"
import { buildStyleMessage, sanitizeFrameVars } from "./frameStyle"

describe("buildStyleMessage", () => {
	test("carries the css and vars as protocol v1's style message", () => {
		expect(
			buildStyleMessage({
				css: "body{color:red}",
				vars: { "--accent": "hotpink" }
			})
		).toEqual({
			t: "style",
			css: "body{color:red}",
			vars: { "--accent": "hotpink" }
		})
	})

	test("does NOT scope selectors — the frame is its own document", () => {
		// The native path rewrites this to `[data-widget-instance="…"]`; here
		// `body` must survive, or a frame skin could not style the frame.
		const msg = buildStyleMessage({ css: "body{margin:0}", vars: {} })
		expect(msg.css).toBe("body{margin:0}")
		expect(msg.css).not.toContain("data-widget-instance")
	})

	test("still refuses @import and cross-origin url()", () => {
		const msg = buildStyleMessage({
			css: '@import url("https://evil.test/x.css");body{background:url(https://evil.test/px.gif)}',
			vars: {}
		})
		expect(msg.css).not.toContain("@import")
		expect(msg.css).not.toContain("evil.test")
	})

	test("an absent skin is an empty style, not a missing one", () => {
		// The frame must be able to take its skin OFF; omitting the message
		// would leave the last one applied for ever.
		expect(buildStyleMessage(undefined)).toEqual({
			t: "style",
			css: "",
			vars: {}
		})
		expect(buildStyleMessage({ css: null, vars: null })).toEqual({
			t: "style",
			css: "",
			vars: {}
		})
	})
})

describe("sanitizeFrameVars", () => {
	test("normalises names the way the native path does", () => {
		expect(sanitizeFrameVars({ "--a": "1px", b: "red" })).toEqual({
			"--a": "1px",
			"--b": "red"
		})
	})

	test("neutralises a cross-origin url() in a value, as native does", () => {
		// `var(--bg)` used in a `background` fetches exactly like a literal
		// would, so the URL is replaced rather than the var kept intact. Same
		// verdict, same replacement text, as the native `varsToStyle` path.
		expect(
			sanitizeFrameVars({ "--bg": "url(https://evil.test/px.gif)" })
		).toEqual({ "--bg": "none" })
	})

	test("strips a value that tries to end its own declaration", () => {
		expect(sanitizeFrameVars({ "--a": "red;}body{display:none" })).toEqual({
			"--a": "redbodydisplay:none"
		})
	})

	test("keeps a value containing a colon whole", () => {
		// The split back into a record is on the FIRST colon, never every one.
		expect(sanitizeFrameVars({ "--label": '"a:b"' })).toEqual({
			"--label": '"a:b"'
		})
	})

	test("nothing in, nothing out", () => {
		expect(sanitizeFrameVars(undefined)).toEqual({})
		expect(sanitizeFrameVars({})).toEqual({})
	})
})

/* ── the frame side: the shipped sample ───────────────────────────────── */

interface FakeEl {
	id: string
	textContent: string
}

/** Just enough DOM for the sample's `style` branch, and nothing more. */
function mountSample() {
	const html = fs.readFileSync(
		path.join(process.cwd(), "src/lib/client/components/frames/devFramePanel.fixture.html"),
		"utf8"
	)
	const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1]
	if (!script) throw new Error("devFramePanel.fixture.html has no inline script")

	const byId = new Map<string, FakeEl>()
	const rootVars = new Map<string, string>()
	// A list, not a nullable let: TypeScript will not narrow a `let` assigned
	// only inside a callback, so the handler would read as `never` below.
	const messageHandlers: ((e: unknown) => void)[] = []

	const ctx = {
		// The sample ticks a counter; a real timer would outlive the test.
		setInterval: () => 0,
		document: {
			getElementById: (id: string) => byId.get(id) ?? null,
			createElement: (): FakeEl => ({ id: "", textContent: "" }),
			head: {
				appendChild: (el: FakeEl) => byId.set(el.id, el)
			},
			documentElement: {
				style: {
					setProperty: (k: string, v: string) => rootVars.set(k, v),
					removeProperty: (k: string) => rootVars.delete(k)
				}
			}
		},
		window: {
			addEventListener: (type: string, fn: (e: unknown) => void) => {
				if (type === "message") messageHandlers.push(fn)
			}
		}
	}
	vm.runInNewContext(script, ctx)
	const onWindowMessage = messageHandlers[0]
	if (!onWindowMessage) throw new Error("sample never listened for init")

	const port = { onmessage: null as null | ((e: unknown) => void) }
	const posted: unknown[] = []
	Object.assign(port, { postMessage: (m: unknown) => posted.push(m) })
	onWindowMessage({ data: { t: "init" }, ports: [port] })

	return {
		posted,
		rootVars,
		send: (m: unknown) => port.onmessage?.({ data: m }),
		styleEl: () => byId.get("sp-widget-style") ?? null
	}
}

describe("the frame fixture applies the style message", () => {
	test("acks init, then takes a style", () => {
		const f = mountSample()
		expect(f.posted).toEqual([{ t: "ready" }])

		f.send({ t: "style", css: "body{color:red}", vars: { "--a": "1px" } })
		expect(f.styleEl()?.textContent).toBe("body{color:red}")
		expect(Object.fromEntries(f.rootVars)).toEqual({ "--a": "1px" })
	})

	test("replaces the style element IN PLACE, never stacking them", () => {
		const f = mountSample()
		f.send({ t: "style", css: "body{color:red}", vars: {} })
		const first = f.styleEl()
		f.send({ t: "style", css: "body{color:blue}", vars: {} })
		expect(f.styleEl()).toBe(first)
		expect(first?.textContent).toBe("body{color:blue}")
	})

	test("a var dropped from the skin stops applying", () => {
		const f = mountSample()
		f.send({ t: "style", css: "", vars: { "--a": "1px", "--b": "2px" } })
		f.send({ t: "style", css: "", vars: { "--a": "9px" } })
		expect(Object.fromEntries(f.rootVars)).toEqual({ "--a": "9px" })
	})

	test("a malformed style message is ignored, never thrown on", () => {
		const f = mountSample()
		expect(() => f.send({ t: "style" })).not.toThrow()
		expect(() =>
			f.send({ t: "style", css: 42, vars: "nope" })
		).not.toThrow()
		expect(f.styleEl()?.textContent).toBe("")
		expect(f.rootVars.size).toBe(0)
	})

	test("an unknown message kind is still a no-op", () => {
		// The guard the host relies on: a frame that never learned this
		// message must ignore it, not fail.
		const f = mountSample()
		expect(() => f.send({ t: "not-a-thing" })).not.toThrow()
	})
})
