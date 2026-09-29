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
	answersEvent,
	lockedEventSpec,
	presetEventSpec,
	type PresetFallback
} from "$lib/server/pipelines/entities/presetBindings"
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
import { sessionEvents as sdkSessionEvents, type EventCause, type Receipt } from "@serene-pub/sdk"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	recordSessionChange,
	type SessionEventPayload
} from "$lib/server/messages/sessionChanges"
import { STANDARD_GENRE_ID } from "$lib/server/pipelines/entities/sessionGenres"

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
		event: opts.event,
		sessionId: opts.sessionId,
		at
	} as SessionEventPayload
	const cause = payload.cause

	/**
	 * (a) The ledger — for every event but `turn-order-changed`.
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
	if (opts.event !== "core:event/turn-order-changed@1")
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

	// (c) and (d) run after the writer returns, on the session's queue —
	// unless the caller asked to wait (see `wait` above).
	const rest = () => settleRest(db, opts, payload, cause, at)
	if (!opts.wait) {
		if (opts.lineage)
			queueChild(opts.sessionId, opts.lineage.rootRunId, rest)
		else enqueue(opts.sessionId, rest)
		return { dispatched: null }
	}
	if (!opts.lineage) return await rest()
	openBranch(opts.lineage.rootRunId)
	try {
		return await rest()
	} finally {
		closeBranch(opts.lineage.rootRunId)
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
 * Wait until a session's queue (or every session's) is empty — work queued
 * by work already queued included. For tests and for a caller that must see
 * the settled state; production writers never wait on it.
 */
export async function settleSessionEvents(sessionId?: number): Promise<void> {
	for (;;) {
		const pending =
			sessionId === undefined
				? [...queues.values()]
				: [queues.get(sessionId)].filter(Boolean)
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
	at: number
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
	return { dispatched }
}

/**
 * The session's own binding for an event (plans/31 V2): the spec its
 * `pipeline_bindings` row at session scope names for `event`, when that spec
 * still answers (genre, event) on its inlet lock — else null, and the layers
 * below decide. Eligibility is re-checked at read for the reason every
 * binding's is: a row whose spec left the bucket falls through rather than
 * routing to something that cannot serve.
 */
export async function sessionBoundEventSpec(
	db: Db,
	sessionId: number,
	genreId: string,
	event: string
): Promise<string | null> {
	const [row] = await db
		.select({ specId: schema.pipelineBindings.specId })
		.from(schema.pipelineBindings)
		.where(
			and(
				eq(schema.pipelineBindings.scopeKind, "session"),
				eq(schema.pipelineBindings.scopeId, sessionId),
				eq(schema.pipelineBindings.genreId, genreId),
				eq(schema.pipelineBindings.subject, event)
			)
		)
		.limit(1)
	if (!row) return null
	const [spec] = await db
		.select({
			slug: schema.pipelineSpecs.slug,
			activeVersionId: schema.pipelineSpecs.activeVersionId
		})
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.id, row.specId))
		.limit(1)
	if (!spec?.activeVersionId) return null
	const [version] = await db
		.select({
			status: schema.pipelineSpecVersions.status,
			inputGenre: schema.pipelineSpecVersions.inputGenre,
			inputEvent: schema.pipelineSpecVersions.inputEvent,
			inputEvents: schema.pipelineSpecVersions.inputEvents
		})
		.from(schema.pipelineSpecVersions)
		.where(eq(schema.pipelineSpecVersions.id, spec.activeVersionId))
		.limit(1)
	// A lock names one event or several (`input_events`, 0154): asked through
	// the one helper the preset's resolution uses, so the two cannot disagree.
	const answers = !!version && answersEvent(version as never, event)
	if (!version || version.status !== "published" || version.inputGenre !== genreId || !answers)
		return null
	return spec.slug
}

/**
 * Which spec answers (genre, event) for this session, and how it was reached.
 *
 * Three layers, in this order:
 *
 * 0. **The session's own binding** on the event id (plans/31 V2; closes the
 *    R-6 gap): a `pipeline_bindings` row at session scope whose `subject` is
 *    this event, when its spec still answers (genre, event) — the same
 *    eligibility `resolveSubjectVerdict` re-checks. A session is a work, not
 *    a preference (12 §2): its own choice beats its preset's.
 * 1. **The session's preset**, when a `sessionId` is given and its preset
 *    binds this event (24 §1). A preset that names a pipeline is an
 *    administrator answering the question directly, so it outranks the lock's
 *    own answer — which is the whole reason the binding exists. A binding the
 *    instance cannot resolve does NOT refuse the turn (ruled 2026-09-10): it comes
 *    back as `fallback`, carrying layer 2's answer plus everything a surface
 *    needs to say the substitution out loud. An upgrade or a plugin removal
 *    must never stop a session working without an admin change.
 * 2. **The input lock** — the one published spec whose active version declares
 *    (genre, event) as columns. Unchanged, and still the answer for every
 *    session on no preset and every caller with no session in hand (the seed
 *    backfill, the admin form's defaults).
 *
 * Everything else still degrades to null, which is a normal state and not a
 * failure (the F29 posture).
 */
export interface SessionEventResolution {
	spec: string | null
	/**
	 * Present only when the session's preset bound this event to something
	 * this instance cannot resolve. Its presence IS the fact the receipt, the
	 * banner and the admin notice all state.
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
		// R-6 (ruled 2026-09-15; the event half built with plans/31 V2): a
		// session's own choice resolves BEFORE its preset, on the same row
		// and the same eligibility the reply's `resolveSubjectVerdict` reads
		// for an event subject, so a reply and a dispatched event cannot
		// route differently.
		if (scope?.sessionId != null) {
			const own = await sessionBoundEventSpec(
				db,
				scope.sessionId,
				genreId,
				event
			)
			if (own) return { spec: own }
		}
		const verdict = await presetEventSpec(db, {
			sessionId: scope?.sessionId,
			genreId,
			event
		})
		if (verdict.via === "preset") return { spec: verdict.spec }
		if (verdict.via === "fallback") {
			const { via: _via, spec, ...fallback } = verdict
			return { spec, fallback }
		}
		return { spec: await lockedEventSpec(db, genreId, event) }
	} catch {
		// Routing infrastructure failing still degrades to "nothing serves",
		// which the caller answers with its own floor (the F29 posture).
		return { spec: null }
	}
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
	}
): Promise<SessionEventDispatch | null> {
	const resolved = await resolveSessionEventVerdict(
		db,
		opts.genreId,
		opts.event,
		// The session is in hand here, so its preset gets to answer first.
		{ sessionId: opts.sessionId }
	)
	if (opts.expectSpec && resolved.spec !== opts.expectSpec && opts.lineage) {
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
							expectSpec: resolved.spec ?? undefined
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
			...(resolved.fallback ? { fallback: resolved.fallback } : {})
		}
	} finally {
		if (handle) {
			opts.signal?.removeEventListener("abort", onParentAbort)
			runRegistry.finish(runId)
		}
	}
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
