<script lang="ts">
	/**
	 * Force-directed graph visualization using plain SVG.
	 * No external physics library — uses a simple Verlet integration loop.
	 *
	 * Nodes are draggable. The simulation settles on its own.
	 */
	import { onMount, onDestroy } from "svelte"

	type NarrativeNode = Sockets.NarrativeGraph.NarrativeNode
	type NarrativeRelationship = Sockets.NarrativeGraph.NarrativeRelationship

	interface Props {
		nodes: NarrativeNode[]
		relationships: NarrativeRelationship[]
		onNodeClick?: (node: NarrativeNode) => void
		onRelClick?: (rel: NarrativeRelationship) => void
	}

	let { nodes, relationships, onNodeClick, onRelClick }: Props = $props()

	// ── SVG dimensions ────────────────────────────────────────────────────────
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
		nodeType: string
		pinned: boolean
	}

	interface SimEdge {
		source: number // node id
		target: number // node id
		rel: NarrativeRelationship
	}

	let simNodes = $state<SimNode[]>([])
	let simEdges = $state<SimEdge[]>([])

	let rafId: number | null = null
	let dragNode: SimNode | null = null
	let dragOffsetX = 0
	let dragOffsetY = 0

	// Constants
	const REPULSION = 4000
	const SPRING_LEN = 120
	const SPRING_K = 0.05
	const DAMPING = 0.85
	const CENTER_PULL = 0.01
	const NODE_RADIUS = 22
	const MAX_ITER = 300

	let iter = 0

	// ── Init simulation on prop change ────────────────────────────────────────
	function initSim() {
		iter = 0
		const nodeMap = new Map<number, SimNode>()
		const angleStep = (2 * Math.PI) / Math.max(nodes.length, 1)

		simNodes = nodes.map((n, i) => {
			const angle = i * angleStep
			const r = Math.min(width, height) * 0.3
			const node: SimNode = {
				id: n.id,
				x: width / 2 + r * Math.cos(angle) + (Math.random() - 0.5) * 20,
				y: height / 2 + r * Math.sin(angle) + (Math.random() - 0.5) * 20,
				vx: 0,
				vy: 0,
				label: n.name || n.nodeType,
				nodeType: n.nodeType,
				pinned: false
			}
			nodeMap.set(n.id, node)
			return node
		})

		simEdges = relationships
			.filter((r) => nodeMap.has(r.fromNodeId) && nodeMap.has(r.toNodeId))
			.map((r) => ({
				source: r.fromNodeId,
				target: r.toNodeId,
				rel: r
			}))

		startSimulation()
	}

	function tick() {
		if (iter >= MAX_ITER || dragNode !== null) {
			// Keep looping at low rate when dragging
			if (dragNode !== null) {
				rafId = requestAnimationFrame(tick)
			}
			return
		}

		iter++

		const nodeMap = new Map(simNodes.map((n) => [n.id, n]))

		// Apply forces
		for (const n of simNodes) {
			if (n.pinned) continue
			let fx = 0
			let fy = 0

			// Center gravity
			fx += (width / 2 - n.x) * CENTER_PULL
			fy += (height / 2 - n.y) * CENTER_PULL

			// Repulsion between all node pairs
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

			// Spring attraction along edges
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

			// Clamp to SVG bounds
			n.x = Math.max(NODE_RADIUS + 4, Math.min(width - NODE_RADIUS - 4, n.x))
			n.y = Math.max(NODE_RADIUS + 4, Math.min(height - NODE_RADIUS - 4, n.y))
		}

		// Trigger reactivity
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

	// ── Drag ──────────────────────────────────────────────────────────────────
	function onNodePointerDown(e: PointerEvent, node: SimNode) {
		e.stopPropagation()
		const svg = svgEl
		if (!svg) return
		dragNode = node
		node.pinned = true

		const svgRect = svg.getBoundingClientRect()
		const scaleX = width / svgRect.width
		const scaleY = height / svgRect.height
		dragOffsetX = (e.clientX - svgRect.left) * scaleX - node.x
		dragOffsetY = (e.clientY - svgRect.top) * scaleY - node.y

		// Resume loop while dragging
		if (rafId === null) rafId = requestAnimationFrame(tick)
	}

	function onSvgPointerMove(e: PointerEvent) {
		if (!dragNode || !svgEl) return
		const svgRect = svgEl.getBoundingClientRect()
		const scaleX = width / svgRect.width
		const scaleY = height / svgRect.height
		dragNode.x = (e.clientX - svgRect.left) * scaleX - dragOffsetX
		dragNode.y = (e.clientY - svgRect.top) * scaleY - dragOffsetY
		dragNode.vx = 0
		dragNode.vy = 0
		simNodes = [...simNodes]
	}

	function onSvgPointerUp() {
		if (!dragNode) return
		dragNode.pinned = false
		dragNode = null
		// Resume normal simulation
		iter = 0
		if (rafId === null) rafId = requestAnimationFrame(tick)
	}

	// ── Lifecycle ─────────────────────────────────────────────────────────────
	onMount(() => {
		initSim()
	})

	onDestroy(() => {
		stopSimulation()
	})

	// Re-init when props change
	$effect(() => {
		nodes.length
		relationships.length
		initSim()
	})

	// ResizeObserver
	onMount(() => {
		if (!svgEl?.parentElement) return
		const ro = new ResizeObserver((entries) => {
			const entry = entries[0]
			width = entry.contentRect.width || 600
			height = Math.max(entry.contentRect.height, 300) || 450
			initSim()
		})
		ro.observe(svgEl.parentElement)
		return () => ro.disconnect()
	})

	// ── Color by type ─────────────────────────────────────────────────────────
	const NODE_COLORS: Record<string, string> = {
		character: "#7c6af7",
		location: "#3b82f6",
		faction: "#f59e0b",
		item: "#10b981",
		concept: "#ec4899",
		event: "#f97316"
	}

	const REL_STATUS_DASH: Record<string, string> = {
		active: "none",
		resolved: "4 2",
		broken: "2 3",
		evolved: "6 2 2 2"
	}

	function nodeColor(nodeType: string) {
		return NODE_COLORS[nodeType] ?? "#6b7280"
	}

	function edgeDash(status: string) {
		return REL_STATUS_DASH[status] ?? "none"
	}

	function midpointLabel(
		a: SimNode,
		b: SimNode
	): { x: number; y: number } {
		return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
	}

	function getSimNode(id: number): SimNode | undefined {
		return simNodes.find((n) => n.id === id)
	}
</script>

<div class="relative h-full w-full overflow-hidden rounded-lg">
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<svg
		bind:this={svgEl}
		class="h-full w-full"
		viewBox="0 0 {width} {height}"
		preserveAspectRatio="xMidYMid meet"
		onpointermove={onSvgPointerMove}
		onpointerup={onSvgPointerUp}
		onpointerleave={onSvgPointerUp}
	>
		<!-- Arrow marker -->
		<defs>
			<marker
				id="arrowhead"
				markerWidth="8"
				markerHeight="6"
				refX="7"
				refY="3"
				orient="auto"
			>
				<polygon points="0 0, 8 3, 0 6" fill="#6b7280" opacity="0.6" />
			</marker>
		</defs>

		<!-- Edges -->
		{#each simEdges as edge}
			{@const srcNode = getSimNode(edge.source)}
			{@const tgtNode = getSimNode(edge.target)}
			{#if srcNode && tgtNode}
				{@const mid = midpointLabel(srcNode, tgtNode)}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<line
					x1={srcNode.x}
					y1={srcNode.y}
					x2={tgtNode.x}
					y2={tgtNode.y}
					stroke="#6b7280"
					stroke-width="1.5"
					stroke-opacity="0.5"
					stroke-dasharray={edgeDash(edge.rel.status)}
					marker-end="url(#arrowhead)"
					class="cursor-pointer"
					onclick={() => onRelClick?.(edge.rel)}
				/>
				<!-- Relationship type label -->
				<text
					x={mid.x}
					y={mid.y - 4}
					text-anchor="middle"
					font-size="9"
					fill="#9ca3af"
					class="pointer-events-none select-none"
				>
					{edge.rel.relationshipType}
				</text>
			{/if}
		{/each}

		<!-- Nodes -->
		{#each simNodes as node}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<g
				class="cursor-pointer"
				onclick={() => {
					const origNode = nodes.find((n) => n.id === node.id)
					if (origNode) onNodeClick?.(origNode)
				}}
				onpointerdown={(e) => onNodePointerDown(e, node)}
			>
				<circle
					cx={node.x}
					cy={node.y}
					r={NODE_RADIUS}
					fill={nodeColor(node.nodeType)}
					stroke="white"
					stroke-width="2"
					opacity="0.9"
				/>
				<text
					x={node.x}
					y={node.y + 1}
					text-anchor="middle"
					dominant-baseline="middle"
					font-size="9"
					font-weight="600"
					fill="white"
					class="pointer-events-none select-none"
					>{node.label.length > 12 ? node.label.slice(0, 11) + "…" : node.label}</text
				>
				<text
					x={node.x}
					y={node.y + NODE_RADIUS + 10}
					text-anchor="middle"
					font-size="8"
					fill="#9ca3af"
					class="pointer-events-none select-none"
					>{node.nodeType}</text
				>
			</g>
		{/each}
	</svg>

	{#if nodes.length === 0}
		<div class="text-surface-400 absolute inset-0 flex items-center justify-center text-sm">
			No nodes in graph yet.
		</div>
	{/if}
</div>
