/**
 * 🚧 `set-backdrop` (DESIGN-image-generation §6.4): core's Backdrop widget
 * sets the session's **backdrop** to one image — by its image ref, a file's
 * uuid (what `character-images` answers as `ref`) — or clears it (`null`),
 * through the page's `sessions:setBackdrop`. Core's widgets only (the askers
 * table, `./askers.ts`).
 *
 * The server judges who may (the session's owner or an admin) and which
 * picture the session may show; its refusal is this request's rejection,
 * never a page-wide toast (R77: per-widget errors). Resolves once the server
 * has written it; the new backdrop arrives on the `session` section (every
 * member hears `sessions:backdropChanged`), never in the reply.
 */
import type { WidgetRequests } from "@serene-pub/sdk"

type Params = WidgetRequests["set-backdrop"]["params"]

/** The page's write: sends `sessions:setBackdrop` and settles on its reply. */
export type BackdropWrite = (ask: {
	sessionId: number
	mediaRef: string | null
}) => Promise<Sockets.Sessions.SetBackdrop.Response>

/** Answer one `set-backdrop` for the page's session `sessionId`. Rejects, in words. */
export async function answerSetBackdrop(
	params: unknown,
	sessionId: number | null,
	write: BackdropWrite
): Promise<void> {
	const p = (params ?? {}) as Partial<Record<keyof Params, unknown>>
	if (p.mediaRef !== null && (typeof p.mediaRef !== "string" || !p.mediaRef.trim()))
		throw new Error("set-backdrop takes an image's ref, or null to clear the backdrop")
	if (sessionId == null) throw new Error("this page has no session to set the backdrop of")
	const res = await write({
		sessionId,
		mediaRef: typeof p.mediaRef === "string" ? p.mediaRef.trim() : null
	})
	if (res.error) throw new Error(res.error)
}

/** The reply's key (`./pendingAsks.ts`): the ask's own `request` token. */
export const backdropReplyKey = (reply: Sockets.Sessions.SetBackdrop.Response): string | null =>
	reply.request ?? null
