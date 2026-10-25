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

	/** 🚧 RF fix 3 (owner, 2026-10-23: "only ask if unsaved changes"). */
	test("asks only while something is unsaved: the same section asks when dirty, and not once it is clean again", async () => {
		adminRouter.adopt("/admin/general")
		const ask = vi.fn(async () => false)
		adminRouter.setDiscardPrompt(ask)
		let dirty = true
		const release = adminRouter.addUnsavedEdits(() => dirty)
		expect(await adminRouter.confirmDiscard()).toBe(false)
		expect(await adminRouter.go("/admin/network")).toBe(false)
		expect(ask).toHaveBeenCalledTimes(2)
		dirty = false
		expect(await adminRouter.confirmDiscard()).toBe(true)
		expect(await adminRouter.go("/admin/network")).toBe(true)
		expect(ask).toHaveBeenCalledTimes(2)
		release()
	})
})

describe("🚧 adminRouter: the question's Save (RF fix 2, item 5)", () => {
	test("a section that registers its Save can be saved from the question; one that does not, cannot", async () => {
		let dirty = true
		const save = vi.fn(async () => {
			dirty = false
			return true
		})
		const release = adminRouter.addUnsavedEdits(() => dirty, save)
		expect(adminRouter.canSaveUnsaved).toBe(true)
		expect(await adminRouter.saveUnsaved()).toBe(true)
		expect(save).toHaveBeenCalledTimes(1)
		expect(adminRouter.hasUnsavedEdits).toBe(false)
		release()
		const other = adminRouter.addUnsavedEdits(() => true)
		expect(adminRouter.canSaveUnsaved).toBe(false)
		expect(await adminRouter.saveUnsaved()).toBe(false)
		other()
	})

	test("a Save that does not land keeps the section's edits, and the move waits on the answer", async () => {
		adminRouter.adopt("/admin/rulesets/x")
		const release = adminRouter.addUnsavedEdits(() => true, async () => false)
		expect(await adminRouter.saveUnsaved()).toBe(false)
		// The question answered Stay (what a failed Save resolves to): the section stays.
		adminRouter.setDiscardPrompt(async () => false)
		expect(await adminRouter.go("/admin/rulesets")).toBe(false)
		expect(adminRouter.path).toBe("/admin/rulesets/x")
		release()
	})
})
