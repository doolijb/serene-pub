<script lang="ts">
	/**
	 * P0 spike — a layout editor as an OVERLAY on the live CSS grid.
	 *
	 * Throwaway (plan `PLAN-session-layout-v2.md` §8, row P0). Nothing here is
	 * a component anyone should import: it exists to answer one question —
	 * whether native pointer events on the grid the app already renders can do
	 * the Move tab's three gestures (§5.1) — and is deleted once P4 builds the
	 * real editor on `dragTracks.ts`, which is the half worth keeping.
	 *
	 * What it proves, and how to check it:
	 * - drag a widget by its grip: the nearest drop line lights up with the
	 *   sentence it would produce, and release applies it. Drops cross zones;
	 *   a refused drop says why for two seconds.
	 * - drag a widget onto the START or END edge of another: the row splits
	 *   into two column tracks (8/4 of twelve, from the widget's declared
	 *   span) with a handle on the line between them.
	 * - drag a track handle, or focus it and use the arrow keys, Home and End:
	 *   grow tracks snap in twelfths, fixed tracks in whole cells, and the
	 *   adjoining widget's declared minimum stops the drag.
	 *
	 * Deliberately absent: persistence, widgets (the cards are placeholders),
	 * groups, pins, variants, undo, and any folding logic beyond drawing each
	 * zone as one column below 1024 — where the handles switch off, because
	 * editing a folded size writes to a variant (§5.5) and that is P4's.
	 */
	import {
		applyDrop,
		cycleExtent,
		dropTargets,
		extentLabel,
		isGrowShare,
		materializeExtent,
		nudgeTrack,
		snapTrack,
		trackCss,
		clamp,
		type DropTarget,
		type Extent,
		type TrackBounds,
		type Zone,
		type ZoneRects
	} from "$lib/client/sessionLayout/dragTracks"

	/** The cell module and the grid gap (plan §2.2, CORE_LOOKS defaults). */
	const CELL = 44
	const GAP = 12

	type ZoneId = "middle" | "right"

	interface Cells {
		minW?: number
		maxW?: number
		minH?: number
		maxH?: number
	}

	interface SpikeUnit {
		key: string
		title: string
		row: { start: number; span: number }
		col: { start: number; span: number }
		/** Declared column share of twelve when it joins a row (§2.3). */
		span?: number
		cells?: Cells
	}

	interface SpikeZone {
		id: ZoneId
		title: string
		rows: Extent[]
		cols: Extent[]
		units: SpikeUnit[]
		/** The middle zone is never empty (§2.5, rule 2). */
		minUnits: number
	}

	/**
	 * What a widget declares about itself, keyed by instance. Stands in for
	 * `WidgetDecl.placement` / `.cells`; a drop re-reads it so a unit keeps
	 * its declaration after a round trip through a pure op.
	 */
	const DECLS: Record<
		string,
		{ title: string; span?: number; cells?: Cells }
	> = {
		world: { title: "World State", span: 4, cells: { minH: 2, minW: 3 } },
		messages: {
			title: "Messages",
			span: 8,
			cells: { minH: 4, minW: 4 }
		},
		portraits: {
			title: "Scene Portraits",
			span: 4,
			cells: { minH: 2, minW: 3 }
		},
		stats: { title: "Stats", span: 4, cells: { minH: 2, minW: 3 } },
		inventory: {
			title: "Inventory",
			span: 4,
			cells: { minH: 2, minW: 3 }
		}
	}

	function unit(key: string, row: number, col = 1): SpikeUnit {
		return {
			key,
			title: DECLS[key].title,
			span: DECLS[key].span,
			cells: DECLS[key].cells,
			row: { start: row, span: 1 },
			col: { start: col, span: 1 }
		}
	}

	const ui = $state({
		zones: [
			{
				id: "middle",
				title: "Middle",
				rows: ["fit", "grow"] as Extent[],
				cols: ["grow"] as Extent[],
				units: [unit("world", 1), unit("messages", 2)],
				minUnits: 1
			},
			{
				id: "right",
				title: "Right",
				rows: ["grow", "grow", "grow"] as Extent[],
				cols: ["grow"] as Extent[],
				units: [
					unit("portraits", 1),
					unit("stats", 2),
					unit("inventory", 3)
				],
				minUnits: 0
			}
		] as SpikeZone[],
		tray: [] as SpikeUnit[],
		screen: "actual" as "actual" | 390 | 640 | 1024,
		drag: null as null | {
			key: string
			title: string
			span?: number
			from: ZoneId | "tray"
			x: number
			y: number
			pointerId: number
		},
		nearest: null as null | { zone: ZoneId; target: DropTarget },
		track: null as null | {
			zone: ZoneId
			axis: "row" | "col"
			index: number
			origin: number
			extent: Extent
			total: number
			pointerId: number
		},
		refusal: "",
		say: ""
	})

	let els: Partial<Record<ZoneId, HTMLElement>> = {}
	let rects = $state<Partial<Record<ZoneId, ZoneRects>>>({})
	let frame = 0
	let refusalTimer: ReturnType<typeof setTimeout> | undefined

	const folded = $derived(typeof ui.screen === "number" && ui.screen < 1024)
	const stageWidth = $derived(
		ui.screen === "actual" ? undefined : `${ui.screen}px`
	)

	function zoneOf(id: ZoneId): SpikeZone {
		return ui.zones.find((z) => z.id === id)!
	}

	/*
	 * Measurement ------------------------------------------------------------
	 *
	 * The editor never keeps a model of where things ARE — it asks the DOM,
	 * every frame of a drag. `gridTemplateRows` in computed style is the used
	 * value (the browser's own solve in pixels), so the lines below are where
	 * the grid actually put them, not where this file thinks it asked for.
	 */
	function lines(start: number, size: number, tracks: number[], gap: number) {
		const out = [start]
		let at = start
		tracks.forEach((track, i) => {
			at += track
			out.push(i === tracks.length - 1 ? start + size : at + gap / 2)
			at += gap
		})
		return out
	}

	function measure(el: HTMLElement): ZoneRects {
		const box = el.getBoundingClientRect()
		const style = getComputedStyle(el)
		// `none` on an element with no layout yet; one zone measured as NaN
		// would put every guide in this zone at NaN, so fall back to the box.
		const sizes = (value: string, whole: number) => {
			const parsed = value.split(" ").map((v) => parseFloat(v))
			return parsed.length && parsed.every((n) => Number.isFinite(n))
				? parsed
				: [whole]
		}
		const rows = sizes(style.gridTemplateRows, el.clientHeight)
		const cols = sizes(style.gridTemplateColumns, el.clientWidth)
		const rowGap = parseFloat(style.rowGap) || 0
		const colGap = parseFloat(style.columnGap) || 0
		const units: Record<
			string,
			{ left: number; top: number; width: number; height: number }
		> = {}
		for (const child of el.querySelectorAll<HTMLElement>("[data-unit]")) {
			const r = child.getBoundingClientRect()
			units[child.dataset.unit!] = {
				left: r.left,
				top: r.top,
				width: r.width,
				height: r.height
			}
		}
		return {
			box: {
				left: box.left,
				top: box.top,
				width: box.width,
				height: box.height
			},
			rowLines: lines(box.top, box.height, rows, rowGap),
			colLines: lines(box.left, box.width, cols, colGap),
			units
		}
	}

	function refresh() {
		const next: Partial<Record<ZoneId, ZoneRects>> = {}
		for (const zone of ui.zones) {
			const el = els[zone.id]
			if (el) next[zone.id] = measure(el)
		}
		rects = next
	}

	$effect(() => {
		// Re-measure whenever the document or the screen size changes. The
		// stringify IS the dependency: it reads every track and every unit
		// through the state proxy, which is what registers them.
		void JSON.stringify(ui.zones)
		void ui.screen
		const id = requestAnimationFrame(refresh)
		return () => cancelAnimationFrame(id)
	})

	/*
	 * Dragging a unit --------------------------------------------------------
	 */
	function startDrag(
		event: PointerEvent,
		u: SpikeUnit,
		from: ZoneId | "tray"
	) {
		if (folded) return
		event.preventDefault()
		;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
		ui.drag = {
			key: u.key,
			title: u.title,
			span: u.span,
			from,
			x: event.clientX,
			y: event.clientY,
			pointerId: event.pointerId
		}
		refresh()
		recompute()
	}

	function moveDrag(event: PointerEvent) {
		const drag = ui.drag
		if (!drag || event.pointerId !== drag.pointerId) return
		drag.x = event.clientX
		drag.y = event.clientY
		if (frame) return
		frame = requestAnimationFrame(() => {
			frame = 0
			refresh()
			recompute()
		})
	}

	function recompute() {
		const drag = ui.drag
		if (!drag) return
		let best: { zone: ZoneId; target: DropTarget } | null = null
		for (const zone of ui.zones) {
			const measured = rects[zone.id]
			if (!measured) continue
			const [target] = dropTargets(
				$state.snapshot(zone) as Zone,
				measured,
				{ x: drag.x, y: drag.y },
				{ dragging: drag.key, span: drag.span }
			)
			if (target && (!best || target.distance < best.target.distance))
				best = { zone: zone.id, target }
		}
		ui.nearest = best
	}

	function endDrag(event: PointerEvent) {
		const drag = ui.drag
		if (!drag || event.pointerId !== drag.pointerId) return
		const landing = ui.nearest
		ui.drag = null
		ui.nearest = null
		if (landing) commit(drag, landing)
	}

	const TRAY_TARGET: DropTarget = {
		kind: "tray",
		guide: { left: 0, top: 0, width: 0, height: 0 },
		distance: 0,
		label: "Remove from the layout"
	}

	function commit(
		drag: NonNullable<typeof ui.drag>,
		landing: { zone: ZoneId; target: DropTarget }
	) {
		const source = drag.from === "tray" ? null : zoneOf(drag.from)
		const label = (z: SpikeZone) => `The ${z.title.toLowerCase()} zone`

		if (landing.target.kind === "tray") {
			if (!source) return
			const out = applyDrop(
				$state.snapshot(source) as Zone,
				TRAY_TARGET,
				drag.key,
				{ minUnits: source.minUnits, zoneLabel: label(source) }
			)
			if (out.refused) return refuse(out.refused)
			ui.tray.push({
				key: drag.key,
				title: drag.title,
				span: drag.span,
				cells: DECLS[drag.key]?.cells,
				row: { start: 1, span: 1 },
				col: { start: 1, span: 1 }
			})
			write(source, out.zone)
			return announce(`${drag.title} moved to the tray.`)
		}

		// Both halves of a cross-zone move are computed before either is
		// written: a removal the source refuses must not leave the unit in two
		// places, and a drop the destination refuses must not lose it.
		const destination = zoneOf(landing.zone)
		let removal: Zone | null = null
		if (source && source.id !== destination.id) {
			const out = applyDrop(
				$state.snapshot(source) as Zone,
				TRAY_TARGET,
				drag.key,
				{ minUnits: source.minUnits, zoneLabel: label(source) }
			)
			if (out.refused) return refuse(out.refused)
			removal = out.zone
		}
		const out = applyDrop(
			$state.snapshot(destination) as Zone,
			landing.target,
			drag.key,
			{ title: drag.title, zoneLabel: label(destination) }
		)
		if (out.refused) return refuse(out.refused)
		if (source && removal) write(source, removal)
		write(destination, out.zone)
		if (drag.from === "tray")
			ui.tray = ui.tray.filter((u) => u.key !== drag.key)
		announce(landing.target.label)
	}

	/** Write a pure op's result back, re-reading each unit's declaration. */
	function write(zone: SpikeZone, next: Zone) {
		zone.rows = next.rows
		zone.cols = next.cols
		zone.units = next.units.map((u) => ({
			key: u.key,
			title: u.title ?? DECLS[u.key]?.title ?? u.key,
			span: DECLS[u.key]?.span,
			cells: DECLS[u.key]?.cells,
			row: u.row,
			col: u.col
		}))
	}

	function refuse(reason: string) {
		ui.refusal = reason
		announce(reason)
		clearTimeout(refusalTimer)
		refusalTimer = setTimeout(() => (ui.refusal = ""), 2000)
	}

	function announce(message: string) {
		ui.say = message
	}

	/*
	 * Track handles ----------------------------------------------------------
	 */
	function axisPx(zone: SpikeZone, axis: "row" | "col") {
		const measured = rects[zone.id]
		if (!measured) return 0
		return axis === "row" ? measured.box.height : measured.box.width
	}

	function trackPx(zone: SpikeZone, axis: "row" | "col", index: number) {
		const measured = rects[zone.id]
		if (!measured) return 0
		const at = axis === "row" ? measured.rowLines : measured.colLines
		return (at[index + 1] ?? 0) - (at[index] ?? 0)
	}

	function tracksOf(zone: SpikeZone, axis: "row" | "col") {
		return axis === "row" ? zone.rows : zone.cols
	}

	/**
	 * Give every bare `grow` track on this axis the share it is already
	 * drawing at. Done to the whole axis rather than the one track being
	 * dragged, because `4fr` beside a bare `1fr` is a different layout than
	 * the two equal tracks that were on screen a moment earlier — the grab
	 * would visibly jump before the pointer moved.
	 */
	function materializeAxis(
		zone: SpikeZone,
		axis: "row" | "col",
		index: number
	) {
		const tracks = tracksOf(zone, axis)
		const zonePx = axisPx(zone, axis)
		tracks.forEach((track, i) => {
			// Every bare `grow` on the axis, and whatever the handle is on —
			// a `fit` track has no size to add pixels to, so grabbing its
			// handle fixes it at the size it is already drawing.
			if (track !== "grow" && i !== index) return
			tracks[i] = materializeExtent(
				track,
				trackPx(zone, axis, i),
				CELL,
				zonePx
			)
		})
	}

	/** The declared bounds of the widgets sitting on a track (§5.1). */
	function boundsFor(
		zone: SpikeZone,
		axis: "row" | "col",
		index: number
	): TrackBounds {
		const on = zone.units.filter((u) => {
			const range = axis === "row" ? u.row : u.col
			return (
				range.start <= index + 1 && range.start + range.span > index + 1
			)
		})
		const mins = on
			.map((u) => (axis === "row" ? u.cells?.minH : u.cells?.minW))
			.filter((n): n is number => typeof n === "number")
		const maxes = on
			.map((u) => (axis === "row" ? u.cells?.maxH : u.cells?.maxW))
			.filter((n): n is number => typeof n === "number")
		return {
			minCells: mins.length ? Math.max(...mins) : undefined,
			maxCells: maxes.length ? Math.min(...maxes) : undefined
		}
	}

	/**
	 * Write a snapped extent back, moving the neighbouring track the other
	 * way when both are shares — what a handle between two tracks means.
	 */
	function applyTrack(
		zone: SpikeZone,
		axis: "row" | "col",
		index: number,
		extent: Extent,
		total: number
	) {
		const tracks = tracksOf(zone, axis)
		const next = tracks[index + 1]
		if (isGrowShare(extent) && isGrowShare(next)) {
			const share = clamp(extent.grow, 1, total - 1)
			tracks[index] = { grow: share }
			tracks[index + 1] = { grow: total - share }
			return
		}
		tracks[index] = extent
	}

	function shareTotal(zone: SpikeZone, axis: "row" | "col", index: number) {
		const tracks = tracksOf(zone, axis)
		const a = tracks[index]
		const b = tracks[index + 1]
		return (isGrowShare(a) ? a.grow : 0) + (isGrowShare(b) ? b.grow : 0)
	}

	function startTrack(
		event: PointerEvent,
		zone: SpikeZone,
		axis: "row" | "col",
		index: number
	) {
		event.preventDefault()
		const el = event.currentTarget as HTMLElement
		el.setPointerCapture(event.pointerId)
		// preventDefault above costs the button its focus; a handle you just
		// dragged should still answer the arrow keys.
		el.focus()
		materializeAxis(zone, axis, index)
		ui.track = {
			zone: zone.id,
			axis,
			index,
			origin: axis === "row" ? event.clientY : event.clientX,
			extent: tracksOf(zone, axis)[index],
			total: shareTotal(zone, axis, index),
			pointerId: event.pointerId
		}
	}

	function moveTrack(event: PointerEvent) {
		const track = ui.track
		if (!track || event.pointerId !== track.pointerId) return
		const zone = zoneOf(track.zone)
		const delta =
			(track.axis === "row" ? event.clientY : event.clientX) -
			track.origin
		const out = snapTrack(
			track.extent,
			delta,
			CELL,
			axisPx(zone, track.axis),
			boundsFor(zone, track.axis, track.index)
		)
		if (out.refused) return
		applyTrack(zone, track.axis, track.index, out.extent, track.total)
	}

	function endTrack(event: PointerEvent) {
		const track = ui.track
		if (!track || event.pointerId !== track.pointerId) return
		const zone = zoneOf(track.zone)
		// Announced once, at the end: a live region updated every frame of a
		// drag says nothing a screen reader can keep up with.
		announce(
			`${track.axis === "row" ? "Row" : "Column"} ${track.index + 1}, ${extentLabel(
				tracksOf(zone, track.axis)[track.index],
				trackPx(zone, track.axis, track.index)
			)}`
		)
		ui.track = null
	}

	function trackKey(
		event: KeyboardEvent,
		zone: SpikeZone,
		axis: "row" | "col",
		index: number
	) {
		const back = axis === "row" ? "ArrowUp" : "ArrowLeft"
		const forward = axis === "row" ? "ArrowDown" : "ArrowRight"
		const known = [back, forward, "Home", "End"]
		if (!known.includes(event.key)) return
		event.preventDefault()
		materializeAxis(zone, axis, index)
		const extent = tracksOf(zone, axis)[index]
		const zonePx = axisPx(zone, axis)
		const bounds = boundsFor(zone, axis, index)
		const out =
			event.key === "Home"
				? snapTrack(extent, -1e6, CELL, zonePx, bounds)
				: event.key === "End"
					? snapTrack(extent, 1e6, CELL, zonePx, bounds)
					: nudgeTrack(
							extent,
							event.key === back ? -1 : 1,
							CELL,
							zonePx,
							bounds
						)
		if (out.refused) return refuse(out.refused)
		applyTrack(zone, axis, index, out.extent, shareTotal(zone, axis, index))
		announce(
			`${axis === "row" ? "Row" : "Column"} ${index + 1}, ${out.label}`
		)
	}

	function handlesFor(zone: SpikeZone, axis: "row" | "col") {
		const measured = rects[zone.id]
		if (!measured || folded) return []
		const at = axis === "row" ? measured.rowLines : measured.colLines
		const tracks = tracksOf(zone, axis)
		const origin = axis === "row" ? measured.box.top : measured.box.left
		return tracks.slice(0, -1).map((_, i) => ({
			index: i,
			at: (at[i + 1] ?? origin) - origin
		}))
	}

	/** The row/column chip cycles the extent (§5.1). */
	function cycle(zone: SpikeZone, axis: "row" | "col", index: number) {
		const tracks = tracksOf(zone, axis)
		tracks[index] = cycleExtent(
			tracks[index],
			trackPx(zone, axis, index),
			CELL
		)
	}

	/*
	 * Drawing ----------------------------------------------------------------
	 */
	function template(zone: SpikeZone, axis: "row" | "col") {
		if (folded)
			return axis === "row"
				? `repeat(${Math.max(1, zone.units.length)}, auto)`
				: "minmax(0, 1fr)"
		return tracksOf(zone, axis)
			.map((t) => trackCss(t, CELL))
			.join(" ")
	}

	function order(zone: SpikeZone) {
		return [...zone.units].sort(
			(a, b) => a.row.start - b.row.start || a.col.start - b.col.start
		)
	}

	function area(zone: SpikeZone, u: SpikeUnit) {
		if (folded) {
			const at = order(zone).findIndex((o) => o.key === u.key) + 1
			return `grid-row: ${at} / span 1; grid-column: 1 / span 1;`
		}
		return `grid-row: ${u.row.start} / span ${u.row.span}; grid-column: ${u.col.start} / span ${u.col.span};`
	}

	/**
	 * The guide's box in zone coordinates: a 3px line, or a cell. Returned as
	 * a list so the markup can `{#each}` over none or one of them — `{@const}`
	 * may only sit directly inside a block.
	 */
	function guidesFor(zone: SpikeZone) {
		const guide = guideBox(zone)
		return guide ? [guide] : []
	}

	function guideBox(zone: SpikeZone) {
		const landing = ui.nearest
		const measured = rects[zone.id]
		if (!landing || landing.zone !== zone.id || !measured) return null
		if (landing.target.kind === "tray") return null
		const g = landing.target.guide
		return {
			left: g.left - measured.box.left - (g.width ? 0 : 1.5),
			top: g.top - measured.box.top - (g.height ? 0 : 1.5),
			width: Math.max(g.width, 3),
			height: Math.max(g.height, 3),
			label: landing.target.label
		}
	}

	const trayLit = $derived(ui.nearest?.target.kind === "tray")
	const screens: Array<{
		label: string
		value: "actual" | 390 | 640 | 1024
	}> = [
		{ label: "390", value: 390 },
		{ label: "640", value: 640 },
		{ label: "1024", value: 1024 },
		{ label: "Actual", value: "actual" }
	]
</script>

<svelte:window onresize={refresh} onscroll={refresh} />

<div class="flex h-full min-h-0 flex-col gap-3 p-4">
	<header class="flex flex-col gap-1">
		<h1 class="text-surface-50 text-lg font-semibold">Layout spike</h1>
		<p class="text-surface-400 max-w-[72ch] text-sm">
			Drag a widget by its grip onto a line. Drop it on another widget's
			left or right edge to share that row. Drag the pill on a line to
			resize the track, or focus it and use the arrow keys, Home and End.
		</p>
	</header>

	<div class="flex flex-wrap items-center gap-2">
		<span class="text-surface-500 text-xs tracking-wide uppercase">
			Screen
		</span>
		{#each screens as screen (screen.value)}
			<button
				type="button"
				class="h-[34px] rounded-full px-4 text-sm {ui.screen ===
				screen.value
					? 'preset-tonal-primary'
					: 'preset-tonal-surface'}"
				aria-pressed={ui.screen === screen.value}
				onclick={() => (ui.screen = screen.value)}
			>
				{screen.label}
			</button>
		{/each}
		{#if folded}
			<span class="text-surface-400 text-sm">
				Folded preview — one column per zone, handles off.
			</span>
		{/if}
	</div>

	<div
		class="spike-stage {folded ? 'is-folded' : ''}"
		style={stageWidth ? `width:${stageWidth}` : ""}
	>
		<div class="spike-rail" aria-hidden="true">
			<span class="spike-rail-dot"></span>
			<span class="spike-rail-dot"></span>
			<span class="spike-rail-dot"></span>
		</div>

		{#each ui.zones as zone (zone.id)}
			<section class="spike-zone" data-zone={zone.id}>
				<header class="spike-zone-head">
					<span class="text-surface-200 text-sm font-medium">
						{zone.title}
					</span>
					<span class="flex flex-wrap items-center gap-1">
						{#each zone.rows as row, i (i)}
							<button
								type="button"
								class="spike-chip"
								onclick={() => cycle(zone, "row", i)}
								title="Cycle this row's extent"
							>
								R{i + 1} · {extentLabel(row)}
							</button>
						{/each}
						{#if zone.cols.length > 1}
							{#each zone.cols as col, i (i)}
								<button
									type="button"
									class="spike-chip"
									onclick={() => cycle(zone, "col", i)}
									title="Cycle this column's extent"
								>
									C{i + 1} · {extentLabel(col)}
								</button>
							{/each}
						{/if}
					</span>
				</header>

				<div
					class="spike-grid"
					bind:this={els[zone.id]}
					style="grid-template-rows: {template(
						zone,
						'row'
					)}; grid-template-columns: {template(
						zone,
						'col'
					)}; gap: {GAP}px;"
				>
					{#each zone.units as u (u.key)}
						<article
							class="spike-unit"
							data-unit={u.key}
							style={area(zone, u)}
						>
							<div class="spike-unit-head">
								<button
									type="button"
									class="spike-grip"
									aria-label="Move {u.title}"
									onpointerdown={(e) =>
										startDrag(e, u, zone.id)}
									onpointermove={moveDrag}
									onpointerup={endDrag}
									onpointercancel={endDrag}
								>
									<span class="spike-grip-dots"></span>
								</button>
								<span class="text-surface-200 truncate text-sm">
									{u.title}
								</span>
							</div>
							<div class="spike-unit-body">
								{u.cells?.minW ?? 1}×{u.cells?.minH ?? 1} min
							</div>
						</article>
					{/each}

					{#if !folded}
						{#each handlesFor(zone, "row") as handle (handle.index)}
							<button
								type="button"
								class="spike-handle is-row"
								style="top:{handle.at}px;"
								aria-label="Row {handle.index +
									1} size, {extentLabel(
									zone.rows[handle.index],
									trackPx(zone, 'row', handle.index)
								)}"
								onpointerdown={(e) =>
									startTrack(e, zone, "row", handle.index)}
								onpointermove={moveTrack}
								onpointerup={endTrack}
								onpointercancel={endTrack}
								onkeydown={(e) =>
									trackKey(e, zone, "row", handle.index)}
							>
								<span class="spike-handle-pill"></span>
							</button>
						{/each}
						{#each handlesFor(zone, "col") as handle (handle.index)}
							<button
								type="button"
								class="spike-handle is-col"
								style="left:{handle.at}px;"
								aria-label="Column {handle.index +
									1} size, {extentLabel(
									zone.cols[handle.index],
									trackPx(zone, 'col', handle.index)
								)}"
								onpointerdown={(e) =>
									startTrack(e, zone, "col", handle.index)}
								onpointermove={moveTrack}
								onpointerup={endTrack}
								onpointercancel={endTrack}
								onkeydown={(e) =>
									trackKey(e, zone, "col", handle.index)}
							>
								<span class="spike-handle-pill"></span>
							</button>
						{/each}
					{/if}

					{#each guidesFor(zone) as guide, i (i)}
						<div
							class="spike-guide"
							style="left:{guide.left}px; top:{guide.top}px; width:{guide.width}px; height:{guide.height}px;"
						></div>
						<span
							class="spike-guide-label"
							style="left:{guide.left}px; top:{guide.top}px;"
						>
							{guide.label}
						</span>
					{/each}
				</div>
			</section>
		{/each}
	</div>

	<section
		class="spike-tray {trayLit ? 'is-lit' : ''}"
		aria-label="Widgets not placed"
	>
		<span class="text-surface-500 text-xs tracking-wide uppercase">
			Tray
		</span>
		{#if ui.tray.length === 0}
			<span class="text-surface-500 text-sm">
				Drop a widget out here to remove it.
			</span>
		{:else}
			{#each ui.tray as u (u.key)}
				<button
					type="button"
					class="spike-tray-item"
					aria-label="Move {u.title} back into a zone"
					onpointerdown={(e) => startDrag(e, u, "tray")}
					onpointermove={moveDrag}
					onpointerup={endDrag}
					onpointercancel={endDrag}
				>
					{u.title}
				</button>
			{/each}
		{/if}
	</section>

	{#if ui.drag}
		<div class="spike-ghost" style="left:{ui.drag.x}px; top:{ui.drag.y}px;">
			{ui.drag.title}
		</div>
	{/if}

	{#if ui.refusal}
		<p class="spike-refusal">{ui.refusal}</p>
	{/if}

	<p class="sr-only" aria-live="polite">{ui.say}</p>
</div>

<style>
	.spike-stage {
		display: grid;
		grid-template-columns: 44px minmax(0, 1fr) 264px;
		gap: 12px;
		height: min(64vh, 560px);
		max-width: 100%;
		padding: 12px;
		border: 1px solid var(--color-surface-800);
		border-radius: 12px;
		background: var(--color-surface-900);
	}

	.spike-stage.is-folded {
		grid-template-columns: 44px minmax(0, 1fr);
		grid-template-rows: auto auto;
		height: auto;
	}

	.spike-stage.is-folded .spike-rail {
		grid-row: 1 / span 2;
	}

	.spike-rail {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		width: 44px;
		padding-block: 10px;
		border-radius: 10px;
		background: color-mix(in oklch, var(--color-surface-950), black 20%);
	}

	.spike-rail-dot {
		width: 24px;
		height: 24px;
		border-radius: 8px;
		background: var(--color-surface-800);
	}

	.spike-zone {
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
		min-height: 0;
		padding: 10px;
		border: 1px solid var(--color-surface-800);
		border-radius: 12px;
		background: var(--color-surface-950);
	}

	.spike-zone-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
	}

	.spike-chip {
		height: 28px;
		padding-inline: 10px;
		border: 1px solid var(--color-surface-800);
		border-radius: 999px;
		font-size: 0.75rem;
		color: var(--color-surface-200);
	}

	.spike-chip:hover {
		border-color: var(--color-primary-500);
		color: var(--color-primary-500);
	}

	.spike-grid {
		position: relative;
		display: grid;
		flex: 1;
		min-height: 0;
	}

	.spike-unit {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
		padding: 8px;
		border: 1px solid var(--color-surface-800);
		border-radius: 10px;
		background: var(--color-surface-900);
	}

	.spike-unit-head {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}

	.spike-grip {
		position: relative;
		z-index: 4;
		display: grid;
		flex: none;
		place-items: center;
		width: 44px;
		height: 44px;
		margin: -8px 0 -8px -4px;
		border-radius: 10px;
		color: var(--color-surface-400);
		cursor: grab;
		touch-action: none;
	}

	.spike-grip:hover,
	.spike-grip:focus-visible {
		color: var(--color-primary-500);
	}

	.spike-grip-dots {
		width: 12px;
		height: 16px;
		background-image: radial-gradient(
			currentColor 1.4px,
			transparent 1.5px
		);
		background-size: 6px 5px;
	}

	.spike-unit-body {
		flex: 1;
		min-height: 0;
		border-radius: 8px;
		background: repeating-linear-gradient(
			135deg,
			var(--color-surface-950) 0 8px,
			transparent 8px 16px
		);
		padding: 6px;
		font-size: 0.75rem;
		color: var(--color-surface-500);
	}

	/* Handles sit on the line, with a 44px hit area around a 6px pill. */
	.spike-handle {
		position: absolute;
		z-index: 2;
		display: grid;
		place-items: center;
		touch-action: none;
	}

	.spike-handle.is-row {
		left: 0;
		right: 0;
		height: 44px;
		transform: translateY(-50%);
		cursor: ns-resize;
	}

	.spike-handle.is-col {
		top: 0;
		bottom: 0;
		width: 44px;
		transform: translateX(-50%);
		cursor: ew-resize;
	}

	.spike-handle-pill {
		border-radius: 999px;
		background: var(--color-surface-800);
		transition: background 120ms ease;
	}

	.spike-handle.is-row .spike-handle-pill {
		width: 48px;
		height: 6px;
	}

	.spike-handle.is-col .spike-handle-pill {
		width: 6px;
		height: 48px;
	}

	.spike-handle:hover .spike-handle-pill,
	.spike-handle:focus-visible .spike-handle-pill {
		background: var(--color-primary-500);
	}

	.spike-handle:focus-visible {
		outline: 2px solid var(--color-primary-500);
		outline-offset: -2px;
		border-radius: 10px;
	}

	.spike-guide {
		position: absolute;
		z-index: 3;
		border-radius: 999px;
		background: var(--color-primary-500);
		box-shadow: 0 0 0 4px
			color-mix(in oklch, var(--color-primary-500), transparent 80%);
		pointer-events: none;
	}

	.spike-guide-label {
		position: absolute;
		z-index: 4;
		width: max-content;
		height: max-content;
		max-width: 100%;
		padding: 4px 8px;
		border-radius: 8px;
		background: var(--color-primary-500);
		color: var(--color-surface-950);
		font-size: 0.75rem;
		white-space: nowrap;
		pointer-events: none;
	}

	.spike-tray {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		min-height: 56px;
		padding: 8px 12px;
		border: 1px dashed var(--color-surface-800);
		border-radius: 12px;
	}

	.spike-tray.is-lit {
		border-color: var(--color-primary-500);
		border-style: solid;
	}

	.spike-tray-item {
		height: 44px;
		padding-inline: 12px;
		border: 1px solid var(--color-surface-800);
		border-radius: 10px;
		background: var(--color-surface-900);
		color: var(--color-surface-200);
		cursor: grab;
		touch-action: none;
	}

	.spike-ghost {
		position: fixed;
		z-index: 60;
		padding: 6px 10px;
		border-radius: 10px;
		background: var(--color-surface-800);
		color: var(--color-surface-50);
		font-size: 0.75rem;
		transform: translate(-50%, -140%);
		pointer-events: none;
	}

	.spike-refusal {
		position: fixed;
		bottom: 24px;
		left: 50%;
		z-index: 60;
		padding: 8px 14px;
		border-radius: 10px;
		background: var(--color-error-500);
		color: var(--color-surface-950);
		font-size: 0.875rem;
		transform: translateX(-50%);
	}
</style>
