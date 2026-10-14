/**
 * 🚧 `stat-trail` (PLAN-core-widgets §3.10, F2, 2026-10-11): core's Stats
 * widget asks how one owner's stat got where it is — the changes this
 * session made to it, each with its message — through the page's
 * `sessions:statTrail`, the server's read of the ledger the *Stat trail*
 * pipeline query reads (`server/state/statTrail.ts`). Core's widgets, or a
 * plugin's widget granted `session:state` (the askers table, `./askers.ts`).
 * A guest may ask: the trail is the session's state, which they see.
 *
 * **One reply, one ask**, as `./sessionPlaces.ts`: each ask carries a
 * request token the server echoes on the reply and on the `:error`
 * refusal, and the page waits under it (`./pendingAsks.ts`). A refusal is
 * the asking widget's own error (R77), never a toast.
 */
import type { WidgetRequests } from "@serene-pub/sdk"

type Params = WidgetRequests["stat-trail"]["params"]
type Result = WidgetRequests["stat-trail"]["result"]

/** The page's read: one `sessions:statTrail`, settled on ITS reply. */
export type StatTrailRead = (
	ask: Omit<Sockets.Sessions.StatTrail.Params, "request">
) => Promise<Sockets.Sessions.StatTrail.Response>

/** The reply's key: the token its ask carried; null for an untokened reply. */
export const statTrailReplyKey = (
	reply: Sockets.Sessions.StatTrail.Response
): string | null => reply.request ?? null

const OWNER_KINDS: ReadonlySet<string> = new Set([
	"session",
	"session_cast",
	"session_location"
])

/** The most changes one ask may name. */
export const STAT_TRAIL_MOST = 100

/**
 * Answer one `stat-trail` for the page's session. Rejects, in words, for an
 * owner or slot that is not one, and with anything the server refused or
 * did not say.
 */
export async function answerStatTrail(
	params: Params,
	sessionId: number | null,
	read: StatTrailRead
): Promise<Result> {
	const p = (params ?? {}) as Partial<Params>
	const owner = p.owner as { kind?: unknown; id?: unknown } | undefined
	if (
		!owner ||
		typeof owner.kind !== "string" ||
		!OWNER_KINDS.has(owner.kind) ||
		typeof owner.id !== "number" ||
		!Number.isInteger(owner.id)
	)
		throw new Error(
			"stat-trail names its owner as { kind: 'session' | 'session_cast' | 'session_location', id }"
		)
	const slotId = typeof p.slotId === "string" ? p.slotId.trim() : ""
	if (!slotId)
		throw new Error("stat-trail names the stat to follow by its slot id")
	if (
		p.limit !== undefined &&
		(typeof p.limit !== "number" ||
			!Number.isInteger(p.limit) ||
			p.limit < 1 ||
			p.limit > STAT_TRAIL_MOST)
	)
		throw new Error(
			`stat-trail's limit is a whole number from 1 to ${STAT_TRAIL_MOST}`
		)
	if (sessionId == null)
		throw new Error("this page has no session to read a stat's trail in")
	const res = await read({
		sessionId,
		owner: { kind: owner.kind as Params["owner"]["kind"], id: owner.id },
		slotId,
		...(p.limit !== undefined ? { limit: p.limit } : {})
	})
	if (res.error) throw new Error(res.error)
	if (!res.trail)
		throw new Error("the server did not say how the stat changed")
	return res.trail
}
