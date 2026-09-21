/**
 * The surface manager (plan 21 §5/§9/§10): the per-session runtime state behind
 * the grid. It holds panel instances, derives the tier from the *content box*
 * width, runs the pure `pack()` to place them, and persists the per-user layout
 * blob (debounced). Availability comes from declarations (the mode's panels);
 * activation + placement is the user's, and lives here + on the server.
 *
 * Three layers stay separate, exactly as the plan insists:
 *   available   — every declared panel (this.instances, active or not)
 *   active      — instance.active (seeded from decl + layout row + intents)
 *   placed      — pack(tier, active) — derived, never stored
 */
import { formatChannel, parseChannel } from "@serene-pub/sdk"
import type {
	WidgetEvent,
	WidgetEventSource
} from "$lib/shared/widgets/context"
import { pack } from "./pack"
import {
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

/** The synthetic primary when a mode declares none — the standard chat log. */
const DEFAULT_PRIMARY: ModePanel = {
	id: "conversation",
	title: "Conversation",
	role: "primary",
	surface: { kind: "native", component: "conversation" },
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
		title: p.title,
		icon: p.icon,
		role,
		surface: p.surface,
		src: p.src,
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

export class SurfaceManager implements WidgetEventSource {
	instances = $state<PanelInstance[]>([])
	tier = $state<Tier>("roomy")
	/** Which drawered panel is currently slid open (null = rail closed). */
	drawerOpenId = $state<string | null>(null)
	sessionId = $state<number | null>(null)
	/** Per-tier column fr weights (21 §5) — sparse; absent tiers use equal fr. */
	colFr = $state<Partial<Record<Tier, number[]>>>({})

	#save: (blob: LayoutBlob) => void = () => {}
	#saveTimer: ReturnType<typeof setTimeout> | null = null
	/** The merged declarations, kept so "reset to default" can re-seed. */
	#decls: ModePanel[] = []

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
		return this.instances.filter((p) => !p.active && p.role !== "primary")
	}

	/**
	 * (Re)seed from the mode's declared panels + this user's saved layout.
	 * A declared primary replaces the synthetic one; otherwise the default log
	 * is prepended so the grid always has its anchor.
	 */
	init(
		sessionId: number | null,
		modePanels: ModePanel[],
		layout: LayoutBlob | undefined,
		save: (blob: LayoutBlob) => void,
		baseLayout?: Record<string, unknown>
	) {
		this.sessionId = sessionId
		this.#save = save
		const hasPrimary = modePanels.some((p) => p.role === "primary")
		const decls = hasPrimary
			? modePanels
			: [DEFAULT_PRIMARY, ...modePanels]
		this.#decls = decls
		this.instances = decls.map((p) => toInstance(p, layout))
		this.colFr = layout?.tierSizeOverrides
			? { ...layout.tierSizeOverrides }
			: {}
		this.zoneLayout = layout?.zoneLayout
		this.widgetGrid = layout?.widgetGrid
		this.arrangedGrid = layout?.arrangedGrid
		this.baseLayout = baseLayout
	}

	/** Restore the mode's default layout — activation, order, sizes, all of it. */
	resetLayout() {
		this.instances = this.#decls.map((p) => toInstance(p, {}))
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
		return this.instances.filter((p) => p.role !== "primary")
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

	close(id: string) {
		const p = this.#find(id)
		if (!p || p.role === "primary" || !p.layout.closable) return
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
		if (!p.active) this.activate(panelId)
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
		for (const p of this.instances)
			if (
				!p.active &&
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

	/* ── the session-level widget event source (PLAN 25) ──────────────────
	 * Every widget's own bus (`WidgetHost` for a native one, `PluginFrame` for
	 * a frame) fans out from here and filters to its declared channels. The
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
		this.#schedulePersist()
	}

	/**
	 * The drag editor's captured per-zone geometry (PLAN 25). Same courier
	 * contract as the two above: stored verbatim, never interpreted here.
	 */
	arrangedGrid = $state<unknown>(undefined)

	setArrangedGrid(grid: unknown) {
		this.arrangedGrid = grid
		this.#schedulePersist()
	}

	/**
	 * The layout preset this session is on, already composed with the user's
	 * own `layoutSettings` (PLAN 25 redesign). A READ-ONLY floor the three
	 * courier slots above fall through to when the user has set none.
	 *
	 * It is deliberately NOT one of them, and `toBlob` deliberately cannot see
	 * it. Were the preset merged into the slots, the very next persist would
	 * copy its content into this user's own `layout` column — turning a
	 * reference into a snapshot, so later edits to the preset would stop
	 * reaching them and `toBlob`'s omit-unset-slots property (the thing that
	 * keeps a never-customised session from writing a row at all) would break.
	 *
	 * The same one-way reading is what makes this whole feature compatible: a
	 * session that already has an arrangement has its own slots set, `??`
	 * short-circuits, and the preset is never consulted.
	 */
	baseLayout = $state<Record<string, unknown> | undefined>(undefined)

	setBaseLayout(base: Record<string, unknown> | undefined) {
		this.baseLayout = base
	}

	/** The zone template in force: this user's, else the preset's. */
	get effectiveZoneLayout(): unknown {
		return this.zoneLayout ?? this.baseLayout?.zoneLayout
	}

	/** The chat widget grid in force: this user's, else the preset's. */
	get effectiveWidgetGrid(): unknown {
		return this.widgetGrid ?? this.baseLayout?.widgetGrid
	}

	/** The captured per-zone geometry in force: this user's, else the preset's. */
	get effectiveArrangedGrid(): unknown {
		return this.arrangedGrid ?? this.baseLayout?.arrangedGrid
	}

	/**
	 * Drop this user's own arrangement so the active preset shows through —
	 * what "reset to default" and "apply a preset" both mean. The slots go back
	 * to `undefined`, which `toBlob` omits, so the row stops asserting an
	 * arrangement rather than storing a copy of the preset's.
	 */
	clearArrangement() {
		this.zoneLayout = undefined
		this.widgetGrid = undefined
		this.arrangedGrid = undefined
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
