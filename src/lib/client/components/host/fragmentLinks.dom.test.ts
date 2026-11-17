/**
 * A widget's `#id` link moves within its own box: to the element's top, with
 * the keyboard, and with no change to the page's URL.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { followFragmentLink } from "./fragmentLinks"
import { LANDED_EVENT } from "$lib/client/utils/landOn"

function box(html: string): HTMLElement {
	const el = document.createElement("div")
	el.innerHTML = html
	document.body.append(el)
	return el
}

function click(target: Element, init: MouseEventInit = {}): MouseEvent {
	const e = new MouseEvent("click", {
		bubbles: true,
		cancelable: true,
		button: 0,
		...init
	})
	Object.defineProperty(e, "target", { value: target })
	return e
}

afterEach(() => {
	document.body.innerHTML = ""
	vi.restoreAllMocks()
})

describe("followFragmentLink", () => {
	test("scrolls the target's top into view, focuses it and keeps the URL", () => {
		const b = box(
			`<div id="message-7" tabindex="-1">text</div><a href="#message-7">up</a>`
		)
		const row = b.querySelector<HTMLElement>("#message-7")!
		const scroll = vi.fn()
		row.scrollIntoView = scroll
		const landed = vi.fn()
		b.addEventListener(LANDED_EVENT, landed)
		const before = location.href

		const e = click(b.querySelector("a")!)
		expect(followFragmentLink(e, b)).toBe(true)

		expect(e.defaultPrevented).toBe(true)
		expect(scroll).toHaveBeenCalledWith({
			block: "start",
			behavior: "auto"
		})
		expect(landed).toHaveBeenCalledOnce()
		expect(document.activeElement).toBe(row)
		expect(row.classList.contains("sp-landed")).toBe(false)
		expect(location.href).toBe(before)
	})

	test("finds the target from a click on the link's icon", () => {
		const b = box(
			`<p id="top"></p><a href="#top"><span class="icon"></span></a>`
		)
		b.querySelector<HTMLElement>("#top")!.scrollIntoView = vi.fn()
		expect(followFragmentLink(click(b.querySelector(".icon")!), b)).toBe(
			true
		)
	})

	test("leaves a target outside the box to the browser", () => {
		box(`<div id="elsewhere"></div>`)
		const b = box(`<a href="#elsewhere">go</a>`)
		const e = click(b.querySelector("a")!)
		expect(followFragmentLink(e, b)).toBe(false)
		expect(e.defaultPrevented).toBe(false)
	})

	test("leaves modified clicks and non-fragment links to the browser", () => {
		const b = box(
			`<p id="t"></p><a id="frag" href="#t">a</a><a id="ext" href="https://example.com">b</a>`
		)
		expect(
			followFragmentLink(
				click(b.querySelector("#frag")!, { ctrlKey: true }),
				b
			)
		).toBe(false)
		expect(followFragmentLink(click(b.querySelector("#ext")!), b)).toBe(
			false
		)
	})
})
