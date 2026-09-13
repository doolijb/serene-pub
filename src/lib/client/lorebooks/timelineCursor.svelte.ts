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
	#ticks = $state<TimelineTick[]>([])
	/** Which book the axis belongs to, so another book's cursor never shows. */
	#lorebookId = $state<number | null>(null)

	get position(): number | null {
		return this.#position
	}

	get ticks(): TimelineTick[] {
		return this.#ticks
	}

	/** The tick the cursor is on, or null at now. */
	get current(): TimelineTick | null {
		if (this.#position == null) return null
		let found: TimelineTick | null = null
		for (const tick of this.#ticks)
			if (tick.value <= this.#position) found = tick
		return found
	}

	setPosition(position: number | null): void {
		this.#position = position
	}

	/**
	 * The axis, rebuilt from the book's dated entries. Moving to another book
	 * returns the cursor to now, because a date in one story means nothing in
	 * another.
	 */
	setAxis(lorebookId: number | null, rows: readonly DatedRow[]): void {
		if (lorebookId !== this.#lorebookId) {
			this.#lorebookId = lorebookId
			this.#position = null
		}
		this.#ticks = buildTicks(rows)
		if (
			this.#position != null &&
			!this.#ticks.some((t) => t.value === this.#position)
		)
			this.#position = null
	}

	reset(): void {
		this.#position = null
	}
}

export const timelineCursor = new TimelineCursor()
