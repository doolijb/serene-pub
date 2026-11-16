/**
 * The version date dialog: prefill, bounds, the taken-date modes, and that
 * Enter confirms only when the confirm is on.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))

import VersionDateDialog from "./VersionDateDialog.svelte"
import {
	TAKEN_REDATE_SENTENCE,
	TAKEN_SAVE_SENTENCE,
	type EntryVersion
} from "./entryVersions"

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
})

const NO_BOUNDS = { after: null, before: null, beginning: null }
const someVersion = { key: "row:1" } as EntryVersion

async function draw(over: Record<string, unknown> = {}) {
	const onConfirm = vi.fn()
	const onCancel = vi.fn()
	const props = $state({
		open: true,
		title: "Add a version",
		description: "One sentence.",
		initial: null,
		bounds: NO_BOUNDS,
		taken: () => null,
		takenMode: "merge",
		confirmLabel: "Add",
		onConfirm,
		onCancel,
		...over
	})
	app = mount(VersionDateDialog, {
		target: document.body,
		props: props as never
	})
	await settle()
	return { onConfirm, onCancel, props }
}
async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}
const input = (label: string) =>
	[...document.body.querySelectorAll<HTMLInputElement>("input")].find((i) =>
		document.body
			.querySelector(`label[for="${i.id}"]`)
			?.textContent?.trim()
			.startsWith(label)
	)!
async function type(label: string, value: string) {
	const el = input(label)
	el.value = value
	el.dispatchEvent(new Event("input", { bubbles: true }))
	await settle()
}
const button = (name: string) =>
	[...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
		(b) => b.textContent?.trim() === name
	)!
const text = () => document.body.textContent?.replace(/\s+/g, " ").trim() ?? ""

describe("version date dialog", () => {
	test("header, prefill and the confirm", async () => {
		const { onConfirm } = await draw({
			initial: { year: 12, month: 3, day: 4 }
		})
		expect(text()).toContain("Add a version")
		expect(text()).toContain("One sentence.")
		expect(
			document.body.querySelector('button[aria-label="Close"]')
		).not.toBeNull()
		expect(input("Year").value).toBe("12")
		expect(input("Month").value).toBe("3")
		expect(input("Day").value).toBe("4")
		button("Add").click()
		expect(onConfirm).toHaveBeenCalledWith({ year: 12, month: 3, day: 4 })
	})

	test("the confirm is off until a whole year; a day needs a month", async () => {
		const { onConfirm } = await draw()
		expect(button("Add").disabled).toBe(true)
		expect(input("Day").disabled).toBe(true)
		expect(input("Day").title).toContain("A day needs a month")
		await type("Year", "7")
		expect(button("Add").disabled).toBe(false)
		await type("Month", "2")
		expect(input("Day").disabled).toBe(false)
		input("Year").dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
		)
		expect(onConfirm).toHaveBeenCalledWith({ year: 7, month: 2, day: null })
	})

	test("a date outside the bounds says so and turns the confirm off", async () => {
		const { onConfirm } = await draw({
			bounds: {
				after: { year: 5, month: null, day: null },
				before: { year: 9, month: null, day: null },
				beginning: null
			}
		})
		await type("Year", "12")
		expect(text()).toContain("Pick a date after")
		expect(button("Add").disabled).toBe(true)
		input("Year").dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
		)
		expect(onConfirm).not.toHaveBeenCalled()
		await type("Year", "7")
		expect(button("Add").disabled).toBe(false)
	})

	test("a taken date merges or is refused", async () => {
		const merge = await draw({ taken: () => someVersion })
		await type("Year", "3")
		expect(text()).toContain(
			TAKEN_SAVE_SENTENCE({ year: 3, month: null, day: null })
		)
		expect(button("Add").disabled).toBe(false)
		unmount(app!)
		document.body.innerHTML = ""
		void merge
		await draw({
			taken: () => someVersion,
			takenMode: "refuse",
			confirmLabel: "Move"
		})
		await type("Year", "3")
		expect(text()).toContain(
			TAKEN_REDATE_SENTENCE({ year: 3, month: null, day: null })
		)
		expect(button("Move").disabled).toBe(true)
	})

	test("busy turns the confirm off; Cancel cancels", async () => {
		const { onCancel } = await draw({
			initial: { year: 1, month: null, day: null },
			busy: true
		})
		expect(button("Add").disabled).toBe(true)
		button("Cancel").click()
		expect(onCancel).toHaveBeenCalled()
	})
})
