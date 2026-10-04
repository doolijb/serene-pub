<script lang="ts">
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
	import { getContext, onDestroy, onMount } from "svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { z } from "zod"
	import CharacterListItem from "../listItems/CharacterListItem.svelte"
	import SessionListItem from "../listItems/SessionListItem.svelte"
	import LorebookListItem from "../listItems/LorebookListItem.svelte"
	import EmptyState from "../EmptyState.svelte"
	import PanelNavHeader from "../panels/PanelNavHeader.svelte"
	import DetailHero from "../panels/DetailHero.svelte"
	import Select from "../inputs/Select.svelte"
	import PanelFilterInput from "../panels/PanelFilterInput.svelte"
	import ViewToolbar from "../panels/ViewToolbar.svelte"
	import PanelSplit from "../panels/PanelSplit.svelte"
	import { ViewModeTracker } from "$lib/client/shell/viewMode.svelte"
	import { goto } from "$app/navigation"
	import { JUMP_CONTEXT, type JumpCtx } from "$lib/client/shell/jump.svelte"

	interface Props {
		onclose?: () => Promise<boolean> | undefined
	}

	let { onclose = $bindable() }: Props = $props()

	const socket = useTypedSocket()
	const panelsCtx: PanelsCtx = $state(getContext("panelsCtx"))
	// Measures the view's own box, not the window: the same view is 400px in
	// the dock and ~1376px full page, and both must land in the right shape.
	const vm = new ViewModeTracker()

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

	/**
	 * Jump, scoped to this view — see CharactersSidebar's matching block for
	 * why the registration is closures rather than values.
	 */
	const jumpCtx = getContext<JumpCtx | undefined>(JUMP_CONTEXT)
	$effect(() =>
		jumpCtx?.registerScope("tags", {
			label: "Tags",
			placeholder: "Filter tags",
			getQuery: () => search,
			setQuery: (next) => (search = next),
			getHits: () =>
				filteredTags.map((tag) => ({
					kind: "tag" as const,
					id: tag.id,
					title: tag.name,
					subtitle: tag.description || undefined
				})),
			// The row's own onclick: select the tag and fetch what it is on.
			onPick: (hit) => {
				const tag = tagsList.find((t) => t.id === Number(hit.id))
				if (tag) handleTagClick(tag)
			}
		})
	)

	/** "3 characters · 1 lorebook" — what the tag is on, for the hero. */
	const tagUsage = $derived(
		[
			[relatedCharacters.length, "character", "characters"],
			[relatedLorebooks.length, "lorebook", "lorebooks"],
			[relatedSessions.length, "session", "sessions"]
		]
			.filter(([n]) => (n as number) > 0)
			.map(([n, one, many]) => `${n} ${n === 1 ? one : many}`)
			.join(" · ")
	)

	// Color preset options
	const colorPresetOptions = [
		{
			value: "preset-filled-primary-500",
			label: "Primary filled",
			type: "filled",
			color: "primary"
		},
		{
			value: "preset-tonal-primary",
			label: "Primary tonal",
			type: "tonal",
			color: "primary"
		},
		{
			value: "preset-outlined-primary-500",
			label: "Primary outlined",
			type: "outlined",
			color: "primary"
		},
		{
			value: "preset-filled-secondary-500",
			label: "Secondary filled",
			type: "filled",
			color: "secondary"
		},
		{
			value: "preset-tonal-secondary",
			label: "Secondary tonal",
			type: "tonal",
			color: "secondary"
		},
		{
			value: "preset-outlined-secondary-500",
			label: "Secondary outlined",
			type: "outlined",
			color: "secondary"
		},
		{
			value: "preset-filled-tertiary-500",
			label: "Tertiary filled",
			type: "filled",
			color: "tertiary"
		},
		{
			value: "preset-tonal-tertiary",
			label: "Tertiary tonal",
			type: "tonal",
			color: "tertiary"
		},
		{
			value: "preset-outlined-tertiary-500",
			label: "Tertiary outlined",
			type: "outlined",
			color: "tertiary"
		},
		{
			value: "preset-filled-success-500",
			label: "Success filled",
			type: "filled",
			color: "success"
		},
		{
			value: "preset-tonal-success",
			label: "Success tonal",
			type: "tonal",
			color: "success"
		},
		{
			value: "preset-outlined-success-500",
			label: "Success outlined",
			type: "outlined",
			color: "success"
		},
		{
			value: "preset-filled-warning-500",
			label: "Warning filled",
			type: "filled",
			color: "warning"
		},
		{
			value: "preset-tonal-warning",
			label: "Warning tonal",
			type: "tonal",
			color: "warning"
		},
		{
			value: "preset-outlined-warning-500",
			label: "Warning outlined",
			type: "outlined",
			color: "warning"
		},
		{
			value: "preset-filled-error-500",
			label: "Error filled",
			type: "filled",
			color: "error"
		},
		{
			value: "preset-tonal-error",
			label: "Error tonal",
			type: "tonal",
			color: "error"
		},
		{
			value: "preset-outlined-error-500",
			label: "Error outlined",
			type: "outlined",
			color: "error"
		},
		{
			value: "preset-filled-surface-500",
			label: "Surface filled",
			type: "filled",
			color: "surface"
		},
		{
			value: "preset-tonal-surface",
			label: "Surface tonal",
			type: "tonal",
			color: "surface"
		},
		{
			value: "preset-outlined-surface-500",
			label: "Surface outlined",
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

	function handleLorebookClick(lorebook: SelectLorebook) {
		panelsCtx.digest.lore = {
			lorebookId: lorebook.id,
			scope: "all"
		}
		panelsCtx.openPanel({ key: "lorebooks", toggle: false })
	}

	function handleSessionClick(
		session: Sockets.Sessions.List.Response["sessionList"][0]
	) {
		goto(`/sessions/${session.id}`)
		panelsCtx.fullPageView = null
	}

	function handleSessionEditClick(
		session: Sockets.Sessions.List.Response["sessionList"][0]
	) {
		panelsCtx.digest.sessionId = session.id
		panelsCtx.openPanel({ key: "sessions", toggle: false })
	}

	// Declared on the interest registry below, which owns the one listener per
	// event and releases this sidebar's subscribers when it is destroyed.
	function handleTagsList(msg: any) {
		tagsList = msg.tagsList || []
		isLoading = false
	}

	// The generic **:error listener in Layout.svelte already toasts this —
	// this just stops the spinner from spinning forever if the initial
	// fetch fails, so it settles into the (accurate enough) empty state.
	function handleTagsListError() {
		isLoading = false
	}

	function handleTagsCreate(msg: any) {
		toaster.success({
			title: "Tag created",
			description: `Tag "${msg.tag.name}" created successfully.`
		})
	}

	function handleTagsUpdate(msg: any) {
		selectedTag = msg.tag
		toaster.success({
			title: "Tag updated",
			description: `Tag "${msg.tag.name}" updated successfully.`
		})
	}

	function handleTagsDelete(msg: any) {
		toaster.success({
			title: "Tag deleted",
			description: "Tag deleted successfully."
		})
	}

	function handleTagsGetRelatedData(msg: any) {
		// No personas section: a persona is a character, so a tagged persona
		// arrives in `characters` (flagged by its own `isPersona`) and
		// showing it twice would be two rows for one row.
		relatedCharacters = msg.tagData.characters || []
		relatedLorebooks = msg.tagData.lorebooks || []
		relatedSessions = msg.tagData.sessions || []
	}

	/**
	 * This sidebar's `tags:*` replies, on the interest registry. All BARE —
	 * the list is the whole of this user's tags, and the three writes plus
	 * `getRelatedData` answer on their own event with no id this view already
	 * holds, so none of them has an interest scope to narrow to.
	 *
	 * `tags:list` is STANDING rather than a one-shot: it is a cascade target,
	 * re-sent after every create, update and delete, and this sidebar is what
	 * renders it. The request that fills it first is in `onMount` below; the
	 * typed `emit` puts the sync packet naming these keys ahead of it on the
	 * same socket.
	 */
	useInterest<"tags:list">("tags:list", handleTagsList)
	// The server has no `tags:list:error` emit today — the key is declared
	// anyway, because the registry is the only listener path and a key nobody
	// sends costs one string in a sync packet.
	useInterest<"tags:list:error">("tags:list:error", handleTagsListError)
	useInterest<"tags:create">("tags:create", handleTagsCreate)
	useInterest<"tags:update">("tags:update", handleTagsUpdate)
	useInterest<"tags:delete">("tags:delete", handleTagsDelete)
	useInterest<"tags:getRelatedData">(
		"tags:getRelatedData",
		handleTagsGetRelatedData
	)

	onMount(() => {
		socket.emit("tags:list", {})

		onclose = async () => {
			return true
		}
	})

	onDestroy(() => {
		// The `tags:*` listeners are not here: the interest registry releases
		// this sidebar's subscribers as its effects are destroyed.
		onclose = undefined
	})
</script>

<div use:vm.observe class="text-foreground flex h-full min-h-0 flex-col">
	<PanelSplit
		mode={vm.mode}
		hasDetail={isCreating || isEditing || selectedTag != null}
		emptyMessage="Pick a tag to see what it is on."
	>
		{#snippet detail()}
			{#if selectedTag && !isEditing}
				<!-- Selected tag view -->
				<div class="mb-4">
					<div class="mb-4">
						<PanelNavHeader
							title="Tag"
							onBack={vm.mode === "desk"
								? undefined
								: () => {
										selectedTag = null
									}}
							backLabel="Back to tags"
							actionsLabel="Tag"
							menuItems={[
								{
									label: "Delete",
									icon: Icons.Trash2,
									destructive: true,
									onSelect: handleDeleteClick
								}
							]}
						>
							{#snippet primaryAction()}
								<button
									class="btn btn-sm preset-filled-surface-400-600 shrink-0 p-2"
									onclick={handleEditClick}
									title="Edit tag"
									aria-label="Edit tag"
									type="button"
								>
									<Icons.Pencil
										size={16}
										aria-hidden="true"
									/>
								</button>
							{/snippet}
						</PanelNavHeader>
					</div>

					<DetailHero
						class="mb-4"
						title={selectedTag.name}
						icon={Icons.Tag}
						subtitle={tagUsage || undefined}
						chips={tagChip}
					/>

					{#if selectedTag.description}
						<div
							class="border-primary-500 bg-surface-50-950 mb-4 rounded-lg border p-4"
						>
							<p class="text-surface-600-400 text-sm">
								{selectedTag.description}
							</p>
						</div>
					{/if}

					<!-- Related sections: side by side once the detail has the
					     room (notes 14), as the session detail's cards are. -->
					<div
						class="grid items-start gap-x-6 @2xl/detail:grid-cols-2"
					>
						{#if relatedCharacters.length > 0}
							<div class="mb-6">
								<h3
									class="mb-3 flex items-center gap-2 text-sm font-medium"
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
												handleCharacterEditClick(
													character
												)}
											showControls={true}
											contentTitle="Go to character sessions"
										/>
									{/each}
								</div>
							</div>
						{/if}

						{#if relatedLorebooks.length > 0}
							<div class="mb-6">
								<h3
									class="mb-3 flex items-center gap-2 text-sm font-medium"
								>
									<Icons.Book size={18} />
									Lorebooks ({relatedLorebooks.length})
								</h3>
								<div class="grid gap-2">
									{#each relatedLorebooks as lorebook}
										<LorebookListItem
											{lorebook}
											onclick={() =>
												handleLorebookClick(lorebook)}
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
									class="mb-3 flex items-center gap-2 text-sm font-medium"
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
				</div>
			{:else if isCreating}
				<!-- Create tag form -->
				<div>
					<h1 class="mb-4 text-lg font-bold">Create a tag</h1>
					<div
						class="mt-4 mb-4 flex max-w-3xl gap-2 @xl/detail:justify-end"
						role="group"
						aria-label="Form actions"
					>
						<button
							class="btn btn-sm preset-filled-surface-500 w-full @xl/detail:w-auto"
							onclick={cancelCreate}
						>
							Cancel
						</button>
						<button
							class="btn btn-sm preset-filled-primary-500 w-full @xl/detail:w-auto"
							onclick={createTag}
							disabled={Object.keys(validationErrors).length >
								0 || !newTagName.trim()}
						>
							Create tag
						</button>
					</div>
					<!-- Two columns once the detail has the room (notes 14):
					     the name beside its colour, the description under both. -->
					<div class="grid max-w-3xl gap-4 @xl/detail:grid-cols-2">
						<div>
							<label
								class="mb-1 block font-semibold"
								for="tagName"
							>
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
								aria-invalid={validationErrors.name
									? "true"
									: "false"}
								aria-describedby={validationErrors.name
									? "name-error"
									: undefined}
								oninput={() => {
									if (validationErrors.name) {
										const { name, ...rest } =
											validationErrors
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
							<Select
								label="Color preset"
								options={colorPresetOptions}
								bind:value={newTagColorPreset}
							/>
							<div class="mt-2">
								<span class="text-surface-600-400 text-sm">
									Preview:
								</span>
								<button
									type="button"
									class="chip {newTagColorPreset} ml-2"
								>
									{newTagName.trim() || "Tag preview"}
								</button>
							</div>
							<div class="@xl/detail:col-span-2">
								<label
									class="mb-1 block font-semibold"
									for="tagDescription"
								>
									Description (optional)
								</label>
								<textarea
									id="tagDescription"
									name="tagDescription"
									class="input w-full"
									bind:value={newTagDescription}
									placeholder="Enter tag description"
									rows="3"
								></textarea>
							</div>
						</div>
					</div>
				</div>
			{:else if isEditing}
				<!-- Edit tag form -->
				<div>
					<h1 class="mb-4 text-lg font-bold">Edit tag</h1>
					<div
						class="mt-4 mb-4 flex max-w-3xl gap-2 @xl/detail:justify-end"
						role="group"
						aria-label="Form actions"
					>
						<button
							class="btn btn-sm preset-filled-surface-500 w-full @xl/detail:w-auto"
							onclick={cancelEdit}
						>
							Cancel
						</button>
						<button
							class="btn btn-sm preset-filled-primary-500 w-full @xl/detail:w-auto"
							onclick={updateTag}
							disabled={Object.keys(editValidationErrors).length >
								0 || !editTagName.trim()}
						>
							Update tag
						</button>
					</div>
					<!-- Two columns once the detail has the room (notes 14):
					     the name beside its colour, the description under both. -->
					<div class="grid max-w-3xl gap-4 @xl/detail:grid-cols-2">
						<div>
							<label
								class="mb-1 block font-semibold"
								for="editTagName"
							>
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
										const { name, ...rest } =
											editValidationErrors
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
							<Select
								label="Color preset"
								options={colorPresetOptions}
								bind:value={editTagColorPreset}
							/>
							<div class="mt-2">
								<span class="text-surface-600-400 text-sm">
									Preview:
								</span>
								<button
									type="button"
									class="chip {editTagColorPreset} ml-2"
								>
									{editTagName.trim() || "Tag preview"}
								</button>
							</div>
							<div class="@xl/detail:col-span-2">
								<label
									class="mb-1 block font-semibold"
									for="editTagDescription"
								>
									Description (optional)
								</label>
								<textarea
									id="editTagDescription"
									name="editTagDescription"
									class="input w-full"
									bind:value={editTagDescription}
									placeholder="Enter tag description"
									rows="3"
								></textarea>
							</div>
						</div>
					</div>
				</div>
			{/if}
		{/snippet}

		{#snippet list()}
			<!-- The view toolbar (STYLE-GUIDE §6.3). -->
			<ViewToolbar label="Tags" class="mb-4">
				{#snippet primary()}
					<button
						type="button"
						class="btn btn-sm preset-filled-primary-500 shrink-0"
						onclick={handleCreateClick}
						title="Create a tag"
					>
						<Icons.Plus size={16} aria-hidden="true" />
						New
					</button>
				{/snippet}
				{#snippet filter()}
					<PanelFilterInput
						bind:value={search}
						placeholder="tags"
						singular="tag"
						count={tagsList.length}
						aria-label="Filter tags by name or description"
					/>
				{/snippet}
			</ViewToolbar>

			{#if isLoading}
				<div class="flex items-center justify-center py-8">
					<Icons.Loader2
						size={20}
						class="text-surface-600-400 animate-spin"
					/>
				</div>
			{:else if filteredTags.length === 0}
				<EmptyState
					icon={Icons.Tag}
					message={search
						? `No tags found matching "${search}".`
						: "No tags yet — create one to get started."}
					ctaLabel={search ? undefined : "New tag"}
					onCta={search ? undefined : () => (isCreating = true)}
				/>
			{:else}
				<!-- Beautiful multi-row flex layout using Skeleton chips -->
				<div class="flex flex-wrap gap-2">
					{#each filteredTags as tag}
						{@const isSelected =
							vm.mode === "desk" && selectedTag?.id === tag.id}
						<!-- Selection is an OUTLINE, not `.sidebar-row-active`: a
					     tag's background is the tag's own colour preset (its
					     data), so the app's usual selected-row surface would
					     paint over the one thing this chip is for. The outline
					     sits outside it and reads on every preset. -->
						<button
							type="button"
							class="chip {tag.colorPreset ||
								'preset-filled-primary-500'} text-sm transition-all duration-200 {isSelected
								? 'outline-primary-500 outline-2 outline-offset-2'
								: ''}"
							onclick={() => handleTagClick(tag)}
							title={tag.description || tag.name}
							aria-current={isSelected ? "true" : undefined}
						>
							{tag.name}
						</button>
					{/each}
				</div>
			{/if}
		{/snippet}
	</PanelSplit>
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
						<h2 class="mb-2 text-lg font-bold">Delete tag?</h2>
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

{#snippet tagChip()}
	{#if selectedTag}
		<span
			class="chip {selectedTag.colorPreset ||
				'preset-filled-primary-500'}"
		>
			{selectedTag.name}
		</span>
	{/if}
{/snippet}
