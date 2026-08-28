/**
 * Surface intents (plan 21 §9) — the server seam for "a node/action asked to
 * open or close a panel in the grid." A *proposal*, emitted to the acting
 * user's own sockets (per-user, the recommended default for shared sessions;
 * the owner ruling can widen this later). The common case doesn't need this at
 * all — a message written to a non-`main` channel already autopopulates the
 * subscribing panel client-side. This is the general escape hatch: open a panel
 * with no message, or close one.
 *
 * Panel ids here are *declared* panel ids; the client silently ignores unknown
 * ones (uninstalling or a typo strands nothing), so this never needs to know
 * the mode's panel set to be safe.
 */

export interface SurfaceIntent {
	open?: string[]
	close?: string[]
}

const ids = (xs: unknown): string[] | undefined =>
	Array.isArray(xs)
		? xs.filter((x): x is string => typeof x === "string" && x.length > 0)
		: undefined

/**
 * Emit a surface intent to the acting user. `emitToUser` is the same
 * user-scoped emitter every socket handler already carries, so a node running
 * inside a session handler can call this directly.
 */
export function emitSurfaceIntent(
	emitToUser: (event: string, data: any) => void,
	sessionId: number,
	intent: SurfaceIntent
): void {
	const open = ids(intent.open)
	const close = ids(intent.close)
	if (!open?.length && !close?.length) return
	emitToUser("sessions:surfaceIntent", {
		sessionId,
		...(open?.length ? { open } : {}),
		...(close?.length ? { close } : {})
	})
}
