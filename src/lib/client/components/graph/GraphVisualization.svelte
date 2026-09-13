<script lang="ts">
	import {
		edgePath,
		edgeBundleKey,
		aggregateEdgesByDirection,
		edgeCountColor,
		edgeCountWidth,
		EDGE_BASE_WIDTH,
		NODE_RADIUS
	} from "./edgeGeometry"
	/**
	 * Force-directed graph visualization using plain SVG.
	 * No external physics library — uses a simple Verlet integration loop.
	 *
	 * Features:
	 *  - Draggable nodes
	 *  - ⌥-drag from one node to another to name a relationship
	 *  - Scroll-to-zoom, drag-to-pan
	 *  - Fullscreen toggle
	 *  - Perspective-scoping: click a node to focus; out-of-scope nodes dim
	 *
	 * ⚠ **A node is addressed by key, not by id.** Cast members and entries are
	 * separate id spaces that collide at the same number, so identity here is
	 * `cast#3` / `entry#3`. The geometry underneath is keyed on a numeric slot
	 * instead, which is this drawing's own ordinal and means nothing outside it.
	 */
	import { onMount, onDestroy } from "svelte"
	import * as Icons from "@lucide/svelte"
	import type {
		GraphEdge,
		GraphNode
	} from "$lib/client/lorebooks/graphs/graphModel"

	interface Props {
		nodes: GraphNode[]
		edges: GraphEdge[]
		/** The node the side panel is open on, ringed so the two agree. */
		selectedKey?: string | null
		onNodeClick?: (node: GraphNode) => void
		onEdgeClick?: (edge: GraphEdge) => void
		/** ⌥-drag landed on a second node: name what joins them. */
		onLinkDraw?: (from: GraphNode, to: GraphNode) => void
	}

	let {
		nodes,
		edges,
		selectedKey = null,
		onNodeClick,
		onEdgeClick,
		onLinkDraw
	}: Props = $props()

	// ── Container / SVG refs ──────────────────────────────────────────────────
	let containerEl = $state<HTMLDivElement | undefined>(undefined)
	let svgEl = $state<SVGSVGElement | undefined>(undefined)
	let width = $state(600)
	let height = $state(450)

	// ── Simulation state ──────────────────────────────────────────────────────
	interface SimNode {
		/** This drawing's own ordinal, which the geometry bundles on. */
		id: number
		key: string
		kind: "cast" | "entry"
		x: number
		y: number
		vx: number
		vy: number
		label: string
		nodeState: string
		nodeVisibility: string
		pinned: boolean
	}

	interface SimEdge {
		source: number
		target: number
		edge: GraphEdge
	}

	let simNodes = $state<SimNode[]>([])
	let simEdges = $state<SimEdge[]>([])

	let rafId: number | null = null
	let dragNode: SimNode | null = null
	let dragOffsetX = 0
	let dragOffsetY = 0

	// Physics — looser spring + stronger repulsion so dense graphs breathe
	const REPULSION = 12000
	const SPRING_LEN = 180
	const SPRING_K = 0.04
	const DAMPING = 0.82
	const CENTER_PULL = 0.008
	const MAX_ITER = 500

	let iter = 0

	// ── Zoom / pan ────────────────────────────────────────────────────────────
	let panX = $state(0)
	let panY = $state(0)
	let zoom = $state(1)
	const MIN_ZOOM = 0.1
	const MAX_ZOOM = 8

	let isPanning = $state(false)
	let panStartClientX = 0
	let panStartClientY = 0
	let panStartPanX = 0
	let panStartPanY = 0

	function resetView() {
		panX = 0
		panY = 0
		zoom = 1
	}

	function clientToViewBox(cx: number, cy: number): [number, number] {
		if (!svgEl) return [0, 0]
		const r = svgEl.getBoundingClientRect()
		return [
			(cx - r.left) * (width / r.width),
			(cy - r.top) * (height / r.height)
		]
	}

	function viewBoxToSim(vx: number, vy: number): [number, number] {
		return [(vx - panX) / zoom, (vy - panY) / zoom]
	}

	// ── Fullscreen ────────────────────────────────────────────────────────────
	let isFullscreen = $state(false)

	function toggleFullscreen() {
		if (!containerEl) return
		if (!document.fullscreenElement) {
			containerEl.requestFullscreen()
		} else {
			document.exitFullscreen()
		}
	}

	// ── Perspective scope ─────────────────────────────────────────────────────
	let perspectiveKey = $state<string | null>(null)

	/** Direct neighbors of the focal node (1-hop, both directions). */
	let inScopeKeys = $derived.by((): Set<string> | null => {
		if (perspectiveKey === null) return null
		const keys = new Set<string>([perspectiveKey])
		for (const e of edges) {
			if (e.fromKey === perspectiveKey) keys.add(e.toKey)
			else if (e.toKey === perspectiveKey) keys.add(e.fromKey)
		}
		return keys
	})

	function inScope(key: string): boolean {
		return inScopeKeys === null || inScopeKeys.has(key)
	}

	/** Only show edges that directly touch the focal node. */
	function edgeInScope(srcSlot: number, tgtSlot: number): boolean {
		if (inScopeKeys === null) return true
		return (
			keyOfSlot(srcSlot) === perspectiveKey ||
			keyOfSlot(tgtSlot) === perspectiveKey
		)
	}

	function clearPerspective() {
		perspectiveKey = null
	}

	/**
	 * Edge labels are shown when the view is actually readable, not always.
	 *
	 * Fanning parallel edges apart stops a pair's own labels from landing on top
	 * of each other, but it cannot help with the other half of the problem: in a
	 * dense cluster, labels belonging to *different* pairs still crowd, because
	 * they compete for the same middle of the graph. Drawing every one of them at
	 * every zoom level makes the default view unreadable.
	 *
	 * So the structure is shown by default and the vocabulary on demand —
	 * either by focusing a node (which already dims everything unrelated, so
	 * only a handful of edges remain) or by zooming in far enough that the
	 * labels have room. Both are things a user already does to inspect a graph.
	 */
	const LABEL_ZOOM_THRESHOLD = 1.4
	let showEdgeLabels = $derived(
		perspectiveKey !== null || zoom >= LABEL_ZOOM_THRESHOLD
	)

	/**
	 * Zoomed out and unfocused, every relationship between a pair collapses to
	 * one arrow per direction carrying a count. Focusing a node or zooming in
	 * expands them back to individual typed edges — the same gesture that
	 * reveals labels, so there is one rule to learn rather than two.
	 */
	let aggregated = $derived(!showEdgeLabels)

	let aggregatedEdges = $derived.by(() => {
		const aggs = aggregateEdgesByDirection(
			simEdges.map((e) => ({
				source: e.source,
				target: e.target,
				status: e.edge.status
			}))
		)
		// Fan the two directions of a pair apart using the same bundling rule
		// as individual edges, so an aggregated pair reads the same way.
		const totals = new Map<string, number>()
		for (const a of aggs) {
			const k = edgeBundleKey(a.source, a.target)
			totals.set(k, (totals.get(k) ?? 0) + 1)
		}
		const counters = new Map<string, number>()
		return aggs.map((a) => {
			const k = edgeBundleKey(a.source, a.target)
			const idx = counters.get(k) ?? 0
			counters.set(k, idx + 1)
			return { agg: a, idx, total: totals.get(k) ?? 1 }
		})
	})

	// ── Simulation ────────────────────────────────────────────────────────────
	function initSim() {
		iter = 0
		const slots = new Map<string, number>()
		const angleStep = (2 * Math.PI) / Math.max(nodes.length, 1)

		simNodes = nodes.map((n, i) => {
			const angle = i * angleStep
			const r = Math.min(width, height) * 0.35
			slots.set(n.key, i)
			return {
				id: i,
				key: n.key,
				kind: n.kind,
				x: width / 2 + r * Math.cos(angle) + (Math.random() - 0.5) * 30,
				y:
					height / 2 +
					r * Math.sin(angle) +
					(Math.random() - 0.5) * 30,
				vx: 0,
				vy: 0,
				label: n.name,
				nodeState: n.state ?? "active",
				nodeVisibility: n.visibility ?? "normal",
				pinned: false
			}
		})

		simEdges = edges
			.filter((e) => slots.has(e.fromKey) && slots.has(e.toKey))
			.map((e) => ({
				source: slots.get(e.fromKey)!,
				target: slots.get(e.toKey)!,
				edge: e
			}))

		startSimulation()
	}

	function tick() {
		if (iter >= MAX_ITER && dragNode === null) return

		if (dragNode !== null) {
			rafId = requestAnimationFrame(tick)
			return
		}

		iter++
		const nodeMap = new Map(simNodes.map((n) => [n.id, n]))

		for (const n of simNodes) {
			if (n.pinned) continue
			let fx = 0,
				fy = 0

			// Weak center gravity
			fx += (width / 2 - n.x) * CENTER_PULL
			fy += (height / 2 - n.y) * CENTER_PULL

			// Repulsion
			for (const m of simNodes) {
				if (m.id === n.id) continue
				const dx = n.x - m.x
				const dy = n.y - m.y
				const dist2 = dx * dx + dy * dy + 0.01
				const dist = Math.sqrt(dist2)
				const force = REPULSION / dist2
				fx += (dx / dist) * force
				fy += (dy / dist) * force
			}

			// Spring attraction
			for (const e of simEdges) {
				if (e.source !== n.id && e.target !== n.id) continue
				const otherId = e.source === n.id ? e.target : e.source
				const other = nodeMap.get(otherId)
				if (!other) continue
				const dx = other.x - n.x
				const dy = other.y - n.y
				const dist = Math.sqrt(dx * dx + dy * dy) + 0.01
				const stretch = dist - SPRING_LEN
				fx += (dx / dist) * stretch * SPRING_K
				fy += (dy / dist) * stretch * SPRING_K
			}

			n.vx = (n.vx + fx) * DAMPING
			n.vy = (n.vy + fy) * DAMPING
			n.x += n.vx
			n.y += n.vy
			// No hard clamp — pan/zoom lets the user navigate
		}

		simNodes = [...simNodes]
		rafId = requestAnimationFrame(tick)
	}

	function startSimulation() {
		if (rafId !== null) cancelAnimationFrame(rafId)
		iter = 0
		rafId = requestAnimationFrame(tick)
	}

	function stopSimulation() {
		if (rafId !== null) {
			cancelAnimationFrame(rafId)
			rafId = null
		}
	}

	// ── Drawing a relationship ────────────────────────────────────────────────
	/**
	 * ⌥-drag names a relationship; a plain drag moves a node.
	 *
	 * The modifier is read at pointerdown and held for the gesture: releasing
	 * the key mid-drag must not turn a link being drawn into a node being
	 * flung across the canvas.
	 */
	let linkFrom = $state<SimNode | null>(null)
	let linkX = $state(0)
	let linkY = $state(0)

	/** The node a drop would land on, or nothing when it lands on nowhere. */
	const HIT_RADIUS = NODE_RADIUS * 1.5

	function nodeAt(x: number, y: number, except?: SimNode): SimNode | null {
		let best: SimNode | null = null
		let bestDist = HIT_RADIUS
		for (const n of simNodes) {
			if (except && n.id === except.id) continue
			const dist = Math.hypot(n.x - x, n.y - y)
			if (dist > bestDist) continue
			best = n
			bestDist = dist
		}
		return best
	}

	let linkTarget = $derived(linkFrom ? nodeAt(linkX, linkY, linkFrom) : null)

	function finishLink() {
		const from = linkFrom
		const target = linkTarget
		linkFrom = null
		if (!from || !target) return
		const a = nodes.find((n) => n.key === from.key)
		const b = nodes.find((n) => n.key === target.key)
		if (a && b) onLinkDraw?.(a, b)
	}

	// ── Drag ──────────────────────────────────────────────────────────────────
	function onNodePointerDown(e: PointerEvent, node: SimNode) {
		e.stopPropagation()
		if (!svgEl) return
		const [vx, vy] = clientToViewBox(e.clientX, e.clientY)
		const [sx, sy] = viewBoxToSim(vx, vy)
		if (e.altKey && onLinkDraw) {
			e.preventDefault()
			linkFrom = node
			linkX = sx
			linkY = sy
			return
		}
		dragNode = node
		node.pinned = true
		dragOffsetX = sx - node.x
		dragOffsetY = sy - node.y
		if (rafId === null) rafId = requestAnimationFrame(tick)
	}

	// ── Pan ───────────────────────────────────────────────────────────────────
	// Track whether the pointer moved since pointerdown to distinguish click vs drag
	let pointerMoved = false

	function onSvgPointerDown(e: PointerEvent) {
		if (e.button !== 0 || dragNode || linkFrom) return
		isPanning = true
		pointerMoved = false
		panStartClientX = e.clientX
		panStartClientY = e.clientY
		panStartPanX = panX
		panStartPanY = panY
	}

	function onSvgPointerMove(e: PointerEvent) {
		if (linkFrom && svgEl) {
			const [vx, vy] = clientToViewBox(e.clientX, e.clientY)
			const [sx, sy] = viewBoxToSim(vx, vy)
			linkX = sx
			linkY = sy
		} else if (dragNode && svgEl) {
			const [vx, vy] = clientToViewBox(e.clientX, e.clientY)
			const [sx, sy] = viewBoxToSim(vx, vy)
			dragNode.x = sx - dragOffsetX
			dragNode.y = sy - dragOffsetY
			dragNode.vx = 0
			dragNode.vy = 0
			simNodes = [...simNodes]
		} else if (isPanning && svgEl) {
			const dx = e.clientX - panStartClientX
			const dy = e.clientY - panStartClientY
			if (Math.abs(dx) > 3 || Math.abs(dy) > 3) pointerMoved = true
			const r = svgEl.getBoundingClientRect()
			const toVB = width / r.width
			panX = panStartPanX + dx * toVB
			panY = panStartPanY + dy * toVB
		}
	}

	function onSvgPointerUp(_e: PointerEvent) {
		if (linkFrom) {
			finishLink()
		} else if (dragNode) {
			dragNode.pinned = false
			dragNode = null
			iter = 0
			if (rafId === null) rafId = requestAnimationFrame(tick)
		} else if (isPanning && !pointerMoved) {
			// Tap on background — clear perspective
			clearPerspective()
		}
		isPanning = false
	}

	// ── Zoom ──────────────────────────────────────────────────────────────────
	function onSvgWheel(e: WheelEvent) {
		e.preventDefault()
		const [vx, vy] = clientToViewBox(e.clientX, e.clientY)
		const [simX, simY] = viewBoxToSim(vx, vy)
		const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
		const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor))
		panX = vx - simX * newZoom
		panY = vy - simY * newZoom
		zoom = newZoom
	}

	// ── Lifecycle ─────────────────────────────────────────────────────────────
	onMount(() => {
		initSim()
		svgEl?.addEventListener("wheel", onSvgWheel, { passive: false })

		const onFsChange = () => {
			isFullscreen = !!document.fullscreenElement
		}
		document.addEventListener("fullscreenchange", onFsChange)

		return () => {
			svgEl?.removeEventListener("wheel", onSvgWheel)
			document.removeEventListener("fullscreenchange", onFsChange)
		}
	})

	onDestroy(() => stopSimulation())

	$effect(() => {
		nodes.length
		edges.length
		initSim()
	})

	onMount(() => {
		if (!svgEl?.parentElement) return
		const ro = new ResizeObserver((entries) => {
			const e = entries[0]
			width = e.contentRect.width || 600
			height = Math.max(e.contentRect.height, 300) || 450
			initSim()
		})
		ro.observe(svgEl.parentElement)
		return () => ro.disconnect()
	})

	// ── Colors & dash patterns ────────────────────────────────────────────────
	const NODE_STATE_COLORS: Record<string, string> = {
		active: "#6366f1",
		deceased: "#ef4444",
		missing: "#6b7280",
		departed: "#f59e0b"
	}

	/** An entry is a place or a thing rather than somebody, and reads apart. */
	const ENTRY_COLOR = "#0ea5e9"

	const REL_STATUS_DASH: Record<string, string> = {
		active: "none",
		resolved: "4 2",
		broken: "2 3",
		evolved: "6 2 2 2"
	}

	function nodeColor(node: { kind: string; nodeState: string }) {
		if (node.kind === "entry") return ENTRY_COLOR
		return NODE_STATE_COLORS[node.nodeState] ?? "#6366f1"
	}
	function edgeDash(s: string) {
		return REL_STATUS_DASH[s] ?? "none"
	}
	function getSimNode(slot: number) {
		return simNodes.find((n) => n.id === slot)
	}
	function keyOfSlot(slot: number): string | null {
		return getSimNode(slot)?.key ?? null
	}

	// ── Parallel edge bundling ────────────────────────────────────────────────

	let indexedEdges = $derived.by(() => {
		const totals = new Map<string, number>()
		for (const edge of simEdges) {
			const key = edgeBundleKey(edge.source, edge.target)
			totals.set(key, (totals.get(key) ?? 0) + 1)
		}
		const counters = new Map<string, number>()
		return simEdges.map((edge) => {
			const key = edgeBundleKey(edge.source, edge.target)
			const idx = counters.get(key) ?? 0
			counters.set(key, idx + 1)
			return { edge, idx, total: totals.get(key) ?? 1 }
		})
	})

	// Focal node name for toolbar display
	let perspectiveNodeName = $derived(
		perspectiveKey === null
			? null
			: (nodes.find((n) => n.key === perspectiveKey)?.name ?? null)
	)
</script>

<div
	bind:this={containerEl}
	class="bg-surface-950 relative h-full w-full overflow-hidden rounded-lg"
>
	<!-- ── Toolbar ──────────────────────────────────────────────────────── -->
	<div
		class="pointer-events-none absolute top-2 right-2 left-2 z-10 flex items-center gap-1.5"
	>
		<!-- Perspective pill -->
		{#if perspectiveKey !== null}
			<div
				class="bg-surface-200-800/90 pointer-events-auto flex items-center gap-1 rounded px-2 py-1 backdrop-blur-sm"
			>
				<Icons.Crosshair size={12} class="text-primary-400 shrink-0" />
				<span class="text-surface-200 max-w-36 truncate text-xs">
					{perspectiveNodeName}
				</span>
				<span class="text-surface-700-300 ml-0.5 text-xs">
					· direct
				</span>
				<button
					class="text-surface-700-300 hover:text-surface-200 ml-1 p-1.5"
					onclick={clearPerspective}
					title="Clear perspective (or click background)"
					aria-label="Clear perspective"
				>
					<Icons.X size={12} />
				</button>
			</div>
		{/if}

		<div class="flex-1"></div>

		<!-- Fullscreen toggle -->
		<button
			class="bg-surface-200-800/80 text-surface-400 hover:text-surface-200 pointer-events-auto rounded p-1.5 backdrop-blur-sm"
			onclick={toggleFullscreen}
			title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
			aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
		>
			{#if isFullscreen}
				<Icons.Minimize2 size={14} />
			{:else}
				<Icons.Maximize2 size={14} />
			{/if}
		</button>
	</div>

	<!-- ── SVG ─────────────────────────────────────────────────────────── -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<svg
		bind:this={svgEl}
		class="h-full w-full {isPanning ? 'cursor-grabbing' : 'cursor-grab'}"
		viewBox="0 0 {width} {height}"
		preserveAspectRatio="xMidYMid meet"
		data-graph-canvas
		onpointerdown={onSvgPointerDown}
		onpointermove={onSvgPointerMove}
		onpointerup={onSvgPointerUp}
		onpointerleave={onSvgPointerUp}
	>
		<defs>
			<marker
				id="arrowhead"
				markerWidth="8"
				markerHeight="6"
				refX="8"
				refY="3"
				orient="auto"
			>
				<polygon points="0 0, 8 3, 0 6" fill="#6b7280" opacity="0.6" />
			</marker>
		</defs>

		<g transform="translate({panX}, {panY}) scale({zoom})">
			<!-- Edges — aggregated when zoomed out, individual when not -->
			{#if aggregated}
				{#each aggregatedEdges as { agg, idx, total }}
					{@const srcNode = getSimNode(agg.source)}
					{@const tgtNode = getSimNode(agg.target)}
					{#if srcNode && tgtNode}
						{@const ep = edgePath(srcNode, tgtNode, idx, total)}
						{@const scoped = edgeInScope(agg.source, agg.target)}
						{@const stroke = edgeCountColor(agg.liveCount)}
						<path
							d={ep.d}
							{stroke}
							stroke-width={edgeCountWidth(agg.liveCount)}
							stroke-opacity={scoped ? 0.75 : 0.1}
							stroke-dasharray={agg.liveCount === 0
								? "4 3"
								: "none"}
							fill="none"
							marker-end="url(#arrowhead)"
							class="transition-opacity"
						>
							<title>
								{agg.liveCount} active of {agg.totalCount} relationship{agg.totalCount ===
								1
									? ""
									: "s"}
							</title>
						</path>
						{#if scoped && agg.liveCount > 0}
							<text
								x={ep.labelX}
								y={ep.labelY + 3}
								text-anchor="middle"
								font-size="10"
								font-weight="600"
								fill={stroke}
								class="pointer-events-none select-none"
							>
								{agg.liveCount}
							</text>
						{/if}
					{/if}
				{/each}
			{:else}
				{#each indexedEdges as { edge, idx, total }}
					{@const srcNode = getSimNode(edge.source)}
					{@const tgtNode = getSimNode(edge.target)}
					{#if srcNode && tgtNode}
						{@const ep = edgePath(srcNode, tgtNode, idx, total)}
						{@const scoped = edgeInScope(edge.source, edge.target)}
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<path
							d={ep.d}
							stroke="#6b7280"
							stroke-width={EDGE_BASE_WIDTH}
							stroke-opacity={scoped ? 0.55 : 0.1}
							stroke-dasharray={edgeDash(edge.edge.status)}
							fill="none"
							marker-end="url(#arrowhead)"
							class="cursor-pointer transition-opacity"
							data-graph-edge={edge.edge.id}
							onclick={() => onEdgeClick?.(edge.edge)}
						/>
						{#if scoped && showEdgeLabels}
							<text
								x={ep.labelX}
								y={ep.labelY - 4}
								text-anchor="middle"
								font-size="9"
								fill="#9ca3af"
								class="pointer-events-none select-none"
							>
								{edge.edge.label}
							</text>
						{/if}
					{/if}
				{/each}
			{/if}

			<!-- The relationship being drawn, until it lands on something -->
			{#if linkFrom}
				<line
					x1={linkFrom.x}
					y1={linkFrom.y}
					x2={linkX}
					y2={linkY}
					stroke="#f59e0b"
					stroke-width="2"
					stroke-dasharray="5 3"
					class="pointer-events-none"
				/>
				{#if linkTarget}
					<circle
						cx={linkTarget.x}
						cy={linkTarget.y}
						r={NODE_RADIUS + 7}
						fill="none"
						stroke="#f59e0b"
						stroke-width="2"
						class="pointer-events-none"
					/>
				{/if}
			{/if}

			<!-- Nodes -->
			{#each simNodes as node}
				{@const scoped = inScope(node.key)}
				{@const isFocal = node.key === perspectiveKey}
				{@const color = nodeColor(node)}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<g
					class="cursor-pointer"
					data-graph-node={node.key}
					onclick={() => {
						if (perspectiveKey === node.key) {
							clearPerspective()
						} else {
							perspectiveKey = node.key
						}
						const origNode = nodes.find((n) => n.key === node.key)
						if (origNode) onNodeClick?.(origNode)
					}}
					onpointerdown={(e) => onNodePointerDown(e, node)}
					opacity={scoped ? 1 : 0.12}
					style="transition: opacity 0.2s"
				>
					<title>{node.label} ({node.nodeState})</title>
					<!-- Focal dashed ring -->
					{#if isFocal || node.key === selectedKey}
						<circle
							cx={node.x}
							cy={node.y}
							r={NODE_RADIUS + 6}
							fill="none"
							stroke={color}
							stroke-width="2"
							stroke-dasharray="4 2"
							opacity="0.8"
						/>
					{/if}
					<!-- Legendary gold ring -->
					{#if node.nodeVisibility === "legendary"}
						<circle
							cx={node.x}
							cy={node.y}
							r={NODE_RADIUS + 4}
							fill="none"
							stroke="#f59e0b"
							stroke-width="2"
							opacity="0.9"
						/>
					{/if}
					{#if node.kind === "entry"}
						<!-- An entry is a square so the two kinds are told apart
						     without reading a label. -->
						<rect
							x={node.x - NODE_RADIUS * 0.85}
							y={node.y - NODE_RADIUS * 0.85}
							width={NODE_RADIUS * 1.7}
							height={NODE_RADIUS * 1.7}
							rx="5"
							fill={color}
							stroke="rgba(255,255,255,0.25)"
							stroke-width="1.5"
							opacity="0.9"
						/>
					{:else}
						<circle
							cx={node.x}
							cy={node.y}
							r={NODE_RADIUS}
							fill={color}
							stroke="rgba(255,255,255,0.25)"
							stroke-width="1.5"
							opacity={node.nodeVisibility === "hidden"
								? 0.4
								: 0.9}
						/>
					{/if}
					<!-- Deceased X mark -->
					{#if node.nodeState === "deceased"}
						<line
							x1={node.x - 6}
							y1={node.y - 6}
							x2={node.x + 6}
							y2={node.y + 6}
							stroke="white"
							stroke-width="1.5"
							opacity="0.5"
							class="pointer-events-none"
						/>
						<line
							x1={node.x + 6}
							y1={node.y - 6}
							x2={node.x - 6}
							y2={node.y + 6}
							stroke="white"
							stroke-width="1.5"
							opacity="0.5"
							class="pointer-events-none"
						/>
					{/if}
					<text
						x={node.x}
						y={node.y + 1}
						text-anchor="middle"
						dominant-baseline="middle"
						font-size="9"
						font-weight="600"
						fill="white"
						class="pointer-events-none select-none"
					>
						{node.label.length > 12
							? node.label.slice(0, 11) + "…"
							: node.label}
					</text>
				</g>
			{/each}
		</g>
	</svg>

	{#if nodes.length === 0}
		<div
			class="text-surface-400 absolute inset-0 flex items-center justify-center text-sm"
		>
			No nodes in graph yet.
		</div>
	{/if}

	<!-- ── Bottom-left: zoom level + reset ─────────────────────────────── -->
	<div class="absolute bottom-2 left-2 flex items-center gap-1">
		<button
			class="bg-surface-200-800/80 text-surface-400 hover:text-surface-200 rounded px-2 py-1 text-xs backdrop-blur-sm"
			onclick={resetView}
			title="Reset zoom and pan (click)"
		>
			{Math.round(zoom * 100)}%
		</button>
	</div>

	<!-- ── Bottom-right: legend ────────────────────────────────────────── -->
	<details class="absolute right-2 bottom-2 text-xs" style="bottom: 2.5rem">
		<summary
			class="bg-surface-200-800/80 text-surface-400 cursor-pointer rounded px-2 py-1 backdrop-blur-sm select-none"
		>
			Legend
		</summary>
		<div
			class="bg-surface-200-800/90 min-w-40 space-y-2 rounded-lg p-2 backdrop-blur-sm"
			style="position:absolute;bottom:100%;right:0;margin-bottom:4px"
		>
			<div class="space-y-1">
				<p
					class="text-surface-700-300 font-semibold tracking-wide uppercase"
					style="font-size:9px"
				>
					Node state
				</p>
				{#each Object.entries(NODE_STATE_COLORS) as [state, color]}
					<div class="flex items-center gap-1.5">
						<svg width="16" height="16" class="shrink-0">
							<circle
								cx="8"
								cy="8"
								r="7"
								fill={color}
								opacity="0.9"
							/>
							{#if state === "deceased"}
								<line
									x1="4"
									y1="4"
									x2="12"
									y2="12"
									stroke="white"
									stroke-width="1.5"
									opacity="0.5"
								/>
								<line
									x1="12"
									y1="4"
									x2="4"
									y2="12"
									stroke="white"
									stroke-width="1.5"
									opacity="0.5"
								/>
							{/if}
						</svg>
						<span class="text-surface-300 capitalize">{state}</span>
					</div>
				{/each}
				<div class="mt-0.5 flex items-center gap-1.5">
					<svg width="16" height="16" class="shrink-0">
						<circle
							cx="8"
							cy="8"
							r="6"
							fill="#6366f1"
							opacity="0.9"
						/>
						<circle
							cx="8"
							cy="8"
							r="7"
							fill="none"
							stroke="#f59e0b"
							stroke-width="2"
							opacity="0.9"
						/>
					</svg>
					<span class="text-surface-300">legendary</span>
				</div>
				<div class="mt-0.5 flex items-center gap-1.5">
					<svg width="16" height="16" class="shrink-0">
						<rect
							x="2"
							y="2"
							width="12"
							height="12"
							rx="3"
							fill={ENTRY_COLOR}
							opacity="0.9"
						/>
					</svg>
					<span class="text-surface-300">entry</span>
				</div>
			</div>
			<div class="border-surface-600 space-y-1 border-t pt-2">
				<p
					class="text-surface-700-300 font-semibold tracking-wide uppercase"
					style="font-size:9px"
				>
					Edge status
				</p>
				{#each [["active", "none"], ["resolved", "4 2"], ["broken", "2 3"], ["evolved", "6 2 2 2"]] as [status, dash]}
					<div class="flex items-center gap-1.5">
						<svg width="24" height="8" class="shrink-0">
							<line
								x1="0"
								y1="4"
								x2="24"
								y2="4"
								stroke="#6b7280"
								stroke-width="1.5"
								stroke-dasharray={dash}
							/>
						</svg>
						<span class="text-surface-300">{status}</span>
					</div>
				{/each}
			</div>
		</div>
	</details>
</div>
