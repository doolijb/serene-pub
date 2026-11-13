/**
 * 🚧 Ask the server which cast member a card's seat holds in this session,
 * (named by the seat's ref) and how far the viewer can reach it — the page's `castMemberOf`
 * (`open-character`; owner ruling 2026-11-05). One `lorebooks:memberOfSeat`
 * round trip: an address when the viewer can open the member's book, `"sheet"`
 * when the member exists but they cannot, null when the seat has no member
 * yet (the card opens). A refusal or a silence rejects; the widget says it.
 */
import { awaitReply } from "$lib/client/utils/awaitReply"
import type { TypedSocket } from "$lib/client/sockets/typedSocket"
import type { CastMemberAddress } from "./openCharacter"

export async function seatMemberOf(
	socket: Pick<TypedSocket, "emit">,
	sessionId: number | null | undefined,
	ref: string
): Promise<CastMemberAddress | "sheet" | null> {
	if (sessionId == null) return null
	const res = await awaitReply({
		socket,
		event: "lorebooks:memberOfSeat",
		errorEvent: "lorebooks:memberOfSeat:error",
		params: { sessionId, ref },
		match: (r) => r.sessionId === sessionId && r.ref === ref,
		fallbackError: "This cast member could not be read."
	})
	if (!res.member) return null
	return res.member.opensInBook
		? { lorebookId: res.member.lorebookId, castId: res.member.castMemberId }
		: "sheet"
}
