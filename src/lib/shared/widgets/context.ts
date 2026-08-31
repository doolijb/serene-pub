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
 * Base sections (layout/session/channels/messages/props) are always present.
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

/** The transport-neutral data half — the versioned sections. */
export interface WidgetData {
	// base — always present
	layout: { v1: LayoutV1 }
	session: { v1: SessionV1 }
	channels: { v1: string[] }
	messages: { v1: MessageV1[] }
	props: { v1: Payload }
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
	| { kind: "message:created"; messageId: number; channel: string }
	| { kind: "message:updated"; messageId: number }
	| { kind: "message:deleted"; messageId: number }
	| { kind: "message:delta"; messageId: number; delta: string }
	| { kind: "generation:start"; messageId?: number }
	| { kind: "generation:end"; messageId?: number; aborted: boolean }
	| { kind: "channel:activated"; channel: string }
	| { kind: "selection:changed"; messageId: number | null }
	| { kind: string; payload?: Payload }

export interface WidgetVerbs {
	/** Fire-and-observe; state returns via the pushed/reactive sections. */
	action(fn: string, messageId?: number, payload?: Payload): void
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

/** Filter the full log to a widget's lanes (empty channels = the whole log). */
export function scopeMessages(
	messages: SurfaceMessage[],
	channels: string[]
): SurfaceMessage[] {
	if (!channels.length) return messages
	const set = new Set(channels)
	return messages.filter((m) => set.has(m.channel ?? "main"))
}

/**
 * Build the transport-neutral data sections. Pure — no reactivity, no port —
 * so both the native context and the frame push feed from ONE projection, and
 * scoping/gating is provably identical for both.
 */
export function projectWidgetData(input: ProjectInput): WidgetData {
	const grants = new Set(input.grants ?? [])
	const p = input.placement

	const data: WidgetData = {
		layout: {
			v1: {
				zone: { ...p.zone },
				box: { cols: p.box.cols, rows: p.box.rows, edges: { ...p.box.edges } },
				tier: p.tier,
				pinned: p.pinned,
				collapsed: p.collapsed,
				drawered: p.drawered,
				chrome: deriveChrome(p)
			}
		},
		session: {
			v1: { id: input.session.id, name: input.session.name ?? null }
		},
		channels: { v1: [...input.channels] },
		messages: { v1: scopeMessages(input.messages, input.channels) },
		props: { v1: { ...(input.props ?? {}) } }
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

/** Wrap the projected data with identity + verbs for a native consumer. */
export function buildNativeContext(
	input: ProjectInput,
	widget: WidgetContext["widget"],
	verbs: WidgetVerbs
): WidgetContext {
	return {
		protocol: 1,
		widget,
		...projectWidgetData(input),
		...verbs
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
