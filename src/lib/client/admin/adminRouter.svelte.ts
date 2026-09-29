/**
 * The admin area's own router (ruled 2026-09-27: admin is purely the Admin
 * sidebar view and Focus, never a page).
 *
 * The Admin view is one view with many sections, each at an address under
 * `/admin`. This keeps that address as STATE — the section on screen — and
 * writes it to the address bar only while the view is in Focus, the one width
 * that owns an address (`viewRoutes.ts`). Docked, the view navigates between
 * sections without touching history, like every other view.
 *
 * The sections were SvelteKit pages until the ruling, and read the page
 * through `page` (`$app/state`), `goto`, `replaceState` and `beforeNavigate`.
 * `adminPage` and the `admin*` functions below have the same shapes, so a
 * section's code reads its params and moves between sections exactly as it
 * did, while the answers come from here instead of the kit's router.
 */

import { page as kitPage } from "$app/state"
import {
	goto as kitGoto,
	pushState,
	replaceState as kitReplaceState
} from "$app/navigation"
import { onMount } from "svelte"
import { SvelteSet } from "svelte/reactivity"
import { matchAdminRoute, resolveAdminAlias, type AdminMatch } from "./adminRoutes"

/** A guard like the kit's `beforeNavigate`: call `cancel()` to stay. */
export interface AdminNavigation {
	from: { url: URL }
	to: { url: URL }
	cancel: () => void
}

const ORIGIN = "http://admin.local"

function isAdminHref(href: string): boolean {
	return href === "/admin" || href.startsWith("/admin/") || href.startsWith("/admin?")
}

class AdminRouter {
	#path = $state("/admin")
	#search = $state("")
	#guards = new Set<(nav: AdminNavigation) => void>()
	/**
	 * Where on the section to land: an element id or a `data-field` name
	 * from an address's `#fragment`. The counter lets the same target be
	 * asked for twice. Never written to the address bar — it is a request
	 * to scroll, not a place.
	 */
	#land = $state<{ target: string; seq: number }>({ target: "", seq: 0 })
	/**
	 * The section on screen's unsaved edits, as probes (`adminUnsavedEdits`).
	 * A `SvelteSet` so `hasUnsavedEdits` follows a section mounting.
	 */
	#unsaved = new SvelteSet<() => boolean>()
	/** Set by AdminView, which hosts the dialog. Resolves true to discard. */
	#askDiscard: () => Promise<boolean> = async () => true
	/** Set by the shell: is the Admin view the view in Focus right now? */
	#isFocused: () => boolean = () => false

	constructor() {
		// Back and Forward between two admin entries: the kit restores the
		// entry's address before this fires, so the section follows it.
		if (typeof window !== "undefined") {
			window.addEventListener("popstate", () => {
				if (!isAdminHref(location.pathname)) return
				const href = location.pathname + location.search
				const leaving = this.href
				const nextPath = location.pathname.replace(/\/$/, "") || "/admin"
				if (nextPath === this.#path || !this.hasUnsavedEdits) {
					this.adopt(href)
					return
				}
				// Back/Forward to another section with edits on screen: ask
				// first, and put the address back if the person stays.
				void this.#askDiscard().then((discard) => {
					if (discard) return this.adopt(href)
					if (location.pathname + location.search === leaving) return
					const prev = kitPage.state as App.PageState
					pushState(leaving, {
						...prev,
						focus: "admin",
						depth: (prev.depth ?? 1) + 1
					})
				})
			})
		}
	}

	/** The section on screen: its route and params. */
	readonly match: AdminMatch = $derived(matchAdminRoute(this.#path))

	get path(): string {
		return this.#path
	}

	/** The latest landing request (see `#land`). */
	get land(): { target: string; seq: number } {
		return this.#land
	}

	#landOn(hash: string) {
		const target = decodeURIComponent(hash.replace(/^#/, ""))
		if (target) this.#land = { target, seq: this.#land.seq + 1 }
	}

	/** Path and query, the view's address when it is focused. */
	get href(): string {
		return this.#path + this.#search
	}

	get url(): URL {
		return new URL(this.href, ORIGIN)
	}

	/** The shell tells the router how to know whether Admin owns the address. */
	setFocusProbe(probe: () => boolean) {
		this.#isFocused = probe
	}

	/**
	 * Take the address as it stands, without writing history: a cold load of
	 * `/admin/...`, or Back/Forward between two admin entries.
	 */
	adopt(href: string) {
		const url = new URL(resolveAdminAlias(href), ORIGIN)
		this.#path = url.pathname.replace(/\/$/, "") || "/admin"
		this.#search = url.search
		this.#landOn(url.hash)
	}

	/** Does the section on screen hold edits nobody saved? */
	get hasUnsavedEdits(): boolean {
		for (const probe of this.#unsaved) if (probe()) return true
		return false
	}

	/** A section registers its dirty probe; the return unregisters it. */
	addUnsavedEdits(probe: () => boolean): () => void {
		this.#unsaved.add(probe)
		return () => this.#unsaved.delete(probe)
	}

	/** AdminView hosts the dialog, and hands the router the way to ask. */
	setDiscardPrompt(ask: () => Promise<boolean>) {
		this.#askDiscard = ask
	}

	/**
	 * The one question before the section's edits are lost: true when there
	 * is nothing to lose or the person chose to discard.
	 */
	async confirmDiscard(): Promise<boolean> {
		if (!this.hasUnsavedEdits) return true
		return this.#askDiscard()
	}

	/**
	 * Move to a section. Resolves false when the person kept their unsaved
	 * edits, or a guard kept the current section.
	 */
	async go(href: string, opts: { replace?: boolean } = {}): Promise<boolean> {
		const target = new URL(resolveAdminAlias(href), new URL(this.href, ORIGIN))
		const nextHref = (target.pathname.replace(/\/$/, "") || "/admin") + target.search
		if (nextHref === this.href) {
			// Same section, maybe another field on it.
			this.#landOn(target.hash)
			return true
		}
		// Another section unmounts this one; a new query keeps it on screen.
		// Nothing is awaited when nothing is unsaved, so a clean move lands
		// in the same tick, as it always did.
		const nextPath = target.pathname.replace(/\/$/, "") || "/admin"
		if (
			nextPath !== this.#path &&
			this.hasUnsavedEdits &&
			!(await this.#askDiscard())
		)
			return false
		let cancelled = false
		const nav: AdminNavigation = {
			from: { url: this.url },
			to: { url: target },
			cancel: () => {
				cancelled = true
			}
		}
		for (const guard of this.#guards) guard(nav)
		if (cancelled) return false
		this.adopt(nextHref + target.hash)
		this.#writeAddress(opts.replace ?? false)
		return true
	}

	/** Change only the query (a section's filters), replacing the entry. */
	setQuery(search: string) {
		const s = search && !search.startsWith("?") ? `?${search}` : search
		if (s === this.#search) return
		this.#search = s
		this.#writeAddress(true)
	}

	addGuard(fn: (nav: AdminNavigation) => void): () => void {
		this.#guards.add(fn)
		return () => this.#guards.delete(fn)
	}

	/**
	 * While Admin is focused its address is in the bar; keep it there. The
	 * entry keeps the shell's Focus marker (`page.state.focus`), so a Back
	 * between two sections is a Back between two sections, never a step out
	 * of Focus.
	 */
	#writeAddress(replace: boolean) {
		if (typeof window === "undefined" || !this.#isFocused()) return
		if (location.pathname + location.search === this.href) return
		const prev = kitPage.state as App.PageState
		const state = {
			...prev,
			focus: "admin",
			depth: replace ? (prev.depth ?? 1) : (prev.depth ?? 1) + 1
		}
		;(replace ? kitReplaceState : pushState)(this.href, state)
	}
}

export const adminRouter = new AdminRouter()

/* ── the kit-shaped surface the sections read ──────────────────────────── */

/**
 * Stands in for `page` from `$app/state` inside an admin section: `params`,
 * `url` and `route.id` answer for the section on screen; `data` and `state`
 * are the kit's own.
 */
export const adminPage = {
	get params(): Record<string, string> {
		return adminRouter.match.params
	},
	get url(): URL {
		return adminRouter.url
	},
	get route(): { id: string } {
		return { id: adminRouter.match.pattern }
	},
	get data() {
		return kitPage.data
	},
	get state() {
		return kitPage.state
	}
}

/** Stands in for `goto`: an admin address moves the section; anything else leaves. */
export function adminGoto(
	href: string,
	opts: { replaceState?: boolean } = {}
): Promise<void> {
	if (isAdminHref(href) || href.startsWith("?")) {
		return adminRouter.go(href, { replace: opts.replaceState }).then(() => {})
	}
	return kitGoto(href, opts)
}

/**
 * Stands in for `replaceState`. The sections use it to keep their filters in
 * the query (`?genre=chat`); an admin address or a bare query is the
 * section's own, anything else passes through.
 */
export function adminReplaceState(url: string | URL, state: App.PageState) {
	const href = typeof url === "string" ? url : url.pathname + url.search
	if (href.startsWith("?")) return adminRouter.setQuery(href)
	if (isAdminHref(href)) {
		const u = new URL(href, ORIGIN)
		if (u.pathname.replace(/\/$/, "") === adminRouter.path)
			return adminRouter.setQuery(u.search)
		void adminRouter.go(href, { replace: true })
		return
	}
	kitReplaceState(url, state)
}

/**
 * A section's unsaved edits, told to the Admin view: moving to another
 * section, closing the view, or reloading the tab asks first while
 * `isDirty()` is true. Call during component initialisation.
 */
export function adminUnsavedEdits(isDirty: () => boolean) {
	onMount(() => adminRouter.addUnsavedEdits(isDirty))
}

/** Stands in for `beforeNavigate`: asked before the view moves to another section. */
export function adminBeforeNavigate(fn: (nav: AdminNavigation) => void) {
	onMount(() => adminRouter.addGuard(fn))
}

/**
 * For the view's click handler: an in-view link to an admin address moves
 * the section instead of loading a page.
 */
export function interceptAdminLink(event: MouseEvent): void {
	if (event.defaultPrevented || event.button !== 0) return
	if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
	const a = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null
	if (!a || a.target === "_blank" || a.hasAttribute("download")) return
	const href = a.getAttribute("href") ?? ""
	if (!isAdminHref(href)) return
	event.preventDefault()
	void adminRouter.go(href)
}
