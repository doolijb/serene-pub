/**
 * The sessions whose creation is still under way, in this process.
 *
 * Creation is one handler (`sessions:create`): the row is inserted, the cast
 * is seated, and the genre's create pipeline runs to its end before the
 * handler answers. A session is therefore **created** once that handler is
 * past its create run, and **creating** only in between — the window in which
 * the create pipeline's own settings still mean something for it (owner
 * ruling 2026-09-30: shown in the session's settings, editable while
 * creating, read-only after).
 *
 * In memory rather than a column on purpose: the fact lasts as long as the
 * handler does. A process that stops mid-creation never resumes it, so a
 * session left half-made by a restart has nothing left to create and reads
 * as created — which is exactly what an empty set says.
 *
 * One set per process, even across a Vite SSR module reload, which would
 * otherwise give the handler and the reader two different sets.
 */

const CREATING_KEY = Symbol.for("serene-pub.sessionsCreating")
const creating: Set<number> = ((globalThis as any)[CREATING_KEY] ??= new Set<number>())

/** The session's create run is about to start (or its row was just written). */
export function markCreating(sessionId: number): void {
	creating.add(sessionId)
}

/** The create run is over, however it ended. */
export function markCreated(sessionId: number): void {
	creating.delete(sessionId)
}

/** Is this session still being created? */
export function isCreating(sessionId: number): boolean {
	return creating.has(sessionId)
}
