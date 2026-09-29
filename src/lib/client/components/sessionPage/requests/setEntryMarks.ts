/**
 * 🚧 `set-entry-marks` (R21, R58): core's lore entries set an entry's **Off**
 * and **Pin** marks, and nothing else — never a re-embed — through the page's
 * `entries:setMarks`. Core's widgets only (the askers table, `./askers.ts`).
 * The server judges who may (the book's owner, an admin).
 *
 * The reply names the entry and nothing more, and comes back on one of two
 * events (`entries:setMarks`, `entries:setMarks:error`), so the page waits
 * per entry, oldest ask first (`./pendingAsks.ts`), and the server's refusal
 * is this request's rejection — the asking widget's own error (R77), never a
 * toast every lore widget shows.
 *
 * Resolves with both marks as they now stand, which is what the server
 * answers with.
 */
import type { WidgetRequests } from "@serene-pub/sdk"
import type { PendingAsks } from "./pendingAsks"

type Params = WidgetRequests["set-entry-marks"]["params"]
type Result = WidgetRequests["set-entry-marks"]["result"]

/** The page's write: sends one `entries:setMarks` and settles on the reply for that entry. */
export type EntryMarksWrite = (ask: Sockets.Entries.SetMarks.Params) => Promise<Sockets.Entries.SetMarks.Response>

/** The reply's key: the entry it names. */
export const entryMarksReplyKey = (reply: Sockets.Entries.SetMarks.Response): string | null =>
	typeof reply.entryId === "number" ? String(reply.entryId) : null

/**
 * The page's write over its pending-asks table: each ask waits under the
 * key its reply will carry (`entryMarksReplyKey`), so the two always agree.
 */
export const entryMarksWrite =
	(asks: PendingAsks<Sockets.Entries.SetMarks.Params, Sockets.Entries.SetMarks.Response>): EntryMarksWrite =>
	(ask) =>
		asks.ask(String(ask.entryId), ask)

/** Answer one `set-entry-marks`. Rejects, in words, with a mistake or the server's refusal. */
export async function answerSetEntryMarks(params: unknown, write: EntryMarksWrite): Promise<Result> {
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
		...(p.pinned !== undefined ? { pinned: p.pinned } : {})
	})
	if (res.error) throw new Error(res.error)
	if (typeof res.off !== "boolean" || typeof res.pinned !== "boolean")
		throw new Error("the server did not say how the marks now stand")
	return { off: res.off, pinned: res.pinned }
}
