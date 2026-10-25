/**
 * 🚧 **Interaction, the cron caps and the restart pause** (PLAN-layering D7,
 * R11, R21; lane 6, 2026-10-20).
 *
 * ## Interaction (ruled 2026-10-20)
 *
 * A member's line, an action a person fires, a form answer, an owner's
 * setting change — and Run now (R39). Each sets the session's
 * `last_interaction_at` and resets `routine_runs_since_interaction`
 * (`noteInteraction`), and resumes the session's system-clock routines.
 *
 * ## After a restart (R21)
 *
 * Every session's crons wait for an interaction: a session is **resumed**
 * (in memory) on its first interaction since the process started, and the
 * system tick looks at resumed sessions only. Nothing fires for time missed
 * while the app was down; system-clock cadence state a previous process
 * wrote reads as empty (`state.ts`), so each cron counts its next time from
 * the interaction.
 *
 * ## The caps (R11)
 *
 * Each system-clock routine run checks the session's effective **idle cron
 * timeout** and **most cron runs in a row** — min(system, the owner's user
 * setting, the registration's caps) — and past either the routine pauses,
 * with its reason ("Paused: no one has played for 3 days" / "Paused after
 * 12 runs in a row"), until the next interaction.
 */
import { eq, sql } from "drizzle-orm"
import type { RoutineCaps } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"

/** What counts as a person interacting with a session (ruled 2026-10-20, R39). */
export type InteractionKind = "line" | "action" | "form" | "setting" | "run-now"

interface InteractionFacts {
	/** Sessions resumed since this process started → their last interaction (epoch ms). */
	resumed: Map<number, number>
	/** Routines paused by a cap, per session: registration key → the reason. */
	paused: Map<number, Map<string, string>>
}

const KEY = Symbol.for("serene-pub.routineInteraction")
const facts = ((globalThis as Record<symbol, unknown>)[KEY] ??= {
	resumed: new Map(),
	paused: new Map()
} satisfies InteractionFacts) as InteractionFacts

/**
 * A person interacted with the session: stamp it, reset the runs-in-a-row
 * count, resume its crons (R21) and lift every cap's pause (R11). Never
 * throws — an interaction is the person's, and it has already happened.
 */
export async function noteInteraction(db: Db, sessionId: number, _kind: InteractionKind): Promise<void> {
	if (!Number.isInteger(sessionId)) return
	const now = Date.now()
	facts.resumed.set(sessionId, now)
	facts.paused.delete(sessionId)
	try {
		await db
			.update(schema.sessions)
			.set({ lastInteractionAt: new Date(now), routineRunsSinceInteraction: 0 })
			.where(eq(schema.sessions.id, sessionId))
	} catch (err) {
		console.warn(`[routines] the interaction with session ${sessionId} was not stamped:`, err)
	}
}

/** Has the session been interacted with since this process started (R21)? */
export const isResumed = (sessionId: number): boolean => facts.resumed.has(sessionId)

/** The session's last interaction since this process started (epoch ms), or null. */
export const lastInteractionOf = (sessionId: number): number | null => facts.resumed.get(sessionId) ?? null

/** The sessions resumed since this process started — the only ones the system tick reads. */
export const resumedSessions = (): number[] => [...facts.resumed.keys()]

/** Tests: forget every interaction and pause. */
export function _resetInteractions(): void {
	facts.resumed.clear()
	facts.paused.clear()
}

/** The routine's pause by a cap, if it is paused. */
export const pauseOf = (sessionId: number, key: string): string | undefined => facts.paused.get(sessionId)?.get(key)

/** Pause a routine until the next interaction; true when it was not paused already. */
export function pause(sessionId: number, key: string, reason: string): boolean {
	let m = facts.paused.get(sessionId)
	if (!m) facts.paused.set(sessionId, (m = new Map()))
	const fresh = !m.has(key)
	m.set(key, reason)
	return fresh
}

/** A count of runs since the last interaction went up by one (a system-clock routine ran). */
export async function countSystemClockRun(db: Db, sessionId: number): Promise<void> {
	try {
		await db
			.update(schema.sessions)
			.set({ routineRunsSinceInteraction: sql`coalesce(${schema.sessions.routineRunsSinceInteraction}, 0) + 1` })
			.where(eq(schema.sessions.id, sessionId))
	} catch (err) {
		console.warn(`[routines] the run count of session ${sessionId} was not kept:`, err)
	}
}

/** The two caps, in effect for one routine. Null = no cap at that layer. */
export interface EffectiveCaps {
	idleTimeoutMinutes: number | null
	maxRunsInRow: number | null
}

const lower = (...vs: Array<number | null | undefined>): number | null => {
	const xs = vs.filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0)
	return xs.length ? Math.min(...xs) : null
}

/** min(system, the owner's user setting, the registration's caps) — R11. Pure. */
export function capsOf(
	system: Partial<EffectiveCaps> | null | undefined,
	user: Partial<EffectiveCaps> | null | undefined,
	registration: RoutineCaps | null | undefined
): EffectiveCaps {
	return {
		idleTimeoutMinutes: lower(system?.idleTimeoutMinutes, user?.idleTimeoutMinutes, registration?.idleTimeoutMinutes),
		maxRunsInRow: lower(system?.maxRunsInRow, user?.maxRunsInRow, registration?.maxRunsInRow)
	}
}

/** "3 days", "90 minutes", "1 hour" — a span of minutes in the largest whole unit. */
export function spanWords(minutes: number): string {
	const word = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`
	if (minutes >= 1440 && minutes % 1440 === 0) return word(minutes / 1440, "day")
	if (minutes >= 60 && minutes % 60 === 0) return word(minutes / 60, "hour")
	return word(minutes, "minute")
}

/**
 * Why a system-clock routine may not run now (R11), or null: the session
 * idle past the timeout, or the runs since the last interaction at the cap.
 * Pure over what it is handed.
 */
export function capsPause(
	now: number,
	session: { lastInteractionAt: number | null; runsSinceInteraction: number },
	caps: EffectiveCaps
): string | null {
	if (caps.idleTimeoutMinutes != null && session.lastInteractionAt != null)
		if (now - session.lastInteractionAt > caps.idleTimeoutMinutes * 60_000)
			return `Paused: no one has played for ${spanWords(caps.idleTimeoutMinutes)}`
	if (caps.maxRunsInRow != null && session.runsSinceInteraction >= caps.maxRunsInRow)
		return `Paused after ${caps.maxRunsInRow} run${caps.maxRunsInRow === 1 ? "" : "s"} in a row`
	return null
}

/** The session's caps facts and the owner's and system's caps, read once. */
export async function sessionCapsFacts(
	db: Db,
	sessionId: number
): Promise<{
	ownerId: number | null
	lastInteractionAt: number | null
	runsSinceInteraction: number
	system: Partial<EffectiveCaps>
	user: Partial<EffectiveCaps>
}> {
	const [session] = await db
		.select({
			userId: schema.sessions.userId,
			lastInteractionAt: schema.sessions.lastInteractionAt,
			runs: schema.sessions.routineRunsSinceInteraction
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	const [system] = await db
		.select({
			idleTimeoutMinutes: schema.systemSettings.cronIdleTimeoutMinutes,
			maxRunsInRow: schema.systemSettings.cronMaxRunsInRow
		})
		.from(schema.systemSettings)
		.limit(1)
	const [user] =
		session?.userId != null
			? await db
					.select({
						idleTimeoutMinutes: schema.userSettings.cronIdleTimeoutMinutes,
						maxRunsInRow: schema.userSettings.cronMaxRunsInRow
					})
					.from(schema.userSettings)
					.where(eq(schema.userSettings.userId, session.userId))
					.limit(1)
			: []
	const memory = lastInteractionOf(sessionId)
	return {
		ownerId: session?.userId ?? null,
		lastInteractionAt: memory ?? (session?.lastInteractionAt ? session.lastInteractionAt.getTime() : null),
		runsSinceInteraction: session?.runs ?? 0,
		system: { idleTimeoutMinutes: system?.idleTimeoutMinutes ?? null, maxRunsInRow: system?.maxRunsInRow ?? null },
		user: { idleTimeoutMinutes: user?.idleTimeoutMinutes ?? null, maxRunsInRow: user?.maxRunsInRow ?? null }
	}
}
