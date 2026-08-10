<script lang="ts">
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { getContext, onMount, onDestroy } from "svelte"
	import { flip } from "svelte/animate"
	import { fade } from "svelte/transition"
	import { Dialog, Portal, FileUpload } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import { goto } from "$app/navigation"
	import PersonaForm from "../personaForms/PersonaForm.svelte"
	import PersonaCreator from "../modals/PersonaCreatorModal.svelte"
	import PersonaUnsavedChangesModal from "../modals/PersonaUnsavedChangesModal.svelte"
	import PersonaListItem from "../listItems/PersonaListItem.svelte"
	import PersonaCardItem from "../listItems/PersonaCardItem.svelte"
	import PersonaViewPanel from "../personaForms/PersonaViewPanel.svelte"
	import EmptyState from "../EmptyState.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { createViewMode } from "$lib/client/utils/viewMode.svelte"
	import ImportConflictModal from "../modals/ImportConflictModal.svelte"
	import PersonaExportModal from "../modals/PersonaExportModal.svelte"
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

	let personaList: Sockets.Personas.List.Response["personaList"] = $state([])
	let isLoading = $state(true)
	const viewMode = createViewMode("serene-pub:viewMode:personasSidebar")
	let search = $state("")
	let personaId: number | undefined = $state()
	let viewingId: number | undefined = $state()
	let returnToViewId: number | undefined = $state()
	// Set when personas:importCard comes back with status "conflict" — the
	// card's uuid matched a persona this user already has, but its content
	// differs.
	let personaImportConflict:
		| { existingPersona: SelectPersona; file: string }
		| undefined = $state(undefined)
	let showPersonaImportConflictModal = $state(false)
	let exportingPersona: {
		id: number
		name: string
		avatar?: string | null
	} | null = $state(null)
	let showExportModal = $state(false)
	let isCreating = $state(false)
	let showPersonaCreator = $state(false)
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

	function handleOverwritePersonaImportConflict() {
		if (!personaImportConflict) return
		socket.emit("personas:importResolve", {
			action: "overwrite",
			file: personaImportConflict.file,
			existingId: personaImportConflict.existingPersona.id
		})
		showPersonaImportConflictModal = false
		personaImportConflict = undefined
	}

	function handleImportPersonaAsNewFromConflict() {
		if (!personaImportConflict) return
		socket.emit("personas:importResolve", {
			action: "createNew",
			file: personaImportConflict.file,
			existingId: personaImportConflict.existingPersona.id
		})
		showPersonaImportConflictModal = false
		personaImportConflict = undefined
	}

	function handleCancelPersonaImportConflict() {
		showPersonaImportConflictModal = false
		personaImportConflict = undefined
	}

	function handleExportPersona(persona: {
		id?: number
		name?: string
		avatar?: string | null
	}) {
		if (!persona.id || !persona.name) return
		exportingPersona = {
			id: persona.id,
			name: persona.name,
			avatar: persona.avatar
		}
		showExportModal = true
	}

	function handleConfirmPersonaExport(options: { format: "json" | "png" }) {
		if (!exportingPersona?.id) return
		socket.emit("personas:exportCard", {
			id: exportingPersona.id,
			format: options.format
		})
		showExportModal = false
		exportingPersona = null
	}

	function handleCancelPersonaExport() {
		showExportModal = false
		exportingPersona = null
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
		goto("/library/personas")
		panelsCtx.fullscreenPanel = null
	}

	async function handleFileImport(details: FileAcceptDetails) {
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
			isLoading = false
		})
		// The generic **:error listener in Layout.svelte already toasts this —
		// this just stops the spinner from spinning forever if the initial
		// fetch fails, so it settles into the (accurate enough) empty state.
		socket.on("personas:list:error", () => {
			isLoading = false
		})
		socket.on(
			"personas:importCard",
			(msg: Sockets.Personas.ImportCard.Response) => {
				if (msg.status === "conflict" && msg.conflict) {
					personaImportConflict = msg.conflict
					showPersonaImportConflictModal = true
					return
				}
				if (msg.status === "unchanged") {
					toaster.success({
						title: "Persona Already Imported",
						description: `"${msg.persona?.name}" is unchanged — using the existing persona.`
					})
					return
				}
				toaster.success({
					title: `Persona Imported`,
					description: `Persona ${msg.persona!.name} imported successfully.`
				})
			}
		)
		socket.on(
			"personas:importResolve",
			(msg: Sockets.Personas.ImportResolve.Response) => {
				toaster.success({
					title: `Persona Imported`,
					description: `Persona ${msg.persona.name} imported successfully.`
				})
			}
		)
		socket.on(
			"personas:importResolve:error",
			(msg: Sockets.ErrorResponse) => {
				toaster.error({
					title: msg.error || "Failed to resolve persona import"
				})
			}
		)
		socket.on("personas:exportCard", (msg) => {
			downloadBlob(msg)
			toaster.success({
				title: "Persona Exported",
				description: `Persona card exported as ${msg.filename}`
			})
		})
		socket.on("personas:exportCard:error", (msg: Sockets.ErrorResponse) => {
			toaster.error({ title: msg.error || "Failed to export persona" })
		})
		// The background vectorization queue updates a row's embeddingModel
		// directly in the DB — without this, the list here only ever refreshes
		// on the next explicit personas:list, leaving the embedding-status
		// badge showing stale info until a manual refresh.
		socket.on(
			"vectorization:itemUpdated",
			(msg: Sockets.Vectorization.ItemUpdated.Response) => {
				if (msg.type !== "persona") return
				const target = personaList.find((p: any) => p.id === msg.id)
				if (target) (target as any).embeddingModel = msg.embeddingModel
			}
		)
		socket.emit("personas:list", {})
		onclose = handleOnClose
	})

	onDestroy(() => {
		socket.off("personas:list")
		socket.off("personas:list:error")
		socket.off("personas:importCard")
		socket.off("personas:importResolve")
		socket.off("personas:importResolve:error")
		socket.off("personas:exportCard")
		socket.off("personas:exportCard:error")
		socket.off("vectorization:itemUpdated")
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
			const targetId = panelsCtx.digest.personaId
			delete panelsCtx.digest.personaId
			if (personaId !== targetId && personaFormHasChanges) {
				// Promise-based, unlike onEditFormCancel (PersonaForm's own
				// discard flow) — lets the switch actually complete once
				// discard is confirmed instead of silently landing back on
				// the list, since panelsCtx.digest.personaId is already
				// gone by the time an async confirm resolves.
				handleOnClose().then((confirmed) => {
					if (confirmed) personaId = targetId
				})
			} else {
				personaId = targetId
			}
		}
	})

	// Same as above, but opens the read-only detail view instead of the edit
	// form — used when arriving from a context that just wants to look up a
	// persona (eg. clicking a name in a chat), not edit it.
	$effect(() => {
		if (panelsCtx.digest.viewPersonaId) {
			viewingId = panelsCtx.digest.viewPersonaId
			delete panelsCtx.digest.viewPersonaId
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

	function handleSetDefaultClick(id: number) {
		socket.emit("personas:setDefault", { personaId: id })
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
		persona: Sockets.Personas.List.Response["personaList"][0]
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
		{#key personaId}
			<PersonaForm
				bind:isSafeToClose={personaFormHasChanges}
				{personaId}
				closeForm={closePersonasForm}
				bind:onCancel={onEditFormCancel}
			/>
		{/key}
	{:else if viewingId}
		{#key viewingId}
			<PersonaViewPanel
				personaId={viewingId}
				onBack={() => (viewingId = undefined)}
				onEdit={handleEditFromView}
				onChat={handleChatFromView}
				onExport={handleExportPersona}
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
				class="btn btn-sm preset-tonal-primary"
				title="Import Persona"
				onclick={handleImportClick}
				aria-label="Import persona from file"
				type="button"
			>
				<Icons.Upload size={16} aria-hidden="true" />
				Import
			</button>
			<button
				class="btn btn-sm preset-tonal-primary"
				title="Browse Persona Library"
				onclick={handleBrowseClick}
				aria-label="Browse the persona library"
				type="button"
			>
				<Icons.Library size={16} aria-hidden="true" />
				Browse
			</button>
		</div>
		<div class="mb-4 flex items-center gap-2">
			<input
				type="text"
				placeholder="Search"
				aria-label="Search personas"
				class="input"
				bind:value={search}
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
		{:else if filteredPersonas.length === 0}
			<EmptyState
				icon={Icons.User}
				message={search
					? `No personas found matching "${search}".`
					: "No personas yet — create one to get started."}
				ctaLabel={search ? undefined : "New Persona"}
				onCta={search ? undefined : () => (isCreating = true)}
			/>
		{:else if viewMode.value === "list"}
			<div
				class="flex flex-col gap-2"
				role="list"
				aria-label="Personas list"
			>
				{#each filteredPersonas as p (p.id)}
					<div
						animate:flip={{ duration: 200 }}
						out:fade={{ duration: 150 }}
					>
						<PersonaListItem
							persona={p}
							onclick={handlePersonaClick}
							onEdit={handleEditClick}
							onDelete={handleDeleteClick}
							onExport={handleExportPersona}
							onSetDefault={handleSetDefaultClick}
							contentTitle="Go to persona chats"
						/>
					</div>
				{/each}
			</div>
		{:else}
			<!-- See CharactersSidebar.svelte's matching grid for why this uses
				auto-fill/minmax instead of a fixed min-width, viewport
				breakpoints, or a fixed set of named @container breakpoints —
				the sidebar's own pixel width doesn't track viewport width
				proportionally, and a capped column count leaves oversized
				cards on very wide (eg. 4K fullscreen) containers. -->
			<div>
				<div
					class="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3"
					role="list"
					aria-label="Personas list"
				>
					{#each filteredPersonas as p (p.id)}
						<div
							animate:flip={{ duration: 200 }}
							out:fade={{ duration: 150 }}
						>
							<PersonaCardItem
								persona={p}
								onclick={handlePersonaClick}
								onEdit={handleEditClick}
								onDelete={handleDeleteClick}
								onExport={handleExportPersona}
								onSetDefault={handleSetDefaultClick}
								contentTitle="Go to persona chats"
							/>
						</div>
					{/each}
				</div>
			</div>
		{/if}
	{/if}
</div>

<Dialog open={showDeleteModal} onOpenChange={(e) => (showDeleteModal = e.open)}>
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
					<h2 class="mb-2 text-lg font-bold">Delete Persona?</h2>
					<p class="mb-4">
						Are you sure you want to delete this persona? This
						action cannot be undone.
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
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
<PersonaUnsavedChangesModal
	open={showUnsavedChangesModal}
	onOpenChange={handleUnsavedChangesOnOpenChange}
	onConfirm={handleCloseModalDiscard}
	onCancel={handleCloseModalCancel}
/>

<PersonaCreator bind:open={showPersonaCreator} />

{#if personaImportConflict}
	<ImportConflictModal
		open={showPersonaImportConflictModal}
		onOpenChange={(e) => {
			showPersonaImportConflictModal = e.open
			if (!e.open) personaImportConflict = undefined
		}}
		entityLabel="Persona"
		existingName={personaImportConflict.existingPersona.name}
		onOverwrite={handleOverwritePersonaImportConflict}
		onImportAsNew={handleImportPersonaAsNewFromConflict}
		onCancel={handleCancelPersonaImportConflict}
	/>
{/if}

<PersonaExportModal
	open={showExportModal}
	onOpenChange={(e) => {
		showExportModal = e.open
		if (!e.open) exportingPersona = null
	}}
	persona={exportingPersona}
	onConfirm={handleConfirmPersonaExport}
	onCancel={handleCancelPersonaExport}
/>

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
						<h2 class="mb-2 text-lg font-bold">Import Persona</h2>
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
