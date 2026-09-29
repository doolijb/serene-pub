/**
 * 🚧 `session-entries` (R21, R58): a page of the session's lorebook, entry by
 * entry, with what this session's rankings made of each — the page's own
 * `entries:sessionEntries` for its own session. Core's widgets, or a plugin's
 * widget granted `lore` (the askers table, `./askers.ts`).
 *
 * Two vocabularies meet here (R5): the widget searches with `titleOrKey`, the
 * socket still calls it `query` — a word the SDK retires for a search string —
 * and this is the one place that maps the one onto the other. A widget that
 * sends `query` is told the word, never silently shown every entry.
 *
 * 🚧 `typeIds` narrows to entry types — a state widget's item picker asks
 * for `core:entry/item` first (attributes phase 3c); absent or empty is every
 * type.
 *
 * **One reply, one ask.** The answer comes back on a user-wide event: another
 * panel and another tab hear every reply. So each ask carries a request
 * token the server echoes, and a reply settles only the ask whose token it
 * carries — a reply that lost a race answers its own ask, never a newer one,
 * and a reply to somebody else's ask answers nothing here. Which answer to
 * SHOW, when a widget has asked twice, is the widget's: each ask resolves
 * with its own (core's Lore entries keeps a latest-ask guard for it).
 *
 * The reply is copied field by field into `SessionEntryV1`, so a later server
 * field cannot ride through to a widget unnoticed.
 */
import type { SessionEntryV1, WidgetRequests } from "@serene-pub/sdk"

type Params = WidgetRequests["session-entries"]["params"]
type Result = WidgetRequests["session-entries"]["result"]
type Ask = Omit<Sockets.Entries.SessionEntries.Params, "request">

const SORTS: ReadonlySet<string> = new Set(["name", "lastRead", "timesRead", "rank"])
const FILTERS: ReadonlySet<string> = new Set(["all", "fired", "pinned", "off"])

/** The page's read: sends one `entries:sessionEntries` and settles on ITS reply. */
export type SessionEntriesRead = (ask: Ask) => Promise<Sockets.Entries.SessionEntries.Response>

/**
 * A read that tokens each ask (`request`) and waits under the token — so the
 * reply matched is this ask's own. `asks` is the page's pending-asks table
 * for `entries:sessionEntries`, keyed by {@link sessionEntriesReplyKey}.
 */
export function tokenedEntriesRead(
	asks: { ask(key: string, params: Sockets.Entries.SessionEntries.Params): Promise<Sockets.Entries.SessionEntries.Response> },
	prefix = `widget-entries:${Math.random().toString(36).slice(2)}`
): SessionEntriesRead {
	let asked = 0
	return (ask) => {
		const request = `${prefix}:${++asked}`
		return asks.ask(request, { ...ask, request })
	}
}

/** The reply's key: the token its ask carried; null for an untokened reply. */
export const sessionEntriesReplyKey = (reply: Sockets.Entries.SessionEntries.Response): string | null =>
	reply.request ?? null

const isCount = (v: unknown, min: number): v is number =>
	typeof v === "number" && Number.isInteger(v) && v >= min

function rowOf(r: Sockets.Entries.SessionEntries.Row): SessionEntryV1 {
	return {
		id: r.id,
		typeId: r.typeId,
		title: r.title,
		keys: [...(r.keys ?? [])],
		off: r.off === true,
		pinned: r.pinned === true,
		timesJudged: r.timesJudged,
		timesIncluded: r.timesIncluded,
		lastJudgedAt: r.lastJudgedAt ?? null,
		lastIncluded: r.lastIncluded ?? null,
		lastReason: r.lastReason ?? null,
		lastRank: r.lastRank ?? null
	}
}

/**
 * Answer one `session-entries` for the page's session `sessionId`. Rejects,
 * in words, with anything a widget could have got wrong, and with the
 * server's own refusal.
 */
export async function answerSessionEntries(
	params: unknown,
	sessionId: number | null,
	read: SessionEntriesRead
): Promise<Result> {
	const p = (params ?? {}) as Partial<Record<keyof Params | "query", unknown>>
	if (p.query !== undefined)
		throw new Error("session-entries searches with 'titleOrKey' — 'query' is not one of its words")
	if (p.titleOrKey !== undefined && typeof p.titleOrKey !== "string")
		throw new Error("session-entries takes 'titleOrKey' as text")
	if (p.sort !== undefined && !SORTS.has(p.sort as string))
		throw new Error("session-entries sorts by 'name', 'lastRead', 'timesRead' or 'rank'")
	if (p.filter !== undefined && !FILTERS.has(p.filter as string))
		throw new Error("session-entries filters by 'all', 'fired', 'pinned' or 'off'")
	if (
		p.typeIds !== undefined &&
		!(Array.isArray(p.typeIds) && p.typeIds.every((t) => typeof t === "string" && t.length > 0))
	)
		throw new Error("session-entries takes 'typeIds' as a list of entry type ids")
	if (p.offset !== undefined && !isCount(p.offset, 0))
		throw new Error("session-entries takes an offset of 0 or more")
	if (p.limit !== undefined && !isCount(p.limit, 1))
		throw new Error("session-entries takes a limit of 1 or more")
	if (sessionId == null) throw new Error("this page has no session to read the lore of")

	const titleOrKey = typeof p.titleOrKey === "string" ? p.titleOrKey.trim() : ""
	const offset = (p.offset as number | undefined) ?? 0
	const res = await read({
		sessionId,
		...(titleOrKey ? { query: titleOrKey } : {}),
		...(p.sort !== undefined ? { sort: p.sort as Params["sort"] } : {}),
		...(p.filter !== undefined ? { filter: p.filter as Params["filter"] } : {}),
		...(Array.isArray(p.typeIds) && p.typeIds.length ? { typeIds: [...(p.typeIds as string[])] } : {}),
		offset,
		...(p.limit !== undefined ? { limit: p.limit as number } : {})
	})
	if (res.error) throw new Error(res.error)
	return {
		lorebookId: res.lorebookId ?? null,
		...(typeof res.bookName === "string" ? { bookName: res.bookName } : {}),
		ownerOnly: res.ownerOnly === true,
		rows: (res.rows ?? []).map(rowOf),
		total: res.total ?? 0,
		offset: typeof res.offset === "number" ? res.offset : offset
	}
}
