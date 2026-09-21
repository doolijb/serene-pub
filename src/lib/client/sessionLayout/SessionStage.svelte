<script lang="ts">
	/**
	 * The **stage** — the live session drawn from a resolved layout document
	 * (session layout v2, plan §3.1/§3.2). Behind `?stage=v2` until the parity
	 * gate; nothing here is reachable without the flag.
	 *
	 * This component renders `resolve`'s answer and nothing else. It computes no
	 * geometry of its own: the grid templates and every `grid-area` are the
	 * strings the SDK emitted, written out inline, and the browser does the
	 * layout. Where it used to take four passes of guard code to decide whether
	 * a side docks, rails, sheets or hides, there is now one field — `state` —
	 * and four containers to put it in.
	 *
	 * ## The three scopes
	 *
	 * Root variables on `.stage`, zone variables on each `.stage-zone`, unit
	 * variables on each `.stage-cell`. `sessionStage.css` holds the structure
	 * and consumes them; nothing structural is written here except the answer.
	 *
	 * ## The no-reload law
	 *
	 * Every widget is mounted ONCE, in one place, keyed by its **unit key**. A
	 * breakpoint change, a side becoming a rail or a sheet, a tab switch, a
	 * flyout opening — all of them move classes and inline styles on the boxes
	 * around a mount, never the mount. Nothing that holds state is ever inside
	 * an `{#if}` that a resize can flip: hiding is `display: none`. An unmount
	 * would reload every iframe under it and drop every native widget's state,
	 * which is the bug the whole shape of this file exists to prevent.
	 *
	 * ## What is NOT here yet
	 *
	 * No editor (P4), no persistence and no operations (P3/P4): the document is
	 * projected from the manager's legacy slots on every read and never written
	 * back. The session-name row (`headerRow`) belongs to `Header.svelte`, which
	 * this lane does not own — see the TODO below.
	 */
	import type { Snippet } from "svelte"
	import { untrack } from "svelte"
	import * as Icons from "@lucide/svelte"
	import {
		BREAKPOINTS,
		ZONE_IDS,
		effectiveZones,
		type GroupUnit,
		type ResolvedUnit,
		type ResolvedZone,
		type SideZone,
		type Unit,
		type UnitBase,
		type WidgetUnit,
		type ZoneId
	} from "@serene-pub/sdk"
	import Panel from "$lib/client/components/surfaces/Panel.svelte"
	import type { SurfaceManager } from "$lib/client/surfaces/panelManager.svelte"
	import type { PanelInstance } from "$lib/client/surfaces/types"
	import type {
		ActionsV1,
		PlacementInput
	} from "$lib/shared/widgets/context"
	import type { ActionDispatch } from "$lib/shared/widgets/invokeAction"
	import { CORE_WIDGETS } from "$lib/shared/widgets/types"
	import {
		resolveWidgetInstance,
		type WidgetSettingsDecl
	} from "$lib/shared/widgets/settings"
	import { widgetSettingValues } from "$lib/client/stores/widgetSettings.svelte"
	import WidgetHost from "./WidgetHost.svelte"
	import {
		mobileSidePanels,
		type MobileGroup
	} from "./mobileSidePanels.svelte"
	import {
		LayoutStore,
		backdropStyle,
		chromeOf,
		declsFor,
		effectiveDocument,
		glassOf,
		parseArea,
		placementFromResolved,
		sideWidthStyle,
		varsStyle
	} from "./layoutStore.svelte"
	import "./sessionStage.css"

	interface Props {
		manager: SurfaceManager
		sessionId: number | null
		session?: unknown
		/**
		 * The middle's conversation content: the ONE `messages` widget, log and
		 * composer together, as the page wires it. The page owns that wiring and
		 * the widget owns its own arrangement; the stage decides only which cell
		 * the unit sits in.
		 */
		conversationChildren?: Snippet
		/**
		 * The session's action venues (`sessions:actions`), threaded from the
		 * page through `SessionLayout` — the `actions.v1` section every widget
		 * the stage mounts reads.
		 */
		actions?: ActionsV1
		/** The page's routing for a press — core's verbs and its own fire (W4). */
		actionDispatch?: ActionDispatch
		onFrameAction?: (
			fn: string,
			messageId?: number,
			payload?: Record<string, unknown>,
			action?: string,
			blockId?: string
		) => void
		/** The session's genre, which is what ships a layout document. */
		genreId?: string | null
		/**
		 * ⏳ This person's layout blob, accepted so the call site is already the
		 * shape P3 needs. P2 reads nothing from it: the document is projected
		 * from the manager's slots, and the style pins it carries are written by
		 * `SessionLayout`, which is still mounted around this component.
		 */
		layoutSettings?: Record<string, unknown>
	}

	let {
		manager,
		sessionId,
		session,
		conversationChildren,
		actions,
		actionDispatch,
		onFrameAction,
		genreId = null,
		layoutSettings = {}
	}: Props = $props()

	/* ── the document and the answer ──────────────────────────────────── */

	// P3 replaces this with the stored document; `fromLegacy` already passes a
	// v2 document straight through, so this is the same call site either way.
	let doc = $derived(
		effectiveDocument({
			zoneLayout: manager.effectiveZoneLayout,
			widgetGrid: manager.effectiveWidgetGrid,
			arrangedGrid: manager.effectiveArrangedGrid,
			genreId
		})
	)
	let decls = $derived(declsFor(manager.instances))

	// Handed over as getters rather than written in through an `$effect`: an
	// effect runs AFTER the render that needed it, so the first paint would draw
	// the built-in document and then swap — and on the server it would never run
	// at all.
	const store = new LayoutStore({
		document: () => doc,
		decls: () => decls
	})

	let resolved = $derived(store.resolved)
	/**
	 * The zones in force at this size — the base patched by the serving variant.
	 * `resolve` answers the same question for the geometry; this is the document
	 * half of it, and it is what the look bags and a side's declared width are
	 * read from.
	 */
	let docZones = $derived(effectiveZones(store.active, resolved.breakpoint))
	let belowRoomy = $derived(
		BREAKPOINTS[resolved.breakpoint] < BREAKPOINTS.roomy
	)

	/* ── measuring the session box ────────────────────────────────────── */

	let stageEl = $state<HTMLDivElement | null>(null)

	$effect(() => {
		const el = stageEl
		if (!el) return
		// `setBox` READS the current box to decide whether anything changed, and
		// a tracked read here would make this effect depend on its own write.
		untrack(() => store.setBox(el.clientWidth, el.clientHeight))
		const ro = new ResizeObserver(() =>
			store.setBox(el.clientWidth, el.clientHeight)
		)
		ro.observe(el)
		return () => ro.disconnect()
	})

	/**
	 * Each cell's measured inline size, keyed `zone:unitKey`.
	 *
	 * Measured per CELL rather than divided out of the zone: the tracks are
	 * `1fr` and `calc()`, so their real size is the browser's answer, not ours.
	 * It is the widget's own width tier — a widget in a 240px column is
	 * `compact` however wide the window is, and that is what it reflows against.
	 */
	let cellWidths = $state<Record<string, number>>({})
	/* The block size of the same cells. Bound beside the width so the
	   contract's `layout.v1.box.px` reports a real box: a track's extent is
	   whatever the browser resolved, and the pixels keep their meaning where
	   a cell count does not. */
	let cellHeights = $state<Record<string, number>>({})

	/* ── widgets ──────────────────────────────────────────────────────── */

	/**
	 * The primary widget's channel declaration: none, i.e. the whole log. A
	 * constant rather than an `[]` literal at the mount, because a widget host
	 * SUBSCRIBES against this array and a fresh literal on every re-render would
	 * tear that subscription down and rebuild it each time.
	 */
	const ALL_CHANNELS: string[] = []

	function inst(id: string): PanelInstance | undefined {
		return manager.instances.find((p) => p.id === id)
	}
	function widgetDeclOf(id: string): WidgetSettingsDecl {
		const p = inst(id)
		if (p && p.role !== "primary")
			return {
				id,
				title: p.title,
				channels: p.channels,
				settings: p.settings
			}
		const core = CORE_WIDGETS.find((w) => w.id === id)
		return {
			id,
			title: core?.title ?? id,
			channels: core?.channels,
			settings: core?.settings
		}
	}
	function resolvedWidget(id: string) {
		return resolveWidgetInstance(widgetDeclOf(id), widgetSettingValues(id))
	}
	function widgetLabel(id: string): string {
		return resolvedWidget(id).title
	}

	/* ── units ────────────────────────────────────────────────────────── */

	function unitOf(zone: ZoneId, key: string): Unit | undefined {
		return (docZones[zone]?.units ?? []).find((u) => u.key === key)
	}
	/** The widget ids a unit draws, in tab order. Empty for a spacer. */
	function widgetsOfUnit(u: Unit | undefined): string[] {
		if (!u) return []
		if (u.kind === "widget") return [(u as WidgetUnit).widget]
		if (u.kind === "group")
			return (u as GroupUnit).members.map((m) => m.widget)
		return []
	}
	/**
	 * What a unit is CALLED comes from the widget declaration it names, never
	 * from the document — one rename reaches every layout, and a document never
	 * carries a stale label for a widget somebody renamed.
	 */
	function unitLabel(u: Unit | undefined, key: string): string {
		if (u?.kind === "spacer") return "Space"
		const ids = widgetsOfUnit(u)
		if (!ids.length) return key
		return ids.map(widgetLabel).join(" · ")
	}
	function unitIconName(u: Unit | undefined, key: string): string {
		const id = widgetsOfUnit(u)[0] ?? key
		return (
			inst(id)?.icon ??
			CORE_WIDGETS.find((w) => w.id === id)?.icon ??
			"LayoutPanelTop"
		)
	}
	function unitIcon(u: Unit | undefined, key: string) {
		const name = unitIconName(u, key)
		return (Icons as unknown as Record<string, unknown>)[name] ?? Icons.LayoutPanelTop
	}

	/** Which member of each tab group is showing, keyed by the group's unit key. */
	let activeTabs = $state<Record<string, string>>({})
	function activeTab(g: GroupUnit): string {
		const a = activeTabs[g.key]
		return a && g.members.some((m) => m.key === a)
			? a
			: (g.members[0]?.key ?? "")
	}
	function setActiveTab(unitKey: string, memberKey: string) {
		activeTabs = { ...activeTabs, [unitKey]: memberKey }
	}

	/**
	 * A unit's `layout.v1` geometry, from the resolved answer.
	 *
	 * The chrome is TOLD rather than derived: the `chrome` look says who paints
	 * the surface, and the primary widget renders full-bleed under either
	 * answer. A grouped member's title comes from its TAB, so it gets no bar.
	 */
	function placementFor(
		zone: ZoneId,
		rz: ResolvedZone,
		ru: ResolvedUnit,
		u: Unit | undefined,
		widgetId: string,
		bare: boolean
	): PlacementInput {
		const primary = widgetId === "messages"
		const members = widgetsOfUnit(u).length
		return placementFromResolved(rz, ru, {
			widthPx: cellWidths[`${zone}:${ru.key}`] ?? 0,
			heightPx: cellHeights[`${zone}:${ru.key}`] ?? 0,
			// The contract's `pinned`: placed in the grid, not collapsible or
			// closable away. For the conversation that is the anchor guarantee;
			// for everything else it is the unit's own field, where absent
			// means pinned.
			pinned: primary ? true : u?.pinned !== false,
			chrome:
				primary || bare
					? { background: false, wrapper: false, titleBar: false }
					: {
							background: true,
							wrapper: true,
							titleBar: members <= 1
						}
		})
	}

	/* ── the rail, and the flyout it opens ────────────────────────────── */

	let openUnit = $state<{ zone: ZoneId; key: string } | null>(null)
	function isOpen(zone: ZoneId, key: string): boolean {
		return openUnit?.zone === zone && openUnit.key === key
	}
	function toggleUnit(zone: ZoneId, key: string) {
		openUnit = isOpen(zone, key) ? null : { zone, key }
	}

	// A flyout whose unit has left the rail (a resize, a document change) is not
	// a flyout any more. Closing it here rather than guarding every reader keeps
	// "what is open" a single fact.
	$effect(() => {
		const o = openUnit
		if (!o) return
		const rz = resolved.zones[o.zone]
		const still =
			!!rz &&
			rz.state !== "hidden" &&
			rz.units.some((u) => u.key === o.key && u.rail && !u.hidden)
		if (!still) untrack(() => (openUnit = null))
	})

	// Click-away and Escape close the flyout. `data-pop-keep` marks what counts
	// as inside — the flyout itself and the rail that opened it, so clicking the
	// icon again is a toggle rather than an outside click plus a re-open.
	$effect(() => {
		if (!openUnit) return
		const onDown = (e: PointerEvent) => {
			const t = e.target as HTMLElement | null
			if (t?.closest("[data-pop-keep]")) return
			openUnit = null
		}
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") openUnit = null
		}
		document.addEventListener("pointerdown", onDown, true)
		document.addEventListener("keydown", onKey)
		return () => {
			document.removeEventListener("pointerdown", onDown, true)
			document.removeEventListener("keydown", onKey)
		}
	})

	/** Roving `tabindex` over each rail: one tab stop, arrows within it. */
	let railFocus = $state<Record<"left" | "right", number>>({
		left: 0,
		right: 0
	})
	function onRailKeydown(e: KeyboardEvent, side: "left" | "right") {
		const bar = (e.currentTarget as HTMLElement).parentElement
		if (!bar) return
		const btns = [...bar.querySelectorAll<HTMLButtonElement>("button")]
		if (!btns.length) return
		let next = railFocus[side]
		if (e.key === "ArrowDown" || e.key === "ArrowRight") next += 1
		else if (e.key === "ArrowUp" || e.key === "ArrowLeft") next -= 1
		else if (e.key === "Home") next = 0
		else if (e.key === "End") next = btns.length - 1
		else return
		e.preventDefault()
		next = (next + btns.length) % btns.length
		railFocus[side] = next
		btns[next]?.focus()
	}

	/* ── sheets (below roomy) ─────────────────────────────────────────── */

	function sheetUnits(side: "left" | "right"): ResolvedUnit[] {
		const rz = resolved.zones[side]
		if (!rz || rz.state !== "sheet") return []
		return rz.units.filter((u) => !u.hidden)
	}
	function groupsOf(side: "left" | "right"): MobileGroup[] {
		return sheetUnits(side).map((ru) => {
			const u = unitOf(side, ru.key)
			return {
				side,
				key: ru.key,
				title: unitLabel(u, ru.key),
				icon: unitIconName(u, ru.key),
				pinned: u?.pinned !== false
			}
		})
	}
	let stageGroups = $derived([...groupsOf("left"), ...groupsOf("right")])
	const groupsKey = (gs: readonly MobileGroup[]) =>
		gs.map((g) => `${g.side}:${g.key}:${g.title}:${g.icon}:${g.pinned}`).join("|")

	/**
	 * The one bridge to the app header, which is a sibling of the routed page
	 * and so out of reach of any context (see `mobileSidePanels`).
	 *
	 * ⚠ Both writers are live while the flag is on: `SessionLayout`'s own
	 * effects still run, and a parent's effects run before a child's. So these
	 * two RECONCILE rather than assign — they read the store, compare, and write
	 * only a difference. Writing an identical value notifies nobody, so this
	 * cannot loop, and a clobber from the legacy host is corrected on the next
	 * flush rather than left standing. Both go away at P6 with the host.
	 */
	$effect(() => {
		const narrow = belowRoomy
		const left = sheetUnits("left").length
		const right = sheetUnits("right").length
		if (
			mobileSidePanels.narrow === narrow &&
			mobileSidePanels.left === left &&
			mobileSidePanels.right === right
		)
			return
		untrack(() => mobileSidePanels.setSides(narrow, left, right))
	})
	$effect(() => {
		const want = groupsKey(stageGroups)
		if (groupsKey(mobileSidePanels.groups) === want) return
		untrack(() => mobileSidePanels.setGroups(stageGroups))
	})

	let sheetSide = $derived(belowRoomy ? mobileSidePanels.open : null)
	let sideEls = $state<Record<"left" | "right", HTMLDivElement | null>>({
		left: null,
		right: null
	})

	function closeSheet() {
		mobileSidePanels.close()
	}

	/** Visible, tabbable descendants — the sheet's focus ring, in DOM order. */
	function focusablesIn(el: HTMLElement): HTMLElement[] {
		return [
			...el.querySelectorAll<HTMLElement>(
				'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
			)
		].filter((n) => n.getClientRects().length > 0)
	}

	// Focus moves into the sheet on open and returns to the header button on
	// close (`mobileSidePanels` owns the return trip). Tab cycles inside it,
	// which is what makes `aria-modal` honest.
	$effect(() => {
		const side = sheetSide
		const el = side ? sideEls[side] : null
		if (!side || !el) return
		el.focus()
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault()
				closeSheet()
				return
			}
			if (e.key !== "Tab") return
			const f = focusablesIn(el)
			if (!f.length) {
				e.preventDefault()
				el.focus()
				return
			}
			const i = f.indexOf(document.activeElement as HTMLElement)
			const next = e.shiftKey
				? f[i <= 0 ? f.length - 1 : i - 1]
				: f[i === -1 || i === f.length - 1 ? 0 : i + 1]
			e.preventDefault()
			next?.focus()
		}
		document.addEventListener("keydown", onKey)
		return () => document.removeEventListener("keydown", onKey)
	})

	/* ── F6: cycle the units in visual order ──────────────────────────── */

	/**
	 * Tab walks DOM order inside one widget; F6 jumps between widgets the way
	 * the eye does — zones left to right, units by the row and column they were
	 * resolved onto. It is the conventional pane-switch key, and it is the
	 * answer to a grid whose visual order is not its source order.
	 */
	function visualUnitOrder(): string[] {
		const out: string[] = []
		for (const id of ZONE_IDS) {
			const rz = resolved.zones[id]
			if (!rz || rz.state === "hidden") continue
			const units = rz.units
				.filter((u) => !u.hidden && !u.rail)
				.map((u) => ({ key: u.key, a: parseArea(u.area) }))
				.sort(
					(x, y) =>
						(x.a?.rowStart ?? 1) - (y.a?.rowStart ?? 1) ||
						(x.a?.colStart ?? 1) - (y.a?.colStart ?? 1) ||
						x.key.localeCompare(y.key)
				)
			for (const u of units) out.push(`${id}:${u.key}`)
		}
		return out
	}

	$effect(() => {
		const el = stageEl
		if (!el) return
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "F6") return
			const order = visualUnitOrder()
			if (!order.length) return
			const cells = order
				.map((k) => {
					const [zone, ...rest] = k.split(":")
					return el.querySelector<HTMLElement>(
						`.stage-cell[data-zone="${zone}"][data-unit-key="${CSS.escape(rest.join(":"))}"]`
					)
				})
				.filter((n): n is HTMLElement => !!n)
			if (!cells.length) return
			e.preventDefault()
			const active = document.activeElement
			const cur = cells.findIndex(
				(c) => c === active || c.contains(active)
			)
			const dir = e.shiftKey ? -1 : 1
			const next =
				((cur < 0 ? 0 : cur + dir) + cells.length) % cells.length
			cells[next]?.focus()
		}
		el.addEventListener("keydown", onKey)
		return () => el.removeEventListener("keydown", onKey)
	})

	const sideLabel = (id: "left" | "right") =>
		id === "left" ? "Left" : "Right"
</script>

<!-- One widget, one mount. Everything below is a container around a mount that
     never moves — see the file header's no-reload note. -->
{#snippet mount(widgetId: string, placement: PlacementInput, bare: boolean)}
	{#if widgetId === "messages"}
		<!-- The primary widget goes through a `WidgetHost` like every other one:
		     same ctx projection, same skin injection, same Style-mode overlay,
		     which is what makes the message packs ordinary widget styles rather
		     than a special case. `channels` is deliberately empty — the primary
		     log is the whole session, not a view onto one channel. -->
		{@const r = resolvedWidget(widgetId)}
		{#if session}
			<WidgetHost
				widget={{ id: widgetId, instanceId: widgetId, title: r.title }}
				session={session as any}
				messages={((session as any)?.sessionMessages ?? []) as any}
				channels={ALL_CHANNELS}
				props={{ widgetId, title: r.title }}
				settings={r.settings}
				{placement}
				source={manager}
				{actions}
				{actionDispatch}
				onAction={onFrameAction}
			>
				{@render conversationChildren?.()}
			</WidgetHost>
		{:else}
			{@render conversationChildren?.()}
		{/if}
	{:else}
		{@const p = inst(widgetId)}
		{#if p && p.role !== "primary"}
			<Panel
				instance={p}
				{manager}
				{sessionId}
				{session}
				{placement}
				chrome="zone"
				hideHeader={bare}
				{actions}
				{actionDispatch}
				{onFrameAction}
			/>
		{:else}
			<!-- Labelled rather than absent: uninstalling a plugin or mistyping
			     a key strands nothing, and the person can see what the layout is
			     asking for. -->
			<div class="stage-missing">
				This layout places “{widgetId}”, which this session does not
				offer.
			</div>
		{/if}
	{/if}
{/snippet}

{#snippet unitBody(
	zone: ZoneId,
	rz: ResolvedZone,
	ru: ResolvedUnit,
	u: Unit | undefined,
	bare: boolean
)}
	{#if !u}
		<div class="stage-missing">
			This layout places “{ru.key}”, which is not in the document at this
			size.
		</div>
	{:else if u.kind === "spacer"}
		<!-- Deliberate empty space: a person may leave a hole without a
		     placeholder standing in it. -->
	{:else if u.kind === "group"}
		{@const g = u as GroupUnit}
		{@const active = activeTab(g)}
		<!-- Several widgets, one unit's cells. Every member stays MOUNTED and
		     the inactive ones are display:none, so a tab switch costs no state
		     and reloads no frame. They share the group's ONE footprint — that is
		     what a tab group is — so they share its placement. -->
		<div class="stage-tabs">
			<div class="stage-tabs-bar" role="tablist" aria-label={unitLabel(u, ru.key)}>
				{#each g.members as m (m.key)}
					<button
						class="stage-tab"
						role="tab"
						aria-selected={m.key === active}
						tabindex={m.key === active ? 0 : -1}
						onclick={() => setActiveTab(g.key, m.key)}
					>
						{widgetLabel(m.widget)}
					</button>
				{/each}
			</div>
			<div class="stage-tabs-body">
				{#each g.members as m (m.key)}
					<div
						class="stage-tabpane"
						data-hidden={m.key === active ? undefined : ""}
					>
						{@render mount(
							m.widget,
							placementFor(zone, rz, ru, u, m.widget, bare),
							true
						)}
					</div>
				{/each}
			</div>
		</div>
	{:else if u.kind === "widget"}
		{@render mount(
			(u as WidgetUnit).widget,
			placementFor(zone, rz, ru, u, (u as WidgetUnit).widget, bare),
			bare
		)}
	{:else}
		<!-- A kind this build has never heard of. The document is versioned by
		     ADDITION, so a newer build's unit draws a placeholder here rather
		     than taking the session down. The cast is what makes that concrete:
		     the three known kinds exhaust `Unit`, so TypeScript has narrowed
		     this branch to `never` while the data has not. -->
		<div class="stage-missing">
			Unknown unit kind “{(u as UnitBase).kind}”.
		</div>
	{/if}
{/snippet}

{#snippet cell(zone: ZoneId, rz: ResolvedZone, ru: ResolvedUnit)}
	{@const u = unitOf(zone, ru.key)}
	{@const bags = [u?.look, docZones[zone]?.look, store.active.look]}
	{@const chrome = chromeOf(bags)}
	{@const opened = !!ru.rail && isOpen(zone, ru.key)}
	<!-- The cell is a focus target for F6, not an interactive control; it is a
	     region a person moves INTO, and Tab then walks what is inside it. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div
		class="stage-cell"
		data-zone={zone}
		data-unit-key={ru.key}
		data-chrome={chrome}
		data-glass={glassOf(bags) ? "" : undefined}
		data-hidden={ru.hidden ? "" : undefined}
		data-rail={ru.rail ? "" : undefined}
		data-open={opened ? "" : undefined}
		data-from={zone === "left" ? "left" : undefined}
		data-fold={ru.fold}
		data-pop-keep={opened ? "" : undefined}
		style="{varsStyle(ru.vars)}grid-area:{ru.area};{backdropStyle(u?.look)}"
		tabindex="-1"
		aria-label={unitLabel(u, ru.key)}
		bind:clientWidth={cellWidths[`${zone}:${ru.key}`]}
		bind:clientHeight={cellHeights[`${zone}:${ru.key}`]}
	>
		{@render unitBody(zone, rz, ru, u, chrome === "bare")}
	</div>
{/snippet}

{#snippet zoneEl(zone: ZoneId, rz: ResolvedZone)}
	{@const zd = docZones[zone]}
	<!-- The templates and every `grid-area` are inline because they are the
	     ANSWER `resolve` computed, not a rule: a stylesheet cannot hold a value
	     that changes with the box. -->
	<div
		class="stage-zone"
		data-zone={zone}
		data-state={rz.state}
		data-glass={glassOf([zd?.look, store.active.look]) ? "" : undefined}
		style="{varsStyle(
			rz.vars
		)}grid-template-rows:{rz.gridTemplateRows};grid-template-columns:{rz.gridTemplateColumns};{backdropStyle(
			zd?.look
		)}"
	>
		{#each rz.units as ru (ru.key)}
			{@render cell(zone, rz, ru)}
		{/each}
	</div>
{/snippet}

{#snippet rail(side: "left" | "right", railed: ResolvedUnit[])}
	<!-- One tab stop for the whole rail. The index is clamped rather than
	     trusted: a unit leaving the rail (a resize, a document change) would
	     otherwise leave the remembered index past the end, and NO button
	     tabbable at all. -->
	{@const focused = Math.min(railFocus[side], railed.length - 1)}
	<!-- The slim rail: one icon per railed unit, at the column's OUTER edge (the
	     wrapper reverses its row for a left side, so one DOM order serves both).
	     `data-pop-keep` so clicking the icon that opened a flyout is not an
	     "outside" click. -->
	<div
		class="stage-rail"
		role="toolbar"
		aria-orientation="vertical"
		aria-label="{sideLabel(side)} panels"
		data-pop-keep
	>
		{#each railed as ru, i (ru.key)}
			{@const u = unitOf(side, ru.key)}
			{@const label = unitLabel(u, ru.key)}
			{@const Icon = unitIcon(u, ru.key) as any}
			<button
				class="stage-rail-btn"
				title={label}
				aria-label={label}
				aria-pressed={isOpen(side, ru.key)}
				tabindex={i === focused ? 0 : -1}
				onclick={() => toggleUnit(side, ru.key)}
				onfocus={() => (railFocus[side] = i)}
				onkeydown={(e) => onRailKeydown(e, side)}
			>
				<Icon size={16} />
			</button>
		{/each}
	</div>
{/snippet}

<!-- A side's ONE mount, moved by class. Docked it is a column; railed it is a
     strip of icons with the grid holding no space; a sheet it IS the dialog;
     hidden it is display:none. Four states, one subtree — a second call site
     for any of them would reload every iframe in it. -->
{#snippet side(id: "left" | "right")}
	{@const rz = resolved.zones[id]}
	{#if rz}
		{@const zd = docZones[id] as SideZone | undefined}
		{@const open = rz.state === "sheet" && sheetSide === id}
		{@const railed = rz.units.filter((u) => u.rail && !u.hidden)}
		<!-- The dialog role and the `tabindex="-1"` are the SAME condition, but
		     the compiler cannot follow that through the ternaries. -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<div
			bind:this={sideEls[id]}
			class="stage-side"
			data-side={id}
			data-state={rz.state}
			data-open={open ? "" : undefined}
			role={open ? "dialog" : undefined}
			aria-modal={open ? "true" : undefined}
			aria-label={open ? `${sideLabel(id)} panels` : undefined}
			tabindex={open ? -1 : undefined}
			data-pop-keep={open ? "" : undefined}
			style={rz.state === "docked" ? sideWidthStyle(zd?.width) : ""}
		>
			{#if open}
				<!-- The sheet's chrome. An `{#if}` adds and removes its OWN nodes
				     at its anchor; the mount below never moves. -->
				<div class="stage-sheet-head">
					<span class="stage-sheet-title">{sideLabel(id)}</span>
					<button
						class="stage-sheet-btn"
						title="Close"
						aria-label="Close {sideLabel(id).toLowerCase()} panels"
						onclick={closeSheet}
					>
						<Icons.X size={16} />
					</button>
				</div>
			{/if}
			{@render zoneEl(id, rz)}
			{#if railed.length && rz.state !== "sheet"}
				{@render rail(id, railed)}
			{/if}
		</div>
	{/if}
{/snippet}

<!-- TODO (P4/Header lane): the `headerRow` look — the row above the zones
     carrying the session name — belongs to `Header.svelte`, which this lane
     does not own. `resolve` already emits it as `--sp-look-headerRow`; whoever
     owns that row reads it. -->
<!-- ⏳ `chat-core` is carried for ONE thing and will go with `messageLayouts.css`
     at P6: the five shared message-STATE rules (selected, dim, hidden, editing)
     are written `.chat-core .sp-msg[…]` in that global sheet, and they are the
     one treatment that is deliberately the same under every pack. Restating
     them here would be a second copy to drift; naming the host they are already
     scoped to costs nothing and keeps selection looking like selection. Nothing
     else in the tree reads the class — SessionLayout's own `.chat-core` rules
     are Svelte-scoped and cannot reach this element. -->
<div
	bind:this={stageEl}
	class="stage chat-core"
	data-breakpoint={resolved.breakpoint}
	data-glass={glassOf([store.active.look]) ? "" : undefined}
	style="{varsStyle(resolved.vars)}{backdropStyle(store.active.look)}"
>
	{@render side("left")}
	{#if resolved.zones.middle}
		{@render zoneEl("middle", resolved.zones.middle)}
	{/if}
	{@render side("right")}

	<!-- The backdrop belongs to no side, so it is here rather than inside one. -->
	{#if sheetSide || mobileSidePanels.menuOpen}
		<button
			class="stage-scrim"
			tabindex="-1"
			aria-label="Close the open panel"
			onclick={() =>
				sheetSide ? closeSheet() : mobileSidePanels.closeMenu()}
		></button>
	{/if}

	<!-- The panels menu: the sheet the header's one panels button opens. It
	     LISTS the side units — icon, title, which side, which are pinned — and
	     tapping one opens that side's sheet. The list is what scales: another
	     widget is another line here. Nothing is mounted by it, so it is an
	     ordinary `{#if}`. -->
	{#if mobileSidePanels.menuOpen}
		<div
			class="stage-menu"
			role="dialog"
			aria-modal="true"
			aria-label="Session panels"
			data-pop-keep
		>
			<div class="stage-sheet-head">
				<span class="stage-sheet-title">Panels</span>
				<button
					class="stage-sheet-btn"
					title="Close"
					aria-label="Close panels menu"
					onclick={() => mobileSidePanels.closeMenu()}
				>
					<Icons.X size={16} />
				</button>
			</div>
			<ul class="stage-menu-list">
				{#each mobileSidePanels.groups as g (`${g.side}:${g.key}`)}
					{@const GroupIcon = ((Icons as unknown as Record<
						string,
						unknown
					>)[g.icon] ?? Icons.LayoutPanelTop) as any}
					<li>
						<button
							class="stage-menu-item"
							onclick={() =>
								mobileSidePanels.openGroup(g.side, g.key)}
						>
							<GroupIcon size={18} />
							<span class="stage-menu-title">{g.title}</span>
							{#if g.pinned}
								<Icons.Pin size={12} />
							{/if}
							<span class="stage-menu-side">
								{sideLabel(g.side)}
							</span>
						</button>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
</div>
