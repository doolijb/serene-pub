/**
 * 🚧 `set-attribute-carry` — one of the rules' optional attributes carried
 * by a holder, or not (RF fix 8, 2026-10-23; an **attribute carry**): core's
 * Stats widget's switch, through the page's `state:setCarry` — the same door
 * Session settings › Attributes uses. Whoever plays the holder, or the
 * session's owner; the host refuses anyone else, and an attribute the rules
 * require, in words. A plugin's widget may ask it holding the write grant
 * `session:state:write`, as for `set-attribute-value`.
 *
 * The refusal is this request's rejection (R77), never a page-wide toast.
 * The change arrives as the next `session_state` push.
 */
import type { WidgetRequests } from "@serene-pub/sdk"
import type { WidgetRequestHandler } from "$lib/shared/widgets/context"
import { holdsWidgetGrant } from "./askers"
import { SET_ATTRIBUTE_VALUE_GRANT } from "./setAttributeValue"

type Result = WidgetRequests["set-attribute-carry"]["result"]

/** The page's write: sends `state:setCarry` and settles on its reply. */
export type AttributeCarryWrite = (ask: {
	sessionId: number
	owner: Sockets.State.SetCarry.Params["owner"]
	slotId: string
	carries: boolean
}) => Promise<Sockets.State.SetCarry.Response & { error?: string }>

const OWNER_KINDS = new Set(["session", "session_cast", "player_seat", "session_location"])

/** Answer one `set-attribute-carry` for the page's session, from `from` (absent: core's own widget). Rejects, in words. */
export async function answerSetAttributeCarry(
	params: unknown,
	sessionId: number | null,
	write: AttributeCarryWrite,
	from?: Parameters<WidgetRequestHandler>[2]
): Promise<Result> {
	if (!holdsWidgetGrant(from, SET_ATTRIBUTE_VALUE_GRANT))
		throw new Error(
			`'set-attribute-carry' changes what the 'session:state' scope covers, and this widget was not granted the write grant '${SET_ATTRIBUTE_VALUE_GRANT}'`
		)
	const p = (params ?? {}) as { owner?: { kind?: unknown; id?: unknown }; slotId?: unknown; carries?: unknown }
	const kind = p.owner?.kind
	if (typeof kind !== "string" || !OWNER_KINDS.has(kind) || typeof p.owner?.id !== "number" || !Number.isInteger(p.owner.id))
		throw new Error("set-attribute-carry needs whose: the world, a cast member, a player's seat or a place")
	if (typeof p.slotId !== "string" || !p.slotId) throw new Error("set-attribute-carry needs which attribute")
	if (typeof p.carries !== "boolean") throw new Error("set-attribute-carry says carries: true or false")
	if (sessionId == null) throw new Error("this page has no session to change anything in")
	const res = await write({
		sessionId,
		owner: { kind: kind as Sockets.State.SetCarry.Params["owner"]["kind"], id: p.owner.id as number },
		slotId: p.slotId,
		carries: p.carries
	})
	if (res.error) throw new Error(res.error)
	return { carries: p.carries }
}

/** The reply's key (`./pendingAsks.ts`): the ask's own `request` token. */
export const attributeCarryReplyKey = (reply: Sockets.State.SetCarry.Response & { error?: string }): string | null => reply.request ?? null
