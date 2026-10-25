/**
 * 🚧 **A routine's cadence state** (PLAN-layering D7, R17, R19, R21; lane 6,
 * 2026-10-20) — what a cadence keeps between moments (a cron's next time, a
 * value's last answer), kept on the session's own registration row (`state`,
 * §11-1): the session's registering row for a registration of its own, else
 * a change row of origin `routine-state` that says nothing else — the
 * routine's runtime, never a choice anybody made.
 *
 * Stored as `{ cadence, at }`: the cadence's own state (`CadenceState`, the
 * SDK's due-function owns its shape) and when it was written. Read through
 * an in-memory copy per session, so a cadence that is not due costs no read
 * after the first; written through on every change.
 *
 * **After a restart (R21)** a session's system-clock cadences count again
 * from the first interaction: state on the system clock written before this
 * process started reads as empty (the due-function then counts "from now").
 * Story-clock state is kept — no story time passed while the app was down.
 */
import { and, eq } from "drizzle-orm"
import { cadenceClock, type CadenceRef, type CadenceState } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { processStartedAt } from "$lib/server/pipelines/routines/runs"
import { registrationScopeWhere, scopeColumns } from "$lib/server/pipelines/registrations/rows"

/** The origin of a session row that holds only a routine's runtime state. */
export const ROUTINE_STATE_ORIGIN = "routine-state"

/** What the `state` column holds. */
export interface StoredRoutineState {
	cadence?: Record<string, unknown>
	/** Epoch ms of the write. */
	at?: number
}

const KEY = Symbol.for("serene-pub.routineCadenceStates")
const states = ((globalThis as Record<symbol, unknown>)[KEY] ??= new Map<number, Map<string, CadenceState>>()) as Map<
	number,
	Map<string, CadenceState>
>

const sessionRowWhere = (sessionId: number, key: string) =>
	and(
		registrationScopeWhere({ kind: "session", sessionId }),
		eq(schema.registrations.key, key)
	)

/** The state a stored value holds for this cadence — empty for system-clock state a previous process wrote (R21). */
export function cadenceStateFromStored(stored: unknown, ref: CadenceRef, startedAt = processStartedAt()): CadenceState {
	const s = (stored && typeof stored === "object" ? stored : {}) as StoredRoutineState
	const cadence = s.cadence && typeof s.cadence === "object" ? s.cadence : {}
	if (cadenceClock(ref) === "system" && (typeof s.at !== "number" || s.at < startedAt)) return {}
	return cadence
}

/**
 * The cadence state of one routine in one session. `rows` — the session's
 * own registration rows, when the caller has them (the resolver's) — spares
 * the read.
 */
export async function cadenceStateOf(
	db: Db,
	sessionId: number,
	key: string,
	ref: CadenceRef,
	rows?: ReadonlyArray<{ key: string; state?: unknown }>
): Promise<CadenceState> {
	const memo = states.get(sessionId)?.get(key)
	if (memo !== undefined) return memo
	let stored: unknown = rows?.find((r) => r.key === key)?.state
	if (stored === undefined && !rows) {
		const [row] = await db
			.select({ state: schema.registrations.state })
			.from(schema.registrations)
			.where(sessionRowWhere(sessionId, key))
			.limit(1)
		stored = row?.state
	}
	const state = cadenceStateFromStored(stored, ref)
	remember(sessionId, key, state)
	return state
}

function remember(sessionId: number, key: string, state: CadenceState): void {
	let perSession = states.get(sessionId)
	if (!perSession) states.set(sessionId, (perSession = new Map()))
	perSession.set(key, state)
}

/**
 * Keep a routine's new cadence state: in memory, and on the session's own
 * row (made, as a change row saying nothing else, when it has none). Never
 * throws — a state that could not be written is counted again from memory,
 * and from scratch after a restart.
 */
export async function saveCadenceState(db: Db, sessionId: number, key: string, state: CadenceState): Promise<void> {
	remember(sessionId, key, state)
	const value = { cadence: { ...state }, at: Date.now() } satisfies StoredRoutineState
	try {
		const updated = await db
			.update(schema.registrations)
			.set({ state: value })
			.where(sessionRowWhere(sessionId, key))
			.returning({ id: schema.registrations.id })
		if (updated.length) return
		await db
			.insert(schema.registrations)
			.values({
				...scopeColumns({ kind: "session", sessionId }),
				key,
				origin: ROUTINE_STATE_ORIGIN,
				state: value
			})
			.onConflictDoUpdate({
				target: [schema.registrations.scopeKind, schema.registrations.scopeRef, schema.registrations.key],
				set: { state: value }
			})
	} catch (err) {
		console.warn(`[routines] the cadence state of ${key} in session ${sessionId} was not stored:`, err)
	}
}

/** Forget a session's remembered states (a test; a session deleted) — the rows stay. */
export function forgetCadenceStates(sessionId?: number): void {
	if (sessionId === undefined) states.clear()
	else states.delete(sessionId)
}
