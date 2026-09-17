<script lang="ts">
	/**
	 * A session's own settings: its name, then Participants, Settings and
	 * Privacy.
	 *
	 * EDIT ONLY. Starting a session is `StartSessionForm` — genre, preset, who
	 * is in it, a name — and the derivations both screens would otherwise each
	 * carry live in `createSession.svelte.ts`. A session keeps its genre for
	 * life, so the one genre control here is the upgrade along the same type.
	 */
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import {
		declareInterest,
		requestWithInterest,
		useInterest
	} from "$lib/client/sockets/interest.svelte"
	import { interestKey } from "$lib/shared/sockets/interest"
	import CharacterSelectModal from "../modals/CharacterSelectModal.svelte"
	import CharacterCreatorModal from "../modals/CharacterCreatorModal.svelte"
	import PersonaSelectModal from "../modals/PersonaSelectModal.svelte"
	import ReassignSessionParticipantModal from "../modals/ReassignSessionParticipantModal.svelte"
	import UserSelectModal from "../modals/UserSelectModal.svelte"
	import Avatar from "../Avatar.svelte"
	import * as Icons from "@lucide/svelte"
	import { dndzone } from "svelte-dnd-action"
	import RemoveFromSessionModal from "../modals/RemoveFromSessionModal.svelte"
	import SessionsUnsavedChangesModal from "../modals/SessionsUnsavedChangesModal.svelte"
	import { onMount, getContext } from "svelte"
	import { Switch } from "@skeletonlabs/skeleton-svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { GroupReplyStrategies } from "$lib/shared/constants/GroupReplyStrategies"
	import { SessionCharacterVisibility } from "$lib/shared/constants/SessionCharacterVisibility"
	import { resolveUserHandle } from "$lib/shared/utils/resolveCharacterName"
	import { z } from "zod"
	import SchemaForm from "../pipelines/SchemaForm.svelte"
	import PipelineConfigOptions from "../pipelines/PipelineConfigOptions.svelte"
	import PanelNavHeader from "../panels/PanelNavHeader.svelte"
	import PanelTabStrip from "../panels/PanelTabStrip.svelte"
	import { actionIdentity } from "$lib/shared/actions/identity"

	// The F29 floor (19 §2) — stated here rather than imported from the
	// server-only sessionModes module. When "sessions:genres" returns nothing (a
	// registry that never synced), the form behaves exactly as before modes
	// existed: no picker, every section shown, today's save rules.
	const STANDARD_GENRE_ID = "core:genre/chat"

	// Zod validation schema
	const sessionSchema = z.object({
		name: z.string().min(1, "Session name is required").trim(),
		scenario: z.string().optional(),
		groupReplyStrategy: z.string().optional()
	})

	type ValidationErrors = Record<string, string>

	interface Props {
		/**
		 * The session this screen edits. Required in practice: starting one is
		 * `StartSessionForm`'s, and this screen shows a spinner until
		 * `sessions:get` answers for the id.
		 */
		editSessionId?: number | null
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

	/**
	 * The one input/textarea chrome this form uses: Skeleton's field preset —
	 * theme-aware background, a focus ring that is already primary — with this
	 * view's corner radius.
	 */
	const FIELD_CLASS = "input rounded-[10px]"

	/**
	 * The card a section sits in, and the hook a shared `@utility panel-card`
	 * takes over the day one exists. The pane is surface-950, so surface-900 is
	 * the step a card reads against without a shadow; the light pair keeps it
	 * legible under a light theme.
	 */
	const CARD_CLASS =
		"panel-card border-surface-300 bg-surface-100 dark:border-surface-800 dark:bg-surface-900 rounded-[12px] border p-4"

	// STATE VARIABLES

	// Tag-related state
	let tagsList: SelectTag[] = $state([])
	let tagSearchInput = $state("")
	let showTagSuggestions = $state(false)
	let selectedTags: string[] = $state([])

	let session: Sockets.Sessions.Get.Response["session"] | undefined = $state()
	let characters: Sockets.Characters.List.Response["characterList"] = $state(
		[]
	)
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
					samplingConfigId?: number | null
					promptConfigId?: number | null
					narratorPromptConfigId?: number | null
					genreId?: string
					genreFields?: Record<string, unknown>
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
					samplingConfigId?: number | null
					promptConfigId?: number | null
					narratorPromptConfigId?: number | null
					genreId?: string
					genreFields?: Record<string, unknown>
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
	let sessionSamplingConfigId: number | null = $state(null)
	let sessionPromptConfigId: number | null = $state(null)
	let narratorPromptConfigId: number | null = $state(null)

	// CHAT MODE (19 §2, U-C2)
	let modesList: Sockets.Sessions.Genres.Response["genres"] = $state([])
	let genreId: string = $state(STANDARD_GENRE_ID)
	let genreFields: Record<string, unknown> = $state({})

	// The selected mode's shape, or null when the mode is unknown to this
	// build — in which case the form falls back to today's behaviour (every
	// capability shown), the F29 posture.
	let modeShape = $derived(
		modesList.find((m) => m.genreId === genreId)?.shape ?? null
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
		!modeShape || genreId === STANDARD_GENRE_ID
			? 1
			: (modeShape.characters?.min ?? 0)
	)
	let personasFloor = $derived(
		!modeShape || genreId === STANDARD_GENRE_ID
			? 1
			: (modeShape.personas?.min ?? 0)
	)
	// The mode's declared per-session fields (SettingsSchema), rendered through
	// the one schema renderer in session settings.
	let modeFieldDecls = $derived(modeShape?.fields ?? {})

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
	// Inline create from the pickers. A fresh install has no characters and no
	// personas, and the standard genre's floors require one of each — without
	// these the pickers are dead ends and the first session can never be
	// created. Close-then-open, never nested: both are skeleton Dialog +
	// Portal at z-50 and there is no nested-Dialog precedent in the repo.
	let showCharacterCreator = $state(false)
	let showPersonaCreator = $state(false)
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

	// SELECTED CHARACTERS AND PERSONAS
	// Populated either from the full session load (session.sessionCharacters/Personas,
	// which carry the complete row) or from CharacterSelectModal/
	// PersonaSelectModal (which only carry the display-column subset from
	// "characters:list") — Partial<...> reflects the latter. A persona is a
	// character the user voices, so both lists hold the same row shape.
	let selectedCharacters: (Partial<SelectCharacter> & { id: number })[] =
		$state([])
	let selectedPersonas: (Partial<SelectCharacter> & { id: number })[] =
		$state([])
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

	/**
	 * The three groups, each carrying whether something it holds is missing —
	 * the dot says "look in here" while another panel is the one on show.
	 */
	let sessionTabs = $derived([
		{
			value: "participants",
			label: "Participants",
			icon: Icons.UsersRound,
			hasError:
				selectedCharacters.length < charactersFloor ||
				selectedPersonas.length < personasFloor
		},
		{
			value: "settings",
			label: "Settings",
			icon: Icons.Settings2,
			hasError: modeShape?.lorebook === "required" && lorebookId == null
		},
		{ value: "visibility", label: "Privacy", icon: Icons.Eye }
	])

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
		const _samplingConfigId = sessionSamplingConfigId
		const _promptConfigId = sessionPromptConfigId
		const _narratorPromptConfigId = narratorPromptConfigId
		const _genreId = genreId
		const _genreFields = JSON.parse(JSON.stringify(genreFields))
		data = {
			session: {
				id: session?.id,
				name: _name,
				scenario: _scenario,
				groupReplyStrategy: _groupReplyStrategy || "ordered",
				lorebookId: _lorebookId,
				tags: _tags,
				samplingConfigId: _samplingConfigId,
				promptConfigId: _promptConfigId,
				narratorPromptConfigId: _narratorPromptConfigId,
				genreId: _genreId,
				genreFields: _genreFields
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

	/**
	 * The session being edited: its SCOPED interest and the request for it, in
	 * one effect so the two cannot drift.
	 *
	 * `sessions:get` carries its scope on `session.id` (`SCOPED_EVENTS`), so
	 * `sessions:get#<id>` is both the reply to this request and every later
	 * re-read the handlers below ask for. The effect form — rather than
	 * `useInterest`, which reads its key once — is what releases `#41` when the
	 * sidebar points this form at 42 without remounting it.
	 *
	 * ⚠ CREATE mode declares NO key. There is no session yet, so there is no id
	 * to scope to and nothing this form could ask for — and a bare `sessions:get`
	 * would open the server's gate for every session's reply while the form is
	 * mounted. The effect re-runs the moment `editSessionId` becomes known (the
	 * form is re-pointed at a saved session) and declares the scoped key then.
	 */
	$effect(() => {
		const id = editSessionId
		if (!id) return
		const release = declareInterest<"sessions:get">(
			interestKey("sessions:get", id),
			handleSessionsGet
		)
		// The typed `emit` puts the pending sync ahead of the request on the
		// same socket, so the handler answering it already sees the key
		// (plan ruling 3).
		socket.emit("sessions:get", { id })
		return release
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

	function handleAddPersona(p: Partial<SelectCharacter> & { id: number }) {
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
		// Re-fit held data to the genre's shape before anything reads it
		// (19 §2): a field under a name the shape stopped declaring, or a
		// participant past its bound, must not ride the commit.
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

		if (!session?.id) return
		// genreId rides in `data` but the server ignores it on update —
		// switching an existing session's mode is an open policy question
		// (19 §10). genreFields does land, filtered to declared keys.
		const updateSession: Sockets.Sessions.Update.Params = {
			...data!,
			session: {
				...data!.session,
				id: session.id
			}
		}
		socket.emit("sessions:update", updateSession)
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
			sessionSamplingConfigId = session.samplingConfigId ?? null
			sessionPromptConfigId = session.promptConfigId ?? null
			narratorPromptConfigId = session.narratorPromptConfigId ?? null
			genreId = (session as any).genreId ?? STANDARD_GENRE_ID
			genreFields = ((session as any).genreFields ?? {}) as Record<
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

	const handleLorebooksList = (msg: Sockets.Lorebooks.List.Response) => {
		lorebookList = msg.lorebookList || []
	}

	const handleSessionsModes = (msg: Sockets.Sessions.Genres.Response) => {
		modesList = msg.genres || []
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
			definitionId: selectedSpeakerStrategy
		})
	}

	/**
	 * The turn-order options for this session: the interest and the request in
	 * one. BARE — `sessions:speakerStrategies` has no `SCOPED_EVENTS` entry, so
	 * the handler's own `msg.sessionId !== session?.id` check is the filter.
	 */
	$effect(() => {
		const id = session?.id
		if (!id) return
		return requestWithInterest(
			"sessions:speakerStrategies",
			{ sessionId: id },
			handleSessionsSpeakerStrategies
		)
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

	/** The preset options for this session — interest and request in one, bare. */
	$effect(() => {
		const id = session?.id
		if (!id) return
		return requestWithInterest(
			"sessions:presets",
			{ sessionId: id },
			handleSessionsPresets
		)
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

	/**
	 * One action's switch, named by its identity (`<spec slug>#<key>`, W1):
	 * enablement is per action, so core's `summarize` and a plugin's are
	 * two checkboxes that do not move together.
	 */
	function toggleSessionFunction(
		f: { specSlug: string; key: string; function: string },
		enabled: boolean
	) {
		if (!session?.id) return
		const identity = actionIdentity(f)
		functionsBusy = identity
		socket.emit("sessions:setFunction", {
			sessionId: session.id,
			function: f.function,
			action: identity,
			enabled
		})
	}

	/** The mode's functions on this session — interest and request in one, bare. */
	$effect(() => {
		const id = session?.id
		if (!id) return
		return requestWithInterest(
			"sessions:functions",
			{ sessionId: id },
			handleSessionsFunctions
		)
	})

	const handleSessionsUpgradeMode = (
		msg: Sockets.Sessions.UpgradeGenre.Response
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
		const current = modeParts(genreId)
		let best: (typeof modesList)[number] | null = null
		for (const m of modesList) {
			const p = modeParts(m.genreId)
			if (p.bare !== current.bare || p.version <= current.version)
				continue
			if (!best || p.version > modeParts(best.genreId).version) best = m
		}
		return best
	})

	function upgradeMode() {
		if (!session?.id || !modeUpgradeTarget) return
		socket.emit("sessions:upgradeGenre", {
			sessionId: session.id,
			genreId: modeUpgradeTarget.genreId
		})
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
		const shape = modesList.find((m) => m.genreId === genreId)?.shape
		if (!shape) return // unknown mode: today's behaviour, nothing to trim
		const declared = shape.fields ?? {}
		genreFields = Object.fromEntries(
			Object.entries(genreFields).filter(([k]) => k in declared)
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

	/**
	 * The two views a tab pays for only when it is opened: the account-privacy
	 * view and the pipelines this session involves. Both are session-scoped, so
	 * neither is asked for before `sessions:get` has landed.
	 */
	$effect(() => {
		const id = session?.id
		if (!id) return
		if (activeSessionTab === "visibility")
			socket.emit("sessions:accountVisibility", { sessionId: id })
		if (activeSessionTab === "settings")
			socket.emit("sessions:pipelines", { sessionId: id })
	})

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

	/**
	 * Every other `sessions:*` reply this form reads, on the interest registry.
	 *
	 * ⚠ All BARE: none of these events has an entry in `SCOPED_EVENTS`, and a
	 * `#<id>` key for an unscoped event matches NO payload at all, so each
	 * handler's own `msg.sessionId !== session?.id` check stays the filter. The
	 * one scoped key this form holds is `sessions:get`, declared in its own
	 * effect above; `sessions:speakerStrategies`, `:presets` and `:functions`
	 * are declared with the request that fills them, likewise above.
	 *
	 * Declared at initialisation and released when the form is destroyed: the
	 * interest registry releases this form's subscribers as its effects are.
	 */
	useInterest<"sessions:toggleSessionCharacterActive">(
		"sessions:toggleSessionCharacterActive",
		handleToggleSessionCharacterActive
	)
	useInterest<"sessions:updateSessionCharacterVisibility">(
		"sessions:updateSessionCharacterVisibility",
		handleUpdateSessionCharacterVisibility
	)
	useInterest<"sessions:update">("sessions:update", handleSessionsUpdate)
	useInterest<"sessions:addGuest">(
		"sessions:addGuest",
		handleSessionsAddGuest
	)
	useInterest<"sessions:removeGuest">(
		"sessions:removeGuest",
		handleSessionsRemoveGuest
	)
	useInterest<"sessions:reassignRemovedParticipant">(
		"sessions:reassignRemovedParticipant",
		handleReassignRemovedParticipant
	)
	useInterest<"sessions:genres">("sessions:genres", handleSessionsModes)
	useInterest<"sessions:upgradeGenre">(
		"sessions:upgradeGenre",
		handleSessionsUpgradeMode
	)
	useInterest<"sessions:accountVisibility">(
		"sessions:accountVisibility",
		handleAccountVisibility
	)
	useInterest<"sessions:pipelines">(
		"sessions:pipelines",
		handleSessionsPipelines
	)
	useInterest<"sessions:choosePreset">(
		"sessions:choosePreset",
		handleSessionsChoosePreset
	)
	useInterest<"sessions:setFunction">(
		"sessions:setFunction",
		handleSessionsSetFunction
	)
	useInterest<"sessions:setSpeakerStrategy">(
		"sessions:setSpeakerStrategy",
		handleSessionsSetSpeakerStrategy
	)

	/**
	 * The cast pickers' three lists. All BARE — each is the whole of this
	 * user's characters/personas/tags, not one session's rows, so none has an
	 * interest scope to narrow to — and all standing, because all three are
	 * cascade targets: a character created, imported or renamed anywhere
	 * re-sends the list these pickers render.
	 */
	useInterest<"characters:list">("characters:list", handleCharactersList)
	useInterest<"tags:list">("tags:list", handleTagsList)

	/**
	 * The lorebook picker's list, on the same terms and for the same reasons:
	 * BARE (this user's whole list, nothing in `SCOPED_EVENTS` to key it to)
	 * and standing, because a lorebook created elsewhere re-sends it.
	 */
	useInterest<"lorebooks:list">("lorebooks:list", handleLorebooksList)

	onMount(() => {
		// Request initial data
		socket.emit("characters:list", {})
		socket.emit("lorebooks:list", {})
		socket.emit("tags:list", {})
		// The `sessions:genres` key is already held (declared above); the typed
		// `emit` puts its sync packet ahead of this request on the same socket.
		socket.emit("sessions:genres", {})
	})

	/**
	 * The session's envoys (plans/29 R-18; U5g) — the speakers its genre
	 * brings with it, off `sessions:view`, with whether each is seated. The
	 * genre's are offered here with a seat toggle; an action's is seated by
	 * its action's post and is listed without one.
	 */
	let sessionEnvoys: Sockets.Sessions.View.Envoy[] = $state([])
	const handleSessionsView = (msg: Sockets.Sessions.View.Response) => {
		if (msg.sessionId !== session?.id) return
		sessionEnvoys = msg.envoys ?? []
	}
	$effect(() => {
		const id = session?.id
		if (!id) return
		return requestWithInterest(
			"sessions:view",
			{ sessionId: id },
			handleSessionsView
		)
	})
	const genreEnvoys = $derived(
		sessionEnvoys.filter((e) => e.origin === "genre")
	)
	/**
	 * The switch is controlled (`checked={envoy.seated}`), so it moves when
	 * the list does and not before. Flipped here optimistically, so the
	 * press answers at once; the server's `sessions:view` re-send confirms
	 * it, and a refusal (`sessions:setEnvoySeat` with `error` — not the
	 * owner, an undeclared slug, an action's envoy) puts it back by
	 * re-reading the list, with the sentence as a toast (U5g review, S3).
	 */
	function setEnvoySeat(slug: string, seated: boolean): void {
		if (!session?.id) return
		sessionEnvoys = sessionEnvoys.map((e) =>
			e.slug === slug ? { ...e, seated } : e
		)
		const req: Sockets.Sessions.SetEnvoySeat.Params = {
			sessionId: session.id,
			slug,
			seated
		}
		socket.emit("sessions:setEnvoySeat", req)
	}
	const handleSessionsSetEnvoySeat = (
		msg: Sockets.Sessions.SetEnvoySeat.Response
	) => {
		if (msg.sessionId !== session?.id) return
		if (!msg.error) return
		toaster.error({ title: "Envoy seat", description: msg.error })
		// The truth is the server's list; the optimistic flip is reverted by
		// re-reading it rather than by guessing the previous value.
		socket.emit("sessions:view", { sessionId: msg.sessionId })
	}
	useInterest<"sessions:setEnvoySeat">(
		"sessions:setEnvoySeat",
		handleSessionsSetEnvoySeat
	)

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

{#if data}
	<div class="flex min-h-full flex-col gap-4">
		<PanelNavHeader
			title={name || session?.name || "Session"}
			onBack={handleCloseForm}
			backLabel="Close"
		>
			{#snippet primaryAction()}
				<button
					type="button"
					class="btn btn-sm shrink-0 {isDirty
						? 'preset-filled-primary-500'
						: 'preset-tonal'}"
					onclick={handleSave}
					disabled={!canSave}
				>
					<Icons.Save size={16} aria-hidden="true" />
					Save
				</button>
			{/snippet}
			{#snippet subtitle()}
				{#if isDirty}
					<p class="text-surface-500 text-xs">Unsaved changes</p>
				{/if}
			{/snippet}
		</PanelNavHeader>

		{#if !session}
			<div class="text-surface-500 flex items-center gap-2 p-4 text-sm">
				<Icons.LoaderCircle
					size={16}
					class="animate-spin"
					aria-hidden="true"
				/>
				Loading…
			</div>
		{:else}
			{#if isGuest}
				<p class="preset-tonal-surface rounded-[10px] p-3 text-[13px]">
					You're a guest in this session. You can manage characters,
					personas, and guests below — session settings (name,
					scenario, lorebook, tags, etc.) can only be changed by the
					session owner.
				</p>
			{/if}

			<section class={CARD_CLASS}>
				<h3 class="mb-3 text-sm font-medium">Name</h3>
				<div class="flex flex-col">
					<label
						class="text-surface-500 mb-1.5 text-xs"
						for="sessionName"
					>
						Session name
					</label>
					<input
						id="sessionName"
						class="{FIELD_CLASS} {validationErrors.name
							? 'border-error-500'
							: ''}"
						type="text"
						placeholder="Name this session"
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
						<p class="text-error-500 mt-1 text-xs" role="alert">
							{validationErrors.name}
						</p>
					{/if}
				</div>
			</section>

			<!-- Genre (19 §2, §6 as ruled). A session keeps its genre for life:
			     there is no swap control, only the upgrade along the same type
			     when the author has shipped a newer version, and even that is
			     shape-validated server-side with sentence refusals. -->
			{#if !isGuest && modeUpgradeTarget}
				<section class={CARD_CLASS}>
					<h3 class="mb-3 text-sm font-medium">Genre</h3>
					<div class="flex flex-wrap items-center gap-2">
						<span
							class="preset-tonal rounded-[10px] px-3 py-1.5 text-[13px]"
						>
							{modesList.find((m) => m.genreId === genreId)
								?.name ?? genreId}
						</span>
						<button
							class="btn btn-sm preset-filled-primary-500 shrink-0"
							title="Upgrade to {modeUpgradeTarget.genreId}"
							onclick={upgradeMode}
						>
							<Icons.ArrowUpCircle size={14} aria-hidden="true" />
							Upgrade
						</button>
					</div>
					<p class="text-surface-500 mt-2 text-xs">
						A newer version of this genre is available ({modeUpgradeTarget.genreId}).
						Upgrading keeps the session and its settings.
					</p>
				</section>
			{/if}

			<PanelTabStrip
				bind:value={activeSessionTab}
				tabs={sessionTabs}
				ariaLabel="Session settings"
				panelIdPrefix="session-panel"
			/>

			<div
				id="session-panel-participants"
				role="tabpanel"
				aria-labelledby="session-panel-participants-tab"
				hidden={activeSessionTab !== "participants"}
			>
				<div class="flex flex-col gap-3 pt-3">
					<!-- Capability-gated (19 §2): a section the mode's shape
						     omits does not exist for this session, so it neither
						     renders nor blocks saving. -->
					{#if showCharactersSection}
						<section class={CARD_CLASS}>
							<h3 class="mb-3 text-sm font-medium">
								Characters{charactersFloor > 0 ? "*" : ""}
							</h3>
							{#key session?.sessionCharacters}
								<div
									class="relative mb-2 flex flex-col gap-1"
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
										{@const label =
											c.nickname || c.name || ""}
										<div
											class="border-surface-300 dark:border-surface-800 flex min-h-11 flex-wrap items-center gap-2 rounded-[10px] border p-2"
											data-dnd-handle
										>
											<span
												class="text-surface-500 hover:text-primary-500 shrink-0 cursor-grab"
												data-dnd-handle
												class:hidden={selectedCharacters.length <=
													1}
												title="Drag to reorder"
											>
												<Icons.GripVertical size={16} />
											</span>
											<Avatar char={c} size="w-10 h-10" />
											<div class="min-w-0 flex-1">
												<div
													class="truncate text-[15px] font-medium select-none"
												>
													{label}
												</div>
												<div
													class="text-surface-600 dark:text-surface-400 truncate text-xs select-none"
												>
													{c.creatorNotes ||
														c.description ||
														""}
												</div>
											</div>
											<div
												class="flex shrink-0 items-center gap-1"
											>
												{#if selectedCharacters.length > 1}
													<button
														class="btn-ghost text-surface-500 hover:text-foreground rounded p-1 disabled:opacity-30"
														onclick={() =>
															moveCharacterUp(i)}
														disabled={i === 0}
														title="Move up"
														aria-label="Move {label} up"
													>
														<Icons.ChevronUp
															size={16}
														/>
													</button>
													<button
														class="btn-ghost text-surface-500 hover:text-foreground rounded p-1 disabled:opacity-30"
														onclick={() =>
															moveCharacterDown(
																i
															)}
														disabled={i ===
															selectedCharacters.length -
																1}
														title="Move down"
														aria-label="Move {label} down"
													>
														<Icons.ChevronDown
															size={16}
														/>
													</button>
												{/if}
												{#if session}
													<span
														title={isSaved
															? "Toggle Character Active"
															: "Save the session to set this character's active status"}
														class="flex items-center"
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
													</span>
													<button
														class="btn-ghost rounded p-1 {getVisibilityColor(
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
															'Full character info is included even when they’re not speaking'}"
														aria-label="Visibility for {label}: {SessionCharacterVisibility.options.find(
															(opt) =>
																opt.value ===
																visibility
														)?.label ||
															'Full Info'}"
													>
														<VisibilityIcon
															size={16}
														/>
													</button>
												{:else}
													<span
														class="text-surface-500 text-xs"
													>
														Ready to add
													</span>
												{/if}
												<button
													class="btn-ghost text-error-500 hover:bg-error-500/10 rounded p-1"
													onclick={() =>
														confirmRemoveCharacter(
															c.id,
															label
														)}
													title="Remove from session"
													aria-label="Remove {label} from the session"
												>
													<Icons.X size={16} />
												</button>
											</div>
										</div>
									{/each}
								</div>
							{/key}
							<button
								class="btn btn-sm preset-tonal"
								onclick={() => (showCharacterModal = true)}
							>
								<Icons.Plus size={16} aria-hidden="true" />
								Add a character
							</button>
						</section>
					{/if}
					{#if genreEnvoys.length}
						<!-- The genre's envoys (R-18): cast members the genre
						     brings with it, seated with a switch. Not a
						     character — nothing to add, remove or reorder. -->
						<section class={CARD_CLASS}>
							<h3 class="mb-3 text-sm font-medium">Envoys</h3>
							<div class="mb-2 flex flex-col gap-1">
								{#each genreEnvoys as envoy (envoy.slug)}
									<div
										class="border-surface-300 dark:border-surface-800 flex min-h-11 flex-wrap items-center gap-2 rounded-[10px] border p-2"
									>
										{#if envoy.image}
											<img
												class="h-10 w-10 shrink-0 rounded-full object-cover"
												src={envoy.image}
												alt=""
											/>
										{:else}
											<span
												class="preset-tonal-surface flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
												aria-hidden="true"
											>
												{envoy.name.trim().charAt(0).toUpperCase() || "?"}
											</span>
										{/if}
										<div class="min-w-0 flex-1">
											<div
												class="truncate text-[15px] font-medium select-none"
											>
												{envoy.name}
											</div>
											<div
												class="text-surface-600 dark:text-surface-400 truncate text-xs select-none"
											>
												{envoy.description ?? ""}
											</div>
										</div>
										<span
											class="text-surface-500 shrink-0 text-xs"
											title={envoy.speaks === "in-turn"
												? "Takes turns replying like a character"
												: "Speaks only through its action"}
										>
											{envoy.speaks === "in-turn"
												? "Replies in turn"
												: "On action"}
										</span>
										<Switch
											name="toggle-envoy-seat-{envoy.slug}"
											checked={envoy.seated}
											disabled={isGuest}
											onCheckedChange={(e) =>
												setEnvoySeat(envoy.slug, e.checked)}
											aria-label="Seat {envoy.name} in this session"
										>
											<Switch.Control
												class="preset-filled-surface-500 data-[state=checked]:preset-filled-success-500 w-9"
											>
												<Switch.Thumb>
													{#if envoy.seated}
														<Icons.Smile size="14" />
													{:else}
														<Icons.Meh size="14" />
													{/if}
												</Switch.Thumb>
											</Switch.Control>
											<Switch.HiddenInput />
										</Switch>
									</div>
								{/each}
							</div>
						</section>
					{/if}
					{#if showPersonasSection}
						<section class={CARD_CLASS}>
							<h3 class="mb-3 text-sm font-medium">
								Personas{personasFloor > 0 ? "*" : ""}
							</h3>
							<div
								class="relative mb-2 flex flex-col gap-1"
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
										class="border-surface-300 dark:border-surface-800 flex min-h-11 flex-wrap items-center gap-2 rounded-[10px] border p-2"
										data-dnd-handle
									>
										<span
											class="text-surface-500 hover:text-primary-500 shrink-0 cursor-grab"
											data-dnd-handle
											class:hidden={selectedPersonas.length <=
												1}
											title="Drag to reorder"
										>
											<Icons.GripVertical size={16} />
										</span>
										<Avatar char={p} size="w-10 h-10" />
										<div class="min-w-0 flex-1">
											<div
												class="truncate text-[15px] font-medium select-none"
											>
												{p.name}
											</div>
											<div
												class="text-surface-600 dark:text-surface-400 truncate text-xs select-none"
											>
												{p.description || ""}
											</div>
										</div>
										<div
											class="flex shrink-0 items-center gap-1"
										>
											{#if selectedPersonas.length > 1}
												<button
													class="btn-ghost text-surface-500 hover:text-foreground rounded p-1 disabled:opacity-30"
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
													class="btn-ghost text-surface-500 hover:text-foreground rounded p-1 disabled:opacity-30"
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
											{/if}
											<button
												class="btn-ghost text-error-500 hover:bg-error-500/10 rounded p-1"
												onclick={() =>
													confirmRemovePersona(
														p.id,
														p.name || ""
													)}
												title="Remove from session"
												aria-label="Remove {p.name} from the session"
											>
												<Icons.X size={16} />
											</button>
										</div>
									</div>
								{/each}
							</div>
							<button
								class="btn btn-sm preset-tonal"
								onclick={() => (showPersonaModal = true)}
							>
								<Icons.Plus size={16} aria-hidden="true" />
								Add a persona
							</button>
						</section>
					{/if}

					{#if session && (removedCharacters.length > 0 || removedPersonas.length > 0)}
						<section class={CARD_CLASS}>
							<h3 class="mb-1 text-sm font-medium">Removed</h3>
							<p class="text-surface-500 mb-2 text-xs">
								These were removed from the session, but their
								past messages are kept. Reassign a removed
								participant's history to a character or persona
								you own.
							</p>
							<div class="flex flex-col gap-2">
								{#each removedCharacters as rc (rc.id)}
									<div
										class="border-surface-300 dark:border-surface-800 flex min-h-11 items-center justify-between gap-3 rounded-[10px] border p-2"
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
										class="border-surface-300 dark:border-surface-800 flex min-h-11 items-center justify-between gap-3 rounded-[10px] border p-2"
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
						</section>
					{/if}

					{#if editSessionId && systemSettingsCtx?.settings?.isAccountsEnabled}
						<section class={CARD_CLASS}>
							<div
								class="mb-3 flex items-center justify-between gap-2"
							>
								<h3 class="text-sm font-medium">Guests</h3>
								<button
									class="btn btn-sm preset-tonal shrink-0"
									onclick={() => (showGuestModal = true)}
								>
									<Icons.UserPlus
										size={16}
										aria-hidden="true"
									/>
									Add guests
								</button>
							</div>
							<div class="flex flex-col gap-1">
								{#each selectedGuests as guest}
									<div
										class="border-surface-300 dark:border-surface-800 flex min-h-11 items-center justify-between gap-2 rounded-[10px] border p-2"
									>
										<span
											class="flex min-w-0 items-center gap-2"
										>
											<Icons.UserRound
												size={18}
												class="shrink-0"
												aria-hidden="true"
											/>
											<span
												class="truncate text-[15px] font-medium"
											>
												{resolveUserHandle(guest.user)}
											</span>
										</span>
										<button
											class="btn-ghost text-error-500 hover:bg-error-500/10 shrink-0 rounded p-1"
											onclick={() =>
												confirmRemoveGuest(
													guest.userId,
													resolveUserHandle(
														guest.user
													)
												)}
											title="Remove guest"
											aria-label="Remove {resolveUserHandle(
												guest.user
											)} from the session"
										>
											<Icons.X size={16} />
										</button>
									</div>
								{/each}
							</div>
						</section>
					{/if}

					{#if selectedCharacters.length > 1 || selectedPersonas.length > 1}
						<section class={CARD_CLASS}>
							<label
								class="text-surface-500 mb-1.5 block text-xs"
								for="groupReplyStrategy"
							>
								Group reply strategy
							</label>
							<select
								id="groupReplyStrategy"
								class="select rounded-[10px]"
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
						</section>
					{/if}
				</div>
			</div>

			<div
				id="session-panel-settings"
				role="tabpanel"
				aria-labelledby="session-panel-settings-tab"
				hidden={activeSessionTab !== "settings"}
			>
				<div class="flex flex-col gap-3 pt-3">
					<section class={CARD_CLASS}>
						<h3 class="mb-3 text-sm font-medium">The story</h3>
						<div class="flex flex-col gap-4">
							<div class="flex flex-col">
								<label
									class="text-surface-500 mb-1.5 flex items-center gap-1 text-xs"
									for="scenario"
								>
									Scenario
									<span
										class="flex items-center"
										title="This field will be visible in prompts"
									>
										<Icons.ScanEye
											size={14}
											aria-hidden="true"
										/>
									</span>
								</label>
								<textarea
									id="scenario"
									class={FIELD_CLASS}
									placeholder="Describe the session scenario, setting, or context (optional)"
									bind:value={scenario}
									rows={3}
									disabled={isGuest}
								></textarea>
							</div>
							{#if showLorebookField}
								<div class="flex flex-col">
									<label
										class="text-surface-500 mb-1.5 flex items-center gap-1 text-xs"
										for="lorebook"
									>
										Lorebook{modeShape?.lorebook ===
										"required"
											? "*"
											: ""}
										<span
											class="flex items-center"
											title="The session will use world lore, character lore and history entries from this lorebook"
										>
											<Icons.MessageCircleQuestion
												size={14}
												aria-hidden="true"
											/>
										</span>
									</label>
									<select
										id="lorebook"
										class="select rounded-[10px]"
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
						</div>
					</section>

					<!-- The preset (19 §7). One pipeline configuration, chosen
						     per session, deciding the settings this session runs on and
						     which actions it includes. Admins additionally see
						     disabled presets, marked — one an admin just switched
						     off vanishing entirely would read as deleted. -->
					{#if session && !isGuest && presetOptions.length > 0}
						<section class={CARD_CLASS}>
							<label
								class="text-surface-500 mb-1.5 block text-xs"
								for="sessionPreset"
							>
								Preset
							</label>
							<select
								id="sessionPreset"
								class="select rounded-[10px]"
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
						</section>
					{/if}

					<!-- Session actions (19 §3). Three layers decide what a session has:
						     its own answer, then its preset's included set, then the
						     companion rule. The permission line runs between the two
						     lists — anyone may toggle what the preset included; only
						     an admin may reach into the second list, because that
						     gives the session something the instance owner did not
						     offer it. -->
					{#if session && !isGuest && sessionFunctions.length > 0}
						<section class={CARD_CLASS}>
							<h3 class="mb-1 text-sm font-medium">Actions</h3>
							<p class="text-surface-500 mb-2 text-xs">
								What this session can do besides reply. Replying
								is intrinsic and always available.
							</p>

							{#each presetActions as f (actionIdentity(f))}
								{@const id = `fn-${actionIdentity(f)}`}
								<label
									class="flex items-start gap-2 text-sm"
									for={id}
								>
									<input
										{id}
										type="checkbox"
										class="checkbox mt-0.5"
										checked={f.enabled}
										disabled={functionsBusy === actionIdentity(f)}
										onchange={(e) =>
											toggleSessionFunction(
												f,
												e.currentTarget.checked
											)}
									/>
									<span class="flex flex-col">
										<span>
											{f.name}
											{#if f.source === "session"}
												<span
													class="text-surface-500 text-[10px]"
												>
													· set for this session
												</span>
											{/if}
										</span>
										<span class="text-surface-500 text-xs">
											{f.specSlug}
										</span>
									</span>
								</label>
							{/each}

							{#if presetActions.length === 0}
								<p class="text-surface-500 text-xs italic">
									This session's preset includes no actions.
								</p>
							{/if}

							{#if outsideActions.length > 0}
								<div class="mt-3 flex flex-col gap-2">
									<p class="text-xs font-medium">
										Not in this preset
									</p>
									<p class="text-surface-500 text-xs">
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
									{#each outsideActions as f (actionIdentity(f))}
										{@const id = `fn-${actionIdentity(f)}`}
										<label
											class="flex items-start gap-2 text-sm"
											for={id}
										>
											<input
												{id}
												type="checkbox"
												class="checkbox mt-0.5"
												checked={f.enabled}
												disabled={functionsBusy ===
													actionIdentity(f) ||
													(!canAddOutsidePreset &&
														!f.enabled)}
												onchange={(e) =>
													toggleSessionFunction(
														f,
														e.currentTarget.checked
													)}
											/>
											<span class="flex flex-col">
												<span>{f.name}</span>
												<span
													class="text-surface-500 text-xs"
												>
													{f.specSlug}
												</span>
											</span>
										</label>
									{/each}
								</div>
							{/if}
						</section>
					{/if}

					<!-- Turn order (19 §5): the dropdown IS the swap list — every
						     registered next-speaker strategy, an extension's beside
						     core's. "Pipeline default" inherits the pinned type;
						     choosing writes a session-scope rebind, and the receipt names
						     whichever type actually ran. -->
					{#if session && !isGuest && speakerStrategies.length > 0}
						<section class={CARD_CLASS}>
							<label
								class="text-surface-500 mb-1.5 block text-xs"
								for="turnOrder"
							>
								Turn order
							</label>
							<div class="flex items-center gap-2">
								<select
									id="turnOrder"
									class="select rounded-[10px]"
									bind:value={selectedSpeakerStrategy}
								>
									<option value={null}>
										Pipeline default
									</option>
									{#each speakerStrategies as s (s.definitionId)}
										<option value={s.definitionId}>
											{s.name}
										</option>
									{/each}
								</select>
								<button
									class="btn btn-sm preset-tonal shrink-0"
									onclick={applySpeakerStrategy}
								>
									Apply
								</button>
							</div>
						</section>
					{/if}

					<!-- Mode-declared per-session fields (19 §2): rendered through the one
			     schema renderer, stored on the session row, supplied back through the
			     input node's published document. Standard mode declares none. -->
					{#if Object.keys(modeFieldDecls).length > 0}
						<section class={CARD_CLASS}>
							<h3 class="mb-3 text-sm font-medium">
								Genre settings
							</h3>
							<SchemaForm
								schema={modeFieldDecls as any}
								bind:values={genreFields}
							/>
						</section>
					{/if}

					<!-- Configurables grouped BY PIPELINE (not by setting
						     type): every pipeline this chat involves — the reply
						     pipeline plus each enabled function like narrate — gets
						     its own card, rendered from the pipeline's own
						     declarations and written at this session's scope. The
						     panel already handles connection (text-gen only),
						     sampling, prompts and tuning per step. -->
					{#if session?.id && sessionPipelines.length}
						<section class={CARD_CLASS}>
							<h3 class="mb-1 text-sm font-medium">Pipelines</h3>
							<p class="text-surface-500 mb-3 text-xs">
								Changes here apply to this session only. Leave a
								control on its default to inherit the global
								setting.
							</p>
							<div class="flex flex-col gap-3">
								{#each sessionPipelines as p (p.slug)}
									<div
										class="border-surface-300 dark:border-surface-800 flex flex-col gap-2 rounded-[10px] border p-3"
									>
										<p class="text-[13px] font-medium">
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
						</section>
					{/if}

					<!-- Tags -->
					<section class="{CARD_CLASS} mb-10">
						<label
							class="text-surface-500 mb-1.5 block text-xs"
							for="tagInput"
						>
							Tags
						</label>
						<div class="relative">
							<input
								id="tagInput"
								type="text"
								bind:value={tagSearchInput}
								class={FIELD_CLASS}
								placeholder="Add a tag…"
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
									class="bg-surface-100-900 border-surface-300 dark:border-surface-800 absolute z-10 mt-1 max-h-40 w-full overflow-y-auto rounded-[10px] border shadow-lg"
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
													class="text-surface-500 text-xs"
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
					</section>
				</div>
			</div>

			<div
				id="session-panel-visibility"
				role="tabpanel"
				aria-labelledby="session-panel-visibility-tab"
				hidden={activeSessionTab !== "visibility"}
			>
				<div class="flex flex-col gap-3 pt-3">
					<div
						class="preset-tonal-surface rounded-[10px] p-4 text-[13px]"
					>
						<div class="flex items-start gap-2">
							<Icons.Eye size={18} class="mt-0.5 shrink-0" />
							<div class="flex flex-col gap-1">
								<p class="font-semibold">
									What this session sees of your data
								</p>
								<p class="text-surface-500">
									Anything you own and add here becomes
									visible to this session's other
									participants, and is read by the pipelines
									that generate its replies. This shows only
									your own data — never what anyone else has
									shared.
								</p>
							</div>
						</div>
					</div>

					{#if !accountVisibility}
						<p class="text-surface-500 text-sm">Loading…</p>
					{:else}
						<p class="text-sm">
							{#if accountVisibility.isOwner}
								You are the <span class="font-semibold">
									owner
								</span>
								of this session.
							{:else if accountVisibility.isGuest}
								You are a <span class="font-semibold">
									guest
								</span>
								in this session.
							{:else}
								You are a participant in this session.
							{/if}
						</p>

						{@const ex = accountVisibility.exposed}
						{#if ex.characters.length + ex.personas.length + ex.lorebooks.length === 0}
							<div
								class="border-surface-300 bg-surface-100 dark:border-surface-800 dark:bg-surface-900 rounded-[12px] border p-4 text-[13px]"
							>
								You have not added any of your own characters,
								personas, or lorebooks to this session — so it
								exposes nothing of yours.
							</div>
						{:else}
							<div class="flex flex-col gap-3">
								{#if ex.characters.length}
									<div
										class="border-surface-300 bg-surface-100 dark:border-surface-800 dark:bg-surface-900 flex flex-col gap-2 rounded-[12px] border p-3"
									>
										<div
											class="flex items-center gap-2 text-sm font-medium"
										>
											<Icons.User size={16} /> Characters
										</div>
										<div class="flex flex-wrap gap-2">
											{#each ex.characters as c}
												<span
													class="preset-tonal-primary rounded-full px-3 py-1 text-xs"
												>
													{c.name}
												</span>
											{/each}
										</div>
									</div>
								{/if}
								{#if ex.personas.length}
									<div
										class="border-surface-300 bg-surface-100 dark:border-surface-800 dark:bg-surface-900 flex flex-col gap-2 rounded-[12px] border p-3"
									>
										<div
											class="flex items-center gap-2 text-sm font-medium"
										>
											<Icons.UserCircle size={16} /> Personas
										</div>
										<div class="flex flex-wrap gap-2">
											{#each ex.personas as p}
												<span
													class="preset-tonal-primary rounded-full px-3 py-1 text-xs"
												>
													{p.name}
												</span>
											{/each}
										</div>
									</div>
								{/if}
								{#if ex.lorebooks.length}
									<div
										class="border-surface-300 bg-surface-100 dark:border-surface-800 dark:bg-surface-900 flex flex-col gap-2 rounded-[12px] border p-3"
									>
										<div
											class="flex items-center gap-2 text-sm font-medium"
										>
											<Icons.BookOpen size={16} /> Lorebooks
										</div>
										<div class="flex flex-wrap gap-2">
											{#each ex.lorebooks as l}
												<span
													class="preset-tonal-primary rounded-full px-3 py-1 text-xs"
												>
													{l.name}
												</span>
											{/each}
										</div>
									</div>
								{/if}
							</div>
						{/if}

						<div class="flex flex-col gap-2">
							<p class="text-sm font-medium">
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
											class="border-surface-300 bg-surface-100 dark:border-surface-800 dark:bg-surface-900 flex items-center justify-between gap-3 rounded-[12px] border p-3 text-[13px]"
										>
											<span
												class="flex items-center gap-2"
											>
												<Icons.User size={16} />
												{v.username}
											</span>
											<span
												class="preset-tonal-surface rounded-full px-2 py-0.5 text-xs capitalize"
											>
												{v.role}
											</span>
										</div>
									{/each}
								</div>
							{/if}
						</div>
					{/if}
				</div>
			</div>
		{/if}
	</div>
{/if}
<CharacterSelectModal
	open={showCharacterModal}
	characters={characters.filter(
		(c) => !selectedCharacters.some((sel) => sel.id === c.id)
	)}
	onOpenChange={(e) => (showCharacterModal = e.open)}
	onSelect={handleAddCharacter}
	onCreateNew={() => {
		showCharacterModal = false
		showCharacterCreator = true
	}}
/>
<PersonaSelectModal
	open={showPersonaModal}
	excludeIds={selectedPersonas.map((p) => p.id)}
	onOpenChange={(e) => (showPersonaModal = e.open)}
	onSelect={handleAddPersona}
	returnFullPersona={true}
	onCreateNew={() => {
		showPersonaModal = false
		showPersonaCreator = true
	}}
/>
<!-- The creators close themselves once the row exists; onCreated adds it to
	the form straight away so the user lands back on the form with the new
	participant already selected. -->
<CharacterCreatorModal
	bind:open={showCharacterCreator}
	onOpenChange={(e) => (showCharacterCreator = e.open)}
	onCreated={handleAddCharacter}
/>
<!-- A persona is a character, so the persona creator IS the character
	creator. Nothing here sets `is_persona`: the server does it when the
	sessionPersonas row is inserted (markCharacterAsPersona), so a creation the
	user then abandons never leaves a stray flag behind.
	TODO: once CharacterCreatorModal accepts a preset (the library lane's
	`initial` prop), pass `{ isPersona: true }` so the flag is visible in the
	form before Save. -->
<CharacterCreatorModal
	bind:open={showPersonaCreator}
	onOpenChange={(e) => (showPersonaCreator = e.open)}
	onCreated={handleAddPersona}
/>
<ReassignSessionParticipantModal
	open={showReassignModal}
	type={reassignTarget?.type ?? "character"}
	removedName={reassignTarget?.name ?? ""}
	characters={characters.filter(
		(c) => !selectedCharacters.some((sel) => sel.id === c.id)
	)}
	excludePersonaIds={selectedPersonas.map((p) => p.id)}
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
<!-- Gated on the same condition the Guests section is: the modal asks for
     `users:list` on mount, and with accounts disabled that request is refused
     and toasted. Mounting it beside a section that cannot be reached means the
     refusal arrives every time the edit form opens. -->
{#if editSessionId && systemSettingsCtx?.settings?.isAccountsEnabled}
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
{/if}
<SessionsUnsavedChangesModal
	open={showCancelModal}
	onOpenChange={handleCloseFormOnOpenChange}
	onConfirm={handleCloseModalDiscard}
	onCancel={handleCloseModalCancel}
/>
