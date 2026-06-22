<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { Popover } from "@skeletonlabs/skeleton-svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { getContext, onDestroy, onMount, tick } from "svelte"
	import EmbeddingStatusIcon from "$lib/client/components/EmbeddingStatusIcon.svelte"
	import LoreContentField from "./LoreContentField.svelte"
	import { v4 as uuid } from "uuid"
	import DeleteLorebookEntryConfirmModal from "../modals/DeleteLorebookEntryConfirmModal.svelte"
	import CompileHistoryEntryModal from "../modals/CompileHistoryEntryModal.svelte"

	interface Props {
		lorebookId: number
		hasUnsavedChanges: boolean
		/** Navigate directly to this history entry on mount / when changed */
		focusHistoryEntryId?: number
		/** Which tab to open when focusing an entry externally */
		focusEntryTab?: "content" | "scenes"
		/** Expand this scene ID within the scenes tab when focusing externally */
		focusSceneId?: number
		/** Called when the user wants to switch to the Graph tab */
		onNavigateToGraph?: () => void
	}

	const socket = useTypedSocket()

	let {
		lorebookId = $bindable(),
		hasUnsavedChanges = $bindable(false),
		focusHistoryEntryId,
		focusEntryTab,
		focusSceneId,
		onNavigateToGraph
	}: Props = $props()

	let systemSettingsCtx: SystemSettingsCtx = $state(getContext("systemSettingsCtx"))
	let vectorizationEnabled = $derived(systemSettingsCtx.settings?.vectorizationEnabled ?? false)

	const SORT_OPTIONS = [
		{ value: "entry-date-desc", label: "Entry Date ↑" },
		{ value: "entry-date-asc", label: "Entry Date ↓" },
		{ value: "created-desc", label: "Date Created ↑" },
		{ value: "created-asc", label: "Date Created ↓" },
		{ value: "updated-desc", label: "Date Updated ↑" },
		{ value: "updated-asc", label: "Date Updated ↓" }
	]

	const DefaultHistoryEntry: InsertHistoryEntry = {
		year: 1,
		month: null,
		day: null,
		content: "",
		keys: "",
		useRegex: false,
		caseSensitive: false,
		constant: false,
		enabled: true,
		isCompleted: false,
		lorebookId
	}

	// ── Core list state ───────────────────────────────────────────
	let historyEntryList: SelectHistoryEntry[] = $state([])
	type BindingWithRelations = SelectLorebookBinding & {
		character?: { nickname?: string | null; name: string } | null
		persona?: { name: string } | null
	}
	let lorebookBindingList: BindingWithRelations[] = $state([])
	let isReady = $state(false)
	let orderBy = $state("entry-date-desc")
	let search = $state("")

	// ── Panel mode: list → view → edit ────────────────────────────
	type PanelMode = "list" | "view" | "edit"
	let panelMode = $state<PanelMode>("list")
	let focusedEntry = $state<SelectHistoryEntry | null>(null)
	let focusedEntryTab = $state<"content" | "scenes">("content")
	/** Mutable copy being edited (includes new entries with _uuid) */
	let editingEntry = $state<(InsertHistoryEntry & { _uuid?: string }) | null>(null)
	let isNewEntry = $state(false)

	// ── Card `...` menu ───────────────────────────────────────────
	let openMenuEntryId = $state<number | null>(null)

	// ── Delete state ──────────────────────────────────────────────
	let deleteEntryId = $state<number | null>(null)
	let showDeleteConfirmModal = $state(false)

	// ── Scenes state ──────────────────────────────────────────────
	let sceneList = $state<Sockets.Scenes.SceneWithMeta[]>([])
	// Full scene edit form
	let editingSceneId = $state<number | null>(null)
	let editingSceneName = $state("")
	let editingSceneSummary = $state("")
	let expandedSceneIds = $state(new Set<number>())
	let showCompileModal = $state(false)
	let compileTargetEntry = $state<SelectHistoryEntry | null>(null)

	let scenesByEntryId = $derived.by(() => {
		const map = new Map<number, Sockets.Scenes.SceneWithMeta[]>()
		for (const scene of sceneList) {
			const key = scene.historyEntryId
			if (!map.has(key)) map.set(key, [])
			map.get(key)!.push(scene)
		}
		return map
	})

	// ── Unsaved changes ───────────────────────────────────────────
	$effect(() => {
		if (panelMode !== "edit" || !editingEntry) {
			hasUnsavedChanges = false
			return
		}
		if (isNewEntry) {
			hasUnsavedChanges = !!(editingEntry as any).content?.trim()
			return
		}
		const original = historyEntryList.find((e) => e.id === (editingEntry as any).id)
		hasUnsavedChanges = original
			? JSON.stringify(original) !== JSON.stringify(editingEntry)
			: false
	})

	// ── External focus (from chat scene/history-entry clicks) ────────
	let _lastFocusedEntryId = $state<number | undefined>(undefined)
	$effect(() => {
		const targetId = focusHistoryEntryId
		if (!targetId || targetId === _lastFocusedEntryId || !historyEntryList.length) return
		const entry = historyEntryList.find((e) => e.id === targetId)
		if (!entry) return
		_lastFocusedEntryId = targetId
		viewEntry(entry)
		if (focusEntryTab) focusedEntryTab = focusEntryTab
		if (focusSceneId) expandedSceneIds = new Set([focusSceneId, ...expandedSceneIds])
	})

	// ── List helpers ──────────────────────────────────────────────
	function getEntryDateValue(entry: SelectHistoryEntry) {
		return entry.year * 10000 + (entry.month || 0) * 100 + (entry.day || 0)
	}

	function getSortedEntries() {
		return historyEntryList.slice().sort((a, b) => {
			const getCreated = (e: SelectHistoryEntry) => new Date(e.createdAt || 0).getTime()
			const getUpdated = (e: SelectHistoryEntry) => new Date(e.updatedAt || 0).getTime()
			switch (orderBy) {
				case "entry-date-desc": return getEntryDateValue(b) - getEntryDateValue(a)
				case "entry-date-asc":  return getEntryDateValue(a) - getEntryDateValue(b)
				case "created-desc":    return getCreated(b) - getCreated(a)
				case "created-asc":     return getCreated(a) - getCreated(b)
				case "updated-desc":    return getUpdated(b) - getUpdated(a)
				case "updated-asc":     return getUpdated(a) - getUpdated(b)
				default:                return 0
			}
		})
	}

	function getFilteredEntries() {
		const lower = search.trim().toLowerCase()
		if (!lower) return getSortedEntries()
		return getSortedEntries().filter((entry) => {
			const content = (entry.content || "").toLowerCase()
			return content.includes(lower) || (entry.keys || "").toLowerCase().includes(lower)
		})
	}

	let filteredEntries: SelectHistoryEntry[] = $derived.by(() => getFilteredEntries())

	let maxDateValue = $derived.by(() => {
		if (filteredEntries.length === 0) return 0
		return Math.max(...filteredEntries.map((e) => getEntryDateValue(e)))
	})

	// ── Date-order bounds ─────────────────────────────────────────
	/** Encoded date: year×10000 + month×100 + day. Used for ordering. */
	function dateValue(year: number, month?: number | null, day?: number | null) {
		return year * 10000 + (month || 0) * 100 + (day || 0)
	}

	/** Human-readable date from an encoded value. */
	function formatDateValue(value: number): string {
		const y = Math.floor(value / 10000)
		const m = Math.floor((value % 10000) / 100)
		const d = value % 100
		return `Year ${y}${m ? `, Mo. ${m}` : ""}${d ? `, Day ${d}` : ""}`
	}

	/**
	 * When editing an existing entry, returns the exclusive (min, max) date values
	 * it must remain between to preserve chronological order.
	 * Returns (-Infinity, Infinity) for new entries or the only entry.
	 */
	let editBounds = $derived.by((): { min: number; max: number } => {
		if (isNewEntry || !focusedEntry || historyEntryList.length < 2) {
			return { min: -Infinity, max: Infinity }
		}
		const sorted = [...historyEntryList].sort(
			(a, b) => getEntryDateValue(a) - getEntryDateValue(b)
		)
		const idx = sorted.findIndex((e) => e.id === focusedEntry!.id)
		if (idx === -1) return { min: -Infinity, max: Infinity }
		const prev = idx > 0 ? sorted[idx - 1] : null
		const next = idx < sorted.length - 1 ? sorted[idx + 1] : null
		return {
			min: prev ? getEntryDateValue(prev) : -Infinity,
			max: next ? getEntryDateValue(next) : Infinity
		}
	})

	function previewContent(entry: SelectHistoryEntry): string {
		let content = entry.content || ""
		lorebookBindingList.forEach((binding) => {
			if (binding.characterId) {
				content = content.replaceAll(
					binding.binding,
					binding.character!.nickname || binding.character!.name || binding.binding
				)
			} else if (binding.personaId) {
				content = content.replaceAll(binding.binding, binding.persona!.name || binding.binding)
			}
		})
		return content
	}

	function entryIsValid(entry: InsertHistoryEntry | SelectHistoryEntry, warn = false): boolean {
		if (!entry.year) {
			if (warn) toaster.error({ title: "Year is required" })
			return false
		}
		if (!!entry.day && !entry.month) {
			if (warn) toaster.error({ title: "Month is required if day is set" })
			return false
		}
		if (!isNewEntry && focusedEntry) {
			const v = dateValue(entry.year, entry.month, entry.day)
			if (editBounds.min !== -Infinity && v <= editBounds.min) {
				if (warn) toaster.error({
					title: "Date would be out of order",
					description: `Must be after ${formatDateValue(editBounds.min)}`
				})
				return false
			}
			if (editBounds.max !== Infinity && v >= editBounds.max) {
				if (warn) toaster.error({
					title: "Date would be out of order",
					description: `Must be before ${formatDateValue(editBounds.max)}`
				})
				return false
			}
		}
		return true
	}

	// ── Navigation ────────────────────────────────────────────────
	function goBack() {
		panelMode = "list"
		focusedEntry = null
		focusedEntryTab = "content"
		editingEntry = null
		isNewEntry = false
	}

	function viewEntry(entry: SelectHistoryEntry) {
		focusedEntry = entry
		focusedEntryTab = "content"
		panelMode = "view"
	}

	function editEntry(entry: SelectHistoryEntry) {
		focusedEntry = entry
		editingEntry = { ...entry }
		focusedEntryTab = "content"
		panelMode = "edit"
	}

	function createEntry() {
		focusedEntry = null
		editingEntry = { ...DefaultHistoryEntry, _uuid: uuid() }
		isNewEntry = true
		focusedEntryTab = "content"
		panelMode = "edit"
	}

	// ── Save / Delete ─────────────────────────────────────────────
	function handleSave() {
		if (!editingEntry || !entryIsValid(editingEntry, true)) return

		const data = {
			...editingEntry,
			lorebookId,
			month: editingEntry.month === 0 ? null : editingEntry.month,
			day:   editingEntry.day   === 0 ? null : editingEntry.day,
			_uuid: undefined
		}

		if (isNewEntry) {
			socket.emit("historyEntries:create", { historyEntry: data as InsertHistoryEntry })
		} else {
			socket.emit("historyEntries:update", { historyEntry: data as UpdateHistoryEntry })
		}
		goBack()
	}

	function onDeleteClick(id: number) {
		deleteEntryId = id
		showDeleteConfirmModal = true
	}

	function onDeleteConfirm() {
		showDeleteConfirmModal = false
		socket.emit("historyEntries:delete", { id: deleteEntryId, lorebookId })
		// If we were viewing/editing this entry, go back to list
		if (focusedEntry?.id === deleteEntryId) goBack()
		deleteEntryId = null
	}

	function onDeleteCancel() {
		showDeleteConfirmModal = false
		deleteEntryId = null
	}

	function onClickIterateNextEntry() {
		if (filteredEntries.length === 0) {
			toaster.error({ title: "No entries found", description: "Create at least one entry before using Next Date." })
			return
		}
		const latestEntry = filteredEntries.reduce((max, entry) =>
			getEntryDateValue(entry) > getEntryDateValue(max) ? entry : max, filteredEntries[0])
		socket.emit("historyEntries:iterateNext", { id: latestEntry.id } satisfies Sockets.HistoryEntries.IterateNext.Params)
	}

	// ── Scene actions ─────────────────────────────────────────────
	function fetchScenes() {
		socket.emit("scenes:listByLorebook", { lorebookId } satisfies Sockets.Scenes.ListByLorebook.Params)
	}

	function deleteScene(sceneId: number) {
		socket.emit("scenes:delete", { id: sceneId } satisfies Sockets.Scenes.Delete.Params)
		if (editingSceneId === sceneId) editingSceneId = null
	}

	function startEditScene(scene: Sockets.Scenes.SceneWithMeta) {
		editingSceneId = scene.id
		editingSceneName = scene.name ?? ""
		editingSceneSummary = scene.summary ?? ""
	}

	function saveEditScene() {
		if (editingSceneId === null) return
		socket.emit("scenes:update", {
			scene: {
				id: editingSceneId,
				name: editingSceneName.trim() || null,
				summary: editingSceneSummary.trim() || null
			}
		} satisfies Sockets.Scenes.Update.Params)
		editingSceneId = null
	}

	function cancelEditScene() {
		editingSceneId = null
	}

	function toggleExpandScene(sceneId: number) {
		if (expandedSceneIds.has(sceneId)) {
			expandedSceneIds.delete(sceneId)
		} else {
			expandedSceneIds.add(sceneId)
		}
		expandedSceneIds = new Set(expandedSceneIds)
	}

	function openCompileModal(entry: SelectHistoryEntry) {
		compileTargetEntry = entry
		showCompileModal = true
	}

	function handleCompileSaved(updated: SelectHistoryEntry) {
		historyEntryList = historyEntryList.map((e) => (e.id === updated.id ? updated : e))
		if (focusedEntry?.id === updated.id) focusedEntry = updated
	}

	// ── Socket setup ──────────────────────────────────────────────
	onMount(() => {
		socket.on("historyEntries:list", async (msg: Sockets.HistoryEntries.List.Response) => {
			if (msg.historyEntryList.length && msg.historyEntryList[0].lorebookId === lorebookId) {
				historyEntryList = msg.historyEntryList
				// Keep focusedEntry in sync
				if (focusedEntry) {
					const updated = msg.historyEntryList.find((e: SelectHistoryEntry) => e.id === focusedEntry!.id)
					if (updated) focusedEntry = updated
				}
			}
			await tick()
		})

		socket.on("historyEntries:create", (msg: Sockets.HistoryEntries.Create.Response) => {
			if (msg.historyEntry?.lorebookId === lorebookId) {
				toaster.success({ title: "History Entry created" })
			}
		})

		socket.on("historyEntries:update", (msg: Sockets.HistoryEntries.Update.Response) => {
			if (msg.historyEntry?.lorebookId === lorebookId) {
				toaster.success({ title: "History Entry updated" })
			}
		})

		socket.on("historyEntries:delete", (msg: Sockets.HistoryEntries.Delete.Response) => {
			if ((msg as any).id && historyEntryList.some((e) => e.id === (msg as any).id)) {
				toaster.success({ title: "History Entry deleted" })
			}
		})

		socket.on("lorebooks:bindingList", async (msg: Sockets.Lorebooks.BindingList.Response) => {
			if (msg.lorebookId === lorebookId) {
				lorebookBindingList = [...msg.lorebookBindingList] as BindingWithRelations[]
			}
			await tick()
		})

		socket.on("historyEntries:iterateNext", (_msg: Sockets.HistoryEntries.IterateNext.Response) => {
			toaster.success({ title: "The story's date has moved forward" })
		})

		socket.on("scenes:listByLorebook", (msg: Sockets.Scenes.ListByLorebook.Response) => {
			sceneList = msg.sceneList
		})

		socket.on("scenes:update", (msg: Sockets.Scenes.Update.Response) => {
			if (msg.scene) {
				sceneList = sceneList.map((s) => (s.id === msg.scene.id ? { ...s, ...msg.scene } : s))
			}
		})

		socket.on("scenes:delete", (_msg: Sockets.Scenes.Delete.Response) => { fetchScenes() })
		socket.on("scenes:create", (_msg: Sockets.Scenes.Create.Response) => { fetchScenes() })

		socket.emit("historyEntries:list", { lorebookId } satisfies Sockets.HistoryEntries.List.Params)
		socket.emit("lorebooks:bindingList", { lorebookId } satisfies Sockets.Lorebooks.BindingList.Params)
		fetchScenes()
		isReady = true
	})

	onDestroy(() => {
		hasUnsavedChanges = false
		socket.off("historyEntries:list")
		socket.off("historyEntries:create")
		socket.off("historyEntries:update")
		socket.off("historyEntries:delete")
		socket.off("lorebooks:bindingList")
		socket.off("historyEntries:iterateNext")
		socket.off("scenes:listByLorebook")
		socket.off("scenes:update")
		socket.off("scenes:delete")
		socket.off("scenes:create")
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
				<button class="btn btn-sm preset-filled-primary-500" onclick={onClickIterateNextEntry} title="Add the next date in sequence">
					<Icons.CalendarPlus size={14} />
				</button>
				<button class="btn btn-sm preset-filled-success-500" onclick={createEntry}>
					<Icons.Plus size={14} /> New
				</button>
			</div>
		</div>

		<!-- Entry cards -->
		{#if filteredEntries.length === 0}
			<p class="text-surface-500 py-6 text-center text-sm italic">No history entries yet.</p>
		{:else}
			{#each filteredEntries as entry}
				{@const entryScenes = scenesByEntryId.get(entry.id) ?? []}
				{@const isMaxDate = getEntryDateValue(entry) === maxDateValue}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<div
					role="button"
					tabindex="0"
					class="preset-filled-surface-100-900 hover:bg-surface-200-800 flex cursor-pointer items-start gap-2 rounded-lg p-3 transition-colors"
					class:opacity-50={!entry.enabled}
					onclick={() => viewEntry(entry)}
				>
					<!-- Main info -->
					<div class="min-w-0 flex-1">
						<div class="mb-1 flex flex-wrap items-center gap-2 text-sm font-semibold">
							<span>
								Year {entry.year}{entry.month ? `, Mo. ${entry.month}` : ""}{entry.day ? `, Day ${entry.day}` : ""}
							</span>
							{#if isMaxDate}
								<span class="text-tertiary-500 text-xs font-normal">(Current)</span>
							{/if}
						</div>
						{#if entry.content?.trim()}
							<p class="text-surface-600-400 line-clamp-2 text-xs leading-relaxed whitespace-pre-wrap">
								{previewContent(entry)}
							</p>
						{:else}
							<p class="text-surface-500 text-xs italic">No content yet.</p>
						{/if}
						<!-- Status / meta badges -->
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
							{/if}
							{#if !vectorizationEnabled && entry.useRegex}
								<span class="preset-filled-primary-500 rounded px-1.5 py-0.5 text-xs" title="Regex keys">
									<Icons.Regex size={11} class="inline" />
								</span>
							{/if}
							{#if entryScenes.length > 0}
								<span class="preset-tonal-secondary rounded px-1.5 py-0.5 text-xs">
									<Icons.Film size={11} class="inline" /> {entryScenes.length}
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
						triggerBase="btn btn-sm preset-tonal-surface p-1 shrink-0"
						contentBase="card bg-surface-100-900 shadow-xl p-2 flex flex-col gap-1 min-w-32"
						zIndex="1000"
					>
						{#snippet trigger()}
							<Icons.Ellipsis size={16} />
						{/snippet}
						{#snippet content()}
							<button
								class="btn btn-sm preset-tonal-surface w-full justify-start"
								onclick={(e) => { e.stopPropagation(); openMenuEntryId = null; viewEntry(entry) }}
							>
								<Icons.Eye size={14} /> View
							</button>
							<button
								class="btn btn-sm preset-tonal-surface w-full justify-start"
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
						{/snippet}
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
	{@const viewScenes = scenesByEntryId.get(focusedEntry.id) ?? []}
	<div class="flex flex-col gap-4">
		<!-- Header -->
		<div class="flex items-center gap-2">
			<button class="btn btn-sm preset-tonal-surface p-2" onclick={goBack}>
				<Icons.ChevronLeft size={16} />
			</button>
			<h3 class="flex-1 font-semibold">
				Year {focusedEntry.year}{focusedEntry.month ? `, Month ${focusedEntry.month}` : ""}{focusedEntry.day ? `, Day ${focusedEntry.day}` : ""}
			</h3>
			<button class="btn btn-sm preset-filled-primary-500" onclick={() => editEntry(focusedEntry!)}>
				<Icons.Pencil size={14} /> Edit
			</button>
		</div>

		<!-- Content | Scenes tabs -->
		<div class="flex gap-1 border-b border-surface-300-700 pb-1">
			<button
				class="btn btn-sm {focusedEntryTab === 'content' ? 'preset-filled-primary-500' : 'preset-tonal-surface'}"
				onclick={() => (focusedEntryTab = "content")}
			>
				Content
			</button>
			<button
				class="btn btn-sm {focusedEntryTab === 'scenes' ? 'preset-filled-primary-500' : 'preset-tonal-surface'}"
				onclick={() => (focusedEntryTab = "scenes")}
			>
				<Icons.Film size={13} /> Scenes
				{#if viewScenes.length > 0}
					<span class="badge-icon preset-filled-secondary-500 ml-1 h-4 min-w-4 rounded-full text-xs">{viewScenes.length}</span>
				{/if}
			</button>
		</div>

		<!-- Content tab -->
		{#if focusedEntryTab === "content"}
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
				<!-- Status flags -->
				<div class="flex flex-wrap items-center gap-2">
					<EmbeddingStatusIcon embeddingModel={focusedEntry.embeddingModel} size={14} />
					{#if !focusedEntry.enabled}
						<span class="preset-filled-error-500 rounded px-2 py-1 text-xs" title="Disabled from prompts">
							<Icons.Ghost size={14} class="inline" /> Disabled
						</span>
					{/if}
					{#if focusedEntry.constant}
						<span class="preset-filled-warning-500 rounded px-2 py-1 text-xs" title="Always included">
							<Icons.Pin size={14} class="inline" /> Pinned
						</span>
					{/if}
					{#if !vectorizationEnabled && focusedEntry.useRegex}
						<span class="preset-filled-primary-500 rounded px-2 py-1 text-xs">
							<Icons.Regex size={14} class="inline" /> Regex
						</span>
					{/if}
				</div>
			</div>

		<!-- Scenes tab -->
		{:else}
			{@const ungraphedSummarized = viewScenes.filter((s) => !s.graphed && s.summary)}
			<div class="flex flex-col gap-2">
				{#if ungraphedSummarized.length > 0 && onNavigateToGraph}
					<button
						class="btn btn-sm preset-tonal-secondary w-full"
						onclick={onNavigateToGraph}
						title="{ungraphedSummarized.length} scene{ungraphedSummarized.length === 1 ? '' : 's'} ready to graph"
					>
						<Icons.GitGraph size={13} /> Build Graph ({ungraphedSummarized.length} ready)
					</button>
				{/if}
				{#if viewScenes.length === 0}
					<p class="text-surface-500 py-4 text-center text-xs italic">
						No scenes captured for this entry yet.
					</p>
				{:else}
					{#each viewScenes as scene}
						{@const isExpanded = expandedSceneIds.has(scene.id)}
						<div class="bg-surface-200-800 rounded-md">
							<!-- Scene header row (always visible) -->
							<button
								class="flex w-full items-center gap-2 p-2 text-left text-sm"
								onclick={() => toggleExpandScene(scene.id)}
							>
								<Icons.ChevronRight
									size={14}
									class="shrink-0 transition-transform {isExpanded ? 'rotate-90' : ''}"
								/>
								<span class="flex-1 truncate font-medium">
									{scene.name ?? "Unnamed Scene"}
								</span>
								{#if scene.chatName}
									<span class="text-surface-500 shrink-0 text-xs">
										<Icons.MessageSquare size={11} class="inline" /> {scene.chatName}
									</span>
								{/if}
								{#if scene.selectedMessageIds?.length}
									<span class="badge preset-tonal-surface shrink-0 text-xs">
										{scene.selectedMessageIds.length} msg
									</span>
								{/if}
								{#if scene.graphed}
									<span class="text-success-500 shrink-0" title="Added to graph">
										<Icons.GitGraph size={12} />
									</span>
								{/if}
							</button>
							<!-- Expanded summary -->
							{#if isExpanded}
								<div class="border-surface-300-700 border-t px-3 pb-3 pt-2">
									{#if scene.summary}
										<p class="text-surface-700-300 whitespace-pre-wrap text-xs leading-relaxed">
											{scene.summary}
										</p>
									{:else}
										<p class="text-surface-500 text-xs italic">No summary.</p>
									{/if}
								</div>
							{/if}
						</div>
					{/each}
					<button
						class="btn btn-sm preset-filled-secondary-500 mt-1 w-full"
						onclick={() => openCompileModal(focusedEntry!)}
					>
						<Icons.Wand size={14} /> Compile to Entry
					</button>
				{/if}
			</div>
		{/if}
	</div>


<!-- ═══════════════════════════════════════════════════════════════
     EDIT MODE
════════════════════════════════════════════════════════════════ -->
{:else if panelMode === "edit" && editingEntry}
	{@const editScenes = focusedEntry ? (scenesByEntryId.get(focusedEntry.id) ?? []) : []}
	<div class="flex flex-col gap-4">
		<!-- Header with inline Cancel/Save -->
		<div class="flex items-center gap-2">
			<button class="btn btn-sm preset-tonal-surface p-2" onclick={goBack}>
				<Icons.ChevronLeft size={16} />
			</button>
			<h3 class="flex-1 text-sm font-semibold">
				{isNewEntry ? "New History Entry" : `Edit — Year ${focusedEntry?.year ?? "?"}`}
			</h3>
			<button
				class="btn btn-sm preset-filled-success-500"
				onclick={handleSave}
				disabled={!entryIsValid(editingEntry)}
			>
				<Icons.Save size={14} /> Save
			</button>
		</div>

		<!-- Content | Scenes tabs (scenes only available when editing existing entry) -->
		<div class="flex gap-1 border-b border-surface-300-700 pb-1">
			<button
				class="btn btn-sm {focusedEntryTab === 'content' ? 'preset-filled-primary-500' : 'preset-tonal-surface'}"
				onclick={() => (focusedEntryTab = "content")}
			>
				Content
			</button>
			{#if !isNewEntry}
				<button
					class="btn btn-sm {focusedEntryTab === 'scenes' ? 'preset-filled-primary-500' : 'preset-tonal-surface'}"
					onclick={() => (focusedEntryTab = "scenes")}
				>
					<Icons.Film size={13} /> Scenes
					{#if editScenes.length > 0}
						<span class="badge-icon preset-filled-secondary-500 ml-1 h-4 min-w-4 rounded-full text-xs">{editScenes.length}</span>
					{/if}
				</button>
			{/if}
		</div>

		<!-- Content form tab -->
		{#if focusedEntryTab === "content"}
			<div class="flex flex-col gap-4">
				<!-- Date fields -->
				<div class="flex flex-col gap-1">
					<div class="flex gap-2">
						<div class="flex flex-col gap-1">
							<label class="flex items-center gap-1 text-sm font-semibold" for="editYear">
								Year <Icons.ScanEye size={13} class="text-surface-400 relative top-[1px]" />
							</label>
							<input id="editYear" class="input preset-filled-surface-200-800 w-full rounded-lg" type="number"
								bind:value={editingEntry.year} required placeholder="2055" />
						</div>
						<div class="flex flex-col gap-1">
							<label class="flex items-center gap-1 text-sm font-semibold" for="editMonth">
								Month <Icons.ScanEye size={13} class="text-surface-400 relative top-[1px]" />
							</label>
							<input id="editMonth" class="input preset-filled-surface-200-800 w-full rounded-lg" type="number"
								bind:value={editingEntry.month} placeholder="3" />
						</div>
						<div class="flex flex-col gap-1">
							<label class="flex items-center gap-1 text-sm font-semibold" for="editDay">
								Day <Icons.ScanEye size={13} class="text-surface-400 relative top-[1px]" />
							</label>
							<input id="editDay" class="input preset-filled-surface-200-800 w-full rounded-lg" type="number"
								bind:value={editingEntry.day} placeholder="1" />
						</div>
					</div>
					{#if !isNewEntry && (editBounds.min !== -Infinity || editBounds.max !== Infinity)}
						<p class="text-surface-500 text-xs">
							{#if editBounds.min !== -Infinity && editBounds.max !== Infinity}
								Must be between {formatDateValue(editBounds.min)} and {formatDateValue(editBounds.max)}
							{:else if editBounds.min !== -Infinity}
								Must be after {formatDateValue(editBounds.min)}
							{:else}
								Must be before {formatDateValue(editBounds.max)}
							{/if}
						</p>
					{/if}
				</div>

				<!-- Content -->
				<div class="flex flex-col gap-1">
					<label class="flex items-center gap-1 text-sm font-semibold" for="editContent">
						Content <Icons.ScanEye size={13} class="text-surface-400 relative top-[1px]" />
					</label>
					<LoreContentField bind:content={(editingEntry as any).content} bind:lorebookBindingList={(lorebookBindingList as any)} />
				</div>

				<!-- Keywords -->
				{#if !vectorizationEnabled}
					<div class="flex flex-col gap-1">
						<label class="flex items-center gap-1 text-sm font-semibold" for="editKeys">
							Keywords <span class="text-surface-500 text-xs font-normal">(comma separated)</span>
						</label>
						<input id="editKeys" class="input preset-filled-surface-200-800 w-full rounded-lg" type="text"
							bind:value={editingEntry.keys} placeholder="umber, umber city" />
					</div>
				{/if}

				<!-- Advanced settings -->
				<details>
					<summary class="cursor-pointer text-sm font-semibold">Advanced Settings</summary>
					<div class="mt-2 flex flex-col gap-2 text-sm">
						{#if !vectorizationEnabled}
							<label class="flex w-full cursor-pointer items-center justify-between gap-2">
								<span>Use Regex</span>
								<input type="checkbox" class="checkbox" checked={!!editingEntry.useRegex}
									onchange={(e) => { if (editingEntry) editingEntry.useRegex = e.currentTarget.checked }} />
							</label>
							<label class="flex w-full cursor-pointer items-center justify-between gap-2">
								<span>Case Sensitive</span>
								<input type="checkbox" class="checkbox" checked={!!editingEntry.caseSensitive}
									onchange={(e) => { if (editingEntry) editingEntry.caseSensitive = e.currentTarget.checked }} />
							</label>
						{/if}
						<label class="flex w-full cursor-pointer items-center justify-between gap-2">
							<span>Pinned</span>
							<input type="checkbox" class="checkbox" checked={!!editingEntry.constant}
								onchange={(e) => { if (editingEntry) editingEntry.constant = e.currentTarget.checked }} />
						</label>
						<label class="flex w-full cursor-pointer items-center justify-between gap-2">
							<span>Enabled</span>
							<input type="checkbox" class="checkbox" checked={!!editingEntry.enabled}
								onchange={(e) => { if (editingEntry) editingEntry.enabled = e.currentTarget.checked }} />
						</label>
						<label class="flex w-full cursor-pointer items-center justify-between gap-2">
							<span>Completed</span>
							<input type="checkbox" class="checkbox" checked={!!editingEntry.isCompleted}
								onchange={(e) => { if (editingEntry) editingEntry.isCompleted = e.currentTarget.checked }} />
						</label>
					</div>
				</details>
			</div>

		<!-- Scenes tab (edit mode) -->
		{:else}
			{@const ungraphedSummarizedEdit = editScenes.filter((s) => !s.graphed && s.summary)}
			<div class="flex flex-col gap-2">
				{#if ungraphedSummarizedEdit.length > 0 && onNavigateToGraph}
					<button
						class="btn btn-sm preset-tonal-secondary w-full"
						onclick={onNavigateToGraph}
						title="{ungraphedSummarizedEdit.length} scene{ungraphedSummarizedEdit.length === 1 ? '' : 's'} ready to graph"
					>
						<Icons.GitGraph size={13} /> Build Graph ({ungraphedSummarizedEdit.length} ready)
					</button>
				{/if}
				{#if editScenes.length === 0}
					<p class="text-surface-500 py-4 text-center text-xs italic">
						No scenes captured for this entry yet. Capture scenes from the chat page.
					</p>
				{:else}
					{#each editScenes as scene}
						<div class="bg-surface-200-800 flex flex-col gap-2 rounded-md p-2 text-sm">
							{#if editingSceneId === scene.id}
								<!-- Full edit form -->
								<div class="flex flex-col gap-2">
									<input
										class="input input-sm w-full text-sm"
										type="text"
										placeholder="Scene name"
										bind:value={editingSceneName}
									/>
									<textarea
										class="textarea min-h-24 text-xs"
										placeholder="Scene summary…"
										bind:value={editingSceneSummary}
									></textarea>
									<div class="flex justify-end gap-2">
										<button class="btn btn-sm preset-tonal-surface" onclick={cancelEditScene}>
											Cancel
										</button>
										<button class="btn btn-sm preset-filled-success-500" onclick={saveEditScene}>
											<Icons.Save size={13} /> Save
										</button>
									</div>
								</div>
							{:else}
								<!-- Read-only card -->
								<div class="flex items-center gap-2">
									<span class="flex-1 truncate font-medium">
										{scene.name ?? "Unnamed Scene"}
									</span>
									{#if scene.chatName}
										<span class="text-surface-500 shrink-0 text-xs">
											<Icons.MessageSquare size={12} class="inline" /> {scene.chatName}
										</span>
									{/if}
									{#if scene.selectedMessageIds?.length}
										<span class="badge preset-tonal-surface shrink-0 text-xs">
											{scene.selectedMessageIds.length} msg
										</span>
									{/if}
									{#if scene.graphed}
										<span class="text-success-500 shrink-0" title="Added to graph">
											<Icons.GitGraph size={12} />
										</span>
									{/if}
									<button
										class="btn btn-sm preset-tonal-surface shrink-0 p-1"
										onclick={() => startEditScene(scene)}
										title="Edit scene"
									>
										<Icons.Pencil size={13} />
									</button>
									<button
										class="btn btn-sm preset-filled-error-500 shrink-0 p-1"
										onclick={() => deleteScene(scene.id)}
										title="Delete scene"
									>
										<Icons.Trash2 size={14} />
									</button>
								</div>
								<!-- Summary snippet -->
								{#if scene.summary}
									<p class="text-surface-600-400 line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed">
										{scene.summary}
									</p>
								{:else}
									<p class="text-surface-500 text-xs italic">No summary.</p>
								{/if}
							{/if}
						</div>
					{/each}
				{/if}
				<button
					class="btn btn-sm preset-filled-secondary-500 w-full"
					onclick={() => focusedEntry && openCompileModal(focusedEntry)}
					disabled={editScenes.length === 0}
					title={editScenes.length === 0 ? "No scenes to compile" : "Compile scenes into this history entry"}
				>
					<Icons.Wand size={14} /> Compile to Entry
				</button>
			</div>
		{/if}

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

{#if compileTargetEntry}
	<CompileHistoryEntryModal
		open={showCompileModal}
		onOpenChange={(e) => {
			showCompileModal = e.open
			if (!e.open) compileTargetEntry = null
		}}
		historyEntry={compileTargetEntry}
		onSaved={handleCompileSaved}
	/>
{/if}
