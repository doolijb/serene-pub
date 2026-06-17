<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import * as skio from "sveltekit-io"
	import { onDestroy, onMount, tick } from "svelte"
	import EmbeddingStatusIcon from "$lib/client/components/EmbeddingStatusIcon.svelte"
	import LoreContentField from "./LoreContentField.svelte"
import { v4 as uuid } from "uuid"
	import DeleteLorebookEntryConfirmModal from "../modals/DeleteLorebookEntryConfirmModal.svelte"

	interface Props {
		lorebookId: number
		hasUnsavedChanges: boolean
	}

	const socket = skio.get()

	let {
		lorebookId = $bindable(),
		hasUnsavedChanges = $bindable(false)
	}: Props = $props()

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
		lorebookId
	}

	let historyEntryList: Sockets.HistoryEntryList.Response["historyEntryList"] =
		$state([])
	let lorebookBindingList: SelectLorebookBinding[] = $state([])
	let editEntriesData: Record<number, SelectHistoryEntry> = $state({})
	let newEntriesData: (InsertHistoryEntry & { _uuid: string })[] = $state([])

	let isReady = $state(false)
	let orderBy: string = $state("entry-date-desc")
	let search = $state("")
	let isReordering = $state(false)
	let deleteEntryId: number | null = $state(null)
	let showDeleteConfirmModal = $state(false)
	let filteredEntries: SelectHistoryEntry[] = $derived.by(() =>
		getFilteredEntries()
	)
	let maxDateValue: number = $derived.by(() => {
		if (filteredEntries.length === 0) return 0
		return Math.max(...filteredEntries.map((e) => getEntryDateValue(e)))
	})

	$effect(() => {
		let populatedNewEntries = false
		let modifiedEntries = false
		newEntriesData.forEach((entry) => {
			if (entry.content?.trim()) {
				populatedNewEntries = true
			}
		})
		Object.values(editEntriesData).forEach((entry) => {
			const originalEntry = historyEntryList.find(
				(e) => e.id === entry.id
			)
			if (JSON.stringify(originalEntry) !== JSON.stringify(entry)) {
				modifiedEntries = true
			}
		})
		hasUnsavedChanges = populatedNewEntries || modifiedEntries
	})

	function getEntryDateValue(entry: SelectHistoryEntry) {
		return entry.year * 10000 + (entry.month || 0) * 100 + (entry.day || 0)
	}

	function getSortedEntries() {
		return historyEntryList.slice().sort((a, b) => {
			const getPinned = (e) => (e.constant ? 1 : 0)
			const getPriority = (e) => e.priority || 1
			const getCreated = (e) => new Date(e.createdAt || 0).getTime()
			const getUpdated = (e) => new Date(e.updatedAt || 0).getTime()
			switch (orderBy) {
				case "entry-date-desc":
					return getEntryDateValue(b) - getEntryDateValue(a)
				case "entry-date-asc":
					return getEntryDateValue(a) - getEntryDateValue(b)
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
			const content = (entry.content || "").toLowerCase()
			const keys = entry.keys || ""
			return content.includes(lower) || keys.toLowerCase().includes(lower)
		})
	}

	function entryIsValid({
		entry,
		warn = false
	}: {
		entry: SelectHistoryEntry
		warn?: boolean
	}): boolean {
		if (!entry.year) {
			if (warn) {
				toaster.error({ title: "Year is required" })
			}
			return false
		}

		if (!!entry.day && !entry.month) {
			if (warn) {
				toaster.error({ title: "Month is required if day is set" })
			}
			return false
		}

		return true
	}

	function handleSave({
		entry
	}: {
		entry: SelectHistoryEntry | (InsertHistoryEntry & { _uuid: string })
	}) {
		if (!entryIsValid({ entry, warn: true })) {
			return
		}

		const data = {
			...entry,
			lorebookId,
			_uuid: undefined
		}

		if (data.month === 0) {
			data.month = null
		}
		if (data.day === 0) {
			data.day = null
		}

		if (entry._uuid) {
			// New entry, send create request
			const req: Sockets.CreateHistoryEntry.Call = {
				historyEntry: data
			}
			socket.emit("historyEntries:create", req)
			newEntriesData = newEntriesData.filter(
				(e) => e._uuid !== entry._uuid
			)
		} else {
			// Existing entry, send update request
			const req: Sockets.UpdateHistoryEntry.Call = {
				historyEntry: data
			}
			socket.emit("historyEntries:update", req)
			delete editEntriesData[entry.id]
		}
	}

	function handleCancel({
		entry
	}: {
		entry: SelectHistoryEntry | (InsertHistoryEntry & { _uuid: string })
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
		const newEntry: InsertHistoryEntry & { _uuid: string } = {
			...DefaultHistoryEntry,
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

	function onClickIterateNextEntry() {
		// Find the entry with the highest date to iterate from
		if (filteredEntries.length === 0) {
			toaster.error({
				title: "No entries found",
				description: "Create at least one entry before using Next Date."
			})
			return
		}

		// Get the entry with the highest date value
		const latestEntry = filteredEntries.reduce((max, entry) => {
			return getEntryDateValue(entry) > getEntryDateValue(max)
				? entry
				: max
		}, filteredEntries[0])

		const req: Sockets.HistoryEntries.IterateNext.Params = {
			id: latestEntry.id
		}
		socket.emit("historyEntries:iterateNext", req)
	}

	function previewContent({ entry }: { entry: SelectHistoryEntry }): string {
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

	function onDeleteClick(id: number) {
		deleteEntryId = id
		showDeleteConfirmModal = true
	}

	function onDeleteConfirm() {
		showDeleteConfirmModal = false
		socket.emit("historyEntries:delete", {
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
			"historyEntries:list",
			async (msg: Sockets.HistoryEntryList.Response) => {
				if (
					msg.historyEntryList.length &&
					msg.historyEntryList[0].lorebookId === lorebookId
				) {
					historyEntryList = msg.historyEntryList
				}
				await tick() // Force state to update
			}
		)

		socket.on(
			"historyEntries:create",
			(msg: Sockets.CreateHistoryEntry.Response) => {
				if (
					msg.historyEntry &&
					msg.historyEntry.lorebookId === lorebookId
				) {
					toaster.success({ title: "History Entry created" })
				}
			}
		)

		socket.on(
			"historyEntries:update",
			(msg: Sockets.UpdateHistoryEntry.Response) => {
				if (
					msg.historyEntry &&
					msg.historyEntry.lorebookId === lorebookId
				) {
					toaster.success({ title: "History Entry updated" })
				}
			}
		)
		socket.on(
			"historyEntries:delete",
			(msg: Sockets.DeleteHistoryEntry.Response) => {
				if (msg.id && historyEntryList.some((e) => e.id === msg.id)) {
					toaster.success({ title: "History Entry deleted" })
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
			"historyEntries:iterateNext",
			(msg: Sockets.IterateNextHistoryEntry.Response) => {
				toaster.success({
					title: "The story's date has moved forward"
				})
			}
		)
		const req: Sockets.HistoryEntryList.Call = { lorebookId: lorebookId }
		socket.emit("historyEntries:list", req)
		const bindingReq: Sockets.LorebookBindingList.Call = {
			lorebookId: lorebookId
		}
		socket.emit("lorebooks:bindingList", bindingReq)
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
						{#each SORT_OPTIONS as opt}
							<option value={opt.value}>{opt.label}</option>
						{/each}
					</select>
					<button
						class="btn btn-sm preset-filled-primary-500 w-full"
						onclick={onClickIterateNextEntry}
					>
						<Icons.CalendarPlus size={16} /> Next Date
					</button>
					<button
						class="btn btn-sm preset-filled-success-500 w-full"
						onclick={onClickCreateEntry}
					>
						<Icons.Plus size={16} /> Create Entry
					</button>
				</div>
			</div>
			{#each [...newEntriesData, ...filteredEntries] as oe}
				{@const entry =
					!!oe._uuid ||
					!Object.values(editEntriesData).find((e) => e.id === oe.id)
						? oe
						: Object.values(editEntriesData).find(
								(e) => e.id === oe.id
							) || oe}
				{@const isEditing = entry.id in editEntriesData || !entry.id}
				{@const isFirstWithMaxDate =
					getEntryDateValue(entry) === maxDateValue &&
					filteredEntries.findIndex(
						(e) => getEntryDateValue(e) === maxDateValue
					) === filteredEntries.indexOf(entry)}
				{#if isEditing}
						<!-- Edit mode: show the form -->
						<div
							class="preset-filled-surface-100-900 border-success-500 flex flex-col gap-4 rounded-lg border-2 p-2"
							class:border-success-500={!entry.id}
						>
							<div class="flex gap-2">
								<div class="flex flex-col gap-2">
									<label
										class="flex items-center gap-1 font-semibold"
										for="entryYear"
									>
										<span>Year</span>
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
										id="entryYear"
										class="input preset-filled-surface-200-800 w-full rounded-lg"
										type="number"
										bind:value={entry.year}
										required
										placeholder="2055"
									/>
								</div>
								<div class="flex flex-col gap-2">
									<label
										class="flex items-center gap-1 font-semibold"
										for="entryMonth"
									>
										<span>Month</span>
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
										id="entryMonth"
										class="input preset-filled-surface-200-800 w-full rounded-lg"
										type="number"
										bind:value={entry.month}
										placeholder="3"
									/>
								</div>
								<div class="flex flex-col gap-2">
									<label
										class="flex items-center gap-1 font-semibold"
										for="entryDay"
									>
										<span>Day</span>
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
										id="entryDay"
										class="input preset-filled-surface-200-800 w-full rounded-lg"
										type="number"
										bind:value={entry.day}
										placeholder="1"
									/>
								</div>
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
									placeholder="umber, umber city"
								/>
							</div>
							<details>
								<summary class="cursor-pointer font-semibold">
									Advanced Settings
								</summary>
								<div class="mt-2 flex flex-col gap-2">
									<label class="flex w-full cursor-pointer items-center justify-between gap-2">
										<span>Use Regex</span>
										<input
											type="checkbox"
											class="checkbox"
											checked={!!entry.useRegex}
											onchange={(e) => {
												entry.useRegex = e.currentTarget.checked
											}}
										/>
									</label>
									<label class="flex w-full cursor-pointer items-center justify-between gap-2">
										<span>Case Sensitive</span>
										<input
											type="checkbox"
											class="checkbox"
											checked={!!entry.caseSensitive}
											onchange={(e) => {
												entry.caseSensitive = e.currentTarget.checked
											}}
										/>
									</label>
									<label class="flex w-full cursor-pointer items-center justify-between gap-2">
										<span>Pinned</span>
										<input
											type="checkbox"
											class="checkbox"
											checked={!!entry.constant}
											onchange={(e) => {
												entry.constant = e.currentTarget.checked
											}}
										/>
									</label>
									<label class="flex w-full cursor-pointer items-center justify-between gap-2">
										<span>Enabled</span>
										<input
											type="checkbox"
											class="checkbox"
											checked={!!entry.enabled}
											onchange={(e) => {
												entry.enabled = e.currentTarget.checked
											}}
										/>
									</label>
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
						<div
							class="preset-filled-surface-100-900 flex flex-col gap-4 rounded-lg p-2"
							class:opacity-50={!entry.enabled}
						>
							<div>
								<strong>Date:</strong>
								{entry.year}{entry.month
									? `-${entry.month}`
									: ""}{entry.day ? `-${entry.day}` : ""}
								{#if entry.year === 0 && entry.month === 0 && entry.day === 0}
									<span
										class="text-tertiary-500 ml-2 text-sm"
									>
										<strong>(No Date)</strong>
									</span>
								{/if}
								{#if entry.year === 0 && entry.month === 0 && entry.day === null}
									<span
										class="text-tertiary-500 ml-2 text-sm"
									>
										<strong>(No Date Set)</strong>
									</span>
								{/if}
								{#if isFirstWithMaxDate}
									<span
										class="text-tertiary-500 ml-2 text-sm"
									>
										<strong>(Current Date)</strong>
									</span>
								{/if}
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
									onclick={() => onDeleteClick(entry.id)}
									title="Delete Entry"
								>
									<Icons.Trash2 size={16} /> Delete
								</button>
							</div>
						</div>
					{/if}
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
						items: historyEntryList
							.slice()
							.sort(
								(a, b) => (a.position ?? 0) - (b.position ?? 0)
							),
						flipDurationMs: 150,
						dragDisabled: false,
						dropFromOthersDisabled: true
					}}
					onconsider={(e) => {
						historyEntryList = e.detail.items.map((item, idx) => ({
							...item,
							position: idx + 1
						}))
					}}
					onfinalize={async (e) => {
						historyEntryList = e.detail.items.map((item, idx) => ({
							...item,
							position: idx + 1
						}))
						await handleUpdateReorder({
							entries: historyEntryList
						})
					}}
					class="flex flex-col gap-1"
				>
					{#each historyEntryList
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
