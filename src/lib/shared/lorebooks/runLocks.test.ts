import { describe, expect, it } from "vitest"
import {
	entryLockedAgainstRuns,
	RUN_LOCK_SENTENCES,
	sceneLockedAgainstRuns
} from "./runLocks"

describe("run locks", () => {
	it("reads the entry lock", () => {
		expect(entryLockedAgainstRuns({ entryLock: true })).toBe(true)
		expect(entryLockedAgainstRuns({ entryLock: false })).toBe(false)
		expect(entryLockedAgainstRuns({ entryLock: null })).toBe(false)
		expect(entryLockedAgainstRuns({})).toBe(false)
	})
	it("reads the scene lock", () => {
		expect(sceneLockedAgainstRuns({ sceneLock: true })).toBe(true)
		expect(sceneLockedAgainstRuns({ sceneLock: false })).toBe(false)
		expect(sceneLockedAgainstRuns({ sceneLock: null })).toBe(false)
		expect(sceneLockedAgainstRuns({})).toBe(false)
	})
	it("words the sentences", () => {
		expect(RUN_LOCK_SENTENCES.entry("Mara")).toBe(
			"Mara is locked, so this run left it as it is."
		)
		expect(RUN_LOCK_SENTENCES.scene("Scene 1")).toBe(
			"Scene 1 is locked, so this run left it as it is."
		)
		expect(RUN_LOCK_SENTENCES.held("Mara")).toBe(
			"Mara is locked, so this change waits here until you Apply or Take back."
		)
	})
})
