/**
 * The copies one tab has asked for (`sessions:panelLayout:startFrom`) and has
 * no answer to yet, oldest first.
 *
 * A copy's answer names no ask. One that landed is sent to every tab of the
 * person, a refusal only to the tab that asked; so a tab settles its OLDEST
 * ask with each answer it hears for the session and ignores the answer when
 * it asked for nothing (another tab's copy). Two things ride an ask:
 *
 * - `settle(landed)`: what the open layout editor waits on, so a refused copy
 *   stops it waiting for a re-seed that is not coming.
 * - whether asking dropped a debounced blob save (the page cancels one so it
 *   cannot land after the copy and write the old layout back). When the copy is
 *   refused, the layout was never replaced, so that save is sent after all.
 */
export class LayoutCopyAsks {
	#asks: Array<{ droppedSave: boolean; settle: (landed: boolean) => void }> = []

	/** Record an ask; the promise resolves whether its copy landed. */
	ask(droppedSave: boolean): Promise<boolean> {
		return new Promise<boolean>((settle) =>
			this.#asks.push({ droppedSave, settle })
		)
	}

	/**
	 * An answer arrived: settle the oldest ask with it. `persist` runs when a
	 * refused ask had dropped a save. Returns `false` when this tab asked for
	 * nothing, which is how the page tells its own refusal (say it) from
	 * another tab's (stay quiet).
	 */
	settle(landed: boolean, persist: () => void): boolean {
		const asked = this.#asks.shift()
		if (!asked) return false
		if (!landed && asked.droppedSave) persist()
		asked.settle(landed)
		return true
	}

	/** Asks with no answer yet. */
	get pending(): number {
		return this.#asks.length
	}
}
