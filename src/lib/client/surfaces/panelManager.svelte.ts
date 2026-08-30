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
		layout: norm,
		active,
		collapsed: saved?.collapsed ?? false,
		drawered:
			saved?.drawered ??
			(role !== "primary" && norm.prefer === "drawer"),
		order: saved?.order ?? (role === "primary" ? -1000 : 0)
	}
}

export class SurfaceManager {
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

	/** Panels currently in the drawer rail. */
	get drawerInstances(): PanelInstance[] {
		return this.placement.drawerIds
			.map((id) => this.instances.find((p) => p.id === id)!)
			.filter(Boolean)
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
		save: (blob: LayoutBlob) => void
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
		if (!channel || channel === "main") return
		for (const p of this.instances)
			if (!p.active && p.role !== "primary" && p.channels.includes(channel))
				this.activate(p.id)
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
	 * The chat widget grid (PLAN 25) — the messages/composer widget config
	 * SessionLayout edits. Same courier contract as zoneLayout: stored verbatim,
	 * never interpreted here.
	 */
	widgetGrid = $state<unknown>(undefined)

	setWidgetGrid(grid: unknown) {
		this.widgetGrid = grid
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
		if (this.#saveTimer) {
			clearTimeout(this.#saveTimer)
			// Flush pending layout on teardown so a quick edit isn't lost.
			this.#save(this.toBlob())
			this.#saveTimer = null
		}
	}
}
