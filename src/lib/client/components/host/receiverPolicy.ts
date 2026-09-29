/**
 * The host's gate on what a remote may put in its box (§3.5, C2).
 *
 * Every mutation a worker sends passes through the SDK's guarded connection
 * (`guardedConnection`, which the component harness runs too) before Remote
 * DOM's receiver sees it, and the receiver is ALSO given the vocabulary as
 * its own element policy — two layers, and the stricter one decides:
 *
 * - an element outside `SP_HOST_ELEMENTS` never lands: its whole subtree is
 *   replaced by an empty comment, so the remote's child INDICES stay the
 *   host's — Remote DOM addresses children by position, and a dropped node
 *   would shift every later insert and removal onto the wrong child. What
 *   the remote later writes INTO that subtree (a text change, an insert, a
 *   removal) is dropped with it, never handed to a receiver that has no
 *   such node;
 * - an attribute the element does not take, or a value the rules refuse
 *   (the SDK's `receiverAttribute` — the table's `hostAttributeValueFinding`:
 *   `href` https or #, `target` `_blank`, `input type` a short list… — plus
 *   whose box it is), is dropped; a URL is judged trimmed and written as
 *   judged;
 * - an update is judged by the node the receiver would write it to — its tag
 *   read off the attached node, never off an insert the receiver may have
 *   refused — and a box whose records the receiver refused takes no more;
 * - PROPERTIES and METHOD calls are refused outright — a remote speaks in
 *   attributes and events only;
 * - ids are prefixed per box (`id`, `for`, `aria-*` references, a `#fragment`
 *   link, a control's `name`), so a remote can never name, label, jump to or
 *   join a group with an element of the page;
 * - a link gets `rel="noopener noreferrer"` from the host, always;
 * - an event listener is kept only for an event the element raises, and
 *   what crosses back is `RemoteEventDetail` — never the live event.
 *
 * What stays here is the page's: the receiver on the box, a control's live
 * value, core's `autofocus`, and the event summary.
 */
import { DOMRemoteReceiver } from "@remote-dom/core/receivers"
import {
	guardedConnection,
	receiverElementPolicy,
	receiverNodeOf,
	type FnHandle,
	type ReceiverRefusal,
	type RemoteEventDetail
} from "@serene-pub/sdk"

export interface PolicyOptions {
	/** Prefix for every id the remote writes — unique per box. */
	idPrefix: string
	/** Turns a function handle into the host function the receiver attaches. */
	fnFor: (handle: FnHandle, event: string) => (detail: unknown) => void
	/** Where a refusal is said. */
	warn: (message: string) => void
	/**
	 * Whose box this is — `core`, or a plugin's id. The page's own views
	 * (`sp-host-view`) and focus (`autofocus`) are core's to place: a
	 * plugin's widget could lay the page's controls under its own, or take
	 * the caret from core's field. Core's `<img>` may also show an envoy's
	 * face from another host or inline (the SDK's `receiverAttribute`).
	 * `core` only ever names core's own module (ComponentMount refuses the
	 * claim from anywhere else).
	 */
	owner: string
}

/** What a refusal took with it, as the page says it after the guard's sentence. */
const DROPPED: Record<ReceiverRefusal["dropped"], string> = {
	subtree: "its subtree is dropped",
	attribute: "dropped",
	property: "a remote speaks in attributes; dropped"
}

/** A receiver for one box, and the guarded connection the worker's records go through. */
export function createGuardedReceiver(box: Element, o: PolicyOptions) {
	const receiver = new DOMRemoteReceiver({ root: box, elements: receiverElementPolicy() })
	// The receiver's own id → node map, the one it applies records by (and
	// prunes as nodes leave): the guard judges by it, so what the guard
	// believes about a node can never differ from what the receiver would
	// write to.
	const nodeOf = receiverNodeOf(receiver)
	// A control's `value`/`checked` attribute is only its DEFAULT once the
	// person has typed, and a textarea has no such attribute at all; the
	// remote's write means the live value, so it is made the property too.
	const syncControl = (el: Element, name: string | null) => {
		if (!(el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement)) return
		if (name !== "checked") {
			const v = el.getAttribute("value")
			if (v !== null && el.value !== v) el.value = v
		}
		if (name !== "value" && el instanceof HTMLInputElement) el.checked = el.hasAttribute("checked")
	}
	const controls = new MutationObserver((records) => {
		for (const r of records) {
			if (r.type === "attributes") syncControl(r.target as Element, r.attributeName)
			else
				for (const n of r.addedNodes)
					if (n instanceof Element) {
						syncControl(n, null)
						n.querySelectorAll("input, textarea").forEach((c) => syncControl(c, null))
						// A field placed with `autofocus` takes focus as it lands, the
						// caret at its end (a remote cannot call `focus`).
						const auto =
							o.owner !== "core" ? null : n.matches("[autofocus]") ? n : n.querySelector("[autofocus]")
						if (auto instanceof HTMLTextAreaElement || auto instanceof HTMLInputElement) {
							auto.focus({ preventScroll: true })
							// Only a field with a caret has one to place: a number (or
							// date, email…) field throws InvalidStateError, which would
							// stop this batch's later records from syncing.
							if (auto.selectionStart !== null) auto.setSelectionRange(auto.value.length, auto.value.length)
						}
					}
		}
	})
	controls.observe(box, { subtree: true, childList: true, attributes: true, attributeFilter: ["value", "checked"] })
	return {
		receiver,
		connection: guardedConnection(receiver.connection, nodeOf, {
			owner: o.owner,
			idPrefix: o.idPrefix,
			fnFor: o.fnFor,
			refuse: (r) => o.warn(`${r.finding} — ${DROPPED[r.dropped]}`)
		}),
		dispose: () => controls.disconnect()
	}
}

/** The event summary a remote listener is called back with — chosen here, never the event. */
export function summarize(event: Event | undefined, type: string, detail: unknown): RemoteEventDetail {
	const out: RemoteEventDetail = { type }
	if (event instanceof CustomEvent) {
		try {
			out.detail = structuredClone(event.detail)
		} catch {
			/* not cloneable: no detail */
		}
		return out
	}
	const t = event?.target as HTMLInputElement | null
	if (t && (type === "input" || type === "change")) {
		if (typeof t.value === "string") out.value = t.value
		if (t.type === "checkbox" || t.type === "radio") out.checked = !!t.checked
	}
	void detail
	return out
}

/**
 * When a remote's box last had a person acting in it, after the host forwarded
 * `type` from it — what the invoke gate reads. A trusted event opens the
 * window; a synthetic one leaves it as it was; a `blur` closes it, as a
 * frame's closes when focus leaves it: a person leaving a field is not a
 * person acting here.
 */
export function interactionAfter(
	type: string,
	event: Event | undefined,
	previous: number | null,
	now: number
): number | null {
	if (type === "blur") return null
	return event?.isTrusted ? now : previous
}
