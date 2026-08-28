<script lang="ts">
	/**
	 * The whole pipeline on a real graph canvas — Svelte Flow rendering, ELK
	 * layered layout (see flow/layout.ts). Every node, every construct —
	 * fan-outs, maps, loops, routes, nested blocks — with pan/zoom, fit-view,
	 * and a minimap, in either direction. The previous hand-built flex/grid
	 * map lives on as PipelineMapLegacy.svelte, unused.
	 *
	 * The map owns its presentation (direction, viewport); selection is the
	 * page's — clicking a node or a block header calls `onSelect` with its
	 * stepKey, and active/draft state flows back in through the map context
	 * so the laid-out graph never rebuilds for a click.
	 *
	 * This surface may name topology; the session sidebar may not (05 §0a).
	 * Read-only today — the structural editor (the lens view, 05 §1–§5) is
	 * exactly what this canvas is groundwork for.
	 */
	import { onMount, setContext } from "svelte"
	import * as Icons from "@lucide/svelte"
	import {
		SvelteFlow,
		Background,
		Controls,
		MiniMap,
		type Node,
		type Edge,
		type ColorMode
	} from "@xyflow/svelte"
	import "@xyflow/svelte/dist/style.css"
	import StepNode from "./flow/StepNode.svelte"
	import BlockNode from "./flow/BlockNode.svelte"
	import ChainLabelNode from "./flow/ChainLabelNode.svelte"
	import {
		layoutPipeline,
		type FlowDirection
	} from "./flow/layout"
	import {
		MAP_CONTEXT_KEY,
		KIND_MEANING,
		KIND_STRIPE,
		BLOCK_LABEL,
		BLOCK_MEANING,
		type PipelineMapContext
	} from "./flow/context"

	type Graph = NonNullable<
		NonNullable<Sockets.Pipelines.Detail.Response["spec"]>["graph"]
	>

	interface Props {
		graph: Graph | null
		steps: Sockets.Pipelines.Step[]
		activeKey: string | null
		/** Unsaved-draft count for a step — the amber dot. */
		pendingFor: (stepKey: string) => number
		onSelect: (stepKey: string) => void
		/** Show the color/construct legend below the map. */
		legend?: boolean
	}

	let {
		graph,
		steps,
		activeKey,
		pendingFor,
		onSelect,
		legend = true
	}: Props = $props()

	/* ── the reactive seam the node components read ─────────────────── */

	setContext<PipelineMapContext>(MAP_CONTEXT_KEY, {
		get activeKey() {
			return activeKey
		},
		stepFor: (stepKey) =>
			stepKey ? steps.find((s) => s.key === stepKey) : undefined,
		pendingFor: (stepKey) => pendingFor(stepKey),
		onSelect: (stepKey) => onSelect(stepKey)
	})

	const nodeTypes = {
		step: StepNode,
		block: BlockNode,
		chain: ChainLabelNode
	} as any

	/* ── direction, remembered per browser ──────────────────────────── */

	const DIRECTION_KEY = "serene-pub:pipeline-map-direction"
	let direction = $state<FlowDirection>("DOWN")
	onMount(() => {
		try {
			const saved = localStorage.getItem(DIRECTION_KEY)
			if (saved === "DOWN" || saved === "RIGHT") direction = saved
		} catch {}
	})
	function rememberDirection(next: FlowDirection) {
		direction = next
		try {
			localStorage.setItem(DIRECTION_KEY, next)
		} catch {}
	}

	/* ── layout ─────────────────────────────────────────────────────── */

	/**
	 * A version published before the graph payload existed still has steps
	 * to configure — synthesized as a plain sequence so the canvas never
	 * shows less than the panel knows.
	 */
	const effectiveGraph = $derived.by((): Graph | null => {
		if (graph?.nodes.length) return graph
		if (!steps.length) return null
		return {
			nodes: steps.map((s, i) => ({
				key: s.key,
				label: s.label,
				kind: s.kind || "task",
				typeId: "",
				blockId: null,
				blockKind: null,
				blockChain: null,
				position: i,
				toggleable: false,
				enabledDefault: true,
				stepKey: s.key
			})),
			blocks: [],
			edges: []
		}
	})

	let nodes = $state.raw<Node[]>([])
	let edges = $state.raw<Edge[]>([])
	let laying = $state(false)
	/** Re-mount the canvas when the drawing changes shape, so fitView re-runs. */
	let layoutKey = $state(0)

	$effect(() => {
		const g = effectiveGraph
		const dir = direction
		if (!g) {
			nodes = []
			edges = []
			return
		}
		laying = true
		let stale = false
		layoutPipeline(g, dir)
			.then((res) => {
				if (stale) return
				nodes = res.nodes
				edges = res.edges
				layoutKey++
				laying = false
			})
			.catch((err) => {
				if (stale) return
				console.error("Pipeline map layout failed:", err)
				laying = false
			})
		return () => {
			stale = true
		}
	})

	/* ── selection: one handler for cards and block headers ─────────── */

	function handleNodeClick({ node }: { node: Node }) {
		const data = node.data as any
		const stepKey: string | null =
			data?.wire?.stepKey ?? data?.block?.stepKey ?? null
		if (stepKey) onSelect(stepKey)
	}

	/* ── chrome ─────────────────────────────────────────────────────── */

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

	const counts = $derived.by(() => {
		const g = effectiveGraph
		const blocks = g?.blocks ?? []
		const c = (kind: string) => blocks.filter((b) => b.kind === kind).length
		const lanes = new Set(
			(g?.nodes ?? [])
				.filter((n) => n.blockId)
				.map((n) => `${n.blockId}/${n.blockChain}`)
		)
		return {
			steps: g?.nodes.length ?? 0,
			fanOuts: c("async"),
			maps: c("map"),
			loops: c("loop"),
			routes: c("route"),
			lanes: lanes.size
		}
	})
	const countLine = $derived(
		[
			`${counts.steps} steps`,
			counts.fanOuts
				? `${counts.fanOuts} fan-out${counts.fanOuts === 1 ? "" : "s"}`
				: null,
			counts.maps ? `${counts.maps} map${counts.maps === 1 ? "" : "s"}` : null,
			counts.loops
				? `${counts.loops} loop${counts.loops === 1 ? "" : "s"}`
				: null,
			counts.routes
				? `${counts.routes} route${counts.routes === 1 ? "" : "s"}`
				: null,
			counts.lanes
				? `${counts.lanes} lane${counts.lanes === 1 ? "" : "s"}`
				: null
		]
			.filter(Boolean)
			.join(" · ")
	)

	const legendKinds = $derived(
		[...new Set((effectiveGraph?.nodes ?? []).map((n) => n.kind))].filter(
			(k) => k in KIND_MEANING
		)
	)
	const legendBlocks = $derived(
		[...new Set((effectiveGraph?.blocks ?? []).map((b) => b.kind))].filter(
			(k) => k in BLOCK_MEANING
		)
	)
	const humanize = (v: string) =>
		v
			.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
			.replace(/^./, (c) => c.toUpperCase())

	/** Minimap swatches follow the kind stripes (theme token → color). */
	const MINIMAP_COLOR: Record<string, string> = {
		input: "var(--color-surface-400)",
		query: "var(--color-success-500)",
		task: "var(--color-primary-500)",
		provider: "var(--color-warning-500)",
		consumer: "var(--color-error-500)"
	}
	const minimapColor = (n: Node) => {
		const data = n.data as any
		if (data?.block) return "transparent"
		return MINIMAP_COLOR[data?.wire?.kind] ?? "var(--color-surface-400)"
	}

	const LEGEND =
		"text-surface-600-400 text-[10px] font-bold tracking-[.15em] uppercase"
</script>

<div class="flex h-full min-h-0 flex-col">
	<div
		class="border-surface-300-700 flex flex-wrap items-center gap-2 border-b px-3 py-2"
	>
		<span class={LEGEND}>Signal path</span>
		<span class="text-surface-600-400 font-mono text-[10.5px]">
			{countLine}
		</span>
		<span class="flex-1"></span>
		<div
			class="border-surface-300-700 flex overflow-hidden rounded-md border"
			role="group"
			aria-label="Flow direction"
		>
			<button
				type="button"
				class="btn btn-sm rounded-none {direction === 'DOWN'
					? 'preset-filled-primary-500'
					: 'preset-tonal-surface'}"
				aria-pressed={direction === "DOWN"}
				title="Top to bottom"
				onclick={() => rememberDirection("DOWN")}
			>
				<Icons.ArrowDown size={15} />
			</button>
			<button
				type="button"
				class="btn btn-sm rounded-none {direction === 'RIGHT'
					? 'preset-filled-primary-500'
					: 'preset-tonal-surface'}"
				aria-pressed={direction === "RIGHT"}
				title="Left to right"
				onclick={() => rememberDirection("RIGHT")}
			>
				<Icons.ArrowRight size={15} />
			</button>
		</div>
	</div>

	<div class="map-canvas relative">
		{#if laying && !nodes.length}
			<p class="text-surface-600-400 absolute inset-0 z-10 flex items-center justify-center text-sm">
				Laying out…
			</p>
		{/if}
		{#key layoutKey}
			<SvelteFlow
				{nodes}
				{edges}
				{nodeTypes}
				{colorMode}
				fitView
				fitViewOptions={{ padding: 0.06, maxZoom: 1 }}
				minZoom={0.15}
				nodesDraggable={false}
				nodesConnectable={false}
				elementsSelectable={false}
				edgesFocusable={false}
				proOptions={{ hideAttribution: false }}
				onnodeclick={handleNodeClick}
			>
				<Background gap={22} />
				<Controls showLock={false} />
				<MiniMap
					nodeColor={minimapColor}
					pannable
					zoomable
					width={140}
					height={100}
				/>
			</SvelteFlow>
		{/key}
	</div>

	{#if legend && (legendKinds.length || legendBlocks.length)}
		<div
			class="border-surface-300-700 flex flex-wrap gap-x-5 gap-y-1 border-t px-3 py-2"
		>
			{#each legendKinds as k (k)}
				<span class="flex items-center gap-2 text-xs">
					<span
						aria-hidden="true"
						class="h-3 w-[3px] shrink-0 rounded-full {KIND_STRIPE[k] ??
							'bg-surface-400-600'}"
					></span>
					<span class="font-medium">{humanize(k)}</span>
					<span class="text-surface-600-400">{KIND_MEANING[k]}</span>
				</span>
			{/each}
			{#each legendBlocks as k (k)}
				<span class="flex items-center gap-2 text-xs">
					<span
						aria-hidden="true"
						class="border-surface-400-600 h-3 w-3 shrink-0 rounded border border-dashed"
					></span>
					<span class="font-medium">{BLOCK_LABEL[k] ?? k}</span>
					<span class="text-surface-600-400">{BLOCK_MEANING[k]}</span>
				</span>
			{/each}
		</div>
	{/if}
</div>

<style>
	.map-canvas {
		height: max(560px, 74vh);
	}
	/* The canvas sits on the card's own surface; the dotted Background is
	   the texture, so the flow's default backdrop goes transparent. */
	.map-canvas :global(.svelte-flow) {
		--xy-background-color: transparent;
		background-color: transparent !important;
		/* The default edge grey vanishes against the card surface. */
		--xy-edge-stroke: color-mix(
			in oklch,
			var(--color-surface-500),
			transparent 25%
		);
		--xy-edge-stroke-width: 1.5;
	}
	.map-canvas :global(.svelte-flow__arrowhead polyline) {
		stroke: var(--xy-edge-stroke);
		fill: var(--xy-edge-stroke);
	}
	.map-canvas :global(.svelte-flow__attribution) {
		background: transparent;
		opacity: 0.5;
	}
</style>
