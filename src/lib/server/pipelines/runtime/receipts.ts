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
import { eq, and, asc, desc, inArray, sql } from "drizzle-orm"
import { WIRE_RAW_LIMIT } from "$lib/server/connectionAdapters/BaseConnectionAdapter"

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
	 * Six, because six producers exist — `session` arrived with the branch
	 * built-in (2026-09-16) and `lore_link` with the link outlet (L2,
	 * 2026-09-17). A seventh is added when a seventh producer is — a
	 * vocabulary entry nothing writes is a control with no effect wearing a
	 * contract.
	 */
	kind:
		| "message"
		| "file"
		| "variant"
		| "lore_entry"
		| "lore_link"
		| "session"
	/**
	 * The row's id in that table.
	 *
	 * ⚠ Deliberately not a foreign key on the column behind it — see the note
	 * on `pipeline_run_artifacts` in the schema. Evidence outlives its subject.
	 */
	entityId: number
	/**
	 * What the run did to the row. `created` and `updated` are a pipeline
	 * writing content; the four verbs are the built-ins (R-15, 2026-09-16),
	 * and a reader asking "which run wrote this reply" filters them out —
	 * an edit's run has no prompt to explain.
	 */
	action:
		| "created"
		| "updated"
		| "attached"
		| "deleted"
		| "hidden"
		| "edited"
		| "swiped"
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
	/**
	 * The version row the run resolved, when the caller already holds it.
	 *
	 * Left out by every caller for the life of the column, which is why
	 * `resolveSpecVersion` below looks it up instead of trusting the scope: a
	 * field nobody fills is a column that is always NULL, and `spec_version_id`
	 * was exactly that.
	 */
	specVersionId?: number
	/** The document's canonical hash, likewise. See `resolveSpecVersion`. */
	specHash?: string
}

/**
 * Which document a receipt is about.
 *
 * `spec_slug` and `spec_version` name an **indirection**: an edited document
 * republishes under the same semver and the slug moves on (ruling 2026-09-10),
 * so the pair says which pipeline and not which document. The hash says which
 * document, and that is what an explain surface needs to answer "does this
 * receipt still describe what runs today".
 *
 * Resolved here rather than required from the caller because six call sites
 * write receipts and only one of them loads a version row. The lookup is one
 * indexed read inside a function that already never fails a turn, and a receipt
 * that could not resolve its own document keeps NULL rather than borrowing a
 * neighbour's hash.
 */
async function resolveSpecVersion(
	db: Db,
	slug: string,
	semver: string
): Promise<{ id: number | null; hash: string | null }> {
	try {
		const [row] = await db
			.select({
				id: schema.pipelineSpecVersions.id,
				hash: schema.pipelineSpecVersions.canonicalHash,
				activeVersionId: schema.pipelineSpecs.activeVersionId
			})
			.from(schema.pipelineSpecVersions)
			.innerJoin(
				schema.pipelineSpecs,
				eq(schema.pipelineSpecVersions.specId, schema.pipelineSpecs.id)
			)
			.where(
				and(
					eq(schema.pipelineSpecs.slug, slug),
					eq(schema.pipelineSpecVersions.semver, semver)
				)
			)
			// The pointer first, then the newest — a slug can hold several rows
			// for one semver now, and the one a run just used is the active one.
			.orderBy(
				desc(
					sql`(${schema.pipelineSpecVersions.id} = ${schema.pipelineSpecs.activeVersionId})`
				),
				desc(schema.pipelineSpecVersions.id)
			)
			.limit(1)
		return { id: row?.id ?? null, hash: row?.hash ?? null }
	} catch {
		return { id: null, hash: null }
	}
}

/** The generate nodes, whose `text` is the reply itself. */
// Matches the pre-rename spelling too: a receipt written before 2026-09-16
// carries `core:provider/…` and is capped on the same terms when re-saved.
const GENERATE_TYPE = /^core:(?:oracle|provider)\/generate-(text|with-tools|json)@/

/** The save node, whose `input.text`/`input.thinking` are the reply again. */
const UPDATE_MESSAGE_TYPE = /^core:(?:outlet|consumer)\/update-message/

/** A byte count as UTF-8, which is what the column stores. */
const bytesOf = (text: string) => Buffer.byteLength(text, "utf8")

/**
 * Cap one field on a node's `input` or `output` at `WIRE_RAW_LIMIT`, in place
 * on a draft copy — `field` on `bag` is replaced and `${field}Truncated` and a
 * note are added, or `bag` is returned untouched when there is nothing to cap.
 */
function boundedField(
	bag: Record<string, unknown>,
	field: string,
	notes: string[]
): Record<string, unknown> {
	const text = bag[field]
	if (typeof text !== "string" || bytesOf(text) <= WIRE_RAW_LIMIT) return bag
	const bytes = bytesOf(text)
	// Sliced by characters from a byte budget: `slice` on a UTF-16 index
	// can only land at or under the byte cap, never over it.
	const kept = text.slice(0, WIRE_RAW_LIMIT)
	const marker = `truncated, ${bytes} bytes`
	notes.push(
		`${field} on this receipt is ${marker}; the message row holds all of it`
	)
	return {
		...bag,
		[field]: kept,
		...(bag.main === text ? { main: kept } : {}),
		[`${field}Truncated`]: { bytes, kept: bytesOf(kept), marker }
	}
}

/**
 * The receipt as STORED: the reply text (and reasoning) on a generate node's
 * output, and on the save node's input, bounded.
 *
 * Since the one road, the generate node's output — `text`, and `main` which is
 * the same string — is the whole reply, and it lands in `pipeline_runs.receipt`
 * as the node recorded it. The adapter road capped the reply it wrote onto the
 * receipt at `WIRE_RAW_LIMIT` (the same cap a recorded wire response is held
 * to); that patch is gone, so the cap is applied here, where the receipt meets
 * the column. Nothing about the RUN changes — the node's published value is
 * the port the save read, untouched — only what is kept of it afterwards.
 *
 * `update-message`'s `input.text`/`input.thinking` carry the same reply a
 * generate node already published, recorded a second time as this node's own
 * input — so the same bound applies there, and to a generate node's own
 * `output.thinking` beside `text`.
 *
 * The truncation is said on the node: a `<field>Truncated` marker beside the
 * field with the original size, and a note, so a reader who finds a reply cut
 * short on the receipt is told it was the receipt and not the reply.
 *
 * A new object rather than a mutation, because the receipt in hand is also the
 * one the trigger returns to its caller and the run-end hook was handed.
 */
export function boundedForStorage(receipt: Receipt): Receipt {
	let changed = false
	const nodes = receipt.nodes.map((n) => {
		const isGenerate = GENERATE_TYPE.test(n.definitionId)
		const isUpdateMessage = UPDATE_MESSAGE_TYPE.test(n.definitionId)
		if (!isGenerate && !isUpdateMessage) return n

		const notes: string[] = []
		let output = n.output as Record<string, unknown> | null | undefined
		if (isGenerate && output && typeof output === "object") {
			const boundedOutput = boundedField(
				boundedField(output, "text", notes),
				"thinking",
				notes
			)
			if (boundedOutput !== output) output = boundedOutput
		}
		let input = n.input as Record<string, unknown> | null | undefined
		if (isUpdateMessage && input && typeof input === "object") {
			const boundedInput = boundedField(
				boundedField(input, "text", notes),
				"thinking",
				notes
			)
			if (boundedInput !== input) input = boundedInput
		}
		if (!notes.length) return n
		changed = true
		return {
			...n,
			...(output !== n.output ? { output } : {}),
			...(input !== n.input ? { input } : {}),
			notes: [...(n.notes ?? []), ...notes]
		}
	})
	return changed ? { ...receipt, nodes } : receipt
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
	const pinned =
		scope.specVersionId != null && scope.specHash
			? { id: scope.specVersionId, hash: scope.specHash }
			: await resolveSpecVersion(db, receipt.specId, receipt.specVersion)
	try {
		const [row] = await db
			.insert(schema.pipelineRuns)
			.values({
				runId: receipt.runId,
				specSlug: receipt.specId,
				specVersion: receipt.specVersion,
				specVersionId: scope.specVersionId ?? pinned.id,
				specHash: scope.specHash ?? pinned.hash,
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
				 * Since 09-B B4 the two agree by construction: a preview is a
				 * dry run, its outlets commit nothing, and every reply runs to
				 * the end and writes through its own outlet. The rule stays
				 * stated in both halves because the column's three consumers —
				 * `pipelines:sessionEntryUsage` (`is_preview = false`),
				 * `lastRunFor` and every panel reading them — ask "did this run
				 * leave something behind", and leaving something behind is what
				 * makes a run not a preview, whichever artifact it was.
				 */
				isPreview: artifacts.length === 0 && Boolean(receipt.preview),
				// Lineage (01 §8; U5d): what the executor stamped from
				// `RunOptions.lineage`, or a root's nothing at depth 0.
				parentRunId: receipt.parentRunId ?? null,
				rootRunId: receipt.rootRunId ?? null,
				depth: receipt.depth ?? 0,
				startedAt: new Date(receipt.startedAt),
				endedAt: new Date(receipt.endedAt),
				elapsedMs: Math.max(0, receipt.endedAt - receipt.startedAt),
				tokensSpent: receipt.consumption?.tokens ?? 0,
				receipt: boundedForStorage(receipt) as unknown as Record<
					string,
					unknown
				>
			})
			.returning()

		if (receipt.nodes?.length)
			await db.insert(schema.pipelineRunNodes).values(
				receipt.nodes.map((n) => ({
					runId: row.id,
					seq: n.seq,
					nodeKey: n.nodeKey,
					kind: n.kind,
					definitionId: n.definitionId,
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

		// The ranking store (R64): every node publishing decisions, recorded
		// from the full receipt (not the bounded copy stored above). A
		// preview that left nothing behind stays in memory (§3.9).
		if (!(artifacts.length === 0 && receipt.preview)) {
			const { recordRankings } = await import(
				"$lib/server/pipelines/runtime/rankingStore"
			)
			await recordRankings(db, receipt, {
				runRowId: row.id,
				sessionId: scope.sessionId ?? null,
				userId: scope.userId ?? null
			})
		}

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
): Promise<
	Array<
		typeof schema.pipelineRuns.$inferSelect & {
			/** What this run did to the row — every action it recorded. */
			actions: RunArtifact["action"][]
		}
	>
> {
	const hits = await db
		.select({
			runId: schema.pipelineRunArtifacts.runId,
			action: schema.pipelineRunArtifacts.action
		})
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
	const actionsByRun = new Map<number, RunArtifact["action"][]>()
	for (const h of hits) {
		const list = actionsByRun.get(h.runId) ?? []
		list.push(h.action as RunArtifact["action"])
		actionsByRun.set(h.runId, list)
	}

	const runs = await db
		.select()
		.from(schema.pipelineRuns)
		.where(inArray(schema.pipelineRuns.id, [...actionsByRun.keys()]))
		.orderBy(desc(schema.pipelineRuns.id))
	return runs.map((r) => ({ ...r, actions: actionsByRun.get(r.id) ?? [] }))
}

/**
 * Did this run WRITE the row's content — as opposed to hiding, editing,
 * swiping or deleting it (a built-in, R-15)? The question "which run
 * produced this reply" filters on it: a built-in's receipt has no prompt.
 */
export const wroteContent = (actions: RunArtifact["action"][]): boolean =>
	actions.some((a) => a === "created" || a === "updated")

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
