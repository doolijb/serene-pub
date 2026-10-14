/**
 * Conversation membership — the only authority over a private conversation
 * (PLAN-private-messages §4). Ids are guessable integers; a member row is
 * what lets someone read, upload into, or view the files of a conversation.
 * Administrators get no bypass.
 *
 * Takes `db` explicitly (a `tx` inside a transaction) — the default-db
 * dynamic import bypasses a test's `vi.mock`.
 */
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

/** Whether `userId` has a `conversation_members` row for `conversationId`. */
export async function isConversationMember(
	db: Db,
	conversationId: number,
	userId: number
): Promise<boolean> {
	if (!Number.isSafeInteger(conversationId) || !Number.isSafeInteger(userId))
		return false
	const [row] = await db
		.select({ userId: schema.conversationMembers.userId })
		.from(schema.conversationMembers)
		.where(
			and(
				eq(schema.conversationMembers.conversationId, conversationId),
				eq(schema.conversationMembers.userId, userId)
			)
		)
		.limit(1)
	return !!row
}
