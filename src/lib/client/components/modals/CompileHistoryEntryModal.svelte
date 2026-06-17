<script lang="ts">
	import { Modal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import * as skio from "sveltekit-io"
	import { onDestroy, onMount } from "svelte"
	import { diffWords } from "diff"
	import { toaster } from "$lib/client/utils/toaster"

	interface Props {
		open: boolean
		onOpenChange: (e: { open: boolean }) => void
		historyEntry: SelectHistoryEntry
		onSaved: (updated: SelectHistoryEntry) => void
	}

	let { open, onOpenChange, historyEntry, onSaved }: Props = $props()

	const socket = skio.get()!

	type Step = "compiling" | "review"
	let step = $state<Step>("compiling")

	// Compiling step
	let progressPercent = $state(0)
	let partialContent = $state<string | undefined>(undefined)

	// Review step
	let compiledContent = $state("")
	let editableContent = $state("")
	let isSaving = $state(false)
	let showRaw = $state(false)
	let rawOutput = $state("")

	let hasExistingContent = $derived(historyEntry.content?.trim().length > 0)

	// Word-level diff between old and new
	let diffParts = $derived.by(() => {
		if (!hasExistingContent || step !== "review") return []
		return diffWords(historyEntry.content ?? "", editableContent)
	})

	let hasDiff = $derived(
		diffParts.some((p) => p.added || p.removed)
	)

	// Reset when opened
	$effect(() => {
		if (open) {
			step = "compiling"
			progressPercent = 0
			partialContent = undefined
			compiledContent = ""
			editableContent = ""
			rawOutput = ""
			showRaw = false
			isSaving = false
			// Kick off compile immediately
			socket.emit("scenes:compile", { historyEntryId: historyEntry.id } satisfies Sockets.Scenes.Compile.Params)
		}
	})

	function handleProgress(data: Sockets.Scenes.Compile.Progress) {
		progressPercent = 50 // synthesis is a single pass — show 50% until done
		partialContent = data.partial.content
	}

	function handleComplete(data: Sockets.Scenes.Compile.Response) {
		if (data.historyEntryId !== historyEntry.id) return
		compiledContent = data.content
		editableContent = data.content
		rawOutput = data.content
		progressPercent = 100
		step = "review"
	}

	function handleError(data: Sockets.Scenes.Compile.ErrorResponse) {
		toaster.error({ title: "Compile failed", description: data.error })
		onOpenChange({ open: false })
	}

	onMount(() => {
		socket.on("scenes:compile:progress", handleProgress)
		socket.on("scenes:compile:complete", handleComplete)
		socket.on("scenes:compile:error", handleError)
	})

	onDestroy(() => {
		socket.off("scenes:compile:progress")
		socket.off("scenes:compile:complete")
		socket.off("scenes:compile:error")
	})

	function save() {
		isSaving = true
		const updated: UpdateHistoryEntry = {
			...historyEntry,
			content: editableContent.trim(),
			isCompleted: true
		}
		socket.emit("historyEntries:update", { historyEntry: updated })
		toaster.success({ title: "History entry updated" })
		onSaved({ ...historyEntry, content: editableContent.trim(), isCompleted: true })
		isSaving = false
		onOpenChange({ open: false })
	}
</script>

<Modal
	{open}
	{onOpenChange}
	contentBase="card bg-surface-100-900 p-6 shadow-xl w-[min(95vw,640px)] max-h-[90vh] overflow-y-auto"
	backdropClasses="backdrop-blur-sm"
>
	{#snippet content()}
		<!-- ── COMPILING ───────────────────────────────────────────── -->
		{#if step === "compiling"}
			<header class="mb-4">
				<h2 class="h3">Compiling Scenes…</h2>
				<p class="text-surface-500 mt-1 text-sm">
					Synthesizing scene summaries into a history entry.
				</p>
			</header>

			<div class="space-y-4">
				<div class="space-y-2">
					<div class="flex items-center justify-between text-sm">
						<span class="text-surface-500">Synthesizing…</span>
						<span class="font-mono">{progressPercent}%</span>
					</div>
					<div class="bg-surface-300-700 h-2 w-full overflow-hidden rounded-full">
						<div
							class="bg-primary-500 h-full rounded-full transition-all duration-500"
							style="width: {progressPercent}%"
						></div>
					</div>
				</div>

				{#if partialContent}
					<div class="space-y-1">
						<p class="text-surface-500 text-xs font-semibold uppercase tracking-wide">
							Preview
						</p>
						<div class="bg-surface-200-800 rounded-lg p-3 text-sm">
							<p class="text-surface-700-300 line-clamp-6 whitespace-pre-wrap">
								{partialContent}
							</p>
						</div>
					</div>
				{:else}
					<div class="text-surface-500 py-6 text-center text-sm">
						<div class="bg-primary-500 mx-auto mb-2 h-2 w-2 animate-pulse rounded-full"></div>
						Waiting for synthesis…
					</div>
				{/if}
			</div>

			<footer class="mt-6 flex justify-end">
				<button
					class="btn preset-filled-error-500"
					onclick={() => onOpenChange({ open: false })}
				>
					<Icons.X size={16} />
					Cancel
				</button>
			</footer>

		<!-- ── REVIEW ─────────────────────────────────────────────── -->
		{:else if step === "review"}
			<header class="mb-4 flex items-center justify-between">
				<div>
					<h2 class="h3">Review & Save</h2>
					<p class="text-surface-500 mt-1 text-sm">
						{historyEntry.year}{historyEntry.month ? `, Month ${historyEntry.month}` : ""}{historyEntry.day ? `, Day ${historyEntry.day}` : ""}
					</p>
				</div>
				{#if hasExistingContent && hasDiff}
					<span class="badge preset-tonal-warning text-xs">Content changed</span>
				{:else if hasExistingContent && !hasDiff}
					<span class="badge preset-tonal-success text-xs">No changes</span>
				{/if}
			</header>

			<div class="space-y-4">
				<!-- Diff view (only when existing content differs) -->
				{#if hasExistingContent && hasDiff}
					<div class="space-y-1">
						<p class="text-surface-500 text-xs font-semibold uppercase tracking-wide">
							Changes
						</p>
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

				<!-- Editable result -->
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

				<!-- Raw toggle -->
				{#if compiledContent !== rawOutput}
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
						<pre class="bg-surface-200-800 overflow-x-auto rounded p-3 text-xs whitespace-pre-wrap">{rawOutput}</pre>
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
				<div class="ml-auto">
					<button
						class="btn preset-filled-primary-500"
						disabled={!editableContent.trim() || isSaving}
						onclick={save}
					>
						<Icons.Save size={16} />
						Save to History Entry
					</button>
				</div>
			</footer>
		{/if}
	{/snippet}
</Modal>
