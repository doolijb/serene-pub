<script lang="ts">
	import { getContext, onDestroy, onMount, tick } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
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
	import LorebookListItem from "../listItems/LorebookListItem.svelte"

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

	const socket = useTypedSocket()
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
	let panelsCtx: PanelsCtx = $state(getContext("panelsCtx"))

	// External navigation from chat scene/history-entry clicks
	let focusHistoryEntryId = $state<number | undefined>(undefined)
	let focusHistoryEntryTab = $state<"content" | "scenes">("content")
	let focusSceneId = $state<number | undefined>(undefined)

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
		const req: Sockets.Lorebooks.Create.Params = {
			name: name.trim()
		}
		socket.emit("lorebooks:create", req)
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
			const req: Sockets.Lorebooks.Import.Params = {
				lorebookData: importingBook
			}
			socket.emit("lorebooks:import", req)
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
			const req: Sockets.Lorebooks.Delete.Params = {
				id: deletingLorebookId
			}
			socket.emit("lorebooks:delete", req)
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

	$effect(() => {
		if (panelsCtx.digest.lorebookId && !!lorebookList.length) {
			selectedLorebook =
				lorebookList.find(
					(l) => l.id === panelsCtx.digest.lorebookId
				) || null
			isEditingLorebook = true
			delete panelsCtx.digest.lorebookId
		}
	})

	$effect(() => {
		if (panelsCtx.digest.historyEntryId) {
			editGroup = "history"
			focusHistoryEntryId = panelsCtx.digest.historyEntryId
			focusHistoryEntryTab = panelsCtx.digest.historyEntryTab ?? "content"
			focusSceneId = panelsCtx.digest.sceneId
			delete panelsCtx.digest.historyEntryId
			delete panelsCtx.digest.historyEntryTab
			delete panelsCtx.digest.sceneId
		}
	})

	onMount(() => {
		socket.on("lorebooks:list", (msg: Sockets.Lorebooks.List.Response) => {
			if (msg.lorebookList) {
				lorebookList = msg.lorebookList
			}
		})
		socket.on(
			"lorebooks:create",
			(msg: Sockets.Lorebooks.Create.Response) => {
				if (msg.lorebook) {
					toaster.success({
						title: "Lorebook Created",
						description: `"${msg.lorebook.name}" created successfully.`
					})
					// Server automatically emits updated list
				}
			}
		)
		socket.on(
			"lorebooks:update",
			(msg: Sockets.Lorebooks.Update.Response) => {
				// Server automatically emits updated list
			}
		)
		socket.on(
			"lorebooks:import",
			(msg: Sockets.Lorebooks.Import.Response) => {
				toaster.success({ title: "Lorebook Imported" })
				// Server automatically emits updated list
			}
		)
		socket.on(
			"lorebooks:delete",
			(msg: Sockets.Lorebooks.Delete.Response) => {
				toaster.success({ title: "Lorebook Deleted" })
				// Server automatically emits updated list
			}
		)
		onclose = handleOnClose
		socket.emit("lorebooks:list", {})
	})

	onDestroy(() => {
		socket.off("lorebooks:list")
		socket.off("lorebooks:create")
		socket.off("lorebooks:update")
		socket.off("lorebooks:import")
		socket.off("lorebooks:delete")
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
					{#if editGroup == "lorebook" && selectedLorebook}
						<EditLorebookForm lorebookId={selectedLorebook.id} />
					{/if}
				</Tabs.Panel>
				<Tabs.Panel value="bindings">
					{#if editGroup == "bindings" && selectedLorebook}
						<LorebookBindingsManager
							lorebookId={selectedLorebook.id}
						/>
					{/if}
				</Tabs.Panel>
				<Tabs.Panel value="world">
					{#if editGroup == "world" && selectedLorebook}
						<WorldLoreManager
							lorebookId={selectedLorebook.id}
							bind:hasUnsavedChanges={tabHasUnsavedChanges}
						/>
					{/if}
				</Tabs.Panel>
				<Tabs.Panel value="characters">
					{#if editGroup == "characters" && selectedLorebook}
						<CharacterLoreManager
							lorebookId={selectedLorebook.id}
							bind:hasUnsavedChanges={tabHasUnsavedChanges}
						/>
					{/if}
				</Tabs.Panel>
				<Tabs.Panel value="history">
					{#if editGroup == "history" && selectedLorebook}
						<HistoryEntryManager
							lorebookId={selectedLorebook.id}
							bind:hasUnsavedChanges={tabHasUnsavedChanges}
							focusHistoryEntryId={focusHistoryEntryId}
							focusEntryTab={focusHistoryEntryTab}
							focusSceneId={focusSceneId}
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
					<LorebookListItem
						lorebook={l}
						onclick={(lorebook) =>
							handleLorebookClick(new MouseEvent("click"), {
								lorebook
							})}
						onEdit={(id) => {
							const lorebook = lorebookList.find(
								(lb) => lb.id === id
							)
							if (lorebook) {
								handleLorebookClick(new MouseEvent("click"), {
									lorebook
								})
							}
						}}
						onDelete={onDeleteClick}
						bindingsCount={l.lorebookBindings?.length || 0}
						worldEntriesCount={l.worldLoreEntries?.length || 0}
						characterEntriesCount={l.characterLoreEntries?.length ||
							0}
						historyEntriesCount={l.historyEntries?.length || 0}
					/>
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
