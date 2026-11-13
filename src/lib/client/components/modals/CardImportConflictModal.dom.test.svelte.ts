import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import CardImportConflictModal from "./CardImportConflictModal.svelte"

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
})
const settle = async () => {
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}
const button = (text: string) =>
	[...document.querySelectorAll("button")].find(
		(b) => b.textContent?.trim() === text
	) as HTMLButtonElement | undefined

async function render(suggestedLabel: string | null = "1.2") {
	const onAddVersion = vi.fn()
	const onSaveAsNewCard = vi.fn()
	const onCancel = vi.fn()
	app = mount(CardImportConflictModal, {
		target: document.body,
		props: {
			open: true,
			onOpenChange: () => {},
			existingName: "Bianca",
			currentVersion: { id: 11, number: 2, label: "1.1" },
			suggestedLabel,
			onAddVersion,
			onSaveAsNewCard,
			onCancel
		}
	})
	await settle()
	return { onAddVersion, onSaveAsNewCard, onCancel }
}
const input = () =>
	document.querySelector<HTMLInputElement>("#cardImportVersionLabel")!

describe("CardImportConflictModal", () => {
	test("says what differs and prefills the suggested label", async () => {
		await render()
		expect(document.body.textContent).toContain("Character already exists")
		expect(document.body.textContent?.replace(/\s+/g, " ")).toContain(
			'You already have "Bianca", from this file or an earlier copy of it, and the file differs from its current version, v1.1.'
		)
		expect(input().value).toBe("1.2")
		expect(button("Overwrite existing")).toBeUndefined()
	})

	test("Add as a new version sends the trimmed label", async () => {
		const { onAddVersion } = await render()
		input().value = "  2.0 "
		input().dispatchEvent(new Event("input", { bubbles: true }))
		flushSync()
		button("Add as a new version")!.click()
		await settle()
		expect(onAddVersion).toHaveBeenCalledWith("2.0")
	})

	test("an empty label is sent as null", async () => {
		const { onAddVersion } = await render(null)
		expect(input().value).toBe("")
		button("Add as a new version")!.click()
		await settle()
		expect(onAddVersion).toHaveBeenCalledWith(null)
	})

	test("Save as a new card and Cancel", async () => {
		const { onSaveAsNewCard, onCancel } = await render()
		button("Save as a new card")!.click()
		button("Cancel")!.click()
		expect(onSaveAsNewCard).toHaveBeenCalledTimes(1)
		expect(onCancel).toHaveBeenCalledTimes(1)
	})
})
