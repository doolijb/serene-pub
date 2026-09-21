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
 *
 * ## Whose id is it
 *
 * Core and a genre name a panel by its plain id. A **plugin** names its OWN
 * panel by the bare id it declared, and this module prefixes it with the
 * emitter's plugin id — the same `<pluginId>:<panelId>` the session view seats
 * it under (`frameHost.surfacesOf`). The prefix is added HERE, at the one seam
 * where the emitter's identity is still in hand, rather than asked of the
 * plugin: an intent is not a capability check, and a package that had to
 * namespace its own ids could name someone else's.
 *
 * Which is the other half: a plugin may open its own widgets and nobody
 * else's. An already-qualified id whose prefix is the emitter's own is passed
 * through (a package that spelled out what it meant is not wrong); one naming
 * a different plugin is DROPPED. A drop, not a refusal, because the whole verb
 * is a proposal — the client already ignores an id it does not know, and a
 * throw here would let one bad id in a batch cancel the good ones beside it.
 */

import { parsePluginWidgetId, pluginWidgetId } from "@serene-pub/sdk"

export interface SurfaceIntent {
	open?: string[]
	close?: string[]
}

/**
 * The ids this emitter may name, in the spelling the client seats them under.
 *
 * `pluginId` absent is core or a genre: every id passes through as written.
 */
const ids = (xs: unknown, pluginId?: string): string[] | undefined => {
	if (!Array.isArray(xs)) return undefined
	const out: string[] = []
	for (const x of xs) {
		if (typeof x !== "string" || !x.length) continue
		if (!pluginId) {
			out.push(x)
			continue
		}
		const owned = parsePluginWidgetId(x)
		// Not namespaced at all → the plugin's own bare panel id, qualified
		// here. Namespaced with the emitter's own id → already what it will
		// be seated as. Namespaced with anyone else's → another package's
		// widget, and not this one's to open.
		if (!owned) out.push(pluginWidgetId(pluginId, x))
		else if (owned.pluginId === pluginId) out.push(x)
	}
	return out
}

/**
 * Emit a surface intent to the acting user. `emitToUser` is the same
 * user-scoped emitter every socket handler already carries, so a node running
 * inside a session handler can call this directly.
 *
 * `pluginId` is the EMITTER's — the package whose hook, script or node asked.
 * Omitted by core and by a genre's own callers, which name plain ids.
 */
export function emitSurfaceIntent(
	emitToUser: (event: string, data: any) => void,
	sessionId: number,
	intent: SurfaceIntent,
	pluginId?: string
): void {
	const open = ids(intent.open, pluginId)
	const close = ids(intent.close, pluginId)
	if (!open?.length && !close?.length) return
	emitToUser("sessions:surfaceIntent", {
		sessionId,
		...(open?.length ? { open } : {}),
		...(close?.length ? { close } : {})
	})
}
