<script lang="ts">
	/**
	 * The event map, drawn (PLAN-turn-order §B2): the laid-out graph on a
	 * Svelte Flow canvas, a legend for the three edge kinds, and a line saying
	 * how many unconnected events were left off. Layout runs when the map
	 * changes; a selection only re-marks the nodes, never re-lays them.
	 */
	import { onMount } from "svelte"
	import {
		SvelteFlow,
		Background,
		Controls,
		type Node,
		type Edge,
		type ColorMode
	} from "@xyflow/svelte"
	import "@xyflow/svelte/dist/style.css"
	import EventMapNode from "./EventMapNode.svelte"
	import {
		connectedOnly,
		layoutEventMap,
		EDGE_COLOUR,
		EDGE_DASH,
		EDGE_MEANING
	} from "./eventMapLayout"

	type MapNode = Sockets.Pipelines.EventMap.MapNode
	interface Props {
		map: { nodes: MapNode[]; edges: Sockets.Pipelines.EventMap.MapEdge[] }
		selectedId: string | null
		onNodeClick: (node: MapNode) => void
	}
	let { map, selectedId, onNodeClick }: Props = $props()

	const nodeTypes = { eventMapNode: EventMapNode }

	let laid = $state.raw<{ nodes: Node[]; edges: Edge[] } | null>(null)
	let laying = $state(false)
	let failed = $state(false)
	/** Bumped per layout so the canvas re-mounts and `fitView` runs again. */
	let layoutKey = $state(0)

	$effect(() => {
		const current = map
		let stale = false
		laying = true
		failed = false
		layoutEventMap(current)
			.then((out) => {
				if (stale) return
				laid = out
				layoutKey++
			})
			.catch((e) => {
				if (stale) return
				console.error("event map layout failed", e)
				laid = { nodes: [], edges: [] }
				failed = true
			})
			.finally(() => {
				if (!stale) laying = false
			})
		return () => {
			stale = true
		}
	})

	// Raw, as xyflow asks: it replaces these arrays rather than mutating them,
	// and a deep proxy over every node is the cost it warns about.
	let nodes = $state.raw<Node[]>([])
	let edges = $state.raw<Edge[]>([])
	$effect(() => {
		const sel = selectedId
		nodes = (laid?.nodes ?? []).map((n) => ({
			...n,
			data: { ...n.data, selected: n.id === sel }
		}))
		edges = laid?.edges ?? []
	})

	const connected = $derived(connectedOnly(map))
	const drawnCount = $derived(connected.size)
	const leftOff = $derived(
		map.nodes.filter((n) => n.kind === "event" && !connected.has(n.id)).length
	)

	/** The app forces its own theme; the canvas follows it, not the OS. */
	let colorMode = $state<ColorMode>("dark")
	onMount(() => {
		const read = () =>
			(colorMode =
				document.documentElement.getAttribute("data-mode") === "light"
					? "light"
					: "dark")
		read()
		const mo = new MutationObserver(read)
		mo.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-mode"]
		})
		return () => mo.disconnect()
	})

	const KINDS = ["binds", "causes", "listens"] as const
</script>

<div class="event-map-canvas border-surface-300-700 relative border-y">
	{#if failed}
		<p
			class="text-surface-600-400 absolute inset-0 z-10 flex items-center justify-center px-6 text-center text-sm"
		>
			The event map could not be laid out. The list above still holds every event.
		</p>
	{:else if laying}
		<p
			class="text-surface-600-400 bg-surface-50-950/70 absolute inset-0 z-10 flex items-center justify-center text-sm"
			role="status"
		>
			Laying out…
		</p>
	{:else if !drawnCount}
		<p
			class="text-surface-600-400 absolute inset-0 z-10 flex items-center justify-center px-6 text-center text-sm"
		>
			Nothing in this scope binds, causes or hears an event.
		</p>
	{/if}
	{#key layoutKey}
		<SvelteFlow
			{nodes}
			{edges}
			{nodeTypes}
			{colorMode}
			fitView
			fitViewOptions={{ padding: 0.08, maxZoom: 1, minZoom: 0.5 }}
			minZoom={0.15}
			nodesDraggable={false}
			nodesConnectable={false}
			nodesFocusable={false}
			elementsSelectable={false}
			edgesFocusable={false}
			onnodeclick={({ node }) =>
				onNodeClick((node.data as { node: MapNode }).node)}
		>
			<Background gap={22} />
			<Controls showLock={false} />
		</SvelteFlow>
	{/key}
</div>

<div class="flex flex-wrap items-center gap-x-5 gap-y-1 px-4 pb-4">
	{#each KINDS as k (k)}
		<span class="flex items-center gap-2 text-xs">
			<svg width="28" height="8" aria-hidden="true">
				<line
					x1="0"
					y1="4"
					x2="28"
					y2="4"
					stroke={EDGE_COLOUR[k]}
					stroke-width="2"
					stroke-dasharray={EDGE_DASH[k] || undefined}
				/>
			</svg>
			<span class="font-medium">{k}</span>
			<span class="text-surface-600-400">{EDGE_MEANING[k]}</span>
		</span>
	{/each}
	{#if leftOff > 0}
		<span class="text-surface-600-400 text-xs">
			{leftOff}
			{leftOff === 1 ? "event has" : "events have"} no edge in this scope and
			{leftOff === 1 ? "is" : "are"} listed above only.
		</span>
	{/if}
</div>

<style>
	.event-map-canvas {
		height: max(480px, 64vh);
	}
	.event-map-canvas :global(.svelte-flow) {
		--xy-background-color: transparent;
		background-color: transparent !important;
	}
	.event-map-canvas :global(.svelte-flow__attribution) {
		background: transparent;
		opacity: 0.5;
	}
</style>
