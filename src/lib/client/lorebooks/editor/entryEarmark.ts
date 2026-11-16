import { interestKey } from "$lib/shared/sockets/interest"
import type { TypedSocket } from "$lib/client/sockets/typedSocket"
import { awaitReply } from "$lib/client/utils/awaitReply"

/**
 * Asks the server whether a pipeline run that was shown this entry may still
 * replace its text. Answers the server's one sentence, or `null` when nothing
 * is pending.
 *
 * A failed or unanswered ask is `null`: it never blocks a save, because the
 * server refuses a save it must refuse whatever the form believes.
 */
export async function askEntryEarmark(
	socket: Pick<TypedSocket, "emit">,
	lorebookId: number,
	entryId: number
): Promise<string | null> {
	try {
		const reply = await awaitReply({
			socket,
			event: "entries:earmark",
			params: { entryId },
			replyKey: interestKey("entries:earmark", lorebookId),
			errorEvent: "entries:earmark:error",
			fallbackError: "The entry could not be checked.",
			match: (d) => d.entryId === entryId,
			matchError: (d) =>
				(d as { entryId?: number } | undefined)?.entryId === entryId
		})
		return reply.notice
	} catch {
		return null
	}
}
