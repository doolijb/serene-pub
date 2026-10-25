/**
 * 🚧 `session-places` (PLAN-core-widgets W4): core's Places widget reads the
 * session's places and the ways between them through the page's
 * `sessions:places` — the server's read of the session's book at its
 * reading (its line, its story clock; `server/sockets/sessionPlaces.ts`).
 * Core's widgets, or a plugin's widget granted `lore` (the askers table,
 * `./askers.ts`). Who stands where is not asked: the widget reads it from
 * the session's state, which it is granted.
 *
 * **One reply, one ask**, as `./authorsNote.ts`: each ask carries a request
 * token the server echoes on the reply and on the `:error` refusal, and the
 * page waits under it (`./pendingAsks.ts`). A refusal is the asking widget's
 * own error (R77), never a toast.
 */
import type { WidgetRequests } from "@serene-pub/sdk"

type Result = WidgetRequests["session-places"]["result"]

/** The page's read: one `sessions:places`, settled on ITS reply. */
export type SessionPlacesRead = (
	ask: Omit<Sockets.Sessions.Places.Params, "request">
) => Promise<Sockets.Sessions.Places.Response>

/** The reply's key: the token its ask carried; null for an untokened reply. */
export const sessionPlacesReplyKey = (
	reply: Sockets.Sessions.Places.Response
): string | null => reply.request ?? null

/**
 * Answer one `session-places` for the page's session. Rejects, in words,
 * with anything the server refused or did not say.
 *
 * 🚧 A session with no shared lorebook: the server lists its own book's places but names no lorebook; the
 * answer names the own book, so the widget draws them (pr-6 B §B-3).
 */
export async function answerSessionPlaces(
	_params: unknown,
	sessionId: number | null,
	read: SessionPlacesRead,
	ownBookId: number | null = null
): Promise<Result> {
	if (sessionId == null)
		throw new Error("this page has no session to read the places of")
	const res = await read({ sessionId })
	if (res.error) throw new Error(res.error)
	if (!res.places)
		throw new Error("the server did not say which places there are")
	return res.places.lorebookId == null && ownBookId != null
		? { ...res.places, lorebookId: ownBookId }
		: res.places
}
