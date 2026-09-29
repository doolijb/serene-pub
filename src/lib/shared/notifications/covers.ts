/**
 * Does what the person is looking at **cover** a notification's `href`?
 *
 * Asked in two places (plan of record `PLAN-notifications-2026-09-28.md` §4):
 *
 * - the SERVER at raise time (`server/notifications/viewing.ts`), against the
 *   snapshot each tab reports as `notifications:viewing` — a notification
 *   about a place already on screen is not shipped (or arrives already read);
 * - the client's auto-read watcher (`client/notifications/autoRead.svelte.ts`),
 *   the fallback for rows that arrived another way: a row whose href is on
 *   screen for the dwell is marked read without a click.
 *
 * Pure and in `$lib/shared`, so both sides run one rule table, tested without
 * a shell.
 *
 * The hrefs are view addresses (NOMENCLATURE *href*), four shapes:
 *
 * - `/sessions/42`, `/sessions/42?message=910&block=knock` — a page. Seeing
 *   the session is seeing it; where it lands inside is a scroll, not a place.
 * - `/admin/data#backup-now` — an Admin section; the fragment is a landing
 *   request (`adminRouter.land`), not part of the address.
 * - `/docs/sessions#turn-order` — a Help page; same for the anchor.
 * - `/lorebooks#lore=12/history/340` — a lore address, on any path, compared
 *   as a `LoreRoute` (`sameRoute`), never as a string: two spellings of one
 *   route are one place.
 *
 * The lore address is parsed by `shared/lorebooks/loreRoute.ts` — one parser
 * for the lore address, not two.
 */
import { fromHash, sameRoute } from "$lib/shared/lorebooks/loreRoute"
import type { NotificationRow } from "$lib/shared/notifications/kinds"

/**
 * What the person is looking at, as plain data. The shell builds it from what
 * it already holds; nothing here reads the DOM.
 */
export interface ViewingSnapshot {
	/** `page.url.pathname` — the page under the views. */
	pathname: string
	/** `page.url.search`, with its `?` (or empty). */
	search: string
	/**
	 * Is the page itself on screen? False while a view is in Focus (it covers
	 * `<main>`) or while a phone's view sheet is over it.
	 */
	pageVisible: boolean
	/** The view on screen (`admin`, `help`, `lorebooks`, …), or null. */
	activeView: string | null
	/** `adminRouter.href`: the Admin view's section, path + query. */
	adminHref: string | null
	/** `helpRouter.slug`: the Help page open, null for the index. */
	helpSlug: string | null
	/** `toHash(loreRoute.route)`: `#lore=…`, or empty for the list of books. */
	loreHash: string | null
}

/** How long the covering state must hold before a row counts as seen. */
export const AUTO_READ_DWELL_MS = 1500

interface SplitHref {
	path: string
	search: string
	hash: string
}

function split(href: string): SplitHref {
	const hashAt = href.indexOf("#")
	const beforeHash = hashAt === -1 ? href : href.slice(0, hashAt)
	const hash = hashAt === -1 ? "" : href.slice(hashAt)
	const queryAt = beforeHash.indexOf("?")
	const path = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt)
	const search = queryAt === -1 ? "" : beforeHash.slice(queryAt)
	return { path: trimSlash(path), search, hash }
}

function trimSlash(path: string): string {
	return path.length > 1 ? path.replace(/\/+$/, "") : path
}

/** A query in one spelling: parameter order does not make a new place. */
function normalSearch(search: string): string {
	const params = new URLSearchParams(search)
	params.sort()
	const s = params.toString()
	return s ? `?${s}` : ""
}

const SESSION_PATH = /^\/sessions\/(\d+)$/
const DOCUMENT_VIEW_SESSION_PATH = /^\/document-view\/sessions\/(\d+)$/

function sessionIdOf(path: string): string | null {
	return (
		SESSION_PATH.exec(path)?.[1] ??
		DOCUMENT_VIEW_SESSION_PATH.exec(path)?.[1] ??
		null
	)
}

export function covers(viewing: ViewingSnapshot, href: string): boolean {
	if (!href.startsWith("/") || href.startsWith("//")) return false
	const target = split(href)

	// A lore address, on whatever path it rides.
	if (target.hash) {
		const route = fromHash(target.hash)
		if (route) {
			if (viewing.activeView !== "lorebooks") return false
			const current = viewing.loreHash ? fromHash(viewing.loreHash) : null
			return current !== null && sameRoute(current, route)
		}
	}

	if (target.path === "/admin" || target.path.startsWith("/admin/")) {
		if (viewing.activeView !== "admin" || !viewing.adminHref) return false
		const current = split(viewing.adminHref)
		return (
			current.path === target.path &&
			normalSearch(current.search) === normalSearch(target.search)
		)
	}

	if (target.path === "/docs" || target.path.startsWith("/docs/")) {
		if (viewing.activeView !== "help") return false
		const raw = target.path.slice("/docs".length).replace(/^\/+/, "")
		const slug = raw ? safeDecode(raw) : null
		return viewing.helpSlug === slug
	}

	const sessionId = sessionIdOf(target.path)
	if (sessionId !== null) {
		if (!viewing.pageVisible) return false
		return sessionIdOf(trimSlash(viewing.pathname)) === sessionId
	}

	return false
}

function safeDecode(s: string): string {
	try {
		return decodeURIComponent(s)
	} catch {
		return s
	}
}

/** The unread open rows the screen covers — what auto-read would mark. */
export function idsToRead(
	rows: readonly Pick<NotificationRow, "id" | "href" | "readAt" | "clearedAt">[],
	viewing: ViewingSnapshot
): number[] {
	return rows
		.filter((r) => !r.readAt && !r.clearedAt && covers(viewing, r.href))
		.map((r) => r.id)
}

/**
 * Per row: when it became covered (ms), or `"sent"` once its read went out.
 * A row absent from the map is not covered.
 */
export type DwellState = ReadonlyMap<number, number | "sent">

export interface DwellStep {
	state: Map<number, number | "sent">
	/** Rows whose dwell completed on this step: read them now. */
	due: number[]
	/** When the next row's dwell completes, or null when none is waiting. */
	nextAt: number | null
}

/**
 * One step of the dwell clock. `covered` is the rows covered right now (empty
 * while the tab is hidden or unfocused — that is what pauses the clock).
 *
 * - A row newly covered starts its dwell at `now`; a row that ARRIVES while
 *   already covered is just that, so it is read after the same dwell and
 *   never lights the dot.
 * - A row that stops being covered drops out, so coming back restarts it.
 * - A row whose read went out stays `"sent"` while it stays covered, so the
 *   read is emitted once — and if it never landed, leaving and coming back
 *   sends it again.
 */
export function dwellStep(
	prev: DwellState,
	covered: readonly number[],
	now: number,
	dwellMs: number = AUTO_READ_DWELL_MS
): DwellStep {
	const state = new Map<number, number | "sent">()
	const due: number[] = []
	let nextAt: number | null = null
	for (const id of covered) {
		if (state.has(id)) continue
		const since = prev.get(id) ?? now
		if (since === "sent") {
			state.set(id, "sent")
		} else if (now - since >= dwellMs) {
			state.set(id, "sent")
			due.push(id)
		} else {
			state.set(id, since)
			const at = since + dwellMs
			if (nextAt === null || at < nextAt) nextAt = at
		}
	}
	return { state, due, nextAt }
}
