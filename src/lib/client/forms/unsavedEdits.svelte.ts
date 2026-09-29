/**
 * **Unsaved edits** — the one way a form knows it holds edits nobody saved.
 *
 * A form keeps its draft wherever it likes; `UnsavedEdits` is handed a
 * reader for it and keeps a **saved snapshot** (what the draft read when it
 * was last loaded or saved). `dirty` is DERIVED from the two, through
 * `sameFormValue`, so:
 *
 *   - it is right in the same tick as the keystroke (a dirty flag set by an
 *     `$effect` lags one, and a "typed anything" flag never clears);
 *   - changing a value and changing it back is clean again;
 *   - a draft that differs from the row only in key order, `""` vs `null`
 *     or `"5"` vs `5` is clean.
 *
 * Nothing is dirty until the first `markSaved()`: a form that has not loaded
 * its row yet has nothing to lose.
 *
 * ⚠ Not _draft_ (a session member's annex draft, a component draft) and not
 * _baseline_ (the squashed migration): the canon words are **unsaved edits**
 * and **saved snapshot**.
 */
import { sameFormValue, type SameFormValueOptions } from "./sameFormValue"

export class UnsavedEdits<T = unknown> {
	#read: () => T
	#options: SameFormValueOptions
	#saved = $state.raw<unknown>(undefined)
	#armed = $state(false)

	constructor(read: () => T, options: SameFormValueOptions = {}) {
		this.#read = read
		this.#options = options
	}

	/** The draft differs from the saved snapshot. */
	readonly dirty: boolean = $derived.by(() => {
		if (!this.#armed) return false
		return !sameFormValue(
			$state.snapshot(this.#read()),
			this.#saved,
			this.#options
		)
	})

	/**
	 * The draft as it reads now (or `value`) is what is saved: after a load,
	 * after a save, after Discard puts the saved values back.
	 */
	markSaved(value: T = this.#read()) {
		this.#saved = $state.snapshot(value)
		this.#armed = true
	}

	/**
	 * The server says the saved row is now `next` (a push, the echo of our own
	 * save, another tab's save), in the shape the reader returns. A clean
	 * form takes it: `apply(next)` writes the draft, and the snapshot is the
	 * draft as it then reads — as BUILT from the row, so a form that
	 * normalises what it loads (trims, splits, fills defaults) is not dirty
	 * the moment it opens. A dirty form keeps the person's edits and only
	 * moves the snapshot, so it stays dirty exactly as long as the edits
	 * differ from what is now saved — and an echo of the very values on
	 * screen makes it clean.
	 */
	adoptSaved(next: T, apply: (next: T) => void) {
		if (!this.dirty) {
			apply(next)
			this.markSaved()
			return
		}
		this.#saved = $state.snapshot(next)
	}

	/** Nothing to lose any more (the row was deleted, the form closed). */
	forget() {
		this.#armed = false
		this.#saved = undefined
	}
}

/**
 * Warn before the tab is closed or reloaded, only while `isDirty()` is true.
 * Call during component initialisation.
 */
export function warnBeforeUnload(isDirty: () => boolean) {
	$effect(() => {
		if (!isDirty()) return
		const onBeforeUnload = (e: BeforeUnloadEvent) => {
			e.preventDefault()
			// Older engines read the return value.
			e.returnValue = ""
		}
		window.addEventListener("beforeunload", onBeforeUnload)
		return () => window.removeEventListener("beforeunload", onBeforeUnload)
	})
}
