<script lang="ts">
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { getContext, onDestroy, onMount } from "svelte"
	import { flip } from "svelte/animate"
	import { fade } from "svelte/transition"
	import { FileUpload, Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import { goto } from "$app/navigation"
	import CharacterForm from "../characterForms/CharacterForm.svelte"
	import CharacterCreator from "../modals/CharacterCreatorModal.svelte"
	import CharacterUnsavedChangesModal from "../modals/CharacterUnsavedChangesModal.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { createViewMode } from "$lib/client/utils/viewMode.svelte"
	import type { SpecV3 } from "@lenml/char-card-reader"
	import CharacterListItem from "../listItems/CharacterListItem.svelte"
	import CharacterViewPanel from "../characterForms/CharacterViewPanel.svelte"
	import CharacterCardItem from "../listItems/CharacterCardItem.svelte"
	import EmptyState from "../EmptyState.svelte"
	import ImportConflictModal from "../modals/ImportConflictModal.svelte"
	import CharacterExportModal from "../modals/CharacterExportModal.svelte"
	import { downloadBlob } from "$lib/client/utils/downloadBlob"

	interface Props {
		onclose?: () => Promise<boolean> | undefined
	}

	let { onclose = $bindable() }: Props = $props()

	const socket = useTypedSocket()
	const panelsCtx: PanelsCtx = $state(getContext("panelsCtx"))
	const systemSettingsCtx: SystemSettingsCtx = $state(
		getContext("systemSettingsCtx")
	)
	const userSettingsCtx: UserSettingsCtx = $state(
		getContext("userSettingsCtx")
	)

	let characterList: any[] = $state([])
	let isLoading = $state(true)
	const viewMode = createViewMode("serene-pub:viewMode:charactersSidebar")
	let search = $state("")
	let characterId: number | undefined = $state()
	let viewingId: number | undefined = $state()
	let returnToViewId: number | undefined = $state()
	let isCreating = $state(false)
	let showCharacterCreator = $state(false)
	let showDeleteModal = $state(false)
	let characterToDelete: number | undefined = $state(undefined)
	let showUnsavedChangesModal = $state(false)
	let confirmCloseSidebarResolve: ((v: boolean) => void) | null = null
	let showImportModal = $state(false)
	let onEditFormCancel: (() => void) | undefined = $state()
	let importingLorebook: SpecV3.Lorebook | null = $state(null)
	let importingLorebookCharacter: SelectCharacter | null = $state(null)
	let showLorebookImportConfirmationModal = $state(false)
	// Set when lorebooks:import comes back with status "conflict" — the
	// embedded book's uuid matched a lorebook this user already has, but its
	// content differs.
	let lorebookImportConflict:
		| { existingLorebook: any; lorebookData: object }
		| undefined = $state(undefined)
	let showLorebookImportConflictModal = $state(false)
	// Set when characters:importCard comes back with status "conflict" — the
	// card's uuid matched a character this user already has, but its
	// content differs.
	let characterImportConflict:
		| { existingCharacter: SelectCharacter; file: string }
		| undefined = $state(undefined)
	let showCharacterImportConflictModal = $state(false)
	let exportingCharacter: {
		id: number
		name: string
		nickname?: string | null
		avatar?: string | null
	} | null = $state(null)
	let showExportModal = $state(false)
	let characterFormHasChanges = $state(false)

	// Note: Despite the name "isSafeToClose", this prop actually tracks when there ARE changes
	// It's misnamed in the CharacterForm component - it should be called "hasChanges"

	$effect(() => {
		if (panelsCtx.digest.characterId) {
			// Check if we have unsaved changes
			if (
				characterId !== panelsCtx.digest.characterId &&
				characterFormHasChanges
			) {
				onEditFormCancel?.()
			} else {
				// If no unsaved changes, just set the characterId
				characterId = panelsCtx.digest.characterId
			}
			delete panelsCtx.digest.characterId
		}
	})

	// Same as above, but opens the read-only detail view instead of the edit
	// form — used when arriving from a context that just wants to look up a
	// character (eg. clicking a name in a chat), not edit it.
	$effect(() => {
		if (panelsCtx.digest.viewCharacterId) {
			viewingId = panelsCtx.digest.viewCharacterId
			delete panelsCtx.digest.viewCharacterId
		}
	})

	// Filtered list
	let filteredCharacters: any[] = $derived.by(() => {
		let list = [...characterList]
		// Sort favorites first
		list.sort((a, b) => {
			if (a.isFavorite && !b.isFavorite) return -1
			if (!a.isFavorite && b.isFavorite) return 1
			return 0
		})
		if (!search) return list

		const searchLower = search.toLowerCase()
		return list.filter((c: any) => {
			// Search by name
			if (c.name!.toLowerCase().includes(searchLower)) return true

			// Search by description
			if (
				c.description &&
				c.description.toLowerCase().includes(searchLower)
			)
				return true

			// Search by tags
			if (c.characterTags) {
				const tagMatch = c.characterTags.some(
					(ct: any) =>
						ct.tag &&
						ct.tag.name.toLowerCase().includes(searchLower)
				)
				if (tagMatch) return true
			}

			return false
		})
	})

	function handleCreateClick() {
		// Clear tutorial flag when user interacts with the highlighted button
		if (panelsCtx.digest.tutorial) {
			panelsCtx.digest.tutorial = false
		}

		// Check if easy character creation is enabled
		if (userSettingsCtx.settings?.enableEasyCharacterCreation) {
			showCharacterCreator = true
		} else {
			// Use regular edit form for creation
			isCreating = true
			characterId = undefined
		}
	}

	function handleViewClick(id: number) {
		viewingId = id
	}

	function handleEditClick(id: number) {
		characterId = id
		viewingId = undefined
	}

	function handleEditFromView() {
		returnToViewId = viewingId
		characterId = viewingId
		viewingId = undefined
	}

	function closeCharacterForm() {
		isCreating = false
		characterId = undefined
		const returnId = returnToViewId
		returnToViewId = undefined
		if (returnId) viewingId = returnId
	}

	function handleDeleteClick(id: number) {
		characterToDelete = id
		showDeleteModal = true
	}

	function confirmDelete() {
		if (characterToDelete !== undefined) {
			socket.emit("characters:delete", { id: characterToDelete })
		}
		showDeleteModal = false
		characterToDelete = undefined
		// Optionally, close form if deleting from edit view
		if (characterId === characterToDelete) closeCharacterForm()
	}

	function cancelDelete() {
		showDeleteModal = false
		characterToDelete = undefined
	}

	async function handleOnClose() {
		if (characterFormHasChanges) {
			showUnsavedChangesModal = true
			return new Promise<boolean>((resolve) => {
				confirmCloseSidebarResolve = resolve
			})
		} else {
			return true
		}
	}

	function handleCloseModalDiscard() {
		showUnsavedChangesModal = false
		if (confirmCloseSidebarResolve) confirmCloseSidebarResolve(true)
	}

	function handleCloseModalCancel() {
		showUnsavedChangesModal = false
		if (confirmCloseSidebarResolve) confirmCloseSidebarResolve(false)
	}

	function handleUnsavedChangesOnOpenChange(e: OpenChangeDetails) {
		if (!e.open) {
			showUnsavedChangesModal = false
			if (confirmCloseSidebarResolve) confirmCloseSidebarResolve(false)
		}
	}

	function handleImportClick() {
		showImportModal = true
	}

	// Must match the `lg` breakpoint the desktop/mobile sidebar split
	// actually switches at (see the matching comment in Layout.svelte's
	// openPanel) — otherwise this sidebar (open as the mobile overlay) stays
	// open behind the newly-navigated library page instead of closing.
	async function handleBrowseClick() {
		if (window.innerWidth < 1024) {
			const closed = await panelsCtx.closePanel({ panel: "mobile" })
			if (!closed) return
		}
		goto("/library/characters")
		panelsCtx.fullscreenPanel = null
	}

	async function handleFileImport(details: FileAcceptDetails) {
		if (!details.files || details.files.length === 0) return
		const file = details.files[0]
		const reader = new FileReader()
		reader.onload = function (e) {
			const base64 = (e.target?.result as string)?.split(",")[1]
			if (base64) {
				socket.emit("characters:importCard", { file: base64 })
				showImportModal = false
			}
		}
		reader.readAsDataURL(file)
		showImportModal = false
	}

	function handleCharacterClick(character: any) {
		handleViewClick(character.id)
	}

	function handleChatFromView() {
		if (!viewingId) return
		panelsCtx.digest.chatCharacterId = viewingId
		panelsCtx.openPanel({ key: "chats", toggle: false })
	}

	function confirmLorebookImport() {
		const req = {
			lorebookData: importingLorebook!
		}
		socket.emit("lorebooks:import", req)
		showLorebookImportConfirmationModal = false
		importingLorebook = null
		importingLorebookCharacter = null
	}

	function handleOverwriteLorebookImportConflict() {
		if (!lorebookImportConflict) return
		socket.emit("lorebooks:importResolve", {
			action: "overwrite",
			lorebookData: lorebookImportConflict.lorebookData,
			existingId: lorebookImportConflict.existingLorebook.id
		})
		showLorebookImportConflictModal = false
		lorebookImportConflict = undefined
	}

	function handleImportLorebookAsNewFromConflict() {
		if (!lorebookImportConflict) return
		socket.emit("lorebooks:importResolve", {
			action: "createNew",
			lorebookData: lorebookImportConflict.lorebookData,
			existingId: lorebookImportConflict.existingLorebook.id
		})
		showLorebookImportConflictModal = false
		lorebookImportConflict = undefined
	}

	function handleCancelLorebookImportConflict() {
		showLorebookImportConflictModal = false
		lorebookImportConflict = undefined
	}

	function handleOverwriteCharacterImportConflict() {
		if (!characterImportConflict) return
		socket.emit("characters:importResolve", {
			action: "overwrite",
			file: characterImportConflict.file,
			existingId: characterImportConflict.existingCharacter.id
		})
		showCharacterImportConflictModal = false
		characterImportConflict = undefined
	}

	function handleImportCharacterAsNewFromConflict() {
		if (!characterImportConflict) return
		socket.emit("characters:importResolve", {
			action: "createNew",
			file: characterImportConflict.file,
			existingId: characterImportConflict.existingCharacter.id
		})
		showCharacterImportConflictModal = false
		characterImportConflict = undefined
	}

	function handleCancelCharacterImportConflict() {
		showCharacterImportConflictModal = false
		characterImportConflict = undefined
	}

	function handleExportCharacter(character: {
		id?: number
		name?: string
		nickname?: string | null
		avatar?: string | null
	}) {
		if (!character.id || !character.name) return
		exportingCharacter = {
			id: character.id,
			name: character.name,
			nickname: character.nickname,
			avatar: character.avatar
		}
		showExportModal = true
	}

	function handleConfirmCharacterExport(options: {
		format: "json" | "png"
		lorebookId: number | null
	}) {
		if (!exportingCharacter?.id) return
		socket.emit("characters:exportCard", {
			id: exportingCharacter.id,
			format: options.format,
			lorebookId: options.lorebookId
		})
		showExportModal = false
		exportingCharacter = null
	}

	function handleCancelCharacterExport() {
		showExportModal = false
		exportingCharacter = null
	}

	function cancelLorebookImport() {
		showLorebookImportConfirmationModal = false
		importingLorebook = null
		importingLorebookCharacter = null
	}

	onMount(() => {
		socket.on("characters:list", (msg) => {
			characterList = msg.characterList
			isLoading = false
		})
		// The generic **:error listener in Layout.svelte already toasts this —
		// this just stops the spinner from spinning forever if the initial
		// fetch fails, so it settles into the (accurate enough) empty state.
		socket.on("characters:list:error", () => {
			isLoading = false
		})
		socket.on(
			"characters:importCard",
			(msg: Sockets.Characters.ImportCard.Response) => {
				if (msg.status === "conflict" && msg.conflict) {
					characterImportConflict = msg.conflict
					showCharacterImportConflictModal = true
					return
				}
				if (msg.status === "unchanged") {
					toaster.success({
						title: "Character Already Imported",
						description: `"${msg.character?.nickname || msg.character?.name}" is unchanged — using the existing character.`
					})
					return
				}
				importingLorebook = msg.book || null
				toaster.success({
					title: `Character Imported`,
					description: `Character ${msg.character!.nickname || msg.character!.name} imported successfully.`
				})
				if (!!importingLorebook) {
					importingLorebookCharacter = msg.character || null
					showLorebookImportConfirmationModal = true
				}
			}
		)
		socket.on(
			"characters:importResolve",
			(msg: Sockets.Characters.ImportResolve.Response) => {
				importingLorebook = msg.book || null
				toaster.success({
					title: `Character Imported`,
					description: `Character ${msg.character.nickname || msg.character.name} imported successfully.`
				})
				if (!!importingLorebook) {
					importingLorebookCharacter = msg.character || null
					showLorebookImportConfirmationModal = true
				}
			}
		)
		socket.on(
			"characters:importResolve:error",
			(msg: Sockets.ErrorResponse) => {
				toaster.error({
					title: msg.error || "Failed to resolve character import"
				})
			}
		)
		socket.on("characters:exportCard", (msg) => {
			downloadBlob(msg)
			toaster.success({
				title: "Character Exported",
				description: `Character card exported as ${msg.filename}`
			})
		})
		socket.on(
			"characters:exportCard:error",
			(msg: Sockets.ErrorResponse) => {
				toaster.error({
					title: msg.error || "Failed to export character"
				})
			}
		)
		socket.on(
			"lorebooks:import",
			(msg: Sockets.Lorebooks.Import.Response) => {
				if (msg.status === "conflict" && msg.conflict) {
					lorebookImportConflict = msg.conflict
					showLorebookImportConflictModal = true
					return
				}
				if (msg.status === "unchanged") {
					toaster.success({
						title: "Lorebook Already Imported",
						description: `"${msg.lorebook?.name}" is unchanged — using the existing lorebook.`
					})
					return
				}
				toaster.success({
					title: `Lorebook Imported`,
					description: `Lorebook imported successfully.`
				})
			}
		)
		socket.on("lorebooks:import:error", (msg: Sockets.ErrorResponse) => {
			toaster.error({ title: msg.error || "Failed to import lorebook" })
		})
		socket.on(
			"lorebooks:importResolve",
			(msg: Sockets.Lorebooks.ImportResolve.Response) => {
				toaster.success({
					title: `Lorebook Imported`,
					description: `Lorebook imported successfully.`
				})
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
		// The background vectorization queue updates a row's embeddingModel
		// directly in the DB — without this, the list here only ever refreshes
		// on the next explicit characters:list, leaving the embedding-status
		// badge showing stale info until a manual refresh.
		socket.on(
			"vectorization:itemUpdated",
			(msg: Sockets.Vectorization.ItemUpdated.Response) => {
				if (msg.type !== "character") return
				const target = characterList.find((c: any) => c.id === msg.id)
				if (target) (target as any).embeddingModel = msg.embeddingModel
			}
		)
		socket.emit("characters:list", {})
		onclose = handleOnClose
	})

	onDestroy(() => {
		socket.off("characters:list")
		socket.off("characters:list:error")
		socket.off("vectorization:itemUpdated")
		socket.off("characters:importCard")
		socket.off("characters:importResolve")
		socket.off("characters:importResolve:error")
		socket.off("characters:exportCard")
		socket.off("characters:exportCard:error")
		socket.off("lorebooks:import")
		socket.off("lorebooks:import:error")
		socket.off("lorebooks:importResolve")
		socket.off("lorebooks:importResolve:error")
		onclose = undefined
	})
</script>

<div
	class="text-foreground h-full p-4"
	role="region"
	aria-label="Characters management"
>
	{#if isCreating}
		<section aria-label="Create new character">
			<CharacterForm
				bind:isSafeToClose={characterFormHasChanges}
				closeForm={closeCharacterForm}
				bind:onCancel={onEditFormCancel}
			/>
		</section>
	{:else if characterId}
		{#key characterId}
			<section aria-label="Edit character">
				<CharacterForm
					bind:isSafeToClose={characterFormHasChanges}
					{characterId}
					closeForm={closeCharacterForm}
					bind:onCancel={onEditFormCancel}
				/>
			</section>
		{/key}
	{:else if viewingId}
		{#key viewingId}
			<section aria-label="View character" class="h-full">
				<CharacterViewPanel
					characterId={viewingId}
					onBack={() => (viewingId = undefined)}
					onEdit={handleEditFromView}
					onChat={handleChatFromView}
					onExport={handleExportCharacter}
				/>
			</section>
		{/key}
	{:else}
		<div
			class="mb-2 flex gap-2"
			role="toolbar"
			aria-label="Character actions"
		>
			<button
				class="btn btn-sm preset-filled-primary-500 {panelsCtx.digest
					.tutorial
					? 'ring-primary-500/50 animate-pulse ring-4'
					: ''}"
				onclick={handleCreateClick}
				title="Create New Character"
				aria-label="Create new character"
				type="button"
			>
				<Icons.Plus size={16} aria-hidden="true" />
				New
			</button>
			<button
				class="btn btn-sm preset-tonal-primary"
				title="Import Character"
				onclick={handleImportClick}
				aria-label="Import character from file"
				type="button"
			>
				<Icons.Upload size={16} aria-hidden="true" />
				Import
			</button>
			<button
				class="btn btn-sm preset-tonal-primary"
				title="Browse Character Library"
				onclick={handleBrowseClick}
				aria-label="Browse the character library"
				type="button"
			>
				<Icons.Library size={16} aria-hidden="true" />
				Browse
			</button>
		</div>
		<div class="mb-4 flex items-center gap-2">
			<label for="character-search" class="sr-only">
				Search characters
			</label>
			<input
				id="character-search"
				type="text"
				placeholder="Search"
				class="input"
				bind:value={search}
				aria-label="Search characters by name, description, or tags"
			/>
			<div
				class="flex shrink-0 gap-1"
				role="group"
				aria-label="View mode"
			>
				<button
					type="button"
					class="btn btn-sm p-2 {viewMode.value === 'list'
						? 'preset-filled-primary-500'
						: 'preset-tonal-surface'}"
					onclick={() => (viewMode.value = "list")}
					title="List view"
					aria-label="List view"
					aria-pressed={viewMode.value === "list"}
				>
					<Icons.List size={16} aria-hidden="true" />
				</button>
				<button
					type="button"
					class="btn btn-sm p-2 {viewMode.value === 'cards'
						? 'preset-filled-primary-500'
						: 'preset-tonal-surface'}"
					onclick={() => (viewMode.value = "cards")}
					title="Card view"
					aria-label="Card view"
					aria-pressed={viewMode.value === "cards"}
				>
					<Icons.LayoutGrid size={16} aria-hidden="true" />
				</button>
			</div>
		</div>
		{#if isLoading}
			<div class="flex items-center justify-center py-8">
				<Icons.Loader2
					size={20}
					class="text-surface-400 animate-spin"
				/>
			</div>
		{:else if filteredCharacters.length === 0}
			<EmptyState
				icon={Icons.Users}
				message={search
					? `No characters found matching "${search}".`
					: "No characters yet — create one to get started."}
				ctaLabel={search ? undefined : "New Character"}
				onCta={search ? undefined : () => (isCreating = true)}
			/>
		{:else if viewMode.value === "list"}
			<div
				class="flex flex-col gap-2"
				role="list"
				aria-label="Characters list"
			>
				{#each filteredCharacters as c (c.id)}
					<div
						animate:flip={{ duration: 200 }}
						out:fade={{ duration: 150 }}
					>
						<CharacterListItem
							character={c}
							onclick={handleCharacterClick}
							onEdit={handleEditClick}
							onDelete={handleDeleteClick}
							onExport={handleExportCharacter}
							contentTitle="Go to character chats"
						/>
					</div>
				{/each}
			</div>
		{:else}
			<!--
				The sidebar's grid needs to respond to ITS OWN width (a fixed
				25% of viewport), not the viewport's width — a viewport-based
				breakpoint (sm/md/lg) gives the same column count whether this
				sidebar is 300px wide (a 1440px window) or 950px wide (a 4K
				window). A fixed set of named breakpoints has the same problem
				at the other end: capping at grid-cols-5 forever means a 4K
				fullscreen panel (3800px+ wide) renders 5 columns of ~750px
				cards instead of more, smaller ones. auto-fill/minmax scales
				column count continuously off the grid's own width with no
				named breakpoints (and no ceiling) at all.
			-->
			<div>
				<div
					class="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3"
					role="list"
					aria-label="Characters list"
				>
					{#each filteredCharacters as c (c.id)}
						<div
							animate:flip={{ duration: 200 }}
							out:fade={{ duration: 150 }}
						>
							<CharacterCardItem
								character={c}
								onclick={handleCharacterClick}
								onEdit={handleEditClick}
								onDelete={handleDeleteClick}
								onExport={handleExportCharacter}
								contentTitle="Go to character chats"
							/>
						</div>
					{/each}
				</div>
			</div>
		{/if}
	{/if}
</div>

{#if showDeleteModal}
	<Dialog
		open={showDeleteModal}
		onOpenChange={(e) => (showDeleteModal = e.open)}
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
					role="alertdialog"
					aria-labelledby="delete-modal-title"
					aria-describedby="delete-modal-description"
				>
					<div class="p-6">
						<h2
							id="delete-modal-title"
							class="mb-2 text-lg font-bold"
						>
							Delete Character?
						</h2>
						<p id="delete-modal-description" class="mb-4">
							Are you sure you want to delete this character? This
							action cannot be undone.
						</p>
						<div
							class="flex justify-end gap-2"
							role="group"
							aria-label="Delete confirmation actions"
						>
							<button
								class="btn preset-filled-surface-500"
								onclick={cancelDelete}
								type="button"
								aria-label="Cancel deletion"
							>
								Cancel
							</button>
							<button
								class="btn preset-filled-error-500"
								onclick={confirmDelete}
								type="button"
								aria-label="Confirm deletion"
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

{#if showImportModal}
	<Dialog
		open={showImportModal}
		onOpenChange={(e) => (showImportModal = e.open)}
	>
		<Portal>
			<Dialog.Backdrop
				class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
			/>
			<Dialog.Positioner
				class="fixed inset-0 z-50 flex items-center justify-center p-4"
			>
				<Dialog.Content
					class="card bg-surface-100-900 w-[min(95vw,560px)] space-y-4 p-4 shadow-xl"
				>
					<div class="p-6">
						<h2 class="mb-2 text-lg font-bold">Import Character</h2>
						<div class="space-y-2">
							<div>
								<p
									class="text-surface-600 dark:text-surface-400 mb-2 text-sm"
								>
									Upload a file (PNG, APNG, JPEG, JPG, WEBP,
									JSON):
								</p>
								<FileUpload
									name="example"
									accept=".png,.apng,.jpeg, .jpg, .webp, .json"
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
										<span
											class="text-surface-700-300 text-xs"
										>
											or drag and drop
										</span>
										<FileUpload.HiddenInput />
									</FileUpload.Dropzone>
								</FileUpload>
							</div>
						</div>
						<div class="mt-4 flex gap-2">
							<button
								class="btn preset-filled-surface-500"
								onclick={() => (showImportModal = false)}
							>
								Cancel
							</button>
						</div>
					</div>
				</Dialog.Content>
			</Dialog.Positioner>
		</Portal>
	</Dialog>
{/if}

{#if showLorebookImportConfirmationModal}
	<Dialog
		open={showLorebookImportConfirmationModal}
		onOpenChange={(e) => {
			showLorebookImportConfirmationModal = e.open
			importingLorebook = null
			importingLorebookCharacter = null
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
						<h2 class="mb-2 text-lg font-bold">Import Lorebook?</h2>
						<p class="mb-4">
							A lorebook is associated with this character card.
							Would you like to import it?
						</p>
						<label
							class="mb-2 block font-semibold"
							for="lorebookName"
						>
							Lorebook Name
						</label>
						<input
							name="lorebookName"
							type="text"
							class="input mb-4 w-full"
							bind:value={importingLorebook!.name}
						/>
						<div class="flex justify-end gap-2">
							<button
								class="btn preset-filled-surface-500"
								onclick={cancelLorebookImport}
							>
								Cancel
							</button>
							<button
								class="btn preset-filled-primary-500"
								onclick={confirmLorebookImport}
							>
								Import Lorebook
							</button>
						</div>
					</div>
				</Dialog.Content>
			</Dialog.Positioner>
		</Portal>
	</Dialog>
{/if}

{#if lorebookImportConflict}
	<ImportConflictModal
		open={showLorebookImportConflictModal}
		onOpenChange={(e) => {
			showLorebookImportConflictModal = e.open
			if (!e.open) lorebookImportConflict = undefined
		}}
		entityLabel="Lorebook"
		existingName={lorebookImportConflict.existingLorebook.name}
		onOverwrite={handleOverwriteLorebookImportConflict}
		onImportAsNew={handleImportLorebookAsNewFromConflict}
		onCancel={handleCancelLorebookImportConflict}
	/>
{/if}

{#if characterImportConflict}
	<ImportConflictModal
		open={showCharacterImportConflictModal}
		onOpenChange={(e) => {
			showCharacterImportConflictModal = e.open
			if (!e.open) characterImportConflict = undefined
		}}
		entityLabel="Character"
		existingName={characterImportConflict.existingCharacter.nickname ||
			characterImportConflict.existingCharacter.name}
		onOverwrite={handleOverwriteCharacterImportConflict}
		onImportAsNew={handleImportCharacterAsNewFromConflict}
		onCancel={handleCancelCharacterImportConflict}
	/>
{/if}

<CharacterExportModal
	open={showExportModal}
	onOpenChange={(e) => {
		showExportModal = e.open
		if (!e.open) exportingCharacter = null
	}}
	character={exportingCharacter}
	onConfirm={handleConfirmCharacterExport}
	onCancel={handleCancelCharacterExport}
/>

{#if showUnsavedChangesModal}
	<CharacterUnsavedChangesModal
		open={showUnsavedChangesModal}
		onOpenChange={handleUnsavedChangesOnOpenChange}
		onConfirm={handleCloseModalDiscard}
		onCancel={handleCloseModalCancel}
	/>
{/if}

<!-- Character Creator Modal -->
<CharacterCreator
	bind:open={showCharacterCreator}
	onOpenChange={(e) => (showCharacterCreator = e.open)}
/>
