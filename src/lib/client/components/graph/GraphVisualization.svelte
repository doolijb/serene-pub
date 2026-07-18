<script lang="ts">
	/**
	 * Force-directed graph visualization using plain SVG.
	 * No external physics library — uses a simple Verlet integration loop.
	 *
	 * Features:
	 *  - Draggable nodes
	 *  - Scroll-to-zoom, drag-to-pan
	 *  - Fullscreen toggle
	 *  - Perspective-scoping: click a node to focus; out-of-scope nodes dim
	 *  - Hop-limited traversal: 1 / 2 / 3 / ∞ hops from focal node
	 */
	import { onMount, onDestroy } from "svelte"
	import * as Icons from "@lucide/svelte"

	type NarrativeNode = Sockets.NarrativeGraph.NarrativeNode
	type NarrativeRelationship = Sockets.NarrativeGraph.NarrativeRelationship

	interface Props {
		nodes: NarrativeNode[]
		relationships: NarrativeRelationship[]
		onNodeClick?: (node: NarrativeNode) => void
		onRelClick?: (rel: NarrativeRelationship) => void
	}

	let { nodes, relationships, onNodeClick, onRelClick }: Props = $props()

	// ── Container / SVG refs ──────────────────────────────────────────────────
	let containerEl = $state<HTMLDivElement | undefined>(undefined)
	let svgEl = $state<SVGSVGElement | undefined>(undefined)
	let width = $state(600)
	let height = $state(450)

	// ── Simulation state ──────────────────────────────────────────────────────
	interface SimNode {
		id: number
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
		rel: NarrativeRelationship
	}

	let simNodes = $state<SimNode[]>([])
	let simEdges = $state<SimEdge[]>([])

	let rafId: number | null = null
	let dragNode: SimNode | null = null
	let dragOffsetX = 0
	let dragOffsetY = 0

	// Physics — looser spring + stronger repulsion so dense graphs breathe
	const REPULSION  = 12000
	const SPRING_LEN = 180
	const SPRING_K   = 0.04
	const DAMPING    = 0.82
	const CENTER_PULL = 0.008
	const NODE_RADIUS = 22
	const MAX_ITER   = 500

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
		panX = 0; panY = 0; zoom = 1
	}

	function clientToViewBox(cx: number, cy: number): [number, number] {
		if (!svgEl) return [0, 0]
		const r = svgEl.getBoundingClientRect()
		return [(cx - r.left) * (width / r.width), (cy - r.top) * (height / r.height)]
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
	let perspectiveNodeId = $state<number | null>(null)

	/** Direct neighbors of the focal node (1-hop, both directions). */
	let inScopeIds = $derived.by((): Set<number> | null => {
		if (perspectiveNodeId === null) return null
		const ids = new Set<number>([perspectiveNodeId])
		for (const r of relationships) {
			if (r.fromNodeId === perspectiveNodeId) ids.add(r.toNodeId)
			else if (r.toNodeId === perspectiveNodeId) ids.add(r.fromNodeId)
		}
		return ids
	})

	function inScope(id: number): boolean {
		return inScopeIds === null || inScopeIds.has(id)
	}

	/** Only show edges that directly touch the focal node. */
	function edgeInScope(src: number, tgt: number): boolean {
		if (inScopeIds === null) return true
		return src === perspectiveNodeId || tgt === perspectiveNodeId
	}

	function clearPerspective() {
		perspectiveNodeId = null
	}

	// ── Simulation ────────────────────────────────────────────────────────────
	function initSim() {
		iter = 0
		const nodeMap = new Map<number, SimNode>()
		const angleStep = (2 * Math.PI) / Math.max(nodes.length, 1)

		simNodes = nodes.map((n, i) => {
			const angle = i * angleStep
			const r = Math.min(width, height) * 0.35
			const node: SimNode = {
				id: n.id,
				x: width / 2 + r * Math.cos(angle) + (Math.random() - 0.5) * 30,
				y: height / 2 + r * Math.sin(angle) + (Math.random() - 0.5) * 30,
				vx: 0, vy: 0,
				label: n.name,
				nodeState: n.nodeState ?? "active",
				nodeVisibility: n.nodeVisibility ?? "normal",
				pinned: false
			}
			nodeMap.set(n.id, node)
			return node
		})

		simEdges = relationships
			.filter((r) => nodeMap.has(r.fromNodeId) && nodeMap.has(r.toNodeId))
			.map((r) => ({ source: r.fromNodeId, target: r.toNodeId, rel: r }))

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
			let fx = 0, fy = 0

			// Weak center gravity
			fx += (width / 2 - n.x) * CENTER_PULL
			fy += (height / 2 - n.y) * CENTER_PULL

			// Repulsion
			for (const m of simNodes) {
				if (m.id === n.id) continue
				const dx = n.x - m.x
				const dy = n.y - m.y
				const dist2 = dx * dx + dy * dy + 0.01
				const dist  = Math.sqrt(dist2)
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
			n.x  += n.vx
			n.y  += n.vy
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
		if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
	}

	// ── Drag ──────────────────────────────────────────────────────────────────
	function onNodePointerDown(e: PointerEvent, node: SimNode) {
		e.stopPropagation()
		if (!svgEl) return
		dragNode = node
		node.pinned = true
		const [vx, vy] = clientToViewBox(e.clientX, e.clientY)
		const [sx, sy] = viewBoxToSim(vx, vy)
		dragOffsetX = sx - node.x
		dragOffsetY = sy - node.y
		if (rafId === null) rafId = requestAnimationFrame(tick)
	}

	// ── Pan ───────────────────────────────────────────────────────────────────
	// Track whether the pointer moved since pointerdown to distinguish click vs drag
	let pointerMoved = false

	function onSvgPointerDown(e: PointerEvent) {
		if (e.button !== 0 || dragNode) return
		isPanning = true
		pointerMoved = false
		panStartClientX = e.clientX
		panStartClientY = e.clientY
		panStartPanX = panX
		panStartPanY = panY
	}

	function onSvgPointerMove(e: PointerEvent) {
		if (dragNode && svgEl) {
			const [vx, vy] = clientToViewBox(e.clientX, e.clientY)
			const [sx, sy] = viewBoxToSim(vx, vy)
			dragNode.x = sx - dragOffsetX
			dragNode.y = sy - dragOffsetY
			dragNode.vx = 0; dragNode.vy = 0
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
		if (dragNode) {
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

		const onFsChange = () => { isFullscreen = !!document.fullscreenElement }
		document.addEventListener("fullscreenchange", onFsChange)

		return () => {
			svgEl?.removeEventListener("wheel", onSvgWheel)
			document.removeEventListener("fullscreenchange", onFsChange)
		}
	})

	onDestroy(() => stopSimulation())

	$effect(() => {
		nodes.length
		relationships.length
		initSim()
	})

	onMount(() => {
		if (!svgEl?.parentElement) return
		const ro = new ResizeObserver((entries) => {
			const e = entries[0]
			width  = e.contentRect.width  || 600
			height = Math.max(e.contentRect.height, 300) || 450
			initSim()
		})
		ro.observe(svgEl.parentElement)
		return () => ro.disconnect()
	})

	// ── Colors & dash patterns ────────────────────────────────────────────────
	const NODE_STATE_COLORS: Record<string, string> = {
		active:   "#6366f1",
		deceased: "#ef4444",
		missing:  "#6b7280",
		departed: "#f59e0b"
	}

	const REL_STATUS_DASH: Record<string, string> = {
		active:   "none",
		resolved: "4 2",
		broken:   "2 3",
		evolved:  "6 2 2 2"
	}

	function nodeColor(state: string) { return NODE_STATE_COLORS[state] ?? "#6366f1" }
	function edgeDash(s: string)      { return REL_STATUS_DASH[s] ?? "none" }
	function getSimNode(id: number) { return simNodes.find((n) => n.id === id) }

	// ── Parallel edge bundling ────────────────────────────────────────────────
	const CURVE_SPACING = 38

	let indexedEdges = $derived.by(() => {
		const relLookup = new Map(relationships.map((r) => [r.id, r]))
		const totals = new Map<string, number>()
		for (const edge of simEdges) {
			const key = Math.min(edge.source, edge.target) + "-" + Math.max(edge.source, edge.target)
			totals.set(key, (totals.get(key) ?? 0) + 1)
		}
		const counters = new Map<string, number>()
		return simEdges.map((edge) => {
			const key = Math.min(edge.source, edge.target) + "-" + Math.max(edge.source, edge.target)
			const idx = counters.get(key) ?? 0
			counters.set(key, idx + 1)
			const liveRel = relLookup.get(edge.rel.id) ?? edge.rel
			return { edge: { ...edge, rel: liveRel }, idx, total: totals.get(key) ?? 1 }
		})
	})

	function edgePath(
		src: SimNode, tgt: SimNode, idx: number, total: number
	): { d: string; labelX: number; labelY: number } {
		const offset = (idx - (total - 1) / 2) * CURVE_SPACING
		const midX = (src.x + tgt.x) / 2
		const midY = (src.y + tgt.y) / 2
		const dx = tgt.x - src.x
		const dy = tgt.y - src.y
		const len = Math.sqrt(dx * dx + dy * dy) || 1
		const px = -dy / len
		const py =  dx / len
		const cx = midX + px * offset
		const cy = midY + py * offset
		const stDx = cx - src.x; const stDy = cy - src.y
		const stLen = Math.sqrt(stDx * stDx + stDy * stDy) || 1
		const x1 = src.x + (stDx / stLen) * NODE_RADIUS
		const y1 = src.y + (stDy / stLen) * NODE_RADIUS
		const etDx = tgt.x - cx; const etDy = tgt.y - cy
		const etLen = Math.sqrt(etDx * etDx + etDy * etDy) || 1
		const x2 = tgt.x - (etDx / etLen) * NODE_RADIUS
		const y2 = tgt.y - (etDy / etLen) * NODE_RADIUS
		const labelX = 0.25 * x1 + 0.5 * cx + 0.25 * x2
		const labelY = 0.25 * y1 + 0.5 * cy + 0.25 * y2
		return { d: `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`, labelX, labelY }
	}

	// Focal node name for toolbar display
	let perspectiveNodeName = $derived(
		perspectiveNodeId === null
			? null
			: (nodes.find((n) => n.id === perspectiveNodeId)?.name ?? null)
	)
</script>

<div
	bind:this={containerEl}
	class="relative h-full w-full overflow-hidden rounded-lg bg-surface-950"
>
	<!-- ── Toolbar ──────────────────────────────────────────────────────── -->
	<div class="absolute top-2 left-2 right-2 z-10 flex items-center gap-1.5 pointer-events-none">
		<!-- Perspective pill -->
		{#if perspectiveNodeId !== null}
			<div class="bg-surface-200-800/90 backdrop-blur-sm rounded flex items-center gap-1 px-2 py-1 pointer-events-auto">
				<Icons.Crosshair size={12} class="text-primary-400 shrink-0" />
				<span class="text-xs text-surface-200 max-w-36 truncate">{perspectiveNodeName}</span>
				<span class="text-surface-500 text-xs ml-0.5">· direct</span>
				<button
					class="ml-1 text-surface-500 hover:text-surface-200 p-1.5"
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
			class="bg-surface-200-800/80 text-surface-400 hover:text-surface-200 rounded p-1.5 backdrop-blur-sm pointer-events-auto"
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
		onpointerdown={onSvgPointerDown}
		onpointermove={onSvgPointerMove}
		onpointerup={onSvgPointerUp}
		onpointerleave={onSvgPointerUp}
	>
		<defs>
			<marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
				<polygon points="0 0, 8 3, 0 6" fill="#6b7280" opacity="0.6" />
			</marker>
		</defs>

		<g transform="translate({panX}, {panY}) scale({zoom})">
			<!-- Edges -->
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
						stroke-width="1.5"
						stroke-opacity={scoped ? 0.55 : 0.1}
						stroke-dasharray={edgeDash(edge.rel.status)}
						fill="none"
						marker-end="url(#arrowhead)"
						class="cursor-pointer transition-opacity"
						onclick={() => onRelClick?.(edge.rel)}
					/>
					{#if scoped}
						<text
							x={ep.labelX}
							y={ep.labelY - 4}
							text-anchor="middle"
							font-size="9"
							fill="#9ca3af"
							class="pointer-events-none select-none"
						>{edge.rel.relationshipType}</text>
					{/if}
				{/if}
			{/each}

			<!-- Nodes -->
			{#each simNodes as node}
				{@const scoped = inScope(node.id)}
				{@const isFocal = node.id === perspectiveNodeId}
				{@const color = nodeColor(node.nodeState)}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<g
					class="cursor-pointer"
					onclick={() => {
						if (perspectiveNodeId === node.id) {
							clearPerspective()
						} else {
							perspectiveNodeId = node.id
						}
						const origNode = nodes.find((n) => n.id === node.id)
						if (origNode) onNodeClick?.(origNode)
					}}
					onpointerdown={(e) => onNodePointerDown(e, node)}
					opacity={scoped ? 1 : 0.12}
					style="transition: opacity 0.2s"
				>
					<title>{node.label} ({node.nodeState})</title>
					<!-- Focal dashed ring -->
					{#if isFocal}
						<circle
							cx={node.x} cy={node.y}
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
							cx={node.x} cy={node.y}
							r={NODE_RADIUS + 4}
							fill="none"
							stroke="#f59e0b"
							stroke-width="2"
							opacity="0.9"
						/>
					{/if}
					<circle
						cx={node.x} cy={node.y}
						r={NODE_RADIUS}
						fill={color}
						stroke="rgba(255,255,255,0.25)"
						stroke-width="1.5"
						opacity={node.nodeVisibility === "hidden" ? 0.4 : 0.9}
					/>
					<!-- Deceased X mark -->
					{#if node.nodeState === "deceased"}
						<line x1={node.x - 6} y1={node.y - 6} x2={node.x + 6} y2={node.y + 6} stroke="white" stroke-width="1.5" opacity="0.5" class="pointer-events-none" />
						<line x1={node.x + 6} y1={node.y - 6} x2={node.x - 6} y2={node.y + 6} stroke="white" stroke-width="1.5" opacity="0.5" class="pointer-events-none" />
					{/if}
					<text
						x={node.x} y={node.y + 1}
						text-anchor="middle" dominant-baseline="middle"
						font-size="9" font-weight="600" fill="white"
						class="pointer-events-none select-none"
					>{node.label.length > 12 ? node.label.slice(0, 11) + "…" : node.label}</text>
				</g>
			{/each}
		</g>
	</svg>

	{#if nodes.length === 0}
		<div class="text-surface-400 absolute inset-0 flex items-center justify-center text-sm">
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
	<details class="absolute bottom-2 right-2 text-xs" style="bottom: 2.5rem">
		<summary class="bg-surface-200-800/80 text-surface-400 cursor-pointer select-none rounded px-2 py-1 backdrop-blur-sm">
			Legend
		</summary>
		<div class="bg-surface-200-800/90 rounded-lg p-2 backdrop-blur-sm space-y-2 min-w-40" style="position:absolute;bottom:100%;right:0;margin-bottom:4px">
			<div class="space-y-1">
				<p class="text-surface-500 font-semibold uppercase tracking-wide" style="font-size:9px">Node state</p>
				{#each Object.entries(NODE_STATE_COLORS) as [state, color]}
					<div class="flex items-center gap-1.5">
						<svg width="16" height="16" class="shrink-0">
							<circle cx="8" cy="8" r="7" fill={color} opacity="0.9" />
							{#if state === "deceased"}
								<line x1="4" y1="4" x2="12" y2="12" stroke="white" stroke-width="1.5" opacity="0.5" />
								<line x1="12" y1="4" x2="4" y2="12" stroke="white" stroke-width="1.5" opacity="0.5" />
							{/if}
						</svg>
						<span class="text-surface-300 capitalize">{state}</span>
					</div>
				{/each}
				<div class="flex items-center gap-1.5 mt-0.5">
					<svg width="16" height="16" class="shrink-0">
						<circle cx="8" cy="8" r="6" fill="#6366f1" opacity="0.9" />
						<circle cx="8" cy="8" r="7" fill="none" stroke="#f59e0b" stroke-width="2" opacity="0.9" />
					</svg>
					<span class="text-surface-300">legendary</span>
				</div>
			</div>
			<div class="border-surface-600 border-t pt-2 space-y-1">
				<p class="text-surface-500 font-semibold uppercase tracking-wide" style="font-size:9px">Edge status</p>
				{#each [["active","none"],["resolved","4 2"],["broken","2 3"],["evolved","6 2 2 2"]] as [status, dash]}
					<div class="flex items-center gap-1.5">
						<svg width="24" height="8" class="shrink-0">
							<line x1="0" y1="4" x2="24" y2="4" stroke="#6b7280" stroke-width="1.5" stroke-dasharray={dash} />
						</svg>
						<span class="text-surface-300">{status}</span>
					</div>
				{/each}
			</div>
		</div>
	</details>
</div>
