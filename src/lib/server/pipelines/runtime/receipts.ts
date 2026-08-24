/**
 * Keeping what a run did.
 *
 * The executor returns a receipt and, until this existed, nothing kept it. That
 * made the first question anyone asks after a turn — *did that use the pipeline,
 * and what did it decide?* — unanswerable the moment the request ended. F3 says
 * rows are the system of record; that was true of specs and types and false of
 * runs, which is the one a user actually looks at.
 *
 * Two rows rather than one blob. The blob stays, verbatim, because a receipt
 * shape will grow and a column list written today should not decide what a
 * future panel can show. But the parts people *query* — which node halted, how
 * long it took, which message it produced — are columns, so answering "why did
 * this reply include that lore" does not mean loading and walking JSON for every
 * run in a session.
 *
 * ## Writing a receipt never fails a turn
 *
 * A run that generated a good reply and then failed to record itself has still
 * generated a good reply. Persistence errors are logged and swallowed, because
 * the alternative — a user losing a message because the audit trail had a bad
 * day — gets the priority exactly backwards.
 */

import type { Receipt } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { eq, and, desc } from "drizzle-orm"

export interface SaveReceiptScope {
	sessionId?: number
	userId?: number
	/** The message this run wrote, when the caller knows it. */
	messageId?: number
	specVersionId?: number
}

/**
 * Store a receipt and its node trail.
 *
 * Returns the row id, or null when it could not be written — never throws. See
 * the note above: the receipt is evidence about the turn, not a precondition
 * for it.
 */
export async function saveReceipt(
	db: any,
	receipt: Receipt,
	scope: SaveReceiptScope = {}
): Promise<number | null> {
	try {
		const [row] = await db
			.insert(schema.pipelineRuns)
			.values({
				runId: receipt.runId,
				specSlug: receipt.specId,
				specVersion: receipt.specVersion,
				specVersionId: scope.specVersionId ?? null,
				sessionId: scope.sessionId ?? null,
				userId: scope.userId ?? null,
				messageId: scope.messageId ?? null,
				outcome: receipt.outcome,
				haltNodeKey: receipt.haltNodeKey ?? null,
				haltReason: receipt.haltReason ?? null,
				triggerSource: receipt.triggerSource,
				seed: receipt.seed,
				isPreview: Boolean(receipt.preview),
				startedAt: new Date(receipt.startedAt),
				endedAt: new Date(receipt.endedAt),
				elapsedMs: Math.max(0, receipt.endedAt - receipt.startedAt),
				tokensSpent: receipt.consumption?.tokens ?? 0,
				receipt: receipt as unknown as Record<string, unknown>
			})
			.returning()

		if (receipt.nodes?.length)
			await db.insert(schema.pipelineRunNodes).values(
				receipt.nodes.map((n) => ({
					runId: row.id,
					seq: n.seq,
					nodeKey: n.nodeKey,
					kind: n.kind,
					typeId: n.typeId,
					result: n.result,
					reason: n.reason ?? null,
					elapsedMs: n.elapsedMs ?? 0,
					tokens: n.tokens ?? null
				}))
			)

		return row.id
	} catch (err) {
		// Logged loudly enough to notice, quiet enough not to break a session.
		console.warn(
			"[pipelines] could not record the run receipt — the turn itself was " +
				"unaffected:",
			err
		)
		return null
	}
}

/**
 * Attach a run to the message it produced.
 *
 * Separate from the write because the id does not exist yet when the receipt is
 * saved: the Consumer writes the message during the run, and the caller learns
 * its id from the receipt afterwards. Linking them is what makes "show me why
 * *this* reply looks like that" a lookup rather than a search.
 */
export async function linkReceiptToMessage(
	db: any,
	runId: string,
	messageId: number
): Promise<void> {
	try {
		await db
			.update(schema.pipelineRuns)
			.set({ messageId })
			.where(eq(schema.pipelineRuns.runId, runId))
	} catch (err) {
		console.warn(
			"[pipelines] could not link the receipt to its message:",
			err
		)
	}
}

/** The runs for a session, newest first — what a history panel lists. */
export async function runsForSession(db: any, sessionId: number, limit = 50) {
	return await db
		.select()
		.from(schema.pipelineRuns)
		.where(eq(schema.pipelineRuns.sessionId, sessionId))
		.orderBy(desc(schema.pipelineRuns.id))
		.limit(limit)
}

/**
 * The run that produced a given message, with its node trail.
 *
 * The query behind "why does this reply say that": one message, one run, the
 * decisions in order.
 */
export async function runForMessage(db: any, messageId: number) {
	const [run] = await db
		.select()
		.from(schema.pipelineRuns)
		.where(eq(schema.pipelineRuns.messageId, messageId))
		.orderBy(desc(schema.pipelineRuns.id))
		.limit(1)
	if (!run) return null

	const nodes = await db
		.select()
		.from(schema.pipelineRunNodes)
		.where(eq(schema.pipelineRunNodes.runId, run.id))
		.orderBy(schema.pipelineRunNodes.seq)

	return { run, nodes }
}

/**
 * Whether a session's last reply came from the pipeline.
 *
 * Exists because the honest answer to "how do I know it is using the new path"
 * should be a query rather than a claim. A session with no rows here was answered
 * by the legacy builder — there is no third possibility.
 */
export async function lastRunFor(db: any, sessionId: number) {
	const [run] = await db
		.select()
		.from(schema.pipelineRuns)
		.where(
			and(
				eq(schema.pipelineRuns.sessionId, sessionId),
				eq(schema.pipelineRuns.isPreview, false)
			)
		)
		.orderBy(desc(schema.pipelineRuns.id))
		.limit(1)
	return run ?? null
}
