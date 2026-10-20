/**
 * 🚧 The push half of personal channel lanes (owner ruling 2026-10-17): a
 * broadcast to a session's members that carries message rows is narrowed per
 * member, so a personal lane's rows reach its person and the session's owner
 * and nobody else (`./lanes.ts`).
 *
 * Two payload shapes carry rows to members:
 *
 *  - `sessionMessage` — `{ sessionMessage: row }`, one row (the live row,
 *    every stream chunk, every edit): the members who may not read its lane
 *    are dropped from the recipients;
 *  - `sessions:get` — the whole session, `{ session: { sessionMessages },
 *    messages }`: each member is sent their own copy with the rows they may
 *    not read taken out, and their own channels view (`SessionV1.channels`).
 *
 * Every other event passes through untouched. The common case — a row on
 * `main`, or a session whose genre declares no personal channel — costs no
 * query beyond the one session read the genre check needs, and `main` costs
 * none at all.
 */

import { DEFAULT_CHANNEL, parseChannel } from "@serene-pub/sdk"
import { filterRowsForView, laneReadersOf, laneViewFor } from "./lanes"

type Recipient = { userId: number; data: any }

const nonMain = (row: unknown): boolean => {
	const ch = (row as { channel?: unknown } | null)?.channel
	return typeof ch === "string" && parseChannel(ch).slug !== DEFAULT_CHANNEL
}

/**
 * The recipients of one broadcast, narrowed by lane. `payload` is what every
 * member would have been sent; the answer may drop members or vary the
 * payload per member. Never throws for a payload it does not understand.
 */
export async function laneScopedRecipients(
	db: Db,
	sessionId: number,
	event: string,
	payload: any,
	userIds: number[]
): Promise<Recipient[]> {
	const everyone = userIds.map((userId) => ({ userId, data: payload }))
	if (!payload || typeof payload !== "object") return everyone
	if (event === "sessionMessage") {
		const row = payload.sessionMessage
		if (!nonMain(row)) return everyone
		const readers = await laneReadersOf(db, sessionId, row.channel)
		return readers ? everyone.filter((r) => readers.has(r.userId)) : everyone
	}
	if (event === "sessions:get") {
		const rows: unknown[] = [
			...(Array.isArray(payload.messages) ? payload.messages : []),
			...(Array.isArray(payload.session?.sessionMessages) ? payload.session.sessionMessages : [])
		]
		const { sessionChannelsFor } = await import("./attention")
		const out: Recipient[] = []
		for (const userId of userIds) {
			const view = await laneViewFor(db, sessionId, userId)
			const channels = view ? await sessionChannelsFor(db, view) : undefined
			if (!view || (view.all && !channels)) {
				out.push({ userId, data: payload })
				continue
			}
			const narrowed = rows.some(nonMain) && !view.all
			out.push({
				userId,
				data: {
					...payload,
					...(Array.isArray(payload.messages) && narrowed
						? { messages: filterRowsForView(view, payload.messages) }
						: {}),
					...(payload.session
						? {
								session: {
									...payload.session,
									...(Array.isArray(payload.session.sessionMessages) && narrowed
										? { sessionMessages: filterRowsForView(view, payload.session.sessionMessages) }
										: {}),
									...(channels ? { channels } : {})
								}
							}
						: {})
				}
			})
		}
		return out
	}
	return everyone
}
