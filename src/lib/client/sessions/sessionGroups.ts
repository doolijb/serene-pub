/**
 * The Sessions sidebar's groups — **Your turn**, **Recent**, **Older** — and
 * the one test behind the first of them.
 *
 * Pure and structural, so the rule is testable without a component and the
 * home page can adopt it: the home's "N sessions waiting on you" line computes
 * the same test inline (`s.lastMessage && !s.lastMessage.isUser`), and the two
 * must never disagree about which sessions owe the reader a line.
 */
import { lastActivityAt } from "$lib/client/utils/timeAgo"

/** The fields of a session list row the grouping reads. */
export interface GroupableSession {
	lastMessage?: {
		isUser?: boolean | null
		createdAt?: string | null
	} | null
	updatedAt?: string | Date | null
}

/**
 * Whether the session is waiting on the reader: its last visible line was
 * somebody else's, and no reply is being written in it right now.
 *
 * Absent `lastMessage` means nothing has been said yet, which is nobody's
 * turn. `running` is the run-in-flight half: while a reply is being written
 * the next line is the model's, whoever spoke last — the row's own "your turn"
 * dot already yields to the run status the same way.
 */
export function isAwaitingUser(
	session: GroupableSession,
	running = false
): boolean {
	return !!session.lastMessage && !session.lastMessage.isUser && !running
}

export type SessionGroupKey = "yourTurn" | "recent" | "older"

export interface SessionGroup<T> {
	key: SessionGroupKey
	label: string
	rows: T[]
}

/** What counts as recent: a rolling week back from now. */
export const RECENT_WINDOW_MS = 7 * 86_400_000

const GROUP_LABELS: Record<SessionGroupKey, string> = {
	yourTurn: "Your turn",
	recent: "Recent",
	older: "Older"
}

/**
 * Cut a list into its groups, in display order, dropping any group with
 * nothing in it.
 *
 * A session waiting on the reader goes under **Your turn** however old it is —
 * it is the list's reason to be opened. Everything else is **Recent** when it
 * last moved within the week, else **Older**, including a session with no
 * readable timestamp (its activity resolves to 0).
 *
 * The incoming order is kept inside each group: the list arrives sorted, and
 * re-sorting here would fight it.
 */
export function groupSessions<T extends GroupableSession>(
	rows: readonly T[],
	options: {
		now?: number
		isRunning?: (row: T) => boolean
	} = {}
): SessionGroup<T>[] {
	const now = options.now ?? Date.now()
	const isRunning = options.isRunning ?? (() => false)
	const byKey: Record<SessionGroupKey, T[]> = {
		yourTurn: [],
		recent: [],
		older: []
	}
	for (const row of rows) {
		const key: SessionGroupKey = isAwaitingUser(row, isRunning(row))
			? "yourTurn"
			: lastActivityAt(row) >= now - RECENT_WINDOW_MS
				? "recent"
				: "older"
		byKey[key].push(row)
	}
	return (["yourTurn", "recent", "older"] as const)
		.map((key) => ({ key, label: GROUP_LABELS[key], rows: byKey[key] }))
		.filter((group) => group.rows.length > 0)
}
