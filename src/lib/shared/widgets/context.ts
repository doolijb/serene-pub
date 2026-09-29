/**
 * The HOST half of the widget data contract (PLAN 25, ruled 2026-08-30).
 *
 * The contract itself — the sections, the verbs, the event union, the protocol
 * number — is declared in `@serene-pub/sdk` (`widgets.ts`), so a plugin
 * compiles against the same shapes this file produces. What lives here is what
 * only a host can own: the grid facts it measures (`PlacementInput`) and their
 * `layout.v1`, the channel scoping, the actions section and its `invoke`, and
 * the page contexts that supply the scoped sections. The widget wire
 * (`widgetWire.svelte.ts`) posts them to every widget — a frame over its port,
 * a remote over its own (R79: no widget runs in the page's tree).
 *
 * ## Base vs scoped
 *
 * Base sections (layout/session/channels/messages/props/settings/actions/…)
 * are delivered to a widget that READS them (`WidgetDecl.reads`, R75; absent
 * reads all): one that does not is handed the empty value, never the host's
 * data, so it is not re-projected on every token. Scoped sections
 * (session_full/session_state/persona/characters/lore — the SDK's one table,
 * `WIDGET_SCOPED_SECTIONS`) appear ONLY when the widget declared the scope AND
 * it was granted — deny by default. Absence means "not granted", never a
 * silent empty.
 */
import { formatChannel, parseChannel, type WidgetSectionScope } from "@serene-pub/sdk"
import { actionIdentity, parseActionIdentity } from "$lib/shared/actions/identity"
import { dispatchAction, type ActionDispatch } from "./invokeAction"

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
	ViewerV1,
	SessionCharactersV1,
	SessionStateV1
} from "@serene-pub/sdk"

import type {
	WidgetRequestKind,
	WidgetRequests,
	ActionsV1,
	LayoutV1,
	MessageV1,
	WidgetAction,
	WidgetEvent,
	WidgetTier,
	WidgetVerbs
} from "@serene-pub/sdk"

/**
 * A message as the HOST holds it, on its way to becoming a `MessageV1`.
 *
 * Tolerant on purpose, and that is the whole difference from the contract:
 * `scopeMessages` and `WidgetMessageFeed` run over whatever list the page has
 * in hand — a row mid-flight, a fixture, a row a socket has not finished
 * enriching — and their job is to skip what they cannot read rather than to
 * refuse it. `MessageV1` is what a widget is promised once the wire has posted
 * it. Two types because there are two jobs.
 */
export interface SurfaceMessage {
	channel?: string
	[k: string]: unknown
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

/**
 * The placement of a widget NOBODY placed: one widget, one cell, touching
 * every edge of a zone of one — so `chrome` derives to "the widget owns its
 * own backdrop", the correct no-op. `tier` is the one field with nothing
 * behind it (there is no box to measure), so it stays the middling default.
 *
 * What `RemoteWidget` posts for a mount no zone placed (a pop-over flyout).
 */
export const UNPLACED: PlacementInput = Object.freeze({
	zone: Object.freeze({ columns: 1, column: 1, rows: 1, row: 1 }),
	box: Object.freeze({
		cols: 1,
		rows: null,
		edges: Object.freeze({ top: true, right: true, bottom: true, left: true })
	}),
	tier: "cozy",
	pinned: false,
	collapsed: false,
	drawered: false
}) as PlacementInput

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
		padding: p.chrome?.padding ?? false,
		// Never derived: only the host that draws the card knows it does
		// (ruled 2026-09-27 — `withHostCard`). Unsaid is flush.
		card: p.chrome?.card ?? false
	}
}

/**
 * A placement as the host that DRAWS it tells it (ruled 2026-09-27): whether
 * its card is on, and so whether it paints the backdrop, the wrapper and a
 * title bar. Carded, the three are true (a title bar unless the host says it
 * drew none — a tab group's member); flush, all three are false, because the
 * host paints nothing around the widget at all.
 *
 * Absent placement is `UNPLACED` — a mount no zone placed, which is exactly
 * the pop-over case that is always carded.
 */
export function withHostCard(
	p: PlacementInput | undefined,
	card: boolean,
	titleBar = true
): PlacementInput {
	const base = p ?? UNPLACED
	return {
		...base,
		chrome: {
			...base.chrome,
			card,
			background: card,
			wrapper: card,
			titleBar: card && titleBar
		}
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

/** Anything a widget host can hang its bus off — the session-level fan-out. */
export interface WidgetEventSource {
	/** Subscribe to every session-level event. Returns an unsubscribe. */
	subscribe(cb: (e: WidgetEvent) => void): () => void
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
 * changes, a frame or a remote, and both get the same events from the same
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
 * Exported because the wire needs exactly this and nothing else: its
 * `{ t: "layout" }` push is this function's output, so a frame's layout and a
 * remote's are one projection rather than two implementations that agree
 * until they don't.
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
 * the projected venues — ONE implementation for every lane, so a remote
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
 * lend; and one that threads no `core` still refuses `invoke('extend')`
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
 * What a host answers a widget's `request` with (C0b) — the session page
 * provides one under {@link WIDGET_REQUESTS_KEY}; the widget wire reads it,
 * so a frame and a remote ask the same handler. Rejects to decline.
 */
export type WidgetRequestHandler = <K extends WidgetRequestKind>(
	kind: K,
	params: WidgetRequests[K]["params"],
	/**
	 * Which widget asks, whose it is — `core`, or the plugin's id — and the
	 * scopes it was granted (F9), BARE (`lore`, `session:state`), never the
	 * permission keys they are reviewed as (`widget:lore`): what the SDK's
	 * `widgetRequestRefusal` judges a request by. Core's widgets hold every
	 * scope, so theirs may be absent.
	 */
	from: { widgetId: string; owner: string; grants?: readonly string[] }
) => Promise<WidgetRequests[K]["result"]>

/** The Svelte context keys a session page provides beside the annex. */
export const WIDGET_REQUESTS_KEY = "widgetRequests"
export const SESSION_VIEWER_KEY = "sessionViewer"
export const SESSION_TURN_ORDER_KEY = "sessionTurnOrder"
/** The conversation dossier (`session_full.v1`), for a widget granted `session:full`. */
export const SESSION_DOSSIER_KEY = "sessionDossier"
/**
 * 🚧 The session's stats and states as a widget reads them (`session_state.v1`,
 * R72), for a widget granted `session:state`: `{ current: SessionStateV1 }`.
 */
export const SESSION_STATE_KEY = "sessionStateSection"
/**
 * 🚧 The session's cast, cast over card, with its scene images
 * (`characters.v1`, R76), for a widget granted `characters`:
 * `{ current: SessionCharactersV1 }`. The session page provides it
 * (`sessionPage/projections/characters.ts`).
 */
export const SESSION_CHARACTERS_KEY = "sessionCharactersSection"

/**
 * 🚧 Which page context supplies each scoped section — scope → the key its
 * `{ current }` handle is set under. A host reads a granted scope's section
 * off that handle and nowhere else. A scope with no entry has no page
 * context: its section is never projected, which a widget reads as "not
 * granted". `lore` is absent on purpose: the lore is paged by request
 * (`session-entries`), and the scope is the grant to ask; `persona` has no
 * supplier yet.
 */
export const SCOPED_SECTION_CONTEXT_KEYS: Readonly<Partial<Record<WidgetSectionScope, string>>> = Object.freeze({
	"session:full": SESSION_DOSSIER_KEY,
	"session:state": SESSION_STATE_KEY,
	characters: SESSION_CHARACTERS_KEY
})

