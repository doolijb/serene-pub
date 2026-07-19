<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import * as skio from "sveltekit-io"
	import { onDestroy, onMount } from "svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import AiTaskModal, { type AiTaskStep } from "./AiTaskModal.svelte"

	function computeDefaultDate(
		entries: Sockets.HistoryEntries.List.Response["historyEntryList"]
	): { year: number; month: number; day: number } {
		const dated = entries.filter((e) => e.year !== null)
		if (dated.length === 0) return { year: 1, month: 1, day: 1 }

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

	interface BindableEntity {
		type: "character" | "persona"
		id: number
		name: string
	}

	interface Props {
		open: boolean
		onOpenChange: (e: { open: boolean }) => void
		chatId: number
		lorebookId: number | null
		selectedMessageIds: number[]
		initialLoreType?: "world" | "character" | "scene"
		onSaved: () => void
		onLorebookSet: (lorebookId: number) => void
		chatCharacters?: BindableEntity[]
		chatPersonas?: BindableEntity[]
		hasSceneMessageGap?: boolean
	}

	let {
		open = $bindable(),
		onOpenChange,
		chatId,
		lorebookId = $bindable(),
		selectedMessageIds,
		initialLoreType = "world",
		onSaved,
		onLorebookSet,
		chatCharacters = [],
		chatPersonas = [],
		hasSceneMessageGap = false
	}: Props = $props()

	const socket = skio.get()!

	// ── Internal step (mapped to AiTaskStep for the shell) ───────────
	type InternalStep = "configure" | "generating" | "review" | "error"
	let step = $state<InternalStep>("configure")

	let aiStep = $derived<AiTaskStep>(
		step === "configure" ? "confirm"
		: step === "generating" ? "running"
		: step
	)

	// ── Configure step state ─────────────────────────────────────────
	let loreType = $state<"world" | "character" | "scene">(initialLoreType)
	let topic = $state("")

	let availableLorebooks = $state<Sockets.Lorebooks.List.Response["lorebookList"]>([])
	let attachingLorebookId = $state<number | "">("")
	let isCreatingLorebook = $state(false)
	let newLorebookName = $state("")
	let historyEntryList = $state<Sockets.HistoryEntries.List.Response["historyEntryList"]>([])

	let selectedHistoryEntryId = $state<number | "">("")
	let isCreatingHistoryEntry = $state(false)

	let lorebookBindings = $state<SelectLorebookBinding[]>([])
	let bindableEntities = $derived.by<BindableEntity[]>(() => {
		const seen = new Set<string>()
		const result: BindableEntity[] = []
		const add = (e: BindableEntity) => {
			const key = `${e.type}:${e.id}`
			if (!seen.has(key)) { seen.add(key); result.push(e) }
		}
		for (const cc of chatCharacters) add(cc)
		for (const cp of chatPersonas) add(cp)
		for (const b of lorebookBindings) {
			if (b.characterId && (b as any).character) add({ type: "character", id: b.characterId, name: (b as any).character.nickname || (b as any).character.name })
			if (b.personaId && (b as any).persona) add({ type: "persona", id: b.personaId, name: (b as any).persona.name })
		}
		return result
	})
	let selectedBinding = $state("")
	let resolvedBindingId = $state<number | null>(null)

	// ── Generating step state ────────────────────────────────────────
	let summarizePhase = $state<"drafting" | "synthesizing">("drafting")
	let currentBatch = $state(0)
	let totalBatches = $state(1)
	let partialSummary = $state<{ content?: string; raw?: string }>({})
	let trace = $state<Sockets.Chats.Summarize.TraceEntry[]>([])
	let showTrace = $state(false)
	let expandedTraceIdx = $state<number | null>(null)

	// ── Review step state ────────────────────────────────────────────
	let reviewName = $state("")
	let reviewContent = $state("")
	let rawOutput = $state("")
	let showRaw = $state(false)
	let isSaving = $state(false)
	let extractedParticipantCharacters = $state<string[]>([])
	let extractedMentionedCharacters = $state<string[]>([])
	let newParticipantInput = $state("")
	let newMentionedInput = $state("")

	// ── Error step state ─────────────────────────────────────────────
	let errorMessage = $state("")

	// ── Derived ─────────────────────────────────────────────────────
	let progressPercent = $derived(
		summarizePhase === "synthesizing" ? 90
		: totalBatches > 1 ? Math.max(5, Math.round((currentBatch / totalBatches) * 80))
		: currentBatch > 0 ? 60 : 5
	)

	let progressLabel = $derived(
		summarizePhase === "synthesizing" ? "Synthesizing final entry…"
		: currentBatch > 0 ? `Drafting part ${currentBatch} of ${totalBatches}…`
		: "Starting…"
	)

	let canGenerate = $derived(
		!!lorebookId &&
		selectedMessageIds.length > 0 &&
		(loreType !== "character" || topic.trim().length > 0) &&
		(loreType !== "scene" || !!selectedHistoryEntryId) &&
		(loreType !== "scene" || !hasSceneMessageGap)
	)
	let canSave = $derived(reviewName.trim().length > 0 && reviewContent.trim().length > 0)
	let hasLorebook = $derived(!!lorebookId)

	let badgeLabel = $derived(
		loreType === "world" ? "World Lore"
		: loreType === "character" ? "Character Lore"
		: "Scene"
	)

	// ── Reset on open ────────────────────────────────────────────────
	$effect(() => {
		if (open) {
			step = "configure"
			loreType = initialLoreType
			topic = ""
			selectedBinding = ""
			resolvedBindingId = null
			selectedHistoryEntryId = ""
			isCreatingHistoryEntry = false
			attachingLorebookId = ""
			isCreatingLorebook = false
			newLorebookName = ""
			historyEntryList = []
			lorebookBindings = []
			summarizePhase = "drafting"
			currentBatch = 0
			totalBatches = 1
			partialSummary = {}
			rawOutput = ""
			showRaw = false
			reviewName = ""
			reviewContent = ""
			extractedParticipantCharacters = []
			extractedMentionedCharacters = []
			newParticipantInput = ""
			newMentionedInput = ""
			trace = []
			showTrace = false
			expandedTraceIdx = null
			errorMessage = ""
		}
	})

	$effect(() => {
		if (open && lorebookId) {
			socket.emit("historyEntries:list", { lorebookId })
			socket.emit("lorebooks:bindingList", { lorebookId })
		}
	})

	// ── Socket handlers ──────────────────────────────────────────────
	function handleProgress(data: Sockets.Chats.Summarize.Progress) {
		summarizePhase = data.phase
		currentBatch = data.batch
		totalBatches = data.totalBatches
		partialSummary = data.partial
	}

	function handleTrace(entry: Sockets.Chats.Summarize.TraceEntry) {
		trace = [...trace, entry]
	}

	function handleComplete(data: Sockets.Chats.Summarize.Response) {
		if (step !== "generating") return
		rawOutput = data.raw
		reviewName = data.name ?? ""
		reviewContent = data.content ?? data.raw ?? ""
		resolvedBindingId = data.lorebookBindingId ?? null
		extractedParticipantCharacters = data.participantCharacters ?? []
		extractedMentionedCharacters = data.mentionedCharacters ?? []
		step = "review"
	}

	function handleError(data: Sockets.Chats.Summarize.ErrorResponse) {
		if (step !== "generating") return
		errorMessage = data.error
		step = "error"
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

	function handleHistoryEntryCreate(data: Sockets.HistoryEntries.Create.Response) {
		isCreatingHistoryEntry = false
		if (data.historyEntry && loreType === "scene") {
			selectedHistoryEntryId = data.historyEntry.id
		}
	}

	function handleLorebookBindingList(data: Sockets.Lorebooks.BindingList.Response) {
		if (data.lorebookId === lorebookId) {
			lorebookBindings = data.lorebookBindingList
		}
	}

	onMount(() => {
		socket.on("chats:summarize:progress", handleProgress)
		socket.on("chats:summarize:complete", handleComplete)
		socket.on("chats:summarize:error", handleError)
		socket.on("chats:summarize:trace", handleTrace)
		socket.on("lorebooks:list", handleLorebooksList)
		socket.on("chats:setLorebook", handleSetLorebook)
		socket.on("lorebooks:create", handleLorebookCreate)
		socket.on("historyEntries:list", handleHistoryEntriesList)
		socket.on("historyEntries:create", handleHistoryEntryCreate)
		socket.on("lorebooks:bindingList", handleLorebookBindingList)
		socket.emit("lorebooks:list", {})
	})

	onDestroy(() => {
		// skio.get()! returns Server | Socket union — .off() signatures are incompatible
		const s = socket as any
		s.off("chats:summarize:progress", handleProgress)
		s.off("chats:summarize:complete", handleComplete)
		s.off("chats:summarize:error", handleError)
		s.off("chats:summarize:trace", handleTrace)
		s.off("lorebooks:list", handleLorebooksList)
		s.off("chats:setLorebook", handleSetLorebook)
		s.off("lorebooks:create", handleLorebookCreate)
		s.off("historyEntries:list", handleHistoryEntriesList)
		s.off("historyEntries:create", handleHistoryEntryCreate)
		s.off("lorebooks:bindingList", handleLorebookBindingList)
	})

	// ── Actions ──────────────────────────────────────────────────────
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
		socket.emit("lorebooks:create", { name: newLorebookName.trim() })
		newLorebookName = ""
		isCreatingLorebook = false
	}

	function createBlankHistoryEntry() {
		if (!lorebookId) return
		const defaultDate = historyEntryList.length > 0
			? computeDefaultDate(historyEntryList)
			: { year: 1, month: 1, day: 1 }
		socket.emit("historyEntries:create", {
			historyEntry: {
				lorebookId,
				year: defaultDate.year,
				month: defaultDate.month,
				day: defaultDate.day,
				content: "",
				keys: "",
				enabled: true,
				constant: false,
				useRegex: false,
				caseSensitive: false
			}
		})
		isCreatingHistoryEntry = true
	}

	function generate() {
		step = "generating"
		summarizePhase = "drafting"
		currentBatch = 0
		totalBatches = 1
		partialSummary = {}
		resolvedBindingId = null
		trace = []
		showTrace = false
		expandedTraceIdx = null
		errorMessage = ""

		const [bindingType, bindingIdStr] = selectedBinding.split(":")
		socket.emit("chats:summarize", {
			chatId,
			messageIds: selectedMessageIds,
			loreType,
			topic: loreType === "scene" ? undefined : (topic.trim() || undefined),
			lorebookBindingCharacterId: bindingType === "character" ? Number(bindingIdStr) : undefined,
			lorebookBindingPersonaId: bindingType === "persona" ? Number(bindingIdStr) : undefined
		} satisfies Sockets.Chats.Summarize.Params)
	}

	function saveEntry() {
		if (!canSave || !lorebookId) return
		isSaving = true

		if (loreType === "scene") {
			socket.emit("scenes:create", {
				scene: {
					lorebookId,
					chatId,
					historyEntryId: selectedHistoryEntryId ? Number(selectedHistoryEntryId) : null,
					name: reviewName.trim() || null,
					summary: reviewContent.trim(),
					selectedMessageIds,
					participantCharacters: extractedParticipantCharacters,
					mentionedCharacters: extractedMentionedCharacters
				}
			})
		} else if (loreType === "world") {
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
		} else if (loreType === "character") {
			socket.emit("characterLoreEntries:create", {
				characterLoreEntry: {
					lorebookId,
					name: reviewName.trim(),
					content: reviewContent.trim(),
					lorebookBindingId: resolvedBindingId ?? null,
					keys: "",
					enabled: true,
					constant: false,
					useRegex: false,
					caseSensitive: false,
					priority: 1
				}
			})
		}

		const titles = { world: "World lore entry saved", character: "Character lore entry saved", scene: "Scene saved" }
		toaster.success({ title: titles[loreType] })
		isSaving = false
		onSaved()
		onOpenChange({ open: false })
	}

	function addParticipant() {
		const name = newParticipantInput.trim()
		if (name && !extractedParticipantCharacters.includes(name)) {
			extractedParticipantCharacters = [...extractedParticipantCharacters, name]
		}
		newParticipantInput = ""
	}

	function addMentioned() {
		const name = newMentionedInput.trim()
		if (name && !extractedMentionedCharacters.includes(name)) {
			extractedMentionedCharacters = [...extractedMentionedCharacters, name]
		}
		newMentionedInput = ""
	}
</script>

{#snippet confirmBlock()}
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
							<select class="select flex-1 text-sm" bind:value={attachingLorebookId}>
								<option value="">Select existing lorebook…</option>
								{#each availableLorebooks as lb}
									<option value={lb.id}>{lb.name}</option>
								{/each}
							</select>
							<button class="btn btn-sm preset-filled-primary-500" disabled={!attachingLorebookId} onclick={confirmAttachExisting}>
								Attach
							</button>
							<button class="btn btn-sm preset-filled-surface-400-600" onclick={() => (isCreatingLorebook = true)}>
								<Icons.Plus size={14} /> New
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
							<button class="btn btn-sm preset-filled-primary-500" disabled={!newLorebookName.trim()} onclick={createAndAttachLorebook}>
								Create & Attach
							</button>
							<button class="btn btn-sm preset-filled-surface-400-600" onclick={() => (isCreatingLorebook = false)}>
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
			<div class="flex flex-wrap gap-4">
				<label class="flex cursor-pointer items-center gap-2">
					<input type="radio" class="radio" name="loreType" value="scene" bind:group={loreType} />
					<Icons.Film size={16} />
					<span class="text-sm">Scene</span>
				</label>
				<label class="flex cursor-pointer items-center gap-2">
					<input type="radio" class="radio" name="loreType" value="world" bind:group={loreType} />
					<Icons.Globe size={16} />
					<span class="text-sm">World Lore</span>
				</label>
				<label class="flex cursor-pointer items-center gap-2">
					<input type="radio" class="radio" name="loreType" value="character" bind:group={loreType} />
					<Icons.User size={16} />
					<span class="text-sm">Character Lore</span>
				</label>
			</div>
		</fieldset>

		<!-- Scene gap warning -->
		{#if loreType === "scene" && hasSceneMessageGap}
			<div class="flex items-start gap-2 rounded-lg border border-warning-500/40 bg-warning-500/10 p-3 text-sm">
				<Icons.TriangleAlert size={16} class="text-warning-500 mt-0.5 shrink-0" />
				<span>Selected messages have a visible gap. Scenes must be a consecutive sequence with no unselected visible messages between them.</span>
			</div>
		{/if}

		<!-- History entry binding (scene only) -->
		{#if loreType === "scene"}
			<div class="space-y-1">
				<label class="label text-sm font-semibold" for="summarize-history-entry">
					History entry <span class="text-error-500">*</span>
				</label>
				{#if historyEntryList.length > 0 || selectedHistoryEntryId}
					<div class="flex gap-2">
						<select id="summarize-history-entry" class="select flex-1 text-sm" bind:value={selectedHistoryEntryId}>
							<option value="">— Select history entry —</option>
							{#each historyEntryList as entry}
								<option value={entry.id}>
									{#if entry.year}Year {entry.year}{entry.month ? `, Month ${entry.month}` : ""}{entry.day ? `, Day ${entry.day}` : ""}{:else}Entry #{entry.id}{/if}
								</option>
							{/each}
						</select>
						<button class="btn btn-sm preset-filled-surface-400-600" disabled={isCreatingHistoryEntry || !hasLorebook} onclick={createBlankHistoryEntry} title={!hasLorebook ? "Attach a lorebook first" : "Create a new blank history entry"}>
							{#if isCreatingHistoryEntry}
								<Icons.Loader size={14} class="animate-spin" />
							{:else}
								<Icons.Plus size={14} />
							{/if}
							New
						</button>
					</div>
				{:else}
					<div class="flex gap-2">
						<p class="text-surface-700-300 flex-1 text-sm">No history entries yet.</p>
						<button class="btn btn-sm preset-filled-primary-500" disabled={isCreatingHistoryEntry || !hasLorebook} onclick={createBlankHistoryEntry} title={!hasLorebook ? "Attach a lorebook first" : undefined}>
							{#if isCreatingHistoryEntry}
								<Icons.Loader size={14} class="animate-spin" />
							{:else}
								<Icons.Plus size={14} />
							{/if}
							Create New Entry
						</button>
					</div>
				{/if}
				{#if selectedHistoryEntryId}
					{@const entry = historyEntryList.find(e => e.id === Number(selectedHistoryEntryId))}
					{#if entry?.content}
						<p class="text-surface-700-300 text-xs line-clamp-2">{entry.content}</p>
					{:else}
						<p class="text-surface-400 text-xs italic">Empty entry — content will be populated from scenes later.</p>
					{/if}
				{/if}
			</div>
		{/if}

		<!-- Topic (world + character) -->
		{#if loreType === "world" || loreType === "character"}
			<div class="space-y-1">
				<label class="label text-sm font-semibold" for="summarize-topic">
					Focus topic
					{#if loreType === "character"}
						<span class="text-error-500">*</span>
					{:else}
						<span class="text-surface-400 font-normal">(optional)</span>
					{/if}
				</label>
				<input
					id="summarize-topic"
					class="input text-sm"
					type="text"
					placeholder={loreType === "character"
						? 'e.g. "abilities", "relationship with Kira", "past"'
						: 'e.g. "the guards in the Labyrinth of Descia"'}
					bind:value={topic}
				/>
				{#if topic.trim()}
					<p class="text-surface-700-300 text-xs">
						Prompt will include: <em>"Specifically focus on: "{topic.trim()}""</em>
					</p>
				{/if}
			</div>
		{/if}

		<!-- Binding (character lore only) -->
		{#if loreType === "character"}
			<div class="space-y-1">
				<label class="label text-sm font-semibold" for="summarize-binding">
					Bind to character / persona
					<span class="text-surface-400 font-normal">(optional)</span>
				</label>
				<select id="summarize-binding" class="select text-sm" bind:value={selectedBinding}>
					<option value="">— None (unbound) —</option>
					{#if bindableEntities.filter(e => e.type === "character").length > 0}
						<optgroup label="Characters">
							{#each bindableEntities.filter(e => e.type === "character") as e}
								<option value="character:{e.id}">{e.name}</option>
							{/each}
						</optgroup>
					{/if}
					{#if bindableEntities.filter(e => e.type === "persona").length > 0}
						<optgroup label="Personas">
							{#each bindableEntities.filter(e => e.type === "persona") as e}
								<option value="persona:{e.id}">{e.name}</option>
							{/each}
						</optgroup>
					{/if}
				</select>
			</div>
		{/if}

		<!-- Message count -->
		<p class="text-surface-700-300 text-sm">
			<Icons.MessageSquare size={14} class="mr-1 inline" />
			Summarizing
			<strong>{selectedMessageIds.length}</strong>
			{selectedMessageIds.length === 1 ? "message" : "messages"}
		</p>
	</div>
{/snippet}

{#snippet previewBlock()}
	{#if partialSummary.content || partialSummary.raw}
		<div class="space-y-1">
			<p class="text-surface-700-300 text-xs font-semibold uppercase tracking-wide">
				{summarizePhase === "synthesizing" ? "Final entry" : `Draft ${currentBatch}`}
			</p>
			<div class="bg-surface-200-800 rounded-lg p-3 text-sm">
				{#if partialSummary.content}
					<p class="text-surface-700-300 line-clamp-6 whitespace-pre-wrap">{partialSummary.content}</p>
				{:else if partialSummary.raw}
					<p class="text-surface-700-300 line-clamp-6 whitespace-pre-wrap text-xs italic">{partialSummary.raw}</p>
				{/if}
			</div>
		</div>
	{:else if summarizePhase === "synthesizing"}
		<div class="text-surface-700-300 py-4 text-center text-sm">
			<div class="bg-primary-500 mx-auto mb-2 h-2 w-2 animate-pulse rounded-full"></div>
			Synthesizing final entry…
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
		{#if loreType === "world" || loreType === "character" || loreType === "scene"}
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
					<p class="text-surface-700-300 text-xs">Auto-generated — edit if needed.</p>
				{/if}
			</div>
		{/if}

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

		{#if loreType === "scene"}
			<div class="rounded-lg border border-surface-300-700 p-3 space-y-3">
				<p class="text-xs font-semibold uppercase tracking-wide text-surface-700-300">Extracted characters</p>

				<div class="space-y-1.5">
					<p class="text-sm font-semibold">Participants <span class="text-surface-700-300 font-normal text-xs">(physically present)</span></p>
					<div class="flex flex-wrap gap-1.5">
						{#each extractedParticipantCharacters as name, i}
							<span class="chip preset-tonal-primary text-xs flex items-center gap-1">
								{name}
								<button class="hover:text-error-500 p-1.5" aria-label="Remove participant {name}" onclick={() => (extractedParticipantCharacters = extractedParticipantCharacters.filter((_, j) => j !== i))}>
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
					{#if extractedParticipantCharacters.length === 0}
						<p class="text-xs text-surface-400 italic">None extracted.</p>
					{/if}
				</div>

				<div class="space-y-1.5">
					<p class="text-sm font-semibold">Mentioned <span class="text-surface-700-300 font-normal text-xs">(referenced but absent)</span></p>
					<div class="flex flex-wrap gap-1.5">
						{#each extractedMentionedCharacters as name, i}
							<span class="chip preset-tonal-surface text-xs flex items-center gap-1">
								{name}
								<button class="hover:text-error-500 p-1.5" aria-label="Remove mention {name}" onclick={() => (extractedMentionedCharacters = extractedMentionedCharacters.filter((_, j) => j !== i))}>
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
					{#if extractedMentionedCharacters.length === 0}
						<p class="text-xs text-surface-400 italic">None extracted.</p>
					{/if}
				</div>
			</div>
		{/if}

		<div>
			<button
				class="text-surface-700-300 hover:text-surface-700-300 flex items-center gap-1 text-xs"
				onclick={() => (showRaw = !showRaw)}
			>
				<Icons.ChevronDown size={14} class="transition-transform {showRaw ? 'rotate-180' : ''}" />
				{showRaw ? "Hide" : "Show"} raw LLM output
			</button>
			{#if showRaw}
				<pre class="bg-surface-200-800 mt-2 overflow-x-auto rounded p-3 text-xs whitespace-pre-wrap">{rawOutput}</pre>
			{/if}
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
	title="Summarize to Lorebook"
	runningTitle="Generating Summary…"
	reviewTitle="Review & Save"
	badge={badgeLabel}
	step={aiStep}
	{progressPercent}
	{progressLabel}
	canStart={canGenerate}
	startLabel="Generate Summary"
	{canSave}
	saveLabel="Save to Lorebook"
	{isSaving}
	{errorMessage}
	hasReviewContent={reviewContent.trim().length > 0}
	onStart={generate}
	onSave={saveEntry}
	onCancel={() => onOpenChange({ open: false })}
	onRetry={generate}
	onDiscard={() => onOpenChange({ open: false })}
	onBack={() => (step = "configure")}
	onRerun={generate}
	onViewLastResult={() => (step = "review")}
	confirm={confirmBlock}
	preview={previewBlock}
	review={reviewBlock}
	debug={debugBlock}
/>
