<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { untrack } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import {
		declareInterest,
		useInterest
	} from "$lib/client/sockets/interest.svelte"
	import { interestKey } from "$lib/shared/sockets/interest"
	import { toaster } from "$lib/client/utils/toaster"
	import { resolveOrCreateBindingByName } from "$lib/client/utils/createLorebookBinding"
	import AiTaskModal, { type AiTaskStep } from "./AiTaskModal.svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"

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
	let newParticipantId = $state("")
	let newMentionedId = $state("")
	let pendingNewParticipants = $state<PendingNewCharacter[]>(
		untrack(() =>
			(pendingResult?.suggestedParticipantCharacters ?? []).map(
				(name) => ({
					name,
					source: "suggested" as const
				})
			)
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
	let genPhase = $state<
		"drafting" | "synthesizing" | "naming" | "extracting"
	>("drafting")
	let genBatch = $state(0)
	let genTotalBatches = $state(1)
	let genPartial = $state<{ content?: string; raw?: string }>({})

	let progressPercent = $derived(
		genPhase === "extracting"
			? 95
			: genPhase === "naming"
				? 88
				: genPhase === "synthesizing"
					? 80
					: genTotalBatches > 1
						? Math.max(
								5,
								Math.round((genBatch / genTotalBatches) * 75)
							)
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
		pendingNewMentioned = [
			...pendingNewMentioned,
			{ name, source: "manual" }
		]
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

			// The review is dismissed BY the update, after its write lands (as
			// `acted`) — sending `activity:dismiss` beside it raced the save,
			// and the ephemeral-scene cleanup could delete the scene first.
			// Success is shown only once the server answers (`handleSaved`).
			awaitingSave = true
			socket.emit("scenes:update", {
				scene: {
					id: sceneId,
					name: reviewName.trim() || null,
					summary: reviewContent.trim(),
					participantCharacters: [...new Set(participantIds)],
					mentionedCharacters: [...new Set(mentionedIds)]
				},
				...(internalActivityId ? { activityId: internalActivityId } : {})
			} satisfies Sockets.Scenes.Update.Params)
		} catch (err) {
			isSaving = false
			toaster.error({
				title: "Failed to save new character",
				description: err instanceof Error ? err.message : undefined
			})
		}
	}

	/** A save this modal sent, waiting on the server's answer. */
	let awaitingSave = $state(false)

	function handleSaved(msg: Sockets.Scenes.Update.Response) {
		if (!awaitingSave || msg.scene?.id !== sceneId) return
		awaitingSave = false
		isSaving = false
		toaster.success({ title: "Scene updated" })
		onApplied?.(sceneId)
		onOpenChange({ open: false })
	}

	function handleSaveError(msg: { error?: string }) {
		if (!awaitingSave) return
		awaitingSave = false
		isSaving = false
		toaster.error({
			title: "Scene not saved",
			description: msg?.error
		})
	}

	// Bare: neither event is in `SCOPED_EVENTS`; `handleSaved` filters on the
	// scene, and both act only while this modal is waiting on a save.
	useInterest<"scenes:update">("scenes:update", handleSaved)
	useInterest<"scenes:update:error">("scenes:update:error", handleSaveError)

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

	function handleError(msg: Sockets.Scenes.Process.ErrorResponse) {
		if (msg.sceneId !== sceneId || step !== "running") return
		errorMessage = msg.error
		step = "error"
	}

	/**
	 * The run this modal is watching, SCOPED to its scene — every one of these
	 * payloads carries `sceneId` (see `SCOPED_EVENTS`), so a second review
	 * modal open on another scene is not sent this one's ticks, and the server
	 * skips the push entirely when nobody has the scene open.
	 *
	 * An effect rather than `useInterest` because the key moves: `sceneId` is a
	 * prop, and `useInterest` keeps the key it was first given. Each handler's
	 * own `msg.sceneId !== sceneId` check stays as belt and braces.
	 *
	 * The `:error` key is scoped like the other two, and is never gated (plan
	 * ruling 2). Every failure the process handler reports names the scene —
	 * the not-found and access refusals, a run that halts, and a throw
	 * mid-run. `register()`'s own fallback for an unexpected throw does NOT
	 * (it knows only the event), which is why the handler sends its own
	 * before it throws; the registry is simply the only listener path now.
	 */
	$effect(() => {
		const releases = [
			declareInterest<"scenes:process:progress">(
				interestKey("scenes:process:progress", sceneId),
				handleProgress
			),
			declareInterest<"scenes:process:complete">(
				interestKey("scenes:process:complete", sceneId),
				handleComplete
			),
			declareInterest<"scenes:process:error">(
				interestKey("scenes:process:error", sceneId),
				handleError
			)
		]
		return () => {
			for (const release of releases) release()
		}
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
				class="text-surface-600-400 text-xs font-semibold"
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
				class="text-surface-600-400 text-xs font-semibold"
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
						<Select
							label="Participant to add"
							labelHidden
							placeholder="Add character…"
							class="w-40 text-xs"
							options={lorebookBindingList.filter((b) => !reviewParticipants.includes(b.id)).map((b) => ({
								value: String(b.id),
								label: b.name || b.binding
							}))}
							bind:value={newParticipantId}
						/>
						<button
							aria-label="Add participant"
							class="btn btn-sm preset-filled-surface-400-600"
							onclick={addParticipant}
							disabled={newParticipantId === ""}
						>
							<Icons.Plus size={12} />
						</button>
					</div>
				</div>
				{#if reviewParticipants.length === 0}
					<p class="text-surface-600-400 text-xs italic">None.</p>
				{/if}
				{#if pendingNewParticipants.length > 0}
					<div class="flex flex-wrap gap-1.5">
						{#each pendingNewParticipants as p, i}
							<span
								class="chip preset-tonal-warning flex items-center gap-1 border border-dashed text-xs"
							>
								{p.name}
								<span class="text-[11px] opacity-70">
									(new)
								</span>
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
						aria-label="Add participant by name"
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
						<Select
							label="Mentioned character to add"
							labelHidden
							placeholder="Add character…"
							class="w-40 text-xs"
							options={lorebookBindingList.filter((b) => !reviewMentioned.includes(b.id)).map((b) => ({
								value: String(b.id),
								label: b.name || b.binding
							}))}
							bind:value={newMentionedId}
						/>
						<button
							aria-label="Add mentioned character"
							class="btn btn-sm preset-filled-surface-400-600"
							onclick={addMentioned}
							disabled={newMentionedId === ""}
						>
							<Icons.Plus size={12} />
						</button>
					</div>
				</div>
				{#if reviewMentioned.length === 0}
					<p class="text-surface-600-400 text-xs italic">None.</p>
				{/if}
				{#if pendingNewMentioned.length > 0}
					<div class="flex flex-wrap gap-1.5">
						{#each pendingNewMentioned as p, i}
							<span
								class="chip preset-tonal-warning flex items-center gap-1 border border-dashed text-xs"
							>
								{p.name}
								<span class="text-[11px] opacity-70">
									(new)
								</span>
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
						aria-label="Add mentioned character by name"
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

<AiTaskModal
	{open}
	{onOpenChange}
	title="Scene summary"
	runningTitle="Processing scene…"
	reviewTitle="Review scene summary"
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
/>
