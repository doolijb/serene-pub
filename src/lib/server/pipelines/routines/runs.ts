/**
 * 🚧 **The routine runtime's in-memory facts** (PLAN-layering D7, R13, R19,
 * R21; lane 6, 2026-10-20) — a leaf module with no imports, so the session
 * event emitter can read it synchronously at the moment it emits.
 *
 *  · which runs in flight are **routine runs** (and how deep in a chain of
 *    routines each sits) — a moment a routine's own write caused must say so
 *    when it is emitted, while the run is still here (R19: routines are not
 *    recursive);
 *  · whether routines run at all in this process — on, except under Vitest,
 *    where a test turns them on (`setRoutinesEnabled`) so a scripted model
 *    never answers a routine's call a test did not expect;
 *  · when this process started — cadence state written before it is a
 *    previous process's, which R21 clears for the system clock.
 *
 * Held on `globalThis`, as the session-event queues are: a Vite SSR reload
 * re-evaluates the module and must not split one runtime in two.
 */

/** A routine run in flight: its session, the registration it answers, its depth in a chain of routines. */
export interface RoutineRunFact {
	sessionId: number
	registrationKey: string
	/** 0 for a routine a person's moment woke; 1 for one a routine's own write woke (R19). */
	depth: number
}

interface RoutineRuntimeFacts {
	runs: Map<string, RoutineRunFact>
	enabled: boolean
	bootAt: number
}

const KEY = Symbol.for("serene-pub.routineRuntime")
const facts = ((globalThis as Record<symbol, unknown>)[KEY] ??= {
	runs: new Map<string, RoutineRunFact>(),
	enabled: !(typeof process !== "undefined" && process.env?.VITEST),
	bootAt: Date.now()
} satisfies RoutineRuntimeFacts) as RoutineRuntimeFacts

/** Note a routine run as it starts. */
export function noteRoutineRun(runId: string, fact: RoutineRunFact): void {
	facts.runs.set(runId, fact)
}

/** Forget a routine run as it ends. */
export function forgetRoutineRun(runId: string): void {
	facts.runs.delete(runId)
}

/**
 * The routine run behind a write, if one is — by the cause's run, or the
 * root of the tree it ran in (a child a routine's run dispatched).
 */
export function routineRunOf(...runIds: Array<string | null | undefined>): RoutineRunFact | undefined {
	for (const id of runIds) {
		if (!id) continue
		const fact = facts.runs.get(id)
		if (fact) return fact
	}
	return undefined
}

/** Do routines run in this process? Off under Vitest unless a test turned them on. */
export const routinesEnabled = (): boolean => facts.enabled

/** Tests: turn the routine runtime on (or off again). */
export function setRoutinesEnabled(on: boolean): void {
	facts.enabled = on
}

/** When this process started — state written before it belongs to a previous run of the app (R21). */
export const processStartedAt = (): number => facts.bootAt

/** Tests: forget every routine run. */
export function _resetRoutineRuns(): void {
	facts.runs.clear()
}
