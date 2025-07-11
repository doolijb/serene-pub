<script lang="ts">
	import * as skio from "sveltekit-io"
	import { getContext, onDestroy, onMount } from "svelte"
	import { Avatar, FileUpload, Modal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import CharacterForm from "../characterForms/CharacterForm.svelte"
	import CharacterUnsavedChangesModal from "../modals/CharacterUnsavedChangesModal.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import type { SpecV3 } from "@lenml/char-card-reader"
	import SidebarListItem from "../SidebarListItem.svelte"

	interface Props {
		onclose?: () => Promise<boolean> | undefined
	}

	let { onclose = $bindable() }: Props = $props()

	const socket = skio.get()
	const panelsCtx: PanelsCtx = $state(getContext("panelsCtx"))

	let characterList: Sockets.CharacterList.Response["characterList"] = $state(
		[]
	)
	let search = $state("")
	let characterId: number | undefined = $state()
	let isCreating = $state(false)
	let isSafeToCloseCharacterForm = $state(true)
	let showDeleteModal = $state(false)
	let characterToDelete: number | undefined = $state(undefined)
	let showUnsavedChangesModal = $state(false)
	let confirmCloseSidebarResolve: ((v: boolean) => void) | null = null
	let showImportModal = $state(false)
	let onEditFormCancel: (() => void) | undefined = $state()
	let importingLorebook: SpecV3.Lorebook | null = $state(null)
	let importingLorebookCharacter: SelectCharacter | null = $state(null)
	let showLorebookImportConfirmationModal = $state(false)

	let unsavedChanges = $derived.by(() => {
		return !isCreating && !characterId ? false : !isSafeToCloseCharacterForm
	})

	$effect(() => {
		if (panelsCtx.digest.characterId) {
			// Check if we have unsaved changes
			if (
				characterId !== panelsCtx.digest.characterId &&
				unsavedChanges
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
	let filteredCharacters: Sockets.CharacterList.Response["characterList"] =
		$derived.by(() => {
			let list = [...characterList]
			// Sort favorites first
			list.sort((a, b) => {
				if (a.isFavorite && !b.isFavorite) return -1
				if (!a.isFavorite && b.isFavorite) return 1
				return 0
			})
			if (!search) return list
			return list.filter(
				(c: Sockets.CharacterList.Response["characterList"][0]) =>
					c.name!.toLowerCase().includes(search.toLowerCase()) ||
					(c.description &&
						c.description
							.toLowerCase()
							.includes(search.toLowerCase()))
			)
		})

	function handleCreateClick() {
		isCreating = true
	}

	function handleEditClick(id: number) {
		characterId = id
	}

	function closeCharacterForm() {
		isCreating = false
		characterId = undefined
	}

	function handleDeleteClick(id: number) {
		characterToDelete = id
		showDeleteModal = true
	}

	function confirmDelete() {
		if (characterToDelete !== undefined) {
			socket.emit("deleteCharacter", { characterId: characterToDelete })
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
		if (unsavedChanges) {
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
				socket.emit("characterCardImport", { file: base64 })
				showImportModal = false
			}
		}
		reader.readAsDataURL(file)
		showImportModal = false
		// const req: Sockets.CharacterCardImport.Call = {
		// 	file
		// }
	}

	function handleCharacterClick(
		character: Sockets.CharacterList.Response["characterList"][0]
	) {
		panelsCtx.digest.chatCharacterId = character.id
		panelsCtx.openPanel({ key: "chats", toggle: false })
	}

	function confirmLorebookImport() {
		const req: Sockets.LorebookImport.Call = {
			lorebookData: importingLorebook!,
			characterId: importingLorebookCharacter?.id
		}
		socket.emit("lorebookImport", req)
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
		socket.on("characterList", (msg: Sockets.CharacterList.Response) => {
			characterList = msg.characterList
		})
		socket.on(
			"characterCardImport",
			(msg: Sockets.CharacterCardImport.Response) => {
				importingLorebook = msg.book || null
				toaster.success({
					title: `Character Imported`,
					description: `Character ${msg.character.nickname || msg.character.name} imported successfully.`
				})
				if (!!importingLorebook) {
					importingLorebookCharacter =
						importingLorebook.character || null
					showLorebookImportConfirmationModal = true
				}
			}
		)
		socket.on("lorebookImport", (msg: Sockets.LorebookImport.Response) => {
			toaster.success({
				title: `Lorebook Imported`,
				description: `Lorebook imported successfully.`
			})
		})
		socket.emit("characterList", {})
		onclose = handleOnClose
	})

	onDestroy(() => {
		socket.off("characterList")
		socket.off("characterCardImport")
		onclose = undefined
	})
</script>

<div class="text-foreground h-full p-4">
	{#if isCreating}
		<CharacterForm
			bind:isSafeToClose={isSafeToCloseCharacterForm}
			closeForm={closeCharacterForm}
		/>
	{:else if characterId}
		{#key characterId}
			<CharacterForm
				bind:isSafeToClose={isSafeToCloseCharacterForm}
				{characterId}
				closeForm={closeCharacterForm}
				bind:onCancel={onEditFormCancel}
			/>
		{/key}
	{:else}
		<div class="mb-2 flex gap-2">
			<button
				class="btn btn-sm preset-filled-primary-500"
				onclick={handleCreateClick}
				title="Create New Character"
			>
				<Icons.Plus size={16} />
			</button>
			<button
				class="btn btn-sm preset-filled-primary-500"
				title="Import Character"
				onclick={handleImportClick}
			>
				<Icons.Upload size={16} />
			</button>
			<button
				class="btn btn-sm preset-filled-primary-500"
				title="Export Character"
				disabled
			>
				<Icons.Download size={16} />
			</button>
		</div>
		<div class="mb-4 flex items-center gap-2">
			<input
				type="text"
				placeholder="Search characters..."
				class="input"
				bind:value={search}
			/>
		</div>
		<div class="flex flex-col gap-2">
			{#if filteredCharacters.length === 0}
				<div class="text-muted-foreground py-8 text-center w-100 relative">
					No characters found.
				</div>
			{:else}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				{#each filteredCharacters as c}
					<SidebarListItem
						id={c.id}
						onclick={() => handleCharacterClick(c)}
						contentTitle="Go to character chats"
						classes={c.isFavorite ? "border border-primary-500" : ""}
					>
						{#snippet content()}
						<Avatar
									src={c.avatar || ""}
									size="w-[4em] h-[4em] min-w-[4em] min-h-[4em]"
									imageClasses="object-cover"
									name={c.nickname || c.name!}
								>
									<Icons.User size={36} />
								</Avatar>
							<div class="flex gap-2 relative flex-1 min-w-0">
								
								<div class="flex-1 relative min-w-0">
									<div class="truncate font-semibold text-left">
										{c.nickname || c.name}
									</div>
									{#if c.description}
										<div
											class="text-muted-foreground line-clamp-2 text-xs text-left"
										>
											{c.description}
										</div>
									{/if}
								</div>
							</div>
						{/snippet}
						{#snippet controls()}
							<div class="flex flex-col gap-4">
								<button
									class="btn btn-sm text-primary-500 p-2"
									onclick={(e) => {
										e.stopPropagation()
										handleEditClick(c.id!)
									}}
									title="Edit Character"
								>
									<Icons.Edit size={16} />
								</button>
								<button
									class="btn btn-sm text-error-500 p-2"
									onclick={(e) => {
										e.stopPropagation()
										handleDeleteClick(c.id!)
									}}
									title="Delete Character"
								>
									<Icons.Trash2 size={16} />
								</button>
							</div>
						{/snippet}
					</SidebarListItem>
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
	>
		{#snippet content()}
			<div class="p-6">
				<h2 class="mb-2 text-lg font-bold">Delete Character?</h2>
				<p class="mb-4">
					Are you sure you want to delete this character? This action
					cannot be undone.
				</p>
				<div class="flex justify-end gap-2">
					<button
						class="btn preset-filled-surface-500"
						onclick={cancelDelete}
					>
						Cancel
					</button>
					<button
						class="btn preset-filled-error-500"
						onclick={confirmDelete}
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
				<p class="mb-4">
					PNG, APNG, JPEG, JPG, WEBP, and JSON files are supported.
				</p>
				<FileUpload
					name="example"
					accept=".png,.apng,.jpeg, .jpg, .webp, .json"
					maxFiles={1}
					onFileAccept={handleFileImport}
					onFileReject={console.error}
					classes="w-full bg-surface-50-950"
				/>
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
