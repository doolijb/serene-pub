<script lang="ts">
	import { Modal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import * as skio from "sveltekit-io"
	import { onDestroy, onMount } from "svelte"
	import { toaster } from "$lib/client/utils/toaster"

	function computeDefaultDate(
		entries: Sockets.HistoryEntries.List.Response["historyEntryList"]
	): { year: number; month: number; day: number } {
		const dated = entries.filter((e) => e.year !== null)
		if (dated.length === 0) return { year: 1, month: 1, day: 1 }

		// Sort descending by year → month → day to find the latest entry
		const latest = dated.sort((a, b) => {
			if ((a.year ?? 0) !== (b.year ?? 0)) return (b.year ?? 0) - (a.year ?? 0)
			if ((a.month ?? 0) !== (b.month ?? 0)) return (b.month ?? 0) - (a.month ?? 0)
			return (b.day ?? 0) - (a.day ?? 0)
		})[0]

		return {
			year: latest.year ?? 1,
			month: latest.month ?? 1,
			day: (latest.day ?? 0) + 1
		}
	}

	interface Props {
		open: boolean
		onOpenChange: (e: { open: boolean }) => void
		chatId: number
		lorebookId: number | null
		selectedMessageIds: number[]
		initialLoreType?: "world" | "history"
		onSaved: () => void
		onLorebookSet: (lorebookId: number) => void
	}

	let {
		open = $bindable(),
		onOpenChange,
		chatId,
		lorebookId = $bindable(),
		selectedMessageIds,
		initialLoreType = "world",
		onSaved,
		onLorebookSet
	}: Props = $props()

	const socket = skio.get()!

	// ── Step management ──────────────────────────────────────────
	type Step = "configure" | "generating" | "review"
	let step = $state<Step>("configure")

	// ── Configure step state ──────────────────────────────────────
	let loreType = $state<"world" | "history">(initialLoreType)
	let topic = $state("")

	// Lorebook attachment
	let availableLorebooks = $state<Sockets.Lorebooks.List.Response["lorebookList"]>([])
	let attachingLorebookId = $state<number | "">("")
	let isCreatingLorebook = $state(false)
	let newLorebookName = $state("")
	let historyEntryList = $state<Sockets.HistoryEntries.List.Response["historyEntryList"]>([])

	// ── Generating step state ─────────────────────────────────────
	let currentBatch = $state(0)
	let totalBatches = $state(1)
	let partialSummary = $state<{ content?: string; raw?: string }>({})

	// ── Review step state ─────────────────────────────────────────
	let reviewName = $state("")
	let reviewContent = $state("")
	let reviewYear = $state<number | null>(null)
	let reviewMonth = $state<number | null>(null)
	let reviewDay = $state<number | null>(null)
	let rawOutput = $state("")
	let showRaw = $state(false)
	let isSaving = $state(false)

	// ── Derived ───────────────────────────────────────────────────
	let progressPercent = $derived(
		totalBatches > 0 ? Math.round((currentBatch / totalBatches) * 100) : 0
	)
	let canGenerate = $derived(
		!!lorebookId && selectedMessageIds.length > 0
	)
	let canSave = $derived(
		loreType === "history"
			? reviewContent.trim().length > 0
			: reviewName.trim().length > 0 && reviewContent.trim().length > 0
	)
	let hasLorebook = $derived(!!lorebookId)

	// ── Reset on open ─────────────────────────────────────────────
	$effect(() => {
		if (open) {
			step = "configure"
			loreType = initialLoreType
			topic = ""
			attachingLorebookId = ""
			isCreatingLorebook = false
			newLorebookName = ""
			historyEntryList = []
			summarizePhase = "drafting"
			currentBatch = 0
			totalBatches = 1
			partialSummary = {}
			rawOutput = ""
			showRaw = false
			reviewName = ""
			reviewContent = ""
			reviewYear = null
			reviewMonth = null
			reviewDay = null
		}
	})

	// Fetch history entries whenever the lorebook is set while the modal is open
	$effect(() => {
		if (open && lorebookId) {
			socket.emit("historyEntries:list", { lorebookId })
		}
	})

	// ── Socket handlers ───────────────────────────────────────────
	let summarizePhase = $state<"drafting" | "synthesizing">("drafting")

	function handleProgress(data: Sockets.Chats.Summarize.Progress) {
		summarizePhase = data.phase
		currentBatch = data.batch
		totalBatches = data.totalBatches
		partialSummary = data.partial
	}

	function handleComplete(data: Sockets.Chats.Summarize.Response) {
		rawOutput = data.raw
		reviewName = data.name ?? ""
		reviewContent = data.content ?? data.raw ?? ""

		if (loreType === "history") {
			const defaultDate = computeDefaultDate(historyEntryList)
			reviewYear = defaultDate.year
			reviewMonth = defaultDate.month
			reviewDay = defaultDate.day
		}

		step = "review"
	}

	function handleError(data: Sockets.Chats.Summarize.ErrorResponse) {
		if (data.reason === "no_lorebook") {
			toaster.error({ title: "No lorebook attached", description: data.error })
			step = "configure"
		} else {
			toaster.error({ title: "Summarization failed", description: data.error })
			step = "configure"
		}
	}

	function handleLorebooksList(data: Sockets.Lorebooks.List.Response) {
		availableLorebooks = data.lorebookList
	}

	function handleSetLorebook(data: Sockets.Chats.SetLorebook.Response) {
		lorebookId = data.chat.lorebookId
		if (data.chat.lorebookId) {
			onLorebookSet(data.chat.lorebookId)
			toaster.success({ title: "Lorebook attached" })
		}
	}

	function handleLorebookCreate(data: any) {
		if (data.lorebook) {
			availableLorebooks = [...availableLorebooks, data.lorebook]
			attachLorebookToChat(data.lorebook.id)
		}
	}

	function handleHistoryEntriesList(data: Sockets.HistoryEntries.List.Response) {
		historyEntryList = data.historyEntryList
	}

	onMount(() => {
		socket.on("chats:summarize:progress", handleProgress)
		socket.on("chats:summarize:complete", handleComplete)
		socket.on("chats:summarize:error", handleError)
		socket.on("lorebooks:list", handleLorebooksList)
		socket.on("chats:setLorebook", handleSetLorebook)
		socket.on("lorebooks:create", handleLorebookCreate)
		socket.on("historyEntries:list", handleHistoryEntriesList)
		socket.emit("lorebooks:list", {})
	})

	onDestroy(() => {
		socket.off("chats:summarize:progress")
		socket.off("chats:summarize:complete")
		socket.off("chats:summarize:error")
		socket.off("lorebooks:list")
		socket.off("chats:setLorebook")
		socket.off("lorebooks:create")
		socket.off("historyEntries:list")
	})

	// ── Actions ───────────────────────────────────────────────────
	function attachLorebookToChat(id: number) {
		socket.emit("chats:setLorebook", { chatId, lorebookId: id })
		attachingLorebookId = ""
	}

	function confirmAttachExisting() {
		if (!attachingLorebookId) return
		attachLorebookToChat(Number(attachingLorebookId))
	}

	function createAndAttachLorebook() {
		if (!newLorebookName.trim()) return
		socket.emit("lorebooks:create", {
			lorebook: { name: newLorebookName.trim() }
		})
		newLorebookName = ""
		isCreatingLorebook = false
	}

	function generate() {
		step = "generating"
		currentBatch = 0
		totalBatches = 1
		partialSummary = {}

		socket.emit("chats:summarize", {
			chatId,
			messageIds: selectedMessageIds,
			loreType,
			topic: topic.trim() || undefined
		} satisfies Sockets.Chats.Summarize.Params)
	}

	function saveEntry() {
		if (!canSave || !lorebookId) return
		isSaving = true

		if (loreType === "world") {
			socket.emit("worldLoreEntries:create", {
				worldLoreEntry: {
					lorebookId,
					name: reviewName.trim(),
					content: reviewContent.trim(),
					keys: "",
					enabled: true,
					constant: false,
					useRegex: false,
					caseSensitive: false,
					priority: 1
				}
			})
		} else {
			socket.emit("historyEntries:create", {
				historyEntry: {
					lorebookId,
					year: reviewYear ?? 1,
					month: reviewMonth || null,
					day: reviewDay || null,
					content: reviewContent.trim(),
					keys: "",
					enabled: true,
					constant: false,
					useRegex: false,
					caseSensitive: false
				}
			})
		}

		toaster.success({
			title: loreType === "world" ? "World lore entry saved" : "History entry saved"
		})
		isSaving = false
		onSaved()
		onOpenChange({ open: false })
	}

	function goBack() {
		step = "configure"
	}
</script>

<Modal
	{open}
	{onOpenChange}
	contentBase="card bg-surface-100-900 p-6 shadow-xl w-[min(95vw,560px)] max-h-[90vh] overflow-y-auto"
	backdropClasses="backdrop-blur-sm"
>
	{#snippet content()}
		<!-- ── STEP 1: Configure ─────────────────────────────── -->
		{#if step === "configure"}
			<header class="mb-4 flex items-center justify-between">
				<h2 id="summarize-modal-title" class="h3">
					Summarize to Lorebook
				</h2>
				<Icons.BookOpen size={24} class="text-primary-500" />
			</header>

			<div class="space-y-5">
				<!-- Lorebook status -->
				<div class="rounded-lg border border-surface-300-700 p-3">
					{#if hasLorebook}
						{@const book = availableLorebooks.find(l => l.id === lorebookId)}
						<div class="flex items-center gap-2 text-sm">
							<Icons.BookMarked size={16} class="text-success-500 shrink-0" />
							<span class="text-surface-600-400">Saving to:</span>
							<span class="font-semibold">{book?.name ?? `Lorebook #${lorebookId}`}</span>
						</div>
					{:else}
						<div class="space-y-3">
							<div class="flex items-start gap-2 text-sm">
								<Icons.TriangleAlert size={16} class="text-warning-500 mt-0.5 shrink-0" />
								<span>No lorebook is attached to this chat. Attach one to continue.</span>
							</div>
							{#if !isCreatingLorebook}
								<div class="flex flex-wrap gap-2">
									<select
										class="select flex-1 text-sm"
										bind:value={attachingLorebookId}
									>
										<option value="">Select existing lorebook…</option>
										{#each availableLorebooks as lb}
											<option value={lb.id}>{lb.name}</option>
										{/each}
									</select>
									<button
										class="btn btn-sm preset-filled-primary-500"
										disabled={!attachingLorebookId}
										onclick={confirmAttachExisting}
									>
										Attach
									</button>
									<button
										class="btn btn-sm preset-tonal-surface"
										onclick={() => (isCreatingLorebook = true)}
									>
										<Icons.Plus size={14} />
										New
									</button>
								</div>
							{:else}
								<div class="flex gap-2">
									<input
										class="input flex-1 text-sm"
										type="text"
										placeholder="New lorebook name…"
										bind:value={newLorebookName}
										onkeydown={(e) => e.key === "Enter" && createAndAttachLorebook()}
									/>
									<button
										class="btn btn-sm preset-filled-primary-500"
										disabled={!newLorebookName.trim()}
										onclick={createAndAttachLorebook}
									>
										Create & Attach
									</button>
									<button
										class="btn btn-sm preset-tonal-surface"
										onclick={() => (isCreatingLorebook = false)}
									>
										<Icons.X size={14} />
									</button>
								</div>
							{/if}
						</div>
					{/if}
				</div>

				<!-- Entry type -->
				<fieldset class="space-y-2">
					<legend class="label text-sm font-semibold">Entry type</legend>
					<div class="flex gap-4">
						<label class="flex cursor-pointer items-center gap-2">
							<input
								type="radio"
								class="radio"
								name="loreType"
								value="world"
								bind:group={loreType}
							/>
							<Icons.Globe size={16} />
							<span class="text-sm">World Lore</span>
						</label>
						<label class="flex cursor-pointer items-center gap-2">
							<input
								type="radio"
								class="radio"
								name="loreType"
								value="history"
								bind:group={loreType}
							/>
							<Icons.Scroll size={16} />
							<span class="text-sm">History Entry</span>
						</label>
					</div>
				</fieldset>

				<!-- Topic (world lore only) -->
				{#if loreType === "world"}
					<div class="space-y-1">
						<label class="label text-sm font-semibold" for="summarize-topic">
							Focus topic
							<span class="text-surface-400 font-normal">(optional)</span>
						</label>
						<input
							id="summarize-topic"
							class="input text-sm"
							type="text"
							placeholder='e.g. "the guards in the Labyrinth of Descia"'
							bind:value={topic}
						/>
						{#if topic.trim()}
							<p class="text-surface-500 text-xs">
								Prompt will include: <em>"Specifically focus on: "{topic.trim()}""</em>
							</p>
						{/if}
					</div>
				{/if}

				<!-- Message count -->
				<p class="text-surface-500 text-sm">
					<Icons.MessageSquare size={14} class="mr-1 inline" />
					Summarizing
					<strong>{selectedMessageIds.length}</strong>
					{selectedMessageIds.length === 1 ? "message" : "messages"}
				</p>
			</div>

			<footer class="mt-6 flex justify-end gap-3">
				<button
					class="btn preset-filled-surface-500"
					onclick={() => onOpenChange({ open: false })}
				>
					Cancel
				</button>
				<button
					class="btn preset-filled-primary-500"
					disabled={!canGenerate}
					onclick={generate}
					title={!hasLorebook ? "Attach a lorebook first" : !selectedMessageIds.length ? "Select at least one message" : ""}
				>
					<Icons.Sparkles size={16} />
					Generate Summary
				</button>
			</footer>

		<!-- ── STEP 2: Generating ────────────────────────────── -->
		{:else if step === "generating"}
			<header class="mb-4">
				<h2 id="summarize-modal-title" class="h3">Generating Summary…</h2>
			</header>

			<div class="space-y-4">
				<!-- Progress -->
				<div class="space-y-2">
					<div class="flex items-center justify-between text-sm">
						<span class="text-surface-500">
							{#if summarizePhase === "synthesizing"}
								Synthesizing final entry…
							{:else if currentBatch > 0}
								Drafting part {currentBatch} of {totalBatches}…
							{:else}
								Starting…
							{/if}
						</span>
						<span class="font-mono text-sm">{progressPercent}%</span>
					</div>
					<div class="bg-surface-300-700 h-2 w-full overflow-hidden rounded-full">
						<div
							class="bg-primary-500 h-full rounded-full transition-all duration-300"
							style="width: {progressPercent}%"
						></div>
					</div>
				</div>

				<!-- Live draft preview -->
				{#if partialSummary.content || partialSummary.raw}
					<div class="space-y-1">
						<p class="text-surface-500 text-xs font-semibold uppercase tracking-wide">
							{summarizePhase === "synthesizing" ? "Final entry" : `Draft ${currentBatch}`}
						</p>
						<div class="bg-surface-200-800 rounded-lg p-3 text-sm">
							{#if partialSummary.content}
								<p class="text-surface-700-300 line-clamp-6 whitespace-pre-wrap">
									{partialSummary.content}
								</p>
							{:else if partialSummary.raw}
								<p class="text-surface-500 line-clamp-6 whitespace-pre-wrap text-xs italic">
									{partialSummary.raw}
								</p>
							{/if}
						</div>
					</div>
				{:else if summarizePhase === "synthesizing"}
					<div class="text-surface-500 py-4 text-center text-sm">
						<div class="bg-primary-500 mx-auto mb-2 h-2 w-2 animate-pulse rounded-full"></div>
						Synthesizing final entry…
					</div>
				{:else}
					<div class="text-surface-500 py-4 text-center text-sm">
						<div class="bg-primary-500 mx-auto mb-2 h-2 w-2 animate-pulse rounded-full"></div>
						Waiting for first draft…
					</div>
				{/if}
			</div>

			<footer class="mt-6 flex justify-end">
				<button
					class="btn preset-filled-error-500"
					onclick={() => {
						step = "configure"
					}}
				>
					<Icons.X size={16} />
					Cancel
				</button>
			</footer>

		<!-- ── STEP 3: Review & Edit ─────────────────────────── -->
		{:else if step === "review"}
			<header class="mb-4 flex items-center justify-between">
				<h2 id="summarize-modal-title" class="h3">Review & Save</h2>
				<span class="badge preset-tonal-primary text-xs capitalize">
					{loreType === "world" ? "World Lore" : "History Entry"}
				</span>
			</header>

			<div class="space-y-4">
				<!-- Name (world lore only — history entries are identified by date) -->
				{#if loreType === "world"}
					<div class="space-y-1">
						<label class="label text-sm font-semibold" for="review-name">
							Name <span class="text-error-500">*</span>
						</label>
						<input
							id="review-name"
							class="input text-sm"
							type="text"
							placeholder="Entry name…"
							bind:value={reviewName}
						/>
						{#if reviewName}
							<p class="text-surface-500 text-xs">Auto-generated — edit if needed.</p>
						{/if}
					</div>
				{/if}

				<!-- Date (history only) -->
				{#if loreType === "history"}
					<div class="space-y-1">
						<p class="label text-sm font-semibold">
							In-world date
							<span class="text-surface-400 font-normal">(optional)</span>
						</p>
						<div class="flex gap-2">
							<label class="flex flex-1 flex-col gap-1">
								<span class="text-surface-500 text-xs">Year</span>
								<input
									class="input text-sm"
									type="number"
									placeholder="e.g. 412"
									bind:value={reviewYear}
								/>
							</label>
							<label class="flex flex-1 flex-col gap-1">
								<span class="text-surface-500 text-xs">Month</span>
								<input
									class="input text-sm"
									type="number"
									min="1"
									max="12"
									placeholder="1–12"
									bind:value={reviewMonth}
								/>
							</label>
							<label class="flex flex-1 flex-col gap-1">
								<span class="text-surface-500 text-xs">Day</span>
								<input
									class="input text-sm"
									type="number"
									min="1"
									max="31"
									placeholder="1–31"
									bind:value={reviewDay}
								/>
							</label>
						</div>
					</div>
				{/if}

				<!-- Content -->
				<div class="space-y-1">
					<label class="label text-sm font-semibold" for="review-content">
						Content <span class="text-error-500">*</span>
					</label>
					<textarea
						id="review-content"
						class="textarea min-h-32 text-sm"
						placeholder="Entry content…"
						bind:value={reviewContent}
					></textarea>
				</div>

				<!-- Raw output toggle -->
				<div>
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
						<pre class="bg-surface-200-800 mt-2 overflow-x-auto rounded p-3 text-xs whitespace-pre-wrap">{rawOutput}</pre>
					{/if}
				</div>
			</div>

			<footer class="mt-6 flex flex-wrap gap-3">
				<button class="btn preset-tonal-surface" onclick={goBack}>
					<Icons.ChevronLeft size={16} />
					Back
				</button>
				<button class="btn preset-tonal-surface" onclick={generate}>
					<Icons.RefreshCw size={16} />
					Re-generate
				</button>
				<div class="ml-auto">
					<button
						class="btn preset-filled-primary-500"
						disabled={!canSave || isSaving}
						onclick={saveEntry}
					>
						<Icons.Save size={16} />
						Save to Lorebook
					</button>
				</div>
			</footer>
		{/if}
	{/snippet}
</Modal>
