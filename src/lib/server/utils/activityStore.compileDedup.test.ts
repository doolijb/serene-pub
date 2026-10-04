/**
 * startCompile()'s dedup previously hand-rolled `this.activities.delete(...)`
 * with no abort, unlike start()/startScene(). That's unsafe to naively fix
 * by calling remove() unconditionally: scenes.ts's scenes:compile handler
 * never wires an AbortController for compile_history_entry activities, so
 * remove()'s internal abort() is a no-op for this activity kind — silently
 * deleting a RUNNING compile would orphan its in-flight LLM call rather
 * than cancel it. startCompile() now rejects a second call while the prior
 * one is still "running", and only supersedes (removes) a prior "review"/
 * "error" activity, where there's no in-flight work left to orphan.
 */
import { afterEach, describe, expect, test } from "vitest"
import { activityStore } from "./activityStore"

function baseParams(
	overrides: Partial<Parameters<typeof activityStore.startCompile>[0]> = {}
) {
	return {
		userId: 1,
		historyEntryId: 100,
		historyEntryDate: "Year 1",
		lorebookId: 1,
		lorebookLabel: "Test Lorebook",
		branchId: null,
		moment: null,
		...overrides
	}
}

const createdIds: string[] = []
afterEach(() => {
	for (const id of createdIds.splice(0)) {
		activityStore.remove(id)
	}
})

describe("activityStore.startCompile — dedup", () => {
	test("rejects a second compile for the same entry while the first is still running", () => {
		const firstId = activityStore.startCompile(baseParams())
		createdIds.push(firstId)

		expect(() => activityStore.startCompile(baseParams())).toThrow(
			/already in progress/i
		)

		// The original activity must still be intact — rejecting the second
		// attempt must not have touched it.
		const stillThere = activityStore.getById(firstId)
		expect(stillThere).toBeDefined()
		expect(stillThere?.status).toBe("running")
	})

	test("supersedes a prior compile once it's in review — no error, old one is gone", () => {
		const firstId = activityStore.startCompile(baseParams())
		activityStore.updateCompile(firstId, {
			status: "review",
			pendingResult: { content: "draft" }
		})

		const secondId = activityStore.startCompile(baseParams())
		createdIds.push(secondId)

		expect(secondId).not.toBe(firstId)
		expect(activityStore.getById(firstId)).toBeUndefined()
		expect(activityStore.getById(secondId)?.status).toBe("running")
	})

	test("supersedes a prior compile that errored out — no error, old one is gone", () => {
		const firstId = activityStore.startCompile(baseParams())
		activityStore.updateCompile(firstId, {
			status: "error",
			errorMessage: "boom"
		})

		const secondId = activityStore.startCompile(baseParams())
		createdIds.push(secondId)

		expect(activityStore.getById(firstId)).toBeUndefined()
		expect(activityStore.getById(secondId)).toBeDefined()
	})

	test("does not conflict across different history entries or different users", () => {
		const idA = activityStore.startCompile(
			baseParams({ historyEntryId: 100 })
		)
		const idB = activityStore.startCompile(
			baseParams({ historyEntryId: 200 })
		)
		const idC = activityStore.startCompile(
			baseParams({ historyEntryId: 100, userId: 2 })
		)
		createdIds.push(idA, idB, idC)

		expect(activityStore.getById(idA)).toBeDefined()
		expect(activityStore.getById(idB)).toBeDefined()
		expect(activityStore.getById(idC)).toBeDefined()
	})

	test("one entry compiled at two readings is two compiles: neither refuses nor replaces the other", () => {
		const onMain = activityStore.startCompile(baseParams())
		const onBranch = activityStore.startCompile(baseParams({ branchId: 7 }))
		const atMoment = activityStore.startCompile(
			baseParams({ branchId: 7, moment: { year: 3 } })
		)
		createdIds.push(onMain, onBranch, atMoment)
		activityStore.updateCompile(onBranch, {
			status: "review",
			pendingResult: { content: "draft" }
		})
		const atMomentAgainId = () =>
			activityStore.startCompile(
				baseParams({
					branchId: 7,
					moment: { year: 3, month: null, day: null }
				})
			)

		// The same line and moment, spelled with its empty parts, is the
		// same reading: still running, so refused.
		expect(atMomentAgainId).toThrow(/already in progress/i)
		expect(activityStore.getById(onMain)?.status).toBe("running")
		expect(activityStore.getById(onBranch)?.status).toBe("review")
		expect(activityStore.getById(atMoment)?.status).toBe("running")
	})
})
