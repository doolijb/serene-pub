<script lang="ts">
	import { onDestroy, onMount, getContext } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import * as Icons from "@lucide/svelte"
	import GraphBuildModal from "../modals/GraphBuildModal.svelte"
	import AbsorbBindingModal from "../modals/AbsorbBindingModal.svelte"
	import GraphVisualization from "../graph/GraphVisualization.svelte"
	import EmbeddingStatusIcon from "../EmbeddingStatusIcon.svelte"

	interface Props {
		lorebookId: number
		// Switches the parent's tab to the Bindings view — the node detail
		// card here is purely informational; all editing (name, summary,
		// state, visibility, attach/detach a character/persona) happens in
		// LorebookBindingsManager (see the merge plan's UI consolidation).
		// Passing a bindingId sorts that binding to the top of the Bindings
		// list and opens it in edit mode.
		onNavigateToBindings?: (bindingId?: number) => void
		// Jump straight to a node when arriving from the Bindings tab's
		// "View relationships" button.
		focusNodeId?: number | null
		onFocusHandled?: () => void
		hasUnsavedChanges?: boolean
	}

	let {
		lorebookId,
		onNavigateToBindings,
		focusNodeId,
		onFocusHandled,
		hasUnsavedChanges = $bindable(false)
	}: Props = $props()

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
	let unresolvedCastSceneCount = $state(0)
	let namelessBindingCount = $state(0)
	let totalDirectHistoryEntryCount = $state(0)
	let isLoading = $state(true)

	let extendReadyCount = $derived(
		ungraphedSceneCount + ungraphedHistoryEntryCount
	)

	// Build modal
	let showBuildModal = $state(false)
	let buildMode = $state<"replace" | "extend">("replace")

	// Active build for this lorebook (from server-side activity store)
	let activeBuild = $derived(
		graphBuildsCtx?.activeBuild?.lorebookId === lorebookId
			? graphBuildsCtx.activeBuild
			: null
	)

	let buildProgressPercent = $derived.by(() => {
		if (!activeBuild || activeBuild.status !== "building") return 0
		if (activeBuild.phase === "loading" || activeBuild.totalScenes === 0)
			return 5
		if (activeBuild.phase === "parsing") return 90
		return Math.max(
			10,
			Math.round(
				(activeBuild.sceneIndex / activeBuild.totalScenes) * 80
			) + 5
		)
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

	// Editing — nodes are purely informational here now (name/summary/state/
	// visibility all edit through LorebookBindingsManager); only
	// relationships are still edited directly in the Graph tab.
	let editingRel = $state<NarrativeRelationship | null>(null)
	let isSaving = $state(false)

	// ── Unsaved changes ────────────────────────────────────────────
	// Compares only the fields the two edit forms below actually bind to —
	// NOT a whole-object diff. `NarrativeRelationship.embedding` changes
	// server-side whenever the app re-vectorizes (independent of anything
	// the user typed here), so diffing the whole object would report dirty
	// for a field the user never touched.
	$effect(() => {
		const current = editingRel
		if (!current) {
			hasUnsavedChanges = false
			return
		}
		const original = relationships.find((r) => r.id === current.id)
		// Same decision as LorebookBindingsManager's equivalent effect:
		// original gone → not dirty, nothing left to discard back to.
		if (!original) {
			hasUnsavedChanges = false
			return
		}
		hasUnsavedChanges =
			current.relationshipType !== original.relationshipType ||
			current.status !== original.status ||
			current.visibility !== original.visibility ||
			current.description !== original.description ||
			current.reason !== original.reason ||
			current.historyEntryId !== original.historyEntryId
	})

	// Delete confirmation
	let pendingDeleteNodeId = $state<number | null>(null)
	let pendingDeleteNodeReferencedByMergeLog = $state(false)

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

	// Arriving from the Bindings tab's "View relationships" button — select
	// that node's detail card as soon as it's loaded.
	$effect(() => {
		if (focusNodeId == null) return
		const node = nodeMap.get(focusNodeId)
		if (!node) return
		selectedNode = node
		editingRel = null
		viewMode = "graph"
		onFocusHandled?.()
	})

	function load() {
		isLoading = true
		socket.emit("narrativeGraph:list", {
			lorebookId
		} satisfies Sockets.NarrativeGraph.List.Params)
	}

	function handleNarrativeGraphList(msg: Sockets.NarrativeGraph.List.Response) {
		nodes = msg.nodes
		relationships = msg.relationships
		ungraphedSceneCount = msg.ungraphedSceneCount ?? 0
		ungraphedUnsummarizedCount = msg.ungraphedUnsummarizedCount ?? 0
		totalSummarizedCount = msg.totalSummarizedCount ?? 0
		ungraphedHistoryEntryCount = msg.ungraphedHistoryEntryCount ?? 0
		totalDirectHistoryEntryCount = msg.totalDirectHistoryEntryCount ?? 0
		unresolvedCastSceneCount = msg.unresolvedCastSceneCount ?? 0
		namelessBindingCount = msg.namelessBindingCount ?? 0
		isLoading = false
	}

	function handleNarrativeGraphUpdateNode(
		msg: Sockets.NarrativeGraph.UpdateNode.Response
	) {
		nodes = nodes.map((n) => (n.id === msg.node.id ? msg.node : n))
		if (selectedNode?.id === msg.node.id) selectedNode = msg.node
		isSaving = false
	}

	function handleNarrativeGraphDeleteNode() {
		load()
		selectedNode = null
	}

	function handleNarrativeGraphCheckNodeMergeReferences(
		msg: Sockets.NarrativeGraph.CheckNodeMergeReferences.Response
	) {
		pendingDeleteNodeReferencedByMergeLog = msg.referencedByMergeLog
	}

	function handleNarrativeGraphUpdateRelationship(
		msg: Sockets.NarrativeGraph.UpdateRelationship.Response
	) {
		relationships = relationships.map((r) =>
			r.id === msg.relationship.id ? msg.relationship : r
		)
		if (selectedRel?.id === msg.relationship.id)
			selectedRel = msg.relationship
		editingRel = null
		isSaving = false
	}

	function handleNarrativeGraphDeleteRelationship() {
		load()
		selectedRel = null
		editingRel = null
	}

	function handleNarrativeGraphCreateRelationship(
		msg: Sockets.NarrativeGraph.CreateRelationship.Response
	) {
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

	function handleHistoryEntriesList(msg: Sockets.HistoryEntries.List.Response) {
		if (msg.lorebookId === lorebookId) {
			historyEntries = msg.historyEntryList
		}
	}

	function handleLorebooksBindingList(
		msg: Sockets.Lorebooks.BindingList.Response
	) {
		if (msg.lorebookId === lorebookId)
			bindings = msg.lorebookBindingList as BindingWithRelations[]
	}

	function handleNarrativeGraphMergeNode() {
		// Absorb rewrites/deletes relationships and deletes the absorbed
		// row outright — simplest and most robust to just reload the
		// whole graph rather than trying to surgically patch every
		// affected node/relationship in local state. The selected node's
		// data (or the node itself) may now be stale/gone either way.
		showMergeModal = false
		mergeTargetNode = null
		selectedNode = null
		load()
	}

	function handleNarrativeGraphUndoMerge() {
		load()
	}

	// The background vectorization queue updates a row's embeddingModel
	// directly in the DB — without this, the badge here only ever refreshes
	// on the next explicit CRUD action, leaving it stale until a manual refresh.
	function handleVectorizationItemUpdated(
		msg: Sockets.Vectorization.ItemUpdated.Response
	) {
		if (msg.lorebookId !== lorebookId) return
		if (msg.type === "narrativeNode") {
			const target = nodes.find((n: any) => n.id === msg.id)
			if (target) (target as any).embeddingModel = msg.embeddingModel
		} else if (msg.type === "narrativeRelationship") {
			const target = relationships.find((r: any) => r.id === msg.id)
			if (target) (target as any).embeddingModel = msg.embeddingModel
		}
	}

	onMount(() => {
		socket.on("narrativeGraph:list", handleNarrativeGraphList)
		socket.on("narrativeGraph:updateNode", handleNarrativeGraphUpdateNode)
		socket.on("narrativeGraph:deleteNode", handleNarrativeGraphDeleteNode)
		socket.on(
			"narrativeGraph:checkNodeMergeReferences",
			handleNarrativeGraphCheckNodeMergeReferences
		)
		socket.on(
			"narrativeGraph:updateRelationship",
			handleNarrativeGraphUpdateRelationship
		)
		socket.on(
			"narrativeGraph:deleteRelationship",
			handleNarrativeGraphDeleteRelationship
		)
		socket.on(
			"narrativeGraph:createRelationship",
			handleNarrativeGraphCreateRelationship
		)
		socket.on("historyEntries:list", handleHistoryEntriesList)
		socket.on("lorebooks:bindingList", handleLorebooksBindingList)
		socket.on("narrativeGraph:mergeNode", handleNarrativeGraphMergeNode)
		socket.on("narrativeGraph:undoMerge", handleNarrativeGraphUndoMerge)
		socket.on("vectorization:itemUpdated", handleVectorizationItemUpdated)
		socket.emit("historyEntries:list", { lorebookId })
		socket.emit("lorebooks:bindingList", { lorebookId })
		load()
	})

	onDestroy(() => {
		hasUnsavedChanges = false
		socket.off("narrativeGraph:list", handleNarrativeGraphList)
		socket.off("narrativeGraph:updateNode", handleNarrativeGraphUpdateNode)
		socket.off("narrativeGraph:deleteNode", handleNarrativeGraphDeleteNode)
		socket.off(
			"narrativeGraph:checkNodeMergeReferences",
			handleNarrativeGraphCheckNodeMergeReferences
		)
		socket.off(
			"narrativeGraph:updateRelationship",
			handleNarrativeGraphUpdateRelationship
		)
		socket.off(
			"narrativeGraph:deleteRelationship",
			handleNarrativeGraphDeleteRelationship
		)
		socket.off(
			"narrativeGraph:createRelationship",
			handleNarrativeGraphCreateRelationship
		)
		socket.off("historyEntries:list", handleHistoryEntriesList)
		socket.off("lorebooks:bindingList", handleLorebooksBindingList)
		socket.off("narrativeGraph:mergeNode", handleNarrativeGraphMergeNode)
		socket.off("narrativeGraph:undoMerge", handleNarrativeGraphUndoMerge)
		socket.off("vectorization:itemUpdated", handleVectorizationItemUpdated)
	})

	function requestDeleteNode(id: number) {
		pendingDeleteNodeId = id
		pendingDeleteNodeReferencedByMergeLog = false
		socket.emit("narrativeGraph:checkNodeMergeReferences", {
			nodeId: id
		} satisfies Sockets.NarrativeGraph.CheckNodeMergeReferences.Params)
	}

	function confirmDeleteNode() {
		if (pendingDeleteNodeId === null) return
		socket.emit("narrativeGraph:deleteNode", {
			id: pendingDeleteNodeId
		} satisfies Sockets.NarrativeGraph.DeleteNode.Params)
		pendingDeleteNodeId = null
		pendingDeleteNodeReferencedByMergeLog = false
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

	function startEditRel(rel: NarrativeRelationship) {
		editingRel = $state.snapshot(rel)
		selectedRel = rel
		// Don't clear selectedNode — rel may be opened from the node's relationship list
	}

	function cancelEdit() {
		editingRel = null
		pendingDeleteNodeId = null
		pendingDeleteNodeReferencedByMergeLog = false
	}

	/**
	 * A binding's display label. `??` alone was not enough: lorebook_bindings.name
	 * is NOT NULL DEFAULT '' (migration 0075, never backfilled, and the boot-time
	 * repair only covers *bound* rows), so unbound/legacy rows carry an empty
	 * string — which `??` passes straight through and renders as nothing at all.
	 * Fall back to the {{char:N}} token, which characterBindingSync's comment
	 * already claims happens "everywhere a binding's name is displayed".
	 */
	function displayName(node: { name?: string; binding?: string } | undefined) {
		return node?.name?.trim() || node?.binding || ""
	}

	function nodeName(id: number): string {
		const node = nodeMap.get(id)
		return displayName(node) || `Node #${id}`
	}

	const NODE_STATE_COLOR: Record<string, string> = {
		active: "preset-tonal-primary",
		deceased: "preset-tonal-error",
		missing: "preset-tonal-surface",
		departed: "preset-tonal-secondary"
	}

	const NODE_VISIBILITY_COLOR: Record<string, string> = {
		normal: "",
		legendary: "preset-tonal-warning",
		hidden: "preset-tonal-surface"
	}

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

	const RELATIONSHIP_VISIBILITIES = [
		"acknowledged",
		"secret",
		"public"
	] as const

	const RELATIONSHIP_STATUSES = [
		"active",
		"resolved",
		"broken",
		"evolved"
	] as const
</script>

<div class="flex h-full flex-col gap-3 pt-2">
	<!-- ── Toolbar ──────────────────────────────────────────────────────────── -->
	<div class="flex items-center gap-2">
		{#if activeBuild}
			<!-- Compact status indicator while build is active -->
			{#if activeBuild.status === "building"}
				<div class="flex items-center gap-2">
					<div
						class="bg-primary-500 h-2 w-2 shrink-0 animate-pulse rounded-full"
					></div>
					<span class="text-surface-700-300 text-sm">Building…</span>
				</div>
			{:else if activeBuild.status === "error"}
				<div class="flex items-center gap-2">
					<Icons.AlertCircle
						size={14}
						class="text-error-500 shrink-0"
					/>
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
				title={nodes.length > 0
					? "Rebuild graph from scratch"
					: "Build graph from scenes"}
			>
				<Icons.Cpu size={14} />
				{nodes.length > 0 ? "Rebuild Graph" : "Build Graph"}
			</button>
			<button
				class="btn btn-sm preset-filled-surface-400-600"
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
					<span
						class="badge-icon preset-filled-primary-500 text-[10px]"
					>
						{extendReadyCount}
					</span>
				{/if}
			</button>
		{/if}
		<div class="ml-auto flex gap-1">
			{#if onNavigateToBindings}
				<button
					class="btn btn-sm preset-filled-surface-400-600"
					onclick={() => onNavigateToBindings?.()}
					title="Add or edit a character's identity in the Bindings tab"
				>
					<Icons.Plus size={14} /> Add Character
				</button>
			{/if}
			<button
				class="btn btn-sm {viewMode === 'graph'
					? 'preset-filled-surface-500'
					: 'preset-filled-surface-400-600'}"
				onclick={() => (viewMode = "graph")}
				title="Graph view"
			>
				<Icons.Network size={14} />
			</button>
			<button
				class="btn btn-sm {viewMode === 'list'
					? 'preset-filled-surface-500'
					: 'preset-filled-surface-400-600'}"
				onclick={() => (viewMode = "list")}
				title="List view"
			>
				<Icons.List size={14} />
			</button>
		</div>
		<button
			class="btn btn-sm preset-filled-surface-400-600"
			onclick={load}
			title="Refresh"
		>
			<Icons.RefreshCw size={14} />
		</button>
	</div>

	<!-- ── Build progress card (shown when a build is active) ──────────────── -->
	{#if activeBuild}
		<div
			class="bg-surface-200-800 border-surface-300-700 space-y-2 rounded-lg border p-3 text-sm"
		>
			{#if activeBuild.status === "building"}
				<div class="space-y-1.5">
					<p class="text-surface-700-300 text-xs capitalize">
						{activeBuild.phase.replace(/_/g, " ")}
						{#if activeBuild.totalScenes > 0}· scene {activeBuild.sceneIndex +
								1}/{activeBuild.totalScenes}{/if}
					</p>
					<div
						class="bg-surface-300-700 h-1.5 w-full overflow-hidden rounded-full"
					>
						<div
							class="bg-primary-500 h-full rounded-full transition-all duration-500"
							style="width: {buildProgressPercent}%"
						></div>
					</div>
					{#if activeBuild.currentPair}
						<p class="text-surface-400 truncate font-mono text-xs">
							{activeBuild.currentPair}
						</p>
					{/if}
				</div>
				<div class="flex items-center gap-2">
					{#if activeBuild.activityId}
						<button
							class="btn btn-sm preset-tonal-error"
							onclick={() =>
								socket.emit("activity:cancel", {
									id: activeBuild!.activityId!
								})}
						>
							<Icons.Square size={14} /> Stop
						</button>
					{/if}
					<button
						class="btn btn-sm preset-filled-surface-400-600"
						onclick={() => {
							if (activeBuild) buildMode = activeBuild.mode
							showBuildModal = true
						}}
					>
						<Icons.Eye size={14} /> View Progress
					</button>
				</div>
			{:else if activeBuild.status === "review"}
				<div class="flex items-center gap-2">
					<Icons.CheckCircle
						size={14}
						class="text-success-500 shrink-0"
					/>
					<span class="text-success-500 font-medium">
						100% complete
					</span>
					<div class="ml-auto flex gap-2">
						<button
							class="btn btn-sm preset-tonal-warning"
							onclick={() => {
								graphBuildsCtx?.clearBuild()
								buildMode = "replace"
								showBuildModal = true
							}}
							title="Discard this unapplied result and start a fresh build"
						>
							<Icons.RefreshCw size={14} /> Rebuild Graph
						</button>
						<button
							class="btn btn-sm preset-filled-primary-500"
							onclick={() => {
								if (activeBuild) buildMode = activeBuild.mode
								showBuildModal = true
							}}
						>
							<Icons.Check size={14} /> Review & Apply
						</button>
					</div>
				</div>
			{:else if activeBuild.status === "error"}
				<div class="space-y-2">
					<div class="flex items-center gap-2">
						<Icons.AlertCircle
							size={14}
							class="text-error-500 shrink-0"
						/>
						<span class="text-error-500">Build failed</span>
						{#if activeBuild.errorMessage}
							<span class="text-surface-700-300 truncate text-xs">
								— {activeBuild.errorMessage}
							</span>
						{/if}
					</div>
					<button
						class="btn btn-sm preset-tonal-error"
						onclick={() => {
							if (activeBuild) buildMode = activeBuild.mode
							showBuildModal = true
						}}
					>
						<Icons.AlertCircle size={14} /> View Error
					</button>
				</div>
			{/if}
		</div>
	{/if}


	{#if namelessBindingCount > 0}
		<!--
			These rows have an empty `name`, so no extracted character name can
			ever match them and a build will propose a fresh node beside each.
			They come from migration 0075 adding the column with DEFAULT '' and
			no backfill (the boot-time repair only covers *bound* rows), and
			their original names were lost when narrative_nodes was dropped.
			Nothing can recover them automatically — surfaced so they can be
			named or deleted by hand.
		-->
		<div
			class="bg-surface-200-800 border-surface-400-600 mt-2 flex items-center gap-2 rounded-lg border p-3 text-sm"
		>
			<Icons.HelpCircle
				size={14}
				class="text-surface-600-400 shrink-0"
			/>
			<span class="text-surface-700-300">
				{namelessBindingCount} graph {namelessBindingCount === 1
					? "entry has"
					: "entries have"} no name, so
				{namelessBindingCount === 1 ? "it can't" : "they can't"} be matched
				to any character a build finds. Rename or delete
				{namelessBindingCount === 1 ? "it" : "them"} in the list below.
			</span>
		</div>
	{/if}

	{#if isLoading}
		<div
			class="text-surface-700-300 flex items-center justify-center py-10 text-sm"
		>
			<div
				class="bg-primary-500 mr-2 h-2 w-2 animate-pulse rounded-full"
			></div>
			Loading…
		</div>
	{:else if nodes.length === 0}
		<!-- Empty state -->
		<div
			class="text-surface-700-300 flex flex-col items-center gap-3 py-10 text-center text-sm"
		>
			<Icons.Network size={32} class="opacity-30" />
			<div>
				<p class="font-medium">No graph yet</p>
				<p class="mt-1 text-xs opacity-70">
					Build a graph from your scenes to extract entities and
					relationships.
				</p>
			</div>
			{#if activeBuild?.status === "building"}
				<div class="flex items-center gap-2">
					<div
						class="bg-primary-500 h-2 w-2 animate-pulse rounded-full"
					></div>
					<span class="capitalize">
						{activeBuild.phase.replace(/_/g, " ")}…
					</span>
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
		<div
			class="bg-surface-200-800 min-h-72 flex-1 overflow-hidden rounded-lg"
		>
			<GraphVisualization
				nodes={parentNodes}
				{relationships}
				onNodeClick={(n) => {
					selectedNode = n
					selectedRel = null
					editingRel = null
				}}
				onRelClick={(r) => {
					selectedRel = r
					selectedNode = null
					editingRel = null
				}}
			/>
		</div>

		<!-- Selected node detail (purely informational — editing happens in
		     the Bindings tab, see the "Edit" button below) -->
		{#if selectedNode}
			{@const nodeRels = relationships.filter(
				(r) => r.fromNodeId === selectedNode!.id
			)}
			<div class="bg-surface-200-800 space-y-2 rounded-lg p-3 text-sm">
				<!-- Header -->
				<div class="flex items-center justify-between">
					<span class="font-semibold">{selectedNode.name}</span>
					<div class="flex gap-1">
						<button
							class="btn btn-sm preset-filled-surface-400-600"
							onclick={() => startConnect(selectedNode!)}
							title="Add relationship from this node"
						>
							<Icons.GitBranch size={13} />
						</button>
						<button
							class="btn btn-sm preset-filled-surface-400-600"
							onclick={() => onNavigateToBindings?.(selectedNode!.id)}
							title="Edit in the Bindings tab"
						>
							<Icons.Pencil size={13} />
						</button>
						<button
							class="btn btn-sm preset-tonal-warning"
							onclick={() => {
								mergeTargetNode = selectedNode
								showMergeModal = true
							}}
							title="Absorb into another character (they're the same person)"
						>
							<Icons.GitMerge size={13} />
						</button>
						<button
							class="btn btn-sm preset-tonal-error"
							onclick={() => requestDeleteNode(selectedNode!.id)}
							title="Delete node"
						>
							<Icons.Trash2 size={13} />
						</button>
						<button
							class="btn btn-sm preset-filled-surface-400-600"
							onclick={() => {
								selectedNode = null
								editingRel = null
							}}
						>
							<Icons.X size={13} />
						</button>
					</div>
				</div>
				<!-- Badges -->
				<div class="flex flex-wrap gap-1">
					<span
						class="badge {NODE_STATE_COLOR[
							selectedNode.nodeState
						] ?? 'preset-tonal-surface'} text-xs"
					>
						{selectedNode.nodeState}
					</span>
					{#if selectedNode.nodeVisibility !== "normal"}
						<span
							class="badge {NODE_VISIBILITY_COLOR[
								selectedNode.nodeVisibility
							] ?? 'preset-tonal-surface'} text-xs"
						>
							{selectedNode.nodeVisibility}
						</span>
					{/if}
				</div>
				{#if selectedNode.summary}
					<p class="text-surface-700-300 text-xs">
						{selectedNode.summary}
					</p>
				{/if}
				{#if [...(selectedNode.aliases ?? []), ...(selectedNode.absorbedAliases ?? [])].length > 0}
					<div class="space-y-1">
						<span class="text-surface-400 text-xs">
							Also known as:
						</span>
						<div class="flex flex-wrap gap-1">
							{#each [...new Set([...(selectedNode.aliases ?? []), ...(selectedNode.absorbedAliases ?? [])])] as alias}
								<span
									class="badge preset-tonal-surface text-xs"
								>
									{alias}
								</span>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Relationships -->
				<div class="border-surface-300-700 space-y-2 border-t pt-2">
					<p
						class="text-surface-700-300 text-xs font-semibold uppercase"
					>
						Relationships
					</p>
					{#if nodeRels.length === 0 && connectingFromNode?.id !== selectedNode.id}
						<p class="text-surface-400 text-xs italic">
							No relationships yet.
						</p>
					{/if}
					{#each nodeRels as rel (rel.id)}
							{#if editingRel?.id === rel.id}
								<!-- Inline edit card -->
								<div
									class="bg-surface-100-900 border-surface-300-700 space-y-2 rounded-lg border p-3"
								>
									<div
										class="text-surface-700-300 flex items-center gap-1 text-xs"
									>
										<Icons.ArrowRight
											size={11}
											class="text-primary-400 shrink-0"
										/>
										<span class="font-medium">
											→ {nodeName(rel.toNodeId)}
										</span>
									</div>
									<input
										class="input w-full text-sm"
										type="text"
										placeholder="Relationship type…"
										bind:value={editingRel.relationshipType}
									/>
									<div class="grid grid-cols-2 gap-2">
										<select
											class="select text-xs"
											bind:value={editingRel.status}
										>
											{#each RELATIONSHIP_STATUSES as s}
												<option value={s}>{s}</option>
											{/each}
										</select>
										<select
											class="select text-xs"
											bind:value={editingRel.visibility}
										>
											{#each RELATIONSHIP_VISIBILITIES as v}
												<option value={v}>{v}</option>
											{/each}
										</select>
									</div>
									<textarea
										class="textarea min-h-10 text-xs"
										placeholder="Description…"
										bind:value={editingRel.description}
									></textarea>
									<input
										class="input text-xs"
										type="text"
										placeholder="Reason for this state…"
										bind:value={editingRel.reason}
									/>
									{#if historyEntries.length > 0}
										<select
											class="select text-xs"
											bind:value={
												editingRel.historyEntryId
											}
										>
											<option value={null}>
												— no date —
											</option>
											{#each historyEntries as he}
												<option value={he.id}>
													Year {he.year}{he.month
														? `, Mo. ${he.month}`
														: ""}{he.day
														? `, Day ${he.day}`
														: ""}
												</option>
											{/each}
										</select>
									{/if}
									<div class="flex justify-end gap-2">
										<button
											class="btn btn-sm preset-filled-surface-400-600"
											onclick={() => {
												editingRel = null
											}}
										>
											Cancel
										</button>
										<button
											class="btn btn-sm preset-filled-primary-500"
											disabled={isSaving}
											onclick={saveRel}
										>
											<Icons.Save size={13} /> Update
										</button>
									</div>
								</div>
							{:else}
								<!-- View card -->
								<div
									class="bg-surface-100-900 border-surface-300-700 space-y-1.5 rounded-lg border p-2.5"
								>
									<div class="flex items-center gap-1.5">
										<Icons.ArrowRight
											size={12}
											class="text-primary-400 shrink-0"
										/>
										<span
											class="flex-1 truncate text-xs font-semibold"
										>
											{rel.relationshipType.replace(
												/_/g,
												" "
											)}
										</span>
										<span
											class="text-surface-400 shrink-0 text-xs"
										>
											→ {nodeName(rel.toNodeId)}
										</span>
									</div>
									<div class="flex items-center gap-1.5">
										<span
											class="badge {REL_STATUS_BADGE[
												rel.status
											] ??
												'preset-tonal-surface'} text-xs"
										>
											{rel.status}
										</span>
										{#if rel.historyEntryId}
											{@const he = historyEntries.find(
												(h) =>
													h.id === rel.historyEntryId
											)}
											{#if he}
												<span
													class="text-surface-700-300 text-xs"
												>
													Yr {he.year}{he.month
														? `, Mo. ${he.month}`
														: ""}
												</span>
											{/if}
										{/if}
										<div class="ml-auto flex gap-1">
											<button
												class="btn btn-sm preset-filled-surface-400-600 p-1"
												onclick={() => startEditRel(rel)}
												title="Edit relationship"
											>
												<Icons.Pencil size={11} />
											</button>
											<button
												class="btn btn-sm preset-tonal-error p-1"
												onclick={() =>
													deleteRel(rel.id)}
												title="Delete relationship"
											>
												<Icons.Trash2 size={11} />
											</button>
										</div>
									</div>
									{#if rel.description}
										<p
											class="text-surface-700-300 text-xs leading-snug"
										>
											{rel.description}
										</p>
									{/if}
								</div>
							{/if}
						{/each}
					</div>
			</div>
		{/if}

		{#if pendingDeleteNodeId !== null}
			{@const relCount = relationships.filter(
				(r) =>
					r.fromNodeId === pendingDeleteNodeId ||
					r.toNodeId === pendingDeleteNodeId
			).length}
			{@const nodeName =
				nodeMap.get(pendingDeleteNodeId)?.name ?? "this node"}
			<div
				class="bg-surface-200-800 border-error-500/40 space-y-2 rounded-lg border p-3 text-sm"
			>
				<p class="text-error-500 font-semibold">Delete "{nodeName}"?</p>
				{#if relCount > 0}
					<p class="text-surface-700-300 text-xs">
						This will also permanently delete <strong>
							{relCount} relationship{relCount === 1 ? "" : "s"}
						</strong>
						.
					</p>
				{/if}
				{#if pendingDeleteNodeReferencedByMergeLog}
					<p class="text-warning-500 text-xs">
						This node is referenced by a past merge record —
						deleting it will permanently disable that merge's undo.
					</p>
				{/if}
				<div class="flex justify-end gap-2">
					<button
						class="btn btn-sm preset-filled-surface-400-600"
						onclick={() => {
							pendingDeleteNodeId = null
							pendingDeleteNodeReferencedByMergeLog = false
						}}
					>
						Cancel
					</button>
					<button
						class="btn btn-sm preset-filled-error-500"
						onclick={() => {
							confirmDeleteNode()
							selectedNode = null
						}}
					>
						<Icons.Trash2 size={13} /> Delete
					</button>
				</div>
			</div>
		{/if}

		{#if connectingFromNode && connectingFromNode.id === selectedNode?.id}
			<div class="bg-surface-200-800 space-y-2 rounded-lg p-3 text-sm">
				<p class="font-semibold">
					Connect: {connectingFromNode.name} →
				</p>
				<div class="space-y-1">
					<p
						class="text-surface-700-300 text-xs font-semibold uppercase"
					>
						Target Node
					</p>
					<select class="select text-sm" bind:value={connectToNodeId}>
						<option value={null} disabled>Select a node…</option>
						{#each nodes.filter((n) => n.id !== connectingFromNode!.id) as n}
							<option value={n.id}>{displayName(n)}</option>
						{/each}
					</select>
				</div>
				<div class="grid grid-cols-2 gap-2">
					<div class="space-y-1">
						<p
							class="text-surface-700-300 text-xs font-semibold uppercase"
						>
							Type
						</p>
						<input
							class="input text-sm"
							type="text"
							bind:value={connectRelType}
							placeholder="e.g. ally, romantic, rival"
						/>
					</div>
					<div class="space-y-1">
						<p
							class="text-surface-700-300 text-xs font-semibold uppercase"
						>
							Status
						</p>
						<select
							class="select text-sm"
							bind:value={connectRelStatus}
						>
							{#each RELATIONSHIP_STATUSES as s}
								<option value={s}>{s}</option>
							{/each}
						</select>
					</div>
				</div>
				<div class="space-y-1">
					<p
						class="text-surface-700-300 text-xs font-semibold uppercase"
					>
						Visibility
					</p>
					<select
						class="select text-sm"
						bind:value={connectVisibility}
					>
						{#each RELATIONSHIP_VISIBILITIES as v}
							<option value={v}>{v}</option>
						{/each}
					</select>
				</div>
				<div class="space-y-1">
					<p
						class="text-surface-700-300 text-xs font-semibold uppercase"
					>
						Description (optional)
					</p>
					<textarea
						class="textarea min-h-10 text-sm"
						placeholder="Describe the relationship…"
						bind:value={connectDescription}
					></textarea>
				</div>
				{#if historyEntries.length > 0}
					<div class="space-y-1">
						<p
							class="text-surface-700-300 text-xs font-semibold uppercase"
						>
							When (optional)
						</p>
						<select
							class="select text-sm"
							bind:value={connectHistoryEntryId}
						>
							<option value={null}>— none —</option>
							{#each historyEntries as he}
								<option value={he.id}>
									Year {he.year}{he.month
										? `, Mo. ${he.month}`
										: ""}{he.day ? `, Day ${he.day}` : ""}
								</option>
							{/each}
						</select>
					</div>
				{/if}
				<div class="flex justify-end gap-2">
					<button
						class="btn btn-sm preset-filled-surface-400-600"
						onclick={cancelConnect}
					>
						Cancel
					</button>
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

		{#if selectedRel && !editingRel}
			<div class="bg-surface-200-800 space-y-1 rounded-lg p-3 text-sm">
				<div class="flex items-center justify-between">
					<span class="font-semibold">
						{nodeName(selectedRel.fromNodeId)} → {selectedRel.relationshipType}
						→ {nodeName(selectedRel.toNodeId)}
					</span>
					<div class="flex gap-1">
						<button
							class="btn btn-sm preset-filled-surface-400-600"
							onclick={() => startEditRel(selectedRel!)}
						>
							<Icons.Pencil size={13} />
						</button>
						<button
							class="btn btn-sm preset-tonal-error"
							onclick={() => {
								deleteRel(selectedRel!.id)
								selectedRel = null
							}}
						>
							<Icons.Trash2 size={13} />
						</button>
						<button
							class="btn btn-sm preset-filled-surface-400-600"
							onclick={() => (selectedRel = null)}
						>
							<Icons.X size={13} />
						</button>
					</div>
				</div>
				<span
					class="badge {REL_STATUS_BADGE[selectedRel.status] ??
						'preset-tonal-surface'} text-xs"
				>
					{selectedRel.status}
				</span>
				{#if selectedRel.description}
					<p class="text-xs">{selectedRel.description}</p>
				{/if}
				{#if selectedRel.reason}
					<p class="text-surface-700-300 text-xs italic">
						Reason: {selectedRel.reason}
					</p>
				{/if}
			</div>
		{/if}

		{#if selectedRel && editingRel}
			<div class="bg-surface-200-800 space-y-2 rounded-lg p-3 text-sm">
				<p class="font-semibold">Edit Relationship</p>
				<div class="space-y-1">
					<label
						for="relType"
						class="text-surface-700-300 text-xs font-semibold uppercase"
					>
						Type
					</label>
					<input
						id="relType"
						class="input text-sm"
						type="text"
						bind:value={editingRel.relationshipType}
					/>
				</div>
				<div class="space-y-1">
					<label
						for="relStatus"
						class="text-surface-700-300 text-xs font-semibold uppercase"
					>
						Status
					</label>
					<select
						id="relStatus"
						class="select text-sm"
						bind:value={editingRel.status}
					>
						{#each RELATIONSHIP_STATUSES as s}
							<option value={s}>{s}</option>
						{/each}
					</select>
				</div>
				<div class="space-y-1">
					<label
						for="relDescription"
						class="text-surface-700-300 text-xs font-semibold uppercase"
					>
						Description
					</label>
					<textarea
						id="relDescription"
						class="textarea min-h-12 text-sm"
						bind:value={editingRel.description}
					></textarea>
				</div>
				<div class="space-y-1">
					<label
						for="relReason"
						class="text-surface-700-300 text-xs font-semibold uppercase"
					>
						Reason for this state
					</label>
					<input
						id="relReason"
						class="input text-sm"
						type="text"
						bind:value={editingRel.reason}
					/>
				</div>
				{#if historyEntries.length > 0}
					<div class="space-y-1">
						<label
							for="relHistoryEntry"
							class="text-surface-700-300 text-xs font-semibold uppercase"
						>
							When (optional)
						</label>
						<select
							id="relHistoryEntry"
							class="select text-sm"
							bind:value={editingRel.historyEntryId}
						>
							<option value={null}>— none —</option>
							{#each historyEntries as he}
								<option value={he.id}>
									Year {he.year}{he.month
										? `, Mo. ${he.month}`
										: ""}{he.day ? `, Day ${he.day}` : ""}
								</option>
							{/each}
						</select>
					</div>
				{/if}
				<div class="flex justify-end gap-2">
					<button
						class="btn btn-sm preset-filled-surface-400-600"
						onclick={cancelEdit}
					>
						Cancel
					</button>
					<button
						class="btn btn-sm preset-filled-primary-500"
						disabled={isSaving}
						onclick={saveRel}
					>
						<Icons.Save size={13} /> Update
					</button>
				</div>
			</div>
		{/if}
	{:else if viewMode === "list"}
		<!-- ── List view ────────────────────────────────────────────────────── -->
		<div class="space-y-4 overflow-y-auto">
			<!-- Nodes list -->
			<section class="space-y-1">
				<h3
					class="text-surface-700-300 text-xs font-semibold tracking-wide uppercase"
				>
					Nodes ({parentNodes.length})
				</h3>
				{#each parentNodes as node}
					<div
						class="bg-surface-200-800 border-surface-300-700 hover:preset-filled-surface-300-700 cursor-pointer rounded-lg border px-3 py-2 transition-colors"
						role="button"
						tabindex="0"
						onclick={() => {
							selectedNode = node
							viewMode = "graph"
						}}
						onkeydown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								selectedNode = node
								viewMode = "graph"
							}
						}}
					>
						<div class="flex items-center gap-2">
							<span class="flex-1 truncate text-sm font-medium">
								{displayName(node)}
							</span>
							<EmbeddingStatusIcon
								embeddingModel={node.embeddingModel}
							/>
							<span
								class="badge {NODE_STATE_COLOR[
									node.nodeState
								] ?? 'preset-tonal-surface'} text-xs"
							>
								{node.nodeState}
							</span>
							{#if node.nodeVisibility !== "normal"}
								<span
									class="badge {NODE_VISIBILITY_COLOR[
										node.nodeVisibility
									] ?? 'preset-tonal-surface'} text-xs"
								>
									{node.nodeVisibility}
								</span>
							{/if}
							<button
								class="btn btn-sm preset-filled-surface-400-600"
								onclick={(e) => {
									e.stopPropagation()
									onNavigateToBindings?.(node.id)
								}}
								title="Edit in the Bindings tab"
							>
								<Icons.Pencil size={13} />
							</button>
							<button
								class="btn btn-sm preset-tonal-error"
								onclick={(e) => {
									e.stopPropagation()
									requestDeleteNode(node.id)
								}}
							>
								<Icons.Trash2 size={13} />
							</button>
						</div>
						{#if node.summary}
							<p class="text-surface-700-300 mt-1 text-xs">
								{node.summary}
							</p>
						{/if}
					</div>
				{/each}
			</section>

			<!-- Relationships list -->
			<section class="space-y-1">
				<h3
					class="text-surface-700-300 text-xs font-semibold tracking-wide uppercase"
				>
					Relationships ({relationships.length})
				</h3>
				{#each relationships as rel}
					<div
						class="bg-surface-200-800 border-surface-300-700 rounded-lg border px-3 py-2"
					>
						{#if editingRel?.id === rel.id}
							<div class="space-y-2">
								<div class="flex items-center gap-2">
									<input
										class="input flex-1 text-sm"
										type="text"
										bind:value={editingRel.relationshipType}
									/>
									<button
										class="btn btn-sm preset-filled-surface-400-600"
										aria-label="Cancel"
										onclick={cancelEdit}
									>
										<Icons.X size={13} />
									</button>
									<button
										class="btn btn-sm preset-filled-primary-500"
										aria-label="Save"
										disabled={isSaving}
										onclick={saveRel}
									>
										<Icons.Save size={13} />
									</button>
								</div>
								<div class="flex items-center gap-2">
									<span
										class="text-surface-700-300 shrink-0 text-xs"
									>
										{nodeName(rel.fromNodeId)} → {nodeName(
											rel.toNodeId
										)}
									</span>
									<select
										class="select ml-auto text-xs"
										bind:value={editingRel.status}
									>
										{#each RELATIONSHIP_STATUSES as s}
											<option value={s}>{s}</option>
										{/each}
									</select>
									<select
										class="select text-xs"
										bind:value={editingRel.visibility}
									>
										{#each RELATIONSHIP_VISIBILITIES as v}
											<option value={v}>{v}</option>
										{/each}
									</select>
								</div>
								<textarea
									class="textarea min-h-10 text-xs"
									placeholder="Description…"
									bind:value={editingRel.description}
								></textarea>
								<input
									class="input text-xs"
									type="text"
									placeholder="Reason for this state…"
									bind:value={editingRel.reason}
								/>
								{#if historyEntries.length > 0}
									<select
										class="select text-xs"
										bind:value={editingRel.historyEntryId}
									>
										<option value={null}>— none —</option>
										{#each historyEntries as he}
											<option value={he.id}>
												Year {he.year}{he.month
													? `, Mo. ${he.month}`
													: ""}{he.day
													? `, Day ${he.day}`
													: ""}
											</option>
										{/each}
									</select>
								{/if}
							</div>
						{:else}
							<div class="flex items-center gap-2">
								<span class="flex-1 truncate text-sm">
									<span class="font-medium">
										{nodeName(rel.fromNodeId)}
									</span>
									<span class="text-surface-400 mx-1 text-xs">
										→ {rel.relationshipType.replace(
											/_/g,
											" "
										)} →
									</span>
									<span class="font-medium">
										{nodeName(rel.toNodeId)}
									</span>
								</span>
								<EmbeddingStatusIcon
									embeddingModel={rel.embeddingModel}
								/>
								{#if rel.visibility && rel.visibility !== "acknowledged"}
									<span
										class="badge {REL_VISIBILITY_BADGE[
											rel.visibility
										] ?? 'preset-tonal-surface'} text-xs"
									>
										{rel.visibility}
									</span>
								{/if}
								<span
									class="badge {REL_STATUS_BADGE[
										rel.status
									] ?? 'preset-tonal-surface'} text-xs"
								>
									{rel.status}
								</span>
								<button
									class="btn btn-sm preset-filled-surface-400-600"
									onclick={() => startEditRel(rel)}
								>
									<Icons.Pencil size={13} />
								</button>
								<button
									class="btn btn-sm preset-tonal-error"
									onclick={() => deleteRel(rel.id)}
								>
									<Icons.Trash2 size={13} />
								</button>
							</div>
							{#if rel.description}
								<p class="text-surface-700-300 mt-1 text-xs">
									{rel.description}
								</p>
							{/if}
							{#if rel.reason}
								<p
									class="text-surface-400 mt-0.5 text-xs italic"
								>
									Reason: {rel.reason}
								</p>
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
	readySceneCount={buildMode === "extend"
		? ungraphedSceneCount
		: totalSummarizedCount}
	skippedSceneCount={buildMode === "extend" ? ungraphedUnsummarizedCount : 0}
	ungraphedHistoryEntryCount={buildMode === "extend"
		? ungraphedHistoryEntryCount
		: totalDirectHistoryEntryCount}
	existingUnboundNodeCount={nodes.filter(
		(n) => n.characterId == null && n.personaId == null && !n.parentNodeId
	).length}
	existingRelationshipCount={relationships.length}
	{unresolvedCastSceneCount}
	onApplied={load}
/>

{#if mergeTargetNode}
	<AbsorbBindingModal
		open={showMergeModal}
		onOpenChange={(e) => {
			showMergeModal = e.open
			if (!e.open) mergeTargetNode = null
		}}
		node={mergeTargetNode}
		{nodes}
		{lorebookId}
	/>
{/if}

