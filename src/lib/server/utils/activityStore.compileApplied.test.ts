/**
 * The cleared hook (`setCompileCleared`) runs for every way a compile
 * activity goes, after the applied hook has settled.
 *
 * A compile review that is applied (`acted`) hands its activity to the
 * `setCompileReviewApplied` hook when it carries `sceneIds`; a discard, a
 * supersede, a lapse, a run still going, or a run with no scenes does not.
 */
import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
	vi
} from "vitest"
import { activityStore } from "./activityStore"

const spy = vi.fn()
const clearedSpy = vi.fn()
beforeEach(() => {
	spy.mockClear()
	clearedSpy.mockClear()
	activityStore.setCompileReviewApplied(spy)
	activityStore.setCompileCleared(clearedSpy)
})
// The setters take a fn and cannot clear it: leave no-ops behind.
afterAll(() => {
	activityStore.setCompileReviewApplied(() => {})
	activityStore.setCompileCleared(() => {})
})

let entryId = 500
const ids: string[] = []
afterEach(() => {
	for (const id of ids.splice(0)) activityStore.remove(id)
})

function start(status: "running" | "review", sceneIds?: number[]) {
	const id = activityStore.startCompile({
		userId: 1,
		historyEntryId: ++entryId,
		historyEntryDate: "Year 1",
		lorebookId: 1,
		lorebookLabel: "Test Lorebook",
		branchId: null,
		moment: null,
		...(sceneIds && { sceneIds })
	})
	ids.push(id)
	if (status === "review")
		activityStore.updateCompile(id, {
			status: "review",
			pendingResult: { content: "draft" }
		})
	return id
}

describe("activityStore compile review applied", () => {
	test("acted on a review with sceneIds calls the hook once with the activity", () => {
		const id = start("review", [7, 8])
		const activity = activityStore.getById(id)
		activityStore.remove(id, "acted")
		expect(spy).toHaveBeenCalledTimes(1)
		expect(spy).toHaveBeenCalledWith(activity)
	})

	test("dismissed, superseded and lapsed do not", () => {
		for (const how of ["dismissed", "superseded", "lapsed"] as const) {
			const id = start("review", [7])
			activityStore.remove(id, how)
		}
		expect(spy).not.toHaveBeenCalled()
	})

	test("acted on a running compile does not", () => {
		activityStore.remove(start("running", [7]), "acted")
		expect(spy).not.toHaveBeenCalled()
	})

	test("acted with no sceneIds does not", () => {
		activityStore.remove(start("review"), "acted")
		expect(spy).not.toHaveBeenCalled()
	})
})

describe("activityStore compile cleared", () => {
	test("runs once, with the activity and how, for each way a compile goes", async () => {
		for (const how of [
			"dismissed",
			"lapsed",
			"superseded",
			"acted"
		] as const) {
			clearedSpy.mockClear()
			const id = start("running")
			const activity = activityStore.getById(id)
			activityStore.remove(id, how)
			await Promise.resolve()
			await Promise.resolve()
			expect(clearedSpy).toHaveBeenCalledTimes(1)
			expect(clearedSpy).toHaveBeenCalledWith(activity, how)
		}
	})

	test("acted with sceneIds in review runs only after the applied hook settles", async () => {
		let open!: () => void
		const gate = new Promise<void>((resolve) => (open = resolve))
		const order: string[] = []
		activityStore.setCompileReviewApplied(async () => {
			await gate
			order.push("applied")
		})
		clearedSpy.mockImplementation(() => {
			order.push("cleared")
		})
		activityStore.remove(start("review", [7, 8]), "acted")
		await new Promise((r) => setTimeout(r, 10))
		expect(clearedSpy).not.toHaveBeenCalled()
		open()
		await new Promise((r) => setTimeout(r, 10))
		expect(clearedSpy).toHaveBeenCalledTimes(1)
		expect(order).toEqual(["applied", "cleared"])
		clearedSpy.mockReset()
	})

	test("runs even when the applied hook rejects", async () => {
		activityStore.setCompileReviewApplied(async () => {
			throw new Error("boom")
		})
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		activityStore.remove(start("review", [7]), "acted")
		await new Promise((r) => setTimeout(r, 10))
		warn.mockRestore()
		expect(clearedSpy).toHaveBeenCalledTimes(1)
	})
})
