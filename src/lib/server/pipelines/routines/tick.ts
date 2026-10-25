/**
 * 🚧 **The system tick** (PLAN-layering D2, D7, R10, R15, R20, R21; lane 6,
 * 2026-10-20) — the one timer every system-clock routine is woken by: System
 * Cron, a Schedule on the system clock, When nobody is playing.
 *
 *  · **One timer, on the 5-minute wall-clock grid** (R15): it fires at
 *    :00, :05, :10 … and core never emits system time to routines finer
 *    than that. The tick is a host moment only — no event, no ledger row.
 *  · **Only resumed sessions** (R21): a session's system-clock routines wait
 *    after a restart until someone interacts with it, so the tick reads the
 *    sessions interacted with since the process started — and of those,
 *    only ones whose routines wake on the tick (the cached registrations
 *    say so; nothing else is read for the rest).
 *  · Each due routine is queued like any other (it waits for the session's
 *    action and event runs, R13) and checks the cron caps when it starts
 *    (R11). The moment carries the tick's time, the session's last
 *    interaction and its owner's time zone (`users.time_zone`, for a
 *    Schedule's wall clock).
 *
 * A managed service (`services/register.ts`): started at boot, its timer
 * stopped on shutdown, and never the reason a process stays alive.
 */
import { eq } from "drizzle-orm"
import { cadenceClock, cadenceMomentKinds, getCadence, SYSTEM_TICK_MINUTES, type CadenceMoment } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { lastInteractionOf, resumedSessions } from "$lib/server/pipelines/routines/interaction"
import { routinesEnabled } from "$lib/server/pipelines/routines/runs"

/** The grid, in ms. */
export const TICK_MS = SYSTEM_TICK_MINUTES * 60_000

/** How long until the next point on the 5-minute grid (never 0: a tick at the grid point waits a whole step). */
export function msToNextTick(now: number): number {
	const rest = TICK_MS - (now % TICK_MS)
	return rest === 0 ? TICK_MS : rest
}

/** The grid point at or before `now` — the time a tick stands for. */
export const gridPoint = (now: number): number => now - (now % TICK_MS)

/** The session's socket server, when one is installed (boot binds it) — where a routine's writes are announced. */
function installedIo(): unknown {
	return (globalThis as Record<symbol, unknown>)[Symbol.for("serene-pub.notificationViewingIo")]
}

/**
 * One tick at `at` (a grid point): evaluate the system-clock routines of
 * every resumed session. Returns the sessions it evaluated. Never throws.
 */
export async function systemTick(db: Db, at: number): Promise<number[]> {
	const evaluated: number[] = []
	if (!routinesEnabled()) return evaluated
	const { effectiveRegistrations } = await import("$lib/server/pipelines/registrations/resolve")
	const { evaluateMoments, wakeableRoutines } = await import("$lib/server/pipelines/routines/evaluate")
	for (const sessionId of resumedSessions()) {
		try {
			const resolved = await effectiveRegistrations(db, sessionId)
			if (!resolved) continue
			const onTick = wakeableRoutines(resolved.effective).some(
				(r) =>
					cadenceClock(r.trigger.cadence) === "system" &&
					cadenceMomentKinds(getCadence(r.trigger.cadence.id)).includes("system-tick")
			)
			if (!onTick) continue
			const [owner] = await db
				.select({ timeZone: schema.users.timeZone })
				.from(schema.sessions)
				.innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
				.where(eq(schema.sessions.id, sessionId))
				.limit(1)
			const moment: CadenceMoment = {
				kind: "system-tick",
				at,
				lastInteractionAt: lastInteractionOf(sessionId),
				...(owner?.timeZone ? { timeZone: owner.timeZone } : {})
			}
			const io = installedIo()
			await evaluateMoments(db, sessionId, [{ moment }], { at, ...(io ? { io: io as never } : {}) }, resolved)
			evaluated.push(sessionId)
		} catch (err) {
			console.warn(`[routines] the system tick for session ${sessionId} failed:`, err)
		}
	}
	return evaluated
}

let timer: ReturnType<typeof setTimeout> | null = null
let tickDb: Db | null = null

function schedule(): void {
	if (!tickDb) return
	timer = setTimeout(() => {
		timer = null
		const db = tickDb
		if (!db) return
		void systemTick(db, gridPoint(Date.now())).finally(schedule)
	}, msToNextTick(Date.now()))
	// Never the reason a process stays alive.
	;(timer as { unref?: () => void }).unref?.()
}

/** Start the tick on the grid (idempotent). */
export function startSystemTick(db: Db): void {
	tickDb = db
	if (timer) return
	schedule()
}

/** Stop the tick (shutdown, a test). */
export function stopSystemTick(): void {
	if (timer) clearTimeout(timer)
	timer = null
	tickDb = null
}

/** The service's boot: the database ready, then the timer. */
export async function reconcileRoutinesOnBoot(): Promise<void> {
	const { db, dbReady } = await import("$lib/server/db")
	await dbReady
	startSystemTick(db as unknown as Db)
}
