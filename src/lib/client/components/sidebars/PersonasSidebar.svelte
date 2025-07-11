<script lang="ts">
	import * as skio from "sveltekit-io"
	import { getContext, onMount } from "svelte"
	import { Modal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import PersonaForm from "../personaForms/PersonaForm.svelte"
	import PersonaUnsavedChangesModal from "../modals/PersonaUnsavedChangesModal.svelte"
	import Avatar from "../Avatar.svelte"
	import SidebarListItem from "../SidebarListItem.svelte"

	interface Props {
		onclose?: () => Promise<boolean> | undefined
	}

	let { onclose = $bindable() }: Props = $props()

	const socket = skio.get()
	const panelsCtx: PanelsCtx = $state(getContext("panelsCtx"))

	let personaList: Sockets.PersonaList.Response["personaList"] = $state([])
	let search = $state("")
	let personaId: number | undefined = $state()
	let isCreating = $state(false)
	let isSafeToClosePersonasForm = $state(true)
	let showDeleteModal = $state(false)
	let personaToDelete: number | undefined = $state(undefined)
	let showUnsavedChangesModal = $state(false)
	let confirmCloseSidebarResolve: ((v: boolean) => void) | null = null
	let onEditFormCancel: (() => void) | undefined = $state()

	onMount(() => {
		socket.emit("personaList", {})
		onclose = handleOnClose
	})

	socket.on("personaList", (msg: Sockets.PersonaList.Response) => {
		personaList = msg.personaList
	})

	let filteredPersonas = $derived.by(() => {
		if (!search) return personaList
		return personaList.filter(
			(p) =>
				p.name!.toLowerCase().includes(search.toLowerCase()) ||
				(p.description &&
					p.description.toLowerCase().includes(search.toLowerCase()))
		)
	})

	$effect(() => {
		if (panelsCtx.digest.personaId) {
			// Check if we have unsaved changes
			if (personaId !== panelsCtx.digest.characterId && !isSafeToClosePersonasForm) {
				onEditFormCancel?.()
			} else { // If no unsaved changes, just set the characterId
				personaId = panelsCtx.digest.personaId
			}
			delete panelsCtx.digest.personaId
		}
	})

	function handleCreateClick() {
		isCreating = true
	}

	function handleEditClick(id: number) {
		personaId = id
	}

	function closePersonasForm() {
		isCreating = false
		personaId = undefined
	}

	function handleDeleteClick(id: number) {
		personaToDelete = id
		showDeleteModal = true
	}

	function confirmDelete() {
		if (personaToDelete !== undefined) {
			socket.emit("deletePersona", { id: personaToDelete })
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
		if (!isSafeToClosePersonasForm) {
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
		panelsCtx.digest.chatPersonaId = persona.id
		panelsCtx.openPanel({key:"chats", toggle: false})
	}

</script>

<div class="text-foreground h-full p-4">
	{#if isCreating}
		<PersonaForm
			bind:isSafeToClose={isSafeToClosePersonasForm}
			closeForm={closePersonasForm}
			bind:onCancel={onEditFormCancel}
		/>
	{:else if personaId}
		<PersonaForm
			bind:isSafeToClose={isSafeToClosePersonasForm}
			{personaId}
			closeForm={closePersonasForm}
			bind:onCancel={onEditFormCancel}
		/>
	{:else}
		<div class="mb-2 flex gap-2">
			<button
				class="btn btn-sm preset-filled-primary-500"
				onclick={handleCreateClick}
				title="Create New Persona"
			>
				<Icons.Plus size={16} />
			</button>
		</div>
		<div class="mb-4 flex items-center gap-2">
			<input
				type="text"
				placeholder="Search personas..."
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
					<SidebarListItem
						id={p.id}
						onclick={() => handlePersonaClick(p)}
						contentTitle="Go to persona chats"
					>
						{#snippet content()}
						<Avatar
									src={p.avatar || ""}
									size="w-[4em] h-[4em] min-w-[4em] min-h-[4em]"
									imageClasses="object-cover"
									name={p.name!}
								>
									<Icons.User size={36} />
								</Avatar>
							<div class="flex gap-2 relative  flex-1">
								
								<div class="flex-1 relative">
									<div class="truncate font-semibold text-left">
										{p.name}
									</div>
									{#if p.description}
										<div
											class="text-muted-foreground line-clamp-2 text-xs text-left"
										>
											{p.description}
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
										handleEditClick(p.id!)
									}}
									title="Edit Character"
								>
									<Icons.Edit size={16} />
								</button>
								<button
									class="btn btn-sm text-error-500 p-2"
									onclick={(e) => {
										e.stopPropagation()
										handleDeleteClick(p.id!)
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