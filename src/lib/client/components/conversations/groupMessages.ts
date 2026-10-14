/**
 * Pure helpers for the Messages view (PLAN-private-messages-2026-10-12 §6.3):
 * which message rows draw their face and name, the list column's groups, and
 * the names a conversation and a person go by. No component, no socket, so
 * the rules are testable on their own.
 */
import type {
	ConversationMessageRow,
	ConversationPerson,
	ConversationSummary
} from "$lib/shared/sockets/conversations"

/** Consecutive messages by one author within this long share one face and name. */
export const COLLAPSE_WINDOW_MS = 5 * 60_000

export interface MessageRowView {
	message: ConversationMessageRow
	/** Draw the face and the name line. False for a follow-on within the window. */
	showHead: boolean
}

function at(iso: string): number {
	const t = Date.parse(iso)
	return Number.isFinite(t) ? t : 0
}

/**
 * The log's rows, oldest first, each marked with whether it draws its head.
 *
 * A row collapses into the one above it when both have the same author and it
 * was written within `COLLAPSE_WINDOW_MS` of that one (ruled Q5: uniform rows,
 * no bubbles). A message whose author's account is gone (`authorUserId`
 * null) never collapses: two former members are not known to be one person.
 * The window is measured from the row directly above, so a steady stream of
 * short messages stays one block.
 */
export function groupMessages(
	messages: readonly ConversationMessageRow[]
): MessageRowView[] {
	const out: MessageRowView[] = []
	let prev: ConversationMessageRow | null = null
	for (const message of messages) {
		const sameAuthor =
			prev != null &&
			message.authorUserId != null &&
			prev.authorUserId === message.authorUserId
		const close =
			prev != null &&
			at(message.createdAt) - at(prev.createdAt) <= COLLAPSE_WINDOW_MS &&
			at(message.createdAt) >= at(prev.createdAt)
		out.push({ message, showHead: !(sameAuthor && close) })
		prev = message
	}
	return out
}

/** A person's name as other people read it: display name, else username. */
export function personName(
	person: Pick<ConversationPerson, "displayName" | "username"> | null | undefined
): string {
	return person?.displayName?.trim() || person?.username || "Former member"
}

/** Everyone in the conversation but the reader. */
export function otherMembers(
	conversation: Pick<ConversationSummary, "members">,
	meId: number | null | undefined
): ConversationPerson[] {
	return conversation.members.filter((m) => m.id !== meId)
}

/**
 * The conversation's name: a group's own name, else the other people's names
 * (a direct conversation is the other person).
 */
export function conversationTitle(
	conversation: Pick<ConversationSummary, "name" | "members">,
	meId: number | null | undefined
): string {
	if (conversation.name?.trim()) return conversation.name.trim()
	const others = otherMembers(conversation, meId)
	if (others.length === 0) return "Just you"
	return others.map(personName).join(", ")
}

/** Whether the find row's text matches the conversation's name or a member. */
export function conversationMatches(
	conversation: Pick<ConversationSummary, "name" | "members">,
	meId: number | null | undefined,
	term: string
): boolean {
	const needle = term.trim().toLowerCase()
	if (!needle) return true
	return [
		conversation.name,
		...otherMembers(conversation, meId).flatMap((m) => [
			m.displayName,
			m.username
		])
	].some((text) => !!text && text.toLowerCase().includes(needle))
}

export type ConversationGroupKey = "unread" | "recent" | "older"

export interface ConversationGroup<T> {
	key: ConversationGroupKey
	label: string
	rows: T[]
}

/** What counts as recent: a rolling week, as the Sessions list. */
export const RECENT_WINDOW_MS = 7 * 86_400_000

const LABELS: Record<ConversationGroupKey, string> = {
	unread: "Unread",
	recent: "Recent",
	older: "Older"
}

/**
 * The list column's groups — **Unread**, **Recent**, **Older** — in that
 * order, empty groups dropped. Within a group the newest moved first.
 */
export function groupConversations<
	T extends Pick<ConversationSummary, "unread" | "lastMessageAt" | "createdAt">
>(rows: readonly T[], now: number = Date.now()): ConversationGroup<T>[] {
	const moved = (r: T) => at(r.lastMessageAt ?? r.createdAt)
	const sorted = [...rows].sort((a, b) => moved(b) - moved(a))
	const byKey: Record<ConversationGroupKey, T[]> = {
		unread: [],
		recent: [],
		older: []
	}
	for (const row of sorted) {
		if (row.unread > 0) byKey.unread.push(row)
		else if (now - moved(row) <= RECENT_WINDOW_MS) byKey.recent.push(row)
		else byKey.older.push(row)
	}
	return (["unread", "recent", "older"] as const)
		.filter((key) => byKey[key].length > 0)
		.map((key) => ({ key, label: LABELS[key], rows: byKey[key] }))
}
