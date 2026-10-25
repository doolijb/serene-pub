/**
 * 🚧 **A person's message, saved through the pipeline** (owner ruling
 * 2026-10-15).
 *
 * The host never writes a person's message row itself. The send handler
 * checks the door — access, the genre, the persona, the length, the channel
 * — and hands the message here; this dispatches
 * `core:event/message-offered@1` on the ordinary run machinery
 * (`dispatchSessionEvent`, cause `{ kind: 'user' }`), and the spec the
 * session's preset binds writes the row: core's `core:spec/save-message` by
 * default (`create-message@1`, `role: 'user'`), or a genre's own, which may
 * refuse with a sentence. The row's `message-completed` fires from that
 * write, under the person's cause, so turn order and auto-advance answer it
 * exactly as they answered a send.
 *
 * The dispatch is waited on: the save calls no model, so the answer the
 * person gets says what became of their message — the row, or the sentence
 * that refused it. Nothing is ever lost: a refusal, a spec error, nothing
 * bound and a run that outlives `SAVE_TIMEOUT_MS` all come back as
 * `refused`, and the composer restores the text.
 */
import { v4 as uuidv4 } from "uuid"
import { and, eq } from "drizzle-orm"
import { sessionEvents, type Receipt } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import type { SessionIo } from "$lib/server/pipelines/runtime/liveRow"

/** How long a save may take before the person is told it did not land. Under the client's 10 s. */
export const SAVE_TIMEOUT_MS = 8000

/** The sentence when nothing in the session saves a message. */
export const NOTHING_SAVES =
	"Nothing in this session saves a message — its preset binds no pipeline on 'message-offered'. Your text was kept."

/** The sentence when the save took too long. */
export const SAVE_TOO_SLOW = "Saving your message took too long, so it was not sent. Your text was kept."

export interface OfferedMessage {
	sessionId: number
	userId: number
	/** `character:<id>` (persona), `player-seat:<id>`, or null — the person themselves. */
	speaker: string | null
	/** Canonical. */
	channel: string
	text: string
	trayItemIds: string[]
	replyTo?: number | null
	io?: SessionIo
	/** Tests only: how long to wait for the save. */
	timeoutMs?: number
}

export type OfferOutcome =
	| { accepted: true; runId: string; messageId: number | null }
	| { refused: string; runId?: string }

/** The message rows a run created — its artifacts, in write order. */
export async function messagesCreatedBy(db: Db, runId: string): Promise<number[]> {
	const rows = await db
		.select({ entityId: schema.pipelineRunArtifacts.entityId })
		.from(schema.pipelineRunArtifacts)
		.innerJoin(
			schema.pipelineRuns,
			eq(schema.pipelineRuns.id, schema.pipelineRunArtifacts.runId)
		)
		.where(
			and(
				eq(schema.pipelineRuns.runId, runId),
				eq(schema.pipelineRunArtifacts.kind, "message"),
				eq(schema.pipelineRunArtifacts.action, "created")
			)
		)
		.orderBy(schema.pipelineRunArtifacts.seq)
	return rows.map((r) => r.entityId)
}

/** Why a finished save did not save, as the sentence the person reads. */
export function refusalOf(receipt: Receipt | undefined): string | null {
	if (!receipt) return null
	if (receipt.outcome === "ok") return null
	const failed = receipt.nodes?.find((n) => n.result !== "ok" && n.reason)
	const raw = receipt.haltReason ?? failed?.reason ?? ""
	// A host refusal names the node it was raised at (`save: …`): the person
	// reads the sentence, not the node key.
	const sentence = raw.replace(/^[a-z][\w-]*: /i, "").trim()
	if (receipt.outcome === "cancelled")
		return "Your message was not saved — the save was stopped. Your text was kept."
	return sentence || "Your message could not be saved. Your text was kept."
}

/**
 * Offer a person's message to the session's save pipeline, and say what
 * became of it. Never throws for the pipeline's sake: every failure is a
 * `refused` sentence, so the caller can always give the text back.
 */
export async function offerMessage(db: Db, m: OfferedMessage): Promise<OfferOutcome> {
	const [session] = await db
		.select({ genreId: schema.sessions.genreId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, m.sessionId))
		.limit(1)
	if (!session) return { refused: "Session not found. Your text was kept." }
	/**
	 * 🚧 A composer the genre closed on this lane, for this person (owner
	 * ruling 2026-10-15): refused before anything is offered, with what it is
	 * waiting on — the owner too, since the genre decides. A widget that let
	 * Send through still lands here, and the page says the sentence.
	 */
	{
		const { composerRefusal } = await import("$lib/server/sessions/composerStates")
		const closed = await composerRefusal(db, m.sessionId, m.channel, m.userId)
		if (closed) return { refused: `${closed} Your text was kept.` }
	}
	/**
	 * 🚧 A channel for the owner alone (`audience: 'owner'`, Lair rewrite
	 * D6): nobody else writes there — the Lair's Sanctum is the GM's table
	 * with the Castellan, and a guest is never offered its composer.
	 */
	{
		const { laneViewFor, laneViewAllows } = await import("$lib/server/channels/lanes")
		const view = await laneViewFor(db, m.sessionId, m.userId)
		if (view && !view.isOwner && view.hidden.size && !laneViewAllows(view, m.channel))
			return { refused: "That channel is the session owner's alone. Your text was kept." }
	}
	/**
	 * 🚧 A member's line is an interaction (PLAN-layering D7, R11, R21; lane
	 * 6): stamped before the line lands, so the routines its turn wakes count
	 * from it and a session's crons resume after a restart.
	 */
	{
		const { noteInteraction } = await import("$lib/server/pipelines/routines/interaction")
		await noteInteraction(db, m.sessionId, "line")
	}
	const { STANDARD_GENRE_ID } = await import(
		"$lib/server/pipelines/entities/sessionGenres"
	)
	const { dispatchSessionEvent } = await import(
		"$lib/server/pipelines/runtime/sessionEvents"
	)
	const runId = uuidv4()
	const cause = { kind: "user" as const, userId: m.userId }
	const payload = {
		sessionId: m.sessionId,
		person: `user:${m.userId}`,
		speaker: m.speaker,
		channel: m.channel,
		text: m.text,
		trayItemIds: m.trayItemIds,
		replyTo: m.replyTo ?? null,
		cause
	}
	const abort = new AbortController()
	const dispatch = dispatchSessionEvent(db, {
		sessionId: m.sessionId,
		userId: m.userId,
		genreId: session.genreId ?? STANDARD_GENRE_ID,
		event: sessionEvents.messageOffered,
		runId,
		io: m.io,
		signal: abort.signal,
		input: {
			main: payload,
			...payload,
			sessionScope: { sessionId: m.sessionId, userId: m.userId }
		}
	}).then(
		(d) => ({ done: true as const, dispatched: d }),
		(err: unknown) => ({ done: true as const, error: err })
	)
	let timer: ReturnType<typeof setTimeout> | undefined
	const timedOut = new Promise<{ done: false }>((resolve) => {
		timer = setTimeout(() => resolve({ done: false }), m.timeoutMs ?? SAVE_TIMEOUT_MS)
	})
	const settled = await Promise.race([dispatch, timedOut])
	clearTimeout(timer)

	if (!settled.done) {
		// Stop it, then look once: a row that landed after all is the person's
		// message, and must not come back as a refusal (the text would be
		// sent twice).
		abort.abort()
		await Promise.race([dispatch, new Promise((r) => setTimeout(r, 1000))])
		const [late] = await messagesCreatedBy(db, runId)
		if (late !== undefined) return { accepted: true, runId, messageId: late }
		return { refused: SAVE_TOO_SLOW, runId }
	}
	if ("error" in settled) {
		console.warn("[offerMessage] the save pipeline failed:", settled.error)
		return { refused: "Your message could not be saved. Your text was kept.", runId }
	}
	const dispatched = settled.dispatched
	if (!dispatched) return { refused: NOTHING_SAVES }
	if (dispatched.refused) return { refused: `${dispatched.refused} Your text was kept.`, runId }
	const refusal = refusalOf(dispatched.receipt)
	const [messageId] = await messagesCreatedBy(db, dispatched.receipt?.runId ?? runId)
	if (refusal && messageId === undefined) return { refused: refusal, runId }
	return { accepted: true, runId, messageId: messageId ?? null }
}
