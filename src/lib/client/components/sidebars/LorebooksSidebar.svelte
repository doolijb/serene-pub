<script lang="ts">
	import { onDestroy, onMount, tick } from "svelte"
	import * as skio from "sveltekit-io"
	import * as Icons from "@lucide/svelte"
	import NewNameModal from "../modals/NewNameModal.svelte"
	import EditLorebookForm from "../lorebookForms/EditLorebookForm.svelte"
	import { FileUpload, Modal, Tabs } from "@skeletonlabs/skeleton-svelte"
	import LorebookBindingsManager from "../lorebookForms/LorebookBindingsManager.svelte"
	import WorldLoreManager from "../lorebookForms/WorldLoreManager.svelte"
	import type { ValueChangeDetails } from "@zag-js/tabs"
	import LorebookUnsavedChangesModal from "../modals/LorebookUnsavedChangesModal.svelte"
	import CharacterLoreManager from "../lorebookForms/CharacterLoreManager.svelte"
	import HistoryEntryManager from "../lorebookForms/HistoryEntryManager.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import type { SpecV3 } from "@lenml/char-card-reader"
	import SidebarListItem from "../SidebarListItem.svelte"

	interface Props {
		onclose?: () => Promise<boolean> | undefined
	}

	type EditGroup =
		| "lorebook"
		| "bindings"
		| "world"
		| "characters"
		| "history"

	let { onclose = $bindable() }: Props = $props()

	const socket = skio.get()
	let lorebookList: any[] = $state([])
	let search: string = $state("")
	let isCreating: boolean = $state(false)
	let isEditingLorebook: boolean = $state(false)
	let selectedLorebook: any = $state(undefined)
	let editGroup: EditGroup = $state("lorebook")
	let nextEditGroup: EditGroup | undefined = $state()
	let tabHasUnsavedChanges: boolean = $state(false)
	let showUnsavedChangesModal: boolean = $state(false)
	let showUnsavedTabChangesModal: boolean = $state(false)
	let confirmCloseSidebarResolve: ((v: boolean) => void) | null = null
	let showImportModal: boolean = $state(false)
	let importingBook: SpecV3.Lorebook | undefined = $state(undefined)
	let deletingLorebookId: number | undefined = $state(undefined)
	let showDeleteConfirmationModal: boolean = $state(false)

	async function handleOnClose() {
		if (tabHasUnsavedChanges) {
			showUnsavedChangesModal = true
			return new Promise<boolean>((resolve) => {
				confirmCloseSidebarResolve = resolve
			})
		} else {
			return true
		}
	}

	function handleCreateClick() {
		isCreating = true
	}

	function handleLorebookClick(
		e: Event,
		{ lorebook, tab }: { lorebook: SelectLorebook; tab?: EditGroup }
	) {
		e.preventDefault()
		e.stopPropagation()
		selectedLorebook = lorebook
		isEditingLorebook = true
		if (tab) {
			editGroup = tab
		} else {
			editGroup = "lorebook"
		}
	}

	// UNSAVED CHANGES MODAL HANDLERS

	function handleUnsavedChangesModalConfirm() {
		showUnsavedChangesModal = false
		if (confirmCloseSidebarResolve) confirmCloseSidebarResolve(true)
	}
	function handleUnsavedChangesModalCancel() {
		showUnsavedChangesModal = false
		if (confirmCloseSidebarResolve) confirmCloseSidebarResolve(false)
	}
	function handleUnsavedChangesModalOpenChange(e: OpenChangeDetails) {
		if (!e.open) {
			showUnsavedChangesModal = false
			if (confirmCloseSidebarResolve) confirmCloseSidebarResolve(false)
		}
	}

	// UNSAVED TAB CHANGES MODAL HANDLERS

	function handleUnsavedTabChangesModalOpenChange(details: {
		open: boolean
	}) {
		showUnsavedTabChangesModal = details.open
	}

	function handleUnsavedTabChangesModalConfirm() {
		showUnsavedTabChangesModal = false
		editGroup = nextEditGroup || "lorebook"
		nextEditGroup = undefined
	}

	function handleUnsavedTabChangesModalCancel() {
		showUnsavedTabChangesModal = false
		nextEditGroup = undefined
	}

	async function handleOnCreateConfirm(name: string) {
		if (!name.trim()) return
		isCreating = false
		const req: Sockets.CreateLorebook.Call = {
			name: name.trim()
		}
		socket.emit("createLorebook", req)
	}

	async function handleSwitchTabGroup(e: ValueChangeDetails): Promise<void> {
		if (!tabHasUnsavedChanges) {
			editGroup = e.value as EditGroup
			await tick()
		} else {
			nextEditGroup = e.value as EditGroup
			showUnsavedTabChangesModal = true
		}
	}

	let filteredLorebooks = $derived.by(() => {
		let list = [...lorebookList]
		list.sort((a, b) => a.id - b.id)
		if (!search) return list
		return list.filter(
			(l) =>
				l.name.toLowerCase().includes(search.toLowerCase()) ||
				(l.description &&
					l.description.toLowerCase().includes(search.toLowerCase()))
		)
	})

	function handleImportClick() {
		showImportModal = true
	}

	async function handleFileImport(details: FileAcceptDetails) {
		if (!details.files || details.files.length === 0) return
		const file = details.files[0]

		if (file.type !== "application/json") {
			toaster.error({
				title: "Invalid file type. Please upload a JSON file."
			})
			return
		}

		const reader = new FileReader()
		reader.onload = function (e) {
			try {
				const json: SpecV3.Lorebook = JSON.parse(
					e.target?.result as string
				)
				let entries = json.entries
				if (entries && !Array.isArray(entries)) {
					entries = Object.values(entries)
				}
				// Normalize both 'key' and 'keys' fields for every entry
				entries = (entries || []).map((entry) => {
					// @ts-ignore
					let keyArr = entry.key
					if (!Array.isArray(keyArr)) {
						keyArr =
							entry.keys && Array.isArray(entry.keys)
								? entry.keys
								: keyArr
									? [keyArr]
									: []
					}
					let keysArr = entry.keys
					if (!Array.isArray(keysArr)) {
						keysArr = keyArr
					}
					// @ts-ignore
					let keysecondaryArr = entry.keysecondary
					if (!Array.isArray(keysecondaryArr)) {
						keysecondaryArr = keysecondaryArr
							? [keysecondaryArr]
							: []
					}
					return {
						...entry,
						key: keyArr,
						keys: keysArr,
						keysecondary: keysecondaryArr
					}
				})
				importingBook = {
					...json,
					entries: entries,
					name: json.name || "",
					description: json.description || "",
					extensions: json.extensions || {}
				}
			} catch (err) {
				console.log("Error parsing JSON:", err)
				toaster.error({ title: "Invalid JSON file" })
			}
		}
		reader.readAsText(file)
	}

	function handleImportConfirm() {
		if (importingBook && importingBook.name?.trim()) {
			console.log("Importing lorebook:", $state.snapshot(importingBook))
			const req: Sockets.LorebookImport.Call = {
				lorebookData: importingBook
			}
			socket.emit("lorebookImport", req)
			showImportModal = false
			importingBook = undefined
		}
	}

	function onDeleteClick(id: number) {
		deletingLorebookId = id
		showDeleteConfirmationModal = true
	}

	function onDeleteConfirm() {
		if (deletingLorebookId !== undefined) {
			const req: Sockets.DeleteLorebook.Call = {
				id: deletingLorebookId
			}
			socket.emit("deleteLorebook", req)
			toaster.success({ title: "Lorebook Deleted" })
		}
		showDeleteConfirmationModal = false
		deletingLorebookId = undefined
		if (isEditingLorebook && selectedLorebook?.id === deletingLorebookId) {
			isEditingLorebook = false
			selectedLorebook = undefined
		}
	}

	function onDeleteCancel() {
		showDeleteConfirmationModal = false
		deletingLorebookId = undefined
	}

	onMount(() => {
		socket.on("lorebookList", (msg: Sockets.LorebookList.Response) => {
			if (msg.lorebookList) {
				lorebookList = msg.lorebookList
			}
		})
		socket.on("lorebookImport", (msg: Sockets.LorebookImport.Response) => {
			toaster.success({ title: "Lorebook Imported" })
		})
		socket.on("lorebookDelete", (msg: Sockets.DeleteLorebook.Response) => {
			toaster.success({ title: "Lorebook Deleted" })
		})
		onclose = handleOnClose
		socket.emit("lorebookList", {})
	})

	onDestroy(() => {
		socket.off("lorebookList")
		socket.off("lorebookImport")
		socket.off("lorebookDelete")
		onclose = undefined
	})
</script>

<div class="min-h-full p-4">
	{#if isEditingLorebook}
		<div class="flex justify-between">
			<h2 class="mb-4 text-lg font-bold">
				{selectedLorebook?.name || "Lorebook"}
			</h2>
			<button
				onclick={() => {
					isEditingLorebook = false
				}}
				class="mb-4"
			>
				<Icons.ArrowLeft size={20} class="inline" /> Back
			</button>
		</div>
		<Tabs value={editGroup} onValueChange={(e) => handleSwitchTabGroup(e)}>
			{#snippet list()}
				<Tabs.Control value="lorebook">
					<Icons.Book size={20} class="inline" />
					{#if editGroup === "lorebook"}
						Lorebook
					{/if}
				</Tabs.Control>
				<Tabs.Control value="bindings">
					<Icons.Link size={20} class="inline" />
					{#if editGroup === "bindings"}
						Bindings
					{/if}
				</Tabs.Control>
				<Tabs.Control value="world">
					<Icons.Globe size={20} class="inline" />
					{#if editGroup === "world"}
						World Lore
					{/if}
				</Tabs.Control>
				<Tabs.Control value="characters">
					<Icons.User size={20} class="inline" />
					{#if editGroup === "characters"}
						Character Lore
					{/if}
				</Tabs.Control>
				<Tabs.Control value="history">
					<Icons.Calendar size={20} class="inline" />
					{#if editGroup === "history"}
						History
					{/if}
				</Tabs.Control>
			{/snippet}
			{#snippet content()}
				<Tabs.Panel value="lorebook">
					{#if editGroup == "lorebook"}
						<EditLorebookForm lorebookId={selectedLorebook.id} />
					{/if}
				</Tabs.Panel>
				<Tabs.Panel value="bindings">
					{#if editGroup == "bindings"}
						<LorebookBindingsManager
							lorebookId={selectedLorebook.id}
						/>
					{/if}
				</Tabs.Panel>
				<Tabs.Panel value="world">
					{#if editGroup == "world"}
						<WorldLoreManager
							lorebookId={selectedLorebook.id}
							bind:hasUnsavedChanges={tabHasUnsavedChanges}
						/>
					{/if}
				</Tabs.Panel>
				<Tabs.Panel value="characters">
					{#if editGroup == "characters"}
						<CharacterLoreManager
							lorebookId={selectedLorebook.id}
							bind:hasUnsavedChanges={tabHasUnsavedChanges}
						/>
					{/if}
				</Tabs.Panel>
				<Tabs.Panel value="history">
					{#if editGroup == "history"}
						<HistoryEntryManager
							lorebookId={selectedLorebook.id}
							bind:hasUnsavedChanges={tabHasUnsavedChanges}
						/>
					{/if}
				</Tabs.Panel>
			{/snippet}
		</Tabs>
	{:else}
		<div class="mb-2 flex gap-2">
			<button
				class="btn btn-sm preset-filled-primary-500"
				onclick={handleCreateClick}
				title="Create New Lorebook"
			>
				<Icons.Plus size={16} />
			</button>
			<button
				class="btn btn-sm preset-filled-primary-500"
				title="Import Lorebook"
				onclick={handleImportClick}
			>
				<Icons.Upload size={16} />
			</button>
			<button
				class="btn btn-sm preset-filled-primary-500"
				title="Export Lorebook"
				disabled
			>
				<Icons.Download size={16} />
			</button>
		</div>
		<div class="mb-4 flex items-center gap-2">
			<input
				type="text"
				placeholder="Search lorebooks..."
				class="input"
				bind:value={search}
			/>
		</div>
		<div class="flex flex-col gap-2">
			{#if filteredLorebooks.length === 0}
				<div class="text-muted-foreground py-8 text-center">
					No lorebooks found.
				</div>
			{:else}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				{#each filteredLorebooks as l}
					<SidebarListItem
						id={l.id}
						onclick={(e) => handleLorebookClick(e, { lorebook: l })}
						contentTitle="Edit lorebook"
					>
						{#snippet content()}
							<div class="flex flex-col gap-1 text-left min-w-0">
								<div class="truncate font-semibold min-w-0">
									{l.name}
								</div>
								<div
									class="text-muted-foreground line-clamp-2 h-[3em] text-xs min-w-0"
								>
									{l.description || "No description provided."}
								</div>
							</div>
						{/snippet}
						{#snippet extraContent()}
							<div class="min-w-0 flex-1">
								<button
									class="btn btn-sm"
									class:preset-filled-primary-500={l
										.lorebookBindings.length > 0}
									class:preset-filled-primary-300-700={l
										.lorebookBindings.length === 0}
									title={l.lorebookBindings?.length
										? "Lorebook Bindings"
										: "No Lorebook Bindings"}
									onclick={(e) =>
										handleLorebookClick(e, {
											lorebook: l,
											tab: "bindings"
										})}
								>
									<Icons.Link size={16} class="inline" />
									{l.lorebookBindings?.length
										? l.lorebookBindings.length
										: ""}
								</button>
								<button
									class="btn btn-sm"
									class:preset-filled-primary-500={l
										.worldLoreEntries.length > 0}
									class:preset-filled-primary-300-700={l
										.worldLoreEntries.length === 0}
									title={l.worldLoreEntries?.length
										? "World Lore Entries"
										: "No World Lore Entries"}
									onclick={(e) =>
										handleLorebookClick(e, {
											lorebook: l,
											tab: "world"
										})}
								>
									<Icons.Globe size={16} class="inline" />
									{l.worldLoreEntries.length
										? l.worldLoreEntries.length
										: ""}
								</button>
								<button
									class="btn btn-sm"
									class:preset-filled-primary-500={l
										.characterLoreEntries.length > 0}
									class:preset-filled-primary-300-700={l
										.characterLoreEntries.length === 0}
									title={l.characterLoreEntries
										? "Character Lore Entries"
										: "No Character Lore Entries"}
									onclick={(e) =>
										handleLorebookClick(e, {
											lorebook: l,
											tab: "characters"
										})}
								>
									<Icons.User size={16} class="inline" />
									{l.characterLoreEntries?.length
										? l.characterLoreEntries.length
										: ""}
								</button>
								<button
									class="btn btn-sm"
									class:preset-filled-primary-500={l
										.historyEntries.length > 0}
									class:preset-filled-primary-300-700={l
										.historyEntries.length === 0}
									title={l.historyEntries.length
										? "History Entries"
										: "No History Entries"}
									onclick={(e) =>
										handleLorebookClick(e, {
											lorebook: l,
											tab: "history"
										})}
								>
									<Icons.Calendar size={16} class="inline" />
									{l.historyEntries?.length
										? l.historyEntries.length
										: ""}
								</button>
							</div>
						{/snippet}
						{#snippet controls()}
							<button
								class="btn btn-sm text-error-500 p-2"
								onclick={(e) => {
									e.stopPropagation()
									onDeleteClick(l.id)
								}}
								title="Delete Lorebook"
							>
								<Icons.Trash2 size={16} />
							</button>
						{/snippet}
					</SidebarListItem>
				{/each}
			{/if}
		</div>
	{/if}
</div>

<NewNameModal
	open={isCreating}
	onOpenChange={(details) => (isCreating = details.open)}
	onConfirm={handleOnCreateConfirm}
	onCancel={() => (isCreating = false)}
	title="Create New Lorebook"
	description="What would you like to call it?"
/>

<LorebookUnsavedChangesModal
	open={showUnsavedChangesModal}
	onOpenChange={handleUnsavedChangesModalOpenChange}
	onConfirm={handleUnsavedChangesModalConfirm}
	onCancel={handleUnsavedChangesModalCancel}
/>

<LorebookUnsavedChangesModal
	open={showUnsavedTabChangesModal}
	onOpenChange={handleUnsavedTabChangesModalOpenChange}
	onConfirm={handleUnsavedTabChangesModalConfirm}
	onCancel={handleUnsavedTabChangesModalCancel}
/>

{#if showImportModal}
	<Modal
		open={showImportModal}
		onOpenChange={(e) => {
			showImportModal = e.open
			if (!e.open) importingBook = undefined
		}}
		contentBase="card bg-surface-100-900 p-4 space-y-4 shadow-xl max-w-dvw-sm border border-surface-300-700"
		backdropClasses="backdrop-blur-sm"
	>
		{#snippet content()}
			<div class="p-6">
				<h2 class="mb-2 text-lg font-bold">Import Lorebook</h2>
				{#if !importingBook}
					<label class="mb-2" for="file-upload">Select a file.</label>
					<FileUpload
						name="file-upload"
						accept=".json"
						maxFiles={1}
						onFileAccept={handleFileImport}
						onFileReject={console.error}
						classes="w-full bg-surface-50-950"
					/>
				{:else}
					<label class="mb-2" for="name">Name</label>
					<input
						id="name"
						type="text"
						bind:value={importingBook.name}
						placeholder="Lorebook Name"
						class="input"
					/>
				{/if}
				<div class="mt-4 flex items-end gap-2">
					<button
						class="btn preset-filled-surface-500"
						onclick={() => {
							showImportModal = false
							importingBook = undefined
						}}
					>
						Cancel
					</button>
					{#if importingBook}
						<button
							class="btn preset-filled-success-500"
							disabled={!importingBook?.name?.trim()}
							onclick={handleImportConfirm}
						>
							Import
						</button>
					{/if}
				</div>
			</div>
		{/snippet}
	</Modal>
{/if}

{#if showDeleteConfirmationModal}
	<Modal
		open={showDeleteConfirmationModal}
		onOpenChange={(e) => {
			showDeleteConfirmationModal = e.open
			if (!e.open) deletingLorebookId = undefined
		}}
		contentBase="card bg-surface-100-900 p-4 space-y-4 shadow-xl max-w-dvw-sm border border-surface-300-700"
		backdropClasses="backdrop-blur-sm"
	>
		{#snippet content()}
			<div class="p-6">
				<h2 class="text-error-500 mb-2 text-lg font-bold">
					Delete Lorebook?
				</h2>
				<p class="mb-4">
					Are you sure you want to delete this lorebook? This action
					cannot be undone.
				</p>
				<div class="mt-4 flex items-end gap-2">
					<button
						class="btn preset-filled-surface-500"
						onclick={onDeleteCancel}
					>
						Cancel
					</button>
					<button
						class="btn preset-filled-error-500"
						onclick={onDeleteConfirm}
					>
						Delete
					</button>
				</div>
			</div>
		{/snippet}
	</Modal>
{/if}
