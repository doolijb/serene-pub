/**
 * 🚧 `give-piece` — _Give to…_ (PLAN-dc-after-walk2 Q0-4, owner ruling ★4,
 * 2026-10-19): core's Stats widget hands `count` of a piece from one sheet
 * to another (or puts it down at a place) through the page's `state:givePiece`.
 * The host decides how — at once where the viewer may write both sheets,
 * else an offer the receiver accepts — and answers which (`given`). A
 * plugin's widget may ask it holding the write grant `session:state:write`,
 * as for `set-attribute-value` (the askers table, `./askers.ts`, and asked
 * again here).
 *
 * The refusal is this request's rejection (R77), never a page-wide toast.
 * What moved arrives as the next `session_state` push.
 */
import type { WidgetRequests } from "@serene-pub/sdk"
import type { WidgetRequestHandler } from "$lib/shared/widgets/context"
import { holdsWidgetGrant } from "./askers"
import { SET_ATTRIBUTE_VALUE_GRANT } from "./setAttributeValue"

type Params = WidgetRequests["give-piece"]["params"]
type Result = WidgetRequests["give-piece"]["result"]

/** The owners a piece moves between: a cast member, a player's seat, a place. */
const GIVE_KINDS = new Set(["session_cast", "player_seat", "session_location"])

/** The page's write: sends `state:givePiece` and settles on its reply. */
export type GiveWrite = (ask: {
	sessionId: number
	from: Params["from"]
	to: Params["to"]
	slotId: string
	index: number
	count: number
}) => Promise<Sockets.State.GivePiece.Response>

const ownerIn = (raw: unknown, what: string): Params["from"] => {
	const o = raw as { kind?: unknown; id?: unknown } | undefined
	if (!o || typeof o !== "object" || typeof o.kind !== "string" || !GIVE_KINDS.has(o.kind))
		throw new Error(`give-piece needs ${what}: a cast member, a player's seat or a place`)
	if (typeof o.id !== "number" || !Number.isInteger(o.id)) throw new Error(`give-piece needs ${what}'s id`)
	return { kind: o.kind as Params["from"]["kind"], id: o.id }
}

/** Answer one `give-piece` for the page's session `sessionId`, from `from` (absent: core's own widget). Rejects, in words. */
export async function answerGivePiece(
	params: unknown,
	sessionId: number | null,
	write: GiveWrite,
	from?: Parameters<WidgetRequestHandler>[2]
): Promise<Result> {
	if (!holdsWidgetGrant(from, SET_ATTRIBUTE_VALUE_GRANT))
		throw new Error(
			`'give-piece' changes what the 'session:state' scope covers, and this widget was not granted the write grant '${SET_ATTRIBUTE_VALUE_GRANT}'`
		)
	const p = (params ?? {}) as Partial<Record<keyof Params, unknown>>
	const giver = ownerIn(p.from, "a giver")
	const to = ownerIn(p.to, "someone to give it to")
	if (typeof p.slotId !== "string" || !p.slotId) throw new Error("give-piece needs a slotId")
	if (typeof p.index !== "number" || !Number.isInteger(p.index) || p.index < 0)
		throw new Error("give-piece needs the piece's place in the list (index)")
	const count = p.count === undefined ? 1 : p.count
	if (typeof count !== "number" || !Number.isInteger(count) || count < 1)
		throw new Error("give-piece gives a whole number of at least one")
	if (sessionId == null) throw new Error("this page has no session to give anything in")
	const res = await write({ sessionId, from: giver, to, slotId: p.slotId, index: p.index, count })
	if (res.error) throw new Error(res.error)
	return { given: res.given === "offered" ? "offered" : "direct" }
}

/** The reply's key (`./pendingAsks.ts`): the ask's own `request` token. */
export const giveReplyKey = (reply: Sockets.State.GivePiece.Response): string | null => reply.request ?? null
