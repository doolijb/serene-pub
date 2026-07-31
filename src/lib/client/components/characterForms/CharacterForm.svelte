<script lang="ts">
	import { Switch, Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { onMount, onDestroy, getContext } from "svelte"
	import { z } from "zod"
	import CharacterUnsavedChangesModal from "../modals/CharacterUnsavedChangesModal.svelte"
	import Avatar from "../Avatar.svelte"
	import { toaster } from "$lib/client/utils/toaster"

	interface EditCharacterData {
		id?: number
		name: string
		nickname: string
		aliases: string[]
		summary: string
		avatar: string
		description: string
		personality: string
		scenario: string
		firstMessage: string
		alternateGreetings: string[]
		exampleDialogues: string[]
		creatorNotes: string
		creatorNotesMultilingual: Record<string, string>
		groupOnlyGreetings: string[]
		postHistoryInstructions: string
		isFavorite: boolean
		_avatarFile?: File | undefined
		_avatar: string
		lorebookId: number | null
		characterVersion?: string
		creator: string
		category: string
		tags: string[]
	}

	// Zod validation schema
	const characterSchema = z.object({
		name: z.string().min(1, "Name is required").trim(),
		nickname: z.string().optional(),
		description: z.string().min(1, "Description is required").trim(),
		personality: z.string().optional(),
		scenario: z.string().optional(),
		firstMessage: z.string().optional(),
		alternateGreetings: z.array(z.string()).optional(),
		exampleDialogues: z.array(z.string()).optional(),
		creatorNotes: z.string().optional(),
		creatorNotesMultilingual: z.record(z.string()).optional(),
		groupOnlyGreetings: z.array(z.string()).optional(),
		postHistoryInstructions: z.string().optional(),
		characterVersion: z.string().optional(),
		creator: z.string().optional(),
		category: z.string().optional(),
		isFavorite: z.boolean().optional(),
		lorebookId: z.number().nullable().optional(),
		tags: z.array(z.string()).optional()
	})

	type ValidationErrors = Record<string, string>

	export interface Props {
		characterId?: number
		isSafeToClose: boolean
		closeForm: () => void
		onCancel?: () => void
		hideAvatar?: boolean
		initialData?: Partial<EditCharacterData>
		customTitle?: string
		hideActionButtons?: boolean
		hideFavorite?: boolean
		hideTitle?: boolean
		hideTags?: boolean
		onDataChange?: (data: EditCharacterData) => void
		disableDataChangeCallback?: boolean
	}

	let {
		characterId,
		isSafeToClose: hasChanges = $bindable(),
		closeForm = $bindable(),
		onCancel = $bindable(),
		hideAvatar = false,
		initialData,
		customTitle,
		hideActionButtons = false,
		hideFavorite = false,
		hideTitle = false,
		hideTags = false,
		onDataChange,
		disableDataChangeCallback = false
	}: Props = $props()

	const socket = useTypedSocket()
	let systemSettingsCtx: SystemSettingsCtx = $state(
		getContext("systemSettingsCtx")
	)
	let userSettingsCtx: UserSettingsCtx = $state(getContext("userSettingsCtx"))

	let isInitialized = $state(false)

	let editCharacterData: EditCharacterData = $state({
		id: undefined,
		name: "",
		nickname: "",
		aliases: [],
		summary: "",
		avatar: "",
		description: "",
		personality: "",
		scenario: "",
		firstMessage: "",
		alternateGreetings: [],
		exampleDialogues: [],
		creatorNotes: "",
		creatorNotesMultilingual: {},
		groupOnlyGreetings: [],
		postHistoryInstructions: "",
		isFavorite: false,
		characterVersion: "",
		creator: "",
		category: "",
		_avatarFile: undefined,
		_avatar: "",
		lorebookId: null,
		tags: []
	})
	let originalCharacterData: EditCharacterData = $state({
		id: undefined,
		name: "",
		nickname: "",
		aliases: [],
		summary: "",
		avatar: "",
		description: "",
		personality: "",
		scenario: "",
		firstMessage: "",
		alternateGreetings: [],
		exampleDialogues: [],
		creatorNotes: "",
		creatorNotesMultilingual: {},
		groupOnlyGreetings: [],
		postHistoryInstructions: "",
		isFavorite: false,
		characterVersion: "",
		creator: "",
		category: "",
		_avatarFile: undefined,
		_avatar: "",
		lorebookId: null,
		tags: []
	})
	let expanded = $state({
		description: true,
		personality: false,
		scenario: false,
		firstMessage: false,
		exampleDialogues: false,
		creatorNotes: false,
		creatorNotesMultilingual: false,
		alternateGreetings: false,
		groupOnlyGreetings: false,
		postHistoryInstructions: false,
		aliases: false,
		summary: false
	})
	let character: Sockets.Characters.Get.Response["character"] | undefined =
		$state(undefined)
	let mode: "create" | "edit" = $derived.by(() =>
		!!character ? "edit" : "create"
	)
	let showCancelModal = $state(false)
	let isSaving = $state(false)
	let validationErrors: ValidationErrors = $state({})
	let newLangKey = $state("")
	let newLangNote = $state("")
	let lorebookList: Sockets.Lorebooks.List.Response["lorebookList"] = $state(
		[]
	)
	let formContainer: HTMLDivElement
	let validationTimeout: NodeJS.Timeout

	// Tags state
	let availableTags: Array<{
		id: number
		name: string
		colorPreset: string
	}> = $state([])
	let tagSearchQuery = $state("")
	let showTagDropdown = $state(false)
	let tagInputRef = $state<HTMLInputElement | null>(null)

	// Filtered tags based on search query
	let filteredTags = $derived.by(() => {
		if (!tagSearchQuery.trim())
			return availableTags.filter(
				(tag) =>
					!editCharacterData.tags.some(
						(selectedTag) =>
							selectedTag.toLowerCase() === tag.name.toLowerCase()
					)
			)
		return availableTags.filter(
			(tag) =>
				tag.name.toLowerCase().includes(tagSearchQuery.toLowerCase()) &&
				!editCharacterData.tags.some(
					(selectedTag) =>
						selectedTag.toLowerCase() === tag.name.toLowerCase()
				)
		)
	})

	// Helper function to get tag color preset
	function getTagColorPreset(tagName: string): string {
		const existingTag = availableTags.find((tag) => tag.name === tagName)
		return (
			existingTag?.colorPreset ||
			"bg-primary-500/20 text-primary-600 dark:text-primary-400"
		)
	}

	// Add tag function
	function addTag(tagName: string) {
		tagName = tagName.trim()
		if (!tagName) return

		// Check for case-insensitive duplicates
		const isDuplicate = editCharacterData.tags.some(
			(existingTag) => existingTag.toLowerCase() === tagName.toLowerCase()
		)
		if (isDuplicate) return

		editCharacterData.tags = [...editCharacterData.tags, tagName]
		tagSearchQuery = ""
		showTagDropdown = false
	}

	// Remove tag function
	function removeTag(tagName: string) {
		editCharacterData.tags = editCharacterData.tags.filter(
			(tag) => tag !== tagName
		)
	}

	// Handle tag input keydown
	function handleTagInputKeydown(event: KeyboardEvent) {
		if (event.key === "Enter") {
			event.preventDefault()
			if (tagSearchQuery.trim()) {
				addTag(tagSearchQuery)
			}
		} else if (event.key === "Escape") {
			showTagDropdown = false
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
		const result = characterSchema.safeParse(editCharacterData)

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

	function handleAvatarChange(e: Event) {
		const input = e.target as HTMLInputElement | null
		if (!input || !input.files || input.files.length === 0) return
		const file = (e.target as HTMLInputElement).files?.[0]
		if (!file) return
		// Only set preview, do not upload yet
		const previewReader = new FileReader()
		previewReader.onload = (ev2) => {
			editCharacterData._avatar = ev2.target?.result as string
		}
		previewReader.readAsDataURL(file)
		// Store file for later upload
		editCharacterData._avatarFile = file
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
			// Create new character
			handleCreate()
		} else if (mode === "edit" && character) {
			// Update existing character
			handleUpdate()
		}
	}

	function handleCreate() {
		const newCharacter = { ...editCharacterData }
		const avatarFile = newCharacter._avatarFile
		delete newCharacter._avatarFile
		isSaving = true
		socket.emit("characters:create", {
			character: newCharacter,
			// Socket.IO transparently marshals a browser File (a Blob
			// subclass) to a Node Buffer on the server; the wire shape
			// differs from the client-side value's compile-time type.
			avatarFile: avatarFile as unknown as Buffer | undefined
		})
	}

	function handleUpdate() {
		const updatedCharacter = { ...editCharacterData }
		if (!updatedCharacter.id) return
		const avatarFile = updatedCharacter._avatarFile
		delete updatedCharacter._avatarFile
		isSaving = true
		socket.emit("characters:update", {
			character: { ...updatedCharacter, id: updatedCharacter.id },
			// See handleCreate() above re: File → Buffer wire conversion.
			avatarFile: avatarFile as unknown as Buffer | undefined
		})
	}

	function handleCancelModalOnOpenChange(e: OpenChangeDetails) {
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

	async function onShowAllCharacterFieldsClick(event: { checked: boolean }) {
		socket?.emit("userSettings:updateShowAllCharacterFields", {
			enabled: event.checked
		})
	}

	// Helper for editing arrays
	function addToArray(arr: string[], value = "") {
		arr.push(value)
	}
	function removeFromArray(arr: string[], idx: number) {
		arr.splice(idx, 1)
	}
	// Helper for editing object
	function setObjectKey(
		obj: Record<string, string>,
		key: string,
		value: string
	) {
		obj[key] = value
	}
	function removeObjectKey(obj: Record<string, string>, key: string) {
		delete obj[key]
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
			editCharacterData.name ||
			Object.keys(validationErrors).length > 0
		) {
			validateFormDebounced()
		}
	})

	$effect(() => {
		hasChanges =
			JSON.stringify(editCharacterData) !==
			JSON.stringify(originalCharacterData)
	})

	// Notify parent when data changes (for auto-save in assistant)
	let lastNotifiedData = $state("")
	$effect(() => {
		// Skip initial run and only trigger on actual changes after initialization
		if (onDataChange && !disableDataChangeCallback && isInitialized) {
			const currentData = JSON.stringify(editCharacterData)

			// Skip if data hasn't actually changed
			if (currentData !== lastNotifiedData) {
				lastNotifiedData = currentData
				// Trigger callback with current data
				onDataChange(editCharacterData)
			}
		}
	})

	function handleCharactersCreate(res: any) {
		isSaving = false
		if (res.character) {
			validationErrors = {} // Clear any validation errors on success
			toaster.success({
				title: "Character Created",
				description: `Character "${res.character.name}" created successfully.`
			})
			// Reset original data to match current state before closing
			originalCharacterData = { ...editCharacterData }
			// Directly set hasChanges to false to prevent race condition
			hasChanges = false
			closeForm()
		}
	}

	function handleCharactersUpdate(res: any) {
		// characters:update is emitToUser — broadcast to every open tab for
		// this user, not just the requester. Without this check, a save in
		// another tab (for a different character) silently closes this
		// form and discards whatever is being edited here.
		if (res.character?.id !== characterId) return
		isSaving = false
		if (res.character) {
			validationErrors = {} // Clear any validation errors on success
			toaster.success({
				title: "Character Updated",
				description: `Character "${res.character.name}" updated successfully.`
			})
			// Reset original data to match current state before closing
			originalCharacterData = { ...editCharacterData }
			// Directly set hasChanges to false to prevent race condition
			hasChanges = false
			closeForm()
		}
	}

	function handleCharactersCreateError(msg: Sockets.ErrorResponse) {
		isSaving = false
		toaster.error({
			title: "Failed to create character",
			description: msg.error
		})
	}

	function handleCharactersUpdateError(msg: Sockets.ErrorResponse) {
		isSaving = false
		toaster.error({
			title: "Failed to update character",
			description: msg.error
		})
	}

	function handleCharactersGet(message: Sockets.Characters.Get.Response) {
		character = message.character
		if (!message.character) return
		const characterData = { ...message.character }

		// Handle migration from old string format to new array format
		if (typeof characterData.exampleDialogues === "string") {
			characterData.exampleDialogues = (
				characterData.exampleDialogues as string
			)
				.split("<START>")
				.map((d: string) => d.trim())
				.filter((d: string) => d !== "")
		} else if (!Array.isArray(characterData.exampleDialogues)) {
			characterData.exampleDialogues = []
		}

		editCharacterData = {
			...editCharacterData,
			id: characterData.id,
			name: characterData.name,
			nickname: characterData.nickname ?? "",
			aliases: Array.isArray(characterData.aliases)
				? characterData.aliases
				: [],
			summary: characterData.summary ?? "",
			avatar: characterData.avatar ?? "",
			description: characterData.description ?? "",
			personality: characterData.personality ?? "",
			scenario: characterData.scenario ?? "",
			firstMessage: characterData.firstMessage ?? "",
			alternateGreetings: Array.isArray(characterData.alternateGreetings)
				? characterData.alternateGreetings
				: [],
			exampleDialogues: characterData.exampleDialogues,
			creatorNotes: characterData.creatorNotes ?? "",
			creatorNotesMultilingual:
				characterData.creatorNotesMultilingual ?? {},
			groupOnlyGreetings: Array.isArray(characterData.groupOnlyGreetings)
				? characterData.groupOnlyGreetings
				: [],
			postHistoryInstructions: characterData.postHistoryInstructions ?? "",
			isFavorite: characterData.isFavorite ?? false,
			lorebookId: characterData.lorebookId ?? null,
			characterVersion: characterData.characterVersion ?? undefined,
			creator: characterData.creator ?? "",
			category: characterData.category ?? "",
			tags: characterData.tags ?? [],
			_avatar: "",
			_avatarFile: undefined
		}
		originalCharacterData = { ...editCharacterData }
	}

	function handleLorebooksList(message: Sockets.Lorebooks.List.Response) {
		lorebookList =
			message.lorebookList.sort((a, b) => (a.id ?? 0) - (b.id ?? 0)) || []
	}

	function handleTagsList(message: any) {
		availableTags = message.tagsList || []
	}

	function handleUpdateShowAllCharacterFields(message: any) {
		if (message.success) {
			toaster.success({
				title: `Character fields display ${message.enabled ? "expanded" : "simplified"}`
			})
		} else {
			toaster.error({
				title: "Failed to update character fields setting"
			})
		}
	}

	onMount(() => {
		onCancel = handleCancel

		// Add keyboard event listener
		document.addEventListener("keydown", handleKeydown)

		socket.on("characters:create", handleCharactersCreate)
		socket.on("characters:update", handleCharactersUpdate)
		socket.on("characters:create:error", handleCharactersCreateError)
		socket.on("characters:update:error", handleCharactersUpdateError)
		socket.on("lorebooks:list", handleLorebooksList)
		socket.on("tags:list", handleTagsList)
		socket.on(
			"userSettings:updateShowAllCharacterFields",
			handleUpdateShowAllCharacterFields
		)

		// Initialize with initialData if provided (for draft mode)
		if (initialData) {
			editCharacterData = {
				...editCharacterData,
				...initialData
			}
			originalCharacterData = { ...editCharacterData }
		} else if (characterId) {
			socket.once("characters:get", handleCharactersGet)
			socket.emit("characters:get", { id: characterId })
		}
		socket.emit("lorebooks:list", {})
		socket.emit("tags:list", {})

		// Mark as initialized after a short delay to allow initial data to settle
		setTimeout(() => {
			// Set the last notified data to current state before enabling
			if (onDataChange) {
				lastNotifiedData = JSON.stringify(editCharacterData)
			}
			isInitialized = true
		}, 100)
	})

	onDestroy(() => {
		socket.off("characters:create", handleCharactersCreate)
		socket.off("characters:update", handleCharactersUpdate)
		socket.off("characters:create:error", handleCharactersCreateError)
		socket.off("characters:update:error", handleCharactersUpdateError)
		socket.off("characters:get", handleCharactersGet)
		socket.off("lorebooks:list", handleLorebooksList)
		socket.off("tags:list", handleTagsList)
		socket.off(
			"userSettings:updateShowAllCharacterFields",
			handleUpdateShowAllCharacterFields
		)

		// Remove keyboard event listener and clear timeout
		document.removeEventListener("keydown", handleKeydown)
		clearTimeout(validationTimeout)
	})

	// Track the last initialData we processed to prevent infinite loops
	let lastProcessedInitialData = $state<string>("")

	// Watch for changes to initialData (for draft mode updates from server)
	$effect(() => {
		if (initialData && isInitialized && !disableDataChangeCallback) {
			const newDataStr = JSON.stringify(initialData)

			// Only update if initialData itself changed (not editCharacterData)
			if (newDataStr !== lastProcessedInitialData) {
				lastProcessedInitialData = newDataStr

				editCharacterData = {
					...editCharacterData,
					...initialData
				}

				// Update lastNotifiedData to prevent triggering onDataChange callback
				if (onDataChange) {
					lastNotifiedData = JSON.stringify(editCharacterData)
				}
			}
		}
	})
</script>

<div
	class="animate-fade-inmin-h-full"
	bind:this={formContainer}
	role="dialog"
	aria-labelledby="form-title"
	aria-modal="false"
>
	{#if !hideTitle || !hideActionButtons}
		<div
			class="mb-4 flex items-center gap-2"
			role="group"
			aria-label="Form actions"
		>
			{#if !hideActionButtons}
				<button
					type="button"
					class="btn btn-sm preset-filled-surface-400-600 shrink-0 p-2"
					onclick={handleCancel}
					title="Cancel"
					aria-label="Cancel and go back"
				>
					<Icons.ChevronLeft size={16} aria-hidden="true" />
				</button>
			{/if}
			{#if !hideTitle}
				<h1 class="flex-1 text-lg font-bold" id="form-title">
					{customTitle ||
						(mode === "edit"
							? `Edit: ${character?.nickname || character?.name || "Character"}`
							: "Create Character")}
				</h1>
			{:else}
				<span class="flex-1"></span>
			{/if}
			{#if !hideActionButtons}
				<button
					type="button"
					class="btn btn-sm shrink-0"
					class:preset-filled-success-500={hasChanges}
					class:preset-tonal-success={!hasChanges}
					onclick={onSave}
					disabled={isSaving}
					aria-describedby="form-title"
					aria-label={`${mode === "edit" ? "Update" : "Create"} character${hasChanges ? " (has unsaved changes)" : ""}`}
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
			{/if}
		</div>
	{/if}
	<div class="flex flex-col gap-4" role="form" aria-labelledby="form-title">
		{#if !hideAvatar}
			<fieldset
				class="flex items-center gap-4"
				aria-labelledby="avatar-section"
			>
				<legend id="avatar-section" class="sr-only">
					Avatar Settings
				</legend>
				<div aria-label="Current avatar preview">
					<Avatar
						src={editCharacterData._avatar ||
							editCharacterData.avatar}
						char={editCharacterData}
					/>
				</div>
				<div class="flex w-full flex-col gap-2">
					<div class="flex w-full items-center justify-center">
						<label
							for="dropzone-file"
							class="border-surface-300-700 bg-surface-50-950 hover:bg-surface-100-900 flex w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed"
							aria-describedby="avatar-help"
						>
							<div
								class="flex w-full flex-col items-center justify-center"
							>
								<svg
									class="text-surface-700-300 dark:text-surface-400 my-4 h-8 w-8"
									aria-hidden="true"
									xmlns="http://www.w3.org/2000/svg"
									fill="none"
									viewBox="0 0 20 16"
								>
									<path
										stroke="currentColor"
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M13 13h3a3 3 0 0 0 0-6h-.025A5.56 5.56 0 0 0 16 6.5 5.5 5.5 0 0 0 5.207 5.021C5.137 5.017 5.071 5 5 5a4 4 0 0 0 0 8h2.167M10 15V6m0 0L8 8m2-2 2 2"
									/>
								</svg>
							</div>
							<input
								id="dropzone-file"
								type="file"
								class="hidden"
								accept="image/*"
								onchange={handleAvatarChange}
								aria-describedby="avatar-help"
							/>
							<div id="avatar-help" class="sr-only">
								Upload an image file for the character avatar.
								Supported formats: JPG, PNG, GIF
							</div>
						</label>
					</div>
					<button
						type="button"
						class="btn btn-sm preset-tonal-error mt-1"
						onclick={() => {
							editCharacterData._avatarFile = undefined
							editCharacterData._avatar = ""
						}}
						disabled={!editCharacterData._avatarFile}
						aria-label="Clear selected avatar image"
					>
						Clear Selection
					</button>
				</div>
			</fieldset>
		{/if}
		<fieldset class="flex flex-col gap-1">
			<label class="flex gap-1 font-semibold" for="charName">
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
				id="charName"
				type="text"
				bind:value={editCharacterData.name}
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
		<fieldset class="flex flex-col gap-1">
			<label class="flex gap-1 font-semibold" for="charNickname">
				Nickname <span
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
				id="charNickname"
				type="text"
				bind:value={editCharacterData.nickname}
				class="input"
			/>
		</fieldset>
		<div class="flex flex-col gap-2">
			<button
				type="button"
				class="flex items-center gap-2 text-sm font-semibold"
				onclick={() => (expanded.aliases = !expanded.aliases)}
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
				<span class="ml-1">{expanded.aliases ? "▼" : "►"}</span>
			</button>
			{#if expanded.aliases}
				<div class="flex flex-col gap-1">
					{#each editCharacterData.aliases as _alias, idx (idx)}
						<div class="flex gap-2">
							<input
								type="text"
								bind:value={editCharacterData.aliases[idx]}
								class="input flex-1"
								placeholder="Alias..."
							/>
							<button
								class="btn btn-sm preset-tonal-error"
								type="button"
								onclick={() =>
									removeFromArray(
										editCharacterData.aliases,
										idx
									)}
							>
								<Icons.Minus class="h-4 w-4" />
							</button>
						</div>
					{/each}
					<button
						class="btn btn-sm preset-filled-primary-500 mt-1"
						type="button"
						onclick={() => addToArray(editCharacterData.aliases)}
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
				onclick={() => (expanded.summary = !expanded.summary)}
			>
				Summary
				<span class="ml-1">{expanded.summary ? "▼" : "►"}</span>
			</button>
			{#if expanded.summary}
				<div class="flex flex-col gap-1">
					<textarea
						bind:value={editCharacterData.summary}
						class="textarea min-h-16 text-sm"
						placeholder="One or two sentences describing who this character is…"
						maxlength="200"
					></textarea>
					<p class="text-surface-700-300 text-right text-xs">
						{editCharacterData.summary.length} / 200
					</p>
					<p class="text-surface-400 text-xs">
						Used as a concise graph node description. Not injected
						into chat context.
					</p>
				</div>
			{/if}
		</div>
		<fieldset class="flex flex-col gap-2">
			<button
				type="button"
				class="flex items-center gap-2 text-sm font-semibold"
				onclick={() => (expanded.description = !expanded.description)}
				aria-expanded={expanded.description}
				aria-controls="description-content"
				id="description-toggle"
			>
				<span class="flex gap-1">
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
				</span>
				<span class="ml-1" aria-hidden="true">
					{expanded.description ? "▼" : "►"}
				</span>
			</button>
			{#if expanded.description}
				<div
					id="description-content"
					role="region"
					aria-labelledby="description-toggle"
				>
					<textarea
						rows="8"
						bind:value={editCharacterData.description}
						class="input {validationErrors.description
							? 'border-error-500 focus:border-error-500'
							: ''}"
						placeholder="Description..."
						aria-label="Character description"
						aria-required="true"
						aria-invalid={validationErrors.description
							? "true"
							: "false"}
						aria-describedby={validationErrors.description
							? "description-error"
							: undefined}
						oninput={() => {
							// Clear validation error when user starts typing
							if (validationErrors.description) {
								const { description, ...rest } =
									validationErrors
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
				</div>
			{/if}
		</fieldset>
		<fieldset class="flex flex-col gap-2">
			<button
				type="button"
				class="flex items-center gap-2 text-sm font-semibold"
				onclick={() => (expanded.personality = !expanded.personality)}
				aria-expanded={expanded.personality}
				aria-controls="personality-content"
				id="personality-toggle"
			>
				<span class="flex gap-1">
					Personality <span
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
				<span class="ml-1" aria-hidden="true">
					{expanded.personality ? "▼" : "►"}
				</span>
			</button>
			{#if expanded.personality}
				<div
					id="personality-content"
					role="region"
					aria-labelledby="personality-toggle"
				>
					<textarea
						rows="8"
						bind:value={editCharacterData.personality}
						class="input"
						placeholder="Personality..."
						aria-label="Character personality"
					></textarea>
				</div>
			{/if}
		</fieldset>
		{#if userSettingsCtx.settings?.showAllCharacterFields}
			<div class="flex flex-col gap-2">
				<button
					type="button"
					class="flex items-center gap-2 text-sm font-semibold"
					onclick={() => (expanded.scenario = !expanded.scenario)}
				>
					<span class="flex gap-1">
						Scenario <span
							class="flex items-center opacity-50 transition-opacity duration-200 hover:opacity-100"
							title="This field will be visible in prompts (excluded from group chats)"
						>
							<Icons.ScanEye
								size={16}
								class="relative top-[1px] inline"
							/>
						</span>
					</span>
					<span class="ml-1">{expanded.scenario ? "▼" : "►"}</span>
				</button>
				{#if expanded.scenario}
					<textarea
						rows="8"
						bind:value={editCharacterData.scenario}
						class="input"
						placeholder="Scenario..."
					></textarea>
				{/if}
			</div>
		{/if}
		<div class="flex flex-col gap-2">
			<button
				type="button"
				class="flex items-center gap-2 text-sm font-semibold"
				onclick={() => (expanded.firstMessage = !expanded.firstMessage)}
			>
				<span>Greeting (First Message)</span>
				<span class="ml-1">{expanded.firstMessage ? "▼" : "►"}</span>
			</button>
			{#if expanded.firstMessage}
				<textarea
					rows="8"
					bind:value={editCharacterData.firstMessage}
					class="input"
					placeholder="First message..."
				></textarea>
			{/if}
		</div>
		{#if userSettingsCtx.settings?.showAllCharacterFields}
			<div class="flex flex-col gap-2">
				<button
					type="button"
					class="flex items-center gap-2 text-sm font-semibold"
					onclick={() =>
						(expanded.alternateGreetings =
							!expanded.alternateGreetings)}
				>
					<span>Alternate Greetings</span>
					<span class="ml-1">
						{expanded.alternateGreetings ? "▼" : "►"}
					</span>
				</button>
				{#if expanded.alternateGreetings}
					<div class="flex flex-col gap-1">
						{#each editCharacterData.alternateGreetings as greeting, idx (idx)}
							<div class="flex flex-col items-center gap-2">
								<div class="w-full">
									<textarea
										rows="2"
										bind:value={
											editCharacterData
												.alternateGreetings[idx]
										}
										class="input input-xs bg-background border-muted w-full resize-y rounded border"
										placeholder="Greeting..."
									></textarea>
								</div>
								<button
									class="btn btn-sm preset-tonal-error w-full"
									type="button"
									onclick={() =>
										removeFromArray(
											editCharacterData.alternateGreetings,
											idx
										)}
								>
									<Icons.Minus class="h-4 w-4" /> Delete
								</button>
							</div>
						{/each}
						<button
							class="btn btn-sm preset-filled-primary-500 mt-1"
							type="button"
							onclick={() =>
								addToArray(
									editCharacterData.alternateGreetings
								)}
						>
							<Icons.Plus class="h-4 w-4" />
							Add Greeting
						</button>
					</div>
				{/if}
			</div>
			<fieldset class="flex flex-col gap-2">
				<button
					type="button"
					class="flex items-center gap-2 text-sm font-semibold"
					onclick={() =>
						(expanded.exampleDialogues =
							!expanded.exampleDialogues)}
					aria-expanded={expanded.exampleDialogues}
					aria-controls="example-dialogues-content"
					id="example-dialogues-toggle"
				>
					<span class="flex gap-1">
						Example Dialogues <span
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
					<span class="ml-1" aria-hidden="true">
						{expanded.exampleDialogues ? "▼" : "►"}
					</span>
				</button>
				{#if expanded.exampleDialogues}
					<div
						id="example-dialogues-content"
						role="region"
						aria-labelledby="example-dialogues-toggle"
					>
						<div
							class="flex flex-col gap-1"
							role="list"
							aria-label="Example dialogues"
						>
							{#each editCharacterData.exampleDialogues as dialogue, idx (idx)}
								<div
									class="flex flex-col items-center gap-2"
									role="listitem"
								>
									<div class="w-full">
										<textarea
											rows="4"
											bind:value={
												editCharacterData
													.exampleDialogues[idx]
											}
											class="input resize-y"
											placeholder="Example dialogue..."
											aria-label={`Example dialogue ${idx + 1}`}
										></textarea>
									</div>
									<button
										class="btn btn-sm preset-tonal-error w-full"
										type="button"
										onclick={() =>
											removeFromArray(
												editCharacterData.exampleDialogues,
												idx
											)}
										aria-label={`Delete example dialogue ${idx + 1}`}
									>
										<Icons.Minus
											class="h-4 w-4"
											aria-hidden="true"
										/> Delete
									</button>
								</div>
							{/each}
							<button
								class="btn btn-sm preset-filled-primary-500 mt-1"
								type="button"
								onclick={() =>
									addToArray(
										editCharacterData.exampleDialogues
									)}
								aria-label="Add new example dialogue"
							>
								<Icons.Plus
									class="h-4 w-4"
									aria-hidden="true"
								/>
								Add Example Dialogue
							</button>
						</div>
					</div>
				{/if}
			</fieldset>
		{/if}
		{#if userSettingsCtx.settings?.showAllCharacterFields}
			<div class="flex flex-col gap-2">
				<button
					type="button"
					class="flex items-center gap-2 text-sm font-semibold"
					onclick={() =>
						(expanded.creatorNotes = !expanded.creatorNotes)}
				>
					<span>Creator Notes</span>
					<span class="ml-1">
						{expanded.creatorNotes ? "▼" : "►"}
					</span>
				</button>
				{#if expanded.creatorNotes}
					<textarea
						rows="4"
						bind:value={editCharacterData.creatorNotes}
						class="input"
						placeholder="Notes from the character creator..."
					></textarea>
				{/if}
			</div>
		{/if}
		{#if userSettingsCtx.settings?.showAllCharacterFields}
			<div class="flex flex-col gap-2">
				<button
					type="button"
					class="flex items-center gap-2 text-sm font-semibold"
					onclick={() =>
						(expanded.creatorNotesMultilingual =
							!expanded.creatorNotesMultilingual)}
				>
					<span>Creator Notes (Multilingual)</span>
					<span class="ml-1">
						{expanded.creatorNotesMultilingual ? "▼" : "►"}
					</span>
				</button>
				{#if expanded.creatorNotesMultilingual}
					<div class="flex flex-col gap-1">
						{#each Object.entries(editCharacterData.creatorNotesMultilingual) as [lang, note], idx (lang)}
							<div class="flex items-center gap-2">
								<input
									type="text"
									value={lang}
									class="input input-xs bg-background border-muted w-16 rounded border"
									readonly
								/>
								<input
									type="text"
									bind:value={
										editCharacterData
											.creatorNotesMultilingual[lang]
									}
									class="input input-xs bg-background border-muted flex-1 rounded border"
									placeholder="Note..."
								/>
								<button
									class="btn btn-sm preset-filled-success-500"
									type="button"
									onclick={() =>
										removeObjectKey(
											editCharacterData.creatorNotesMultilingual,
											lang
										)}
								>
									-
								</button>
							</div>
						{/each}
						<div class="mt-1 flex gap-2">
							<input
								type="text"
								class="input input-xs bg-background border-muted w-16 rounded border"
								bind:value={newLangKey}
								placeholder="Lang"
							/>
							<input
								type="text"
								class="input input-xs bg-background border-muted flex-1 rounded border"
								bind:value={newLangNote}
								placeholder="Note..."
							/>
							<button
								class="btn btn-sm preset-filled-success-500"
								type="button"
								onclick={() => {
									if (newLangKey) {
										setObjectKey(
											editCharacterData.creatorNotesMultilingual,
											newLangKey,
											newLangNote
										)
										newLangKey = ""
										newLangNote = ""
									}
								}}
							>
								<Icons.Plus class="h-4 w-4" />
							</button>
						</div>
					</div>
				{/if}
			</div>
		{/if}
		{#if userSettingsCtx.settings?.showAllCharacterFields}
			<div class="flex flex-col gap-2">
				<button
					type="button"
					class="flex items-center gap-2 text-sm font-semibold"
					onclick={() =>
						(expanded.groupOnlyGreetings =
							!expanded.groupOnlyGreetings)}
				>
					<span>Group-Only Greetings</span>
					<span class="ml-1">
						{expanded.groupOnlyGreetings ? "▼" : "►"}
					</span>
				</button>
				{#if expanded.groupOnlyGreetings}
					<div class="flex flex-col gap-1">
						{#each editCharacterData.groupOnlyGreetings as greeting, idx (idx)}
							<div class="flex flex-col items-center gap-2">
								<div class="w-full">
									<textarea
										rows="2"
										bind:value={
											editCharacterData
												.groupOnlyGreetings[idx]
										}
										class="textarea w-full resize-y rounded border"
										placeholder="Group greeting..."
									></textarea>
								</div>
								<button
									class="btn btn-sm preset-tonal-error w-full"
									type="button"
									onclick={() =>
										removeFromArray(
											editCharacterData.groupOnlyGreetings,
											idx
										)}
								>
									<Icons.Minus class="h-4 w-4" /> Delete
								</button>
							</div>
						{/each}
						<button
							class="btn btn-sm preset-filled-primary-500 mt-1"
							type="button"
							onclick={() =>
								addToArray(
									editCharacterData.groupOnlyGreetings
								)}
						>
							<Icons.Plus class="h-4 w-4" />
							Add Group Greeting
						</button>
					</div>
				{/if}
			</div>
		{/if}
		{#if userSettingsCtx.settings?.showAllCharacterFields}
			<div class="flex flex-col gap-2">
				<button
					type="button"
					class="flex items-center gap-2 text-sm font-semibold"
					onclick={() =>
						(expanded.postHistoryInstructions =
							!expanded.postHistoryInstructions)}
				>
					<span class="flex gap-1">
						Post-History Instructions <span
							class="flex items-center opacity-50 transition-opacity duration-200 hover:opacity-100"
							title="This field will be visible in prompts"
						>
							<Icons.ScanEye
								size={16}
								class="relative top-[1px] inline"
							/>
						</span>
					</span>
					<span class="ml-1">
						{expanded.postHistoryInstructions ? "▼" : "►"}
					</span>
				</button>
				{#if expanded.postHistoryInstructions}
					<textarea
						rows="4"
						bind:value={editCharacterData.postHistoryInstructions}
						class="input"
						placeholder="Instructions for post-history processing..."
					></textarea>
				{/if}
			</div>
		{/if}
		{#if userSettingsCtx.settings?.showAllCharacterFields}
			<div class="flex flex-col gap-1">
				<label class="font-semibold" for="charVersion">
					Character Version
				</label>
				<input
					id="charVersion"
					type="text"
					bind:value={editCharacterData.characterVersion}
					class="input"
					placeholder="1.0"
				/>
			</div>
			<div class="flex flex-col gap-1">
				<label class="font-semibold" for="charCreator">Creator</label>
				<input
					id="charCreator"
					type="text"
					bind:value={editCharacterData.creator}
					class="input"
					placeholder="Who made this character?"
				/>
			</div>
			<div class="flex flex-col gap-1">
				<label class="font-semibold" for="charCategory">Category</label>
				<input
					id="charCategory"
					type="text"
					bind:value={editCharacterData.category}
					class="input"
					placeholder="e.g. Fantasy, Sci-Fi, Slice of Life"
				/>
			</div>
		{/if}
		<!-- <div class="flex flex-col gap-2">
			<label class="font-semibold" for="lorebookSelect">Lorebook</label>
			<select
				id="lorebookSelect"
				class="select"
				bind:value={editCharacterData.lorebookId}
			>
				<option value={null}>None</option>
				{#each lorebookList as lb}
					<option value={lb.id}>{`#${lb.id} - ${lb.name}`}</option>
				{/each}
			</select>
		</div> -->
		{#if !hideTags}
			<fieldset class="mb-4 flex flex-col gap-1">
				<label class="font-semibold" for="charTags">Tags</label>
				<div class="relative">
					<input
						id="charTags"
						type="text"
						bind:value={tagSearchQuery}
						bind:this={tagInputRef}
						class="input"
						placeholder="Search or add tags..."
						onfocus={() => (showTagDropdown = true)}
						onblur={(e) => {
							// Delay hiding dropdown to allow clicking on dropdown items
							setTimeout(() => {
								if (
									!(
										e.relatedTarget instanceof Element &&
										e.relatedTarget.closest(".tag-dropdown")
									)
								) {
									showTagDropdown = false
								}
							}, 150)
						}}
						onkeydown={handleTagInputKeydown}
					/>

					{#if showTagDropdown && (filteredTags.length > 0 || tagSearchQuery.trim())}
						<div
							class="tag-dropdown bg-surface-100-900 border-surface-300-700 absolute top-full right-0 left-0 z-10 max-h-48 overflow-y-auto rounded-lg border shadow-lg"
						>
							{#if tagSearchQuery.trim() && !filteredTags.some((tag) => tag.name.toLowerCase() === tagSearchQuery.toLowerCase())}
								<button
									type="button"
									class="hover:bg-surface-200-800 border-surface-300-700 w-full border-b px-3 py-2 text-left"
									onclick={() => addTag(tagSearchQuery)}
								>
									<Icons.Plus size={16} class="mr-2 inline" />
									Create "{tagSearchQuery}"
								</button>
							{/if}
							{#each filteredTags as tag}
								{#if !editCharacterData.tags.includes(tag.name)}
									<button
										type="button"
										class="hover:bg-surface-200-800 w-full px-3 py-2 text-left"
										onclick={() => addTag(tag.name)}
									>
										{tag.name}
									</button>
								{/if}
							{/each}
						</div>
					{/if}
				</div>

				<!-- Selected tags display -->
				{#if editCharacterData.tags.length > 0}
					<div class="mt-2 flex flex-wrap gap-1">
						{#each editCharacterData.tags as tag}
							<span
								class="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs {getTagColorPreset(
									tag
								)}"
							>
								{tag}
								<button
									type="button"
									class="rounded-full p-0.5 hover:opacity-70"
									onclick={() => removeTag(tag)}
									aria-label="Remove tag {tag}"
								>
									<Icons.X size={12} />
								</button>
							</span>
						{/each}
					</div>
				{/if}
			</fieldset>
		{/if}
		{#if !hideFavorite}
			<fieldset class="mt-2 flex items-center gap-2">
				<Switch
					name="favorite"
					checked={editCharacterData.isFavorite}
					onCheckedChange={(e) =>
						(editCharacterData.isFavorite = e.checked)}
					aria-describedby="favorite-description"
				>
					<Switch.Control
						class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
					>
						<Switch.Thumb />
					</Switch.Control>
					<Switch.HiddenInput />
					<Switch.Label class="font-semibold">Favorite</Switch.Label>
				</Switch>
				<span id="favorite-description" class="sr-only">
					Mark this character as a favorite for easier access
				</span>
			</fieldset>
		{/if}
		<fieldset class="mt-2 flex items-center gap-2">
			<Switch
				name="show-all-character-fields"
				checked={userSettingsCtx.settings?.showAllCharacterFields ??
					false}
				onCheckedChange={onShowAllCharacterFieldsClick}
				aria-describedby="show-all-fields-description"
			>
				<Switch.Control
					class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
				>
					<Switch.Thumb />
				</Switch.Control>
				<Switch.HiddenInput />
				<Switch.Label class="font-semibold">
					Show All Fields
				</Switch.Label>
			</Switch>
			<span id="show-all-fields-description" class="sr-only">
				Show all character fields including advanced options
			</span>
		</fieldset>
	</div>
</div>

<CharacterUnsavedChangesModal
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
