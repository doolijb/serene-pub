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
import {
	connectionsVisibleTo,
	namesAConnection,
	refuseConnectionChoice,
	withoutConnectionIdentity,
	type ConnectionSubject
} from "$lib/server/connections/visibility"

export interface PendingReview {
	id: string
	userId: number
	sessionId?: number
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
 *
 * ## The connection is not among the fields it can fold
 *
 * This is where a non-admin could redirect a run onto any connection on the
 * instance. The provider node's input carries its resolved `connection`
 * (`{id, kind, metadata}`); `inferSchema` made a JSON field of it like any
 * other structure; `host.ts` re-read `refId(p.connection)` afterwards and
 * dispatched to whatever came back. `resolveCapabilityTarget` re-judged what
 * that connection could DO and never who was asking, so a redirect onto a
 * capable connection succeeded in silence.
 *
 * Two things close it, and they are deliberately independent:
 *
 *  1. A non-admin's edit is applied through the schema with connection
 *     identity REMOVED. `applyFormValues` starts from the original payload and
 *     writes only keys the schema names, so the connection the administrator
 *     chose survives by construction — not by a check that could be missed.
 *  2. Supplying one anyway is refused outright, before anything is read. A
 *     write that is quietly dropped teaches nobody anything.
 */
export function resolveReview(
	id: string,
	userId: number,
	action: ReviewDecision["action"],
	values?: Record<string, unknown>,
	/**
	 * Who is deciding, as of NOW — not as of when the run parked.
	 *
	 * Optional, and absent means non-admin, because the only default that can
	 * be wrong in one direction is the one that grants. Read at decision time
	 * rather than captured by `createReviewer` so that an administrator
	 * demoted while a review sat parked decides as what they now are.
	 */
	viewer?: ConnectionSubject
): void {
	// First, before the entry is even looked up: a refusal that had to find
	// the review to be sure would answer differently for an id that exists.
	if (!connectionsVisibleTo(viewer) && namesAConnection(values))
		refuseConnectionChoice()

	const p = parked.get(id)
	// One sentence either way: a stale card after a restart and somebody
	// else's review id both deserve "there is nothing here to decide".
	if (!p || p.entry.userId !== userId)
		throw new ReviewNotFoundError(
			"That review is no longer waiting — it may have been decided " +
				"elsewhere, or the run that asked for it has ended."
		)

	// Built while the entry is still parked, because building it can fail:
	// `applyFormValues` refuses an unparseable JSON field or a number that is
	// not one. The invariant that keeps a refusal survivable is that an entry
	// leaves `parked` only when its promise is settled on the very next line,
	// with nothing between the two that can throw or await. De-parked first,
	// a thrown edit stranded the run forever — nothing held the resolver, and
	// `onAbort` bails on an id it can no longer find, so not even cancelling
	// could free it. Refusing an edit now leaves the run exactly as it was:
	// still parked, still decidable, still cancellable.
	const decision: ReviewDecision = {
		action,
		by: `user:${userId}`,
		at: Date.now(),
		...(action === "edit"
			? {
					payload: applyFormValues(
						// The schema a non-admin was SHOWN, which is the
						// schema their edit may write. `applyFormValues`
						// iterates the schema and leaves every other key of
						// the payload as it found it, so the connection is
						// carried through untouched rather than defended.
						connectionsVisibleTo(viewer)
							? p.entry.schema
							: withoutConnectionIdentity(p.entry.schema),
						p.entry.payload,
						values ?? {}
					)
				}
			: {})
	}

	parked.delete(id)
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
	sessionId?: number
	specId: string
	signal?: AbortSignal
}): Reviewer {
	return async (req) => {
		const schema = inferSchema(req.payload)
		const entry: PendingReview = {
			id: randomUUID(),
			userId: scope.userId,
			sessionId: scope.sessionId,
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
			const cancelled = (): ReviewDecision => ({
				action: "reject",
				by: "system:cancelled",
				at: Date.now()
			})

			// A signal that already aborted never fires `abort` again, so a
			// listener added now would never run and the run would park on a
			// promise nothing could settle.
			//
			// This was the *only* thing between a cancelled run and a permanent
			// park while the executor's between-nodes cancel hook
			// (`opts.cancelSignal`, 13 §3) went unwired: `checkCancel` was
			// always false, so a node that returned rather than throwing after
			// its adapter was aborted walked straight into the next gate
			// carrying a dead signal. The hook is wired now — `runSpec` passes
			// `runRegistry.cancellation`, so the run stops before it reaches
			// another gate — which makes this the backstop rather than the
			// mechanism. It stays: a reviewer reached through any path that
			// does not poll a cancellation is still a promise nothing settles.
			if (scope.signal?.aborted) {
				resolve(cancelled())
				return
			}

			parked.set(entry.id, { entry, resolve })

			// The guard is what keeps a decided review from being "cancelled"
			// a moment later: absent from `parked` now means settled, never
			// merely in flight.
			const onAbort = () => {
				if (!parked.has(entry.id)) return
				parked.delete(entry.id)
				resolve(cancelled())
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
