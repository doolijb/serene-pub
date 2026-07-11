<script lang="ts">
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { getContext, onDestroy, onMount } from "svelte"
	import { FileUpload, Modal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import CharacterForm from "../characterForms/CharacterForm.svelte"
	import CharacterCreator from "../modals/CharacterCreatorModal.svelte"
	import CharacterUnsavedChangesModal from "../modals/CharacterUnsavedChangesModal.svelte"
	import CharacterLibraryModal from "../modals/CharacterLibraryModal.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import type { SpecV3 } from "@lenml/char-card-reader"
	import CharacterListItem from "../listItems/CharacterListItem.svelte"
	import CharacterViewPanel from "../characterForms/CharacterViewPanel.svelte"

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
	let showLibraryModal = $state(false)
	let onEditFormCancel: (() => void) | undefined = $state()
	let importingLorebook: SpecV3.Lorebook | null = $state(null)
	let importingLorebookCharacter: SelectCharacter | null = $state(null)
	let showLorebookImportConfirmationModal = $state(false)
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

	async function handleFileImport(details: FileAcceptDetails) {
		console.log("File import details:", details)
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
			lorebookData: importingLorebook!,
			characterId: importingLorebookCharacter?.id
		}
		socket.emit("lorebooks:import", req)
		showLorebookImportConfirmationModal = false
		importingLorebook = null
		importingLorebookCharacter = null
	}

	function cancelLorebookImport() {
		showLorebookImportConfirmationModal = false
		importingLorebook = null
		importingLorebookCharacter = null
	}

	onMount(() => {
		socket.on("characters:list", (msg) => {
			characterList = msg.characterList
		})
		socket.on("characters:importCard", (msg) => {
			importingLorebook = msg.book || null
			toaster.success({
				title: `Character Imported`,
				description: `Character ${msg.character.nickname || msg.character.name} imported successfully.`
			})
			if (!!importingLorebook) {
				importingLorebookCharacter = importingLorebook.character || null
				showLorebookImportConfirmationModal = true
			}
		})
		socket.on("lorebooks:import", (msg) => {
			toaster.success({
				title: `Lorebook Imported`,
				description: `Lorebook imported successfully.`
			})
		})
		socket.emit("characters:list", {})
		onclose = handleOnClose
	})

	onDestroy(() => {
		socket.off("characters:list")
		socket.off("characters:importCard")
		socket.off("lorebooks:import")
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
			</button>
			<button
				class="btn btn-sm preset-filled-primary-500"
				title="Import Character"
				onclick={handleImportClick}
				aria-label="Import character from file"
				type="button"
			>
				<Icons.Download size={16} aria-hidden="true" />
			</button>
		</div>
		<div class="mb-4 flex items-center gap-2">
			<label for="character-search" class="sr-only">
				Search characters
			</label>
			<input
				id="character-search"
				type="text"
				placeholder="Search characters, descriptions, tags..."
				class="input"
				bind:value={search}
				aria-label="Search characters by name, description, or tags"
			/>
		</div>
		<div
			class="flex flex-col gap-2"
			role="list"
			aria-label="Characters list"
		>
			{#if filteredCharacters.length === 0}
				<div
					class="text-muted-foreground relative w-100 py-8 text-center"
					role="status"
					aria-live="polite"
				>
					{search
						? `No characters found matching "${search}".`
						: "No characters found."}
				</div>
			{:else}
				{#each filteredCharacters as c}
					<CharacterListItem
						character={c}
						onclick={handleCharacterClick}
						onEdit={handleEditClick}
						onDelete={handleDeleteClick}
						contentTitle="Go to character chats"
					/>
				{/each}
			{/if}
		</div>
	{/if}
</div>

{#if showDeleteModal}
	<Modal
		open={showDeleteModal}
		onOpenChange={(e) => (showDeleteModal = e.open)}
		contentBase="card bg-surface-100-900 p-4 space-y-4 shadow-xl max-w-dvw-sm border border-surface-300-700"
		backdropClasses="backdrop-blur-sm"
		role="alertdialog"
		aria-labelledby="delete-modal-title"
		aria-describedby="delete-modal-description"
	>
		{#snippet content()}
			<div class="p-6">
				<h2 id="delete-modal-title" class="mb-2 text-lg font-bold">
					Delete Character?
				</h2>
				<p id="delete-modal-description" class="mb-4">
					Are you sure you want to delete this character? This action
					cannot be undone.
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
		{/snippet}
	</Modal>
{/if}

{#if showImportModal}
	<Modal
		open={showImportModal}
		onOpenChange={(e) => (showImportModal = e.open)}
		contentBase="card bg-surface-100-900 p-4 space-y-4 shadow-xl max-w-dvw-sm w-[35rem]"
		backdropClasses="backdrop-blur-sm"
	>
		{#snippet content()}
			<div class="p-6">
				<h2 class="mb-2 text-lg font-bold">Import Character</h2>
				<p class="mb-4">Choose how to import:</p>
				<div class="space-y-2">
					<button
						class="btn preset-filled-surface-400-600 w-full justify-start"
						onclick={() => {
							showImportModal = false
							showLibraryModal = true
						}}
					>
						<Icons.Library class="w-4 h-4" />
						Search Library
					</button>
					<div class="divider">OR</div>
					<div>
						<p class="text-sm text-surface-600 dark:text-surface-400 mb-2">
							Upload a file (PNG, APNG, JPEG, JPG, WEBP, JSON):
						</p>
						<FileUpload
							name="example"
							accept=".png,.apng,.jpeg, .jpg, .webp, .json"
							maxFiles={1}
							onFileAccept={handleFileImport}
							onFileReject={console.error}
							classes="w-full bg-surface-50-950"
						/>
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
		{/snippet}
	</Modal>
{/if}

<CharacterLibraryModal bind:open={showLibraryModal} />

{#if showLorebookImportConfirmationModal}
	<Modal
		open={showLorebookImportConfirmationModal}
		onOpenChange={(e) => {
			showLorebookImportConfirmationModal = e.open
			importingLorebook = null
			importingLorebookCharacter = null
		}}
		contentBase="card bg-surface-100-900 p-4 space-y-4 shadow-xl max-w-dvw-sm border border-surface-300-700"
		backdropClasses="backdrop-blur-sm"
	>
		{#snippet content()}
			<div class="p-6">
				<h2 class="mb-2 text-lg font-bold">Import Lorebook?</h2>
				<p class="mb-4">
					A lorebook is associated with this character card. Would you
					like to import it?
				</p>
				<label class="mb-2 block font-semibold" for="lorebookName">
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
		{/snippet}
	</Modal>
{/if}

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
