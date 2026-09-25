/**
 * The host's gate on what a remote may put in its box (§3.5, C2).
 *
 * Every mutation a worker sends passes through here before Remote DOM's
 * receiver sees it, and the receiver is ALSO given the vocabulary as its own
 * element policy — two layers, and the stricter one decides:
 *
 * - an element outside `SP_HOST_ELEMENTS` never lands: its whole subtree is
 *   replaced by an empty comment, so the remote's child INDICES stay the
 *   host's — Remote DOM addresses children by position, and a dropped node
 *   would shift every later insert and removal onto the wrong child;
 * - an attribute the element does not take, or a value the table's rules
 *   refuse (`hostAttributeValueFinding`: `href` https or #, `target`
 *   `_blank`/`_self`, `input type` a short list…), is dropped;
 * - PROPERTIES and METHOD calls are refused outright — a remote speaks in
 *   attributes and events only;
 * - ids are prefixed per box (`id`, `for`, `aria-*` references, a `#fragment`
 *   link, a control's `name`), so a remote can never name, label, jump to or
 *   join a group with an element of the page;
 * - a link gets `rel="noopener noreferrer"` from the host, always;
 * - an event listener is kept only for an event the element raises, and
 *   what crosses back is `RemoteEventDetail` — never the live event.
 */
import { DOMRemoteReceiver, type DOMRemoteElementPolicy } from "@remote-dom/core/receivers"
import {
	MUTATION_TYPE_INSERT_CHILD,
	MUTATION_TYPE_UPDATE_PROPERTY,
	UPDATE_PROPERTY_TYPE_ATTRIBUTE,
	UPDATE_PROPERTY_TYPE_EVENT_LISTENER,
	type RemoteConnection,
	type RemoteMutationRecord
} from "@remote-dom/core"
import {
	SP_HOST_ELEMENTS,
	hostAttributeAllowed,
	hostAttributeValueFinding,
	hostEventAllowed,
	isFnHandle,
	isHostElement,
	type FnHandle,
	type HostElementSpec,
	type RemoteEventDetail
} from "@serene-pub/sdk"

/** Attributes whose value names an element by id. */
const ID_REFS = new Set([
	"id",
	"for",
	"aria-labelledby",
	"aria-describedby",
	"aria-controls",
	"aria-activedescendant",
	"aria-owns",
	"aria-errormessage",
	"aria-details",
	"aria-flowto"
])

/**
 * The vocabulary as Remote DOM's element policy: which ELEMENTS, which
 * events, no methods. Attributes are the gate's above (`attributeValue`), not
 * listed here: a widget's `data-*` cannot be enumerated, and Remote DOM's
 * policy takes names only — so the receiver keeps its own floor (no `on*`, no
 * unsafe URL, no native method) and the gate decides the rest, properties
 * included (refused before they get here).
 */
export function receiverElementPolicy(): Record<string, DOMRemoteElementPolicy> {
	const out: Record<string, DOMRemoteElementPolicy> = {}
	for (const [tag, spec] of Object.entries(SP_HOST_ELEMENTS) as Array<[string, HostElementSpec]>)
		out[tag] = {
			events: Object.fromEntries(spec.events.map((e) => [e, {}])),
			methods: []
		}
	return out
}

interface SerializedNode {
	id: string
	type: number
	element?: string
	attributes?: Record<string, unknown>
	properties?: Record<string, unknown>
	eventListeners?: Record<string, unknown>
	children?: SerializedNode[]
	data?: string
}

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
	 * the caret from core's field.
	 */
	owner: string
}

/** A value for an id-referencing attribute, every token prefixed. */
const prefixIds = (value: string, prefix: string) =>
	value
		.split(/\s+/)
		.filter(Boolean)
		.map((t) => `${prefix}${t}`)
		.join(" ")

/** One attribute, judged; `undefined` means drop it. */
function attributeValue(tag: string, name: string, value: unknown, o: PolicyOptions): string | null | undefined {
	if (!hostAttributeAllowed(tag, name)) {
		o.warn(`<${tag}> takes no '${name}' — dropped`)
		return undefined
	}
	if (value === null || value === undefined) return null
	const text = String(value)
	const refused = hostAttributeValueFinding(tag, name, text)
	if (refused) {
		o.warn(`${refused} — dropped`)
		return undefined
	}
	// A control's `name` groups radios page-wide; an sp-icon's names an icon.
	if (ID_REFS.has(name) || (name === "name" && (tag === "input" || tag === "textarea")))
		return prefixIds(text, o.idPrefix)
	if (name === "href" && text.startsWith("#")) return `#${o.idPrefix}${text.slice(1)}`
	return text
}

/** An inert stand-in that keeps a refused node's position among its siblings. */
const placeholder = (node: SerializedNode): SerializedNode => ({ id: node.id, type: 8, data: "" })

/** A serialized subtree made safe; a refused element becomes a placeholder comment. */
export function sanitizeNode(node: SerializedNode, o: PolicyOptions): SerializedNode {
	if (node.type !== 1) return node // text and comments carry data only
	const tag = String(node.element ?? "").toLowerCase()
	if (!isHostElement(tag)) {
		o.warn(`<${tag}> is not in the host-element vocabulary — its subtree is dropped`)
		return placeholder(node)
	}
	if (tag === "sp-host-view" && o.owner !== "core") {
		o.warn(`<sp-host-view> is core's — a plugin's widget does not place the page's own views`)
		return placeholder(node)
	}
	const attributes: Record<string, string> = {}
	for (const [name, value] of Object.entries(node.attributes ?? {})) {
		const v = attributeValue(tag, name, value, o)
		if (typeof v === "string") attributes[name] = v
	}
	if (node.properties && Object.keys(node.properties).length)
		o.warn(`<${tag}> set properties (${Object.keys(node.properties).join(", ")}) — a remote speaks in attributes; dropped`)
	const eventListeners: Record<string, unknown> = {}
	for (const [event, handle] of Object.entries(node.eventListeners ?? {})) {
		if (!hostEventAllowed(tag, event) || !isFnHandle(handle)) continue
		eventListeners[event] = o.fnFor(handle, event)
	}
	if (tag === "a") attributes.rel = "noopener noreferrer"
	const children = (node.children ?? []).map((child) => sanitizeNode(child, o))
	return { id: node.id, type: 1, element: tag, attributes, eventListeners, children }
}

/**
 * A connection for the worker's records that enforces the above before the
 * receiver's own connection applies them. `tagOf` answers an attached
 * node's tag, for updates that arrive by id.
 */
export function guardedConnection(
	inner: RemoteConnection,
	tagOf: (id: string) => string | undefined,
	o: PolicyOptions
): RemoteConnection {
	return {
		call() {
			throw new Error("a remote calls no host methods")
		},
		mutate(records) {
			const safe: RemoteMutationRecord[] = []
			for (const r of records as unknown as unknown[][]) {
				if (r[0] === MUTATION_TYPE_INSERT_CHILD) {
					safe.push([r[0], r[1], sanitizeNode(r[2] as SerializedNode, o), r[3]] as never)
				} else if (r[0] === MUTATION_TYPE_UPDATE_PROPERTY) {
					const [, id, name, value, type] = r as [number, string, string, unknown, number | undefined]
					const tag = tagOf(id)
					if (!tag) continue
					if (type === UPDATE_PROPERTY_TYPE_ATTRIBUTE) {
						const v = attributeValue(tag, name, value, o)
						if (v !== undefined) safe.push([r[0], id, name, v, type] as never)
					} else if (type === UPDATE_PROPERTY_TYPE_EVENT_LISTENER) {
						if (!hostEventAllowed(tag, name)) continue
						safe.push([r[0], id, name, isFnHandle(value) ? o.fnFor(value, name) : null, type] as never)
					} else {
						o.warn(`<${tag}> set property '${name}' — a remote speaks in attributes; dropped`)
					}
				} else {
					safe.push(r as never)
				}
			}
			if (safe.length) inner.mutate(safe)
		}
	}
}

/** A receiver for one box, and the guarded connection the worker's records go through. */
export function createGuardedReceiver(box: Element, o: PolicyOptions) {
	const tags = new Map<string, string>()
	const receiver = new DOMRemoteReceiver({ root: box, elements: receiverElementPolicy() })
	const remember = (n: SerializedNode) => {
		if (n.type === 1 && n.element) tags.set(n.id, n.element)
		for (const c of n.children ?? []) remember(c)
	}
	const inner: RemoteConnection = {
		call: receiver.connection.call,
		mutate(records) {
			for (const r of records as unknown as unknown[][])
				if (r[0] === MUTATION_TYPE_INSERT_CHILD) remember(r[2] as SerializedNode)
			receiver.connection.mutate(records)
		}
	}
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
							auto.setSelectionRange?.(auto.value.length, auto.value.length)
						}
					}
		}
	})
	controls.observe(box, { subtree: true, childList: true, attributes: true, attributeFilter: ["value", "checked"] })
	return {
		receiver,
		connection: guardedConnection(inner, (id) => tags.get(id), o),
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
