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
	MUTATION_TYPE_UPDATE_TEXT,
	UPDATE_PROPERTY_TYPE_ATTRIBUTE,
	UPDATE_PROPERTY_TYPE_EVENT_LISTENER,
	UPDATE_PROPERTY_TYPE_PROPERTY,
	ROOT_ID
} from "@remote-dom/core"
import { createGuardedReceiver, interactionAfter } from "./receiverPolicy"
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

function setup(owner = "demo") {
	const box = document.createElement("div")
	document.body.appendChild(box)
	const warn = vi.fn()
	const fnFor = vi.fn((handle: { [FN]: number }, event: string) => () => `${event}:${handle[FN]}`)
	const { connection } = createGuardedReceiver(box, { idPrefix: "p1-", warn, fnFor, owner })
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

	test("a node inserted and updated in ONE batch keeps the update — an edit field opens holding its line", async () => {
		const { box, connection } = setup()
		const field = el("textarea", { rows: "1" })
		const badge = el("sp-badge", {})
		connection.mutate([
			[MUTATION_TYPE_INSERT_CHILD, ROOT_ID, el("div", {}, [field, badge]), 0],
			[MUTATION_TYPE_UPDATE_PROPERTY, field.id, "value", "the line as it reads", UPDATE_PROPERTY_TYPE_ATTRIBUTE],
			[MUTATION_TYPE_UPDATE_PROPERTY, badge.id, "tone", "warning", UPDATE_PROPERTY_TYPE_ATTRIBUTE]
		] as never)
		await Promise.resolve() // the live-value sync is a MutationObserver
		expect(box.querySelector("textarea")?.value).toBe("the line as it reads")
		expect(box.querySelector("sp-badge")?.getAttribute("tone")).toBe("warning")
	})

	test("an update to a node of a refused subtree is dropped, in the same batch too", () => {
		const { box, connection } = setup()
		const inner = el("div", {})
		connection.mutate([
			[MUTATION_TYPE_INSERT_CHILD, ROOT_ID, el("svg", {}, [inner]), 0],
			[MUTATION_TYPE_UPDATE_PROPERTY, inner.id, "class", "x", UPDATE_PROPERTY_TYPE_ATTRIBUTE]
		] as never)
		expect(box.querySelector(".x")).toBeNull()
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

	test("aria-current and aria-live land with their allowed values; others (assertive) are dropped with a warning", () => {
		const { box, insert, warn } = setup()
		insert(
			el("ol", {}, [
				el("li", { class: "now", "aria-current": "step" }),
				el("li", { class: "odd", "aria-current": "yes please" }),
				el("div", { class: "calm", "aria-live": "polite" }),
				el("div", { class: "loud", "aria-live": "assertive" })
			])
		)
		expect(box.querySelector(".now")!.getAttribute("aria-current")).toBe("step")
		expect(box.querySelector(".odd")!.hasAttribute("aria-current")).toBe(false)
		expect(box.querySelector(".calm")!.getAttribute("aria-live")).toBe("polite")
		expect(box.querySelector(".loud")!.hasAttribute("aria-live")).toBe(false)
		const said = warn.mock.calls.map((c) => String(c[0]))
		expect(said.some((s) => s.includes("aria-live 'assertive'"))).toBe(true)
		expect(said.some((s) => s.includes("aria-current 'yes please'"))).toBe(true)
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

	test("a plugin's field never lands with autofocus; core's does", () => {
		const plugin = setup()
		const field = el("textarea", { autofocus: "" })
		plugin.insert(field)
		plugin.connection.mutate([
			[MUTATION_TYPE_UPDATE_PROPERTY, field.id, "autofocus", "", UPDATE_PROPERTY_TYPE_ATTRIBUTE]
		] as never)
		expect(plugin.box.querySelector("textarea")!.hasAttribute("autofocus")).toBe(false)
		expect(plugin.warn).toHaveBeenCalled()
		const core = setup("core")
		core.insert(el("textarea", { autofocus: "" }))
		expect(core.box.querySelector("textarea")!.hasAttribute("autofocus")).toBe(true)
	})

	test("core's autofocus on a field with no caret (a number) focuses it, and the rest of the batch still lands", async () => {
		// A number field has no selection: putting the caret at its end throws
		// (InvalidStateError), which stopped the live-value sync for every later
		// record in the batch — the C7 gate caught it on a Stats edit.
		const core = setup("core")
		const other = el("input", { type: "text", value: "old" })
		core.insert(other)
		await Promise.resolve()
		const typed = core.box.querySelector("input") as HTMLInputElement
		typed.value = "typed by the person"
		core.connection.mutate([
			[MUTATION_TYPE_INSERT_CHILD, ROOT_ID, el("div", {}, [el("input", { type: "number", autofocus: "", value: "14" })]), 1],
			[MUTATION_TYPE_UPDATE_PROPERTY, other.id, "value", "the remote's", UPDATE_PROPERTY_TYPE_ATTRIBUTE]
		] as never)
		await Promise.resolve()
		const number = core.box.querySelector('input[type="number"]') as HTMLInputElement
		expect(document.activeElement === number).toBe(true)
		expect(typed.value).toBe("the remote's")
	})

	test("hidden or inert written as the string 'false' is absent, as the component meant", () => {
		const { box, insert, connection } = setup()
		const badge = el("sp-badge", { hidden: "false", inert: "false" })
		const kept = el("div", { class: "kept", hidden: "", inert: "" })
		insert(el("div", {}, [badge, kept]))
		const landed = box.querySelector("sp-badge")!
		expect(landed.hasAttribute("hidden")).toBe(false)
		expect(landed.hasAttribute("inert")).toBe(false)
		const other = box.querySelector(".kept")!
		expect(other.hasAttribute("hidden")).toBe(true)
		expect(other.hasAttribute("inert")).toBe(true)
		// Shown, then hidden, then `hidden={false}` again: the attribute goes.
		connection.mutate([[MUTATION_TYPE_UPDATE_PROPERTY, badge.id, "hidden", "", UPDATE_PROPERTY_TYPE_ATTRIBUTE]] as never)
		expect(landed.hasAttribute("hidden")).toBe(true)
		connection.mutate([[MUTATION_TYPE_UPDATE_PROPERTY, badge.id, "hidden", "false", UPDATE_PROPERTY_TYPE_ATTRIBUTE]] as never)
		expect(landed.hasAttribute("hidden")).toBe(false)
	})

	test("a refused insert teaches the guard nothing: the node keeps its own tag's rules, and the box stops", () => {
		const { box, insert, connection } = setup()
		const field = el("input", { type: "text" })
		const other = el("div", { class: "a" })
		insert(el("div", {}, [field, other]))
		// The same id again, now claiming to be a button — whose `type` has no
		// value rule. The receiver would refuse it; the guard refuses first.
		expect(() =>
			connection.mutate([[MUTATION_TYPE_INSERT_CHILD, ROOT_ID, { ...el("button"), id: field.id }, 1]] as never)
		).toThrow(/already in the box as <input>/)
		connection.mutate([
			[MUTATION_TYPE_UPDATE_PROPERTY, field.id, "type", "password", UPDATE_PROPERTY_TYPE_ATTRIBUTE],
			[MUTATION_TYPE_UPDATE_PROPERTY, other.id, "class", "b", UPDATE_PROPERTY_TYPE_ATTRIBUTE]
		] as never)
		expect(box.querySelector("input")!.getAttribute("type")).toBe("text")
		// Stopped: not even a sound record lands in a box that stopped matching.
		expect(box.querySelector(".a")).not.toBeNull()
		expect(box.querySelector("button")).toBeNull()
	})

	test("what the remote writes into a refused subtree is dropped, and the widget lives on", () => {
		const { box, insert, connection, warn } = setup()
		const bold = text("0")
		const b = el("b", {}, [bold])
		const deep = el("div", {})
		const nav = el("nav", {}, [deep])
		const kept = text("ok")
		insert(el("div", {}, [b, nav, el("span", {}, [kept])]))
		warn.mockClear()
		expect(() =>
			connection.mutate([
				// `<b>{count}</b>` changing: its text node never landed.
				[MUTATION_TYPE_UPDATE_TEXT, bold.id, "1"],
				// An `{#if}` inside the refused element, then inside its subtree.
				[MUTATION_TYPE_INSERT_CHILD, b.id, el("i", {}, [text("new")]), 1],
				[MUTATION_TYPE_INSERT_CHILD, deep.id, el("p", {}, [text("new")]), 0],
				[MUTATION_TYPE_REMOVE_CHILD, b.id, 0],
				[MUTATION_TYPE_REMOVE_CHILD, deep.id, 0],
				[MUTATION_TYPE_UPDATE_PROPERTY, deep.id, "class", "x", UPDATE_PROPERTY_TYPE_ATTRIBUTE],
				// And the rest of the widget still answers.
				[MUTATION_TYPE_UPDATE_TEXT, kept.id, "still ok"]
			] as never)
		).not.toThrow()
		expect(box.querySelector("span")!.textContent).toBe("still ok")
		expect(box.querySelector("i, p, .x")).toBeNull()
		expect(box.textContent).toBe("still ok")
	})

	test("an {#if} toggling inside a refused subtree leaves its tracking bounded; the subtree's removal clears it", () => {
		const { box, insert, connection } = setup()
		const g = el("g")
		const svg = el("svg", {}, [g])
		const row = el("div", {}, [svg, el("span", { class: "kept" })])
		insert(row)
		// The svg and its g, held for what the remote still draws there.
		expect(connection.refusedIdsHeld).toBe(2)
		for (let i = 0; i < 100; i++) {
			connection.mutate([[MUTATION_TYPE_INSERT_CHILD, g.id, el("path", {}, [text(String(i))]), 0]] as never)
			connection.mutate([[MUTATION_TYPE_REMOVE_CHILD, g.id, 0]] as never)
		}
		expect(connection.refusedIdsHeld).toBe(2)
		// A removal inside it takes the child at the remote's index, and what is under it.
		const first = el("i", {}, [text("a")])
		const second = el("b", {}, [text("b"), text("c")])
		connection.mutate([
			[MUTATION_TYPE_INSERT_CHILD, svg.id, first, 1],
			[MUTATION_TYPE_INSERT_CHILD, svg.id, second, 1],
			[MUTATION_TYPE_REMOVE_CHILD, svg.id, 2]
		] as never)
		expect(connection.refusedIdsHeld).toBe(2 + 3)
		// The stand-in leaves the box: nothing of it is held, and its sibling stays.
		connection.mutate([[MUTATION_TYPE_REMOVE_CHILD, row.id, 0]] as never)
		expect(connection.refusedIdsHeld).toBe(0)
		expect(box.querySelector(".kept")).not.toBeNull()
	})

	test("an update for a node that has left the box is dropped, not a crash", () => {
		const { box, insert, connection } = setup()
		const gone = el("div", { class: "gone" })
		insert(gone)
		connection.mutate([[MUTATION_TYPE_REMOVE_CHILD, ROOT_ID, 0]] as never)
		expect(() =>
			connection.mutate([[MUTATION_TYPE_UPDATE_PROPERTY, gone.id, "class", "back", UPDATE_PROPERTY_TYPE_ATTRIBUTE]] as never)
		).not.toThrow()
		expect(box.children).toHaveLength(0)
	})

	test("a link written with leading or trailing space is judged and written trimmed, so it is still the box's", () => {
		const { box, insert, connection } = setup()
		const spaced = el("a", { href: " #message-12" })
		insert(el("div", {}, [spaced, el("a", { href: " #top\t" }), el("img", { src: "\t/media/abc?v=thumb " })]))
		const [one, two] = Array.from(box.querySelectorAll("a"))
		expect(one.getAttribute("href")).toBe("#p1-message-12")
		expect(two.getAttribute("href")).toBe("#p1-top")
		expect(box.querySelector("img")!.getAttribute("src")).toBe("/media/abc?v=thumb")
		connection.mutate([[MUTATION_TYPE_UPDATE_PROPERTY, spaced.id, "href", "\n#message-5", UPDATE_PROPERTY_TYPE_ATTRIBUTE]] as never)
		expect(one.getAttribute("href")).toBe("#p1-message-5")
	})

	test("a message's session assets land in core's box and a plugin's: a part's image and file, a block's image", () => {
		for (const owner of ["core", "demo"]) {
			const { box, insert, warn } = setup(owner)
			insert(
				el("div", {}, [
					el("img", { class: "part", src: "/session-assets/41", alt: "a map" }),
					el("a", { class: "file", href: "/session-assets/42", download: "notes.txt" }),
					el("img", { class: "block", src: "/session-assets/43?v=thumb", alt: "a sketch" })
				])
			)
			expect(box.querySelector(".part")!.getAttribute("src")).toBe("/session-assets/41")
			expect(box.querySelector(".block")!.getAttribute("src")).toBe("/session-assets/43?v=thumb")
			const file = box.querySelector(".file")!
			expect(file.getAttribute("href")).toBe("/session-assets/42")
			expect(file.getAttribute("download")).toBe("notes.txt")
			expect(file.getAttribute("rel")).toBe("noopener noreferrer")
			expect(warn).not.toHaveBeenCalled()
		}
	})

	test("what only looks like a session asset is still refused, in core's box too", () => {
		for (const owner of ["core", "demo"]) {
			const { box, insert, warn } = setup(owner)
			insert(
				el("div", {}, [
					el("a", { href: "javascript:alert(1)" }),
					el("a", { href: "http://evil.example/session-assets/42" }),
					el("a", { href: "//evil.example/session-assets/42" }),
					el("a", { href: "/session-assets/42/../../api/users" }),
					el("img", { src: "/session-assets/41/sprites/happy.webp" }),
					el("img", { src: "/session-assets/secret" }),
					el("img", { src: "http://evil.example/session-assets/41" })
				])
			)
			for (const a of Array.from(box.querySelectorAll("a"))) expect(a.getAttribute("href")).toBeNull()
			for (const img of Array.from(box.querySelectorAll("img"))) expect(img.getAttribute("src")).toBeNull()
			expect(warn).toHaveBeenCalledTimes(7)
		}
		// Another host over TLS: a plugin's box refuses the image the page would fetch.
		const plugin = setup()
		plugin.insert(el("img", { src: "https://evil.example/session-assets/41" }))
		expect(plugin.box.querySelector("img")!.getAttribute("src")).toBeNull()
	})

	test("an envoy's face: core's box shows an https or inline image, a plugin's does not", () => {
		const png =
			"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
		const faces = () =>
			el("div", {}, [
				el("img", { class: "https", src: "https://cdn.example/herald.png" }),
				el("img", { class: "inline", src: png }),
				el("img", { class: "vector", src: "data:image/svg+xml;utf8,%3Csvg%2F%3E" })
			])
		const core = setup("core")
		core.insert(faces())
		expect(core.box.querySelector(".https")!.getAttribute("src")).toBe("https://cdn.example/herald.png")
		expect(core.box.querySelector(".inline")!.getAttribute("src")).toBe(png)
		// Remote DOM's own floor refuses a vector data URI outright: dropped
		// here, so the box lives on without it.
		expect(core.box.querySelector(".vector")!.getAttribute("src")).toBeNull()
		const plugin = setup()
		plugin.insert(faces())
		for (const img of Array.from(plugin.box.querySelectorAll("img"))) expect(img.getAttribute("src")).toBeNull()
	})
})

describe("the invoke gate's window (interactionAfter)", () => {
	const trusted = { isTrusted: true } as Event
	const synthetic = { isTrusted: false } as Event
	test("a person's event opens it; a synthetic one leaves it as it was", () => {
		expect(interactionAfter("click", trusted, null, 100)).toBe(100)
		expect(interactionAfter("change", synthetic, 40, 100)).toBe(40)
		expect(interactionAfter("change", undefined, null, 100)).toBeNull()
	})
	test("leaving a field closes it, however trusted the blur — never opens it", () => {
		expect(interactionAfter("blur", trusted, null, 100)).toBeNull()
		expect(interactionAfter("blur", trusted, 90, 100)).toBeNull()
	})
})
