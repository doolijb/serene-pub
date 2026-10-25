/**
 * 🚧 **A routine's run** (PLAN-layering D7, R9, R11, R13, R25, R37, A14; lane
 * 6, 2026-10-20) — what the routine queue does with a firing, and the one
 * queue every session's firings go through.
 *
 * A routine run is a run like any other — `runSpec`, the ordinary world,
 * host, receipt — with four things of its own:
 *
 *  · **Its input is the routine inlet's** (`core:inlet/routine@1`, R9):
 *    the session (scope and settings), `routine` — where it resides: the
 *    registration, the preset, the cadence and its options, the mode, the
 *    turn / round / scene it fired on — `cause`, what the moment carried, the
 *    same moment's entities one port each, and `ruleset`, the rules the
 *    session plays. Nothing opinionated.
 *  · **It acts with the session owner's authority** (R25, A14), within the
 *    session, under its package's grants: the run's user is the owner, and
 *    its receipt says "routine ‹name›, for ‹owner›" (`meta.routine`).
 *  · **Its mode** (R37): Off skips; Review and Full run, and the pipeline
 *    reads the mode off `routine` (the reckoning proposes on Review, applies
 *    on Full). A pipeline that never reads its mode is held at the review
 *    gate on Review — each write it would make waits for the owner — so
 *    Review never applies anything.
 *  · **It records its family** (LS2): `pipeline_runs.trigger_family =
 *    'routine'` with its registration key; the run registry knows it as kind
 *    `routine`, which never makes the session "generating". What it moved of
 *    the session's state is announced at its end (`state:changed`), as a
 *    reply's and an action's are.
 *
 * A system-clock routine checks the cron caps (R11) as it starts, and counts
 * as one run in a row. A run that parks at a review gate frees the queue: the
 * next routine does not wait on a person.
 */
import { v4 as uuidv4 } from "uuid"
import { eq } from "drizzle-orm"
import {
	cadenceClock,
	inletPortsRead,
	minAgeOf,
	type EffectiveRegistration,
	type Receipt,
	type RoutineFiring
} from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import * as runRegistry from "$lib/server/pipelines/runtime/runRegistry"
import { keyedLockHeld } from "$lib/server/utils/sessionGenerationLock"
import { saveReceipt } from "$lib/server/pipelines/runtime/receipts"
import {
	addSettleProbe,
	sessionEventsIdle,
	sessionEventsPending
} from "$lib/server/pipelines/runtime/sessionEvents"
import { RoutineQueue, type RoutineFiringEntry } from "$lib/server/pipelines/routines/queue"
import { forgetRoutineRun, noteRoutineRun } from "$lib/server/pipelines/routines/runs"
import {
	capsOf,
	capsPause,
	countSystemClockRun,
	pause,
	sessionCapsFacts
} from "$lib/server/pipelines/routines/interaction"

/** The families a routine waits on (R13, worded by family — LS2). */
const WAITS_ON: ReadonlySet<string> = new Set(["action", "event"])

/** How long a routine waiting on a run or a lock looks again. */
export const QUIET_POLL_MS = 200

/**
 * Is an action or event run of this session pending or running (R13)? The
 * run registry (a reply, an action, a child a run dispatched), the
 * session's event chain (what a write set off, still to run) and its
 * generation lock (a turn being fired).
 */
export function sessionBusyForRoutines(sessionId: number): boolean {
	if (runRegistry.sessionRunsOf(sessionId, WAITS_ON).length) return true
	if (keyedLockHeld("generation", sessionId)) return true
	return sessionEventsPending(sessionId)
}

const beat = (ms: number) =>
	new Promise<void>((resolve) => {
		const t = setTimeout(resolve, ms)
		;(t as { unref?: () => void }).unref?.()
	})

/** The one queue, per process (on `globalThis`, as the event queues are). */
const QUEUE_KEY = Symbol.for("serene-pub.routineQueue")
export const routineQueue: RoutineQueue = ((globalThis as Record<symbol, unknown>)[QUEUE_KEY] ??= new RoutineQueue({
	busy: sessionBusyForRoutines,
	waitQuiet: (sessionId) => Promise.race([sessionEventsIdle(sessionId), beat(QUIET_POLL_MS)]),
	run: (f) => runRoutineFiring(f),
	refused: (f, reason) => routineLine(f.db as Db, { firing: f, reason, kind: "skipped" })
})) as RoutineQueue

// A settle (`settleSessionEvents`) waits for the routines a session's events
// set off, as it waits for the events — a test reads what the turn did.
addSettleProbe((sessionId) => routineQueue.settling(sessionId))

/** A registration's label: its own, else the pipeline's name, else its id. */
async function labelOf(db: Db, reg: EffectiveRegistration): Promise<string> {
	const own = reg.label as unknown
	if (typeof own === "string" && own.trim()) return own
	const en = (own as { en?: unknown } | null | undefined)?.en
	if (typeof en === "string" && en.trim()) return en
	try {
		const [row] = await db
			.select({ name: schema.pipelineSpecs.name })
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, reg.pipeline))
			.limit(1)
		if (row?.name) return row.name
	} catch {
		// The id says it.
	}
	return reg.pipeline
}

/** The owner's name, as a receipt says it. */
async function ownerName(db: Db, userId: number): Promise<string> {
	try {
		const [u] = await db
			.select({ username: schema.users.username, displayName: schema.users.displayName })
			.from(schema.users)
			.where(eq(schema.users.id, userId))
			.limit(1)
		return u?.displayName?.trim() || u?.username || `user ${userId}`
	} catch {
		return `user ${userId}`
	}
}

/**
 * A routine that did not run, said where the inspector reads (R18, R19,
 * R11): one halted receipt on the routine's pipeline, no nodes — "Skipped:
 * already waiting", "Skipped: the clock jumped …", "Paused after 12 runs in
 * a row". Never throws.
 */
export async function routineLine(
	db: Db,
	opts: {
		firing: Pick<RoutineFiringEntry, "sessionId" | "registrationKey" | "pipeline">
		reason: string
		kind: "skipped" | "paused"
		userId?: number | null
	}
): Promise<void> {
	try {
		const { loadPublished } = await import("$lib/server/pipelines/boot/bootstrap")
		const doc = await loadPublished(db, opts.firing.pipeline)
		let userId = opts.userId ?? null
		if (userId == null) {
			const [s] = await db
				.select({ userId: schema.sessions.userId })
				.from(schema.sessions)
				.where(eq(schema.sessions.id, opts.firing.sessionId))
				.limit(1)
			userId = s?.userId ?? null
		}
		const now = Date.now()
		await saveReceipt(
			db,
			{
				runId: uuidv4(),
				specId: opts.firing.pipeline,
				specVersion: doc?.version ?? "0.0.0",
				schemaVersion: 1,
				seed: "",
				triggerSource: "schedule",
				triggerFamily: "routine",
				registrationKey: opts.firing.registrationKey,
				depth: 0,
				startedAt: now,
				endedAt: now,
				outcome: "halt",
				haltReason: opts.reason,
				meta: { routine: { [opts.kind]: true, registrationKey: opts.firing.registrationKey } },
				nodes: [],
				emitted: [],
				consumption: { tokens: 0, nodeExecutions: 0 }
			} as Receipt,
			{ sessionId: opts.firing.sessionId, userId: userId ?? undefined, artifacts: [] }
		)
	} catch (err) {
		console.warn(`[routines] the line "${opts.reason}" for ${opts.firing.registrationKey} was not kept:`, err)
	}
}

/**
 * The run of one firing (R9, R25, R37) — to its end, or until it parks at a
 * review gate for the owner. Never throws.
 */
export async function runRoutineFiring(f: RoutineFiringEntry): Promise<void> {
	const db = f.db as Db
	// 🚧 pr-6 R-k: an archived session is read-only — the firing is skipped, and says so.
	{
		const { sessionArchivedRefusal } = await import("$lib/server/sessions/archive")
		const archived = await sessionArchivedRefusal(db, f.sessionId)
		if (archived) {
			await routineLine(db, { firing: f, reason: archived, kind: "skipped" })
			return
		}
	}
	const { effectiveRegistrations } = await import("$lib/server/pipelines/registrations/resolve")
	const resolved = await effectiveRegistrations(db, f.sessionId)
	const reg = resolved?.effective.find((r) => r.key === f.registrationKey && r.trigger.family === "routine")
	if (!resolved || !reg || reg.trigger.family !== "routine") {
		if (resolved)
			await routineLine(db, {
				firing: f,
				reason: "Skipped: the routine is no longer registered in this session",
				kind: "skipped"
			})
		return
	}
	const mode = reg.mode ?? "full"
	// Off skips (R37) — Run now is refused at its door for an Off routine.
	if (mode === "off" && !f.runNow) return

	const cadence = reg.trigger.cadence
	const systemClock = cadenceClock(cadence) === "system"
	const facts = await sessionCapsFacts(db, f.sessionId)
	if (facts.ownerId == null) return
	const owner = facts.ownerId
	if (systemClock && !f.runNow) {
		const why = capsPause(Date.now(), facts, capsOf(facts.system, facts.user, reg.caps))
		if (why) {
			if (pause(f.sessionId, reg.key, why))
				await routineLine(db, { firing: f, reason: why, kind: "paused", userId: owner })
			return
		}
		await countSystemClockRun(db, f.sessionId)
	}

	const { loadPublished } = await import("$lib/server/pipelines/boot/bootstrap")
	const doc = await loadPublished(db, reg.pipeline)
	if (!doc) {
		await routineLine(db, {
			firing: f,
			reason: `Skipped: '${reg.pipeline}' is not published on this pub`,
			kind: "skipped",
			userId: owner
		})
		return
	}
	const [name, forWhom] = await Promise.all([labelOf(db, reg), ownerName(db, owner)])
	const { sessionRulesetInput, runSpec } = await import("$lib/server/pipelines/runtime/runTurn")
	const routine: RoutineFiring = {
		registrationKey: reg.key,
		presetId: resolved.presetId,
		cadence: { id: cadence.id, options: { ...cadence.options } },
		mode,
		firedAt: { ...f.firedAt }
	}
	const cause = f.cause
	const input: Record<string, unknown> = {
		sessionId: f.sessionId,
		sessionScope: { sessionId: f.sessionId, userId: owner },
		routine,
		cause,
		ruleset: await sessionRulesetInput(db, f.sessionId),
		...(cause.messageId != null ? { message: cause.messageId } : {}),
		...(cause.speaker !== undefined ? { speaker: cause.speaker } : {}),
		...(cause.actor !== undefined ? { actor: cause.actor } : {}),
		...(cause.castMember !== undefined ? { castMember: cause.castMember } : {}),
		...(cause.subject !== undefined ? { subject: cause.subject } : {}),
		...(cause.user !== undefined ? { user: cause.user } : {}),
		...(cause.slot !== undefined ? { slot: cause.slot } : {}),
		...(cause.clock !== undefined ? { clock: cause.clock } : {}),
		...(cause.sceneId != null ? { scene: cause.sceneId } : {})
	}
	/**
	 * Review on a pipeline that never reads its mode: hold every write it
	 * would make at the review gate, for the owner — Review never applies.
	 */
	const readsMode = inletPortsRead(doc as never).includes("routine")
	const overrides: Array<{ nodeKey: string; slot: string; path: string; value: unknown }> =
		mode === "review" && !readsMode
			? (doc.nodes as Array<{ key: string; kind: string }>)
					.filter((n) => n.kind === "outlet")
					.map((n) => ({ nodeKey: n.key, slot: "settings", path: "review", value: "on" }))
			: []
	const runId = uuidv4()
	const handle = runRegistry.start({ runId, userId: owner, sessionId: f.sessionId, specId: reg.pipeline, kind: "routine" })
	noteRoutineRun(runId, { sessionId: f.sessionId, registrationKey: reg.key, depth: f.depth })
	let parked!: () => void
	const parkedAt = new Promise<void>((resolve) => (parked = resolve))
	const run = runSpec({
		db,
		sessionId: f.sessionId,
		userId: owner,
		specId: reg.pipeline,
		runId,
		input,
		...(f.io ? { io: f.io } : {}),
		signal: handle.controller.signal,
		cancelSignal: () => runRegistry.cancellation(handle),
		registration: { family: "routine", key: reg.key, minAge: minAgeOf(reg) },
		meta: {
			routine: {
				name,
				for: forWhom,
				said: `routine ${name}, for ${forWhom}`,
				registrationKey: reg.key,
				cadence: cadence.id,
				mode,
				...(f.runNow ? { runNow: true } : {})
			}
		},
		...(overrides.length ? { overrides } : {}),
		onParked: () => parked()
	})
		.then(
			async (receipt) => {
				// What it moved of the session's state, every tab re-reads — as a
				// reply's and an action's end announce theirs.
				if (f.io) {
					const { announceStateChanges } = await import("$lib/server/state/announce")
					await announceStateChanges(f.io, f.sessionId, receipt).catch((err: unknown) =>
						console.warn(`[routines] what ${reg.key} moved was not announced:`, err)
					)
				}
			},
			(err: unknown) => {
				console.warn(`[routines] ${reg.key} in session ${f.sessionId} failed:`, err)
			}
		)
		.finally(() => {
			runRegistry.finish(runId)
			forgetRoutineRun(runId)
		})
	await Promise.race([run, parkedAt])
}

/**
 * 🚧 **Run now** (R39): the session's owner fires one of its routines by
 * hand — one that is not Off. It counts as an interaction (the cron counts
 * reset), and it queues like any firing: in its session it still waits for a
 * running action or event, and Allow stacking still holds (a routine already
 * waiting is not queued twice). Across sessions its model calls wait with
 * actions' (R26). Answers whether it was queued, or why not, in a sentence.
 */
export async function runRoutineNow(
	db: Db,
	req: { sessionId: number; userId: number; registrationKey: string; io?: RoutineFiringEntry["io"] }
): Promise<{ queued: true } | { refused: string }> {
	const { checkSessionAccess } = await import("$lib/server/utils/sessionAccess")
	const access = await checkSessionAccess(req.sessionId, req.userId)
	if (!access.hasAccess) return { refused: "Session not found." }
	if (!access.isOwner) return { refused: "Only the session's owner runs a routine by hand." }
	// 🚧 pr-6 R-k: an archived session is read-only.
	{
		const { sessionArchivedRefusal } = await import("$lib/server/sessions/archive")
		const archived = await sessionArchivedRefusal(db, req.sessionId)
		if (archived) return { refused: archived }
	}
	const { effectiveRegistrations } = await import("$lib/server/pipelines/registrations/resolve")
	const resolved = await effectiveRegistrations(db, req.sessionId)
	const reg = resolved?.effective.find((r) => r.key === req.registrationKey && r.trigger.family === "routine")
	if (!reg) return { refused: "That is not one of this session's routines." }
	if ((reg.mode ?? "full") === "off") return { refused: "That routine is Off in this session. Turn it on to run it." }
	// 🚧 R56: never a run that can only fail.
	{
		const { unservedPipelines } = await import("$lib/server/pipelines/registrations/unserved")
		const missing = (await unservedPipelines(db, [reg.pipeline])).get(reg.pipeline)
		if (missing) return { refused: missing.sentence }
	}
	const { noteInteraction } = await import("$lib/server/pipelines/routines/interaction")
	await noteInteraction(db, req.sessionId, "run-now")
	const now = Date.now()
	const outcome = await routineQueue.fire(
		{
			id: uuidv4(),
			db,
			sessionId: req.sessionId,
			registrationKey: reg.key,
			pipeline: reg.pipeline,
			cause: { moment: "run-now", at: now, user: `user:${req.userId}` },
			firedAt: {},
			depth: 0,
			...(req.io ? { io: req.io } : {}),
			runNow: { userId: req.userId },
			queuedAt: now
		},
		{ allowStacking: reg.allowStacking === true }
	)
	return outcome.queued ? { queued: true } : { refused: "It is already waiting to run." }
}
