/**
 * 🚧 `authors-note` and `set-authors-note` (2026-10-02, AN1): core's Author's
 * note widget reads the session's author's note — and what the newest reply
 * did with it — and saves it, through the page's `sessions:authorsNote` and
 * `sessions:setAuthorsNote`. Core's widgets only (the askers table,
 * `./askers.ts`). The server judges who may write (the session's owner).
 *
 * **One reply, one ask**, as `./setEntryMarks.ts`: each ask carries a request
 * token the server echoes on the reply and on the `:error` refusal, and the
 * page waits under it (`./pendingAsks.ts`). A refusal is the asking widget's
 * own error (R77), never a toast.
 */
import type { WidgetRequests } from "@serene-pub/sdk"
import type { PendingAsks } from "./pendingAsks"

type ReadResult = WidgetRequests["authors-note"]["result"]
type WriteResult = WidgetRequests["set-authors-note"]["result"]

/** The page's read: one `sessions:authorsNote`, settled on ITS reply. */
export type AuthorsNoteRead = (
	ask: Omit<Sockets.Sessions.AuthorsNote.Params, "request">
) => Promise<Sockets.Sessions.AuthorsNote.Response>
/** The page's write: one `sessions:setAuthorsNote`, settled on ITS reply. */
export type AuthorsNoteWrite = (
	ask: Omit<Sockets.Sessions.SetAuthorsNote.Params, "request">
) => Promise<Sockets.Sessions.SetAuthorsNote.Response>

/** The reply's key: the token its ask carried; null for an untokened reply. */
export const authorsNoteReplyKey = (reply: Sockets.Sessions.AuthorsNote.Response): string | null =>
	reply.request ?? null

/** Each ask tokened (`request`), waiting under the token its reply will carry. */
export function tokenedAsk<P extends object, R>(
	asks: Pick<PendingAsks<P & { request?: string }, R>, "ask">,
	prefix: string
): (ask: P) => Promise<R> {
	let asked = 0
	return (ask) => {
		const request = `${prefix}:${++asked}:${Math.random().toString(36).slice(2, 8)}`
		return asks.ask(request, { ...ask, request })
	}
}

const ROLES: ReadonlySet<string> = new Set(["system", "user", "assistant"])
const isWhole = (v: unknown, min: number) =>
	typeof v === "number" && Number.isInteger(v) && v >= min

/** Answer one `authors-note` for the page's session. Rejects, in words. */
export async function answerAuthorsNote(
	_params: unknown,
	sessionId: number | null,
	read: AuthorsNoteRead
): Promise<ReadResult> {
	if (sessionId == null) throw new Error("this page has no session to read the author's note of")
	const res = await read({ sessionId })
	if (res.error) throw new Error(res.error)
	if (!res.note) throw new Error("the server did not say what the author's note is")
	return res.note
}

/** Answer one `set-authors-note`. Rejects, in words, with a mistake or the server's refusal. */
export async function answerSetAuthorsNote(
	params: unknown,
	sessionId: number | null,
	write: AuthorsNoteWrite
): Promise<WriteResult> {
	const note = ((params ?? {}) as { note?: Record<string, unknown> }).note
	if (!note || typeof note !== "object") throw new Error("set-authors-note needs a note")
	if (typeof note.text !== "string") throw new Error("set-authors-note takes the note's text as text")
	if (!isWhole(note.depth, 0)) throw new Error("set-authors-note takes a depth of 0 or more, whole")
	if (!isWhole(note.interval, 1)) throw new Error("set-authors-note takes an interval of 1 or more, whole")
	if (typeof note.role !== "string" || !ROLES.has(note.role))
		throw new Error("set-authors-note sends the note as 'system', 'user' or 'assistant'")
	if (sessionId == null) throw new Error("this page has no session to save the author's note to")
	const res = await write({
		sessionId,
		note: {
			text: note.text,
			depth: note.depth as number,
			interval: note.interval as number,
			role: note.role as "system" | "user" | "assistant"
		}
	})
	if (res.error) throw new Error(res.error)
	if (!res.note) throw new Error("the server did not say how the author's note now reads")
	return res.note
}
