<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import PanelNavHeader from "$lib/client/components/panels/PanelNavHeader.svelte"
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { getContext, onDestroy, onMount, tick } from "svelte"
	import EmbeddingStatusIcon from "$lib/client/components/EmbeddingStatusIcon.svelte"
	import LoreContentField from "./LoreContentField.svelte"
	import EntryConditionField from "./EntryConditionField.svelte"
	import EntryFireTest from "./EntryFireTest.svelte"
	import { Switch } from "@skeletonlabs/skeleton-svelte"
	import { v4 as uuid } from "uuid"
	import { dndzone } from "svelte-dnd-action"
	import DeleteLorebookEntryConfirmModal from "../modals/DeleteLorebookEntryConfirmModal.svelte"
	import { Priorities } from "$lib/shared/constants/Priorities"
	import {
		WORLD_LORE_TYPE_ID,
		type LorebookEntry,
		type NewLorebookEntry
	} from "$lib/shared/entries/types"
	import {
		ENTRY_SORT_OPTIONS,
		compareEntriesBy,
		entryChannel,
		filterEntriesBySearch,
		substituteBindings,
		type BindingWithRelations
	} from "./entryManager"

	/** This tab's one type. It is never rendered; it addresses the namespace. */
	type WorldLore = LorebookEntry<typeof WORLD_LORE_TYPE_ID>

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

	const SORT_OPTIONS = ENTRY_SORT_OPTIONS

	const DefaultWorldEntry: NewLorebookEntry<typeof WORLD_LORE_TYPE_ID> = {
		typeId: WORLD_LORE_TYPE_ID,
		name: "",
		content: "",
		keys: "",
		// The absence of a condition, spelled the way the column stores it:
		// no keys and no mode. Either one alone is a rule about nothing.
		secondaryKeys: "",
		selectiveLogic: null,
		useRegex: false,
		caseSensitive: false,
		constant: false,
		enabled: true,
		priority: 1,
		lorebookId
	}

	// ── Core list state ────────────────────────────────────────────
	let worldLoreEntryList: WorldLore[] = $state([])
	let lorebookBindingList: BindingWithRelations[] = $state([])
	let isReady = $state(false)
	let orderBy = $state("position-asc")
	let search = $state("")

	// ── Panel mode: list → view → edit ─────────────────────────────
	type PanelMode = "list" | "view" | "edit"
	let panelMode = $state<PanelMode>("list")
	let focusedEntry = $state<WorldLore | null>(null)
	let editingEntry = $state<
		| (NewLorebookEntry<typeof WORLD_LORE_TYPE_ID> & {
				id?: number
				_uuid?: string
		  })
		| null
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
		const original = worldLoreEntryList.find(
			(e) => e.id === (editingEntry as any).id
		)
		hasUnsavedChanges = original
			? JSON.stringify(original) !== JSON.stringify(editingEntry)
			: false
	})

	// ── List helpers ───────────────────────────────────────────────
	// Sorting, searching and `{{char:N}}` preview substitution were identical
	// in all three managers; they live in `entryManager.ts` now and this tab
	// borrows them. What stays here is what is curated: which sort this tab
	// offers, and what "valid" means for a *named* entry.
	let filteredEntries: WorldLore[] = $derived(
		filterEntriesBySearch(
			worldLoreEntryList.slice().sort(compareEntriesBy(orderBy)),
			search
		)
	)

	function previewContent(entry: WorldLore): string {
		return substituteBindings(entry.content, lorebookBindingList)
	}

	function entryIsValid(
		entry: { name?: string | null },
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

	function viewEntry(entry: WorldLore) {
		focusedEntry = entry
		panelMode = "view"
	}

	function editEntry(entry: WorldLore) {
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
		const { _uuid, ...data } = editingEntry
		if (isNewEntry) channel.create(data)
		else channel.update(data as typeof data & { id: number })
		goBack()
	}

	function onDeleteClick(id: number) {
		deleteEntryId = id
		showDeleteConfirmModal = true
	}

	function onDeleteConfirm() {
		showDeleteConfirmModal = false
		channel.remove(deleteEntryId!)
		if (focusedEntry?.id === deleteEntryId) goBack()
		deleteEntryId = null
	}

	function onDeleteCancel() {
		showDeleteConfirmModal = false
		deleteEntryId = null
	}

	// ── Reorder ────────────────────────────────────────────────────
	function handleUpdateReorder(entries: WorldLore[]) {
		channel.reorder(entries.map((e, i) => ({ id: e.id, position: i + 1 })))
	}

	// ── Socket setup ───────────────────────────────────────────────
	const channel = entryChannel(socket, {
		lorebookId,
		typeId: WORLD_LORE_TYPE_ID,
		// The band the vectorizer reports this type's rows under, which is the
		// ranking vocabulary rather than the type id.
		vectorSource: "worldLore",
		handlers: {
			async onList(entries) {
				worldLoreEntryList = entries
				if (focusedEntry) {
					const updated = entries.find(
						(e) => e.id === focusedEntry!.id
					)
					if (updated) focusedEntry = updated
				}
				await tick()
			},
			async onBindings(bindings) {
				lorebookBindingList = bindings
				await tick()
			},
			// The background vectorization queue updates a row's
			// `embeddingModel` directly in the database — without this the
			// badge here only refreshes on the next explicit CRUD action.
			onVectorized(id, embeddingModel) {
				const target = worldLoreEntryList.find((e) => e.id === id)
				if (target) (target as any).embeddingModel = embeddingModel
				if (focusedEntry?.id === id)
					(focusedEntry as any).embeddingModel = embeddingModel
			},
			onCreated: () =>
				toaster.success({ title: "World Lore Entry created" }),
			onUpdated: () =>
				toaster.success({ title: "World Lore Entry updated" }),
			onDeleted: () =>
				toaster.success({ title: "World Lore Entry deleted" }),
			onReordered: () => toaster.success({ title: "Entries reordered" })
		}
	})

	onMount(() => {
		channel.open()
		isReady = true
	})

	onDestroy(() => {
		hasUnsavedChanges = false
		channel.close()
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
							items: worldLoreEntryList
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
							worldLoreEntryList = e.detail.items.map(
								(item, idx) => ({ ...item, position: idx + 1 })
							)
						}}
						onfinalize={async (e) => {
							worldLoreEntryList = e.detail.items.map(
								(item, idx) => ({ ...item, position: idx + 1 })
							)
							handleUpdateReorder(worldLoreEntryList)
						}}
						class="flex flex-col gap-1"
					>
						{#each worldLoreEntryList
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
					No world lore entries yet.
				</p>
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
							<div class="mb-1 truncate text-sm font-semibold">
								{entry.name}
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
		<div class="flex flex-col gap-4">
			<!-- Header -->
			<PanelNavHeader
				title={focusedEntry.name ?? ""}
				onBack={goBack}
				backLabel="Back"
				headingLevel={3}
				actionsLabel="World lore entry"
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

				<!-- Sited in the view rather than the editor: the pipeline
				     gathers lore out of the database, so this reports on the
				     saved row and an unsaved draft has no verdict to give. -->
				<EntryFireTest
					entryId={focusedEntry.id}
					typeId={WORLD_LORE_TYPE_ID}
					{lorebookId}
					enabled={!!focusedEntry.enabled}
				/>
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
					? "New World Lore Entry"
					: `Edit — ${focusedEntry?.name ?? "?"}`}
				onBack={goBack}
				backLabel="Back"
				headingLevel={3}
				titleClass="text-sm"
				actionsLabel="Edit world lore entry"
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
						for="wleName"
					>
						Name <span class="text-error-500">*</span>
						<Icons.ScanEye
							size={13}
							class="text-surface-400 relative top-[1px]"
						/>
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
					<label
						class="flex items-center gap-1 text-sm font-semibold"
						for="wleContent"
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
						<label class="text-sm font-semibold" for="wleKeys">
							Keywords <span
								class="text-surface-700-300 text-xs font-normal"
							>
								(comma separated)
							</span>
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
					<summary class="cursor-pointer text-sm font-semibold">
						Advanced Settings
					</summary>
					<div class="mt-2 flex flex-col gap-3 text-sm">
						{#if !vectorizationEnabled}
							<Switch
								name="wleRegex"
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
								name="wleCase"
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
						<!-- Recursion depth.

						     Outside the `!vectorizationEnabled` gate that hides Use Regex and
						     Case Sensitive, deliberately: recursion is a property of the
						     keyword mechanism, and the keyword mechanism still runs with vectorization
						     on — an entry set to `keyword` or `both`, and every `rag` entry
						     on an instance whose model is not loaded, goes through it.
						     Hiding this would repeat the mistake those two are making. -->
						<div
							class="flex w-full items-center justify-between gap-2"
						>
							<label for="wleRecursion">Recursion depth</label>
							<select
								id="wleRecursion"
								class="select preset-filled-surface-200-800 w-max max-w-xs rounded-lg text-sm"
								value={String(
									editingEntry.recursionDepth ?? ""
								)}
								onchange={(e) => {
									if (!editingEntry) return
									// "" is not 0. Empty means the entry has no opinion and the
									// pipeline's ceiling decides, which is a different answer
									// from "conversation only" and has to survive as null.
									const v = e.currentTarget.value
									editingEntry.recursionDepth =
										v === "" ? null : Number(v)
								}}
							>
								<option value="">Use pipeline default</option>
								<option value="0">Conversation only</option>
								<option value="1">1 level deep</option>
								<option value="2">2 levels deep</option>
								<option value="3">3 levels deep</option>
							</select>
						</div>
						<!-- The entry's own condition — see `EntryConditionField`.

						     Beside Recursion depth and outside the `!vectorizationEnabled`
						     gate, for that control's stated reason: this is a property of the
						     keyword mechanism, and the keyword mechanism still runs with vectorization on.
						     Hiding it would repeat the mistake Use Regex and Case Sensitive
						     are making. -->
						<EntryConditionField
							bind:selectiveLogic={
								(editingEntry as any).selectiveLogic
							}
							bind:secondaryKeys={
								(editingEntry as any).secondaryKeys
							}
							idPrefix="wle"
						/>
						<Switch
							name="wlePinned"
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
							name="wleEnabled"
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
									for="wlePriority"
									class:opacity-50={editingEntry.constant}
								>
									Priority
								</label>
								<select
									id="wlePriority"
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
