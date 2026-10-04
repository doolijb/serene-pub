/**
 * The sp elements' custom-element machinery (§3.5, C1b).
 *
 * An sp element is an `sp-*` element the HOST renders with its own Svelte
 * component, so a remote component can place a popover, a menu or a
 * streaming message body and get the page's behaviour, theme and a11y
 * without importing any of it. The element is the contract
 * (`SP_HOST_ELEMENTS` in the SDK): its attributes are the props, its events
 * are what the component raises, its children fill named slots.
 *
 * ## How children reach the right place
 *
 * The component renders into an internal root the element owns. Children
 * someone else inserts — the receiver mirroring a remote, or Svelte on a
 * native page — are routed into the container the component registered for
 * the child's `slot` (`""` is the body). A child whose container is not
 * rendered yet (a closed popover's panel) waits in a hidden park, in order,
 * and moves in when the container appears; it moves back when the container
 * goes. Tags an sp element reads as DATA — a menu's `sp-menu-item`s — stay
 * in the park for good and reach the component through `props.items`.
 *
 * Three doors, one list. The element's own `appendChild` / `insertBefore` /
 * `removeChild` route synchronously (the receiver's path). A child that
 * arrives some other way — markup Svelte cloned into place, the parser, a
 * native `before()` next to a seated child — is taken in by an observer and
 * routed the same way. A child that leaves some other way (`.remove()`, a
 * move to another parent) is dropped from the list, so a slot re-registering
 * never pulls it back. The element keeps the children's logical order
 * itself (`childNodes`, `firstChild`, … answer from it), so a receiver that
 * inserts before a sibling it placed earlier finds that sibling wherever the
 * element put it.
 *
 * Light DOM throughout: the page's theme and the widget-CSS scope reach an
 * sp element's markup as they reach any widget's (R22, unstyled-but-correct);
 * a portalled panel carries its box's scope with it (`portalScope`).
 */

import { hostElementContext } from "./context.svelte"
import { mount, unmount, untrack, type Component } from "svelte"
import {
	SP_HOST_ELEMENTS,
	hostEventAllowed,
	type HostElementSpec
} from "@serene-pub/sdk"

/** One child element an sp element reads as data. */
export interface SpElementItem {
	tag: string
	attrs: Record<string, string | null>
	/** The child's text — a menu item's or a tab's label. */
	text: string
	el: HTMLElement
}

/** What every sp element component receives. */
export interface SpElementProps {
	/** The element's attributes, live; an absent attribute is `null`. */
	attrs: Record<string, string | null>
	/**
	 * How many times each attribute has been WRITTEN — read it beside `attrs`
	 * where a write is a command even when the value is unchanged (`value=""`
	 * resets a field the person typed into; `open` re-opens a closed popover).
	 */
	writes: Record<string, number>
	/** Raise one of the element's declared events; anything else is dropped. */
	emit: (event: string, detail?: unknown) => void
	/**
	 * An attachment that makes the node it is placed on the container for
	 * a slot (`""`, the default, is the body): `{@attach slot("trigger")}`.
	 */
	slot: (name?: string) => (el: HTMLElement) => () => void
	/** Child elements of the tags this element reads as data, in order. */
	items: SpElementItem[]
	/**
	 * An attachment that seats ONE data child in the node it is placed on —
	 * a menu row showing its `sp-menu-item`'s own content:
	 * `{@attach seatItem(item.el)}`. The child goes back to the park when the
	 * node goes.
	 */
	seatItem: (node: Node) => (container: HTMLElement) => () => void
	/** The element — for one that coordinates with its parent sp element. */
	host: HTMLElement
	/** Shared state other sp elements may read through the element (`spState`). */
	state: Record<string, unknown>
}

export interface SpElementDef {
	component: Component<SpElementProps>
	/** Child tags read as data and kept in the park (`sp-menu-item`). */
	dataChildren?: readonly string[]
	/** Initial shared state (`spState`) — a coordinating parent's. */
	state?: () => Record<string, unknown>
}

/** A boolean attribute is present-or-absent on the wire. */
export const flag = (v: string | null | undefined): boolean =>
	v !== null && v !== undefined && v !== "false"

/**
 * The attributes a portalled panel copies from its element's widget box so
 * it stays inside that box's widget-CSS scope and owner — a popover panel
 * lives under `<body>`, but a skin wrote `[data-skin-scope=…] .x`.
 */
export function portalScope(host: Element): Record<string, string> {
	const out: Record<string, string> = {}
	const scope = host
		.closest("[data-skin-scope]")
		?.getAttribute("data-skin-scope")
	if (scope) out["data-skin-scope"] = scope
	const owner = host.closest("[data-sp-owner]")?.getAttribute("data-sp-owner")
	if (owner) out["data-sp-owner"] = owner
	return out
}

/**
 * Keep a trigger's ARIA on the control a component slotted into it. Zag
 * puts `aria-expanded` / `aria-controls` / `aria-describedby` on the element
 * it renders — here a wrapper span around the remote's own button, which is
 * what takes focus and what a screen reader announces. Place it beside
 * `slot("trigger")`, with the attributes the wrapper was handed.
 */
export const mirrorTrigger =
	(aria: () => Record<string, unknown>) =>
	(box: HTMLElement): (() => void) => {
		const apply = () => {
			const control = box.firstElementChild
			if (!control) return
			for (const [k, v] of Object.entries(aria()))
				if (!k.startsWith("aria-")) continue
				// `false` is a value for ARIA (`aria-expanded="false"`), not an absence.
				else if (v === undefined || v === null)
					control.removeAttribute(k)
				else control.setAttribute(k, String(v))
		}
		apply()
		const mo = new MutationObserver(apply)
		mo.observe(box, { childList: true })
		return () => mo.disconnect()
	}

/**
 * On close, give focus back to the control a component slotted as the
 * trigger. Zag returns it to the element it rendered — here the wrapper span,
 * which cannot take focus — so without this a keyboard user lands on
 * `<body>`. Only when focus would otherwise be lost (on the body, or inside
 * the panel that is closing): a click elsewhere keeps its own focus.
 */
export function returnFocus(
	box: HTMLElement | null,
	panel?: Element | null
): void {
	queueMicrotask(() => {
		const active = document.activeElement
		const lost =
			!active ||
			active === document.body ||
			(!!panel && panel.contains(active))
		if (!lost) return
		;(box?.firstElementChild as HTMLElement | null)?.focus?.()
	})
}

/** A wrapper's attributes without its ARIA, which `mirrorTrigger` moves to the control. */
export const withoutAria = (
	attributes: Record<string, unknown>
): Record<string, unknown> =>
	Object.fromEntries(
		Object.entries(attributes).filter(([k]) => !k.startsWith("aria-"))
	)

const INTERNAL = Symbol("sp-element-internal")

/** Node's own `childNodes`, past this class's override. */
const nativeChildNodes = (n: Node): NodeListOf<ChildNode> =>
	Object.getOwnPropertyDescriptor(Node.prototype, "childNodes")!.get!.call(n)

type Internal = Node & { [INTERNAL]?: true }

/**
 * Build the element class for one sp element. Only called in a browser: a
 * class extending `HTMLElement` cannot be evaluated during SSR.
 */
export function makeSpElementClass(
	tag: string,
	def: SpElementDef
): CustomElementConstructor {
	const spec = (SP_HOST_ELEMENTS as Record<string, HostElementSpec>)[tag]
	if (!spec) throw new Error(`${tag} is not in the host-element vocabulary`)
	const dataTags = new Set(def.dataChildren ?? [])

	return class SpElement extends HTMLElement {
		static get observedAttributes() {
			return [...spec.attributes]
		}

		/** Reactive: the component reads these; attribute and child changes write them. */
		#view = $state<{
			attrs: Record<string, string | null>
			writes: Record<string, number>
			items: SpElementItem[]
		}>({ attrs: {}, writes: {}, items: [] })
		spState = $state<Record<string, unknown>>(def.state?.() ?? {})

		#logical: Node[] = []
		#slots = new Map<string, HTMLElement>()
		/** Data children seated one by one (`seatItem`), and where. */
		#seatedItems = new Map<Node, HTMLElement>()
		#root: HTMLElement | null = null
		#park: HTMLElement | null = null
		#app: Record<string, unknown> | null = null
		/** The park's data children, for `items`. */
		#dataObserver: MutationObserver | null = null
		/** Children arriving or leaving by any door but this element's own methods. */
		#doorWatch: MutationObserver | null = null

		constructor() {
			super()
			for (const a of spec.attributes) {
				this.#view.attrs[a] = null
				this.#view.writes[a] = 0
			}
			// The element's events are the ones it raises itself. A native
			// event of the same name bubbling out of its OWN markup (the
			// textarea's `input`) stops here, so a listener hears one event
			// with the declared detail, never both. Content in a slot is the
			// component's, not this element's: its events pass untouched.
			// Bubble phase, registered first: Svelte's delegated handlers on
			// the inner root have already run; a listener on this element
			// has not, and is exactly who must not hear it.
			for (const name of spec.events)
				this.addEventListener(name, (e) => {
					if (this.#isOwnMarkup(e.target as Node | null))
						e.stopImmediatePropagation()
				})
		}

		// ── lifecycle ────────────────────────────────────────────────────

		#mountQueued = false
		connectedCallback() {
			// Re-entered while building: seating children moves subtrees, and
			// an element moved reconnects — here, before `#app` is set.
			if (this.#app || this.#mountQueued || this.#building) return
			// Connected by Svelte building or moving the block it sits in: built
			// a microtask later, not now — a component mounted from inside that
			// effect attaches to it (it rendered twice in a keyed list, and
			// would be torn down with a block it does not belong to). Connected
			// by anyone else (a receiver, a test, the parser), built now.
			if (!$effect.tracking()) return this.#build()
			this.#mountQueued = true
			queueMicrotask(() => {
				this.#mountQueued = false
				if (this.isConnected && !this.#app) this.#build()
			})
		}

		#building = false
		#build() {
			this.#building = true
			try {
				this.#buildNow()
			} finally {
				this.#building = false
			}
		}

		#buildNow() {
			if (!this.classList.contains(tag)) this.#addHook()
			// Children already here — cloned markup, the parser — are the
			// list's before anything is built.
			this.#takeDirect()
			// Made once and kept: an element that is moved reconnects into them.
			if (!this.#park) {
				this.#park = this.#internal("div")
				this.#park.hidden = true
				this.#park.dataset.spPark = ""
			}
			if (!this.#root) {
				this.#root = this.#internal("div")
				this.#root.style.display = "contents"
			}
			this.#write(() => {
				for (const a of spec.attributes) {
					const v = this.getAttribute(a)
					if (this.#view.attrs[a] !== v) this.#view.attrs[a] = v
				}
			})
			const view = this.#view
			const self = this
			this.#app = mount(def.component, {
				target: this.#root,
				// The page's contexts, when it supplied them: a host view draws
				// page components that read them.
				context: hostElementContext.context,
				props: {
					get attrs() {
						return view.attrs
					},
					get writes() {
						return view.writes
					},
					get items() {
						return view.items
					},
					emit: (event: string, detail?: unknown) => {
						// Bubbles, so a native page's `onchange` on the element
						// (a delegated handler) hears it.
						if (hostEventAllowed(tag, event))
							self.dispatchEvent(
								new CustomEvent(event, {
									detail,
									bubbles: true
								})
							)
					},
					slot:
						(name = "") =>
						(el: HTMLElement) =>
							self.#claim(name, el),
					seatItem: (node: Node) => (el: HTMLElement) =>
						self.#seatItemIn(node, el),
					host: this,
					state: this.spState
				}
			})
			// Whatever no container claimed waits in the park.
			for (const n of this.#logical) if (!this.#isSeated(n)) this.#seat(n)
			this.#dataObserver = new MutationObserver(() => this.#readItems())
			this.#dataObserver.observe(this.#park, {
				subtree: true,
				childList: true,
				attributes: true,
				characterData: true
			})
			this.#doorWatch = new MutationObserver((records) =>
				this.#reconcile(records)
			)
			this.#watch(this)
			this.#watch(this.#park)
			for (const c of this.#slots.values()) this.#watch(c)
			this.#readItems()
		}

		/**
		 * A write to the element's view, untracked: it can land inside whatever
		 * effect set the attribute (a widget's attachment), and one that read the
		 * counter it bumps would depend on its own write — a loop. Untracked,
		 * Svelte also lets it through while a block is being built or moved; the
		 * microtask retry is a safety net for a runtime that still refuses
		 * (`state_unsafe_mutation`), not a path this one takes.
		 */
		#write(fn: () => void) {
			try {
				untrack(fn)
			} catch (e) {
				if (
					String((e as Error)?.message ?? e).includes(
						"state_unsafe_mutation"
					)
				)
					queueMicrotask(fn)
				else throw e
			}
		}

		#addingHook = false
		/** Put the root hook `.sp-<name>` back on the element (R22). */
		#addHook() {
			this.#addingHook = true
			try {
				this.classList.add(tag)
			} finally {
				this.#addingHook = false
			}
		}

		disconnectedCallback() {
			// Deferred: a receiver MOVES an element by removing and re-inserting
			// it, and one torn down on the first half loses its state.
			queueMicrotask(() => {
				if (this.isConnected || !this.#app) return
				this.#dataObserver?.disconnect()
				this.#doorWatch?.disconnect()
				this.#dataObserver = this.#doorWatch = null
				// Children go back to the park so a later connect finds them.
				for (const n of this.#logical)
					if (n.parentNode !== this.#park) this.#park?.appendChild(n)
				unmount(this.#app)
				this.#app = null
				this.#slots.clear()
				this.#seatedItems.clear()
			})
		}

		attributeChangedCallback(
			name: string,
			_old: string | null,
			value: string | null
		) {
			// The host re-adding its own root hook (`#addHook`) is not a write
			// of the component's: nothing to tell. Every other write counts,
			// the same value included — a write is a command.
			if (!(name === "class" && this.#addingHook))
				this.#write(() => {
					this.#view.attrs[name] = value
					this.#view.writes[name] = (this.#view.writes[name] ?? 0) + 1
				})
			// A written `class` replaces the list; the root hook a skin
			// targets (`.sp-<name>`, R22) is the host's and stays.
			// `classList.add` rewrites the attribute even when the token is
			// already there, which would call this again — hence the check.
			if (
				name === "class" &&
				this.isConnected &&
				!this.classList.contains(tag)
			)
				this.#addHook()
		}

		// ── the logical child list ───────────────────────────────────────

		/**
		 * The list is read NOW, so whatever another door did is taken in first:
		 * Remote DOM's receiver removes with `child.remove()` and then indexes
		 * into `childNodes` for its next record, in the same task.
		 */
		#flush() {
			if (this.#doorWatch) this.#reconcile(this.#doorWatch.takeRecords())
		}
		override get childNodes(): NodeListOf<ChildNode> {
			this.#flush()
			return this.#logical as unknown as NodeListOf<ChildNode>
		}
		override get children(): HTMLCollection {
			this.#flush()
			return this.#logical.filter(
				(n) => n.nodeType === 1
			) as unknown as HTMLCollection
		}
		override get firstChild(): ChildNode | null {
			this.#flush()
			return (this.#logical[0] as ChildNode) ?? null
		}
		override get lastChild(): ChildNode | null {
			this.#flush()
			return (
				(this.#logical[this.#logical.length - 1] as ChildNode) ?? null
			)
		}
		override hasChildNodes(): boolean {
			return this.#logical.length > 0
		}

		override appendChild<T extends Node>(node: T): T {
			return this.#place(node, null)
		}
		override insertBefore<T extends Node>(node: T, ref: Node | null): T {
			return this.#place(node, ref)
		}
		override removeChild<T extends Node>(node: T): T {
			if ((node as Internal)[INTERNAL]) return super.removeChild(node)
			const at = this.#logical.indexOf(node)
			if (at === -1)
				throw new DOMException(
					"not a child of this element",
					"NotFoundError"
				)
			this.#logical.splice(at, 1)
			node.parentNode?.removeChild(node)
			this.#readItems()
			return node
		}
		override replaceChild<T extends Node>(node: Node, old: T): T {
			this.#place(node, old)
			return this.removeChild(old)
		}
		override append(...nodes: Array<Node | string>): void {
			for (const n of nodes)
				this.#place(
					typeof n === "string" ? document.createTextNode(n) : n,
					null
				)
		}
		override prepend(...nodes: Array<Node | string>): void {
			const first = this.#logical[0] ?? null
			for (const n of nodes)
				this.#place(
					typeof n === "string" ? document.createTextNode(n) : n,
					first
				)
		}
		override replaceChildren(...nodes: Array<Node | string>): void {
			for (const n of [...this.#logical]) this.removeChild(n)
			this.append(...nodes)
		}

		// ── routing ──────────────────────────────────────────────────────

		#internal(tagName: string): HTMLElement {
			const el = document.createElement(tagName) as HTMLElement & Internal
			el[INTERNAL] = true
			super.appendChild(el)
			return el
		}

		#watch(node: Node) {
			this.#doorWatch?.observe(node, { childList: true })
		}

		/** Is the node where this element put it — the park, a slot container, an item's row? */
		#isSeated(n: Node): boolean {
			const p = n.parentNode
			return (
				!!p &&
				(p === this.#park ||
					[...this.#slots.values()].includes(p as HTMLElement) ||
					this.#seatedItems.get(n) === p)
			)
		}

		/**
		 * Is `t` markup this element drew for itself — the icon's `svg`, a
		 * field's `textarea` — rather than a node the component placed? The
		 * component knows nothing of such a node, so an event starting there
		 * is re-delivered to one it does (`ComponentMount`).
		 */
		ownsMarkup(t: Node | null): boolean {
			return this.#isOwnMarkup(t)
		}

		/** Is an event target this element's OWN rendered markup (not a slotted child's)? */
		#isOwnMarkup(t: Node | null): boolean {
			if (!t || t === this || !this.contains(t)) return false
			if (this.#park?.contains(t)) return false
			for (const c of this.#slots.values())
				if (c.contains(t)) return false
			for (const c of this.#seatedItems.values())
				if (c.contains(t)) return false
			return true
		}

		#slotOf(node: Node): string | null {
			if (node.nodeType !== 1) return ""
			const el = node as Element
			if (dataTags.has(el.localName)) return null
			return el.getAttribute("slot") ?? ""
		}

		#place<T extends Node>(node: T, ref: Node | null): T {
			if ((node as Internal)[INTERNAL])
				return super.insertBefore(node, ref)
			// A fragment inserts its children, in order, and is left empty.
			if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
				for (const child of Array.from(node.childNodes))
					this.#place(child, ref)
				return node
			}
			// Moving within this element: out of the logical list first.
			const was = this.#logical.indexOf(node)
			if (was !== -1) this.#logical.splice(was, 1)
			let at = ref ? this.#logical.indexOf(ref) : -1
			// A reference another door put here a moment ago (Svelte inserts
			// one node natively, then the next before it through this method)
			// is still waiting in the observer's queue: take it in now.
			if (ref && at === -1 && this.#doorWatch) {
				this.#reconcile(this.#doorWatch.takeRecords())
				at = this.#logical.indexOf(ref)
			}
			// …or cloned markup not yet taken in because the element is not
			// connected (a `before()` on an anchor it holds lands here too).
			if (ref && at === -1 && ref.parentNode === this) {
				this.#takeDirect()
				at = this.#logical.indexOf(ref)
			}
			if (ref && at === -1)
				throw new DOMException(
					"the reference is not a child",
					"NotFoundError"
				)
			if (at === -1) this.#logical.push(node)
			else this.#logical.splice(at, 0, node)
			this.#seat(node)
			this.#readItems()
			return node
		}

		/** Put a node in its container, or the park — after its logical predecessor there. */
		#seat(node: Node) {
			const row = this.#seatedItems.get(node)
			if (row) {
				if (node.parentNode !== row) row.appendChild(node)
				return
			}
			const slot = this.#slotOf(node)
			const home = (slot !== null && this.#slots.get(slot)) || this.#park
			if (!home) return
			// The next logical sibling already in the same home keeps the order.
			const i = this.#logical.indexOf(node)
			const next =
				this.#logical.slice(i + 1).find((n) => n.parentNode === home) ??
				null
			home.insertBefore(node, next)
		}

		#seatItemIn(node: Node, el: HTMLElement): () => void {
			if (!this.#logical.includes(node)) return () => {}
			this.#seatedItems.set(node, el)
			this.#watch(el)
			// Its content is still data the component reads (`items`).
			this.#dataObserver?.observe(el, {
				subtree: true,
				childList: true,
				attributes: true,
				characterData: true
			})
			this.#seat(node)
			return () => {
				if (this.#seatedItems.get(node) !== el) return
				this.#seatedItems.delete(node)
				if (node.parentNode === el) this.#seat(node)
			}
		}

		#claim(name: string, el: HTMLElement): () => void {
			this.#slots.set(name, el)
			this.#watch(el)
			for (const n of this.#logical)
				if (this.#slotOf(n) === name) this.#seat(n)
			return () => {
				if (this.#slots.get(name) !== el) return
				this.#slots.delete(name)
				for (const n of this.#logical)
					if (n.parentNode === el) this.#seat(n)
			}
		}

		/**
		 * The doors this element does not own. A node that appeared inside
		 * one of the element's containers without passing `#place` is taken
		 * in after the logical sibling it landed beside, then SEATED — a
		 * Svelte block inserts beside its anchor, which may be in another
		 * slot's container than the node belongs in. Nodes that appeared
		 * straight under the element (the parser, cloned markup) are taken in
		 * in one sweep, in DOM order — seating one moves it, so positions
		 * read one at a time would reverse them. A logical node not
		 * seated anywhere of ours has left.
		 */
		#reconcile(records: MutationRecord[]) {
			let changed = false
			const landed: Node[] = []
			for (const r of records) {
				for (const n of Array.from(r.removedNodes)) {
					if ((n as Internal)[INTERNAL]) continue
					const at = this.#logical.indexOf(n)
					// Moved between our own containers is still ours.
					if (
						at !== -1 &&
						!this.#isSeated(n) &&
						n.parentNode !== this
					) {
						this.#logical.splice(at, 1)
						changed = true
					}
				}
				if (r.target === this) continue
				for (const n of Array.from(r.addedNodes)) {
					if ((n as Internal)[INTERNAL] || this.#logical.includes(n))
						continue
					if (n.parentNode !== r.target) continue
					// Before the next sibling we know: Svelte always inserts
					// BEFORE an anchor, and the node before it in this container
					// may be a slot's neighbour, not the list's.
					let next = n.nextSibling
					while (next && !this.#logical.includes(next))
						next = next.nextSibling
					if (next)
						this.#logical.splice(this.#logical.indexOf(next), 0, n)
					else {
						let prev = n.previousSibling
						while (prev && !this.#logical.includes(prev))
							prev = prev.previousSibling
						this.#logical.splice(
							prev
								? this.#logical.indexOf(prev) + 1
								: this.#logical.length,
							0,
							n
						)
					}
					landed.push(n)
					changed = true
				}
			}
			const arrived = this.#takeDirect()
			for (const n of [...landed, ...arrived]) this.#seat(n)
			if (changed || arrived.length) this.#readItems()
		}

		/** Native children straight under the element that the list lacks, taken in in DOM order. */
		#takeDirect(): Node[] {
			const arrived = Array.from(nativeChildNodes(this)).filter(
				(n) => !(n as Internal)[INTERNAL] && !this.#logical.includes(n)
			)
			for (const n of arrived) {
				// Before the next direct child the list already holds, else last.
				let next = n.nextSibling
				while (next && !this.#logical.includes(next))
					next = next.nextSibling
				const at = next ? this.#logical.indexOf(next) : -1
				if (at === -1) this.#logical.push(n)
				else this.#logical.splice(at, 0, n)
			}
			return arrived
		}

		#readItems() {
			if (!dataTags.size) return
			const items: SpElementItem[] = []
			for (const n of this.#logical) {
				if (n.nodeType !== 1 || !dataTags.has((n as Element).localName))
					continue
				const el = n as HTMLElement
				const attrs: Record<string, string | null> = {}
				for (const a of el.getAttributeNames())
					attrs[a] = el.getAttribute(a)
				items.push({
					tag: el.localName,
					attrs,
					text: (el.textContent ?? "").trim(),
					el
				})
			}
			// Only a real change re-renders: the component's own render is
			// under the same observer.
			const bare = (xs: SpElementItem[]) =>
				JSON.stringify(xs.map(({ el: _, ...i }) => i))
			if (bare(items) !== bare(this.#view.items)) this.#view.items = items
		}
	}
}
