/**
 * Dragging one pool row onto another files it under it.
 *
 * The picker in the editor and this are the same write (`anchorEntryId`) from
 * two directions, which is why the refusal is shared: `canFileUnder` decides,
 * and a row that would make a ring never lights up as a target.
 *
 * ⚠ **The dragged key is held here, not on the event.** A `dragover` handler
 * may read `dataTransfer.types` and not the data behind them, so a target that
 * asked the event what it was holding could never refuse anything until the
 * drop had already happened.
 */

/** The one drag in flight, or none. */
let dragging: string | null = null

const MIME = "application/x-lore-row"

export interface RowDragOptions {
	/** The pool key of the row this is attached to. */
	key: string
	/**
	 * Whether this row can be picked up at all. A scene hangs off the history
	 * entry it was compiled into, which is not a thing a reader files
	 * elsewhere, so it offers no handle rather than refusing after the drop.
	 */
	draggable: boolean
	/** Whether the row being dragged may be filed under this one. */
	canDrop: (fromKey: string) => boolean
	/** File the dragged row under this one. */
	onDrop: (fromKey: string) => void
}

export function rowDrag(node: HTMLElement, options: RowDragOptions) {
	let opts = options

	const clear = () => {
		node.removeAttribute("data-drop-target")
	}

	const onDragStart = (event: DragEvent) => {
		if (!opts.draggable) return
		dragging = opts.key
		event.dataTransfer?.setData(MIME, opts.key)
		if (event.dataTransfer) event.dataTransfer.effectAllowed = "move"
	}

	const onDragEnd = () => {
		dragging = null
		clear()
	}

	const onDragOver = (event: DragEvent) => {
		if (!dragging || dragging === opts.key || !opts.canDrop(dragging))
			return
		// Preventing the default is what makes an element a drop target at all.
		event.preventDefault()
		if (event.dataTransfer) event.dataTransfer.dropEffect = "move"
		node.setAttribute("data-drop-target", "true")
	}

	const onDragLeave = () => clear()

	const onDrop = (event: DragEvent) => {
		const from = dragging ?? event.dataTransfer?.getData(MIME) ?? null
		clear()
		dragging = null
		if (!from || from === opts.key || !opts.canDrop(from)) return
		event.preventDefault()
		event.stopPropagation()
		opts.onDrop(from)
	}

	const setHandle = () => {
		if (opts.draggable) node.setAttribute("draggable", "true")
		else node.removeAttribute("draggable")
	}

	setHandle()
	node.addEventListener("dragstart", onDragStart)
	node.addEventListener("dragend", onDragEnd)
	node.addEventListener("dragover", onDragOver)
	node.addEventListener("dragleave", onDragLeave)
	node.addEventListener("drop", onDrop)

	return {
		update(next: RowDragOptions) {
			opts = next
			setHandle()
		},
		destroy() {
			node.removeEventListener("dragstart", onDragStart)
			node.removeEventListener("dragend", onDragEnd)
			node.removeEventListener("dragover", onDragOver)
			node.removeEventListener("dragleave", onDragLeave)
			node.removeEventListener("drop", onDrop)
		}
	}
}
