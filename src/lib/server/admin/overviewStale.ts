/**
 * `admin:overviewStale` — tell every connected admin that the Overview they
 * hold is out of date.
 *
 * The **Needs you** list is derived on read (`admin/attention.ts`) and the
 * client asks for it on its own schedule, so a tunnel that fails while an
 * admin is somewhere else in the app would leave the rail's Admin dot wrong
 * until the next read. The decision points that change a derived item call
 * `markAdminOverviewStale()`; the client (`client/admin/adminHealth.svelte.ts`)
 * hears the push and reads `admin:overview` again. The push carries nothing:
 * the Overview stays the one place its facts are gathered.
 *
 * ## Why this module imports nothing
 *
 * Its callers — the model sync, the plugin store, the daily backup — are
 * written to run against a test database without loading `$lib/server/db`,
 * whose import opens the real one. So the transport is installed from
 * `connectSockets` (where `io` exists) onto `globalThis`, and a call made with
 * nothing installed — every unit test, and anything before the first socket
 * server — does nothing. On `globalThis` so a Vite SSR reload keeps it.
 */

export const ADMIN_OVERVIEW_STALE_EVENT = "admin:overviewStale"

const KEY = Symbol.for("serene-pub.adminOverviewStale")

/** The half of Socket.IO this reads: every connected socket and its user. */
interface AdminIo {
	sockets: {
		sockets: {
			values(): Iterable<{ user?: { id?: number; isAdmin?: boolean | null } | null }>
		}
	}
}

type Push = (userId: number, event: string, data: unknown) => void

/**
 * How long calls are gathered into one push. A `syncAllConnections` that
 * flips five hosts is one push, not five; and the push (whose `pushToUser`
 * reads the outer db handle) runs after a caller's transaction has most
 * likely settled rather than inside it — see `db/transactionGuard.ts`.
 */
const COALESCE_MS = 250

/**
 * Bind the push. Admins are found by walking the connected sockets rather than
 * querying `users`: only a connected admin can hear it, and each push still
 * goes through `pushToUser`, so the interest gate (and the restricted `admin:`
 * prefix it enforces) decides which of their sockets receive it.
 */
export function installAdminOverviewStale(
	io: AdminIo,
	push: Push,
	delayMs = COALESCE_MS
): void {
	let timer: ReturnType<typeof setTimeout> | null = null
	const send = () => {
		timer = null
		const admins = new Set<number>()
		for (const socket of io.sockets.sockets.values()) {
			const u = socket.user
			if (u?.isAdmin && typeof u.id === "number") admins.add(u.id)
		}
		for (const id of admins) push(id, ADMIN_OVERVIEW_STALE_EVENT, {})
	}
	;(globalThis as Record<symbol, unknown>)[KEY] = () => {
		if (timer) return
		timer = setTimeout(send, delayMs)
		// Never the reason a process stays alive.
		timer.unref?.()
	}
}

/** Something a Needs you item reads just changed. Never throws. */
export function markAdminOverviewStale(): void {
	try {
		;((globalThis as Record<symbol, unknown>)[KEY] as (() => void) | undefined)?.()
	} catch (err) {
		console.warn("[admin] could not push admin:overviewStale:", err)
	}
}
