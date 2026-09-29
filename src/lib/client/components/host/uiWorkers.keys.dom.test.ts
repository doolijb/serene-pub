/**
 * A plain `input` a remote placed with `keys` (R80, `uiWorkers.ts`): a press
 * its `keys` names is kept from the field and reaches the component as `key`
 * with the detail `sp-composer-field` sends; every other key is the field's.
 * Driven through a real guarded receiver on a real box.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { MUTATION_TYPE_INSERT_CHILD, ROOT_ID } from "@remote-dom/core"
import { FN } from "@serene-pub/sdk"
import { createGuardedReceiver, summarize } from "./receiverPolicy"
import { currentEvent, listenForRemoteEvents } from "./uiWorkers"
import { registerVoucher } from "$lib/client/components/hostElements/activation"

let seq = 0
const input = (attributes: Record<string, string>, fn: number) => ({
	id: `k${++seq}`,
	type: 1,
	element: "input",
	attributes,
	children: [],
	eventListeners: { key: { [FN]: fn } }
})

/** A box in a remote's territory, its fns recording the summary the worker would be sent. */
function setup() {
	const box = document.createElement("div")
	box.setAttribute("data-sp-owner", "demo")
	document.body.appendChild(box)
	const posted: Array<{ id: number; detail: unknown }> = []
	const warn = vi.fn()
	const { connection } = createGuardedReceiver(box, {
		idPrefix: "t-",
		owner: "demo",
		warn,
		fnFor: (handle, event) => () =>
			posted.push({ id: handle[FN], detail: summarize(currentEvent(event), event, undefined) })
	})
	const insert = (node: unknown) =>
		connection.mutate([[MUTATION_TYPE_INSERT_CHILD, ROOT_ID, node, 0]] as never)
	listenForRemoteEvents()
	return { box, posted, insert, warn }
}

const press = (key: string, held: KeyboardEventInit = {}) =>
	new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...held })

afterEach(() => {
	document.body.innerHTML = ""
	vi.restoreAllMocks()
})

describe("keys on a plain input", () => {
	test("Escape and Enter reach the component as `key`, kept from the field; other keys do not", () => {
		const { box, posted, insert, warn } = setup()
		insert(input({ type: "number", keys: "Escape Enter", value: "3" }, 1))
		const field = box.querySelector("input")!
		// The vocabulary took the attribute and the listener: nothing was refused.
		expect(warn).not.toHaveBeenCalled()
		expect(field.getAttribute("keys")).toBe("Escape Enter")

		const enter = press("Enter")
		field.dispatchEvent(enter)
		const escape = press("Escape")
		field.dispatchEvent(escape)
		expect(enter.defaultPrevented).toBe(true)
		expect(escape.defaultPrevented).toBe(true)
		expect(posted).toEqual([
			{ id: 1, detail: { type: "key", detail: { key: "Enter", shift: false, ctrl: false, meta: false } } },
			{ id: 1, detail: { type: "key", detail: { key: "Escape", shift: false, ctrl: false, meta: false } } }
		])

		// A digit, an arrow (a number field's own step) and Shift+Enter (a bare
		// `Enter` leaves it to the field) stay the field's.
		for (const other of [press("7"), press("ArrowUp"), press("Enter", { shiftKey: true })]) {
			field.dispatchEvent(other)
			expect(other.defaultPrevented).toBe(false)
		}
		expect(posted).toHaveLength(2)
		// The field is still a number field.
		expect(field.type).toBe("number")
	})

	test("a modifier token names the press only while the modifier is held, and the detail says what was", () => {
		const { box, posted, insert } = setup()
		insert(input({ keys: "Control+Enter" }, 2))
		const field = box.querySelector("input")!
		field.dispatchEvent(press("Enter"))
		expect(posted).toEqual([])
		field.dispatchEvent(press("Enter", { ctrlKey: true, shiftKey: true }))
		expect(posted).toEqual([
			{ id: 2, detail: { type: "key", detail: { key: "Enter", shift: true, ctrl: true, meta: false } } }
		])
	})

	test("a keys token the grammar refuses never lands, and is said", () => {
		const { box, insert, warn } = setup()
		insert(input({ keys: "Ctrl+Enter" }, 3))
		expect(box.querySelector("input")!.hasAttribute("keys")).toBe(false)
		expect(warn).toHaveBeenCalledWith(expect.stringMatching(/input keys 'Ctrl\+Enter'/))
	})

	test("an input with no keys, and one outside any remote's territory, are left alone", () => {
		const { box, posted, insert } = setup()
		insert(input({}, 4))
		const bare = press("Enter")
		box.querySelector("input")!.dispatchEvent(bare)
		expect(bare.defaultPrevented).toBe(false)
		const page = document.createElement("input")
		page.setAttribute("keys", "Enter")
		document.body.append(page)
		const heard: Event[] = []
		page.addEventListener("key", (e) => heard.push(e))
		const outside = press("Enter")
		page.dispatchEvent(outside)
		expect(outside.defaultPrevented).toBe(false)
		expect(heard).toEqual([])
		expect(posted).toEqual([])
	})

	test("a trusted press counts as the person's for the box's gate, a synthetic one never; the raised event does not bubble", () => {
		const { box, insert } = setup()
		const vouched = vi.fn()
		registerVoucher(box, vouched)
		insert(input({ keys: "Enter" }, 5))
		const field = box.querySelector("input")!
		const bubbled: Event[] = []
		box.addEventListener("key", (e) => bubbled.push(e))
		// A synthetic press is not a person's.
		field.dispatchEvent(press("Enter"))
		expect(vouched).not.toHaveBeenCalled()
		expect(bubbled).toEqual([])
		// A person's is (the test DOM cannot make one, so it says so).
		const theirs = press("Enter")
		Object.defineProperty(theirs, "isTrusted", { value: true })
		field.dispatchEvent(theirs)
		expect(vouched).toHaveBeenCalledTimes(1)
		// A key the field keeps is no press of the widget's.
		const typed = press("x")
		Object.defineProperty(typed, "isTrusted", { value: true })
		field.dispatchEvent(typed)
		expect(vouched).toHaveBeenCalledTimes(1)
	})
})
