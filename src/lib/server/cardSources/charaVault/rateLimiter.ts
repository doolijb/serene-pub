/**
 * Self-throttles outbound requests to charavault.net to stay under its
 * published rate limits. A single shared sliding-window counter for the
 * whole process — CharaVault's limit is effectively a property of this
 * Serene Pub instance (one shared outbound IP), not of any individual
 * request.
 *
 * The ceiling is dynamic: 120/min when a CharaVault session is currently
 * cached and unexpired, else 15/min (a conservative floor — CharaVault
 * documents 60/min for anonymous traffic, but a separate, undocumented
 * lower tier for traffic it identifies as VPS/datacenter-sourced, which is
 * exactly what most self-hosted instances are; since we can't tell which
 * tier we've been placed in, assume the worst case rather than risk the
 * 240/min ban threshold).
 */

const WINDOW_MS = 60_000
const AUTHENTICATED_CEILING = 120
const CONSERVATIVE_CEILING = 15

let timestamps: number[] = []

function pruneStale(now: number) {
	const cutoff = now - WINDOW_MS
	while (timestamps.length > 0 && timestamps[0] <= cutoff) {
		timestamps.shift()
	}
}

/**
 * Acquire a slot before making a CharaVault HTTP call. Resolves once a
 * slot is available (immediately, if under the ceiling).
 *
 * @param hasActiveSession - Cheap synchronous check for whether a session
 *   is currently cached and unexpired. Deliberately NOT "would getting a
 *   session succeed" — that could itself trigger a login call and create a
 *   circular dependency on this very limiter.
 */
export async function acquire(hasActiveSession: boolean): Promise<void> {
	for (;;) {
		const now = Date.now()
		pruneStale(now)

		const ceiling = hasActiveSession
			? AUTHENTICATED_CEILING
			: CONSERVATIVE_CEILING

		if (timestamps.length < ceiling) {
			timestamps.push(now)
			return
		}

		const oldest = timestamps[0]
		const waitMs = Math.max(0, oldest + WINDOW_MS - now)
		await new Promise((resolve) => setTimeout(resolve, waitMs + 1))
	}
}

/** Test-only: reset the shared window between test cases. */
export function _resetForTests() {
	timestamps = []
}
