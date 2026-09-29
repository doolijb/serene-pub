/**
 * The page's click re-delivery (`uiWorkers.ts`): a click on a node that
 * takes none (a button's label, an icon's svg) reaches the component once,
 * through the nearest element that does, as a copy that activates nothing —
 * the person's own event stays `currentEvent`. Driven through a real guarded
 * receiver on a real box.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { MUTATION_TYPE_INSERT_CHILD, ROOT_ID } from "@remote-dom/core"
import { FN } from "@serene-pub/sdk"
import { createGuardedReceiver } from "./receiverPolicy"
import { currentEvent, listenForRemoteEvents } from "./uiWorkers"

let seq = 0
const el = (element: string, attributes: Record<string, string> = {}, children: unknown[] = [], extra: object = {}) => ({
	id: `r${++seq}`,
	type: 1,
	element,
	attributes,
	children,
	...extra
})
const text = (data: string) => ({ id: `r${++seq}`, type: 3, data })
const onClick = (id: number) => ({ eventListeners: { click: { [FN]: id } } })

/** A box in a remote's territory, its fns recording the event the host saw. */
function setup() {
	const box = document.createElement("div")
	box.setAttribute("data-sp-owner", "demo")
	document.body.appendChild(box)
	const posted: Array<{ id: number; event: string; seen: Event | undefined }> = []
	const { connection } = createGuardedReceiver(box, {
		idPrefix: "t-",
		owner: "demo",
		warn: () => {},
		fnFor: (handle, event) => () => posted.push({ id: handle[FN], event, seen: currentEvent(event) })
	})
	const insert = (node: unknown) => connection.mutate([[MUTATION_TYPE_INSERT_CHILD, ROOT_ID, node, 0]] as never)
	// Twice, as every mount calls it: the listeners are the page's, taken once.
	listenForRemoteEvents()
	listenForRemoteEvents()
	return { box, posted, insert }
}

const click = () => new MouseEvent("click", { bubbles: true, cancelable: true })

afterEach(() => {
	document.body.innerHTML = ""
	vi.restoreAllMocks()
})

describe("click re-delivery", () => {
	test("a click on a button's label posts once, and the fn reads the person's own event", () => {
		const { box, posted, insert } = setup()
		insert(el("button", {}, [el("span", {}, [text("Save")])], onClick(1)))
		const button = box.querySelector("button")!
		const heard: Event[] = []
		button.addEventListener("click", (e) => heard.push(e))
		const original = click()
		box.querySelector("span")!.dispatchEvent(original)
		expect(posted).toHaveLength(1)
		expect(posted[0]).toMatchObject({ id: 1, event: "click" })
		expect(posted[0].seen).toBe(original)
		// The button heard the person's click bubble by, and one copy aimed at it
		// — a copy with no mouse in it, so it activates nothing.
		expect(heard).toHaveLength(2)
		const copy = heard.find((e) => e !== original)!
		expect(copy.target).toBe(button)
		expect(copy).toBeInstanceOf(CustomEvent)
		expect(copy).not.toBeInstanceOf(MouseEvent)
		expect(copy.bubbles).toBe(false)
	})

	test("a click on a link's icon is not a second activation of the link", () => {
		const { box, posted, insert } = setup()
		const open = vi.spyOn(window, "open").mockImplementation(() => null)
		insert(el("a", { href: "https://ok.example/", target: "_blank" }, [el("span", {}, [text("Docs")])], onClick(2)))
		const link = box.querySelector("a")!
		const mice: Event[] = []
		link.addEventListener("click", (e) => {
			if (e instanceof MouseEvent) mice.push(e)
		})
		box.querySelector("span")!.dispatchEvent(click())
		expect(posted.map((p) => p.id)).toEqual([2])
		// Only the person's click is a mouse click at the link; the re-delivered
		// copy opened nothing (a MouseEvent copy would have: two tabs).
		expect(mice).toHaveLength(1)
		expect(open).not.toHaveBeenCalled()
	})

	test("a click the element itself takes is not re-delivered", () => {
		const { box, posted, insert } = setup()
		insert(el("button", {}, [text("Go")], onClick(3)))
		const button = box.querySelector("button")!
		const heard: Event[] = []
		button.addEventListener("click", (e) => heard.push(e))
		button.dispatchEvent(click())
		expect(heard).toHaveLength(1)
		expect(posted.map((p) => p.id)).toEqual([3])
	})

	test("a click outside any remote's territory is left alone", () => {
		setup()
		const button = document.createElement("button")
		const label = document.createElement("span")
		button.append(label)
		document.body.append(button)
		const heard: Event[] = []
		button.addEventListener("click", (e) => heard.push(e))
		label.dispatchEvent(click())
		expect(heard).toHaveLength(1)
		expect(heard[0].target).toBe(label)
	})

	test("a descendant's change is never re-delivered as an ancestor's own", () => {
		const { box } = setup()
		// `sp-tabs` takes `change`; a control inside its panel raising one must
		// reach it only by bubbling, still the control's — never as sp-tabs' own.
		const tabs = document.createElement("sp-tabs")
		const inner = document.createElement("span")
		tabs.append(inner)
		box.append(tabs)
		const heard: Event[] = []
		tabs.addEventListener("change", (e) => heard.push(e))
		inner.dispatchEvent(new Event("change", { bubbles: true }))
		expect(heard).toHaveLength(1)
		expect(heard[0].target).toBe(inner)
	})
})
