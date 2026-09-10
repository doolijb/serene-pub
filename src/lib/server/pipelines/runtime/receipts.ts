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
 * long it took — are columns, and what the run *made* is its own table, so
 * answering "why did this reply include that lore" does not mean loading and
 * walking JSON for every run in a session.
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
import { eq, and, asc, desc, inArray } from "drizzle-orm"

/**
 * One row a run left behind.
 *
 * ⚠ **Collected, never parsed back off the receipt.** The obvious-looking
 * alternative — walk `receipt.nodes[].output` for ids — cannot be made correct:
 * every host commit publishes its own shape (`{id}`, `{ids}`, `{status,
 * proposalId}`, a bare proposal), the outputs are redacted for non-admins, and
 * a Provider that writes rows (`generate-image` → `createMedia`) publishes
 * media *references* rather than row ids at all. So the writer says what it
 * wrote, at the moment it writes it, and this is the shape it says it in.
 */
export interface RunArtifact {
	/**
	 * Which table the id belongs to.
	 *
	 * Four, because four producers exist today. A fifth is added when a fifth
	 * producer is — a vocabulary entry nothing writes is a control with no
	 * effect wearing a contract.
	 */
	kind: "message" | "file" | "variant" | "lore_entry"
	/**
	 * The row's id in that table.
	 *
	 * ⚠ Deliberately not a foreign key on the column behind it — see the note
	 * on `pipeline_run_artifacts` in the schema. Evidence outlives its subject.
	 */
	entityId: number
	action: "created" | "updated" | "attached"
	/** Which node produced it. Absent for a producer that is not a node. */
	nodeKey?: string | null
}

export interface SaveReceiptScope {
	sessionId?: number
	userId?: number
	/**
	 * Everything this run made, in the order it made it.
	 *
	 * Filled by the host as its commits run (`HostScope.artifacts`), and seeded
	 * by a caller that already owns the row the run is writing into — the reply
	 * path, where the message row is created by the trigger, the pipeline
	 * compiles the prompt, and the adapter fills the row in, so no Consumer
	 * ever commits.
	 *
	 * ⚠ It also decides `is_preview`. See below.
	 */
	artifacts?: RunArtifact[]
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
	db: Db,
	receipt: Receipt,
	scope: SaveReceiptScope = {}
): Promise<number | null> {
	// Deduped here rather than left to the unique constraint, because a
	// constraint violation would abort the whole insert and the `catch` below
	// would swallow the entire receipt. Two `attach-image` nodes on one message
	// both record `(message, id, updated)` — the same fact stated twice, not a
	// second thing that happened — so the first wins and keeps its seq.
	const artifacts = dedupe(scope.artifacts ?? [])
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
				outcome: receipt.outcome,
				haltNodeKey: receipt.haltNodeKey ?? null,
				haltReason: receipt.haltReason ?? null,
				triggerSource: receipt.triggerSource,
				seed: receipt.seed,
				/**
				 * ⚠ **"Nothing was produced" — not "the executor halted early".**
				 *
				 * These read as the same question and are not. The reply path
				 * runs `runTurn({ preview: true })` because the ADAPTER makes
				 * the provider call, so the pipeline deliberately stops at the
				 * pre-call substrate and hands its payload over — and then a
				 * real message is written. `Boolean(receipt.preview)` alone
				 * therefore recorded **every reply in the product** as a
				 * preview, which silently emptied all three consumers of the
				 * column: `pipelines:sessionEntryUsage` (`is_preview = false`),
				 * `lastRunFor` (the query for "did this reply come from the
				 * pipeline"), and by extension every panel reading them. It was
				 * invisible in tests because a test runs the pipeline through
				 * its Consumer and production never does.
				 *
				 * Leaving something behind is what makes a run not a preview,
				 * whichever artifact it was and however the writer learned of
				 * it. What `preview` means to the executor is untouched.
				 */
				isPreview: artifacts.length === 0 && Boolean(receipt.preview),
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

		if (artifacts.length)
			await db.insert(schema.pipelineRunArtifacts).values(
				artifacts.map((a, i) => ({
					runId: row.id,
					seq: i,
					kind: a.kind,
					entityId: a.entityId,
					action: a.action,
					nodeKey: a.nodeKey ?? null
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
 * Write the composed stop sequences onto an already-stored receipt's generate
 * node.
 *
 * ## Why a patch, and why only one caller
 *
 * On every path whose Provider node actually fires, the stop list rides the
 * binding's own output and lands here with the rest of the receipt — no patch
 * involved. The REPLY path is the exception, and it is the one users spend their
 * day on: it runs `runTurn({ preview: true })` so the pipeline stops at the
 * pre-call substrate and hands its payload to the adapter, which means the
 * receipt is stored *before* anything has composed a stop list at all. Without
 * this, the panel would show a Stops row for summarize and lore runs and nothing
 * for a single reply.
 *
 * ⚠ **It records what was SENT, not that the node ran.** `result` stays `halt`
 * and `reason` stays "preview: stopped before …", both true: the node did halt,
 * and the adapter beside it did the sending. Rewriting either would turn an
 * honest receipt into a fictional one.
 *
 * Never throws, for the same reason `saveReceipt` never throws — a turn that
 * produced a good reply and then could not annotate its own audit trail has
 * still produced a good reply. A run id nothing matches is a no-op.
 */
export async function recordGenerateStops(
	db: Db,
	runId: string,
	stops: unknown
): Promise<void> {
	try {
		const [row] = await db
			.select()
			.from(schema.pipelineRuns)
			.where(eq(schema.pipelineRuns.runId, runId))
			.limit(1)
		if (!row) return
		const receipt = row.receipt as {
			nodes?: { typeId?: string; output?: unknown }[]
		} | null
		const node = receipt?.nodes?.find((n) =>
			String(n?.typeId ?? "").startsWith("core:provider/generate-text")
		)
		// A spec with no generate node, or a run that halted before reaching
		// one, has nothing to annotate. Silence rather than an invented node:
		// the receipt is evidence, and evidence does not grow entries.
		if (!node) return
		node.output = {
			...((node.output as Record<string, unknown> | null) ?? {}),
			stops
		}
		await db
			.update(schema.pipelineRuns)
			.set({ receipt: receipt as unknown as Record<string, unknown> })
			.where(eq(schema.pipelineRuns.id, row.id))
	} catch (err) {
		console.warn(
			"[pipelines] could not record this run's stop sequences — the turn " +
				"itself was unaffected:",
			err
		)
	}
}

/** First occurrence wins, so an artifact keeps the seq it was produced at. */
function dedupe(artifacts: RunArtifact[]): RunArtifact[] {
	const seen = new Set<string>()
	return artifacts.filter((a) => {
		const key = `${a.kind}|${a.entityId}|${a.action}`
		if (seen.has(key)) return false
		seen.add(key)
		return true
	})
}

/** The runs for a session, newest first — what a history panel lists. */
export async function runsForSession(db: Db, sessionId: number, limit = 50) {
	return await db
		.select()
		.from(schema.pipelineRuns)
		.where(eq(schema.pipelineRuns.sessionId, sessionId))
		.orderBy(desc(schema.pipelineRuns.id))
		.limit(limit)
}

/**
 * Everything one run left behind, in the order it made it.
 *
 * Takes the run **row** id, like `pipeline_run_nodes` does — not the SDK's
 * `runId` string, which is the receipt's identity rather than the table's.
 */
export async function runArtifacts(db: Db, runId: number) {
	return await db
		.select()
		.from(schema.pipelineRunArtifacts)
		.where(eq(schema.pipelineRunArtifacts.runId, runId))
		.orderBy(asc(schema.pipelineRunArtifacts.seq))
}

/**
 * Every run that produced a given row, newest first.
 *
 * The reverse of `runArtifacts`, and the reason the relation replaced a column:
 * a message can legitimately be the artifact of more than one run — regenerated,
 * continued, edited by a second pipeline — and a single nullable column could
 * only ever remember the last writer.
 */
export async function runsForArtifact(
	db: Db,
	kind: RunArtifact["kind"],
	entityId: number,
	limit = 50
) {
	const hits = await db
		.select({ runId: schema.pipelineRunArtifacts.runId })
		.from(schema.pipelineRunArtifacts)
		.where(
			and(
				eq(schema.pipelineRunArtifacts.kind, kind),
				eq(schema.pipelineRunArtifacts.entityId, entityId)
			)
		)
		.orderBy(desc(schema.pipelineRunArtifacts.runId))
		.limit(limit)
	if (!hits.length) return []

	return await db
		.select()
		.from(schema.pipelineRuns)
		.where(
			inArray(
				schema.pipelineRuns.id,
				hits.map((h) => h.runId)
			)
		)
		.orderBy(desc(schema.pipelineRuns.id))
}

/**
 * The run that produced a given message, with its node trail.
 *
 * The query behind "why does this reply say that": one message, one run, the
 * decisions in order.
 *
 * ⚠ **Non-preview first, then newest.** A message can be the artifact of
 * several runs, and the one worth explaining is the one that actually sent
 * something — a later preview over the same row (a token count, a compare
 * sweep) would otherwise shadow the reply the reader is asking about.
 */
export async function runForMessage(db: Db, messageId: number) {
	const [hit] = await db
		.select({ id: schema.pipelineRuns.id })
		.from(schema.pipelineRunArtifacts)
		.innerJoin(
			schema.pipelineRuns,
			eq(schema.pipelineRuns.id, schema.pipelineRunArtifacts.runId)
		)
		.where(
			and(
				eq(schema.pipelineRunArtifacts.kind, "message"),
				eq(schema.pipelineRunArtifacts.entityId, messageId)
			)
		)
		.orderBy(
			asc(schema.pipelineRuns.isPreview),
			desc(schema.pipelineRuns.id)
		)
		.limit(1)
	if (!hit) return null

	const [run] = await db
		.select()
		.from(schema.pipelineRuns)
		.where(eq(schema.pipelineRuns.id, hit.id))
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
export async function lastRunFor(db: Db, sessionId: number) {
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
