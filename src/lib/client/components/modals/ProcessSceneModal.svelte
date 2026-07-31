<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { onDestroy, onMount, untrack } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { toaster } from "$lib/client/utils/toaster"
	import { resolveOrCreateBindingByName } from "$lib/client/utils/createLorebookBinding"
	import AiTaskModal, { type AiTaskStep } from "./AiTaskModal.svelte"

	type PendingResult = {
		content: string
		name?: string
		participantCharacters: number[]
		mentionedCharacters: number[]
		suggestedParticipantCharacters?: string[]
		suggestedMentionedCharacters?: string[]
		raw: string
	}

	/** A name not yet backed by a real lorebookBindings id — either
	 * suggested by character extraction or typed manually in review. Only
	 * resolved to a real binding (matched or newly created) at Save. */
	type PendingNewCharacter = { name: string; source: "suggested" | "manual" }

	interface Props {
		open: boolean
		onOpenChange: (e: { open: boolean }) => void
		sceneId: number
		activityId: string | null
		pendingResult: PendingResult | null
		initialStep?: "review" | "generating"
		lorebookId: number
		lorebookBindingList: { id: number; name: string; binding: string }[]
		onApplied?: (sceneId: number) => void
		onDiscarded?: (activityId: string) => void
	}

	let {
		open = $bindable(),
		onOpenChange,
		sceneId,
		activityId,
		pendingResult,
		initialStep,
		lorebookId,
		lorebookBindingList,
		onApplied,
		onDiscarded
	}: Props = $props()

	let bindingNameById = $derived.by(() => {
		const map = new Map<number, string>()
		for (const b of lorebookBindingList) map.set(b.id, b.name || b.binding)
		return map
	})

	const socket = useTypedSocket()

	let internalActivityId = $state(untrack(() => activityId))

	let step = $state<AiTaskStep>(
		untrack(() =>
			initialStep === "review" || (pendingResult != null && !initialStep)
				? "review"
				: "running"
		)
	)

	let errorMessage = $state("")

	// Review state
	let reviewName = $state(untrack(() => pendingResult?.name ?? ""))
	let reviewContent = $state(untrack(() => pendingResult?.content ?? ""))
	let reviewParticipants = $state<number[]>(
		untrack(() => [...(pendingResult?.participantCharacters ?? [])])
	)
	let reviewMentioned = $state<number[]>(
		untrack(() => [...(pendingResult?.mentionedCharacters ?? [])])
	)
	let newParticipantId = $state<number | "">("")
	let newMentionedId = $state<number | "">("")
	let pendingNewParticipants = $state<PendingNewCharacter[]>(
		untrack(() =>
			(pendingResult?.suggestedParticipantCharacters ?? []).map((name) => ({
				name,
				source: "suggested" as const
			}))
		)
	)
	let pendingNewMentioned = $state<PendingNewCharacter[]>(
		untrack(() =>
			(pendingResult?.suggestedMentionedCharacters ?? []).map((name) => ({
				name,
				source: "suggested" as const
			}))
		)
	)
	let newParticipantName = $state("")
	let newMentionedName = $state("")
	let isSaving = $state(false)

	// Running state
	let genPhase = $state<"drafting" | "synthesizing" | "naming" | "extracting">(
		"drafting"
	)
	let genBatch = $state(0)
	let genTotalBatches = $state(1)
	let genPartial = $state<{ content?: string; raw?: string }>({})

	// Debug trace
	type TraceEntry = {
		label: string
		system: string
		user: string
		response: string
	}
	let trace = $state<TraceEntry[]>([])
	let showTrace = $state(false)
	let expandedTraceIdx = $state<number | null>(null)

	let progressPercent = $derived(
		genPhase === "extracting"
			? 95
			: genPhase === "naming"
				? 88
				: genPhase === "synthesizing"
					? 80
					: genTotalBatches > 1
						? Math.max(5, Math.round((genBatch / genTotalBatches) * 75))
						: 40
	)

	let progressLabel = $derived(
		genPhase === "extracting"
			? "Extracting characters…"
			: genPhase === "naming"
				? "Naming scene…"
				: genPhase === "synthesizing"
					? "Synthesizing…"
					: genBatch > 0
						? `Drafting part ${genBatch} of ${genTotalBatches}…`
						: "Starting…"
	)

	let canSave = $derived(reviewContent.trim().length > 0)

	$effect(() => {
		if (!pendingResult) return
		reviewName = pendingResult.name ?? ""
		reviewContent = pendingResult.content
		reviewParticipants = [...pendingResult.participantCharacters]
		reviewMentioned = [...pendingResult.mentionedCharacters]
		pendingNewParticipants = (
			pendingResult.suggestedParticipantCharacters ?? []
		).map((name) => ({ name, source: "suggested" as const }))
		pendingNewMentioned = (
			pendingResult.suggestedMentionedCharacters ?? []
		).map((name) => ({ name, source: "suggested" as const }))
	})

	function addParticipant() {
		if (newParticipantId === "") return
		const id = Number(newParticipantId)
		if (!reviewParticipants.includes(id)) {
			reviewParticipants = [...reviewParticipants, id]
		}
		newParticipantId = ""
	}

	function addMentioned() {
		if (newMentionedId === "") return
		const id = Number(newMentionedId)
		if (!reviewMentioned.includes(id)) {
			reviewMentioned = [...reviewMentioned, id]
		}
		newMentionedId = ""
	}

	function pendingNameTaken(name: string, list: PendingNewCharacter[]) {
		return list.some((p) => p.name.toLowerCase() === name.toLowerCase())
	}

	function addManualParticipant() {
		const name = newParticipantName.trim()
		if (!name || pendingNameTaken(name, pendingNewParticipants)) return
		pendingNewParticipants = [
			...pendingNewParticipants,
			{ name, source: "manual" }
		]
		newParticipantName = ""
	}

	function addManualMentioned() {
		const name = newMentionedName.trim()
		if (!name || pendingNameTaken(name, pendingNewMentioned)) return
		pendingNewMentioned = [...pendingNewMentioned, { name, source: "manual" }]
		newMentionedName = ""
	}

	async function apply() {
		if (!canSave || isSaving) return
		isSaving = true
		try {
			const participantIds = [...reviewParticipants]
			const mentionedIds = [...reviewMentioned]
			for (const p of pendingNewParticipants) {
				const { id } = await resolveOrCreateBindingByName(
					socket,
					lorebookId,
					p.name
				)
				participantIds.push(id)
			}
			for (const m of pendingNewMentioned) {
				const { id } = await resolveOrCreateBindingByName(
					socket,
					lorebookId,
					m.name
				)
				mentionedIds.push(id)
			}

			socket.emit("scenes:update", {
				scene: {
					id: sceneId,
					name: reviewName.trim() || null,
					summary: reviewContent.trim(),
					participantCharacters: [...new Set(participantIds)],
					mentionedCharacters: [...new Set(mentionedIds)]
				}
			} satisfies Sockets.Scenes.Update.Params)
			if (internalActivityId)
				socket.emit("activity:dismiss", { id: internalActivityId })
			toaster.success({ title: "Scene updated" })
			onApplied?.(sceneId)
			onOpenChange({ open: false })
		} catch (err) {
			toaster.error({
				title: "Failed to save new character",
				description: err instanceof Error ? err.message : undefined
			})
		} finally {
			isSaving = false
		}
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
		pendingNewParticipants = []
		pendingNewMentioned = []
		socket.emit("scenes:process", {
			sceneId
		} satisfies Sockets.Scenes.Process.Params)
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
		pendingNewParticipants = (msg.suggestedParticipantCharacters ?? []).map(
			(name) => ({ name, source: "suggested" as const })
		)
		pendingNewMentioned = (msg.suggestedMentionedCharacters ?? []).map(
			(name) => ({ name, source: "suggested" as const })
		)
		step = "review"
	}

	function handleTrace(msg: Sockets.Scenes.Process.TraceEntry) {
		if (msg.sceneId !== sceneId) return
		trace = [
			...trace,
			{
				label: msg.label,
				system: msg.system,
				user: msg.user,
				response: msg.response
			}
		]
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
	let handleCancel = $derived(
		step === "confirm"
			? () => {
					step = "review"
				}
			: discard
	)
</script>

{#snippet confirmBlock()}
	<p class="text-surface-700-300 text-sm">
		Re-process this scene to regenerate the summary and character list. This
		will replace the current results.
	</p>
{/snippet}

{#snippet previewBlock()}
	{#if genPartial.content || genPartial.raw}
		<div class="space-y-1">
			<p
				class="text-surface-700-300 text-xs font-semibold tracking-wide uppercase"
			>
				{genPhase === "synthesizing"
					? "Synthesizing"
					: `Draft ${genBatch}`}
			</p>
			<div class="bg-surface-200-800 rounded-lg p-3 text-sm">
				{#if genPartial.content}
					<p
						class="text-surface-700-300 line-clamp-6 whitespace-pre-wrap"
					>
						{genPartial.content}
					</p>
				{:else if genPartial.raw}
					<p
						class="text-surface-700-300 line-clamp-6 text-xs whitespace-pre-wrap italic"
					>
						{genPartial.raw}
					</p>
				{/if}
			</div>
		</div>
	{:else}
		<div class="text-surface-700-300 py-4 text-center text-sm">
			<div
				class="bg-primary-500 mx-auto mb-2 h-2 w-2 animate-pulse rounded-full"
			></div>
			Waiting for first draft…
		</div>
	{/if}
{/snippet}

{#snippet reviewBlock()}
	<div class="space-y-4">
		<div class="space-y-1">
			<label class="label text-sm font-semibold" for="ps-name">
				Scene title
			</label>
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

		<div class="border-surface-300-700 space-y-3 rounded-lg border p-3">
			<p
				class="text-surface-700-300 text-xs font-semibold tracking-wide uppercase"
			>
				Characters
			</p>

			<div class="space-y-1.5">
				<p class="text-sm font-semibold">
					Participants <span
						class="text-surface-700-300 text-xs font-normal"
					>
						(physically present)
					</span>
				</p>
				<div class="flex flex-wrap gap-1.5">
					{#each reviewParticipants as id, i}
						<span
							class="chip preset-tonal-primary flex items-center gap-1 text-xs"
						>
							{bindingNameById.get(id) ?? `#${id}`}
							<button
								class="hover:text-error-500 p-1.5"
								aria-label="Remove participant {bindingNameById.get(
									id
								) ?? id}"
								onclick={() =>
									(reviewParticipants =
										reviewParticipants.filter(
											(_, j) => j !== i
										))}
							>
								<Icons.X size={10} />
							</button>
						</span>
					{/each}
					<div class="flex gap-1">
						<select
							class="select select-sm w-32 text-xs"
							bind:value={newParticipantId}
						>
							<option value="">Add character…</option>
							{#each lorebookBindingList.filter((b) => !reviewParticipants.includes(b.id)) as b}
								<option value={b.id}
									>{b.name || b.binding}</option
								>
							{/each}
						</select>
						<button
							class="btn btn-sm preset-filled-surface-400-600"
							onclick={addParticipant}
							disabled={newParticipantId === ""}
						>
							<Icons.Plus size={12} />
						</button>
					</div>
				</div>
				{#if reviewParticipants.length === 0}
					<p class="text-surface-400 text-xs italic">None.</p>
				{/if}
				{#if pendingNewParticipants.length > 0}
					<div class="flex flex-wrap gap-1.5">
						{#each pendingNewParticipants as p, i}
							<span
								class="chip preset-tonal-warning flex items-center gap-1 border border-dashed text-xs"
							>
								{p.name}
								<span class="text-[10px] opacity-70">(new)</span>
								<button
									class="hover:text-error-500 p-1.5"
									aria-label="Remove suggested character {p.name}"
									onclick={() =>
										(pendingNewParticipants =
											pendingNewParticipants.filter(
												(_, j) => j !== i
											))}
								>
									<Icons.X size={10} />
								</button>
							</span>
						{/each}
					</div>
				{/if}
				<div class="flex gap-1">
					<input
						class="input input-sm w-32 text-xs"
						type="text"
						placeholder="Add new character…"
						bind:value={newParticipantName}
						onkeydown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault()
								addManualParticipant()
							}
						}}
					/>
					<button
						class="btn btn-sm preset-filled-surface-400-600"
						onclick={addManualParticipant}
						disabled={!newParticipantName.trim()}
					>
						<Icons.Plus size={12} />
					</button>
				</div>
			</div>

			<div class="space-y-1.5">
				<p class="text-sm font-semibold">
					Mentioned <span
						class="text-surface-700-300 text-xs font-normal"
					>
						(referenced but absent)
					</span>
				</p>
				<div class="flex flex-wrap gap-1.5">
					{#each reviewMentioned as id, i}
						<span
							class="chip preset-tonal-surface flex items-center gap-1 text-xs"
						>
							{bindingNameById.get(id) ?? `#${id}`}
							<button
								class="hover:text-error-500 p-1.5"
								aria-label="Remove mention {bindingNameById.get(
									id
								) ?? id}"
								onclick={() =>
									(reviewMentioned = reviewMentioned.filter(
										(_, j) => j !== i
									))}
							>
								<Icons.X size={10} />
							</button>
						</span>
					{/each}
					<div class="flex gap-1">
						<select
							class="select select-sm w-32 text-xs"
							bind:value={newMentionedId}
						>
							<option value="">Add character…</option>
							{#each lorebookBindingList.filter((b) => !reviewMentioned.includes(b.id)) as b}
								<option value={b.id}
									>{b.name || b.binding}</option
								>
							{/each}
						</select>
						<button
							class="btn btn-sm preset-filled-surface-400-600"
							onclick={addMentioned}
							disabled={newMentionedId === ""}
						>
							<Icons.Plus size={12} />
						</button>
					</div>
				</div>
				{#if reviewMentioned.length === 0}
					<p class="text-surface-400 text-xs italic">None.</p>
				{/if}
				{#if pendingNewMentioned.length > 0}
					<div class="flex flex-wrap gap-1.5">
						{#each pendingNewMentioned as p, i}
							<span
								class="chip preset-tonal-warning flex items-center gap-1 border border-dashed text-xs"
							>
								{p.name}
								<span class="text-[10px] opacity-70">(new)</span>
								<button
									class="hover:text-error-500 p-1.5"
									aria-label="Remove suggested character {p.name}"
									onclick={() =>
										(pendingNewMentioned =
											pendingNewMentioned.filter(
												(_, j) => j !== i
											))}
								>
									<Icons.X size={10} />
								</button>
							</span>
						{/each}
					</div>
				{/if}
				<div class="flex gap-1">
					<input
						class="input input-sm w-32 text-xs"
						type="text"
						placeholder="Add new character…"
						bind:value={newMentionedName}
						onkeydown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault()
								addManualMentioned()
							}
						}}
					/>
					<button
						class="btn btn-sm preset-filled-surface-400-600"
						onclick={addManualMentioned}
						disabled={!newMentionedName.trim()}
					>
						<Icons.Plus size={12} />
					</button>
				</div>
			</div>
		</div>
	</div>
{/snippet}

{#snippet debugBlock()}
	{#if trace.length > 0}
		<button
			class="text-surface-700-300 hover:text-surface-700-300 flex w-full items-center justify-between text-xs"
			onclick={() => (showTrace = !showTrace)}
		>
			<span>Debug ({trace.length} calls)</span>
			<Icons.ChevronDown
				size={14}
				class="transition-transform {showTrace ? 'rotate-180' : ''}"
			/>
		</button>
		{#if showTrace}
			<div class="mt-3 max-h-[40vh] space-y-2 overflow-y-auto pr-1">
				{#each trace as entry, i}
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
										class="bg-surface-200-800 max-h-48 overflow-y-auto rounded p-2.5 leading-relaxed whitespace-pre-wrap">{entry.system}</pre>
								</div>
								<div class="space-y-1 p-3">
									<p
										class="text-warning-500 text-[10px] font-bold tracking-widest uppercase"
									>
										User
									</p>
									<pre
										class="bg-surface-200-800 max-h-48 overflow-y-auto rounded p-2.5 leading-relaxed whitespace-pre-wrap">{entry.user}</pre>
								</div>
								<div class="space-y-1 p-3">
									<p
										class="text-success-500 text-[10px] font-bold tracking-widest uppercase"
									>
										Response
									</p>
									<pre
										class="bg-surface-200-800 max-h-48 overflow-y-auto rounded p-2.5 leading-relaxed whitespace-pre-wrap">{entry.response}</pre>
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
	{isSaving}
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
