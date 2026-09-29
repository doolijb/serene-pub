/**
 * Admin health — the `admin:overview` read, shared by everything that shows it.
 *
 * Three readers: the Overview page (the whole payload), the Admin sidebar
 * view (the Needs you card and a dot per section row), and the rail's Admin
 * item (one dot, `worst`). One module-level instance so the three agree and
 * one request serves them all.
 *
 * ## Why the registry functions and not the admin context
 *
 * `ADMIN_INTEREST_CONTEXT` exists only inside `/admin/**`, and two of the
 * readers (the sidebar view, the rail) live in the shell outside it. The
 * context's functions are these same module functions, so the protection is
 * unchanged: `admin:` is a restricted prefix, the registry refuses it for a
 * known non-admin and sends nothing, and the handler refuses regardless. On
 * top of that, `connect(false)` never asks at all — importing this module is
 * free for a non-admin.
 *
 * ## When it asks
 *
 * On the FIRST consumer's `connect` (not every one), and on an explicit
 * `refresh()`: the Overview page calls it each time it opens, and the Admin
 * view on every change of section and once a minute while it is open and
 * visible, so a fix clears its row without a visit to Overview.
 *
 * And when the server says so: while an admin consumer is connected this
 * holds interest in `admin:overviewStale`, the push sent at the moments a
 * Needs you item can appear or clear on its own (a tunnel failing, a daily
 * backup failing or recovering, a default's model sync failing or recovering,
 * a plugin update arriving or being reviewed). Without it the rail's dot is
 * only as fresh as the last visit to Admin. Replies are debounced: one burst
 * of pushes is one read.
 */
import {
	declareInterest,
	requestWithInterest
} from "$lib/client/sockets/interest.svelte"

/** How long a burst of `admin:overviewStale` pushes is gathered into one read. */
const STALE_DEBOUNCE_MS = 1000

type Overview = Sockets.Admin.Overview.Response
type AttentionItem = Sockets.Admin.Overview.AttentionItem
export type AdminHealthLevel = Sockets.Admin.Overview.AttentionLevel

const RANK: Record<AdminHealthLevel, number> = { attention: 1, error: 2 }

function worstOf(items: readonly AttentionItem[]): AdminHealthLevel | null {
	let worst: AdminHealthLevel | null = null
	for (const a of items) if (!worst || RANK[a.level] > RANK[worst]) worst = a.level
	return worst
}

class AdminHealth {
	/** The last `admin:overview` reply; null until one arrives (and always, for a non-admin). */
	overview = $state<Overview | null>(null)
	/** True from a request until its reply. */
	loading = $state(false)

	/** The Needs you list, errors first. Empty until loaded. */
	attention = $derived<AttentionItem[]>(this.overview?.attention ?? [])
	/** The worst level across the whole list — the rail's one dot. */
	worst = $derived<AdminHealthLevel | null>(worstOf(this.attention))

	#consumers = 0
	#isAdmin = false
	#pending: (() => void) | null = null
	/** The `admin:overviewStale` interest, held while an admin consumer is connected. */
	#staleRelease: (() => void) | null = null
	#staleTimer: ReturnType<typeof setTimeout> | null = null
	/** One reference, so the registry sees one subscriber however often it is declared. */
	#onStale = () => {
		if (this.#staleTimer) clearTimeout(this.#staleTimer)
		this.#staleTimer = setTimeout(() => {
			this.#staleTimer = null
			this.refresh()
		}, STALE_DEBOUNCE_MS)
	}

	/** The worst level among items whose `section` is exactly `href`. */
	levelFor(href: string): AdminHealthLevel | null {
		return worstOf(this.attention.filter((a) => a.section === href))
	}

	/**
	 * Register a consumer. Call from `onMount` and return its result, which
	 * disconnects. The first admin consumer triggers a read; a non-admin's
	 * does nothing.
	 */
	connect(isAdmin: boolean): () => void {
		this.#consumers++
		if (isAdmin) {
			const first = !this.#isAdmin || this.#consumers === 1
			this.#isAdmin = true
			if (first) this.refresh()
			this.#staleRelease ??= declareInterest<"admin:overviewStale">(
				"admin:overviewStale",
				this.#onStale
			)
		}
		let done = false
		return () => {
			if (done) return
			done = true
			this.#consumers = Math.max(0, this.#consumers - 1)
			if (this.#consumers === 0) {
				this.#pending?.()
				this.#pending = null
				this.loading = false
				this.#staleRelease?.()
				this.#staleRelease = null
				if (this.#staleTimer) clearTimeout(this.#staleTimer)
				this.#staleTimer = null
			}
		}
	}

	/** Ask again. A no-op until an admin consumer has connected. */
	refresh(): void {
		if (!this.#isAdmin) return
		// One request in flight at a time: a fresh one supersedes the last.
		// Each request has its OWN handler, because the registry dedupes by
		// function reference and a shared one would be released by whichever
		// reply landed first.
		this.#pending?.()
		this.loading = true
		let release: (() => void) | null = null
		const onReply = (data: Overview) => {
			this.overview = data
			this.loading = false
			release?.()
			if (this.#pending === release) this.#pending = null
		}
		release = requestWithInterest("admin:overview", {}, onReply)
		this.#pending = release
	}
}

export const adminHealth = new AdminHealth()
