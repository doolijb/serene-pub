import type { TypedSocket } from "$lib/client/sockets/typedSocket"
import { awaitReply } from "$lib/client/utils/awaitReply"
import { interestKey } from "$lib/shared/sockets/interest"

/**
 * 🚧 The place editor's Stats section's door to the server (plan
 * places-graph L4): `lorebookState:get` and `lorebookState:set`, each
 * resolving with the place's fresh read — or rejecting with the server's
 * sentence, or on silence (`awaitReply`).
 *
 * A prop of `PlaceStats`, so the section is testable without a socket.
 */
export interface PlaceStatsApi {
	read(params: Sockets.LorebookState.Get.Params): Promise<Sockets.LorebookState.Get.Response>
	write(params: Sockets.LorebookState.Set.Params): Promise<Sockets.LorebookState.Set.Response>
}

let sent = 0
/** This tab's own id for one call: a reply reaches every tab of the user, and each settles its own. */
const nextRequestId = () => `place-stats-${Date.now().toString(36)}-${++sent}`

/**
 * A refusal is this call's when it names this call's id — or names none (a
 * failure the handler did not word reaches every caller, as before). One
 * naming another request is another stat's save, or another tab's.
 */
export const refusalFor = (requestId: string) => (data: unknown) => {
	const named = (data as { requestId?: unknown } | null | undefined)?.requestId
	return named === undefined || named === requestId
}

export function socketPlaceStatsApi(socket: Pick<TypedSocket, "emit">): PlaceStatsApi {
	return {
		read(params) {
			const requestId = nextRequestId()
			return awaitReply({
				socket,
				event: "lorebookState:get",
				params: { ...params, requestId },
				replyKey: interestKey("lorebookState:get", params.lorebookId),
				errorEvent: "lorebookState:get:error",
				match: (res) => res.requestId === requestId,
				matchError: refusalFor(requestId),
				fallbackError: "This place's stats could not be read."
			})
		},
		write(params) {
			const requestId = nextRequestId()
			return awaitReply({
				socket,
				event: "lorebookState:set",
				params: { ...params, requestId },
				replyKey: interestKey("lorebookState:set", params.lorebookId),
				errorEvent: "lorebookState:set:error",
				match: (res) => res.requestId === requestId,
				matchError: refusalFor(requestId),
				fallbackError: "The stat could not be saved."
			})
		}
	}
}
