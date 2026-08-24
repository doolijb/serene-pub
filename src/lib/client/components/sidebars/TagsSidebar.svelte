<script lang="ts">
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { getContext, onDestroy, onMount } from "svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { z } from "zod"
	import CharacterListItem from "../listItems/CharacterListItem.svelte"
	import PersonaListItem from "../listItems/PersonaListItem.svelte"
	import SessionListItem from "../listItems/SessionListItem.svelte"
	import LorebookListItem from "../listItems/LorebookListItem.svelte"
	import EmptyState from "../EmptyState.svelte"
	import PanelNavHeader from "../panels/PanelNavHeader.svelte"
	import { goto } from "$app/navigation"

	interface Props {
		onclose?: () => Promise<boolean> | undefined
	}

	let { onclose = $bindable() }: Props = $props()

	const socket = useTypedSocket()
	const panelsCtx: PanelsCtx = $state(getContext("panelsCtx"))

	let tagsList: SelectTag[] = $state([])
	let isLoading = $state(true)
	let selectedTag: SelectTag | null = $state(null)
	let search = $state("")
	let isCreating = $state(false)
	let isEditing = $state(false)
	let newTagName = $state("")
	let newTagDescription = $state("")
	let newTagColorPreset = $state("preset-filled-primary-500")
	let editTagName = $state("")
	let editTagDescription = $state("")
	let editTagColorPreset = $state("preset-filled-primary-500")
	let showDeleteModal = $state(false)
	let tagToDelete: SelectTag | null = $state(null)

	// Related data for selected tag — these come back from "tags:getRelatedData"
	// with only a display-column subset (see registerTagHandlers), so they're
	// Partial, matching what the *ListItem components expect.
	let relatedCharacters: Partial<SelectCharacter>[] = $state([])
	let relatedPersonas: Partial<SelectPersona>[] = $state([])
	let relatedLorebooks: SelectLorebook[] = $state([])
	// tags:getRelatedData never actually populates sessions server-side today
	// (see registerTagHandlers), so this stays empty at runtime — typed to
	// match SessionListItem's expected shape regardless.
	let relatedSessions: Sockets.Sessions.List.Response["sessionList"] = $state(
		[]
	)

	// Zod validation schema
	const tagSchema = z.object({
		name: z.string().min(1, "Tag name is required").trim()
	})

	type ValidationErrors = Record<string, string>
	let validationErrors: ValidationErrors = $state({})
	let editValidationErrors: ValidationErrors = $state({})

	// Filtered tags for display
	let filteredTags: SelectTag[] = $derived.by(() => {
		if (!search) return tagsList
		return tagsList.filter(
			(tag) =>
				tag.name.toLowerCase().includes(search.toLowerCase()) ||
				(tag.description &&
					tag.description
						.toLowerCase()
						.includes(search.toLowerCase()))
		)
	})

	// Color preset options
	const colorPresetOptions = [
		{
			value: "preset-filled-primary-500",
			label: "Primary Filled",
			type: "filled",
			color: "primary"
		},
		{
			value: "preset-tonal-primary",
			label: "Primary Tonal",
			type: "tonal",
			color: "primary"
		},
		{
			value: "preset-outlined-primary-500",
			label: "Primary Outlined",
			type: "outlined",
			color: "primary"
		},
		{
			value: "preset-filled-secondary-500",
			label: "Secondary Filled",
			type: "filled",
			color: "secondary"
		},
		{
			value: "preset-tonal-secondary",
			label: "Secondary Tonal",
			type: "tonal",
			color: "secondary"
		},
		{
			value: "preset-outlined-secondary-500",
			label: "Secondary Outlined",
			type: "outlined",
			color: "secondary"
		},
		{
			value: "preset-filled-tertiary-500",
			label: "Tertiary Filled",
			type: "filled",
			color: "tertiary"
		},
		{
			value: "preset-tonal-tertiary",
			label: "Tertiary Tonal",
			type: "tonal",
			color: "tertiary"
		},
		{
			value: "preset-outlined-tertiary-500",
			label: "Tertiary Outlined",
			type: "outlined",
			color: "tertiary"
		},
		{
			value: "preset-filled-success-500",
			label: "Success Filled",
			type: "filled",
			color: "success"
		},
		{
			value: "preset-tonal-success",
			label: "Success Tonal",
			type: "tonal",
			color: "success"
		},
		{
			value: "preset-outlined-success-500",
			label: "Success Outlined",
			type: "outlined",
			color: "success"
		},
		{
			value: "preset-filled-warning-500",
			label: "Warning Filled",
			type: "filled",
			color: "warning"
		},
		{
			value: "preset-tonal-warning",
			label: "Warning Tonal",
			type: "tonal",
			color: "warning"
		},
		{
			value: "preset-outlined-warning-500",
			label: "Warning Outlined",
			type: "outlined",
			color: "warning"
		},
		{
			value: "preset-filled-error-500",
			label: "Error Filled",
			type: "filled",
			color: "error"
		},
		{
			value: "preset-tonal-error",
			label: "Error Tonal",
			type: "tonal",
			color: "error"
		},
		{
			value: "preset-outlined-error-500",
			label: "Error Outlined",
			type: "outlined",
			color: "error"
		},
		{
			value: "preset-filled-surface-500",
			label: "Surface Filled",
			type: "filled",
			color: "surface"
		},
		{
			value: "preset-tonal-surface",
			label: "Surface Tonal",
			type: "tonal",
			color: "surface"
		},
		{
			value: "preset-outlined-surface-500",
			label: "Surface Outlined",
			type: "outlined",
			color: "surface"
		}
	]

	function handleCreateClick() {
		isCreating = true
		newTagName = ""
		newTagDescription = ""
		newTagColorPreset = "preset-filled-primary-500"
	}

	function handleEditClick() {
		if (!selectedTag) return
		isEditing = true
		editTagName = selectedTag.name
		editTagDescription = selectedTag.description || ""
		editTagColorPreset =
			selectedTag.colorPreset || "preset-filled-primary-500"
	}

	function handleDeleteClick() {
		if (!selectedTag) return
		tagToDelete = selectedTag
		showDeleteModal = true
	}

	function handleTagClick(tag: SelectTag) {
		selectedTag = tag
		// Load related data for the selected tag
		socket.emit("tags:getRelatedData", { tagId: tag.id })
	}

	function validateNewTag(): boolean {
		const result = tagSchema.safeParse({
			name: newTagName
		})

		if (result.success) {
			validationErrors = {}
			return true
		} else {
			const errors: ValidationErrors = {}
			result.error.errors.forEach((error) => {
				if (error.path.length > 0) {
					errors[error.path[0] as string] = error.message
				}
			})
			validationErrors = errors
			return false
		}
	}

	function validateEditTag(): boolean {
		const result = tagSchema.safeParse({
			name: editTagName
		})

		if (result.success) {
			editValidationErrors = {}
			return true
		} else {
			const errors: ValidationErrors = {}
			result.error.errors.forEach((error) => {
				if (error.path.length > 0) {
					errors[error.path[0] as string] = error.message
				}
			})
			editValidationErrors = errors
			return false
		}
	}

	function createTag() {
		if (!validateNewTag()) return

		const tag: Omit<InsertTag, "userId"> = {
			name: newTagName.trim(),
			description: newTagDescription.trim() || null,
			colorPreset: newTagColorPreset
		}

		socket.emit("tags:create", { tag })
		isCreating = false
	}

	function updateTag() {
		if (!selectedTag || !validateEditTag()) return

		const tag: SelectTag = {
			...selectedTag,
			name: editTagName.trim(),
			description: editTagDescription.trim() || null,
			colorPreset: editTagColorPreset
		}

		socket.emit("tags:update", { tag })
		isEditing = false
	}

	function confirmDelete() {
		if (!tagToDelete) return
		const deletedId = tagToDelete.id
		socket.emit("tags:delete", { id: deletedId })
		showDeleteModal = false
		tagToDelete = null
		if (selectedTag?.id === deletedId) {
			selectedTag = null
		}
	}

	function cancelDelete() {
		showDeleteModal = false
		tagToDelete = null
	}

	function cancelCreate() {
		isCreating = false
		newTagName = ""
		newTagDescription = ""
		newTagColorPreset = "preset-filled-primary-500"
	}

	function cancelEdit() {
		isEditing = false
		editTagName = ""
		editTagDescription = ""
		editTagColorPreset = "preset-filled-primary-500"
	}

	function handleCharacterClick(character: Partial<SelectCharacter>) {
		panelsCtx.digest.sessionCharacterId = character.id
		panelsCtx.openPanel({ key: "sessions", toggle: false })
	}

	function handleCharacterEditClick(character: Partial<SelectCharacter>) {
		panelsCtx.digest.characterId = character.id
		panelsCtx.openPanel({ key: "characters", toggle: false })
	}

	function handlePersonaClick(persona: Partial<SelectPersona>) {
		panelsCtx.digest.sessionPersonaId = persona.id
		panelsCtx.openPanel({ key: "sessions", toggle: false })
	}

	function handlePersonaEditClick(persona: Partial<SelectPersona>) {
		panelsCtx.digest.personaId = persona.id
		panelsCtx.openPanel({ key: "personas", toggle: false })
	}

	function handleLorebookClick(lorebook: SelectLorebook) {
		panelsCtx.digest.lorebookId = lorebook.id
		panelsCtx.openPanel({ key: "lorebooks", toggle: false })
	}

	function handleSessionClick(
		session: Sockets.Sessions.List.Response["sessionList"][0]
	) {
		goto(`/sessions/${session.id}`)
		panelsCtx.fullscreenPanel = null
	}

	function handleSessionEditClick(
		session: Sockets.Sessions.List.Response["sessionList"][0]
	) {
		panelsCtx.digest.sessionId = session.id
		panelsCtx.openPanel({ key: "sessions", toggle: false })
	}

	onMount(() => {
		socket.on("tags:list", (msg: any) => {
			tagsList = msg.tagsList || []
			isLoading = false
		})
		// The generic **:error listener in Layout.svelte already toasts this —
		// this just stops the spinner from spinning forever if the initial
		// fetch fails, so it settles into the (accurate enough) empty state.
		socket.on("tags:list:error", () => {
			isLoading = false
		})

		socket.on("tags:create", (msg: any) => {
			toaster.success({
				title: "Tag Created",
				description: `Tag "${msg.tag.name}" created successfully.`
			})
		})

		socket.on("tags:update", (msg: any) => {
			selectedTag = msg.tag
			toaster.success({
				title: "Tag Updated",
				description: `Tag "${msg.tag.name}" updated successfully.`
			})
		})

		socket.on("tags:delete", (msg: any) => {
			toaster.success({
				title: "Tag Deleted",
				description: "Tag deleted successfully."
			})
		})

		socket.on("tags:getRelatedData", (msg: any) => {
			relatedCharacters = msg.tagData.characters || []
			relatedPersonas = msg.tagData.personas || []
			relatedLorebooks = msg.tagData.lorebooks || []
			relatedSessions = msg.tagData.sessions || []
		})

		socket.emit("tags:list", {})

		onclose = async () => {
			return true
		}
	})

	onDestroy(() => {
		socket.off("tags:list")
		socket.off("tags:list:error")
		socket.off("tags:create")
		socket.off("tags:update")
		socket.off("tags:delete")
		socket.off("tags:getRelatedData")
		onclose = undefined
	})
</script>

<div class="text-foreground h-full p-4">
	{#if selectedTag && !isEditing}
		<!-- Selected tag view -->
		<div class="mb-4">
			<div class="mb-4">
				<PanelNavHeader
					title={selectedTag.name}
					onBack={() => {
						selectedTag = null
					}}
					backLabel="Back to tags"
					actionsLabel="Tag"
				>
					{#snippet primaryAction()}
						<button
							class="btn btn-sm preset-filled-surface-400-600 shrink-0 p-2"
							onclick={handleEditClick}
							title="Edit Tag"
							aria-label="Edit Tag"
							type="button"
						>
							<Icons.Pencil size={16} aria-hidden="true" />
						</button>
					{/snippet}
					{#snippet actions()}
						<button
							class="btn btn-sm popover-menu-btn hover:preset-filled-error-500"
							onclick={handleDeleteClick}
							type="button"
						>
							<Icons.Trash2 size={16} aria-hidden="true" />
							<span>Delete</span>
						</button>
					{/snippet}
				</PanelNavHeader>
			</div>

			{#if selectedTag.description}
				<div
					class="border-primary-500 bg-surface-50-950 mb-4 rounded-lg border p-4"
				>
					<p class="text-muted-foreground text-sm">
						{selectedTag.description}
					</p>
				</div>
			{/if}

			<!-- Related sections -->
			{#if relatedCharacters.length > 0}
				<div class="mb-6">
					<h3
						class="mb-3 flex items-center gap-2 text-lg font-semibold"
					>
						<Icons.User size={18} />
						Characters ({relatedCharacters.length})
					</h3>
					<div class="flex flex-col gap-2">
						{#each relatedCharacters as character}
							<CharacterListItem
								{character}
								onclick={handleCharacterClick}
								onEdit={() =>
									handleCharacterEditClick(character)}
								showControls={true}
								contentTitle="Go to character sessions"
							/>
						{/each}
					</div>
				</div>
			{/if}

			{#if relatedPersonas.length > 0}
				<div class="mb-6">
					<h3
						class="mb-3 flex items-center gap-2 text-lg font-semibold"
					>
						<Icons.UserCog size={18} />
						Personas ({relatedPersonas.length})
					</h3>
					<div class="flex flex-col gap-2">
						{#each relatedPersonas as persona}
							<PersonaListItem
								{persona}
								onclick={handlePersonaClick}
								onEdit={() => handlePersonaEditClick(persona)}
								showControls={true}
								contentTitle="Go to persona sessions"
							/>
						{/each}
					</div>
				</div>
			{/if}

			{#if relatedLorebooks.length > 0}
				<div class="mb-6">
					<h3
						class="mb-3 flex items-center gap-2 text-lg font-semibold"
					>
						<Icons.Book size={18} />
						Lorebooks ({relatedLorebooks.length})
					</h3>
					<div class="grid gap-2">
						{#each relatedLorebooks as lorebook}
							<LorebookListItem
								{lorebook}
								onclick={() => handleLorebookClick(lorebook)}
								showControls={false}
								contentTitle="Go to lorebook"
							/>
						{/each}
					</div>
				</div>
			{/if}

			{#if relatedSessions.length > 0}
				<div class="mb-6">
					<h3
						class="mb-3 flex items-center gap-2 text-lg font-semibold"
					>
						<Icons.MessageSquare size={18} />
						Sessions ({relatedSessions.length})
					</h3>
					<div class="flex flex-col gap-2">
						{#each relatedSessions as session}
							<SessionListItem
								{session}
								onclick={handleSessionClick}
								onEdit={() => {
									handleSessionEditClick(session)
								}}
								showControls={true}
								contentTitle="Go to session"
							/>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	{:else if isCreating}
		<!-- Create tag form -->
		<div>
			<h1 class="mb-4 text-lg font-bold">Create New Tag</h1>
			<div
				class="mt-4 mb-4 flex gap-2"
				role="group"
				aria-label="Form actions"
			>
				<button
					class="btn btn-sm preset-filled-surface-500 w-full"
					onclick={cancelCreate}
				>
					Cancel
				</button>
				<button
					class="btn btn-sm preset-filled-primary-500 w-full"
					onclick={createTag}
					disabled={Object.keys(validationErrors).length > 0 ||
						!newTagName.trim()}
				>
					Create Tag
				</button>
			</div>
			<div class="space-y-4">
				<div>
					<label class="mb-1 block font-semibold" for="tagName">
						Name
					</label>
					<input
						id="tagName"
						name="tagName"
						type="text"
						class="input w-full {validationErrors.name
							? 'border-error-500'
							: ''}"
						bind:value={newTagName}
						placeholder="Enter tag name"
						aria-invalid={validationErrors.name ? "true" : "false"}
						aria-describedby={validationErrors.name
							? "name-error"
							: undefined}
						oninput={() => {
							if (validationErrors.name) {
								const { name, ...rest } = validationErrors
								validationErrors = rest
							}
						}}
					/>
					{#if validationErrors.name}
						<p
							id="name-error"
							class="text-error-500 mt-1 text-sm"
							role="alert"
						>
							{validationErrors.name}
						</p>
					{/if}
				</div>
				<div>
					<label
						class="mb-1 block font-semibold"
						for="tagDescription"
					>
						Description (Optional)
					</label>
					<textarea
						name="tagDescription"
						class="input w-full"
						bind:value={newTagDescription}
						placeholder="Enter tag description"
						rows="3"
					></textarea>
				</div>
				<div>
					<label class="mb-1 block font-semibold" for="colorPreset">
						Color Preset
					</label>
					<select
						name="colorPreset"
						class="input w-full"
						bind:value={newTagColorPreset}
					>
						{#each colorPresetOptions as option}
							<option value={option.value}>{option.label}</option>
						{/each}
					</select>
					<div class="mt-2">
						<span class="text-muted-foreground text-sm">
							Preview:
						</span>
						<button
							type="button"
							class="chip {newTagColorPreset} ml-2"
						>
							{newTagName.trim() || "Tag Preview"}
						</button>
					</div>
				</div>
			</div>
		</div>
	{:else if isEditing}
		<!-- Edit tag form -->
		<div>
			<h1 class="mb-4 text-lg font-bold">Edit Tag</h1>
			<div
				class="mt-4 mb-4 flex gap-2"
				role="group"
				aria-label="Form actions"
			>
				<button
					class="btn btn-sm preset-filled-surface-500 w-full"
					onclick={cancelEdit}
				>
					Cancel
				</button>
				<button
					class="btn btn-sm preset-filled-primary-500 w-full"
					onclick={updateTag}
					disabled={Object.keys(editValidationErrors).length > 0 ||
						!editTagName.trim()}
				>
					Update Tag
				</button>
			</div>
			<div class="space-y-4">
				<div>
					<label class="mb-1 block font-semibold" for="editTagName">
						Name
					</label>
					<input
						id="editTagName"
						name="editTagName"
						type="text"
						class="input w-full {editValidationErrors.name
							? 'border-error-500'
							: ''}"
						bind:value={editTagName}
						placeholder="Enter tag name"
						aria-invalid={editValidationErrors.name
							? "true"
							: "false"}
						aria-describedby={editValidationErrors.name
							? "edit-name-error"
							: undefined}
						oninput={() => {
							if (editValidationErrors.name) {
								const { name, ...rest } = editValidationErrors
								editValidationErrors = rest
							}
						}}
					/>
					{#if editValidationErrors.name}
						<p
							id="edit-name-error"
							class="text-error-500 mt-1 text-sm"
							role="alert"
						>
							{editValidationErrors.name}
						</p>
					{/if}
				</div>
				<div>
					<label
						class="mb-1 block font-semibold"
						for="editTagDescription"
					>
						Description (Optional)
					</label>
					<textarea
						name="editTagDescription"
						class="input w-full"
						bind:value={editTagDescription}
						placeholder="Enter tag description"
						rows="3"
					></textarea>
				</div>
				<div>
					<label
						class="mb-1 block font-semibold"
						for="editColorPreset"
					>
						Color Preset
					</label>
					<select
						name="editColorPreset"
						class="input w-full"
						bind:value={editTagColorPreset}
					>
						{#each colorPresetOptions as option}
							<option value={option.value}>{option.label}</option>
						{/each}
					</select>
					<div class="mt-2">
						<span class="text-muted-foreground text-sm">
							Preview:
						</span>
						<button
							type="button"
							class="chip {editTagColorPreset} ml-2"
						>
							{editTagName.trim() || "Tag Preview"}
						</button>
					</div>
				</div>
			</div>
		</div>
	{:else}
		<!-- Main tags list view -->
		<div class="mb-2 flex gap-2">
			<button
				class="btn btn-sm preset-filled-primary-500"
				onclick={handleCreateClick}
				title="Create New Tag"
			>
				<Icons.Plus size={16} />
				New
			</button>
		</div>

		<div class="mb-4 flex items-center gap-2">
			<input
				type="text"
				placeholder="Search tags..."
				aria-label="Search tags"
				class="input"
				bind:value={search}
			/>
		</div>

		{#if isLoading}
			<div class="flex items-center justify-center py-8">
				<Icons.Loader2
					size={20}
					class="text-surface-400 animate-spin"
				/>
			</div>
		{:else if filteredTags.length === 0}
			<EmptyState
				icon={Icons.Tag}
				message={search
					? `No tags found matching "${search}".`
					: "No tags yet — create one to get started."}
				ctaLabel={search ? undefined : "New Tag"}
				onCta={search ? undefined : () => (isCreating = true)}
			/>
		{:else}
			<!-- Beautiful multi-row flex layout using Skeleton chips -->
			<div class="flex flex-wrap gap-2">
				{#each filteredTags as tag}
					<button
						type="button"
						class="chip {tag.colorPreset ||
							'preset-filled-primary-500'} text-sm transition-all duration-200"
						onclick={() => handleTagClick(tag)}
						title={tag.description || tag.name}
					>
						{tag.name}
					</button>
				{/each}
			</div>
		{/if}
	{/if}
</div>

<!-- Delete confirmation modal -->
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
					class="card bg-surface-100-900 max-w-[95vw] space-y-4 p-4 shadow-xl"
				>
					<div class="p-6">
						<h2 class="mb-2 text-lg font-bold">Delete Tag?</h2>
						<p class="mb-4">
							Are you sure you want to delete the tag "{tagToDelete?.name}"?
							This action cannot be undone and will remove the tag
							from all associated items.
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
{/if}
