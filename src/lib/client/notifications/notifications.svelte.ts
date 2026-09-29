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
 */
import {
	declareInterest,
	requestWithInterest
} from "$lib/client/sockets/interest.svelte"
import { typedSocketOrNull } from "$lib/client/sockets/typedSocket"
import type {
	NotificationLevel,
	NotificationRow
} from "$lib/shared/notifications/kinds"
import type { NotificationsListResponse } from "$lib/shared/sockets/notifications"

const RANK: Record<NotificationLevel, number> = { info: 0, attention: 1, error: 2 }

class NotificationsStore {
	/** Open rows, newest raise first. */
	open = $state<NotificationRow[]>([])
	/** Recently cleared rows, newest first (the Activity view's Earlier). */
	cleared = $state<NotificationRow[]>([])
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
		this.open = data.open ?? []
		this.cleared = data.cleared ?? []
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

	/** Mark rows read (a `view`-clearing kind is cleared as viewed). */
	read(ids: number[]): void {
		const wanted = ids.filter((id) =>
			this.open.some((r) => r.id === id && !r.readAt)
		)
		if (!wanted.length) return
		typedSocketOrNull()?.emit("notifications:read", { ids: wanted })
	}

	/** Clear rows as dismissed. */
	dismiss(ids: number[]): void {
		if (!ids.length) return
		typedSocketOrNull()?.emit("notifications:dismiss", { ids })
	}
}

export const notifications = new NotificationsStore()
