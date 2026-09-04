/**
 * The signal parameter bridges an external AbortController (e.g.
 * activityStore's per-activity controller) to llmQueue's real cancellation
 * mechanism (llmQueue.cancel(id) -> adapter.abort()), so cancelling actually
 * stops a call already in flight, not just prevents a future one from
 * starting. See summarizer/index.ts's runGeneration() for the consumer.
 */
import { describe, expect, test, vi } from "vitest"
import { runQueuedLLMCall } from "./runQueuedLLMCall"
import type { TextGenResult } from "$lib/server/adapters/actions"
import type { FakeTextAdapter } from "$lib/server/connectionAdapters/fakeTextAdapter"
import type { CompiledPrompt } from "$lib/server/connectionAdapters/types"

function macrotask() {
	return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * What the mock reports it sent. Nothing here reads it back, but the action
 * requires it — so the fake states an empty payload rather than omitting a field
 * the real `generateText` promises. The `as any` is on `meta` alone: those
 * fields describe a build that did not happen.
 */
const NO_PAYLOAD: CompiledPrompt = {
	prompt: undefined,
	messages: undefined,
	meta: {} as any
}

function makeMockAdapter(
	overrides: {
		onGenerate?: () => Promise<TextGenResult>
		onAbort?: () => void
	} = {}
) {
	// `satisfies` and not a bare literal: the method name and its return are
	// checked against the real `text->text` action, so a mock that kept the old
	// `generate` name — as this one did until the actions were split — fails to
	// compile here instead of type-checking green and dying at runtime with
	// "adapter.generateText is not a function". See fakeTextAdapter.ts.
	//
	// The lifecycle members are spelled into the target because this is an object
	// LITERAL, where excess-property checking makes a bare `satisfies
	// FakeTextAdapter` reject `preflight` and `abort` outright. A class fake uses
	// `implements FakeTextAdapter` and needs none of this.
	const mock = {
		preflight: async () => {},
		generateText:
			overrides.onGenerate ??
			(async () => ({
				completionResult: "ok",
				compiledPrompt: NO_PAYLOAD,
				isAborted: false
			})),
		abort: () => {
			overrides.onAbort?.()
		}
	} satisfies FakeTextAdapter & {
		preflight(): Promise<void>
		abort(): void
	}

	// The bridge takes a whole BaseConnectionAdapter; this is the three members
	// it actually touches, so the cast is at the boundary rather than hiding the
	// shape check above.
	return mock as any
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
				return {
					completionResult: "partial",
					compiledPrompt: NO_PAYLOAD,
					isAborted: abortCalled
				}
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

		// Let execution actually reach the blocked generateText() call before
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
				return {
					completionResult: "blocker",
					compiledPrompt: NO_PAYLOAD,
					isAborted: false
				}
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
