<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { onMount, untrack } from "svelte"
	import { diffWords } from "diff"
	import { toaster } from "$lib/client/utils/toaster"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import {
		declareInterest,
		useInterest
	} from "$lib/client/sockets/interest.svelte"
	import { interestKey } from "$lib/shared/sockets/interest"
	import { changedFields } from "$lib/shared/lorebooks/amendments"
	import { awaitReply, isReplyTimeout } from "$lib/client/utils/awaitReply"
	import { fileEntryAmendments } from "$lib/client/lorebooks/editor/entrySave"
	import {
		formatDate,
		type StoryDate
	} from "$lib/client/lorebooks/sections/historyDates"
	import AiTaskModal, { type AiTaskStep } from "./AiTaskModal.svelte"
	import {
		HISTORY_TYPE_ID,
		type LorebookEntry
	} from "$lib/shared/entries/types"

	type History = LorebookEntry<typeof HISTORY_TYPE_ID>

	interface Props {
		open: boolean
		onOpenChange: (e: { open: boolean }) => void
		historyEntry: History
		activityId?: string | null
		pendingResult?: { content: string } | null
		initialStep?: "review" | "running"
		/**
		 * The date being read, when one is. A compile saved at a moment is an
		 * AMENDMENT dated then, exactly as the entry editor's Save as of is;
		 * at now it is a write of the changed fields to the entry.
		 */
		moment?: StoryDate | null
		/** The line being read. `null` is main. */
		branchId?: number | null
		/** The overlay ids already known for this entry, to spot the new one. */
		knownAmendmentIds?: number[]
		onSaved?: (updated: History) => void
		onDiscarded?: (activityId: string) => void
	}

	let {
		open = $bindable(),
		onOpenChange,
		historyEntry,
		activityId = null,
		pendingResult = null,
		initialStep,
		moment = null,
		branchId = null,
		knownAmendmentIds = [],
		onSaved,
		onDiscarded
	}: Props = $props()

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
	let editableContent = $state(untrack(() => pendingResult?.content ?? ""))

	// Running state
	let genPhase = $state<"drafting" | "synthesizing">("drafting")
	let genBatch = $state(0)
	let genTotalBatches = $state(1)
	let genPartial = $state<{ content?: string; raw?: string }>({})

	let hasExistingContent = $derived(
		(historyEntry.content?.trim().length ?? 0) > 0
	)

	let diffParts = $derived.by(() => {
		if (!hasExistingContent || step !== "review") return []
		return diffWords(historyEntry.content ?? "", editableContent)
	})
	let hasDiff = $derived(diffParts.some((p) => p.added || p.removed))

	let progressPercent = $derived(
		genPhase === "synthesizing"
			? 80
			: genTotalBatches > 1
				? Math.max(5, Math.round((genBatch / genTotalBatches) * 75))
				: 40
	)

	let progressLabel = $derived(
		genPhase === "synthesizing"
			? "Synthesizing…"
			: genBatch > 0
				? `Drafting part ${genBatch} of ${genTotalBatches}…`
				: "Starting…"
	)

	/** A save is on its way; the modal stays until the server has it. */
	let saving = $state(false)
	let saveError = $state("")

	let canSave = $derived(editableContent.trim().length > 0 && !saving)

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
		socket.emit("scenes:compile", {
			historyEntryId: historyEntry.id
		} satisfies Sockets.Scenes.Compile.Params)
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

	/**
	 * The compile this modal is watching, SCOPED to its history entry — both
	 * payloads carry `historyEntryId` (see `SCOPED_EVENTS`), so a second modal
	 * open on another entry is not sent this one's ticks.
	 *
	 * An effect rather than `useInterest` because the key moves: `historyEntry`
	 * is a prop, and `useInterest` keeps the key it was first given. Declared
	 * above `onMount` so the interest exists before `startCompile()` emits
	 * (effects run in creation order, and `onMount` is one of them).
	 *
	 * ⚠ `handleProgress` has no id check of its own — the scope IS its filter,
	 * which is why `scenes:compile:progress` has to carry `historyEntryId`.
	 */
	$effect(() => {
		const id = historyEntry.id
		const releases = [
			declareInterest<"scenes:compile:progress">(
				interestKey("scenes:compile:progress", id),
				handleProgress
			),
			declareInterest<"scenes:compile:complete">(
				interestKey("scenes:compile:complete", id),
				handleComplete
			)
		]
		return () => {
			for (const release of releases) release()
		}
	})

	/**
	 * BARE: the refusal carries no id to scope on, so `scenes:compile:error`
	 * has no entry in `SCOPED_EVENTS` and a `#<id>` key would match no payload
	 * at all. Errors are never gated either (plan ruling 2) — the registry is
	 * simply the only listener path now.
	 */
	useInterest<"scenes:compile:error">("scenes:compile:error", handleError)

	onMount(() => {
		if (step === "running" && !internalActivityId) {
			startCompile()
		}
	})

	/**
	 * The entry editor's rule, for the compile (ruled 2026-09-28).
	 *
	 * ⚠ Only what the compile CHANGED is written — never the row spread whole.
	 * `historyEntry` is the row as it READS (amendments resolved in), so
	 * spreading it into an update baked every amendment into the base. At a
	 * moment the change is filed as an amendment dated then, on the line being
	 * read; at now it patches the entry.
	 *
	 * ⚠ Nothing is claimed until the server answers: the toast, the activity's
	 * dismissal and the close all wait, so a refusal leaves the compiled text
	 * here to retry.
	 */
	async function save() {
		if (saving) return
		const content = editableContent.trim()
		const fields = changedFields(
			{ content, isCompleted: true },
			{
				content: historyEntry.content ?? "",
				isCompleted: !!historyEntry.isCompleted
			}
		)
		saving = true
		saveError = ""
		try {
			if (!Object.keys(fields).length) {
				// Already says this: nothing to write, the review is done.
			} else if (moment) {
				await fileEntryAmendments(
					socket,
					{
						lorebookId: historyEntry.lorebookId,
						entryId: historyEntry.id,
						branchId
					},
					[{ ...moment, fields }],
					knownAmendmentIds
				)
			} else {
				await awaitReply({
					socket,
					event: "entries:update",
					params: {
						entry: {
							...fields,
							id: historyEntry.id,
							typeId: HISTORY_TYPE_ID
						} as any
					},
					replyKey: interestKey(
						"entries:update",
						historyEntry.lorebookId
					),
					errorEvent: "entries:update:error",
					fallbackError: "The history entry could not be saved.",
					match: (data) => data.entry?.id === historyEntry.id
				})
			}
		} catch (err) {
			saving = false
			saveError =
				err instanceof Error && err.message
					? isReplyTimeout(err)
						? "The server did not answer in time. The compiled text is still here."
						: err.message
					: "The history entry could not be saved."
			return
		}
		saving = false
		if (internalActivityId)
			socket.emit("activity:dismiss", {
				id: internalActivityId,
				how: "acted"
			})
		toaster.success({
			title: moment
				? `History amended as of ${formatDate(moment)}`
				: "History entry updated"
		})
		onSaved?.({ ...historyEntry, content, isCompleted: true })
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
			if (internalActivityId)
				socket.emit("activity:dismiss", { id: internalActivityId })
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
			Waiting for synthesis…
		</div>
	{/if}
{/snippet}

{#snippet reviewBlock()}
	<div class="space-y-4">
		{#if hasExistingContent && hasDiff}
			<div class="space-y-1">
				<p
					class="text-surface-600-400 text-xs font-semibold"
				>
					Changes
				</p>
				<div
					class="bg-surface-200-800 rounded-lg p-3 text-sm leading-relaxed whitespace-pre-wrap"
				>
					{#each diffParts as part}
						{#if part.removed}
							<span
								class="text-error-500 line-through opacity-70"
							>
								{part.value}
							</span>
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
		{#if moment}
			<p class="text-surface-700-300 text-xs">
				Saved as an amendment dated {formatDate(moment)}: the entry
				reads this way from then on, and as it was before.
			</p>
		{/if}
		{#if saveError}
			<p class="text-error-700-300 text-sm" role="alert">{saveError}</p>
		{/if}
	</div>
{/snippet}

<AiTaskModal
	{open}
	{onOpenChange}
	title="Compile to Entry"
	runningTitle="Compiling scenes…"
	reviewTitle="Review compiled entry"
	badge="History entry"
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
