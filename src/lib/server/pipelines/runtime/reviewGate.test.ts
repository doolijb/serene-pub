/**
 * The parking invariant: **an entry leaves `parked` only when something is
 * guaranteed to settle its promise.**
 *
 * These are regression tests for a run that could be stranded forever by a
 * typo. `resolveReview` used to de-park the entry and only then build the
 * decision — and building it can fail, because `applyFormValues` refuses a
 * JSON field that does not parse or a number that is not one. The throw
 * escaped with the resolver already dropped on the floor: the executor's
 * `await opts.reviewer(...)` never settled, so the run never ended, its
 * registry entry was never finished, and the progress card never cleared.
 * Cancelling could not rescue it either — `onAbort` bails on an id it can no
 * longer find, and the id was already gone. Only restarting the app recovered.
 *
 * It bites image generation first because the image provider's review form is
 * the one screen with three JSON blobs on it (`connection`, `sampling`,
 * `prompts`), so the payloads here are shaped like that node's.
 *
 * Written at this seam rather than through a whole run because the hang IS the
 * unsettled promise: `startGatedNode` awaits the reviewer exactly as the
 * executor does, and every run-level symptom is a plain consequence of that
 * `await` never returning. A race is also easier to pin without a database and
 * a model in the way.
 */

import { describe, it, expect, beforeEach } from "vitest"
import {
	createReviewer,
	pendingReviewsFor,
	resolveReview,
	setReviewTransport
} from "$lib/server/pipelines/runtime/reviewGate"
import type { ReviewDecision, Reviewer } from "@serene-pub/sdk"

const SPEC_ID = "core:spec/chat-generate-image"

/** Fresh per test: `parked` is module state, and users are how it partitions. */
let nextUserId = 1000
const newUser = () => ++nextUserId

let pushes: Array<{ userId: number; event: string; data: unknown }> = []

beforeEach(() => {
	pushes = []
	setReviewTransport((userId, event, data) =>
		pushes.push({ userId, event, data })
	)
})

/** What the image provider node hands the gate — one string, three JSON blobs. */
const imagePayload = () => ({
	prompt: "a lantern in the fog",
	connection: { id: 7, kind: "image", metadata: { model: "sd-1.5" } },
	sampling: { steps: 20, cfg: 6.5 },
	prompts: { positive: "{{prompt}}", negative: "blurry" }
})

/**
 * The executor's own shape — `const decision = await opts.reviewer(req)` — so
 * that "the run is stranded" is observable as the thing it actually is: this
 * promise never settles and the node after it never runs.
 */
function startGatedNode(reviewer: Reviewer, payload: unknown) {
	const state: { settled: boolean; decision?: ReviewDecision } = {
		settled: false
	}
	const done = reviewer({
		nodeKey: "render",
		definitionId: "core:oracle/generate-image",
		payload,
		position: "on"
	}).then((decision) => {
		state.settled = true
		state.decision = decision
		return decision
	})
	// The gate resolves and never rejects; catching keeps a surprise from
	// surfacing as an unhandled rejection in some later, unrelated test.
	done.catch(() => {})
	return state
}

/**
 * One macrotask turn, which runs only after every pending microtask has — so a
 * promise that has not settled by here is not merely slow, it is waiting.
 */
const settle = () => new Promise((r) => setTimeout(r, 5))

const parkedFor = (userId: number) => pendingReviewsFor(userId)

async function parkOne(scope: { userId: number; signal?: AbortSignal }) {
	const reviewer = createReviewer({ ...scope, specId: SPEC_ID })
	const state = startGatedNode(reviewer, imagePayload())
	await settle()
	const review = parkedFor(scope.userId)[0]
	expect(review, "the run did not park at the gate").toBeDefined()
	return { state, review: review! }
}

describe("a refused edit leaves the run exactly as it was", () => {
	it("keeps the review parked, and the person can correct the field and resume", async () => {
		const userId = newUser()
		const { state, review } = await parkOne({ userId })

		// The form the person is looking at: the blobs are JSON fields, which
		// is what makes a typo in one of them a validation failure at all.
		expect((review.schema as any).connection.format).toBe("json")
		expect((review.schema as any).sampling.format).toBe("json")
		expect((review.schema as any).prompts.format).toBe("json")

		// One typo in the Connection blob. Decided as an ADMINISTRATOR,
		// because that blob is only ever on an administrator's card since
		// connections became invisible to everyone else — a non-admin
		// submitting one is refused before the JSON is ever parsed
		// (`reviewGate.connectionVisibility.test.ts`). The invariant under
		// test is unchanged: a refused edit leaves the run parked.
		expect(() =>
			resolveReview(
				review.id,
				userId,
				"edit",
				{
					...review.values,
					connection: '{ "id": 7, "kind": "image"'
				},
				{ isAdmin: true }
			)
		).toThrow(/valid JSON/)

		// The refusal changed nothing: the card is still there to correct, and
		// the run is still waiting on a person rather than on nobody.
		expect(parkedFor(userId).map((r) => r.id)).toEqual([review.id])
		await settle()
		expect(state.settled, "a refused edit must not decide the review").toBe(
			false
		)

		// And the correction goes through, on the same id.
		resolveReview(
			review.id,
			userId,
			"edit",
			{ ...review.values, prompt: "a lantern in the fog, corrected" },
			{ isAdmin: true }
		)
		await settle()
		expect(
			state.settled,
			"the run never resumed — a refused edit stranded it forever"
		).toBe(true)
		expect(state.decision!.action).toBe("edit")
		const payload = state.decision!.payload as Record<string, unknown>
		expect(payload.prompt).toBe("a lantern in the fog, corrected")
		// Untouched fields survive the round trip through the form (F14).
		expect(payload.connection).toEqual({
			id: 7,
			kind: "image",
			metadata: { model: "sd-1.5" }
		})
		expect(parkedFor(userId)).toHaveLength(0)
	})

	it("stays cancellable — Cancel frees a run whose edit was just refused", async () => {
		const userId = newUser()
		const controller = new AbortController()
		const { state, review } = await parkOne({
			userId,
			signal: controller.signal
		})

		// Admin again, and for the same reason: `review.values` carries the
		// connection blob, which only an administrator may submit at all. The
		// refusal under test is the sampling one.
		expect(() =>
			resolveReview(
				review.id,
				userId,
				"edit",
				{ ...review.values, sampling: "20 steps" },
				{ isAdmin: true }
			)
		).toThrow(/valid JSON/)

		controller.abort()
		await settle()

		expect(
			state.settled,
			"Cancel could not free a run whose edit had just been refused"
		).toBe(true)
		expect(state.decision).toMatchObject({
			action: "reject",
			by: "system:cancelled"
		})
		expect(parkedFor(userId)).toHaveLength(0)
		// The card goes with the run — no ghost asking about work that stopped.
		expect(
			pushes.filter((p) => p.event === "pipelines:reviewClosed")
		).toEqual([
			{
				userId,
				event: "pipelines:reviewClosed",
				data: { id: review.id }
			}
		])
	})
})

describe("the gate never parks on a signal that cannot wake it", () => {
	it("resolves immediately when the run was already cancelled", async () => {
		const userId = newUser()
		const controller = new AbortController()
		// An `abort` that already fired never fires again, so a listener
		// registered now would wait for an event that has been and gone.
		controller.abort()

		const reviewer = createReviewer({
			userId,
			specId: SPEC_ID,
			signal: controller.signal
		})
		const state = startGatedNode(reviewer, imagePayload())
		await settle()

		expect(
			state.settled,
			"a gate reached with a dead signal parked forever"
		).toBe(true)
		expect(state.decision).toMatchObject({
			action: "reject",
			by: "system:cancelled"
		})
		expect(parkedFor(userId)).toHaveLength(0)
		// Nobody is asked to decide a run that is already over.
		expect(pushes).toHaveLength(0)
	})

	it("does not un-decide a review when its run is cancelled a moment later", async () => {
		const userId = newUser()
		const controller = new AbortController()
		const { state, review } = await parkOne({
			userId,
			signal: controller.signal
		})

		resolveReview(review.id, userId, "approve")
		controller.abort()
		await settle()

		expect(state.decision!.action).toBe("approve")
		expect(parkedFor(userId)).toHaveLength(0)
		// A decided card must not be reported as cancelled after the fact.
		expect(
			pushes.filter((p) => p.event === "pipelines:reviewClosed")
		).toHaveLength(0)
	})
})

/**
 * Owner note 16 (2026-10-02): a card must say which moment of the run it is
 * about. Review on respond's `placeholder` parks on the EMPTY row before the
 * model writes — an empty Text field with no explanation reads like a bug.
 */
describe("whatIsReviewed — the card says what it is asking about", () => {
	it("names the reply's placeholder, and points at the save step", async () => {
		const { whatIsReviewed } = await import(
			"$lib/server/pipelines/runtime/reviewGate"
		)
		const line = whatIsReviewed({
			definitionId: "core:outlet/create-message@1",
			nodeKey: "placeholder",
			payload: { text: "", generating: true }
		})
		expect(line).toMatch(/placeholder/)
		expect(line).toMatch(/before the model writes anything/)
		expect(line).toMatch(/saves the finished message/)
	})
	it("a complete new message and the finished save read differently", async () => {
		const { whatIsReviewed } = await import(
			"$lib/server/pipelines/runtime/reviewGate"
		)
		expect(
			whatIsReviewed({
				definitionId: "core:outlet/create-message@1",
				nodeKey: "save",
				payload: { text: "hi" }
			})
		).toBe("A new message, before it is posted.")
		expect(
			whatIsReviewed({
				definitionId: "core:outlet/update-message@1",
				nodeKey: "save",
				payload: { text: "hi" }
			})
		).toBe("The finished message, before it is saved.")
	})
	it("any other write is named from its definition", async () => {
		const { whatIsReviewed } = await import(
			"$lib/server/pipelines/runtime/reviewGate"
		)
		expect(
			whatIsReviewed({
				definitionId: "acme:outlet/post-tweet@2",
				nodeKey: "post",
				payload: {}
			})
		).toBe("This step's write (post tweet), before it takes effect.")
	})
	it("rides on the pushed card", async () => {
		const pushed: any[] = []
		setReviewTransport((_u: number, event: string, payload: any) => {
			if (event === "pipelines:reviewRequested") pushed.push(payload)
		})
		const userId = newUser()
		const reviewer = createReviewer({ userId, specId: "core:spec/chat-respond" })
		void reviewer({
			nodeKey: "placeholder",
			definitionId: "core:outlet/create-message@1",
			payload: { text: "", generating: true },
			position: "on"
		} as any)
		await new Promise((r) => setTimeout(r, 0))
		const [card] = pendingReviewsFor(userId)
		expect(card.whatIsReviewed).toMatch(/placeholder/)
		expect(pushed.at(-1)?.whatIsReviewed).toBe(card.whatIsReviewed)
		resolveReview(card.id, userId, "reject")
	})
})
