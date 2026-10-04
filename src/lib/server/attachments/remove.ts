/**
 * **Removing an attachment from a sent message** — the whole of attachment
 * editing in v1 (PLAN-composer-attachments D9: remove only; adding means
 * sending a new message).
 *
 * Who may: whoever may edit the message (`canActOnMessage` — the persona's
 * owner, the character's owner or the session's owner, the author of a
 * persona-less line), under the edit verb's enabled-when (not while the row is
 * generating, not on a hidden row). Edit is a floor, so no genre can switch it
 * off; the enabled-when is the only session rule that applies.
 *
 * What goes: the one `core:image` / `core:file` part. **The file stays** —
 * the media store's no-cascade ruling (plan 28 §2, D10): a file nothing
 * refers to any more shows as unreferenced in the Media panel, whose cleanup
 * is where files are deleted. Its provenance (`files.message_id`) is left as
 * it was, as a message delete leaves it.
 */
import { and, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	canActOnMessage,
	MESSAGE_ACTION_REFUSAL
} from "$lib/server/messages/permissions"
import { verbEnablementRefusal } from "$lib/server/messages/verbs"
import { ATTACHMENT_PART_TYPES } from "./references"
import { TrayRefusal } from "./tray"

export const MESSAGE_NOT_FOUND = "That message no longer exists."
export const ATTACHMENT_PART_GONE =
	"That attachment is no longer on this message."

export interface RemoveMessageAttachmentResult {
	sessionId: number
	messageId: number
	partId: number
	/** The file the part showed — kept, per the no-cascade ruling. */
	fileId: number | null
}

/**
 * Remove one attachment part from a message. Throws `TrayRefusal` (a
 * sentence for the person) when refused; nothing is written then.
 */
export async function removeMessageAttachment(
	db: Db,
	input: { userId: number; messageId: unknown; partId: unknown }
): Promise<RemoveMessageAttachmentResult> {
	const { userId } = input
	if (!Number.isSafeInteger(input.messageId))
		throw new TrayRefusal(MESSAGE_NOT_FOUND)
	if (!Number.isSafeInteger(input.partId))
		throw new TrayRefusal(ATTACHMENT_PART_GONE)
	const messageId = input.messageId as number
	const partId = input.partId as number

	const [message] = await db
		.select({ sessionId: schema.messages.sessionId })
		.from(schema.messages)
		.where(eq(schema.messages.id, messageId))
		.limit(1)
	if (!message?.sessionId) throw new TrayRefusal(MESSAGE_NOT_FOUND)

	if (!(await canActOnMessage(db, messageId, userId)))
		throw new TrayRefusal(MESSAGE_ACTION_REFUSAL)

	const refusal = await verbEnablementRefusal(db, message.sessionId, "edit", {
		messageId,
		userId
	})
	// From here on the asker may act on the message, so a refusal may name
	// its session (scoped replies carry their scope key).
	const known = (sentence: string) =>
		Object.assign(new TrayRefusal(sentence), { sessionId: message.sessionId })
	if (refusal) throw known(refusal)

	return db.transaction(async (tx) => {
		const t = tx as unknown as Db
		const [part] = await t
			.delete(schema.messageParts)
			.where(
				and(
					eq(schema.messageParts.id, partId),
					eq(schema.messageParts.messageId, messageId),
					inArray(schema.messageParts.type, [...ATTACHMENT_PART_TYPES])
				)
			)
			.returning()
		if (!part) throw known(ATTACHMENT_PART_GONE)
		await t
			.update(schema.messages)
			.set({ updatedAt: new Date() })
			.where(eq(schema.messages.id, messageId))
		const assetId = Number((part.data as Record<string, unknown> | null)?.assetId)
		return {
			sessionId: message.sessionId!,
			messageId,
			partId,
			fileId: Number.isSafeInteger(assetId) ? assetId : null
		}
	})
}
