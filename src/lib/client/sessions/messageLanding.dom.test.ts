import { afterEach, describe, expect, test, vi } from "vitest"
import { landingTarget } from "./messageLanding"
import { LANDED_EVENT, landOn } from "$lib/client/utils/landOn"

afterEach(() => {
	document.body.replaceChildren()
	vi.useRealTimers()
})

function draw(html: string) {
	document.body.innerHTML = html
}

describe("landingTarget", () => {
	test("nothing drawn yet → null", () => {
		draw(`<div id="message-2"></div>`)
		expect(landingTarget(document, { messageId: 1, blockId: null })).toBeNull()
	})

	test("the row, focused when it can take focus", () => {
		draw(`<div id="message-1" tabindex="-1"></div>`)
		const hit = landingTarget(document, { messageId: 1, blockId: null })!
		expect(hit.el.id).toBe("message-1")
		expect(hit.focus).toBe(hit.el)
	})

	test("the named block inside the row; a live form's first control takes focus", () => {
		draw(`<div id="message-1" tabindex="-1">
			<div data-block-id="f1"><input disabled /><select name="a"></select></div>
		</div>`)
		const hit = landingTarget(document, { messageId: 1, blockId: "f1" })!
		expect(hit.el.dataset.blockId).toBe("f1")
		expect(hit.focus?.tagName).toBe("SELECT")
	})

	test("an answered block (no controls) lands on the block, focus on the row", () => {
		draw(`<div id="message-1" tabindex="-1"><div data-block-id="f1" data-answered="true"></div></div>`)
		const hit = landingTarget(document, { messageId: 1, blockId: "f1" })!
		expect(hit.el.dataset.blockId).toBe("f1")
		expect(hit.focus?.id).toBe("message-1")
	})

	test("a block that is not in this message falls back to the message", () => {
		draw(`<div id="message-1"></div><div id="message-2"><div data-block-id="f1"></div></div>`)
		const hit = landingTarget(document, { messageId: 1, blockId: "f1" })!
		expect(hit.el.id).toBe("message-1")
		expect(hit.focus).toBeNull()
	})
})

describe("landOn", () => {
	test("scrolls, raises the landed event, rings once, focuses", () => {
		vi.useFakeTimers()
		draw(`<section><div id="message-1" tabindex="-1"></div></section>`)
		const el = document.getElementById("message-1")!
		const scroll = vi.fn()
		el.scrollIntoView = scroll
		const heard = vi.fn()
		document.querySelector("section")!.addEventListener(LANDED_EVENT, heard)
		landOn(el, { focus: el })
		expect(scroll).toHaveBeenCalledWith({ block: "center", behavior: "auto" })
		expect(heard).toHaveBeenCalledOnce()
		expect(el.classList.contains("sp-landed")).toBe(true)
		expect(document.activeElement).toBe(el)
		vi.runAllTimers()
		expect(el.classList.contains("sp-landed")).toBe(false)
	})
})
