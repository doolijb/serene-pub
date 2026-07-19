<script lang="ts">
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import CharacterSelectModal from "../modals/CharacterSelectModal.svelte"
	import PersonaSelectModal from "../modals/PersonaSelectModal.svelte"
	import UserSelectModal from "../modals/UserSelectModal.svelte"
	import Avatar from "../Avatar.svelte"
	import * as Icons from "@lucide/svelte"
	import { dndzone } from "svelte-dnd-action"
	import RemoveFromChatModal from "../modals/RemoveFromChatModal.svelte"
	import { onDestroy, onMount, getContext, untrack } from "svelte"
	import { Switch } from "@skeletonlabs/skeleton-svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { GroupReplyStrategies } from "$lib/shared/constants/GroupReplyStrategies"
	import { ChatCharacterVisibility } from "$lib/shared/constants/ChatCharacterVisibility"
	import { z } from "zod"
	import ConnectionSamplingPicker from "../ConnectionSamplingPicker.svelte"

	// Zod validation schema
	const chatSchema = z.object({
		name: z.string().min(1, "Chat name is required").trim(),
		scenario: z.string().optional(),
		groupReplyStrategy: z.string().optional()
	})

	type ValidationErrors = Record<string, string>

	interface Props {
		editChatId?: number | null // If provided, edit mode; else create mode
		showEditChatForm: boolean // Controls visibility of the form
		hasChanges?: boolean // Track if the form has unsaved changes
		onClose?: () => void
	}

	let {
		editChatId = $bindable(null),
		showEditChatForm = $bindable(),
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

	let chat: Sockets.Chats.Get.Response["chat"] | undefined = $state()
	let isCreating = $state(untrack(() => !chat))
	let characters: Sockets.Characters.List.Response["characterList"] = $state(
		[]
	)
	let personas: Sockets.Personas.List.Response["personaList"] = $state([])
	let lorebookList: Sockets.Lorebooks.List.Response["lorebookList"] = $state(
		[]
	)

	// Data structure to hold chat and selected characters/personas
	let data:
		| {
				chat: {
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
				}
				characterIds: number[]
				personaIds: number[]
				guestIds: number[]
				characterPositions: Record<number, number>
		  }
		| undefined = $state()

	let originalData:
		| {
				chat: {
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
	let chatConnectionId: number | null = $state(null)
	let chatSamplingConfigId: number | null = $state(null)
	let chatPromptConfigId: number | null = $state(null)
	let narratorPromptConfigId: number | null = $state(null)

	// AI override lists (admin only)
	let adminConnectionsList: Sockets.Connections.List.Response["connectionsList"] =
		$state([])
	let adminSamplingList: Sockets.SamplingConfigs.List.Response["samplingConfigsList"] =
		$state([])
	let adminPromptConfigsList: Sockets.PromptConfigs.List.Response["promptConfigsList"] =
		$state([])
	let adminNarratorPromptConfigsList: Sockets.NarratorPromptConfigs.List.Response["narratorPromptConfigsList"] =
		$state([])

	// MODALS
	let showCharacterModal = $state(false)
	let showPersonaModal = $state(false)
	let showGuestModal = $state(false)

	// FORM SUBMIT STATE
	let isDirty: boolean = $derived(
		JSON.stringify(data) !== JSON.stringify(originalData)
	)
	let canSave: boolean = $derived(
		// Always allow saving if we have basic requirements
		!!(
			data?.chat.name.trim() &&
			data?.characterIds.length > 0 &&
			data?.personaIds.length > 0
		)
	)

	// Sync hasChanges with isDirty
	$effect(() => {
		hasChanges = isDirty
	})

	// Initialize data for new chat creation
	$effect(() => {
		if (showEditChatForm && !editChatId && !data) {
			data = {
				chat: {
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
	// Populated either from the full chat load (chat.chatCharacters/Personas,
	// which carry the complete row) or from CharacterSelectModal/
	// PersonaSelectModal (which only carry the display-column subset from
	// "characters:list"/"personas:list") — Partial<...> reflects the latter.
	let selectedCharacters: (Partial<SelectCharacter> & { id: number })[] =
		$state([])
	let selectedPersonas: (Partial<SelectPersona> & { id: number })[] =
		$state([])
	let selectedGuests: NonNullable<
		NonNullable<Sockets.Chats.Get.Response["chat"]>["chatGuests"]
	> = $state([])
	let showRemoveModal = $state(false)
	let removeType: "character" | "persona" | "guest" = $state("character")
	let removeName = $state("")
	let removeId: number | null = $state(null)
	let validationErrors: ValidationErrors = $state({})
	let userCtx: UserCtx = getContext("userCtx")
	let systemSettingsCtx: SystemSettingsCtx = getContext("systemSettingsCtx")

	// A guest (chat participant who isn't the owner) may manage characters/
	// personas/guests on this chat but not chat-level settings (name,
	// scenario, lorebook, tags, response mode, AI overrides) — mirrors the
	// same restriction enforced server-side in chatsUpdateHandler, which
	// silently ignores those fields for non-owners regardless of what this
	// form sends, so this is UX clarity, not the actual security boundary.
	let isGuest: boolean = $derived(
		!!chat && chat.userId !== userCtx.user?.id
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
		const _connectionId = chatConnectionId
		const _samplingConfigId = chatSamplingConfigId
		const _promptConfigId = chatPromptConfigId
		const _narratorPromptConfigId = narratorPromptConfigId
		data = {
			chat: {
				id: chat?.id,
				name: _name,
				scenario: _scenario,
				groupReplyStrategy: _groupReplyStrategy || "ordered",
				lorebookId: _lorebookId,
				tags: _tags,
				connectionId: _connectionId,
				samplingConfigId: _samplingConfigId,
				promptConfigId: _promptConfigId,
				narratorPromptConfigId: _narratorPromptConfigId
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
		if (editChatId) {
			socket.emit("chats:get", { id: editChatId })
		}
	})

	function handleAddCharacter(char: Partial<SelectCharacter> & { id: number }) {
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

	function handleAddGuests(userIds: number[]) {
		if (!chat?.id) return
		const chatId = chat.id

		// Add each guest via socket
		userIds.forEach((userId) => {
			const req: Sockets.Chats.AddGuest.Params = {
				chatId,
				guestUserId: userId
			}
			socket.emit("chats:addGuest", req)
		})
		showGuestModal = false
	}

	function handleRemoveGuest(userId: number) {
		if (!chat?.id) return

		const req: Sockets.Chats.RemoveGuest.Params = {
			chatId: chat.id,
			guestUserId: userId
		}
		socket.emit("chats:removeGuest", req)
	}

	function handleSave() {
		if (!validateForm()) return
		if (
			!data?.chat.name.trim() ||
			selectedCharacters.length === 0 ||
			selectedPersonas.length === 0
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
				chat: {
					...data.chat,
					name: name.trim(),
					scenario: scenario.trim(),
					groupReplyStrategy: groupReplyStrategy
				}
			}
		}
		
		if (chat && chat.id) {
			const updateChat: Sockets.Chats.Update.Params = {
				...data!,
				chat: {
					...data!.chat,
					id: chat.id
				}
			}
			socket.emit("chats:update", updateChat)
		} else {
			const createChat: Sockets.Chats.Create.Params = {
				chat: {
					name: name.trim(),
					scenario: scenario.trim(),
					groupReplyStrategy: groupReplyStrategy,
					lorebookId: lorebookId,
					connectionId: chatConnectionId,
					samplingConfigId: chatSamplingConfigId,
					promptConfigId: chatPromptConfigId,
					narratorPromptConfigId: narratorPromptConfigId
				},
				characterIds,
				personaIds,
				characterPositions,
				tags: selectedTags
			}
			socket.emit("chats:create", createChat)
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
		const result = chatSchema.safeParse({
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

	function handleCloseForm() {
		// TODO handle unsaved changes if any
		showEditChatForm = false
		onClose?.()
	}

	// Socket event handlers - defined as named functions for proper cleanup
	const handleChatsGet = (msg: Sockets.Chats.Get.Response) => {
		if (msg.chat && msg.chat.id === editChatId) {
			// Create new object reference to ensure reactivity
			chat = {
				...msg.chat,
				chatCharacters: [...(msg.chat.chatCharacters || [])]
			}
			name = chat.name || ""
			scenario = chat.scenario || ""
			groupReplyStrategy = chat.groupReplyStrategy || "ordered"
			selectedCharacters =
				chat.chatCharacters?.map((cc) => cc.character) || []
			selectedPersonas =
				chat.chatPersonas?.map((cp) => cp.persona) || []
			selectedGuests = chat.chatGuests || []
			lorebookId = chat.lorebookId || null
			selectedTags = chat.tags || []
			chatConnectionId = chat.connectionId ?? null
			chatSamplingConfigId = chat.samplingConfigId ?? null
			chatPromptConfigId = chat.promptConfigId ?? null
			narratorPromptConfigId = chat.narratorPromptConfigId ?? null
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

	const handleTagsList = (msg: any) => {
		tagsList = msg.tagsList || []
	}

	const handleToggleChatCharacterActive = (
		msg: Sockets.Chats.ToggleChatCharacterActive.Response
	) => {
		if (msg.error) {
			toaster.error({
				title: "Error toggling character",
				description: msg.error
			})
			return
		}
		if (chat && chat.id === msg.chatId) {
			toaster.success({
				title: `Character ${msg.isActive ? "activated" : "deactivated"}`
			})
			// Refresh chat data to get updated state
			socket.emit("chats:get", { id: chat.id })
		}
	}

	const handleUpdateChatCharacterVisibility = (
		msg: Sockets.Chats.UpdateChatCharacterVisibility.Response
	) => {
		if (msg.error) {
			toaster.error({
				title: "Error updating visibility",
				description: msg.error
			})
			return
		}
		if (chat && chat.id === msg.chatId) {
			const visibilityLabel =
				ChatCharacterVisibility.options.find(
					(opt) => opt.value === msg.visibility
				)?.label || msg.visibility
			toaster.success({
				title: `Set to "${visibilityLabel}" when not speaking`
			})
			// Optimistically update local state immediately
			if (chat.chatCharacters) {
				const updatedChatCharacters = chat.chatCharacters.map((cc) =>
					cc.characterId === msg.characterId
						? { ...cc, visibility: msg.visibility }
						: cc
				)
				chat = { ...chat, chatCharacters: updatedChatCharacters }
			}
			// Also refresh from server to ensure consistency
			socket.emit("chats:get", { id: chat.id })
		}
	}

	const handleChatsCreate = (res: any) => {
		toaster.success({
			title: "Chat Created",
			description: `Chat "${res.chat.name || "Unnamed Chat"}" created successfully.`
		})
		showEditChatForm = false
		onClose?.()
	}

	const handleChatsUpdate = (res: any) => {
		toaster.success({
			title: "Chat Updated",
			description: `Chat "${res.chat.name || "Unnamed Chat"}" updated successfully.`
		})
		showEditChatForm = false
		onClose?.()
	}

	const handleChatsAddGuest = (res: Sockets.Chats.AddGuest.Response) => {
		if (res.success) {
			toaster.success({ title: "Guest added successfully" })
			// Request updated chat data
			if (editChatId) {
				socket.emit("chats:get", { id: editChatId })
			}
		} else if (res.error) {
			toaster.error({ title: res.error })
		}
	}

	const handleChatsRemoveGuest = (
		res: Sockets.Chats.RemoveGuest.Response
	) => {
		if (res.success) {
			toaster.success({ title: "Guest removed successfully" })
			// Request updated chat data
			if (editChatId) {
				socket.emit("chats:get", { id: editChatId })
			}
		} else if (res.error) {
			toaster.error({ title: res.error })
		}
	}

	onMount(() => {
		// Register all socket event handlers
		socket.on("chats:get", handleChatsGet)
		socket.on("characters:list", handleCharactersList)
		socket.on("personas:list", handlePersonasList)
		socket.on("lorebooks:list", handleLorebooksList)
		socket.on("tags:list", handleTagsList)
		socket.on(
			"chats:toggleChatCharacterActive",
			handleToggleChatCharacterActive
		)
		socket.on(
			"chats:updateChatCharacterVisibility",
			handleUpdateChatCharacterVisibility
		)
		socket.on("chats:create", handleChatsCreate)
		socket.on("chats:update", handleChatsUpdate)
		socket.on("chats:addGuest", handleChatsAddGuest)
		socket.on("chats:removeGuest", handleChatsRemoveGuest)

		// Admin-only: load connections, sampling configs, and prompt configs for override pickers
		if (userCtx.user?.isAdmin) {
			socket.on("connections:list", (msg: Sockets.Connections.List.Response) => { adminConnectionsList = msg.connectionsList || [] })
			socket.on("samplingConfigs:list", (msg: Sockets.SamplingConfigs.List.Response) => { adminSamplingList = msg.samplingConfigsList || [] })
			socket.on("promptConfigs:list", (msg: Sockets.PromptConfigs.List.Response) => { adminPromptConfigsList = msg.promptConfigsList || [] })
			socket.on("narratorPromptConfigs:list", (msg: Sockets.NarratorPromptConfigs.List.Response) => { adminNarratorPromptConfigsList = msg.narratorPromptConfigsList || [] })
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
	})

	onDestroy(() => {
		socket.off("connections:list")
		socket.off("samplingConfigs:list")
		socket.off("promptConfigs:list")
		socket.off("narratorPromptConfigs:list")
		// Properly remove event handlers by passing the function references
		socket.off("chats:get", handleChatsGet)
		socket.off("characters:list", handleCharactersList)
		socket.off("personas:list", handlePersonasList)
		socket.off("lorebooks:list", handleLorebooksList)
		socket.off("tags:list", handleTagsList)
		socket.off(
			"chats:toggleChatCharacterActive",
			handleToggleChatCharacterActive
		)
		socket.off(
			"chats:updateChatCharacterVisibility",
			handleUpdateChatCharacterVisibility
		)
		socket.off("chats:create", handleChatsCreate)
		socket.off("chats:update", handleChatsUpdate)
		socket.off("chats:addGuest", handleChatsAddGuest)
		socket.off("chats:removeGuest", handleChatsRemoveGuest)
	})

	function toggleCharacterActive(
		e: { checked: boolean },
		c: Partial<SelectCharacter> & { id: number }
	): void {
		if (!chat?.id) {
			console.error("No chat ID available")
			return
		}
		const req: Sockets.Chats.ToggleChatCharacterActive.Params = {
			chatId: chat.id,
			characterId: c.id
		}
		socket.emit("chats:toggleChatCharacterActive", req)
	}

	function updateCharacterVisibility(
		c: Partial<SelectCharacter> & { id: number },
		visibility: string
	): void {
		if (!chat?.id) {
			console.error("No chat ID available")
			return
		}
		const req: Sockets.Chats.UpdateChatCharacterVisibility.Params = {
			chatId: chat.id,
			characterId: c.id,
			visibility
		}
		socket.emit("chats:updateChatCharacterVisibility", req)
	}

	function getVisibilityIcon(visibility: string) {
		switch (visibility) {
			case ChatCharacterVisibility.VISIBLE:
				return Icons.Eye
			case ChatCharacterVisibility.MINIMAL:
				return Icons.EyeClosed
			case ChatCharacterVisibility.HIDDEN:
				return Icons.EyeOff
			default:
				return Icons.Eye
		}
	}

	function getVisibilityColor(visibility: string) {
		switch (visibility) {
			case ChatCharacterVisibility.VISIBLE:
				return "text-success-500"
			case ChatCharacterVisibility.MINIMAL:
				return "text-warning-500"
			case ChatCharacterVisibility.HIDDEN:
				return "text-error-500"
			default:
				return "text-success-500"
		}
	}

	function getNextVisibility(current: string): string {
		switch (current) {
			case ChatCharacterVisibility.VISIBLE:
				return ChatCharacterVisibility.MINIMAL
			case ChatCharacterVisibility.MINIMAL:
				return ChatCharacterVisibility.HIDDEN
			case ChatCharacterVisibility.HIDDEN:
				return ChatCharacterVisibility.VISIBLE
			default:
				return ChatCharacterVisibility.VISIBLE
		}
	}
</script>

{#if data}
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
				{chat ? "Edit Chat" : "New Chat"}
			</h2>
			<button
				class="btn btn-sm shrink-0"
				class:preset-filled-success-500={isDirty}
				class:preset-tonal-success={!isDirty}
				onclick={handleSave}
				disabled={!canSave}
			>
				<Icons.Save size={16} />
				{chat ? "Update" : "Create"}
			</button>
		</div>
		{#if isGuest}
			<p class="preset-tonal-surface rounded-lg p-3 text-sm">
				You're a guest in this chat. You can manage characters, personas,
				and guests below — chat settings (name, scenario, lorebook, tags,
				etc.) can only be changed by the chat owner.
			</p>
		{/if}
		<div>
			<label class="font-semibold" for="chatName">Chat Name*</label>
			<input
				id="chatName"
				class="input input-lg w-full {validationErrors.name
					? 'border-error-500'
					: ''}"
				type="text"
				placeholder="Enter chat name"
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
				<p class="mt-1 text-sm text-error-500" role="alert">
					{validationErrors.name}
				</p>
			{/if}
		</div>
		<div>
			<span class="mb-2 font-semibold">Characters*</span>
			{#key chat?.chatCharacters}
				<div
					class="relative mb-2 flex flex-col gap-2"
					use:dndzone={{
						items: selectedCharacters,
						flipDurationMs: 150,
						dragDisabled: !(selectedCharacters.length > 1),
						dropFromOthersDisabled: true
					}}
					onconsider={(e) => (selectedCharacters = e.detail.items)}
					onfinalize={(e) => (selectedCharacters = e.detail.items)}
				>
					{#each selectedCharacters as c, i (c.id)}
						{@const isActive = chat
							? !!chat?.chatCharacters?.find(
									(cc) => cc.characterId === c.id
								)?.isActive
							: true}
						{@const visibility = chat
							? chat?.chatCharacters?.find(
									(cc) => cc.characterId === c.id
								)?.visibility || ChatCharacterVisibility.VISIBLE
							: ChatCharacterVisibility.VISIBLE}
						{@const VisibilityIcon = getVisibilityIcon(visibility)}
						<div
							class="preset-outlined-surface-400-600 bg-surface-100-800 hover:bg-surface-200-800 flex flex-col gap-3 rounded-xl p-3 shadow-sm transition-colors"
							data-dnd-handle
						>
							<div class="flex items-start gap-3">
								<div class="relative w-fit shrink-0">
									<span
										class="text-surface-400 hover:text-primary-500 absolute -top-2 -left-2 z-10 cursor-grab"
										data-dnd-handle
										class:hidden={selectedCharacters.length <=
											1}
										title="Drag to reorder"
									>
										<Icons.GripVertical size={18} />
									</span>
									<Avatar char={c} />
								</div>
								<div class="min-w-0 flex-1">
									<div class="truncate font-semibold select-none">
										{c.nickname || c.name}
									</div>
									<div
										class="text-surface-700-300 line-clamp-2 text-xs select-none"
									>
										{c.creatorNotes || c.description || ""}
									</div>
								</div>
								{#if selectedCharacters.length > 1}
									<div class="flex shrink-0 flex-col gap-0.5">
										<button
											class="btn-ghost rounded p-0.5 disabled:opacity-30"
											onclick={() => moveCharacterUp(i)}
											disabled={i === 0}
											title="Move up"
											aria-label="Move {c.nickname || c.name} up"
										>
											<Icons.ChevronUp size={16} />
										</button>
										<button
											class="btn-ghost rounded p-0.5 disabled:opacity-30"
											onclick={() => moveCharacterDown(i)}
											disabled={i === selectedCharacters.length - 1}
											title="Move down"
											aria-label="Move {c.nickname || c.name} down"
										>
											<Icons.ChevronDown size={16} />
										</button>
									</div>
								{/if}
							</div>
							<div
								class="border-surface-300-700 flex items-center justify-between gap-2 border-t pt-2"
							>
								{#if chat}
									<span
										title="Toggle Character Active"
										class="flex items-center gap-2"
									>
										<Switch
											name="toggle-character-active-{c.id}"
											checked={isActive}
											onCheckedChange={(e) =>
												toggleCharacterActive(e, c)}
											aria-label="Toggle character {c.name} active status"
										>
											<Switch.Control
												class="w-9 preset-filled-surface-500 data-[state=checked]:preset-filled-success-500"
											>
												<Switch.Thumb>
													{#if isActive}
														<Icons.Smile size="14" />
													{:else}
														<Icons.Meh size="14" />
													{/if}
												</Switch.Thumb>
											</Switch.Control>
											<Switch.HiddenInput />
										</Switch>
										<span class="text-surface-700-300 text-xs">
											{isActive ? "Active" : "Inactive"}
										</span>
									</span>
									<button
										class="btn btn-sm {getVisibilityColor(
											visibility
										)}"
										onclick={() =>
											updateCharacterVisibility(
												c,
												getNextVisibility(visibility)
											)}
										title="When not speaking: {ChatCharacterVisibility.options.find(
											(opt) => opt.value === visibility
										)?.description || 'Full character info is included even when they\'re not speaking'}"
									>
										<VisibilityIcon size={16} />
										{ChatCharacterVisibility.options.find(
											(opt) => opt.value === visibility
										)?.label || "Full Info"}
									</button>
								{:else}
									<span class="text-surface-700-300 text-xs">
										Ready to add
									</span>
								{/if}
								<button
									class="preset-tonal-error btn btn-sm"
									onclick={() =>
										confirmRemoveCharacter(
											c.id,
											c.nickname || c.name || ""
										)}
									title="Remove from chat"
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
		<div>
			<span class="mb-2 font-semibold">Personas*</span>
			<div
				class="relative mb-2 flex flex-col gap-2"
				use:dndzone={{
					items: selectedPersonas,
					flipDurationMs: 150,
					dragDisabled: !(selectedPersonas.length > 1),
					dropFromOthersDisabled: true
				}}
				onconsider={(e) => (selectedPersonas = e.detail.items)}
				onfinalize={(e) => (selectedPersonas = e.detail.items)}
			>
				{#each selectedPersonas as p, i (p.id)}
					<div
						class="preset-outlined-surface-400-600 bg-surface-100-800 hover:bg-surface-200-800 flex flex-col gap-3 rounded-xl p-3 shadow-sm transition-colors"
						data-dnd-handle
					>
						<div class="flex items-start gap-3">
							<div class="relative w-fit shrink-0">
								<span
									class="text-surface-400 hover:text-primary-500 absolute -top-2 -left-2 z-10 cursor-grab"
									data-dnd-handle
									class:hidden={selectedPersonas.length <= 1}
									title="Drag to reorder"
								>
									<Icons.GripVertical size={18} />
								</span>
								<Avatar char={p} />
							</div>
							<div class="min-w-0 flex-1">
								<div class="truncate font-semibold select-none">
									{p.name}
								</div>
								<div
									class="text-surface-700-300 line-clamp-2 text-xs select-none"
								>
									{p.description || ""}
								</div>
							</div>
							{#if selectedPersonas.length > 1}
								<div class="flex shrink-0 flex-col gap-0.5">
									<button
										class="btn-ghost rounded p-0.5 disabled:opacity-30"
										onclick={() => movePersonaUp(i)}
										disabled={i === 0}
										title="Move up"
										aria-label="Move {p.name} up"
									>
										<Icons.ChevronUp size={16} />
									</button>
									<button
										class="btn-ghost rounded p-0.5 disabled:opacity-30"
										onclick={() => movePersonaDown(i)}
										disabled={i === selectedPersonas.length - 1}
										title="Move down"
										aria-label="Move {p.name} down"
									>
										<Icons.ChevronDown size={16} />
									</button>
								</div>
							{/if}
						</div>
						<div
							class="border-surface-300-700 flex items-center justify-end border-t pt-2"
						>
							<button
								class="preset-tonal-error btn btn-sm"
								onclick={() => confirmRemovePersona(p.id, p.name || "")}
								title="Remove from chat"
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

		{#if editChatId && systemSettingsCtx?.settings?.isAccountsEnabled}
			<!-- Guests Section (only show in edit mode and when accounts are enabled) -->
			<div>
				<label class="mb-3 flex items-center justify-between">
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
						<div class="preset-outlined-surface-400-600 bg-surface-100-800 rounded-xl p-3">
							<div class="flex flex-col gap-2">
								<div class="flex items-center justify-between">
									<div class="flex items-center gap-2">
										<Icons.User size={20} />
										<span class="font-semibold">
											{guest.user?.username ||
												"Unknown User"}
										</span>
									</div>
									<button
										class="hover:preset-filled-error-500 rounded p-1"
										onclick={() =>
											confirmRemoveGuest(
												guest.userId,
												guest.user?.username ||
													"Unknown User"
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
				<label class="font-semibold" for="groupReplyStrategy">
					Group Reply Strategy
				</label>
				<select
					id="groupReplyStrategy"
					class="select input-lg w-full"
					bind:value={groupReplyStrategy}
					disabled={isGuest}
				>
					{#each GroupReplyStrategies.options as opt}
						<option value={opt.value}>{opt.label}</option>
					{/each}
				</select>
			</div>
		{/if}
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
				placeholder="Describe the chat scenario, setting, or context (optional)"
				bind:value={scenario}
				rows={3}
				disabled={isGuest}
			></textarea>
		</div>
		<div>
			<label class="flex gap-1 font-semibold" for="lorebook">
				Lorebook <span
					class="flex items-center opacity-50 transition-opacity duration-200 hover:opacity-100"
					title="The chat will use world lore, character lore and history entries from this lorebook"
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
					<option value={lorebook.id}>{lorebook.name}</option>
				{/each}
			</select>
		</div>

		<!-- Admin-only AI override -->
		{#if userCtx.user?.isAdmin}
			<div class="flex flex-col gap-2">
				<p class="font-semibold">AI Override</p>
				<p class="text-muted-foreground text-xs">Overrides system defaults for this chat. Leave as "System default" to use the global setting.</p>
				<ConnectionSamplingPicker
					connectionsList={adminConnectionsList}
					samplingList={adminSamplingList}
					bind:connectionId={chatConnectionId}
					bind:samplingConfigId={chatSamplingConfigId}
				/>
				<div class="grid grid-cols-[5.5rem_1fr] items-center gap-x-2 gap-y-1.5">
					<span class="text-muted-foreground text-xs">Character Prompt</span>
					<select class="select text-xs" bind:value={chatPromptConfigId}>
						<option value={null}>System default</option>
						{#each adminPromptConfigsList.filter((p) => p.id != null) as p}
							<option value={p.id}>{p.name}</option>
						{/each}
					</select>
				</div>
				<div class="grid grid-cols-[5.5rem_1fr] items-center gap-x-2 gap-y-1.5">
					<span class="text-muted-foreground text-xs">Narrator Prompt</span>
					<select class="select text-xs" bind:value={narratorPromptConfigId}>
						<option value={null}>System default</option>
						{#each adminNarratorPromptConfigsList.filter((p) => p.id != null) as p}
							<option value={p.id}>{p.name}</option>
						{/each}
					</select>
				</div>
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
						setTimeout(() => (showTagSuggestions = false), 200)}
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
			{#if selectedTags.length > 0}
				<div class="mt-2 flex flex-wrap gap-2">
					{#each selectedTags as tagName}
						{@const tag = tagsList.find((t) => t.name === tagName)}
						<button
							type="button"
							class="chip {tag?.colorPreset ||
								'preset-filled-primary-500'} group relative"
							onclick={() => removeTag(tagName)}
							disabled={isGuest}
							title={isGuest ? tagName : "Click to remove tag"}
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
	<!-- RemoveFromChatModal only models "character" | "persona" (its ternaries
		fall back to the "character" copy for anything else, including its own
		default value of "character") — mapping "guest" to undefined below
		keeps that exact same fallback behavior while satisfying its prop type. -->
	<RemoveFromChatModal
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
			...(chat?.userId ? [chat.userId] : []),
			...selectedGuests.map((g) => g.userId)
		]}
		onclose={() => (showGuestModal = false)}
		onSelect={() => {}}
		multiSelect={true}
		onMultiSelect={handleAddGuests}
		title="Add Guests to Chat"
		description="Select users to add as guests. Guests can view and participate in the chat."
	/>
{/if}
