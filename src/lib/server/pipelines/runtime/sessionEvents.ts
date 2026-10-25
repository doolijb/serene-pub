/**
 * Session events: the one emitter (`emitSessionEvent`, PLAN-turn-order
 * §4.1, A2) and the dispatch behind it (24 §3/§5).
 *
 * ## The emitter
 *
 * Every session event core emits goes through `emitSessionEvent`, which
 * (a) writes the `session_changes` ledger row, (b) fans out to plugin
 * listeners through `plugins/eventHost`, (c) runs the core-internal
 * listeners for `turn-order-changed` (A7: auto-advance and the
 * `sessions:turnOrder` push — not yet built), and (d) dispatches the spec
 * the session's genre or preset binds to the event. Before A2, data events
 * reached only the ledger and only three sites dispatched; now a send, a
 * finished reply, a delete, a settings save and a cast toggle all take one
 * road, and every payload carries its `cause` — who or what did it — which
 * is what the auto-advance listener keys on.
 *
 * ⚠ Never call it inside a `db.transaction`. The plugin fan-out reaches the
 * sandbox, whose row store queries the OUTER handle; on PGlite that waits
 * on the open transaction's mutex (`db/transactionGuard.ts`). The one site
 * that must hold a transaction around its write — `recordFormSuperseded`'s
 * once-lock — records directly and does not fan out.
 *
 * ## The dispatch
 *
 * `dispatchSessionEvent` resolves which pipeline answers an event for a
 * genre — a SELECT over the input-lock columns — and runs it through the
 * ordinary executor. This is dispatch keyed on (genre, event), the same rule
 * respond-bucket resolution uses, applied to the lifecycle events.
 *
 * Returns null when nothing serves, and that is a normal state, not a
 * failure: a transitional input-type genre has no create pipeline (the
 * caller keeps its imperative floor, the F29 posture), and today nothing
 * subscribes to the data events — the seam exists so the first pipeline
 * that wants them binds by declaring, not by core growing a call site.
 */
import { v4 as uuidv4 } from "uuid"
import {
	runSpec,
	type SpecRunRequest
} from "$lib/server/pipelines/runtime/runTurn"
import {
	defaultEventSpec,
	lockedEventSpec,
	type PresetFallback
} from "$lib/server/pipelines/entities/presetBindings"
import { registrationsOn } from "$lib/server/pipelines/registrations/resolve"
import {
	admitDescendant,
	closeBranch,
	openBranch,
	type RunLineage
} from "$lib/server/pipelines/runtime/lineage"
import * as runRegistry from "$lib/server/pipelines/runtime/runRegistry"
import {
	noteRun,
	parkAtCap,
	type CapPauseView
} from "$lib/server/pipelines/runtime/capPause"
import { saveReceipt } from "$lib/server/pipelines/runtime/receipts"
import type { SessionIo } from "$lib/server/pipelines/runtime/liveRow"
import { minAgeOf, sessionEvents as sdkSessionEvents, type EventCause, type Receipt } from "@serene-pub/sdk"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	recordSessionChange,
	type SessionEventPayload
} from "$lib/server/messages/sessionChanges"
import { STANDARD_GENRE_ID } from "$lib/server/pipelines/entities/sessionGenres"
import { routineRunOf, routinesEnabled, type RoutineRunFact } from "$lib/server/pipelines/routines/runs"

/**
 * Events the ledger does not record: `turn-order-changed` (see (a) below)
 * and 🚧 the five session moments (PLAN-layering D7, lane 6) — a turn or a
 * round ending, a scene opening or closing, the story clock moving. Each
 * describes something already on record (the line, the scene row, the
 * clock's `session-updated`); a ledger row for it would reach the next
 * reply's `sessionChanges` once per turn forever, saying nothing new.
 */
const OFF_LEDGER: ReadonlySet<string> = new Set([
	"core:event/turn-order-changed@1",
	sdkSessionEvents.turnEnded,
	sdkSessionEvents.roundEnded,
	sdkSessionEvents.sceneOpened,
	sdkSessionEvents.sceneClosed,
	sdkSessionEvents.storyClockMoved,
	// 🚧 pr-6 (supervisor C, 2026-10-25): host moments too — a reply is told
	// nothing by the line settling, a summary landing or the session closing.
	sdkSessionEvents.historySettled,
	sdkSessionEvents.sceneSummaryApplied,
	sdkSessionEvents.sessionArchived
])

/**
 * Emit one session event (PLAN-turn-order §4.1): the ledger row, the plugin
 * fan-out, the core listeners, the bound spec. `payload` is one of the
 * payload shapes the event's registry entry names, with `cause` filled by
 * the emitter (§4.1 *Cause at the emitters*); `at` is filled here when the
 * payload does not carry it, and is the instant every consumer agrees on.
 *
 * The ledger row's `run_id` is the cause's `runId` — the run that made the
 * write, whatever kind the cause is (a person's delete performed by the
 * built-in's run carries `{ kind: 'edit', userId, runId }`).
 *
 * `lineage`, when given, is the CHILD lineage a dispatched spec runs under
 * (`childLineage` of the emitting run), so the cycle caps hold across an
 * event a run's own write caused. The payload's own `lineage` — the
 * writer's place in the tree — is the emitter's to fill.
 *
 * Never throws for the fan-out or the dispatch: the write this event
 * describes has already landed, and a listener failing is that listener's
 * problem (01 §9c). The ledger write is best-effort for the same reason.
 */
export async function emitSessionEvent(
	db: Db,
	opts: {
		sessionId: number
		userId: number
		event: string
		/** One of the payload shapes §4.1 names, cause filled. */
		payload: unknown
		lineage?: RunLineage
		/**
		 * The lineage holds the dispatch to the depth cap only, never the
		 * descendant count (R65) — a run's own data events.
		 */
		depthOnly?: boolean
		io?: SessionIo
		signal?: AbortSignal
		/**
		 * Wait for the listeners and the bound spec before returning (M4
		 * review). Off by default: §3's "the send's ack waits for neither" —
		 * a writer (a socket handler, a run's outlet) records the change and
		 * returns, and what the change sets off (the turn-order recompute,
		 * which may call a model; auto-advance, which may run a whole reply)
		 * runs after it on the session's queue, one at a time (§4.2). An
		 * outlet waiting on a model call through here blew its own timeout.
		 * `wait: true` is for a caller that needs the dispatch's answer.
		 */
		wait?: boolean
	}
): Promise<{ dispatched: SessionEventDispatch | null }> {
	const given = (opts.payload ?? {}) as Partial<SessionEventPayload> & {
		cause?: EventCause
	}
	const at = typeof given.at === "number" ? given.at : Date.now()
	const payload = {
		...given,
		...(opts.event === sdkSessionEvents.messageCompleted
			? await landedLineFacts(db, given as { messageId?: unknown; channel?: unknown; speaker?: unknown })
			: {}),
		event: opts.event,
		sessionId: opts.sessionId,
		at
	} as SessionEventPayload
	const cause = payload.cause
	/**
	 * 🚧 The routine run behind this write, if one is (R19) — read now, while
	 * that run is still in flight: a routine takes no turn, and what its own
	 * writes set off wakes no routine past one level.
	 */
	const fromRoutine = routineRunOf(
		cause?.runId,
		(payload as { lineage?: { rootRunId?: string } }).lineage?.rootRunId
	)

	/**
	 * (a) The ledger — for every event but `turn-order-changed` (and the
	 * session moments, `OFF_LEDGER`).
	 *
	 * `session_changes` is what the built-ins DID, read by the next reply's
	 * inlet so a pipeline knows the history it is about to read has moved
	 * (R-15). A turn-order recompute moves no history: it describes no
	 * message and no setting, it is core-internal (no preset may bind it),
	 * and its consumers are the two listeners below. Writing it here would
	 * put a row on every reply's `sessionChanges` port saying "the order was
	 * recomputed", which is true, useless, and would arrive once per event
	 * forever.
	 *
	 * The event still happens: plugins hear it, the push carries it, and
	 * auto-advance reads it. It is the LEDGER it stays off.
	 */
	if (!OFF_LEDGER.has(opts.event))
		await recordSessionChange(db, {
			...payload,
			runId: cause?.runId ?? null
		})

	// (b) Plugin listeners. The registry is empty when plugins are off, and
	// `notify` never rejects; the import is deferred so a process that never
	// emits never loads the sandbox.
	try {
		const { pluginEvents } = await import("$lib/server/plugins/eventHost")
		const { getManager } = await import("$lib/server/plugins")
		await pluginEvents().notify(getManager(), opts.event, payload, {
			...(cause?.runId ? { runId: cause.runId } : {}),
			user: String(opts.userId),
			nowMs: at,
			...(opts.signal ? { signal: opts.signal } : {})
		})
	} catch (err) {
		console.warn(
			`[sessionEvents] plugin fan-out for ${opts.event} failed:`,
			err
		)
	}

	// (b2) A package's event reaches everything in the session (R56): its
	// clients, whose page hands it to the widgets. Core's own events reach
	// clients as the pushes they already have.
	if (opts.io) {
		try {
			const { pushRecordedEvent, recordedEventPushOf } = await import(
				"$lib/server/sessions/recordedEventPush"
			)
			const push = recordedEventPushOf(opts.event, payload, opts.sessionId, at)
			if (push) await pushRecordedEvent(opts.io, push)
		} catch (err) {
			console.warn(`[sessionEvents] the push for ${opts.event} failed:`, err)
		}
	}

	// (b3) Who plays whom moved — a seat taken or left, a persona swapped — so
	// what each member may see of the annex may have moved with it (R57).
	if (
		opts.io &&
		(opts.event === sdkSessionEvents.memberAdded ||
			opts.event === sdkSessionEvents.memberRemoved ||
			opts.event === sdkSessionEvents.castChanged)
	) {
		try {
			const { pushAnnexViews } = await import("$lib/server/sessions/annexViews")
			await pushAnnexViews(db, opts.io, opts.sessionId)
		} catch (err) {
			console.warn(`[sessionEvents] the annex view push after ${opts.event} failed:`, err)
		}
	}

	// (b4) A line landed, was rewritten or went — so a form someone was told
	// about may now be answered, overtaken or gone. Staleness is computed,
	// never stored, so the open-form notifications are re-checked here
	// (PLAN-notifications §5). One read when the session has none.
	if (
		opts.event === sdkSessionEvents.messageCompleted ||
		opts.event === sdkSessionEvents.messageDeleted ||
		opts.event === "core:event/message-updated@1"
	) {
		try {
			const { settleOpenForms } = await import("$lib/server/notifications/openForm")
			await settleOpenForms(db, opts.sessionId)
		} catch (err) {
			console.warn(`[sessionEvents] the open-form re-check after ${opts.event} failed:`, err)
		}
	}

	// (b5) 🚧 A line landed, so a scene boundary may belong at it (live
	// scenes §4): the boundary watcher reads the session's scene settings and
	// the line's stamp against the line before it, and records a scene cue
	// (Suggested) or places the boundary (Automatic). One read when the
	// session is Manual or places no scene; never throws.
	if (opts.event === sdkSessionEvents.messageCompleted) {
		const messageId = (payload as { messageId?: unknown }).messageId
		if (typeof messageId === "number") {
			const { watchSceneBoundaries } = await import(
				"$lib/server/scenes/boundaryWatcher"
			)
			// The run that wrote the line, and its tree's root: what a genre's
			// declared trigger's `actionKey` reads (live scenes §15 G1).
			const lineage = (payload as { lineage?: { rootRunId?: unknown } }).lineage
			await watchSceneBoundaries(db, {
				sessionId: opts.sessionId,
				messageId,
				io: opts.io,
				runIds: [cause?.runId, lineage?.rootRunId].filter(
					(id): id is string => typeof id === "string" && id !== ""
				)
			})
		}
	}

	// (c) and (d) run after the writer returns, on the session's queue —
	// unless the caller asked to wait (see `wait` above).
	const rest = () => settleRest(db, opts, payload, cause, at, fromRoutine)
	/**
	 * (f) 🚧 A line landed, so a turn may have ended — and with it a round
	 * (PLAN-layering D7, lane 6): queued AFTER this event's own work, so the
	 * turn ends once what the line set off has run (its recompute wrote the
	 * order the round is read from). Emits `turn-ended` / `round-ended`
	 * through this same emitter; see `routines/moments.ts`.
	 */
	const landedId = (payload as { messageId?: unknown }).messageId
	const landed =
		opts.event === sdkSessionEvents.messageCompleted && typeof landedId === "number"
			? async () => {
					const { noteLineLanded } = await import("$lib/server/pipelines/routines/moments")
					await noteLineLanded(db, {
						sessionId: opts.sessionId,
						userId: opts.userId,
						messageId: landedId,
						...(cause ? { cause } : {}),
						...(opts.lineage ? { lineage: opts.lineage, depthOnly: opts.depthOnly } : {}),
						...(opts.io ? { io: opts.io } : {}),
						fromRoutine: !!fromRoutine
					})
				}
			: null
	const queueLanded = () => {
		if (!landed) return
		if (opts.lineage) queueChild(opts.sessionId, opts.lineage.rootRunId, landed)
		else enqueue(opts.sessionId, landed)
	}
	if (!opts.wait) {
		if (opts.lineage)
			queueChild(opts.sessionId, opts.lineage.rootRunId, rest)
		else enqueue(opts.sessionId, rest)
		queueLanded()
		return { dispatched: null }
	}
	if (!opts.lineage) {
		const done = await rest()
		queueLanded()
		return done
	}
	openBranch(opts.lineage.rootRunId)
	try {
		const done = await rest()
		queueLanded()
		return done
	} finally {
		closeBranch(opts.lineage.rootRunId)
	}
}

/**
 * 🚧 **Where a landed line is, and whose it is** (Lair rewrite L4,
 * 2026-10-21): `message-completed` carries the row's `channel` (canonical)
 * and its `speaker` — the participant reference that wrote it
 * (`metadata.speaker`, else `character:<id>` for a character's reply or a
 * persona's line, else `user:<id>` for a person as themselves) — so a
 * routine's `onEvent` cadence may say which lines wake it (the Lair's
 * scratchpad: the Castellan's lines on the Sanctum, `where`). Read off the
 * row once, here, for every writer; a payload that already says them keeps
 * its own.
 */
async function landedLineFacts(
	db: Db,
	given: { messageId?: unknown; channel?: unknown; speaker?: unknown }
): Promise<{ channel?: string; speaker?: string }> {
	if (typeof given.channel === "string" && typeof given.speaker === "string") return {}
	const id = given.messageId
	if (typeof id !== "number" || !Number.isInteger(id)) return {}
	const [row] = await db
		.select({
			channel: schema.sessionMessages.channel,
			role: schema.sessionMessages.role,
			characterId: schema.sessionMessages.characterId,
			personaId: schema.sessionMessages.personaId,
			userId: schema.sessionMessages.userId,
			metadata: schema.sessionMessages.metadata
		})
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.id, id))
		.limit(1)
	if (!row) return {}
	const { canonicalChannel } = await import("$lib/server/messages/channels")
	const said = (row.metadata as { speaker?: unknown } | null)?.speaker
	const speaker =
		typeof said === "string" && said
			? said
			: row.characterId != null
				? `character:${row.characterId}`
				: row.personaId != null
					? `character:${row.personaId}`
					: row.role === "user" && row.userId != null
						? `user:${row.userId}`
						: undefined
	return {
		...(typeof given.channel === "string" ? {} : { channel: canonicalChannel(row.channel ?? "main") }),
		...(typeof given.speaker === "string" || !speaker ? {} : { speaker })
	}
}

/**
 * Queue a child dispatch on the session's queue, holding its tree open until
 * it settles: the root's run has usually returned by the time the child
 * runs, and the tree's count must still be there when it does (E1c).
 */
function queueChild(
	sessionId: number,
	rootRunId: string,
	work: () => Promise<unknown>
): void {
	openBranch(rootRunId)
	enqueue(sessionId, async () => {
		try {
			await work()
		} finally {
			closeBranch(rootRunId)
		}
	})
}

/**
 * The queue a session's deferred event work runs on (M4 review): one chain
 * per session, so a session's recomputes and auto-advance fires run one at a
 * time and in emission order, while different sessions run side by side.
 * Held on `globalThis` because a Vite SSR reload re-evaluates this module
 * and a second map would split the queue in two (memory: server singletons).
 */
const QUEUES_KEY = Symbol.for("serene-pub.sessionEventQueues")
const queues = ((globalThis as Record<symbol, unknown>)[QUEUES_KEY] ??= new Map<
	number,
	Promise<void>
>()) as Map<number, Promise<void>>

function enqueue(sessionId: number, work: () => Promise<unknown>): void {
	const prev = queues.get(sessionId) ?? Promise.resolve()
	const next = prev.then(work).then(
		() => undefined,
		(err) =>
			console.warn(
				`[sessionEvents] deferred work for session ${sessionId} failed:`,
				err
			)
	)
	queues.set(sessionId, next)
	void next.then(() => {
		if (queues.get(sessionId) === next) queues.delete(sessionId)
	})
}

/**
 * 🚧 Is anything of this session's still on its event chain — queued or
 * running? A probe, never a wait: the routine queue reads it (R13).
 */
export function sessionEventsPending(sessionId: number): boolean {
	return queues.has(sessionId)
}

/** 🚧 Wait until this session's event chain is empty (and only it — no settle probes). */
export async function sessionEventsIdle(sessionId: number): Promise<void> {
	for (;;) {
		const pending = queues.get(sessionId)
		if (!pending) return
		await pending
	}
}

/**
 * 🚧 More work a settle waits for, beside the event chains — the routine
 * queue's drains (lane 6). A probe hands back the promises of what is in
 * flight now, for one session or every one.
 */
type SettleProbe = (sessionId?: number) => Promise<unknown>[]
const PROBES_KEY = Symbol.for("serene-pub.sessionEventSettleProbes")
const settleProbes = ((globalThis as Record<symbol, unknown>)[PROBES_KEY] ??= new Set<SettleProbe>()) as Set<SettleProbe>

/** 🚧 Register a settle probe (idempotent per function). */
export function addSettleProbe(probe: SettleProbe): void {
	settleProbes.add(probe)
}

/**
 * Wait until a session's queue (or every session's) is empty — work queued
 * by work already queued included, and 🚧 the routines it set off (the
 * settle probes). For tests and for a caller that must see the settled
 * state; production writers never wait on it.
 */
export async function settleSessionEvents(sessionId?: number): Promise<void> {
	for (;;) {
		const pending: Promise<unknown>[] =
			sessionId === undefined
				? [...queues.values()]
				: [queues.get(sessionId)].filter((p): p is Promise<void> => !!p)
		for (const probe of settleProbes) pending.push(...probe(sessionId))
		if (!pending.length) return
		await Promise.all(pending)
	}
}

async function settleRest(
	db: Db,
	opts: {
		sessionId: number
		userId: number
		event: string
		lineage?: RunLineage
		depthOnly?: boolean
		io?: SessionIo
		signal?: AbortSignal
	},
	payload: SessionEventPayload,
	cause: EventCause | undefined,
	at: number,
	fromRoutine?: RoutineRunFact
): Promise<{ dispatched: SessionEventDispatch | null }> {
	/**
	 * (c) The core-internal listeners for `turn-order-changed` (§4.6, §4.7):
	 * the `sessions:turnOrder` push, so every open client renders the order
	 * the moment it is written, and auto-advance, which may fire the head
	 * turn. The push precedes the fire, deliberately: the person sees whose
	 * turn it is before the turn starts, rather than after it has streamed.
	 *
	 * Both are core's own, not plugin listeners — a plugin subscribes
	 * through (b) and cannot fire a turn.
	 */
	if (opts.event === "core:event/turn-order-changed@1") {
		const order = (payload as { turnOrder?: unknown }).turnOrder
		/**
		 * The push goes out once auto-advance has decided — still before
		 * the fire — carrying that decision as `autoAdvancing` (lair pass
		 * B9). A client that has just sent learns at once whether a reply is
		 * coming, rather than hiding its next-speaker block until a backstop.
		 */
		let pushed = false
		const push = async (autoAdvancing: boolean) => {
			pushed = true
			try {
				const { pushTurnOrder } = await import(
					"$lib/server/sessions/turnOrderPush"
				)
				await pushTurnOrder(opts.io, opts.sessionId, order, {
					autoAdvancing
				})
			} catch (err) {
				console.warn("[sessionEvents] the turn-order push failed:", err)
			}
		}
		try {
			const { onTurnOrderChanged } = await import(
				"$lib/server/sessions/autoAdvance"
			)
			await onTurnOrderChanged(db, {
				sessionId: opts.sessionId,
				userId: opts.userId,
				cause,
				turnOrder: order,
				io: opts.io,
				announce: push
			})
		} catch (err) {
			console.warn("[sessionEvents] auto-advance failed:", err)
		}
		// The order is pushed whatever became of the listener.
		if (!pushed) await push(false)
		// `your-move` (notifications §5, Q1): the stored head is somebody's
		// own entry, or nobody's move. After the push and the fire, so it
		// never delays either; `settleYourMove` never throws.
		try {
			const { settleYourMove } = await import(
				"$lib/server/notifications/yourMove"
			)
			await settleYourMove(db, { sessionId: opts.sessionId, cause })
		} catch (err) {
			console.warn("[sessionEvents] the your-move settle failed:", err)
		}
	}

	// (d) The bound spec, when the session's genre or preset binds one. The
	// input is what `core:inlet/session-event@1` publishes (§4.4): the event,
	// the session, the payload, the cause, the instant; the host adds the
	// settings document as `session` at run start (A3).
	let dispatched: SessionEventDispatch | null = null
	try {
		const [session] = await db
			.select({ genreId: schema.sessions.genreId })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, opts.sessionId))
			.limit(1)
		if (session) {
			dispatched = await dispatchSessionEvent(db, {
				sessionId: opts.sessionId,
				userId: opts.userId,
				genreId: session.genreId ?? STANDARD_GENRE_ID,
				event: opts.event,
				input: {
					event: opts.event,
					sessionId: opts.sessionId,
					payload,
					cause: cause ?? null,
					at,
					sessionScope: {
						sessionId: opts.sessionId,
						userId: opts.userId
					}
				},
				...(opts.lineage ? { lineage: opts.lineage } : {}),
				...(opts.lineage && opts.depthOnly ? { depthOnly: true } : {}),
				...(opts.io ? { io: opts.io } : {}),
				...(opts.signal ? { signal: opts.signal } : {})
			})
		}
	} catch (err) {
		console.warn(`[sessionEvents] dispatch for ${opts.event} failed:`, err)
	}

	/**
	 * (e) 🚧 The session's **routines** (PLAN-layering D2/D7, lane 6): each
	 * whose cadence wakes on this event — or on the moment it is (a turn, a
	 * round, a scene, a clock move) — is evaluated, after the event's own
	 * registrations ran; one that comes due is queued (`routines/queue.ts`)
	 * and waits until the session has no action or event run left (R13).
	 * Nothing is read for a session with no routine that wakes on it.
	 */
	if (routinesEnabled())
		try {
			const { onSessionEvent } = await import("$lib/server/pipelines/routines/evaluate")
			await onSessionEvent(db, {
				sessionId: opts.sessionId,
				event: opts.event,
				payload,
				at,
				...(opts.io ? { io: opts.io } : {}),
				...(fromRoutine ? { fromRoutine } : {})
			})
		} catch (err) {
			console.warn(`[sessionEvents] the routines on ${opts.event} were not evaluated:`, err)
		}
	return { dispatched }
}

/**
 * Which spec answers an event for this session, and how it was reached.
 *
 * 🚧 **Registrations** (PLAN-layering D7, R24, R31, R33; 2026-10-20): the
 * session's own rows over its preset's changes over the genre's defaults —
 * the one resolver (`registrations/resolve.ts`). An event may carry several
 * registrations; each runs in order when its `when` holds, and this names
 * the first (`registrations` lists them all, `skipped` the ones whose `when`
 * did not hold). A preset registration that no longer resolves falls back to
 * the genre's defaults on the event and says so (`fallback`, ruled
 * 2026-09-10). With no session in hand, the genre's defaults answer.
 *
 * Everything else still degrades to null, which is a normal state and not a
 * failure (the F29 posture).
 */
export interface SessionEventResolution {
	spec: string | null
	/** The first registration's key — the one `spec` is. */
	registrationKey?: string
	/** That registration's `minAgeOf` (pass 9 S3) — what its run may not reach into. */
	minAge?: number
	/** Every registration that runs, in order (R24). */
	registrations?: Array<{ spec: string; key: string; minAge?: number }>
	/** Registrations on the event whose `when` did not hold (R31). */
	skipped?: Array<{ spec: string; key: string }>
	/**
	 * Present only when the session's preset registered something on this
	 * event that this instance cannot resolve. Its presence IS the fact the
	 * receipt, the banner and the admin notice all state.
	 */
	fallback?: PresetFallback
}

export async function resolveSessionEventVerdict(
	db: Db,
	genreId: string,
	event: string,
	scope?: { sessionId?: number | null }
): Promise<SessionEventResolution> {
	try {
		// The session's registrations answer for the session's own genre; a
		// caller naming another genre is answered by that genre's defaults.
		if (scope?.sessionId != null && (await sessionGenreIs(db, scope.sessionId, genreId))) {
			const on = await registrationsOn(db, scope.sessionId, event)
			const said = on.fallback ? { fallback: on.fallback } : {}
			const registrations = on.run.map((r) => ({ spec: r.pipeline, key: r.key, minAge: minAgeOf(r) }))
			const skipped = on.skipped.map((r) => ({ spec: r.pipeline, key: r.key }))
			if (registrations.length)
				return {
					spec: registrations[0]!.spec,
					registrationKey: registrations[0]!.key,
					minAge: registrations[0]!.minAge,
					registrations,
					...(skipped.length ? { skipped } : {}),
					...said
				}
			if (skipped.length) return { spec: null, skipped, ...said }
			// Nothing registered on the event: core's default save still
			// answers `message-offered` (owner ruling 2026-10-15).
			return { spec: defaultEventSpec(event), ...said }
		}
		return {
			spec: (await lockedEventSpec(db, genreId, event)) ?? defaultEventSpec(event)
		}
	} catch {
		// Routing infrastructure failing still degrades to "nothing serves",
		// which the caller answers with its own floor (the F29 posture).
		return { spec: null }
	}
}

/** Is this session in this genre? (A missing session is in none.) */
async function sessionGenreIs(db: Db, sessionId: number, genreId: string): Promise<boolean> {
	const [row] = await db
		.select({ genreId: schema.sessions.genreId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	return !!row && (row.genreId ?? "core:genre/story") === genreId
}

/** The same answer, for the callers that only need the slug. */
export async function resolveSessionEventSpec(
	db: Db,
	genreId: string,
	event: string,
	scope?: { sessionId?: number | null }
): Promise<string | null> {
	return (await resolveSessionEventVerdict(db, genreId, event, scope)).spec
}

export interface SessionEventDispatch {
	specSlug: string
	/** 🚧 The registration this run answered for (D7). */
	registrationKey?: string
	/** 🚧 The event's other registrations' runs, in order, after this one (R24). */
	others?: SessionEventDispatch[]
	/** Absent only when the run is `paused`: it has not run, and nothing has been written. */
	receipt?: Receipt
	/** Set when the preset's own choice could not answer — see the resolution. */
	fallback?: PresetFallback
	/**
	 * The run was refused by a cycle cap before it started (01 §8; U5d).
	 * The receipt is the refusal's — `outcome: 'halt'`, the cap in
	 * `haltReason`, lineage filled — saved like any other so the tree's
	 * reader sees where it stopped.
	 */
	refused?: string
	/**
	 * The run was parked at a cycle cap for the session owner (E1c,
	 * `capPause.ts`): it has not run, and runs on their Continue.
	 */
	paused?: CapPauseView
}

/**
 * Run the pipeline serving (genre, event), if one does. The caller shapes
 * `input` for the event's input contract; the run gets the ordinary session
 * scope, receipt, and bindings — an event run is a run like any other.
 *
 * A dispatch made **by a run** — `form-addressed` from the run that wrote
 * the form (U5d) — carries `lineage`, and this is where 01 §8's dynamic
 * cycle guards hold: the child is refused past the per-root depth and
 * descendant caps (`lineage.ts`), and the refusal is receipted rather than
 * dropped. The child is registered as an `action` run under the run owner,
 * so a stop on the parent reaches it, and its receipt names the parent.
 */
export async function dispatchSessionEvent(
	db: Db,
	opts: {
		sessionId: number
		userId: number
		genreId: string
		event: string
		input: unknown
		signal?: AbortSignal
		/** The dispatching run's lineage plus one — a child run. Absent for a person-less root. */
		lineage?: RunLineage
		/** Hold `lineage` to the depth cap only (R65); see `admitDescendant`. */
		depthOnly?: boolean
		/** Where a child's rows are announced — the parent's socket server, when it had one. */
		io?: SessionIo
		runId?: string
		/**
		 * The parent's progress sink and status relay, handed down (U5d
		 * review, S4): a child's frames ride the parent's card, so the person
		 * who pressed sees the answer being made — its stage, its statuses.
		 */
		sink?: SpecRunRequest["sink"]
		onStatus?: SpecRunRequest["onStatus"]
		/** The parent's park relay, handed down — see `SpecRunRequest.onParked`. */
		onParked?: SpecRunRequest["onParked"]
		/**
		 * The pipeline the session owner let run past a cap (E1c). If the
		 * binding has changed since, nothing runs: the owner approved that
		 * pipeline, not whatever answers now — receipted as a halt saying so.
		 */
		expectSpec?: string
		/**
		 * 🚧 Run only this registration of the event (its key) — a parked one
		 * the owner let continue (E1c, R24): the event's other registrations
		 * ran when it was first emitted and must not run again.
		 */
		onlyRegistration?: string
	}
): Promise<SessionEventDispatch | null> {
	const resolved = await resolveSessionEventVerdict(
		db,
		opts.genreId,
		opts.event,
		// The session is in hand here, so its registrations answer.
		{ sessionId: opts.sessionId }
	)
	/**
	 * 🚧 Every registration on the event runs, in order, each its own run
	 * (R24). The first carries the caller's run id, signal and parked
	 * relay — what the caller is waiting on; the rest run after it.
	 */
	const all = resolved.registrations?.length
		? resolved.registrations
		: resolved.spec
			? [{ spec: resolved.spec, key: resolved.registrationKey ?? "" }]
			: []
	const list =
		opts.onlyRegistration !== undefined
			? all.filter((r) => (r.key ?? "") === opts.onlyRegistration)
			: all
	if (!list.length) {
		// A required event whose registrations' conditions all failed runs
		// nothing — and the receipt says so (R24).
		if (resolved.skipped?.length)
			await skippedReceipt(db, {
				sessionId: opts.sessionId,
				userId: opts.userId,
				event: opts.event,
				skipped: resolved.skipped,
				lineage: opts.lineage
			}).catch(() => undefined)
		return await dispatchOne(db, opts, { spec: null, ...(resolved.fallback ? { fallback: resolved.fallback } : {}) })
	}
	const first = await dispatchOne(db, opts, {
		spec: list[0]!.spec,
		registrationKey: list[0]!.key || undefined,
		minAge: (list[0] as { minAge?: number }).minAge,
		...(resolved.fallback ? { fallback: resolved.fallback } : {})
	})
	const others: SessionEventDispatch[] = []
	for (const next of list.slice(1)) {
		try {
			const d = await dispatchOne(
				db,
				{ ...opts, runId: undefined, expectSpec: undefined, onParked: undefined },
				{ spec: next.spec, registrationKey: next.key || undefined, minAge: (next as { minAge?: number }).minAge }
			)
			if (d) others.push(d)
		} catch (err) {
			console.warn(`[sessionEvents] ${opts.event} → ${next.spec} failed:`, err)
		}
	}
	return first && others.length ? { ...first, others } : first
}

/** One registration's run — the dispatch as it stood for one spec (expect-spec, caps, park, run). */
async function dispatchOne(
	db: Db,
	opts: {
		sessionId: number
		userId: number
		genreId: string
		event: string
		input: unknown
		signal?: AbortSignal
		/** The dispatching run's lineage plus one — a child run. Absent for a person-less root. */
		lineage?: RunLineage
		/** Hold `lineage` to the depth cap only (R65); see `admitDescendant`. */
		depthOnly?: boolean
		/** Where a child's rows are announced — the parent's socket server, when it had one. */
		io?: SessionIo
		runId?: string
		/**
		 * The parent's progress sink and status relay, handed down (U5d
		 * review, S4): a child's frames ride the parent's card, so the person
		 * who pressed sees the answer being made — its stage, its statuses.
		 */
		sink?: SpecRunRequest["sink"]
		onStatus?: SpecRunRequest["onStatus"]
		/** The parent's park relay, handed down — see `SpecRunRequest.onParked`. */
		onParked?: SpecRunRequest["onParked"]
		/**
		 * The pipeline the session owner let run past a cap (E1c). If the
		 * binding has changed since, nothing runs: the owner approved that
		 * pipeline, not whatever answers now — receipted as a halt saying so.
		 */
		expectSpec?: string
	}
,
	resolved: { spec: string | null; registrationKey?: string; minAge?: number; fallback?: PresetFallback }
): Promise<SessionEventDispatch | null> {	if (opts.expectSpec && resolved.spec !== opts.expectSpec && opts.lineage) {
		const reason =
			`the pipeline answering ${opts.event} changed while this waited at the cycle cap ` +
			`(now ${resolved.spec ?? "none"}); the approved one did not run`
		const receipt = await refusalReceipt(db, {
			runId: uuidv4(),
			specId: opts.expectSpec,
			sessionId: opts.sessionId,
			userId: opts.userId,
			lineage: opts.lineage,
			reason
		})
		return { specSlug: opts.expectSpec, receipt, refused: reason }
	}
	if (!resolved.spec) return null
	const runId = opts.runId ?? uuidv4()

	if (opts.lineage) {
		const cap = admitDescendant(opts.lineage, {
			count: !opts.depthOnly
		})
		if (cap) {
			// Parked for the session owner (E1c): Continue dispatches it again,
			// on the session's queue, under the tree's widened caps. Only a
			// session with no owner to ask falls through to the refusal.
			const lineage = opts.lineage
			const paused = await parkAtCap(db, {
				sessionId: opts.sessionId,
				userId: opts.userId,
				event: opts.event,
				specSlug: resolved.spec,
				lineage,
				cap,
				redispatch: () =>
					queueChild(opts.sessionId, lineage.rootRunId, () =>
						dispatchSessionEvent(db, {
							...opts,
							// A fresh run, answering to nobody's stop or card: the
							// run that caused it finished long ago.
							runId: undefined,
							signal: undefined,
							sink: undefined,
							onStatus: undefined,
							onParked: undefined,
							expectSpec: resolved.spec ?? undefined,
							onlyRegistration: resolved.registrationKey ?? ""
						})
					)
			})
			if (paused)
				return {
					specSlug: resolved.spec,
					paused,
					...(resolved.fallback
						? { fallback: resolved.fallback }
						: {})
				}
			const receipt = await refusalReceipt(db, {
				runId,
				specId: resolved.spec,
				sessionId: opts.sessionId,
				userId: opts.userId,
				lineage: opts.lineage,
				reason: cap
			})
			return {
				specSlug: resolved.spec,
				receipt,
				refused: cap,
				...(resolved.fallback ? { fallback: resolved.fallback } : {})
			}
		}
	}

	if (opts.lineage) noteRun(runId, resolved.spec, opts.lineage.parentRunId)

	// A child is a run somebody can watch and stop — registered like an
	// action's, under the run owner; the parent's stop reaches it through
	// its own handle. A listener-lane dispatch (R65) of one of core's own
	// specs is not — the turn-order recompute after a write: registered, it
	// read as a live reply and shut the session's verbs while it ran. Anyone
	// else's pipeline on the lane is registered: it may stream, call a model
	// or loop, and a person must be able to see and stop it (R65 review).
	const handle =
		opts.lineage && (!opts.depthOnly || !resolved.spec.startsWith("core:"))
		? runRegistry.start({
				runId,
				userId: opts.userId,
				sessionId: opts.sessionId,
				specId: resolved.spec,
				kind: "action"
			})
		: null
	const onParentAbort = () =>
		runRegistry.cancelAs(
			runId,
			"system:parent-stopped",
			"the run that dispatched this one was stopped"
		)
	if (handle)
		opts.signal?.addEventListener("abort", onParentAbort, { once: true })
	try {
		const receipt = await runSpec({
			db,
			sessionId: opts.sessionId,
			userId: opts.userId,
			specId: resolved.spec,
			runId,
			input: opts.input,
			io: opts.io,
			signal: handle ? handle.controller.signal : opts.signal,
			...(handle
				? { cancelSignal: () => runRegistry.cancellation(handle) }
				: {}),
			lineage: opts.lineage,
			...(opts.sink ? { sink: opts.sink } : {}),
			...(opts.onStatus ? { onStatus: opts.onStatus } : {}),
			...(opts.onParked ? { onParked: opts.onParked } : {}),
			// 🚧 The registration that started it (D7, LS2) — an event run
			// either way (LS2: every run records its family).
			...(resolved.registrationKey
				? { registration: { family: "event", key: resolved.registrationKey, minAge: resolved.minAge ?? 0 } }
				: { triggerFamily: "event" }),
			// 🚧 A session's creation waits first in the model queue (R26).
			...(opts.event === sdkSessionEvents.sessionCreated ? { creation: true } : {}),
			// A run reached through a substitution says so on its own receipt.
			// The explain surface reads it from there, which is where every other
			// "why did the turn do that" answer already lives.
			...(resolved.fallback
				? {
						meta: {
							preset: { via: "fallback", ...resolved.fallback }
						}
					}
				: {})
		})
		return {
			specSlug: resolved.spec,
			receipt,
			...(resolved.registrationKey ? { registrationKey: resolved.registrationKey } : {}),
			...(resolved.fallback ? { fallback: resolved.fallback } : {})
		}
	} finally {
		if (handle) {
			opts.signal?.removeEventListener("abort", onParentAbort)
			runRegistry.finish(runId)
			/**
			 * A registered child is `session.generating` while it runs, and
			 * it may outlive its root's end push — a listener dispatched by
			 * the root's event settles after it (Dungeon Crawler walk round
			 * 2, 2026-10-15: Continue stayed "wait for the reply to finish"
			 * with nothing running until a reload). Only then: while the root
			 * still runs, its own end push covers this child (W-A2 keeps a
			 * parked grandchild from pushing before every root has).
			 */
			const rootStillRuns = runRegistry
				.active()
				.some((h) => h.runId === opts.lineage?.parentRunId)
			if (opts.io && !rootStillRuns)
				void import("$lib/server/sessions/actionsPush").then(
					({ pushSessionActions }) => pushSessionActions(opts.io, opts.sessionId)
				)
		}
	}
}

/**
 * 🚧 R24: an event whose registrations' conditions all failed ran nothing,
 * and the receipt says so — one row on the first skipped pipeline, a halt
 * naming every registration that did not hold. No nodes ran.
 */
async function skippedReceipt(
	db: Db,
	opts: {
		sessionId: number
		userId: number
		event: string
		skipped: Array<{ spec: string; key: string }>
		lineage?: RunLineage
	}
): Promise<void> {
	const runId = uuidv4()
	const reason =
		`nothing ran on ${opts.event}: the condition of every registration on it was false now ` +
		`(${opts.skipped.map((s) => s.key).join(", ")})`
	if (opts.lineage) {
		await refusalReceipt(db, {
			runId,
			specId: opts.skipped[0]!.spec,
			sessionId: opts.sessionId,
			userId: opts.userId,
			lineage: opts.lineage,
			reason
		})
		return
	}
	const { loadPublished } = await import("$lib/server/pipelines/boot/bootstrap")
	const doc = await loadPublished(db, opts.skipped[0]!.spec)
	const now = Date.now()
	await saveReceipt(
		db,
		{
			runId,
			specId: opts.skipped[0]!.spec,
			specVersion: doc?.version ?? "0.0.0",
			schemaVersion: 1,
			seed: "",
			triggerSource: "event",
			triggerFamily: "event",
			registrationKey: opts.skipped[0]!.key,
			depth: 0,
			startedAt: now,
			endedAt: now,
			outcome: "halt",
			haltReason: reason,
			nodes: [],
			emitted: [],
			consumption: { tokens: 0, nodeExecutions: 0 }
		} as Receipt,
		{ sessionId: opts.sessionId, userId: opts.userId, artifacts: [] }
	)
}

/**
 * The receipt a refusal leaves (01 §8; U5d): a run that never started,
 * written as one row so the inspector shows the tree ending on a sentence
 * rather than on nothing. No nodes, no seed to replay — there was no run —
 * and `triggerSource: 'event'`, since an event asked for it. Written at both
 * doors a dispatched run has (U5d review, W1): a `form-addressed` child the
 * caps refused here, and the fire an `answer-form` commit could not make —
 * a cap, receipted by `dispatchFires` after the answer's own row (S-b), or
 * `fireAction`'s own refusal at the dispatch.
 *
 * The same row for a fire that was **stopped** before it ran or that
 * **threw** on its way (U5d review, W-a): the answer's receipt names
 * `firedRunId`, so a fire that leaves no row is a run the inspector cannot
 * find. `cancelled` carries the stop's actor and reason the way the
 * executor stamps them; a throw is a `halt` on the error's sentence.
 */
export async function refusalReceipt(
	db: Db,
	opts: {
		runId: string
		specId: string
		sessionId: number
		userId: number
		lineage: RunLineage
		reason: string
		/** `halt` unless a stop is being recorded. */
		outcome?: "halt" | "cancelled"
		/** Who stopped it — set with `outcome: 'cancelled'`. */
		cancelledBy?: string
		/** 🚧 LS2: the family of the run that did not run — an event's unless said (a fire is an action's). */
		triggerFamily?: string
	}
): Promise<Receipt> {
	const { loadPublished } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	const doc = await loadPublished(db, opts.specId)
	const now = Date.now()
	const receipt: Receipt = {
		runId: opts.runId,
		specId: opts.specId,
		specVersion: doc?.version ?? "0.0.0",
		schemaVersion: 1,
		seed: "",
		triggerSource: "event",
		triggerFamily: opts.triggerFamily ?? "event",
		parentRunId: opts.lineage.parentRunId,
		rootRunId: opts.lineage.rootRunId,
		depth: opts.lineage.depth,
		startedAt: now,
		endedAt: now,
		outcome: opts.outcome ?? "halt",
		haltReason: opts.reason,
		...(opts.outcome === "cancelled" && opts.cancelledBy
			? { cancelledBy: opts.cancelledBy }
			: {}),
		nodes: [],
		emitted: [],
		consumption: { tokens: 0, nodeExecutions: 0 }
	}
	await saveReceipt(db, receipt, {
		sessionId: opts.sessionId,
		userId: opts.userId,
		artifacts: []
	})
	return receipt
}
