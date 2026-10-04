/**
 * runGeneration() (the single choke-point every LLM call in this module
 * funnels through) now throws immediately when a result comes back
 * isAborted, instead of returning truncated text as if it were a normal
 * successful generation. Without this, compileScenesForEntry() would
 * surface a cancelled synthesis's truncated output as the history entry's
 * content — including a truncated onProgress update visible to the client.
 *
 * The adapter itself is mocked out entirely (getConnectionAdapter ->
 * a minimal class) so this exercises the module's own cancellation
 * handling, not any real adapter's streaming/network behavior — that's
 * covered by runQueuedLLMCall.test.ts (the bridge) and the per-adapter
 * test files.
 */
import { beforeEach, describe, expect, test, vi } from "vitest"
import type { FakeTextAdapter } from "$lib/server/connectionAdapters/fakeTextAdapter"

const mockGenerate = vi.fn()
const mockAbort = vi.fn()

vi.mock("../getConnectionAdapter", () => ({
	getConnectionAdapter: vi.fn(async () => ({
		// `implements` and not a bare method: it is what makes this fake fail to
		// compile if it ever drifts from the real `text->text` action — see
		// fakeTextAdapter.ts for why `implements AdapterActions` would not.
		Adapter: class implements FakeTextAdapter {
			/** The composed stop list, handed over at construction. */
			stops: any
			withStops(s: any) {
				this.stops = s
				return this
			}
			constructor(_args: any) {}
			async preflight() {}
			async generateText() {
				return mockGenerate()
			}
			abort() {
				mockAbort()
			}
		},
		listModels: async () => [],
		testConnection: async () => ({ success: true }),
		connectionDefaults: {},
		samplingKeyMap: {}
	}))
}))

const { compileScenesForEntry } = await import("./index")

function macrotask() {
	return new Promise((resolve) => setTimeout(resolve, 0))
}

function baseConnection(): any {
	return { name: "test-conn", type: "ollama" }
}
function baseSampling(): any {
	return { name: "test-sampling" }
}

describe("compileScenesForEntry — mid-flight cancellation", () => {
	beforeEach(() => {
		mockGenerate.mockReset()
		mockAbort.mockReset()
	})

	test("a mid-flight abort throws rather than returning truncated text, and no truncated content is ever surfaced via onProgress", async () => {
		let releaseGenerate!: () => void
		const gate = new Promise<void>((resolve) => {
			releaseGenerate = resolve
		})
		let abortedFlag = false

		mockGenerate.mockImplementation(async () => {
			await gate
			return {
				completionResult: "TRUNCATED_DRAFT_SHOULD_NEVER_SURFACE",
				isAborted: abortedFlag,
				reasoningContent: undefined
			}
		})
		mockAbort.mockImplementation(() => {
			abortedFlag = true
			// Simulate the adapter's own streaming loop noticing isAborting
			// and unwinding — every real adapter does this.
			releaseGenerate()
		})

		const controller = new AbortController()
		const onProgress = vi.fn()

		// Two summaries, so the synthesis call actually runs (one is returned
		// as-is with no call at all).
		const resultPromise = compileScenesForEntry({
			scenes: [
				{ name: "One", summary: "The first scene." },
				{ name: "Two", summary: "The second scene." }
			],
			connection: baseConnection(),
			sampling: baseSampling(),
			onProgress,
			signal: controller.signal
		})

		// Let execution actually reach the blocked generateText() call before
		// aborting.
		await macrotask()
		controller.abort()

		await expect(resultPromise).rejects.toThrow()
		expect(mockAbort).toHaveBeenCalled()

		// The abort lands on the synthesis call — with runGeneration throwing on
		// isAborted, no progress frame ever carries the truncated text. (The
		// opening "synthesizing" frame, sent before the call, carries none.)
		expect(onProgress).toHaveBeenCalledTimes(1)
		for (const [frame] of onProgress.mock.calls) {
			expect(frame.partial?.content).toBeUndefined()
			expect(frame.partial?.raw).toBeUndefined()
		}
	})

	test("an already-aborted signal throws before invoking the adapter at all (fast path)", async () => {
		const controller = new AbortController()
		controller.abort()

		const resultPromise = compileScenesForEntry({
			scenes: [
				{ name: "One", summary: "The first scene." },
				{ name: "Two", summary: "The second scene." }
			],
			connection: baseConnection(),
			sampling: baseSampling(),
			signal: controller.signal
		})

		await expect(resultPromise).rejects.toThrow()
		expect(mockGenerate).not.toHaveBeenCalled()
	})
})
