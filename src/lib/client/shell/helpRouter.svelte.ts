/**
 * The Help view's page, and its address (ruled 2026-09-27: the `/docs` full
 * page is gone; the documentation is read in the Help view, docked or in
 * Focus).
 *
 * The page being read is STATE here rather than in the view, so the three
 * things that move it — a link inside an article, a Jump hit, and the address
 * bar — all move the same thing whether the view is mounted yet or not. The
 * address is `/docs` for the index and `/docs/<slug>` for a page, which is
 * what every compiled link already points at; it is written to the bar only
 * while Help is the view in Focus (`viewRoutes.ts`), exactly as Admin's is.
 */

import { page as kitPage } from "$app/state"
import { pushState, replaceState } from "$app/navigation"
import { isDocsPath } from "./jump.svelte"

const DOCS_ROOT = "/docs"

/** Per-browser memory of the page last read, so Help reopens on it. */
const LAST_PAGE_KEY = "sp:help:lastPage"

function readLastPage(): string | null {
	try {
		return localStorage.getItem(LAST_PAGE_KEY)
	} catch {
		return null
	}
}

function writeLastPage(slug: string | null) {
	try {
		if (slug) localStorage.setItem(LAST_PAGE_KEY, slug)
		else localStorage.removeItem(LAST_PAGE_KEY)
	} catch {
		// Private windows and blocked storage: Help simply opens on the index.
	}
}

/** The slug an address names, or null for the index. */
export function slugForPath(pathname: string): string | null {
	if (!isDocsPath(pathname)) return null
	const slug = pathname.slice(DOCS_ROOT.length + 1).replace(/\/+$/, "")
	return slug ? decodeURIComponent(slug) : null
}

class HelpRouter {
	#slug = $state<string | null>(null)
	/**
	 * Where on the page to land, spent by the view once the page is rendered.
	 * A counter rides along so asking for the same anchor twice lands twice.
	 */
	#anchor = $state<{ anchor: string; seq: number }>({ anchor: "", seq: 0 })
	#isFocused: () => boolean = () => false
	/** Whether anything has put a page here yet this visit. */
	#addressed = false

	constructor() {
		// Back and Forward between two pages read in Focus: the kit restores
		// the entry's address before this fires, so the page follows it.
		if (typeof window !== "undefined") {
			window.addEventListener("popstate", () => {
				if (isDocsPath(location.pathname))
					this.adopt(location.pathname + location.hash)
			})
		}
	}

	get slug(): string | null {
		return this.#slug
	}

	/**
	 * Open on the page last read, when nothing else — an address, a link, a
	 * jump — has said where to be. Called by the view as it mounts.
	 */
	resume(exists: (slug: string) => boolean) {
		if (this.#addressed) return
		this.#addressed = true
		const last = readLastPage()
		if (last && exists(last)) this.#slug = last
	}

	get anchor(): { anchor: string; seq: number } {
		return this.#anchor
	}

	/** The view's address when it is focused. */
	get href(): string {
		return this.#slug ? `${DOCS_ROOT}/${this.#slug}` : DOCS_ROOT
	}

	setFocusProbe(probe: () => boolean) {
		this.#isFocused = probe
	}

	/** Take an address as it stands, without writing history. */
	adopt(href: string) {
		const url = new URL(href, "http://help.local")
		this.#addressed = true
		this.#slug = slugForPath(url.pathname)
		writeLastPage(this.#slug)
		this.#land(decodeURIComponent(url.hash.slice(1)))
	}

	/** Show a page (null for the index), landing on `anchor` when given. */
	go(slug: string | null, anchor = "") {
		const moved = slug !== this.#slug
		this.#addressed = true
		this.#slug = slug
		writeLastPage(slug)
		this.#land(anchor)
		if (moved) this.#writeAddress()
	}

	#land(anchor: string) {
		this.#anchor = { anchor, seq: this.#anchor.seq + 1 }
	}

	/**
	 * While Help is focused its address is in the bar; each page read is its
	 * own entry, so Back steps back a page. The entry keeps the shell's Focus
	 * marker (`page.state.focus`), so that Back is never read as a step out
	 * of Focus.
	 */
	#writeAddress() {
		if (typeof window === "undefined" || !this.#isFocused()) return
		if (location.pathname === this.href) return
		const prev = kitPage.state as App.PageState
		const push = isDocsPath(location.pathname)
		const state = {
			...prev,
			focus: "help",
			depth: push ? (prev.depth ?? 1) + 1 : (prev.depth ?? 1)
		}
		;(push ? pushState : replaceState)(this.href, state)
	}
}

export const helpRouter = new HelpRouter()
