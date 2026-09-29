/**
 * 🚧 **Pending asks** — a widget request the page answers over a socket
 * event whose reply comes back on its own, with no acknowledgement to await:
 * `sessions:setSpriteSet`, `entries:sessionEntries`, `entries:setMarks`. Each
 * ask waits under a KEY its reply carries (a character id, an entry id, a
 * request token), and a reply settles the OLDEST ask waiting under its key —
 * one reply, one ask, never every ask that happens to be listening.
 *
 * Why one table rather than a listener per ask: two listeners for one event
 * both hear the first reply, so two asks for the same entry would both take
 * it. Here the reply is delivered once, to the table.
 *
 * The replies are user-wide (every tab of this person hears them), so a reply
 * nobody here asked for — another tab's, the native widget's — settles
 * nothing and `deliver` says so, letting the page keep its own handling (a
 * toast) for it.
 *
 * An ask never hangs: it rejects, in words, when no reply comes in time, and
 * `drop` rejects everything still waiting when the page goes.
 */

export interface PendingAsksOptions<P, R> {
	/** Send the ask. The page's typed socket flushes the interest sync first. */
	emit(params: P): void
	/**
	 * Hear the replies while any ask waits; returns the release. Absent when
	 * the page listens for the event anyway and calls `deliver` itself.
	 */
	listen?(onReply: (reply: R) => void): () => void
	/** The key a reply answers, or null for a reply that is nobody's here. */
	keyOf(reply: R): string | null
	/** Why an ask gave up waiting — a sentence the asking widget is shown. */
	timeout: string
	/** How long an ask waits for its reply. */
	timeoutMs?: number
}

export interface PendingAsks<P, R> {
	/** Send `params` and wait for the next reply under `key`. */
	ask(key: string, params: P): Promise<R>
	/** Hand a reply to the oldest ask waiting under its key; false when none was. */
	deliver(reply: R): boolean
	/** Reject every ask still waiting (the page is going), and stop listening. */
	drop(why: string): void
	/** How many asks wait. */
	readonly size: number
}

interface Waiting<R> {
	resolve(reply: R): void
	reject(error: Error): void
	timer: ReturnType<typeof setTimeout>
}

/** A table of asks waiting on their socket replies (see the header). */
export function createPendingAsks<P, R>(opts: PendingAsksOptions<P, R>): PendingAsks<P, R> {
	const byKey = new Map<string, Waiting<R>[]>()
	let size = 0
	let release: (() => void) | null = null

	const quiet = () => {
		if (size > 0 || !release) return
		const r = release
		release = null
		r()
	}

	/** Take one waiting ask out of the table. */
	function take(key: string, which: Waiting<R>): void {
		const queue = byKey.get(key)
		const at = queue?.indexOf(which) ?? -1
		if (!queue || at < 0) return
		queue.splice(at, 1)
		if (!queue.length) byKey.delete(key)
		size--
		clearTimeout(which.timer)
	}

	function deliver(reply: R): boolean {
		const key = opts.keyOf(reply)
		const oldest = key == null ? undefined : byKey.get(key)?.[0]
		if (key == null || !oldest) return false
		take(key, oldest)
		quiet()
		oldest.resolve(reply)
		return true
	}

	return {
		ask(key, params) {
			return new Promise<R>((resolve, reject) => {
				const waiting: Waiting<R> = {
					resolve,
					reject,
					timer: setTimeout(() => {
						take(key, waiting)
						quiet()
						reject(new Error(opts.timeout))
					}, opts.timeoutMs ?? 15_000)
				}
				const queue = byKey.get(key) ?? []
				queue.push(waiting)
				byKey.set(key, queue)
				size++
				// Listening BEFORE the ask goes out: the reply may not overtake it.
				if (!release && opts.listen) release = opts.listen(deliver)
				try {
					opts.emit(params)
				} catch (e) {
					take(key, waiting)
					quiet()
					reject(e instanceof Error ? e : new Error(String(e)))
				}
			})
		},
		deliver,
		drop(why) {
			const all = [...byKey.values()].flat()
			byKey.clear()
			size = 0
			for (const w of all) {
				clearTimeout(w.timer)
				w.reject(new Error(why))
			}
			quiet()
		},
		get size() {
			return size
		}
	}
}
