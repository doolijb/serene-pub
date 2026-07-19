<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { onDestroy, onMount, untrack } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { toaster } from "$lib/client/utils/toaster"
	import AiTaskModal, { type AiTaskStep } from "./AiTaskModal.svelte"

	type PendingResult = {
		content: string
		name?: string
		participantCharacters: string[]
		mentionedCharacters: string[]
		raw: string
	}

	interface Props {
		open: boolean
		onOpenChange: (e: { open: boolean }) => void
		sceneId: number
		activityId: string | null
		pendingResult: PendingResult | null
		initialStep?: "review" | "generating"
		onApplied?: (sceneId: number) => void
		onDiscarded?: (activityId: string) => void
	}

	let { open = $bindable(), onOpenChange, sceneId, activityId, pendingResult, initialStep, onApplied, onDiscarded }: Props = $props()

	const socket = useTypedSocket()

	let internalActivityId = $state(untrack(() => activityId))

	let step = $state<AiTaskStep>(
		untrack(() => initialStep === "review" || (pendingResult != null && !initialStep) ? "review" : "running")
	)

	let errorMessage = $state("")

	// Review state
	let reviewName = $state(untrack(() => pendingResult?.name ?? ""))
	let reviewContent = $state(untrack(() => pendingResult?.content ?? ""))
	let reviewParticipants = $state<string[]>(untrack(() => [...(pendingResult?.participantCharacters ?? [])]))
	let reviewMentioned = $state<string[]>(untrack(() => [...(pendingResult?.mentionedCharacters ?? [])]))
	let newParticipantInput = $state("")
	let newMentionedInput = $state("")

	// Running state
	let genPhase = $state<"drafting" | "synthesizing" | "extracting">("drafting")
	let genBatch = $state(0)
	let genTotalBatches = $state(1)
	let genPartial = $state<{ content?: string; raw?: string }>({})

	// Debug trace
	type TraceEntry = { label: string; system: string; user: string; response: string }
	let trace = $state<TraceEntry[]>([])
	let showTrace = $state(false)
	let expandedTraceIdx = $state<number | null>(null)

	let progressPercent = $derived(
		genPhase === "extracting" ? 95
		: genPhase === "synthesizing" ? 80
		: genTotalBatches > 1 ? Math.max(5, Math.round((genBatch / genTotalBatches) * 75))
		: 40
	)

	let progressLabel = $derived(
		genPhase === "extracting" ? "Extracting characters…"
		: genPhase === "synthesizing" ? "Synthesizing…"
		: genBatch > 0 ? `Drafting part ${genBatch} of ${genTotalBatches}…`
		: "Starting…"
	)

	let canSave = $derived(reviewContent.trim().length > 0)

	$effect(() => {
		if (!pendingResult) return
		reviewName = pendingResult.name ?? ""
		reviewContent = pendingResult.content
		reviewParticipants = [...pendingResult.participantCharacters]
		reviewMentioned = [...pendingResult.mentionedCharacters]
	})

	function addParticipant() {
		const name = newParticipantInput.trim()
		if (name && !reviewParticipants.includes(name)) reviewParticipants = [...reviewParticipants, name]
		newParticipantInput = ""
	}

	function addMentioned() {
		const name = newMentionedInput.trim()
		if (name && !reviewMentioned.includes(name)) reviewMentioned = [...reviewMentioned, name]
		newMentionedInput = ""
	}

	function apply() {
		if (!canSave) return
		socket.emit("scenes:update", {
			scene: {
				id: sceneId,
				name: reviewName.trim() || null,
				summary: reviewContent.trim(),
				participantCharacters: reviewParticipants,
				mentionedCharacters: reviewMentioned
			}
		} satisfies Sockets.Scenes.Update.Params)
		if (internalActivityId) socket.emit("activity:dismiss", { id: internalActivityId })
		toaster.success({ title: "Scene updated" })
		onApplied?.(sceneId)
		onOpenChange({ open: false })
	}

	function discard() {
		if (internalActivityId) {
			socket.emit("activity:dismiss", { id: internalActivityId })
			onDiscarded?.(internalActivityId)
		}
		onOpenChange({ open: false })
	}

	function startRerun() {
		step = "running"
		genPhase = "drafting"
		genBatch = 0
		genTotalBatches = 1
		genPartial = {}
		trace = []
		expandedTraceIdx = null
		errorMessage = ""
		socket.emit("scenes:process", { sceneId } satisfies Sockets.Scenes.Process.Params)
	}

	function handleProgress(msg: Sockets.Scenes.Process.Progress) {
		if (msg.sceneId !== sceneId || step !== "running") return
		genPhase = msg.phase
		genBatch = msg.batch
		genTotalBatches = msg.totalBatches
		if (msg.partial) genPartial = msg.partial
	}

	function handleComplete(msg: Sockets.Scenes.Process.Response) {
		if (msg.sceneId !== sceneId || step !== "running") return
		internalActivityId = msg.activityId
		reviewName = msg.name ?? ""
		reviewContent = msg.content
		reviewParticipants = [...msg.participantCharacters]
		reviewMentioned = [...msg.mentionedCharacters]
		step = "review"
	}

	function handleTrace(msg: Sockets.Scenes.Process.TraceEntry) {
		if (msg.sceneId !== sceneId) return
		trace = [...trace, { label: msg.label, system: msg.system, user: msg.user, response: msg.response }]
	}

	function handleError(msg: Sockets.Scenes.Process.ErrorResponse) {
		if (msg.sceneId !== sceneId || step !== "running") return
		errorMessage = msg.error
		step = "error"
	}

	onMount(() => {
		socket.on("scenes:process:progress", handleProgress)
		socket.on("scenes:process:complete", handleComplete)
		socket.on("scenes:process:error", handleError)
		socket.on("scenes:process:trace", handleTrace)
	})

	onDestroy(() => {
		socket.off("scenes:process:progress", handleProgress)
		socket.off("scenes:process:complete", handleComplete)
		socket.off("scenes:process:error", handleError)
		socket.off("scenes:process:trace", handleTrace)
	})

	// In confirm step (pre-rerun): cancel goes back to review; otherwise discard + close
	let handleCancel = $derived(step === "confirm" ? () => { step = "review" } : discard)
</script>

{#snippet confirmBlock()}
	<p class="text-surface-700-300 text-sm">
		Re-process this scene to regenerate the summary and character list. This will replace the current results.
	</p>
{/snippet}

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
			Waiting for first draft…
		</div>
	{/if}
{/snippet}

{#snippet reviewBlock()}
	<div class="space-y-4">
		<div class="space-y-1">
			<label class="label text-sm font-semibold" for="ps-name">Scene title</label>
			<input
				id="ps-name"
				class="input text-sm"
				type="text"
				placeholder="Scene title (optional)…"
				bind:value={reviewName}
			/>
		</div>

		<div class="space-y-1">
			<label class="label text-sm font-semibold" for="ps-content">
				Summary <span class="text-error-500">*</span>
			</label>
			<textarea
				id="ps-content"
				class="textarea min-h-40 text-sm"
				placeholder="Scene summary…"
				bind:value={reviewContent}
			></textarea>
		</div>

		<div class="rounded-lg border border-surface-300-700 p-3 space-y-3">
			<p class="text-xs font-semibold uppercase tracking-wide text-surface-700-300">Characters</p>

			<div class="space-y-1.5">
				<p class="text-sm font-semibold">Participants <span class="text-surface-700-300 font-normal text-xs">(physically present)</span></p>
				<div class="flex flex-wrap gap-1.5">
					{#each reviewParticipants as name, i}
						<span class="chip preset-tonal-primary text-xs flex items-center gap-1">
							{name}
							<button class="hover:text-error-500 p-1.5" aria-label="Remove participant {name}" onclick={() => (reviewParticipants = reviewParticipants.filter((_, j) => j !== i))}>
								<Icons.X size={10} />
							</button>
						</span>
					{/each}
					<div class="flex gap-1">
						<input
							class="input input-sm text-xs w-28"
							placeholder="Add name…"
							bind:value={newParticipantInput}
							onkeydown={(e) => e.key === "Enter" && addParticipant()}
							onblur={addParticipant}
						/>
						<button class="btn btn-sm preset-filled-surface-400-600" onclick={addParticipant} disabled={!newParticipantInput.trim()}>
							<Icons.Plus size={12} />
						</button>
					</div>
				</div>
				{#if reviewParticipants.length === 0}
					<p class="text-xs text-surface-400 italic">None.</p>
				{/if}
			</div>

			<div class="space-y-1.5">
				<p class="text-sm font-semibold">Mentioned <span class="text-surface-700-300 font-normal text-xs">(referenced but absent)</span></p>
				<div class="flex flex-wrap gap-1.5">
					{#each reviewMentioned as name, i}
						<span class="chip preset-tonal-surface text-xs flex items-center gap-1">
							{name}
							<button class="hover:text-error-500 p-1.5" aria-label="Remove mention {name}" onclick={() => (reviewMentioned = reviewMentioned.filter((_, j) => j !== i))}>
								<Icons.X size={10} />
							</button>
						</span>
					{/each}
					<div class="flex gap-1">
						<input
							class="input input-sm text-xs w-28"
							placeholder="Add name…"
							bind:value={newMentionedInput}
							onkeydown={(e) => e.key === "Enter" && addMentioned()}
							onblur={addMentioned}
						/>
						<button class="btn btn-sm preset-filled-surface-400-600" onclick={addMentioned} disabled={!newMentionedInput.trim()}>
							<Icons.Plus size={12} />
						</button>
					</div>
				</div>
				{#if reviewMentioned.length === 0}
					<p class="text-xs text-surface-400 italic">None.</p>
				{/if}
			</div>
		</div>
	</div>
{/snippet}

{#snippet debugBlock()}
	{#if trace.length > 0}
		<button
			class="flex w-full items-center justify-between text-xs text-surface-700-300 hover:text-surface-700-300"
			onclick={() => (showTrace = !showTrace)}
		>
			<span>Debug ({trace.length} calls)</span>
			<Icons.ChevronDown size={14} class="transition-transform {showTrace ? 'rotate-180' : ''}" />
		</button>
		{#if showTrace}
			<div class="mt-3 max-h-[40vh] space-y-2 overflow-y-auto pr-1">
				{#each trace as entry, i}
					<div class="bg-surface-100-900 overflow-hidden rounded-lg border border-surface-300-700 text-xs">
						<button
							class="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-surface-200-800"
							onclick={() => (expandedTraceIdx = expandedTraceIdx === i ? null : i)}
						>
							<Icons.ChevronRight size={12} class="text-surface-400 shrink-0 transition-transform {expandedTraceIdx === i ? 'rotate-90' : ''}" />
							<span class="text-primary-400 shrink-0 font-mono font-medium">{i + 1}.</span>
							<span class="truncate font-medium">{entry.label}</span>
						</button>
						{#if expandedTraceIdx === i}
							<div class="divide-y divide-surface-300-700 border-t border-surface-300-700">
								<div class="space-y-1 p-3">
									<p class="text-primary-500 text-[10px] font-bold uppercase tracking-widest">System</p>
									<pre class="bg-surface-200-800 max-h-48 overflow-y-auto rounded p-2.5 leading-relaxed whitespace-pre-wrap">{entry.system}</pre>
								</div>
								<div class="space-y-1 p-3">
									<p class="text-warning-500 text-[10px] font-bold uppercase tracking-widest">User</p>
									<pre class="bg-surface-200-800 max-h-48 overflow-y-auto rounded p-2.5 leading-relaxed whitespace-pre-wrap">{entry.user}</pre>
								</div>
								<div class="space-y-1 p-3">
									<p class="text-success-500 text-[10px] font-bold uppercase tracking-widest">Response</p>
									<pre class="bg-surface-200-800 max-h-48 overflow-y-auto rounded p-2.5 leading-relaxed whitespace-pre-wrap">{entry.response}</pre>
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
	title="Scene Summary"
	runningTitle="Processing Scene…"
	reviewTitle="Review Scene Summary"
	badge="Scene"
	{step}
	{progressPercent}
	{progressLabel}
	startLabel="Re-process"
	{canSave}
	saveLabel="Apply"
	{errorMessage}
	hasReviewContent={reviewContent.trim().length > 0}
	onStart={startRerun}
	onSave={apply}
	onCancel={handleCancel}
	onMinimize={() => onOpenChange({ open: false })}
	onRetry={startRerun}
	onDiscard={discard}
	onRerun={() => (step = "confirm")}
	onViewLastResult={() => (step = "review")}
	confirm={confirmBlock}
	preview={previewBlock}
	review={reviewBlock}
	debug={debugBlock}
/>
