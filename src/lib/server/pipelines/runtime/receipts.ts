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

import type { Outcome, Receipt } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { WIRE_RAW_LIMIT } from "$lib/server/connectionAdapters/BaseConnectionAdapter"
import { REPLY_SENT_BY_ADAPTER } from "$lib/shared/constants/replyReceipt"
import { eq, and, asc, desc, inArray, sql } from "drizzle-orm"

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
				 * These read as the same question and are not. A reply whose spec
				 * has ONE Provider on the spine runs
				 * `runTurn({ preview: true })` because the ADAPTER makes the
				 * provider call, so the pipeline deliberately stops at the
				 * pre-call substrate and hands its payload over — and then a
				 * real message is written. `Boolean(receipt.preview)` alone
				 * therefore recorded **every reply in the product** as a
				 * preview, which silently emptied all three consumers of the
				 * column: `pipelines:sessionEntryUsage` (`is_preview = false`),
				 * `lastRunFor` (the query for "did this reply come from the
				 * pipeline"), and by extension every panel reading them.
				 *
				 * A multi-stage spec takes the other road (`runReplyToCompletion`)
				 * and commits through its own Consumer, so it is not a preview
				 * by either half of this test.
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
 * The generate node on a stored receipt, or nothing.
 *
 * Every patch below edits this one node, and all four ask for it the same way:
 * a spec with no generate node, or a run that halted before reaching one, has
 * nothing to annotate. Silence rather than an invented node — the receipt is
 * evidence, and evidence does not grow entries.
 */
function generateNodeOf<T extends { typeId?: string }>(
	receipt: { nodes?: T[] } | null
): T | undefined {
	return receipt?.nodes?.find((n) =>
		String(n?.typeId ?? "").startsWith("core:provider/generate-text")
	)
}

/**
 * Write the composed stop sequences onto an already-stored receipt's generate
 * node.
 *
 * ## Why a patch, and why only one caller
 *
 * On every path whose Provider node actually fires, the stop list rides the
 * binding's own output and lands here with the rest of the receipt — no patch
 * involved. The single-Provider REPLY path is the exception, and it is the one
 * users spend their day on: it runs `runTurn({ preview: true })` so the pipeline
 * stops at the pre-call substrate and hands its payload to the adapter, which
 * means the receipt is stored *before* anything has composed a stop list at all.
 * Without this, the panel would show a Stops row for summarize and lore runs and
 * nothing for a single reply. A multi-stage reply needs no patch: its Providers
 * fire.
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
		const node = generateNodeOf(receipt)
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

/**
 * Write the exchange an adapter recorded onto an already-stored receipt's
 * generate node — the same patch `recordGenerateStops` makes, for the same
 * reason.
 *
 * ## Under `output`, beside the stop record
 *
 * Where a Provider node fires, the exchange rides the binding's own output and
 * lands here with the rest of the receipt. The single-Provider REPLY path is
 * the exception the patch exists for: the pipeline stops at the pre-call
 * substrate and the adapter beside it does the sending, so the receipt is
 * stored before there is a request to record.
 *
 * ⚠ **Administrator-only, by the key it is stored under.** The exchange names
 * the base URL, the model and the body, and `withoutConnectionIdentity`
 * removes `wire` at every egress. Nothing else on the node moves.
 *
 * Never throws, for the reason `saveReceipt` never throws. A run id nothing
 * matches is a no-op, and so is an adapter that recorded nothing.
 */
export async function recordGenerateWire(
	db: Db,
	runId: string,
	wire: unknown
): Promise<void> {
	if (!wire) return
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
		const node = generateNodeOf(receipt)
		if (!node) return
		node.output = {
			...((node.output as Record<string, unknown> | null) ?? {}),
			wire
		}
		await db
			.update(schema.pipelineRuns)
			.set({ receipt: receipt as unknown as Record<string, unknown> })
			.where(eq(schema.pipelineRuns.id, row.id))
	} catch (err) {
		console.warn(
			"[pipelines] could not record this run's exchange — the turn " +
				"itself was unaffected:",
			err
		)
	}
}

/**
 * Write prompt-cache usage onto an already-stored receipt's generate node —
 * the same patch `recordGenerateStops` makes, for the same reason.
 *
 * ## Off the node, not off `output`
 *
 * The SDK executor's `ctx.reportCacheUsage?.()` writes these three fields
 * directly on the node receipt (`nr.tokensPrompt = …`), and
 * `sockets/pipelines.ts`'s `promptCacheFromReceipt` reads them from the same
 * place. Nesting them under `output` here — the way `recordGenerateStops`
 * nests `stops` — would put a real reply's usage somewhere that reader never
 * looks, the same silent gap this patch exists to close.
 *
 * ⚠ **Absent stays absent.** Only a key the adapter actually reported is
 * written; a service that never says is not the same finding as a service
 * that reused nothing, and writing 0 over the first would report the second.
 *
 * Never throws, for the same reason `recordGenerateStops` never does — a turn
 * that produced a good reply and then could not annotate its own audit trail
 * has still produced a good reply. A run id nothing matches is a no-op.
 */
export async function recordGenerateCacheUsage(
	db: Db,
	runId: string,
	usage: {
		tokensPrompt?: number
		tokensCached?: number
		tokensCacheWrite?: number
	}
): Promise<void> {
	try {
		const [row] = await db
			.select()
			.from(schema.pipelineRuns)
			.where(eq(schema.pipelineRuns.runId, runId))
			.limit(1)
		if (!row) return
		const receipt = row.receipt as {
			nodes?: {
				typeId?: string
				tokensPrompt?: number
				tokensCached?: number
				tokensCacheWrite?: number
			}[]
		} | null
		const node = generateNodeOf(receipt)
		if (!node) return
		if (typeof usage.tokensPrompt === "number")
			node.tokensPrompt = usage.tokensPrompt
		if (typeof usage.tokensCached === "number")
			node.tokensCached = usage.tokensCached
		if (typeof usage.tokensCacheWrite === "number")
			node.tokensCacheWrite = usage.tokensCacheWrite
		await db
			.update(schema.pipelineRuns)
			.set({ receipt: receipt as unknown as Record<string, unknown> })
			.where(eq(schema.pipelineRuns.id, row.id))
	} catch (err) {
		console.warn(
			"[pipelines] could not record this run's prompt-cache usage — the " +
				"turn itself was unaffected:",
			err
		)
	}
}

/** What the reply adapter did with the payload the run handed it. */
export interface ReplyOutcome {
	/**
	 * The receipt's own vocabulary, minus the one word this can never be: the
	 * pipeline's halt is the thing that already happened, and what is being
	 * recorded here is what happened AFTER it.
	 */
	result: Exclude<Outcome, "halt">
	/** Why — for anything that is not the ordinary success. */
	reason?: string
	/** The reply as the message row holds it. */
	text?: string
	/** What the service said ended it: `done_reason`, `finish_reason`. */
	finishReason?: string
	tokensPrompt?: number
	tokensCompletion?: number
	/**
	 * The reasoning half of `tokensCompletion`, where the service breaks it
	 * out. A BREAKDOWN and never an addition, so the totals below count it once
	 * through `tokensCompletion` and never again through this.
	 */
	tokensReasoning?: number
	/**
	 * The send's own duration, off the adapter's exchange — the span both the
	 * generate node and the run itself are extended by.
	 */
	elapsedMs?: number
}

/** The reply, at the same cap a recorded response is held to. */
function cappedReply(text: string): { text: string; truncated?: true } {
	return text.length > WIRE_RAW_LIMIT
		? { text: text.slice(0, WIRE_RAW_LIMIT), truncated: true }
		: { text }
}

/** Said on a node whose service named no counts, so the 0 beside it is read right. */
const NO_TOKEN_COUNTS = "the service reported no token counts for this reply"

/**
 * Write what the reply adapter did onto an already-stored receipt — the run's
 * last word, and the same kind of patch `recordGenerateStops` makes.
 *
 * ## Why the stored receipt is wrong until this runs
 *
 * A spec with ONE Provider on the spine compiles under `runTurn({ preview: true })`
 * and hands its payload to the connection adapter, which sends it and fills in
 * the message. The receipt is written at that halt — before the send — so
 * without this every reply in the product reads `halt`, "preview: stopped
 * before generate, nothing sent" and 0 tokens, beside a message that was
 * written and a service that reported what the call cost. The halt is true when
 * it is stored and false by the time anybody reads it.
 *
 * ⚠ **`preview` stays.** It is the record of the substrate the adapter was
 * handed, and what makes the send explicable at all. `is_preview` is a
 * different question — "was anything produced" — and is not touched here.
 *
 * ⚠ **Absent stays absent.** A service that reported no counts leaves the total
 * at 0 and says so in a note; a 0 presented as a measurement would report a free
 * reply.
 *
 * ⚠ **The run's span covers the send.** Written at the pre-call halt, `endedAt`
 * and `elapsedMs` measure the compile alone — a header reading tens of
 * milliseconds beside a generate node that spent the whole exchange. The
 * adapter's own duration is the rest of the same run; `startedAt` never moves.
 *
 * Never throws, for the reason `saveReceipt` never throws — a turn that produced
 * a good reply and then could not annotate its own audit trail has still
 * produced a good reply. A run id nothing matches is a no-op.
 */
export async function recordReplyOutcome(
	db: Db,
	runId: string,
	outcome: ReplyOutcome
): Promise<void> {
	try {
		const [row] = await db
			.select()
			.from(schema.pipelineRuns)
			.where(eq(schema.pipelineRuns.runId, runId))
			.limit(1)
		if (!row) return
		const receipt = row.receipt as {
			outcome?: string
			haltNodeKey?: string | null
			haltReason?: string | null
			startedAt?: number
			endedAt?: number
			consumption?: { tokens?: number; nodeExecutions?: number }
			nodes?: {
				nodeKey?: string
				typeId?: string
				result?: string
				reason?: string
				output?: unknown
				notes?: string[]
				tokens?: number
				tokensPrompt?: number
				startedAt?: number
				endedAt?: number
				elapsedMs?: number
			}[]
		} | null
		if (!receipt) return

		const node = generateNodeOf(receipt)
		const reason =
			outcome.result === "ok" ? REPLY_SENT_BY_ADAPTER : outcome.reason

		// The service's own numbers, prompt and completion together — the
		// prompt half may already be on the node from `recordGenerateCacheUsage`.
		const tokensPrompt = outcome.tokensPrompt ?? node?.tokensPrompt
		const { tokensCompletion, tokensReasoning } = outcome
		const counted = [tokensPrompt, tokensCompletion].filter(
			(n): n is number => typeof n === "number" && Number.isFinite(n)
		)
		const tokens = counted.reduce((sum, n) => sum + n, 0)

		// The send's own span, or nothing where the adapter timed nothing.
		const sendMs =
			typeof outcome.elapsedMs === "number" &&
			Number.isFinite(outcome.elapsedMs)
				? Math.max(0, Math.round(outcome.elapsedMs))
				: null

		if (node) {
			node.result = outcome.result
			if (reason) node.reason = reason
			else delete node.reason
			if (typeof tokensCompletion === "number")
				node.tokens = tokensCompletion
			// The node's own span covers the substrate only. Added to rather
			// than replaced: both halves are this node's time.
			if (sendMs !== null) {
				node.elapsedMs = (node.elapsedMs ?? 0) + sendMs
				if (typeof node.startedAt === "number")
					node.endedAt = node.startedAt + node.elapsedMs
			}
			node.output = {
				...((node.output as Record<string, unknown> | null) ?? {}),
				reply: {
					...(typeof outcome.text === "string"
						? cappedReply(outcome.text)
						: {}),
					...(outcome.finishReason
						? { finishReason: outcome.finishReason }
						: {}),
					...(typeof tokensPrompt === "number"
						? { tokensPrompt }
						: {}),
					...(typeof tokensCompletion === "number"
						? { tokensCompletion }
						: {}),
					...(typeof tokensReasoning === "number"
						? { tokensReasoning }
						: {})
				}
			}
			if (!counted.length)
				node.notes = [
					...(node.notes ?? []).filter((n) => n !== NO_TOKEN_COUNTS),
					NO_TOKEN_COUNTS
				]
		}

		receipt.outcome = outcome.result
		if (outcome.result === "ok") {
			delete receipt.haltNodeKey
			delete receipt.haltReason
		} else {
			receipt.haltNodeKey = node?.nodeKey ?? receipt.haltNodeKey ?? null
			receipt.haltReason = reason ?? null
		}
		receipt.consumption = {
			nodeExecutions: receipt.consumption?.nodeExecutions ?? 0,
			tokens: counted.length ? tokens : (receipt.consumption?.tokens ?? 0)
		}

		// The run ends where the send did: the stored end plus the exchange.
		// Read off the row, so the blob and the columns cannot disagree; the
		// start is the run's own and stays as the executor recorded it.
		const startedAt = row.startedAt.getTime()
		const endedAt = row.endedAt.getTime() + (sendMs ?? 0)
		receipt.endedAt = endedAt

		await db
			.update(schema.pipelineRuns)
			.set({
				endedAt: new Date(endedAt),
				elapsedMs: Math.max(0, endedAt - startedAt),
				outcome: outcome.result,
				haltNodeKey:
					outcome.result === "ok"
						? null
						: (node?.nodeKey ?? row.haltNodeKey),
				haltReason: outcome.result === "ok" ? null : (reason ?? null),
				tokensSpent: counted.length ? tokens : row.tokensSpent,
				receipt: receipt as unknown as Record<string, unknown>
			})
			.where(eq(schema.pipelineRuns.id, row.id))

		// The queryable half of the same fact: a panel that filters on a node's
		// result reads the row, not the blob.
		if (node?.nodeKey)
			await db
				.update(schema.pipelineRunNodes)
				.set({
					result: outcome.result,
					reason: reason ?? null,
					...(typeof tokensCompletion === "number"
						? { tokens: tokensCompletion }
						: {}),
					...(typeof node.elapsedMs === "number"
						? { elapsedMs: node.elapsedMs }
						: {})
				})
				.where(
					and(
						eq(schema.pipelineRunNodes.runId, row.id),
						eq(schema.pipelineRunNodes.nodeKey, node.nodeKey)
					)
				)
	} catch (err) {
		console.warn(
			"[pipelines] could not record what this reply's adapter did — the " +
				"turn itself was unaffected:",
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
