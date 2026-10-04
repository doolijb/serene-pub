/**
 * 🚧 `set-entry-marks` (R21, R58): core's lore entries set an entry's **Off**
 * and **Pin** marks, and nothing else — never a re-embed — through the page's
 * `entries:setMarks`. Core's widgets only (the askers table, `./askers.ts`).
 * The server judges who may (the book's owner, an admin).
 *
 * **One reply, one ask.** The answer comes back on one of two user-wide
 * events (`entries:setMarks`, `entries:setMarks:error`) that every tab of
 * the person hears, and it is as the ASKING session reads the entry — so
 * another tab's answer for the same entry may be another session's marks.
 * Each ask carries a request token the server echoes on both, and the page
 * waits under it (`./pendingAsks.ts`); the server's refusal is this
 * request's rejection — the asking widget's own error (R77), never a toast
 * every lore widget shows.
 *
 * Resolves with both marks as the page's session reads the entry — its
 * line, at its clock — which is what the server answers with when the page
 * names its session (plan A14). When a dated amendment still decides a mark
 * asked for, the server names it (`heldBy`) and the widget is told which
 * mark and from when, in its own words (`mark`: `off` · `pinned`), the date
 * spelled by the book's calendar.
 */
import type { WidgetRequests } from "@serene-pub/sdk"
import type { PendingAsks } from "./pendingAsks"

type Params = WidgetRequests["set-entry-marks"]["params"]
type Result = WidgetRequests["set-entry-marks"]["result"]

type Ask = Omit<Sockets.Entries.SetMarks.Params, "request">

/** The page's write: sends one `entries:setMarks` and settles on ITS reply. */
export type EntryMarksWrite = (ask: Ask) => Promise<Sockets.Entries.SetMarks.Response>

/** The reply's key: the token its ask carried; null for an untokened reply. */
export const entryMarksReplyKey = (reply: Sockets.Entries.SetMarks.Response): string | null =>
	reply.request ?? null

/**
 * The page's write over its pending-asks table: each ask is tokened
 * (`request`) and waits under the token its reply will carry
 * (`entryMarksReplyKey`), so the two always agree.
 */
export function entryMarksWrite(
	asks: Pick<PendingAsks<Sockets.Entries.SetMarks.Params, Sockets.Entries.SetMarks.Response>, "ask">,
	prefix = `widget-marks:${Math.random().toString(36).slice(2)}`
): EntryMarksWrite {
	let asked = 0
	return (ask) => {
		const request = `${prefix}:${++asked}`
		return asks.ask(request, { ...ask, request })
	}
}

/** Answer one `set-entry-marks`. Rejects, in words, with a mistake or the server's refusal. */
export async function answerSetEntryMarks(
	params: unknown,
	/** The page's session, or null when it has none yet. */
	sessionId: number | null,
	write: EntryMarksWrite
): Promise<Result> {
	const p = (params ?? {}) as Partial<Record<keyof Params, unknown>>
	if (typeof p.entryId !== "number" || !Number.isInteger(p.entryId))
		throw new Error("set-entry-marks needs an entryId")
	if (p.off !== undefined && typeof p.off !== "boolean") throw new Error("set-entry-marks takes 'off' as true or false")
	if (p.pinned !== undefined && typeof p.pinned !== "boolean")
		throw new Error("set-entry-marks takes 'pinned' as true or false")
	if (p.off === undefined && p.pinned === undefined)
		throw new Error("set-entry-marks needs a mark to set: 'off', 'pinned' or both")
	const res = await write({
		entryId: p.entryId,
		...(p.off !== undefined ? { off: p.off } : {}),
		...(p.pinned !== undefined ? { pinned: p.pinned } : {}),
		...(sessionId != null ? { sessionId } : {})
	})
	if (res.error) throw new Error(res.error)
	if (typeof res.off !== "boolean" || typeof res.pinned !== "boolean")
		throw new Error("the server did not say how the marks now stand")
	return {
		off: res.off,
		pinned: res.pinned,
		...(res.heldBy
			? { heldBy: { mark: res.heldBy.field === "enabled" ? "off" : "pinned", date: res.heldBy.label } }
			: {})
	}
}
