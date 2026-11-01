/**
 * 🚧 **Message settled** (speech follow-ups A1, 2026-10-29): the one emit of
 * `core:event/message-settled@1` — ONE per line a run wrote, after that run
 * closed its receipt, so work that must never hold the line (reading it aloud)
 * starts as its own run.
 *
 * ⚠ Not `message-completed@1` (per WRITE, during the run) and not the
 * session's settle line / `history-settled@1`. Always "message settled".
 *
 * ## How the lines are found
 *
 * `emitSessionEvent` notes every `message-completed` a run caused
 * (`noteLineLanded`, keyed by the cause's run id) — one place, however the
 * line landed (create-message, a seeded greeting, update-message, a stopped
 * reply's release). `runSpecOnce` takes them once its receipt is saved
 * (`emitMessagesSettled`). A run that throws discards them (`dropLandedLines`).
 *
 * ## Decisions
 *
 *  · Off the ledger (`OFF_LEDGER`): it describes no write of its own.
 *  · A person's edit (`cause.kind: 'edit'`) is no line landing: not noted.
 *  · A hidden row, a row still generating, a blank row, a `system` row: no emit.
 *  · A stopped reply that left a partial line still settles (it IS a line);
 *    the listener reads the row and speaks none (`generationOutcome`).
 *  · `kind`: `user` a person's own send (its role is `user`), `narration` a row
 *    with no speaker, `reply` any other character's or envoy's line.
 */
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { sessionEvents } from "@serene-pub/sdk"
import type { MessageSettledPayload } from "@serene-pub/sdk"
import type { RunLineage } from "$lib/server/pipelines/runtime/lineage"
import type { SessionIo } from "$lib/server/pipelines/runtime/liveRow"
import type { RunArtifact } from "$lib/server/pipelines/runtime/receipts"
import { speakerRefOf } from "$lib/server/messages/sessionChanges"
import { canonicalChannel } from "$lib/server/messages/channels"

/** Held on `globalThis`: a Vite SSR reload would otherwise split the map (server singletons). */
const KEY = Symbol.for("serene-pub.landedLinesByRun")
const landed = ((globalThis as Record<symbol, unknown>)[KEY] ??= new Map<
	string,
	number[]
>()) as Map<string, number[]>

/** A `message-completed` the run caused landed `messageId`. */
export function noteLineLanded(runId: string, messageId: number): void {
	const ids = landed.get(runId)
	if (!ids) landed.set(runId, [messageId])
	else if (!ids.includes(messageId)) ids.push(messageId)
}

/** Take (and forget) the lines a run landed, in landing order. */
export function takeLandedLines(runId: string): number[] {
	const ids = landed.get(runId) ?? []
	landed.delete(runId)
	return ids
}

/** A run that threw: its lines are not settled. */
export const dropLandedLines = (runId: string): void => void landed.delete(runId)

/** The settled-payload facts of one row, or null when the row settles nothing. */
export function settledFactsOf(
	row: {
		role: string
		channel: string | null
		content: string
		isHidden: boolean
		isGenerating: boolean
		characterId: number | null
		personaId: number | null
		userId: number | null
		isNarratorResponse: boolean
		metadata: unknown
	}
): Pick<MessageSettledPayload, "channel" | "revision" | "speakerRef" | "kind"> | null {
	if (row.isHidden || row.isGenerating) return null
	if (row.role === "system") return null
	if (typeof row.content !== "string" || !row.content.trim()) return null
	const meta = (row.metadata ?? {}) as {
		speaker?: unknown
		swipes?: { currentIdx?: unknown }
	}
	const said = typeof meta.speaker === "string" && meta.speaker ? meta.speaker : null
	const speakerRef =
		said ??
		speakerRefOf(row) ??
		(row.role === "user" && row.userId != null ? `user:${row.userId}` : null)
	const idx = meta.swipes?.currentIdx
	return {
		channel: canonicalChannel(row.channel ?? "main"),
		revision: typeof idx === "number" && Number.isInteger(idx) && idx > 0 ? idx : 0,
		speakerRef,
		kind: row.role === "user" ? "user" : speakerRef === null ? "narration" : "reply"
	}
}

/**
 * After the run's receipt is saved: one `message-settled` per line it landed.
 * Never awaited for its listeners (`emitSessionEvent` defers them), never
 * throws — the reply is already written.
 */
export async function emitMessagesSettled(
	db: Db,
	opts: {
		runId: string
		sessionId: number
		userId: number
		artifacts: ReadonlyArray<RunArtifact>
		lineage?: RunLineage
		io?: SessionIo
	}
): Promise<void> {
	const ids = takeLandedLines(opts.runId)
	if (!ids.length) return
	try {
		const { emitSessionEvent } = await import("$lib/server/pipelines/runtime/sessionEvents")
		for (const messageId of ids) {
			const [row] = await db
				.select({
					sessionId: schema.sessionMessages.sessionId,
					role: schema.sessionMessages.role,
					channel: schema.sessionMessages.channel,
					content: schema.sessionMessages.content,
					isHidden: schema.sessionMessages.isHidden,
					isGenerating: schema.sessionMessages.isGenerating,
					characterId: schema.sessionMessages.characterId,
					personaId: schema.sessionMessages.personaId,
					userId: schema.sessionMessages.userId,
					isNarratorResponse: schema.sessionMessages.isNarratorResponse,
					metadata: schema.sessionMessages.metadata
				})
				.from(schema.sessionMessages)
				.where(eq(schema.sessionMessages.id, messageId))
				.limit(1)
			if (!row || row.sessionId !== opts.sessionId) continue
			const facts = settledFactsOf(row)
			if (!facts) continue
			// The node that wrote it: the last message artifact the run recorded for the row.
			const step =
				[...opts.artifacts]
					.reverse()
					.find((a) => a.kind === "message" && a.entityId === messageId && a.nodeKey)?.nodeKey ?? null
			const payload: Omit<MessageSettledPayload, "at"> = {
				event: sessionEvents.messageSettled,
				sessionId: opts.sessionId,
				cause: { kind: "run", runId: opts.runId },
				...(opts.lineage ? { lineage: opts.lineage } : {}),
				messageId,
				step,
				...facts
			}
			await emitSessionEvent(db, {
				sessionId: opts.sessionId,
				userId: opts.userId,
				event: sessionEvents.messageSettled,
				payload,
				io: opts.io
			})
		}
	} catch (err) {
		console.warn(`[settledLines] message-settled for run ${opts.runId} failed:`, err)
	}
}
