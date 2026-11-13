<script lang="ts">
	import { withoutShared } from "$lib/shared/utils/sharedRows"
	import { avatarSrc } from "$lib/client/utils/media"
	import { isStarterKit } from "$lib/client/lorebooks/starterKitCards"
	import {
		Switch,
		Popover,
		Portal,
		Dialog
	} from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import {
		declareInterest,
		requestWithInterest,
		useInterest
	} from "$lib/client/sockets/interest.svelte"
	import { interestKey } from "$lib/shared/sockets/interest"
	import { onMount, onDestroy, getContext } from "svelte"
	import { z } from "zod"
	import CharacterUnsavedChangesModal from "../modals/CharacterUnsavedChangesModal.svelte"
	import AvatarPicker from "../media/AvatarPicker.svelte"
	import PanelTabStrip from "$lib/client/components/panels/PanelTabStrip.svelte"
	import PanelNavHeader from "$lib/client/components/panels/PanelNavHeader.svelte"
	import { notify } from "$lib/client/utils/notify"
	import { stableStringify } from "$lib/shared/utils/connectionDefaults"
	import { validateStrokes, type Stroke } from "@serene-pub/sdk"
	import StrokeField from "./StrokeField.svelte"
	import { FIELD_CLASS } from "./fieldClass"
	import { FORM_TABS, type FormTab } from "./formTabs"
	import PromptBadge from "./PromptBadge.svelte"
	import RemoveRowButton from "./RemoveRowButton.svelte"
	import AddRowButton from "./AddRowButton.svelte"
	import ProseField from "./ProseField.svelte"
	import GreetingsList from "./GreetingsList.svelte"
	import CreatorNotesFields from "./CreatorNotesFields.svelte"
	import { STROKES_ENABLED } from "$lib/shared/characters/strokesFlag"
	import CardStatsTab from "./CardStatsTab.svelte"
	import LikenessTab, { type LikenessDraft } from "./LikenessTab.svelte"
	import { likenessOfExtensions } from "$lib/shared/characters/likeness"
	import VoiceTab from "./VoiceTab.svelte"
	import {
		EMPTY_TIMBRE_DRAFT,
		extensionsForSave,
		timbreDraftOf,
		type TimbreDraft
	} from "./voiceTab"
	import { canPickVoice } from "$lib/shared/characters/timbre"
	import { openInLoadouts } from "$lib/client/admin/railDoors"
	import { socketCardStatsApi } from "./cardStatsApi"
	import { castEditParts, type CastBannerMember } from "./castBannerWords"
	import { openCastMember } from "./openCastMember"
	import CastLine from "./CastLine.svelte"
	import AdvancedHiddenLine from "$lib/client/components/AdvancedHiddenLine.svelte"
	import { showsAdvancedControls } from "$lib/client/advancedControls"
	import {
		greetingColumnsOf,
		greetingsOfColumns,
		noteLanguageProblem,
		notesColumnsOf,
		notesDraftOf,
		openerIndex,
		withOpenerText,
		type NoteLanguageRow
	} from "./cardDraft"
	import {
		highestVersion,
		inPlaceNote,
		stayingGroups,
		versionLabelText,
		versionOptionText,
		type CardVersionOption,
		type StayingCastMember
	} from "./cardVersionWords"
	import {
		nextVersionLabel,
		type CharacterGreeting
	} from "$lib/shared/characters/profile"
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
		/**
		 * The one greetings list (the opener first, then the alternates, the
		 * group-only ones marked). The wire still speaks three columns:
		 * `cardDraft.ts` converts on load and save.
		 */
		greetings: CharacterGreeting[]
		exampleDialogues: string[]
		/** The creator notes' main text, its language, and the other languages (`cardDraft.ts`). */
		creatorNotes: string
		creatorNotesLang: string
		creatorNotesVariants: NoteLanguageRow[]
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
		/**
		 * 🚧 The card's timbre (speech build) — not a column: a save writes
		 * it into `extensions.serenepub.timbre`.
		 */
		timbre: TimbreDraft
	}

	// Zod validation schema
	const characterSchema = z
		.object({
			name: z.string().min(1, "Name is required").trim(),
			nickname: z.string().optional(),
			description: z.string().trim(),
			personality: z.string().optional(),
			scenario: z.string().optional(),
			greetings: z
				.array(
					z.object({
						text: z.string(),
						groupOnly: z.boolean().optional()
					})
				)
				.optional(),
			exampleDialogues: z.array(z.string()).optional(),
			creatorNotes: z.string().optional(),
			creatorNotesLang: z.string().optional(),
			creatorNotesVariants: z
				.array(z.object({ lang: z.string(), text: z.string() }))
				.optional(),
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
		})
		.superRefine((v, ctx) => {
			// With strokes, the description is compiled from them: required
			// only while the card is one text.
			if (!v.strokes?.length && !v.description)
				ctx.addIssue({
					code: "custom",
					path: ["description"],
					message: "Description is required"
				})
			const languages = noteLanguageProblem({
				creatorNotes: v.creatorNotes ?? "",
				creatorNotesLang: v.creatorNotesLang ?? "",
				creatorNotesVariants: v.creatorNotesVariants ?? []
			})
			if (languages)
				ctx.addIssue({
					code: "custom",
					path: ["creatorNotesLanguages"],
					message: languages
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
	const advanced = $derived(showsAdvancedControls(userSettingsCtx?.settings))

	/**
	 * The cast line (plans/PLAN-cast-retold-fields-2026-10-13.md): which cast
	 * members this card represents, and which of them retell parts of it.
	 */
	const panelsCtx = getContext<PanelsCtx | undefined>("panelsCtx")
	let castMembers: CastBannerMember[] = $state([])

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
	let castAsk = $state(0)
	let castAskedFor: number | null = null
	$effect(() => {
		void castAsk
		const askFor = mode === "edit" && characterId ? characterId : null
		// A re-ask for the same card keeps the line until the reply lands.
		if (castAskedFor !== askFor) castMembers = []
		castAskedFor = askFor
		if (!askFor) return
		return requestWithInterest(
			"lorebooks:bindingsForCharacter",
			{ characterId: askFor },
			handleCastBindings
		)
	})

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
		greetings: [],
		exampleDialogues: [],
		creatorNotes: "",
		creatorNotesLang: "",
		creatorNotesVariants: [],
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
		likeness: { prompt: "", negative: "" },
		timbre: { ...EMPTY_TIMBRE_DRAFT, settings: {} }
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
		greetings: [],
		exampleDialogues: [],
		creatorNotes: "",
		creatorNotesLang: "",
		creatorNotesVariants: [],
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
		likeness: { prompt: "", negative: "" },
		timbre: { ...EMPTY_TIMBRE_DRAFT, settings: {} }
	})
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
			"greetings",
			"scenario",
			"exampleDialogues",
			"postHistoryInstructions",
			"strokesPersonality"
		],
		notes: ["creatorNotes", "creatorNotesLang", "creatorNotesLanguages"],
		likeness: [],
		speech: [],
		stats: []
	}

	function tabHasError(tab: FormTab): boolean {
		return TAB_FIELDS[tab].some((field) => !!validationErrors[field])
	}

	/** The strip's tabs, each carrying whether its group currently fails. */
	let formTabs = $derived(
		FORM_TABS.map((tab) => ({ ...tab, hasError: tabHasError(tab.value) }))
	)

	/** Field hints, now the fields' titles (polish parity L5, STYLE-GUIDE §6.4). */
	const ALIASES_HINT =
		"Other names they go by; when lore is looked up, a mention of one counts as a mention of them."
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
	/** The save in flight is a Save as new version. */
	let savingAsNewVersion = false

	// ── Card versions ────────────────────────────────────────────────────
	/** Every card version of this card, by number ascending (edit mode). */
	let cardVersions: CardVersionOption[] = $state([])
	/** The card version the form shows and a save writes. */
	let shownCardVersionId: number | undefined = $state(undefined)
	// Who editing the shown version changes: only members on that version.
	const castEdit = $derived(castEditParts(castMembers, shownCardVersionId))
	let currentCardVersionId: number | undefined = $state(undefined)
	/** Cast members that stay on an older card version after the last Save as new version. */
	let stayingMembers: StayingCastMember[] = $state([])
	const shownVersion = $derived(
		cardVersions.find((v) => v.id === shownCardVersionId)
	)
	const currentVersion = $derived(
		cardVersions.find((v) => v.id === currentCardVersionId)
	)
	const stayingLines = $derived(stayingGroups(stayingMembers, cardVersions))
	let showVersionSwitchModal = $state(false)
	let pendingCardVersionId: number | undefined = $state(undefined)
	let showNewVersionDialog = $state(false)
	let newVersionLabel = $state("")
	let validationErrors: ValidationErrors = $state({})
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
		return existingTag?.colorPreset || "bg-primary-500/20 text-primary-ink"
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
		return strokesForSave(
			$state.snapshot(editCharacterData.strokes) as Stroke[],
			{
				description: editCharacterData.description,
				personality: editCharacterData.personality
			}
		)
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
			const key =
				kind === "personality"
					? "strokesPersonality"
					: "strokesDescription"
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
		const { greetings, creatorNotesLang, creatorNotesVariants, ...draft } =
			$state.snapshot(editCharacterData)
		return characterForSave({
			...draft,
			// The wire still speaks the columns (cardDraft.ts).
			...greetingColumnsOf(greetings),
			...notesColumnsOf({
				creatorNotes: draft.creatorNotes,
				creatorNotesLang,
				creatorNotesVariants
			}),
			strokes: draft.strokes as Stroke[]
		})
	}

	/** The card's stored extensions, for the timbre write (kept whole). */
	let storedExtensions: unknown = $state(undefined)
	const userCtxForVoice:
		| { user?: { isAdmin?: boolean | null } | null }
		| undefined = getContext("userCtx")
	const mayPickVoice = $derived(canPickVoice(userCtxForVoice?.user))

	/** `extensions` for a save: only when the timbre moved. */
	function savedExtensions() {
		return extensionsForSave(
			storedExtensions,
			$state.snapshot(editCharacterData.timbre),
			$state.snapshot(originalCharacterData.timbre),
			{ canPickVoice: mayPickVoice }
		)
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
		const {
			likeness: _likeness,
			timbre: _timbre,
			...newCharacter
		} = savedCharacter()
		const extensions = savedExtensions()
		if (extensions) (newCharacter as any).extensions = extensions
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

	function handleUpdate(newVersion?: { label: string | null }) {
		const {
			likeness: _likeness,
			timbre: _timbre,
			...updatedCharacter
		} = savedCharacter()
		const extensions = savedExtensions()
		if (extensions) (updatedCharacter as any).extensions = extensions
		if (!updatedCharacter.id) return
		savingAsNewVersion = !!newVersion
		const avatarFile = updatedCharacter._avatarFile
		delete updatedCharacter._avatarFile
		isSaving = true
		socket.emit("characters:update", {
			likeness: savedLikeness(),
			character: { ...updatedCharacter, id: updatedCharacter.id },
			// See handleCreate() above re: File → Buffer wire conversion.
			avatarFile: avatarFile as unknown as Buffer | undefined,
			// The card version shown is the one written; an in-place save with
			// a changed version label renames it (the server ignores empty).
			...(shownCardVersionId !== undefined
				? { cardVersionId: shownCardVersionId }
				: {}),
			...(newVersion ? { saveAsNewVersion: newVersion } : {})
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

	/**
	 * The picker: another card version loads into the form. Unsaved changes ask
	 * first (STYLE-GUIDE §6.14: ask first, then discard).
	 */
	function onPickCardVersion(
		event: Event & { currentTarget: HTMLSelectElement }
	) {
		const picked = Number(event.currentTarget.value)
		if (
			!Number.isFinite(picked) ||
			picked === shownCardVersionId ||
			!characterId
		)
			return
		if (hasChanges) {
			// The select shows the version still on screen until the answer.
			event.currentTarget.value = String(shownCardVersionId)
			pendingCardVersionId = picked
			showVersionSwitchModal = true
			return
		}
		loadCardVersion(picked)
	}

	function loadCardVersion(cardVersionId: number) {
		if (!characterId) return
		stayingMembers = []
		askCharacter(characterId, cardVersionId)
	}

	function confirmVersionSwitch() {
		showVersionSwitchModal = false
		if (pendingCardVersionId !== undefined)
			loadCardVersion(pendingCardVersionId)
		pendingCardVersionId = undefined
	}

	function cancelVersionSwitch() {
		showVersionSwitchModal = false
		pendingCardVersionId = undefined
	}

	/** Save as new version: validate as a save does, then ask for the label. */
	function openNewVersionDialog() {
		if (isSaving || mode !== "edit" || !character) return
		if (!validateForm()) return
		if (!strokesValid()) return
		const top = highestVersion(cardVersions)
		newVersionLabel = nextVersionLabel(top?.label) ?? ""
		showNewVersionDialog = true
	}

	function confirmNewVersion() {
		if (isSaving) return
		handleUpdate({ label: newVersionLabel.trim() || null })
	}

	// Helper for editing arrays
	function addToArray(arr: string[], value = "") {
		arr.push(value)
	}
	function removeFromArray(arr: string[], idx: number) {
		arr.splice(idx, 1)
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
			notify.success({
				source: "socket:characters:create",
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
		// Only the save THIS form sent may keep it open or move its card
		// version; the same card saved in another tab closes it as before.
		const mine = isSaving
		const asNewVersion = savingAsNewVersion
		isSaving = false
		savingAsNewVersion = false
		if (res.character) {
			// This form's own save moved a card version: ask the cast line
			// again so a member now behind the card shows its update offer.
			if (mine) castAsk++
			avatarPicker?.commitPendingFrame(res.character.avatarMediaId)
			validationErrors = {} // Clear any validation errors on success
			notify.success({
				source: "socket:characters:update",
				title: "Character updated",
				description: `Character "${res.character.name}" updated successfully.`
			})
			// Reset original data to match current state before closing
			originalCharacterData = $state.snapshot(editCharacterData)
			// Directly set hasChanges to false to prevent race condition
			hasChanges = false
			const staying: StayingCastMember[] =
				mine && asNewVersion ? (res.staying ?? []) : []
			if (staying.length && res.cardVersionId !== undefined) {
				// Cast members stay on the older card version: the form stays
				// open on the new one, and the line says who stays.
				showNewVersionDialog = false
				cardVersions = res.cardVersions ?? cardVersions
				currentCardVersionId = res.currentCardVersionId
				shownCardVersionId = res.cardVersionId
				stayingMembers = staying
				askCharacter(res.character.id, res.cardVersionId)
				return
			}
			closeForm()
		}
	}

	function handleCharactersCreateError(msg: Sockets.ErrorResponse) {
		isSaving = false
		notify.error({
			source: "socket:characters:create:error",
			title: "Failed to create character",
			description: msg.error
		})
	}

	function handleCharactersUpdateError(msg: Sockets.ErrorResponse) {
		isSaving = false
		notify.error({
			source: "socket:characters:update:error",
			title: "Failed to update character",
			description: msg.error
		})
	}

	function handleCharactersGet(message: Sockets.Characters.Get.Response) {
		character = message.character
		if (!message.character) return
		cardVersions = message.cardVersions ?? []
		shownCardVersionId = message.cardVersionId
		currentCardVersionId = message.currentCardVersionId
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
			greetings: greetingsOfColumns(characterData),
			exampleDialogues: characterData.exampleDialogues,
			...notesDraftOf(characterData),
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
			timbre: timbreDraftOf(characterData.extensions),
			_avatar: "",
			_avatarFile: undefined
		}
		storedExtensions = characterData.extensions
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
			const id =
				(res as { requestId?: string }).requestId ?? tokenInFlight
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
	let releaseGet: (() => void) | undefined
	/** One `characters:get`, as a one-shot interest; `cardVersionId` asks for another card version than the current one. */
	function askCharacter(id: number, cardVersionId?: number) {
		releaseGet?.()
		const release = declareInterest<"characters:get">(
			interestKey("characters:get", id),
			(msg: Sockets.Characters.Get.Response) => {
				handleCharactersGet(msg)
				release()
				if (releaseGet === release) releaseGet = undefined
			}
		)
		releaseGet = release
		socket.emit(
			"characters:get",
			cardVersionId === undefined ? { id } : { id, cardVersionId }
		)
	}

	$effect(() => {
		if (initialData || !characterId) return
		askCharacter(characterId)
		// Idempotent, so releasing an already-released key is a no-op.
		return () => releaseGet?.()
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
	<PromptBadge {hint} />
{/snippet}

<!-- The delete on one row of an array editor: an icon at the row's top-right,
     so a list of textareas stays a list rather than alternating field, button,
     field, button. -->
{#snippet removeRowButton(label: string, onRemove: () => void)}
	<RemoveRowButton {label} {onRemove} />
{/snippet}

{#snippet addRowButton(label: string, onAdd: () => void)}
	<AddRowButton {label} {onAdd} />
{/snippet}

<!-- Save, labelled. Filled primary only while there is something to save: a
     permanently lit call to action stops being one. -->
{#snippet saveButton()}
	<div class="flex shrink-0 items-center gap-2">
		{#if mode === "edit"}
			<button
				type="button"
				class="btn btn-sm preset-tonal-surface shrink-0"
				onclick={openNewVersionDialog}
				disabled={isSaving}
				data-save-as-new-version
			>
				<Icons.CopyPlus size={16} aria-hidden="true" />
				Save as new version
			</button>
		{/if}
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
	</div>
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
						editCharacterData.nickname ||
						editCharacterData.name ||
						"this"
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
					{@render versionLine()}
				</div>
			</fieldset>
		{:else}
			<div class="flex flex-col gap-2">
				<div class="grid grid-cols-1 gap-3 @lg/view:grid-cols-2">
					{@render nameField()}
					{@render nicknameField()}
				</div>
				{@render castLine()}
				{@render versionLine()}
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
							<ProseField
								id="charDescription"
								label="Description"
								required
								hint="This field will be visible in prompts"
								rows={8}
								bind:value={editCharacterData.description}
								class={validationErrors.description
									? "border-error-500 focus:border-error-500"
									: ""}
								placeholder="Description..."
								invalid={!!validationErrors.description}
								describedBy={validationErrors.description
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
							/>
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
						<p
							class="text-error-600-400 -mt-2 text-sm"
							role="alert"
						>
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
			{#if advanced}
				<section class="panel-card">
					<h2 class="mb-3 text-sm font-medium">Card metadata</h2>
					<div class="grid grid-cols-1 gap-3 @lg/view:grid-cols-3">
						<div class="flex flex-col">
							<label
								class="text-surface-600-400 mb-1.5 text-xs"
								for="charVersion"
							>
								Version label
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
							<ProseField
								id="charPersonality"
								label="Personality"
								hint="This field will be visible in prompts"
								rows={8}
								bind:value={editCharacterData.personality}
								placeholder="Personality..."
							/>
						{/snippet}
					</StrokeField>
					{#if validationErrors.strokesPersonality && editCharacterData.strokes.length}
						<p
							class="text-error-600-400 -mt-2 text-sm"
							role="alert"
						>
							{validationErrors.strokesPersonality}
						</p>
					{/if}
					{#if advanced}
						<div class="flex flex-col">
							<ProseField
								id="charScenario"
								label="Scenario"
								hint="This field will be visible in prompts (excluded from group sessions)"
								rows={8}
								bind:value={editCharacterData.scenario}
								placeholder="Scenario..."
							/>
						</div>
					{/if}
				</div>
			</section>
			<section class="panel-card">
				<h2 class="mb-3 text-sm font-medium">Greetings</h2>
				<div class="flex flex-col gap-3">
					{#if advanced}
						<p class="text-surface-600-400 text-xs">
							A new session opens with the first greeting and
							offers the others as swipes; a group session uses
							the ones marked for it, when there are any.
						</p>
						<GreetingsList
							greetings={editCharacterData.greetings}
							onText={(i, text) =>
								(editCharacterData.greetings[i].text = text)}
							onGroupOnly={(i, groupOnly) => {
								// Absent, not false, when unmarked: changing and changing back stays clean.
								const text = editCharacterData.greetings[i].text
								editCharacterData.greetings[i] = groupOnly
									? { text, groupOnly: true }
									: { text }
							}}
							onRemove={(i) =>
								editCharacterData.greetings.splice(i, 1)}
							onAdd={() =>
								editCharacterData.greetings.push({ text: "" })}
						/>
					{:else}
						<div class="flex flex-col">
							<label
								class="text-surface-600-400 mb-1.5 text-xs"
								for="charFirstMessage"
							>
								First greeting
							</label>
							<textarea
								id="charFirstMessage"
								rows="8"
								value={editCharacterData.greetings[
									openerIndex(editCharacterData.greetings)
								]?.text ?? ""}
								oninput={(e) =>
									(editCharacterData.greetings =
										withOpenerText(
											editCharacterData.greetings,
											e.currentTarget.value
										))}
								class={FIELD_CLASS}
								placeholder="First greeting..."
							></textarea>
						</div>
					{/if}
				</div>
			</section>
			{#if advanced}
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
						<ProseField
							id="charPostHistory"
							label="Post-history instructions"
							hint="This field will be visible in prompts"
							rows={4}
							bind:value={
								editCharacterData.postHistoryInstructions
							}
							placeholder="Stay in character and keep replies short…"
							title="Placed after the conversation, just before the reply; good for style reminders."
						/>
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
				<CreatorNotesFields
					textId="charCreatorNotes"
					langId="charCreatorNotesLang"
					bind:text={editCharacterData.creatorNotes}
					bind:lang={editCharacterData.creatorNotesLang}
					bind:variants={editCharacterData.creatorNotesVariants}
					languages={advanced}
					error={validationErrors.creatorNotesLanguages}
				/>
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
			id="character-panel-speech"
			role="tabpanel"
			aria-labelledby="character-panel-speech-tab"
			hidden={activeFormTab !== "speech"}
			class="space-y-3"
		>
			<VoiceTab
				characterName={editCharacterData.name}
				bind:timbre={editCharacterData.timbre}
				openVoices={panelsCtx
					? () => openInLoadouts(panelsCtx, {})
					: undefined}
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

		<!-- The "Some controls are hidden" line, shown only while advanced
		     controls are off; it turns them on in place. -->
		{#if !advanced}
			<div
				class="pt-2"
				hidden={activeFormTab === "stats" ||
					activeFormTab === "likeness" ||
					activeFormTab === "speech"}
			>
				<AdvancedHiddenLine />
			</div>
		{/if}
	</div>
</div>

<!-- The cast line (polish parity L5; it was a banner card over the form): one
     muted line under the name, each lorebook's name opening that member. How
     many members, which retell parts of the card, and what a card is ride its
     title. Absent outside the shell, the names are plain text. -->
{#snippet castLine()}
	<CastLine members={castMembers} onChanged={() => castAsk++} />
	{#if castEdit}
		<p class="text-surface-600-400 text-xs" data-cast-edit-note>
			{#each castEdit as part, i (i)}{#if typeof part === "string"}{part}{:else if panelsCtx}<button
						type="button"
						class="text-primary-ink underline-offset-2 hover:underline"
						aria-label="Open this card's cast member in {part.lorebookName}"
						onclick={() => openCastMember(panelsCtx, part)}
					>
						{part.lorebookName}
					</button>{:else}{part.lorebookName}{/if}{/each}
		</p>
	{/if}
	{#if stayingLines.length}
		<!-- After a Save as new version: who stays on the older card version,
		     each name a link to that member (as the cast line does). -->
		<p class="text-surface-600-400 text-xs" data-staying-line>
			{#each stayingLines as group, g (g)}
				{group.lead}{" "}{#each group.members as member, i (member.castMemberId)}{#if i > 0},{" "}{/if}{#if panelsCtx}<button
							type="button"
							class="text-primary-ink underline-offset-2 hover:underline"
							onclick={() =>
								openCastMember(panelsCtx, {
									lorebookId: member.lorebookId,
									castId: member.castMemberId
								})}
						>
							{member.name}
						</button>{:else}{member.name}{/if}{/each}{g <
				stayingLines.length - 1
					? "; "
					: "."}
			{/each}
		</p>
	{/if}
{/snippet}

<!-- The card version picker (edit mode, more than one card version). In the
     hero rather than beside the Version label field, which sits under
     advanced controls: reaching an older card version must not depend on it. -->
{#snippet versionLine()}
	{#if mode === "edit" && cardVersions.length > 1}
		<div class="flex flex-col gap-1" data-card-version-picker>
			<select
				class="select w-auto max-w-full self-start text-sm"
				aria-label="Card version"
				value={shownCardVersionId}
				onchange={onPickCardVersion}
			>
				{#each cardVersions as version (version.id)}
					<option value={version.id}>
						{versionOptionText(version, currentCardVersionId)}
					</option>
				{/each}
			</select>
			{#if shownVersion && currentVersion && shownVersion.id !== currentVersion.id}
				<p class="text-surface-600-400 text-xs" data-card-version-note>
					{inPlaceNote(shownVersion, currentVersion)}
				</p>
			{/if}
		</div>
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
			<p
				class="text-error-600-400 mt-1 text-sm"
				id="name-error"
				role="alert"
			>
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

<CharacterUnsavedChangesModal
	open={showVersionSwitchModal}
	onOpenChange={(e) => {
		if (!e.open) cancelVersionSwitch()
	}}
	onConfirm={confirmVersionSwitch}
	onCancel={cancelVersionSwitch}
/>

<Dialog
	open={showNewVersionDialog}
	onOpenChange={(e) => (showNewVersionDialog = e.open)}
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
				data-new-version-dialog
			>
				<Dialog.Title class="text-lg font-semibold">
					Save as new version
				</Dialog.Title>
				<form
					class="space-y-4"
					onsubmit={(e) => {
						e.preventDefault()
						confirmNewVersion()
					}}
				>
					<div class="flex flex-col">
						<label
							class="text-surface-600-400 mb-1.5 text-xs"
							for="newVersionLabel"
						>
							Version label
						</label>
						<input
							id="newVersionLabel"
							type="text"
							bind:value={newVersionLabel}
							class={FIELD_CLASS}
							placeholder="1.1"
						/>
					</div>
					<footer class="flex justify-end gap-2">
						<button
							type="button"
							class="btn preset-tonal"
							onclick={() => (showNewVersionDialog = false)}
						>
							Cancel
						</button>
						<button
							type="submit"
							class="btn preset-filled-primary-500"
							disabled={isSaving}
							data-new-version-confirm
						>
							Save as new version
						</button>
					</footer>
				</form>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>

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
							{offStrokes === 1 ? "stroke is" : "strokes are"} off
							and will not be kept.
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
