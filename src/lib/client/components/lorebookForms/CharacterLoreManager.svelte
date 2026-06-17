<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import * as skio from "sveltekit-io"
	import { onDestroy, onMount, tick } from "svelte"
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

	const socket = skio.get()

	let {
		lorebookId = $bindable(),
		hasUnsavedChanges = $bindable(false)
	}: Props = $props()

	const DefaultCharacterEntry: InsertCharacterLoreEntry = {
		name: "",
		content: "",
		keys: "",
		useRegex: false,
		caseSensitive: false,
		constant: false,
		enabled: true,
		priority: 1, // Default priority
		lorebookId
	}

	let characterLoreEntryList: Sockets.CharacterLoreEntries.List.Response["characterLoreEntryList"] =
		$state([])
	let lorebookBindingList: SelectLorebookBinding[] = $state([])
	let editEntriesData: Record<number, SelectCharacterLoreEntry> = $state({})
	let newEntriesData: (InsertCharacterLoreEntry & { _uuid: string })[] =
		$state([])
	let isReady = $state(false)
	let orderBy: string = $state("position-asc")
	let search = $state("")
	let isReordering = $state(false)
	let deleteEntryId: number | null = $state(null)
	let showDeleteConfirmModal = $state(false)

	$effect(() => {
		let populatedNewEntries = false
		let modifiedEntries = false
		newEntriesData.forEach((entry) => {
			if (entry.name.trim() || entry.content?.trim()) {
				populatedNewEntries = true
			}
		})
		Object.values(editEntriesData).forEach((entry) => {
			const originalEntry = characterLoreEntryList.find(
				(e) => e.id === entry.id
			)
			if (JSON.stringify(originalEntry) !== JSON.stringify(entry)) {
				modifiedEntries = true
			}
		})
		hasUnsavedChanges = populatedNewEntries || modifiedEntries
	})

	function getSortedEntries() {
		return characterLoreEntryList.slice().sort((a, b) => {
			const getPinned = (e) => (e.constant ? 1 : 0)
			const getPriority = (e) => e.priority || 1
			const getCreated = (e) => new Date(e.createdAt || 0).getTime()
			const getUpdated = (e) => new Date(e.updatedAt || 0).getTime()
			const getPosition = (e) =>
				typeof e.position === "number" ? e.position : 0
			switch (orderBy) {
				case "position-asc":
					return getPosition(a) - getPosition(b)
				case "position-desc":
					return getPosition(b) - getPosition(a)
				case "priority-desc":
					// Pinned > 3 > 2 > 1
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

	function getFilteredEntries() {
		const lower = search.trim().toLowerCase()
		if (!lower) return getSortedEntries()
		return getSortedEntries().filter((entry) => {
			const name = (entry.name || "").toLowerCase()
			const content = (entry.content || "").toLowerCase()
			const keys = Array.isArray(entry.keys)
				? entry.keys.join(", ")
				: entry.keys || ""
			return (
				name.includes(lower) ||
				content.includes(lower) ||
				keys.toLowerCase().includes(lower)
			)
		})
	}

	function entryIsValid({
		entry,
		warn = false
	}: {
		entry: SelectWorldLoreEntry
		warn?: boolean
	}): boolean {
		if (!entry.name.trim()) {
			if (warn) {
				toaster.error({ title: "Name is required" })
			}
			return false
		}

		return true
	}

	function handleSave({
		entry
	}: {
		entry:
			| SelectCharacterLoreEntry
			| (InsertCharacterLoreEntry & { _uuid: string })
	}) {
		if (!entryIsValid({ entry, warn: true })) {
			return
		}

		if (entry._uuid) {
			// New entry, send create request
			const req: Sockets.CreateCharacterLoreEntry.Call = {
				characterLoreEntry: { ...entry, lorebookId, _uuid: undefined }
			}
			socket.emit("characterLoreEntries:create", req)
			newEntriesData = newEntriesData.filter(
				(e) => e._uuid !== entry._uuid
			)
		} else {
			// Existing entry, send update request
			const req: Sockets.UpdateCharacterLoreEntry.Call = {
				characterLoreEntry: { ...entry, lorebookId }
			}
			socket.emit("characterLoreEntries:update", req)
			delete editEntriesData[entry.id]
		}
		// tick().then(() => {
		// 	const el = document.getElementById(`entry-${entry.id}`)
		// 	if (el) {
		// 		el.scrollIntoView({ behavior: "smooth" })
		// 	}
		// })
	}

	function handleCancel({
		entry
	}: {
		entry:
			| SelectCharacterLoreEntry
			| (InsertCharacterLoreEntry & { _uuid: string })
	}) {
		if (entry._uuid) {
			// If it's a new entry, just remove it from the newEntriesData
			newEntriesData = newEntriesData.filter(
				(e) => e._uuid !== entry._uuid
			)
		} else {
			// If it's an existing entry, remove it from editEntriesData
			delete editEntriesData[entry.id]
		}
	}

	function onClickCreateEntry() {
		const newEntry: InsertCharacterLoreEntry & { _uuid: string } = {
			...DefaultCharacterEntry,
			_uuid: uuid()
		}
		newEntriesData.push(newEntry)
		tick().then(() => {
			const el = document.getElementById(`entry-${newEntry.id}`)
			if (el) {
				el.scrollIntoView({ behavior: "smooth" })
			}
		})
	}

	function previewContent({
		entry
	}: {
		entry: SelectCharacterLoreEntry
	}): string {
		let content = entry.content || ""
		lorebookBindingList.forEach((binding) => {
			if (!binding.characterId && !binding.personaId) {
				return
			}
			if (binding.characterId) {
				content = content.replaceAll(
					binding.binding,
					binding.character!.nickname ||
						binding.character!.name ||
						binding.binding
				)
			} else if (binding.personaId) {
				content = content.replaceAll(
					binding.binding,
					binding.persona!.name || binding.binding
				)
			}
		})
		return content
	}

	function onReorderClick() {
		if (!isReordering && !hasUnsavedChanges) {
			isReordering = true
		}
	}

	function handleUpdateReorder({
		entries
	}: {
		entries: Sockets.CharacterLoreEntryList.Response["characterLoreEntryList"]
	}) {
		console.log("Reordering entries:", $state.snapshot(entries))
		// Map id's to positions
		const positionMap: Sockets.UpdateCharacterLoreEntryPositions.Call["positions"] =
			[]
		entries.forEach((entry, index) => {
			positionMap.push({ id: entry.id, position: index + 1 })
		})
		const req: Sockets.UpdateCharacterLoreEntryPositions.Call = {
			lorebookId,
			positions: positionMap
		}
		socket.emit("characterLoreEntries:updatePositions", req)
	}

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

	function onDeleteClick(id: number) {
		deleteEntryId = id
		showDeleteConfirmModal = true
	}

	function onDeleteConfirm() {
		showDeleteConfirmModal = false
		socket.emit("characterLoreEntries:delete", {
			id: deleteEntryId,
			lorebookId
		})
		deleteEntryId = null
	}

	function onDeleteCancel() {
		showDeleteConfirmModal = false
		deleteEntryId = null
	}

	onMount(() => {
		socket.on(
			"characterLoreEntries:list",
			async (msg: Sockets.CharacterLoreEntries.List.Response) => {
				if (msg.lorebookId === lorebookId) {
					characterLoreEntryList = msg.characterLoreEntryList
				}
				await tick()
			}
		)

		socket.on(
			"characterLoreEntries:create",
			(msg: Sockets.CreateCharacterLoreEntry.Response) => {
				if (
					msg.characterLoreEntry &&
					msg.characterLoreEntry.lorebookId === lorebookId
				) {
					toaster.success({ title: "Character Lore Entry created" })
				}
			}
		)

		socket.on(
			"characterLoreEntries:update",
			(msg: Sockets.UpdateCharacterLoreEntry.Response) => {
				if (
					msg.characterLoreEntry &&
					msg.characterLoreEntry.lorebookId === lorebookId
				) {
					toaster.success({ title: "Character Lore Entry updated" })
				}
			}
		)
		socket.on(
			"characterLoreEntries:delete",
			(msg: Sockets.DeleteCharacterLoreEntry.Response) => {
				if (
					msg.id &&
					characterLoreEntryList.some((e) => e.id === msg.id)
				) {
					toaster.success({ title: "Character Lore Entry deleted" })
					// characterLoreEntryList = characterLoreEntryList.filter(
					// 	(e) => e.id !== msg.id
					// )
				}
			}
		)
		socket.on(
			"lorebooks:bindingList",
			async (msg: Sockets.LorebookBindingList.Response) => {
				if (msg.lorebookId === lorebookId) {
					lorebookBindingList = [...msg.lorebookBindingList]
				}
				await tick() // Force state to update
			}
		)
		socket.on(
			"characterLoreEntries:updatePositions",
			(msg: Sockets.UpdateCharacterLoreEntryPositions.Response) => {
				if (msg.lorebookId === lorebookId) {
					toaster.success({ title: "Entries reordered" })
				}
			}
		)
		const req: Sockets.CharacterLoreEntryList.Call = {
			lorebookId: lorebookId
		}
		socket.emit("characterLoreEntries:list", req)
		const bindingReq: Sockets.LorebookBindingList.Call = {
			lorebookId: lorebookId
		}
		socket.emit("lorebooks:bindingList", bindingReq)
		isReady = true
	})

	onDestroy(() => {
		hasUnsavedChanges = false
		socket.off("characterLoreEntries:list")
		socket.off("characterLoreEntries:create")
		socket.off("characterLoreEntries:update")
		socket.off("characterLoreEntries:delete")
		socket.off("lorebooks:bindingList")
		socket.off("characterLoreEntries:updatePositions")
	})
</script>

{#if isReady}
	<div class="flex flex-col gap-4">
		{#if !isReordering}
			<div class="mb-2 flex flex-wrap items-center justify-between gap-2">
				<input
					class="input input-sm w-full"
					placeholder="Search entries..."
					type="text"
					bind:value={search}
					disabled={newEntriesData.length > 0 ||
						Object.keys(editEntriesData).length > 0}
				/>
				<div class="flex w-full gap-2">
					<select
						id="orderBy"
						class="select compact text-sm"
						bind:value={orderBy}
						disabled={newEntriesData.length > 0 ||
							Object.keys(editEntriesData).length > 0}
					>
						<option value="position-asc">Position ↑</option>
						<option value="position-desc">Position ↓</option>
						<option value="priority-desc">Priority ↑</option>
						<option value="priority-asc">Priority ↓</option>
						<option value="created-desc">Date Created ↑</option>
						<option value="created-asc">Date Created ↓</option>
						<option value="updated-desc">Date Updated ↑</option>
						<option value="updated-asc">Date Updated ↓</option>
					</select>
					<button
						class="btn btn-sm preset-filled-surface-500 w-full"
						onclick={onReorderClick}
						disabled={hasUnsavedChanges ||
							characterLoreEntryList.length === 0}
					>
						<Icons.SortAsc size={16} /> Reorder
					</button>
					<button
						class="btn btn-sm preset-filled-success-500 w-full"
						onclick={onClickCreateEntry}
					>
						<Icons.Plus size={16} /> Create Entry
					</button>
				</div>
			</div>
			{#each [...newEntriesData, ...getFilteredEntries()] as oe}
				{@const entry =
					!!oe._uuid ||
					!Object.values(editEntriesData).find((e) => e.id === oe.id)
						? oe
						: Object.values(editEntriesData).find(
								(e) => e.id === oe.id
							) || oe}
				{@const isEditing = entry.id in editEntriesData || !entry.id}
				{#key entry}
					{#if isEditing}
						<!-- Edit mode: show the form -->
						<div
							class="preset-filled-surface-100-900 border-success-500 flex flex-col gap-4 rounded-lg border-2 p-2"
							class:border-success-500={!entry.id}
						>
							<div>
								<label
									class="flex items-center gap-1 font-semibold"
									for="entryName"
								>
									<span>Name</span>
									<span
										class="flex items-center opacity-50 transition-opacity duration-200 hover:opacity-100"
										title="This field will be visible in prompts"
									>
										<Icons.ScanEye
											size={16}
											class="relative top-[1px] inline"
										/>
									</span>
								</label>

								<input
									id="entryName"
									class="input preset-filled-surface-200-800 w-full rounded-lg"
									type="text"
									bind:value={entry.name}
									required
									placeholder="Her abilities"
								/>
							</div>
							<div>
								<label
									class="flex items-center gap-1 font-semibold"
									for="entryBinding"
								>
									<span>Binding</span>
									<span
										class="flex items-center opacity-50 transition-opacity duration-200 hover:opacity-100"
										title="Select a binding to associate with this entry"
									>
										<Icons.Link2
											size={16}
											class="relative top-[1px] inline"
										/>
									</span>
								</label>
								<select
									id="entryBinding"
									class="select preset-filled-surface-200-800 w-full rounded-lg"
									bind:value={entry.lorebookBindingId}
								>
									<option value={null}>None</option>
									{#each lorebookBindingList as binding (binding.id)}
										<option value={binding.id}>
											{getBindingLabel(binding.id)}
										</option>
									{/each}
								</select>
							</div>
							<div>
								<label
									class="flex items-center gap-1 font-semibold"
									for="entryContent"
								>
									<span>Content</span>
									<span
										class="flex items-center opacity-50 transition-opacity duration-200 hover:opacity-100"
										title="This field will be visible in prompts"
									>
										<Icons.ScanEye
											size={16}
											class="relative top-[1px] inline"
										/>
									</span>
								</label>
								<LoreContentField
									bind:content={entry.content}
									bind:lorebookBindingList
								/>
							</div>
							<div>
								<label
									class="flex items-center gap-1 font-semibold"
									for="entryKeys"
								>
									<span>Keywords (comma separated)</span>
									<span
										class="flex items-center opacity-50 transition-opacity duration-200 hover:opacity-100"
										title="Words or phrases that will trigger this entry"
									>
										<Icons.MessageCircleQuestion
											size={16}
											class="relative top-[1px] inline"
										/>
									</span>
								</label>
								<input
									id="entryKeys"
									class="input preset-filled-surface-200-800 w-full rounded-lg"
									type="text"
									bind:value={entry.keys}
									placeholder="abilities, powers, skills"
								/>
							</div>
							<details>
								<summary class="cursor-pointer font-semibold">
									Advanced Settings
								</summary>
								<div class="mt-2 flex flex-col gap-2">
									<div class="flex w-full justify-between">
										<label for="useRegex-{entry.id}">
											Use Regex
										</label>
										<Switch
											name="useRegex-{entry.id}"
											checked={entry.useRegex || false}
											onCheckedChange={(e) =>
												(entry.useRegex = e.checked)}
											aria-labelledby="useRegex-{entry.id}"
										/>
									</div>
									<div class="flex w-full justify-between">
										<label for="caseSensitive-{entry.id}">
											Case Sensitive
										</label>
										<Switch
											name="caseSensitive-{entry.id}"
											checked={entry.caseSensitive}
											onCheckedChange={(e) =>
												(entry.caseSensitive =
													e.checked)}
											aria-labelledby="caseSensitive-{entry.id}"
										/>
									</div>
									<div class="flex w-full justify-between">
										<label for="constant-{entry.id}">
											Pinned
										</label>
										<Switch
											name="constant-{entry.id}"
											checked={entry.constant}
											onCheckedChange={(e) =>
												(entry.constant = e.checked)}
											aria-labelledby="constant-{entry.id}"
										/>
									</div>
									<div class="flex w-full justify-between">
										<label for="enabled-{entry.id}">
											Enabled
										</label>
										<Switch
											name="enabled-{entry.id}"
											checked={entry.enabled}
											onCheckedChange={(e) =>
												(entry.enabled = e.checked)}
											aria-labelledby="enabled-{entry.id}"
										/>
									</div>
									<div class="flex w-full justify-between">
										<label
											for="entryPriority"
											class="font-semibold"
											class:disabled={entry.constant}
										>
											Priority
										</label>
										<select
											id="entryPriority"
											bind:value={entry.priority}
											class="select preset-filled-surface-200-800 w-full w-max max-w-xs rounded-lg text-sm"
											disabled={entry.constant}
										>
											{#each Priorities as priority}
												<option value={priority.value}>
													{priority.label}
												</option>
											{/each}
										</select>
									</div>
								</div>
							</details>

							<div class="flex gap-2">
								<button
									class="btn btn-sm preset-filled-surface-500 w-full"
									onclick={() => {
										handleCancel({ entry })
									}}
								>
									Cancel
								</button>
								<button
									class="btn btn-sm preset-filled-success-500 w-full"
									onclick={() => handleSave({ entry })}
									disabled={!entryIsValid({ entry })}
								>
									<Icons.Save size={16} />
									Save
								</button>
							</div>
						</div>
					{:else}
						<!-- View mode: show entry details -->
						{@const isUnbound = !entry.lorebookBindingId}
						{@const binding = !isUnbound
							? lorebookBindingList.find(
									(b) => b.id === entry.lorebookBindingId
								)
							: undefined}
						{@const isBindingUnlinked = binding
							? !binding?.characterId && !binding?.personaId
							: false}
						<div
							class="preset-filled-surface-100-900 flex flex-col gap-4 rounded-lg p-2"
							class:border-error-500={isUnbound}
							class:border-warning-500={isBindingUnlinked}
							class:border-2={isUnbound || isBindingUnlinked}
							class:opacity-50={!entry.enabled}
						>
							<div>
								<strong>Name:</strong>
								{entry.name}
							</div>
							<div>
								<strong>Binding:</strong>
								<span
									class:text-error-500={isUnbound}
									class:text-warning-500={isBindingUnlinked}
								>
									{#if isUnbound}
										<Icons.AlertTriangle
											size={16}
											class="inline"
										/> Unbound
									{:else}
										{@const bindingLabel = getBindingLabel(
											entry.lorebookBindingId!
										)}
										{bindingLabel}
									{/if}
								</span>
							</div>
							<div>
								<strong>Content:</strong>
								<div class="line-clamp-3 whitespace-pre-line">
									{previewContent({ entry })}
								</div>
							</div>
							<div>
								<strong>Keys:</strong>
								{entry.keys}
							</div>
							<div class="flex items-center gap-1">
								<EmbeddingStatusIcon embeddingModel={entry.embeddingModel} size={14} />
								{#if !entry.enabled}
									<span
										class="preset-filled-error-500 rounded px-2 py-1"
										title="This entry is disabled and will not be used in prompts"
									>
										<Icons.Ghost size={16} class="inline" />
									</span>
								{/if}
								{#if entry.useRegex}
									<span
										class="preset-filled-primary-500 rounded px-2 py-1"
										title="This entry's keys use a regex pattern"
									>
										<Icons.Regex size={16} class="inline" />
									</span>
								{/if}
								{#if entry.constant}
									<span
										class="preset-filled-warning-500 rounded px-2 py-1"
										title="This entry is pinned and will always be included in prompts"
									>
										<Icons.Pin size={16} class="inline" />
									</span>
								{:else}
									<span
										class="rounded px-2 py-1"
										class:preset-filled-success-500={entry.priority ===
											1}
										class:preset-filled-primary-500={entry.priority ===
											2}
										class:preset-filled-tertiary-500={entry.priority ===
											3}
										title={`${Priorities[entry.priority! - 1].label} Priority`}
									>
										{#if entry.priority === 1}
											<Icons.Plus
												size={16}
												class="inline"
											/>
										{:else if entry.priority === 2}
											<Icons.Plus
												size={16}
												class="inline"
											/><Icons.Plus
												size={16}
												class="inline"
											/>
										{:else if entry.priority === 3}
											<Icons.Plus
												size={16}
												class="inline"
											/><Icons.Plus
												size={16}
												class="inline"
											/><Icons.Plus
												size={16}
												class="inline"
											/>
										{/if}
									</span>
								{/if}
							</div>
							<div class="mt-2 flex gap-2">
								<button
									class="btn btn-sm preset-filled-primary-500"
									onclick={() => {
										editEntriesData[entry.id] = { ...entry }
									}}
								>
									<Icons.Edit size={16} /> Edit
								</button>
								<button
									class="btn btn-sm preset-filled-error-500"
									onclick={() => onDeleteClick(entry.id!)}
									title="Delete Entry"
								>
									<Icons.Trash2 size={16} /> Delete
								</button>
							</div>
						</div>
					{/if}
				{/key}
			{/each}
		{:else}
			<!-- Reorder drag-and-drop list -->
			<div class="flex flex-col gap-2">
				<div class="mb-2 text-sm font-semibold">
					Drag to reorder entries
				</div>
				<div class="mb-4 flex gap-2">
					<button
						class="btn btn-sm preset-filled-success-500 w-full"
						onclick={() => (isReordering = false)}
					>
						<Icons.Check size={16} />
						Done
					</button>
				</div>
				<div
					use:dndzone={{
						items: characterLoreEntryList
							.slice()
							.sort(
								(a, b) => (a.position ?? 0) - (b.position ?? 0)
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
						await handleUpdateReorder({
							entries: characterLoreEntryList
						})
					}}
					class="flex flex-col gap-1"
				>
					{#each characterLoreEntryList
						.slice()
						.sort((a, b) => (a.position ?? 0) - (b.position ?? 0)) as entry (entry.id)}
						<div
							class="bg-surface-500 hover:bg-surface-300-700 flex cursor-grab items-center gap-2 rounded p-2 shadow-sm"
							data-dnd-handle
						>
							<span
								class="hover:text-primary-500 cursor-grab"
								data-dnd-handle
								title="Drag to reorder"
							>
								<Icons.GripVertical size={18} />
							</span>
							<span class="flex-1 truncate font-semibold">
								{entry.name}
							</span>
							<span class="text-xs">#{entry.position}</span>
						</div>
					{/each}
				</div>
				<div class="mt-4 flex gap-2">
					<button
						class="btn btn-sm preset-filled-success-500 w-full"
						onclick={() => (isReordering = false)}
					>
						<Icons.Check size={16} />
						Done
					</button>
				</div>
			</div>
		{/if}
	</div>
{/if}

<DeleteLorebookEntryConfirmModal
	open={showDeleteConfirmModal}
	onOpenChange={(e) => {
		showDeleteConfirmModal = e.open
		deleteEntryId = null
	}}
	onConfirm={onDeleteConfirm}
	onCancel={onDeleteCancel}
/>
