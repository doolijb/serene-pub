/**
 * The run's live row — core's half of "the pipeline owns its row" (09-B B4).
 *
 * The executor knows WHICH row a run is currently filling (`RunFacts.liveRow`,
 * the row its placeholder outlet committed) and tells the host on every oracle
 * call and once more when the run ends. Everything that happens TO that row
 * while the run is between its placeholder and its final write is here:
 *
 *  · **streaming** (R-21 (2)) — the oracle publishes its stream and stays blind
 *    to messages; this is where core routes it. The buffer is core's, which is
 *    why Stop can leave the partial text behind: no node holds it.
 *  · **the queue item and the status** — what the client's Stop cancels by,
 *    and the status the row shows while it waits (R-19): *{speaker} is
 *    typing*, *loading the model* — whatever the run's status relay says
 *    (`runStatus.ts`), written onto `generationStatus`. The retired
 *    `generationStage` enum is written by nothing.
 *  · **the end** (R-17) — a run that stopped, failed or halted with its row
 *    still generating has nothing left to run, so this finalises it: stopped
 *    with the partial, failed with the reason, released if it merely ended.
 *
 * One object per run, created by `runSpec` and handed to the host through the
 * scope. It never decides which row is live — the executor says — and it never
 * decides which oracle streams: `narratingProvider` reads that off the document
 * once, because a multi-stage spec's planner and keeper must not write JSON
 * into the row the narrator is filling.
 *
 * ## Fences
 *
 * Every write here is fenced on `isGenerating = true` and, once one exists, on
 * the queue item this run put on the row. `sessionMessages:cancel` releases the
 * row FIRST and unconditionally — that is the client's guarantee — so a frame
 * that lands after a stop cannot resurrect the row, and the finalisation at the
 * end is a no-op on a row somebody has already released. The cost is the
 * frames the throttle had not persisted yet; the same cost the adapter road
 * always paid, and the price of the client never waiting on the model to stop.
 */

import { randomUUID } from "node:crypto"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { updateLegacyWhere } from "$lib/server/messages/store"
import { broadcastToSessionUsers } from "$lib/server/sockets/utils/broadcastHelpers"
import {
	persistGenerationErrorRow,
	persistGenerationStatus
} from "$lib/server/utils/generationStatus"
import { ComposedError } from "$lib/server/connections/visibility"
import type { StatusText } from "@serene-pub/sdk"
import { resolveThinking } from "$lib/shared/utils/thinkingDelimiters"
import { joinContinuation } from "$lib/server/messages/continuation"
import type { AuthenticatedSocket } from "$lib/server/sockets/auth"
import { setLiveRow } from "$lib/server/pipelines/runtime/runRegistry"
import { recordSessionChange } from "$lib/server/messages/sessionChanges"

// db is the global Db — see db/types.d.ts

/** Where a session's rows are announced. Absent, nothing is broadcast. */
export type SessionIo = AuthenticatedSocket["io"] | undefined

/** Mid-stream persistence cadence — well below what reads as choppy. */
const STREAM_PERSIST_THROTTLE_MS = 120

export interface LiveRowOptions {
	db: Db
	io?: SessionIo
	sessionId: number
	/**
	 * The run this row belongs to, so the registry learns which row the run
	 * is filling the moment the placeholder commits — what the message's own
	 * Stop matches the released rows against (`runRegistry.cancelSession`).
	 * Absent for a run nobody registered (a preview, a test).
	 */
	runId?: string
	/**
	 * The one oracle whose stream is the reply's prose — see
	 * `narratingProvider`. Undefined streams nothing: the row fills when the
	 * write lands.
	 */
	streamingNode?: string
}

/** The callbacks an oracle's dispatch streams into, when this call streams. */
export interface LiveStream {
	onChunk: (chunk: string) => void
	onThinking: (chunk: string) => void
}

export interface LiveRow {
	/** The row this run is filling, once its placeholder committed. */
	readonly id: number | undefined
	/** The text streamed so far, joined onto the prefill a continue started from. */
	readonly text: string
	/**
	 * What the row held when the placeholder claimed it — a continue's
	 * partial, empty otherwise. The final write joins onto THIS, never onto
	 * the row's current text, which the stream has been rewriting.
	 */
	readonly prefill: string
	/**
	 * Whether the row is narration — the narrator's or a side character's
	 * line — as the placeholder committed it. Undefined until one has. What
	 * the queue's task type is derived from, so a narrator call is filed as
	 * one whatever the oracle's payload says.
	 */
	readonly narration: boolean | undefined
	/**
	 * Whether the row was opened AS a placeholder — generating, waiting on
	 * this run to fill it. A create-message that commits a complete row is
	 * still the run's live row for streaming purposes, but it is not a row a
	 * Stop finalises or a late save is dropped for: it was never open.
	 */
	readonly placeholder: boolean
	/** The placeholder committed: remember the row, and what it already held. */
	opened(row: {
		id: number
		content: string | null
		isGenerating?: boolean | null
		isNarratorResponse?: boolean | null
	}): void
	/**
	 * Fence this run's writes on a queue item and put it on the row, so the
	 * client's Stop can cancel by it. Once per call; returns the id.
	 */
	claim(row: number): Promise<string>
	/**
	 * The run's status (R-19), onto the row's `generationStatus` — a no-op
	 * until the placeholder has committed, since there is no row to say it
	 * on. Fenced like every other write here; the row is announced from the
	 * write, the same `sessionMessage` frame the stream uses.
	 */
	status(text: StatusText): Promise<void>
	/**
	 * Where this call's stream goes — into `row` if this is the streaming
	 * oracle, nowhere otherwise. Called by the host per oracle call with the
	 * executor's `run.liveRow`.
	 */
	attach(
		row: number | string | undefined,
		nodeKey: string
	): LiveStream | undefined
	/** Flush what the throttle held back, once the stream has drained. */
	flush(): Promise<void>
	/**
	 * What an oracle's call threw, kept as the OBJECT. The executor carries
	 * only the message onto the receipt, and the message alone cannot say
	 * whether the words are ours (`ComposedError`, shown as written) or a
	 * service's (moved into the administrator-only field) — that is the
	 * class, and only the host still has it when the run ends.
	 */
	failedWith(err: unknown): void
	/**
	 * The run ended. A row still generating is finalised: stopped with the
	 * partial text, failed with the reason, or released. A row already
	 * settled — by the update, or by a Stop that got there first — is left
	 * exactly as it is.
	 */
	finish(end: {
		kind: "ok" | "halt" | "err" | "cancelled"
		liveRow?: number | string
		reason?: string
	}): Promise<void>
}

export function createLiveRow(opts: LiveRowOptions): LiveRow {
	const { db, io, sessionId } = opts
	let id: number | undefined
	let prefill = ""
	let narration: boolean | undefined
	let placeholder = false
	let queueItemId: string | null = null
	let streamed = ""
	let nativeThinking = ""
	let lastPersistedAt = 0
	let pending: Promise<void> | null = null
	let lastError: unknown

	/** The row as the reader should see it right now: stripped, joined. */
	const display = () => {
		const resolved = resolveThinking(streamed.trim(), nativeThinking)
		return joinContinuation(prefill, resolved.content)
	}

	const fence = (row: number) =>
		and(
			eq(schema.sessionMessages.id, row),
			eq(schema.sessionMessages.isGenerating, true),
			...(queueItemId
				? [eq(schema.sessionMessages.queueItemId, queueItemId)]
				: [])
		)

	/**
	 * Announcements leave in the order their writes landed.
	 *
	 * `broadcastToSessionUsers` awaits a roster lookup before it emits, so two
	 * frames whose writes committed in order could still reach the room out of
	 * order — and a client that painted the later frame first would then paint
	 * the earlier, shorter text over it. One chain rather than a sequence
	 * number: ordering on the server is enough, and the client keeps reading
	 * frames exactly as it does today.
	 */
	let announcing: Promise<void> = Promise.resolve()
	const announce = (row: typeof schema.sessionMessages.$inferSelect) => {
		if (!io) return Promise.resolve()
		announcing = announcing.then(() =>
			broadcastToSessionUsers(io, sessionId, "sessionMessage", {
				sessionMessage: row
			}).catch(() => {})
		)
		return announcing
	}

	const persist = async () => {
		if (id === undefined) return
		const [updated] = await updateLegacyWhere(db, fence(id), {
			content: display(),
			isGenerating: true
		})
		if (updated) await announce(updated)
	}

	return {
		get id() {
			return id
		},
		get text() {
			return display()
		},
		get prefill() {
			return prefill
		},
		get narration() {
			return narration
		},
		get placeholder() {
			return placeholder
		},
		opened(row) {
			id = row.id
			prefill = row.content ?? ""
			narration = row.isNarratorResponse === true
			placeholder = row.isGenerating === true
			if (opts.runId) setLiveRow(opts.runId, row.id)
		},
		async claim(row) {
			queueItemId = randomUUID()
			await updateLegacyWhere(
				db,
				and(
					eq(schema.sessionMessages.id, row),
					eq(schema.sessionMessages.isGenerating, true)
				),
				{ queueItemId }
			)
			return queueItemId
		},
		async status(text) {
			if (id === undefined) return
			await persistGenerationStatus(
				db,
				id,
				sessionId,
				io,
				text,
				queueItemId ?? undefined
			)
		},
		attach(row, nodeKey) {
			if (typeof row !== "number" || nodeKey !== opts.streamingNode)
				return undefined
			if (id === undefined) id = row
			return {
				onChunk: (chunk) => {
					streamed += chunk
					const now = Date.now()
					if (now - lastPersistedAt < STREAM_PERSIST_THROTTLE_MS)
						return
					lastPersistedAt = now
					// Fire and forget, fenced — see the header.
					pending = persist().catch(() => {})
				},
				onThinking: (chunk) => {
					nativeThinking += chunk
				}
			}
		},
		async flush() {
			await pending
			if (streamed) await persist()
		},
		failedWith(err) {
			lastError = err
		},
		async finish(end) {
			const row = typeof end.liveRow === "number" ? end.liveRow : id
			if (row === undefined) return
			// Before deciding anything: a frame still in flight must land
			// before the release, or it would land after it and be fenced out
			// — which is right — while the text it carried is lost.
			await pending
			if (end.kind === "err" || end.kind === "halt") {
				// A run that failed, or halted with its row still open (the
				// model returned nothing, a reviewer rejected the write), owes
				// the person a reason on the row rather than a spinner.
				// `persistGenerationErrorRow` is fenced on the row still
				// generating — a no-op if the update already landed — and it
				// is where the redaction rule lives: the thrown object where
				// the host kept one, else the receipt's reason, which is the
				// executor's or a binding's own sentence.
				await persistGenerationErrorRow(
					io,
					sessionId,
					row,
					lastError ??
						new ComposedError(
							end.reason ?? "the turn produced no reply"
						),
					queueItemId ?? undefined
				)
				return
			}
			// Stopped, or ended without ever filling its row: the row leaves
			// the generating state holding whatever arrived. A stop says so
			// on the row (`generationOutcome: 'stopped'`, R-15) and is
			// recorded as a change for the next reply's inlet — by whichever
			// release won the fence, so the message's own Stop, which
			// releases first when it lands first, records it instead and this
			// write is the no-op the fence makes it.
			const stopped = end.kind === "cancelled"
			const [released] = await updateLegacyWhere(db, fence(row), {
				content: display(),
				isGenerating: false,
				generationStatus: null,
				queueItemId: null,
				error: null,
				...(stopped ? { generationOutcome: "stopped" } : {})
			})
			if (released) {
				await announce(released)
				if (stopped)
					await recordSessionChange(db, {
						event: "core:event/message-stopped@1",
						sessionId,
						messageId: released.id,
						textLength: released.content.length,
						runId: opts.runId
					})
			}
		}
	}
}
