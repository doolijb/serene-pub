import { describe, expect, test, vi } from "vitest"

vi.mock("$app/navigation", () => ({
	goto: vi.fn(),
	pushState: vi.fn(),
	replaceState: vi.fn()
}))

const { adminRouter } = await import("./adminRouter.svelte")

describe("adminRouter landing targets", () => {
	test("an address's fragment asks to land, and never becomes the address", () => {
		adminRouter.adopt("/admin/general#accounts")
		expect(adminRouter.href).toBe("/admin/general")
		expect(adminRouter.land.target).toBe("accounts")
	})

	test("the same section, another field, still lands", async () => {
		adminRouter.adopt("/admin/general")
		const before = adminRouter.land.seq
		await adminRouter.go("/admin/general#scripts-heading")
		expect(adminRouter.path).toBe("/admin/general")
		expect(adminRouter.land).toEqual({ target: "scripts-heading", seq: before + 1 })
	})

	test("moving section with a fragment lands on the new section", async () => {
		await adminRouter.go("/admin/data#backup-policy-heading")
		expect(adminRouter.path).toBe("/admin/data")
		expect(adminRouter.land.target).toBe("backup-policy-heading")
	})
})

describe("adminRouter unsaved edits", () => {
	test("a clean section moves without asking", async () => {
		adminRouter.adopt("/admin/general")
		const ask = vi.fn(async () => false)
		adminRouter.setDiscardPrompt(ask)
		const release = adminRouter.addUnsavedEdits(() => false)
		expect(await adminRouter.go("/admin/network")).toBe(true)
		expect(ask).not.toHaveBeenCalled()
		expect(adminRouter.path).toBe("/admin/network")
		release()
	})

	test("unsaved edits ask; keeping them stays on the section", async () => {
		adminRouter.adopt("/admin/general")
		adminRouter.setDiscardPrompt(async () => false)
		const release = adminRouter.addUnsavedEdits(() => true)
		expect(await adminRouter.go("/admin/network")).toBe(false)
		expect(adminRouter.path).toBe("/admin/general")
		release()
	})

	test("unsaved edits ask; discarding moves", async () => {
		adminRouter.adopt("/admin/general")
		adminRouter.setDiscardPrompt(async () => true)
		const release = adminRouter.addUnsavedEdits(() => true)
		expect(await adminRouter.go("/admin/network")).toBe(true)
		expect(adminRouter.path).toBe("/admin/network")
		release()
	})

	test("a new query on the same section never asks", async () => {
		adminRouter.adopt("/admin/pipelines")
		const ask = vi.fn(async () => false)
		adminRouter.setDiscardPrompt(ask)
		const release = adminRouter.addUnsavedEdits(() => true)
		expect(await adminRouter.go("/admin/pipelines?genre=chat")).toBe(true)
		expect(ask).not.toHaveBeenCalled()
		release()
	})

	test("confirmDiscard answers true when nothing is unsaved", async () => {
		adminRouter.setDiscardPrompt(async () => false)
		expect(await adminRouter.confirmDiscard()).toBe(true)
	})
})
