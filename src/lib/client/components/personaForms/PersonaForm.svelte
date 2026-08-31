<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { onDestroy, onMount } from "svelte"
	import { z } from "zod"
	import PersonaUnsavedChangesModal from "../modals/PersonaUnsavedChangesModal.svelte"
	import Avatar from "../Avatar.svelte"
	import FileDropzone from "../FileDropzone.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { stableStringify } from "$lib/shared/utils/connectionDefaults"

	interface EditPersonaData {
		id?: number
		name: string
		aliases: string[]
		summary: string
		avatar: string
		description: string
		isDefault: boolean
		position?: number
		connections?: string
		creator: string
		category: string
		tags: string[]
		_avatarFile?: File | undefined
		_avatar?: string
	}

	// Zod validation schema
	const personaSchema = z.object({
		name: z.string().min(1, "Name is required").trim(),
		description: z.string().min(1, "Description is required").trim(),
		avatar: z.string().optional(),
		isDefault: z.boolean().optional(),
		position: z.number().optional(),
		connections: z.string().optional()
	})

	type ValidationErrors = Record<string, string>

	export interface Props {
		personaId?: number
		isSafeToClose: boolean
		closeForm: () => void
		onCancel?: () => void
	}

	let {
		personaId,
		isSafeToClose = $bindable(),
		closeForm = $bindable(),
		onCancel = $bindable()
	}: Props = $props()

	let hasChanges = $state(false)

	const socket = useTypedSocket()

	// Tag-related state
	let tagsList: SelectTag[] = $state([])
	let tagSearchInput = $state("")
	let showTagSuggestions = $state(false)

	let editPersonaData: EditPersonaData = $state({
		id: undefined,
		name: "",
		aliases: [],
		summary: "",
		avatar: "",
		description: "",
		isDefault: false,
		position: 0,
		connections: "",
		creator: "",
		category: "",
		tags: [],
		_avatarFile: undefined,
		_avatar: ""
	})
	let originalPersonaData: EditPersonaData = $state({
		id: undefined,
		name: "",
		aliases: [],
		summary: "",
		avatar: "",
		description: "",
		isDefault: false,
		position: 0,
		connections: "",
		creator: "",
		category: "",
		tags: [],
		_avatarFile: undefined,
		_avatar: ""
	})
	let expandedAliases = $state(false)
	let expandedSummary = $state(false)
	let showCancelModal = $state(false)
	let isSaving = $state(false)
	let validationErrors: ValidationErrors = $state({})
	let formContainer: HTMLDivElement
	let validationTimeout: NodeJS.Timeout

	let mode: "create" | "edit" = $derived.by(() =>
		!!editPersonaData.id ? "edit" : "create"
	)

	// Filtered tags for suggestions
	let filteredTags = $derived.by(() => {
		if (!tagSearchInput)
			return tagsList.filter(
				(tag) =>
					!editPersonaData.tags.some(
						(selectedTag) =>
							selectedTag.toLowerCase() === tag.name.toLowerCase()
					)
			)
		return tagsList.filter(
			(tag) =>
				tag.name.toLowerCase().includes(tagSearchInput.toLowerCase()) &&
				!editPersonaData.tags.some(
					(selectedTag) =>
						selectedTag.toLowerCase() === tag.name.toLowerCase()
				)
		)
	})

	// Tag helper functions
	function addTag(tagName: string) {
		const trimmedName = tagName.trim()
		if (!trimmedName) return

		// Check for case-insensitive duplicates
		const isDuplicate = editPersonaData.tags.some(
			(existingTag) =>
				existingTag.toLowerCase() === trimmedName.toLowerCase()
		)
		if (isDuplicate) return

		editPersonaData.tags = [...editPersonaData.tags, trimmedName]
		tagSearchInput = ""
		showTagSuggestions = false
	}

	function removeTag(tagName: string) {
		editPersonaData.tags = editPersonaData.tags.filter(
			(tag) => tag !== tagName
		)
	}

	function handleTagInputKeydown(e: KeyboardEvent) {
		if (e.key === "Enter" && tagSearchInput.trim()) {
			e.preventDefault()
			addTag(tagSearchInput)
		} else if (e.key === "Escape") {
			showTagSuggestions = false
		}
	}

	// Events: avatarChange, save, cancel
	function validateFormDebounced() {
		clearTimeout(validationTimeout)
		validationTimeout = setTimeout(() => {
			validateForm()
		}, 300) // 300ms debounce
	}

	function validateForm(): boolean {
		const result = personaSchema.safeParse(editPersonaData)

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

	function handleAvatarChange(details: FileAcceptDetails) {
		const file = details.files?.[0]
		if (!file) return
		// Only set preview, do not upload yet
		const previewReader = new FileReader()
		previewReader.onload = (ev2) => {
			editPersonaData._avatar = ev2.target?.result as string
		}
		previewReader.readAsDataURL(file)
		// Store file for later upload
		editPersonaData._avatarFile = file
	}

	function onSave() {
		// Guard against double-submit (eg. an impatient re-click while the
		// previous save is still in flight)
		if (isSaving) return

		// Validate the form first
		if (!validateForm()) {
			// Validation failed, errors are already set in validationErrors
			return
		}

		if (mode === "create") {
			handleCreate()
		} else if (mode === "edit" && editPersonaData.id) {
			handleUpdate()
		}
	}

	function handleCreate() {
		const newPersona = { ...editPersonaData }
		const avatarFile = newPersona._avatarFile
		delete newPersona._avatarFile
		delete newPersona._avatar
		isSaving = true
		socket.emit("personas:create", {
			persona: newPersona,
			// Socket.IO transparently marshals a browser File (a Blob
			// subclass) to a Node Buffer on the server; the wire shape
			// differs from the client-side value's compile-time type.
			avatarFile: avatarFile as unknown as Buffer | undefined
		})
	}

	function handleUpdate() {
		const updatedPersona = { ...editPersonaData }
		if (!updatedPersona.id) return
		const avatarFile = updatedPersona._avatarFile
		delete updatedPersona._avatarFile
		delete updatedPersona._avatar
		isSaving = true
		socket.emit("personas:update", {
			persona: { ...updatedPersona, id: updatedPersona.id },
			// See handleCreate() above re: File → Buffer wire conversion.
			avatarFile: avatarFile as unknown as Buffer | undefined
		})
	}

	function handleCancelModalOnOpenChange(e: { open: boolean }) {
		if (!e.open) {
			showCancelModal = false
		}
	}

	function handleCancel() {
		if (hasChanges) {
			showCancelModal = true
		} else {
			closeForm()
		}
	}

	function handleCancelModalDiscard() {
		showCancelModal = false
		closeForm()
	}

	function handleCancelModalCancel() {
		showCancelModal = false
	}

	function handleKeydown(e: KeyboardEvent) {
		// Only handle shortcuts if this form is focused or contains the active element
		if (!formContainer?.contains(document.activeElement)) return

		// Ctrl+S / Cmd+S to save
		if ((e.ctrlKey || e.metaKey) && e.key === "s") {
			e.preventDefault()
			onSave()
		}
		// Escape to cancel
		else if (e.key === "Escape") {
			e.preventDefault()
			handleCancel()
		}
	}

	// Add debounced validation effect
	$effect(() => {
		// Only validate if we have some data and it's not the initial empty state
		if (
			editPersonaData.name ||
			editPersonaData.description ||
			Object.keys(validationErrors).length > 0
		) {
			validateFormDebounced()
		}
	})

	$effect(() => {
		hasChanges =
			stableStringify(editPersonaData) !==
			stableStringify(originalPersonaData)
		// Despite the name "isSafeToClose", this prop actually tracks when
		// there ARE changes (same misnaming as CharacterForm's identical
		// prop) — it should be called "hasChanges".
		isSafeToClose = hasChanges
	})

	// Define socket event handlers as named functions for proper cleanup
	const handlePersonasCreate = (res: Sockets.Personas.Create.Response) => {
		isSaving = false
		if (res.persona) {
			validationErrors = {} // Clear any validation errors on success
			toaster.success({
				title: "Persona Created",
				description: `Persona "${res.persona.name}" created successfully.`
			})
			closeForm()
		}
	}

	const handlePersonasUpdate = (res: Sockets.Personas.Update.Response) => {
		// personas:update is emitToUser — broadcast to every open tab for
		// this user, not just the requester. Without this check, a save in
		// another tab (for a different persona) silently closes this form
		// and discards whatever is being edited here.
		if (res.persona?.id !== personaId) return
		isSaving = false
		if (res.persona) {
			validationErrors = {} // Clear any validation errors on success
			toaster.success({
				title: "Persona Updated",
				description: `Persona "${res.persona.name}" updated successfully.`
			})
			closeForm()
		}
	}

	const handlePersonasCreateError = (msg: Sockets.ErrorResponse) => {
		isSaving = false
		toaster.error({
			title: "Failed to create persona",
			description: msg.error
		})
	}

	const handlePersonasUpdateError = (msg: Sockets.ErrorResponse) => {
		isSaving = false
		toaster.error({
			title: "Failed to update persona",
			description: msg.error
		})
	}

	const handleTagsList = (msg: Sockets.Tags.List.Response) => {
		tagsList = msg.tagsList || []
	}

	const handlePersonasGet = (message: Sockets.Personas.Get.Response) => {
		if (message.persona) {
			const p = message.persona
			editPersonaData = {
				...editPersonaData,
				id: p.id,
				name: p.name,
				aliases: Array.isArray(p.aliases) ? p.aliases : [],
				summary: p.summary ?? "",
				avatar: p.avatar ?? "",
				description: p.description ?? "",
				isDefault: p.isDefault,
				position: p.position ?? 0,
				// "connections" has no backing column on the personas table
				// (see schema.ts) and is never sent by "personas:get" — this
				// field only ever gets its value from local UI state.
				connections: "",
				creator: p.creator ?? "",
				category: p.category ?? "",
				tags: p.tags || [],
				_avatar: "",
				_avatarFile: undefined
			}
			originalPersonaData = $state.snapshot(editPersonaData)
		}
	}

	onMount(() => {
		onCancel = handleCancel

		// Add keyboard event listener
		document.addEventListener("keydown", handleKeydown)

		// Register socket event handlers
		socket.on("personas:create", handlePersonasCreate)
		socket.on("personas:update", handlePersonasUpdate)
		socket.on("personas:create:error", handlePersonasCreateError)
		socket.on("personas:update:error", handlePersonasUpdateError)
		socket.on("tags:list", handleTagsList)

		// Load tags list
		socket.emit("tags:list", {})

		if (personaId) {
			socket.once("personas:get", handlePersonasGet)
			socket.emit("personas:get", { id: personaId })
		}
	})

	onDestroy(() => {
		isSafeToClose = false
		// Properly remove event handlers by passing the function references
		socket.off("personas:create", handlePersonasCreate)
		socket.off("personas:update", handlePersonasUpdate)
		socket.off("personas:create:error", handlePersonasCreateError)
		socket.off("personas:update:error", handlePersonasUpdateError)
		socket.off("personas:get", handlePersonasGet)
		socket.off("tags:list", handleTagsList)

		// Remove keyboard event listener and clear timeout
		document.removeEventListener("keydown", handleKeydown)
		clearTimeout(validationTimeout)
	})
</script>

<div
	class="h-full rounded-lg"
	bind:this={formContainer}
	role="dialog"
	aria-labelledby="form-title"
	aria-modal="false"
>
	<div
		class="mb-4 flex items-center gap-2"
		role="group"
		aria-label="Form actions"
	>
		<button
			type="button"
			class="btn btn-sm preset-filled-surface-400-600 shrink-0 p-2"
			onclick={handleCancel}
			title="Cancel"
			aria-label="Cancel and go back"
		>
			<Icons.ChevronLeft size={16} aria-hidden="true" />
		</button>
		<h1 class="flex-1 text-lg font-bold" id="form-title">
			{mode === "edit"
				? `Edit: ${editPersonaData.name || "Persona"}`
				: "Create Persona"}
		</h1>
		<button
			type="button"
			class="btn btn-sm shrink-0"
			class:preset-filled-success-500={hasChanges}
			class:preset-tonal-success={!hasChanges}
			onclick={onSave}
			disabled={isSaving}
			aria-describedby="form-title"
			aria-label={`${mode === "edit" ? "Update" : "Create"} persona${hasChanges ? " (has unsaved changes)" : ""}`}
		>
			{#if isSaving}
				<Icons.Loader2
					size={16}
					class="animate-spin"
					aria-hidden="true"
				/>
			{:else}
				<Icons.Save size={16} aria-hidden="true" />
			{/if}
			{mode === "edit" ? "Update" : "Create"}
		</button>
	</div>
	<div class="flex flex-col gap-4" role="form" aria-labelledby="form-title">
		<fieldset
			class="flex items-center gap-4"
			aria-labelledby="avatar-section"
		>
			<legend id="avatar-section" class="sr-only">Avatar Settings</legend>
			<div aria-label="Current avatar preview">
				<Avatar
					src={editPersonaData._avatar || editPersonaData.avatar}
					char={editPersonaData}
				/>
			</div>
			<div class="flex w-full flex-col gap-2">
				<div class="flex w-full items-center justify-center">
					<FileDropzone
						name="persona-avatar"
						accept="image/*"
						hint="PNG, JPG or GIF"
						onFileAccept={handleAvatarChange}
					/>
				</div>
				<button
					type="button"
					class="btn btn-sm preset-tonal-error mt-1"
					onclick={() => {
						editPersonaData._avatarFile = undefined
						editPersonaData._avatar = ""
					}}
					disabled={!editPersonaData._avatarFile}
					aria-label="Clear selected avatar image"
				>
					Clear Selection
				</button>
			</div>
		</fieldset>
		<fieldset class="flex flex-col gap-1">
			<label class="flex gap-1 font-semibold" for="personaName">
				Name* <span
					class="flex items-center opacity-50 transition-opacity duration-200 hover:opacity-100"
					title="This field will be visible in prompts"
					aria-label="This field will be visible in prompts"
				>
					<Icons.ScanEye
						size={16}
						class="relative top-[1px] inline"
						aria-hidden="true"
					/>
				</span>
			</label>
			<input
				id="personaName"
				type="text"
				bind:value={editPersonaData.name}
				class="input {validationErrors.name
					? 'border-error-500 focus:border-error-500'
					: ''}"
				oninput={() => {
					// Clear validation error when user starts typing
					if (validationErrors.name) {
						const { name, ...rest } = validationErrors
						validationErrors = rest
					}
				}}
				aria-required="true"
				aria-invalid={validationErrors.name ? "true" : "false"}
				aria-describedby={validationErrors.name
					? "name-error"
					: undefined}
			/>
			{#if validationErrors.name}
				<p
					class="text-error-500 mt-1 text-sm"
					id="name-error"
					role="alert"
				>
					{validationErrors.name}
				</p>
			{/if}
		</fieldset>
		<div class="flex flex-col gap-2">
			<button
				type="button"
				class="flex items-center gap-2 text-sm font-semibold"
				onclick={() => (expandedAliases = !expandedAliases)}
			>
				<span class="flex gap-1">
					Aliases <span
						class="flex items-center opacity-50 transition-opacity duration-200 hover:opacity-100"
						title="This field will be visible in prompts"
						aria-label="This field will be visible in prompts"
					>
						<Icons.ScanEye
							size={16}
							class="relative top-[1px] inline"
							aria-hidden="true"
						/>
					</span>
				</span>
				<span class="ml-1">{expandedAliases ? "▼" : "►"}</span>
			</button>
			{#if expandedAliases}
				<div class="flex flex-col gap-1">
					{#each editPersonaData.aliases as _alias, idx (idx)}
						<div class="flex gap-2">
							<input
								type="text"
								bind:value={editPersonaData.aliases[idx]}
								class="input flex-1"
								placeholder="Alias..."
							/>
							<button
								class="btn btn-sm preset-tonal-error"
								type="button"
								onclick={() => {
									editPersonaData.aliases =
										editPersonaData.aliases.filter(
											(_, i) => i !== idx
										)
								}}
							>
								<Icons.Minus class="h-4 w-4" />
							</button>
						</div>
					{/each}
					<button
						class="btn btn-sm preset-filled-primary-500 mt-1"
						type="button"
						onclick={() => {
							editPersonaData.aliases = [
								...editPersonaData.aliases,
								""
							]
						}}
					>
						<Icons.Plus class="h-4 w-4" />
						Add Alias
					</button>
				</div>
			{/if}
		</div>
		<div class="flex flex-col gap-2">
			<button
				type="button"
				class="flex items-center gap-2 text-sm font-semibold"
				onclick={() => (expandedSummary = !expandedSummary)}
			>
				Summary
				<span class="ml-1">{expandedSummary ? "▼" : "►"}</span>
			</button>
			{#if expandedSummary}
				<div class="flex flex-col gap-1">
					<textarea
						bind:value={editPersonaData.summary}
						class="textarea min-h-16 text-sm"
						placeholder="One or two sentences describing who this persona is…"
						maxlength="200"
					></textarea>
					<p class="text-surface-700-300 text-right text-xs">
						{editPersonaData.summary.length} / 200
					</p>
					<p class="text-surface-400 text-xs">
						Used as a concise graph node description. Not injected
						into chat context.
					</p>
				</div>
			{/if}
		</div>
		<fieldset class="flex flex-col gap-2">
			<label class="flex gap-1 font-semibold" for="personaDescription">
				Description* <span
					class="flex items-center opacity-50 transition-opacity duration-200 hover:opacity-100"
					title="This field will be visible in prompts"
					aria-label="This field will be visible in prompts"
				>
					<Icons.ScanEye
						size={16}
						class="relative top-[1px] inline"
						aria-hidden="true"
					/>
				</span>
			</label>
			<textarea
				id="personaDescription"
				rows="8"
				bind:value={editPersonaData.description}
				class="input {validationErrors.description
					? 'border-error-500 focus:border-error-500'
					: ''}"
				placeholder="Description..."
				aria-label="Persona description"
				aria-required="true"
				aria-invalid={validationErrors.description ? "true" : "false"}
				aria-describedby={validationErrors.description
					? "description-error"
					: undefined}
				oninput={() => {
					// Clear validation error when user starts typing
					if (validationErrors.description) {
						const { description, ...rest } = validationErrors
						validationErrors = rest
					}
				}}
			></textarea>
			{#if validationErrors.description}
				<p
					class="text-error-500 mt-1 text-sm"
					id="description-error"
					role="alert"
				>
					{validationErrors.description}
				</p>
			{/if}
		</fieldset>

		<div class="flex flex-col gap-1">
			<label class="font-semibold" for="personaCreator">Creator</label>
			<input
				id="personaCreator"
				type="text"
				bind:value={editPersonaData.creator}
				class="input"
				placeholder="Who made this persona?"
			/>
		</div>
		<div class="flex flex-col gap-1">
			<label class="font-semibold" for="personaCategory">Category</label>
			<input
				id="personaCategory"
				type="text"
				bind:value={editPersonaData.category}
				class="input"
				placeholder="e.g. Fantasy, Sci-Fi, Slice of Life"
			/>
		</div>

		<!-- Tags Section -->
		<fieldset class="flex flex-col gap-2">
			<label class="font-semibold" for="tagInput">Tags</label>
			<div class="relative">
				<input
					id="tagInput"
					type="text"
					bind:value={tagSearchInput}
					class="input w-full"
					placeholder="Add a tag..."
					onfocus={() => (showTagSuggestions = true)}
					onblur={() =>
						setTimeout(() => (showTagSuggestions = false), 200)}
					onkeydown={handleTagInputKeydown}
				/>

				<!-- Tag suggestions dropdown -->
				{#if showTagSuggestions && filteredTags.length > 0}
					<div
						class="bg-surface-100-900 absolute z-10 mt-1 max-h-40 w-full overflow-y-auto rounded-lg border shadow-lg"
					>
						{#each filteredTags as tag}
							<button
								type="button"
								class="hover:bg-surface-200-800 w-full px-3 py-2 text-left transition-colors"
								onclick={() => addTag(tag.name)}
							>
								<span
									class="chip mr-2 {tag.colorPreset ||
										'preset-filled-primary-500'}"
								>
									{tag.name}
								</span>
								{#if tag.description}
									<span class="text-muted-foreground text-sm">
										- {tag.description}
									</span>
								{/if}
							</button>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Selected tags display -->
			{#if editPersonaData.tags.length > 0}
				<div class="flex flex-wrap gap-2">
					{#each editPersonaData.tags as tagName}
						{@const tag = tagsList.find((t) => t.name === tagName)}
						<button
							type="button"
							class="chip {tag?.colorPreset ||
								'preset-filled-primary-500'} group relative"
							onclick={() => removeTag(tagName)}
							title="Click to remove tag"
						>
							{tagName}
							<Icons.X
								size={14}
								class="ml-1 opacity-60 group-hover:opacity-100"
							/>
						</button>
					{/each}
				</div>
			{/if}
		</fieldset>
	</div>
</div>

<PersonaUnsavedChangesModal
	open={showCancelModal}
	onOpenChange={handleCancelModalOnOpenChange}
	onConfirm={handleCancelModalDiscard}
	onCancel={handleCancelModalCancel}
/>

<style>
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
