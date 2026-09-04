/**
 * runGeneration() (the single choke-point every LLM call in this module
 * funnels through) now throws immediately when a result comes back
 * isAborted, instead of returning truncated text as if it were a normal
 * successful generation. Without this, generateSummary()'s batch loop would
 * process/surface a cancelled batch's partial output for one more iteration
 * before the *next* call's pre-check finally caught it — including
 * emitting a truncated onProgress update visible to the client.
 *
 * The adapter itself is mocked out entirely (getConnectionAdapter ->
 * a minimal class) so this exercises generateSummary()'s own cancellation
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

const { generateSummary } = await import("./index")

function macrotask() {
	return new Promise((resolve) => setTimeout(resolve, 0))
}

function baseConnection(): any {
	return { name: "test-conn", type: "ollama" }
}
function baseSampling(): any {
	return { name: "test-sampling" }
}

describe("generateSummary — mid-flight cancellation", () => {
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
				thinkingContent: undefined
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

		// Force multiple batches so there's a "next batch" the loop must
		// never reach after the first one is cancelled mid-flight.
		const messages = Array.from({ length: 30 }, (_, i) => ({
			senderName: "User",
			content: `message number ${i} `.repeat(50)
		}))

		const resultPromise = generateSummary({
			messages,
			loreType: "scene",
			connection: baseConnection(),
			sampling: baseSampling(),
			contextConfig: {} as any,
			promptConfig: {} as any,
			onProgress,
			signal: controller.signal
		})

		// Let execution actually reach the blocked generateText() call for the
		// first batch before aborting.
		await macrotask()
		controller.abort()

		await expect(resultPromise).rejects.toThrow()
		expect(mockAbort).toHaveBeenCalled()

		// The abort lands on the very first batch's generateText() call — with
		// runGeneration throwing on isAborted, generateSummary's post-call
		// bookkeeping for that batch (parseSummaryOutput, drafts.push,
		// onProgress) never runs, so onProgress must never have been called
		// at all. (Checking for the literal truncated string here would be
		// a weaker assertion — parseSummaryOutput's parsed `content` field
		// wouldn't equal the raw completion text anyway, fixed or not; the
		// call count is what actually distinguishes the two cases.)
		expect(onProgress).not.toHaveBeenCalled()
	})

	test("an already-aborted signal throws before invoking the adapter at all (fast path)", async () => {
		const controller = new AbortController()
		controller.abort()

		const resultPromise = generateSummary({
			messages: [{ senderName: "User", content: "hello" }],
			loreType: "scene",
			connection: baseConnection(),
			sampling: baseSampling(),
			contextConfig: {} as any,
			promptConfig: {} as any,
			signal: controller.signal
		})

		await expect(resultPromise).rejects.toThrow()
		expect(mockGenerate).not.toHaveBeenCalled()
	})
})
