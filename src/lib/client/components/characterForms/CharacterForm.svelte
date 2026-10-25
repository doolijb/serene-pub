<script lang="ts">
	import { withoutShared } from "$lib/shared/utils/sharedRows"
	import { avatarSrc } from "$lib/client/utils/media"
	import { isStarterKit } from "$lib/client/lorebooks/starterKitCards"
	import { Switch, Popover, Portal, Dialog } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import {
		declareInterest,
		requestWithInterest,
		useInterest
	} from "$lib/client/sockets/interest.svelte"
	import { interestKey } from "$lib/shared/sockets/interest"
	import { onMount, onDestroy, getContext, type Component } from "svelte"
	import { z } from "zod"
	import CharacterUnsavedChangesModal from "../modals/CharacterUnsavedChangesModal.svelte"
	import AvatarPicker from "../media/AvatarPicker.svelte"
	import PanelTabStrip from "$lib/client/components/panels/PanelTabStrip.svelte"
	import PanelNavHeader from "$lib/client/components/panels/PanelNavHeader.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { stableStringify } from "$lib/shared/utils/connectionDefaults"
	import { validateStrokes, type Stroke } from "@serene-pub/sdk"
	import StrokeField from "./StrokeField.svelte"
	import { STROKES_ENABLED } from "$lib/shared/characters/strokesFlag"
	import CardStatsTab from "./CardStatsTab.svelte"
	import LikenessTab, { type LikenessDraft } from "./LikenessTab.svelte"
	import { likenessOfExtensions } from "$lib/shared/characters/likeness"
	import { socketCardStatsApi } from "./cardStatsApi"
	import {
		CAST_LINE_NOTE,
		castBannerWords,
		retoldFieldList,
		type CastBannerMember
	} from "./castBannerWords"
	import {
		backToOneText,
		findingsByStroke,
		offStrokeCount,
		strokesForSave,
		characterForSave
	} from "./strokes"

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
		/**
		 * 🚧 The card's strokes (DESIGN-card-strokes §A.3): empty is the
		 * legacy shape, where `description` / `personality` are the truth.
		 */
		strokes: Stroke[]
		/**
		 * 🚧 The card's likeness (DESIGN-image-generation §5) — not a column:
		 * sent beside the character and stored in its extensions.
		 */
		likeness: LikenessDraft
	}

	// Zod validation schema
	const characterSchema = z.object({
		name: z.string().min(1, "Name is required").trim(),
		nickname: z.string().optional(),
		description: z.string().trim(),
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
		tags: z.array(z.string()).optional(),
		strokes: z.array(z.any()).optional()
	}).superRefine((v, ctx) => {
		// With strokes, the description is compiled from them: required
		// only while the card is one text.
		if (!v.strokes?.length && !v.description)
			ctx.addIssue({
				code: "custom",
				path: ["description"],
				message: "Description is required"
			})
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

	/**
	 * The cast banner (plans/PLAN-cast-retold-fields-2026-10-13.md): which
	 * cast members this card represents, and which of them retell parts of
	 * it. Absent outside the shell (no panels to open), and then the banner
	 * is plain text.
	 */
	const panelsCtx = getContext<PanelsCtx | undefined>("panelsCtx")
	let castMembers: CastBannerMember[] = $state([])
	const castBanner = $derived(castBannerWords(castMembers))

	function handleCastBindings(
		message: Sockets.Lorebooks.BindingsForCharacter.Response
	) {
		if (message.characterId !== characterId) return
		// `members` arrives with the cast retold-fields server lane; an older
		// reply without it is "no members", which renders nothing.
		castMembers =
			(message as { members?: CastBannerMember[] }).members ?? []
	}

	/**
	 * Asked once per card, BARE — `lorebooks:bindingsForCharacter` has no
	 * `SCOPED_EVENTS` entry, so the handler's `characterId` check is the
	 * filter (as in CharacterExportModal). Errors are not watched: the banner
	 * is a note, and a failed ask just leaves it out.
	 */
	$effect(() => {
		castMembers = []
		if (mode !== "edit" || !characterId) return
		return requestWithInterest(
			"lorebooks:bindingsForCharacter",
			{ characterId },
			handleCastBindings
		)
	})

	/** Address first, then open (shell/openJumpHit.ts). */
	function openCastMember(member: CastBannerMember) {
		if (!panelsCtx) return
		panelsCtx.digest.lore = {
			lorebookId: member.lorebookId,
			scope: "cast",
			castId: member.castId
		}
		panelsCtx.openPanel({ key: "lorebooks", toggle: false })
	}

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
		tags: [],
		strokes: [],
		likeness: { prompt: "", negative: "" }
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
		tags: [],
		strokes: [],
		likeness: { prompt: "", negative: "" }
	})
	/**
	 * The three groups this form's fields belong to. A field is always open
	 * inside its group: folding one away hides whether it is filled, which is
	 * the question a character sheet answers at a glance.
	 */
	type FormTab = "profile" | "voice" | "notes" | "likeness" | "stats"
	const FORM_TABS: Array<{
		value: FormTab
		label: string
		icon: Component<any>
	}> = [
		{ value: "profile", label: "Profile", icon: Icons.UserRound },
		{ value: "voice", label: "Voice", icon: Icons.MessageSquareQuote },
		{ value: "notes", label: "Notes", icon: Icons.NotebookPen },
		{ value: "likeness", label: "Likeness", icon: Icons.ScanFace },
		{ value: "stats", label: "Stats", icon: Icons.HeartPulse }
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
			"category",
			"strokesDescription"
		],
		voice: [
			"personality",
			"firstMessage",
			"scenario",
			"alternateGreetings",
			"exampleDialogues",
			"groupOnlyGreetings",
			"postHistoryInstructions",
			"strokesPersonality"
		],
		notes: ["creatorNotes", "creatorNotesMultilingual"],
		likeness: [],
		stats: []
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
	const FIELD_CLASS = "input rounded-base"
	/** Field hints, now the fields' titles (polish parity L5, STYLE-GUIDE §6.4). */
	const ALIASES_HINT =
		"Other names they go by; when lore is looked up, a mention of one counts as a mention of them."
	const SHOW_ALL_FIELDS_HINT =
		"Adds every field a character card can carry: scenario, extra greetings, example dialogues and the creator's own metadata."
	/** The Summary's limit; its counter shows only past 80% of it (§6.4). */
	const SUMMARY_MAX = 200
	const summaryNearLimit = $derived(
		editCharacterData.summary.length >= SUMMARY_MAX * 0.8
	)

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
			"bg-primary-500/20 text-primary-ink"
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

	/** The avatar picker: it holds a new avatar's crop until the save comes
	 *  back with the file's id (`commitPendingFrame`). */
	let avatarPicker = $state<ReturnType<typeof AvatarPicker> | null>(null)

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
		if (!strokesValid()) return

		if (mode === "create") {
			// Create new character
			handleCreate()
		} else if (mode === "edit" && character) {
			// Update existing character
			handleUpdate()
		}
	}

	/** The strokes this save sends: the draft's, with a never-split field folded in. */
	function savedStrokes(): Stroke[] {
		return strokesForSave($state.snapshot(editCharacterData.strokes) as Stroke[], {
			description: editCharacterData.description,
			personality: editCharacterData.personality
		})
	}

	/**
	 * The strokes against the SDK's shape and limits before anything is sent:
	 * each finding is said under its stroke (every one, empty text included,
	 * from now on), and the tab holding the first is marked.
	 */
	function strokesValid(): boolean {
		if (!STROKES_ENABLED) return true
		const findings = findingsByStroke(validateStrokes(savedStrokes()))
		const errors = { ...validationErrors }
		delete errors.strokesDescription
		delete errors.strokesPersonality
		for (const [index, list] of findings) {
			const kind = editCharacterData.strokes[index]?.kind ?? "description"
			const key = kind === "personality" ? "strokesPersonality" : "strokesDescription"
			errors[key] ??= list[0].message
		}
		validationErrors = errors
		if (!findings.size) return true
		revealStrokeFindings = true
		activeFormTab = errors.strokesDescription ? "profile" : "voice"
		return false
	}

	/** The draft as a save sends it — no `strokes` while strokes are paused. */
	function savedCharacter() {
		return characterForSave({
			...editCharacterData,
			strokes: $state.snapshot(editCharacterData.strokes) as Stroke[]
		})
	}

	/** The likeness as a save sends it, beside the character, not on it. */
	function savedLikeness() {
		const l = $state.snapshot(editCharacterData.likeness)
		return {
			...(l.imageMediaId !== undefined
				? { imageMediaId: l.imageMediaId }
				: {}),
			prompt: l.prompt,
			negative: l.negative
		}
	}

	function handleCreate() {
		const { likeness: _likeness, ...newCharacter } = savedCharacter()
		const avatarFile = newCharacter._avatarFile
		delete newCharacter._avatarFile
		isSaving = true
		socket.emit("characters:create", {
			likeness: savedLikeness(),
			character: newCharacter,
			// Socket.IO transparently marshals a browser File (a Blob
			// subclass) to a Node Buffer on the server; the wire shape
			// differs from the client-side value's compile-time type.
			avatarFile: avatarFile as unknown as Buffer | undefined
		})
	}

	function handleUpdate() {
		const { likeness: _likeness, ...updatedCharacter } = savedCharacter()
		if (!updatedCharacter.id) return
		const avatarFile = updatedCharacter._avatarFile
		delete updatedCharacter._avatarFile
		isSaving = true
		socket.emit("characters:update", {
			likeness: savedLikeness(),
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
				stableStringify(originalCharacterData) || statsDirty
	})

	function handleCharactersCreate(res: any) {
		// characters:create is emitToUser, so another tab's create arrives here
		// too. Only the form that is mid-save may attach its pending crop —
		// otherwise this character's crop would land on that one's avatar.
		const mine = isSaving
		isSaving = false
		if (res.character) {
			if (mine)
				avatarPicker?.commitPendingFrame(res.character.avatarMediaId)
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
			avatarPicker?.commitPendingFrame(res.character.avatarMediaId)
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
			// Strokes paused: none in the draft, so the textareas hold the
			// stored prose and description stays required.
			strokes:
				STROKES_ENABLED && Array.isArray(characterData.strokes)
					? (characterData.strokes as Stroke[])
					: [],
			likeness: (() => {
				const l = likenessOfExtensions(characterData.extensions)
				return {
					...(l.imageMediaId !== undefined
						? { imageMediaId: l.imageMediaId }
						: {}),
					prompt: l.prompt ?? "",
					negative: l.negative ?? ""
				}
			})(),
			_avatar: "",
			_avatarFile: undefined
		}
		originalCharacterData = $state.snapshot(editCharacterData)
	}

	function handleLorebooksList(message: Sockets.Lorebooks.List.Response) {
		// Books only: a shared one is read and copy only, and a starter lorebook is
		// never read (PLAN-lorebook-kinds §B).
		lorebookList = withoutShared(message.lorebookList)
			.filter((l) => !isStarterKit(l))
			.sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
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

	// ── Strokes: token counts, Back to one text ───────────────────────────

	/** Every stroke finding said, empty text included — set once a Save was tried. */
	let revealStrokeFindings = $state(false)
	let strokeTokens =
		$state<Sockets.Characters.CountStrokeTokens.Response | null>(null)
	let tokenTimer: ReturnType<typeof setTimeout> | undefined
	let tokenGiveUp: ReturnType<typeof setTimeout> | undefined
	/** The one count in flight, by its request id; another edit waits for it. */
	let tokenInFlight: string | null = null
	let tokenQueued = false
	let tokenAsks = 0

	function askStrokeTokens() {
		if (!STROKES_ENABLED) return
		const strokes = savedStrokes()
		if (!strokes.length) {
			strokeTokens = null
			return
		}
		if (tokenInFlight) {
			tokenQueued = true
			return
		}
		const requestId = `stroke-tokens-${Date.now().toString(36)}-${++tokenAsks}`
		tokenInFlight = requestId
		socket.emit("characters:countStrokeTokens", { strokes, requestId })
		// A count that never comes back must not hold every later one.
		clearTimeout(tokenGiveUp)
		tokenGiveUp = setTimeout(() => settleStrokeTokens(requestId), 15_000)
	}

	function settleStrokeTokens(requestId: string) {
		if (tokenInFlight !== requestId) return
		tokenInFlight = null
		clearTimeout(tokenGiveUp)
		if (tokenQueued) {
			tokenQueued = false
			askStrokeTokens()
		}
	}

	/**
	 * The count replies — BARE and standing, ungated: the reply goes to the
	 * asking socket only, and the request id says which ask it answers. A
	 * failed count says nothing; the rows just keep their last count.
	 */
	useInterest<"characters:countStrokeTokens">(
		"characters:countStrokeTokens",
		(res) => {
			if (!res.requestId || res.requestId !== tokenInFlight) return
			strokeTokens = res
			settleStrokeTokens(res.requestId)
		}
	)
	useInterest<"characters:countStrokeTokens:error">(
		"characters:countStrokeTokens:error",
		(res) => {
			const id = (res as { requestId?: string }).requestId ?? tokenInFlight
			if (id) settleStrokeTokens(id)
		}
	)

	// 400 ms after the last stroke edit (or an edit of a field still one
	// text beside them, which travels as a stroke too).
	$effect(() => {
		const has = STROKES_ENABLED && editCharacterData.strokes.length > 0
		void JSON.stringify(editCharacterData.strokes)
		void editCharacterData.description
		void editCharacterData.personality
		clearTimeout(tokenTimer)
		if (!has) {
			strokeTokens = null
			return
		}
		tokenTimer = setTimeout(askStrokeTokens, 400)
	})

	let backToOneOpen = $state(false)
	let offStrokes = $derived(offStrokeCount(editCharacterData.strokes))

	/** Both fields compiled from their strokes, and the strokes cleared — the card is one text again. */
	function confirmBackToOneText() {
		const out = backToOneText(
			$state.snapshot(editCharacterData.strokes) as Stroke[],
			{
				description: editCharacterData.description,
				personality: editCharacterData.personality
			}
		)
		editCharacterData.description = out.description
		editCharacterData.personality = out.personality
		editCharacterData.strokes = []
		strokeTokens = null
		revealStrokeFindings = false
		const { strokesDescription, strokesPersonality, ...rest } =
			validationErrors
		validationErrors = rest
		backToOneOpen = false
	}

	const cardStatsApi = socketCardStatsApi(socket)
	let statsDirty = $state(false)

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
		clearTimeout(tokenTimer)
		clearTimeout(tokenGiveUp)
		// The `characters:*`, `tags:list`, `lorebooks:list` and
		// `userSettings:*` listeners are not here: the interest registry
		// releases this form's subscribers as its effects are destroyed.

		// Remove keyboard event listener and clear timeout
		document.removeEventListener("keydown", handleKeydown)
		clearTimeout(validationTimeout)
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
		class="flex items-center opacity-50 transition-opacity duration-fast hover:opacity-100"
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
		class="text-surface-600-400 hover:bg-surface-200-800 hover:text-error-600-400 grid size-8 shrink-0 place-items-center rounded-lg"
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

<!-- Save, labelled. Filled primary only while there is something to save: a
     permanently lit call to action stops being one. -->
{#snippet saveButton()}
	<button
		type="button"
		class="btn btn-sm shrink-0"
		class:preset-filled-primary-500={hasChanges}
		class:preset-tonal-surface={!hasChanges}
		onclick={onSave}
		disabled={isSaving}
		aria-label={`Save character${hasChanges ? " (has unsaved changes)" : ""}`}
	>
		{#if isSaving}
			<Icons.Loader2 size={16} class="animate-spin" aria-hidden="true" />
		{:else}
			<Icons.Save size={16} aria-hidden="true" />
		{/if}
		Save
	</button>
{/snippet}

{#snippet unsavedLine()}
	<p class="text-surface-600-400 text-xs">Unsaved changes</p>
{/snippet}

<!-- A flex column whose 12px gap is the only space under the header
     (STYLE-GUIDE §6.3). -->
<div
	class="animate-fade-in flex min-h-full max-w-[760px] flex-col gap-3"
	bind:this={formContainer}
	role="dialog"
	aria-label={formTitle}
	aria-modal="false"
>
	{#if !hideTitle}
		<!-- The one title row (STYLE-GUIDE §6.3): back only when the list is
		     off screen — it runs the same cancel path as Escape, so the
		     unsaved-changes gate holds — then who is being edited, then Save. -->
		<PanelNavHeader
			title={formTitle}
			onBack={!hideActionButtons && showBack ? handleCancel : undefined}
			backLabel="Back to list"
			primaryAction={hideActionButtons ? undefined : saveButton}
			subtitle={!hideActionButtons && hasChanges
				? unsavedLine
				: undefined}
		/>
	{:else if !hideActionButtons}
		<div class="flex items-center justify-end gap-2">
			{#if hasChanges}
				{@render unsavedLine()}
			{/if}
			{@render saveButton()}
		</div>
	{/if}
	<div class="flex flex-col gap-4" role="form" aria-label={formTitle}>
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
				<AvatarPicker
					bind:this={avatarPicker}
					bind:file={editCharacterData._avatarFile}
					bind:preview={editCharacterData._avatar}
					src={avatarSrc(editCharacterData, { full: true })}
					mediaId={character?.avatarMediaId}
					media={character?.avatarMedia}
					subject={`${
						editCharacterData.nickname || editCharacterData.name || "this"
					}'s avatar`}
					onStoredFrame={(frame) => {
						if (character?.avatarMedia)
							character.avatarMedia.frame = frame
					}}
				/>
				<div class="flex min-w-0 flex-1 flex-col gap-2">
					<div class="grid grid-cols-1 gap-3 @lg/view:grid-cols-2">
						{@render nameField()}
						{@render nicknameField()}
					</div>
					{@render castLine()}
				</div>
			</fieldset>
		{:else}
			<div class="flex flex-col gap-2">
				<div class="grid grid-cols-1 gap-3 @lg/view:grid-cols-2">
					{@render nameField()}
					{@render nicknameField()}
				</div>
				{@render castLine()}
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
						<!-- The hint is the field's title, the counter only
						     past 80% of the limit (polish parity L5). -->
						<textarea
							id="charSummary"
							rows="2"
							bind:value={editCharacterData.summary}
							class={FIELD_CLASS}
							placeholder="One or two sentences describing who this character is…"
							title="A one-line blurb for character lists and the lorebook Graph; not part of the prompt."
							maxlength={SUMMARY_MAX}
						></textarea>
						{#if summaryNearLimit}
							<p
								class="text-surface-600-400 mt-1 text-right text-xs"
								aria-live="polite"
							>
								{editCharacterData.summary.length} / {SUMMARY_MAX}
							</p>
						{/if}
					</div>
					<StrokeField
						kind="description"
						label="Description"
						bind:strokes={editCharacterData.strokes}
						prose={editCharacterData.description}
						tokens={strokeTokens ?? undefined}
						revealAll={revealStrokeFindings}
						onBackToOneText={() => (backToOneOpen = true)}
					>
						{#snippet labelExtra()}
							{@render promptBadge(
								"This field will be visible in prompts"
							)}
						{/snippet}
						{#snippet textarea()}
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
								class="text-error-600-400 mt-1 text-sm"
								id="description-error"
								role="alert"
							>
								{validationErrors.description}
							</p>
						{/if}
						{/snippet}
					</StrokeField>
					{#if validationErrors.strokesDescription && editCharacterData.strokes.length}
						<p class="text-error-600-400 -mt-2 text-sm" role="alert">
							{validationErrors.strokesDescription}
						</p>
					{/if}
					<div class="flex flex-col">
						<span
							class="text-surface-600-400 mb-1.5 flex items-center gap-1 text-xs"
							title={ALIASES_HINT}
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
										title={ALIASES_HINT}
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
													class="tag-dropdown bg-surface-100-900 border-surface-200-800 max-h-48 w-full overflow-y-auto rounded-lg border shadow-lg"
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
					<StrokeField
						kind="personality"
						label="Personality"
						bind:strokes={editCharacterData.strokes}
						prose={editCharacterData.personality}
						tokens={strokeTokens ?? undefined}
						revealAll={revealStrokeFindings}
						onBackToOneText={() => (backToOneOpen = true)}
					>
						{#snippet labelExtra()}
							{@render promptBadge(
								"This field will be visible in prompts"
							)}
						{/snippet}
						{#snippet textarea()}
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
						{/snippet}
					</StrokeField>
					{#if validationErrors.strokesPersonality && editCharacterData.strokes.length}
						<p class="text-error-600-400 -mt-2 text-sm" role="alert">
							{validationErrors.strokesPersonality}
						</p>
					{/if}
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
							placeholder="Stay in character and keep replies short…"
							title="Placed after the conversation, just before the reply; good for style reminders."
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

		<div
			id="character-panel-likeness"
			role="tabpanel"
			aria-labelledby="character-panel-likeness-tab"
			hidden={activeFormTab !== "likeness"}
			class="space-y-3"
		>
			<LikenessTab
				characterId={mode === "edit" ? characterId : undefined}
				active={activeFormTab === "likeness"}
				avatarUrl={avatarSrc(editCharacterData, { full: true })}
				bind:likeness={editCharacterData.likeness}
			/>
		</div>

		<div
			id="character-panel-stats"
			role="tabpanel"
			aria-labelledby="character-panel-stats-tab"
			hidden={activeFormTab !== "stats"}
			class="space-y-3"
		>
			<CardStatsTab
				characterId={mode === "edit" ? characterId : undefined}
				active={activeFormTab === "stats"}
				api={cardStatsApi}
				bind:dirty={statsDirty}
			/>
		</div>

		<!-- Its own quiet row, outside the cards: this switch changes what the
		     cards contain, so it is not one of the things they hold. What it
		     adds is its title (polish parity L5), not a sentence under it. -->
		<div
			class="flex flex-col gap-1 pt-2"
			hidden={activeFormTab === "stats" || activeFormTab === "likeness"}
			title={SHOW_ALL_FIELDS_HINT}
		>
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
			<span id="show-all-fields-description" class="sr-only">
				{SHOW_ALL_FIELDS_HINT}
			</span>
		</div>
	</div>
</div>

<!-- The cast line (polish parity L5; it was a banner card over the form): one
     muted line under the name, each lorebook's name opening that member. How
     many members, which retell parts of the card, and what a card is ride its
     title. Absent outside the shell, the names are plain text. -->
{#snippet castLine()}
	{#if castBanner}
		<p
			class="text-surface-600-400 text-xs"
			title="{castBanner.represents}{castBanner.retells
				? ` ${castBanner.retells}`
				: ''} {CAST_LINE_NOTE}"
			data-cast-line
		>
			{castBanner.lead}
			{#each castMembers as member, i (member.castId)}
				{@const retold = retoldFieldList(member.retold)}
				{#if i > 0},{" "}{/if}{#if panelsCtx}<button
						type="button"
						class="text-primary-ink underline-offset-2 hover:underline"
						aria-label="Open this card's cast member in {member.lorebookName}"
						onclick={() => openCastMember(member)}
					>
						{member.lorebookName}
					</button>{:else}<span>{member.lorebookName}</span>{/if}{#if retold}{" "}(retells {retold}){/if}
			{/each}
		</p>
	{/if}
{/snippet}

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
			<p class="text-error-600-400 mt-1 text-sm" id="name-error" role="alert">
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
			placeholder="What others call them in replies"
		/>
	</div>
{/snippet}

<CharacterUnsavedChangesModal
	open={showCancelModal}
	onOpenChange={handleCancelModalOnOpenChange}
	onConfirm={handleCancelModalDiscard}
	onCancel={handleCancelModalCancel}
/>

<Dialog
	open={backToOneOpen}
	role="alertdialog"
	closeOnInteractOutside={false}
	onOpenChange={(e) => (backToOneOpen = e.open)}
>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 w-full max-w-md space-y-4 p-6 shadow-xl"
				data-back-to-one-text
			>
				<Dialog.Title class="text-lg font-semibold">
					Back to one text?
				</Dialog.Title>
				<Dialog.Description class="space-y-2 text-sm">
					<p>
						Description and Personality each become one text, joined
						from their strokes as the model reads them now. Labels
						stay as “Label: text”; keywords, slugs and the order
						handles go.
					</p>
					{#if offStrokes}
						<p class="text-surface-600-400">
							{offStrokes}
							{offStrokes === 1 ? "stroke is" : "strokes are"} off and
							will not be kept.
						</p>
					{/if}
					<p class="text-surface-600-400">
						Nothing is saved until you save the character.
					</p>
				</Dialog.Description>
				<footer class="flex justify-end gap-2">
					<button
						type="button"
						class="btn preset-tonal"
						onclick={() => (backToOneOpen = false)}
					>
						Cancel
					</button>
					<button
						type="button"
						class="btn preset-filled-primary-500"
						onclick={confirmBackToOneText}
						data-back-confirm
					>
						Back to one text
					</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>

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
