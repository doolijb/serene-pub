/**
 * The surface manager (plan 21 §5/§9/§10): the per-session runtime state behind
 * the grid. It holds panel instances, derives the tier from the *content box*
 * width, runs the pure `pack()` to place them, and persists the per-user layout
 * blob (debounced). Availability comes from declarations (the mode's panels);
 * activation + placement is the user's, and lives here + on the server.
 *
 * Three layers stay separate, exactly as the plan insists:
 *   available   — every declared panel (this.decls, active or not)
 *   active      — instance.active (seeded from decl + layout row + intents)
 *   placed      — pack(tier, active) — derived, never stored
 *
 * **Declarations and instances** (brief 7b, layout plan §M.3.7). `decls` is
 * one entry per declared widget — what the tray offers, what an intent and a
 * channel's traffic address — and each is also its widget's OWN instance,
 * the bare id. `copies` is one entry per copy the layout names
 * (`<widget id>#<instance name>`), cloned from its widget's declaration under
 * its own id, so a copy of ANY widget draws, not only of Messages.
 * `instances` is both, and everything that keys by a placed id — `#find`,
 * close, collapse, the blob's `active[]` — keys by the instance id.
 */
import {
	CONVERSATION_WIDGET_ID,
	drawnWidgetIds,
	layoutWidgetIds,
	widgetOfInstance,
	type SessionLayoutV1
} from "@serene-pub/sdk"
import { formatChannel, parseChannel } from "@serene-pub/sdk"
import type {
	WidgetEvent,
	WidgetEventSource
} from "$lib/shared/widgets/context"
import { pack } from "./pack"
import {
	instanceTitle,
	normalizeLayout,
	tierFor,
	type LayoutBlob,
	type PanelInstance,
	type Tier
} from "./types"

// `Sockets` is an ambient global namespace (declared in shared/sockets/types).
type ModePanel = Sockets.Sessions.View.ModePanel

/**
 * A message row as `witnessMessage` reads it: the four columns an event is
 * derived from, and nothing else named.
 *
 * Tolerant on purpose, like `SurfaceMessage` and for the same reason — what
 * the page has in hand is a row off the wire, and a row mid-flight is skipped
 * rather than refused. It is NOT `MessageV1`: that is what a widget is
 * promised after projection, and this is what the announcer needs before one.
 */
export interface WitnessedMessage {
	id: number
	channel?: string | null
	content?: string | null
	isGenerating?: boolean | null
	generationOutcome?: string | null
}

/**
 * The synthetic primary when a mode declares none — the standard chat log,
 * core's conversation (the layout mounts it itself, as core's remote).
 */
const DEFAULT_PRIMARY: ModePanel = {
	id: "conversation",
	title: "Conversation",
	role: "primary",
	surface: { kind: "remote", owner: "core", component: "messages" },
	defaultActive: true
}

function toInstance(p: ModePanel, layout?: LayoutBlob): PanelInstance {
	const role = p.role === "primary" ? "primary" : "secondary"
	const saved = layout?.active?.find((a) => a.id === p.id)
	const norm = normalizeLayout(p.layout, role)
	// Active if: primary always; else saved.on wins; else the decl default.
	const active =
		role === "primary"
			? true
			: saved?.on !== undefined
				? saved.on
				: !!p.defaultActive
	return {
		id: p.id,
		widgetId: p.id,
		...(p.maxInstances ? { maxInstances: p.maxInstances } : {}),
		title: p.title,
		icon: p.icon,
		role,
		surface: p.surface,
		src: p.src,
		...(p.grants?.length ? { grants: p.grants } : {}),
		...(p.reads ? { reads: p.reads } : {}),
		channels: p.channels ?? [],
		...(p.settings
			? { settings: p.settings as PanelInstance["settings"] }
			: {}),
		layout: norm,
		active,
		collapsed: saved?.collapsed ?? false,
		drawered:
			saved?.drawered ??
			(role !== "primary" && norm.prefer === "drawer"),
		order: saved?.order ?? (role === "primary" ? -1000 : 0)
	}
}

/**
 * A copy of a declared widget, under its own instance id (brief 7b): the
 * declaration's surface, module, settings and grants, its own title
 * (_World state · 2_), and its own sticky state — from the blob's `active[]`
 * when the layout it was seeded from saved some, else the defaults. Always
 * active: a copy exists only while the layout places it.
 */
function toCopy(
	decl: ModePanel,
	instanceId: string,
	layout?: LayoutBlob
): PanelInstance {
	const inst = toInstance(
		{ ...decl, id: instanceId, title: instanceTitle(decl.title, instanceId) },
		layout
	)
	return { ...inst, widgetId: decl.id, active: true }
}

/**
 * Every copy id the three stored slots name (zone lists, the middle grid, the
 * arrangement), each once, in READING order — what the layout draws first
 * (the SDK's `drawnWidgetIds`: middle, left, right, strips), then what it
 * names without drawing (`layoutWidgetIds`). The order matters only past a
 * widget's `maxInstances`, where the copies read first are the ones kept
 * (plan M.3.6; brief 7b review). The manager is the slots' courier and still
 * never interprets them: this only asks which ids they NAME.
 */
function namedCopyIds(slots: SessionLayoutV1): string[] {
	return [...new Set([...drawnWidgetIds(slots), ...layoutWidgetIds(slots)])].filter(
		(id) => widgetOfInstance(id) !== id
	)
}

export class SurfaceManager implements WidgetEventSource {
	/**
	 * One per declared widget (brief 7b): the tray, the intents and channel
	 * activation read these. Each is also its widget's own instance — the bare
	 * id, active or not.
	 */
	decls = $state<PanelInstance[]>([])
	/** One per copy the layout names (`<widget id>#<name>`), cloned from its declaration. */
	copies = $state<PanelInstance[]>([])
	/** Every instance: each declared widget's own, then every copy. */
	get instances(): PanelInstance[] {
		return [...this.decls, ...this.copies]
	}
	/** The widgets this session's genre withholds (R71), core's included. */
	omitted = $state<ReadonlySet<string>>(new Set())
	tier = $state<Tier>("roomy")
	/** Which drawered panel is currently slid open (null = rail closed). */
	drawerOpenId = $state<string | null>(null)
	sessionId = $state<number | null>(null)
	/** Per-tier column fr weights (21 §5) — sparse; absent tiers use equal fr. */
	colFr = $state<Partial<Record<Tier, number[]>>>({})

	#save: (blob: LayoutBlob) => void = () => {}
	#saveTimer: ReturnType<typeof setTimeout> | null = null
	/** The merged declarations, kept so "reset to default" can re-seed. */
	#declared: ModePanel[] = []
	/** Copies already warned about as past their cap — said once, not on every write. */
	#overCap = new Set<string>()

	/** Placement for the current tier — the pure packer's output. */
	placement = $derived(pack(this.tier, this.instances))

	/** Panels currently on the grid (for rendering order/keys). */
	get gridInstances(): PanelInstance[] {
		return this.instances.filter(
			(p) => p.active && this.placement.placements.get(p.id)?.location === "grid"
		)
	}

	/**
	 * Panels currently in the drawer rail.
	 *
	 * An id with no instance is SKIPPED, never rendered and never thrown on: a
	 * saved layout outlives the declaration it names — a plugin disabled since
	 * the arrangement was made stops being listed by `sessions:view` while its
	 * rows stay exactly where they were, so that it can come back — and a
	 * missing widget must draw nothing rather than empty the rail. The filter
	 * is a type guard, so the skip is what narrows the type: `.filter(Boolean)`
	 * narrows nothing, and the `!` it would need makes the declared return type
	 * a promise the code does not keep.
	 */
	get drawerInstances(): PanelInstance[] {
		return this.placement.drawerIds
			.map((id) => this.instances.find((p) => p.id === id))
			.filter((p): p is PanelInstance => !!p)
	}

	/** Inactive-but-declared panels — the "+ add panel" menu. */
	get addable(): PanelInstance[] {
		return this.decls.filter((p) => !p.active && p.role !== "primary")
	}

	/**
	 * How many times `init` has seeded this manager. Reactive, so a view that
	 * keeps its own working copy of the layout (the layout editor) can tell
	 * that the layout under it was REPLACED — a copy landed from the server
	 * (Start from, Reset, Start from scratch) — and re-read it.
	 */
	seedCount = $state(0)

	/**
	 * (Re)seed from the mode's declared panels + this user's session layout —
	 * the whole of it: under the copy model the row IS the layout, and nothing
	 * sits under it. A declared primary replaces the synthetic one; otherwise
	 * the default log is prepended so the grid always has its anchor.
	 */
	init(
		sessionId: number | null,
		modePanels: ModePanel[],
		layout: LayoutBlob | undefined,
		save: (blob: LayoutBlob) => void,
		omit: ReadonlySet<string> = new Set()
	) {
		this.sessionId = sessionId
		this.#save = save
		this.omitted = new Set(omit)
		const hasPrimary = modePanels.some((p) => p.role === "primary")
		// A genre that withholds the conversation (R71) places its own middle;
		// the synthetic log is never put back.
		const decls = hasPrimary || omit.has(CONVERSATION_WIDGET_ID)
			? modePanels
			: [DEFAULT_PRIMARY, ...modePanels]
		this.#declared = decls
		this.decls = decls.map((p) => toInstance(p, layout))
		this.copies = []
		this.colFr = layout?.tierSizeOverrides
			? { ...layout.tierSizeOverrides }
			: {}
		this.zoneLayout = layout?.zoneLayout
		this.widgetGrid = layout?.widgetGrid
		this.arrangedGrid = layout?.arrangedGrid
		// A copy seeded here keeps the sticky state the blob saved for it; one
		// placed later starts at the defaults, never a removed copy's.
		this.#syncCopies(layout)
		this.seedCount++
	}

	/**
	 * Bring `copies` in line with the ids the three slots name: a copy named
	 * and not yet made is cloned from its widget's declaration; a copy no
	 * longer named is dropped (and so leaves the blob's `active[]`). Run on
	 * every write to a slot — `init` and the three setters are the only ways
	 * one changes — so it needs no effect.
	 *
	 * A copy of a widget nobody declares (a plugin since disabled) or of the
	 * conversation (never a panel instance) gets none, and draws nothing. A
	 * copy past its widget's `maxInstances` gets none either, in the order the
	 * slots name them, and says so — the validator's warning, at the reader.
	 */
	#syncCopies(seed?: LayoutBlob) {
		const named = namedCopyIds({
			zoneLayout: this.zoneLayout,
			widgetGrid: this.widgetGrid,
			arrangedGrid: this.arrangedGrid
		} as SessionLayoutV1)
		const have = new Map(this.copies.map((c) => [c.id, c]))
		const placedBare = new Set(
			layoutWidgetIds({
				zoneLayout: this.zoneLayout,
				widgetGrid: this.widgetGrid,
				arrangedGrid: this.arrangedGrid
			} as SessionLayoutV1).filter((id) => widgetOfInstance(id) === id)
		)
		const counts = new Map<string, number>()
		const next: PanelInstance[] = []
		for (const id of named) {
			const widget = widgetOfInstance(id)
			const decl = this.#declared.find((d) => d.id === widget)
			if (!decl) continue
			const count = (counts.get(widget) ?? (placedBare.has(widget) ? 1 : 0)) + 1
			counts.set(widget, count)
			if (decl.maxInstances && count > decl.maxInstances) {
				if (!this.#overCap.has(id)) {
					this.#overCap.add(id)
					console.warn(
						`[session layout] "${id}" is placed past "${widget}"'s maxInstances (${decl.maxInstances}) — not drawn`
					)
				}
				continue
			}
			next.push(have.get(id) ?? toCopy(decl, id, seed))
		}
		const same =
			next.length === this.copies.length &&
			next.every((c, i) => c === this.copies[i])
		if (!same) this.copies = next
	}

	/**
	 * Drop a debounced save that has not gone out yet, WITHOUT sending it.
	 * For the moment the layout is about to be replaced by a copy from the
	 * server: a stale blob posted after the copy was asked for could land
	 * after it and write the old layout back over the new one. Answers
	 * whether one was dropped, so a refused copy can send it after all
	 * (`persistNow`).
	 */
	cancelPendingSave(): boolean {
		if (!this.#saveTimer) return false
		clearTimeout(this.#saveTimer)
		this.#saveTimer = null
		return true
	}

	/**
	 * Save the layout as it stands, now, in place of any debounced save still
	 * waiting. For a copy that was refused after `cancelPendingSave` dropped
	 * the save of an edit made just before it: the layout was never replaced,
	 * so that edit is still this session's.
	 */
	persistNow() {
		if (this.#saveTimer) clearTimeout(this.#saveTimer)
		this.#saveTimer = null
		this.#save(this.toBlob())
	}

	/** Restore the mode's default layout — activation, order, sizes, all of it. */
	resetLayout() {
		this.decls = this.#declared.map((p) => toInstance(p, {}))
		this.copies = []
		this.#syncCopies()
		this.colFr = {}
		this.drawerOpenId = null
		this.#schedulePersist()
	}

	/** Collapse (or expand) every collapsible secondary panel at once. */
	setAllCollapsed(collapsed: boolean) {
		for (const p of this.instances)
			if (p.role !== "primary" && p.layout.collapsible)
				p.collapsed = collapsed
		this.#schedulePersist()
	}

	/** Are all collapsible secondaries currently collapsed? (menu label state) */
	get allCollapsed(): boolean {
		const c = this.instances.filter(
			(p) => p.role !== "primary" && p.layout.collapsible && p.active
		)
		return c.length > 0 && c.every((p) => p.collapsed)
	}

	/** Every secondary panel the mode declares — the layout menu's toggle list. */
	get secondaryPanels(): PanelInstance[] {
		return this.decls.filter((p) => p.role !== "primary")
	}

	/** Column fr weights for the current tier (defaults to equal columns). */
	get columns(): number[] {
		const n = this.placement.tracks
		const saved = this.colFr[this.tier]
		if (saved && saved.length === n) return saved
		return Array.from({ length: n }, () => 1)
	}

	/** Drag a gutter: shift weight between columns `i` and `i+1`. */
	resizeColumn(i: number, deltaFr: number) {
		const cols = [...this.columns]
		if (i < 0 || i + 1 >= cols.length) return
		const lo = 0.25
		const a = cols[i] + deltaFr
		const b = cols[i + 1] - deltaFr
		if (a < lo || b < lo) return
		cols[i] = a
		cols[i + 1] = b
		this.colFr = { ...this.colFr, [this.tier]: cols }
		this.#schedulePersist()
	}

	/** Container resized (any cause: sidebar toggle, window, drag). */
	setWidth(px: number) {
		const t = tierFor(px)
		if (t !== this.tier) this.tier = t
	}

	#find(id: string): PanelInstance | undefined {
		return this.instances.find((p) => p.id === id)
	}

	activate(id: string) {
		const p = this.#find(id)
		if (!p || p.active) return
		p.active = true
		// Fresh arrivals honor their declared preference for grid vs drawer.
		p.drawered = p.layout.prefer === "drawer"
		this.#schedulePersist()
	}

	/**
	 * Deactivate a panel its declaration lets close. The role does not decide
	 * it: the layout keeps its last primary instance by never offering to
	 * remove it (the primary floor, sessionLayout/primaryFloor), and a primary
	 * stays drawn wherever it is placed whatever `active` says.
	 */
	close(id: string) {
		const p = this.#find(id)
		if (!p || !p.layout.closable) return
		p.active = false
		if (this.drawerOpenId === id) this.drawerOpenId = null
		this.#schedulePersist()
	}

	toggleCollapse(id: string) {
		const p = this.#find(id)
		if (!p || !p.layout.collapsible) return
		p.collapsed = !p.collapsed
		this.#schedulePersist()
	}

	/** Pin/unpin a panel to the drawer rail (primary can't be drawered). */
	toggleDrawer(id: string) {
		const p = this.#find(id)
		if (!p || p.role === "primary") return
		p.drawered = !p.drawered
		if (!p.drawered && this.drawerOpenId === id) this.drawerOpenId = null
		this.#schedulePersist()
	}

	openDrawer(id: string) {
		this.drawerOpenId = this.drawerOpenId === id ? null : id
	}

	closeDrawer() {
		this.drawerOpenId = null
	}

	/** Move a panel earlier/later in the pack order. */
	reorder(id: string, delta: number) {
		const p = this.#find(id)
		if (!p) return
		p.order += delta
		this.#schedulePersist()
	}

	/**
	 * A `surface:open` intent (21 §9): a node/action asked to surface a panel.
	 * We *activate* it for this viewer (proposal, not force) and persist so it
	 * sticks. A no-op if it's already active or not a declared panel.
	 */
	applyOpenIntent(panelId: string) {
		const p = this.#find(panelId)
		if (!p) return
		// An intent addresses a WIDGET (brief 7b): with an instance of it
		// already placed and open — its own or a copy — there is nothing to
		// surface; else its own instance is.
		if (this.#openInstanceOf(p.widgetId ?? p.id)) return
		this.activate(panelId)
	}

	/** Is any instance of this widget open — its own, or a copy? */
	#openInstanceOf(widgetId: string): boolean {
		return this.instances.some(
			(p) => p.active && (p.widgetId ?? widgetOfInstance(p.id)) === widgetId
		)
	}

	applyCloseIntent(panelId: string) {
		this.close(panelId)
	}

	/**
	 * Channel-driven autopopulation (21 §9): a message arrived on a non-`main`
	 * channel, so any declared-but-inactive panel that is a *view onto that
	 * channel* flows in. This is the zero-transport path — the message push a
	 * node already makes is the intent. Idempotent; primary is never touched.
	 */
	activateForChannel(channel: string | null | undefined) {
		if (!channel) return
		// On the **slug** (ruling 2026-09-09): a panel is a view onto a
		// channel, and the lanes under it are opened at runtime, so the second
		// conversation arriving in the cell-phone channel is the same panel
		// flowing in — matching the whole string would leave it closed while
		// its own channel filled up. `main` is the anchored log and never
		// autopopulates, whichever of its lanes the message landed on.
		const ref = parseChannel(channel)
		if (ref.slug === "main") return
		let surfaced = false
		for (const p of this.decls)
			if (
				!this.#openInstanceOf(p.id) &&
				p.role !== "primary" &&
				p.channels.some((c) => parseChannel(c).slug === ref.slug)
			) {
				this.activate(p.id)
				surfaced = true
			}
		// `channel:activated` is exactly this transition and nothing looser: a
		// channel that was not on screen now is. The page calls this method for
		// EVERY message that lands, so announcing every call would make the
		// event "a channel had traffic" — which is `message:created`'s job, by a
		// name that promises something else.
		if (surfaced)
			this.#emit({
				kind: "channel:activated",
				channel: formatChannel(ref),
				slug: ref.slug,
				lane: ref.lane
			})
	}

	/**
	 * A package's event, recorded in this session (R56): every widget hears
	 * it as `event:recorded`. The page hands over the server's push; the
	 * manager is the one fan-out both widget lanes already share.
	 */
	announceRecordedEvent(e: { event: string; payload: unknown; at: number }) {
		this.#emit({ kind: "event:recorded", event: e.event, payload: e.payload, at: e.at })
	}

	/**
	 * A turn ranked this session's lore (R81): the page hands over the
	 * server's `sessions:loreRanked` push and every subscriber hears
	 * `lore:ranked`. Who of them may pass it on to its widget is each
	 * delivery's to ask (`widgetEventHeard`: core's, or a plugin's granted
	 * `lore`) — the fan-out itself stays one.
	 */
	announceLoreRanked() {
		this.#emit({ kind: "lore:ranked" })
	}

	/**
	 * 🚧 A lore entry of the session's book changed — any `entries:update` the
	 * viewer's own saves send, from any tab, widget or editor (its marks set
	 * through `entries:setMarks` included): every subscriber hears `lore:marked`,
	 * scoped as `lore:ranked` is, and a lore reader showing that entry asks
	 * again.
	 */
	announceLoreMarked(entryId: number) {
		this.#emit({ kind: "lore:marked", entryId })
	}

	/**
	 * 🚧 The session's stored genre fields moved — the server's
	 * `sessions:genreFieldsChanged` push for this session (Edit Session's
	 * save, the Author's note's own write, in any of the owner's tabs):
	 * every subscriber hears `genreFields:changed`, and a widget showing a
	 * field's value (the Author's note) asks again. Carries nothing.
	 */
	announceGenreFieldsChanged() {
		this.#emit({ kind: "genreFields:changed" })
	}

	/* ── the session-level widget event source (PLAN 25) ──────────────────
	 * Every widget's wire (`ComponentMount`), and a session-view frame's
	 * (`PluginFrame`), fans out from here and filters to its declared channels. The
	 * manager is where these are born because it is already the one thing that
	 * sees session-wide activity — the page hands it every arriving channel —
	 * so nothing has to open a second subscription to the same facts.
	 *
	 * Deliberately a plain Set rather than `$state`: this is a notification
	 * seam, not derived data. Subscribing must not make a component that
	 * subscribes a dependency of the manager, or every widget on screen would
	 * re-run on every other widget's mount. */
	#subscribers = new Set<(e: WidgetEvent) => void>()

	subscribe(cb: (e: WidgetEvent) => void): () => void {
		this.#subscribers.add(cb)
		return () => this.#subscribers.delete(cb)
	}

	#emit(e: WidgetEvent) {
		// Copied before iterating, and each call guarded: a widget that
		// unsubscribes (or throws) inside its own listener must not perturb the
		// delivery its neighbours are in the middle of.
		for (const cb of [...this.#subscribers]) {
			try {
				cb(e)
			} catch (err) {
				console.error("widget event subscriber threw", e.kind, err)
			}
		}
	}

	/** A row's channel, canonically, or undefined when the row names none. */
	#channelOf(m: WitnessedMessage): string | undefined {
		return typeof m.channel === "string"
			? formatChannel(parseChannel(m.channel))
			: undefined
	}

	/**
	 * A message row as the wire pushed it, and the row it replaced when the
	 * page already held one — `witness` because the manager reports what it
	 * was shown rather than deciding anything: the page hands over the arrival
	 * and this works out which events that arrival IS.
	 *
	 * It has to be worked out here because the wire carries no events. A
	 * `sessionMessage` push is the WHOLE row every time, streaming chunks
	 * included, so "a token arrived", "a person edited it" and "the run
	 * finished" are all the same message on the socket and are told apart
	 * only by the row they replaced:
	 *
	 *  - **`generation:start`** — the row is generating and was not (a fresh
	 *    assistant row arrives already generating, which is the ordinary case).
	 *  - **`message:delta`** — the new content EXTENDS the old while the row is
	 *    (or was just) generating. `delta` is the appended text alone: one
	 *    `startsWith` and one `slice` per chunk, no buffer, no second copy of
	 *    the content, nothing retained between chunks.
	 *  - **`message:updated`** — any other arrival of a row the page already
	 *    held. The push IS the change; describing which column moved would
	 *    mean diffing the row, and a widget re-reads `messages.v1` either way.
	 *  - **`generation:end`** — it was generating and is not. `aborted` is the
	 *    `stopped` outcome: a reply a person stopped, not an error.
	 *
	 * `message:created` belongs to every widget's own `WidgetMessageFeed` and
	 * not here: it is per widget, already channel-scoped, and seeds silently so
	 * mounting onto a loaded session is not a thousand arrivals. Two producers
	 * for one kind would double every arrival.
	 */
	witnessMessage(next: WitnessedMessage, previous?: WitnessedMessage): void {
		if (typeof next?.id !== "number") return
		const channel = this.#channelOf(next)
		const wasGenerating = !!previous?.isGenerating
		const isGenerating = !!next.isGenerating

		if (isGenerating && !wasGenerating)
			this.#emit({ kind: "generation:start", messageId: next.id })

		if (previous) {
			const before = previous.content ?? ""
			const after = next.content ?? ""
			// Appended text, and only while the row is being filled: a person
			// typing onto the end of an edited message is an update, not a
			// delta, and an empty `before` cannot tell the two apart at all.
			if (
				(wasGenerating || isGenerating) &&
				before &&
				after.length > before.length &&
				after.startsWith(before)
			)
				this.#emit({
					kind: "message:delta",
					messageId: next.id,
					delta: after.slice(before.length),
					...(channel ? { channel } : {})
				})
			else
				this.#emit({
					kind: "message:updated",
					messageId: next.id,
					...(channel ? { channel } : {})
				})
		}

		if (wasGenerating && !isGenerating)
			this.#emit({
				kind: "generation:end",
				messageId: next.id,
				aborted: next.generationOutcome === "stopped"
			})
	}

	/**
	 * A row is gone (`sessionMessages:delete`). Takes the ROW rather than the
	 * id so the announcement can name the channel it was on — a widget that
	 * declared one channel should not be told about another's deletion. A
	 * caller without the row in hand passes the id alone, and the event reaches
	 * every widget, which is the honest answer for an unknown channel.
	 */
	witnessMessageDeleted(message: WitnessedMessage): void {
		if (typeof message?.id !== "number") return
		const channel = this.#channelOf(message)
		this.#emit({
			kind: "message:deleted",
			messageId: message.id,
			...(channel ? { channel } : {})
		})
	}

	/**
	 * The modular zone layout (mockup 2026-08-28) — the free-form template
	 * SessionLayout edits. Stored verbatim inside the same blob; the manager
	 * is only its courier, never its interpreter.
	 */
	zoneLayout = $state<unknown>(undefined)

	setZoneLayout(layout: unknown) {
		this.zoneLayout = layout
		this.#syncCopies()
		this.#schedulePersist()
	}

	/**
	 * The chat widget grid (PLAN 25) — the middle-zone widget config
	 * SessionLayout edits. Same courier contract as zoneLayout: stored verbatim,
	 * never interpreted here.
	 */
	widgetGrid = $state<unknown>(undefined)

	setWidgetGrid(grid: unknown) {
		this.widgetGrid = grid
		this.#syncCopies()
		this.#schedulePersist()
	}

	/**
	 * The drag editor's captured per-zone geometry (PLAN 25). Same courier
	 * contract as the two above: stored verbatim, never interpreted here.
	 */
	arrangedGrid = $state<unknown>(undefined)

	setArrangedGrid(grid: unknown) {
		this.arrangedGrid = grid
		this.#syncCopies()
		this.#schedulePersist()
	}

	/** Serialize just the sticky per-panel state (21 §10). */
	toBlob(): LayoutBlob {
		return {
			active: this.instances
				.filter((p) => p.role !== "primary")
				.map((p) => ({
					id: p.id,
					order: p.order,
					collapsed: p.collapsed,
					drawered: p.drawered,
					on: p.active
				})),
			tierSizeOverrides: { ...this.colFr },
			...(this.zoneLayout !== undefined
				? { zoneLayout: this.zoneLayout }
				: {}),
			...(this.widgetGrid !== undefined
				? { widgetGrid: this.widgetGrid }
				: {}),
			...(this.arrangedGrid !== undefined
				? { arrangedGrid: this.arrangedGrid }
				: {})
		}
	}

	#schedulePersist() {
		if (this.#saveTimer) clearTimeout(this.#saveTimer)
		this.#saveTimer = setTimeout(() => {
			this.#saveTimer = null
			this.#save(this.toBlob())
		}, 400)
	}

	destroy() {
		// Subscribers hold a reference to whatever closed over them (a widget
		// host, a frame); a manager that outlived a session with its listener
		// list intact would keep those alive and go on calling them.
		this.#subscribers.clear()
		if (this.#saveTimer) {
			clearTimeout(this.#saveTimer)
			// Flush pending layout on teardown so a quick edit isn't lost.
			this.#save(this.toBlob())
			this.#saveTimer = null
		}
	}
}
