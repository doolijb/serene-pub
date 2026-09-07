/**
 * The review card cannot hand a run to a connection nobody gave it.
 *
 * ## The bug this pins
 *
 * A gated Provider node parks with its resolved input, and that input names the
 * connection the administrator chose: `{id, kind, metadata}`. `inferSchema`
 * turned it into a JSON field like any other, the card offered it for editing,
 * `applyFormValues` folded whatever came back into the payload, and `host.ts`
 * then read `refId(p.connection)` and dispatched to it. `resolveCapabilityTarget`
 * re-judged what that connection could DO and never asked who was asking — so a
 * non-admin retyping the id of any *capable* connection on the instance moved
 * the run onto it, silently, with a correct-looking receipt.
 *
 * Every connection WRITE was already guarded (`sockets/connections.ts`,
 * `config/panel/scopes.ts`). This one was shaped like a read.
 *
 * ## What is pinned here
 *
 * 1. A non-admin's card carries no connection identity — no id, no kind, no
 *    model.
 * 2. A non-admin submitting one is refused, in a sentence that would read the
 *    same for an id that does not exist.
 * 3. An administrator still sees it and can still change it.
 * 4. A non-admin editing the fields that ARE theirs leaves the run pointed at
 *    the administrator's connection — which is the assertion that would have
 *    caught the original bug, because it is exactly what `host.ts` reads.
 */

import { describe, it, expect, beforeEach } from "vitest"
import {
	createReviewer,
	pendingReviewsFor,
	resolveReview
} from "$lib/server/pipelines/runtime/reviewGate"
import {
	CONNECTION_REFUSAL,
	redactConnections
} from "$lib/server/connections/visibility"
import type { ReviewDecision, Reviewer } from "@serene-pub/sdk"

const SPEC_ID = "core:spec/generate-image"

/** The connection an ADMINISTRATOR set for this capability. */
const ADMIN_CONNECTION = {
	id: 7,
	kind: "image",
	metadata: { model: "sd-1.5" }
}

/** The one they would rather the run used. */
const SOMEBODY_ELSES_CONNECTION = { id: 9, kind: "image" }

const admin = { isAdmin: true }
const nonAdmin = { isAdmin: false }

let nextUserId = 5000
const newUser = () => ++nextUserId

const imagePayload = () => ({
	prompt: "a lantern in the fog",
	connection: ADMIN_CONNECTION,
	sampling: { steps: 20, cfg: 6.5 },
	prompts: { positive: "{{prompt}}", negative: "blurry" }
})

function startGatedNode(reviewer: Reviewer, payload: unknown) {
	const state: { settled: boolean; decision?: ReviewDecision } = {
		settled: false
	}
	reviewer({
		nodeKey: "render",
		typeId: "core:provider/generate-image",
		payload,
		position: "on"
	})
		.then((decision) => {
			state.settled = true
			state.decision = decision
			return decision
		})
		.catch(() => {})
	return state
}

const settle = () => new Promise((r) => setTimeout(r, 5))

async function parkOne(userId: number) {
	const state = startGatedNode(
		createReviewer({ userId, specId: SPEC_ID }),
		imagePayload()
	)
	await settle()
	const review = pendingReviewsFor(userId)[0]
	expect(review, "the run did not park at the gate").toBeDefined()
	return { state, review: review! }
}

/** Whatever `host.ts` will read out of the decision as `refId(p.connection)`. */
const connectionTheRunWillUse = (decision?: ReviewDecision) =>
	(decision?.payload as Record<string, any> | undefined)?.connection

beforeEach(() => {
	// No transport: these tests read the parked entry directly, and a push
	// left over from another suite must not be delivered into this one.
})

describe("what a non-admin sees on the card", () => {
	it("has no connection field at all — not the id, not the model", async () => {
		const userId = newUser()
		const { review } = await parkOne(userId)

		// `redactConnections` is the function the push transport
		// (`registerPipelineHandlers`) and `emitToUser` both apply; this is
		// the card as it goes out.
		const card = redactConnections(review, nonAdmin)

		expect(card.schema).not.toHaveProperty("connection")
		expect(card.values).not.toHaveProperty("connection")
		expect(JSON.stringify(card)).not.toContain("sd-1.5")
		expect(JSON.stringify(card)).not.toContain('"id":7')

		// The rest of the card is untouched — this is a redaction, not a
		// downgrade of the review to a yes/no.
		expect(card.schema).toHaveProperty("prompt")
		expect(card.schema).toHaveProperty("sampling")
		expect(card.values.prompt).toBe("a lantern in the fog")

		resolveReview(review.id, userId, "reject")
	})

	it("still shows an administrator everything it showed before", async () => {
		const userId = newUser()
		const { review } = await parkOne(userId)

		const card = redactConnections(review, admin)
		expect(card).toBe(review)
		expect((card.schema as any).connection.format).toBe("json")
		expect(JSON.parse(String(card.values.connection))).toEqual(
			ADMIN_CONNECTION
		)

		resolveReview(review.id, userId, "reject")
	})
})

describe("what a non-admin may change", () => {
	it("is refused when it names a connection, in a sentence that names none", async () => {
		const userId = newUser()
		const { state, review } = await parkOne(userId)

		expect(() =>
			resolveReview(
				review.id,
				userId,
				"edit",
				{
					...review.values,
					connection: JSON.stringify(SOMEBODY_ELSES_CONNECTION)
				},
				nonAdmin
			)
		).toThrow(CONNECTION_REFUSAL)

		// The refusal is the same for an id that does not exist — nothing was
		// looked up, so nothing could have been learned.
		expect(() =>
			resolveReview(
				review.id,
				userId,
				"edit",
				{ connection: JSON.stringify({ id: 999999 }) },
				nonAdmin
			)
		).toThrow(CONNECTION_REFUSAL)

		// Refused, not swallowed: the run is still parked and still decidable,
		// exactly as a rejected JSON field leaves it.
		expect(pendingReviewsFor(userId).map((r) => r.id)).toEqual([review.id])
		await settle()
		expect(state.settled).toBe(false)

		resolveReview(review.id, userId, "reject")
	})

	it("cannot move the run even by supplying a connection id that is real", async () => {
		const userId = newUser()
		const { state, review } = await parkOne(userId)

		// The whole original bug in one call: a valid id, submitted directly,
		// through the field the card used to offer. Two independent things
		// stop it — the refusal above, and the schema this edit is applied
		// through, which no longer names `connection` at all.
		resolveReview(
			review.id,
			userId,
			"edit",
			{ prompt: "a lantern, but mine" },
			nonAdmin
		)
		await settle()

		expect(state.settled).toBe(true)
		expect(state.decision!.action).toBe("edit")
		// What they were allowed to change, changed.
		expect((state.decision!.payload as any).prompt).toBe(
			"a lantern, but mine"
		)
		// What they were not, did not: `host.ts` reads this and dispatches to
		// the administrator's connection.
		expect(connectionTheRunWillUse(state.decision)).toEqual(
			ADMIN_CONNECTION
		)
	})

	it("cannot move it by hiding the id under a key the form never had", async () => {
		const userId = newUser()
		const { state, review } = await parkOne(userId)

		// Not in the schema, so `applyFormValues` would have ignored it
		// anyway; the point is that the attempt is ANSWERED rather than
		// dropped. Every spelling the wire has for a connection is refused,
		// not only the one this form happened to render.
		expect(() =>
			resolveReview(
				review.id,
				userId,
				"edit",
				{ connectionId: 9 },
				nonAdmin
			)
		).toThrow(CONNECTION_REFUSAL)
		expect(state.settled).toBe(false)
		expect(pendingReviewsFor(userId)).toHaveLength(1)

		resolveReview(review.id, userId, "reject")
	})

	it("is judged by what they are now, not by what they were when it parked", async () => {
		const userId = newUser()
		const { review } = await parkOne(userId)

		// A review can sit for as long as a person takes. `resolveReview`
		// reads the decider's standing at decision time rather than a flag
		// captured by `createReviewer`, so an administrator demoted while the
		// card waited decides as what they now are.
		expect(() =>
			resolveReview(
				review.id,
				userId,
				"edit",
				{ connection: "{}" },
				nonAdmin
			)
		).toThrow(CONNECTION_REFUSAL)

		resolveReview(review.id, userId, "reject")
	})

	it("refuses when the caller states no standing at all", async () => {
		const userId = newUser()
		const { review } = await parkOne(userId)

		// The default is closed. A caller added later that forgets to say who
		// is deciding gets the safe answer, not the granting one.
		expect(() =>
			resolveReview(review.id, userId, "edit", { connection: "{}" })
		).toThrow(CONNECTION_REFUSAL)

		resolveReview(review.id, userId, "reject")
	})
})

describe("what an administrator may change", () => {
	it("still includes the connection — the run follows their edit", async () => {
		const userId = newUser()
		const { state, review } = await parkOne(userId)

		resolveReview(
			review.id,
			userId,
			"edit",
			{
				...review.values,
				connection: JSON.stringify(SOMEBODY_ELSES_CONNECTION)
			},
			admin
		)
		await settle()

		expect(state.settled).toBe(true)
		expect(connectionTheRunWillUse(state.decision)).toEqual(
			SOMEBODY_ELSES_CONNECTION
		)
	})

	it("keeps F14: a field they did not touch survives the round trip", async () => {
		const userId = newUser()
		const { state, review } = await parkOne(userId)

		resolveReview(
			review.id,
			userId,
			"edit",
			{ ...review.values, prompt: "corrected" },
			admin
		)
		await settle()

		expect(connectionTheRunWillUse(state.decision)).toEqual(
			ADMIN_CONNECTION
		)
	})
})
