/**
 * The review gate's core half — parking, forms, and resolution (01 §7).
 *
 * The executor owns the gate itself: it checks `settings.review` on every
 * gated node and parks on the reviewer this module supplies. What core owns
 * is what only core can do — hold the parked promise, tell the person, and
 * hand their decision back. The form a reviewer sees is **inferred from the
 * payload the node received** (`inferSchema`), which is the same field
 * language extensions declare settings in and the same renderer draws: one
 * schema strategy for review pauses, plugin settings, and arbitrary
 * extension forms.
 *
 * ## What v1 deliberately does not do
 *
 * - **Parking is in-memory.** A parked run does not survive a process
 *   restart; the run simply never completes and the trigger fails the way
 *   any interrupted run does. The durable parking store (a parked run
 *   outlives the process) is core's job in the plans and lands with the
 *   plugin lifecycle work.
 * Parked gates are never timed out — waiting is free (F13), and exceeding a
 * ceiling queues the *run*, not the person (13 §3).
 */

import { randomUUID } from "node:crypto"
import {
	inferSchema,
	valuesForForm,
	applyFormValues,
	type Reviewer,
	type ReviewDecision,
	type SettingsSchema
} from "@serene-pub/sdk"

export interface PendingReview {
	id: string
	userId: number
	chatId?: number
	specId: string
	nodeKey: string
	typeId: string
	position: "on"
	payload: unknown
	schema: SettingsSchema
	values: Record<string, unknown>
	requestedAt: number
}

/** What the client renders — everything but the raw payload. */
export interface PendingReviewView {
	id: string
	specId: string
	nodeKey: string
	typeId: string
	schema: SettingsSchema
	values: Record<string, unknown>
	requestedAt: number
}

interface Parked {
	entry: PendingReview
	resolve: (d: ReviewDecision) => void
}

const parked = new Map<string, Parked>()

/**
 * The push transport, registered once from the socket layer. A module-level
 * seam rather than a parameter because a review can park from any trigger —
 * a socket handler, an event, a schedule — and they all reach the same
 * person the same way.
 */
let pushToUser:
	| ((userId: number, event: string, data: unknown) => void)
	| null = null

export function setReviewTransport(
	push: (userId: number, event: string, data: unknown) => void
) {
	pushToUser = push
}

const viewOf = (e: PendingReview): PendingReviewView => ({
	id: e.id,
	specId: e.specId,
	nodeKey: e.nodeKey,
	typeId: e.typeId,
	schema: e.schema,
	values: e.values,
	requestedAt: e.requestedAt
})

/** Everything waiting on this person, oldest first. */
export function pendingReviewsFor(userId: number): PendingReviewView[] {
	return [...parked.values()]
		.filter((p) => p.entry.userId === userId)
		.sort((a, b) => a.entry.requestedAt - b.entry.requestedAt)
		.map((p) => viewOf(p.entry))
}

export class ReviewNotFoundError extends Error {}

/**
 * A person's decision, folded back into the run.
 *
 * `edit` folds the form values into the original payload through the same
 * schema the form was generated from — untouched fields keep their
 * originals, JSON fields must parse, and the binding receives the result
 * without being able to tell it from an approval (F14).
 */
export function resolveReview(
	id: string,
	userId: number,
	action: ReviewDecision["action"],
	values?: Record<string, unknown>
): void {
	const p = parked.get(id)
	// One sentence either way: a stale card after a restart and somebody
	// else's review id both deserve "there is nothing here to decide".
	if (!p || p.entry.userId !== userId)
		throw new ReviewNotFoundError(
			"That review is no longer waiting — it may have been decided " +
				"elsewhere, or the run that asked for it has ended."
		)
	parked.delete(id)

	const decision: ReviewDecision = {
		action,
		by: `user:${userId}`,
		at: Date.now(),
		...(action === "edit"
			? {
					payload: applyFormValues(
						p.entry.schema,
						p.entry.payload,
						values ?? {}
					)
				}
			: {})
	}
	p.resolve(decision)
}

/**
 * The reviewer a run is handed.
 *
 * `sync` parks: the entry is stored, the person is pushed the form, and the
 * run waits — free, per F13 — until `resolveReview` hands the decision back
 * or the run's own signal aborts (a cancelled run rejects its reviews; a
 * person cancelling a build should not leave a ghost card asking them to
 * approve what it was doing).
 */
export function createReviewer(scope: {
	userId: number
	chatId?: number
	specId: string
	signal?: AbortSignal
}): Reviewer {
	return async (req) => {
		const schema = inferSchema(req.payload)
		const entry: PendingReview = {
			id: randomUUID(),
			userId: scope.userId,
			chatId: scope.chatId,
			specId: scope.specId,
			nodeKey: req.nodeKey,
			typeId: req.typeId,
			position: req.position,
			payload: req.payload,
			schema,
			values: valuesForForm(schema, req.payload),
			requestedAt: Date.now()
		}

		return await new Promise<ReviewDecision>((resolve) => {
			parked.set(entry.id, { entry, resolve })

			const onAbort = () => {
				if (!parked.has(entry.id)) return
				parked.delete(entry.id)
				resolve({
					action: "reject",
					by: "system:cancelled",
					at: Date.now()
				})
				pushToUser?.(scope.userId, "pipelines:reviewClosed", {
					id: entry.id
				})
			}
			scope.signal?.addEventListener("abort", onAbort, { once: true })

			pushToUser?.(
				scope.userId,
				"pipelines:reviewRequested",
				viewOf(entry)
			)
		})
	}
}
