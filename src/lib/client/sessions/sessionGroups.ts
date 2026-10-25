/**
 * The Sessions sidebar's groups — **Your turn**, **Recent**, **Older** — and
 * Archived last (pr-6 R-k) — and the one test behind the first of them.
 *
 * Pure and structural, so the rule is testable without a component and the
 * home page can adopt it: the home's "N sessions waiting on you" line computes
 * the same test inline (`s.lastMessage && !s.lastMessage.isUser`), and the two
 * must never disagree about which sessions owe the reader a line.
 */
import { lastActivityAt } from "$lib/client/utils/timeAgo"
import { SESSION_ARCHIVE_LABELS } from "$lib/shared/sessions/archive"

/** The fields of a session list row the grouping reads. */
export interface GroupableSession {
	lastMessage?: {
		isUser?: boolean | null
		createdAt?: string | null
		/** 🚧 A revision branch's last line: the turn after it was taken back. */
		revisedTurn?: boolean | null
	} | null
	updatedAt?: string | Date | null
	/** 🚧 pr-6 (R-k): set once the session is archived. */
	archivedAt?: string | Date | null
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
	// An archived session owes nobody a line (R-k).
	if (session.archivedAt) return false
	const last = session.lastMessage
	// A revision branch's last line is the reader's own, but the turn after
	// it was taken back: nobody else owes a line.
	return !!last && (!last.isUser || !!last.revisedTurn) && !running
}

export type SessionGroupKey = "yourTurn" | "recent" | "older" | "archived"

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
	older: "Older",
	archived: SESSION_ARCHIVE_LABELS.group
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
		older: [],
		archived: []
	}
	for (const row of rows) {
		const key: SessionGroupKey = row.archivedAt
			? "archived"
			: isAwaitingUser(row, isRunning(row))
				? "yourTurn"
				: lastActivityAt(row) >= now - RECENT_WINDOW_MS
					? "recent"
					: "older"
		byKey[key].push(row)
	}
	return (["yourTurn", "recent", "older", "archived"] as const)
		.map((key) => ({ key, label: GROUP_LABELS[key], rows: byKey[key] }))
		.filter((group) => group.rows.length > 0)
}
