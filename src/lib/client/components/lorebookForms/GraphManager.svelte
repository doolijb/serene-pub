<script lang="ts">
	import { onDestroy, onMount } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import * as Icons from "@lucide/svelte"
	import GraphBuildModal from "../modals/GraphBuildModal.svelte"
	import GraphVisualization from "../graph/GraphVisualization.svelte"
	import EmbeddingStatusIcon from "../EmbeddingStatusIcon.svelte"

	interface Props {
		lorebookId: number
	}

	let { lorebookId }: Props = $props()

	const socket = useTypedSocket()

	type NarrativeNode = Sockets.NarrativeGraph.NarrativeNode
	type NarrativeRelationship = Sockets.NarrativeGraph.NarrativeRelationship

	let nodes = $state<NarrativeNode[]>([])
	let relationships = $state<NarrativeRelationship[]>([])
	let ungraphedSceneCount = $state(0)
	let ungraphedUnsummarizedCount = $state(0)
	let totalSummarizedCount = $state(0)
	let isLoading = $state(true)

	// Build modal
	let showBuildModal = $state(false)
	let buildMode = $state<"replace" | "extend">("replace")

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
	let connectHistoryEntryId = $state<number | null>(null)
	let isConnecting = $state(false)

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
				connectHistoryEntryId = null
				isConnecting = false
			}
		)
		socket.on("historyEntries:list", (msg) => {
			historyEntries = msg.historyEntryList
		})
		socket.emit("historyEntries:list", { lorebookId })
		load()
	})

	onDestroy(() => {
		socket.off("narrativeGraph:list")
		socket.off("narrativeGraph:updateNode")
		socket.off("narrativeGraph:deleteNode")
		socket.off("narrativeGraph:updateRelationship")
		socket.off("narrativeGraph:deleteRelationship")
		socket.off("narrativeGraph:createRelationship")
		socket.off("historyEntries:list")
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
			historyEntryId: connectHistoryEntryId ?? undefined
		} satisfies Sockets.NarrativeGraph.CreateRelationship.Params)
	}

	function cancelConnect() {
		connectingFromNode = null
		connectToNodeId = null
		connectHistoryEntryId = null
		isConnecting = false
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
		selectedNode = null
	}

	function cancelEdit() {
		editingNode = null
		editingRel = null
		pendingDeleteNodeId = null
	}

	function nodeName(id: number): string {
		return nodeMap.get(id)?.name ?? `Node #${id}`
	}

	const NODE_TYPE_COLOR: Record<string, string> = {
		character: "preset-tonal-primary",
		location: "preset-tonal-secondary",
		faction: "preset-tonal-warning",
		item: "preset-tonal-success",
		concept: "preset-tonal-error",
		event: "preset-tonal-surface"
	}

	const REL_STATUS_BADGE: Record<string, string> = {
		active: "preset-tonal-success",
		resolved: "preset-tonal-surface",
		broken: "preset-tonal-error",
		evolved: "preset-tonal-warning"
	}

	const RELATIONSHIP_TYPES = [
		"ally", "enemy", "rival", "mentor", "student", "family",
		"romantic", "neutral", "complicated", "life_debt", "betrayal",
		"contract", "unknown"
	] as const

	const RELATIONSHIP_STATUSES = ["active", "resolved", "broken", "evolved"] as const
</script>

<div class="flex h-full flex-col gap-3 pt-2">
	<!-- ── Toolbar ──────────────────────────────────────────────────────────── -->
	<div class="flex items-center gap-2">
		<button
			class="btn btn-sm preset-filled-primary-500"
			onclick={() => {
				buildMode = "replace"
				showBuildModal = true
			}}
			title="Build graph from scenes"
		>
			<Icons.Cpu size={14} />
			Build Graph
		</button>
		<button
			class="btn btn-sm preset-tonal-surface"
			onclick={() => {
				buildMode = "extend"
				showBuildModal = true
			}}
			title={ungraphedSceneCount === 0
				? ungraphedUnsummarizedCount > 0
					? `${ungraphedUnsummarizedCount} scene${ungraphedUnsummarizedCount === 1 ? "" : "s"} need summaries before they can be graphed`
					: "Graph is up to date"
				: `Extend graph with ${ungraphedSceneCount} new scene${ungraphedSceneCount === 1 ? "" : "s"}${ungraphedUnsummarizedCount > 0 ? ` (${ungraphedUnsummarizedCount} more need summaries)` : ""}`}
			disabled={nodes.length === 0 || ungraphedSceneCount === 0}
		>
			<Icons.Layers size={14} />
			Extend
			{#if ungraphedSceneCount > 0}
				<span class="badge-icon preset-filled-primary-500 text-[10px]">{ungraphedSceneCount}</span>
			{/if}
		</button>
		<div class="ml-auto flex gap-1">
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
			<button
				class="btn btn-sm preset-filled-primary-500"
				onclick={() => (showBuildModal = true)}
			>
				<Icons.Cpu size={14} /> Build Graph
			</button>
		</div>
	{:else if viewMode === "graph"}
		<!-- ── Graph visualization ──────────────────────────────────────────── -->
		<div class="bg-surface-200-800 min-h-72 flex-1 overflow-hidden rounded-lg">
			<GraphVisualization
				{nodes}
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
			<div class="bg-surface-200-800 rounded-lg p-3 text-sm space-y-1">
				<div class="flex items-center justify-between">
					<span class="font-semibold">{selectedNode.name}</span>
					<div class="flex gap-1">
						<button
							class="btn btn-sm preset-tonal-surface"
							onclick={() => startConnect(selectedNode!)}
							title="Create relationship from this node"
						><Icons.GitBranch size={13} /></button>
						<button
							class="btn btn-sm preset-tonal-surface"
							onclick={() => startEditNode(selectedNode!)}
						><Icons.Pencil size={13} /></button>
						<button
							class="btn btn-sm preset-tonal-error"
							onclick={() => requestDeleteNode(selectedNode!.id)}
						><Icons.Trash2 size={13} /></button>
						<button
							class="btn btn-sm preset-tonal-surface"
							onclick={() => (selectedNode = null)}
						><Icons.X size={13} /></button>
					</div>
				</div>
				<span class="badge {NODE_TYPE_COLOR[selectedNode.nodeType] ?? 'preset-tonal-surface'} text-xs">
					{selectedNode.nodeType}
				</span>
				{#if selectedNode.summary}
					<p class="text-surface-500 text-xs">{selectedNode.summary}</p>
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
						<select class="select text-sm" bind:value={connectRelType}>
							{#each RELATIONSHIP_TYPES as t}
								<option value={t}>{t.replace("_", " ")}</option>
							{/each}
						</select>
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
				<div class="space-y-1">
					<p class="text-surface-500 text-xs font-semibold uppercase">Type</p>
					<select class="select text-sm" bind:value={editingNode.nodeType}>
						{#each ["character","location","faction","item","concept","event"] as t}
							<option value={t}>{t}</option>
						{/each}
					</select>
				</div>
				<div class="space-y-1">
					<p class="text-surface-500 text-xs font-semibold uppercase">State</p>
					<select class="select text-sm" bind:value={editingNode.nodeState}>
						{#each ["active","resolved","defunct","retconned"] as s}
							<option value={s}>{s}</option>
						{/each}
					</select>
				</div>
				<div class="space-y-1">
					<p class="text-surface-500 text-xs font-semibold uppercase">Summary</p>
					<textarea class="textarea min-h-12 text-sm" bind:value={editingNode.summary}></textarea>
				</div>
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
					<select class="select text-sm" bind:value={editingRel.relationshipType}>
						{#each RELATIONSHIP_TYPES as t}
							<option value={t}>{t.replace("_", " ")}</option>
						{/each}
					</select>
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
					Nodes ({nodes.length})
				</h3>
				{#each nodes as node}
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
									<select class="select text-xs" bind:value={editingNode.nodeType}>
										{#each ["character","location","faction","item","concept","event"] as t}
											<option value={t}>{t}</option>
										{/each}
									</select>
									<select class="select text-xs" bind:value={editingNode.nodeState}>
										{#each ["active","resolved","defunct","retconned"] as s}
											<option value={s}>{s}</option>
										{/each}
									</select>
								</div>
								<textarea class="textarea min-h-12 text-xs" placeholder="Summary…" bind:value={editingNode.summary}></textarea>
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
								<span class="badge {NODE_TYPE_COLOR[node.nodeType] ?? 'preset-tonal-surface'} text-xs">{node.nodeType}</span>
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
									<select class="select flex-1 text-sm" bind:value={editingRel.relationshipType}>
										{#each RELATIONSHIP_TYPES as t}
											<option value={t}>{t.replace("_", " ")}</option>
										{/each}
									</select>
									<button class="btn btn-sm preset-tonal-surface" onclick={cancelEdit}>
										<Icons.X size={13} />
									</button>
									<button class="btn btn-sm preset-filled-primary-500" disabled={isSaving} onclick={saveRel}>
										<Icons.Save size={13} />
									</button>
								</div>
								<div class="flex items-center gap-2">
									<span class="text-surface-500 text-xs">{nodeName(rel.fromNodeId)} → {nodeName(rel.toNodeId)}</span>
									<select class="select ml-auto text-xs" bind:value={editingRel.status}>
										{#each RELATIONSHIP_STATUSES as s}
											<option value={s}>{s}</option>
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
									<span class="text-surface-400 mx-1 text-xs">→ {rel.relationshipType} →</span>
									<span class="font-medium">{nodeName(rel.toNodeId)}</span>
								</span>
								<EmbeddingStatusIcon embeddingModel={rel.embeddingModel} />
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
	skippedSceneCount={buildMode === "extend" ? ungraphedUnsummarizedCount : (totalSummarizedCount === 0 ? 0 : 0)}
	onApplied={load}
/>
