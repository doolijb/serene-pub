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

/**
 * Whether any `set-state` node in this run applied or proposed something —
 * 🚧 or wrote a skipped clock line (live scenes §15 G16), or a
 * `set-stat-config` node configured a stat: the ledger moved. 🚧 And
 * (2026-10-18, the 100-turn walk B10) a ruleset handler's `apply` that
 * wrote through the gate or filed a proposal (`core:task/ruleset-resolve@1`,
 * its `facts.applied` / `facts.proposed`, a refusal filed for review), or
 * a seat named (`core:outlet/set-seat-name@1`): a Planner-lane edit wrote
 * the sheet through the handler alone, and the sheet stayed stale until a
 * reload.
 */
export function stateMoved(receipt: Receipt): boolean {
	return receipt.nodes.some((node) => {
		const def = String(node.definitionId ?? "")
		// 🚧 A stat configured (`set-stat-config@1`): a bar's ceiling moved.
		if (def.startsWith("core:outlet/set-stat-config"))
			return typeof (node.output as { main?: { configId?: unknown } } | null)?.main?.configId === "number"
		// 🚧 The ruleset handler's writes (`apply`, `advance`).
		if (def.startsWith("core:task/ruleset-resolve")) {
			const out = node.output as
				| { facts?: { applied?: unknown[]; proposed?: unknown[] }; rejected?: Array<{ proposalId?: unknown }> }
				| null
				| undefined
			return Boolean(
				out?.facts?.applied?.length ||
					out?.facts?.proposed?.length ||
					out?.rejected?.some((r) => typeof r?.proposalId === "number")
			)
		}
		// 🚧 A seat named or renamed: the sheet's head reads its name.
		if (def.startsWith("core:outlet/set-seat-name"))
			return (node.output as { status?: unknown } | null)?.status === "committed"

		if (!def.startsWith("core:task/set-state"))
			return false
		const out = node.output as
			| { applied?: unknown[]; proposed?: unknown[]; skipped?: unknown[] }
			| null
			| undefined
		return Boolean(out?.applied?.length || out?.proposed?.length || out?.skipped?.length)
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
