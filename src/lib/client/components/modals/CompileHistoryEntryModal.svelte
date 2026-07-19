<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { onDestroy, onMount, untrack } from "svelte"
	import { diffWords } from "diff"
	import { toaster } from "$lib/client/utils/toaster"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import AiTaskModal, { type AiTaskStep } from "./AiTaskModal.svelte"

	interface Props {
		open: boolean
		onOpenChange: (e: { open: boolean }) => void
		historyEntry: SelectHistoryEntry
		activityId?: string | null
		pendingResult?: { content: string } | null
		initialStep?: "review" | "running"
		onSaved: (updated: SelectHistoryEntry) => void
		onDiscarded?: (activityId: string) => void
	}

	let {
		open = $bindable(),
		onOpenChange,
		historyEntry,
		activityId = null,
		pendingResult = null,
		initialStep,
		onSaved,
		onDiscarded
	}: Props = $props()

	const socket = useTypedSocket()

	let internalActivityId = $state(untrack(() => activityId))

	let step = $state<AiTaskStep>(
		untrack(() => initialStep === "review" || (pendingResult != null && !initialStep) ? "review" : "running")
	)

	let errorMessage = $state("")

	// Review state
	let editableContent = $state(untrack(() => pendingResult?.content ?? ""))

	// Running state
	let genPhase = $state<"drafting" | "synthesizing">("drafting")
	let genBatch = $state(0)
	let genTotalBatches = $state(1)
	let genPartial = $state<{ content?: string; raw?: string }>({})

	let hasExistingContent = $derived((historyEntry.content?.trim().length ?? 0) > 0)

	let diffParts = $derived.by(() => {
		if (!hasExistingContent || step !== "review") return []
		return diffWords(historyEntry.content ?? "", editableContent)
	})
	let hasDiff = $derived(diffParts.some((p) => p.added || p.removed))

	let progressPercent = $derived(
		genPhase === "synthesizing" ? 80
		: genTotalBatches > 1 ? Math.max(5, Math.round((genBatch / genTotalBatches) * 75))
		: 40
	)

	let progressLabel = $derived(
		genPhase === "synthesizing" ? "Synthesizing…"
		: genBatch > 0 ? `Drafting part ${genBatch} of ${genTotalBatches}…`
		: "Starting…"
	)

	let canSave = $derived(editableContent.trim().length > 0)

	$effect(() => {
		if (!pendingResult) return
		editableContent = pendingResult.content
	})

	function startCompile() {
		step = "running"
		genPhase = "drafting"
		genBatch = 0
		genTotalBatches = 1
		genPartial = {}
		errorMessage = ""
		socket.emit("scenes:compile", { historyEntryId: historyEntry.id } satisfies Sockets.Scenes.Compile.Params)
	}

	function handleProgress(data: Sockets.Scenes.Compile.Progress) {
		genPhase = data.phase
		genBatch = data.batch
		genTotalBatches = data.totalBatches
		genPartial = data.partial
	}

	function handleComplete(data: Sockets.Scenes.Compile.Response) {
		if (data.historyEntryId !== historyEntry.id) return
		internalActivityId = data.activityId
		editableContent = data.content
		step = "review"
	}

	function handleError(data: Sockets.Scenes.Compile.ErrorResponse) {
		errorMessage = data.error
		step = "error"
	}

	onMount(() => {
		socket.on("scenes:compile:progress", handleProgress)
		socket.on("scenes:compile:complete", handleComplete)
		socket.on("scenes:compile:error", handleError)
		if (step === "running" && !internalActivityId) {
			startCompile()
		}
	})

	onDestroy(() => {
		socket.off("scenes:compile:progress", handleProgress)
		socket.off("scenes:compile:complete", handleComplete)
		socket.off("scenes:compile:error", handleError)
	})

	function save() {
		const updated: UpdateHistoryEntry = {
			...historyEntry,
			content: editableContent.trim(),
			isCompleted: true
		}
		socket.emit("historyEntries:update", { historyEntry: updated })
		if (internalActivityId) socket.emit("activity:dismiss", { id: internalActivityId })
		toaster.success({ title: "History entry updated" })
		onSaved({ ...historyEntry, content: editableContent.trim(), isCompleted: true })
		onOpenChange({ open: false })
	}

	function discard() {
		if (internalActivityId) {
			socket.emit("activity:dismiss", { id: internalActivityId })
			onDiscarded?.(internalActivityId)
		}
		onOpenChange({ open: false })
	}

	function handleCancel() {
		if (step === "running") {
			discard()
		} else {
			if (internalActivityId) socket.emit("activity:dismiss", { id: internalActivityId })
			onOpenChange({ open: false })
		}
	}

	function handleRetry() {
		internalActivityId = null
		startCompile()
	}
</script>

{#snippet previewBlock()}
	{#if genPartial.content || genPartial.raw}
		<div class="space-y-1">
			<p class="text-surface-700-300 text-xs font-semibold uppercase tracking-wide">
				{genPhase === "synthesizing" ? "Synthesizing" : `Draft ${genBatch}`}
			</p>
			<div class="bg-surface-200-800 rounded-lg p-3 text-sm">
				{#if genPartial.content}
					<p class="text-surface-700-300 line-clamp-6 whitespace-pre-wrap">{genPartial.content}</p>
				{:else if genPartial.raw}
					<p class="text-surface-700-300 line-clamp-6 whitespace-pre-wrap text-xs italic">{genPartial.raw}</p>
				{/if}
			</div>
		</div>
	{:else}
		<div class="text-surface-700-300 py-4 text-center text-sm">
			<div class="bg-primary-500 mx-auto mb-2 h-2 w-2 animate-pulse rounded-full"></div>
			Waiting for synthesis…
		</div>
	{/if}
{/snippet}

{#snippet reviewBlock()}
	<div class="space-y-4">
		{#if hasExistingContent && hasDiff}
			<div class="space-y-1">
				<p class="text-surface-700-300 text-xs font-semibold uppercase tracking-wide">Changes</p>
				<div class="bg-surface-200-800 rounded-lg p-3 text-sm leading-relaxed whitespace-pre-wrap">
					{#each diffParts as part}
						{#if part.removed}
							<span class="text-error-500 line-through opacity-70">{part.value}</span>
						{:else if part.added}
							<span class="text-success-500">{part.value}</span>
						{:else}
							<span>{part.value}</span>
						{/if}
					{/each}
				</div>
			</div>
		{/if}
		<div class="space-y-1">
			<label class="label text-sm font-semibold" for="compile-content">
				Content <span class="text-error-500">*</span>
			</label>
			<textarea
				id="compile-content"
				class="textarea min-h-40 text-sm"
				bind:value={editableContent}
			></textarea>
		</div>
	</div>
{/snippet}

<AiTaskModal
	{open}
	{onOpenChange}
	title="Compile to Entry"
	runningTitle="Compiling Scenes…"
	reviewTitle="Review Compiled Entry"
	badge="History Entry"
	{step}
	{progressPercent}
	{progressLabel}
	{canSave}
	saveLabel="Save to Entry"
	{errorMessage}
	hasReviewContent={editableContent.trim().length > 0}
	onStart={startCompile}
	onSave={save}
	onCancel={handleCancel}
	onMinimize={() => onOpenChange({ open: false })}
	onRetry={handleRetry}
	onDiscard={discard}
	onRerun={handleRetry}
	onViewLastResult={() => (step = "review")}
	preview={previewBlock}
	review={reviewBlock}
/>
