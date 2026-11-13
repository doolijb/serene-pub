import { db } from "$lib/server/db"
import {
	CharacterRowsRefusal,
	characterRowsPage
} from "$lib/server/cast/characterRows"
import { redactConnections } from "$lib/server/connections/visibility"
import { isGatedEvent } from "$lib/shared/sockets/interest"
import type { Handler } from "$lib/shared/events"
import { socketWants } from "./interest"

/**
 * Reply to the socket that asked, and to no other tab of the user: a second
 * tab paging its own list must not receive a sibling's page. The same
 * projection as `sockets/connections.ts`' `replyToAsker` — redacted for the
 * recipient, and honouring the interest gate.
 */
function replyToAsker(socket: any, event: string, data: unknown): void {
	if (socket.disconnected) return
	if (isGatedEvent(event) && !socketWants(socket, event)) return
	socket.emit?.(event, redactConnections(data, socket.user))
}

/**
 * 🚧 `characters:page` — one page of the Characters view's rows, answered to
 * the asking socket only (plan §34.4). Nothing is pushed: the view re-asks.
 */
export const charactersPage: Handler<
	Sockets.Characters.Page.Params,
	Sockets.Characters.Page.Response
> = {
	event: "characters:page",
	handler: async (socket, params, emitToUser) => {
		const requestId = (params as any)?.requestId
		if (
			!params ||
			typeof params !== "object" ||
			typeof requestId !== "string" ||
			requestId === ""
		) {
			emitToUser("characters:page:error", {
				error: "Couldn't load the characters."
			})
			return undefined as never
		}
		try {
			const page = await characterRowsPage(db, socket.user!.id, {
				cursor: params.cursor,
				limit: params.limit,
				filters: params.filters
			})
			const res: Sockets.Characters.Page.Response = {
				rows: page.rows,
				nextCursor: page.nextCursor,
				requestId
			}
			replyToAsker(socket, "characters:page", res)
			return res
		} catch (error) {
			if (error instanceof CharacterRowsRefusal) {
				emitToUser("characters:page:error", {
					error: error.message,
					requestId
				})
				return undefined as never
			}
			emitToUser("characters:page:error", {
				error: "Couldn't load the characters.",
				requestId
			})
			throw error
		}
	}
}

/** 🚧 Registers `characters:page`, the Characters view's paged read. */
export function registerCharacterRowsHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, charactersPage, emitToUser)
}
