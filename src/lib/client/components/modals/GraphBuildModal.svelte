<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { getContext, onDestroy, onMount } from "svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import AiTaskModal, { type AiTaskStep } from "./AiTaskModal.svelte"

	interface Props {
		open: boolean
		onOpenChange: (e: { open: boolean }) => void
		lorebookId: number
		mode?: "replace" | "extend"
		readySceneCount?: number
		skippedSceneCount?: number
		ungraphedHistoryEntryCount?: number
		existingUnboundNodeCount?: number
		existingRelationshipCount?: number
		/** Scenes needing character extraction — cost disclosure, not a gate. */
		unresolvedCastSceneCount?: number
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
		existingUnboundNodeCount = 0,
		existingRelationshipCount = 0,
		unresolvedCastSceneCount = 0,
		onApplied
	}: Props = $props()

	let hasExistingContent = $derived(
		mode === "replace" &&
			(existingUnboundNodeCount > 0 || existingRelationshipCount > 0)
	)
	let totalReadyCount = $derived(
		(readySceneCount ?? 0) + (ungraphedHistoryEntryCount ?? 0)
	)

	const socket = useTypedSocket()
	const graphBuildsCtx: GraphBuildsCtx = getContext("graphBuildsCtx")

	// Internal step — "applying" removed; handled via isApplying flag
	type Step = "preflight" | "building" | "review" | "error"
	let step = $state<Step>("preflight")

	let aiStep = $derived<AiTaskStep>(
		step === "preflight"
			? "confirm"
			: step === "building"
				? "running"
				: step === "error"
					? "error"
					: "review"
	)

	let errorMessage = $state("")
	let errorRaw = $state<string | undefined>(undefined)
	let showRaw = $state(false)

	type EditableNode = Sockets.NarrativeGraph.NodeProposal & {
		_deleted?: boolean
	}
	type EditableRel = Sockets.NarrativeGraph.RelationshipProposal & {
		_deleted?: boolean
	}
	type EditableNodeUpdate = Sockets.NarrativeGraph.NodeUpdateProposal & {
		_deleted?: boolean
	}

	let proposalNodes = $state<EditableNode[]>([])
	let proposalRels = $state<EditableRel[]>([])
	let proposalNodeUpdates = $state<EditableNodeUpdate[]>([])
	let sceneLabels = $state<string[]>([])
	let seedTempIdMap = $state<Record<string, number>>({})
	let seedNodeNames = $state<Record<string, string>>({})
	let isApplying = $state(false)

	let expandedNodeIdx = $state<number | null>(null)
	let expandedRelIdx = $state<number | null>(null)
	let showTrace = $state(false)
	let expandedTraceIdx = $state<number | null>(null)

	let activeNodes = $derived(proposalNodes.filter((n) => !n._deleted))
	let activeRels = $derived(proposalRels.filter((r) => !r._deleted))
	let activeNodeUpdates = $derived(
		proposalNodeUpdates.filter((u) => !u._deleted)
	)

	let build = $derived(
		graphBuildsCtx?.activeBuild?.lorebookId === lorebookId
			? graphBuildsCtx.activeBuild
			: null
	)

	let progressPhase = $derived(build?.phase ?? "loading")
	let progressSceneIndex = $derived(build?.sceneIndex ?? 0)
	let progressTotalScenes = $derived(build?.totalScenes ?? 0)
	let progressNodesFound = $derived(build?.nodesFound ?? 0)
	let progressRelsFound = $derived(build?.relsFound ?? 0)
	let progressCurrentPair = $derived(build?.currentPair)
	let progressCurrentSceneLabel = $derived(build?.currentSceneLabel)

	let progressPercent = $derived.by(() => {
		if (progressPhase === "loading" || progressTotalScenes === 0) return 5
		if (progressPhase === "parsing") return 90
		return Math.max(
			10,
			Math.round((progressSceneIndex / progressTotalScenes) * 80) + 5
		)
	})

	let progressLabel = $derived(
		progressPhase === "loading"
			? "Loading…"
			: progressPhase
					.replace(/_/g, " ")
					.replace(/^\w/, (c) => c.toUpperCase()) + "…"
	)

	let modalTitle = $derived(
		mode === "extend" ? "Extend Narrative Graph" : "Build Narrative Graph"
	)
	let runningTitle = $derived(
		mode === "extend"
			? "Extending Narrative Graph…"
			: "Building Narrative Graph…"
	)
	let startLabel = $derived(hasExistingContent ? "Replace Graph" : "Proceed")

	// Restore or reset step when modal opens
	$effect(() => {
		if (!open) return
		const b = graphBuildsCtx?.activeBuild
		if (b && b.lorebookId === lorebookId) {
			if (b.status === "building") {
				step = "building"
			} else if (b.status === "review") {
				step = "review"
				proposalNodes = (b.proposal?.nodes ?? []).map((n) => ({ ...n }))
				proposalRels = (b.proposal?.relationships ?? []).map((r) => ({
					...r
				}))
				proposalNodeUpdates = (b.proposal?.updatedNodes ?? []).map(
					(u) => ({ ...u })
				)
				sceneLabels = b.sceneLabels ?? []
				seedTempIdMap = b.seedTempIdMap ?? {}
				seedNodeNames = b.seedNodeNames ?? {}
			} else if (b.status === "error") {
				step = "error"
				errorMessage = b.errorMessage ?? "Unknown error"
				errorRaw = b.errorRaw
			}
		} else {
			step = "preflight"
			errorMessage = ""
			errorRaw = undefined
			showRaw = false
			proposalNodes = []
			proposalRels = []
			proposalNodeUpdates = []
			sceneLabels = []
			seedTempIdMap = {}
			seedNodeNames = {}
			isApplying = false
			expandedNodeIdx = null
			expandedRelIdx = null
		}
	})

	// Transition when ctx build status changes while modal is open
	$effect(() => {
		if (!open || !build) return
		if (build.status === "review" && step === "building") {
			step = "review"
			proposalNodes = (build.proposal?.nodes ?? []).map((n) => ({ ...n }))
			proposalRels = (build.proposal?.relationships ?? []).map((r) => ({
				...r
			}))
			proposalNodeUpdates = (build.proposal?.updatedNodes ?? []).map(
				(u) => ({ ...u })
			)
			sceneLabels = build.sceneLabels ?? []
			seedTempIdMap = build.seedTempIdMap ?? {}
			seedNodeNames = build.seedNodeNames ?? {}
			expandedNodeIdx = null
			expandedRelIdx = null
		} else if (build.status === "error" && step === "building") {
			step = "error"
			errorMessage = build.errorMessage ?? "Unknown error"
			errorRaw = build.errorRaw
		}
	})

	function triggerBuild() {
		step = "building"
		graphBuildsCtx?.startBuild({ lorebookId, mode })
		socket.emit("narrativeGraph:build", {
			lorebookId,
			mode
		} satisfies Sockets.NarrativeGraph.Build.Params)
	}

	// `step = "building"` above is optimistic — it flips before the server has
	// accepted anything, and startBuild() fabricates a client-side activeBuild
	// to match. If the build is refused before its activity exists (the
	// pre-activity window in narrativeGraphBuildHandler), no activity:update
	// will ever arrive to move us off "building", so without this listener the
	// modal spins forever. Failures *after* the activity exists arrive as a
	// status: "error" update and are handled by the $effect above instead.
	function handleBuildError(msg: Sockets.NarrativeGraph.Build.ErrorResponse) {
		// emitToUser is user-scoped: a build failing for another lorebook in a
		// second tab must not un-stick this modal.
		if (msg.lorebookId !== undefined && msg.lorebookId !== lorebookId) return
		if (step !== "building") return
		graphBuildsCtx?.clearBuild()
		step = "preflight"
		errorMessage = ""
		errorRaw = undefined
		showRaw = false
		// No toast here on purpose: "narrativeGraph:build:error" is absent from
		// Layout's HANDLED_ERROR_EVENTS, so its catch-all already surfaces the
		// server's real message. Toasting again would double it.
	}

	onMount(() => {
		socket.on("narrativeGraph:build:error", handleBuildError)
	})

	// Shared by the error step's "Start Over" and the review step's
	// "Rebuild" — both mean the same thing: discard whatever build is
	// parked (error or stale/unapplied review) and return to a clean
	// preflight so the user can actually kick a new one.
	function startOver() {
		graphBuildsCtx?.clearBuild()
		step = "preflight"
		errorMessage = ""
		errorRaw = undefined
		showRaw = false
	}

	function apply() {
		isApplying = true

		// No seedTempIdMap: the server derives `existing_<id>` → id itself now.
		// Sending it was both redundant (it was a pure identity map) and
		// dangerous — the server validated only its values, so a wrong pairing
		// silently attached relationships to the wrong character.
		const filteredProposal: Sockets.NarrativeGraph.GraphProposal = {
			nodes: activeNodes.map(({ _deleted, ...n }) => n),
			relationships: activeRels.map(({ _deleted, ...r }) => r),
			updatedNodes: activeNodeUpdates.map(({ _deleted, ...u }) => u)
		}

		socket.emit("narrativeGraph:applyProposal", {
			lorebookId,
			proposal: filteredProposal,
			mode
		} satisfies Sockets.NarrativeGraph.ApplyProposal.Params)

		const cleanup = () => {
			socket.off("narrativeGraph:applyProposal", handleApplied)
			socket.off("narrativeGraph:applyProposal:error", handleApplyError)
		}
		const handleApplied = () => {
			cleanup()
			toaster.success({
				title: "Graph applied",
				description: `${activeNodes.length} nodes, ${activeNodeUpdates.length} updates and ${activeRels.length} relationships saved.`
			})
			graphBuildsCtx?.clearBuild()
			isApplying = false
			onApplied?.()
			onOpenChange({ open: false })
		}
		// Without this the Apply button spins forever on any rejection —
		// isApplying was only ever cleared on success. Stay on the review step
		// so the proposal isn't lost; Layout's catch-all toasts the message.
		const handleApplyError = (
			msg: Sockets.NarrativeGraph.ApplyProposal.ErrorResponse
		) => {
			// emitToUser is user-scoped — don't un-stick another tab's modal.
			if (msg.lorebookId !== undefined && msg.lorebookId !== lorebookId)
				return
			cleanup()
			isApplying = false
		}
		socket.on("narrativeGraph:applyProposal", handleApplied)
		socket.on("narrativeGraph:applyProposal:error", handleApplyError)
	}

	onDestroy(() => {
		socket.off("narrativeGraph:applyProposal")
		socket.off("narrativeGraph:applyProposal:error")
		socket.off("narrativeGraph:build:error", handleBuildError)
	})

	function nodeLabel(tempId: string): string {
		return (
			proposalNodes.find((n) => n.tempId === tempId)?.name ??
			seedNodeNames[tempId] ??
			tempId
		)
	}

	function sceneLabel(index: number | undefined): string {
		if (index == null) return ""
		return sceneLabels[index] ?? `Scene ${index + 1}`
	}

	const NODE_STATES = ["active", "deceased", "missing", "departed"] as const
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

	const REL_STATUS_COLOR: Record<string, string> = {
		active: "text-success-500",
		resolved: "text-surface-400",
		broken: "text-error-500",
		evolved: "text-warning-500"
	}

	// Cancel: during building = stop + go to preflight; otherwise = close
	let handleCancel = $derived(
		step === "building"
			? () => {
					if (build?.activityId)
						socket.emit("activity:cancel", { id: build.activityId })
					graphBuildsCtx?.clearBuild()
					step = "preflight"
					errorMessage = ""
					errorRaw = undefined
				}
			: () => onOpenChange({ open: false })
	)
</script>

{#snippet confirmBlock()}
	<p class="text-surface-700-300 mt-1 text-sm">
		{mode === "extend"
			? "The LLM will process new scenes and add to your existing graph."
			: "The LLM will process all summarised scenes and build a fresh graph."}
	</p>
	<div class="mt-4 space-y-2">
		{#if totalReadyCount > 0}
			<div
				class="border-success-500/30 bg-success-500/10 flex items-center gap-3 rounded-lg border p-3 text-sm"
			>
				<Icons.CheckCircle
					size={16}
					class="text-success-500 shrink-0"
				/>
				<span>
					{#if (readySceneCount ?? 0) > 0}
						<strong>{readySceneCount}</strong>
						scene{(readySceneCount ?? 0) === 1 ? "" : "s"}
					{/if}
					{#if (readySceneCount ?? 0) > 0 && (ungraphedHistoryEntryCount ?? 0) > 0}
						{" + "}
					{/if}
					{#if (ungraphedHistoryEntryCount ?? 0) > 0}
						<strong>{ungraphedHistoryEntryCount}</strong>
						history {(ungraphedHistoryEntryCount ?? 0) === 1
							? "entry"
							: "entries"}
					{/if}
					{" "}ready to process
				</span>
			</div>
		{/if}
		{#if unresolvedCastSceneCount > 0}
			<!--
				Disclosure, not a warning: these scenes have no recorded cast,
				so the build derives it from their summaries. That costs about
				one LLM call each, once — afterwards the cast is saved and
				rebuilds take the fast path. "up to" is deliberate: scenes
				holding legacy name strings resolve without any call.
			-->
			<div
				class="border-primary-500/30 bg-primary-500/10 flex items-center gap-3 rounded-lg border p-3 text-sm"
			>
				<Icons.Sparkles size={16} class="text-primary-500 shrink-0" />
				<span>
					<strong>{unresolvedCastSceneCount}</strong>
					scene{unresolvedCastSceneCount === 1 ? "" : "s"} need character
					extraction (up to {unresolvedCastSceneCount} extra LLM call{unresolvedCastSceneCount ===
					1
						? ""
						: "s"}). This is saved afterwards, so later rebuilds skip
					it.
				</span>
			</div>
		{:else}
			<div
				class="border-warning-500/30 bg-warning-500/10 flex items-center gap-3 rounded-lg border p-3 text-sm"
			>
				<Icons.AlertTriangle
					size={16}
					class="text-warning-500 shrink-0"
				/>
				<span>
					No content is ready to process. Generate scene summaries or
					add history entry content first.
				</span>
			</div>
		{/if}
		{#if (skippedSceneCount ?? 0) > 0}
			<div
				class="border-surface-300-700 bg-surface-200-800 flex items-center gap-3 rounded-lg border p-3 text-sm"
			>
				<Icons.SkipForward
					size={16}
					class="text-surface-400 shrink-0"
				/>
				<span class="text-surface-700-300">
					<strong>{skippedSceneCount}</strong>
					scene{(skippedSceneCount ?? 0) === 1 ? "" : "s"} will be skipped
					— no summary yet
				</span>
			</div>
		{/if}
		{#if hasExistingContent}
			<div
				class="border-warning-500/40 bg-warning-500/10 flex items-start gap-3 rounded-lg border p-3 text-sm"
			>
				<Icons.AlertTriangle
					size={16}
					class="text-warning-500 mt-0.5 shrink-0"
				/>
				<span>
					This will replace the existing graph.{" "}
					{#if existingUnboundNodeCount > 0}
						<strong>{existingUnboundNodeCount}</strong>
						unbound node{existingUnboundNodeCount === 1 ? "" : "s"}
					{/if}
					{#if existingUnboundNodeCount > 0 && existingRelationshipCount > 0}
						{" and "}
					{/if}
					{#if existingRelationshipCount > 0}
						<strong>{existingRelationshipCount}</strong>
						relationship{existingRelationshipCount === 1 ? "" : "s"}
					{/if}
					{" "}will be permanently deleted.
				</span>
			</div>
		{/if}
	</div>
{/snippet}

{#snippet previewBlock()}
	{#if progressTotalScenes > 0}
		<div class="text-surface-700-300 flex justify-between text-xs">
			<span>
				{progressCurrentSceneLabel ?? `Scene ${progressSceneIndex + 1}`}
				({progressSceneIndex + 1} / {progressTotalScenes})
			</span>
			<span>
				{progressNodesFound} nodes · {progressRelsFound} relationships
			</span>
		</div>
	{/if}
	{#if progressCurrentPair}
		<div class="mt-3 space-y-1">
			<p
				class="text-surface-700-300 text-xs font-semibold tracking-wide uppercase"
			>
				Extracting perspective
			</p>
			<div class="bg-surface-200-800 rounded-lg p-3 text-sm">
				<p class="text-surface-700-300 font-mono text-xs">
					{progressCurrentPair}
				</p>
			</div>
		</div>
	{:else}
		<div class="text-surface-700-300 py-6 text-center text-sm">
			<div
				class="bg-primary-500 mx-auto mb-2 h-2 w-2 animate-pulse rounded-full"
			></div>
			Waiting for LLM…
		</div>
	{/if}
{/snippet}

{#snippet reviewBlock()}
	<p class="text-surface-700-300 -mt-1 mb-4 text-sm">
		{activeNodes.length} new · {activeNodeUpdates.length} updated · {activeRels.length}
		relationships
	</p>

	<!-- Node updates to existing characters -->
	{#if proposalNodeUpdates.length > 0}
		<section class="mb-4 space-y-2">
			<h3
				class="text-surface-700-300 text-xs font-semibold tracking-wide uppercase"
			>
				Updates to existing characters
			</h3>
			{#each proposalNodeUpdates as update, i}
				<div
					class="bg-surface-200-800 rounded-lg border transition-opacity {update._deleted
						? 'opacity-40'
						: 'border-surface-300-700'}"
				>
					<div class="flex items-center gap-2 px-3 py-2">
						<span class="flex-1 truncate text-sm font-medium">
							{update.name}
						</span>
						{#if update.nodeState}
							<span
								class="badge preset-tonal-warning shrink-0 text-xs"
							>
								{update.previousNodeState} → {update.nodeState}
							</span>
						{/if}
						{#if update.summary !== undefined}
							<span
								class="badge preset-tonal-primary shrink-0 text-xs"
							>
								summary
							</span>
						{/if}
						<button
							type="button"
							class="btn-icon btn-icon-sm preset-tonal-surface shrink-0"
							aria-label={update._deleted
								? `Restore update for ${update.name}`
								: `Discard update for ${update.name}`}
							onclick={() =>
								(proposalNodeUpdates[i]._deleted =
									!update._deleted)}
						>
							{#if update._deleted}
								<Icons.Undo2 size={14} />
							{:else}
								<Icons.Trash2 size={14} />
							{/if}
						</button>
					</div>
					{#if update.summary !== undefined || update.nodeStateReason}
						<div
							class="border-surface-300-700 space-y-1 border-t px-3 py-2"
						>
							{#if update.summary !== undefined}
								<p class="text-sm">{update.summary}</p>
							{/if}
							{#if update.nodeStateReason}
								<p
									class="text-surface-700-300 text-xs italic"
								>
									Reason: {update.nodeStateReason}
								</p>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</section>
	{/if}

	<!-- Nodes -->
	<section class="mb-4 space-y-2">
		<h3
			class="text-surface-700-300 text-xs font-semibold tracking-wide uppercase"
		>
			Nodes
		</h3>
		{#if proposalNodes.length === 0}
			<p class="text-surface-700-300 text-sm italic">
				No new nodes extracted.
			</p>
		{/if}
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
					onclick={() =>
						(expandedNodeIdx = expandedNodeIdx === i ? null : i)}
					onkeydown={(e) =>
						e.key === "Enter" &&
						(expandedNodeIdx = expandedNodeIdx === i ? null : i)}
				>
					<Icons.User size={14} class="text-primary-500 shrink-0" />
					<span class="flex-1 truncate text-sm font-medium">
						{node.name}
					</span>
					<span class="text-surface-400 text-xs">
						{node.nodeState}
					</span>
					{#if node.sceneIndex != null}
						<span class="text-surface-400 text-xs">
							{sceneLabel(node.sceneIndex)}
						</span>
					{/if}
					<button
						class="text-surface-400 hover:text-error-500 ml-1 shrink-0"
						onclick={(e) => {
							e.stopPropagation()
							proposalNodes[i]._deleted =
								!proposalNodes[i]._deleted
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
						class="text-surface-400 transition-transform {expandedNodeIdx ===
						i
							? 'rotate-180'
							: ''}"
					/>
				</div>
				{#if expandedNodeIdx === i && !node._deleted}
					<div
						class="border-surface-300-700 space-y-2 border-t px-3 py-2"
					>
						<div class="space-y-1">
							<p
								class="text-surface-700-300 text-xs font-semibold uppercase"
							>
								Name
							</p>
							<input
								class="input text-sm"
								type="text"
								bind:value={proposalNodes[i].name}
							/>
						</div>
						<div class="space-y-1">
							<p
								class="text-surface-700-300 text-xs font-semibold uppercase"
							>
								State
							</p>
							<select
								class="select text-sm"
								bind:value={proposalNodes[i].nodeState}
							>
								{#each NODE_STATES as s}<option value={s}>
										{s}
									</option>{/each}
							</select>
						</div>
						<div class="space-y-1">
							<p
								class="text-surface-700-300 text-xs font-semibold uppercase"
							>
								Summary
							</p>
							<textarea
								class="textarea min-h-12 text-sm"
								maxlength="200"
								bind:value={proposalNodes[i].summary}
							></textarea>
							<p class="text-surface-400 text-right text-xs">
								{(proposalNodes[i].summary ?? "").length} / 200
							</p>
						</div>
					</div>
				{/if}
			</div>
		{/each}
	</section>

	<!-- Relationships -->
	<section class="mb-4 space-y-2">
		<h3
			class="text-surface-700-300 text-xs font-semibold tracking-wide uppercase"
		>
			Relationships
		</h3>
		{#if proposalRels.length === 0}
			<p class="text-surface-700-300 text-sm italic">
				No relationships extracted.
			</p>
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
					onclick={() =>
						(expandedRelIdx = expandedRelIdx === i ? null : i)}
					onkeydown={(e) =>
						e.key === "Enter" &&
						(expandedRelIdx = expandedRelIdx === i ? null : i)}
				>
					<span class="truncate text-sm">
						<span class="font-medium">
							{nodeLabel(rel.fromTempId)}
						</span>
						<span class="text-surface-400 mx-1">→</span>
						<span class="text-primary-500 text-xs">
							{rel.relationshipType.replace(/_/g, " ")}
						</span>
						<span class="text-surface-400 mx-1">→</span>
						<span class="font-medium">
							{nodeLabel(rel.toTempId)}
						</span>
					</span>
					{#if rel.visibility === "secret"}
						<span
							class="text-warning-500 shrink-0 text-xs"
							title="Secret"
						>
							🔒
						</span>
					{:else if rel.visibility === "public"}
						<span
							class="text-primary-400 shrink-0 text-xs"
							title="Public"
						>
							📢
						</span>
					{/if}
					<span
						class="ml-auto shrink-0 text-xs {REL_STATUS_COLOR[
							rel.status
						] ?? ''}"
					>
						{rel.status}
					</span>
					{#if rel.sceneIndex != null}
						<span class="text-surface-400 text-xs">
							{sceneLabel(rel.sceneIndex)}
						</span>
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
						class="text-surface-400 transition-transform {expandedRelIdx ===
						i
							? 'rotate-180'
							: ''}"
					/>
				</div>
				{#if expandedRelIdx === i && !rel._deleted}
					<div
						class="border-surface-300-700 space-y-2 border-t px-3 py-2"
					>
						<div class="grid grid-cols-3 gap-2">
							<div class="space-y-1">
								<p
									class="text-surface-700-300 text-xs font-semibold uppercase"
								>
									Type
								</p>
								<input
									class="input text-sm"
									type="text"
									bind:value={
										proposalRels[i].relationshipType
									}
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
									bind:value={proposalRels[i].status}
								>
									{#each RELATIONSHIP_STATUSES as s}<option
											value={s}
										>
											{s}
										</option>{/each}
								</select>
							</div>
							<div class="space-y-1">
								<p
									class="text-surface-700-300 text-xs font-semibold uppercase"
								>
									Visibility
								</p>
								<select
									class="select text-sm"
									bind:value={proposalRels[i].visibility}
								>
									{#each RELATIONSHIP_VISIBILITIES as v}<option
											value={v}
										>
											{v}
										</option>{/each}
								</select>
							</div>
						</div>
						<div class="space-y-1">
							<p
								class="text-surface-700-300 text-xs font-semibold uppercase"
							>
								Description
							</p>
							<textarea
								class="textarea min-h-12 text-sm"
								bind:value={proposalRels[i].description}
							></textarea>
						</div>
						<div class="space-y-1">
							<p
								class="text-surface-700-300 text-xs font-semibold uppercase"
							>
								Reason for change
							</p>
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
{/snippet}

{#snippet reviewExtraBlock()}
	<button
		class="btn preset-filled-surface-400-600"
		onclick={() => onOpenChange({ open: false })}
	>
		Close
	</button>
	<button class="btn preset-tonal-warning" onclick={startOver}>
		<Icons.RefreshCw size={16} /> Rebuild
	</button>
{/snippet}

{#snippet errorExtraBlock()}
	{#if errorRaw}
		<button
			class="text-surface-700-300 hover:text-surface-700-300 flex items-center gap-1 text-xs"
			onclick={() => (showRaw = !showRaw)}
		>
			<Icons.ChevronDown
				size={14}
				class="transition-transform {showRaw ? 'rotate-180' : ''}"
			/>
			{showRaw ? "Hide" : "Show"} raw LLM output
		</button>
		{#if showRaw}
			<pre
				class="bg-surface-200-800 mt-2 max-h-40 overflow-y-auto rounded p-3 text-xs whitespace-pre-wrap">{errorRaw}</pre>
		{/if}
	{/if}
{/snippet}

{#snippet debugBlock()}
	{#if (build?.trace?.length ?? 0) > 0}
		<button
			class="text-surface-700-300 hover:text-surface-700-300 flex w-full items-center justify-between text-xs"
			onclick={() => (showTrace = !showTrace)}
		>
			<span>Debug ({build?.trace?.length ?? 0} calls)</span>
			<Icons.ChevronDown
				size={14}
				class="transition-transform {showTrace ? 'rotate-180' : ''}"
			/>
		</button>
		{#if showTrace}
			<div class="mt-3 max-h-[60vh] space-y-2 overflow-y-auto pr-1">
				{#each build?.trace ?? [] as entry, i}
					<div
						class="bg-surface-100-900 border-surface-300-700 overflow-hidden rounded-lg border text-xs"
					>
						<button
							class="hover:bg-surface-200-800 flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors"
							onclick={() =>
								(expandedTraceIdx =
									expandedTraceIdx === i ? null : i)}
						>
							<Icons.ChevronRight
								size={12}
								class="text-surface-400 shrink-0 transition-transform {expandedTraceIdx ===
								i
									? 'rotate-90'
									: ''}"
							/>
							<span
								class="text-primary-400 shrink-0 font-mono font-medium"
							>
								{i + 1}.
							</span>
							<span class="truncate font-medium">
								{entry.label}
							</span>
						</button>
						{#if expandedTraceIdx === i}
							<div
								class="divide-surface-300-700 border-surface-300-700 divide-y border-t"
							>
								<div class="space-y-1 p-3">
									<p
										class="text-primary-500 text-[10px] font-bold tracking-widest uppercase"
									>
										System
									</p>
									<pre
										class="bg-surface-200-800 max-h-56 overflow-y-auto rounded p-2.5 leading-relaxed whitespace-pre-wrap">{entry.system}</pre>
								</div>
								<div class="space-y-1 p-3">
									<p
										class="text-warning-500 text-[10px] font-bold tracking-widest uppercase"
									>
										User
									</p>
									<pre
										class="bg-surface-200-800 max-h-56 overflow-y-auto rounded p-2.5 leading-relaxed whitespace-pre-wrap">{entry.user}</pre>
								</div>
								<div class="space-y-1 p-3">
									<p
										class="text-success-500 text-[10px] font-bold tracking-widest uppercase"
									>
										Response
									</p>
									<pre
										class="bg-surface-200-800 max-h-56 overflow-y-auto rounded p-2.5 leading-relaxed whitespace-pre-wrap">{entry.response}</pre>
								</div>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	{/if}
{/snippet}

<AiTaskModal
	{open}
	{onOpenChange}
	title={modalTitle}
	{runningTitle}
	reviewTitle="Review Graph Proposal"
	step={aiStep}
	{progressPercent}
	{progressLabel}
	canStart={totalReadyCount > 0}
	{startLabel}
	canSave={activeNodes.length > 0 ||
		activeNodeUpdates.length > 0 ||
		activeRels.length > 0}
	saveLabel="Apply Graph"
	isSaving={isApplying}
	{errorMessage}
	retryLabel="Retry Step"
	onStart={triggerBuild}
	onSave={apply}
	onCancel={handleCancel}
	onMinimize={() => onOpenChange({ open: false })}
	onRetry={() => {
		step = "building"
		errorMessage = ""
		errorRaw = undefined
		showRaw = false
		socket.emit("narrativeGraph:build", {
			lorebookId,
			mode,
			resume: true
		} satisfies Sockets.NarrativeGraph.Build.Params)
	}}
	onStartOver={startOver}
	onDiscard={() => {
		graphBuildsCtx?.clearBuild()
		onOpenChange({ open: false })
	}}
	confirm={confirmBlock}
	preview={previewBlock}
	review={reviewBlock}
	reviewExtra={reviewExtraBlock}
	errorExtra={errorExtraBlock}
	debug={debugBlock}
	size="lg"
/>
