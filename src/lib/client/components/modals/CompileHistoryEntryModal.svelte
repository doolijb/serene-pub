<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { getContext, onMount, untrack } from "svelte"
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
	import { compileSaveOf } from "$lib/client/lorebooks/editor/compileSave"
	import { sameLineAndMoment } from "$lib/shared/lorebooks/loreRoute"
	import {
		formatDate,
		type StoryDate
	} from "$lib/client/lorebooks/sections/historyDates"
	import AiTaskModal, { type AiTaskStep } from "./AiTaskModal.svelte"
	import LoreWritesOffNotice from "$lib/client/lorebooks/LoreWritesOffNotice.svelte"
	import { useLoreWritesOff } from "$lib/client/lorebooks/loreWritesOff.svelte"
	import { LORE_WRITES_OFF_NOTICE } from "$lib/shared/lorebooks/loreWriteMode"
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
		 * The date being read, when one is. A resumed compile is handed the
		 * moment its activity was asked at. Read ONCE, when the modal opens:
		 * the compile, its retry and its save all stay at that reading, even
		 * if the workspace's route moves while the dialog is open.
		 */
		moment?: StoryDate | null
		/**
		 * The line being read, `null` for main: the compile reads its scenes
		 * and the save lands on it (`compileSaveOf`). A resumed compile is
		 * handed its activity's. Read once, like `moment`.
		 */
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

	/** The reading this modal compiles and saves at, fixed when it opens. */
	const reading = untrack(() => ({ branchId, moment }))
	/** Where Save writes: the entry, or an amendment on the line (and when). */
	let saveAt = $derived(compileSaveOf(historyEntry, reading))

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

	// Lorebook writes from sessions Off (plan A22): a compile folds what
	// sessions played into the book, so it says so before any work and
	// neither compiles nor saves.
	const loreWrites = useLoreWritesOff()
	let canSave = $derived(
		!loreWrites.off && editableContent.trim().length > 0 && !saving
	)

	$effect(() => {
		if (!pendingResult) return
		editableContent = pendingResult.content
	})

	/**
	 * The run, as the Activity panel knows it — so a reconnect that drops the
	 * `:complete` (or `:error`) frame cannot leave this window spinning
	 * forever (plan B8). While the window runs it follows the run in the
	 * activity store (refreshed on every `activity:update` and on reconnect):
	 * the one named, else this entry's compile on this reading that is
	 * running, or that was not there (finished) when the run started.
	 */
	const compileEntriesCtx: CompileEntriesCtx | undefined =
		getContext("compileEntriesCtx")
	const finishedRunsOf = () =>
		new Set(
			(compileEntriesCtx?.activities ?? [])
				.filter(
					(a) =>
						a.historyEntryId === historyEntry.id &&
						a.status !== "running"
				)
				.map((a) => a.activityId)
		)
	let runActivityId = $state<string | null>(
		untrack(() => (step === "running" ? activityId : null))
	)
	let finishedBeforeRun = untrack(() =>
		runActivityId ? new Set<string>() : finishedRunsOf()
	)

	$effect(() => {
		if (step !== "running") return
		const list = compileEntriesCtx?.activities ?? []
		const named = runActivityId
		const entryId = historyEntry.id
		const run = named
			? list.find((a) => a.activityId === named)
			: list.find(
					(a) =>
						a.historyEntryId === entryId &&
						sameLineAndMoment(a, reading) &&
						(a.status === "running" ||
							!finishedBeforeRun.has(a.activityId))
				)
		if (!run) return
		const status = run.status
		const result = run.pendingResult
		const failure = run.errorMessage
		untrack(() => {
			runActivityId = run.activityId
			if (status === "review" && result) {
				internalActivityId = run.activityId
				editableContent = result.content
				step = "review"
			} else if (status === "error") {
				errorMessage = failure || "The entry was not compiled."
				step = "error"
			}
		})
	})

	function startCompile() {
		finishedBeforeRun = finishedRunsOf()
		runActivityId = null
		if (loreWrites.off) {
			errorMessage = LORE_WRITES_OFF_NOTICE
			step = "error"
			return
		}
		step = "running"
		genPhase = "drafting"
		genBatch = 0
		genTotalBatches = 1
		genPartial = {}
		errorMessage = ""
		// The reading it is asked from: its line decides the scenes, and the
		// activity keeps both so a review reopened later saves right here.
		socket.emit("scenes:compile", {
			historyEntryId: historyEntry.id,
			branchId: reading.branchId,
			moment: reading.moment
		} satisfies Sockets.Scenes.Compile.Params)
	}

	function handleProgress(data: Sockets.Scenes.Compile.Progress) {
		// One entry compiled on two lines is two runs; only ours is shown.
		if (!sameLineAndMoment(data, reading)) return
		genPhase = data.phase
		genBatch = data.batch
		genTotalBatches = data.totalBatches
		genPartial = data.partial
	}

	function handleComplete(data: Sockets.Scenes.Compile.Response) {
		if (data.historyEntryId !== historyEntry.id) return
		if (!sameLineAndMoment(data, reading)) return
		internalActivityId = data.activityId
		editableContent = data.content
		step = "review"
	}

	/**
	 * A refusal is this window's only while it is running, and only when it
	 * is about this entry: the refusal goes to the asking tab alone, but a
	 * lorebook docked beside a session page can hold two Compile windows, and
	 * one's failure must not flip the other (or a review) to the error step
	 * (plan B8). A refusal naming no entry is the run's own early refusal.
	 */
	function handleError(data: Sockets.Scenes.Compile.ErrorResponse) {
		if (step !== "running") return
		if (
			typeof data.historyEntryId === "number" &&
			data.historyEntryId !== historyEntry.id
		)
			return
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
	 * BARE: an `:error` is never gated or scoped (plan ruling 2) — the
	 * registry is simply the only listener path. The refusal names its entry
	 * (`historyEntryId`), which `handleError` filters on.
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
	 * spreading it into an update baked every amendment into the base. Where
	 * it goes is `compileSaveOf`: an amendment on the line — dated at the
	 * moment, or at the entry's own date when the line reads the entry from
	 * another line — else a patch of the entry itself.
	 *
	 * ⚠ Nothing is claimed until the server answers: the toast, the activity's
	 * dismissal and the close all wait, so a refusal leaves the compiled text
	 * here to retry.
	 */
	async function save() {
		if (saving || loreWrites.off) return
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
			} else if (saveAt.kind === "amendment") {
				await fileEntryAmendments(
					socket,
					{
						lorebookId: historyEntry.lorebookId,
						entryId: historyEntry.id,
						branchId: saveAt.branchId
					},
					[{ ...saveAt.date, fields }],
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
			title:
				saveAt.kind === "amendment"
					? `History amended as of ${formatDate(saveAt.date)}`
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
		{#if loreWrites.off}
			<!-- A review reopened after the setting moved: it cannot save. -->
			<LoreWritesOffNotice />
		{/if}
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
		{#if saveAt.kind === "amendment" && saveAt.atEntryDate}
			<p class="text-surface-700-300 text-xs">
				Saved as an amendment on this line only, dated {formatDate(
					saveAt.date
				)}, the entry's own date. The entry comes from the line this one
				branched from, and that line keeps it as it was.
			</p>
		{:else if saveAt.kind === "amendment"}
			<p class="text-surface-700-300 text-xs">
				Saved as an amendment dated {formatDate(saveAt.date)}: the entry
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
