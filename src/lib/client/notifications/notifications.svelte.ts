/**
 * The signed-in user's notifications — one module-level instance, shared by
 * every reader: the Activity view's list, the rail's Activity dot, the phone
 * Views button, and the auto-read watcher (`autoRead.svelte.ts`).
 *
 * Connected once per shell: `Layout.svelte` and `AccessibleShell.svelte` each
 * call `notifications.connect()` at mount, so every signed-in tab declares the
 * family and hears `notifications:changed` wherever it is. Both events are
 * gated (`shared/sockets/interest.ts`); a tab that never connected is never
 * pushed to.
 *
 * Writes are fire-and-forget: the server answers `read` and `dismiss` by
 * pushing the fresh list to every tab of this user, so two tabs agree without
 * either one patching its copy.
 *
 * Local rows (M0 U3): a widget's `notify` with `sticky` is raised in the
 * browser (`raiseLocal`) — raising is never a socket verb. Such a row has a
 * NEGATIVE id, lives for this tab's visit (a reload loses it), and is merged
 * ahead of the server's rows in `open` / `cleared`, so every reader works
 * unchanged. `read` / `dismiss` handle ids < 0 here and send only ids > 0.
 */
import {
	declareInterest,
	requestWithInterest
} from "$lib/client/sockets/interest.svelte"
import { typedSocketOrNull } from "$lib/client/sockets/typedSocket"
import type {
	NotificationLevel,
	NotificationRow,
	NotificationVars
} from "$lib/shared/notifications/kinds"
import type { NotificationsListResponse } from "$lib/shared/sockets/notifications"

const RANK: Record<NotificationLevel, number> = { info: 0, attention: 1, error: 2 }

let nextLocalId = -1

class NotificationsStore {
	#server = $state<NotificationRow[]>([])
	#serverCleared = $state<NotificationRow[]>([])
	#local = $state<NotificationRow[]>([])
	/** Open rows, newest raise first (local rows ahead of the server's). */
	open = $derived([...this.#local.filter((r) => !r.clearedAt), ...this.#server])
	/** Recently cleared rows, newest first (the Activity view's Earlier). */
	cleared = $derived([
		...this.#local.filter((r) => r.clearedAt),
		...this.#serverCleared
	])
	/** True once the first list has arrived. */
	loaded = $state(false)

	/** Open rows this user has not seen yet. */
	unread = $derived(this.open.filter((r) => !r.readAt))
	/**
	 * The worst level among UNREAD open rows — what the rail's Activity dot
	 * and the phone Views dot show. `null` when nothing is unread.
	 */
	worst = $derived<NotificationLevel | null>(
		this.unread.reduce<NotificationLevel | null>(
			(w, r) => (!w || RANK[r.level] > RANK[w] ? r.level : w),
			null
		)
	)

	#consumers = 0
	#releaseChanged: (() => void) | null = null
	#releaseList: (() => void) | null = null

	#apply = (data: NotificationsListResponse) => {
		if (!data) return
		this.#server = data.open ?? []
		this.#serverCleared = data.cleared ?? []
		this.loaded = true
	}

	/**
	 * Register a shell. Call from `onMount` and return the result. The first
	 * consumer declares the family and asks for the list.
	 */
	connect(): () => void {
		if (this.#consumers++ === 0) {
			this.#releaseChanged = declareInterest<"notifications:changed">(
				"notifications:changed",
				this.#apply
			)
			this.refresh()
		}
		let done = false
		return () => {
			if (done) return
			done = true
			if (--this.#consumers > 0) return
			this.#consumers = 0
			this.#releaseChanged?.()
			this.#releaseList?.()
			this.#releaseChanged = this.#releaseList = null
		}
	}

	/**
	 * Ask for the list again. The shell calls this on every (re)connect: a
	 * reconnect missed whatever was pushed while the socket was down.
	 */
	refresh(): void {
		if (this.#consumers === 0) return
		this.#releaseList?.()
		this.#releaseList = requestWithInterest<"notifications:list">(
			"notifications:list",
			{},
			this.#apply
		)
	}

	/**
	 * Raise a row in this browser only (a widget's sticky notice). An open
	 * local row with the same `regarding` is replaced by a bumped copy.
	 */
	raiseLocal(input: {
		kind: string
		regarding: string
		level: NotificationLevel
		href: string
		vars: NotificationVars
	}): void {
		const now = new Date().toISOString()
		const prior = this.#local.find(
			(r) => r.regarding === input.regarding && !r.clearedAt
		)
		if (prior) {
			this.#local = this.#local.map((r) =>
				r === prior
					? { ...r, ...input, lastRaisedAt: now, readAt: null }
					: r
			)
			return
		}
		const row: NotificationRow = {
			id: nextLocalId--,
			...input,
			raisedAt: now,
			lastRaisedAt: now,
			readAt: null,
			clearedAt: null,
			clearedHow: null
		}
		this.#local = [row, ...this.#local]
	}

	/** Mark rows read (a `view`-clearing kind is cleared as viewed). */
	read(ids: number[]): void {
		const local = ids.filter((id) => id < 0)
		if (local.length) {
			const now = new Date().toISOString()
			this.#local = this.#local.map((r) =>
				local.includes(r.id) && !r.readAt ? { ...r, readAt: now } : r
			)
		}
		const wanted = ids.filter(
			(id) => id > 0 && this.open.some((r) => r.id === id && !r.readAt)
		)
		if (!wanted.length) return
		typedSocketOrNull()?.emit("notifications:read", { ids: wanted })
	}

	/** Clear rows as dismissed. */
	dismiss(ids: number[]): void {
		const local = ids.filter((id) => id < 0)
		if (local.length) {
			const now = new Date().toISOString()
			this.#local = this.#local.map((r) =>
				local.includes(r.id) && !r.clearedAt
					? { ...r, clearedAt: now, clearedHow: "dismissed" as const }
					: r
			)
		}
		const remote = ids.filter((id) => id > 0)
		if (!remote.length) return
		typedSocketOrNull()?.emit("notifications:dismiss", { ids: remote })
	}
}

export const notifications = new NotificationsStore()
