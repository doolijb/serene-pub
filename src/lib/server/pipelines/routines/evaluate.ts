/**
 * 🚧 **Cadence evaluation** (PLAN-layering D2, D7, R5, R9, R15–R21; lane 6,
 * 2026-10-20) — at a session moment, which of the session's routines come
 * due.
 *
 * The host evaluates cadences only at moments: every session event (each
 * routine whose cadence wakes on `event`, and the moments five of them are —
 * turn ended, round ended, scene opened, scene closed, story clock moved),
 * a published value moving (`value-changed`, read only when a routine
 * listens for one) and the 5-minute system tick. A cadence that does not
 * wake on the moment is never asked; one that is not due costs nothing past
 * the session's cached registrations (its state rides on them).
 *
 *  · **Core's cadences** are evaluated natively (`cadenceDue`); a
 *    **plugin's** by its script, kind `core:script:cadence/due@1`, in the
 *    sandbox — a verdict and its state, no data out (R9) — and never when
 *    the scripts kill switch is off.
 *  · **Off** routines are not evaluated (R37): an Off routine keeps no time.
 *  · **System-clock** cadences wait for the session's first interaction
 *    since the process started (R21) and sleep while a cap paused them (R11).
 *  · **Not recursive** (R19): a routine never wakes itself, and a moment a
 *    routine's own write caused wakes other routines one level deep only —
 *    the reckoning moving the clock wakes a Timeline Cron, whose own writes
 *    wake nothing.
 *  · A Timeline Cron or story-clock Schedule skipped because the clock
 *    jumped past its ceiling leaves an inspector line (R19).
 */
import { v4 as uuidv4 } from "uuid"
import { eq } from "drizzle-orm"
import {
	cadenceClock,
	cadenceDue,
	cadenceMomentKinds,
	cadenceOptionsOf,
	getCadence,
	sessionEvents as sdkSessionEvents,
	storyTimeText,
	type CadenceDef,
	type CadenceMoment,
	type CadenceState,
	type CadenceVerdict,
	type EffectiveRegistration,
	type RoutineCause,
	type StoryTime
} from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { coreAnnexIn } from "$lib/server/sessions/coreAnnex"
import type { SessionIo } from "$lib/server/pipelines/runtime/liveRow"
import { cadenceStateOf, saveCadenceState } from "$lib/server/pipelines/routines/state"
import { routinesEnabled, type RoutineRunFact } from "$lib/server/pipelines/routines/runs"
import { isResumed, pauseOf } from "$lib/server/pipelines/routines/interaction"

/** The five session moments that are events (lane 1). */
export const MOMENT_EVENTS: ReadonlySet<string> = new Set([
	sdkSessionEvents.turnEnded,
	sdkSessionEvents.roundEnded,
	sdkSessionEvents.sceneOpened,
	sdkSessionEvents.sceneClosed,
	sdkSessionEvents.storyClockMoved
])

/** What one evaluation hands each firing besides its moment. */
export interface MomentContext {
	at: number
	/** The turn, round or scene the moment is. */
	firedAt?: { turn?: number; round?: number; sceneId?: number }
	io?: SessionIo
	/** The routine run whose own write caused the moment, when one did (R19). */
	fromRoutine?: RoutineRunFact
}

/** A session's routines a moment could wake: registered, not Off, not the one whose write caused it. */
export function wakeableRoutines(
	effective: readonly EffectiveRegistration[],
	fromRoutine?: Pick<RoutineRunFact, "registrationKey">
): Array<EffectiveRegistration & { trigger: { family: "routine" } }> {
	return effective.filter(
		(r) =>
			r.trigger.family === "routine" &&
			(r.mode ?? "full") !== "off" &&
			r.key !== fromRoutine?.registrationKey
	) as Array<EffectiveRegistration & { trigger: { family: "routine" } }>
}

/** The moment kinds a set of routines wakes on. */
export function wakesOf(routines: ReadonlyArray<EffectiveRegistration>): Set<string> {
	const out = new Set<string>()
	for (const r of routines)
		if (r.trigger.family === "routine") for (const k of cadenceMomentKinds(getCadence(r.trigger.cadence.id))) out.add(k)
	return out
}

/** A participant reference, when a value is one. */
const refOf = (v: unknown): string | undefined => (typeof v === "string" && v.includes(":") ? v : undefined)

/** What a moment carries, as the routine inlet's `cause` (R9) — the moment's own facts, nothing more. */
export function causeOf(moment: CadenceMoment, ctx: { at: number; event?: string; payload?: unknown }): RoutineCause {
	const p = (ctx.payload && typeof ctx.payload === "object" ? ctx.payload : {}) as Record<string, unknown>
	const base: RoutineCause = {
		moment: moment.kind,
		at: ctx.at,
		...(ctx.event ? { event: ctx.event } : {}),
		...(ctx.payload !== undefined ? { payload: ctx.payload } : {})
	}
	if (typeof p.messageId === "number") base.messageId = p.messageId
	if (p.speaker === null || typeof p.speaker === "string") base.speaker = p.speaker as string | null
	if (moment.kind === "turn-ended" || moment.kind === "round-ended") {
		// R51, R52: the turn's lane, number, round and who spoke.
		if (typeof p.lane === "string") base.lane = p.lane
		if (typeof p.turn === "number") base.turn = p.turn
		if (typeof p.round === "number") base.round = p.round
		if (p.turnsBy && typeof p.turnsBy === "object") base.turnsBy = { ...(p.turnsBy as Record<string, number>) }
		if (Array.isArray(p.speakers)) base.speakers = p.speakers.filter((x): x is string => typeof x === "string")
	}
	if (typeof p.sceneId === "number") base.sceneId = p.sceneId
	const castMember = refOf(p.ref)
	if (castMember) base.castMember = castMember
	if (typeof p.subject === "string") base.subject = p.subject
	if (typeof p.actor === "string") base.actor = p.actor
	if (typeof p.userId === "number") base.user = `user:${p.userId}`
	if (typeof p.slot === "string") base.slot = p.slot
	switch (moment.kind) {
		case "story-clock-moved":
			base.clock = { from: moment.from, to: moment.to }
			break
		case "scene-opened":
		case "scene-closed":
			if (moment.sceneId != null) base.sceneId = moment.sceneId
			break
		case "system-tick":
			base.scheduledFor = moment.at
			break
	}
	return base
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {})

/**
 * A plugin's cadence, by its script (`core:script:cadence/due@1`): a verdict
 * and its state, no data out. Never due when scripts are switched off.
 */
export async function scriptVerdict(
	db: Db,
	def: CadenceDef,
	options: Readonly<Record<string, unknown>>,
	moment: CadenceMoment,
	state: CadenceState,
	seedLabel: string,
	/** 🚧 The session's turn facts (R51, R52) — `session.turn` · `round` · `lastSpeaker` · `turnsBy`. */
	session?: Readonly<Record<string, unknown>>
): Promise<CadenceVerdict> {
	const source = typeof def.evaluate === "object" ? def.evaluate.script : ""
	const { scriptsEnabledFor } = await import("$lib/server/pipelines/scripts/chains")
	if (!(await scriptsEnabledFor(db))) return { due: false, state, reason: "scripts are switched off on this pub" }
	const { runScriptSource } = await import("$lib/server/pipelines/scripts/host")
	const at = "at" in moment && typeof moment.at === "number" ? moment.at : Date.now()
	const r = await runScriptSource({
		source,
		vars: {
			moment: JSON.parse(JSON.stringify(moment)),
			options: { ...options },
			state: { ...state },
			session: JSON.parse(JSON.stringify(session ?? {}))
		},
		seedLabel,
		nowMs: at
	})
	if (!r.ok) {
		console.warn(`[routines] the cadence script of ${def.id} failed: ${r.reason}`)
		return { due: false, state, reason: `its script failed: ${r.reason}` }
	}
	const v = r.value
	if (typeof v === "boolean") return { due: v, state }
	if (v && typeof v === "object") {
		const o = v as { due?: unknown; state?: unknown }
		const next = o.state && typeof o.state === "object" ? (o.state as CadenceState) : state
		return o.due === true ? { due: true, state: next } : { due: false, state: next, reason: "its script said not yet" }
	}
	return { due: false, state, reason: "its script said nothing" }
}

/** "from 412-03-05 22:30 to 412-03-08 09:00" — what a jump says beside its ceiling. */
const jumpWords = (from: StoryTime, to: StoryTime) => {
	try {
		return ` (from ${storyTimeText(from)} to ${storyTimeText(to)})`
	} catch {
		return ""
	}
}

/**
 * Evaluate `moments`, in order, against the session's routines; queue every
 * firing that comes due (`routineQueue.fire`, which applies Allow stacking),
 * keep each cadence's new state, and say a jump-ceiling skip. Returns the
 * keys it queued. Never throws.
 */
export async function evaluateMoments(
	db: Db,
	sessionId: number,
	moments: ReadonlyArray<{ moment: CadenceMoment; event?: string; payload?: unknown }>,
	ctx: MomentContext,
	resolved?: Awaited<ReturnType<typeof import("$lib/server/pipelines/registrations/resolve").effectiveRegistrations>>
): Promise<string[]> {
	const queued: string[] = []
	if (!routinesEnabled() || !moments.length) return queued
	if (ctx.fromRoutine && ctx.fromRoutine.depth >= 1) return queued
	try {
		// 🚧 pr-6 R-k: an archived session is read-only — nothing wakes.
		const { sessionArchivedRefusal } = await import("$lib/server/sessions/archive")
		if (await sessionArchivedRefusal(db, sessionId)) return queued
		const { effectiveRegistrations } = await import("$lib/server/pipelines/registrations/resolve")
		const regs = resolved === undefined ? await effectiveRegistrations(db, sessionId) : resolved
		if (!regs) return queued
		const wakeable = wakeableRoutines(regs.effective, ctx.fromRoutine)
		if (!wakeable.length) return queued
		// 🚧 R56: a routine whose pipeline needs a model nothing here serves is
		// disabled — not evaluated, as if Off — never a run that fails.
		const { unservedPipelines } = await import("$lib/server/pipelines/registrations/unserved")
		const unserved = await unservedPipelines(db, wakeable.map((r) => r.pipeline))
		const routines = wakeable.filter((r) => !unserved.has(r.pipeline))
		if (!routines.length) return queued
		const { routineQueue, routineLine } = await import("$lib/server/pipelines/routines/run")
		let sessionFacts: Readonly<Record<string, unknown>> | undefined
		for (const { moment, event, payload } of moments) {
			for (const r of routines) {
				const ref = r.trigger.cadence
				const def = getCadence(ref.id)
				if (!def || !cadenceMomentKinds(def).includes(moment.kind)) continue
				if (cadenceClock(ref) === "system") {
					// R21: after a restart, nothing on the system clock until someone plays.
					if (!isResumed(sessionId)) continue
					// R11: a cap paused it until the next interaction.
					if (pauseOf(sessionId, r.key)) continue
				}
				const state = await cadenceStateOf(db, sessionId, r.key, ref, regs.rows.session)
				const verdict =
					def.evaluate === "host"
						? cadenceDue(ref, moment, state)
						: await scriptVerdict(
								db,
								def,
								cadenceOptionsOf(ref),
								moment,
								state,
								`cadence:${sessionId}:${r.key}`,
								(sessionFacts ??= await sessionTurnFacts(db, sessionId))
							)
				if (!same(verdict.state, state)) await saveCadenceState(db, sessionId, r.key, verdict.state)
				if (!verdict.due) {
					if (verdict.reason?.startsWith("Skipped:") && moment.kind === "story-clock-moved")
						await routineLine(db, {
							firing: { sessionId, registrationKey: r.key, pipeline: r.pipeline },
							reason: `${verdict.reason}${jumpWords(moment.from, moment.to)}`,
							kind: "skipped"
						})
					continue
				}
				const outcome = await routineQueue.fire(
					{
						id: uuidv4(),
						db,
						sessionId,
						registrationKey: r.key,
						pipeline: r.pipeline,
						cause: causeOf(moment, { at: ctx.at, event, payload }),
						firedAt: { ...(ctx.firedAt ?? {}) },
						depth: ctx.fromRoutine ? ctx.fromRoutine.depth + 1 : 0,
						...(ctx.io ? { io: ctx.io } : {}),
						queuedAt: Date.now()
					},
					{ allowStacking: r.allowStacking === true }
				)
				if (outcome.queued) queued.push(r.key)
			}
		}
	} catch (err) {
		console.warn(`[routines] the cadences of session ${sessionId} were not evaluated:`, err)
	}
	return queued
}

/** 🚧 The session's turn facts a cadence script reads (`session.turn` · `round` · `lastSpeaker` · `turnsBy`). */
async function sessionTurnFacts(db: Db, sessionId: number): Promise<Record<string, unknown>> {
	const { publishedTurns } = await import("$lib/server/pipelines/routines/turnTally")
	try {
		const [s] = await db
			.select({ annex: schema.sessions.annex })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
			.limit(1)
		return publishedTurns(coreAnnexIn(s?.annex ?? null))
	} catch {
		// Never the reason a cadence is not judged: the script sees no turn facts.
		return publishedTurns(null)
	}
}

/** The calendar of a session's book, for a story-clock moment. Null for a free-form book or none. */
async function calendarOf(db: Db, sessionId: number) {
	const [s] = await db
		.select({ lorebookId: schema.sessions.lorebookId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!s?.lorebookId) return null
	const { bookCalendarOf } = await import("$lib/server/state/storyTime")
	return await bookCalendarOf(db, s.lorebookId)
}

/**
 * **A session event, as moments** — called by the emitter for every event
 * once its dispatch has run, on the session's event chain. The event itself
 * (`event`, for `onEvent` cadences), the moment it is when it is one of the
 * five, and a `value-changed` moment when a routine listens for one. Never
 * throws.
 */
export async function onSessionEvent(
	db: Db,
	ev: {
		sessionId: number
		event: string
		payload: unknown
		at: number
		io?: SessionIo
		fromRoutine?: RoutineRunFact
	}
): Promise<string[]> {
	if (!routinesEnabled()) return []
	if (ev.event === sdkSessionEvents.turnOrderChanged) return []
	if (ev.fromRoutine && ev.fromRoutine.depth >= 1) return []
	// 🚧 Back and Forward (RF fix 5) raise one `message-hidden` so the turn
	// order recomputes; no routine runs on either — not even an `onEvent`
	// cadence listening for every event.
	if ((ev.payload as { rewind?: unknown } | null)?.rewind !== undefined) return []
	try {
		const { effectiveRegistrations } = await import("$lib/server/pipelines/registrations/resolve")
		const resolved = await effectiveRegistrations(db, ev.sessionId)
		if (!resolved) return []
		const wakes = wakesOf(wakeableRoutines(resolved.effective, ev.fromRoutine))
		if (!wakes.size) return []
		const p = (ev.payload && typeof ev.payload === "object" ? ev.payload : {}) as Record<string, unknown>
		const moments: Array<{ moment: CadenceMoment; event?: string; payload?: unknown }> = []
		const of = (moment: CadenceMoment) => moments.push({ moment, event: ev.event, payload: ev.payload })
		// R51: every lane's lines are turns, but core's turn and round
		// cadences count the story's lane; another lane's turn reaches a
		// routine only through an `onEvent` cadence (the `event` moment below).
		const storyLane = p.lane === undefined || p.lane === "main"
		switch (ev.event) {
			case sdkSessionEvents.turnEnded:
				if (wakes.has("turn-ended") && storyLane && typeof p.turn === "number")
					of({
						kind: "turn-ended",
						turn: p.turn,
						...(typeof p.speaker === "string" ? { speaker: p.speaker } : p.speaker === null ? { speaker: "narrator" } : {}),
						...(typeof p.lane === "string" ? { lane: p.lane } : {}),
						...(typeof p.round === "number" ? { round: p.round } : {}),
						...(p.turnsBy && typeof p.turnsBy === "object" ? { turnsBy: p.turnsBy as Record<string, number> } : {})
					})
				break
			case sdkSessionEvents.roundEnded:
				if (wakes.has("round-ended") && storyLane)
					of({
						kind: "round-ended",
						round: typeof p.round === "number" ? p.round : 0,
						...(Array.isArray(p.speakers) ? { speakers: p.speakers as string[] } : {}),
						...(typeof p.lane === "string" ? { lane: p.lane } : {})
					})
				break
			case sdkSessionEvents.sceneOpened:
				if (wakes.has("scene-opened"))
					of({ kind: "scene-opened", ...(typeof p.sceneId === "number" ? { sceneId: p.sceneId } : {}) })
				break
			case sdkSessionEvents.sceneClosed:
				if (wakes.has("scene-closed"))
					of({ kind: "scene-closed", ...(typeof p.sceneId === "number" ? { sceneId: p.sceneId } : {}) })
				break
			case sdkSessionEvents.storyClockMoved: {
				const clock = p.clock as { from?: StoryTime; to?: StoryTime } | undefined
				if (wakes.has("story-clock-moved") && clock?.from && clock?.to)
					of({
						kind: "story-clock-moved",
						from: clock.from,
						to: clock.to,
						calendar: await calendarOf(db, ev.sessionId)
					})
				break
			}
		}
		if (wakes.has("event")) of({ kind: "event", event: ev.event, payload: ev.payload })
		if (wakes.has("value-changed") && !MOMENT_EVENTS.has(ev.event)) {
			const { publishedValues } = await import("$lib/server/pipelines/entities/publishedValues")
			of({ kind: "value-changed", values: await publishedValues(db, ev.sessionId) })
		}
		return await evaluateMoments(
			db,
			ev.sessionId,
			moments,
			{
				at: ev.at,
				firedAt: {
					...(typeof p.turn === "number" ? { turn: p.turn } : {}),
					...(typeof p.round === "number" ? { round: p.round } : {}),
					...(typeof p.sceneId === "number" ? { sceneId: p.sceneId } : {})
				},
				...(ev.io ? { io: ev.io } : {}),
				...(ev.fromRoutine ? { fromRoutine: ev.fromRoutine } : {})
			},
			resolved
		)
	} catch (err) {
		console.warn(`[routines] ${ev.event} in session ${ev.sessionId} was not evaluated:`, err)
		return []
	}
}
