/**
 * 🚧 `set-tie-shown` — a tie side's numbers shown to others, or hidden again
 * (ties on the graph, screen 2, lane T2, 2026-10-23): core's Stats widget's
 * switch under a tie, through the page's `state:showTieSide`. The holder's,
 * or the session owner's; the host refuses anyone else. A plugin's widget
 * may ask it holding the write grant `session:state:write`, as for
 * `set-attribute-value`.
 *
 * The refusal is this request's rejection (R77), never a page-wide toast.
 * The change arrives as the next `session_state` push.
 */
import type { WidgetRequests } from "@serene-pub/sdk"
import type { WidgetRequestHandler } from "$lib/shared/widgets/context"
import { holdsWidgetGrant } from "./askers"
import { SET_ATTRIBUTE_VALUE_GRANT } from "./setAttributeValue"

type Result = WidgetRequests["set-tie-shown"]["result"]

/** The page's write: sends `state:showTieSide` and settles on its reply. */
export type TieShownWrite = (ask: {
	sessionId: number
	owner: { kind: "session_cast" | "player_seat"; id: number }
	entryType: string
	towards: string
	shown: boolean
}) => Promise<Sockets.State.ShowTieSide.Response>

/** Answer one `set-tie-shown` for the page's session, from `from` (absent: core's own widget). Rejects, in words. */
export async function answerSetTieShown(
	params: unknown,
	sessionId: number | null,
	write: TieShownWrite,
	from?: Parameters<WidgetRequestHandler>[2]
): Promise<Result> {
	if (!holdsWidgetGrant(from, SET_ATTRIBUTE_VALUE_GRANT))
		throw new Error(
			`'set-tie-shown' changes what the 'session:state' scope covers, and this widget was not granted the write grant '${SET_ATTRIBUTE_VALUE_GRANT}'`
		)
	const p = (params ?? {}) as { owner?: { kind?: unknown; id?: unknown }; entryType?: unknown; towards?: unknown; shown?: unknown }
	const kind = p.owner?.kind
	if ((kind !== "session_cast" && kind !== "player_seat") || typeof p.owner?.id !== "number" || !Number.isInteger(p.owner.id))
		throw new Error("set-tie-shown needs whose side: a cast member or a player's seat")
	if (typeof p.entryType !== "string" || !p.entryType || typeof p.towards !== "string" || !p.towards)
		throw new Error("set-tie-shown needs the tie: its kind and whom it is towards")
	if (typeof p.shown !== "boolean") throw new Error("set-tie-shown says shown: true or false")
	if (sessionId == null) throw new Error("this page has no session to show anything in")
	const res = await write({ sessionId, owner: { kind, id: p.owner.id as number }, entryType: p.entryType, towards: p.towards, shown: p.shown })
	if (res.error) throw new Error(res.error)
	return { shown: res.shown === true }
}

/** The reply's key (`./pendingAsks.ts`): the ask's own `request` token. */
export const tieShownReplyKey = (reply: Sockets.State.ShowTieSide.Response): string | null => reply.request ?? null
