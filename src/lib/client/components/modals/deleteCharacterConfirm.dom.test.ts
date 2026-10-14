/**
 * Less-confusing plan F2 (2026-10-11): the character delete dialog names the
 * character and says what goes with it, and what stays. The delete is soft:
 * the card leaves the Characters list with its gallery and sprites, while
 * sessions that already have it keep it in their cast.
 */
import { afterEach, describe, expect, test } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"
import DeleteCharacterConfirm from "./DeleteCharacterConfirm.svelte"

let apps: ReturnType<typeof mount>[] = []
afterEach(() => {
	for (const app of apps) unmount(app)
	apps = []
	document.body.innerHTML = ""
})

async function openDialog(
	name: string | undefined,
	onConfirm: () => void = () => {},
	onCancel: () => void = () => {}
) {
	const host = document.createElement("div")
	document.body.append(host)
	apps.push(
		mount(DeleteCharacterConfirm, {
			target: host,
			props: { open: true, name, onConfirm, onCancel }
		})
	)
	flushSync()
	await tick()
}

const button = (label: string) =>
	[...document.querySelectorAll("button")].find(
		(b) => b.textContent?.trim() === label
	)
const what = () =>
	document
		.querySelector("[data-delete-character-what]")
		?.textContent?.replace(/\s+/g, " ")
		.trim()

describe("DeleteCharacterConfirm", () => {
	test("names the character, what goes, and what stays", async () => {
		await openDialog("Brix")
		expect(document.querySelector("[role=alertdialog]")).not.toBeNull()
		expect(document.body.textContent).toContain("Delete Brix?")
		expect(what()).toBe(
			"Brix leaves your characters for good, along with the gallery and sprites on the card. Sessions that already have Brix keep Brix in their cast, with every message."
		)
	})

	test("without a name it still says what goes", async () => {
		await openDialog(undefined)
		expect(document.body.textContent).toContain("Delete this character?")
		expect(what()).toContain("the gallery and sprites on the card")
	})

	test("Delete confirms and Cancel cancels", async () => {
		const calls: string[] = []
		await openDialog(
			"Brix",
			() => calls.push("confirm"),
			() => calls.push("cancel")
		)
		button("Delete")!.click()
		button("Cancel")!.click()
		expect(calls).toEqual(["confirm", "cancel"])
	})
})
