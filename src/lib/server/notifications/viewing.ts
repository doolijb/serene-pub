/**
 * **What each of a person's tabs is looking at** — so a notification about a
 * place already on screen is decided at raise time rather than shipped and
 * then auto-read (plan of record `PLAN-notifications-2026-09-28.md` §4).
 *
 * Every tab reports its `ViewingSnapshot` as `notifications:viewing` (null
 * while it is hidden or unfocused); the handler stores it ON THE SOCKET, so a
 * disconnect forgets it with nothing to clean up. `userIsViewing` walks the
 * user's room and asks the same pure `covers` the client's auto-read asks.
 *
 * `io` is installed from `connectSockets` and held on `globalThis`, like
 * `userPush`'s transport, so it survives a Vite SSR reload. Before any socket
 * has connected nobody is viewing anything.
 */
import {
	covers,
	type ViewingSnapshot
} from "$lib/shared/notifications/covers"
import { socketsInUserRoom, type InterestIo } from "$lib/server/sockets/interest"

/** The socket property the latest snapshot lives on. */
export const VIEWING_PROP = "notificationViewing"

/** Longest string a snapshot field may carry; longer is refused whole. */
export const VIEWING_STRING_CAP = 2048

const IO_KEY = Symbol.for("serene-pub.notificationViewingIo")

export function installViewingIo(io: InterestIo): void {
	;(globalThis as Record<symbol, unknown>)[IO_KEY] = io
}

function viewingIo(): InterestIo | undefined {
	return (globalThis as Record<symbol, unknown>)[IO_KEY] as
		| InterestIo
		| undefined
}

function str(v: unknown): v is string {
	return typeof v === "string" && v.length <= VIEWING_STRING_CAP
}

function strOrNull(v: unknown): v is string | null {
	return v === null || str(v)
}

/**
 * A client's report, checked field by field. Anything malformed is `null`
 * ("viewing nothing"), which only ever means a notification is shipped — the
 * safe way to be wrong.
 */
export function parseViewing(raw: unknown): ViewingSnapshot | null {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
	const r = raw as Record<string, unknown>
	if (
		!str(r.pathname) ||
		!str(r.search) ||
		typeof r.pageVisible !== "boolean" ||
		!strOrNull(r.activeView) ||
		!strOrNull(r.adminHref) ||
		!strOrNull(r.helpSlug) ||
		!strOrNull(r.loreHash)
	)
		return null
	return {
		pathname: r.pathname,
		search: r.search,
		pageVisible: r.pageVisible,
		activeView: r.activeView,
		adminHref: r.adminHref,
		helpSlug: r.helpSlug,
		loreHash: r.loreHash
	}
}

/** Is any connected, visible and focused tab of `userId` showing `href`? */
export function userIsViewing(
	userId: number,
	href: string,
	io: InterestIo | undefined = viewingIo()
): boolean {
	if (!io) return false
	for (const socket of socketsInUserRoom(io, userId)) {
		const viewing = (socket as unknown as Record<string, unknown>)[
			VIEWING_PROP
		] as ViewingSnapshot | null | undefined
		if (viewing && covers(viewing, href)) return true
	}
	return false
}
