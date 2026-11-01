/**
 * Per-user emitters and the progress throttle shared by every service run by
 * Serene Pub (KoboldCPP today, audio.cpp next).
 *
 * Extracted from three copies that had the same shape exactly:
 * `koboldcpp/binaryManager.ts` (binary download progress),
 * `koboldcpp/subprocessManager.ts` (subprocess status) and
 * `sockets/koboldcpp.ts` (model download progress).
 *
 * ## Why a `Map<userId, {emit, connections}>`
 *
 * Not a single nullable slot and not a `Set<emit>`. The old single-slot design
 * meant whichever admin socket most recently registered became the sole
 * recipient, silently cutting off every other connected admin. A Set fixes
 * that but overcorrects: registration happens once per *connection*, and
 * `emitToUser` already broadcasts to every open tab of a user — so N tabs of
 * one admin would mean N entries, each re-broadcasting to all N sockets (N²
 * transmissions per tick instead of N). Keying by user id with a connection
 * refcount collapses that back to one broadcast per user regardless of tab
 * count, and unregisters only once every one of their connections has gone.
 *
 * The slot keeps the FIRST connection's `emit` for the whole life of the
 * refcount. That is safe because the closures handed in resolve their
 * recipients at emit time from `io` and the user id, never from the socket
 * that made them: a second tab is served by the first tab's closure, and goes
 * on being served after the first tab disconnects.
 */

/** One user's emitter: a function that reaches every socket of that user. */
export type UserEmit<T> = (payload: T) => void

/** The backing slot for one user. Exported so a caller can keep the map on `globalThis`. */
export interface UserEmitterSlot<T> {
	/** The first registered connection's emitter. */
	emit: UserEmit<T>
	/** How many of this user's connections are registered. */
	connections: number
}

export interface UserEmitters<T> {
	/**
	 * Count one more connection for `userId`. The first registration's `fn`
	 * is kept; later ones only raise the refcount.
	 */
	register(userId: number, fn: UserEmit<T>): void
	/** Count one connection fewer; the slot is dropped when none remain. */
	unregister(userId: number): void
	/** Send `payload` to every registered user. A throwing emitter never stops the rest. */
	emit(payload: T): void
	/** Users with at least one registered connection. */
	readonly size: number
}

/**
 * Make a per-user refcounted emitter registry.
 *
 * @param backing an existing map to use as the store — pass one that lives on
 *   `globalThis` when the registry must survive Vite SSR HMR re-evaluation
 *   (the supervisor does). Defaults to a fresh map.
 */
export function createUserEmitters<T>(
	backing: Map<number, UserEmitterSlot<T>> = new Map()
): UserEmitters<T> {
	return {
		register(userId, fn) {
			const existing = backing.get(userId)
			if (existing) {
				existing.connections++
				return
			}
			backing.set(userId, { emit: fn, connections: 1 })
		},
		unregister(userId) {
			const existing = backing.get(userId)
			if (!existing) return
			existing.connections--
			if (existing.connections <= 0) backing.delete(userId)
		},
		emit(payload) {
			for (const { emit } of backing.values()) {
				try {
					emit(payload)
				} catch {}
			}
		},
		get size() {
			return backing.size
		}
	}
}

/**
 * Progress ticks arrive on every TCP chunk of a streaming download (hundreds
 * of thousands of times for a multi-GB file) — each broadcast is a synchronous
 * JSON-serialise + Socket.IO emit competing with the download's own network
 * I/O on Node's single event loop. Throttling the broadcast (never the byte
 * counter, which stays real-time for pull-based progress handlers) is the
 * single biggest win for download throughput.
 */
export const PROGRESS_EMIT_THROTTLE_MS = 250

export interface ProgressThrottle {
	/**
	 * True when `key`'s last accepted tick was at least the throttle interval
	 * ago (or there was none); records now as the last tick when it says yes.
	 * Gate only the per-chunk broadcast with this — state transitions
	 * (start / success / error) must emit directly so they are never dropped.
	 *
	 * @param key one download's key; omit for a single-flight download.
	 */
	ready(key?: string): boolean
	/** Forget `key`'s last tick (when its download leaves history). */
	forget(key?: string): void
}

const SINGLE_KEY = ""

/**
 * Make a keyed progress throttle. The clock is read at call time (never
 * captured), so fake timers in tests see the faked `Date`.
 */
export function createProgressThrottle(
	intervalMs: number = PROGRESS_EMIT_THROTTLE_MS
): ProgressThrottle {
	const lastAt = new Map<string, number>()
	return {
		ready(key = SINGLE_KEY) {
			const now = Date.now()
			if (now - (lastAt.get(key) ?? 0) < intervalMs) return false
			lastAt.set(key, now)
			return true
		},
		forget(key = SINGLE_KEY) {
			lastAt.delete(key)
		}
	}
}
