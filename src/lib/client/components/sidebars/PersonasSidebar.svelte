<script lang="ts">
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { getContext, onMount, onDestroy } from "svelte"
	import { Modal, FileUpload } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import PersonaForm from "../personaForms/PersonaForm.svelte"
	import PersonaCreator from "../modals/PersonaCreatorModal.svelte"
	import PersonaUnsavedChangesModal from "../modals/PersonaUnsavedChangesModal.svelte"
	import PersonaLibraryModal from "../modals/PersonaLibraryModal.svelte"
	import PersonaListItem from "../listItems/PersonaListItem.svelte"
	import PersonaViewPanel from "../personaForms/PersonaViewPanel.svelte"
	import { toaster } from "$lib/client/utils/toaster"

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

	let personaList: Sockets.Personas.List.Response["personaList"] = $state([])
	let search = $state("")
	let personaId: number | undefined = $state()
	let viewingId: number | undefined = $state()
	let returnToViewId: number | undefined = $state()
	let isCreating = $state(false)
	let showPersonaCreator = $state(false)
	let showLibraryModal = $state(false)
	let showImportModal = $state(false)
	let personaFormHasChanges = $state(false)
	let showDeleteModal = $state(false)
	let personaToDelete: number | undefined = $state(undefined)
	let showUnsavedChangesModal = $state(false)
	let confirmCloseSidebarResolve: ((v: boolean) => void) | null = null
	let onEditFormCancel: (() => void) | undefined = $state()

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
				socket.emit("personas:importCard", { file: base64 })
				showImportModal = false
			}
		}
		reader.readAsDataURL(file)
		showImportModal = false
	}

	onMount(() => {
		socket.on("personas:list", (msg: Sockets.Personas.List.Response) => {
			personaList = msg.personaList
		})
		socket.on("personas:importCard", (msg) => {
			toaster.success({
				title: `Persona Imported`,
				description: `Persona ${msg.persona.name} imported successfully.`
			})
		})
		socket.emit("personas:list", {})
		onclose = handleOnClose
	})

	onDestroy(() => {
		socket.off("personas:list")
		socket.off("personas:importCard")
		onclose = undefined
	})

	let filteredPersonas = $derived.by(() => {
		if (!search) return personaList

		const searchLower = search.toLowerCase()
		return personaList.filter((p) => {
			// Search by name
			if (p.name!.toLowerCase().includes(searchLower)) return true

			// Search by description
			if (
				p.description &&
				p.description.toLowerCase().includes(searchLower)
			)
				return true

			// Search by tags
			if (p.personaTags) {
				const tagMatch = p.personaTags.some(
					(pt: any) =>
						pt.tag &&
						pt.tag.name.toLowerCase().includes(searchLower)
				)
				if (tagMatch) return true
			}

			return false
		})
	})

	$effect(() => {
		if (panelsCtx.digest.personaId) {
			// Check if we have unsaved changes
			if (
				personaId !== panelsCtx.digest.characterId &&
				personaFormHasChanges
			) {
				onEditFormCancel?.()
			} else {
				// If no unsaved changes, just set the characterId
				personaId = panelsCtx.digest.personaId
			}
			delete panelsCtx.digest.personaId
		}
	})

	function handleCreateClick() {
		// Clear tutorial flag when user interacts with the highlighted button
		if (panelsCtx.digest.tutorial) {
			panelsCtx.digest.tutorial = false
		}

		// Check if easy persona creation is enabled
		if (userSettingsCtx.settings?.enableEasyPersonaCreation) {
			showPersonaCreator = true
		} else {
			// Use regular edit form for creation
			isCreating = true
			personaId = undefined
		}
	}

	function handleViewClick(id: number) {
		viewingId = id
	}

	function handleEditClick(id: number) {
		personaId = id
		viewingId = undefined
	}

	function handleEditFromView() {
		returnToViewId = viewingId
		personaId = viewingId
		viewingId = undefined
	}

	function closePersonasForm() {
		isCreating = false
		personaId = undefined
		personaFormHasChanges = false
		const returnId = returnToViewId
		returnToViewId = undefined
		if (returnId) viewingId = returnId
	}

	function handleChatFromView() {
		if (!viewingId) return
		panelsCtx.digest.chatPersonaId = viewingId
		panelsCtx.openPanel({ key: "chats", toggle: false })
	}

	function handleDeleteClick(id: number) {
		personaToDelete = id
		showDeleteModal = true
	}

	function confirmDelete() {
		if (personaToDelete !== undefined) {
			socket.emit("personas:delete", { id: personaToDelete })
		}
		showDeleteModal = false
		personaToDelete = undefined
		if (personaId === personaToDelete) closePersonasForm()
	}

	function cancelDelete() {
		showDeleteModal = false
		personaToDelete = undefined
	}

	async function handleOnClose() {
		if (personaFormHasChanges) {
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

	function handleUnsavedChangesOnOpenChange(e: { open: boolean }) {
		if (!e.open) {
			showUnsavedChangesModal = false
			if (confirmCloseSidebarResolve) confirmCloseSidebarResolve(false)
		}
	}

	function handlePersonaClick(
		persona: Sockets.PersonaList.Response["personaList"][0]
	) {
		handleViewClick(persona.id!)
	}
</script>

<div class="text-foreground h-full p-4">
	{#if isCreating}
		<PersonaForm
			bind:isSafeToClose={personaFormHasChanges}
			closeForm={closePersonasForm}
			bind:onCancel={onEditFormCancel}
		/>
	{:else if personaId}
		<PersonaForm
			bind:isSafeToClose={personaFormHasChanges}
			{personaId}
			closeForm={closePersonasForm}
			bind:onCancel={onEditFormCancel}
		/>
	{:else if viewingId}
		{#key viewingId}
			<PersonaViewPanel
				personaId={viewingId}
				onBack={() => (viewingId = undefined)}
				onEdit={handleEditFromView}
				onChat={handleChatFromView}
			/>
		{/key}
	{:else}
		<div class="mb-2 flex gap-2">
			<button
				class="btn btn-sm preset-filled-primary-500 {panelsCtx.digest
					.tutorial
					? 'ring-primary-500/50 animate-pulse ring-4'
					: ''}"
				onclick={handleCreateClick}
				title="Create New Persona"
				aria-label="Create new persona"
				type="button"
			>
				<Icons.Plus size={16} aria-hidden="true" />
				New
			</button>
			<button
				class="btn btn-sm preset-filled-primary-500"
				title="Import Persona"
				onclick={handleImportClick}
				aria-label="Import persona from file"
				type="button"
			>
				<Icons.Download size={16} aria-hidden="true" />
				Import
			</button>
		</div>
		<div class="mb-4 flex items-center gap-2">
			<input
				type="text"
				placeholder="Search personas, descriptions, tags..."
				class="input"
				bind:value={search}
			/>
		</div>
		<div class="flex flex-col gap-2">
			{#if filteredPersonas.length === 0}
				<div class="text-muted-foreground py-8 text-center">
					No personas found.
				</div>
			{:else}
				{#each filteredPersonas as p}
					<PersonaListItem
						persona={p}
						onclick={handlePersonaClick}
						onEdit={handleEditClick}
						onDelete={handleDeleteClick}
						contentTitle="Go to persona chats"
					/>
				{/each}
			{/if}
		</div>
	{/if}
</div>

<Modal
	open={showDeleteModal}
	onOpenChange={(e) => (showDeleteModal = e.open)}
	contentBase="card bg-surface-100-900 p-4 space-y-4 shadow-xl max-w-dvw-sm border border-surface-300-700"
	backdropClasses="backdrop-blur-sm"
>
	{#snippet content()}
		<div class="p-6">
			<h2 class="mb-2 text-lg font-bold">Delete Persona?</h2>
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
<PersonaUnsavedChangesModal
	open={showUnsavedChangesModal}
	onOpenChange={handleUnsavedChangesOnOpenChange}
	onConfirm={handleCloseModalDiscard}
	onCancel={handleCloseModalCancel}
/>

<PersonaCreator bind:open={showPersonaCreator} />

{#if showImportModal}
	<Modal
		open={showImportModal}
		onOpenChange={(e) => (showImportModal = e.open)}
		contentBase="card bg-surface-100-900 p-4 space-y-4 shadow-xl max-w-dvw-sm w-[35rem]"
		backdropClasses="backdrop-blur-sm"
	>
		{#snippet content()}
			<div class="p-6">
				<h2 class="mb-2 text-lg font-bold">Import Persona</h2>
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

<PersonaLibraryModal bind:open={showLibraryModal} />
