import type { TypedSocket } from "$lib/client/sockets/typedSocket"
import { awaitReply } from "$lib/client/utils/awaitReply"
import { interestKey } from "$lib/shared/sockets/interest"
import { refusalFor } from "$lib/client/lorebooks/places/placeStatsApi"

/**
 * 🚧 The character form's **Stats** tab's door to the server
 * (DESIGN-card-strokes-and-dowry §B.4): `cardState:*`, each call resolving
 * with its reply — or rejecting with the server's sentence, or on silence
 * (`awaitReply`). A prop of `CardStatsTab`, so the tab is testable without a
 * socket.
 */
export interface CardStatsApi {
	read(characterId: number): Promise<Sockets.CardState.Get.Response>
	write(characterId: number, changes: Sockets.CardState.Change[]): Promise<Sockets.CardState.Set.Response>
	setSheets(characterId: number, sheetIds: string[]): Promise<Sockets.CardState.SetSheets.Response>
	declareSlot(params: Omit<Sockets.CardState.DeclareSlot.Params, "requestId">): Promise<Sockets.CardState.DeclareSlot.Response>
	declareSheet(
		params: Omit<Sockets.CardState.DeclareSheet.Params, "requestId">
	): Promise<Sockets.CardState.DeclareSheet.Response>
}

let sent = 0
/** This tab's own id for one call: a reply reaches every tab of the user, and each settles its own. */
const nextRequestId = () => `card-stats-${Date.now().toString(36)}-${++sent}`

export function socketCardStatsApi(socket: Pick<TypedSocket, "emit">): CardStatsApi {
	return {
		read(characterId) {
			const requestId = nextRequestId()
			return awaitReply({
				socket,
				event: "cardState:get",
				params: { characterId, requestId },
				replyKey: interestKey("cardState:get", characterId),
				errorEvent: "cardState:get:error",
				match: (res) => res.requestId === requestId,
				matchError: refusalFor(requestId),
				fallbackError: "This character's stats could not be read."
			})
		},
		write(characterId, changes) {
			const requestId = nextRequestId()
			return awaitReply({
				socket,
				event: "cardState:set",
				params: { characterId, changes, requestId },
				replyKey: interestKey("cardState:set", characterId),
				errorEvent: "cardState:set:error",
				match: (res) => res.requestId === requestId,
				matchError: refusalFor(requestId),
				fallbackError: "The stats could not be saved."
			})
		},
		setSheets(characterId, sheetIds) {
			const requestId = nextRequestId()
			return awaitReply({
				socket,
				event: "cardState:setSheets",
				params: { characterId, sheetIds, requestId },
				replyKey: interestKey("cardState:setSheets", characterId),
				errorEvent: "cardState:setSheets:error",
				match: (res) => res.requestId === requestId,
				matchError: refusalFor(requestId),
				fallbackError: "The sheets could not be saved."
			})
		},
		declareSlot(params) {
			const requestId = nextRequestId()
			return awaitReply({
				socket,
				event: "cardState:declareSlot",
				params: { ...params, requestId },
				errorEvent: "cardState:declareSlot:error",
				match: (res) => res.requestId === requestId,
				matchError: refusalFor(requestId),
				fallbackError: "The slot could not be declared."
			})
		},
		declareSheet(params) {
			const requestId = nextRequestId()
			return awaitReply({
				socket,
				event: "cardState:declareSheet",
				params: { ...params, requestId },
				errorEvent: "cardState:declareSheet:error",
				match: (res) => res.requestId === requestId,
				matchError: refusalFor(requestId),
				fallbackError: "The sheet could not be declared."
			})
		}
	}
}
