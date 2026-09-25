/**
 * The sp element machinery (C1b) in a DOM: routing by slot, the park, the
 * logical child list, the doors it does not own, events, and write counts.
 * Driven through a fixture body registered under `sp-switch` (declared
 * event: `change`) so the assertions are about the machinery, not Skeleton.
 */
import { beforeAll, describe, expect, test } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import { makeSpElementClass } from "./spElement.svelte"
import Fixture from "./SpElementFixture.svelte"
import BlockFixture from "./SpElementBlockFixture.svelte"

const tick = () => new Promise((r) => setTimeout(r, 0))

beforeAll(() => {
	customElements.define("sp-switch", makeSpElementClass("sp-switch", { component: Fixture, dataChildren: ["sp-option"] }))
})

function make(attrs: Record<string, string> = {}): HTMLElement {
	const el = document.createElement("sp-switch")
	for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
	return el
}
const p = (text: string, attrs: Record<string, string> = {}) => {
	const n = document.createElement("p")
	n.textContent = text
	for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v)
	return n
}
const texts = (nodes: ArrayLike<Node>) => Array.from(nodes).map((n) => n.textContent)

describe("sp element routing", () => {
	test("a slotted child goes to its container; the body waits in the park until its container exists", async () => {
		const el = make()
		document.body.appendChild(el)
		flushSync()
		const trigger = p("T", { slot: "trigger" })
		const body = p("B")
		el.appendChild(trigger)
		el.appendChild(body)
		expect(trigger.parentElement?.className).toBe("trigger-box")
		expect(body.closest("[data-sp-park]")).not.toBeNull()
		el.setAttribute("checked", "")
		flushSync()
		expect(body.parentElement?.className).toBe("body-box")
		el.removeAttribute("checked")
		flushSync()
		expect(body.closest("[data-sp-park]")).not.toBeNull()
		el.remove()
	})

	test("the logical order is kept across containers, and a receiver's insertBefore works against it", () => {
		const el = make({ checked: "" })
		document.body.appendChild(el)
		flushSync()
		const a = p("A"),
			c = p("C"),
			t = p("T", { slot: "trigger" }),
			b = p("B")
		el.appendChild(a)
		el.appendChild(t)
		el.appendChild(c)
		el.insertBefore(b, c)
		expect(texts(el.childNodes)).toEqual(["A", "T", "B", "C"])
		expect(texts(el.querySelector(".body-box")!.childNodes)).toEqual(["A", "B", "C"])
		el.removeChild(a)
		expect(texts(el.childNodes)).toEqual(["T", "B", "C"])
		expect(() => el.insertBefore(p("X"), a)).toThrow()
		el.remove()
	})

	test("a fragment inserts its children, in order", () => {
		const el = make({ checked: "" })
		document.body.appendChild(el)
		flushSync()
		const f = document.createDocumentFragment()
		f.append(p("1"), p("2"))
		el.appendChild(f)
		expect(texts(el.childNodes)).toEqual(["1", "2"])
		expect(f.childNodes.length).toBe(0)
		el.remove()
	})

	test("children the parser put there are taken in and routed", async () => {
		const box = document.createElement("div")
		document.body.appendChild(box)
		box.innerHTML = '<sp-switch checked><p slot="trigger">T</p><p>B</p></sp-switch>'
		flushSync()
		await tick()
		const el = box.firstElementChild as HTMLElement
		expect(texts(el.childNodes)).toEqual(["T", "B"])
		expect(el.querySelector(".trigger-box")!.textContent).toBe("T")
		expect(el.querySelector(".body-box")!.textContent).toBe("B")
		box.remove()
	})

	test("a child that leaves by another door is dropped, and never pulled back", async () => {
		const el = make({ checked: "" })
		document.body.appendChild(el)
		flushSync()
		const gone = p("gone")
		el.appendChild(gone)
		gone.remove()
		await tick()
		expect(texts(el.childNodes)).toEqual([])
		// The body container re-registering must not steal it back.
		el.removeAttribute("checked")
		flushSync()
		el.setAttribute("checked", "")
		flushSync()
		expect(gone.isConnected).toBe(false)
		el.remove()
	})

	test("a move keeps the element's children and state", async () => {
		const a = document.createElement("div"),
			b = document.createElement("div")
		document.body.append(a, b)
		const el = make({ checked: "" })
		a.appendChild(el)
		flushSync()
		el.appendChild(p("kept"))
		b.appendChild(el)
		await tick()
		flushSync()
		expect(el.querySelector(".body-box")!.textContent).toBe("kept")
		a.remove()
		b.remove()
	})
})

describe("sp element data children", () => {
	test("data children stay parked and reach the body as items, live", async () => {
		const el = make()
		document.body.appendChild(el)
		flushSync()
		const o = document.createElement("sp-option")
		o.setAttribute("value", "r")
		o.textContent = "Red"
		el.appendChild(o)
		flushSync()
		expect(o.closest("[data-sp-park]")).not.toBeNull()
		expect(texts(el.querySelectorAll(".items li"))).toEqual(["r:Red"])
		o.textContent = "Rouge"
		await tick()
		flushSync()
		expect(texts(el.querySelectorAll(".items li"))).toEqual(["r:Rouge"])
		el.remove()
	})
})

describe("sp element events and writes", () => {
	test("its own markup's same-named native event stops at the element; its declared event bubbles once", () => {
		const box = document.createElement("div")
		document.body.appendChild(box)
		const el = make()
		box.appendChild(el)
		flushSync()
		const heard: unknown[] = []
		box.addEventListener("change", (e) => heard.push((e as CustomEvent).detail ?? "native"))
		el.addEventListener("change", (e) => heard.push(["on-element", (e as CustomEvent).detail ?? "native"]))
		el.querySelector(".own-input")!.dispatchEvent(new Event("change", { bubbles: true }))
		expect(heard).toEqual([])
		;(el.querySelector(".own-emit") as HTMLButtonElement).click()
		expect(heard).toEqual([["on-element", { checked: true }], { checked: true }])
		box.remove()
	})

	test("slotted content's events pass through untouched", () => {
		const box = document.createElement("div")
		document.body.appendChild(box)
		const el = make({ checked: "" })
		box.appendChild(el)
		flushSync()
		const input = document.createElement("input")
		el.appendChild(input)
		const heard: string[] = []
		box.addEventListener("change", (e) => heard.push((e.target as Element).localName))
		input.dispatchEvent(new Event("change", { bubbles: true }))
		expect(heard).toEqual(["input"])
		box.remove()
	})

	test("every write is counted, even of the same value — a write is a command", () => {
		const el = make()
		document.body.appendChild(el)
		flushSync()
		const writes = () => Number(el.querySelector(".own")!.getAttribute("data-writes"))
		el.setAttribute("checked", "")
		flushSync()
		const once = writes()
		el.setAttribute("checked", "")
		flushSync()
		expect(writes()).toBe(once + 1)
		el.remove()
	})

	test("a written class keeps the element's root hook", () => {
		const el = make({ class: "mine" })
		document.body.appendChild(el)
		flushSync()
		el.setAttribute("class", "other")
		expect(el.classList.contains("sp-switch")).toBe(true)
		expect(el.classList.contains("other")).toBe(true)
		el.remove()
	})
})

describe("Svelte blocks inside an sp element", () => {
	test("a node a block inserts after mount is seated in its own slot, and leaves cleanly", async () => {
		const target = document.createElement("div")
		document.body.appendChild(target)
		const props = $state({ showTrigger: false, rows: [] as string[] })
		const app = mount(BlockFixture, { target, props })
		flushSync()
		await tick()
		const el = target.querySelector("sp-switch") as HTMLElement
		expect(el.querySelector(".body-box .body")).not.toBeNull()
		props.showTrigger = true
		flushSync()
		await tick()
		expect(el.querySelector(".trigger-box .late-trigger")).not.toBeNull()
		props.showTrigger = false
		flushSync()
		await tick()
		expect(el.querySelector(".late-trigger")).toBeNull()
		expect(el.querySelector(".body-box .body")).not.toBeNull()
		unmount(app)
		target.remove()
	})

	test("data children a block adds and removes reach the body as items", async () => {
		const target = document.createElement("div")
		document.body.appendChild(target)
		const props = $state({ showTrigger: false, rows: ["a"] as string[] })
		const app = mount(BlockFixture, { target, props })
		flushSync()
		await tick()
		const el = target.querySelector("sp-switch") as HTMLElement
		const items = () => Array.from(el.querySelectorAll(".items li")).map((l) => l.textContent)
		expect(items()).toEqual(["a:a"])
		props.rows = ["a", "b"]
		flushSync()
		await tick()
		flushSync()
		expect(items()).toEqual(["a:a", "b:b"])
		props.rows = ["b"]
		flushSync()
		await tick()
		flushSync()
		expect(items()).toEqual(["b:b"])
		unmount(app)
		target.remove()
	})
})
