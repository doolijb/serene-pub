<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import PanelNavHeader from "$lib/client/components/panels/PanelNavHeader.svelte"
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { getContext, onDestroy, onMount, tick } from "svelte"
	import EmbeddingStatusIcon from "$lib/client/components/EmbeddingStatusIcon.svelte"
	import LoreContentField from "./LoreContentField.svelte"
	import { Switch } from "@skeletonlabs/skeleton-svelte"
	import { v4 as uuid } from "uuid"
	import { dndzone } from "svelte-dnd-action"
	import DeleteLorebookEntryConfirmModal from "../modals/DeleteLorebookEntryConfirmModal.svelte"
	import { Priorities } from "$lib/shared/constants/Priorities"
	import { getCharacterLoreVisibility } from "$lib/shared/utils/characterLoreVisibility"

	interface Props {
		lorebookId: number
		hasUnsavedChanges: boolean
	}

	const socket = useTypedSocket()

	let {
		lorebookId = $bindable(),
		hasUnsavedChanges = $bindable(false)
	}: Props = $props()

	let systemSettingsCtx: SystemSettingsCtx = $state(
		getContext("systemSettingsCtx")
	)
	let vectorizationEnabled = $derived(
		systemSettingsCtx.settings?.vectorizationEnabled ?? false
	)

	const SORT_OPTIONS = [
		{ value: "position-asc", label: "Position ↑" },
		{ value: "position-desc", label: "Position ↓" },
		{ value: "priority-desc", label: "Priority ↑" },
		{ value: "priority-asc", label: "Priority ↓" },
		{ value: "created-desc", label: "Date Created ↑" },
		{ value: "created-asc", label: "Date Created ↓" },
		{ value: "updated-desc", label: "Date Updated ↑" },
		{ value: "updated-asc", label: "Date Updated ↓" }
	]

	const DefaultCharacterEntry: InsertCharacterLoreEntry = {
		name: "",
		content: "",
		keys: "",
		useRegex: false,
		caseSensitive: false,
		constant: false,
		enabled: true,
		priority: 1,
		lorebookId,
		lorebookBindingId: null
	}

	type BindingWithRelations = SelectLorebookBinding & {
		character?: { nickname?: string | null; name: string } | null
		persona?: { name: string } | null
	}

	// ── Core list state ────────────────────────────────────────────
	let characterLoreEntryList: SelectCharacterLoreEntry[] = $state([])
	let lorebookBindingList: BindingWithRelations[] = $state([])
	let isReady = $state(false)
	let orderBy = $state("position-asc")
	let search = $state("")

	// ── Panel mode: list → view → edit ─────────────────────────────
	type PanelMode = "list" | "view" | "edit"
	let panelMode = $state<PanelMode>("list")
	let focusedEntry = $state<SelectCharacterLoreEntry | null>(null)
	let editingEntry = $state<
		(InsertCharacterLoreEntry & { _uuid?: string }) | null
	>(null)
	let isNewEntry = $state(false)

	// ── Card `...` menu ────────────────────────────────────────────
	let openMenuEntryId = $state<number | null>(null)

	// ── Delete state ───────────────────────────────────────────────
	let deleteEntryId = $state<number | null>(null)
	let showDeleteConfirmModal = $state(false)

	// ── Reorder ────────────────────────────────────────────────────
	let isReordering = $state(false)

	// ── Unsaved changes ────────────────────────────────────────────
	$effect(() => {
		if (panelMode !== "edit" || !editingEntry) {
			hasUnsavedChanges = false
			return
		}
		if (isNewEntry) {
			hasUnsavedChanges =
				!!(editingEntry as any).name?.trim() ||
				!!(editingEntry as any).content?.trim()
			return
		}
		const original = characterLoreEntryList.find(
			(e) => e.id === (editingEntry as any).id
		)
		hasUnsavedChanges = original
			? JSON.stringify(original) !== JSON.stringify(editingEntry)
			: false
	})

	// ── List helpers ───────────────────────────────────────────────
	function getSortedEntries(): SelectCharacterLoreEntry[] {
		return characterLoreEntryList.slice().sort((a, b) => {
			const getPinned = (e: SelectCharacterLoreEntry) =>
				e.constant ? 1 : 0
			const getPriority = (e: SelectCharacterLoreEntry) => e.priority || 1
			const getCreated = (e: SelectCharacterLoreEntry) =>
				new Date(e.createdAt || 0).getTime()
			const getUpdated = (e: SelectCharacterLoreEntry) =>
				new Date(e.updatedAt || 0).getTime()
			const getPosition = (e: SelectCharacterLoreEntry) =>
				typeof e.position === "number" ? e.position : 0
			switch (orderBy) {
				case "position-asc":
					return getPosition(a) - getPosition(b)
				case "position-desc":
					return getPosition(b) - getPosition(a)
				case "priority-desc":
					if (getPinned(a) !== getPinned(b))
						return getPinned(b) - getPinned(a)
					return getPriority(b) - getPriority(a)
				case "priority-asc":
					if (getPinned(a) !== getPinned(b))
						return getPinned(a) - getPinned(b)
					return getPriority(a) - getPriority(b)
				case "created-desc":
					return getCreated(b) - getCreated(a)
				case "created-asc":
					return getCreated(a) - getCreated(b)
				case "updated-desc":
					return getUpdated(b) - getUpdated(a)
				case "updated-asc":
					return getUpdated(a) - getUpdated(b)
				default:
					return 0
			}
		})
	}

	let filteredEntries: SelectCharacterLoreEntry[] = $derived.by(() => {
		const lower = search.trim().toLowerCase()
		if (!lower) return getSortedEntries()
		return getSortedEntries().filter((e) => {
			return (
				(e.name || "").toLowerCase().includes(lower) ||
				(e.content || "").toLowerCase().includes(lower) ||
				(e.keys || "").toLowerCase().includes(lower)
			)
		})
	})

	function getBindingLabel(bindingId: number): string {
		const binding = lorebookBindingList.find((b) => b.id === bindingId)
		if (!binding) return "Missing Binding"
		if (binding.characterId) {
			return (
				binding.character?.nickname ||
				binding.character?.name ||
				binding.binding
			)
		} else if (binding.personaId) {
			return binding.persona?.name || binding.binding
		}
		return binding.binding
	}

	// Thin binding to this list's current lorebookBindingList — see
	// getCharacterLoreVisibility()'s own doc comment for the actual rule.
	function getVisibility(lorebookBindingId: number | null | undefined) {
		return getCharacterLoreVisibility(
			lorebookBindingId,
			lorebookBindingList
		)
	}
	// Recomputed live as the edit form's Binding <select> changes, so the
	// helper text under it always reflects what saving right now would do.
	let editVisibility = $derived(
		getVisibility(editingEntry?.lorebookBindingId)
	)

	function previewContent(entry: SelectCharacterLoreEntry): string {
		let content = entry.content || ""
		lorebookBindingList.forEach((binding) => {
			if (binding.characterId) {
				content = content.replaceAll(
					binding.binding,
					binding.character?.nickname ||
						binding.character?.name ||
						binding.binding
				)
			} else if (binding.personaId) {
				content = content.replaceAll(
					binding.binding,
					binding.persona?.name || binding.binding
				)
			}
		})
		return content
	}

	function entryIsValid(
		entry: InsertCharacterLoreEntry | SelectCharacterLoreEntry,
		warn = false
	): boolean {
		if (!entry.name?.trim()) {
			if (warn) toaster.error({ title: "Name is required" })
			return false
		}
		return true
	}

	// ── Navigation ─────────────────────────────────────────────────
	function goBack() {
		panelMode = "list"
		focusedEntry = null
		editingEntry = null
		isNewEntry = false
	}

	function viewEntry(entry: SelectCharacterLoreEntry) {
		focusedEntry = entry
		panelMode = "view"
	}

	function editEntry(entry: SelectCharacterLoreEntry) {
		focusedEntry = entry
		editingEntry = { ...entry }
		panelMode = "edit"
	}

	function createEntry() {
		focusedEntry = null
		editingEntry = { ...DefaultCharacterEntry, _uuid: uuid() }
		isNewEntry = true
		panelMode = "edit"
	}

	// ── Save / Delete ──────────────────────────────────────────────
	function handleSave() {
		if (!editingEntry || !entryIsValid(editingEntry, true)) return

		const data = { ...editingEntry, lorebookId, _uuid: undefined }

		if (isNewEntry) {
			socket.emit("characterLoreEntries:create", {
				characterLoreEntry: data as InsertCharacterLoreEntry
			} satisfies Sockets.CharacterLoreEntries.Create.Params)
		} else {
			socket.emit("characterLoreEntries:update", {
				characterLoreEntry: data as UpdateCharacterLoreEntry
			} satisfies Sockets.CharacterLoreEntries.Update.Params)
		}
		goBack()
	}

	function onDeleteClick(id: number) {
		deleteEntryId = id
		showDeleteConfirmModal = true
	}

	function onDeleteConfirm() {
		showDeleteConfirmModal = false
		socket.emit("characterLoreEntries:delete", {
			id: deleteEntryId!
		} satisfies Sockets.CharacterLoreEntries.Delete.Params)
		if (focusedEntry?.id === deleteEntryId) goBack()
		deleteEntryId = null
	}

	function onDeleteCancel() {
		showDeleteConfirmModal = false
		deleteEntryId = null
	}

	// ── Reorder ────────────────────────────────────────────────────
	function handleUpdateReorder(entries: SelectCharacterLoreEntry[]) {
		const positions = entries.map((e, i) => ({ id: e.id, position: i + 1 }))
		socket.emit("characterLoreEntries:updatePositions", {
			lorebookId,
			positions
		} satisfies Sockets.CharacterLoreEntries.UpdatePositions.Params)
	}

	async function handleLorebooksBindingList(
		msg: Sockets.Lorebooks.BindingList.Response
	) {
		if (msg.lorebookId === lorebookId) {
			lorebookBindingList = [
				...msg.lorebookBindingList
			] as BindingWithRelations[]
		}
		await tick()
	}

	// ── Socket setup ───────────────────────────────────────────────
	async function handleCharacterLoreEntriesList(
		msg: Sockets.CharacterLoreEntries.List.Response
	) {
		if (msg.lorebookId === lorebookId) {
			characterLoreEntryList = msg.characterLoreEntryList
			if (focusedEntry) {
				const updated = msg.characterLoreEntryList.find(
					(e) => e.id === focusedEntry!.id
				)
				if (updated) focusedEntry = updated
			}
		}
		await tick()
	}

	function handleCharacterLoreEntriesCreate(
		msg: Sockets.CharacterLoreEntries.Create.Response
	) {
		if (msg.characterLoreEntry?.lorebookId === lorebookId) {
			toaster.success({ title: "Character Lore Entry created" })
		}
	}

	function handleCharacterLoreEntriesUpdate(
		msg: Sockets.CharacterLoreEntries.Update.Response
	) {
		if (msg.characterLoreEntry?.lorebookId === lorebookId) {
			toaster.success({ title: "Character Lore Entry updated" })
		}
	}

	function handleCharacterLoreEntriesDelete(
		_msg: Sockets.CharacterLoreEntries.Delete.Response
	) {
		toaster.success({ title: "Character Lore Entry deleted" })
	}

	function handleCharacterLoreEntriesUpdatePositions(
		msg: Sockets.CharacterLoreEntries.UpdatePositions.Response
	) {
		if (msg.success) toaster.success({ title: "Entries reordered" })
	}

	// The background vectorization queue updates a row's embeddingModel
	// directly in the DB — without this, the badge here only ever refreshes
	// on the next explicit CRUD action, leaving it stale until a manual refresh.
	function handleVectorizationItemUpdated(
		msg: Sockets.Vectorization.ItemUpdated.Response
	) {
		if (msg.type !== "characterLore" || msg.lorebookId !== lorebookId)
			return
		const target = characterLoreEntryList.find((e: any) => e.id === msg.id)
		if (target) (target as any).embeddingModel = msg.embeddingModel
		if (focusedEntry?.id === msg.id)
			(focusedEntry as any).embeddingModel = msg.embeddingModel
	}

	onMount(() => {
		socket.on("characterLoreEntries:list", handleCharacterLoreEntriesList)
		socket.on(
			"characterLoreEntries:create",
			handleCharacterLoreEntriesCreate
		)
		socket.on(
			"characterLoreEntries:update",
			handleCharacterLoreEntriesUpdate
		)
		socket.on(
			"characterLoreEntries:delete",
			handleCharacterLoreEntriesDelete
		)
		socket.on("lorebooks:bindingList", handleLorebooksBindingList)
		socket.on(
			"characterLoreEntries:updatePositions",
			handleCharacterLoreEntriesUpdatePositions
		)
		socket.on("vectorization:itemUpdated", handleVectorizationItemUpdated)

		socket.emit("characterLoreEntries:list", {
			lorebookId
		} satisfies Sockets.CharacterLoreEntries.List.Params)
		socket.emit("lorebooks:bindingList", {
			lorebookId
		} satisfies Sockets.Lorebooks.BindingList.Params)
		isReady = true
	})

	onDestroy(() => {
		hasUnsavedChanges = false
		socket.off("characterLoreEntries:list", handleCharacterLoreEntriesList)
		socket.off(
			"characterLoreEntries:create",
			handleCharacterLoreEntriesCreate
		)
		socket.off(
			"characterLoreEntries:update",
			handleCharacterLoreEntriesUpdate
		)
		socket.off(
			"characterLoreEntries:delete",
			handleCharacterLoreEntriesDelete
		)
		socket.off("lorebooks:bindingList", handleLorebooksBindingList)
		socket.off(
			"characterLoreEntries:updatePositions",
			handleCharacterLoreEntriesUpdatePositions
		)
		socket.off("vectorization:itemUpdated", handleVectorizationItemUpdated)
	})
</script>

{#if isReady}
	<!-- ═══════════════════════════════════════════════════════════════
     LIST MODE
════════════════════════════════════════════════════════════════ -->
	{#if panelMode === "list"}
		<div class="flex flex-col gap-3">
			<!-- Toolbar -->
			<div class="flex flex-col gap-2">
				<input
					class="input input-sm w-full"
					placeholder="Search entries…"
					type="text"
					bind:value={search}
				/>
				<div class="flex gap-2">
					<select class="select compact text-sm" bind:value={orderBy}>
						{#each SORT_OPTIONS as opt}
							<option value={opt.value}>{opt.label}</option>
						{/each}
					</select>
					<button
						class="btn btn-sm preset-filled-surface-400-600 shrink-0"
						onclick={() => (isReordering = true)}
						disabled={characterLoreEntryList.length === 0}
						title="Reorder entries"
					>
						<Icons.SortAsc size={14} />
					</button>
					<button
						class="btn btn-sm preset-filled-success-500 shrink-0"
						onclick={createEntry}
					>
						<Icons.Plus size={14} /> New
					</button>
				</div>
			</div>

			<!-- Reorder panel -->
			{#if isReordering}
				<div class="flex flex-col gap-2">
					<div
						class="text-surface-700-300 text-xs font-semibold tracking-wide uppercase"
					>
						Drag to reorder
					</div>
					<div
						use:dndzone={{
							items: characterLoreEntryList
								.slice()
								.sort(
									(a, b) =>
										(a.position ?? 0) - (b.position ?? 0)
								),
							flipDurationMs: 150,
							dragDisabled: false,
							dropFromOthersDisabled: true
						}}
						onconsider={(e) => {
							characterLoreEntryList = e.detail.items.map(
								(item, idx) => ({ ...item, position: idx + 1 })
							)
						}}
						onfinalize={async (e) => {
							characterLoreEntryList = e.detail.items.map(
								(item, idx) => ({ ...item, position: idx + 1 })
							)
							handleUpdateReorder(characterLoreEntryList)
						}}
						class="flex flex-col gap-1"
					>
						{#each characterLoreEntryList
							.slice()
							.sort((a, b) => (a.position ?? 0) - (b.position ?? 0)) as entry (entry.id)}
							<div
								class="bg-surface-200-800 hover:bg-surface-300-700 flex cursor-grab items-center gap-2 rounded-md p-2 text-sm"
								data-dnd-handle
							>
								<Icons.GripVertical
									size={16}
									class="text-surface-400 shrink-0"
								/>
								<span class="flex-1 truncate font-medium">
									{entry.name}
								</span>
								{#if entry.lorebookBindingId}
									<span
										class="text-surface-700-300 shrink-0 text-xs"
									>
										{getBindingLabel(
											entry.lorebookBindingId
										)}
									</span>
								{/if}
								<span class="text-surface-700-300 text-xs">
									#{entry.position}
								</span>
							</div>
						{/each}
					</div>
					<button
						class="btn btn-sm preset-filled-success-500 w-full"
						onclick={() => (isReordering = false)}
					>
						<Icons.Check size={14} /> Done
					</button>
				</div>

				<!-- Entry cards -->
			{:else if filteredEntries.length === 0}
				<p class="text-surface-700-300 py-6 text-center text-sm italic">
					No character lore entries yet.
				</p>
			{:else}
				{#each filteredEntries as entry}
					{@const visibility = getVisibility(entry.lorebookBindingId)}
					{@const isOrphaned = visibility.kind === "orphaned"}
					{@const isUnbound = visibility.kind === "unbound"}
					{@const needsAttention = isOrphaned || isUnbound}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<div
						role="button"
						tabindex="0"
						class="preset-filled-surface-100-900 hover:bg-surface-200-800 flex cursor-pointer items-start gap-2 rounded-lg p-3 transition-colors"
						class:opacity-50={!entry.enabled}
						class:border-2={needsAttention}
						class:border-warning-500={needsAttention}
						onclick={() => viewEntry(entry)}
					>
						<div class="min-w-0 flex-1">
							<div
								class="mb-1 flex items-center gap-2 text-sm font-semibold"
							>
								<span class="truncate">{entry.name}</span>
								{#if isOrphaned}
									<span
										class="text-warning-500 shrink-0 text-xs font-normal"
										title={visibility.description}
									>
										<Icons.AlertTriangle
											size={11}
											class="inline"
										/>
										{visibility.label}
									</span>
								{:else if isUnbound}
									<span
										class="text-warning-500 shrink-0 text-xs font-normal"
										title={visibility.description}
									>
										<Icons.LockOpen
											size={11}
											class="inline"
										/>
										{visibility.label}
									</span>
								{:else if visibility.kind === "narrator"}
									<span
										class="text-tertiary-600-400 shrink-0 text-xs font-normal"
										title={visibility.description}
									>
										<Icons.Drama size={11} class="inline" />
										{visibility.label}
									</span>
								{:else}
									<span
										class="text-surface-700-300 shrink-0 text-xs font-normal"
										title={visibility.description}
									>
										<Icons.Lock size={11} class="inline" />
										{visibility.label}
									</span>
								{/if}
							</div>
							{#if entry.content?.trim()}
								<p
									class="text-surface-600-400 line-clamp-2 text-xs leading-relaxed whitespace-pre-wrap"
								>
									{previewContent(entry)}
								</p>
							{:else}
								<p class="text-surface-700-300 text-xs italic">
									No content yet.
								</p>
							{/if}
							<div
								class="mt-1.5 flex flex-wrap items-center gap-1"
							>
								<EmbeddingStatusIcon
									embeddingModel={entry.embeddingModel}
									size={12}
								/>
								{#if !entry.enabled}
									<span
										class="preset-filled-error-500 rounded px-1.5 py-0.5 text-xs"
										title="Disabled"
									>
										<Icons.Ghost size={11} class="inline" />
									</span>
								{/if}
								{#if entry.constant}
									<span
										class="preset-filled-warning-500 rounded px-1.5 py-0.5 text-xs"
										title="Pinned"
									>
										<Icons.Pin size={11} class="inline" />
									</span>
								{:else if !vectorizationEnabled}
									<span
										class="rounded px-1.5 py-0.5 text-xs"
										class:preset-filled-success-500={entry.priority ===
											1}
										class:preset-filled-primary-500={entry.priority ===
											2}
										class:preset-filled-tertiary-500={entry.priority ===
											3}
										title={Priorities[
											(entry.priority ?? 1) - 1
										]?.label + " Priority"}
									>
										{#if entry.priority === 1}
											<Icons.Plus
												size={10}
												class="inline"
											/>
										{:else if entry.priority === 2}
											<Icons.Plus
												size={10}
												class="inline"
											/><Icons.Plus
												size={10}
												class="inline"
											/>
										{:else if entry.priority === 3}
											<Icons.Plus
												size={10}
												class="inline"
											/><Icons.Plus
												size={10}
												class="inline"
											/><Icons.Plus
												size={10}
												class="inline"
											/>
										{/if}
									</span>
								{/if}
								{#if !vectorizationEnabled && entry.useRegex}
									<span
										class="preset-filled-primary-500 rounded px-1.5 py-0.5 text-xs"
										title="Regex keys"
									>
										<Icons.Regex size={11} class="inline" />
									</span>
								{/if}
							</div>
						</div>

						<!-- ... menu -->
						<div role="none" onclick={(e) => e.stopPropagation()}>
							<Popover
								open={openMenuEntryId === entry.id}
								onOpenChange={(e) =>
									(openMenuEntryId = e.open
										? entry.id
										: null)}
								positioning={{ placement: "bottom-end" }}
							>
								<Popover.Trigger
									class="btn btn-sm preset-filled-surface-400-600 shrink-0 p-1"
									title="More options"
									aria-label="More options for {entry.name}"
								>
									<Icons.Ellipsis size={16} />
								</Popover.Trigger>
								<Portal>
									<Popover.Positioner class="z-[1000]!">
										<Popover.Content
											class="card bg-surface-100-900 flex min-w-32 flex-col gap-1 p-2 shadow-xl"
										>
											<button
												class="btn btn-sm preset-filled-surface-400-600 w-full justify-start"
												onclick={(e) => {
													e.stopPropagation()
													openMenuEntryId = null
													viewEntry(entry)
												}}
											>
												<Icons.Eye size={14} /> View
											</button>
											<button
												class="btn btn-sm preset-filled-surface-400-600 w-full justify-start"
												onclick={(e) => {
													e.stopPropagation()
													openMenuEntryId = null
													editEntry(entry)
												}}
											>
												<Icons.Pencil size={14} /> Edit
											</button>
											<hr
												class="border-surface-300-700"
											/>
											<button
												class="btn btn-sm preset-filled-error-500 w-full justify-start"
												onclick={(e) => {
													e.stopPropagation()
													openMenuEntryId = null
													onDeleteClick(entry.id)
												}}
											>
												<Icons.Trash2 size={14} /> Delete
											</button>
										</Popover.Content>
									</Popover.Positioner>
								</Portal>
							</Popover>
						</div>
					</div>
				{/each}
			{/if}
		</div>

		<!-- ═══════════════════════════════════════════════════════════════
     VIEW MODE
════════════════════════════════════════════════════════════════ -->
	{:else if panelMode === "view" && focusedEntry}
		{@const visibility = getVisibility(focusedEntry.lorebookBindingId)}
		<div class="flex flex-col gap-4">
			<!-- Header -->
			<PanelNavHeader
				title={focusedEntry.name}
				onBack={goBack}
				backLabel="Back"
				headingLevel={3}
				actionsLabel="Character lore entry"
			>
				{#snippet primaryAction()}
					<button
						class="btn btn-sm preset-filled-primary-500 shrink-0 p-2"
						onclick={() => editEntry(focusedEntry!)}
						title="Edit entry"
						aria-label="Edit entry"
						type="button"
					>
						<Icons.Pencil size={16} aria-hidden="true" />
					</button>
				{/snippet}
			</PanelNavHeader>

			<div class="flex flex-col gap-3 text-sm">
				<!-- Visibility -->
				<div>
					<p
						class="text-surface-700-300 mb-1 text-xs font-semibold tracking-wide uppercase"
					>
						Visibility
					</p>
					{#if visibility.kind === "character" || visibility.kind === "persona"}
						<span>
							<Icons.Lock size={14} class="inline" />
							{visibility.label}
						</span>
					{:else if visibility.kind === "unbound"}
						<span class="text-warning-500">
							<Icons.LockOpen size={14} class="inline" />
							{visibility.label}
						</span>
					{:else if visibility.kind === "narrator"}
						<span class="text-tertiary-600-400">
							<Icons.Drama size={14} class="inline" />
							{visibility.label}
						</span>
					{:else}
						<span class="text-warning-500">
							<Icons.AlertTriangle size={14} class="inline" />
							{visibility.label}
						</span>
					{/if}
					<p class="text-surface-700-300 mt-0.5 text-xs">
						{visibility.description}
					</p>
				</div>

				{#if focusedEntry.content?.trim()}
					<div>
						<p
							class="text-surface-700-300 mb-1 text-xs font-semibold tracking-wide uppercase"
						>
							Content
						</p>
						<div class="leading-relaxed whitespace-pre-wrap">
							{previewContent(focusedEntry)}
						</div>
					</div>
				{:else}
					<p class="text-surface-700-300 italic">No content yet.</p>
				{/if}

				{#if !vectorizationEnabled && focusedEntry.keys?.trim()}
					<div>
						<p
							class="text-surface-700-300 mb-1 text-xs font-semibold tracking-wide uppercase"
						>
							Keywords
						</p>
						<p>{focusedEntry.keys}</p>
					</div>
				{/if}

				<div class="flex flex-wrap items-center gap-2">
					<EmbeddingStatusIcon
						embeddingModel={focusedEntry.embeddingModel}
						size={14}
					/>
					{#if !focusedEntry.enabled}
						<span
							class="preset-filled-error-500 rounded px-2 py-1 text-xs"
						>
							<Icons.Ghost size={14} class="inline" /> Disabled
						</span>
					{/if}
					{#if focusedEntry.constant}
						<span
							class="preset-filled-warning-500 rounded px-2 py-1 text-xs"
						>
							<Icons.Pin size={14} class="inline" /> Pinned
						</span>
					{:else if !vectorizationEnabled}
						<span
							class="rounded px-2 py-1 text-xs"
							class:preset-filled-success-500={focusedEntry.priority ===
								1}
							class:preset-filled-primary-500={focusedEntry.priority ===
								2}
							class:preset-filled-tertiary-500={focusedEntry.priority ===
								3}
						>
							{Priorities[(focusedEntry.priority ?? 1) - 1]
								?.label} Priority
						</span>
					{/if}
					{#if !vectorizationEnabled && focusedEntry.useRegex}
						<span
							class="preset-filled-primary-500 rounded px-2 py-1 text-xs"
						>
							<Icons.Regex size={14} class="inline" /> Regex
						</span>
					{/if}
					{#if !vectorizationEnabled && focusedEntry.caseSensitive}
						<span
							class="preset-tonal-surface rounded px-2 py-1 text-xs"
						>
							Case Sensitive
						</span>
					{/if}
				</div>
			</div>
		</div>

		<!-- ═══════════════════════════════════════════════════════════════
     EDIT MODE
════════════════════════════════════════════════════════════════ -->
	{:else if panelMode === "edit" && editingEntry}
		<div class="flex flex-col gap-4">
			<!-- Header with Cancel/Save on their own wrapping row -->
			<PanelNavHeader
				title={isNewEntry
					? "New Character Lore Entry"
					: `Edit — ${focusedEntry?.name ?? "?"}`}
				onBack={goBack}
				backLabel="Back"
				headingLevel={3}
				titleClass="text-sm"
				actionsLabel="Edit character lore entry"
			>
				{#snippet primaryAction()}
					<button
						class="btn btn-sm preset-filled-success-500 shrink-0 p-2"
						onclick={handleSave}
						disabled={!entryIsValid(editingEntry!)}
						title={isNewEntry ? "Create entry" : "Update entry"}
						aria-label={isNewEntry
							? "Create entry"
							: "Update entry"}
						type="button"
					>
						<Icons.Save size={16} aria-hidden="true" />
					</button>
				{/snippet}
				{#snippet actions()}
					<button
						class="btn btn-sm popover-menu-btn hover:preset-filled-surface-500"
						onclick={goBack}
						type="button"
					>
						<Icons.X size={16} aria-hidden="true" />
						<span>Cancel</span>
					</button>
				{/snippet}
			</PanelNavHeader>

			<!-- Form fields -->
			<div class="flex flex-col gap-4">
				<!-- Name -->
				<div class="flex flex-col gap-1">
					<label
						class="flex items-center gap-1 text-sm font-semibold"
						for="cleName"
					>
						Name <span class="text-error-500">*</span>
						<Icons.ScanEye
							size={13}
							class="text-surface-400 relative top-[1px]"
						/>
					</label>
					<input
						id="cleName"
						class="input preset-filled-surface-200-800 w-full rounded-lg"
						type="text"
						bind:value={editingEntry.name}
						placeholder="Her abilities"
						required
					/>
				</div>

				<!-- Binding -->
				<div class="flex flex-col gap-1">
					<label
						class="flex items-center gap-1 text-sm font-semibold"
						for="cleBinding"
					>
						Binding
						<Icons.Link2
							size={13}
							class="text-surface-400 relative top-[1px]"
						/>
					</label>
					<select
						id="cleBinding"
						class="select preset-filled-surface-200-800 w-full rounded-lg"
						bind:value={editingEntry.lorebookBindingId}
					>
						<option value={null}>None (Unbound)</option>
						{#each lorebookBindingList as binding (binding.id)}
							<option value={binding.id}>
								{getBindingLabel(binding.id)}
							</option>
						{/each}
					</select>
					<p
						class="text-xs"
						class:text-warning-500={editVisibility.kind ===
							"orphaned" || editVisibility.kind === "unbound"}
						class:text-surface-700-300={editVisibility.kind !==
							"orphaned" && editVisibility.kind !== "unbound"}
					>
						{#if editVisibility.kind === "orphaned"}
							<Icons.AlertTriangle size={12} class="inline" />
						{:else if editVisibility.kind === "unbound"}
							<Icons.LockOpen size={12} class="inline" />
						{:else}
							<Icons.Lock size={12} class="inline" />
						{/if}
						{editVisibility.description}
					</p>
				</div>

				<!-- Content -->
				<div class="flex flex-col gap-1">
					<label
						class="flex items-center gap-1 text-sm font-semibold"
						for="cleContent"
					>
						Content
						<Icons.ScanEye
							size={13}
							class="text-surface-400 relative top-[1px]"
						/>
					</label>
					<LoreContentField
						bind:content={(editingEntry as any).content}
						bind:lorebookBindingList={lorebookBindingList as any}
					/>
				</div>

				<!-- Keywords -->
				{#if !vectorizationEnabled}
					<div class="flex flex-col gap-1">
						<label class="text-sm font-semibold" for="cleKeys">
							Keywords <span
								class="text-surface-700-300 text-xs font-normal"
							>
								(comma separated)
							</span>
						</label>
						<input
							id="cleKeys"
							class="input preset-filled-surface-200-800 w-full rounded-lg"
							type="text"
							bind:value={editingEntry.keys}
							placeholder="abilities, powers, skills"
						/>
					</div>
				{/if}

				<!-- Advanced settings -->
				<details>
					<summary class="cursor-pointer text-sm font-semibold">
						Advanced Settings
					</summary>
					<div class="mt-2 flex flex-col gap-3 text-sm">
						{#if !vectorizationEnabled}
							<Switch
								name="cleRegex"
								checked={editingEntry.useRegex || false}
								onCheckedChange={(e) => {
									if (editingEntry)
										editingEntry.useRegex = e.checked
								}}
								class="flex w-full items-center justify-between gap-2"
							>
								<Switch.Label>Use Regex</Switch.Label>
								<Switch.Control
									class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
								>
									<Switch.Thumb />
								</Switch.Control>
								<Switch.HiddenInput />
							</Switch>
							<Switch
								name="cleCase"
								checked={editingEntry.caseSensitive || false}
								onCheckedChange={(e) => {
									if (editingEntry)
										editingEntry.caseSensitive = e.checked
								}}
								class="flex w-full items-center justify-between gap-2"
							>
								<Switch.Label>Case Sensitive</Switch.Label>
								<Switch.Control
									class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
								>
									<Switch.Thumb />
								</Switch.Control>
								<Switch.HiddenInput />
							</Switch>
						{/if}
						<Switch
							name="clePinned"
							checked={editingEntry.constant || false}
							onCheckedChange={(e) => {
								if (editingEntry)
									editingEntry.constant = e.checked
							}}
							class="flex w-full items-center justify-between gap-2"
						>
							<Switch.Label>Pinned</Switch.Label>
							<Switch.Control
								class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
							>
								<Switch.Thumb />
							</Switch.Control>
							<Switch.HiddenInput />
						</Switch>
						<Switch
							name="cleEnabled"
							checked={editingEntry.enabled !== false}
							onCheckedChange={(e) => {
								if (editingEntry)
									editingEntry.enabled = e.checked
							}}
							class="flex w-full items-center justify-between gap-2"
						>
							<Switch.Label>Enabled</Switch.Label>
							<Switch.Control
								class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
							>
								<Switch.Thumb />
							</Switch.Control>
							<Switch.HiddenInput />
						</Switch>
						{#if !vectorizationEnabled}
							<div
								class="flex w-full items-center justify-between gap-2"
							>
								<label
									for="clePriority"
									class:opacity-50={editingEntry.constant}
								>
									Priority
								</label>
								<select
									id="clePriority"
									class="select preset-filled-surface-200-800 w-max max-w-xs rounded-lg text-sm"
									bind:value={editingEntry.priority}
									disabled={editingEntry.constant || false}
								>
									{#each Priorities as priority}
										<option value={priority.value}>
											{priority.label}
										</option>
									{/each}
								</select>
							</div>
						{/if}
					</div>
				</details>
			</div>
		</div>
	{/if}
{/if}

<DeleteLorebookEntryConfirmModal
	open={showDeleteConfirmModal}
	onOpenChange={(e) => {
		showDeleteConfirmModal = e.open
		if (!e.open) deleteEntryId = null
	}}
	onConfirm={onDeleteConfirm}
	onCancel={onDeleteCancel}
/>
