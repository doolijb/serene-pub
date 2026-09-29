/**
 * `sp-composer-field` in a DOM: which presses its `keys` keep from the field
 * (a bare key whatever is held, `Control+Enter` only while Control is), what
 * the raised `key` says was held, and `autofocus` placing the caret. An
 * edit's Ctrl+Enter-to-save and Esc-to-cancel ride this in a remote, where
 * the widget hears no keydown of its own.
 */
import { afterEach, beforeAll, describe, expect, test } from "vitest"
import { flushSync } from "svelte"
import { makeSpElementClass } from "./spElement.svelte"
import SpComposerField from "./SpComposerField.svelte"

const tick = () => new Promise((r) => setTimeout(r, 0))

beforeAll(() => {
	customElements.define("sp-composer-field", makeSpElementClass("sp-composer-field", { component: SpComposerField }))
})
afterEach(() => {
	document.body.replaceChildren()
})

type KeyDetail = { key: string; shift: boolean; ctrl: boolean; meta: boolean }

async function field(attrs: Record<string, string>) {
	const el = document.createElement("sp-composer-field")
	for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
	const keys: KeyDetail[] = []
	const submits: unknown[] = []
	el.addEventListener("key", (e) => keys.push((e as CustomEvent<KeyDetail>).detail))
	el.addEventListener("submit", (e: Event) => submits.push((e as CustomEvent).detail))
	document.body.append(el)
	flushSync()
	await tick()
	const area = el.querySelector("textarea")!
	/** Press a key in the field; true when the field kept it (its default prevented). */
	const press = (key: string, held: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {}) => {
		const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...held })
		area.dispatchEvent(e)
		return e.defaultPrevented
	}
	return { el, area, keys, submits, press }
}

const detail = (key: string, held: Partial<Omit<KeyDetail, "key">> = {}): KeyDetail => ({
	key,
	shift: false,
	ctrl: false,
	meta: false,
	...held
})

describe("sp-composer-field keys", () => {
	test("a bare key is kept whatever is held, and the detail says what was; Shift+Enter stays the field's", async () => {
		const f = await field({ keys: "Escape Enter", "submit-on": "none" })
		expect(f.press("Escape")).toBe(true)
		expect(f.press("Enter", { ctrlKey: true })).toBe(true)
		expect(f.press("Enter", { shiftKey: true })).toBe(false)
		expect(f.press("a")).toBe(false)
		expect(f.keys).toEqual([detail("Escape"), detail("Enter", { ctrl: true })])
	})

	test("a modified key is kept only while its modifier is held: plain Enter stays a newline", async () => {
		// The edit field's: Ctrl/Cmd+Enter saves, Enter and Shift+Enter write a newline.
		const f = await field({ keys: "Escape Control+Enter Meta+Enter", "submit-on": "none" })
		expect(f.press("Enter")).toBe(false)
		expect(f.press("Enter", { shiftKey: true })).toBe(false)
		expect(f.press("Enter", { ctrlKey: true })).toBe(true)
		expect(f.press("Enter", { metaKey: true })).toBe(true)
		expect(f.press("Enter", { ctrlKey: true, shiftKey: true })).toBe(true)
		expect(f.press("Escape")).toBe(true)
		expect(f.keys).toEqual([
			detail("Enter", { ctrl: true }),
			detail("Enter", { meta: true }),
			detail("Enter", { ctrl: true, shift: true }),
			detail("Escape")
		])
		expect(f.submits).toEqual([])
	})

	test("the send key still submits when it is not kept", async () => {
		const f = await field({ keys: "Control+Enter" })
		expect(f.press("Enter")).toBe(true)
		expect(f.submits).toEqual([{ value: "" }])
		expect(f.keys).toEqual([])
	})
})

describe("sp-composer-field autofocus", () => {
	test("the field takes the caret as it lands, at the end of what it holds", async () => {
		const f = await field({ value: "Hello there", autofocus: "" })
		await tick()
		expect(document.activeElement).toBe(f.area)
		expect(f.area.value).toBe("Hello there")
		expect(f.area.selectionStart).toBe("Hello there".length)
	})

	test("without it the field waits to be chosen", async () => {
		const f = await field({ value: "Hello there" })
		await tick()
		expect(document.activeElement).not.toBe(f.area)
	})
})
