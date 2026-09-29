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
	projectMessageRow,
	widgetEventHeard,
	widgetReads,
	widgetRequestRefusal,
	type HostFrameMessage,
	type MessageV1,
	type SessionV1,
	type TurnOrderV1,
	type ViewerV1,
	type WidgetBaseSection,
	type WidgetRequestKind,
	type WidgetScopedSectionName,
	type WidgetScopedSectionValues,
	type WidgetSectionScope
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
	/**
	 * Scoped sections this widget was granted, by the name each is posted
	 * under (C0b; the SDK's one table, `WIDGET_SCOPED_SECTIONS`) — posted as
	 * `scoped`, withdrawn (`null`) when one goes.
	 */
	scoped?: Partial<WidgetScopedSectionValues>
	/**
	 * The base sections this widget reads (`WidgetDecl.reads`, R75) — absent
	 * reads all. One it does not read is never posted: a widget that does not
	 * read `messages` is not sent the log, nor anything on a token.
	 */
	reads?: readonly WidgetBaseSection[]
	/**
	 * The scopes this widget was granted, BARE (`lore`, never `widget:lore`):
	 * carried on every request it makes (F9), so a kind that reads scoped data
	 * is answered only for a widget holding its scope — and TOLD to the widget
	 * (`grants`), on ready and on every change, so it can say "not granted"
	 * rather than wait for a section that will never come. Absent, nothing is
	 * told: a frame, whose page passes none, is left as it was.
	 */
	grants?: readonly WidgetSectionScope[]
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
		args: { messageId?: number; payload?: Record<string, unknown>; blockId?: string; text?: string },
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
	/**
	 * The mount runs core's own code (`ComponentMount` decides, never a
	 * manifest): as trusted as its native copy, so no confirm stands in front
	 * of its `edit`. A frame or a plugin's component never is.
	 */
	trusted?: () => boolean
}

export interface WidgetWire {
	/** Speak over this port from now on (a fresh port per boot). */
	attach(port: MessagePort): void
	/** Stop speaking; the port is closed. */
	detach(): void
	/**
	 * A message the widget sent that arrived by another road — a remote's
	 * worker channel (`{ k: "wire" }`), ordered after the DOM it drew that
	 * turn. Handled as if it came on the port; ignored while none is attached.
	 */
	receive(data: unknown): void
	/** Has the widget said `ready` on the current port? */
	readonly ready: boolean
}

export function createWidgetWire(opts: WidgetWireOptions): WidgetWire {
	let port: MessagePort | null = null
	let ready = $state(false)
	/**
	 * What the widget holds of each section, on the current port: the JSON it
	 * was last DELIVERED as, by the key `postChanged` files it under. Every
	 * section but the log is diffed (F4): the page re-runs `push` whenever
	 * any input moves, and a section that did not move is not sent again. The
	 * log is not (see `push`). Cleared on a new port and on every `ready` — a
	 * widget saying ready again has nothing, and is sent everything.
	 */
	const sent = new Map<string, string>()
	/** Filed for a section that went out but could not be compared (a cycle): never equal to a later post. */
	const UNCOMPARED = "\u0000uncompared"
	const input = () => opts.inputs()
	/**
	 * Rows as they may cross to ANY widget — a plugin's, an authored one,
	 * core's own: the host's bookkeeping (`MESSAGE_HOST_FIELDS` — `debugMeta`'s
	 * compiled prompt, the `embedding` vector, `userId`, …) stripped. Every
	 * road a row takes out of this wire goes through here: the `messages`
	 * post, the `channel` posts, a `messages` page. A shallow copy per row,
	 * never a serialisation, so a token costs no JSON of the log (F4).
	 * Core's conversation reads a recorded prompt's presence off its dossier
	 * line (`promptDetails`) and the prompt through `prompt-details`.
	 */
	const project = (rows: readonly unknown[]): MessageV1[] => rows.map(projectMessageRow) as MessageV1[]

	/** Post one message; whether it went out. */
	function post(msg: HostFrameMessage): boolean {
		if (!port) return false
		try {
			// A snapshot, not the value: a section read off `$state` is a
			// proxy, which `postMessage` cannot clone — `actions` was dropped
			// that way on every push until the relay was shared (C2).
			port.postMessage($state.snapshot(msg))
			return true
		} catch (e) {
			console.warn(`${opts.label()}: dropped uncloneable "${msg.t}" payload`, e)
			return false
		}
	}

	/**
	 * Post `msg` unless the widget already holds what it says. Recorded only
	 * once it went out: one `post` dropped (uncloneable) is not held, and is
	 * tried again on the next push; one that went out but cannot be compared
	 * (a cycle) is recorded as held-but-uncompared, so a withdrawal of it is
	 * still sent.
	 */
	function postChanged(key: string, msg: HostFrameMessage) {
		let json: string | null
		try {
			json = JSON.stringify(msg)
		} catch {
			json = null
		}
		if (json !== null && sent.get(key) === json) return
		if (post(msg)) sent.set(key, json ?? UNCOMPARED)
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

	/** The base sections this widget reads (R75) — the SDK's one clamp; absent reads all. */
	const readsOf = (i: WireInputs) => new Set<WidgetBaseSection>(widgetReads({ reads: i.reads as WidgetBaseSection[] | undefined }))

	function push() {
		if (!port || !ready) return
		const i = input()
		const reads = readsOf(i)
		// What it holds, before any section it covers: a scope not listed
		// here will never be posted, and the widget may say so.
		if (i.grants !== undefined) postChanged("grants", { t: "grants", grants: [...i.grants] })
		if (reads.has("session") && i.session !== undefined) postChanged("session", { t: "session", session: i.session })
		if (reads.has("messages")) {
			// The rows as the page holds them, narrowed at this one seam.
			// Posted as they are, never diffed: the log is the section that
			// moves on every token, so a comparison could never skip it —
			// it would be one more whole serialisation of the log per token.
			const held = project(i.messages ?? [])
			if (i.channels && i.channels.length) {
				// Panel scoping: only this widget's lanes, one post each.
				for (const ch of i.channels)
					post({
						t: "channel",
						channel: ch,
						messages: held.filter((m) => (m?.channel ?? "main") === ch)
					})
			} else if (i.messages !== undefined) {
				post({ t: "messages", messages: held })
			}
		}
		if (reads.has("props") && i.props !== undefined) postChanged("props", { t: "props", props: i.props })
		if (reads.has("settings") && i.settings !== undefined)
			postChanged("settings", { t: "settings", settings: i.settings })
		if (reads.has("actions") && i.actions !== undefined)
			postChanged("actions", { t: "actions", actions: projectActions(i.actions) })
		// A document NESTED in a component (`onInvoke`) is handed what its
		// component forwards — never the page's own sections besides.
		const nested = !!i.onInvoke
		if (reads.has("annex") && annexCtx && !nested)
			postChanged("annex", { t: "annex", annex: JSON.parse(JSON.stringify(annexCtx.current)) })
		// An EMPTY skin is still posted: taking a style off has to arrive too.
		if (i.skin !== undefined) postChanged("style", buildStyleMessage(i.skin))
		if (reads.has("layout") && i.placement !== undefined) postChanged("layout", buildLayoutMessage(i.placement))
		if (theme) postChanged("theme", { t: "theme", theme: theme.theme, mode: theme.mode })
		if (reads.has("locale")) postChanged("locale", { t: "locale", locale: localeCtx?.current ?? "en" })
		if (reads.has("viewer") && viewerCtx && !nested)
			postChanged("viewer", { t: "viewer", viewer: { ...viewerCtx.current } })
		if (reads.has("turnOrder") && turnOrderCtx && !nested)
			postChanged("turn-order", { t: "turn-order", turnOrder: JSON.parse(JSON.stringify(turnOrderCtx.current)) })
		// Scoped sections: posted when they change, and withdrawn (`null`)
		// when a grant goes away — a worker keeps nothing it may not see.
		// Only a name the SDK's table carries is a section at all.
		const scoped = (i.scoped ?? {}) as Record<string, unknown>
		const postedScoped = [...sent.keys()].filter((k) => k.startsWith("scoped:")).map((k) => k.slice("scoped:".length))
		for (const section of new Set([...Object.keys(scoped), ...postedScoped]) as Set<WidgetScopedSectionName>) {
			const value = scoped[section]
			if (value === undefined) {
				if (!sent.has(`scoped:${section}`)) continue
				if (post({ t: "scoped", section, value: null })) sent.delete(`scoped:${section}`)
			} else postChanged(`scoped:${section}`, { t: "scoped", section, value })
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
		// Who asks, with what it was granted (F9): the page's handler judges
		// by the same, and a kind this widget may not ask is declined here
		// before any page code runs — core's writes to core's widgets, a
		// scoped read to a widget holding its scope.
		const from = {
			widgetId: i.widgetId ?? opts.label(),
			owner: i.owner ?? "unknown",
			grants: [...(i.grants ?? [])]
		}
		const refused = widgetRequestRefusal(what, from)
		if (refused) return decline(refused)
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
				return post(buildPageMessage(m.requestId, { ...page, rows: project(page.rows) as FrameRow[] }))
			}
			requests("messages", params, from).then(
				(page) => {
					// The page answers for the session; this widget sees its lanes only.
					const lanes = i.channels?.length ? new Set(i.channels) : null
					const rows = (page.rows as FrameRow[]).filter(
						(r) => !lanes || lanes.has(((r as { channel?: string }).channel ?? "main") as string)
					)
					post(buildPageMessage(m.requestId, { rows: project(rows) as FrameRow[], nextCursor: page.nextCursor }))
				},
				(e) => decline((e as Error).message)
			)
			return
		}
		if (!requests) return decline(`this page answers no '${what}' request`)
		requests(what, (m.params ?? {}) as never, from).then(
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

	/** One message from the widget — off the port, or relayed (`receive`). */
	function handle(data: unknown) {
		// What arrives is whatever the other side chose to post: untyped, and
		// every field tested before it is used.
		const m = data as Record<string, any> | null
		if (!m || typeof m !== "object") return
		const i = input()
		if (m.t === "ready") {
			ready = true
			// A widget saying ready holds nothing yet — a replayed `ready` on
			// the same port included (the SDK's contract, `surfaces.ts`): it
			// is sent every section it reads again, not only what moved.
			sent.clear()
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
					blockId: typeof m.blockId === "string" ? m.blockId : undefined,
					// The text the press supplies — a slash argument (S2).
					...(typeof m.text === "string" ? { text: m.text } : {})
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
					// Core's own component edits as its native copy does: unasked.
					const content = (m.payload as { content?: unknown } | undefined)?.content
					if (
						!opts.trusted?.() &&
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
					blockId: typeof m.blockId === "string" ? m.blockId : undefined,
					...(typeof m.text === "string" ? { text: m.text } : {})
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
		void i.grants
		void i.reads
		push()
	})

	/* ── events (PLAN 25): a second DELIVERY of the native bus ─────────── */
	const emit = (e: WidgetEvent) => post(buildEventMessage(e))

	// `message:created`, scoped as the `channel` posts are; the feed seeds
	// silently, so a widget mounted onto a loaded session hears arrivals only.
	// A widget that does not read `messages` (R75) is told of no arrival:
	// it could never find the row it was told about.
	const feed = new WidgetMessageFeed()
	$effect(() => {
		const i = input()
		if (!readsOf(i).has("messages")) return
		const list = (i.messages ?? []) as SurfaceMessage[]
		for (const e of feed.take(scopeMessages(list, i.channels ?? []))) emit(e)
	})

	// `layout:changed` beside the `{ t: "layout" }` push; the first placement
	// is what it mounted with, not a change.
	let lastLayout: string | null = null
	$effect(() => {
		const i = input()
		const placement = i.placement
		// Not read (R75), not reported: a widget that does not read its layout
		// is told nothing of it.
		if (placement === undefined || !readsOf(i).has("layout")) return
		const key = JSON.stringify(buildLayoutMessage(placement).layout)
		if (key === lastLayout) return
		const first = lastLayout === null
		lastLayout = key
		if (!first) emit({ kind: "layout:changed", layout: buildLayoutMessage(placement).layout })
	})

	// The session-level fan-out, narrowed to the widget's declared channels —
	// and to what it may read: a kind about scoped data (`lore:ranked`, R81)
	// reaches core's widget, or a plugin's granted its scope, as of now.
	$effect(() => {
		const i = input()
		const src = i.source
		if (!src) return
		const declared = [...(i.channels ?? [])]
		return src.subscribe((e) => {
			if (!eventInScope(e, declared)) return
			const now = input()
			if (!widgetEventHeard(e.kind, { owner: now.owner ?? "unknown", grants: [...(now.grants ?? [])] })) return
			emit(e)
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
			sent.clear()
			port = p
			port.onmessage = (e) => handle(e.data)
		},
		detach() {
			port?.close()
			port = null
			ready = false
		},
		receive(data: unknown) {
			// The same rule a port message meets: no port, no widget to answer.
			if (port) handle(data)
		},
		get ready() {
			return ready
		}
	}
}
