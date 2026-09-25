/**
 * The host's gate on a remote's box (§3.5, C2): what a worker sends is
 * mirrored only through the host-element allowlist. Driven with Remote DOM's
 * own record shapes into a real receiver on a real box.
 */
import { describe, expect, test, vi } from "vitest"
import {
	MUTATION_TYPE_INSERT_CHILD,
	MUTATION_TYPE_REMOVE_CHILD,
	MUTATION_TYPE_UPDATE_PROPERTY,
	UPDATE_PROPERTY_TYPE_ATTRIBUTE,
	UPDATE_PROPERTY_TYPE_EVENT_LISTENER,
	UPDATE_PROPERTY_TYPE_PROPERTY,
	ROOT_ID
} from "@remote-dom/core"
import { createGuardedReceiver } from "./receiverPolicy"
import { FN } from "@serene-pub/sdk"

let seq = 0
const el = (element: string, attributes: Record<string, string> = {}, children: unknown[] = [], extra: object = {}) => ({
	id: `n${++seq}`,
	type: 1,
	element,
	attributes,
	children,
	...extra
})
const text = (data: string) => ({ id: `n${++seq}`, type: 3, data })

function setup() {
	const box = document.createElement("div")
	document.body.appendChild(box)
	const warn = vi.fn()
	const fnFor = vi.fn((handle: { [FN]: number }, event: string) => () => `${event}:${handle[FN]}`)
	const { connection } = createGuardedReceiver(box, { idPrefix: "p1-", warn, fnFor, owner: "demo" })
	const insert = (node: unknown, index = 0) =>
		connection.mutate([[MUTATION_TYPE_INSERT_CHILD, ROOT_ID, node, index]] as never)
	return { box, warn, fnFor, connection, insert }
}

describe("the remote's box", () => {
	test("an element outside the vocabulary never lands — its whole subtree is dropped", () => {
		const { box, insert, warn } = setup()
		insert(el("div", {}, [el("script", {}, [text("alert(1)")]), el("iframe", { src: "https://x" }), el("p", {}, [text("kept")])]))
		expect(box.querySelector("script, iframe")).toBeNull()
		expect(box.querySelector("p")?.textContent).toBe("kept")
		expect(warn).toHaveBeenCalled()
	})

	test("a refused node keeps its place, so later records address the right child", () => {
		const { box, insert, connection } = setup()
		insert(el("svg"), 0)
		insert(el("div", { class: "second" }), 1)
		// The remote removes ITS child 0 — the svg — and the div must stay.
		connection.mutate([[MUTATION_TYPE_REMOVE_CHILD, ROOT_ID, 0]] as never)
		expect(box.querySelector(".second")).not.toBeNull()
	})

	test("a link opens without an opener, and may not navigate the app", () => {
		const { box, insert } = setup()
		insert(el("div", {}, [el("a", { href: "https://ok.example/", target: "_blank", rel: "opener" }), el("a", { href: "#top", target: "_self" })]))
		const [ext, frag] = Array.from(box.querySelectorAll("a"))
		expect(ext.getAttribute("rel")).toBe("noopener noreferrer")
		expect(frag.getAttribute("target")).toBeNull()
		expect(frag.getAttribute("href")).toBe("#p1-top")
	})

	test("an attribute the element does not take, or a refused value, never lands", () => {
		const { box, insert } = setup()
		insert(
			el("div", {}, [
				el("button", { onclick: "steal()", style: "position:fixed", type: "button", class: "btn" }),
				el("a", { href: "javascript:alert(1)", target: "top" }),
				el("a", { href: "https://ok.example/", target: "_blank" }),
				el("img", { src: "https://tracker.example/p.gif?d=secret" }),
				el("input", { type: "password" }),
				el("img", { src: "data:image/svg+xml,<svg/>" })
			])
		)
		const button = box.querySelector("button")!
		expect(button.getAttribute("onclick")).toBeNull()
		expect(button.getAttribute("style")).toBeNull()
		expect(button.getAttribute("class")).toBe("btn")
		const [bad, good] = Array.from(box.querySelectorAll("a"))
		expect(bad.getAttribute("href")).toBeNull()
		expect(bad.getAttribute("target")).toBeNull()
		expect(good.getAttribute("href")).toBe("https://ok.example/")
		expect(box.querySelector("input")!.getAttribute("type")).toBeNull()
		for (const img of Array.from(box.querySelectorAll("img"))) expect(img.getAttribute("src")).toBeNull()
	})

	test("ids and id references are prefixed per box, so a remote cannot name the page's elements", () => {
		const { box, insert } = setup()
		insert(el("div", {}, [el("label", { for: "field" }), el("input", { id: "field", "aria-describedby": "a b" })]))
		expect(box.querySelector("label")!.getAttribute("for")).toBe("p1-field")
		const input = box.querySelector("input")!
		expect(input.id).toBe("p1-field")
		expect(input.getAttribute("aria-describedby")).toBe("p1-a p1-b")
	})

	test("properties and method calls are refused; updates are judged like inserts", () => {
		const { box, insert, connection } = setup()
		const div = el("div", { class: "a" })
		insert(div)
		connection.mutate([
			[MUTATION_TYPE_UPDATE_PROPERTY, div.id, "innerHTML", "<img src=x onerror=alert(1)>", UPDATE_PROPERTY_TYPE_PROPERTY],
			[MUTATION_TYPE_UPDATE_PROPERTY, div.id, "onclick", "x()", UPDATE_PROPERTY_TYPE_ATTRIBUTE],
			[MUTATION_TYPE_UPDATE_PROPERTY, div.id, "class", "b", UPDATE_PROPERTY_TYPE_ATTRIBUTE]
		] as never)
		const d = box.querySelector("div")!
		expect(d.innerHTML).toBe("")
		expect(d.getAttribute("onclick")).toBeNull()
		expect(d.getAttribute("class")).toBe("b")
		expect(() => connection.call(div.id, "click")).toThrow()
	})

	test("a listener is kept only for an event the element raises, as the host's own function", () => {
		const { insert, fnFor } = setup()
		insert(
			el("button", {}, [], {
				eventListeners: { click: { [FN]: 1 }, mouseover: { [FN]: 2 } }
			})
		)
		expect(fnFor).toHaveBeenCalledTimes(1)
		expect(fnFor.mock.calls[0][1]).toBe("click")
	})

	test("a listener update for an event the element does not raise is dropped", () => {
		const { insert, connection, fnFor } = setup()
		const b = el("button")
		insert(b)
		connection.mutate([
			[MUTATION_TYPE_UPDATE_PROPERTY, b.id, "keydown", { [FN]: 3 }, UPDATE_PROPERTY_TYPE_EVENT_LISTENER],
			[MUTATION_TYPE_UPDATE_PROPERTY, b.id, "click", { [FN]: 4 }, UPDATE_PROPERTY_TYPE_EVENT_LISTENER]
		] as never)
		expect(fnFor.mock.calls.map((c) => c[1])).toEqual(["click"])
	})

	test("a control's value written by the remote becomes the LIVE value, even after typing", async () => {
		const { box, insert, connection } = setup()
		const area = el("textarea", { value: "draft" })
		const field = el("input", { type: "text", value: "" })
		insert(el("div", {}, [area, field]))
		await Promise.resolve()
		const ta = box.querySelector("textarea")!
		const input = box.querySelector("input")!
		// A textarea has no value attribute of its own: it is made the property.
		expect(ta.value).toBe("draft")
		// The person types; the component empties the field after send.
		input.value = "hello"
		connection.mutate([[MUTATION_TYPE_UPDATE_PROPERTY, field.id, "value", undefined, UPDATE_PROPERTY_TYPE_ATTRIBUTE]] as never)
		connection.mutate([[MUTATION_TYPE_UPDATE_PROPERTY, field.id, "value", "", UPDATE_PROPERTY_TYPE_ATTRIBUTE]] as never)
		await Promise.resolve()
		expect(input.value).toBe("")
	})

	test("a checkbox the person ticked is not unticked by the remote writing its value", async () => {
		const { box, insert, connection } = setup()
		const box1 = el("input", { type: "checkbox", value: "a" })
		insert(box1)
		await Promise.resolve()
		const cb = box.querySelector("input")!
		cb.checked = true
		connection.mutate([[MUTATION_TYPE_UPDATE_PROPERTY, box1.id, "value", "b", UPDATE_PROPERTY_TYPE_ATTRIBUTE]] as never)
		await Promise.resolve()
		expect(cb.checked).toBe(true)
	})

	test("a plugin's widget does not place the page's own views", () => {
		const { box, insert, warn } = setup()
		insert(el("div", {}, [el("sp-host-view", { name: "session-controls" })]))
		expect(box.querySelector("sp-host-view")).toBeNull()
		expect(warn).toHaveBeenCalled()
	})
})
