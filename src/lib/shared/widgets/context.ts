/**
 * The widget data contract (PLAN 25, ruled 2026-08-30) — ONE envelope every
 * session widget receives, native and frame alike. Native reads it via Svelte
 * context (live/reactive); a frame gets the same sections snapshotted over the
 * port. Field-for-field identical: reactivity is the native analog of a push.
 *
 * ## Two version clocks
 *
 *  - `protocol` versions the TRANSPORT — the verbs (`action`/`request`/`menu`/
 *    `on`) and the message kinds. Rev only when the wire itself changes.
 *  - Each DATA section is a bag of versioned shapes (`layout: { v1 }`, …). When
 *    a pre-existing key inside a section changes meaning, emit `v2` alongside
 *    `v1` for a transition window; old widgets read `.v1`, new ones read `.v2`.
 *    ADDITIVE keys go straight into the existing `v1` — no bump.
 *
 * ## Base vs scoped
 *
 * Base sections (layout/session/channels/messages/props/settings/actions)
 * are always present.
 * Scoped sections (persona/characters/lore/…) appear ONLY when the widget
 * declared the scope AND it was granted — the same deny-by-default a frame gets,
 * enforced here at projection so a native widget is no more privileged. Absence
 * means "not granted", never a silent empty.
 *
 * `projectWidgetData` is the transport-neutral core: it produces the sections
 * from a session + placement + grants, and is fed to BOTH deliveries.
 * `buildNativeContext` wraps that with the verbs for the in-document (native)
 * consumer; a frame host posts the same sections and implements the verbs over
 * the port.
 */
import { getContext } from "svelte"
import { formatChannel, parseChannel } from "@serene-pub/sdk"
import { actionIdentity, parseActionIdentity } from "$lib/shared/actions/identity"
import {
	dispatchAction,
	type CoreVerbHandlers,
	type InvokeArgs
} from "./invokeAction"
import type { WidgetScope, WidgetTier } from "./types"

export type Payload = Record<string, unknown>

/** A message as a widget sees it — opaque but for its lane. */
export interface SurfaceMessage {
	channel?: string
	[k: string]: unknown
}

// ─── Section shapes (v1) ──────────────────────────────────────────────────────

export interface LayoutV1 {
	/** Which zone in the page-level zone grid (identity + totals). */
	zone: { columns: number; column: number; rows: number; row: number }
	/** Where this widget sits within its zone. */
	box: {
		cols: number
		/** Height in cells, or null when the widget grows/is unbounded. */
		rows: number | null
		/** Which zone edges the widget touches. */
		edges: { top: boolean; right: boolean; bottom: boolean; left: boolean }
	}
	/** The width class of this widget's own box. */
	tier: WidgetTier
	/** Guaranteed-visible: placed in the grid, not collapsible/closable away. */
	pinned: boolean
	collapsed: boolean
	drawered: boolean
	/**
	 * Decoration the HOST is painting, so the widget suppresses its own and
	 * never double-draws (a widget renders its own backdrop only where false).
	 */
	chrome: {
		background: boolean
		wrapper: boolean
		titleBar: boolean
		padding: boolean
	}
}

export interface SessionV1 {
	id: number
	name: string | null
}

export type MessageV1 = SurfaceMessage

/**
 * One action as a venue lists it (plans/29 R-15; U5c) — the wire shape of
 * `sessions:actions`, transport-neutral here so a frame and a native widget
 * read the same rows. `specSlug` is `core` for one of core's message verbs.
 */
export interface WidgetAction {
	key: string
	function: string
	specSlug: string
	name: string
	description?: string
	icon?: string
	slash: string
	quick: boolean
	audience: { see: string[]; act: string[] }
	venue: string
	channel?: string
	origin: "core" | "companion" | "attachment"
	floor: boolean
	canAct: boolean
	itemGated: boolean
	isNew: boolean
}

/**
 * The session's actions per **venue**, each a primary set plus an overflow
 * that lists every enabled action (F38). Keyed by venue kind (`composer`,
 * `message`, `extra`, `widget`, …); a widget reads the venues it draws —
 * `widget` for its own controls, `message` when it renders a message's menu
 * — and invokes one through `invoke(key)`. Empty venues when the host has no
 * list yet.
 */
export type ActionsV1 = Record<
	string,
	{ primary: WidgetAction[]; overflow: WidgetAction[] }
>

/** The transport-neutral data half — the versioned sections. */
export interface WidgetData {
	// base — always present
	layout: { v1: LayoutV1 }
	session: { v1: SessionV1 }
	channels: { v1: string[] }
	messages: { v1: MessageV1[] }
	props: { v1: Payload }
	/** The action model's venues (R-15, U5c) — base, so a widget need not declare a scope to offer a control. */
	actions: { v1: ActionsV1 }
	/**
	 * This instance's effective settings (shared/widgets/settings.ts): every
	 * field the widget declares, defaults filled in, with the user's deviations
	 * over them. Complete by construction, so a widget reads a value rather than
	 * re-deriving its own defaults. Empty for a widget that declares none.
	 */
	settings: { v1: Payload }
	// scoped — present iff declared + granted
	persona?: { v1: unknown }
	characters?: { v1: unknown[] }
	lore?: { v1: unknown }
	session_full?: { v1: unknown }
}

// ─── Verbs (transport-specific; part of `protocol`) ───────────────────────────

export interface MenuSpec {
	at: { x: number; y: number }
	items: Array<{ id: string; label: string; icon?: string; disabled?: boolean }>
}
export interface MenuResult {
	id: string
}

export type WidgetEvent =
	| {
			kind: "message:created"
			/** The channel as stored — canonical, so lane 1 is the bare slug. */
			channel: string
			/** …taken apart, so a widget need not parse it (ruling 2026-09-09). */
			slug: string
			lane: number
			messageId: number
	  }
	| { kind: "message:updated"; messageId: number }
	| { kind: "message:deleted"; messageId: number }
	| { kind: "message:delta"; messageId: number; delta: string }
	| { kind: "generation:start"; messageId?: number }
	| { kind: "generation:end"; messageId?: number; aborted: boolean }
	| { kind: "channel:activated"; channel: string; slug: string; lane: number }
	| { kind: "selection:changed"; messageId: number | null }
	/**
	 * This widget's placement changed — it moved, resized, changed tier, or was
	 * collapsed/drawered. The new `layout.v1` rides along so a listener needs no
	 * second read; native consumers can equally just read `ctx.layout.v1`, which
	 * is already reactive. It exists for the frame lane, where a push is the
	 * only reactivity there is, and is emitted on both so the two stay
	 * field-for-field identical.
	 */
	| { kind: "layout:changed"; layout: LayoutV1 }
	| { kind: string; payload?: Payload }

export interface WidgetVerbs {
	/**
	 * Fire-and-observe; state returns via the pushed/reactive sections.
	 *
	 * `action` is the identity of the declaration being fired
	 * (`<spec slug>#<key>`, U5c review W1) when one is in hand — `invoke`
	 * always supplies it — so the server checks THAT action's audience and
	 * enablement and runs THAT spec. A bare call naming only a function is
	 * the legacy shape and gets the narrowest reading (owner floor, the
	 * companion spec).
	 */
	action(
		fn: string,
		messageId?: number,
		payload?: Payload,
		action?: string,
		/**
		 * The form the press answers — a block's id within `messageId`
		 * (R-15 *Forms*; U5d) — so the server reads the block off the row
		 * and holds the press to its addressee. Absent on every other press.
		 */
		blockId?: string
	): void
	/**
	 * Invoke an action from `actions.v1` by its **identity** (`<spec
	 * slug>#<key>`) or, when only one action carries it, its bare **key**
	 * (R-15 `invoke(id, args)`): the host resolves it to the declaration and
	 * routes it — one of core's verbs to the host's real handler (a
	 * `continue` is `sessionMessages:continue`, never a function fire), a
	 * contributed one through `action` with its identity, the same audited
	 * `sessions:triggerFunction` path a button takes. A key no venue lists,
	 * or a bare key several actions share, throws: a widget cannot fire
	 * something the session does not offer — or something ambiguous — and
	 * believe it did.
	 */
	invoke(key: string, args?: InvokeArgs): void
	/** Request/response; gated by declared scope. */
	request<T = unknown>(kind: string, params?: Payload): Promise<T>
	/** Host-rendered menu; resolves to the pick, or null if dismissed. */
	menu(spec: MenuSpec): Promise<MenuResult | null>
	/** Subscribe to a host event; returns an unsubscribe. */
	on(kind: WidgetEvent["kind"], cb: (e: WidgetEvent) => void): () => void
}

/** The full native envelope: identity + data sections + verbs. */
export interface WidgetContext extends WidgetData, WidgetVerbs {
	protocol: 1
	widget: { id: string; instanceId: string; title: string }
}

// ─── Projection ───────────────────────────────────────────────────────────────

/** The raw grid facts the layout engine measures; the factory only packages them. */
export interface PlacementInput {
	zone: { columns: number; column: number; rows: number; row: number }
	box: {
		cols: number
		rows: number | null
		edges: { top: boolean; right: boolean; bottom: boolean; left: boolean }
	}
	tier: WidgetTier
	pinned: boolean
	collapsed: boolean
	drawered: boolean
	/** Optional explicit chrome; when omitted it is derived from placement. */
	chrome?: Partial<LayoutV1["chrome"]>
}

export interface ProjectInput {
	session: { id: number; name?: string | null } & Record<string, unknown>
	channels: string[]
	messages: SurfaceMessage[]
	props?: Payload
	/** The widget's effective settings; defaulted+overridden by the host. */
	settings?: Payload
	/** The session's action venues (`sessions:actions`), as the host holds them. */
	actions?: ActionsV1
	placement: PlacementInput
	/** The effective granted scopes (declared − admin-denied). Default none. */
	grants?: WidgetScope[]
	/** Source data for scoped sections; projected only when granted. */
	scoped?: { persona?: unknown; characters?: unknown[]; lore?: unknown; sessionFull?: unknown }
}

/**
 * Host-provided chrome policy: the host owns the backdrop/card when a widget is
 * pinned into the grid or docked in the drawer; a grid-floating widget supplies
 * its own. An explicit `placement.chrome` overrides per-field.
 */
export function deriveChrome(p: PlacementInput): LayoutV1["chrome"] {
	const hostManaged = p.pinned || p.drawered
	return {
		background: p.chrome?.background ?? hostManaged,
		wrapper: p.chrome?.wrapper ?? hostManaged,
		titleBar: p.chrome?.titleBar ?? p.drawered,
		padding: p.chrome?.padding ?? false
	}
}

/**
 * A predicate for "is this channel one the widget declared?".
 *
 * A declaration is read as the ruling defines it (2026-09-09): a **bare slug is
 * the whole channel**, every lane under it, because a channel's lanes are
 * allocated at runtime and a declaration written ahead of time could not name
 * them — the cell-phone panel declares `text-messages` once and gets the sixth
 * conversation the day a pipeline opens it. A declaration that does name a lane
 * (`text-messages:2`) is that lane alone.
 *
 * ONE matcher, because the data half (which messages a widget sees) and the
 * event half (which arrivals it hears about) must agree exactly: a widget that
 * is told about a message it cannot then find in `messages.v1` is a bug the
 * widget author cannot fix.
 */
export function channelMatcher(
	channels: string[]
): (channel: unknown) => boolean {
	if (!channels.length) return () => true
	/** Declared as a whole channel. */
	const slugs = new Set<string>()
	/** Declared down to the lane, keyed canonically so `x:1` finds a bare `x`. */
	const lanes = new Set<string>()
	for (const declared of channels) {
		const ref = parseChannel(declared)
		if (ref.explicit) lanes.add(formatChannel(ref))
		else slugs.add(ref.slug)
	}
	return (channel: unknown) => {
		const ref = parseChannel(channel)
		return slugs.has(ref.slug) || lanes.has(formatChannel(ref))
	}
}

/** Filter the full log to a widget's channels (empty channels = the whole log). */
export function scopeMessages(
	messages: SurfaceMessage[],
	channels: string[]
): SurfaceMessage[] {
	if (!channels.length) return messages
	const matches = channelMatcher(channels)
	return messages.filter((m) => matches(m.channel))
}

/**
 * Is a session-level host event this widget's business?
 *
 * Events that name a channel are scoped by the same matcher the data half uses.
 * An event that names NO channel is not channel news at all (a generation
 * starting, a layout change) and reaches every widget — absence of a channel is
 * "not about a channel", never "about a channel you did not declare".
 */
export function eventInScope(e: WidgetEvent, channels: string[]): boolean {
	const channel = (e as { channel?: unknown }).channel
	if (typeof channel !== "string") return true
	return channelMatcher(channels)(channel)
}

// ─── Events ───────────────────────────────────────────────────────────────────

/**
 * The per-widget event bus behind the `on` verb.
 *
 * Deliberately tiny and transport-neutral: `WidgetHost` owns one per native
 * widget and `PluginFrame` owns one per frame, so the two lanes deliver the
 * same events from the same code and a frame is once again a native widget
 * minus the iframe.
 *
 * `"*"` is a real kind here — it receives every event — which is what lets the
 * frame lane forward the lot over the port without enumerating a union it would
 * then have to keep in step.
 */
export interface WidgetEventBus {
	/** Subscribe to one kind, or `"*"` for all. Returns an unsubscribe. */
	on(kind: WidgetEvent["kind"], cb: (e: WidgetEvent) => void): () => void
	emit(e: WidgetEvent): void
}

/** Anything a widget host can hang its bus off — the session-level fan-out. */
export interface WidgetEventSource {
	/** Subscribe to every session-level event. Returns an unsubscribe. */
	subscribe(cb: (e: WidgetEvent) => void): () => void
}

export function createWidgetEventBus(): WidgetEventBus {
	const byKind = new Map<string, Set<(e: WidgetEvent) => void>>()
	return {
		on(kind, cb) {
			const set = byKind.get(kind) ?? new Set()
			byKind.set(kind, set)
			set.add(cb)
			// Idempotent by construction: a second call removes an already-absent
			// member, and a re-subscribed identical callback is a different
			// closure. Unsubscribing yours can never take someone else's off.
			return () => set.delete(cb)
		},
		emit(e) {
			// Copied before iterating: a subscriber that unsubscribes (or
			// subscribes) inside its own callback must not perturb THIS delivery
			// — a widget tearing itself down on the first event it sees is
			// ordinary, and it must not swallow its neighbour's.
			for (const set of [byKind.get(e.kind), byKind.get("*")]) {
				if (!set) continue
				for (const cb of [...set]) {
					try {
						cb(e)
					} catch (err) {
						// One widget's bad listener is not the host's problem, and
						// certainly not the next widget's. Loud, but contained.
						console.error("widget event listener threw", e.kind, err)
					}
				}
			}
		}
	}
}

/** A stored message → its `message:created` event, or null if it has no id. */
export function messageCreatedEvent(
	m: SurfaceMessage
): Extract<WidgetEvent, { kind: "message:created" }> | null {
	const messageId = (m as { id?: unknown }).id
	if (typeof messageId !== "number") return null
	const ref = parseChannel(m.channel)
	return {
		kind: "message:created",
		// Canonical, so lane 1 is the bare slug — the same string the column
		// holds, whatever spelling arrived.
		channel: formatChannel(ref),
		slug: ref.slug,
		lane: ref.lane,
		messageId
	}
}

/**
 * Turns a widget's (already channel-scoped) message list into `message:created`
 * events — the diff that says which of them are NEW.
 *
 * Stateful but not reactive: the host drives it from wherever its message list
 * changes, native or frame, and both lanes get the same events from the same
 * code. Two properties it exists to guarantee:
 *
 *  - the FIRST list seeds silently. A widget mounted onto a session with a
 *    thousand messages has not just witnessed a thousand arrivals; a backlog is
 *    history, and announcing it would make `message:created` useless for the
 *    one thing it is for.
 *  - an id is announced once. The page re-projects the whole list on every
 *    change (an edit, a stream delta, a re-sort), so identity — not position,
 *    not length — is what "new" means here.
 */
export class WidgetMessageFeed {
	#seen = new Set<number>()
	#seeded = false

	take(messages: SurfaceMessage[]): WidgetEvent[] {
		const out: WidgetEvent[] = []
		for (const m of messages) {
			const id = (m as { id?: unknown }).id
			if (typeof id !== "number" || this.#seen.has(id)) continue
			this.#seen.add(id)
			if (!this.#seeded) continue
			const e = messageCreatedEvent(m)
			if (e) out.push(e)
		}
		this.#seeded = true
		return out
	}
}

/**
 * The measured placement → the `layout.v1` section. A detached deep copy, so a
 * host that keeps mutating its geometry object cannot reach into a projection
 * it already handed out (or into a message already posted to a frame).
 *
 * Exported because the frame lane needs exactly this and nothing else: its
 * `{ t: "layout" }` push is this function's output, so native `ctx.layout.v1`
 * and the frame's layout are one projection with two deliveries rather than two
 * implementations that agree until they don't.
 */
export function projectLayout(p: PlacementInput): LayoutV1 {
	return {
		zone: { ...p.zone },
		box: { cols: p.box.cols, rows: p.box.rows, edges: { ...p.box.edges } },
		tier: p.tier,
		pinned: p.pinned,
		collapsed: p.collapsed,
		drawered: p.drawered,
		chrome: deriveChrome(p)
	}
}

/**
 * Build the transport-neutral data sections. Pure — no reactivity, no port —
 * so both the native context and the frame push feed from ONE projection, and
 * scoping/gating is provably identical for both.
 */
export function projectWidgetData(input: ProjectInput): WidgetData {
	const grants = new Set(input.grants ?? [])

	const data: WidgetData = {
		layout: { v1: projectLayout(input.placement) },
		session: {
			v1: { id: input.session.id, name: input.session.name ?? null }
		},
		channels: { v1: [...input.channels] },
		messages: { v1: scopeMessages(input.messages, input.channels) },
		props: { v1: { ...(input.props ?? {}) } },
		settings: { v1: { ...(input.settings ?? {}) } },
		actions: { v1: projectActions(input.actions) }
	}

	// Scoped sections — present iff granted AND source data supplied.
	const s = input.scoped ?? {}
	if (grants.has("persona") && s.persona !== undefined)
		data.persona = { v1: s.persona }
	if (grants.has("characters") && s.characters !== undefined)
		data.characters = { v1: s.characters }
	if (grants.has("lore") && s.lore !== undefined) data.lore = { v1: s.lore }
	if (grants.has("session:full") && s.sessionFull !== undefined)
		data.session_full = { v1: s.sessionFull }

	return data
}

/**
 * The `actions.v1` section: a detached copy of the host's venues, so a widget
 * (or a frame, over the port) cannot reach into the host's list. Absent =
 * no venues at all, which is what a host with no list yet honestly has.
 */
export function projectActions(actions: ActionsV1 | undefined): ActionsV1 {
	const out: ActionsV1 = {}
	for (const [kind, venue] of Object.entries(actions ?? {}))
		out[kind] = {
			primary: (venue?.primary ?? []).map((a) => ({ ...a })),
			overflow: (venue?.overflow ?? []).map((a) => ({ ...a }))
		}
	return out
}

/**
 * The action an identity names — `<spec slug>#<key>` — or, for a bare key,
 * the one action carrying it (U5c review, S7). Undefined when nothing
 * matches; a bare key several actions share (two specs contributing
 * `summarize`, say) throws rather than picking one, because "the first
 * venue's" is not an answer a widget author can reason about.
 *
 * One listing per venue means the same declaration may appear under several
 * venues; those are one action, not an ambiguity.
 */
export function findAction(
	actions: ActionsV1,
	ref: string
): WidgetAction | undefined {
	const listed = Object.values(actions).flatMap((v) => [
		...v.primary,
		...v.overflow
	])
	const parsed = parseActionIdentity(ref)
	if (parsed)
		return listed.find(
			(a) => a.specSlug === parsed.specSlug && a.key === parsed.key
		)
	const byKey = listed.filter((a) => a.key === ref)
	const identities = new Set(byKey.map(actionIdentity))
	if (identities.size > 1)
		throw new Error(
			`action key "${ref}" is carried by ${identities.size} actions here — name one: ${[...identities].join(", ")}`
		)
	return byKey[0]
}

/**
 * The `invoke` verb, derived from `action`, the host's core-verb handlers
 * and the projected venues — ONE implementation for both lanes, so a native
 * widget's `invoke('roll')` and a frame's `{ t: "invoke", key: "roll" }`
 * resolve the same reference to the same declaration through the same path
 * (`dispatchAction`): core's verbs to `coreVerbs`, everything else through
 * `action` with the identity riding along (U5c review, W4).
 *
 * A host that wires no `coreVerbs` still refuses `invoke('continue')`
 * loudly rather than firing it as a function the server cannot serve.
 */
export function makeInvoke(
	actions: () => ActionsV1,
	action: WidgetVerbs["action"],
	widgetId: string,
	coreVerbs: CoreVerbHandlers = {}
): WidgetVerbs["invoke"] {
	return (ref, args) => {
		const found = findAction(actions(), ref)
		if (!found)
			throw new Error(
				`widget "${widgetId}" invoked action "${ref}", which no venue of this session lists`
			)
		dispatchAction(
			found,
			{
				core: coreVerbs,
				fire: (a, fireArgs) =>
					action(
						a.function,
						fireArgs?.messageId,
						fireArgs?.payload,
						actionIdentity(a)
					)
			},
			args
		)
	}
}

/**
 * Wrap the projected data with identity + verbs for a native consumer.
 *
 * `invoke` is optional on the way in: a host supplying `action` gets the
 * derived one (`makeInvoke`) over the projection it just made, so no host
 * has to implement the key→function walk twice. `coreVerbs` are the host's
 * handlers for core's verbs (U5c review, W4); a host that has none gets an
 * `invoke` that refuses them by name.
 */
export function buildNativeContext(
	input: ProjectInput,
	widget: WidgetContext["widget"],
	verbs: Omit<WidgetVerbs, "invoke"> &
		Partial<Pick<WidgetVerbs, "invoke">> & { coreVerbs?: CoreVerbHandlers }
): WidgetContext {
	const data = projectWidgetData(input)
	const { coreVerbs, ...rest } = verbs
	return {
		protocol: 1,
		widget,
		...data,
		...rest,
		invoke:
			verbs.invoke ??
			makeInvoke(() => data.actions.v1, verbs.action, widget.id, coreVerbs)
	}
}

/** The Svelte context key native widgets read their ctx from. */
export const WIDGET_CONTEXT_KEY = "widget"

/**
 * A stable handle a widget reads its (reactive) context through. The provider
 * (`WidgetHost`) puts one in Svelte context whose `current` getter returns the
 * live `$derived` ctx, so a consumer that reads `ref.current.session.v1` inside
 * its own `$derived`/template stays reactive across host re-projections — the
 * in-document analog of a frame's push.
 */
export interface WidgetContextRef {
	readonly current: WidgetContext
}

/**
 * Read the widget context, if a `WidgetHost` provides one. Returns undefined
 * when a component renders outside a host (standalone, tests, a not-yet-wired
 * site), so a native widget must degrade gracefully — never assume presence.
 */
export function useWidgetContext(): WidgetContextRef | undefined {
	return getContext<WidgetContextRef | undefined>(WIDGET_CONTEXT_KEY)
}
