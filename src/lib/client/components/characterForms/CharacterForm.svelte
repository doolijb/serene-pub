<script lang="ts">
	import { avatarSrc } from "$lib/client/utils/media"
	import { Switch, Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import RowMenu from "$lib/client/components/menus/RowMenu.svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import {
		declareInterest,
		useInterest
	} from "$lib/client/sockets/interest.svelte"
	import { interestKey } from "$lib/shared/sockets/interest"
	import { onMount, onDestroy, getContext, type Component } from "svelte"
	import { z } from "zod"
	import CharacterUnsavedChangesModal from "../modals/CharacterUnsavedChangesModal.svelte"
	import AvatarCropEditor from "../media/AvatarCropEditor.svelte"
	import PanelTabStrip from "$lib/client/components/panels/PanelTabStrip.svelte"
	import {
		avatarFrameCommit,
		type PendingAvatarFrame
	} from "../media/avatarFrameCommit"
	import type { MediaFrame } from "$lib/shared/media/frame"
	import { toaster } from "$lib/client/utils/toaster"
	import { stableStringify } from "$lib/shared/utils/connectionDefaults"

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
		/** "A character you play" — `characters.is_persona`. */
		isPersona: boolean
		/** The persona a new session starts with. At most one per user. */
		isDefaultPersona: boolean
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
		isPersona: z.boolean().optional(),
		isDefaultPersona: z.boolean().optional(),
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
		/**
		 * Whether the header shows its back chevron. Pass `false` where the
		 * list this form was opened from is already on screen beside it (a
		 * two-pane desk layout), where a "back" that goes nowhere visible is
		 * only a button to explain. The chevron runs the same cancel path as
		 * Escape, so the unsaved-changes gate holds either way.
		 */
		showBack?: boolean
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
		showBack = true
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
		isPersona: false,
		isDefaultPersona: false,
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
		isPersona: false,
		isDefaultPersona: false,
		characterVersion: "",
		creator: "",
		category: "",
		_avatarFile: undefined,
		_avatar: "",
		lorebookId: null,
		tags: []
	})
	/**
	 * The three groups this form's fields belong to. A field is always open
	 * inside its group: folding one away hides whether it is filled, which is
	 * the question a character sheet answers at a glance.
	 */
	type FormTab = "profile" | "voice" | "notes"
	const FORM_TABS: Array<{
		value: FormTab
		label: string
		icon: Component<any>
	}> = [
		{ value: "profile", label: "Profile", icon: Icons.UserRound },
		{ value: "voice", label: "Voice", icon: Icons.MessageSquareQuote },
		{ value: "notes", label: "Notes", icon: Icons.NotebookPen }
	]
	let activeFormTab: FormTab = $state("profile")

	/**
	 * Which group each validated field sits in, so a group can mark itself when
	 * something inside it fails while another group is on show. Name is the
	 * exception: it is in the hero above the tabs and shows its error there.
	 */
	const TAB_FIELDS: Record<FormTab, string[]> = {
		profile: [
			"summary",
			"description",
			"aliases",
			"tags",
			"isFavorite",
			"isPersona",
			"isDefaultPersona",
			"characterVersion",
			"creator",
			"category"
		],
		voice: [
			"personality",
			"firstMessage",
			"scenario",
			"alternateGreetings",
			"exampleDialogues",
			"groupOnlyGreetings",
			"postHistoryInstructions"
		],
		notes: ["creatorNotes", "creatorNotesMultilingual"]
	}

	function tabHasError(tab: FormTab): boolean {
		return TAB_FIELDS[tab].some((field) => !!validationErrors[field])
	}

	/** The strip's tabs, each carrying whether its group currently fails. */
	let formTabs = $derived(
		FORM_TABS.map((tab) => ({ ...tab, hasError: tabHasError(tab.value) }))
	)

	/**
	 * The one input/textarea chrome this form uses: Skeleton's field preset —
	 * theme-aware background and a focus ring that is already primary — with
	 * this view's corner radius.
	 */
	const FIELD_CLASS = "input rounded-[10px]"

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

	/**
	 * The crop editor's answer, held until the save comes back with a media id
	 * to attach it to — the avatar is uploaded with the character, so the file
	 * does not exist before then. Null means "upload it as it is".
	 */
	let pendingFrame = $state<PendingAvatarFrame | null>(null)
	let cropOpen = $state(false)
	/** What the editor is measuring: an object URL for a chosen file, or the
	 *  stored original. Object URLs are revoked when they are replaced. */
	let cropSrc = $state("")
	let cropObjectUrl: string | null = null
	/** Null while cropping a file that has not been uploaded; the stored frame
	 *  when adjusting an avatar that already exists. */
	let cropFrame = $state<MediaFrame | null>(null)

	function releaseCropUrl() {
		if (cropObjectUrl) URL.revokeObjectURL(cropObjectUrl)
		cropObjectUrl = null
	}

	function handleAvatarChange(details: FileAcceptDetails) {
		const file = details.files?.[0]
		if (!file) return
		// Only set preview, do not upload yet
		const previewReader = new FileReader()
		previewReader.onload = (ev2) => {
			editCharacterData._avatar = ev2.target?.result as string
		}
		previewReader.readAsDataURL(file)
		// Store file for later upload
		editCharacterData._avatarFile = file

		// The editor measures the file itself, so the frame is in the pixels
		// the server will store.
		releaseCropUrl()
		cropObjectUrl = URL.createObjectURL(file)
		cropSrc = cropObjectUrl
		cropFrame = null
		pendingFrame = null
		cropOpen = true
	}

	/** Re-crop an avatar that already exists: the file has an id, so the frame
	 *  is sent now rather than held for the save. */
	function adjustCrop() {
		const media = character?.avatarMedia
		if (!media) return
		releaseCropUrl()
		cropSrc = `/media/${media.uuid}?v=original&r=${media.rev}`
		cropFrame = media.frame ?? null
		cropOpen = true
	}

	function onCropSaved(frame: MediaFrame | null) {
		if (editCharacterData._avatarFile) {
			pendingFrame = { frame }
			// Held so reopening the editor before the save shows the crop that
			// was just chosen rather than starting over at the default.
			cropFrame = frame
			return
		}
		const mediaId = character?.avatarMediaId
		if (!mediaId) return
		socket.emit("media:setFrame", { mediaId, frame })
		if (character?.avatarMedia) character.avatarMedia.frame = frame
		toaster.success({ title: "Crop updated" })
	}

	/** The crop the save just earned the right to store. */
	function commitPendingFrame(avatarMediaId: number | null | undefined) {
		const commit = avatarFrameCommit(pendingFrame, avatarMediaId)
		pendingFrame = null
		if (commit) socket.emit("media:setFrame", commit)
	}

	/**
	 * The hero avatar IS the upload control: it takes a click and it takes a
	 * drop, and both land in `handleAvatarChange` — the one place a chosen file
	 * becomes a preview, a crop source and a pending upload.
	 */
	let avatarInputRef = $state<HTMLInputElement | null>(null)
	let avatarMenuOpen = $state(false)
	let isAvatarDragOver = $state(false)

	function openAvatarPicker() {
		avatarInputRef?.click()
	}

	function handleAvatarInputChange(e: Event) {
		const input = e.currentTarget as HTMLInputElement
		const file = input.files?.[0]
		if (file) handleAvatarChange({ files: [file] } as FileAcceptDetails)
		// Cleared so choosing the same file twice in a row fires `change` again.
		input.value = ""
	}

	function handleAvatarDragOver(e: DragEvent) {
		// A drop only happens where the default is prevented, so this is what
		// makes the avatar a target rather than a page the browser navigates.
		e.preventDefault()
		if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"
		isAvatarDragOver = true
	}

	function handleAvatarDragLeave(e: DragEvent) {
		const next = e.relatedTarget
		if (
			next instanceof Node &&
			(e.currentTarget as HTMLElement).contains(next)
		)
			return
		isAvatarDragOver = false
	}

	function handleAvatarDrop(e: DragEvent) {
		e.preventDefault()
		isAvatarDragOver = false
		const file = e.dataTransfer?.files?.[0]
		if (file) handleAvatarChange({ files: [file] } as FileAcceptDetails)
	}

	/** The crop editor, on whichever source there is: a chosen file that has
	 *  not been uploaded, or the stored original. */
	function openCropEditor() {
		if (editCharacterData._avatarFile) cropOpen = true
		else adjustCrop()
	}

	/** Drops the picked file and its preview, back to the stored avatar. */
	function clearAvatarSelection() {
		editCharacterData._avatarFile = undefined
		editCharacterData._avatar = ""
		pendingFrame = null
		releaseCropUrl()
		// The editor is mounted whether or not it is open, so a revoked url
		// left here is one it would try to load.
		cropSrc = ""
	}

	/** The header's title: who is being edited, or that nobody is yet. */
	let formTitle = $derived.by(
		() =>
			customTitle ||
			(mode === "edit"
				? character?.nickname || character?.name || "Character"
				: "New character")
	)

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
			stableStringify(editCharacterData) !==
			stableStringify(originalCharacterData)
	})

	function handleCharactersCreate(res: any) {
		// characters:create is emitToUser, so another tab's create arrives here
		// too. Only the form that is mid-save may attach its pending crop —
		// otherwise this character's crop would land on that one's avatar.
		const mine = isSaving
		isSaving = false
		if (res.character) {
			if (mine) commitPendingFrame(res.character.avatarMediaId)
			validationErrors = {} // Clear any validation errors on success
			toaster.success({
				title: "Character created",
				description: `Character "${res.character.name}" created successfully.`
			})
			// Reset original data to match current state before closing
			originalCharacterData = $state.snapshot(editCharacterData)
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
			commitPendingFrame(res.character.avatarMediaId)
			validationErrors = {} // Clear any validation errors on success
			toaster.success({
				title: "Character updated",
				description: `Character "${res.character.name}" updated successfully.`
			})
			// Reset original data to match current state before closing
			originalCharacterData = $state.snapshot(editCharacterData)
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
			avatar: avatarSrc(characterData) ?? "",
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
			postHistoryInstructions:
				characterData.postHistoryInstructions ?? "",
			isFavorite: characterData.isFavorite ?? false,
			isPersona: characterData.isPersona ?? false,
			isDefaultPersona: characterData.isDefaultPersona ?? false,
			lorebookId: characterData.lorebookId ?? null,
			characterVersion: characterData.characterVersion ?? undefined,
			creator: characterData.creator ?? "",
			category: characterData.category ?? "",
			tags: characterData.tags ?? [],
			_avatar: "",
			_avatarFile: undefined
		}
		originalCharacterData = $state.snapshot(editCharacterData)
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

	/**
	 * The write replies this form reads, on the interest registry. All BARE:
	 * `characters:create` has no id to key on yet, and `characters:update` is
	 * an `emitToUser` push whose own handler already filters by `characterId`
	 * — the same reason it keeps that check. The two `:error` keys stop the
	 * save button spinning; `tags:list` is a cascade target, so it is standing
	 * rather than one-shot.
	 */
	useInterest<"characters:create">(
		"characters:create",
		handleCharactersCreate
	)
	useInterest<"characters:update">(
		"characters:update",
		handleCharactersUpdate
	)
	useInterest<"characters:create:error">(
		"characters:create:error",
		handleCharactersCreateError
	)
	useInterest<"characters:update:error">(
		"characters:update:error",
		handleCharactersUpdateError
	)
	useInterest<"tags:list">("tags:list", handleTagsList)

	/**
	 * The lorebook picker's list — BARE, and standing rather than one-shot:
	 * `lorebooks:list` has no entry in `SCOPED_EVENTS` (it is this user's whole
	 * list, with nothing to key it to) and the server re-emits it as a cascade
	 * after a lorebook write, which is how a book created elsewhere appears in
	 * this picker without a reload.
	 */
	useInterest<"lorebooks:list">("lorebooks:list", handleLorebooksList)

	/**
	 * The "show every field" toggle's confirmation — BARE and standing. The
	 * setting is per user with nothing to scope on, and the reply is what
	 * actually flips the sections open, so the key has to outlive each press.
	 */
	useInterest<"userSettings:updateShowAllCharacterFields">(
		"userSettings:updateShowAllCharacterFields",
		handleUpdateShowAllCharacterFields
	)

	/**
	 * Edit mode only: this character's row, as a SCOPED interest
	 * (`characters:get#<id>`; the payload carries the id on `character.id`,
	 * see `SCOPED_EVENTS`), declared and asked for in one effect so a form
	 * re-pointed at another character releases the old key as it takes the
	 * new one.
	 *
	 * A form handed its fields outright (`initialData`, from the creator
	 * modal) never asks the server for them, which is what the first guard
	 * says.
	 *
	 * Released on the first reply — this replaces a `socket.once`, and the
	 * one-shot is deliberate: `characters:get` is re-sent after a write
	 * elsewhere, and a standing key here would refill the fields under
	 * whatever is being typed.
	 */
	$effect(() => {
		if (initialData || !characterId) return
		const id = characterId
		let release: (() => void) | undefined
		release = declareInterest<"characters:get">(
			interestKey("characters:get", id),
			(msg: Sockets.Characters.Get.Response) => {
				handleCharactersGet(msg)
				release?.()
			}
		)
		socket.emit("characters:get", { id })
		// Idempotent, so releasing an already-released key is a no-op.
		return () => release?.()
	})

	onMount(() => {
		onCancel = handleCancel

		// Add keyboard event listener
		document.addEventListener("keydown", handleKeydown)

		// Initialize with initialData if provided
		if (initialData) {
			editCharacterData = {
				...editCharacterData,
				...initialData
			}
			originalCharacterData = $state.snapshot(editCharacterData)
		}
		socket.emit("lorebooks:list", {})
		socket.emit("tags:list", {})

		// Mark as initialized after a short delay to allow initial data to settle
		setTimeout(() => {
			isInitialized = true
		}, 100)
	})

	onDestroy(() => {
		// The `characters:*`, `tags:list`, `lorebooks:list` and
		// `userSettings:*` listeners are not here: the interest registry
		// releases this form's subscribers as its effects are destroyed.

		// Remove keyboard event listener and clear timeout
		document.removeEventListener("keydown", handleKeydown)
		clearTimeout(validationTimeout)
		releaseCropUrl()
	})

	// Track the last initialData we processed to prevent infinite loops
	let lastProcessedInitialData = $state<string>("")

	// Watch for changes to initialData
	$effect(() => {
		if (initialData && isInitialized) {
			const newDataStr = JSON.stringify(initialData)

			// Only update if initialData itself changed (not editCharacterData)
			if (newDataStr !== lastProcessedInitialData) {
				lastProcessedInitialData = newDataStr

				editCharacterData = {
					...editCharacterData,
					...initialData
				}
			}
		}
	})
</script>

<!-- The prompt-visibility badge, beside the label of every field whose text
     reaches the model. -->
{#snippet promptBadge(hint: string)}
	<span
		class="flex items-center opacity-50 transition-opacity duration-200 hover:opacity-100"
		title={hint}
		aria-label={hint}
	>
		<Icons.ScanEye
			size={14}
			class="relative top-[1px] inline"
			aria-hidden="true"
		/>
	</span>
{/snippet}

<!-- The delete on one row of an array editor: an icon at the row's top-right,
     so a list of textareas stays a list rather than alternating field, button,
     field, button. -->
{#snippet removeRowButton(label: string, onRemove: () => void)}
	<button
		type="button"
		class="text-surface-600-400 hover:bg-surface-200-800 hover:text-error-500 grid size-8 shrink-0 place-items-center rounded-lg"
		onclick={onRemove}
		aria-label={label}
		title={label}
	>
		<Icons.X size={14} aria-hidden="true" />
	</button>
{/snippet}

{#snippet addRowButton(label: string, onAdd: () => void)}
	<button
		type="button"
		class="text-surface-600-400 hover:text-foreground self-start text-xs"
		onclick={onAdd}
	>
		+ {label}
	</button>
{/snippet}

<div
	class="animate-fade-in min-h-full max-w-[760px]"
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
			{#if !hideActionButtons && showBack}
				<button
					type="button"
					class="btn btn-sm preset-filled-surface-400-600 shrink-0 p-2"
					onclick={handleCancel}
					title="Back to list"
					aria-label="Back to list"
				>
					<Icons.ChevronLeft size={16} aria-hidden="true" />
				</button>
			{/if}
			{#if !hideTitle}
				<h1
					class="min-w-0 flex-1 truncate text-lg font-semibold"
					id="form-title"
				>
					{formTitle}
				</h1>
			{:else}
				<span class="flex-1"></span>
			{/if}
			{#if !hideActionButtons}
				{#if hasChanges}
					<span class="text-surface-600-400 shrink-0 text-xs">
						Unsaved changes
					</span>
				{/if}
				<!-- Filled primary only while there is something to save: a
				     permanently lit call to action stops being one. -->
				<button
					type="button"
					class="btn btn-sm shrink-0"
					class:preset-filled-primary-500={hasChanges}
					class:preset-tonal-surface={!hasChanges}
					onclick={onSave}
					disabled={isSaving}
					aria-describedby="form-title"
					aria-label={`Save character${hasChanges ? " (has unsaved changes)" : ""}`}
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
					Save
				</button>
			{/if}
		</div>
	{/if}
	<div class="flex flex-col gap-4" role="form" aria-labelledby="form-title">
		{#if !hideAvatar}
			<!-- The avatar IS the upload control: it takes a click, it takes a
			     drop, and the camera badge says so. Anything the picture itself
			     cannot carry — re-cropping, clearing a pick — is in the menu
			     under it. -->
			<fieldset
				class="flex items-start gap-4"
				aria-labelledby="avatar-section"
			>
				<legend id="avatar-section" class="sr-only">
					Avatar settings
				</legend>
				<div class="flex flex-col items-center gap-1.5">
					<button
						type="button"
						class="border-surface-200-800 relative h-[88px] w-[88px] shrink-0 overflow-hidden rounded-[14px] border {isAvatarDragOver
							? 'ring-primary-500 ring-2'
							: ''}"
						onclick={openAvatarPicker}
						ondragover={handleAvatarDragOver}
						ondragleave={handleAvatarDragLeave}
						ondrop={handleAvatarDrop}
						title="Choose an avatar image"
						aria-label="Choose an avatar image, or drop one here"
					>
						{#if avatarSrc(editCharacterData, { full: true })}
							<img
								src={avatarSrc(editCharacterData, {
									full: true
								})}
								alt=""
								class="absolute inset-0 h-full w-full object-cover object-top"
							/>
						{:else}
							<span
								class="bg-surface-200-800 absolute inset-0 grid place-items-center"
							>
								<Icons.UsersRound
									size={36}
									class="text-surface-600-400"
									aria-hidden="true"
								/>
							</span>
						{/if}
						<span
							class="bg-surface-900/90 text-surface-800-200 absolute right-1 bottom-1 grid size-6 place-items-center rounded-full backdrop-blur-sm"
						>
							<Icons.Camera size={14} aria-hidden="true" />
						</span>
					</button>
					<input
						type="file"
						accept="image/*"
						class="hidden"
						tabindex="-1"
						bind:this={avatarInputRef}
						onchange={handleAvatarInputChange}
						aria-hidden="true"
					/>
					<RowMenu
						label="Avatar"
						triggerClass="btn btn-icon hover:bg-surface-200-800 data-[state=open]:bg-surface-200-800 h-7 min-h-0 w-7 p-0"
						bind:open={avatarMenuOpen}
						items={[
							{
								label: "Adjust crop",
								icon: Icons.Crop,
								disabled:
									!editCharacterData._avatarFile &&
									!character?.avatarMedia,
								onSelect: openCropEditor
							},
							{
								label: "Remove image",
								icon: Icons.Trash2,
								destructive: true,
								disabled: !editCharacterData._avatarFile,
								onSelect: clearAvatarSelection
							}
						]}
					/>
				</div>
				<div
					class="grid min-w-0 flex-1 grid-cols-1 gap-3 @lg/view:grid-cols-2"
				>
					{@render nameField()}
					{@render nicknameField()}
				</div>
			</fieldset>
		{:else}
			<div class="grid grid-cols-1 gap-3 @lg/view:grid-cols-2">
				{@render nameField()}
				{@render nicknameField()}
			</div>
		{/if}

		<!-- Three groups, always open inside the one on show. A field that has
		     to be unfolded before it can be read hides whether it is filled,
		     which is the question a character sheet answers at a glance.

		     The strip is PanelTabStrip, the same component the read-only
		     character view wears, so the two screens are one idiom rather than
		     two that resemble each other. -->
		<PanelTabStrip
			bind:value={activeFormTab}
			tabs={formTabs}
			ariaLabel="Character fields"
			panelIdPrefix="character-panel"
		/>

		<div
			id="character-panel-profile"
			role="tabpanel"
			aria-labelledby="character-panel-profile-tab"
			hidden={activeFormTab !== "profile"}
			class="space-y-3"
		>
			<section class="panel-card">
				<h2 class="mb-3 text-sm font-medium">About</h2>
				<div class="flex flex-col gap-4">
					<div class="flex flex-col">
						<label
							class="text-surface-600-400 mb-1.5 text-xs"
							for="charSummary"
						>
							Summary
						</label>
						<textarea
							id="charSummary"
							rows="2"
							bind:value={editCharacterData.summary}
							class={FIELD_CLASS}
							placeholder="One or two sentences describing who this character is…"
							maxlength="200"
						></textarea>
						<p class="text-surface-600-400 mt-1 text-right text-xs">
							{editCharacterData.summary.length} / 200
						</p>
						<p class="text-surface-600-400 text-xs">
							Used as a concise graph node description. Not
							injected into session context.
						</p>
					</div>
					<div class="flex flex-col">
						<label
							class="text-surface-600-400 mb-1.5 flex items-center gap-1 text-xs"
							for="charDescription"
						>
							Description*
							{@render promptBadge(
								"This field will be visible in prompts"
							)}
						</label>
						<textarea
							id="charDescription"
							rows="8"
							bind:value={editCharacterData.description}
							class="{FIELD_CLASS} {validationErrors.description
								? 'border-error-500 focus:border-error-500'
								: ''}"
							placeholder="Description..."
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
					<div class="flex flex-col">
						<span
							class="text-surface-600-400 mb-1.5 flex items-center gap-1 text-xs"
						>
							Aliases
							{@render promptBadge(
								"This field will be visible in prompts"
							)}
						</span>
						<div class="flex flex-col gap-2">
							{#each editCharacterData.aliases as _alias, idx (idx)}
								<div class="flex items-start gap-2">
									<input
										type="text"
										bind:value={
											editCharacterData.aliases[idx]
										}
										class="{FIELD_CLASS} flex-1"
										placeholder="Alias..."
										aria-label={`Alias ${idx + 1}`}
									/>
									{@render removeRowButton(
										`Delete alias ${idx + 1}`,
										() =>
											removeFromArray(
												editCharacterData.aliases,
												idx
											)
									)}
								</div>
							{/each}
							{@render addRowButton("Add alias", () =>
								addToArray(editCharacterData.aliases)
							)}
						</div>
					</div>
				</div>
			</section>
			{#if !hideTags || !hideFavorite}
				<section class="panel-card">
					<h2 class="mb-3 text-sm font-medium">Organize</h2>
					<div class="flex flex-col gap-4">
						{#if !hideTags}
							<div class="flex flex-col">
								<label
									class="text-surface-600-400 mb-1.5 text-xs"
									for="charTags"
								>
									Tags
								</label>
								<!-- Portalled, so the suggestions are not clipped by the
					     pane this form scrolls inside. The input keeps the
					     open/close decision: the popover neither steals focus
					     from the box being typed in nor closes itself from
					     under the click that picks a suggestion. -->
								<Popover
									open={showTagDropdown}
									onOpenChange={(e) =>
										(showTagDropdown = e.open)}
									autoFocus={false}
									restoreFocus={false}
									closeOnInteractOutside={false}
									closeOnEscape={false}
									positioning={{
										placement: "bottom-start",
										sameWidth: true
									}}
								>
									<Popover.Anchor>
										<input
											id="charTags"
											type="text"
											bind:value={tagSearchQuery}
											bind:this={tagInputRef}
											class={FIELD_CLASS}
											placeholder="Search or add tags..."
											onfocus={() =>
												(showTagDropdown = true)}
											onblur={(e) => {
												// Delay hiding dropdown to allow clicking on dropdown items
												setTimeout(() => {
													if (
														!(
															e.relatedTarget instanceof
																Element &&
															e.relatedTarget.closest(
																".tag-dropdown"
															)
														)
													) {
														showTagDropdown = false
													}
												}, 150)
											}}
											onkeydown={handleTagInputKeydown}
										/>
									</Popover.Anchor>
									{#if filteredTags.length > 0 || tagSearchQuery.trim()}
										<Portal>
											<Popover.Positioner
												class="z-[1000]!"
											>
												<Popover.Content
													class="tag-dropdown bg-surface-100-900 border-surface-300-700 max-h-48 w-full overflow-y-auto rounded-lg border shadow-lg"
												>
													{#if tagSearchQuery.trim() && !filteredTags.some((tag) => tag.name.toLowerCase() === tagSearchQuery.toLowerCase())}
														<button
															type="button"
															class="hover:bg-surface-200-800 panel-edge w-full border-b px-3 py-2 text-left text-sm"
															onclick={() =>
																addTag(
																	tagSearchQuery
																)}
														>
															<Icons.Plus
																size={16}
																class="mr-2 inline"
															/>
															Create "{tagSearchQuery}"
														</button>
													{/if}
													{#each filteredTags as tag}
														{#if !editCharacterData.tags.includes(tag.name)}
															<button
																type="button"
																class="hover:bg-surface-200-800 w-full px-3 py-2 text-left text-sm"
																onclick={() =>
																	addTag(
																		tag.name
																	)}
															>
																{tag.name}
															</button>
														{/if}
													{/each}
												</Popover.Content>
											</Popover.Positioner>
										</Portal>
									{/if}
								</Popover>

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
													onclick={() =>
														removeTag(tag)}
													aria-label="Remove tag {tag}"
												>
													<Icons.X size={12} />
												</button>
											</span>
										{/each}
									</div>
								{/if}
							</div>
						{/if}
						{#if !hideFavorite}
							<div class="flex items-center gap-2">
								<Switch
									name="favorite"
									checked={editCharacterData.isFavorite}
									onCheckedChange={(e) =>
										(editCharacterData.isFavorite =
											e.checked)}
									aria-describedby="favorite-description"
								>
									<Switch.Control
										class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
									>
										<Switch.Thumb />
									</Switch.Control>
									<Switch.HiddenInput />
									<Switch.Label class="text-sm">
										Favorite
									</Switch.Label>
								</Switch>
								<span id="favorite-description" class="sr-only">
									Mark this character as a favorite for easier
									access
								</span>
							</div>
							<!-- Persona and Default persona sit beside Favorite
							     because all three are the same kind of fact: how
							     THIS library treats the character, not anything
							     the model is told. Default implies Persona, and
							     the pair enforces it in both directions — the
							     switch is disabled while Persona is off, and
							     turning it on turns Persona on — so the state
							     "a default you cannot play" is unreachable
							     here, exactly as the server makes it
							     unreachable there. -->
							<div class="flex items-center gap-2">
								<Switch
									name="persona"
									checked={editCharacterData.isPersona}
									onCheckedChange={(e) => {
										editCharacterData.isPersona = e.checked
										// Clearing Persona clears Default with
										// it rather than leaving a default
										// nobody can play.
										if (!e.checked)
											editCharacterData.isDefaultPersona = false
									}}
									aria-describedby="persona-description"
								>
									<Switch.Control
										class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
									>
										<Switch.Thumb />
									</Switch.Control>
									<Switch.HiddenInput />
									<Switch.Label class="text-sm">
										Persona
									</Switch.Label>
								</Switch>
								<span id="persona-description" class="sr-only">
									A character you play
								</span>
								<span class="text-surface-600-400 text-xs">
									A character you play
								</span>
							</div>
							<div class="flex items-center gap-2">
								<Switch
									name="default-persona"
									checked={editCharacterData.isDefaultPersona}
									disabled={!editCharacterData.isPersona}
									onCheckedChange={(e) => {
										editCharacterData.isDefaultPersona =
											e.checked
										if (e.checked)
											editCharacterData.isPersona = true
									}}
									aria-describedby="default-persona-description"
								>
									<Switch.Control
										class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
									>
										<Switch.Thumb />
									</Switch.Control>
									<Switch.HiddenInput />
									<Switch.Label class="text-sm">
										Default persona
									</Switch.Label>
								</Switch>
								<span
									id="default-persona-description"
									class="sr-only"
								>
									The persona a new session starts with
								</span>
								<span class="text-surface-600-400 text-xs">
									New sessions start with this one
								</span>
							</div>
						{/if}
					</div>
				</section>
			{/if}
			{#if userSettingsCtx.settings?.showAllCharacterFields}
				<section class="panel-card">
					<h2 class="mb-3 text-sm font-medium">Card metadata</h2>
					<div class="grid grid-cols-1 gap-3 @lg/view:grid-cols-3">
						<div class="flex flex-col">
							<label
								class="text-surface-600-400 mb-1.5 text-xs"
								for="charVersion"
							>
								Version
							</label>
							<input
								id="charVersion"
								type="text"
								bind:value={editCharacterData.characterVersion}
								class={FIELD_CLASS}
								placeholder="1.0"
							/>
						</div>
						<div class="flex flex-col">
							<label
								class="text-surface-600-400 mb-1.5 text-xs"
								for="charCreator"
							>
								Creator
							</label>
							<input
								id="charCreator"
								type="text"
								bind:value={editCharacterData.creator}
								class={FIELD_CLASS}
								placeholder="Who made this character?"
							/>
						</div>
						<div class="flex flex-col">
							<label
								class="text-surface-600-400 mb-1.5 text-xs"
								for="charCategory"
							>
								Category
							</label>
							<input
								id="charCategory"
								type="text"
								bind:value={editCharacterData.category}
								class={FIELD_CLASS}
								placeholder="e.g. Fantasy, Sci-Fi, Slice of Life"
							/>
						</div>
					</div>
				</section>
			{/if}
		</div>

		<div
			id="character-panel-voice"
			role="tabpanel"
			aria-labelledby="character-panel-voice-tab"
			hidden={activeFormTab !== "voice"}
			class="space-y-3"
		>
			<section class="panel-card">
				<h2 class="mb-3 text-sm font-medium">Voice</h2>
				<div class="flex flex-col gap-4">
					<div class="flex flex-col">
						<label
							class="text-surface-600-400 mb-1.5 flex items-center gap-1 text-xs"
							for="charPersonality"
						>
							Personality
							{@render promptBadge(
								"This field will be visible in prompts"
							)}
						</label>
						<textarea
							id="charPersonality"
							rows="8"
							bind:value={editCharacterData.personality}
							class={FIELD_CLASS}
							placeholder="Personality..."
						></textarea>
					</div>
					{#if userSettingsCtx.settings?.showAllCharacterFields}
						<div class="flex flex-col">
							<label
								class="text-surface-600-400 mb-1.5 flex items-center gap-1 text-xs"
								for="charScenario"
							>
								Scenario
								{@render promptBadge(
									"This field will be visible in prompts (excluded from group sessions)"
								)}
							</label>
							<textarea
								id="charScenario"
								rows="8"
								bind:value={editCharacterData.scenario}
								class={FIELD_CLASS}
								placeholder="Scenario..."
							></textarea>
						</div>
					{/if}
				</div>
			</section>
			<section class="panel-card">
				<h2 class="mb-3 text-sm font-medium">Greetings</h2>
				<div class="flex flex-col gap-4">
					<div class="flex flex-col">
						<label
							class="text-surface-600-400 mb-1.5 text-xs"
							for="charFirstMessage"
						>
							First message
						</label>
						<textarea
							id="charFirstMessage"
							rows="8"
							bind:value={editCharacterData.firstMessage}
							class={FIELD_CLASS}
							placeholder="First message..."
						></textarea>
					</div>
					{#if userSettingsCtx.settings?.showAllCharacterFields}
						<div class="flex flex-col">
							<span class="text-surface-600-400 mb-1.5 text-xs">
								Alternate greetings
							</span>
							<div class="flex flex-col gap-2">
								{#each editCharacterData.alternateGreetings as _greeting, idx (idx)}
									<div class="flex items-start gap-2">
										<textarea
											rows="2"
											bind:value={
												editCharacterData
													.alternateGreetings[idx]
											}
											class="{FIELD_CLASS} flex-1 resize-y"
											placeholder="Greeting..."
											aria-label={`Alternate greeting ${idx + 1}`}
										></textarea>
										{@render removeRowButton(
											`Delete alternate greeting ${idx + 1}`,
											() =>
												removeFromArray(
													editCharacterData.alternateGreetings,
													idx
												)
										)}
									</div>
								{/each}
								{@render addRowButton("Add greeting", () =>
									addToArray(
										editCharacterData.alternateGreetings
									)
								)}
							</div>
						</div>
						<div class="flex flex-col">
							<span class="text-surface-600-400 mb-1.5 text-xs">
								Group-only greetings
							</span>
							<div class="flex flex-col gap-2">
								{#each editCharacterData.groupOnlyGreetings as _greeting, idx (idx)}
									<div class="flex items-start gap-2">
										<textarea
											rows="2"
											bind:value={
												editCharacterData
													.groupOnlyGreetings[idx]
											}
											class="{FIELD_CLASS} flex-1 resize-y"
											placeholder="Group greeting..."
											aria-label={`Group-only greeting ${idx + 1}`}
										></textarea>
										{@render removeRowButton(
											`Delete group-only greeting ${idx + 1}`,
											() =>
												removeFromArray(
													editCharacterData.groupOnlyGreetings,
													idx
												)
										)}
									</div>
								{/each}
								{@render addRowButton(
									"Add group greeting",
									() =>
										addToArray(
											editCharacterData.groupOnlyGreetings
										)
								)}
							</div>
						</div>
					{/if}
				</div>
			</section>
			{#if userSettingsCtx.settings?.showAllCharacterFields}
				<section class="panel-card">
					<h2 class="mb-3 text-sm font-medium">Examples</h2>
					<div class="flex flex-col">
						<span
							class="text-surface-600-400 mb-1.5 flex items-center gap-1 text-xs"
						>
							Example dialogues
							{@render promptBadge(
								"This field will be visible in prompts"
							)}
						</span>
						<div
							class="flex flex-col gap-2"
							role="list"
							aria-label="Example dialogues"
						>
							{#each editCharacterData.exampleDialogues as _dialogue, idx (idx)}
								<div
									class="flex items-start gap-2"
									role="listitem"
								>
									<textarea
										rows="4"
										bind:value={
											editCharacterData.exampleDialogues[
												idx
											]
										}
										class="{FIELD_CLASS} flex-1 resize-y"
										placeholder="Example dialogue..."
										aria-label={`Example dialogue ${idx + 1}`}
									></textarea>
									{@render removeRowButton(
										`Delete example dialogue ${idx + 1}`,
										() =>
											removeFromArray(
												editCharacterData.exampleDialogues,
												idx
											)
									)}
								</div>
							{/each}
							{@render addRowButton("Add example dialogue", () =>
								addToArray(editCharacterData.exampleDialogues)
							)}
						</div>
					</div>
				</section>
				<section class="panel-card">
					<h2 class="mb-3 text-sm font-medium">Instructions</h2>
					<div class="flex flex-col">
						<label
							class="text-surface-600-400 mb-1.5 flex items-center gap-1 text-xs"
							for="charPostHistory"
						>
							Post-history instructions
							{@render promptBadge(
								"This field will be visible in prompts"
							)}
						</label>
						<textarea
							id="charPostHistory"
							rows="4"
							bind:value={
								editCharacterData.postHistoryInstructions
							}
							class={FIELD_CLASS}
							placeholder="Instructions for post-history processing..."
						></textarea>
					</div>
				</section>
			{/if}
		</div>

		<div
			id="character-panel-notes"
			role="tabpanel"
			aria-labelledby="character-panel-notes-tab"
			hidden={activeFormTab !== "notes"}
			class="space-y-3"
		>
			<section class="panel-card">
				<h2 class="mb-3 text-sm font-medium">Creator notes</h2>
				<div class="flex flex-col gap-4">
					<div class="flex flex-col">
						<label
							class="text-surface-600-400 mb-1.5 text-xs"
							for="charCreatorNotes"
						>
							Creator notes
						</label>
						<textarea
							id="charCreatorNotes"
							rows="4"
							bind:value={editCharacterData.creatorNotes}
							class={FIELD_CLASS}
							placeholder="Notes from the character creator..."
						></textarea>
					</div>
					{#if userSettingsCtx.settings?.showAllCharacterFields}
						<div class="flex flex-col">
							<span class="text-surface-600-400 mb-1.5 text-xs">
								Creator notes (multilingual)
							</span>
							<div class="flex flex-col gap-2">
								{#each Object.entries(editCharacterData.creatorNotesMultilingual) as [lang, _note], idx (lang)}
									<div class="flex items-start gap-2">
										<input
											type="text"
											value={lang}
											class="{FIELD_CLASS} w-16 shrink-0"
											aria-label={`Language ${idx + 1}`}
											readonly
										/>
										<input
											type="text"
											bind:value={
												editCharacterData
													.creatorNotesMultilingual[
													lang
												]
											}
											class="{FIELD_CLASS} flex-1"
											placeholder="Note..."
											aria-label={`Note in ${lang}`}
										/>
										{@render removeRowButton(
											`Delete the ${lang} note`,
											() =>
												removeObjectKey(
													editCharacterData.creatorNotesMultilingual,
													lang
												)
										)}
									</div>
								{/each}
								<div class="flex items-start gap-2">
									<input
										type="text"
										class="{FIELD_CLASS} w-16 shrink-0"
										bind:value={newLangKey}
										placeholder="Lang"
										aria-label="New note language"
									/>
									<input
										type="text"
										class="{FIELD_CLASS} flex-1"
										bind:value={newLangNote}
										placeholder="Note..."
										aria-label="New note text"
									/>
									<button
										type="button"
										class="text-surface-600-400 hover:bg-surface-200-800 hover:text-foreground grid size-8 shrink-0 place-items-center rounded-lg"
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
										aria-label="Add multilingual note"
										title="Add multilingual note"
									>
										<Icons.Plus
											size={14}
											aria-hidden="true"
										/>
									</button>
								</div>
							</div>
						</div>
					{/if}
				</div>
			</section>
		</div>

		<!-- Its own quiet row, outside the cards: this switch changes what the
		     cards contain, so it is not one of the things they hold. -->
		<div class="flex flex-col gap-1 pt-2">
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
				<Switch.Label class="text-sm">Show all fields</Switch.Label>
			</Switch>
			<p
				id="show-all-fields-description"
				class="text-surface-600-400 text-xs"
			>
				Adds every field a character card can carry — scenario, extra
				greetings, example dialogues and the creator's own metadata.
			</p>
		</div>
	</div>
</div>

{#snippet nameField()}
	<div class="flex flex-col">
		<label
			class="text-surface-600-400 mb-1.5 flex items-center gap-1 text-xs"
			for="charName"
		>
			Name*
			{@render promptBadge("This field will be visible in prompts")}
		</label>
		<input
			id="charName"
			type="text"
			bind:value={editCharacterData.name}
			class="{FIELD_CLASS} text-base {validationErrors.name
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
			aria-describedby={validationErrors.name ? "name-error" : undefined}
		/>
		{#if validationErrors.name}
			<p class="text-error-500 mt-1 text-sm" id="name-error" role="alert">
				{validationErrors.name}
			</p>
		{/if}
	</div>
{/snippet}

{#snippet nicknameField()}
	<div class="flex flex-col">
		<label
			class="text-surface-600-400 mb-1.5 flex items-center gap-1 text-xs"
			for="charNickname"
		>
			Nickname
			{@render promptBadge("This field will be visible in prompts")}
		</label>
		<input
			id="charNickname"
			type="text"
			bind:value={editCharacterData.nickname}
			class={FIELD_CLASS}
		/>
	</div>
{/snippet}

<CharacterUnsavedChangesModal
	open={showCancelModal}
	onOpenChange={handleCancelModalOnOpenChange}
	onConfirm={handleCancelModalDiscard}
	onCancel={handleCancelModalCancel}
/>

<!-- Mounted whether or not it is open: a dialog torn down mid-close leaves its
     machine reading state that went with it. The source outlives the close
     here, so it is `open` alone that opens and closes the editor. -->
<AvatarCropEditor
	open={cropOpen}
	onOpenChange={(e) => (cropOpen = e.open)}
	src={cropSrc}
	frame={cropFrame}
	subject={`${
		editCharacterData.nickname || editCharacterData.name || "this"
	}'s avatar`}
	onSave={onCropSaved}
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
