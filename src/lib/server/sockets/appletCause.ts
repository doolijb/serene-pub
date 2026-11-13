import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

/**
 * 🚧 (M2c) Which extension a server-made `sessions:update` call is on behalf of.
 * Keyed by the params OBJECT, set only by server code (`appletApi:updateSession`),
 * so a client cannot claim a cause by posting a field: the ledger's
 * `EventCause.pluginId` is the server's word.
 */
const callers = new WeakMap<object, string>()

export function markAppletCall<T extends object>(params: T, pluginId: string): T {
	callers.set(params, pluginId)
	return params
}

export function appletCallerOf(params: unknown): { pluginId?: string } {
	const id = params && typeof params === "object" ? callers.get(params as object) : undefined
	return id ? { pluginId: id } : {}
}

/**
 * 🚧 **The frame-origin cause** (owner 2026-11-04, C5): the applet whose
 * mounted frame caused a call — its own request through the applet door, or a
 * press in it. The applet-group reach (`ctx.annex('user')`, `ctx.storage.user`)
 * is granted to a sandbox call only while this is present AND names the plugin
 * being called: its own applet is open, so another plugin's hook in the same
 * run gets none.
 *
 * Built only by server code (`frameCauseFor`), judged from server data: the
 * invoke door for the applet's own mounts (`frameCauseOfInvoke`), and a run a
 * person's press started on a session that applet draws (`frameCauseOfRun`).
 * Carried on a run's scope and on each `manager.callHook` beside `user`. It is
 * never read off a request field, so a client cannot claim it. Event and
 * lifecycle hooks, the schedule tick and routine/cadence/schedule runs never
 * get one. Not `ActingVia` (`send` / `view` / `press` say who acts, not which
 * surface caused it), and not the event ledger's `EventCause.pluginId` (which
 * plugin's write an event came from).
 */
export interface FrameCause {
	pluginId: string
}

export function frameCauseFor(pluginId: string): FrameCause {
	return { pluginId }
}

/** Whether a call into `pluginId` is a frame's own: the cause is present and names that plugin. */
export function frameOpenFor(cause: FrameCause | undefined, pluginId: string): boolean {
	return !!cause && cause.pluginId === pluginId
}

/** The one sentence every refused applet-group member rejects with, whatever it is: `<thing> is only available while the app is open.` */
export function appletClosedRefusal(thing: string): string {
	return `${thing} is only available while the app is open.`
}

/** What `ctx.annex('user')` rejects with when no frame of the plugin is open. */
export const USER_ANNEX_CLOSED = appletClosedRefusal("This person's saved data")
/** What `ctx.storage.user` rejects with when no frame of the plugin is open. */
export const USER_STORAGE_CLOSED = appletClosedRefusal("Per-person storage")

/**
 * 🚧 (M2e) The plugin id whose `session-view` frame draws this session: its
 * genre's `shape.view` when the genre is an applet genre, else null (also
 * null for no such session).
 */
export async function appletOfSession(db: Db, sessionId: number): Promise<string | null> {
	const [row] = await db
		.select({ genreId: schema.sessions.genreId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!row?.genreId) return null
	// Dynamic: this file is imported by `SandboxManager.ts`; a static import would cycle.
	const { getSessionGenre } = await import("$lib/server/pipelines/entities/sessionGenres")
	const genre = await getSessionGenre(db, row.genreId)
	const shape = genre?.shape as { applet?: unknown; view?: unknown } | null | undefined
	return shape?.applet === true && typeof shape.view === "string" ? shape.view : null
}
