/**
 * scene_summarize/compile_history_entry activities now get a real
 * AbortController registered at creation (previously abortControllers only
 * ever held entries for graph_build). updateScene()/updateCompile() delete
 * the controller once a job leaves "running" — without this, a controller
 * for a long-finished job would sit in the map for the rest of the process
 * lifetime if the activity itself lingers un-dismissed in "review"/"error".
 */
import { afterEach, describe, expect, test } from "vitest"
import { activityStore } from "./activityStore"

function sceneParams(overrides: Partial<
	Parameters<typeof activityStore.startScene>[0]
> = {}) {
	return {
		userId: 1,
		sceneId: 100,
		lorebookId: 1,
		lorebookLabel: "Test Lorebook",
		...overrides
	}
}

function compileParams(overrides: Partial<
	Parameters<typeof activityStore.startCompile>[0]
> = {}) {
	return {
		userId: 1,
		historyEntryId: 200,
		historyEntryDate: "Year 1",
		lorebookId: 1,
		lorebookLabel: "Test Lorebook",
		...overrides
	}
}

const createdIds: string[] = []
afterEach(() => {
	for (const id of createdIds.splice(0)) {
		activityStore.remove(id)
	}
})

describe("activityStore — abort controller cleanup", () => {
	test("startScene registers the controller atomically (no separate setAbortController gap)", () => {
		const controller = new AbortController()
		const id = activityStore.startScene(sceneParams(), controller)
		createdIds.push(id)

		activityStore.cancel(id)
		expect(controller.signal.aborted).toBe(true)
		expect(activityStore.getById(id)).toBeUndefined()
	})

	test("a controller is deleted once a scene job leaves 'running' via updateScene", () => {
		const controller = new AbortController()
		const id = activityStore.startScene(sceneParams(), controller)
		createdIds.push(id)

		activityStore.updateScene(id, {
			status: "review",
			pendingResult: {
				content: "done",
				participantCharacters: [],
				mentionedCharacters: [],
				raw: "done"
			}
		})

		// Whitebox: abortControllers is private, read the same way other
		// tests in this codebase reach internal state.
		expect((activityStore as any).abortControllers.has(id)).toBe(false)

		// Cancelling a finished-but-not-dismissed activity must not throw or
		// try to abort a controller that's already gone.
		expect(() => activityStore.cancel(id)).not.toThrow()
	})

	test("a controller is deleted once a compile job leaves 'running' via updateCompile", () => {
		const controller = new AbortController()
		const id = activityStore.startCompile(compileParams(), controller)
		createdIds.push(id)

		activityStore.updateCompile(id, {
			status: "error",
			errorMessage: "boom"
		})

		expect((activityStore as any).abortControllers.has(id)).toBe(false)
	})

	test("startScene's dedup-supersede loop aborts the superseded controller before removing it", () => {
		const firstController = new AbortController()
		const firstId = activityStore.startScene(sceneParams(), firstController)

		const secondController = new AbortController()
		const secondId = activityStore.startScene(
			sceneParams(),
			secondController
		)
		createdIds.push(secondId)

		// The first activity/controller must be gone, and its controller
		// must have actually been aborted (not just dropped), so its
		// in-flight LLM call is stopped rather than orphaned.
		expect(activityStore.getById(firstId)).toBeUndefined()
		expect(firstController.signal.aborted).toBe(true)
		expect(activityStore.getById(secondId)).toBeDefined()
	})

	test("startCompile refuses to supersede a running compile rather than orphaning its controller", () => {
		const controller = new AbortController()
		const id = activityStore.startCompile(compileParams(), controller)
		createdIds.push(id)

		expect(() =>
			activityStore.startCompile(compileParams(), new AbortController())
		).toThrow(/already in progress/i)

		// The original activity and its controller are untouched by the
		// rejected attempt.
		expect(activityStore.getById(id)?.status).toBe("running")
		expect(controller.signal.aborted).toBe(false)
	})
})
