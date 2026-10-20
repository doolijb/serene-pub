/**
 * 🚧 `set-owner-face` (PLAN-sheet-widget-redesign §12): core's Stats widget
 * sets or clears a player seat's **portrait** — the face the sheet head, the
 * faces strip, Scene Portraits and their replies' avatar draw — by an
 * image's ref (a file's id or uuid), or `null` to clear it, through the
 * page's `state:setOwnerFace`. Core's widgets only (the askers table,
 * `./askers.ts`).
 *
 * The server judges who may (the seat's own player, or the session's owner
 * for anyone) and which picture the session may show; its refusal is this
 * request's rejection (R77), never a page-wide toast. Resolves once written;
 * the new `face` arrives on the next `session_state` push, never in the
 * reply.
 */
import type { WidgetRequests } from "@serene-pub/sdk"

type Params = WidgetRequests["set-owner-face"]["params"]

/** The owner kinds a face may be asked for (`OwnerRefV1`). */
const OWNER_KINDS = new Set(["session", "session_cast", "player_seat", "session_location"])

/** The page's write: sends `state:setOwnerFace` and settles on its reply. */
export type OwnerFaceWrite = (ask: {
	sessionId: number
	owner: Params["owner"]
	mediaRef: string | null
}) => Promise<Sockets.State.SetOwnerFace.Response>

/** Answer one `set-owner-face` for the page's session `sessionId`. Rejects, in words. */
export async function answerSetOwnerFace(
	params: unknown,
	sessionId: number | null,
	write: OwnerFaceWrite
): Promise<void> {
	const p = (params ?? {}) as Partial<Record<keyof Params, unknown>>
	const owner = p.owner as { kind?: unknown; id?: unknown } | undefined
	if (!owner || typeof owner !== "object" || typeof owner.kind !== "string" || !OWNER_KINDS.has(owner.kind))
		throw new Error("set-owner-face needs an owner: the world, a cast member, a player seat or a place")
	if (typeof owner.id !== "number" || !Number.isInteger(owner.id))
		throw new Error("set-owner-face needs the owner's id")
	if (p.mediaRef !== null && (typeof p.mediaRef !== "string" || !p.mediaRef.trim()))
		throw new Error("set-owner-face takes an image's ref, or null to clear the portrait")
	if (sessionId == null) throw new Error("this page has no session to set a face in")
	const res = await write({
		sessionId,
		owner: { kind: owner.kind as Params["owner"]["kind"], id: owner.id },
		mediaRef: typeof p.mediaRef === "string" ? p.mediaRef.trim() : null
	})
	if (res.error) throw new Error(res.error)
}

/** The reply's key (`./pendingAsks.ts`): the ask's own `request` token. */
export const ownerFaceReplyKey = (reply: Sockets.State.SetOwnerFace.Response): string | null =>
	reply.request ?? null
