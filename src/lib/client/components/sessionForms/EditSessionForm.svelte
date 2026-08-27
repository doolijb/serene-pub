<script lang="ts">
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import CharacterSelectModal from "../modals/CharacterSelectModal.svelte"
	import PersonaSelectModal from "../modals/PersonaSelectModal.svelte"
	import ReassignSessionParticipantModal from "../modals/ReassignSessionParticipantModal.svelte"
	import UserSelectModal from "../modals/UserSelectModal.svelte"
	import Avatar from "../Avatar.svelte"
	import * as Icons from "@lucide/svelte"
	import { dndzone } from "svelte-dnd-action"
	import RemoveFromSessionModal from "../modals/RemoveFromSessionModal.svelte"
	import SessionsUnsavedChangesModal from "../modals/SessionsUnsavedChangesModal.svelte"
	import { onDestroy, onMount, getContext, untrack } from "svelte"
	import { Switch, Tabs } from "@skeletonlabs/skeleton-svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { GroupReplyStrategies } from "$lib/shared/constants/GroupReplyStrategies"
	import { SessionCharacterVisibility } from "$lib/shared/constants/SessionCharacterVisibility"
	import { resolveUserHandle } from "$lib/shared/utils/resolveCharacterName"
	import { z } from "zod"
	import ConnectionSamplingPicker from "../ConnectionSamplingPicker.svelte"
	import SchemaForm from "../pipelines/SchemaForm.svelte"
	import PipelineConfigOptions from "../pipelines/PipelineConfigOptions.svelte"

	// The F29 floor (19 §2) — stated here rather than imported from the
	// server-only sessionModes module. When "sessions:modes" returns nothing (a
	// registry that never synced), the form behaves exactly as before modes
	// existed: no picker, every section shown, today's save rules.
	const STANDARD_MODE_ID = "core:input/user-message@1"

	// Zod validation schema
	const sessionSchema = z.object({
		name: z.string().min(1, "Session name is required").trim(),
		scenario: z.string().optional(),
		groupReplyStrategy: z.string().optional()
	})

	type ValidationErrors = Record<string, string>

	interface Props {
		editSessionId?: number | null // If provided, edit mode; else create mode
		showEditSessionForm: boolean // Controls visibility of the form
		hasChanges?: boolean // Track if the form has unsaved changes
		onClose?: () => void
	}

	let {
		editSessionId = $bindable(null),
		showEditSessionForm = $bindable(),
		hasChanges = $bindable(false),
		onClose
	}: Props = $props()

	const socket = useTypedSocket()

	// STATE VARIABLES

	// Tag-related state
	let tagsList: SelectTag[] = $state([])
	let tagSearchInput = $state("")
	let showTagSuggestions = $state(false)
	let selectedTags: string[] = $state([])

	let session: Sockets.Sessions.Get.Response["session"] | undefined = $state()
	let isCreating = $state(untrack(() => !session))
	let characters: Sockets.Characters.List.Response["characterList"] = $state(
		[]
	)
	let personas: Sockets.Personas.List.Response["personaList"] = $state([])
	let lorebookList: Sockets.Lorebooks.List.Response["lorebookList"] = $state(
		[]
	)

	// Data structure to hold session and selected characters/personas
	let data:
		| {
				session: {
					id: number | undefined
					name: string
					scenario: string
					groupReplyStrategy: string
					lorebookId?: number | null
					tags: string[]
					connectionId?: number | null
					samplingConfigId?: number | null
					promptConfigId?: number | null
					narratorPromptConfigId?: number | null
					modeId?: string
					modeFields?: Record<string, unknown>
				}
				characterIds: number[]
				personaIds: number[]
				guestIds: number[]
				characterPositions: Record<number, number>
		  }
		| undefined = $state()

	let originalData:
		| {
				session: {
					id: number | undefined
					name: string
					scenario: string
					groupReplyStrategy: string
					lorebookId?: number | null
					tags: string[]
					connectionId?: number | null
					samplingConfigId?: number | null
					promptConfigId?: number | null
					narratorPromptConfigId?: number | null
					modeId?: string
					modeFields?: Record<string, unknown>
				}
				characterIds: number[]
				personaIds: number[]
				guestIds: number[]
				characterPositions: Record<number, number>
		  }
		| undefined = $state()

	// DATA FIELDS
	let name = $state("")
	let scenario = $state("")
	let groupReplyStrategy = $state("ordered")
	let lorebookId: number | null = $state(null)
	let sessionConnectionId: number | null = $state(null)
	let sessionSamplingConfigId: number | null = $state(null)
	let sessionPromptConfigId: number | null = $state(null)
	let narratorPromptConfigId: number | null = $state(null)

	// CHAT MODE (19 §2, U-C2)
	let modesList: Sockets.Sessions.Modes.Response["modes"] = $state([])
	let modeId: string = $state(STANDARD_MODE_ID)
	let modeFields: Record<string, unknown> = $state({})

	// The selected mode's shape, or null when the mode is unknown to this
	// build — in which case the form falls back to today's behaviour (every
	// capability shown), the F29 posture.
	let modeShape = $derived(
		modesList.find((m) => m.modeId === modeId)?.shape ?? null
	)
	// A capability the shape omits (or caps at zero) does not exist for the
	// session: its section disappears rather than rendering an un-fillable
	// requirement. No shape at all means "behave as before modes existed".
	let showCharactersSection = $derived(
		!modeShape ||
			(!!modeShape.characters && (modeShape.characters.max ?? 1) !== 0)
	)
	let showPersonasSection = $derived(
		!modeShape ||
			(!!modeShape.personas && (modeShape.personas.max ?? 1) !== 0)
	)
	let showLorebookField = $derived(!modeShape || !!modeShape.lorebook)
	// Save floors: a non-standard mode's shape speaks for itself. The
	// standard mode keeps the form's historical ≥1 character / ≥1 persona
	// floor even though its shape says min 0 — the shape states what the
	// *server* permits, and relaxing the form here would change today's
	// creation UX, which the parity posture forbids.
	let charactersFloor = $derived(
		!modeShape || modeId === STANDARD_MODE_ID
			? 1
			: (modeShape.characters?.min ?? 0)
	)
	let personasFloor = $derived(
		!modeShape || modeId === STANDARD_MODE_ID
			? 1
			: (modeShape.personas?.min ?? 0)
	)
	// The mode's declared per-session fields (SettingsSchema), rendered through
	// the one schema renderer in session settings.
	let modeFieldDecls = $derived(modeShape?.fields ?? {})

	// AI override lists (admin only)
	let adminConnectionsList: Sockets.Connections.List.Response["connectionsList"] =
		$state([])
	let adminSamplingList: Sockets.SamplingConfigs.List.Response["samplingConfigsList"] =
		$state([])
	let adminPromptConfigsList: Sockets.PromptConfigs.List.Response["promptConfigsList"] =
		$state([])
	let adminNarratorPromptConfigsList: Sockets.NarratorPromptConfigs.List.Response["narratorPromptConfigsList"] =
		$state([])

	let activeSessionTab = $state<"participants" | "settings" | "visibility">(
		"participants"
	)

	// The pipelines involved in this chat (respond + enabled contributed
	// functions like narrate), each rendered as its own settings card at
	// session scope. Fetched lazily when the Settings tab opens.
	let sessionPipelines: Sockets.Sessions.Pipelines.Pipeline[] = $state([])
	const handleSessionsPipelines = (
		msg: Sockets.Sessions.Pipelines.Response
	) => {
		if (msg.sessionId === editSessionId) sessionPipelines = msg.pipelines
	}

	// The account-visibility view (design §4): what of the current user's data
	// this session exposes to its other participants. Fetched lazily when the
	// tab opens.
	let accountVisibility = $state<
		Sockets.Sessions.AccountVisibility.Response | undefined
	>(undefined)

	// MODALS
	let showCharacterModal = $state(false)
	let showPersonaModal = $state(false)
	let showGuestModal = $state(false)
	let showReassignModal = $state(false)
	let reassignTarget: {
		type: "character" | "persona"
		oldId: number
		name: string
	} | null = $state(null)

	// FORM SUBMIT STATE
	let isDirty: boolean = $derived(
		JSON.stringify(data) !== JSON.stringify(originalData)
	)
	let canSave: boolean = $derived(
		// Name plus the mode's participant floors — for the standard mode
		// these are the historical ≥1/≥1, so nothing changes there.
		!!(
			data?.session.name.trim() &&
			(data?.characterIds.length ?? 0) >= charactersFloor &&
			(data?.personaIds.length ?? 0) >= personasFloor
		)
	)

	// Sync hasChanges with isDirty
	$effect(() => {
		hasChanges = isDirty
	})

	// Initialize data for new session creation
	$effect(() => {
		if (showEditSessionForm && !editSessionId && !data) {
			data = {
				session: {
					id: undefined,
					name: "",
					scenario: "",
					groupReplyStrategy: "ordered",
					lorebookId: null,
					tags: [],
					connectionId: null,
					samplingConfigId: null,
					promptConfigId: null,
					narratorPromptConfigId: null
				},
				characterIds: [],
				personaIds: [],
				guestIds: [],
				characterPositions: {}
			}
			originalData = JSON.parse(JSON.stringify(data))
		}
	})

	// SELECTED CHARACTERS AND PERSONAS
	// Populated either from the full session load (session.sessionCharacters/Personas,
	// which carry the complete row) or from CharacterSelectModal/
	// PersonaSelectModal (which only carry the display-column subset from
	// "characters:list"/"personas:list") — Partial<...> reflects the latter.
	let selectedCharacters: (Partial<SelectCharacter> & { id: number })[] =
		$state([])
	let selectedPersonas: (Partial<SelectPersona> & { id: number })[] = $state(
		[]
	)
	let selectedGuests: NonNullable<
		NonNullable<Sockets.Sessions.Get.Response["session"]>["sessionGuests"]
	> = $state([])
	let showRemoveModal = $state(false)
	let removeType: "character" | "persona" | "guest" = $state("character")
	let removeName = $state("")
	let removeId: number | null = $state(null)
	let validationErrors: ValidationErrors = $state({})
	let userCtx: UserCtx = getContext("userCtx")
	let systemSettingsCtx: SystemSettingsCtx = getContext("systemSettingsCtx")

	// A guest (session participant who isn't the owner) may manage characters/
	// personas/guests on this session but not session-level settings (name,
	// scenario, lorebook, tags, response mode, AI overrides) — mirrors the
	// same restriction enforced server-side in sessionsUpdateHandler, which
	// silently ignores those fields for non-owners regardless of what this
	// form sends, so this is UX clarity, not the actual security boundary.
	let isGuest: boolean = $derived(
		!!session && session.userId !== userCtx.user?.id
	)

	// Filtered tags for suggestions
	let filteredTags = $derived.by(() => {
		if (!tagSearchInput)
			return tagsList.filter(
				(tag) =>
					!selectedTags.some(
						(selectedTag) =>
							selectedTag.toLowerCase() === tag.name.toLowerCase()
					)
			)
		return tagsList.filter(
			(tag) =>
				tag.name.toLowerCase().includes(tagSearchInput.toLowerCase()) &&
				!selectedTags.some(
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
		const isDuplicate = selectedTags.some(
			(existingTag) =>
				existingTag.toLowerCase() === trimmedName.toLowerCase()
		)
		if (isDuplicate) return

		selectedTags = [...selectedTags, trimmedName]
		tagSearchInput = ""
		showTagSuggestions = false
	}

	function removeTag(tagName: string) {
		selectedTags = selectedTags.filter((tag) => tag !== tagName)
	}

	$effect(() => {
		const _name = name.trim()
		const _scenario = scenario.trim()
		const _groupReplyStrategy = groupReplyStrategy || "ordered"
		const _selectedCharacters = selectedCharacters
		const _selectedPersonas = selectedPersonas
		const _selectedGuests = selectedGuests
		const _lorebookId = lorebookId || null
		const _tags = selectedTags
		const _connectionId = sessionConnectionId
		const _samplingConfigId = sessionSamplingConfigId
		const _promptConfigId = sessionPromptConfigId
		const _narratorPromptConfigId = narratorPromptConfigId
		const _modeId = modeId
		const _modeFields = JSON.parse(JSON.stringify(modeFields))
		data = {
			session: {
				id: session?.id,
				name: _name,
				scenario: _scenario,
				groupReplyStrategy: _groupReplyStrategy || "ordered",
				lorebookId: _lorebookId,
				tags: _tags,
				connectionId: _connectionId,
				samplingConfigId: _samplingConfigId,
				promptConfigId: _promptConfigId,
				narratorPromptConfigId: _narratorPromptConfigId,
				modeId: _modeId,
				modeFields: _modeFields
			},
			characterIds: _selectedCharacters.map((cc) => cc.id),
			personaIds: _selectedPersonas.map((cp) => cp.id),
			guestIds: _selectedGuests.map((g) => g.userId),
			characterPositions: Object.fromEntries(
				_selectedCharacters.map((cc, i) => [cc.id, i])
			)
		}

		if (!originalData) {
			originalData = JSON.parse(JSON.stringify(data))
		}
	})

	$effect(() => {
		if (editSessionId) {
			socket.emit("sessions:get", { id: editSessionId })
		}
	})

	function handleAddCharacter(
		char: Partial<SelectCharacter> & { id: number }
	) {
		if (!selectedCharacters.some((c) => c.id === char.id))
			selectedCharacters = [...selectedCharacters, char]
		showCharacterModal = false
		// Update data to reflect the new character
		if (data) {
			data = {
				...data,
				characterIds: selectedCharacters.map((c) => c.id),
				characterPositions: Object.fromEntries(
					selectedCharacters.map((cc, i) => [cc.id, i])
				)
			}
		}
	}

	function handleRemoveCharacter(id: number) {
		selectedCharacters = selectedCharacters.filter((c) => c.id !== id)
		// Update data to reflect removed character
		if (data) {
			data = {
				...data,
				characterIds: selectedCharacters.map((c) => c.id),
				characterPositions: Object.fromEntries(
					selectedCharacters.map((cc, i) => [cc.id, i])
				)
			}
		}
	}

	function handleAddPersona(p: Partial<SelectPersona> & { id: number }) {
		if (!selectedPersonas.some((pp) => pp.id === p.id))
			selectedPersonas = [...selectedPersonas, p]
		showPersonaModal = false
		// Update data to reflect the new persona
		if (data) {
			data = {
				...data,
				personaIds: selectedPersonas.map((p) => p.id)
			}
		}
	}

	function handleRemovePersona(id: number) {
		selectedPersonas = selectedPersonas.filter((p) => p.id !== id)
		// Update data to reflect removed persona
		if (data) {
			data = {
				...data,
				personaIds: selectedPersonas.map((p) => p.id)
			}
		}
	}

	// Removed (soft-deleted) participants — kept out of selectedCharacters/
	// selectedPersonas above, surfaced here instead with a way to reassign
	// their message history onto a new character/persona. Display-name
	// precedence: prefer the live entity's name if it still exists (a
	// rename should still show up here), fall back to the removedName
	// snapshot only once the entity itself is gone — same rule as
	// getMessageCharacter on the session page.
	let removedCharacters = $derived(
		(session?.sessionCharacters || [])
			.filter((cc) => cc.removedAt)
			.map((cc) => ({
				id: cc.characterId!,
				name:
					cc.character?.nickname ||
					cc.character?.name ||
					cc.removedName ||
					"Unknown"
			}))
	)
	let removedPersonas = $derived(
		(session?.sessionPersonas || [])
			.filter((cp) => cp.removedAt)
			.map((cp) => ({
				id: cp.personaId!,
				name: cp.persona?.name || cp.removedName || "Unknown"
			}))
	)

	function openReassignModal(
		type: "character" | "persona",
		oldId: number,
		name: string
	) {
		reassignTarget = { type, oldId, name }
		showReassignModal = true
	}

	function handleReassignSelect(newId: number) {
		if (!session?.id || !reassignTarget) return
		const req: Sockets.Sessions.ReassignRemovedParticipant.Params = {
			sessionId: session.id,
			type: reassignTarget.type,
			oldId: reassignTarget.oldId,
			newId
		}
		socket.emit("sessions:reassignRemovedParticipant", req)
		showReassignModal = false
		reassignTarget = null
	}

	function handleAddGuests(userIds: number[]) {
		if (!session?.id) return
		const sessionId = session.id

		// Add each guest via socket
		userIds.forEach((userId) => {
			const req: Sockets.Sessions.AddGuest.Params = {
				sessionId,
				guestUserId: userId
			}
			socket.emit("sessions:addGuest", req)
		})
		showGuestModal = false
	}

	function handleRemoveGuest(userId: number) {
		if (!session?.id) return

		const req: Sockets.Sessions.RemoveGuest.Params = {
			sessionId: session.id,
			guestUserId: userId
		}
		socket.emit("sessions:removeGuest", req)
	}

	function handleSave() {
		// Re-fit held data to the mode before anything reads it (19 §2) — a
		// leftover from a different creation pick must not ride the commit.
		reconcileToMode()
		if (!validateForm()) return
		if (
			!data?.session.name.trim() ||
			selectedCharacters.length < charactersFloor ||
			selectedPersonas.length < personasFloor
		)
			return

		// Ensure data is synced with current selections
		const characterIds = selectedCharacters.map((c) => c.id)
		const personaIds = selectedPersonas.map((p) => p.id)
		const characterPositions = Object.fromEntries(
			selectedCharacters.map((cc, i) => [cc.id, i])
		)

		// Update data to ensure everything is in sync
		if (data) {
			data = {
				...data,
				characterIds,
				personaIds,
				characterPositions,
				session: {
					...data.session,
					name: name.trim(),
					scenario: scenario.trim(),
					groupReplyStrategy: groupReplyStrategy
				}
			}
		}

		if (session && session.id) {
			// modeId rides in `data` but the server ignores it on update —
			// switching an existing session's mode is an open policy question
			// (19 §10). modeFields does land, filtered to declared keys.
			const updateSession: Sockets.Sessions.Update.Params = {
				...data!,
				session: {
					...data!.session,
					id: session.id
				}
			}
			socket.emit("sessions:update", updateSession)
		} else {
			const createSession: Sockets.Sessions.Create.Params = {
				session: {
					name: name.trim(),
					scenario: scenario.trim(),
					groupReplyStrategy: groupReplyStrategy,
					lorebookId: lorebookId,
					connectionId: sessionConnectionId,
					samplingConfigId: sessionSamplingConfigId,
					promptConfigId: sessionPromptConfigId,
					narratorPromptConfigId: narratorPromptConfigId,
					modeId,
					modeFields
				},
				characterIds,
				personaIds,
				characterPositions,
				tags: selectedTags
			}
			socket.emit("sessions:create", createSession)
		}
		isCreating = false
	}

	// Touch-friendly alternative to the drag handle above — dndzone works fine
	// with a mouse but has no keyboard/touch-tap equivalent on its own.
	function moveCharacterUp(index: number) {
		if (index <= 0) return
		const next = selectedCharacters.slice()
		;[next[index - 1], next[index]] = [next[index], next[index - 1]]
		selectedCharacters = next
	}

	function moveCharacterDown(index: number) {
		if (index >= selectedCharacters.length - 1) return
		const next = selectedCharacters.slice()
		;[next[index], next[index + 1]] = [next[index + 1], next[index]]
		selectedCharacters = next
	}

	function movePersonaUp(index: number) {
		if (index <= 0) return
		const next = selectedPersonas.slice()
		;[next[index - 1], next[index]] = [next[index], next[index - 1]]
		selectedPersonas = next
	}

	function movePersonaDown(index: number) {
		if (index >= selectedPersonas.length - 1) return
		const next = selectedPersonas.slice()
		;[next[index], next[index + 1]] = [next[index + 1], next[index]]
		selectedPersonas = next
	}

	function confirmRemoveCharacter(id: number, name: string) {
		removeType = "character"
		removeName = name
		removeId = id
		showRemoveModal = true
	}

	function confirmRemovePersona(id: number, name: string) {
		removeType = "persona"
		removeName = name
		removeId = id
		showRemoveModal = true
	}

	function confirmRemoveGuest(userId: number, username: string) {
		removeType = "guest"
		removeName = username
		removeId = userId
		showRemoveModal = true
	}

	function handleRemoveConfirm() {
		if (removeType === "character") handleRemoveCharacter(removeId!)
		else if (removeType === "persona") handleRemovePersona(removeId!)
		else if (removeType === "guest") handleRemoveGuest(removeId!)
		showRemoveModal = false
		removeId = null
		removeName = ""
	}

	function handleRemoveCancel() {
		showRemoveModal = false
		removeId = null
		removeName = ""
	}

	function validateForm(): boolean {
		const result = sessionSchema.safeParse({
			name: name,
			scenario: scenario,
			groupReplyStrategy: groupReplyStrategy
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

	let showCancelModal = $state(false)

	function handleCloseFormOnOpenChange(e: OpenChangeDetails) {
		if (!e.open) {
			showCancelModal = false
		}
	}

	function handleCloseForm() {
		if (hasChanges) {
			showCancelModal = true
		} else {
			showEditSessionForm = false
			onClose?.()
		}
	}

	function handleCloseModalDiscard() {
		showCancelModal = false
		showEditSessionForm = false
		onClose?.()
	}

	function handleCloseModalCancel() {
		showCancelModal = false
	}

	// Socket event handlers - defined as named functions for proper cleanup
	const handleSessionsGet = (msg: Sockets.Sessions.Get.Response) => {
		if (msg.session && msg.session.id === editSessionId) {
			// Create new object reference to ensure reactivity
			session = {
				...msg.session,
				sessionCharacters: [...(msg.session.sessionCharacters || [])]
			}
			name = session.name || ""
			scenario = session.scenario || ""
			groupReplyStrategy = session.groupReplyStrategy || "ordered"
			// Removed participants stay out of the editable "active cast"
			// list (and so don't get silently re-submitted on the next
			// Save) — they surface instead in the "Removed" section below.
			selectedCharacters =
				session.sessionCharacters
					?.filter((cc) => !cc.removedAt)
					.map((cc) => cc.character) || []
			selectedPersonas =
				session.sessionPersonas
					?.filter((cp) => !cp.removedAt)
					.map((cp) => cp.persona) || []
			selectedGuests = session.sessionGuests || []
			lorebookId = session.lorebookId || null
			selectedTags = session.tags || []
			sessionConnectionId = session.connectionId ?? null
			sessionSamplingConfigId = session.samplingConfigId ?? null
			sessionPromptConfigId = session.promptConfigId ?? null
			narratorPromptConfigId = session.narratorPromptConfigId ?? null
			modeId = (session as any).modeId ?? STANDARD_MODE_ID
			modeFields = ((session as any).modeFields ?? {}) as Record<
				string,
				unknown
			>
			// Reset originalData to null so it gets re-initialized with the loaded data
			originalData = undefined
		}
	}

	const handleCharactersList = (msg: Sockets.Characters.List.Response) => {
		characters = msg.characterList || []
	}

	const handlePersonasList = (msg: Sockets.Personas.List.Response) => {
		personas = msg.personaList || []
	}

	const handleLorebooksList = (msg: Sockets.Lorebooks.List.Response) => {
		lorebookList = msg.lorebookList || []
	}

	const handleSessionsModes = (msg: Sockets.Sessions.Modes.Response) => {
		modesList = msg.modes || []
	}

	// The swap list (19 §5): which next-speaker strategy runs this session's
	// turns. The list is rows (strategies are types); the selection is a
	// session-scope rebind; null inherits the pipeline's pinned default.
	let speakerStrategies: Sockets.Sessions.Bindings.SpeakerStrategies.Response["strategies"] =
		$state([])
	let selectedSpeakerStrategy: string | null = $state(null)

	const handleSessionsSpeakerStrategies = (
		msg: Sockets.Sessions.Bindings.SpeakerStrategies.Response
	) => {
		if (msg.sessionId !== session?.id) return
		speakerStrategies = msg.strategies || []
		selectedSpeakerStrategy = msg.selected
	}

	const handleAccountVisibility = (
		msg: Sockets.Sessions.AccountVisibility.Response
	) => {
		if (msg.sessionId !== session?.id) return
		accountVisibility = msg
	}

	const handleSessionsSetSpeakerStrategy = (
		msg: Sockets.Sessions.Bindings.SetSpeakerStrategy.Response
	) => {
		if (msg.sessionId !== session?.id) return
		if (msg.error) {
			toaster.error({ title: "Turn order", description: msg.error })
		} else {
			toaster.success({ title: "Turn order updated" })
		}
		socket.emit("sessions:speakerStrategies", { sessionId: msg.sessionId })
	}

	function applySpeakerStrategy() {
		if (!session?.id) return
		socket.emit("sessions:setSpeakerStrategy", {
			sessionId: session.id,
			typeId: selectedSpeakerStrategy
		})
	}

	$effect(() => {
		if (session?.id)
			socket.emit("sessions:speakerStrategies", { sessionId: session.id })
	})

	// The preset this session runs on (19 §7). A preset is a pipeline
	// configuration a person is allowed to see and use — what a non-admin is
	// offered is the enabled ones, and it is the ordinary user's one lever over
	// how their session behaves. Changing it changes which actions the session
	// includes, which is why both refresh together.
	let presetOptions: Sockets.Sessions.PresetOptions.Response["options"] =
		$state([])
	let selectedPreset: number | null = $state(null)

	const handleSessionsPresets = (
		msg: Sockets.Sessions.PresetOptions.Response
	) => {
		if (msg.sessionId !== session?.id) return
		presetOptions = msg.options || []
		selectedPreset = msg.selectedId
	}

	const handleSessionsChoosePreset = (
		msg: Sockets.Sessions.ChoosePreset.Response
	) => {
		if (msg.sessionId !== session?.id) return
		if (msg.error)
			toaster.error({ title: "Preset", description: msg.error })
	}

	function choosePreset(value: string) {
		if (!session?.id) return
		const configId = Number(value)
		if (!Number.isFinite(configId)) return
		socket.emit("sessions:choosePreset", {
			sessionId: session.id,
			configId
		})
	}

	$effect(() => {
		if (session?.id)
			socket.emit("sessions:presets", { sessionId: session.id })
	})

	// The mode's functions and their state on this session (19 §3). Companions —
	// contributed from the mode owner's own namespace — arrive on; attachments
	// arrive off and are opt-in. Absence of a row means the default answers, so
	// a companion added in a later update reaches sessions that never had a view.
	let sessionFunctions: Sockets.Sessions.Functions.Response["functions"] =
		$state([])
	let functionsBusy: string | null = $state(null)
	let canAddOutsidePreset = $state(false)

	const handleSessionsFunctions = (
		msg: Sockets.Sessions.Functions.Response
	) => {
		if (msg.sessionId !== session?.id) return
		sessionFunctions = msg.functions || []
		canAddOutsidePreset = !!msg.canAddOutsidePreset
		functionsBusy = null
	}

	// Two groups, because they answer different questions. The preset's actions
	// are "what this session has"; the rest are "what its mode could offer" — and
	// only an admin can move something from the second list into the first.
	const presetActions = $derived(sessionFunctions.filter((f) => f.included))
	const outsideActions = $derived(sessionFunctions.filter((f) => !f.included))

	const handleSessionsSetFunction = (
		msg: Sockets.Sessions.SetFunction.Response
	) => {
		if (msg.sessionId !== session?.id) return
		functionsBusy = null
		// The refusal verbatim — an unoffered function and a mode mismatch both
		// name what went wrong, and summarizing them here would lose the half
		// that tells somebody what to do about it.
		if (msg.error)
			toaster.error({
				title: "Session functions",
				description: msg.error
			})
	}

	function toggleSessionFunction(key: string, enabled: boolean) {
		if (!session?.id) return
		functionsBusy = key
		socket.emit("sessions:setFunction", {
			sessionId: session.id,
			function: key,
			enabled
		})
	}

	$effect(() => {
		if (session?.id)
			socket.emit("sessions:functions", { sessionId: session.id })
	})

	const handleSessionsUpgradeMode = (
		msg: Sockets.Sessions.UpgradeMode.Response
	) => {
		if (msg.sessionId !== session?.id) return
		if (msg.error) {
			// The validator's sentences, verbatim — "never a silent coercion"
			// also means never a summarized refusal.
			toaster.error({ title: "Session mode", description: msg.error })
			return
		}
		toaster.success({ title: "Session mode upgraded" })
		socket.emit("sessions:get", { id: msg.sessionId })
	}

	/** `ns:kind/name@N` → its halves, for the latest-per-type folds below. */
	const modeParts = (id: string) => {
		const [bare, v] = id.split("@")
		return { bare: bare ?? id, version: Number(v ?? 1) }
	}

	// There is no mid-session mode swap (19 §6, ruled): a session keeps its mode
	// for life. What exists instead is the upgrade — the same bare type at a
	// higher version, offered when one is registered.
	let modeUpgradeTarget = $derived.by(() => {
		if (!session) return null
		const current = modeParts(modeId)
		let best: (typeof modesList)[number] | null = null
		for (const m of modesList) {
			const p = modeParts(m.modeId)
			if (p.bare !== current.bare || p.version <= current.version)
				continue
			if (!best || p.version > modeParts(best.modeId).version) best = m
		}
		return best
	})

	function upgradeMode() {
		if (!session?.id || !modeUpgradeTarget) return
		socket.emit("sessions:upgradeMode", {
			sessionId: session.id,
			modeId: modeUpgradeTarget.modeId
		})
	}

	// The creation picker offers each mode once, at its newest version —
	// starting a session on a superseded version is a support question waiting
	// to happen.
	let latestModes = $derived.by(() => {
		const byBare = new Map<string, (typeof modesList)[number]>()
		for (const m of modesList) {
			const p = modeParts(m.modeId)
			const held = byBare.get(p.bare)
			if (!held || modeParts(held.modeId).version < p.version)
				byBare.set(p.bare, m)
		}
		return [...byBare.values()]
	})

	// The card step (19 §2, second pass): with more than one mode registered,
	// creation opens on a card per mode — name, description, the shape's facts
	// — and the form appears once one is chosen. A single-mode build (the F29
	// floor with an empty registry among them) skips the step entirely, which
	// is exactly today's behaviour. `!isDirty` is the late-arrival guard: if
	// the modes list lands after the user already started typing, the cards
	// never shove the form aside — the dropdown in the form covers that path.
	let modeChosen = $state(false)
	let pickingMode = $derived(
		!session &&
			!editSessionId &&
			!modeChosen &&
			latestModes.length > 1 &&
			!isDirty
	)

	function chooseMode(id: string) {
		modeId = id
		reconcileToMode()
		modeChosen = true
	}

	// One line of shape facts for a card — presentation only, derived from
	// the same shape the validator reads.
	function modeFacts(shape: (typeof modesList)[number]["shape"]): string {
		if (!shape) return ""
		const parts: string[] = []
		const cap = (label: string, b?: { min: number; max?: number }) => {
			if (!b || b.max === 0) return void parts.push(`no ${label}`)
			const bounds =
				b.min > 0
					? b.max != null
						? `${b.min}–${b.max}`
						: `${b.min}+`
					: b.max != null
						? `up to ${b.max}`
						: ""
			parts.push(bounds ? `${label} ${bounds}` : label)
		}
		cap("characters", shape.characters)
		cap("personas", shape.personas)
		if (shape.lorebook === "required") parts.push("lorebook required")
		else if (shape.lorebook) parts.push("lorebook optional")
		if (shape.composer === "none") parts.push("no composer")
		if (shape.voice === "narrator") parts.push("narrator voice")
		return parts.join(" · ")
	}

	/**
	 * Re-fit what the form already holds to the selected mode's shape (19 §2):
	 * field values filtered to the declared keys, participants trimmed to the
	 * shape's bounds, the lorebook detached when the capability is absent — so
	 * a commit can never carry another type's leftovers. The server filters and
	 * validates again on create; this keeps what is *sent* honest so that
	 * refusal never fires from stale UI state.
	 */
	function reconcileToMode() {
		const shape = modesList.find((m) => m.modeId === modeId)?.shape
		if (!shape) return // unknown mode: today's behaviour, nothing to trim
		const declared = shape.fields ?? {}
		modeFields = Object.fromEntries(
			Object.entries(modeFields).filter(([k]) => k in declared)
		)
		const charMax = shape.characters
			? (shape.characters.max ?? Infinity)
			: 0
		if (selectedCharacters.length > charMax)
			selectedCharacters = selectedCharacters.slice(0, charMax)
		const personaMax = shape.personas ? (shape.personas.max ?? Infinity) : 0
		if (selectedPersonas.length > personaMax)
			selectedPersonas = selectedPersonas.slice(0, personaMax)
		if (!shape.lorebook) lorebookId = null
	}

	const handleTagsList = (msg: any) => {
		tagsList = msg.tagsList || []
	}

	const handleToggleSessionCharacterActive = (
		msg: Sockets.Sessions.ToggleSessionCharacterActive.Response
	) => {
		if (msg.error) {
			toaster.error({
				title: "Error toggling character",
				description: msg.error
			})
			return
		}
		if (session && session.id === msg.sessionId) {
			toaster.success({
				title: `Character ${msg.isActive ? "activated" : "deactivated"}`
			})
			// Refresh session data to get updated state
			socket.emit("sessions:get", { id: session.id })
		}
	}

	const handleUpdateSessionCharacterVisibility = (
		msg: Sockets.Sessions.UpdateSessionCharacterVisibility.Response
	) => {
		if (msg.error) {
			toaster.error({
				title: "Error updating visibility",
				description: msg.error
			})
			return
		}
		if (session && session.id === msg.sessionId) {
			const visibilityLabel =
				SessionCharacterVisibility.options.find(
					(opt) => opt.value === msg.visibility
				)?.label || msg.visibility
			toaster.success({
				title: `Set to "${visibilityLabel}" when not speaking`
			})
			// Optimistically update local state immediately
			if (session.sessionCharacters) {
				const updatedSessionCharacters = session.sessionCharacters.map(
					(cc) =>
						cc.characterId === msg.characterId
							? { ...cc, visibility: msg.visibility }
							: cc
				)
				session = {
					...session,
					sessionCharacters: updatedSessionCharacters
				}
			}
			// Also refresh from server to ensure consistency
			socket.emit("sessions:get", { id: session.id })
		}
	}

	const handleSessionsCreate = (res: any) => {
		toaster.success({
			title: "Session Created",
			description: `Session "${res.session.name || "Unnamed Session"}" created successfully.`
		})
		showEditSessionForm = false
		onClose?.()
	}

	const handleSessionsUpdate = (res: any) => {
		toaster.success({
			title: "Session Updated",
			description: `Session "${res.session.name || "Unnamed Session"}" updated successfully.`
		})
		showEditSessionForm = false
		onClose?.()
	}

	const handleSessionsAddGuest = (
		res: Sockets.Sessions.AddGuest.Response
	) => {
		if (res.success) {
			toaster.success({ title: "Guest added successfully" })
			// Request updated session data
			if (editSessionId) {
				socket.emit("sessions:get", { id: editSessionId })
			}
		} else if (res.error) {
			toaster.error({ title: res.error })
		}
	}

	const handleSessionsRemoveGuest = (
		res: Sockets.Sessions.RemoveGuest.Response
	) => {
		if (res.success) {
			toaster.success({ title: "Guest removed successfully" })
			// Request updated session data
			if (editSessionId) {
				socket.emit("sessions:get", { id: editSessionId })
			}
		} else if (res.error) {
			toaster.error({ title: res.error })
		}
	}

	const handleReassignRemovedParticipant = (
		res: Sockets.Sessions.ReassignRemovedParticipant.Response
	) => {
		if (res.error) {
			toaster.error({
				title: "Error reassigning",
				description: res.error
			})
			return
		}
		if (res.success) {
			toaster.success({ title: "History reassigned" })
			// The server also broadcasts a "sessions:get" to every participant
			// (including this socket), which handleSessionsGet already applies —
			// no separate local state update needed here.
		}
	}

	const handleAdminConnectionsList = (
		msg: Sockets.Connections.List.Response
	) => {
		adminConnectionsList = msg.connectionsList || []
	}
	const handleAdminSamplingConfigsList = (
		msg: Sockets.SamplingConfigs.List.Response
	) => {
		adminSamplingList = msg.samplingConfigsList || []
	}
	const handleAdminPromptConfigsList = (
		msg: Sockets.PromptConfigs.List.Response
	) => {
		adminPromptConfigsList = msg.promptConfigsList || []
	}
	const handleAdminNarratorPromptConfigsList = (
		msg: Sockets.NarratorPromptConfigs.List.Response
	) => {
		adminNarratorPromptConfigsList = msg.narratorPromptConfigsList || []
	}

	onMount(() => {
		// Register all socket event handlers
		socket.on("sessions:get", handleSessionsGet)
		socket.on("characters:list", handleCharactersList)
		socket.on("personas:list", handlePersonasList)
		socket.on("lorebooks:list", handleLorebooksList)
		socket.on("tags:list", handleTagsList)
		socket.on(
			"sessions:toggleSessionCharacterActive",
			handleToggleSessionCharacterActive
		)
		socket.on(
			"sessions:updateSessionCharacterVisibility",
			handleUpdateSessionCharacterVisibility
		)
		socket.on("sessions:create", handleSessionsCreate)
		socket.on("sessions:update", handleSessionsUpdate)
		socket.on("sessions:addGuest", handleSessionsAddGuest)
		socket.on("sessions:removeGuest", handleSessionsRemoveGuest)
		socket.on(
			"sessions:reassignRemovedParticipant",
			handleReassignRemovedParticipant
		)

		// Admin-only: load connections, sampling configs, and prompt configs for override pickers
		if (userCtx.user?.isAdmin) {
			socket.on("connections:list", handleAdminConnectionsList)
			socket.on("samplingConfigs:list", handleAdminSamplingConfigsList)
			socket.on("promptConfigs:list", handleAdminPromptConfigsList)
			socket.on(
				"narratorPromptConfigs:list",
				handleAdminNarratorPromptConfigsList
			)
			socket.emit("connections:list", {})
			socket.emit("samplingConfigs:list", {})
			socket.emit("promptConfigs:list", {})
			socket.emit("narratorPromptConfigs:list", {})
		}

		// Request initial data
		socket.emit("characters:list", {})
		socket.emit("personas:list", {})
		socket.emit("lorebooks:list", {})
		socket.emit("tags:list", {})
		socket.on("sessions:modes", handleSessionsModes)
		socket.emit("sessions:modes", {})
		socket.on("sessions:upgradeMode", handleSessionsUpgradeMode)
		socket.on("sessions:speakerStrategies", handleSessionsSpeakerStrategies)
		socket.on("sessions:accountVisibility", handleAccountVisibility)
		socket.on("sessions:pipelines", handleSessionsPipelines)
		socket.on("sessions:presets", handleSessionsPresets)
		socket.on("sessions:choosePreset", handleSessionsChoosePreset)
		socket.on("sessions:functions", handleSessionsFunctions)
		socket.on("sessions:setFunction", handleSessionsSetFunction)
		socket.on(
			"sessions:setSpeakerStrategy",
			handleSessionsSetSpeakerStrategy
		)
	})

	onDestroy(() => {
		socket.off("connections:list", handleAdminConnectionsList)
		socket.off("samplingConfigs:list", handleAdminSamplingConfigsList)
		socket.off("promptConfigs:list", handleAdminPromptConfigsList)
		socket.off(
			"narratorPromptConfigs:list",
			handleAdminNarratorPromptConfigsList
		)
		// Properly remove event handlers by passing the function references
		socket.off("sessions:get", handleSessionsGet)
		socket.off("characters:list", handleCharactersList)
		socket.off("personas:list", handlePersonasList)
		socket.off("lorebooks:list", handleLorebooksList)
		socket.off("tags:list", handleTagsList)
		socket.off(
			"sessions:toggleSessionCharacterActive",
			handleToggleSessionCharacterActive
		)
		socket.off(
			"sessions:updateSessionCharacterVisibility",
			handleUpdateSessionCharacterVisibility
		)
		socket.off("sessions:create", handleSessionsCreate)
		socket.off("sessions:update", handleSessionsUpdate)
		socket.off("sessions:addGuest", handleSessionsAddGuest)
		socket.off("sessions:removeGuest", handleSessionsRemoveGuest)
		socket.off(
			"sessions:reassignRemovedParticipant",
			handleReassignRemovedParticipant
		)
		socket.off("sessions:modes", handleSessionsModes)
		socket.off("sessions:upgradeMode", handleSessionsUpgradeMode)
		socket.off(
			"sessions:speakerStrategies",
			handleSessionsSpeakerStrategies
		)
		socket.off("sessions:accountVisibility", handleAccountVisibility)
		socket.off("sessions:pipelines", handleSessionsPipelines)
		socket.off("sessions:presets", handleSessionsPresets)
		socket.off("sessions:choosePreset", handleSessionsChoosePreset)
		socket.off("sessions:functions", handleSessionsFunctions)
		socket.off("sessions:setFunction", handleSessionsSetFunction)
		socket.off(
			"sessions:setSpeakerStrategy",
			handleSessionsSetSpeakerStrategy
		)
	})

	function toggleCharacterActive(
		e: { checked: boolean },
		c: Partial<SelectCharacter> & { id: number }
	): void {
		if (!session?.id) {
			console.error("No session ID available")
			return
		}
		const req: Sockets.Sessions.ToggleSessionCharacterActive.Params = {
			sessionId: session.id,
			characterId: c.id
		}
		socket.emit("sessions:toggleSessionCharacterActive", req)
	}

	function updateCharacterVisibility(
		c: Partial<SelectCharacter> & { id: number },
		visibility: string
	): void {
		if (!session?.id) {
			console.error("No session ID available")
			return
		}
		const req: Sockets.Sessions.UpdateSessionCharacterVisibility.Params = {
			sessionId: session.id,
			characterId: c.id,
			visibility
		}
		socket.emit("sessions:updateSessionCharacterVisibility", req)
	}

	function getVisibilityIcon(visibility: string) {
		switch (visibility) {
			case SessionCharacterVisibility.VISIBLE:
				return Icons.Eye
			case SessionCharacterVisibility.MINIMAL:
				return Icons.EyeClosed
			case SessionCharacterVisibility.HIDDEN:
				return Icons.EyeOff
			default:
				return Icons.Eye
		}
	}

	function getVisibilityColor(visibility: string) {
		switch (visibility) {
			case SessionCharacterVisibility.VISIBLE:
				return "text-success-500"
			case SessionCharacterVisibility.MINIMAL:
				return "text-warning-500"
			case SessionCharacterVisibility.HIDDEN:
				return "text-error-500"
			default:
				return "text-success-500"
		}
	}

	function getNextVisibility(current: string): string {
		switch (current) {
			case SessionCharacterVisibility.VISIBLE:
				return SessionCharacterVisibility.MINIMAL
			case SessionCharacterVisibility.MINIMAL:
				return SessionCharacterVisibility.HIDDEN
			case SessionCharacterVisibility.HIDDEN:
				return SessionCharacterVisibility.VISIBLE
			default:
				return SessionCharacterVisibility.VISIBLE
		}
	}
</script>

{#if data && pickingMode}
	<div class="flex min-h-full flex-col gap-6">
		<div class="flex items-center gap-2">
			<button
				class="btn btn-sm preset-filled-surface-400-600 shrink-0 p-2"
				onclick={handleCloseForm}
				title="Cancel"
			>
				<Icons.ChevronLeft size={16} />
			</button>
			<h2 class="flex-1 truncate font-semibold">New Session</h2>
		</div>
		<!-- The card step (19 §2, second pass): the mode is the first
		     decision — it decides which systems exist for the session and is
		     fixed for life, upgradable along its own type but never swappable
		     — so it is asked before the form, as cards rendered from rows.
		     The dropdown inside the form remains for changing the answer
		     while the session is still unsaved. -->
		<p class="text-sm opacity-80">
			What kind of session is this? The mode decides which systems exist —
			characters, personas, lorebooks, the composer — and stays with the
			session for its life.
		</p>
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
			{#each latestModes as mode (mode.modeId)}
				<button
					type="button"
					class="preset-tonal hover:preset-tonal-primary flex flex-col items-start gap-1 rounded-lg p-4 text-left"
					onclick={() => chooseMode(mode.modeId)}
				>
					<span class="font-semibold">{mode.name}</span>
					{#if mode.description}
						<span class="text-sm opacity-80">
							{mode.description}
						</span>
					{/if}
					{#if modeFacts(mode.shape)}
						<span class="text-xs opacity-60">
							{modeFacts(mode.shape)}
						</span>
					{/if}
				</button>
			{/each}
		</div>
	</div>
{:else if data}
	<div class="flex min-h-full flex-col gap-6">
		<div class="flex items-center gap-2">
			<button
				class="btn btn-sm preset-filled-surface-400-600 shrink-0 p-2"
				onclick={handleCloseForm}
				title="Cancel"
			>
				<Icons.ChevronLeft size={16} />
			</button>
			<h2 class="flex-1 truncate font-semibold">
				{session ? "Edit Session" : "New Session"}
			</h2>
			<button
				class="btn btn-sm shrink-0"
				class:preset-filled-success-500={isDirty}
				class:preset-tonal-success={!isDirty}
				onclick={handleSave}
				disabled={!canSave}
			>
				<Icons.Save size={16} />
				{session ? "Update" : "Create"}
			</button>
		</div>
		{#if isGuest}
			<p class="preset-tonal-surface rounded-lg p-3 text-sm">
				You're a guest in this session. You can manage characters,
				personas, and guests below — session settings (name, scenario,
				lorebook, tags, etc.) can only be changed by the session owner.
			</p>
		{/if}
		<div>
			<label class="font-semibold" for="sessionName">Session Name*</label>
			<input
				id="sessionName"
				class="input input-lg w-full {validationErrors.name
					? 'border-error-500'
					: ''}"
				type="text"
				placeholder="Enter session name"
				bind:value={name}
				required
				disabled={isGuest}
				oninput={() => {
					if (validationErrors.name) {
						const { name, ...rest } = validationErrors
						validationErrors = rest
					}
				}}
			/>
			{#if validationErrors.name}
				<p class="text-error-500 mt-1 text-sm" role="alert">
					{validationErrors.name}
				</p>
			{/if}
		</div>

		<!-- Mode (19 §2, §6 as ruled). Creation picks freely — each mode once,
		     at its newest version. An existing session keeps its mode for life:
		     there is no swap control, only the upgrade along the same type
		     when the author has shipped a newer version, and even that is
		     shape-validated server-side with sentence refusals. -->
		{#if !session && latestModes.length > 1}
			<div>
				<label class="font-semibold" for="sessionMode">
					Session Mode
				</label>
				<select
					id="sessionMode"
					class="select w-full"
					bind:value={modeId}
					onchange={() => {
						// Data follows the type: refit fields, participants and
						// the lorebook to the newly selected shape.
						reconcileToMode()
					}}
				>
					{#each latestModes as mode (mode.modeId)}
						<option value={mode.modeId}>{mode.name}</option>
					{/each}
				</select>
			</div>
		{:else if session && !isGuest && modeUpgradeTarget}
			<div class="flex flex-col gap-1">
				<span class="font-semibold">Session Mode</span>
				<div class="flex items-center gap-2">
					<span class="preset-tonal rounded-lg px-3 py-2 text-sm">
						{modesList.find((m) => m.modeId === modeId)?.name ??
							modeId}
					</span>
					<button
						class="btn btn-sm preset-filled-primary-500 shrink-0"
						title="Upgrade to {modeUpgradeTarget.modeId}"
						onclick={upgradeMode}
					>
						<Icons.ArrowUpCircle size={14} />
						Upgrade
					</button>
				</div>
				<p class="text-surface-700-300 text-xs">
					A newer version of this mode is available ({modeUpgradeTarget.modeId}).
					Upgrading keeps the session and its settings.
				</p>
			</div>
		{/if}

		<Tabs
			value={activeSessionTab}
			onValueChange={(e) => {
				activeSessionTab = e.value as typeof activeSessionTab
				// Fetch the visibility view lazily, only when its tab is opened.
				if (activeSessionTab === "visibility" && session?.id)
					socket.emit("sessions:accountVisibility", {
						sessionId: session.id
					})
				// The involved pipelines, likewise — only an existing session
				// has them (a not-yet-created session has no scope to write to).
				if (activeSessionTab === "settings" && session?.id)
					socket.emit("sessions:pipelines", {
						sessionId: session.id
					})
			}}
		>
			<!-- Matches the site's underlined tab strip (see PanelTab): no
			     pill, no fill, a bottom border that colours in on selection.
			     Only the open tab shows its label — the others are icon-only,
			     so the strip reads as a tab bar rather than a row of buttons. -->
			<Tabs.List
				class="border-surface-200-800 flex items-center gap-1 border-b"
			>
				<Tabs.Trigger
					value="participants"
					title="Participants"
					aria-label="Participants"
					class="text-surface-700-300 hover:text-primary-500 data-[selected]:border-primary-500 data-[selected]:text-primary-500 flex items-center gap-1.5 rounded-none border-b-2 border-transparent bg-transparent px-2 py-1.5"
				>
					<Icons.Users size={16} aria-hidden="true" />
					{#if activeSessionTab === "participants"}
						<span>Participants</span>
					{/if}
				</Tabs.Trigger>
				<Tabs.Trigger
					value="settings"
					title="Settings"
					aria-label="Settings"
					class="text-surface-700-300 hover:text-primary-500 data-[selected]:border-primary-500 data-[selected]:text-primary-500 flex items-center gap-1.5 rounded-none border-b-2 border-transparent bg-transparent px-2 py-1.5"
				>
					<Icons.Settings size={16} aria-hidden="true" />
					{#if activeSessionTab === "settings"}
						<span>Settings</span>
					{/if}
				</Tabs.Trigger>
				<Tabs.Trigger
					value="visibility"
					title="Privacy"
					aria-label="Privacy"
					class="text-surface-700-300 hover:text-primary-500 data-[selected]:border-primary-500 data-[selected]:text-primary-500 flex items-center gap-1.5 rounded-none border-b-2 border-transparent bg-transparent px-2 py-1.5"
				>
					<Icons.Eye size={16} aria-hidden="true" />
					{#if activeSessionTab === "visibility"}
						<span>Privacy</span>
					{/if}
				</Tabs.Trigger>
			</Tabs.List>
			<Tabs.Content value="participants">
				<div class="flex flex-col gap-6 pt-4">
					<!-- Capability-gated (19 §2): a section the mode's shape
					     omits does not exist for this session, so it neither
					     renders nor blocks saving. -->
					{#if showCharactersSection}
						<div>
							<span class="mb-2 font-semibold">
								Characters{charactersFloor > 0 ? "*" : ""}
							</span>
							{#key session?.sessionCharacters}
								<div
									class="relative mb-2 flex flex-col gap-2"
									use:dndzone={{
										items: selectedCharacters,
										flipDurationMs: 150,
										dragDisabled: !(
											selectedCharacters.length > 1
										),
										dropFromOthersDisabled: true
									}}
									onconsider={(e) =>
										(selectedCharacters = e.detail.items)}
									onfinalize={(e) =>
										(selectedCharacters = e.detail.items)}
								>
									{#each selectedCharacters as c, i (c.id)}
										{@const isActive = session
											? !!session?.sessionCharacters?.find(
													(cc) =>
														cc.characterId === c.id
												)?.isActive
											: true}
										{@const visibility = session
											? session?.sessionCharacters?.find(
													(cc) =>
														cc.characterId === c.id
												)?.visibility ||
												SessionCharacterVisibility.VISIBLE
											: SessionCharacterVisibility.VISIBLE}
										{@const VisibilityIcon =
											getVisibilityIcon(visibility)}
										{@const isSaved =
											!session ||
											!!session.sessionCharacters?.some(
												(cc) => cc.characterId === c.id
											)}
										<div
											class="card preset-tonal flex flex-col gap-3 p-3 shadow-sm transition-colors"
											data-dnd-handle
										>
											<div class="flex items-start gap-3">
												<div
													class="relative w-fit shrink-0"
												>
													<span
														class="text-surface-400 hover:text-primary-500 absolute -top-2 -left-2 z-10 cursor-grab"
														data-dnd-handle
														class:hidden={selectedCharacters.length <=
															1}
														title="Drag to reorder"
													>
														<Icons.GripVertical
															size={18}
														/>
													</span>
													<Avatar char={c} />
												</div>
												<div class="min-w-0 flex-1">
													<div
														class="truncate font-semibold select-none"
													>
														{c.nickname || c.name}
													</div>
													<div
														class="text-surface-700-300 line-clamp-2 text-xs select-none"
													>
														{c.creatorNotes ||
															c.description ||
															""}
													</div>
												</div>
												{#if selectedCharacters.length > 1}
													<div
														class="flex shrink-0 flex-col gap-0.5"
													>
														<button
															class="btn-ghost rounded p-0.5 disabled:opacity-30"
															onclick={() =>
																moveCharacterUp(
																	i
																)}
															disabled={i === 0}
															title="Move up"
															aria-label="Move {c.nickname ||
																c.name} up"
														>
															<Icons.ChevronUp
																size={16}
															/>
														</button>
														<button
															class="btn-ghost rounded p-0.5 disabled:opacity-30"
															onclick={() =>
																moveCharacterDown(
																	i
																)}
															disabled={i ===
																selectedCharacters.length -
																	1}
															title="Move down"
															aria-label="Move {c.nickname ||
																c.name} down"
														>
															<Icons.ChevronDown
																size={16}
															/>
														</button>
													</div>
												{/if}
											</div>
											<div
												class="border-surface-300-700 flex items-center justify-between gap-2 border-t pt-2"
											>
												{#if session}
													<span
														title={isSaved
															? "Toggle Character Active"
															: "Save the session to set this character's active status"}
														class="flex items-center gap-2"
													>
														<Switch
															name="toggle-character-active-{c.id}"
															checked={isActive}
															disabled={!isSaved}
															onCheckedChange={(
																e
															) =>
																toggleCharacterActive(
																	e,
																	c
																)}
															aria-label="Toggle character {c.name} active status"
														>
															<Switch.Control
																class="preset-filled-surface-500 data-[state=checked]:preset-filled-success-500 w-9"
															>
																<Switch.Thumb>
																	{#if isActive}
																		<Icons.Smile
																			size="14"
																		/>
																	{:else}
																		<Icons.Meh
																			size="14"
																		/>
																	{/if}
																</Switch.Thumb>
															</Switch.Control>
															<Switch.HiddenInput
															/>
														</Switch>
														<span
															class="text-surface-700-300 text-xs"
														>
															{isActive
																? "Active"
																: "Inactive"}
														</span>
													</span>
													<button
														class="btn btn-sm {getVisibilityColor(
															visibility
														)}"
														onclick={() =>
															updateCharacterVisibility(
																c,
																getNextVisibility(
																	visibility
																)
															)}
														title="When not speaking: {SessionCharacterVisibility.options.find(
															(opt) =>
																opt.value ===
																visibility
														)?.description ||
															"Full character info is included even when they're not speaking"}"
													>
														<VisibilityIcon
															size={16}
														/>
														{SessionCharacterVisibility.options.find(
															(opt) =>
																opt.value ===
																visibility
														)?.label || "Full Info"}
													</button>
												{:else}
													<span
														class="text-surface-700-300 text-xs"
													>
														Ready to add
													</span>
												{/if}
												<button
													class="preset-tonal-error btn btn-sm"
													onclick={() =>
														confirmRemoveCharacter(
															c.id,
															c.nickname ||
																c.name ||
																""
														)}
													title="Remove from session"
												>
													<Icons.X size={16} /> Remove
												</button>
											</div>
										</div>
									{/each}
								</div>
							{/key}
							<div>
								<button
									class="btn btn-sm preset-filled-primary-500 flex items-center"
									onclick={() => (showCharacterModal = true)}
								>
									<Icons.Plus size={16} /> Add Character
								</button>
							</div>
						</div>
					{/if}
					{#if showPersonasSection}
						<div>
							<span class="mb-2 font-semibold">
								Personas{personasFloor > 0 ? "*" : ""}
							</span>
							<div
								class="relative mb-2 flex flex-col gap-2"
								use:dndzone={{
									items: selectedPersonas,
									flipDurationMs: 150,
									dragDisabled: !(
										selectedPersonas.length > 1
									),
									dropFromOthersDisabled: true
								}}
								onconsider={(e) =>
									(selectedPersonas = e.detail.items)}
								onfinalize={(e) =>
									(selectedPersonas = e.detail.items)}
							>
								{#each selectedPersonas as p, i (p.id)}
									<div
										class="card preset-tonal flex flex-col gap-3 p-3 shadow-sm transition-colors"
										data-dnd-handle
									>
										<div class="flex items-start gap-3">
											<div
												class="relative w-fit shrink-0"
											>
												<span
													class="text-surface-400 hover:text-primary-500 absolute -top-2 -left-2 z-10 cursor-grab"
													data-dnd-handle
													class:hidden={selectedPersonas.length <=
														1}
													title="Drag to reorder"
												>
													<Icons.GripVertical
														size={18}
													/>
												</span>
												<Avatar char={p} />
											</div>
											<div class="min-w-0 flex-1">
												<div
													class="truncate font-semibold select-none"
												>
													{p.name}
												</div>
												<div
													class="text-surface-700-300 line-clamp-2 text-xs select-none"
												>
													{p.description || ""}
												</div>
											</div>
											{#if selectedPersonas.length > 1}
												<div
													class="flex shrink-0 flex-col gap-0.5"
												>
													<button
														class="btn-ghost rounded p-0.5 disabled:opacity-30"
														onclick={() =>
															movePersonaUp(i)}
														disabled={i === 0}
														title="Move up"
														aria-label="Move {p.name} up"
													>
														<Icons.ChevronUp
															size={16}
														/>
													</button>
													<button
														class="btn-ghost rounded p-0.5 disabled:opacity-30"
														onclick={() =>
															movePersonaDown(i)}
														disabled={i ===
															selectedPersonas.length -
																1}
														title="Move down"
														aria-label="Move {p.name} down"
													>
														<Icons.ChevronDown
															size={16}
														/>
													</button>
												</div>
											{/if}
										</div>
										<div
											class="border-surface-300-700 flex items-center justify-end border-t pt-2"
										>
											<button
												class="preset-tonal-error btn btn-sm"
												onclick={() =>
													confirmRemovePersona(
														p.id,
														p.name || ""
													)}
												title="Remove from session"
											>
												<Icons.X size={16} /> Remove
											</button>
										</div>
									</div>
								{/each}
							</div>
							<div>
								<button
									class="btn btn-sm preset-filled-primary-500 flex items-center gap-1"
									onclick={() => (showPersonaModal = true)}
								>
									<Icons.Plus size={16} /> Add Persona
								</button>
							</div>
						</div>
					{/if}

					{#if session && (removedCharacters.length > 0 || removedPersonas.length > 0)}
						<div>
							<span class="mb-2 font-semibold">Removed</span>
							<p class="text-surface-700-300 mb-2 text-xs">
								These were removed from the session, but their
								past messages are kept. Reassign a removed
								participant's history to a character or persona
								you own.
							</p>
							<div class="flex flex-col gap-2">
								{#each removedCharacters as rc (rc.id)}
									<div
										class="card preset-tonal flex items-center justify-between gap-3 p-3"
									>
										<span class="truncate text-sm">
											{rc.name}
										</span>
										<button
											class="btn btn-sm preset-tonal"
											onclick={() =>
												openReassignModal(
													"character",
													rc.id,
													rc.name
												)}
										>
											Reassign…
										</button>
									</div>
								{/each}
								{#each removedPersonas as rp (rp.id)}
									<div
										class="card preset-tonal flex items-center justify-between gap-3 p-3"
									>
										<span class="truncate text-sm">
											{rp.name}
										</span>
										<button
											class="btn btn-sm preset-tonal"
											onclick={() =>
												openReassignModal(
													"persona",
													rp.id,
													rp.name
												)}
										>
											Reassign…
										</button>
									</div>
								{/each}
							</div>
						</div>
					{/if}

					{#if editSessionId && systemSettingsCtx?.settings?.isAccountsEnabled}
						<!-- Guests Section (only show in edit mode and when accounts are enabled) -->
						<div>
							<label
								class="mb-3 flex items-center justify-between"
							>
								<span class="font-semibold">Guests</span>
								<button
									class="btn btn-sm preset-filled-primary-500 flex items-center gap-1"
									onclick={() => (showGuestModal = true)}
								>
									<Icons.UserPlus size={16} /> Add Guests
								</button>
							</label>
							<div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
								{#if selectedGuests.length === 0}
									<div
										class="text-surface-700-300 col-span-full text-center text-sm"
									>
										No guests added
									</div>
								{/if}
								{#each selectedGuests as guest}
									<div class="card preset-tonal p-3">
										<div class="flex flex-col gap-2">
											<div
												class="flex items-center justify-between"
											>
												<div
													class="flex items-center gap-2"
												>
													<Icons.User size={20} />
													<span class="font-semibold">
														{resolveUserHandle(
															guest.user
														)}
													</span>
												</div>
												<button
													class="hover:preset-filled-error-500 rounded p-1"
													onclick={() =>
														confirmRemoveGuest(
															guest.userId,
															resolveUserHandle(
																guest.user
															)
														)}
													title="Remove guest"
												>
													<Icons.X size={16} />
												</button>
											</div>
										</div>
									</div>
								{/each}
							</div>
						</div>
					{/if}

					{#if selectedCharacters.length > 1 || selectedPersonas.length > 1}
						<div>
							<label
								class="font-semibold"
								for="groupReplyStrategy"
							>
								Group Reply Strategy
							</label>
							<select
								id="groupReplyStrategy"
								class="select input-lg w-full"
								bind:value={groupReplyStrategy}
								disabled={isGuest}
							>
								{#each GroupReplyStrategies.options as opt}
									{#if opt.value !== GroupReplyStrategies.USER_SPLIT || systemSettingsCtx.settings?.isAccountsEnabled}
										<option value={opt.value}>
											{opt.label}
										</option>
									{/if}
								{/each}
							</select>
						</div>
					{/if}
				</div>
			</Tabs.Content>
			<Tabs.Content value="settings">
				<div class="flex flex-col gap-6 pt-4">
					<div>
						<label class="flex gap-1 font-semibold" for="scenario">
							Scenario <span
								class="flex items-center opacity-50 transition-opacity duration-200 hover:opacity-100"
								title="This field will be visible in prompts"
							>
								<Icons.ScanEye
									size={16}
									class="relative top-[1px] inline"
								/>
							</span>
						</label>
						<textarea
							id="scenario"
							class="textarea input-lg w-full"
							placeholder="Describe the session scenario, setting, or context (optional)"
							bind:value={scenario}
							rows={3}
							disabled={isGuest}
						></textarea>
					</div>
					{#if showLorebookField}
						<div>
							<label
								class="flex gap-1 font-semibold"
								for="lorebook"
							>
								Lorebook{modeShape?.lorebook === "required"
									? "*"
									: ""}
								<span
									class="flex items-center opacity-50 transition-opacity duration-200 hover:opacity-100"
									title="The session will use world lore, character lore and history entries from this lorebook"
								>
									<Icons.MessageCircleQuestion
										size={16}
										class="relative top-[1px] inline"
									/>
								</span>
							</label>
							<select
								id="lorebook"
								class="select input-lg w-full"
								bind:value={lorebookId}
								disabled={isGuest}
							>
								<option value={null}>None</option>
								{#each lorebookList as lorebook (lorebook.id)}
									<option value={lorebook.id}>
										{lorebook.name}
									</option>
								{/each}
							</select>
						</div>
					{/if}

					<!-- The preset (19 §7). One pipeline configuration, chosen
					     per session, deciding the settings this session runs on and
					     which actions it includes. Admins additionally see
					     disabled presets, marked — one an admin just switched
					     off vanishing entirely would read as deleted. -->
					{#if session && !isGuest && presetOptions.length > 0}
						<div>
							<label class="font-semibold" for="sessionPreset">
								Preset
							</label>
							<select
								id="sessionPreset"
								class="select w-full"
								value={selectedPreset == null
									? ""
									: String(selectedPreset)}
								onchange={(e) =>
									choosePreset(e.currentTarget.value)}
							>
								{#each presetOptions as p (p.configId)}
									<option value={String(p.configId)}>
										{p.isDefault
											? "★ "
											: ""}{p.name}{!p.enabled
											? " (unavailable)"
											: ""}
									</option>
								{/each}
							</select>
						</div>
					{/if}

					<!-- Session actions (19 §3). Three layers decide what a session has:
					     its own answer, then its preset's included set, then the
					     companion rule. The permission line runs between the two
					     lists — anyone may toggle what the preset included; only
					     an admin may reach into the second list, because that
					     gives the session something the instance owner did not
					     offer it. -->
					{#if session && !isGuest && sessionFunctions.length > 0}
						<div class="flex flex-col gap-2">
							<p class="font-semibold">Actions</p>
							<p class="text-muted-foreground text-xs">
								What this session can do besides reply. Replying
								is intrinsic and always available.
							</p>

							{#each presetActions as f (f.function)}
								<label
									class="flex items-start gap-2 text-sm"
									for="fn-{f.function}"
								>
									<input
										id="fn-{f.function}"
										type="checkbox"
										class="checkbox mt-0.5"
										checked={f.enabled}
										disabled={functionsBusy === f.function}
										onchange={(e) =>
											toggleSessionFunction(
												f.function,
												e.currentTarget.checked
											)}
									/>
									<span class="flex flex-col">
										<span>
											{f.name}
											{#if f.source === "session"}
												<span
													class="text-muted-foreground text-[10px]"
												>
													· set for this session
												</span>
											{/if}
										</span>
										<span
											class="text-muted-foreground text-xs"
										>
											{f.specSlug}
										</span>
									</span>
								</label>
							{/each}

							{#if presetActions.length === 0}
								<p class="text-muted-foreground text-xs italic">
									This session's preset includes no actions.
								</p>
							{/if}

							{#if outsideActions.length > 0}
								<div
									class="border-surface-300-700 mt-1 flex flex-col gap-2 border-t pt-2"
								>
									<p class="text-xs font-semibold">
										Not in this preset
									</p>
									<p class="text-muted-foreground text-xs">
										{#if canAddOutsidePreset}
											Contributed to this mode but left
											out of the preset. Adding one
											affects this session only.
										{:else}
											Contributed to this mode but not
											part of your preset. An
											administrator can add these.
										{/if}
									</p>
									{#each outsideActions as f (f.function)}
										<label
											class="flex items-start gap-2 text-sm"
											for="fn-{f.function}"
										>
											<input
												id="fn-{f.function}"
												type="checkbox"
												class="checkbox mt-0.5"
												checked={f.enabled}
												disabled={functionsBusy ===
													f.function ||
													(!canAddOutsidePreset &&
														!f.enabled)}
												onchange={(e) =>
													toggleSessionFunction(
														f.function,
														e.currentTarget.checked
													)}
											/>
											<span class="flex flex-col">
												<span>{f.name}</span>
												<span
													class="text-muted-foreground text-xs"
												>
													{f.specSlug}
												</span>
											</span>
										</label>
									{/each}
								</div>
							{/if}
						</div>
					{/if}

					<!-- Turn order (19 §5): the dropdown IS the swap list — every
					     registered next-speaker strategy, an extension's beside
					     core's. "Pipeline default" inherits the pinned type;
					     choosing writes a session-scope rebind, and the receipt names
					     whichever type actually ran. -->
					{#if session && !isGuest && speakerStrategies.length > 0}
						<div>
							<label class="font-semibold" for="turnOrder">
								Turn Order
							</label>
							<div class="flex items-center gap-2">
								<select
									id="turnOrder"
									class="select w-full"
									bind:value={selectedSpeakerStrategy}
								>
									<option value={null}>
										Pipeline default
									</option>
									{#each speakerStrategies as s (s.typeId)}
										<option value={s.typeId}>
											{s.name}
										</option>
									{/each}
								</select>
								<button
									class="btn btn-sm preset-filled-primary-500 shrink-0"
									onclick={applySpeakerStrategy}
								>
									Apply
								</button>
							</div>
						</div>
					{/if}

					<!-- Mode-declared per-session fields (19 §2): rendered through the one
		     schema renderer, stored on the session row, supplied back through the
		     input node's published document. Standard mode declares none. -->
					{#if Object.keys(modeFieldDecls).length > 0}
						<div class="flex flex-col gap-2">
							<p class="font-semibold">Mode Settings</p>
							<SchemaForm
								schema={modeFieldDecls as any}
								bind:values={modeFields}
							/>
						</div>
					{/if}

					<!-- Configurables grouped BY PIPELINE (not by setting
					     type): every pipeline this chat involves — the reply
					     pipeline plus each enabled function like narrate — gets
					     its own card, rendered from the pipeline's own
					     declarations and written at this session's scope. The
					     panel already handles connection (text-gen only),
					     sampling, prompts and tuning per step. -->
					{#if session?.id && sessionPipelines.length}
						<div class="flex flex-col gap-3">
							<div>
								<p class="font-semibold">Pipelines</p>
								<p class="text-muted-foreground text-xs">
									Changes here apply to this chat only. Leave a
									control on its default to inherit the global
									setting.
								</p>
							</div>
							{#each sessionPipelines as p (p.slug)}
								<!-- One card per pipeline: in selectorsOnly the
								     panel renders a flat selector list, so this
								     is the only card — no nesting. -->
								<div
									class="card preset-tonal-surface flex flex-col gap-2 p-3"
								>
									<p class="text-sm font-semibold">
										{p.label}
									</p>
									<PipelineConfigOptions
										slug={p.slug}
										sessionId={session.id}
										selectorsOnly
										showConfigPicker={false}
										showScopeNote={false}
									/>
								</div>
							{/each}
						</div>
					{/if}

					<!-- Tags Section -->
					<div class="pb-10">
						<label class="font-semibold" for="tagInput">Tags</label>
						<div class="relative">
							<input
								id="tagInput"
								type="text"
								bind:value={tagSearchInput}
								class="input input-lg w-full"
								placeholder="Add a tag..."
								disabled={isGuest}
								onfocus={() => (showTagSuggestions = true)}
								onblur={() =>
									setTimeout(
										() => (showTagSuggestions = false),
										200
									)}
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
												<span
													class="text-muted-foreground text-sm"
												>
													- {tag.description}
												</span>
											{/if}
										</button>
									{/each}
								</div>
							{/if}
						</div>

						<!-- Selected tags display -->
						{#if selectedTags.length > 0}
							<div class="mt-2 flex flex-wrap gap-2">
								{#each selectedTags as tagName}
									{@const tag = tagsList.find(
										(t) => t.name === tagName
									)}
									<button
										type="button"
										class="chip {tag?.colorPreset ||
											'preset-filled-primary-500'} group relative"
										onclick={() => removeTag(tagName)}
										disabled={isGuest}
										title={isGuest
											? tagName
											: "Click to remove tag"}
									>
										{tagName}
										{#if !isGuest}
											<Icons.X
												size={14}
												class="ml-1 opacity-60 group-hover:opacity-100"
											/>
										{/if}
									</button>
								{/each}
							</div>
						{/if}
					</div>
				</div>
			</Tabs.Content>
			<Tabs.Content value="visibility">
				<div class="flex flex-col gap-5 pt-4">
					<div class="preset-tonal-surface rounded-lg p-4 text-sm">
						<div class="flex items-start gap-2">
							<Icons.Eye size={18} class="mt-0.5 shrink-0" />
							<div class="flex flex-col gap-1">
								<p class="font-semibold">
									What this session sees of your data
								</p>
								<p class="text-surface-500">
									Anything you own and add here becomes visible
									to this session's other participants, and is
									read by the pipelines that generate its
									replies. This shows only your own data — never
									what anyone else has shared.
								</p>
							</div>
						</div>
					</div>

					{#if !accountVisibility}
						<p class="text-surface-500 text-sm">Loading…</p>
					{:else}
						<p class="text-sm">
							{#if accountVisibility.isOwner}
								You are the <span class="font-semibold"
									>owner</span
								> of this session.
							{:else if accountVisibility.isGuest}
								You are a <span class="font-semibold">guest</span>
								in this session.
							{:else}
								You are a participant in this session.
							{/if}
						</p>

						{@const ex = accountVisibility.exposed}
						{#if ex.characters.length + ex.personas.length + ex.lorebooks.length === 0}
							<div class="card preset-tonal p-4 text-sm">
								You have not added any of your own characters,
								personas, or lorebooks to this session — so it
								exposes nothing of yours.
							</div>
						{:else}
							<div class="flex flex-col gap-3">
								{#if ex.characters.length}
									<div
										class="card preset-tonal flex flex-col gap-2 p-3"
									>
										<div
											class="flex items-center gap-2 text-sm font-semibold"
										>
											<Icons.User size={16} /> Characters
										</div>
										<div class="flex flex-wrap gap-2">
											{#each ex.characters as c}
												<span
													class="preset-tonal-primary rounded-full px-3 py-1 text-xs"
													>{c.name}</span
												>
											{/each}
										</div>
									</div>
								{/if}
								{#if ex.personas.length}
									<div
										class="card preset-tonal flex flex-col gap-2 p-3"
									>
										<div
											class="flex items-center gap-2 text-sm font-semibold"
										>
											<Icons.UserCircle size={16} /> Personas
										</div>
										<div class="flex flex-wrap gap-2">
											{#each ex.personas as p}
												<span
													class="preset-tonal-primary rounded-full px-3 py-1 text-xs"
													>{p.name}</span
												>
											{/each}
										</div>
									</div>
								{/if}
								{#if ex.lorebooks.length}
									<div
										class="card preset-tonal flex flex-col gap-2 p-3"
									>
										<div
											class="flex items-center gap-2 text-sm font-semibold"
										>
											<Icons.BookOpen size={16} /> Lorebooks
										</div>
										<div class="flex flex-wrap gap-2">
											{#each ex.lorebooks as l}
												<span
													class="preset-tonal-primary rounded-full px-3 py-1 text-xs"
													>{l.name}</span
												>
											{/each}
										</div>
									</div>
								{/if}
							</div>
						{/if}

						<div class="flex flex-col gap-2">
							<p class="text-sm font-semibold">
								Who can see the above
							</p>
							{#if accountVisibility.viewers.length === 0}
								<p class="text-surface-500 text-sm">
									No one else yet — you are the only
									participant.
								</p>
							{:else}
								<div class="flex flex-col gap-2">
									{#each accountVisibility.viewers as v}
										<div
											class="card preset-tonal flex items-center justify-between gap-3 p-3 text-sm"
										>
											<span
												class="flex items-center gap-2"
											>
												<Icons.User size={16} />
												{v.username}
											</span>
											<span
												class="preset-tonal-surface rounded-full px-2 py-0.5 text-xs capitalize"
												>{v.role}</span
											>
										</div>
									{/each}
								</div>
							{/if}
						</div>
					{/if}
				</div>
			</Tabs.Content>
		</Tabs>
	</div>
{/if}
<CharacterSelectModal
	open={showCharacterModal}
	characters={characters.filter(
		(c) => !selectedCharacters.some((sel) => sel.id === c.id)
	)}
	onOpenChange={(e) => (showCharacterModal = e.open)}
	onSelect={handleAddCharacter}
/>
<PersonaSelectModal
	open={showPersonaModal}
	personas={personas.filter(
		(p) => !selectedPersonas.some((sel) => sel.id === p.id)
	)}
	onOpenChange={(e) => (showPersonaModal = e.open)}
	onSelect={handleAddPersona}
	returnFullPersona={true}
/>
<ReassignSessionParticipantModal
	open={showReassignModal}
	type={reassignTarget?.type ?? "character"}
	removedName={reassignTarget?.name ?? ""}
	characters={characters.filter(
		(c) => !selectedCharacters.some((sel) => sel.id === c.id)
	)}
	personas={personas.filter(
		(p) => !selectedPersonas.some((sel) => sel.id === p.id)
	)}
	onOpenChange={(e) => {
		showReassignModal = e.open
		if (!e.open) reassignTarget = null
	}}
	onSelect={handleReassignSelect}
/>
<!-- RemoveFromSessionModal only models "character" | "persona" (its ternaries
	fall back to the "character" copy for anything else, including its own
	default value of "character") — mapping "guest" to undefined below
	keeps that exact same fallback behavior while satisfying its prop type. -->
<RemoveFromSessionModal
	open={showRemoveModal}
	onOpenChange={(e) => (showRemoveModal = e.open)}
	onConfirm={handleRemoveConfirm}
	onCancel={handleRemoveCancel}
	name={removeName}
	type={removeType === "guest" ? undefined : removeType}
/>
<UserSelectModal
	open={showGuestModal}
	excludeUserIds={[
		...(session?.userId ? [session.userId] : []),
		...selectedGuests.map((g) => g.userId)
	]}
	onclose={() => (showGuestModal = false)}
	onSelect={() => {}}
	multiSelect={true}
	onMultiSelect={handleAddGuests}
	title="Add Guests to Session"
	description="Select users to add as guests. Guests can view and participate in the session."
/>
<SessionsUnsavedChangesModal
	open={showCancelModal}
	onOpenChange={handleCloseFormOnOpenChange}
	onConfirm={handleCloseModalDiscard}
	onCancel={handleCloseModalCancel}
/>
