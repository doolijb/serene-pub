/**
 * The host half of the widget wire (frame protocol 2), over any port.
 *
 * One relay for both boundaries that speak it: a plugin FRAME (an
 * opaque-origin iframe, `PluginFrame.svelte`) and a REMOTE component (the
 * page's UI worker, `host/ComponentMount.svelte`). A remote is a frame minus
 * the document (§3.5), and this is the code that makes that true rather than
 * aspirational — the sections pushed, the paging, the saved view state, the
 * events and the invoke walk are decided here once.
 *
 * What differs between the two is passed in:
 * - **the gate** — how the host knows a person is behind a state-changing
 *   invoke. A frame is judged by focus entering the iframe (`frameActivation`);
 *   a remote by the trusted DOM events the host itself forwarded.
 * - **the label** — whose name goes in a warning.
 *
 * Must be created during a component's initialisation: it registers the
 * effects that re-push on data change, and they belong to that component.
 */
import { getContext } from "svelte"
import { SvelteSet } from "svelte/reactivity"
import {
	WIDGET_REQUEST_KINDS,
	type HostFrameMessage,
	type MessageV1,
	type SessionV1,
	type TurnOrderV1,
	type ViewerV1,
	type WidgetRequestKind
} from "@serene-pub/sdk"
import { t } from "$lib/client/i18n/state.svelte"
import {
	eventInScope,
	findAction,
	makeInvoke,
	projectActions,
	scopeMessages,
	SESSION_VIEWER_KEY,
	SESSION_TURN_ORDER_KEY,
	WIDGET_REQUESTS_KEY,
	WidgetMessageFeed,
	type WidgetRequestHandler,
	type ActionsV1,
	type PlacementInput,
	type SurfaceMessage,
	type WidgetEvent,
	type WidgetEventSource
} from "$lib/shared/widgets/context"
import type { ActionDispatch } from "$lib/shared/widgets/invokeAction"
import { buildEventMessage, buildLayoutMessage } from "./framePlacement"
import { buildStyleMessage } from "./frameStyle"
import type { FrameInvokeVerdict } from "./frameActivation"
import {
	buildPageMessage,
	buildStateMessage,
	pageOf,
	savedFrameState,
	type FrameRow
} from "./framePort"

/** The sections a widget is fed — read live, so a change re-pushes. */
export interface WireInputs {
	/** Scoped sections this widget was granted, by name (C0b) — posted as `scoped`. */
	scoped?: Partial<Record<"persona" | "characters" | "lore" | "session_full", unknown>>
	session?: SessionV1
	messages?: unknown[]
	channels?: string[]
	props?: Record<string, unknown>
	settings?: Record<string, unknown>
	skin?: { css: string; vars: Record<string, string> }
	placement?: PlacementInput
	actions?: ActionsV1
	source?: WidgetEventSource
	suspended?: boolean
	/** Where saved view state is filed (`frameStateKey`). */
	stateKey: string
	/** The widget's id and whose it is (a plugin's id), for the page's request handler. */
	widgetId?: string
	owner?: string
	actionDispatch?: ActionDispatch
	/**
	 * A frame NESTED in a component (`sp-frame`): its invoke is raised to the
	 * component unresolved, and the component invokes through its own widget —
	 * that widget's actions, that widget's gate. Resolving here, against a
	 * list the nested document was never given, would drop every press.
	 */
	onInvoke?: (
		key: string,
		args: { messageId?: number; payload?: Record<string, unknown>; blockId?: string },
		/** The document's own live check (`WidgetWireOptions.personBehind`) passed. */
		personBehind: boolean
	) => void
	onAction?: (
		fn: string,
		messageId?: number,
		payload?: Record<string, unknown>,
		action?: string,
		blockId?: string
	) => void
}

export interface WidgetWireOptions {
	/** Read on every use; a `$props()`-backed getter keeps it live. */
	inputs: () => WireInputs
	/** Whose name goes in a warning: `PluginFrame "Map" (ui/map.html)`. */
	label: () => string
	/** Whether a resolved action may be invoked now — the boundary's own gate. */
	gate: (action: { specSlug: string; key: string }) => FrameInvokeVerdict
	/** The widget gave up (`fatal`); the host shows its own sentence. */
	onFatal?: (message: string) => void
	/** Is a person pressing inside this document right now? Read for a relayed (`onInvoke`) press. */
	personBehind?: () => boolean
}

export interface WidgetWire {
	/** Speak over this port from now on (a fresh port per boot). */
	attach(port: MessagePort): void
	/** Stop speaking; the port is closed. */
	detach(): void
	/** Has the widget said `ready` on the current port? */
	readonly ready: boolean
}

export function createWidgetWire(opts: WidgetWireOptions): WidgetWire {
	let port: MessagePort | null = null
	let ready = $state(false)
	/** What each scoped section was last posted as (JSON), on the current port. */
	const sentScoped = new Map<string, string>()
	const input = () => opts.inputs()

	function post(msg: HostFrameMessage) {
		try {
			// A snapshot, not the value: a section read off `$state` is a
			// proxy, which `postMessage` cannot clone — `actions` was dropped
			// that way on every push until the relay was shared (C2).
			port?.postMessage($state.snapshot(msg))
		} catch (e) {
			console.warn(`${opts.label()}: dropped uncloneable "${msg.t}" payload`, e)
		}
	}

	/**
	 * The viewer's annex view (R57), from the session page's context — absent
	 * outside a session page. Already the viewer's: what they may see and
	 * nothing more.
	 */
	const annexCtx = getContext<{ current: Record<string, Record<string, unknown>> } | undefined>(
		"sessionAnnex"
	)
	/** The viewer's language (`locale.v1`), from the same page; `en` outside one. */
	const localeCtx = getContext<{ current: string } | undefined>("sessionLocale")
	/** Who is looking (`viewer.v1`), and the page's answer to a request (C0b). */
	const viewerCtx = getContext<{ current: ViewerV1 } | undefined>(SESSION_VIEWER_KEY)
	/** The session's turn order (`turnOrder.v1`, C5), from the same page. */
	const turnOrderCtx = getContext<{ current: TurnOrderV1 } | undefined>(SESSION_TURN_ORDER_KEY)
	const requests = getContext<WidgetRequestHandler | undefined>(WIDGET_REQUESTS_KEY)
	/** English strings the widget asked to have translated (`translate`). */
	const wanted = new SvelteSet<string>()

	/* ── the host's theme, as data ─────────────────────────────────────── */
	let theme = $state<{ theme: string; mode: "light" | "dark" } | null>(null)
	$effect(() => {
		const read = () => {
			const el = document.documentElement
			theme = {
				theme: el.getAttribute("data-theme") ?? "",
				mode: el.getAttribute("data-mode") === "dark" ? "dark" : "light"
			}
		}
		read()
		const mo = new MutationObserver(read)
		mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-mode"] })
		return () => mo.disconnect()
	})

	function push() {
		if (!port || !ready) return
		const i = input()
		if (i.session !== undefined) post({ t: "session", session: i.session })
		// The rows as the page holds them, narrowed at this one seam.
		const held = (i.messages ?? []) as MessageV1[]
		if (i.channels && i.channels.length) {
			// Panel scoping: only this widget's lanes, one post each.
			for (const ch of i.channels)
				post({ t: "channel", channel: ch, messages: held.filter((m) => (m?.channel ?? "main") === ch) })
		} else if (i.messages !== undefined) {
			post({ t: "messages", messages: held })
		}
		if (i.props !== undefined) post({ t: "props", props: i.props })
		if (i.settings !== undefined) post({ t: "settings", settings: i.settings })
		if (i.actions !== undefined) post({ t: "actions", actions: projectActions(i.actions) })
		// A document NESTED in a component (`onInvoke`) is handed what its
		// component forwards — never the page's own sections besides.
		const nested = !!i.onInvoke
		if (annexCtx && !nested) post({ t: "annex", annex: JSON.parse(JSON.stringify(annexCtx.current)) })
		// An EMPTY skin is still posted: taking a style off has to arrive too.
		if (i.skin !== undefined) post(buildStyleMessage(i.skin))
		if (i.placement !== undefined) post(buildLayoutMessage(i.placement))
		if (theme) post({ t: "theme", theme: theme.theme, mode: theme.mode })
		post({ t: "locale", locale: localeCtx?.current ?? "en" })
		if (viewerCtx && !nested) post({ t: "viewer", viewer: { ...viewerCtx.current } })
		if (turnOrderCtx && !nested) post({ t: "turn-order", turnOrder: JSON.parse(JSON.stringify(turnOrderCtx.current)) })
		// Scoped sections are large (the dossier) and change less often than
		// the rows: posted when they change, and withdrawn (`null`) when a
		// grant goes away — a worker keeps nothing it may not see.
		const scoped = i.scoped ?? {}
		for (const section of new Set([...Object.keys(scoped), ...sentScoped.keys()])) {
			const value = (scoped as Record<string, unknown>)[section]
			const json = value === undefined ? null : JSON.stringify(value)
			if (sentScoped.get(section) === json) continue
			if (json === null) sentScoped.delete(section)
			else sentScoped.set(section, json)
			post({ t: "scoped", section: section as "session_full", value: json === null ? null : JSON.parse(json) })
		}
	}

	/** One request, answered or declined — never left hanging for a remote. */
	function answer(m: Record<string, unknown> & { requestId: string }) {
		const i = input()
		const what = String(m.what) as WidgetRequestKind
		const decline = (why: string) => {
			console.warn(`${opts.label()}: declined request — ${why}`)
			// `messages` declines silently (the frame protocol's rule); the rest answer.
			if (what !== "messages") post({ t: "response", requestId: m.requestId, ok: false, error: why })
		}
		if (!WIDGET_REQUEST_KINDS.includes(what)) return decline(`'${String(m.what)}' is not something this host answers`)
		if (i.onInvoke) return decline("a document inside a component asks its component, not the page")
		if (what === "messages") {
			const params = {
				channel: typeof m.channel === "string" ? m.channel : undefined,
				cursor: typeof m.cursor === "string" ? m.cursor : undefined,
				limit: typeof m.limit === "number" ? m.limit : undefined
			}
			// A panel's lanes are its lanes: a request cannot reach past them.
			if (params.channel && i.channels?.length && !i.channels.includes(params.channel))
				return decline(`'${params.channel}' is not one of this widget's channels`)
			if (!requests) {
				const page = pageOf({ messages: (i.messages ?? []) as FrameRow[], channels: i.channels }, params)
				if (page.refused) return decline(page.refused)
				return post(buildPageMessage(m.requestId, page))
			}
			requests("messages", params, { widgetId: i.widgetId ?? opts.label(), owner: i.owner ?? "unknown" }).then(
				(page) => {
					// The page answers for the session; this widget sees its lanes only.
					const lanes = i.channels?.length ? new Set(i.channels) : null
					const rows = (page.rows as FrameRow[]).filter(
						(r) => !lanes || lanes.has(((r as { channel?: string }).channel ?? "main") as string)
					)
					post(buildPageMessage(m.requestId, { rows, nextCursor: page.nextCursor }))
				},
				(e) => decline((e as Error).message)
			)
			return
		}
		if (!requests) return decline(`this page answers no '${what}' request`)
		requests(what, (m.params ?? {}) as never, { widgetId: i.widgetId ?? opts.label(), owner: i.owner ?? "unknown" }).then(
			(result) => post({ t: "response", requestId: m.requestId, ok: true, result }),
			(e) => decline((e as Error).message)
		)
	}

	// The translations a widget asked for, re-posted as the app's catalog
	// fills in (the app's own `t()` requests a miss and re-renders on arrival).
	$effect(() => {
		if (!ready || !wanted.size) return
		const strings: Record<string, string> = {}
		for (const src of wanted) strings[src] = t(src)
		post({ t: "strings", strings })
	})

	function onMessage(e: MessageEvent) {
		// What arrives is whatever the other side chose to post: untyped, and
		// every field tested before it is used.
		const m = e.data
		if (!m || typeof m !== "object") return
		const i = input()
		if (m.t === "ready") {
			ready = true
			// Saved state BEFORE the first push: a remount is exactly when a
			// widget has forgotten.
			const held = savedFrameState.get(i.stateKey)
			if (held) post(buildStateMessage(held))
			push()
		} else if (m.t === "error") {
			const message = String(m.message ?? "the widget reported an error")
			console.warn(`${opts.label()}: ${m.fatal === true ? "FATAL — " : ""}${message}`, m.detail)
			if (m.fatal === true) opts.onFatal?.(message)
		} else if (m.t === "request" && typeof m.requestId === "string") {
			// A request is not a grant: answered by the page's handler when it
			// gave one (C0b), else `messages` out of what was already pushed —
			// and anything else declined.
			answer(m as Record<string, unknown> & { requestId: string })
		} else if (m.t === "translate" && Array.isArray(m.sources)) {
			for (const src of m.sources.slice(0, 500)) if (typeof src === "string" && src.length <= 2000) wanted.add(src)
		} else if (m.t === "save-state") {
			// Not storage: held for this (session, surface), capped.
			const outcome = savedFrameState.set(i.stateKey, m.state)
			if (!outcome.kept) console.warn(`${opts.label()}: dropped save-state — ${outcome.reason}`)
		} else if (m.t === "action" && typeof m.fn === "string") {
			i.onAction?.(
				m.fn,
				typeof m.messageId === "number" ? m.messageId : undefined,
				m.payload && typeof m.payload === "object" ? m.payload : undefined,
				typeof m.action === "string" ? m.action : undefined,
				typeof m.blockId === "string" ? m.blockId : undefined
			)
		} else if (m.t === "invoke" && typeof m.key === "string" && i.onInvoke) {
			i.onInvoke(
				m.key,
				{
					messageId: typeof m.messageId === "number" ? m.messageId : undefined,
					payload: m.payload && typeof m.payload === "object" ? (m.payload as Record<string, unknown>) : undefined,
					blockId: typeof m.blockId === "string" ? m.blockId : undefined
				},
				opts.personBehind?.() ?? false
			)
		} else if (m.t === "invoke" && typeof m.key === "string") {
			// The same walk the native verb makes, over the same projection this
			// widget was posted. A state-changing core verb needs a person
			// behind it — the boundary's gate says whether one is — and a verb
			// that spends tokens is put to the person on the host's own dialog.
			try {
				const resolved = findAction(projectActions(i.actions), m.key)
				if (resolved) {
					const verdict = opts.gate(resolved)
					if (!verdict.allowed) {
						console.warn(`${opts.label()}: ${verdict.reason}`)
						return
					}
					if (verdict.confirm && !window.confirm(verdict.confirm)) {
						console.warn(`${opts.label()}: '${m.key}' declined by the person`)
						return
					}
					// `edit` commits text (C0b): a widget that is not core's does not
					// rewrite a line the person has not read — they see the new text.
					const content = (m.payload as { content?: unknown } | undefined)?.content
					if (
						resolved.specSlug === "core" &&
						resolved.key === "edit" &&
						typeof content === "string" &&
						!window.confirm(`Replace this message's text with:\n\n${content.slice(0, 2000)}`)
					) {
						console.warn(`${opts.label()}: 'edit' declined by the person`)
						return
					}
				}
				makeInvoke(
					() => projectActions(input().actions),
					(fn, messageId, payload, action, blockId) =>
						input().onAction?.(fn, messageId, payload, action, blockId),
					opts.label(),
					i.actionDispatch
				)(m.key, {
					messageId: typeof m.messageId === "number" ? m.messageId : undefined,
					payload: m.payload && typeof m.payload === "object" ? m.payload : undefined,
					blockId: typeof m.blockId === "string" ? m.blockId : undefined
				})
			} catch (err) {
				console.warn(`${opts.label()}: ${(err as Error).message}`)
			}
		}
	}

	// Re-feed on data change — the widget renders what the host chose to post.
	$effect(() => {
		const i = input()
		void i.session
		void i.messages
		void i.channels
		void i.props
		void i.settings
		void i.skin
		void i.placement
		void i.actions
		void theme
		void annexCtx?.current
		void localeCtx?.current
		void viewerCtx?.current
		void turnOrderCtx?.current
		void i.scoped
		push()
	})

	/* ── events (PLAN 25): a second DELIVERY of the native bus ─────────── */
	const emit = (e: WidgetEvent) => post(buildEventMessage(e))

	// `message:created`, scoped as the `channel` posts are; the feed seeds
	// silently, so a widget mounted onto a loaded session hears arrivals only.
	const feed = new WidgetMessageFeed()
	$effect(() => {
		const i = input()
		const list = (i.messages ?? []) as SurfaceMessage[]
		for (const e of feed.take(scopeMessages(list, i.channels ?? []))) emit(e)
	})

	// `layout:changed` beside the `{ t: "layout" }` push; the first placement
	// is what it mounted with, not a change.
	let lastLayout: string | null = null
	$effect(() => {
		const placement = input().placement
		if (placement === undefined) return
		const key = JSON.stringify(buildLayoutMessage(placement).layout)
		if (key === lastLayout) return
		const first = lastLayout === null
		lastLayout = key
		if (!first) emit({ kind: "layout:changed", layout: buildLayoutMessage(placement).layout })
	})

	// The session-level fan-out, narrowed to the widget's declared channels.
	$effect(() => {
		const i = input()
		const src = i.source
		if (!src) return
		const declared = [...(i.channels ?? [])]
		return src.subscribe((e) => {
			if (eventInScope(e, declared)) emit(e)
		})
	})

	// Suspend/resume on transitions only, once ready.
	let lastSuspended = false
	$effect(() => {
		const s = !!input().suspended
		if (!port || !ready) return
		if (s !== lastSuspended) {
			lastSuspended = s
			post({ t: s ? "suspend" : "resume" })
		}
	})

	return {
		attach(p: MessagePort) {
			port?.close()
			ready = false
			sentScoped.clear()
			port = p
			port.onmessage = onMessage
		},
		detach() {
			port?.close()
			port = null
			ready = false
		},
		get ready() {
			return ready
		}
	}
}
