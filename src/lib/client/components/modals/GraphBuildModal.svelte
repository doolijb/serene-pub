<script lang="ts">
	import { Modal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { onDestroy, onMount } from "svelte"
	import { toaster } from "$lib/client/utils/toaster"

	interface Props {
		open: boolean
		onOpenChange: (e: { open: boolean }) => void
		lorebookId: number
		mode?: "replace" | "extend"
		/** Scenes that will be processed in this build */
		readySceneCount?: number
		/** Scenes that will be skipped (no summary yet) */
		skippedSceneCount?: number
		/** Direct history entries (no scenes) that will be processed */
		ungraphedHistoryEntryCount?: number
		onApplied?: () => void
	}

	let {
		open,
		onOpenChange,
		lorebookId,
		mode = "replace",
		readySceneCount,
		skippedSceneCount,
		ungraphedHistoryEntryCount,
		onApplied
	}: Props = $props()

	let totalReadyCount = $derived((readySceneCount ?? 0) + (ungraphedHistoryEntryCount ?? 0))

	const socket = useTypedSocket()

	type Step = "preflight" | "building" | "review" | "applying" | "error"
	let step = $state<Step>("preflight")

	// Build progress
	let progressPhase = $state<Sockets.NarrativeGraph.Build.Progress["phase"]>("loading")
	let progressSceneIndex = $state(0)
	let progressTotalScenes = $state(0)
	let progressNodesFound = $state(0)
	let progressRelsFound = $state(0)
	let progressPartial = $state<string | undefined>(undefined)

	// Error state
	let errorMessage = $state("")
	let errorRaw = $state<string | undefined>(undefined)
	let showRaw = $state(false)

	// Proposal review
	type EditableNode = Sockets.NarrativeGraph.NodeProposal & { _deleted?: boolean }
	type EditableRel = Sockets.NarrativeGraph.RelationshipProposal & { _deleted?: boolean }

	let proposalNodes = $state<EditableNode[]>([])
	let proposalRels = $state<EditableRel[]>([])
	let sceneLabels = $state<string[]>([])
	let seedTempIdMap = $state<Record<string, number>>({})
	let isApplying = $state(false)

	// Expand state for review cards
	let expandedNodeIdx = $state<number | null>(null)
	let expandedRelIdx = $state<number | null>(null)

	let activeNodes = $derived(proposalNodes.filter((n) => !n._deleted))
	let activeRels = $derived(proposalRels.filter((r) => !r._deleted))

	let progressPercent = $derived.by(() => {
		if (progressTotalScenes === 0) return 5
		if (progressPhase === "loading") return 5
		if (progressPhase === "extracting") return Math.max(10, Math.round((progressSceneIndex / progressTotalScenes) * 80))
		if (progressPhase === "parsing") return 90
		return 100
	})

	$effect(() => {
		if (open) {
			step = "preflight"
			progressPhase = "loading"
			progressSceneIndex = 0
			progressTotalScenes = 0
			progressPartial = undefined
			errorMessage = ""
			errorRaw = undefined
			showRaw = false
			proposalNodes = []
			proposalRels = []
			sceneLabels = []
			seedTempIdMap = {}
			isApplying = false
			expandedNodeIdx = null
			expandedRelIdx = null
		}
	})

	function triggerBuild() {
		socket.emit("narrativeGraph:build", {
			lorebookId,
			mode
		} satisfies Sockets.NarrativeGraph.Build.Params)
	}

	function handleProgress(data: Sockets.NarrativeGraph.Build.Progress) {
		progressPhase = data.phase
		progressSceneIndex = data.sceneIndex
		progressTotalScenes = data.totalScenes
		progressNodesFound = data.nodesFound
		progressRelsFound = data.relationshipsFound
		progressPartial = data.partial
	}

	function handleComplete(data: Sockets.NarrativeGraph.Build.Response) {
		proposalNodes = data.proposal.nodes.map((n) => ({ ...n }))
		proposalRels = data.proposal.relationships.map((r) => ({ ...r }))
		sceneLabels = data.sceneLabels
		seedTempIdMap = data.seedTempIdMap ?? {}
		step = "review"
	}

	function handleError(data: Sockets.NarrativeGraph.Build.ErrorResponse) {
		errorMessage = data.error
		errorRaw = data.raw
		step = "error"
	}

	onMount(() => {
		socket.on("narrativeGraph:build:progress", handleProgress)
		socket.on("narrativeGraph:build:complete", handleComplete)
		socket.on("narrativeGraph:build:error", handleError)
	})

	onDestroy(() => {
		socket.off("narrativeGraph:build:progress")
		socket.off("narrativeGraph:build:complete")
		socket.off("narrativeGraph:build:error")
	})

	function nodeLabel(tempId: string): string {
		const node = proposalNodes.find((n) => n.tempId === tempId)
		return node?.name ?? tempId
	}

	function sceneLabel(index: number | undefined): string {
		if (index == null) return ""
		return sceneLabels[index] ?? `Scene ${index + 1}`
	}

	function apply() {
		step = "applying"
		isApplying = true

		const filteredProposal: Sockets.NarrativeGraph.GraphProposal = {
			nodes: activeNodes.map(({ _deleted, ...n }) => n),
			relationships: activeRels.map(({ _deleted, ...r }) => r)
		}

		socket.emit(
			"narrativeGraph:applyProposal",
			{
				lorebookId,
				proposal: filteredProposal,
				mode,
				seedTempIdMap: mode === "extend" ? seedTempIdMap : undefined
			} satisfies Sockets.NarrativeGraph.ApplyProposal.Params
		)

		// Listen for confirmation
		const handleApplied = () => {
			socket.off("narrativeGraph:applyProposal", handleApplied)
			toaster.success({
				title: "Graph applied",
				description: `${activeNodes.length} nodes and ${activeRels.length} relationships saved.`
			})
			onApplied?.()
			onOpenChange({ open: false })
		}
		socket.on("narrativeGraph:applyProposal", handleApplied)
	}

	const NODE_TYPES = ["character", "location", "faction", "item", "concept", "event"] as const
	const NODE_STATES = ["active", "resolved", "defunct", "retconned"] as const
	const RELATIONSHIP_TYPES = ["ally", "enemy", "rival", "mentor", "student", "family", "romantic", "neutral", "complicated", "life_debt", "betrayal", "contract", "unknown"] as const
	const RELATIONSHIP_STATUSES = ["active", "resolved", "broken", "evolved"] as const

	const REL_STATUS_COLOR: Record<string, string> = {
		active: "text-success-500",
		resolved: "text-surface-400",
		broken: "text-error-500",
		evolved: "text-warning-500"
	}
</script>

<Modal
	{open}
	{onOpenChange}
	contentBase="card bg-surface-100-900 p-6 shadow-xl w-[min(95vw,720px)] max-h-[90vh] overflow-y-auto"
	backdropClasses="backdrop-blur-sm"
>
	{#snippet content()}
		<!-- ── PREFLIGHT ────────────────────────────────────────────────── -->
		{#if step === "preflight"}
			<header class="mb-4">
				<h2 class="h3">{mode === "extend" ? "Extend Narrative Graph" : "Build Narrative Graph"}</h2>
				<p class="text-surface-500 mt-1 text-sm">
					{mode === "extend"
						? "The LLM will process new scenes and add to your existing graph."
						: "The LLM will process all summarised scenes and build a fresh graph."}
				</p>
			</header>

			<div class="space-y-2">
				{#if totalReadyCount > 0}
					<div class="flex items-center gap-3 rounded-lg border border-success-500/30 bg-success-500/10 p-3 text-sm">
						<Icons.CheckCircle size={16} class="text-success-500 shrink-0" />
						<span>
							{#if (readySceneCount ?? 0) > 0}
								<strong>{readySceneCount}</strong> scene{(readySceneCount ?? 0) === 1 ? "" : "s"}
							{/if}
							{#if (readySceneCount ?? 0) > 0 && (ungraphedHistoryEntryCount ?? 0) > 0}
								{" + "}
							{/if}
							{#if (ungraphedHistoryEntryCount ?? 0) > 0}
								<strong>{ungraphedHistoryEntryCount}</strong> history {(ungraphedHistoryEntryCount ?? 0) === 1 ? "entry" : "entries"}
							{/if}
							{" "}ready to process
						</span>
					</div>
				{:else}
					<div class="flex items-center gap-3 rounded-lg border border-warning-500/30 bg-warning-500/10 p-3 text-sm">
						<Icons.AlertTriangle size={16} class="text-warning-500 shrink-0" />
						<span>No content is ready to process. Generate scene summaries or add history entry content first.</span>
					</div>
				{/if}
				{#if (skippedSceneCount ?? 0) > 0}
					<div class="flex items-center gap-3 rounded-lg border border-surface-300-700 bg-surface-200-800 p-3 text-sm">
						<Icons.SkipForward size={16} class="text-surface-400 shrink-0" />
						<span class="text-surface-500"><strong>{skippedSceneCount}</strong> scene{(skippedSceneCount ?? 0) === 1 ? "" : "s"} will be skipped — no summary yet</span>
					</div>
				{/if}
			</div>

			<footer class="mt-6 flex gap-3">
				<button class="btn preset-tonal-surface" onclick={() => onOpenChange({ open: false })}>
					Cancel
				</button>
				<button
					class="btn preset-filled-primary-500 ml-auto"
					disabled={totalReadyCount === 0}
					onclick={() => { step = "building"; triggerBuild() }}
				>
					<Icons.Play size={16} /> Proceed
				</button>
			</footer>

		<!-- ── BUILDING ─────────────────────────────────────────────────── -->
		{:else if step === "building"}
			<header class="mb-4">
				<h2 class="h3">{mode === "extend" ? "Extending Narrative Graph…" : "Building Narrative Graph…"}</h2>
				<p class="text-surface-500 mt-1 text-sm">
					{mode === "extend"
						? "Analyzing scenes for new entities and relationships to add to the existing graph."
						: "Analyzing scenes to extract nodes and relationships."}
				</p>
			</header>

			<div class="space-y-4">
				<div class="space-y-2">
					<div class="flex items-center justify-between text-sm">
						<span class="text-surface-500 capitalize">{progressPhase}…</span>
						<span class="font-mono">{progressPercent}%</span>
					</div>
					<div class="bg-surface-300-700 h-2 w-full overflow-hidden rounded-full">
						<div
							class="bg-primary-500 h-full rounded-full transition-all duration-500"
							style="width: {progressPercent}%"
						></div>
					</div>
					{#if progressTotalScenes > 0}
						<div class="text-surface-500 flex justify-between text-xs">
							<span>Scene {progressSceneIndex + 1} / {progressTotalScenes}</span>
							<span>{progressNodesFound} nodes · {progressRelsFound} relationships</span>
						</div>
					{/if}
				</div>

				{#if progressPartial}
					<div class="space-y-1">
						<p class="text-surface-500 text-xs font-semibold uppercase tracking-wide">Preview</p>
						<div class="bg-surface-200-800 rounded-lg p-3 text-sm">
							<p class="text-surface-700-300 line-clamp-4 whitespace-pre-wrap font-mono text-xs">
								{progressPartial}
							</p>
						</div>
					</div>
				{:else}
					<div class="text-surface-500 py-6 text-center text-sm">
						<div class="bg-primary-500 mx-auto mb-2 h-2 w-2 animate-pulse rounded-full"></div>
						Waiting for LLM…
					</div>
				{/if}
			</div>

			<footer class="mt-6 flex justify-end">
				<button class="btn preset-filled-error-500" onclick={() => onOpenChange({ open: false })}>
					<Icons.X size={16} /> Cancel
				</button>
			</footer>

		<!-- ── ERROR ─────────────────────────────────────────────────────── -->
		{:else if step === "error"}
			<header class="mb-4">
				<h2 class="h3 text-error-500">Graph Build Failed</h2>
				<p class="text-surface-500 mt-1 text-sm">The LLM response could not be parsed.</p>
			</header>

			<div class="space-y-3">
				<div
					class="flex items-start gap-3 rounded-lg border border-error-500/30 bg-error-500/10 p-3 text-sm"
				>
					<Icons.AlertCircle size={16} class="text-error-500 mt-0.5 shrink-0" />
					<span>{errorMessage}</span>
				</div>

				{#if errorRaw}
					<button
						class="text-surface-500 hover:text-surface-700-300 flex items-center gap-1 text-xs"
						onclick={() => (showRaw = !showRaw)}
					>
						<Icons.ChevronDown
							size={14}
							class="transition-transform {showRaw ? 'rotate-180' : ''}"
						/>
						{showRaw ? "Hide" : "Show"} raw LLM output
					</button>
					{#if showRaw}
						<pre class="bg-surface-200-800 max-h-40 overflow-y-auto rounded p-3 text-xs whitespace-pre-wrap"
							>{errorRaw}</pre
						>
					{/if}
				{/if}
			</div>

			<footer class="mt-6 flex flex-wrap gap-3">
				<button
					class="btn preset-tonal-surface"
					onclick={() => onOpenChange({ open: false })}
				>
					Cancel
				</button>
				<button
					class="btn preset-filled-primary-500 ml-auto"
					onclick={() => {
						step = "building"
						progressPhase = "loading"
						progressSceneIndex = 0
						progressTotalScenes = 0
						progressPartial = undefined
						errorMessage = ""
						errorRaw = undefined
						triggerBuild()
					}}
				>
					<Icons.RefreshCw size={16} /> Retry
				</button>
			</footer>

		<!-- ── REVIEW ─────────────────────────────────────────────────────── -->
		{:else if step === "review"}
			<header class="mb-4 flex items-start justify-between gap-2">
				<div>
					<h2 class="h3">Review Graph Proposal</h2>
					<p class="text-surface-500 mt-1 text-sm">
						{activeNodes.length} nodes · {activeRels.length} relationships — remove or edit before applying.
					</p>
				</div>
				<span class="badge preset-tonal-primary text-xs">{mode === "replace" ? "Replace All" : "Extend"}</span>
			</header>

			<!-- Nodes -->
			<section class="mb-4 space-y-2">
				<h3 class="text-surface-500 text-xs font-semibold uppercase tracking-wide">Nodes</h3>
				{#each proposalNodes as node, i}
					<div
						class="bg-surface-200-800 rounded-lg border transition-opacity {node._deleted
							? 'opacity-40'
							: 'border-surface-300-700'}"
					>
						<div
							class="flex cursor-pointer items-center gap-2 px-3 py-2"
							role="button"
							tabindex="0"
							onclick={() => (expandedNodeIdx = expandedNodeIdx === i ? null : i)}
							onkeydown={(e) => e.key === "Enter" && (expandedNodeIdx = expandedNodeIdx === i ? null : i)}
						>
							<Icons.User size={14} class="text-primary-500 shrink-0" />
							<span class="flex-1 truncate text-sm font-medium">{node.name}</span>
							<span class="text-surface-500 text-xs">{node.nodeType}</span>
							{#if node.sceneIndex != null}
								<span class="text-surface-400 text-xs">{sceneLabel(node.sceneIndex)}</span>
							{/if}
							<button
								class="text-surface-400 hover:text-error-500 ml-1 shrink-0"
								onclick={(e) => {
									e.stopPropagation()
									proposalNodes[i]._deleted = !proposalNodes[i]._deleted
								}}
								title={node._deleted ? "Restore" : "Remove"}
							>
								{#if node._deleted}
									<Icons.RotateCcw size={14} />
								{:else}
									<Icons.Trash2 size={14} />
								{/if}
							</button>
							<Icons.ChevronDown
								size={14}
								class="text-surface-400 transition-transform {expandedNodeIdx === i ? 'rotate-180' : ''}"
							/>
						</div>
						{#if expandedNodeIdx === i && !node._deleted}
							<div class="border-surface-300-700 border-t px-3 py-2 space-y-2">
								<div class="space-y-1">
									<p class="text-surface-500 text-xs font-semibold uppercase">Name</p>
									<input
										class="input text-sm"
										type="text"
										bind:value={proposalNodes[i].name}
									/>
								</div>
								<div class="grid grid-cols-2 gap-2">
									<div class="space-y-1">
										<p class="text-surface-500 text-xs font-semibold uppercase">Type</p>
										<select class="select text-sm" bind:value={proposalNodes[i].nodeType}>
											{#each NODE_TYPES as t}
												<option value={t}>{t}</option>
											{/each}
										</select>
									</div>
									<div class="space-y-1">
										<p class="text-surface-500 text-xs font-semibold uppercase">State</p>
										<select class="select text-sm" bind:value={proposalNodes[i].nodeState}>
											{#each NODE_STATES as s}
												<option value={s}>{s}</option>
											{/each}
										</select>
									</div>
								</div>
								<div class="space-y-1">
									<p class="text-surface-500 text-xs font-semibold uppercase">Summary</p>
									<textarea
										class="textarea min-h-12 text-sm"
										bind:value={proposalNodes[i].summary}
									></textarea>
								</div>
							</div>
						{/if}
					</div>
				{/each}
			</section>

			<!-- Relationships -->
			<section class="mb-4 space-y-2">
				<h3 class="text-surface-500 text-xs font-semibold uppercase tracking-wide">Relationships</h3>
				{#if proposalRels.length === 0}
					<p class="text-surface-500 text-sm italic">No relationships extracted.</p>
				{/if}
				{#each proposalRels as rel, i}
					<div
						class="bg-surface-200-800 rounded-lg border transition-opacity {rel._deleted
							? 'opacity-40'
							: 'border-surface-300-700'}"
					>
						<div
							class="flex cursor-pointer items-center gap-2 px-3 py-2"
							role="button"
							tabindex="0"
							onclick={() => (expandedRelIdx = expandedRelIdx === i ? null : i)}
							onkeydown={(e) => e.key === "Enter" && (expandedRelIdx = expandedRelIdx === i ? null : i)}
						>
							<span class="truncate text-sm">
								<span class="font-medium">{nodeLabel(rel.fromTempId)}</span>
								<span class="text-surface-400 mx-1">→</span>
								<span class="text-primary-500 text-xs">{rel.relationshipType}</span>
								<span class="text-surface-400 mx-1">→</span>
								<span class="font-medium">{nodeLabel(rel.toTempId)}</span>
							</span>
							<span class="ml-auto shrink-0 text-xs {REL_STATUS_COLOR[rel.status] ?? ''}">{rel.status}</span>
							{#if rel.sceneIndex != null}
								<span class="text-surface-400 text-xs">{sceneLabel(rel.sceneIndex)}</span>
							{/if}
							<button
								class="text-surface-400 hover:text-error-500 ml-1 shrink-0"
								onclick={(e) => {
									e.stopPropagation()
									proposalRels[i]._deleted = !proposalRels[i]._deleted
								}}
								title={rel._deleted ? "Restore" : "Remove"}
							>
								{#if rel._deleted}
									<Icons.RotateCcw size={14} />
								{:else}
									<Icons.Trash2 size={14} />
								{/if}
							</button>
							<Icons.ChevronDown
								size={14}
								class="text-surface-400 transition-transform {expandedRelIdx === i ? 'rotate-180' : ''}"
							/>
						</div>
						{#if expandedRelIdx === i && !rel._deleted}
							<div class="border-surface-300-700 border-t px-3 py-2 space-y-2">
								<div class="grid grid-cols-2 gap-2">
									<div class="space-y-1">
										<p class="text-surface-500 text-xs font-semibold uppercase">Type</p>
										<select class="select text-sm" bind:value={proposalRels[i].relationshipType}>
											{#each RELATIONSHIP_TYPES as t}
												<option value={t}>{t.replace("_", " ")}</option>
											{/each}
										</select>
									</div>
									<div class="space-y-1">
										<p class="text-surface-500 text-xs font-semibold uppercase">Status</p>
										<select class="select text-sm" bind:value={proposalRels[i].status}>
											{#each RELATIONSHIP_STATUSES as s}
												<option value={s}>{s}</option>
											{/each}
										</select>
									</div>
								</div>
								<div class="space-y-1">
									<p class="text-surface-500 text-xs font-semibold uppercase">Description</p>
									<textarea
										class="textarea min-h-12 text-sm"
										bind:value={proposalRels[i].description}
									></textarea>
								</div>
								<div class="space-y-1">
									<p class="text-surface-500 text-xs font-semibold uppercase">Reason for change</p>
									<input
										class="input text-sm"
										type="text"
										placeholder="Optional"
										bind:value={proposalRels[i].reason}
									/>
								</div>
							</div>
						{/if}
					</div>
				{/each}
			</section>

			<footer class="mt-2 flex flex-wrap gap-3">
				<button class="btn preset-tonal-surface" onclick={() => onOpenChange({ open: false })}>
					Cancel
				</button>
				<button
					class="btn preset-tonal-warning"
					onclick={() => { step = "preflight" }}
				>
					<Icons.RefreshCw size={16} /> Rebuild
				</button>
				<button
					class="btn preset-filled-primary-500 ml-auto"
					disabled={activeNodes.length === 0 || isApplying}
					onclick={apply}
				>
					<Icons.Check size={16} /> Apply Graph
				</button>
			</footer>

		<!-- ── APPLYING ───────────────────────────────────────────────────── -->
		{:else if step === "applying"}
			<header class="mb-4">
				<h2 class="h3">{mode === "extend" ? "Extending Graph…" : "Saving Graph…"}</h2>
			</header>
			<div class="flex items-center justify-center py-8">
				<div class="bg-primary-500 h-3 w-3 animate-pulse rounded-full"></div>
			</div>
		{/if}
	{/snippet}
</Modal>
