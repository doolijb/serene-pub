<script lang="ts">
	import * as Icons from "@lucide/svelte"
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

	interface Props {
		lorebookId: number
		hasUnsavedChanges: boolean
	}

	const socket = useTypedSocket()

	let {
		lorebookId = $bindable(),
		hasUnsavedChanges = $bindable(false)
	}: Props = $props()

	let systemSettingsCtx: SystemSettingsCtx = $state(getContext("systemSettingsCtx"))
	let vectorizationEnabled = $derived(systemSettingsCtx.settings?.vectorizationEnabled ?? false)

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

	const DefaultWorldEntry: InsertWorldLoreEntry = {
		name: "",
		content: "",
		keys: "",
		useRegex: false,
		caseSensitive: false,
		constant: false,
		enabled: true,
		priority: 1,
		lorebookId
	}

	type BindingWithRelations = SelectLorebookBinding & {
		character?: { nickname?: string | null; name: string } | null
		persona?: { name: string } | null
	}

	// ── Core list state ────────────────────────────────────────────
	let worldLoreEntryList: SelectWorldLoreEntry[] = $state([])
	let lorebookBindingList: BindingWithRelations[] = $state([])
	let isReady = $state(false)
	let orderBy = $state("position-asc")
	let search = $state("")

	// ── Panel mode: list → view → edit ─────────────────────────────
	type PanelMode = "list" | "view" | "edit"
	let panelMode = $state<PanelMode>("list")
	let focusedEntry = $state<SelectWorldLoreEntry | null>(null)
	let editingEntry = $state<(InsertWorldLoreEntry & { _uuid?: string }) | null>(null)
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
			hasUnsavedChanges = !!(editingEntry as any).name?.trim() || !!(editingEntry as any).content?.trim()
			return
		}
		const original = worldLoreEntryList.find((e) => e.id === (editingEntry as any).id)
		hasUnsavedChanges = original
			? JSON.stringify(original) !== JSON.stringify(editingEntry)
			: false
	})

	// ── List helpers ───────────────────────────────────────────────
	function getSortedEntries(): SelectWorldLoreEntry[] {
		return worldLoreEntryList.slice().sort((a, b) => {
			const getPinned = (e: SelectWorldLoreEntry) => (e.constant ? 1 : 0)
			const getPriority = (e: SelectWorldLoreEntry) => e.priority || 1
			const getCreated = (e: SelectWorldLoreEntry) => new Date(e.createdAt || 0).getTime()
			const getUpdated = (e: SelectWorldLoreEntry) => new Date(e.updatedAt || 0).getTime()
			const getPosition = (e: SelectWorldLoreEntry) => (typeof e.position === "number" ? e.position : 0)
			switch (orderBy) {
				case "position-asc":  return getPosition(a) - getPosition(b)
				case "position-desc": return getPosition(b) - getPosition(a)
				case "priority-desc":
					if (getPinned(a) !== getPinned(b)) return getPinned(b) - getPinned(a)
					return getPriority(b) - getPriority(a)
				case "priority-asc":
					if (getPinned(a) !== getPinned(b)) return getPinned(a) - getPinned(b)
					return getPriority(a) - getPriority(b)
				case "created-desc": return getCreated(b) - getCreated(a)
				case "created-asc":  return getCreated(a) - getCreated(b)
				case "updated-desc": return getUpdated(b) - getUpdated(a)
				case "updated-asc":  return getUpdated(a) - getUpdated(b)
				default: return 0
			}
		})
	}

	let filteredEntries: SelectWorldLoreEntry[] = $derived.by(() => {
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

	function previewContent(entry: SelectWorldLoreEntry): string {
		let content = entry.content || ""
		lorebookBindingList.forEach((binding) => {
			if (binding.characterId) {
				content = content.replaceAll(
					binding.binding,
					binding.character?.nickname || binding.character?.name || binding.binding
				)
			} else if (binding.personaId) {
				content = content.replaceAll(binding.binding, binding.persona?.name || binding.binding)
			}
		})
		return content
	}

	function entryIsValid(entry: InsertWorldLoreEntry | SelectWorldLoreEntry, warn = false): boolean {
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

	function viewEntry(entry: SelectWorldLoreEntry) {
		focusedEntry = entry
		panelMode = "view"
	}

	function editEntry(entry: SelectWorldLoreEntry) {
		focusedEntry = entry
		editingEntry = { ...entry }
		panelMode = "edit"
	}

	function createEntry() {
		focusedEntry = null
		editingEntry = { ...DefaultWorldEntry, _uuid: uuid() }
		isNewEntry = true
		panelMode = "edit"
	}

	// ── Save / Delete ──────────────────────────────────────────────
	function handleSave() {
		if (!editingEntry || !entryIsValid(editingEntry, true)) return

		const data = { ...editingEntry, lorebookId, _uuid: undefined }

		if (isNewEntry) {
			socket.emit("worldLoreEntries:create", {
				worldLoreEntry: data as InsertWorldLoreEntry
			} satisfies Sockets.WorldLoreEntries.Create.Params)
		} else {
			socket.emit("worldLoreEntries:update", {
				worldLoreEntry: data as UpdateWorldLoreEntry
			} satisfies Sockets.WorldLoreEntries.Update.Params)
		}
		goBack()
	}

	function onDeleteClick(id: number) {
		deleteEntryId = id
		showDeleteConfirmModal = true
	}

	function onDeleteConfirm() {
		showDeleteConfirmModal = false
		socket.emit("worldLoreEntries:delete", { id: deleteEntryId! } satisfies Sockets.WorldLoreEntries.Delete.Params)
		if (focusedEntry?.id === deleteEntryId) goBack()
		deleteEntryId = null
	}

	function onDeleteCancel() {
		showDeleteConfirmModal = false
		deleteEntryId = null
	}

	// ── Reorder ────────────────────────────────────────────────────
	function handleUpdateReorder(entries: SelectWorldLoreEntry[]) {
		const updates = entries.map((e, i) => ({ id: e.id, position: i + 1 }))
		socket.emit("worldLoreEntries:updatePositions", {
			updates
		} satisfies Sockets.WorldLoreEntries.UpdatePositions.Params)
	}

	// ── Socket setup ───────────────────────────────────────────────
	onMount(() => {
		socket.on("worldLoreEntries:list", async (msg: Sockets.WorldLoreEntries.List.Response) => {
			if (msg.worldLoreEntryList.length && msg.worldLoreEntryList[0].lorebookId === lorebookId) {
				worldLoreEntryList = msg.worldLoreEntryList
				if (focusedEntry) {
					const updated = msg.worldLoreEntryList.find((e) => e.id === focusedEntry!.id)
					if (updated) focusedEntry = updated
				}
			}
			await tick()
		})

		socket.on("worldLoreEntries:create", (msg: Sockets.WorldLoreEntries.Create.Response) => {
			if (msg.worldLoreEntry?.lorebookId === lorebookId) {
				toaster.success({ title: "World Lore Entry created" })
			}
		})

		socket.on("worldLoreEntries:update", (msg: Sockets.WorldLoreEntries.Update.Response) => {
			if (msg.worldLoreEntry?.lorebookId === lorebookId) {
				toaster.success({ title: "World Lore Entry updated" })
			}
		})

		socket.on("worldLoreEntries:delete", (_msg: Sockets.WorldLoreEntries.Delete.Response) => {
			toaster.success({ title: "World Lore Entry deleted" })
		})

		socket.on("lorebooks:bindingList", async (msg: Sockets.Lorebooks.BindingList.Response) => {
			if (msg.lorebookId === lorebookId) {
				lorebookBindingList = [...msg.lorebookBindingList] as BindingWithRelations[]
			}
			await tick()
		})

		socket.on("worldLoreEntries:updatePositions", (msg: Sockets.WorldLoreEntries.UpdatePositions.Response) => {
			if (msg.success) toaster.success({ title: "Entries reordered" })
		})

		// The background vectorization queue updates a row's embeddingModel
		// directly in the DB — without this, the badge here only ever refreshes
		// on the next explicit CRUD action, leaving it stale until a manual refresh.
		socket.on(
			"vectorization:itemUpdated",
			(msg: Sockets.Vectorization.ItemUpdated.Response) => {
				if (msg.type !== "worldLore" || msg.lorebookId !== lorebookId) return
				const target = worldLoreEntryList.find((e: any) => e.id === msg.id)
				if (target) (target as any).embeddingModel = msg.embeddingModel
				if (focusedEntry?.id === msg.id)
					(focusedEntry as any).embeddingModel = msg.embeddingModel
			}
		)

		socket.emit("worldLoreEntries:list", { lorebookId } satisfies Sockets.WorldLoreEntries.List.Params)
		socket.emit("lorebooks:bindingList", { lorebookId } satisfies Sockets.Lorebooks.BindingList.Params)
		isReady = true
	})

	onDestroy(() => {
		hasUnsavedChanges = false
		socket.off("worldLoreEntries:list")
		socket.off("worldLoreEntries:create")
		socket.off("worldLoreEntries:update")
		socket.off("worldLoreEntries:delete")
		socket.off("lorebooks:bindingList")
		socket.off("worldLoreEntries:updatePositions")
		socket.off("vectorization:itemUpdated")
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
					disabled={worldLoreEntryList.length === 0}
					title="Reorder entries"
				>
					<Icons.SortAsc size={14} />
				</button>
				<button class="btn btn-sm preset-filled-success-500 shrink-0" onclick={createEntry}>
					<Icons.Plus size={14} /> New
				</button>
			</div>
		</div>

		<!-- Reorder panel -->
		{#if isReordering}
			<div class="flex flex-col gap-2">
				<div class="text-surface-500 text-xs font-semibold uppercase tracking-wide">
					Drag to reorder
				</div>
				<div
					use:dndzone={{
						items: worldLoreEntryList.slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
						flipDurationMs: 150,
						dragDisabled: false,
						dropFromOthersDisabled: true
					}}
					onconsider={(e) => {
						worldLoreEntryList = e.detail.items.map((item, idx) => ({ ...item, position: idx + 1 }))
					}}
					onfinalize={async (e) => {
						worldLoreEntryList = e.detail.items.map((item, idx) => ({ ...item, position: idx + 1 }))
						handleUpdateReorder(worldLoreEntryList)
					}}
					class="flex flex-col gap-1"
				>
					{#each worldLoreEntryList.slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0)) as entry (entry.id)}
						<div
							class="bg-surface-200-800 hover:bg-surface-300-700 flex cursor-grab items-center gap-2 rounded-md p-2 text-sm"
							data-dnd-handle
						>
							<Icons.GripVertical size={16} class="text-surface-400 shrink-0" />
							<span class="flex-1 truncate font-medium">{entry.name}</span>
							<span class="text-surface-500 text-xs">#{entry.position}</span>
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
			<p class="text-surface-500 py-6 text-center text-sm italic">No world lore entries yet.</p>
		{:else}
			{#each filteredEntries as entry}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<div
					role="button"
					tabindex="0"
					class="preset-filled-surface-100-900 hover:bg-surface-200-800 flex cursor-pointer items-start gap-2 rounded-lg p-3 transition-colors"
					class:opacity-50={!entry.enabled}
					onclick={() => viewEntry(entry)}
				>
					<div class="min-w-0 flex-1">
						<div class="mb-1 text-sm font-semibold truncate">{entry.name}</div>
						{#if entry.content?.trim()}
							<p class="text-surface-600-400 line-clamp-2 text-xs leading-relaxed whitespace-pre-wrap">
								{previewContent(entry)}
							</p>
						{:else}
							<p class="text-surface-500 text-xs italic">No content yet.</p>
						{/if}
						<div class="mt-1.5 flex flex-wrap items-center gap-1">
							<EmbeddingStatusIcon embeddingModel={entry.embeddingModel} size={12} />
							{#if !entry.enabled}
								<span class="preset-filled-error-500 rounded px-1.5 py-0.5 text-xs" title="Disabled">
									<Icons.Ghost size={11} class="inline" />
								</span>
							{/if}
							{#if entry.constant}
								<span class="preset-filled-warning-500 rounded px-1.5 py-0.5 text-xs" title="Pinned">
									<Icons.Pin size={11} class="inline" />
								</span>
							{:else if !vectorizationEnabled}
								<span
									class="rounded px-1.5 py-0.5 text-xs"
									class:preset-filled-success-500={entry.priority === 1}
									class:preset-filled-primary-500={entry.priority === 2}
									class:preset-filled-tertiary-500={entry.priority === 3}
									title={Priorities[(entry.priority ?? 1) - 1]?.label + " Priority"}
								>
									{#if entry.priority === 1}
										<Icons.Plus size={10} class="inline" />
									{:else if entry.priority === 2}
										<Icons.Plus size={10} class="inline" /><Icons.Plus size={10} class="inline" />
									{:else if entry.priority === 3}
										<Icons.Plus size={10} class="inline" /><Icons.Plus size={10} class="inline" /><Icons.Plus size={10} class="inline" />
									{/if}
								</span>
							{/if}
							{#if !vectorizationEnabled && entry.useRegex}
								<span class="preset-filled-primary-500 rounded px-1.5 py-0.5 text-xs" title="Regex keys">
									<Icons.Regex size={11} class="inline" />
								</span>
							{/if}
						</div>
					</div>

					<!-- ... menu -->
					<div role="none" onclick={(e) => e.stopPropagation()}>
					<Popover
						open={openMenuEntryId === entry.id}
						onOpenChange={(e) => (openMenuEntryId = e.open ? entry.id : null)}
						positioning={{ placement: "bottom-end" }}
					>
						<Popover.Trigger class="btn btn-sm preset-filled-surface-400-600 p-1 shrink-0">
							<Icons.Ellipsis size={16} />
						</Popover.Trigger>
						<Portal>
							<Popover.Positioner class="z-[1000]!">
								<Popover.Content class="card bg-surface-100-900 shadow-xl p-2 flex flex-col gap-1 min-w-32">
									<button
										class="btn btn-sm preset-filled-surface-400-600 w-full justify-start"
										onclick={(e) => { e.stopPropagation(); openMenuEntryId = null; viewEntry(entry) }}
									>
										<Icons.Eye size={14} /> View
									</button>
									<button
										class="btn btn-sm preset-filled-surface-400-600 w-full justify-start"
										onclick={(e) => { e.stopPropagation(); openMenuEntryId = null; editEntry(entry) }}
									>
										<Icons.Pencil size={14} /> Edit
									</button>
									<hr class="border-surface-300-700" />
									<button
										class="btn btn-sm preset-filled-error-500 w-full justify-start"
										onclick={(e) => { e.stopPropagation(); openMenuEntryId = null; onDeleteClick(entry.id) }}
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
	<div class="flex flex-col gap-4">
		<!-- Header -->
		<div class="flex items-center gap-2">
			<button class="btn btn-sm preset-filled-surface-400-600" onclick={goBack} aria-label="Back">
				<Icons.ChevronLeft size={16} />
			</button>
			<h3 class="flex-1 truncate font-semibold">{focusedEntry.name}</h3>
			<button class="btn btn-sm preset-filled-primary-500" onclick={() => editEntry(focusedEntry!)}>
				<Icons.Pencil size={14} /> Edit
			</button>
		</div>

		<div class="flex flex-col gap-3 text-sm">
			{#if focusedEntry.content?.trim()}
				<div>
					<p class="text-surface-500 mb-1 text-xs font-semibold uppercase tracking-wide">Content</p>
					<div class="whitespace-pre-wrap leading-relaxed">{previewContent(focusedEntry)}</div>
				</div>
			{:else}
				<p class="text-surface-500 italic">No content yet.</p>
			{/if}

			{#if !vectorizationEnabled && focusedEntry.keys?.trim()}
				<div>
					<p class="text-surface-500 mb-1 text-xs font-semibold uppercase tracking-wide">Keywords</p>
					<p>{focusedEntry.keys}</p>
				</div>
			{/if}

			<div class="flex flex-wrap items-center gap-2">
				<EmbeddingStatusIcon embeddingModel={focusedEntry.embeddingModel} size={14} />
				{#if !focusedEntry.enabled}
					<span class="preset-filled-error-500 rounded px-2 py-1 text-xs">
						<Icons.Ghost size={14} class="inline" /> Disabled
					</span>
				{/if}
				{#if focusedEntry.constant}
					<span class="preset-filled-warning-500 rounded px-2 py-1 text-xs">
						<Icons.Pin size={14} class="inline" /> Pinned
					</span>
				{:else if !vectorizationEnabled}
					<span
						class="rounded px-2 py-1 text-xs"
						class:preset-filled-success-500={focusedEntry.priority === 1}
						class:preset-filled-primary-500={focusedEntry.priority === 2}
						class:preset-filled-tertiary-500={focusedEntry.priority === 3}
					>
						{Priorities[(focusedEntry.priority ?? 1) - 1]?.label} Priority
					</span>
				{/if}
				{#if !vectorizationEnabled && focusedEntry.useRegex}
					<span class="preset-filled-primary-500 rounded px-2 py-1 text-xs">
						<Icons.Regex size={14} class="inline" /> Regex
					</span>
				{/if}
				{#if !vectorizationEnabled && focusedEntry.caseSensitive}
					<span class="preset-tonal-surface rounded px-2 py-1 text-xs">Case Sensitive</span>
				{/if}
			</div>
		</div>
	</div>


<!-- ═══════════════════════════════════════════════════════════════
     EDIT MODE
════════════════════════════════════════════════════════════════ -->
{:else if panelMode === "edit" && editingEntry}
	<div class="flex flex-col gap-4">
		<!-- Header with inline Cancel/Save -->
		<div class="flex items-center gap-2">
			<button class="btn btn-sm preset-filled-surface-400-600" onclick={goBack} aria-label="Back">
				<Icons.ChevronLeft size={16} />
			</button>
			<h3 class="flex-1 text-sm font-semibold">
				{isNewEntry ? "New World Lore Entry" : `Edit — ${focusedEntry?.name ?? "?"}`}
			</h3>
			<button class="btn btn-sm preset-filled-surface-400-600" onclick={goBack}>Cancel</button>
			<button
				class="btn btn-sm preset-filled-success-500"
				onclick={handleSave}
				disabled={!entryIsValid(editingEntry)}
			>
				<Icons.Save size={14} /> {isNewEntry ? "Create" : "Update"}
			</button>
		</div>

		<!-- Form fields -->
		<div class="flex flex-col gap-4">
			<!-- Name -->
			<div class="flex flex-col gap-1">
				<label class="flex items-center gap-1 text-sm font-semibold" for="wleName">
					Name <span class="text-error-500">*</span>
					<Icons.ScanEye size={13} class="text-surface-400 relative top-[1px]" />
				</label>
				<input
					id="wleName"
					class="input preset-filled-surface-200-800 w-full rounded-lg"
					type="text"
					bind:value={editingEntry.name}
					placeholder="Umber City"
					required
				/>
			</div>

			<!-- Content -->
			<div class="flex flex-col gap-1">
				<label class="flex items-center gap-1 text-sm font-semibold" for="wleContent">
					Content
					<Icons.ScanEye size={13} class="text-surface-400 relative top-[1px]" />
				</label>
				<LoreContentField bind:content={(editingEntry as any).content} bind:lorebookBindingList={(lorebookBindingList as any)} />
			</div>

			<!-- Keywords -->
			{#if !vectorizationEnabled}
				<div class="flex flex-col gap-1">
					<label class="text-sm font-semibold" for="wleKeys">
						Keywords <span class="text-surface-500 text-xs font-normal">(comma separated)</span>
					</label>
					<input
						id="wleKeys"
						class="input preset-filled-surface-200-800 w-full rounded-lg"
						type="text"
						bind:value={editingEntry.keys}
						placeholder="umber, umber city"
					/>
				</div>
			{/if}

			<!-- Advanced settings -->
			<details>
				<summary class="cursor-pointer text-sm font-semibold">Advanced Settings</summary>
				<div class="mt-2 flex flex-col gap-3 text-sm">
					{#if !vectorizationEnabled}
						<div class="flex w-full items-center justify-between gap-2">
							<label for="wleRegex">Use Regex</label>
							<Switch
								name="wleRegex"
								checked={editingEntry.useRegex || false}
								onCheckedChange={(e) => { if (editingEntry) editingEntry.useRegex = e.checked }}
							>
								<Switch.Control class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500">
									<Switch.Thumb />
								</Switch.Control>
								<Switch.HiddenInput />
							</Switch>
						</div>
						<div class="flex w-full items-center justify-between gap-2">
							<label for="wleCase">Case Sensitive</label>
							<Switch
								name="wleCase"
								checked={editingEntry.caseSensitive || false}
								onCheckedChange={(e) => { if (editingEntry) editingEntry.caseSensitive = e.checked }}
							>
								<Switch.Control class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500">
									<Switch.Thumb />
								</Switch.Control>
								<Switch.HiddenInput />
							</Switch>
						</div>
					{/if}
					<div class="flex w-full items-center justify-between gap-2">
						<label for="wlePinned">Pinned</label>
						<Switch
							name="wlePinned"
							checked={editingEntry.constant || false}
							onCheckedChange={(e) => { if (editingEntry) editingEntry.constant = e.checked }}
						>
							<Switch.Control class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500">
								<Switch.Thumb />
							</Switch.Control>
							<Switch.HiddenInput />
						</Switch>
					</div>
					<div class="flex w-full items-center justify-between gap-2">
						<label for="wleEnabled">Enabled</label>
						<Switch
							name="wleEnabled"
							checked={editingEntry.enabled !== false}
							onCheckedChange={(e) => { if (editingEntry) editingEntry.enabled = e.checked }}
						>
							<Switch.Control class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500">
								<Switch.Thumb />
							</Switch.Control>
							<Switch.HiddenInput />
						</Switch>
					</div>
					{#if !vectorizationEnabled}
						<div class="flex w-full items-center justify-between gap-2">
							<label for="wlePriority" class:opacity-50={editingEntry.constant}>Priority</label>
							<select
								id="wlePriority"
								class="select preset-filled-surface-200-800 w-max max-w-xs rounded-lg text-sm"
								bind:value={editingEntry.priority}
								disabled={editingEntry.constant || false}
							>
								{#each Priorities as priority}
									<option value={priority.value}>{priority.label}</option>
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
