/** 🚧 The page's clock-move-back dialog: opens, answers, is gone. */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, tick } from "svelte"

vi.mock("$app/navigation", () => ({ goto: vi.fn() }))

import { askClockMoveBack } from "./clockMoveBackConfirm"

const notice = {
	mode: "branch" as const,
	count: 2,
	latestLabel: "Year 412",
	toLabel: "Year 400",
	sentence: "This passes 2 dated writes."
}

afterEach(() => {
	document.body.innerHTML = ""
})

const dialog = () => document.querySelector("[data-action-confirm]")
const press = (label: string) =>
	[...document.querySelectorAll("button")]
		.find((b) => b.textContent?.trim() === label)!
		.click()
async function settle() {
	await tick()
	flushSync()
	await tick()
}

describe("askClockMoveBack", () => {
	test("opens with the question and the sentence; Confirm resolves true and the dialog is gone", async () => {
		const answer = askClockMoveBack(notice)
		await settle()
		expect(dialog()?.textContent).toContain("Move the story back?")
		expect(dialog()?.textContent).toContain(
			"This passes 2 dated writes. On revision: Branch."
		)
		press("Branch and move back")
		await expect(answer).resolves.toBe(true)
		await settle()
		expect(dialog()).toBeNull()
	})

	test("Cancel resolves false", async () => {
		const answer = askClockMoveBack(notice)
		await settle()
		press("Cancel")
		await expect(answer).resolves.toBe(false)
		await settle()
		expect(dialog()).toBeNull()
	})

	test("a second ask answers the first false", async () => {
		const first = askClockMoveBack(notice)
		await settle()
		const second = askClockMoveBack({ ...notice, mode: "overwrite" })
		await expect(first).resolves.toBe(false)
		await settle()
		press("Move back")
		await expect(second).resolves.toBe(true)
	})
})
