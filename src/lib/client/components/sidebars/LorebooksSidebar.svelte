<script lang="ts">
	import { getContext, onDestroy, onMount, tick } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import * as Icons from "@lucide/svelte"
	import NewNameModal from "../modals/NewNameModal.svelte"
	import EditLorebookForm from "../lorebookForms/EditLorebookForm.svelte"
	import {
		FileUpload,
		Dialog,
		Portal,
		Tabs
	} from "@skeletonlabs/skeleton-svelte"
	import LorebookBindingsManager from "../lorebookForms/LorebookBindingsManager.svelte"
	import WorldLoreManager from "../lorebookForms/WorldLoreManager.svelte"
	import type { ValueChangeDetails } from "@zag-js/tabs"
	import LorebookUnsavedChangesModal from "../modals/LorebookUnsavedChangesModal.svelte"
	import CharacterLoreManager from "../lorebookForms/CharacterLoreManager.svelte"
	import HistoryEntryManager from "../lorebookForms/HistoryEntryManager.svelte"
	import GraphManager from "../lorebookForms/GraphManager.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import type { SpecV3 } from "@lenml/char-card-reader"
	import LorebookListItem from "../listItems/LorebookListItem.svelte"
	import EmptyState from "../EmptyState.svelte"
	import ImportConflictModal from "../modals/ImportConflictModal.svelte"
	import LorebookExportOptionsModal from "../modals/LorebookExportOptionsModal.svelte"
	import { downloadBlob } from "$lib/client/utils/downloadBlob"

	interface Props {
		onclose?: () => Promise<boolean> | undefined
	}

	type EditGroup =
		| "lorebook"
		| "bindings"
		| "world"
		| "characters"
		| "history"
		| "graph"

	let { onclose = $bindable() }: Props = $props()

	const socket = useTypedSocket()
	let lorebookList: any[] = $state([])
	let isLoading: boolean = $state(true)
	let search: string = $state("")
	let isCreating: boolean = $state(false)
	let isEditingLorebook: boolean = $state(false)
	let selectedLorebook: any = $state(undefined)
	let editGroup: EditGroup = $state("lorebook")
	let nextEditGroup: EditGroup | undefined = $state()
	let tabHasUnsavedChanges: boolean = $state(false)
	let lorebookFormMode = $state<"view" | "edit">("view")
	let tabsDisabled = $derived(
		lorebookFormMode === "edit" || tabHasUnsavedChanges
	)
	let showUnsavedChangesModal: boolean = $state(false)
	let showUnsavedTabChangesModal: boolean = $state(false)
	let confirmCloseSidebarResolve: ((v: boolean) => void) | null = null
	let showImportModal: boolean = $state(false)
	let importingBook: SpecV3.Lorebook | undefined = $state(undefined)
	// Set when lorebooks:import comes back with status "conflict" — the
	// incoming uuid matched an existing lorebook but its content differs.
	let importConflict:
		| { existingLorebook: any; lorebookData: object }
		| undefined = $state(undefined)
	let showImportConflictModal: boolean = $state(false)
	let exportingLorebookId: number | null = $state(null)
	let showExportOptionsModal: boolean = $state(false)
	let deletingLorebookId: number | undefined = $state(undefined)
	let showDeleteConfirmationModal: boolean = $state(false)
	let panelsCtx: PanelsCtx = $state(getContext("panelsCtx"))
	let systemSettingsCtx: SystemSettingsCtx = $state(
		getContext("systemSettingsCtx")
	)
	let openChatCtx: OpenChatCtx = $state(getContext("openChatCtx"))

	// Building a graph is pure LLM extraction from scene summaries — it never
	// touches embeddings (see graphBuilder.ts), so this only needs summarization
	// on, not vectorization too. The keyword-based infill path can now surface
	// graph content without RAG as well (see KeywordInfillEngine.ts).
	let graphEnabled = $derived(
		!!systemSettingsCtx.settings?.summarizationEnabled
	)

	// Guests can view a shared chat but can't reconfigure it — the server
	// rejects chats:setLorebook for non-owners anyway, this just avoids
	// showing an action that would fail with an error toast.
	let hasOpenChat = $derived(
		openChatCtx.chatId !== null && openChatCtx.isOwner
	)
	let openChatHasLorebook = $derived(openChatCtx.lorebookId !== null)

	function handleAttachToChat(lorebookId: number) {
		if (openChatCtx.chatId === null) return
		socket.emit("chats:setLorebook", {
			chatId: openChatCtx.chatId,
			lorebookId
		})
	}

	function handleDetachFromChat() {
		if (openChatCtx.chatId === null) return
		socket.emit("chats:setLorebook", {
			chatId: openChatCtx.chatId,
			lorebookId: null
		})
	}

	// If graph tab is active but graph becomes unavailable, fall back to world lore
	$effect(() => {
		if (!graphEnabled && editGroup === "graph") {
			editGroup = "world"
		}
	})

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
		{
			lorebook,
			tab,
			startEditing = false
		}: { lorebook: SelectLorebook; tab?: EditGroup; startEditing?: boolean }
	) {
		e.preventDefault()
		e.stopPropagation()
		selectedLorebook = lorebook
		isEditingLorebook = true
		lorebookFormMode = startEditing ? "edit" : "view"
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
			if (e.value !== "lorebook") lorebookFormMode = "view"
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
				toaster.error({ title: "Invalid JSON file" })
			}
		}
		reader.readAsText(file)
	}

	function handleImportConfirm() {
		if (importingBook && importingBook.name?.trim()) {
			const req: Sockets.Lorebooks.Import.Params = {
				lorebookData: importingBook
			}
			socket.emit("lorebooks:import", req)
			showImportModal = false
			importingBook = undefined
		}
	}

	function handleExportLorebook(id: number) {
		exportingLorebookId = id
		showExportOptionsModal = true
	}

	function handleConfirmExportOptions(options: {
		includeCharacters: boolean
		includePersonas: boolean
		includeNarrativeGraph: boolean
	}) {
		if (exportingLorebookId === null) return
		socket.emit("lorebooks:export", { id: exportingLorebookId, ...options })
		showExportOptionsModal = false
		exportingLorebookId = null
	}

	function handleCancelExportOptions() {
		showExportOptionsModal = false
		exportingLorebookId = null
	}

	function handleOverwriteImportConflict() {
		if (!importConflict) return
		const req: Sockets.Lorebooks.ImportResolve.Params = {
			action: "overwrite",
			lorebookData: importConflict.lorebookData,
			existingId: importConflict.existingLorebook.id
		}
		socket.emit("lorebooks:importResolve", req)
		showImportConflictModal = false
		importConflict = undefined
	}

	function handleImportAsNewFromConflict() {
		if (!importConflict) return
		const req: Sockets.Lorebooks.ImportResolve.Params = {
			action: "createNew",
			lorebookData: importConflict.lorebookData,
			existingId: importConflict.existingLorebook.id
		}
		socket.emit("lorebooks:importResolve", req)
		showImportConflictModal = false
		importConflict = undefined
	}

	function handleCancelImportConflict() {
		showImportConflictModal = false
		importConflict = undefined
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
			if (panelsCtx.digest.lorebookTab) {
				editGroup = panelsCtx.digest.lorebookTab as EditGroup
				delete panelsCtx.digest.lorebookTab
			}
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
			isLoading = false
		})
		// The generic **:error listener in Layout.svelte already toasts this —
		// this just stops the spinner from spinning forever if the initial
		// fetch fails, so it settles into the (accurate enough) empty state.
		socket.on("lorebooks:list:error", () => {
			isLoading = false
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
				if (msg.status === "conflict" && msg.conflict) {
					importConflict = msg.conflict
					showImportConflictModal = true
					return
				}
				if (msg.status === "unchanged") {
					toaster.success({
						title: "Already Imported",
						description: `"${msg.lorebook?.name}" is unchanged — using the existing lorebook.`
					})
					return
				}
				toaster.success({ title: "Lorebook Imported" })
				// Server automatically emits updated list
			}
		)
		socket.on("lorebooks:import:error", (msg: Sockets.ErrorResponse) => {
			toaster.error({ title: msg.error || "Failed to import lorebook" })
		})
		socket.on(
			"lorebooks:importResolve",
			(msg: Sockets.Lorebooks.ImportResolve.Response) => {
				toaster.success({ title: "Lorebook Imported" })
				// Server automatically emits updated list
			}
		)
		socket.on(
			"lorebooks:importResolve:error",
			(msg: Sockets.ErrorResponse) => {
				toaster.error({
					title: msg.error || "Failed to resolve lorebook import"
				})
			}
		)
		socket.on(
			"lorebooks:export",
			(msg: Sockets.Lorebooks.Export.Response) => {
				downloadBlob(msg)
				toaster.success({
					title: "Lorebook Exported",
					description: `Lorebook exported as ${msg.filename}`
				})
			}
		)
		socket.on("lorebooks:export:error", (msg: Sockets.ErrorResponse) => {
			toaster.error({ title: msg.error || "Failed to export lorebook" })
		})
		socket.on(
			"lorebooks:delete",
			(msg: Sockets.Lorebooks.Delete.Response) => {
				toaster.success({ title: "Lorebook Deleted" })
				// Server automatically emits updated list
			}
		)
		socket.on(
			"chats:setLorebook",
			(msg: Sockets.Chats.SetLorebook.Response) => {
				if (
					!msg.chat ||
					openChatCtx.chatId === null ||
					msg.chat.id !== openChatCtx.chatId
				)
					return
				toaster.success({
					title: msg.chat.lorebookId
						? "Lorebook Attached"
						: "Lorebook Detached"
				})
				// Full reload of the open chat, not just a field patch — lore-bound
				// content (RAG notices, etc.) can depend on the chat's lorebook.
				socket.emit("chats:get", { id: openChatCtx.chatId, limit: 25 })
			}
		)
		onclose = handleOnClose
		socket.emit("lorebooks:list", {})
	})

	onDestroy(() => {
		socket.off("lorebooks:list")
		socket.off("lorebooks:list:error")
		socket.off("lorebooks:create")
		socket.off("lorebooks:update")
		socket.off("lorebooks:import")
		socket.off("lorebooks:import:error")
		socket.off("lorebooks:importResolve")
		socket.off("lorebooks:importResolve:error")
		socket.off("lorebooks:export")
		socket.off("lorebooks:export:error")
		socket.off("lorebooks:delete")
		socket.off("chats:setLorebook")
		onclose = undefined
	})
</script>

<div class="min-h-full p-4">
	{#if isEditingLorebook}
		<div class="mb-4 flex items-center gap-2">
			<button
				class="btn btn-sm preset-filled-surface-400-600"
				onclick={() => {
					isEditingLorebook = false
				}}
				title="Back to lorebooks"
			>
				<Icons.ChevronLeft size={16} />
				Back
			</button>
			<h2 class="flex-1 truncate font-semibold">
				{selectedLorebook?.name || "Lorebook"}
			</h2>
			{#if hasOpenChat && selectedLorebook}
				{#if openChatCtx.lorebookId === selectedLorebook.id}
					<button
						class="btn btn-sm preset-filled-warning-500"
						onclick={handleDetachFromChat}
						title="Detach from current chat"
					>
						<Icons.Unlink size={16} />
						Detach from Chat
					</button>
				{:else}
					<button
						class="btn btn-sm preset-filled-primary-500"
						onclick={() => handleAttachToChat(selectedLorebook.id)}
						disabled={openChatHasLorebook}
						title={openChatHasLorebook
							? "The current chat already has a lorebook attached"
							: "Attach to current chat"}
					>
						<Icons.Link size={16} />
						Attach to Chat
					</button>
				{/if}
			{/if}
		</div>
		<Tabs value={editGroup} onValueChange={(e) => handleSwitchTabGroup(e)}>
			<Tabs.List class="flex flex-wrap gap-1">
				<Tabs.Trigger
					value="lorebook"
					disabled={tabsDisabled && editGroup !== "lorebook"}
				>
					<span
						title="Lorebook"
						aria-label="Lorebook tab"
						class="flex items-center gap-1"
					>
						<Icons.Book size={20} class="inline" />
						{#if editGroup === "lorebook"}
							Lorebook
						{/if}
					</span>
				</Tabs.Trigger>
				<Tabs.Trigger value="bindings" disabled={tabsDisabled}>
					<span
						title="Bindings"
						aria-label="Bindings tab"
						class="flex items-center gap-1"
					>
						<Icons.Link size={20} class="inline" />
						{#if editGroup === "bindings"}
							Bindings
						{/if}
					</span>
				</Tabs.Trigger>
				<Tabs.Trigger value="world" disabled={tabsDisabled}>
					<span
						title="World Lore"
						aria-label="World Lore tab"
						class="flex items-center gap-1"
					>
						<Icons.Globe size={20} class="inline" />
						{#if editGroup === "world"}
							World Lore
						{/if}
					</span>
				</Tabs.Trigger>
				<Tabs.Trigger value="characters" disabled={tabsDisabled}>
					<span
						title="Character Lore"
						aria-label="Character Lore tab"
						class="flex items-center gap-1"
					>
						<Icons.User size={20} class="inline" />
						{#if editGroup === "characters"}
							Character Lore
						{/if}
					</span>
				</Tabs.Trigger>
				<Tabs.Trigger value="history" disabled={tabsDisabled}>
					<span
						title="History"
						aria-label="History tab"
						class="flex items-center gap-1"
					>
						<Icons.Calendar size={20} class="inline" />
						{#if editGroup === "history"}
							History
						{/if}
					</span>
				</Tabs.Trigger>
				{#if graphEnabled}
					<Tabs.Trigger value="graph" disabled={tabsDisabled}>
						<span
							title="Graph"
							aria-label="Graph tab"
							class="flex items-center gap-1"
						>
							<Icons.Network size={20} class="inline" />
							{#if editGroup === "graph"}
								Graph
							{/if}
						</span>
					</Tabs.Trigger>
				{/if}
			</Tabs.List>
			<Tabs.Content value="lorebook">
				{#if editGroup == "lorebook" && selectedLorebook}
					<EditLorebookForm
						lorebookId={selectedLorebook.id}
						bind:mode={lorebookFormMode}
						bind:hasUnsavedChanges={tabHasUnsavedChanges}
						onExport={handleExportLorebook}
					/>
				{/if}
			</Tabs.Content>
			<Tabs.Content value="bindings">
				{#if editGroup == "bindings" && selectedLorebook}
					<LorebookBindingsManager lorebookId={selectedLorebook.id} />
				{/if}
			</Tabs.Content>
			<Tabs.Content value="world">
				{#if editGroup == "world" && selectedLorebook}
					<WorldLoreManager
						lorebookId={selectedLorebook.id}
						bind:hasUnsavedChanges={tabHasUnsavedChanges}
					/>
				{/if}
			</Tabs.Content>
			<Tabs.Content value="characters">
				{#if editGroup == "characters" && selectedLorebook}
					<CharacterLoreManager
						lorebookId={selectedLorebook.id}
						bind:hasUnsavedChanges={tabHasUnsavedChanges}
					/>
				{/if}
			</Tabs.Content>
			<Tabs.Content value="history">
				{#if editGroup == "history" && selectedLorebook}
					<HistoryEntryManager
						lorebookId={selectedLorebook.id}
						bind:hasUnsavedChanges={tabHasUnsavedChanges}
						{focusHistoryEntryId}
						focusEntryTab={focusHistoryEntryTab}
						{focusSceneId}
						onNavigateToGraph={graphEnabled
							? () => {
									editGroup = "graph"
								}
							: undefined}
					/>
				{/if}
			</Tabs.Content>
			{#if graphEnabled}
				<Tabs.Content value="graph">
					{#if editGroup == "graph" && selectedLorebook}
						<GraphManager lorebookId={selectedLorebook.id} />
					{/if}
				</Tabs.Content>
			{/if}
		</Tabs>
	{:else}
		<div class="mb-2 flex gap-2">
			<button
				class="btn btn-sm preset-filled-primary-500"
				onclick={handleCreateClick}
				title="Create New Lorebook"
			>
				<Icons.Plus size={16} />
				New
			</button>
			<button
				class="btn btn-sm preset-tonal-primary"
				title="Import Lorebook"
				onclick={handleImportClick}
			>
				<Icons.Upload size={16} />
				Import
			</button>
		</div>
		<div class="mb-4 flex items-center gap-2">
			<input
				type="text"
				placeholder="Search lorebooks..."
				aria-label="Search lorebooks"
				class="input"
				bind:value={search}
			/>
		</div>
		<div class="flex flex-col gap-2">
			{#if isLoading}
				<div class="flex items-center justify-center py-8">
					<Icons.Loader2
						size={20}
						class="text-surface-400 animate-spin"
					/>
				</div>
			{:else if filteredLorebooks.length === 0}
				<EmptyState
					icon={Icons.Book}
					message={search
						? `No lorebooks found matching "${search}".`
						: "No lorebooks yet — create one to get started."}
					ctaLabel={search ? undefined : "New Lorebook"}
					onCta={search ? undefined : () => (isCreating = true)}
				/>
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
									lorebook,
									startEditing: true
								})
							}
						}}
						onDelete={onDeleteClick}
						onExport={handleExportLorebook}
						bindingsCount={l.lorebookBindings?.length || 0}
						worldEntriesCount={l.worldLoreEntries?.length || 0}
						characterEntriesCount={l.characterLoreEntries?.length ||
							0}
						historyEntriesCount={l.historyEntries?.length || 0}
						{hasOpenChat}
						{openChatHasLorebook}
						isOpenChatLorebook={openChatCtx.lorebookId === l.id}
						onAttachToChat={handleAttachToChat}
						onDetachFromChat={handleDetachFromChat}
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

{#if importConflict}
	<ImportConflictModal
		open={showImportConflictModal}
		onOpenChange={(e) => {
			showImportConflictModal = e.open
			if (!e.open) importConflict = undefined
		}}
		entityLabel="Lorebook"
		existingName={importConflict.existingLorebook.name}
		onOverwrite={handleOverwriteImportConflict}
		onImportAsNew={handleImportAsNewFromConflict}
		onCancel={handleCancelImportConflict}
	/>
{/if}

{#if exportingLorebookId !== null}
	<LorebookExportOptionsModal
		open={showExportOptionsModal}
		onOpenChange={(e) => {
			showExportOptionsModal = e.open
			if (!e.open) exportingLorebookId = null
		}}
		onConfirm={handleConfirmExportOptions}
		onCancel={handleCancelExportOptions}
	/>
{/if}

{#if showImportModal}
	<Dialog
		open={showImportModal}
		onOpenChange={(e) => {
			showImportModal = e.open
			if (!e.open) importingBook = undefined
		}}
	>
		<Portal>
			<Dialog.Backdrop
				class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
			/>
			<Dialog.Positioner
				class="fixed inset-0 z-50 flex items-center justify-center p-4"
			>
				<Dialog.Content
					class="card bg-surface-100-900 border-surface-300-700 max-w-[95vw] space-y-4 border p-4 shadow-xl"
				>
					<div class="p-6">
						<h2 class="mb-2 text-lg font-bold">Import Lorebook</h2>
						{#if !importingBook}
							<label class="mb-2" for="file-upload">
								Select a file.
							</label>
							<FileUpload
								name="file-upload"
								accept=".json"
								maxFiles={1}
								onFileAccept={handleFileImport}
								onFileReject={console.error}
							>
								<FileUpload.Dropzone
									class="border-surface-300-700 bg-surface-50-950 hover:bg-surface-100-900 flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6"
								>
									<Icons.Upload
										class="text-surface-700-300 h-8 w-8"
									/>
									<FileUpload.Trigger
										class="btn btn-sm preset-filled-primary-500"
									>
										Browse
									</FileUpload.Trigger>
									<span class="text-surface-700-300 text-xs">
										or drag and drop
									</span>
									<FileUpload.HiddenInput />
								</FileUpload.Dropzone>
							</FileUpload>
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
									class="btn preset-filled-primary-500"
									disabled={!importingBook?.name?.trim()}
									onclick={handleImportConfirm}
								>
									Import
								</button>
							{/if}
						</div>
					</div>
				</Dialog.Content>
			</Dialog.Positioner>
		</Portal>
	</Dialog>
{/if}

{#if showDeleteConfirmationModal}
	<Dialog
		open={showDeleteConfirmationModal}
		onOpenChange={(e) => {
			showDeleteConfirmationModal = e.open
			if (!e.open) deletingLorebookId = undefined
		}}
	>
		<Portal>
			<Dialog.Backdrop
				class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
			/>
			<Dialog.Positioner
				class="fixed inset-0 z-50 flex items-center justify-center p-4"
			>
				<Dialog.Content
					class="card bg-surface-100-900 border-surface-300-700 max-w-[95vw] space-y-4 border p-4 shadow-xl"
				>
					<div class="p-6">
						<h2 class="text-error-500 mb-2 text-lg font-bold">
							Delete Lorebook?
						</h2>
						<p class="mb-4">
							Are you sure you want to delete this lorebook? This
							action cannot be undone.
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
				</Dialog.Content>
			</Dialog.Positioner>
		</Portal>
	</Dialog>
{/if}
