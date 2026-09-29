/**
 * **Auto-read** — a notification whose href is already on screen has been
 * seen, so it is marked read without a click (plan of record
 * `PLAN-notifications-2026-09-28.md` §4).
 *
 * The decision is pure and lives in `$lib/shared/notifications/covers.ts`
 * (`idsToRead`, `dwellStep`); this file only feeds it: the snapshot of what is
 * on screen, whether the tab is actually being looked at, and a clock.
 *
 * - Counts only while `document.visibilityState === "visible"` AND the
 *   document has focus. Both are held in `$state` and updated from their
 *   events: reading the DOM property inside an effect samples it once and
 *   never again.
 * - A row must stay covered for `AUTO_READ_DWELL_MS` before it is read, so
 *   flicking past a place does not count as seeing it. A row that ARRIVES
 *   while its place is on screen is read after the same dwell, so it never
 *   lights the Activity dot.
 * - Reported to the server as `notifications:viewing` (debounced, again on
 *   every reconnect, and `null` while hidden or unfocused), so a notification
 *   about a place already on screen is decided at raise time — not shipped,
 *   or shipped already read (`server/notifications/viewing.ts`). The dwell
 *   here is the fallback for rows that arrive some other way, and for places
 *   navigated to later.
 *
 * Started once, from `Layout.svelte`'s `onMount`.
 */
import { browser } from "$app/environment"
import { page } from "$app/state"
import { adminRouter } from "$lib/client/admin/adminRouter.svelte"
import { toHash } from "$lib/shared/lorebooks/loreRoute"
import { loreRoute } from "$lib/client/lorebooks/loreRoute.svelte"
import { helpRouter } from "$lib/client/shell/helpRouter.svelte"
import {
	dwellStep,
	idsToRead,
	type DwellState,
	type ViewingSnapshot
} from "$lib/shared/notifications/covers"
import { getSocket } from "$lib/client/sockets/socketInstance"
import { typedSocketOrNull } from "$lib/client/sockets/typedSocket"
import { untrack } from "svelte"
import { notifications } from "./notifications.svelte"

/** How long the screen must hold still before the server is told about it. */
const VIEWING_REPORT_DEBOUNCE_MS = 250

/** The two things only the shell knows: which view is on screen, and whether the page is. */
export interface ShellViewing {
	activeView: string | null
	/** False while a view in Focus or a phone's view sheet covers the page. */
	pageVisible: boolean
}

/** What is on screen, built from the routers the shell already keeps. */
export function viewingSnapshot(shell: ShellViewing): ViewingSnapshot {
	return {
		pathname: page.url.pathname,
		search: page.url.search,
		pageVisible: shell.pageVisible,
		activeView: shell.activeView,
		adminHref: adminRouter.href,
		helpSlug: helpRouter.slug,
		loreHash: toHash(loreRoute.route)
	}
}

/**
 * Start watching. `getShell` is read inside an effect, so it must read state
 * (the shell's `activeView`, `fullPageView`, `desktop.matches`). Returns the
 * stop function; call it from the same `onMount`'s cleanup.
 */
export function startAutoRead(getShell: () => ShellViewing): () => void {
	if (!browser) return () => {}

	let visible = $state(document.visibilityState === "visible")
	let focused = $state(document.hasFocus())

	const onVisibility = () => {
		visible = document.visibilityState === "visible"
	}
	// Re-sampled a tick later rather than set to false: focus moving into a
	// widget's iframe blurs the window while the person is still looking at
	// this page, and `hasFocus()` answers for the frame once focus has moved.
	let blurTimer: ReturnType<typeof setTimeout> | null = null
	const resampleFocus = () => {
		if (blurTimer) clearTimeout(blurTimer)
		blurTimer = setTimeout(() => {
			blurTimer = null
			focused = document.hasFocus()
		}, 0)
	}
	const onFocus = () => {
		focused = true
	}
	document.addEventListener("visibilitychange", onVisibility)
	window.addEventListener("focus", onFocus)
	window.addEventListener("blur", resampleFocus)

	const covered = (): number[] =>
		visible && focused
			? idsToRead(notifications.open, viewingSnapshot(getShell()))
			: []

	// What the server is told: the snapshot while this tab is being looked
	// at, null otherwise. Sent only when it changes, except on a reconnect —
	// the snapshot lives on the server's socket, and that socket is new.
	const viewingNow = (): ViewingSnapshot | null =>
		visible && focused ? viewingSnapshot(getShell()) : null
	let lastReported: string | undefined
	let reportTimer: ReturnType<typeof setTimeout> | null = null
	const report = (viewing: ViewingSnapshot | null, force = false) => {
		const key = JSON.stringify(viewing)
		if (!force && key === lastReported) return
		const socket = typedSocketOrNull()
		if (!socket) return
		socket.emit("notifications:viewing", { viewing })
		lastReported = key
	}
	const onReconnect = () => report(viewingNow(), true)
	const manager = getSocket()?.io
	manager?.on("reconnect", onReconnect)

	let dwell: DwellState = new Map()
	let timer: ReturnType<typeof setTimeout> | null = null

	const step = (ids: number[]) => {
		if (timer) clearTimeout(timer)
		timer = null
		const next = dwellStep(dwell, ids, Date.now())
		dwell = next.state
		if (next.due.length) notifications.read(next.due)
		if (next.nextAt !== null)
			timer = setTimeout(
				() => step(covered()),
				Math.max(0, next.nextAt - Date.now())
			)
	}

	const stopEffects = $effect.root(() => {
		$effect(() => {
			const ids = covered()
			untrack(() => step(ids))
		})
		$effect(() => {
			// Read here so the effect tracks it; the timer re-reads, so what
			// is sent is the screen as it is when the debounce settles.
			viewingNow()
			untrack(() => {
				if (reportTimer) clearTimeout(reportTimer)
				reportTimer = setTimeout(() => {
					reportTimer = null
					report(viewingNow())
				}, VIEWING_REPORT_DEBOUNCE_MS)
			})
		})
	})

	return () => {
		stopEffects()
		if (timer) clearTimeout(timer)
		if (blurTimer) clearTimeout(blurTimer)
		if (reportTimer) clearTimeout(reportTimer)
		timer = blurTimer = reportTimer = null
		manager?.off("reconnect", onReconnect)
		// A stopped shell watches nothing, so it reports nothing on screen.
		report(null)
		document.removeEventListener("visibilitychange", onVisibility)
		window.removeEventListener("focus", onFocus)
		window.removeEventListener("blur", resampleFocus)
	}
}
