import { untrack } from "svelte"
import type { DatedRow, TimelineTick } from "./timelineStrip"
import { buildTicks } from "./timelineStrip"

/**
 * "Viewing as of" — one cursor, read by every section.
 *
 * The strip stands under the workspace header and the pool is drawn three
 * components away, so the moment being read lives here rather than being
 * threaded through both. Held outside the route on purpose: dragging the
 * cursor is a way of looking, not an address, and writing a history entry to
 * the URL on every frame of a drag would bury the page the panel is open over.
 *
 * `null` is **now**, which stays the default: the strip is a way to look back,
 * not a mode that has to be dismissed.
 */
class TimelineCursor {
	#position = $state<number | null>(null)
	/**
	 * The moment's lossless address (`Y3-2-12`), beside the packed
	 * `#position`. The position is PLACEMENT — two dates can share one — so
	 * what the cursor stands on is named by the key.
	 */
	#key = $state<string | null>(null)
	#ticks = $state<TimelineTick[]>([])
	/** Which book the axis belongs to, so another book's cursor never shows. */
	#lorebookId = $state<number | null>(null)

	get position(): number | null {
		return this.#position
	}

	/** The moment the cursor stands on, as the route spells it; null at now. */
	get key(): string | null {
		return this.#key
	}

	get ticks(): TimelineTick[] {
		return this.#ticks
	}

	/** The tick the cursor is on, or null at now (or between ticks). */
	get current(): TimelineTick | null {
		if (this.#position == null) return null
		if (this.#key != null)
			return this.#ticks.find((t) => t.key === this.#key) ?? null
		let found: TimelineTick | null = null
		for (const tick of this.#ticks)
			if (tick.value <= this.#position) found = tick
		return found
	}

	/** A placement value, and the key it stands for when known. */
	setPosition(position: number | null, key: string | null = null): void {
		this.#position = position
		this.#key = position == null ? null : key
	}

	/** Stand on a tick (null = now). */
	setTick(tick: TimelineTick | null): void {
		this.#position = tick?.value ?? null
		this.#key = tick?.key ?? null
	}

	/**
	 * The axis, rebuilt from the book's dated entries. Moving to another book
	 * returns the cursor to now, because a date in one story means nothing in
	 * another.
	 */
	setAxis(lorebookId: number | null, rows: readonly DatedRow[]): void {
		// ⚠ **Every read of `#position` and `#lorebookId` here is untracked,
		// and that is load-bearing.** This runs inside an `$effect`, and a
		// tracked read would make that effect depend on state it also writes —
		// while a second effect writes `#position` from the route. The two then
		// chase each other: axis → position → axis → `effect_update_depth_
		// exceeded`, and the whole workspace stops responding.
		//
		// It stayed hidden for as long as it did because it needs an axis to
		// start: a book with no dated rows has no ticks, the route effect
		// leaves the position at null, and nothing is ever written. Amendment
		// dates joining the axis (2026-09-23) gave such a book one, and the
		// loop woke up. Writes are what this method is for; reads are not.
		untrack(() => {
			if (lorebookId !== this.#lorebookId) {
				this.#lorebookId = lorebookId
				this.#position = null
				this.#key = null
			}
			this.#ticks = buildTicks(rows)
			// Off every tick: back to now. The route effect re-applies an
			// address that still names a moment (it may sit between ticks).
			if (
				this.#position != null &&
				!this.#ticks.some((t) =>
					this.#key != null ? t.key === this.#key : t.value === this.#position
				)
			) {
				this.#position = null
				this.#key = null
			}
		})
	}

	reset(): void {
		this.#position = null
		this.#key = null
	}
}

export const timelineCursor = new TimelineCursor()
