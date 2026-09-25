<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { getContext, onDestroy, onMount } from "svelte"
	import { SvelteSet } from "svelte/reactivity"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import {
		declareInterest,
		useInterest
	} from "$lib/client/sockets/interest.svelte"
	import { interestKey } from "$lib/shared/sockets/interest"
	import PanelToolbar from "$lib/client/components/panels/PanelToolbar.svelte"
	import PipelineConfigOptions from "$lib/client/components/pipelines/PipelineConfigOptions.svelte"
	import EmbeddingStatusIcon from "$lib/client/components/EmbeddingStatusIcon.svelte"
	import EmptyState from "$lib/client/components/EmptyState.svelte"
	import GraphBuildModal from "$lib/client/components/modals/GraphBuildModal.svelte"
	import AbsorbBindingModal from "$lib/client/components/modals/AbsorbBindingModal.svelte"
	import {
		CHARACTER_LORE_TYPE_ID,
		HISTORY_TYPE_ID,
		WORLD_LORE_TYPE_ID
	} from "$lib/shared/entries/types"
	import LinkForm from "./graphs/LinkForm.svelte"
	import NodePanel from "./graphs/NodePanel.svelte"
	import RelationshipsCanvas from "./graphs/RelationshipsCanvas.svelte"
	import PlacesBoard from "./places/PlacesBoard.svelte"
	import { buildPlacesMap } from "./places/placesMap"
	import { edgesAtMoment, type DatedEntryLike } from "./graphs/asOf"
	import {
		castKey,
		ceilingFactsFrom,
		ceilingLine,
		entriesWithLinks,
		entryKey,
		graphEdges,
		graphHeaderLine,
		graphNodes,
		nodeNames,
		panelEdges,
		type CeilingFacts,
		type GraphEdge,
		type GraphNode
	} from "./graphs/graphModel"
	import {
		createLinkParams,
		newLinkDraft,
		type LinkDraft
	} from "./graphs/linkDraft"
	import {
		edgedCastPairs,
		notDrawnSentence,
		scenesNamingNone,
		unnamedPairsFor
	} from "./graphs/sceneGaps"
	import { loreRoute } from "./loreRoute.svelte"
	import { graphBuildReason, type LoreDrawing } from "./graphs"
	import { SCOPE_KIND, SCOPE_LABELS } from "./loreRoute"
	import { stateBadge, visibilityBadge } from "./cast/castVocabulary"
	import { momentLabel } from "./time/moment"

	/**
	 * The drawings the lorebook can make, over the scope being read.
	 *
	 * Which drawing is on screen is the lens, so the rail's lens row is this
	 * place's navigation: the canvas takes the width the list and editor
	 * columns would have had, and the column beside it is whatever is selected
	 * on the canvas.
	 */
	type NarrativeNode = Sockets.NarrativeGraph.NarrativeNode
	type NarrativeRelationship = Sockets.NarrativeGraph.NarrativeRelationship
	type SceneRow = Sockets.Scenes.SceneWithMeta

	interface Props {
		lorebookId: number
		mode: "desk" | "compact"
		/** Which canvas the lens asks for. */
		drawing: LoreDrawing
		/**
		 * What the attached session's newest run did with the graph, or null
		 * when no run reported on it. The ceiling line's only source.
		 */
		relationships?:
			| Sockets.Entries.RecentDecisions.Response["relationships"]
			| null
		hasUnsavedChanges: boolean
		/** Opens Cast on a member. */
		onEditMember: (castId: number) => void
	}

	let {
		lorebookId,
		mode,
		drawing,
		relationships: runRelationships = null,
		hasUnsavedChanges = $bindable(false),
		onEditMember
	}: Props = $props()

	const socket = useTypedSocket()
	const graphBuildsCtx: GraphBuildsCtx = getContext("graphBuildsCtx")
	const userCtx: { user?: SelectUser } = getContext("userCtx")

	/** The build runs on this pipeline's per-step config. */
	const GRAPH_PIPELINE_SLUG = "core:spec/graph-build"

	/** The kinds that can be a node, a box on the map, or a date on an edge. */
	const ENTRY_KINDS = [
		WORLD_LORE_TYPE_ID,
		CHARACTER_LORE_TYPE_ID,
		HISTORY_TYPE_ID
	] as const

	const RELATIONSHIP_STATUSES = [
		"active",
		"resolved",
		"broken",
		"evolved"
	] as const
	const RELATIONSHIP_VISIBILITIES = [
		"acknowledged",
		"secret",
		"public"
	] as const
	const REL_STATUS_BADGE: Record<string, string> = {
		active: "preset-tonal-success",
		resolved: "preset-tonal-surface",
		broken: "preset-tonal-error",
		evolved: "preset-tonal-warning"
	}

	let nodes = $state<NarrativeNode[]>([])
	let relationships = $state<NarrativeRelationship[]>([])
	let entriesByKind = $state<Record<string, any[]>>({})
	let scenes = $state<SceneRow[]>([])
	let isLoading = $state(true)
	/**
	 * Why the graph is not on screen, when it is not.
	 *
	 * ⚠ Before this, `isLoading` began `true` and was cleared by the success
	 * handler alone: a load that could only succeed. A refused read, a dropped
	 * socket or a handler that threw all left the spinner turning for as long
	 * as the panel stayed open, with nothing said and nothing to press. The
	 * server has always emitted `narrativeGraph:list:error` — the register
	 * wrapper builds the name — and nothing listened for it.
	 */
	let loadError = $state<string | null>(null)
	/**
	 * The failure nobody reports: silence.
	 *
	 * An `:error` covers a handler that threw. It does not cover a socket that
	 * went away mid-flight, which produces no reply at all — and "no reply" is
	 * indistinguishable from "still loading" without a clock.
	 */
	const LOAD_TIMEOUT_MS = 20_000
	let loadTimer: ReturnType<typeof setTimeout> | null = null

	function clearLoadTimer() {
		if (loadTimer !== null) {
			clearTimeout(loadTimer)
			loadTimer = null
		}
	}

	let ungraphedSceneCount = $state(0)
	let ungraphedUnsummarizedCount = $state(0)
	let totalSummarizedCount = $state(0)
	let ungraphedHistoryEntryCount = $state(0)
	let unresolvedCastSceneCount = $state(0)
	let namelessBindingCount = $state(0)
	let totalDirectHistoryEntryCount = $state(0)

	/**
	 * Nothing shuts the build: summarizing is a capability every instance has.
	 * The seam stays on these two buttons, where a future gate would sit.
	 */
	let buildReason = $derived(graphBuildReason())

	let showBuildModal = $state(false)
	let buildMode = $state<"replace" | "extend">("replace")
	let showPipelinePanel = $state(false)
	let pipelineOverview = $state<Sockets.Pipelines.NamespaceDetail | null>(
		null
	)

	let selectedRel = $state<NarrativeRelationship | null>(null)
	let editingRel = $state<NarrativeRelationship | null>(null)
	let isSaving = $state(false)

	/**
	 * Edges this session made, by id.
	 *
	 * ⚠ `SvelteSet`, not `$state(new Set())` — a plain Set in `$state` does not
	 * make `.add()`/`.delete()` reactive, so a Keep would never clear the mark.
	 */
	const newEdgeIds = new SvelteSet<number>()
	/** The ids standing before an apply, so the reload can name what arrived. */
	let appliedBaseline: Set<number> | null = null

	let linkDraft = $state<LinkDraft | null>(null)
	let isConnecting = $state(false)

	let pendingDeleteNodeId = $state<number | null>(null)
	let pendingDeleteReferenced = $state(false)

	let mergeTarget = $state<NarrativeNode | null>(null)
	let showMergeModal = $state(false)

	/** Compact has no room for both, so the canvas is a screen of its own. */
	let canvasOpen = $state(false)

	let route = $derived(loreRoute.route)

	let historyEntries = $derived(
		(entriesByKind[HISTORY_TYPE_ID] ?? []) as DatedEntryLike[]
	)

	/**
	 * The entries the scope holds.
	 *
	 * A scope that narrows to one entry kind narrows the graph's denominator
	 * with it; a scope that is the whole pool, or that narrows to rows which are
	 * not entries at all, leaves every kind in.
	 */
	let scopeKinds = $derived.by(() => {
		const kind = SCOPE_KIND[route.scope]
		return kind && (ENTRY_KINDS as readonly string[]).includes(kind)
			? [kind]
			: [...ENTRY_KINDS]
	})

	let scopeEntries = $derived.by(() => {
		const out: { id: number; name: string }[] = []
		for (const kind of scopeKinds)
			for (const row of entriesByKind[kind] ?? [])
				out.push({ id: row.id, name: (row.name ?? "").trim() })
		return out
	})

	/** Alias rows fold into the parent they were absorbed into. */
	let parentNodes = $derived(nodes.filter((n) => !n.parentNodeId))

	let visibleRelationships = $derived(
		edgesAtMoment(relationships, route.moment, historyEntries)
	)
	let heldBack = $derived(relationships.length - visibleRelationships.length)

	let selectedKey = $derived<string | null>(
		route.castId != null
			? castKey(route.castId)
			: route.entryId != null
				? entryKey(route.entryId)
				: null
	)

	let graph = $derived(
		graphNodes({
			cast: parentNodes,
			relationships: visibleRelationships,
			scopeEntries,
			selectedKey
		})
	)
	let nodeKeys = $derived(new Set(graph.map((n) => n.key)))
	let edges = $derived(graphEdges(visibleRelationships, nodeKeys, newEdgeIds))
	let names = $derived(nodeNames(graph))
	let selectedNode = $derived(
		selectedKey ? (graph.find((n) => n.key === selectedKey) ?? null) : null
	)
	let panelRows = $derived(panelEdges(selectedKey, edges, names))

	let edgedPairs = $derived(edgedCastPairs(relationships))
	let scenesWithNothingNamed = $derived(scenesNamingNone(scenes, edgedPairs))

	/** Scenes the open member was in that the graph names nothing about. */
	let notDrawn = $derived.by(() => {
		if (selectedNode?.kind !== "cast") return []
		return unnamedPairsFor(selectedNode.id, scenes, edgedPairs).map(
			(pair) => ({
				otherId: pair.otherId,
				sceneIds: pair.sceneIds,
				sentence: notDrawnSentence(
					selectedNode!.name,
					names.get(castKey(pair.otherId)) ?? `#${pair.otherId}`,
					pair.sceneIds.length
				)
			})
		)
	})

	let headline = $derived(
		graphHeaderLine({
			scopeLabel: SCOPE_LABELS[route.scope],
			entriesWithLinks: entriesWithLinks(
				scopeEntries,
				visibleRelationships
			),
			entriesTotal: scopeEntries.length,
			linkCount: edges.length,
			scenesNamingNone: scenesWithNothingNamed
		})
	)

	let castNames = $derived(
		new Map(parentNodes.map((n) => [n.id, displayName(n)]))
	)

	let placeEntries = $derived.by(() => {
		const out: { id: number; name: string; parentId: number | null }[] = []
		for (const kind of scopeKinds)
			for (const row of entriesByKind[kind] ?? [])
				out.push({
					id: row.id,
					name: (row.name ?? "").trim() || `#${row.id}`,
					parentId: row.anchorEntryId ?? null
				})
		return out
	})

	let placesMap = $derived(
		buildPlacesMap({
			entries: placeEntries,
			relationships: visibleRelationships,
			castNames
		})
	)

	/**
	 * What the last turn sent of the graph it walked.
	 *
	 * ⚠ The RUN's figures, not this member's: the mechanism walks the whole
	 * graph under one ceiling, so the line says what the turn sent rather than
	 * what the selected node holds. A run that reported nothing gets no line.
	 */
	let ceilingFacts = $derived<CeilingFacts>(
		ceilingFactsFrom(runRelationships)
	)
	let ceiling = $derived(ceilingLine(ceilingFacts))

	let activeBuild = $derived(
		graphBuildsCtx?.activeBuild?.lorebookId === lorebookId
			? graphBuildsCtx.activeBuild
			: null
	)
	let extendReadyCount = $derived(
		ungraphedSceneCount + ungraphedHistoryEntryCount
	)
	let buildProgressPercent = $derived.by(() => {
		if (!activeBuild || activeBuild.status !== "building") return 0
		if (activeBuild.phase === "loading" || activeBuild.totalScenes === 0)
			return 5
		if (activeBuild.phase === "parsing") return 90
		return (
			Math.max(
				10,
				Math.round(
					(activeBuild.sceneIndex / activeBuild.totalScenes) * 80
				)
			) + 5
		)
	})

	/**
	 * Only the relationship form is edited here. Compares the fields it binds
	 * to and nothing else: `embedding` moves whenever the app re-vectorizes, so
	 * a whole-object diff would report dirty for something nobody typed.
	 */
	$effect(() => {
		const current = editingRel
		if (!current) {
			hasUnsavedChanges = false
			return
		}
		const original = relationships.find((r) => r.id === current.id)
		// Gone out from under an open form leaves nothing to discard back to.
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

	// The activity sidebar asks for the build modal by naming the book.
	$effect(() => {
		if (graphBuildsCtx?.reopenLorebookId !== lorebookId) return
		if (activeBuild) buildMode = activeBuild.mode
		showBuildModal = true
		graphBuildsCtx.reopenLorebookId = null
	})

	function displayName(node?: { name?: string; binding?: string }) {
		return node?.name?.trim() || node?.binding || ""
	}

	function dateLabel(entry: DatedEntryLike): string {
		return `Year ${entry.year}${entry.month ? `, Mo. ${entry.month}` : ""}${
			entry.day ? `, Day ${entry.day}` : ""
		}`
	}

	/** Opening a node is opening the thing it stands for. */
	function openNode(node: GraphNode) {
		if (node.kind === "cast") {
			onEditMember(node.id)
			return
		}
		void loreRoute.navigate({
			type: "openEntry",
			entryId: node.id
		})
	}

	function selectNode(node: GraphNode | null) {
		selectedRel = null
		editingRel = null
		linkDraft = null
		if (!node) {
			void loreRoute.navigate({ type: "openCastMember", castId: null })
			return
		}
		void loreRoute.navigate(
			node.kind === "cast"
				? { type: "openCastMember", castId: node.id }
				: { type: "openEntry", entryId: node.id }
		)
		if (mode === "compact") canvasOpen = false
	}

	function selectEdge(edge: GraphEdge) {
		const rel = relationships.find((r) => r.id === edge.id) ?? null
		if (!rel) return
		selectedRel = rel
		editingRel = null
		linkDraft = null
	}

	function openScene(sceneId: number) {
		const scene = scenes.find((s) => s.id === sceneId)
		if (!scene) return
		void loreRoute.navigate({
			type: "openEntry",
			scope: "history",
			entryId: scene.historyEntryId,
			sceneId: scene.id
		})
	}

	function load() {
		isLoading = true
		loadError = null
		clearLoadTimer()
		loadTimer = setTimeout(() => {
			loadTimer = null
			if (!isLoading) return
			isLoading = false
			loadError = "The graph did not come back."
		}, LOAD_TIMEOUT_MS)
		socket.emit("narrativeGraph:list", {
			lorebookId
		} satisfies Sockets.NarrativeGraph.List.Params)
	}

	function handleListError(msg: Sockets.ErrorResponse) {
		clearLoadTimer()
		isLoading = false
		loadError = msg?.error || "The graph could not be read."
	}

	function startLink(from: GraphNode, to: GraphNode) {
		selectedRel = null
		editingRel = null
		linkDraft = newLinkDraft(from, to)
	}

	function submitLink() {
		if (!linkDraft) return
		isConnecting = true
		socket.emit(
			"narrativeGraph:createRelationship",
			createLinkParams(lorebookId, linkDraft)
		)
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

	function requestDeleteNode(id: number) {
		pendingDeleteNodeId = id
		pendingDeleteReferenced = false
		socket.emit("narrativeGraph:checkNodeMergeReferences", {
			nodeId: id
		} satisfies Sockets.NarrativeGraph.CheckNodeMergeReferences.Params)
	}

	// Named so `off` can name them too: a bare off() removes every listener for
	// the event, including any other open lorebooks UI.
	function handleList(msg: Sockets.NarrativeGraph.List.Response) {
		// The scope the gate reads; checked here too, so a stale book's
		// reply arriving after a switch cannot paint this one.
		if (msg.lorebookId !== lorebookId) return
		nodes = msg.nodes
		relationships = msg.relationships
		if (appliedBaseline) {
			for (const rel of msg.relationships)
				if (!appliedBaseline.has(rel.id)) newEdgeIds.add(rel.id)
			appliedBaseline = null
		}
		ungraphedSceneCount = msg.ungraphedSceneCount ?? 0
		ungraphedUnsummarizedCount = msg.ungraphedUnsummarizedCount ?? 0
		totalSummarizedCount = msg.totalSummarizedCount ?? 0
		ungraphedHistoryEntryCount = msg.ungraphedHistoryEntryCount ?? 0
		totalDirectHistoryEntryCount = msg.totalDirectHistoryEntryCount ?? 0
		unresolvedCastSceneCount = msg.unresolvedCastSceneCount ?? 0
		namelessBindingCount = msg.namelessBindingCount ?? 0
		clearLoadTimer()
		loadError = null
		isLoading = false
	}

	function handleEntriesList(msg: Sockets.Entries.List.Response) {
		// One namespace, so another section's list arrives here too; the filter
		// is what makes that harmless.
		if (msg.lorebookId !== lorebookId) return
		entriesByKind = { ...entriesByKind, [msg.typeId]: msg.entryList }
	}

	function handleScenesList(msg: Sockets.Scenes.ListByLorebook.Response) {
		scenes = msg.sceneList ?? []
	}

	function handleUpdateNode(msg: Sockets.NarrativeGraph.UpdateNode.Response) {
		nodes = nodes.map((n) => (n.id === msg.node.id ? msg.node : n))
		isSaving = false
	}

	function handleDeleteNode() {
		// The selection is whoever was deleted, or nobody worth holding onto
		// through a reload: either way the canvas comes back with no node open.
		if (route.castId != null)
			void loreRoute.navigate({ type: "openCastMember", castId: null })
		load()
	}

	function handleCheckMergeReferences(
		msg: Sockets.NarrativeGraph.CheckNodeMergeReferences.Response
	) {
		pendingDeleteReferenced = msg.referencedByMergeLog
	}

	function handleUpdateRelationship(
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

	function handleDeleteRelationship() {
		selectedRel = null
		editingRel = null
		load()
	}

	function handleCreateRelationship(
		msg: Sockets.NarrativeGraph.CreateRelationship.Response
	) {
		relationships = [...relationships, msg.relationship]
		newEdgeIds.add(msg.relationship.id)
		linkDraft = null
		isConnecting = false
	}

	function handleMergeWrite() {
		showMergeModal = false
		mergeTarget = null
		void loreRoute.navigate({ type: "openCastMember", castId: null })
		load()
	}

	// The vectorization queue writes embeddingModel straight to the row, so
	// without this the badge only refreshes on the next explicit write.
	function handleVectorized(msg: Sockets.Vectorization.ItemUpdated.Response) {
		if (msg.lorebookId !== lorebookId) return
		if (msg.type === "narrativeNode")
			nodes = nodes.map((n) =>
				n.id === msg.id
					? ({ ...n, embeddingModel: msg.embeddingModel } as any)
					: n
			)
		else if (msg.type === "narrativeRelationship")
			relationships = relationships.map((r) =>
				r.id === msg.id
					? ({ ...r, embeddingModel: msg.embeddingModel } as any)
					: r
			)
	}

	/**
	 * Four reads name the book this canvas is drawing, so they are SCOPED to
	 * it: the graph itself, the entries behind the nodes, the scenes behind
	 * the edges, and the embedding badge each of them wears. Effects rather
	 * than `useInterest` because a key built from a prop is a key that can
	 * move, and `useInterest` keeps the one it was first given. Declared above
	 * `onMount` so all of them exist before the reads below go out (effects
	 * run in creation order, and `onMount` is one of them).
	 */
	$effect(() =>
		declareInterest<"narrativeGraph:list">(
			interestKey("narrativeGraph:list", lorebookId),
			handleList
		)
	)
	/**
	 * ⚠ A BARE key, not a scoped one. The failure carries no `lorebookId` to
	 * scope on, and the server sends it with a raw room emit precisely so the
	 * interest gate cannot swallow it — a client waiting on a reply declared
	 * interest in being told it failed.
	 */
	$effect(() =>
		declareInterest<"narrativeGraph:list:error">(
			"narrativeGraph:list:error",
			handleListError
		)
	)
	$effect(() =>
		declareInterest<"entries:list">(
			interestKey("entries:list", lorebookId),
			handleEntriesList
		)
	)
	$effect(() =>
		declareInterest<"scenes:listByLorebook">(
			interestKey("scenes:listByLorebook", lorebookId),
			handleScenesList
		)
	)
	$effect(() =>
		declareInterest<"vectorization:itemUpdated">(
			interestKey("vectorization:itemUpdated", lorebookId),
			handleVectorized
		)
	)

	/**
	 * The writes answer with the node or the edge alone and name no book, so
	 * every one of them is BARE — none has an entry in `SCOPED_EVENTS`, and a
	 * scoped key for an unscoped event matches nothing at all.
	 */
	useInterest<"narrativeGraph:updateNode">(
		"narrativeGraph:updateNode",
		handleUpdateNode
	)
	useInterest<"narrativeGraph:deleteNode">(
		"narrativeGraph:deleteNode",
		handleDeleteNode
	)
	useInterest<"narrativeGraph:checkNodeMergeReferences">(
		"narrativeGraph:checkNodeMergeReferences",
		handleCheckMergeReferences
	)
	useInterest<"narrativeGraph:updateRelationship">(
		"narrativeGraph:updateRelationship",
		handleUpdateRelationship
	)
	useInterest<"narrativeGraph:deleteRelationship">(
		"narrativeGraph:deleteRelationship",
		handleDeleteRelationship
	)
	useInterest<"narrativeGraph:createRelationship">(
		"narrativeGraph:createRelationship",
		handleCreateRelationship
	)
	useInterest<"narrativeGraph:mergeNode">(
		"narrativeGraph:mergeNode",
		handleMergeWrite
	)
	useInterest<"narrativeGraph:undoMerge">(
		"narrativeGraph:undoMerge",
		handleMergeWrite
	)

	onMount(() => {
		for (const typeId of ENTRY_KINDS)
			socket.emit("entries:list", { lorebookId, typeId })
		socket.emit("scenes:listByLorebook", { lorebookId })
		load()
	})

	onDestroy(() => {
		hasUnsavedChanges = false
		// A timer that outlives the panel would set state on a dead component.
		clearLoadTimer()
	})
</script>

{#snippet buildActions()}
	{#if activeBuild}
		{#if activeBuild.status === "building"}
			<div class="flex items-center gap-2">
				<div
					class="bg-primary-500 h-2 w-2 shrink-0 animate-pulse rounded-full"
				></div>
				<span class="text-surface-700-300 text-sm">Building…</span>
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
			type="button"
			disabled={!!buildReason}
			data-graph-build
			onclick={() => {
				buildMode = "replace"
				showBuildModal = true
			}}
			title={buildReason ??
				(nodes.length > 0
					? "Rebuild the graph from scratch"
					: "Build the graph from scenes")}
		>
			<Icons.Cpu size={14} aria-hidden="true" />
			{nodes.length > 0 ? "Rebuild" : "Build"}
		</button>
		<button
			class="btn btn-sm preset-filled-surface-400-600"
			type="button"
			disabled={!!buildReason ||
				nodes.length === 0 ||
				extendReadyCount === 0}
			data-graph-extend
			title={buildReason ??
				(extendReadyCount === 0
					? ungraphedUnsummarizedCount > 0
						? `${ungraphedUnsummarizedCount} scene${ungraphedUnsummarizedCount === 1 ? "" : "s"} need summaries before they can be graphed`
						: "The graph is up to date"
					: `Read the ${extendReadyCount} scene${extendReadyCount === 1 ? "" : "s"} and history entries this book has not graphed yet, and propose what they add`)}
			onclick={() => {
				buildMode = "extend"
				showBuildModal = true
			}}
		>
			<Icons.Layers size={14} aria-hidden="true" />
			Extend from this session
			{#if extendReadyCount > 0}
				<span class="badge-icon preset-filled-primary-500 text-[10px]">
					{extendReadyCount}
				</span>
			{/if}
		</button>
	{/if}
	<button
		class="btn btn-sm preset-filled-surface-400-600"
		type="button"
		onclick={load}
		title="Refresh"
		aria-label="Refresh the graph"
	>
		<Icons.RefreshCw size={14} aria-hidden="true" />
	</button>
	<button
		class="btn btn-sm {showPipelinePanel
			? 'preset-filled-surface-500'
			: 'preset-filled-surface-400-600'}"
		type="button"
		title="The pipeline behind the build: which model, sampling profile and prompt each step runs on"
		aria-label="Graph build pipeline settings"
		aria-pressed={showPipelinePanel}
		onclick={() => (showPipelinePanel = !showPipelinePanel)}
	>
		<Icons.Workflow size={14} aria-hidden="true" />
	</button>
{/snippet}

{#snippet relationshipForm(rel: NarrativeRelationship)}
	<div class="flex flex-col gap-2">
		<input
			class="input text-sm"
			type="text"
			aria-label="Relationship type"
			placeholder="Relationship type…"
			bind:value={rel.relationshipType}
		/>
		<div class="grid grid-cols-2 gap-2">
			<select
				class="select text-xs"
				aria-label="Status"
				bind:value={rel.status}
			>
				{#each RELATIONSHIP_STATUSES as s (s)}
					<option value={s}>{s}</option>
				{/each}
			</select>
			<select
				class="select text-xs"
				aria-label="Visibility"
				bind:value={rel.visibility}
			>
				{#each RELATIONSHIP_VISIBILITIES as v (v)}
					<option value={v}>{v}</option>
				{/each}
			</select>
		</div>
		<textarea
			class="textarea min-h-10 text-xs"
			aria-label="Description"
			placeholder="Description…"
			bind:value={rel.description}
		></textarea>
		<input
			class="input text-xs"
			type="text"
			aria-label="Reason for this state"
			placeholder="Reason for this state…"
			bind:value={rel.reason}
		/>
		{#if historyEntries.length > 0}
			<select
				class="select text-xs"
				aria-label="When"
				bind:value={rel.historyEntryId}
			>
				<option value={null}>No date</option>
				{#each historyEntries as he (he.id)}
					<option value={he.id}>{dateLabel(he)}</option>
				{/each}
			</select>
		{/if}
		<div class="flex justify-end gap-2">
			<button
				class="btn btn-sm preset-filled-surface-400-600"
				type="button"
				onclick={() => (editingRel = null)}
			>
				Cancel
			</button>
			<button
				class="btn btn-sm preset-filled-primary-500"
				type="button"
				disabled={isSaving}
				onclick={saveRel}
			>
				<Icons.Save size={13} aria-hidden="true" /> Update
			</button>
		</div>
	</div>
{/snippet}

{#snippet castActions(node: NarrativeNode)}
	<div class="flex flex-wrap items-center gap-1">
		<span class="badge {stateBadge(node.nodeState).color} text-xs">
			{node.nodeState}
		</span>
		{#if node.nodeVisibility !== "normal"}
			<span class="badge {visibilityBadge(node.nodeVisibility)} text-xs">
				{node.nodeVisibility}
			</span>
		{/if}
		<div class="ml-auto flex gap-1">
			<button
				class="btn btn-sm preset-tonal-warning p-1.5"
				type="button"
				onclick={() => {
					mergeTarget = node
					showMergeModal = true
				}}
				title="Absorb into another member, because they are the same person"
				aria-label="Absorb into another member"
			>
				<Icons.GitMerge size={13} aria-hidden="true" />
			</button>
			<button
				class="btn btn-sm preset-tonal-error p-1.5"
				type="button"
				onclick={() => requestDeleteNode(node.id)}
				title="Delete"
				aria-label="Delete"
			>
				<Icons.Trash2 size={13} aria-hidden="true" />
			</button>
		</div>
	</div>
	{#if node.summary}
		<p class="text-surface-700-300 text-xs">{node.summary}</p>
	{/if}
	{#if pendingDeleteNodeId === node.id}
		{@const relCount = relationships.filter(
			(r) =>
				(r.from.kind === "cast" && r.from.bindingId === node.id) ||
				(r.to.kind === "cast" && r.to.bindingId === node.id)
		).length}
		<div
			class="border-error-500/40 flex flex-col gap-2 rounded-lg border p-3"
		>
			<p class="text-error-500 font-semibold">
				Delete "{displayName(node)}"?
			</p>
			{#if relCount > 0}
				<p class="text-surface-700-300 text-xs">
					This also permanently deletes {relCount} relationship{relCount ===
					1
						? ""
						: "s"}.
				</p>
			{/if}
			{#if pendingDeleteReferenced}
				<p class="text-warning-500 text-xs">
					A past merge record names this member, so deleting it
					permanently disables that merge's undo.
				</p>
			{/if}
			<div class="flex justify-end gap-2">
				<button
					class="btn btn-sm preset-filled-surface-400-600"
					type="button"
					onclick={() => (pendingDeleteNodeId = null)}
				>
					Cancel
				</button>
				<button
					class="btn btn-sm preset-filled-error-500"
					type="button"
					onclick={() => {
						socket.emit("narrativeGraph:deleteNode", {
							id: node.id
						} satisfies Sockets.NarrativeGraph.DeleteNode.Params)
						pendingDeleteNodeId = null
					}}
				>
					<Icons.Trash2 size={13} aria-hidden="true" /> Delete
				</button>
			</div>
		</div>
	{/if}
{/snippet}

{#snippet nodeList()}
	<div
		class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto"
		data-graph-nodes
	>
		{#if graph.length === 0}
			<EmptyState
				icon={Icons.Network}
				message="No graph yet. Build one from your scenes and history to pull out who is connected to whom."
			/>
		{:else}
			{#each graph as node (node.key)}
				<button
					type="button"
					data-graph-node
					data-node-key={node.key}
					aria-current={selectedKey === node.key ? "true" : undefined}
					class="preset-filled-surface-100-900 hover:bg-surface-200-800 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors"
					class:preset-tonal-primary={selectedKey === node.key}
					onclick={() => selectNode(node)}
				>
					<span class="min-w-0 flex-1 truncate text-sm font-medium">
						{node.name}
					</span>
					{#if node.kind === "cast"}
						{@const row = nodes.find((n) => n.id === node.id)}
						{#if row}
							<EmbeddingStatusIcon
								embeddingModel={row.embeddingModel}
							/>
						{/if}
						<span
							class="badge {stateBadge(node.state)
								.color} shrink-0 text-xs"
						>
							{node.state}
						</span>
					{:else}
						<span
							class="badge preset-tonal-surface shrink-0 text-[10px] uppercase"
						>
							entry
						</span>
					{/if}
				</button>
			{/each}
		{/if}
	</div>
{/snippet}

{#snippet canvas()}
	{#if drawing === "places"}
		<PlacesBoard
			map={placesMap}
			selectedEntryId={route.entryId ?? null}
			onOpenEntry={(entryId) =>
				loreRoute.navigate({ type: "openEntry", entryId })}
			onOpenCast={onEditMember}
		/>
	{:else}
		<RelationshipsCanvas
			nodes={graph}
			{edges}
			{headline}
			{heldBack}
			momentLabel={route.moment ? momentLabel(route.moment) : null}
			{selectedKey}
			onNodeClick={selectNode}
			onEdgeClick={selectEdge}
			onLinkDraw={startLink}
		/>
	{/if}
{/snippet}

{#snippet sideColumn()}
	<div class="flex min-h-0 flex-1 flex-col gap-2">
		{#if linkDraft}
			<LinkForm
				draft={linkDraft}
				nodes={graph}
				saving={isConnecting}
				onChange={(next) => (linkDraft = next)}
				onSubmit={submitLink}
				onCancel={() => (linkDraft = null)}
			/>
		{:else if selectedNode}
			<NodePanel
				node={selectedNode}
				edges={panelRows}
				{notDrawn}
				{ceiling}
				isNew={(edge) => newEdgeIds.has(edge.id)}
				canAdd={graph.length > 1}
				onOpen={() => openNode(selectedNode!)}
				onAdd={() => {
					const other = graph.find((n) => n.key !== selectedNode!.key)
					if (other) linkDraft = newLinkDraft(selectedNode!, other)
				}}
				onKeep={(edge) => newEdgeIds.delete(edge.id)}
				onEdgeClick={selectEdge}
				onDeleteEdge={(edge) => deleteRel(edge.id)}
				onOpenScene={openScene}
				onRaiseCeiling={() => (showPipelinePanel = true)}
				onClose={() => selectNode(null)}
			/>
			{#if selectedNode.kind === "cast"}
				{@const row = nodes.find((n) => n.id === selectedNode!.id)}
				{#if row}
					<div
						class="border-border flex flex-col gap-2 border-t pt-2"
					>
						{@render castActions(row)}
					</div>
				{/if}
			{/if}
		{:else if selectedRel}
			<div class="flex flex-col gap-2 text-sm">
				<div class="flex items-center gap-1">
					<span class="min-w-0 flex-1 truncate font-semibold">
						{names.get(
							selectedRel.from.kind === "cast"
								? castKey(selectedRel.from.bindingId)
								: entryKey(selectedRel.from.entryId)
						) ?? "?"} → {names.get(
							selectedRel.to.kind === "cast"
								? castKey(selectedRel.to.bindingId)
								: entryKey(selectedRel.to.entryId)
						) ?? "?"}
					</span>
					<button
						class="btn btn-sm preset-filled-surface-400-600 p-1.5"
						type="button"
						title="Edit relationship"
						aria-label="Edit relationship"
						onclick={() =>
							(editingRel = $state.snapshot(selectedRel!))}
					>
						<Icons.Pencil size={13} aria-hidden="true" />
					</button>
					<button
						class="btn btn-sm preset-filled-surface-400-600 p-1.5"
						type="button"
						title="Close"
						aria-label="Close"
						onclick={() => {
							selectedRel = null
							editingRel = null
						}}
					>
						<Icons.X size={13} aria-hidden="true" />
					</button>
				</div>
				{#if editingRel}
					{@render relationshipForm(editingRel)}
				{:else}
					<span
						class="badge {REL_STATUS_BADGE[selectedRel.status] ??
							'preset-tonal-surface'} self-start text-xs"
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
				{/if}
			</div>
		{:else}
			{@render nodeList()}
		{/if}
	</div>
{/snippet}

<div class="flex min-h-0 flex-1 flex-col gap-3" data-lore-drawing={drawing}>
	{#if drawing === "relationships"}
		<PanelToolbar label="Graph actions">
			{@render buildActions()}
		</PanelToolbar>
	{/if}

	{#if showPipelinePanel}
		<div
			class="bg-surface-200-800 border-border max-h-96 space-y-2 overflow-y-auto rounded-lg border p-3 text-sm"
		>
			<div class="flex items-center justify-between gap-2">
				<p class="font-medium">
					<Icons.Workflow size={14} class="mr-1 inline" />
					{pipelineOverview
						? `${pipelineOverview.name} · v${pipelineOverview.version}`
						: "Graph build pipeline"}
				</p>
				{#if userCtx?.user?.isAdmin}
					<a
						class="btn btn-sm preset-tonal-surface shrink-0 text-xs"
						href="/admin/pipelines/{encodeURIComponent(
							GRAPH_PIPELINE_SLUG
						)}"
						title="Versions, publish state and run history"
					>
						<Icons.Settings2 size={12} /> Manage
					</a>
				{/if}
			</div>
			<PipelineConfigOptions
				slug={GRAPH_PIPELINE_SLUG}
				onLoaded={(d) => (pipelineOverview = d)}
			/>
		</div>
	{/if}

	{#if activeBuild && drawing === "relationships"}
		<div
			class="bg-surface-200-800 border-border flex flex-col gap-2 rounded-lg border p-3 text-sm"
		>
			{#if activeBuild.status === "building"}
				<p class="text-surface-700-300 text-xs capitalize">
					{activeBuild.phase.replace(/_/g, " ")}
					{#if activeBuild.totalScenes > 0}
						· scene {activeBuild.sceneIndex +
							1}/{activeBuild.totalScenes}
					{/if}
				</p>
				<div
					class="bg-surface-300-700 h-1.5 w-full overflow-hidden rounded-full"
				>
					<div
						class="bg-primary-500 h-full rounded-full transition-all duration-500"
						style="width: {buildProgressPercent}%"
					></div>
				</div>
				<div class="flex items-center gap-2">
					{#if activeBuild.activityId}
						<button
							class="btn btn-sm preset-tonal-error"
							type="button"
							onclick={() =>
								socket.emit("activity:cancel", {
									id: activeBuild!.activityId!
								})}
						>
							<Icons.Square size={14} aria-hidden="true" /> Stop
						</button>
					{/if}
					<button
						class="btn btn-sm preset-filled-surface-400-600"
						type="button"
						onclick={() => {
							buildMode = activeBuild!.mode
							showBuildModal = true
						}}
					>
						<Icons.Eye size={14} aria-hidden="true" /> View progress
					</button>
				</div>
			{:else if activeBuild.status === "review"}
				<div class="flex flex-wrap items-center gap-2">
					<Icons.CheckCircle
						size={14}
						class="text-success-500 shrink-0"
					/>
					<span class="text-success-500 font-medium">
						100% complete
					</span>
					<button
						class="btn btn-sm preset-filled-primary-500 ml-auto"
						type="button"
						onclick={() => {
							buildMode = activeBuild!.mode
							showBuildModal = true
						}}
					>
						<Icons.Check size={14} aria-hidden="true" /> Review & apply
					</button>
				</div>
			{:else if activeBuild.status === "error"}
				<div class="flex flex-wrap items-center gap-2">
					<Icons.AlertCircle
						size={14}
						class="text-error-500 shrink-0"
					/>
					<span class="text-error-500">Build failed</span>
					{#if activeBuild.errorMessage}
						<span class="text-surface-700-300 truncate text-xs">
							{activeBuild.errorMessage}
						</span>
					{/if}
					<button
						class="btn btn-sm preset-tonal-error ml-auto"
						type="button"
						onclick={() => {
							buildMode = activeBuild!.mode
							showBuildModal = true
						}}
					>
						<Icons.AlertCircle size={14} aria-hidden="true" /> View error
					</button>
				</div>
			{/if}
		</div>
	{/if}

	{#if namelessBindingCount > 0 && drawing === "relationships"}
		<!-- A row with an empty name matches no extracted name, so a build
		     proposes a fresh one beside it every time. Surfaced so it can be
		     named or removed by hand. -->
		<div
			class="bg-surface-200-800 border-border flex items-center gap-2 rounded-lg border p-3 text-sm"
		>
			<Icons.HelpCircle size={14} class="text-surface-600-400 shrink-0" />
			<span class="text-surface-700-300">
				{namelessBindingCount} cast {namelessBindingCount === 1
					? "member has"
					: "members have"} no name, so a build cannot match them to anyone
				it finds. Name or delete them in Cast.
			</span>
		</div>
	{/if}

	{#if loadError}
		<!-- Say what happened and offer the one thing that can help. A spinner
		     that never stops says neither. -->
		<div
			class="flex flex-col items-center justify-center gap-3 py-10 text-center"
			data-lore-graph-error
		>
			<Icons.Unplug
				size={24}
				class="text-surface-500"
				aria-hidden="true"
			/>
			<p class="text-surface-700-300 max-w-sm text-sm leading-relaxed">
				{loadError} Nothing has been changed — the graph is still there,
				this view could not read it.
			</p>
			<button
				class="btn btn-sm preset-filled-primary-500"
				type="button"
				onclick={load}
			>
				<Icons.RefreshCw size={14} aria-hidden="true" />
				Try again
			</button>
		</div>
	{:else if isLoading}
		<div class="flex items-center justify-center py-10">
			<Icons.Loader2 size={20} class="text-surface-400 animate-spin" />
		</div>
	{:else if mode === "desk"}
		<div class="flex min-h-0 flex-1 gap-4">
			<div class="flex min-h-0 min-w-0 flex-1 flex-col">
				{@render canvas()}
			</div>
			<div
				class="border-border flex min-h-0 w-[360px] shrink-0 flex-col border-l pl-4"
				data-graph-side
			>
				{@render sideColumn()}
			</div>
		</div>
	{:else if canvasOpen}
		<div class="flex min-h-0 flex-1 flex-col gap-2">
			<button
				class="btn btn-sm preset-filled-surface-400-600 self-start"
				type="button"
				onclick={() => (canvasOpen = false)}
			>
				<Icons.ChevronLeft size={16} aria-hidden="true" /> Back to the list
			</button>
			{@render canvas()}
		</div>
	{:else}
		<button
			class="btn btn-sm preset-tonal-surface self-start"
			type="button"
			onclick={() => (canvasOpen = true)}
		>
			<Icons.Maximize2 size={14} aria-hidden="true" />
			{drawing === "relationships" ? "Show the graph" : "Show the map"}
		</button>
		{@render sideColumn()}
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
		(n) => n.characterId == null && !n.parentNodeId
	).length}
	existingRelationshipCount={relationships.length}
	{unresolvedCastSceneCount}
	onApplied={() => {
		appliedBaseline = new Set(relationships.map((r) => r.id))
		load()
	}}
/>

{#if mergeTarget}
	<AbsorbBindingModal
		open={showMergeModal}
		onOpenChange={(e) => {
			showMergeModal = e.open
			if (!e.open) mergeTarget = null
		}}
		node={mergeTarget}
		{nodes}
		{lorebookId}
	/>
{/if}
