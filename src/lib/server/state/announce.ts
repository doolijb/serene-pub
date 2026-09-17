/**
 * Telling a session that its state moved.
 *
 * `core:task/set-state@1` writes its rows straight through `state/write.ts` and
 * has no socket to announce them on: a Task has no host seam at all (see
 * `bindings.state.ts`). So the announcement is the TRIGGER's, made from the
 * receipt once the run is over — which is also the only moment at which "did
 * anything actually land" is answerable.
 *
 * Conditional on purpose. A turn where the keeper changed nothing is the
 * ordinary turn, and announcing on every one of them would have every ledger and
 * every stat widget in the session re-read for no reason.
 */

import type { Receipt } from "@serene-pub/sdk"
import { broadcastToSessionUsers } from "$lib/server/sockets/utils/broadcastHelpers"

/** Whether any `set-state` node in this run applied or proposed something. */
export function stateMoved(receipt: Receipt): boolean {
	return receipt.nodes.some((node) => {
		if (!String(node.definitionId ?? "").startsWith("core:task/set-state"))
			return false
		const out = node.output as
			| { applied?: unknown[]; proposed?: unknown[] }
			| null
			| undefined
		return Boolean(out?.applied?.length || out?.proposed?.length)
	})
}

/** Broadcast `state:changed` to the session, if this run moved anything. */
export async function announceStateChanges(
	io: any,
	sessionId: number,
	receipt: Receipt
): Promise<void> {
	if (!stateMoved(receipt)) return
	await broadcastToSessionUsers(io, sessionId, "state:changed", { sessionId })
}
