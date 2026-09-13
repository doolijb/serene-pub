/**
 * A reply whose spec has more than one generating stage.
 *
 * ## Why this is a second road rather than a flag on the first
 *
 * `generateResponse` compiles the turn, takes the payload the pipeline halted
 * with, and lets a connection adapter send it. That is exactly right for a spec
 * with ONE Provider on the spine: the halt lands where the adapter takes over
 * and nothing downstream is lost, which is every reply this product has shipped.
 *
 * For a spec with several, the same halt stops at the FIRST stage — so an
 * Adventure turn sent the planner's prompt, wrote the planner's JSON to the
 * screen as the reply, and never narrated, never gave the cast a voice and never
 * ran the state-keeper. The stages after the first are not a detail the adapter
 * could be taught: they are the pipeline, and the only thing that can run them
 * is the executor. So this runs the document to completion and the spec's own
 * Consumer writes the reply, into the row the trigger already created
 * (`HostScope.fillMessageId`).
 *
 * ## One stop, three shapes
 *
 * The run is registered with `runRegistry` and enqueued on the LLM queue, so a
 * turn can be stopped from either surface a person actually has: the message's
 * own Stop button (`sessionMessages:cancel` → `llmQueue.cancel` → `onCancel`
 * here) and the progress card's X (`pipelines:cancelRun` → `runRegistry.cancel`).
 * Both end at ONE `AbortController`, the registry's, because a second controller
 * would be a second source and two sources of one truth is how a run gets
 * cancelled in one half of itself. From there the fact travels in each
 * boundary's own shape: the adapters get the signal as an event, and the
 * executor — which only ever pauses between nodes — polls `cancellation()`.
 *
 * ## What streams
 *
 * Exactly one node, chosen from the document by `narratingProvider`. A run has
 * one sink, so letting every Provider write to it would put the planner's JSON,
 * the keeper's JSON and several parallel voices into the message row on top of
 * each other. Everything else reports as a STAGE on the run progress card.
 */

import { and, eq } from "drizzle-orm"
import { v4 as uuidv4 } from "uuid"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { updateLegacyWhere } from "$lib/server/messages/store"
import { broadcastToSessionUsers } from "../sockets/utils/broadcastHelpers"
import { ComposedError } from "$lib/server/connections/visibility"
import { llmQueue, isQueueCancellation } from "./llmQueue"
import {
	persistGenerationStage,
	persistGenerationErrorRow
} from "./generationStatus"
import { buildThinkingMetadata } from "$lib/server/messages/thinkingMetadata"
import { resolveThinking } from "$lib/shared/utils/thinkingDelimiters"
import {
	autoEnqueueSession,
	ensureSessionMessageEmbedded
} from "$lib/server/embedding/vectorizationQueue"
import {
	narratingProvider,
	spineProviders
} from "$lib/server/pipelines/runtime/specShape"
import { announceStateChanges } from "$lib/server/state/announce"
import type { Receipt, SpecDocument } from "@serene-pub/sdk"

/** A node key as a person reads it: `voices.item.say` → "voices say". */
function stageOf(nodeKey: string): string {
	return nodeKey
		.split(".")
		.filter((part) => part !== "item")
		.join(" ")
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.toLowerCase()
}

/** Mid-stream persistence cadence, the same one the adapter path uses. */
const STREAM_PERSIST_THROTTLE_MS = 120

export interface FullRunReply {
	socket: any
	emitToUser: (event: string, data: any) => void
	sessionId: number
	userId: number
	generatingMessage: SelectSessionMessage
	/** The spec the function router picked, and the document it resolved to. */
	specId: string
	doc: SpecDocument
	/** Whose turn it is — null in narrator mode, as everywhere else. */
	currentCharacterId: number | null
	speaker?: {
		name: string
		characterId: number | null
		known: boolean
		character?: Record<string, unknown> | null
	} | null
	/** The partial a continue is resuming from. Absent on every other turn. */
	continuationPrefill?: string
	/** What to call this turn on the progress card. */
	label: string
	/** Set when the preset's binding did not resolve — see `resolveFunctionVerdict`. */
	meta?: Record<string, unknown>
}

export async function runReplyToCompletion(
	request: FullRunReply
): Promise<boolean> {
	const {
		socket,
		emitToUser,
		sessionId,
		userId,
		generatingMessage,
		specId,
		doc,
		label
	} = request
	const messageId = generatingMessage.id

	const runRegistry = await import(
		"$lib/server/pipelines/runtime/runRegistry"
	)
	const runId = uuidv4()
	const handle = runRegistry.start({ runId, userId, sessionId, specId })

	const streamingNode = narratingProvider(doc)
	let declaredStages = spineProviders(doc).length
	let stagesSeen = 0

	const progress = (event: Record<string, unknown>) =>
		emitToUser("pipelines:progress", {
			runId,
			sessionId,
			specId,
			label,
			...event
		})

	emitToUser("pipelines:runStarted", {
		runId,
		sessionId,
		specId,
		label,
		steps: declaredStages
	})

	// The queue item id goes on the row BEFORE anything is enqueued, so a very
	// fast Stop can never find a generating row with nothing to cancel — the
	// same order, and the same reason, as the adapter path.
	const queueItemId = uuidv4()
	await updateLegacyWhere(db, eq(schema.sessionMessages.id, messageId), {
		queueItemId
	})

	/** The narrator's tokens as they arrive, for the row the player is watching. */
	let streamed = ""
	let nativeThinking = ""
	let streamingNow = false
	let lastPersistedAt = 0

	const persistStreamed = async () => {
		const resolved = resolveThinking(streamed.trim(), nativeThinking)
		const [updated] = await updateLegacyWhere(
			db,
			and(
				eq(schema.sessionMessages.id, messageId),
				eq(schema.sessionMessages.isGenerating, true),
				eq(schema.sessionMessages.queueItemId, queueItemId)
			),
			{ content: resolved.content, isGenerating: true }
		)
		if (updated)
			await broadcastToSessionUsers(
				socket.io,
				sessionId,
				"sessionMessage",
				{ sessionMessage: updated }
			)
	}

	const { haltExplanation, runTurn } = await import(
		"$lib/server/pipelines/runtime/runTurn"
	)

	let stopped: { by: string; reason: string } | undefined
	try {
		const { done } = llmQueue.enqueue(
			{
				taskType: "session",
				// Each stage owns its own `connection` and `sampling` slots and
				// resolves them for itself, so there is no one name to give the
				// queue's snapshot. Saying so is better than naming whichever the
				// first stage happened to pick.
				connectionName: "per step",
				samplingName: "per step",
				sessionId,
				messageId,
				label,
				userId,
				/**
				 * ⚠ The queue's own `signal` is deliberately unused. Its stop
				 * reaches this run through `onCancel` below, which goes to the one
				 * controller the registry holds; taking the queue's signal here as
				 * well would be a second source, and the executor would be polling
				 * one while the adapters listened to the other.
				 */
				execute: async () => {
					const receipt = await runTurn({
						db,
						sessionId,
						userId,
						currentCharacterId: request.currentCharacterId,
						speaker: request.speaker ?? null,
						text: "",
						continuationPrefill: request.continuationPrefill,
						specId,
						runId,
						// The row the trigger created. Without it the spec's
						// Consumer would insert a SECOND message and leave the
						// player's placeholder generating forever.
						fillMessageId: messageId,
						signal: handle.controller.signal,
						cancelSignal: () => runRegistry.cancellation(handle),
						sink: {
							onChunk: (chunk: string) => {
								if (!streamingNow) return
								streamed += chunk
								const now = Date.now()
								if (
									now - lastPersistedAt <
									STREAM_PERSIST_THROTTLE_MS
								)
									return
								lastPersistedAt = now
								// Fire and forget, exactly as the adapter path's
								// per-chunk write is: the write is fenced on the
								// queue item, so a frame that lands after a stop
								// cannot resurrect the row.
								void persistStreamed().catch(() => {})
							},
							onThinking: (chunk: string) => {
								if (streamingNow) nativeThinking += chunk
							}
						},
						onNode: (event) => {
							if (event.kind !== "provider") return
							if (event.nodeKey === streamingNode)
								streamingNow = event.phase === "start"
							if (event.phase !== "start") return
							stagesSeen += 1
							declaredStages = Math.max(
								declaredStages,
								stagesSeen
							)
							progress({
								stage: stageOf(event.nodeKey),
								nodeKey: event.nodeKey,
								step: stagesSeen,
								steps: declaredStages
							})
						},
						...(request.meta ? { meta: request.meta } : {})
					})
					return receipt
				},
				// The queue's stop, forwarded to the ONE controller this run has.
				// `cancel` records who asked, which is the half an `AbortSignal`
				// cannot carry and the half the receipt wants.
				onCancel: () => {
					runRegistry.cancel(runId, userId)
				},
				onStatusChange: (status) =>
					persistGenerationStage(
						messageId,
						sessionId,
						socket.io,
						status
					)
			},
			queueItemId
		)

		const receipt = await done
		// Read before `finish`: one projection of the abort, shared by every
		// branch below, so they cannot disagree about whether this turn was
		// stopped. Cancellation is decided by the ABORT and never by the
		// receipt — a node that halts on its own abort ends the run before the
		// executor, which only pauses between nodes, reaches its cancel hook.
		stopped = runRegistry.cancellation(handle)

		const [row] = await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, messageId))
			.limit(1)

		/**
		 * Whether the spec's own Consumer committed the reply.
		 *
		 * Off the receipt rather than off the row, because the row alone cannot
		 * tell "the Consumer wrote it" from "somebody pressed Stop and the
		 * cancel handler cleared the flags". Both conditions together is the
		 * honest test: the node says it wrote, and the row has left the
		 * generating state — the second half is what a review gate parks in
		 * front of.
		 */
		const wrote =
			!!row &&
			!row.isGenerating &&
			receipt.nodes.some(
				(n) =>
					String(n.typeId ?? "").startsWith(
						"core:consumer/create-message"
					) && n.result === "ok"
			)

		if (wrote) {
			await settleMessage(request, receipt, row)
			await announceStateChanges(socket.io, sessionId, receipt)
			// A turn that wrote its reply and then stopped has still written
			// it, and the answer says the turn did not run to the end — which
			// is what the trigger loop reads it for.
			return !stopped && receipt.outcome === "ok"
		}

		if (stopped) {
			// Idempotent with `sessionMessages:cancel`, which clears the row
			// first and unconditionally. It is not the only stop there is: the
			// progress card cancels the RUN, and nothing else would ever take
			// this row out of "generating".
			await releaseRow(socket, sessionId, messageId)
			return false
		}

		await persistGenerationErrorRow(
			socket.io,
			sessionId,
			messageId,
			new ComposedError(
				haltExplanation(receipt) ?? "The turn produced no reply."
			)
		)
		return false
	} catch (err) {
		stopped ??= runRegistry.cancellation(handle)
		if (stopped || isQueueCancellation(err)) {
			await releaseRow(socket, sessionId, messageId)
			return false
		}
		await persistGenerationErrorRow(socket.io, sessionId, messageId, err)
		return false
	} finally {
		// Always: a run left registered is a leak and a stale cancel target,
		// and the client's progress card would never clear.
		runRegistry.finish(runId)
		progress({ done: true, ...(stopped ? { cancelled: true } : {}) })
	}
}

/**
 * The row the Consumer filled, finished off.
 *
 * The text is already there — `create-message` wrote it — so this is the part a
 * Consumer has no way to do: the swipe slot and the reasoning trace, whose
 * invariants `projectLegacy` states and `buildThinkingMetadata` is the one place
 * that maintains. A row with no swipe history and no trace needs neither, and
 * the builder answers that with null rather than a write.
 */
async function settleMessage(
	request: FullRunReply,
	receipt: Receipt,
	row: SelectSessionMessage
): Promise<void> {
	const { socket, sessionId } = request
	const messageId = row.id

	// The narrator's reasoning, off the node that produced the prose. The
	// dispatch already separated it from the text before the text reached the
	// port, so this is a read rather than a second parse.
	const streamingNode = narratingProvider(request.doc)
	const thinking = receipt.nodes.find((n) => n.nodeKey === streamingNode)
		?.output as { thinking?: unknown } | undefined
	const trace =
		typeof thinking?.thinking === "string" && thinking.thinking.length
			? thinking.thinking
			: undefined

	const metadata = buildThinkingMetadata(
		row.metadata,
		row.content ?? "",
		trace,
		true
	)
	const finished =
		metadata !== null
			? ((
					await updateLegacyWhere(
						db,
						eq(schema.sessionMessages.id, messageId),
						{ metadata }
					)
				)[0] ?? row)
			: row
	await broadcastToSessionUsers(socket.io, sessionId, "sessionMessage", {
		sessionMessage: finished
	})

	try {
		await ensureSessionMessageEmbedded(messageId)
	} catch (err) {
		// Swallowed on purpose: `autoEnqueueSession` below is the fallback that
		// catches this message up through the background queue either way.
		console.error(
			"[vectorization] Inline embed of new message failed:",
			err
		)
	}
	autoEnqueueSession(sessionId).catch(console.error)
}

/**
 * Take a row out of "generating" when nothing else will.
 *
 * Fenced on the flag rather than on the queue item, so it is a no-op for a row
 * `sessionMessages:cancel` has already cleared — that handler nulls
 * `queueItemId` as the very first thing it does, which a fence on the id would
 * read as "not mine" and leave the row spinning forever.
 */
async function releaseRow(
	socket: any,
	sessionId: number,
	messageId: number
): Promise<void> {
	const [released] = await updateLegacyWhere(
		db,
		and(
			eq(schema.sessionMessages.id, messageId),
			eq(schema.sessionMessages.isGenerating, true)
		),
		{
			isGenerating: false,
			generationStage: null,
			queueItemId: null,
			error: null
		}
	)
	if (released)
		await broadcastToSessionUsers(socket.io, sessionId, "sessionMessage", {
			sessionMessage: released
		})
}
