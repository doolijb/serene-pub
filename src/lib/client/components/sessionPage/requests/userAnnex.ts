import type { WidgetRequests } from "@serene-pub/sdk"
import { v4 as uuid } from "uuid"
import { awaitReply } from "$lib/client/utils/awaitReply"
import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"

/**
 * 🚧 `user-annex` (M2b): the person's own documents under the asking
 * extension. The owner is the frame's own (`from.owner`) — the server
 * resolves the person from the socket and judges the extension's grant. A
 * refusal rejects with the server's own sentence; a stale write is a result,
 * not a refusal.
 */
export async function answerUserAnnex(
	params: WidgetRequests["user-annex"]["params"],
	from: { owner: string }
): Promise<WidgetRequests["user-annex"]["result"]> {
	if (from.owner === "core")
		throw new Error("Only an extension's own frames keep documents for it.")
	// The uuid package, not the Web Crypto UUID: that is undefined on a plain-http LAN address.
	const requestId = uuid()
	const res = await awaitReply({
		socket: useTypedSocket(),
		event: "appletApi:userAnnex",
		errorEvent: "appletApi:userAnnex:error",
		params: { ...params, pluginId: from.owner, requestId },
		match: (r) => r?.requestId === requestId,
		matchError: (e) => (e as { requestId?: string } | null)?.requestId === requestId,
		timeoutMs: 30_000
	})
	return res.result
}
