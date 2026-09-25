/**
 * The HOST half of the widget data contract (PLAN 25, ruled 2026-08-30).
 *
 * The contract itself — the sections, the verbs, the event union, the protocol
 * number — is declared in `@serene-pub/sdk` (`widgets.ts`), so a plugin
 * compiles against the same shapes this file produces. What lives here is what
 * only a host can own: the grid facts it measures (`PlacementInput`), the
 * projection that turns them plus a session into the sections
 * (`projectWidgetData`), the grant gate, the channel scoping, and the event bus
 * behind the `on` verb.
 *
 * `projectWidgetData` is transport-neutral and is fed to BOTH deliveries.
 * `buildNativeContext` wraps it with the verbs for the in-document consumer; a
 * frame host posts the same sections over its port and implements the verbs
 * there. Field-for-field identical: reactivity is the native analog of a push.
 *
 * ## Base vs scoped
 *
 * Base sections (layout/session/channels/messages/props/settings/actions) are
 * always present. Scoped sections (persona/characters/lore/…) appear ONLY when
 * the widget declared the scope AND it was granted — the same deny-by-default a
 * frame gets, applied here at projection so a native widget is no more
 * privileged. Absence means "not granted", never a silent empty.
 */
import { getContext } from "svelte"
import {
	EMPTY_TURN_ORDER,
	formatChannel,
	parseChannel,
	WIDGET_PROTOCOL,
	type TurnOrderV1,
	type WidgetProtocolVersion
} from "@serene-pub/sdk"
import { actionIdentity, parseActionIdentity } from "$lib/shared/actions/identity"
import { dispatchAction, type ActionDispatch } from "./invokeAction"
import type { WidgetScope } from "./types"

/**
 * The envelope's own shapes are the SDK's (`@serene-pub/sdk`, `widgets.ts`) —
 * one declaration for the contract a plugin compiles against and the data this
 * host produces. Re-exported here so every app import keeps resolving through
 * this module, which is the door the app has always read them through.
 */
export type {
	ActionsV1,
	LayoutV1,
	MenuResult,
	MenuSpec,
	MessageV1,
	SessionV1,
	WidgetAction,
	WidgetData,
	WidgetEvent,
	WidgetEventKind,
	WidgetPayload,
	WidgetRequestKind,
	WidgetRequests,
	WidgetTier,
	WidgetVerbs,
	ViewerV1
} from "@serene-pub/sdk"

import type {
	ViewerV1,
	WidgetRequestKind,
	WidgetRequests,
	ActionsV1,
	LayoutV1,
	MessageV1,
	WidgetAction,
	WidgetData,
	WidgetEvent,
	WidgetEventKind,
	WidgetPayload,
	WidgetTier,
	WidgetVerbs
} from "@serene-pub/sdk"

/**
 * ⏳ The app's spelling of the envelope's free-form bag.
 *
 * @deprecated Use `WidgetPayload` — the name the SDK publishes. A bare
 * `Payload` cannot say whose (R2/R3), and the SDK's barrel is shared with
 * every other payload in the system. Kept one release so app call sites move
 * on their own schedule.
 */
export type Payload = WidgetPayload

/**
 * A message as the HOST holds it, on its way to becoming a `MessageV1`.
 *
 * Tolerant on purpose, and that is the whole difference from the contract:
 * `scopeMessages` and `WidgetMessageFeed` run over whatever list the page has
 * in hand — a row mid-flight, a fixture, a row a socket has not finished
 * enriching — and their job is to skip what they cannot read rather than to
 * refuse it. `MessageV1` is what a widget is promised once the projection has
 * run. Two types because there are two jobs, reconciled at `projectWidgetData`
 * and nowhere else.
 */
export interface SurfaceMessage {
	channel?: string
	[k: string]: unknown
}

/** The full native envelope: identity + data sections + verbs. */
export interface WidgetContext extends WidgetData, WidgetVerbs {
	/**
	 * The widget contract's version — the SDK's one number, shared with the
	 * frame lane's `FRAME_PROTOCOL`. Native is frame minus the iframe, so the
	 * two deliveries report the same contract rather than two clocks that
	 * agree until one is bumped.
	 */
	protocol: WidgetProtocolVersion
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
		/**
		 * The widget box as this host measured it, in CSS pixels — the one
		 * geometry that survives the move off cells, and the contract's
		 * `layout.v1.box.px`.
		 *
		 * Omitted when the zone measured no height (or nothing at all): a
		 * widget reads absence as "unknown" and falls back to `tier`, so a
		 * half-measured box must stay absent rather than report a 0.
		 */
		px?: { width: number; height: number }
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
	/** The viewer's view of the session annex (R57), as the page holds it — already the viewer's. */
	annex?: Record<string, Record<string, unknown>>
	/** The viewer's language code — `locale.v1`; `en` when the host has none. */
	locale?: string
	/** Who is looking — `viewer.v1`; nobody in particular when the host has no one. */
	viewer?: ViewerV1
	/** The session's stored turn order — `turnOrder.v1`; empty when the host has none. */
	turnOrder?: TurnOrderV1
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
 * `"*"` is a SUBSCRIPTION, not a kind — it receives every event, which is what
 * lets the frame lane forward the lot over the port without enumerating a union
 * it would then have to keep in step. Nothing is ever emitted carrying
 * `kind: "*"`, which is why it sits on `on` and not in `WidgetEvent`.
 */
export interface WidgetEventBus {
	/** Subscribe to one kind, or `"*"` for all. Returns an unsubscribe. */
	on(kind: WidgetEventKind | "*", cb: (e: WidgetEvent) => void): () => void
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
		box: {
			cols: p.box.cols,
			rows: p.box.rows,
			edges: { ...p.box.edges },
			...(p.box.px ? { px: { ...p.box.px } } : {})
		},
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
		// The one seam between what the host HOLDS and what a widget is
		// PROMISED (see `SurfaceMessage`). The host's list is rows off the
		// wire; a row that reached the page without an id or a body is a row
		// the socket layer should not have produced, and narrowing here — or
		// dropping it — would hide that in the one place a widget could still
		// see it.
		messages: { v1: scopeMessages(input.messages, input.channels) as MessageV1[] },
		props: { v1: { ...(input.props ?? {}) } },
		settings: { v1: { ...(input.settings ?? {}) } },
		actions: { v1: projectActions(input.actions) },
		// Detached, like every section: a widget cannot reach into the page's copy.
		annex: { v1: JSON.parse(JSON.stringify(input.annex ?? {})) },
		locale: { v1: input.locale ?? "en" },
		viewer: { v1: { ...NOBODY, ...(input.viewer ?? {}) } },
		turnOrder: { v1: JSON.parse(JSON.stringify(input.turnOrder ?? EMPTY_TURN_ORDER)) }
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
 * The `invoke` verb, derived from `action`, the host's action dispatch and
 * the projected venues — ONE implementation for both lanes, so a native
 * widget's `invoke('roll')` and a frame's `{ t: "invoke", key: "roll" }`
 * resolve the same reference to the same declaration through the same path
 * (`dispatchAction`): core's verbs to `actionDispatch.core`, everything else
 * to `actionDispatch.fire` (U5c review, W4).
 *
 * `fire` is the host's OWN fire, not a second one derived here: the session
 * page names the run (`runId`, so Cancel works before the first progress
 * event) and diverts the narrator's two functions to their modal, and a
 * widget's press earns both by taking the same function the chips take.
 * A host that threads no dispatch keeps the fallback — the generic `action`
 * verb, identity in hand — because a mount outside a session has no fire to
 * lend; and one that threads no `core` still refuses `invoke('continue')`
 * loudly rather than firing it as a function the server cannot serve.
 */
export function makeInvoke(
	actions: () => ActionsV1,
	action: WidgetVerbs["action"],
	widgetId: string,
	actionDispatch: Partial<ActionDispatch> = {}
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
				core: actionDispatch.core ?? {},
				fire:
					actionDispatch.fire ??
					((a, fireArgs) =>
						action(
							a.key,
							fireArgs?.messageId,
							fireArgs?.payload,
							actionIdentity(a),
							// The form a press answers (`WidgetInvokeArgs.blockId`)
							// — carried, never chosen here, so a widget drawing a
							// message's form presses it by identity like any other
							// action instead of dropping back to `action`.
							fireArgs?.blockId
						))
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
 * has to implement the key→function walk twice. `actionDispatch` is the
 * host's own routing — its handlers for core's verbs and its fire for
 * everything else (U5c review, W4) — so a widget's press lands where the
 * chips' presses land; a host that has none gets an `invoke` that refuses
 * core's verbs by name and falls back to the generic `action` verb.
 */
export function buildNativeContext(
	input: ProjectInput,
	widget: WidgetContext["widget"],
	verbs: Omit<WidgetVerbs, "invoke"> &
		Partial<Pick<WidgetVerbs, "invoke">> & {
			actionDispatch?: Partial<ActionDispatch>
		}
): WidgetContext {
	const data = projectWidgetData(input)
	const { actionDispatch, ...rest } = verbs
	return {
		protocol: WIDGET_PROTOCOL,
		widget,
		...data,
		...rest,
		invoke:
			verbs.invoke ??
			makeInvoke(
				() => data.actions.v1,
				verbs.action,
				widget.id,
				actionDispatch
			)
	}
}

/** The viewer a host with no one to name reports: not an admin, not a guest. */
const NOBODY: ViewerV1 = { userId: null, isAdmin: false, isGuest: false }

/**
 * What a host answers a widget's `request` with (C0b) — the session page
 * provides one under {@link WIDGET_REQUESTS_KEY}; the native host and the
 * widget wire both read it, so a native widget, a frame and a remote ask the
 * same handler. Rejects to decline.
 */
export type WidgetRequestHandler = <K extends WidgetRequestKind>(
	kind: K,
	params: WidgetRequests[K]["params"],
	/** Which widget asks, and whose it is — `core`, or the plugin's id. */
	from: { widgetId: string; owner: string }
) => Promise<WidgetRequests[K]["result"]>

/** The Svelte context keys a session page provides beside the annex. */
export const WIDGET_REQUESTS_KEY = "widgetRequests"
export const SESSION_VIEWER_KEY = "sessionViewer"
export const SESSION_TURN_ORDER_KEY = "sessionTurnOrder"
/** The conversation dossier (`session_full.v1`), for a widget granted `session:full`. */
export const SESSION_DOSSIER_KEY = "sessionDossier"

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
