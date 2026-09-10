/**
 * The two gates every `/recovery` route passes through, and the confirm token.
 *
 * Both gates are re-checked per route rather than inherited from
 * `hooks.server.ts`. The hook is what makes these routes reachable at all in
 * recovery mode, so it would be the natural place to trust — but a gate that
 * exists in exactly one place is a gate that a later refactor of that one place
 * silently removes, and what is behind this one is "move the user's database"
 * with no account to check. Two independent checks of the same fact is the
 * cheapest insurance there is against that.
 */
import crypto from "node:crypto"
import type { RequestEvent } from "@sveltejs/kit"
import { isRecoveryRequestAllowed } from "$lib/server/db/recoveryAccess"
import { renderUnavailablePage } from "$lib/server/db/unopenablePage"

/**
 * Decide whether this request may proceed, and if not, what it gets instead.
 *
 * Order matters, and it is: database state first, address second.
 *
 * - A **healthy** instance answers 404 to everybody, local or not. These routes
 *   can move a database with no credential at all; on an instance that is
 *   working they must not exist, and "404" is what not existing looks like.
 * - A **broken** instance answers a bare 503 to a non-local peer — the same
 *   thing every other path on that instance answers (see `hooks.server.ts`), so
 *   probing `/recovery` tells a remote reader nothing it did not already know.
 */
export async function guardRecovery(
	event: RequestEvent
): Promise<Response | null> {
	const { getDatabaseState } = await import("$lib/server/startup")
	if (getDatabaseState().ok) {
		return new Response("Not Found\n", {
			status: 404,
			headers: {
				"content-type": "text/plain; charset=utf-8",
				"cache-control": "no-store"
			}
		})
	}
	if (!isRecoveryRequestAllowed(event)) return renderUnavailablePage()
	return null
}

interface PendingConfirm {
	action: string
	target: string
	expiresAt: number
}

/**
 * Tokens the first POST hands out and the second POST spends.
 *
 * In memory, and that is right rather than a shortcut: there is no database to
 * put them in, and a token that did not die with the process would outlive the
 * page that explained what it was for.
 */
const pending = new Map<string, PendingConfirm>()

/** Ten minutes is long enough to read a confirmation and short enough that a
 * tab left open overnight does not still hold a live capability. */
const CONFIRM_TTL_MS = 10 * 60 * 1000

/** Bounded so repeated first-POSTs cannot grow the map without limit. Small,
 * because a human confirming one action at a time needs one. */
const CONFIRM_LIMIT = 32

export function issueConfirmToken(action: string, target = ""): string {
	const now = Date.now()
	for (const [key, value] of pending) {
		if (value.expiresAt <= now) pending.delete(key)
	}
	while (pending.size >= CONFIRM_LIMIT) {
		// Insertion-ordered, so the first key is the oldest outstanding one.
		const oldest = pending.keys().next()
		if (oldest.done) break
		pending.delete(oldest.value)
	}
	const token = crypto.randomBytes(18).toString("base64url")
	pending.set(token, { action, target, expiresAt: now + CONFIRM_TTL_MS })
	return token
}

/**
 * Spend a token, once.
 *
 * Single-use is the whole mechanism: a refresh re-POSTs the same form with the
 * same token, and the second attempt finds nothing — so a browser's "confirm
 * form resubmission" cannot restore a backup twice, which on this surface would
 * mean a second `serene-pub.db.broken-<ts>` directory and the first restore
 * thrown away.
 *
 * Bound to both the action and its target, so a token issued for "delete this
 * backup" cannot be replayed against "start fresh".
 */
export function consumeConfirmToken(
	token: unknown,
	action: string,
	target = ""
): boolean {
	if (typeof token !== "string" || !token) return false
	const found = pending.get(token)
	if (!found) return false
	pending.delete(token)
	if (found.expiresAt <= Date.now()) return false
	return found.action === action && found.target === target
}

/** Test seam. Nothing in the app clears these; the process ending does. */
export function clearConfirmTokens(): void {
	pending.clear()
}
