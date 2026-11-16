/**
 * The bulk Beginning / Decay dialog: its fieldset per mode, when Apply is
 * enabled, the patch it hands back, titles, Cancel and the reset on reopen.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))

import BulkTimeDialog from "./BulkTimeDialog.svelte"
import { openBookTime } from "./time/bookTime.svelte"

let app: ReturnType<typeof mount> | null = null
beforeEach(() => {
	openBookTime.open(7)
})
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
	openBookTime.open(null)
})

async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}

async function draw(mode: "beginning" | "decay", count = 3) {
	const onApply = vi.fn()
	const onClose = vi.fn()
	const props = $state({ open: true })
	app = mount(BulkTimeDialog, {
		target: document.body,
		props: {
			get open() {
				return props.open
			},
			mode,
			count,
			onApply,
			onClose
		}
	})
	await settle()
	return { onApply, onClose, props }
}

const q = <T extends Element>(sel: string) =>
	document.body.querySelector<T>(sel)
const radio = (value: string) =>
	q<HTMLInputElement>(`input[type="radio"][value="${value}"]`)!
const apply = () =>
	[
		...document.body.querySelectorAll<HTMLButtonElement>("footer button")
	].pop()!
const cancel = () =>
	[...document.body.querySelectorAll<HTMLButtonElement>("footer button")][0]
const title = () => q('[data-part="title"]')?.textContent?.trim()

async function type(selector: string, value: string) {
	const el = q<HTMLInputElement>(selector)!
	el.value = value
	el.dispatchEvent(new Event("input", { bubbles: true }))
	await settle()
}
async function choose(value: string) {
	radio(value).click()
	await settle()
}

describe("beginning", () => {
	test("opens on Perpetual and Apply sends all three null", async () => {
		const { onApply, onClose } = await draw("beginning")
		expect(radio("perpetual").checked).toBe(true)
		expect(q("[data-lore-decay]")).toBeNull()
		apply().click()
		await settle()
		expect(onApply).toHaveBeenCalledWith({
			year: null,
			month: null,
			day: null
		})
		expect(onClose).toHaveBeenCalled()
	})

	test("Began at with no year disables Apply", async () => {
		await draw("beginning")
		await choose("beganAt")
		expect(apply().disabled).toBe(true)
	})

	test("year 5 month 3 sends the numbers, day null", async () => {
		const { onApply } = await draw("beginning")
		await choose("beganAt")
		await type('input[placeholder="2055"]', "5")
		await type('input[placeholder="3"]', "3")
		expect(apply().disabled).toBe(false)
		apply().click()
		await settle()
		expect(onApply).toHaveBeenCalledWith({ year: 5, month: 3, day: null })
	})

	test("a day without a month disables Apply", async () => {
		await draw("beginning")
		await choose("beganAt")
		await type('input[placeholder="2055"]', "5")
		await type('input[placeholder="1"]', "2")
		expect(apply().disabled).toBe(true)
	})
})

describe("decay", () => {
	test("opens on Fact and Apply sends 0", async () => {
		const { onApply } = await draw("decay")
		expect(radio("fact").checked).toBe(true)
		expect(q("[data-lore-beginning]")).toBeNull()
		apply().click()
		await settle()
		expect(onApply).toHaveBeenCalledWith({ decayRate: 0 })
	})

	test("Living starts at 0.25 and the range value is sent", async () => {
		const { onApply } = await draw("decay")
		await choose("living")
		const range = q<HTMLInputElement>('input[aria-label="Decay rate"]')!
		expect(Number(range.value)).toBe(0.25)
		await type('input[aria-label="Decay rate"]', "0.6")
		expect(q("[data-lore-decay-rate]")!.textContent!.trim()).toBe("0.6")
		apply().click()
		await settle()
		expect(onApply).toHaveBeenCalledWith({ decayRate: 0.6 })
	})
})

describe("words", () => {
	test("titles and Apply label for 3 entries", async () => {
		await draw("beginning", 3)
		expect(title()).toBe("Beginning for 3 entries")
		expect(apply().textContent!.trim()).toBe("Apply to 3 entries")
	})

	test("titles and Apply label for 1 entry", async () => {
		await draw("decay", 1)
		expect(title()).toBe("Decay for 1 entry")
		expect(apply().textContent!.trim()).toBe("Apply to 1 entry")
	})
})

describe("Cancel and reopen", () => {
	test("Cancel closes and applies nothing", async () => {
		const { onApply, onClose } = await draw("beginning")
		cancel().click()
		await settle()
		expect(onClose).toHaveBeenCalled()
		expect(onApply).not.toHaveBeenCalled()
	})

	test("reopening resets to Perpetual", async () => {
		const { props } = await draw("beginning")
		await choose("beganAt")
		await type('input[placeholder="2055"]', "5")
		props.open = false
		await settle()
		props.open = true
		await settle()
		expect(radio("perpetual").checked).toBe(true)
		expect(q('input[placeholder="2055"]')).toBeNull()
	})

	test("reopening resets to Fact", async () => {
		const { props } = await draw("decay")
		await choose("living")
		props.open = false
		await settle()
		props.open = true
		await settle()
		expect(radio("fact").checked).toBe(true)
		expect(q('input[aria-label="Decay rate"]')).toBeNull()
	})
})
