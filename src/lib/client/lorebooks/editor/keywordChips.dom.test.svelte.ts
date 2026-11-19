/**
 * The keyword chips write a LIST, one element per chip (finding #146), and a
 * comma typed into a regex key stays in that key.
 */
import { afterEach, describe, expect, test } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"
import KeywordChips from "./KeywordChips.svelte"
import KeywordChipsFixture from "./KeywordChipsFixture.svelte"

const REGEX_KEY = String.raw`\w{2,4}`

describe("KeywordChips", () => {
	let app: ReturnType<typeof mount> | null = null
	let host: HTMLElement

	afterEach(() => {
		if (app) unmount(app)
		app = null
		document.body.innerHTML = ""
	})

	function render(initial: { keys: string[]; regex: boolean }) {
		const props = $state({ ...initial, idPrefix: "t" })
		host = document.createElement("div")
		document.body.append(host)
		app = mount(KeywordChips, { target: host, props })
		flushSync()
		return props
	}

	async function settle() {
		flushSync()
		await tick()
		flushSync()
	}

	const chips = () =>
		[...host.querySelectorAll(".chip > span")].map((s) => s.textContent)

	async function openBox() {
		const add = [...host.querySelectorAll("button")].find(
			(b) => b.textContent?.trim() === "Add…"
		)!
		add.click()
		await settle()
		return host.querySelector<HTMLInputElement>("#tKeys")!
	}

	async function type(input: HTMLInputElement, text: string) {
		input.value = text
		input.dispatchEvent(new Event("input", { bubbles: true }))
		await settle()
	}

	function press(input: HTMLInputElement, key: string) {
		const event = new KeyboardEvent("keydown", {
			key,
			bubbles: true,
			cancelable: true
		})
		input.dispatchEvent(event)
		flushSync()
		return event.defaultPrevented
	}

	test("a key holding a comma is one chip", () => {
		render({ keys: [REGEX_KEY, "Smith, John"], regex: true })
		expect(chips()).toEqual([REGEX_KEY, "Smith, John"])
	})

	test("in a regex entry a comma stays in the key; Enter adds it", async () => {
		const props = render({ keys: [], regex: true })
		const input = await openBox()
		await type(input, String.raw`\w{2`)
		expect(press(input, ",")).toBe(false)
		expect(props.keys).toEqual([])

		await type(input, REGEX_KEY)
		expect(press(input, "Enter")).toBe(true)
		await settle()
		expect(props.keys).toEqual([REGEX_KEY])
	})

	test("in a literal entry a comma ends the key", async () => {
		const props = render({ keys: ["umber"], regex: false })
		const input = await openBox()
		await type(input, "tavern")
		expect(press(input, ",")).toBe(true)
		await settle()
		expect(props.keys).toEqual(["umber", "tavern"])
	})

	test("removing a chip removes that element only", async () => {
		const props = render({ keys: [REGEX_KEY, "b"], regex: true })
		;[...host.querySelectorAll("button")]
			.find((b) => b.getAttribute("aria-label") === `Remove ${REGEX_KEY}`)!
			.click()
		await settle()
		expect(props.keys).toEqual(["b"])
	})
})

describe("KeywordChips in a read-only book", () => {
	let app: ReturnType<typeof mount> | null = null
	afterEach(() => {
		if (app) unmount(app)
		app = null
		document.body.innerHTML = ""
	})

	function mountIn(bookAccess: "owner" | "shared") {
		const host = document.createElement("div")
		document.body.append(host)
		app = mount(KeywordChipsFixture, {
			target: host,
			props: { bookAccess, keys: ["umber", "ochre"] }
		})
		flushSync()
		return host
	}

	test("the keywords read as plain chips: no remove button, no Add", () => {
		const host = mountIn("shared")
		expect(host.textContent).toContain("umber")
		expect(host.textContent).toContain("ochre")
		expect(host.querySelectorAll("button")).toHaveLength(0)
	})

	test("an editable book keeps them", () => {
		const host = mountIn("owner")
		expect(host.querySelectorAll('button[aria-label^="Remove"]')).toHaveLength(2)
		expect(host.textContent).toContain("Add…")
	})
})
