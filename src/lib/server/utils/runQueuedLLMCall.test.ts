/**
 * The signal parameter bridges an external AbortController (e.g.
 * activityStore's per-activity controller) to llmQueue's real cancellation
 * mechanism (llmQueue.cancel(id) -> adapter.abort()), so cancelling actually
 * stops a call already in flight, not just prevents a future one from
 * starting. See summarizer/index.ts's runGeneration() for the consumer.
 */
import { describe, expect, test, vi } from "vitest"
import { runQueuedLLMCall } from "./runQueuedLLMCall"

function macrotask() {
	return new Promise((resolve) => setTimeout(resolve, 0))
}

function makeMockAdapter(
	overrides: {
		onGenerate?: () => Promise<{
			completionResult: string
			isAborted: boolean
		}>
		onAbort?: () => void
	} = {}
) {
	return {
		preflight: async () => {},
		generate:
			overrides.onGenerate ??
			(async () => ({ completionResult: "ok", isAborted: false })),
		abort: () => {
			overrides.onAbort?.()
		}
	} as any
}

describe("runQueuedLLMCall — signal bridge", () => {
	test("an already-aborted signal short-circuits without ever calling the adapter", async () => {
		const generate = vi.fn()
		const adapter = makeMockAdapter({ onGenerate: generate })
		const controller = new AbortController()
		controller.abort()

		const result = await runQueuedLLMCall({
			adapter,
			taskType: "session",
			connectionName: "test",
			samplingName: "test",
			signal: controller.signal
		})

		expect(result).toEqual({ text: "", isAborted: true })
		expect(generate).not.toHaveBeenCalled()
	})

	test("aborting the signal while a call is actually in flight calls adapter.abort() and the run settles", async () => {
		let releaseGenerate!: () => void
		const generateGate = new Promise<void>((resolve) => {
			releaseGenerate = resolve
		})
		let abortCalled = false
		const adapter = makeMockAdapter({
			onGenerate: async () => {
				await generateGate
				return { completionResult: "partial", isAborted: abortCalled }
			},
			onAbort: () => {
				abortCalled = true
				// Simulate the adapter's own streaming loop noticing
				// isAborting and unwinding — every real adapter does this.
				releaseGenerate()
			}
		})
		const controller = new AbortController()

		const callPromise = runQueuedLLMCall({
			adapter,
			taskType: "session",
			connectionName: "test",
			samplingName: "test",
			signal: controller.signal
		})

		// Let execution actually reach the blocked generate() call before
		// aborting — otherwise this would only exercise the pre-check.
		await macrotask()

		controller.abort()

		const result = await callPromise
		expect(abortCalled).toBe(true)
		expect(result.isAborted).toBe(true)
	})

	test("cancelling a queued-but-not-yet-running call rejects rather than hanging", async () => {
		// Occupy the lane with a blocker so the next enqueue() genuinely
		// queues instead of starting immediately.
		let releaseBlocker!: () => void
		const blockerGate = new Promise<void>((resolve) => {
			releaseBlocker = resolve
		})
		const blockerAdapter = makeMockAdapter({
			onGenerate: async () => {
				await blockerGate
				return { completionResult: "blocker", isAborted: false }
			}
		})
		const blockerPromise = runQueuedLLMCall({
			adapter: blockerAdapter,
			taskType: "session",
			connectionName: "test",
			samplingName: "test"
		})
		await macrotask() // let the blocker actually start running

		const queuedAdapter = makeMockAdapter()
		const controller = new AbortController()
		const queuedPromise = runQueuedLLMCall({
			adapter: queuedAdapter,
			taskType: "session",
			connectionName: "test",
			samplingName: "test",
			signal: controller.signal
		})

		controller.abort() // still queued behind the blocker — never started

		await expect(queuedPromise).rejects.toThrow(/cancelled/i)

		releaseBlocker()
		await blockerPromise
	})
})
