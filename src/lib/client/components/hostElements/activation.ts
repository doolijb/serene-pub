/**
 * A person behind a press, carried from a nested document to the component
 * around it — host-side only, never through the worker.
 *
 * A component's gate trusts only presses it saw (trusted events on its box);
 * a click inside an `sp-frame`'s document never reaches the box. So the
 * frame's own live check (`hasRecentActivation`) decides, and on success the
 * enclosing mount is told directly. A worker can raise the same `invoke`
 * event, but cannot reach this.
 */
const vouchers = new WeakMap<Element, () => void>()

/** A mount box says how to record "a person just pressed something in here". */
export function registerVoucher(box: Element, vouch: () => void): () => void {
	vouchers.set(box, vouch)
	return () => {
		if (vouchers.get(box) === vouch) vouchers.delete(box)
	}
}

/** Record a person's press for the mount box `el` sits in, if any. */
export function vouchFor(el: Element): void {
	const box = el.closest("[data-sp-owner]")
	if (box) vouchers.get(box)?.()
}
