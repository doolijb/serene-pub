/**
 * "just now", "3 minutes ago", "yesterday" — for a timestamp a person reads
 * beside a status, where the exact second is noise and the magnitude is the
 * point. Coarse on purpose: anything under a minute is "just now", and past a
 * week it is the date, because "23 days ago" makes somebody do arithmetic.
 */
export function timeAgo(
	iso: string | Date | null | undefined,
	now: number = Date.now()
): string {
	if (!iso) return "never"
	const then = typeof iso === "string" ? Date.parse(iso) : iso.getTime()
	if (!Number.isFinite(then)) return "never"
	const seconds = Math.max(0, Math.round((now - then) / 1000))
	if (seconds < 60) return "just now"
	const minutes = Math.round(seconds / 60)
	if (minutes < 60)
		return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`
	const hours = Math.round(minutes / 60)
	if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`
	const days = Math.round(hours / 24)
	if (days === 1) return "yesterday"
	if (days < 7) return `${days} days ago`
	return new Date(then).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric"
	})
}

/** A short calendar date — "Sep 12" — for "not listed since …". */
export function shortDate(iso: string | Date | null | undefined): string {
	if (!iso) return ""
	const d = typeof iso === "string" ? new Date(iso) : iso
	if (Number.isNaN(d.getTime())) return ""
	return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

/**
 * The same magnitudes as `timeAgo`, abbreviated — "2 h ago", "3 d ago".
 *
 * For the 11px slot at the end of a list row, where the timestamp shares one
 * line with a name that must stay readable: the long form spends 70px saying
 * what the short one says in 45px, and the name pays for it. Anywhere the
 * timestamp is prose ("last active …") wants `timeAgo` instead.
 */
export function timeAgoShort(
	iso: string | Date | null | undefined,
	now: number = Date.now()
): string {
	if (!iso) return ""
	const then = typeof iso === "string" ? Date.parse(iso) : iso.getTime()
	if (!Number.isFinite(then)) return ""
	const seconds = Math.max(0, Math.round((now - then) / 1000))
	if (seconds < 60) return "just now"
	const minutes = Math.round(seconds / 60)
	if (minutes < 60) return `${minutes} m ago`
	const hours = Math.round(minutes / 60)
	if (hours < 24) return `${hours} h ago`
	const days = Math.round(hours / 24)
	if (days === 1) return "yesterday"
	if (days < 7) return `${days} d ago`
	return shortDate(new Date(then))
}

/**
 * When a session last moved, as an instant — 0 when it has never moved or the
 * stamp will not parse, so a sort never has to handle NaN.
 *
 * The last message's timestamp in preference to `sessions.updatedAt`: that
 * column is a PG `date` (day granularity), so ordering by it alone shuffles
 * everything touched today into an arbitrary order.
 *
 * Typed structurally rather than against `Sockets.Sessions.List`: the same two
 * fields reach this from the list row, from a view panel's props and from the
 * home's cards, and a util that named one of those shapes would refuse the
 * other two.
 */
export function lastActivityAt(session: {
	lastMessage?: { createdAt?: string | null } | null
	updatedAt?: string | Date | null
}): number {
	const at = session.lastMessage?.createdAt ?? session.updatedAt
	const parsed = at ? Date.parse(String(at)) : NaN
	return Number.isFinite(parsed) ? parsed : 0
}
