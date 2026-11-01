/**
 * 🚧 **Read aloud, automatically** (speech follow-ups A2, 2026-10-29): core's
 * listener for `core:event/message-settled@1`. When the session's Read aloud
 * is not Off and the settled line is a reply or narration, it starts
 * `core:spec/speak-message` — the very run the message ⋮ **Read aloud** verb
 * starts (`SPEAK_MESSAGE_ACTION_KEYS.readAloud`, through `fireAction`) — as
 * its OWN run. The reply's run is over (its receipt closed) before this one
 * begins, so the next reply never waits for speech (fixes lane V's V-5).
 *
 * ## Outside every queue the reply uses
 *
 *  · It is not awaited by `emitSessionEvent`, so it never sits on the
 *    session's event chain (`sessionEvents.ts` `enqueue`, where auto-advance
 *    fires the next reply): the run starts detached, in the **speech queue**
 *    below.
 *  · The **speech queue** is one chain per (session, message), so one line's
 *    run never waits for another's and a newer settle of the same line replaces
 *    the older run.
 *  · It registers as kind `maintenance`, not `action`: an `action` run makes
 *    `session.generating` true, which would grey the composer and the reply
 *    verbs for as long as the voice is speaking.
 *
 * ## One in flight per message
 *
 * A newer settle of the same message cancels the older run (`cancelAs`, its
 * receipt says "cancelled by core:speech"), then starts its own.
 *
 * ## The pending marker
 *
 * On enqueue the message carries `metadata.spoken.pending = { runId, at }`
 * (pushed to the session's participants) so the line can show **Speaking…**
 * and Stop. The speak step's own write of `metadata.spoken` replaces it on
 * success (`nextSpokenMetadata` writes `spoken` wholesale); whatever the
 * ending — failure, cancel, no words — this clears a marker that is still its
 * own, and pushes again. A `spoken` holding only `pending` is not a spoken
 * line (`spokenAs` is what makes one).
 *
 * Never throws: the line is already written and the reply is over.
 */
import { and, eq } from "drizzle-orm"
import type { MessageSettledPayload } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { sessionSpeechSettings } from "$lib/server/pipelines/speech/sessionSpeech"
import type { SessionIo } from "$lib/server/pipelines/runtime/liveRow"

/** The identity of the ⋮ **Read aloud** verb: `<spec slug>#<key>`. */
export const READ_ALOUD_ACTION = "core:spec/speak-message#read-aloud"

/** Who a cancelled speech run says cancelled it. */
export const SPEECH_CANCELLER = "core:speech"

/** The `metadata.spoken.pending` marker; same shape and name as core-catalog `spokenLine.ts` `SpokenPending`. */
export interface SpokenPending {
	runId: string
	/** ISO instant the run was enqueued. */
	at: string
}

interface InFlight {
	runId: string
	/** A newer settle came before the run registered: stop it the moment it does. */
	superseded: boolean
	done: Promise<void>
}

const KEY = Symbol.for("serene-pub.speechInFlight")
const inFlight = ((globalThis as Record<symbol, unknown>)[KEY] ??= new Map<
	string,
	InFlight
>()) as Map<string, InFlight>

const keyOf = (sessionId: number, messageId: number) => `${sessionId}:${messageId}`

/** The speech runs in flight for a session, newest first by key (a probe for tests and Stop). */
export function speechRunsInFlight(sessionId?: number): string[] {
	return [...inFlight.entries()]
		.filter(([k]) => sessionId === undefined || k.startsWith(`${sessionId}:`))
		.map(([, v]) => v.runId)
}

/** Wait until the speech runs of a session (or every one) have ended. For tests. */
export async function settleSpeechRuns(sessionId?: number): Promise<void> {
	for (;;) {
		const pending = [...inFlight.entries()]
			.filter(([k]) => sessionId === undefined || k.startsWith(`${sessionId}:`))
			.map(([, v]) => v.done)
		if (!pending.length) return
		await Promise.all(pending)
	}
}

/** Push the row (with its parts) to the session's participants. Best effort. */
export async function pushMessage(db: Db, io: SessionIo | undefined, sessionId: number, messageId: number) {
	if (!io) return
	try {
		const [row] = await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, messageId))
			.limit(1)
		if (!row) return
		const { attachParts } = await import("$lib/server/messages/store")
		const [withParts] = await attachParts(db, [row])
		const { broadcastToSessionUsers } = await import("$lib/server/sockets/utils/broadcastHelpers")
		await broadcastToSessionUsers(io as never, sessionId, "sessionMessage", {
			sessionMessage: withParts ?? row
		})
	} catch (err) {
		console.warn("[speech] the pending push failed:", err)
	}
}

/** Write `metadata.spoken.pending`, keeping a `spoken` record that is already there. */
export async function markPending(db: Db, messageId: number, pending: SpokenPending): Promise<boolean> {
	const { updateLegacy } = await import("$lib/server/messages/store")
	const [row] = await db
		.select({ metadata: schema.sessionMessages.metadata })
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.id, messageId))
		.limit(1)
	if (!row) return false
	const meta = (row.metadata ?? {}) as Record<string, any>
	const spoken = meta.spoken && typeof meta.spoken === "object" ? meta.spoken : {}
	await updateLegacy(db, messageId, { metadata: { ...meta, spoken: { ...spoken, pending } } as never })
	return true
}

/**
 * Remove the marker when it is still `runId`'s (the speak step's success has
 * already replaced it; a newer run's marker is not ours to clear). Returns
 * whether it wrote.
 */
export async function clearPending(db: Db, messageId: number, runId: string): Promise<boolean> {
	const { updateLegacy } = await import("$lib/server/messages/store")
	const [row] = await db
		.select({ metadata: schema.sessionMessages.metadata })
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.id, messageId))
		.limit(1)
	if (!row) return false
	const meta = (row.metadata ?? {}) as Record<string, any>
	const spoken = meta.spoken
	if (!spoken || typeof spoken !== "object" || spoken.pending?.runId !== runId) return false
	const { pending: _gone, ...rest } = spoken as Record<string, any>
	const next = { ...meta }
	if (Object.keys(rest).length) next.spoken = rest
	else delete next.spoken
	await updateLegacy(db, messageId, { metadata: next })
	return true
}

/** Is this run a speak-message run (a spec id may carry a version after the slug)? */
export const isSpeakRun = (specId: string | undefined | null): boolean =>
	typeof specId === "string" && specId.startsWith("core:spec/speak-message")

/**
 * A MANUAL press of Read aloud / Say it as… (the ⋮ or the heading icons)
 * marks its line the way the automatic path does, so the line reads
 * *Speaking…* and the heading shows Stop. Best effort; returns whether it marked.
 */
export async function markManualSpeech(
	db: Db,
	io: SessionIo | undefined,
	sessionId: number,
	messageId: number,
	runId: string
): Promise<boolean> {
	try {
		if (!(await markPending(db, messageId, { runId, at: new Date().toISOString() }))) return false
		await pushMessage(db, io, sessionId, messageId)
		return true
	} catch (err) {
		console.warn("[speech] marking a manual speak run pending failed:", err)
		return false
	}
}

/** Clear a manual press's marker once its run has ended — whatever the outcome — and push when it cleared. */
export async function endManualSpeech(
	db: Db,
	io: SessionIo | undefined,
	sessionId: number,
	messageId: number,
	runId: string
): Promise<void> {
	try {
		if (await clearPending(db, messageId, runId)) await pushMessage(db, io, sessionId, messageId)
	} catch (err) {
		console.warn("[speech] clearing a manual speak marker failed:", err)
	}
}

/** Should this settled line be read aloud at all? */
async function worthSpeaking(db: Db, p: MessageSettledPayload): Promise<boolean> {
	if (p.kind !== "reply" && p.kind !== "narration") return false
	const settings = await sessionSpeechSettings(db, p.sessionId)
	if (settings.readAloud === "off") return false
	const [row] = await db
		.select({
			content: schema.sessionMessages.content,
			isHidden: schema.sessionMessages.isHidden,
			isGenerating: schema.sessionMessages.isGenerating,
			generationOutcome: schema.sessionMessages.generationOutcome,
			error: schema.sessionMessages.error,
			metadata: schema.sessionMessages.metadata
		})
		.from(schema.sessionMessages)
		.where(
			and(
				eq(schema.sessionMessages.id, p.messageId),
				eq(schema.sessionMessages.sessionId, p.sessionId)
			)
		)
		.limit(1)
	if (!row || row.isHidden || row.isGenerating || !row.content?.trim()) return false
	// A stopped or failed reply is a partial line: it was never read aloud.
	if (row.generationOutcome === "stopped" || row.error) return false
	// A seeded greeting is the session's opening, not a reply that landed.
	if ((row.metadata as { isGreeting?: boolean } | null)?.isGreeting) return false
	return true
}

/**
 * The listener. Reads the settings, marks the line pending, and starts the
 * speak run detached; returns once the run is under way (not when it ends).
 */
export async function onMessageSettled(
	db: Db,
	opts: { payload: MessageSettledPayload; userId: number; io?: SessionIo }
): Promise<void> {
	const p = opts.payload
	try {
		if (typeof p?.messageId !== "number" || typeof p.sessionId !== "number") return
		if (!(await worthSpeaking(db, p))) return

		const key = keyOf(p.sessionId, p.messageId)
		const older = inFlight.get(key)
		if (older) {
			older.superseded = true
			const { cancelAs } = await import("$lib/server/pipelines/runtime/runRegistry")
			cancelAs(older.runId, SPEECH_CANCELLER, "a newer settle of the same message replaced this run")
		}

		const { randomUUID } = await import("node:crypto")
		const runId = randomUUID()
		const entry: InFlight = { runId, superseded: false, done: Promise.resolve() }
		inFlight.set(key, entry)
		const pending: SpokenPending = { runId, at: new Date().toISOString() }
		await markPending(db, p.messageId, pending)
		await pushMessage(db, opts.io, p.sessionId, p.messageId)

		entry.done = (async () => {
			// The older run's marker is cleared by its own ending, which only
			// clears a marker still its own — ours was written above.
			if (older) await older.done.catch(() => {})
			try {
				const { fireAction } = await import("$lib/server/pipelines/runtime/fireAction")
				const { cancelAs } = await import("$lib/server/pipelines/runtime/runRegistry")
				const outcome = await fireAction(db, {
					sessionId: p.sessionId,
					action: READ_ALOUD_ACTION,
					messageId: p.messageId,
					actor: { userId: opts.userId },
					runId,
					io: opts.io,
					kind: "maintenance",
					automatic: true,
					onStarted: () => {
						if (entry.superseded) cancelAs(runId, SPEECH_CANCELLER, "a newer settle of the same message replaced this run")
					}
				})
				if (outcome.kind === "refused")
					console.warn(`[speech] read aloud on message ${p.messageId} refused: ${outcome.error}`)
			} catch (err) {
				console.warn(`[speech] read aloud on message ${p.messageId} failed:`, err)
			} finally {
				try {
					if (await clearPending(db, p.messageId, runId))
						await pushMessage(db, opts.io, p.sessionId, p.messageId)
				} catch (err) {
					console.warn("[speech] clearing the pending marker failed:", err)
				}
				if (inFlight.get(key) === entry) inFlight.delete(key)
			}
		})()
	} catch (err) {
		console.warn(`[speech] message-settled listener failed for message ${p?.messageId}:`, err)
	}
}

/**
 * 🚧 The boot half of the pending marker (speech follow-ups, supervisor
 * 2026-10-29): a speech run lives in memory only, so a marker written before
 * this process started has no run left to replace or clear it — the line
 * would read **Speaking…** forever, its Stop naming a run nobody holds.
 * Clears every `metadata.spoken.pending` whose `at` is before `bootedAt`
 * and whose run is not one this process has in flight (a dev reload re-runs
 * the startup tasks on a live instance). An earlier recording is kept.
 * Returns how many markers it cleared. Never throws into boot.
 */
export async function clearDerelictSpokenPending(db: Db, bootedAt: Date): Promise<number> {
	try {
		const { sql } = await import("drizzle-orm")
		const rows = await db
			.select({ id: schema.sessionMessages.id, metadata: schema.sessionMessages.metadata })
			.from(schema.sessionMessages)
			.where(sql`(${schema.sessionMessages.metadata} -> 'spoken' -> 'pending') is not null`)
		const live = new Set(speechRunsInFlight())
		let cleared = 0
		for (const row of rows) {
			const pending = ((row.metadata ?? {}) as Record<string, any>).spoken?.pending
			const runId = typeof pending?.runId === "string" ? pending.runId : null
			const at = typeof pending?.at === "string" ? Date.parse(pending.at) : NaN
			if (runId && live.has(runId)) continue
			if (Number.isFinite(at) && at >= bootedAt.getTime()) continue
			if (runId && (await clearPending(db, row.id, runId))) cleared++
		}
		return cleared
	} catch (err) {
		console.error("[speech] derelict Speaking… markers could not be cleared:", err)
		return 0
	}
}
