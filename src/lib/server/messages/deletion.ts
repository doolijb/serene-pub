/**
 * 🚧 **Deleting a message needs a pipeline** (RF fix 5, owner ruling
 * 2026-10-23: "Let's disable message deletions by default… hiding messages
 * or using back/forward will be the recommended methods. Deletion requires a
 * pipeline, so it's managed by the genre"; NOMENCLATURE §24 **deletion
 * pipeline**).
 *
 * The host never deletes a message on a person's press by itself.
 * Delete is OFFERED on a message only where the session's effective
 * registrations hold an event pipeline on
 * `core:event/message-deletion-asked@1` — the one door every action and
 * event registration goes through, so a preset may drop it — and core
 * registers none on any genre: deletion is off everywhere until a plugin
 * genre, or an administrator's pipeline, registers one. Pressing Delete
 * dispatches that event; the registered pipeline does the work, ending in
 * `core:outlet/delete-message@1`, which deletes the row and takes back
 * everything it changed in one transaction (RF fix 4's one rule).
 *
 * The recommended ways are elsewhere: **Hide** (the line stays said and
 * what it changed stands; the characters do not read it) and **Back**
 * (`sessions/rewind.ts`). The one deletion that stays on by default is a new
 * write replacing the turns Back took out (`discardForwardStack`), which
 * raises nothing here.
 */
import { v4 as uuidv4 } from "uuid"
import { eq } from "drizzle-orm"
import { sessionEvents, type DeletionAskedPayload } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import type { SessionIo } from "$lib/server/pipelines/runtime/liveRow"

/** The sentence when nothing in the session deletes a message — member copy. */
export const DELETION_OFF =
	"Deleting messages is off in this session. Hide it from the story instead, or use Back to take back the last turn."

/** The sentence when the deletion pipeline ran and the message is still there. */
export const NOT_DELETED = "The message was not deleted."

/**
 * Does this session delete messages — does an event pipeline answer
 * `message-deletion-asked` here (a registration whose `when` holds)? What
 * the action list offers Delete on, and the door asks first. Never throws:
 * a failed read is "no" (the F29 posture: off is the safe answer).
 */
export async function deletionOffered(db: Db, sessionId: number): Promise<boolean> {
	try {
		const { registrationsOn } = await import("$lib/server/pipelines/registrations/resolve")
		const { run } = await registrationsOn(db, sessionId, sessionEvents.messageDeletionAsked)
		return run.length > 0
	} catch (e) {
		console.warn("[deletion] whether this session deletes messages could not be read:", e)
		return false
	}
}

export type DeletionOutcome =
	| { deleted: true; runId: string }
	| { deleted: false; refused: string; runId?: string }

/**
 * Ask the session's deletion pipeline to delete one message, and say what
 * became of it. The door — the message is the session's, the person may act
 * on it, the session deletes at all — is the caller's; this dispatches the
 * event under the person's cause and waits for the run. Never throws for
 * the pipeline's sake: a refusal, a run that left the row, nothing
 * registered and a run past the caller's `timeoutMs` all come back as `refused`.
 */
export async function askDeletion(
	db: Db,
	ask: {
		sessionId: number
		messageId: number
		userId: number
		io?: SessionIo
		timeoutMs?: number
	}
): Promise<DeletionOutcome> {
	const [message] = await db
		.select({ id: schema.sessionMessages.id, channel: schema.sessionMessages.channel })
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.id, ask.messageId))
		.limit(1)
	if (!message) return { deleted: false, refused: "Message not found." }
	const [session] = await db
		.select({ genreId: schema.sessions.genreId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, ask.sessionId))
		.limit(1)
	if (!session) return { deleted: false, refused: "Session not found." }
	const { STANDARD_GENRE_ID } = await import("$lib/server/pipelines/entities/sessionGenres")
	const { dispatchSessionEvent } = await import("$lib/server/pipelines/runtime/sessionEvents")
	const runId = uuidv4()
	const cause = { kind: "user" as const, userId: ask.userId }
	const payload: DeletionAskedPayload = {
		sessionId: ask.sessionId,
		messageId: ask.messageId,
		channel: message.channel ?? "main",
		person: `user:${ask.userId}`,
		cause
	}
	const abort = new AbortController()
	const dispatch = dispatchSessionEvent(db, {
		sessionId: ask.sessionId,
		userId: ask.userId,
		genreId: session.genreId ?? STANDARD_GENRE_ID,
		event: sessionEvents.messageDeletionAsked,
		runId,
		...(ask.io ? { io: ask.io } : {}),
		signal: abort.signal,
		input: {
			main: payload,
			...payload,
			sessionScope: { sessionId: ask.sessionId, userId: ask.userId }
		}
	}).then(
		(d) => ({ done: true as const, dispatched: d }),
		(error: unknown) => ({ done: true as const, error })
	)
	// Waited on whole by default, as the built-in's run was: a deletion
	// pipeline may park at a review gate or ask a confirm form, and the
	// person's answer is the end of it. A caller may bound the wait.
	let timer: ReturnType<typeof setTimeout> | undefined
	const timedOut =
		ask.timeoutMs === undefined
			? new Promise<{ done: false }>(() => {})
			: new Promise<{ done: false }>((resolve) => {
					timer = setTimeout(() => resolve({ done: false }), ask.timeoutMs)
				})
	const settled = await Promise.race([dispatch, timedOut])
	clearTimeout(timer)
	const gone = async () =>
		!(
			await db
				.select({ id: schema.sessionMessages.id })
				.from(schema.sessionMessages)
				.where(eq(schema.sessionMessages.id, ask.messageId))
				.limit(1)
		).length
	if (!settled.done) {
		abort.abort()
		await Promise.race([dispatch, new Promise((r) => setTimeout(r, 1000))])
		if (await gone()) return { deleted: true, runId }
		return { deleted: false, refused: "Deleting the message took too long, so it was not deleted.", runId }
	}
	if ("error" in settled) {
		console.warn("[deletion] the deletion pipeline failed:", settled.error)
		if (await gone()) return { deleted: true, runId }
		return { deleted: false, refused: NOT_DELETED, runId }
	}
	const dispatched = settled.dispatched
	if (await gone()) return { deleted: true, runId: dispatched?.receipt?.runId ?? runId }
	if (!dispatched) return { deleted: false, refused: DELETION_OFF }
	if (dispatched.refused) return { deleted: false, refused: dispatched.refused, runId }
	if (dispatched.paused) return { deleted: false, refused: "The deletion is waiting for the session's owner.", runId }
	return { deleted: false, refused: refusalSentence(dispatched.receipt), runId }
}

/** Why a finished deletion run left the message, as the person reads it. */
function refusalSentence(receipt: import("@serene-pub/sdk").Receipt | undefined): string {
	if (!receipt) return NOT_DELETED
	if (receipt.outcome === "cancelled") return "The deletion was stopped, so the message was not deleted."
	const failed = receipt.nodes?.find((n) => n.result !== "ok" && n.reason)
	const raw = receipt.haltReason ?? failed?.reason ?? ""
	// A host refusal names the node it was raised at (`delete: …`).
	return raw.replace(/^[a-z][\w-]*: /i, "").trim() || NOT_DELETED
}
