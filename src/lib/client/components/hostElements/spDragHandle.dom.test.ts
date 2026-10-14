/**
 * 🚧 `sp-drag-handle` (vocabulary 1.4, live scenes lane E): dragged along a
 * box's items, it snaps to the gap nearest the pointer and raises `move`
 * with the keys either side, in document order. happy-dom lays nothing out,
 * so each item is given a box by hand (`layout`); what is tested is which
 * gap a drop lands in, and that Escape, a click without a drag and a hidden
 * item raise nothing or are passed over.
 */
import { afterEach, beforeAll, describe, expect, test } from "vitest"
import { flushSync } from "svelte"
import { makeSpElementClass } from "./spElement.svelte"
import SpDragHandle from "./SpDragHandle.svelte"

beforeAll(() => {
	if (!customElements.get("sp-drag-handle"))
		customElements.define(
			"sp-drag-handle",
			makeSpElementClass("sp-drag-handle", { component: SpDragHandle })
		)
})

afterEach(() => {
	document.body.replaceChildren()
})

/** A box for an element: `top`, 40px tall, 300px wide. */
function layout(el: HTMLElement, top: number) {
	const rect = {
		top,
		bottom: top + 40,
		left: 10,
		right: 310,
		width: 300,
		height: 40,
		x: 10,
		y: top,
		toJSON: () => ({})
	} as DOMRect
	el.getBoundingClientRect = () => rect
	el.getClientRects = () => [rect] as unknown as DOMRectList
}

/** A widget box with three rows (keys 1–3, at 0, 40, 80) and a handle. */
function mount(opts: { hideSecond?: boolean; disabled?: boolean } = {}) {
	const box = document.createElement("div")
	box.setAttribute("data-sp-owner", "core")
	const rows = [1, 2, 3].map((key, i) => {
		const li = document.createElement("li")
		li.setAttribute("data-widget-part", "messages.message-row")
		li.setAttribute("data-drag-key", String(key))
		if (opts.hideSecond && key === 2) li.hidden = true
		layout(li, i * 40)
		box.appendChild(li)
		return li
	})
	const handle = document.createElement("sp-drag-handle")
	handle.setAttribute("along", "messages.message-row")
	handle.setAttribute("label", "Drag to move where the scene starts")
	if (opts.disabled) handle.setAttribute("disabled", "")
	box.appendChild(handle)
	document.body.appendChild(box)
	flushSync()
	const moves: unknown[] = []
	handle.addEventListener("move", (e) => moves.push((e as CustomEvent).detail))
	const grip = handle.querySelector<HTMLElement>(".sp-drag-handle-grip")!
	return { box, rows, handle, grip, moves }
}

const pointer = (type: string, clientY: number) =>
	new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientY })

describe("sp-drag-handle", () => {
	test("a drop snaps to the nearest gap and names the items either side", () => {
		const { grip, moves, handle } = mount()
		expect(grip.getAttribute("aria-hidden")).toBe("true")
		grip.dispatchEvent(pointer("pointerdown", 85))
		grip.dispatchEvent(pointer("pointermove", 45))
		flushSync()
		expect(handle.querySelector(".sp-drag-handle-line")).not.toBeNull()
		grip.dispatchEvent(pointer("pointerup", 45))
		flushSync()
		expect(moves).toEqual([{ prev: "1", next: "2" }])
		expect(handle.querySelector(".sp-drag-handle-line")).toBeNull()

		// Past the last item: no next.
		grip.dispatchEvent(pointer("pointerdown", 10))
		grip.dispatchEvent(pointer("pointermove", 200))
		grip.dispatchEvent(pointer("pointerup", 200))
		expect(moves.at(-1)).toEqual({ prev: "3", next: null })
	})

	test("a hidden item is passed over", () => {
		const { grip, moves } = mount({ hideSecond: true })
		grip.dispatchEvent(pointer("pointerdown", 10))
		grip.dispatchEvent(pointer("pointermove", 41))
		grip.dispatchEvent(pointer("pointerup", 41))
		// Gaps are at 0, 80 (before 3) and 120: 41 is nearest 80.
		expect(moves).toEqual([{ prev: "1", next: "3" }])
	})

	test("a click with no drag, Escape, and a disabled handle raise nothing", () => {
		const { grip, moves } = mount()
		grip.dispatchEvent(pointer("pointerdown", 10))
		grip.dispatchEvent(pointer("pointerup", 10))
		grip.dispatchEvent(pointer("pointerdown", 10))
		grip.dispatchEvent(pointer("pointermove", 60))
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
		grip.dispatchEvent(pointer("pointerup", 60))
		expect(moves).toEqual([])

		const off = mount({ disabled: true })
		off.grip.dispatchEvent(pointer("pointerdown", 10))
		off.grip.dispatchEvent(pointer("pointermove", 60))
		off.grip.dispatchEvent(pointer("pointerup", 60))
		expect(off.moves).toEqual([])
	})
})
