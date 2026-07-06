<script lang="ts">
	import { onDestroy, onMount, getContext } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import * as Icons from "@lucide/svelte"
	import GraphBuildModal from "../modals/GraphBuildModal.svelte"
	import MergeNodeModal from "../modals/MergeNodeModal.svelte"
	import GraphVisualization from "../graph/GraphVisualization.svelte"
	import EmbeddingStatusIcon from "../EmbeddingStatusIcon.svelte"

	interface Props {
		lorebookId: number
	}

	let { lorebookId }: Props = $props()

	const socket = useTypedSocket()
	const graphBuildsCtx: GraphBuildsCtx = getContext("graphBuildsCtx")

	type NarrativeNode = Sockets.NarrativeGraph.NarrativeNode
	type NarrativeRelationship = Sockets.NarrativeGraph.NarrativeRelationship

	let nodes = $state<NarrativeNode[]>([])
	let relationships = $state<NarrativeRelationship[]>([])
	let ungraphedSceneCount = $state(0)
	let ungraphedUnsummarizedCount = $state(0)
	let totalSummarizedCount = $state(0)
	let ungraphedHistoryEntryCount = $state(0)
	let totalDirectHistoryEntryCount = $state(0)
	let isLoading = $state(true)

	let extendReadyCount = $derived(ungraphedSceneCount + ungraphedHistoryEntryCount)

	// Build modal
	let showBuildModal = $state(false)
	let buildMode = $state<"replace" | "extend">("replace")

	// Active build for this lorebook (from server-side activity store)
	let activeBuild = $derived(
		graphBuildsCtx?.activeBuild?.lorebookId === lorebookId ? graphBuildsCtx.activeBuild : null
	)

	let buildProgressPercent = $derived.by(() => {
		if (!activeBuild || activeBuild.status !== "building") return 0
		if (activeBuild.phase === "loading" || activeBuild.totalScenes === 0) return 5
		if (activeBuild.phase === "parsing") return 90
		return Math.max(10, Math.round((activeBuild.sceneIndex / activeBuild.totalScenes) * 80) + 5)
	})

	// Auto-open modal when Activity sidebar requests it
	$effect(() => {
		if (graphBuildsCtx?.reopenLorebookId === lorebookId) {
			if (activeBuild) buildMode = activeBuild.mode
			showBuildModal = true
			graphBuildsCtx.reopenLorebookId = null
		}
	})

	// Selected node / rel for detail panel
	let selectedNode = $state<NarrativeNode | null>(null)
	let selectedRel = $state<NarrativeRelationship | null>(null)

	// View mode
	type ViewMode = "graph" | "list"
	let viewMode = $state<ViewMode>("graph")

	// Editing
	let editingNode = $state<NarrativeNode | null>(null)
	let editingRel = $state<NarrativeRelationship | null>(null)
	let isSaving = $state(false)

	// Delete confirmation
	let pendingDeleteNodeId = $state<number | null>(null)

	// History entries (for optional temporal anchoring)
	let historyEntries = $state<SelectHistoryEntry[]>([])

	// Create relationship
	let connectingFromNode = $state<NarrativeNode | null>(null)
	let connectToNodeId = $state<number | null>(null)
	let connectRelType = $state<string>("neutral")
	let connectRelStatus = $state<string>("active")
	let connectDescription = $state("")
	let connectVisibility = $state("acknowledged")
	let connectHistoryEntryId = $state<number | null>(null)
	let isConnecting = $state(false)

	// Create node (manual)
	let showCreateNodeForm = $state(false)
	let createNodeName = $state("")
	let createNodeState = $state("active")
	let createNodeVisibility = $state("normal")
	let createNodeSummary = $state("")
	let createNodeHistoryEntryId = $state<number | null>(null)
	let isCreatingNode = $state(false)

	// Lorebook bindings (for linking nodes to characters/personas)
	type BindingWithRelations = SelectLorebookBinding & {
		character?: { nickname?: string | null; name: string } | null
		persona?: { name: string } | null
	}
	let bindings = $state<BindingWithRelations[]>([])

	// Merge node modal
	let showMergeModal = $state(false)
	let mergeTargetNode = $state<NarrativeNode | null>(null)

	// Derived: only parent (non-alias) nodes shown in graph/list
	let parentNodes = $derived(nodes.filter((n) => !n.parentNodeId))

	// Relationship lookup helpers
	let nodeMap = $derived(new Map(nodes.map((n) => [n.id, n])))

	function load() {
		isLoading = true
		socket.emit("narrativeGraph:list", {
			lorebookId
		} satisfies Sockets.NarrativeGraph.List.Params)
	}

	onMount(() => {
		socket.on(
			"narrativeGraph:list",
			(msg: Sockets.NarrativeGraph.List.Response) => {
				nodes = msg.nodes
				relationships = msg.relationships
				ungraphedSceneCount = msg.ungraphedSceneCount ?? 0
				ungraphedUnsummarizedCount = msg.ungraphedUnsummarizedCount ?? 0
				totalSummarizedCount = msg.totalSummarizedCount ?? 0
				ungraphedHistoryEntryCount = msg.ungraphedHistoryEntryCount ?? 0
				totalDirectHistoryEntryCount = msg.totalDirectHistoryEntryCount ?? 0
				isLoading = false
			}
		)
		socket.on(
			"narrativeGraph:updateNode",
			(msg: Sockets.NarrativeGraph.UpdateNode.Response) => {
				nodes = nodes.map((n) => (n.id === msg.node.id ? msg.node : n))
				if (selectedNode?.id === msg.node.id) selectedNode = msg.node
				editingNode = null
				isSaving = false
			}
		)
		socket.on(
			"narrativeGraph:deleteNode",
			() => {
				load()
				selectedNode = null
				editingNode = null
			}
		)
		socket.on(
			"narrativeGraph:updateRelationship",
			(msg: Sockets.NarrativeGraph.UpdateRelationship.Response) => {
				relationships = relationships.map((r) =>
					r.id === msg.relationship.id ? msg.relationship : r
				)
				if (selectedRel?.id === msg.relationship.id) selectedRel = msg.relationship
				editingRel = null
				isSaving = false
			}
		)
		socket.on(
			"narrativeGraph:deleteRelationship",
			() => {
				load()
				selectedRel = null
				editingRel = null
			}
		)
		socket.on(
			"narrativeGraph:createRelationship",
			(msg: Sockets.NarrativeGraph.CreateRelationship.Response) => {
				relationships = [...relationships, msg.relationship]
				connectingFromNode = null
				connectToNodeId = null
				connectRelType = "neutral"
				connectRelStatus = "active"
				connectDescription = ""
				connectVisibility = "acknowledged"
				connectHistoryEntryId = null
				isConnecting = false
			}
		)
		socket.on(
			"narrativeGraph:createNode",
			(msg: Sockets.NarrativeGraph.CreateNode.Response) => {
				nodes = [...nodes, msg.node]
				showCreateNodeForm = false
				createNodeName = ""
				createNodeState = "active"
	
				createNodeSummary = ""
				createNodeHistoryEntryId = null
				isCreatingNode = false
			}
		)
		socket.on("historyEntries:list", (msg) => {
			historyEntries = msg.historyEntryList
		})
		socket.on("lorebooks:bindingList", (msg) => {
			if (msg.lorebookId === lorebookId) bindings = msg.lorebookBindingList as BindingWithRelations[]
		})
		socket.on("narrativeGraph:linkBindingNode", (msg: Sockets.NarrativeGraph.LinkBindingNode.Response) => {
			nodes = nodes.map(n =>
				n.lorebookBindingId === msg.bindingId
					? { ...n, lorebookBindingId: null }
					: n.id === msg.nodeId
						? { ...n, lorebookBindingId: msg.bindingId }
						: n
			)
		})
		socket.on("narrativeGraph:mergeNode", (msg: Sockets.NarrativeGraph.MergeNode.Response) => {
			nodes = nodes.map(n =>
				n.id === msg.parentNode.id ? msg.parentNode
				: n.id === msg.childNode.id ? msg.childNode
				: n
			)
			showMergeModal = false
			mergeTargetNode = null
		})
		socket.on("narrativeGraph:demergeNode", (msg: Sockets.NarrativeGraph.DemergeNode.Response) => {
			nodes = nodes.map(n => n.id === msg.node.id ? msg.node : n)
		})
		socket.emit("historyEntries:list", { lorebookId })
		socket.emit("lorebooks:bindingList", { lorebookId })
		load()
	})

	onDestroy(() => {
		socket.off("narrativeGraph:list")
		socket.off("narrativeGraph:updateNode")
		socket.off("narrativeGraph:deleteNode")
		socket.off("narrativeGraph:updateRelationship")
		socket.off("narrativeGraph:deleteRelationship")
		socket.off("narrativeGraph:createRelationship")
		socket.off("narrativeGraph:createNode")
		socket.off("historyEntries:list")
		socket.off("lorebooks:bindingList")
		socket.off("narrativeGraph:linkBindingNode")
		socket.off("narrativeGraph:mergeNode")
		socket.off("narrativeGraph:demergeNode")
	})

	function saveNode() {
		if (!editingNode) return
		isSaving = true
		socket.emit("narrativeGraph:updateNode", {
			node: editingNode
		} satisfies Sockets.NarrativeGraph.UpdateNode.Params)
	}

	function requestDeleteNode(id: number) {
		pendingDeleteNodeId = id
	}

	function confirmDeleteNode() {
		if (pendingDeleteNodeId === null) return
		socket.emit("narrativeGraph:deleteNode", {
			id: pendingDeleteNodeId
		} satisfies Sockets.NarrativeGraph.DeleteNode.Params)
		pendingDeleteNodeId = null
	}

	function saveRel() {
		if (!editingRel) return
		isSaving = true
		socket.emit("narrativeGraph:updateRelationship", {
			relationship: editingRel
		} satisfies Sockets.NarrativeGraph.UpdateRelationship.Params)
	}

	function deleteRel(id: number) {
		socket.emit("narrativeGraph:deleteRelationship", {
			id
		} satisfies Sockets.NarrativeGraph.DeleteRelationship.Params)
	}

	function startConnect(node: NarrativeNode) {
		connectingFromNode = node
		connectToNodeId = null
		connectRelType = "neutral"
		connectRelStatus = "active"
		editingNode = null
		editingRel = null
	}

	function submitConnect() {
		if (!connectingFromNode || !connectToNodeId) return
		isConnecting = true
		socket.emit("narrativeGraph:createRelationship", {
			lorebookId,
			fromNodeId: connectingFromNode.id,
			toNodeId: connectToNodeId,
			relationshipType: connectRelType,
			status: connectRelStatus,
			description: connectDescription || undefined,
			visibility: connectVisibility,
			historyEntryId: connectHistoryEntryId ?? undefined
		} satisfies Sockets.NarrativeGraph.CreateRelationship.Params)
	}

	function cancelConnect() {
		connectingFromNode = null
		connectToNodeId = null
		connectDescription = ""
		connectVisibility = "acknowledged"
		connectHistoryEntryId = null
		isConnecting = false
	}

	function submitCreateNode() {
		if (!createNodeName.trim()) return
		isCreatingNode = true
		socket.emit("narrativeGraph:createNode", {
			lorebookId,
			name: createNodeName.trim(),
			nodeState: createNodeState,
			nodeVisibility: createNodeVisibility,

			summary: createNodeSummary || undefined,
			historyEntryId: createNodeHistoryEntryId ?? null
		} satisfies Sockets.NarrativeGraph.CreateNode.Params)
	}

	function cancelCreateNode() {
		showCreateNodeForm = false
		createNodeName = ""
		createNodeState = "active"
		createNodeVisibility = "normal"
		createNodeSummary = ""
		createNodeHistoryEntryId = null
		isCreatingNode = false
	}

	function startEditNode(node: NarrativeNode) {
		editingNode = { ...node }
		editingRel = null
		selectedNode = node
		selectedRel = null
	}

	function startEditRel(rel: NarrativeRelationship) {
		editingRel = { ...rel }
		editingNode = null
		selectedRel = rel
		// Don't clear selectedNode — rel may be opened from the node's relationship list
	}

	function cancelEdit() {
		editingNode = null
		editingRel = null
		pendingDeleteNodeId = null
	}

	function nodeName(id: number): string {
		return nodeMap.get(id)?.name ?? `Node #${id}`
	}

	const NODE_STATE_COLOR: Record<string, string> = {
		active: "preset-tonal-primary",
		deceased: "preset-tonal-error",
		missing: "preset-tonal-surface",
		departed: "preset-tonal-secondary"
	}

	const NODE_STATES = ["active", "deceased", "missing", "departed"] as const

	const NODE_VISIBILITY_COLOR: Record<string, string> = {
		normal: "",
		legendary: "preset-tonal-warning",
		hidden: "preset-tonal-surface"
	}

	const NODE_VISIBILITY = ["normal", "legendary", "hidden"] as const

	const REL_STATUS_BADGE: Record<string, string> = {
		active: "preset-tonal-success",
		resolved: "preset-tonal-surface",
		broken: "preset-tonal-error",
		evolved: "preset-tonal-warning"
	}

	const REL_VISIBILITY_BADGE: Record<string, string> = {
		secret: "preset-tonal-warning",
		public: "preset-tonal-primary",
		acknowledged: "preset-tonal-surface"
	}

	const RELATIONSHIP_VISIBILITIES = ["acknowledged", "secret", "public"] as const


	const RELATIONSHIP_STATUSES = ["active", "resolved", "broken", "evolved"] as const
</script>

<div class="flex h-full flex-col gap-3 pt-2">
	<!-- ── Toolbar ──────────────────────────────────────────────────────────── -->
	<div class="flex items-center gap-2">
		{#if activeBuild}
			<!-- Compact status indicator while build is active -->
			{#if activeBuild.status === "building"}
				<div class="flex items-center gap-2">
					<div class="bg-primary-500 h-2 w-2 shrink-0 animate-pulse rounded-full"></div>
					<span class="text-surface-500 text-sm">Building…</span>
				</div>
			{:else if activeBuild.status === "error"}
				<div class="flex items-center gap-2">
					<Icons.AlertCircle size={14} class="text-error-500 shrink-0" />
					<span class="text-error-500 text-sm">Failed</span>
				</div>
			{/if}
		{:else}
			<button
				class="btn btn-sm preset-filled-primary-500"
				onclick={() => {
					buildMode = "replace"
					showBuildModal = true
				}}
				title={nodes.length > 0 ? "Rebuild graph from scratch" : "Build graph from scenes"}
			>
				<Icons.Cpu size={14} />
				{nodes.length > 0 ? "Rebuild Graph" : "Build Graph"}
			</button>
			<button
				class="btn btn-sm preset-tonal-surface"
				onclick={() => {
					buildMode = "extend"
					showBuildModal = true
				}}
				title={extendReadyCount === 0
					? ungraphedUnsummarizedCount > 0
						? `${ungraphedUnsummarizedCount} scene${ungraphedUnsummarizedCount === 1 ? "" : "s"} need summaries before they can be graphed`
						: "Graph is up to date"
					: `Extend graph with ${extendReadyCount} new item${extendReadyCount === 1 ? "" : "s"}${ungraphedUnsummarizedCount > 0 ? ` (${ungraphedUnsummarizedCount} more scenes need summaries)` : ""}`}
				disabled={nodes.length === 0 || extendReadyCount === 0}
			>
				<Icons.Layers size={14} />
				Extend
				{#if extendReadyCount > 0}
					<span class="badge-icon preset-filled-primary-500 text-[10px]">{extendReadyCount}</span>
				{/if}
			</button>
		{/if}
		<div class="ml-auto flex gap-1">
			<button
				class="btn btn-sm preset-tonal-surface"
				onclick={() => { showCreateNodeForm = !showCreateNodeForm; editingNode = null; editingRel = null; connectingFromNode = null }}
				title="Add node manually"
			>
				<Icons.Plus size={14} />
			</button>
			<button
				class="btn btn-sm {viewMode === 'graph' ? 'preset-filled-surface-500' : 'preset-tonal-surface'}"
				onclick={() => (viewMode = "graph")}
				title="Graph view"
			>
				<Icons.Network size={14} />
			</button>
			<button
				class="btn btn-sm {viewMode === 'list' ? 'preset-filled-surface-500' : 'preset-tonal-surface'}"
				onclick={() => (viewMode = "list")}
				title="List view"
			>
				<Icons.List size={14} />
			</button>
		</div>
		<button
			class="btn btn-sm preset-tonal-surface"
			onclick={load}
			title="Refresh"
		>
			<Icons.RefreshCw size={14} />
		</button>
	</div>

	<!-- ── Build progress card (shown when a build is active) ──────────────── -->
	{#if activeBuild}
		<div class="bg-surface-200-800 border border-surface-300-700 rounded-lg p-3 space-y-2 text-sm">
			{#if activeBuild.status === "building"}
				<div class="space-y-1.5">
					<p class="text-surface-500 capitalize text-xs">
						{activeBuild.phase.replace(/_/g, " ")}
						{#if activeBuild.totalScenes > 0}· scene {activeBuild.sceneIndex + 1}/{activeBuild.totalScenes}{/if}
					</p>
					<div class="bg-surface-300-700 h-1.5 w-full overflow-hidden rounded-full">
						<div
							class="bg-primary-500 h-full rounded-full transition-all duration-500"
							style="width: {buildProgressPercent}%"
						></div>
					</div>
					{#if activeBuild.currentPair}
						<p class="text-surface-400 text-xs font-mono truncate">{activeBuild.currentPair}</p>
					{/if}
				</div>
				<div class="flex items-center gap-2">
					{#if activeBuild.activityId}
						<button
							class="btn btn-sm preset-tonal-error"
							onclick={() => socket.emit("activity:cancel", { id: activeBuild!.activityId! })}
						>
							<Icons.Square size={14} /> Stop
						</button>
					{/if}
					<button
						class="btn btn-sm preset-tonal-surface"
						onclick={() => { if (activeBuild) buildMode = activeBuild.mode; showBuildModal = true }}
					>
						<Icons.Eye size={14} /> View Progress
					</button>
				</div>
			{:else if activeBuild.status === "review"}
				<div class="flex items-center gap-2">
					<Icons.CheckCircle size={14} class="text-success-500 shrink-0" />
					<span class="text-success-500 font-medium">100% complete</span>
					<button
						class="btn btn-sm preset-filled-primary-500 ml-auto"
						onclick={() => { if (activeBuild) buildMode = activeBuild.mode; showBuildModal = true }}
					>
						<Icons.Check size={14} /> Review & Apply
					</button>
				</div>
			{:else if activeBuild.status === "error"}
				<div class="space-y-2">
					<div class="flex items-center gap-2">
						<Icons.AlertCircle size={14} class="text-error-500 shrink-0" />
						<span class="text-error-500">Build failed</span>
						{#if activeBuild.errorMessage}
							<span class="text-surface-500 text-xs truncate">— {activeBuild.errorMessage}</span>
						{/if}
					</div>
					<button
						class="btn btn-sm preset-tonal-error"
						onclick={() => { if (activeBuild) buildMode = activeBuild.mode; showBuildModal = true }}
					>
						<Icons.AlertCircle size={14} /> View Error
					</button>
				</div>
			{/if}
		</div>
	{/if}

	<!-- ── Create node form card ───────────────────────────────────────────────── -->
	{#if showCreateNodeForm}
		<div class="bg-surface-200-800 border border-surface-300-700 rounded-lg p-3 space-y-2 text-sm">
			<p class="font-semibold text-sm">New Node</p>
			<div class="space-y-1">
				<p class="text-surface-500 text-xs font-semibold uppercase">Name</p>
				<input class="input text-sm" type="text" placeholder="Node name…" bind:value={createNodeName} />
			</div>
			<div class="grid grid-cols-2 gap-2">
				<div class="space-y-1">
					<p class="text-surface-500 text-xs font-semibold uppercase">State</p>
					<select class="select text-sm" bind:value={createNodeState}>
						{#each NODE_STATES as s}
							<option value={s}>{s}</option>
						{/each}
					</select>
				</div>
				<div class="space-y-1">
					<p class="text-surface-500 text-xs font-semibold uppercase">Visibility</p>
					<select class="select text-sm" bind:value={createNodeVisibility}>
						{#each NODE_VISIBILITY as v}
							<option value={v}>{v}</option>
						{/each}
					</select>
				</div>
			</div>
			<div class="space-y-1">
				<p class="text-surface-500 text-xs font-semibold uppercase">Summary</p>
				<textarea class="textarea min-h-10 text-sm" placeholder="Short summary for context infill…" maxlength="200" bind:value={createNodeSummary}></textarea>
			<p class="text-surface-400 text-right text-xs">{createNodeSummary.length} / 200</p>
			</div>
			{#if historyEntries.length > 0}
				<div class="space-y-1">
					<p class="text-surface-500 text-xs font-semibold uppercase">First appeared (optional)</p>
					<select class="select text-sm" bind:value={createNodeHistoryEntryId}>
						<option value={null}>— none —</option>
						{#each historyEntries as he}
							<option value={he.id}>
								Year {he.year}{he.month ? `, Mo. ${he.month}` : ""}{he.day ? `, Day ${he.day}` : ""}
							</option>
						{/each}
					</select>
				</div>
			{/if}
			<div class="flex gap-2 justify-end">
				<button class="btn btn-sm preset-tonal-surface" onclick={cancelCreateNode}>Cancel</button>
				<button
					class="btn btn-sm preset-filled-primary-500"
					disabled={!createNodeName.trim() || isCreatingNode}
					onclick={submitCreateNode}
				>
					<Icons.Plus size={13} /> Create Node
				</button>
			</div>
		</div>
	{/if}

	{#if isLoading}
		<div class="text-surface-500 flex items-center justify-center py-10 text-sm">
			<div class="bg-primary-500 mr-2 h-2 w-2 animate-pulse rounded-full"></div>
			Loading…
		</div>
	{:else if nodes.length === 0}
		<!-- Empty state -->
		<div class="text-surface-500 flex flex-col items-center gap-3 py-10 text-center text-sm">
			<Icons.Network size={32} class="opacity-30" />
			<div>
				<p class="font-medium">No graph yet</p>
				<p class="mt-1 text-xs opacity-70">
					Build a graph from your scenes to extract entities and relationships.
				</p>
			</div>
			{#if activeBuild?.status === "building"}
				<div class="flex items-center gap-2">
					<div class="bg-primary-500 h-2 w-2 animate-pulse rounded-full"></div>
					<span class="capitalize">{activeBuild.phase.replace(/_/g, " ")}…</span>
				</div>
			{:else}
				<button
					class="btn btn-sm preset-filled-primary-500"
					onclick={() => (showBuildModal = true)}
				>
					<Icons.Cpu size={14} /> Build Graph
				</button>
			{/if}
		</div>
	{:else if viewMode === "graph"}
		<!-- ── Graph visualization ──────────────────────────────────────────── -->
		<div class="bg-surface-200-800 min-h-72 flex-1 overflow-hidden rounded-lg">
			<GraphVisualization
				nodes={parentNodes}
				{relationships}
				onNodeClick={(n) => {
					selectedNode = n
					selectedRel = null
					editingNode = null
					editingRel = null
				}}
				onRelClick={(r) => {
					selectedRel = r
					selectedNode = null
					editingNode = null
					editingRel = null
				}}
			/>
		</div>

		<!-- Selected node / rel detail -->
		{#if selectedNode && !editingNode}
			{@const aliasChildren = nodes.filter(n => n.parentNodeId === selectedNode!.id)}
			{@const nodeRels = relationships.filter(r => r.fromNodeId === selectedNode!.id)}
			<div class="bg-surface-200-800 rounded-lg p-3 text-sm space-y-2">
				<!-- Header -->
				<div class="flex items-center justify-between">
					<span class="font-semibold">{selectedNode.name}</span>
					<div class="flex gap-1">
						<button
							class="btn btn-sm preset-tonal-surface"
							onclick={() => startConnect(selectedNode!)}
							title="Add relationship from this node"
						><Icons.GitBranch size={13} /></button>
						<button
							class="btn btn-sm preset-tonal-surface"
							onclick={() => startEditNode(selectedNode!)}
							title="Edit node"
						><Icons.Pencil size={13} /></button>
						<button
							class="btn btn-sm preset-tonal-warning"
							onclick={() => { mergeTargetNode = selectedNode; showMergeModal = true }}
							title="Merge as alias of another node"
						><Icons.GitMerge size={13} /></button>
						<button
							class="btn btn-sm preset-tonal-error"
							onclick={() => requestDeleteNode(selectedNode!.id)}
							title="Delete node"
						><Icons.Trash2 size={13} /></button>
						<button
							class="btn btn-sm preset-tonal-surface"
							onclick={() => { selectedNode = null; editingRel = null }}
						><Icons.X size={13} /></button>
					</div>
				</div>
				<!-- Badges -->
				<div class="flex gap-1 flex-wrap">
					<span class="badge {NODE_STATE_COLOR[selectedNode.nodeState] ?? 'preset-tonal-surface'} text-xs">
						{selectedNode.nodeState}
					</span>
					{#if selectedNode.nodeVisibility !== "normal"}
						<span class="badge {NODE_VISIBILITY_COLOR[selectedNode.nodeVisibility] ?? 'preset-tonal-surface'} text-xs">
							{selectedNode.nodeVisibility}
						</span>
					{/if}
				</div>
				{#if selectedNode.summary}
					<p class="text-surface-500 text-xs">{selectedNode.summary}</p>
				{/if}
				{#if aliasChildren.length > 0}
					<div class="space-y-1">
						<span class="text-surface-400 text-xs">Also known as:</span>
						<div class="flex flex-wrap gap-1">
							{#each aliasChildren as alias}
								<span class="badge preset-tonal-surface text-xs flex items-center gap-1">
									{alias.name}
									<button
										class="hover:text-error-500 transition-colors"
										title="De-merge: restore as independent node"
										onclick={() => socket.emit("narrativeGraph:demergeNode", { nodeId: alias.id })}
									><Icons.Unlink size={10} /></button>
								</span>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Relationships -->
				{#if nodeRels.length > 0 || connectingFromNode?.id === selectedNode.id}
					<div class="border-t border-surface-300-700 pt-2 space-y-2">
						<p class="text-surface-500 text-xs font-semibold uppercase">Relationships</p>
						{#each nodeRels as rel (rel.id)}
							{#if editingRel?.id === rel.id}
								<!-- Inline edit card -->
								<div class="bg-surface-100-900 border border-surface-300-700 rounded-lg p-3 space-y-2">
									<div class="flex items-center gap-1 text-xs text-surface-500">
										<Icons.ArrowRight size={11} class="text-primary-400 shrink-0" />
										<span class="font-medium">→ {nodeName(rel.toNodeId)}</span>
									</div>
									<input class="input text-sm w-full" type="text" placeholder="Relationship type…" bind:value={editingRel.relationshipType} />
									<div class="grid grid-cols-2 gap-2">
										<select class="select text-xs" bind:value={editingRel.status}>
											{#each RELATIONSHIP_STATUSES as s}
												<option value={s}>{s}</option>
											{/each}
										</select>
										<select class="select text-xs" bind:value={editingRel.visibility}>
											{#each RELATIONSHIP_VISIBILITIES as v}
												<option value={v}>{v}</option>
											{/each}
										</select>
									</div>
									<textarea class="textarea min-h-10 text-xs" placeholder="Description…" bind:value={editingRel.description}></textarea>
									<input class="input text-xs" type="text" placeholder="Reason for this state…" bind:value={editingRel.reason} />
									{#if historyEntries.length > 0}
										<select class="select text-xs" bind:value={editingRel.historyEntryId}>
											<option value={null}>— no date —</option>
											{#each historyEntries as he}
												<option value={he.id}>Year {he.year}{he.month ? `, Mo. ${he.month}` : ""}{he.day ? `, Day ${he.day}` : ""}</option>
											{/each}
										</select>
									{/if}
									<div class="flex gap-2 justify-end">
										<button class="btn btn-sm preset-tonal-surface" onclick={() => { editingRel = null }}>Cancel</button>
										<button class="btn btn-sm preset-filled-primary-500" disabled={isSaving} onclick={saveRel}>
											<Icons.Save size={13} /> Save
										</button>
									</div>
								</div>
							{:else}
								<!-- View card -->
								<div class="bg-surface-100-900 border border-surface-300-700 rounded-lg p-2.5 space-y-1.5">
									<div class="flex items-center gap-1.5">
										<Icons.ArrowRight size={12} class="text-primary-400 shrink-0" />
										<span class="font-semibold text-xs truncate flex-1">{rel.relationshipType.replace(/_/g, " ")}</span>
										<span class="text-surface-400 text-xs shrink-0">→ {nodeName(rel.toNodeId)}</span>
									</div>
									<div class="flex items-center gap-1.5">
										<span class="badge {REL_STATUS_BADGE[rel.status] ?? 'preset-tonal-surface'} text-xs">{rel.status}</span>
										{#if rel.historyEntryId}
											{@const he = historyEntries.find(h => h.id === rel.historyEntryId)}
											{#if he}
												<span class="text-surface-500 text-xs">Yr {he.year}{he.month ? `, Mo. ${he.month}` : ""}</span>
											{/if}
										{/if}
										<div class="flex gap-1 ml-auto">
											<button
												class="btn btn-sm preset-tonal-surface p-1"
												onclick={() => { editingRel = { ...rel }; selectedRel = rel }}
												title="Edit relationship"
											><Icons.Pencil size={11} /></button>
											<button
												class="btn btn-sm preset-tonal-error p-1"
												onclick={() => deleteRel(rel.id)}
												title="Delete relationship"
											><Icons.Trash2 size={11} /></button>
										</div>
									</div>
									{#if rel.description}
										<p class="text-surface-500 text-xs leading-snug">{rel.description}</p>
									{/if}
								</div>
							{/if}
						{/each}
					</div>
				{/if}
			</div>
		{/if}

		{#if pendingDeleteNodeId !== null}
			{@const relCount = relationships.filter(r => r.fromNodeId === pendingDeleteNodeId || r.toNodeId === pendingDeleteNodeId).length}
			{@const nodeName = nodeMap.get(pendingDeleteNodeId)?.name ?? "this node"}
			<div class="bg-surface-200-800 rounded-lg border border-error-500/40 p-3 text-sm space-y-2">
				<p class="font-semibold text-error-500">Delete "{nodeName}"?</p>
				{#if relCount > 0}
					<p class="text-surface-500 text-xs">This will also permanently delete <strong>{relCount} relationship{relCount === 1 ? "" : "s"}</strong>.</p>
				{/if}
				<div class="flex gap-2 justify-end">
					<button class="btn btn-sm preset-tonal-surface" onclick={() => (pendingDeleteNodeId = null)}>Cancel</button>
					<button class="btn btn-sm preset-filled-error-500" onclick={() => { confirmDeleteNode(); selectedNode = null }}>
						<Icons.Trash2 size={13} /> Delete
					</button>
				</div>
			</div>
		{/if}

		{#if connectingFromNode && connectingFromNode.id === selectedNode?.id}
			<div class="bg-surface-200-800 rounded-lg p-3 text-sm space-y-2">
				<p class="font-semibold">Connect: {connectingFromNode.name} →</p>
				<div class="space-y-1">
					<p class="text-surface-500 text-xs font-semibold uppercase">Target Node</p>
					<select class="select text-sm" bind:value={connectToNodeId}>
						<option value={null} disabled>Select a node…</option>
						{#each nodes.filter(n => n.id !== connectingFromNode!.id) as n}
							<option value={n.id}>{n.name}</option>
						{/each}
					</select>
				</div>
				<div class="grid grid-cols-2 gap-2">
					<div class="space-y-1">
						<p class="text-surface-500 text-xs font-semibold uppercase">Type</p>
						<input class="input text-sm" type="text" bind:value={connectRelType} placeholder="e.g. ally, romantic, rival" />
					</div>
					<div class="space-y-1">
						<p class="text-surface-500 text-xs font-semibold uppercase">Status</p>
						<select class="select text-sm" bind:value={connectRelStatus}>
							{#each RELATIONSHIP_STATUSES as s}
								<option value={s}>{s}</option>
							{/each}
						</select>
					</div>
				</div>
				<div class="space-y-1">
					<p class="text-surface-500 text-xs font-semibold uppercase">Visibility</p>
					<select class="select text-sm" bind:value={connectVisibility}>
						{#each RELATIONSHIP_VISIBILITIES as v}
							<option value={v}>{v}</option>
						{/each}
					</select>
				</div>
				<div class="space-y-1">
					<p class="text-surface-500 text-xs font-semibold uppercase">Description (optional)</p>
					<textarea class="textarea min-h-10 text-sm" placeholder="Describe the relationship…" bind:value={connectDescription}></textarea>
				</div>
				{#if historyEntries.length > 0}
					<div class="space-y-1">
						<p class="text-surface-500 text-xs font-semibold uppercase">When (optional)</p>
						<select class="select text-sm" bind:value={connectHistoryEntryId}>
							<option value={null}>— none —</option>
							{#each historyEntries as he}
								<option value={he.id}>
									Year {he.year}{he.month ? `, Mo. ${he.month}` : ""}{he.day ? `, Day ${he.day}` : ""}
								</option>
							{/each}
						</select>
					</div>
				{/if}
				<div class="flex gap-2 justify-end">
					<button class="btn btn-sm preset-tonal-surface" onclick={cancelConnect}>Cancel</button>
					<button
						class="btn btn-sm preset-filled-primary-500"
						disabled={!connectToNodeId || isConnecting}
						onclick={submitConnect}
					>
						<Icons.GitBranch size={13} /> Connect
					</button>
				</div>
			</div>
		{/if}

		{#if selectedNode && editingNode}
			<div class="bg-surface-200-800 rounded-lg p-3 text-sm space-y-2">
				<p class="font-semibold">Edit Node</p>
				<div class="space-y-1">
					<p class="text-surface-500 text-xs font-semibold uppercase">Name</p>
					<input class="input text-sm" type="text" bind:value={editingNode.name} />
				</div>
				<div class="grid grid-cols-2 gap-2">
					<div class="space-y-1">
						<p class="text-surface-500 text-xs font-semibold uppercase">State</p>
						<select class="select text-sm" bind:value={editingNode.nodeState}>
							{#each NODE_STATES as s}
								<option value={s}>{s}</option>
							{/each}
						</select>
					</div>
					<div class="space-y-1">
						<p class="text-surface-500 text-xs font-semibold uppercase">Visibility</p>
						<select class="select text-sm" bind:value={editingNode.nodeVisibility}>
							{#each NODE_VISIBILITY as v}
								<option value={v}>{v}</option>
							{/each}
						</select>
					</div>
				</div>
				<div class="space-y-1">
					<p class="text-surface-500 text-xs font-semibold uppercase">Summary</p>
					<textarea class="textarea min-h-10 text-sm" maxlength="200" bind:value={editingNode.summary}></textarea>
					<p class="text-surface-400 text-right text-xs">{(editingNode.summary ?? "").length} / 200</p>
				</div>
				{#if bindings.length > 0}
					<div class="space-y-1">
						<p class="text-surface-500 text-xs font-semibold uppercase">Character Binding</p>
						<select class="select text-sm" bind:value={editingNode.lorebookBindingId}>
							<option value={null}>— None —</option>
							{#each bindings.filter(b => !nodes.some(n => n.id !== editingNode!.id && n.lorebookBindingId === b.id)) as b}
								<option value={b.id}>
									{b.character?.nickname || b.character?.name || b.persona?.name || b.binding}
								</option>
							{/each}
						</select>
					</div>
				{/if}
				{#if historyEntries.length > 0}
					<div class="space-y-1">
						<p class="text-surface-500 text-xs font-semibold uppercase">First appeared (optional)</p>
						<select class="select text-sm" bind:value={editingNode.historyEntryId}>
							<option value={null}>— none —</option>
							{#each historyEntries as he}
								<option value={he.id}>
									Year {he.year}{he.month ? `, Mo. ${he.month}` : ""}{he.day ? `, Day ${he.day}` : ""}
								</option>
							{/each}
						</select>
					</div>
				{/if}
				<div class="flex gap-2 justify-end">
					<button class="btn btn-sm preset-tonal-surface" onclick={cancelEdit}>Cancel</button>
					<button class="btn btn-sm preset-filled-primary-500" disabled={isSaving} onclick={saveNode}>
						<Icons.Save size={13} /> Save
					</button>
				</div>
			</div>
		{/if}

		{#if selectedRel && !editingRel}
			<div class="bg-surface-200-800 rounded-lg p-3 text-sm space-y-1">
				<div class="flex items-center justify-between">
					<span class="font-semibold">
						{nodeName(selectedRel.fromNodeId)} → {selectedRel.relationshipType} → {nodeName(selectedRel.toNodeId)}
					</span>
					<div class="flex gap-1">
						<button class="btn btn-sm preset-tonal-surface" onclick={() => startEditRel(selectedRel!)}>
							<Icons.Pencil size={13} />
						</button>
						<button class="btn btn-sm preset-tonal-error" onclick={() => {
							deleteRel(selectedRel!.id)
							selectedRel = null
						}}>
							<Icons.Trash2 size={13} />
						</button>
						<button class="btn btn-sm preset-tonal-surface" onclick={() => (selectedRel = null)}>
							<Icons.X size={13} />
						</button>
					</div>
				</div>
				<span class="badge {REL_STATUS_BADGE[selectedRel.status] ?? 'preset-tonal-surface'} text-xs">
					{selectedRel.status}
				</span>
				{#if selectedRel.description}
					<p class="text-xs">{selectedRel.description}</p>
				{/if}
				{#if selectedRel.reason}
					<p class="text-surface-500 text-xs italic">Reason: {selectedRel.reason}</p>
				{/if}
			</div>
		{/if}

		{#if selectedRel && editingRel}
			<div class="bg-surface-200-800 rounded-lg p-3 text-sm space-y-2">
				<p class="font-semibold">Edit Relationship</p>
				<div class="space-y-1">
					<p class="text-surface-500 text-xs font-semibold uppercase">Type</p>
					<input class="input text-sm" type="text" bind:value={editingRel.relationshipType} />
				</div>
				<div class="space-y-1">
					<p class="text-surface-500 text-xs font-semibold uppercase">Status</p>
					<select class="select text-sm" bind:value={editingRel.status}>
						{#each RELATIONSHIP_STATUSES as s}
							<option value={s}>{s}</option>
						{/each}
					</select>
				</div>
				<div class="space-y-1">
					<p class="text-surface-500 text-xs font-semibold uppercase">Description</p>
					<textarea class="textarea min-h-12 text-sm" bind:value={editingRel.description}></textarea>
				</div>
				<div class="space-y-1">
					<p class="text-surface-500 text-xs font-semibold uppercase">Reason for this state</p>
					<input class="input text-sm" type="text" bind:value={editingRel.reason} />
				</div>
				{#if historyEntries.length > 0}
					<div class="space-y-1">
						<p class="text-surface-500 text-xs font-semibold uppercase">When (optional)</p>
						<select class="select text-sm" bind:value={editingRel.historyEntryId}>
							<option value={null}>— none —</option>
							{#each historyEntries as he}
								<option value={he.id}>
									Year {he.year}{he.month ? `, Mo. ${he.month}` : ""}{he.day ? `, Day ${he.day}` : ""}
								</option>
							{/each}
						</select>
					</div>
				{/if}
				<div class="flex gap-2 justify-end">
					<button class="btn btn-sm preset-tonal-surface" onclick={cancelEdit}>Cancel</button>
					<button class="btn btn-sm preset-filled-primary-500" disabled={isSaving} onclick={saveRel}>
						<Icons.Save size={13} /> Save
					</button>
				</div>
			</div>
		{/if}

	{:else if viewMode === "list"}
		<!-- ── List view ────────────────────────────────────────────────────── -->
		<div class="space-y-4 overflow-y-auto">
			<!-- Nodes list -->
			<section class="space-y-1">
				<h3 class="text-surface-500 text-xs font-semibold uppercase tracking-wide">
					Nodes ({parentNodes.length})
				</h3>
				{#each parentNodes as node}
					<div class="bg-surface-200-800 rounded-lg border border-surface-300-700 px-3 py-2">
						{#if editingNode?.id === node.id}
							<div class="space-y-2">
								<div class="flex items-center gap-2">
									<input class="input flex-1 text-sm" type="text" bind:value={editingNode.name} />
									<button class="btn btn-sm preset-tonal-surface" onclick={cancelEdit}>
										<Icons.X size={13} />
									</button>
									<button class="btn btn-sm preset-filled-primary-500" disabled={isSaving} onclick={saveNode}>
										<Icons.Save size={13} />
									</button>
								</div>
								<div class="grid grid-cols-2 gap-2">
									<select class="select text-xs" bind:value={editingNode.nodeState}>
										{#each NODE_STATES as s}
											<option value={s}>{s}</option>
										{/each}
									</select>
									<select class="select text-xs" bind:value={editingNode.nodeVisibility}>
										{#each NODE_VISIBILITY as v}
											<option value={v}>{v}</option>
										{/each}
									</select>
								</div>
								<textarea class="textarea min-h-10 text-xs" placeholder="Summary…" maxlength="200" bind:value={editingNode.summary}></textarea>
								<p class="text-surface-400 text-right text-xs">{(editingNode.summary ?? "").length} / 200</p>
								{#if bindings.length > 0}
									<div class="space-y-1">
										<p class="text-surface-500 text-xs font-semibold uppercase">Character Binding</p>
										<select class="select text-xs" bind:value={editingNode.lorebookBindingId}>
											<option value={null}>— None —</option>
											{#each bindings.filter(b => !nodes.some(n => n.id !== editingNode!.id && n.lorebookBindingId === b.id)) as b}
												<option value={b.id}>
													{b.character?.nickname || b.character?.name || b.persona?.name || b.binding}
												</option>
											{/each}
										</select>
									</div>
								{/if}
								{#if historyEntries.length > 0}
									<select class="select text-xs" bind:value={editingNode.historyEntryId}>
										<option value={null}>— no history entry —</option>
										{#each historyEntries as he}
											<option value={he.id}>
												Year {he.year}{he.month ? `, Mo. ${he.month}` : ""}{he.day ? `, Day ${he.day}` : ""}
											</option>
										{/each}
									</select>
								{/if}
							</div>
						{:else}
							<div class="flex items-center gap-2">
								<span class="flex-1 truncate text-sm font-medium">{node.name}</span>
								<EmbeddingStatusIcon embeddingModel={node.embeddingModel} />
								<span class="badge {NODE_STATE_COLOR[node.nodeState] ?? 'preset-tonal-surface'} text-xs">{node.nodeState}</span>
								{#if node.nodeVisibility !== "normal"}
									<span class="badge {NODE_VISIBILITY_COLOR[node.nodeVisibility] ?? 'preset-tonal-surface'} text-xs">{node.nodeVisibility}</span>
								{/if}
								<button class="btn btn-sm preset-tonal-surface" onclick={() => startEditNode(node)}>
									<Icons.Pencil size={13} />
								</button>
								<button class="btn btn-sm preset-tonal-error" onclick={() => requestDeleteNode(node.id)}>
									<Icons.Trash2 size={13} />
								</button>
							</div>
							{#if node.summary}
								<p class="text-surface-500 mt-1 text-xs">{node.summary}</p>
							{/if}
						{/if}
					</div>
				{/each}
			</section>

			<!-- Relationships list -->
			<section class="space-y-1">
				<h3 class="text-surface-500 text-xs font-semibold uppercase tracking-wide">
					Relationships ({relationships.length})
				</h3>
				{#each relationships as rel}
					<div class="bg-surface-200-800 rounded-lg border border-surface-300-700 px-3 py-2">
						{#if editingRel?.id === rel.id}
							<div class="space-y-2">
								<div class="flex items-center gap-2">
									<input class="input flex-1 text-sm" type="text" bind:value={editingRel.relationshipType} />
									<button class="btn btn-sm preset-tonal-surface" onclick={cancelEdit}>
										<Icons.X size={13} />
									</button>
									<button class="btn btn-sm preset-filled-primary-500" disabled={isSaving} onclick={saveRel}>
										<Icons.Save size={13} />
									</button>
								</div>
								<div class="flex items-center gap-2">
									<span class="text-surface-500 shrink-0 text-xs">{nodeName(rel.fromNodeId)} → {nodeName(rel.toNodeId)}</span>
									<select class="select ml-auto text-xs" bind:value={editingRel.status}>
										{#each RELATIONSHIP_STATUSES as s}
											<option value={s}>{s}</option>
										{/each}
									</select>
									<select class="select text-xs" bind:value={editingRel.visibility}>
										{#each RELATIONSHIP_VISIBILITIES as v}
											<option value={v}>{v}</option>
										{/each}
									</select>
								</div>
								<textarea class="textarea min-h-10 text-xs" placeholder="Description…" bind:value={editingRel.description}></textarea>
								<input class="input text-xs" type="text" placeholder="Reason for this state…" bind:value={editingRel.reason} />
								{#if historyEntries.length > 0}
									<select class="select text-xs" bind:value={editingRel.historyEntryId}>
										<option value={null}>— none —</option>
										{#each historyEntries as he}
											<option value={he.id}>
												Year {he.year}{he.month ? `, Mo. ${he.month}` : ""}{he.day ? `, Day ${he.day}` : ""}
											</option>
										{/each}
									</select>
								{/if}
							</div>
						{:else}
							<div class="flex items-center gap-2">
								<span class="flex-1 truncate text-sm">
									<span class="font-medium">{nodeName(rel.fromNodeId)}</span>
									<span class="text-surface-400 mx-1 text-xs">→ {rel.relationshipType.replace(/_/g, " ")} →</span>
									<span class="font-medium">{nodeName(rel.toNodeId)}</span>
								</span>
								<EmbeddingStatusIcon embeddingModel={rel.embeddingModel} />
								{#if rel.visibility && rel.visibility !== "acknowledged"}
									<span class="badge {REL_VISIBILITY_BADGE[rel.visibility] ?? 'preset-tonal-surface'} text-xs">{rel.visibility}</span>
								{/if}
								<span class="badge {REL_STATUS_BADGE[rel.status] ?? 'preset-tonal-surface'} text-xs">{rel.status}</span>
								<button class="btn btn-sm preset-tonal-surface" onclick={() => startEditRel(rel)}>
									<Icons.Pencil size={13} />
								</button>
								<button class="btn btn-sm preset-tonal-error" onclick={() => deleteRel(rel.id)}>
									<Icons.Trash2 size={13} />
								</button>
							</div>
							{#if rel.description}
								<p class="text-surface-500 mt-1 text-xs">{rel.description}</p>
							{/if}
							{#if rel.reason}
								<p class="text-surface-400 mt-0.5 text-xs italic">Reason: {rel.reason}</p>
							{/if}
						{/if}
					</div>
				{/each}
			</section>
		</div>
	{/if}
</div>

<GraphBuildModal
	open={showBuildModal}
	onOpenChange={(e) => (showBuildModal = e.open)}
	{lorebookId}
	mode={buildMode}
	readySceneCount={buildMode === "extend" ? ungraphedSceneCount : totalSummarizedCount}
	skippedSceneCount={buildMode === "extend" ? ungraphedUnsummarizedCount : 0}
	ungraphedHistoryEntryCount={buildMode === "extend" ? ungraphedHistoryEntryCount : totalDirectHistoryEntryCount}
	existingUnboundNodeCount={nodes.filter((n) => !n.lorebookBindingId && !n.parentNodeId).length}
	existingRelationshipCount={relationships.length}
	onApplied={load}
/>

{#if mergeTargetNode}
	<MergeNodeModal
		open={showMergeModal}
		onOpenChange={(e) => { showMergeModal = e.open; if (!e.open) mergeTargetNode = null }}
		node={mergeTargetNode}
		{nodes}
		{lorebookId}
	/>
{/if}
