<script lang="ts">
	import { page } from "$app/state"
	import { goto } from "$app/navigation"
	import { Dialog, Portal, Popover } from "@skeletonlabs/skeleton-svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { GroupReplyStrategies } from "$lib/shared/constants/GroupReplyStrategies"
	import * as Icons from "@lucide/svelte"
	import MessageComposer from "$lib/client/components/sessionMessages/MessageComposer.svelte"
	import MessageControls from "$lib/client/components/sessionMessages/MessageControls.svelte"
	import SessionContainer from "$lib/client/components/sessionMessages/SessionContainer.svelte"
	import PluginFrame from "$lib/client/components/frames/PluginFrame.svelte"
	import SessionMessage from "$lib/client/components/sessionMessages/SessionMessage.svelte"
	import NextCharacterBlock from "$lib/client/components/sessionMessages/NextCharacterBlock.svelte"
	import ProcessSceneModal from "$lib/client/components/modals/ProcessSceneModal.svelte"
	import SessionComposer from "$lib/client/components/sessionMessages/SessionComposer.svelte"
	import GeneratingAnimation from "$lib/client/components/sessionMessages/GeneratingAnimation.svelte"
	import { renderMarkdownWithQuotedText } from "$lib/client/utils/markdownToHTML"
	import { getContext, onDestroy, onMount } from "svelte"
	import Avatar from "$lib/client/components/Avatar.svelte"
	import PersonaSelectModal from "$lib/client/components/modals/PersonaSelectModal.svelte"
	import BranchSessionModal from "$lib/client/components/modals/BranchSessionModal.svelte"
	import SummarizeLoreModal from "$lib/client/components/modals/SummarizeLoreModal.svelte"
	import TriggerNarratorResponseModal from "$lib/client/components/modals/TriggerNarratorResponseModal.svelte"
	import EntityGalleryViewModal from "$lib/client/components/sessionMessages/EntityGalleryViewModal.svelte"
	import SessionSceneImagesTab from "$lib/client/components/sessionMessages/SessionSceneImagesTab.svelte"
	import SessionWorkflowTab from "$lib/client/components/sessionMessages/SessionWorkflowTab.svelte"
	import { sceneImages } from "$lib/client/stores/sceneImages"
	import { toaster } from "$lib/client/utils/toaster"
	import { resolveCharacterName } from "$lib/shared/utils/resolveCharacterName"
	import SessionLayout from "$lib/client/sessionLayout/SessionLayout.svelte"
	import { SurfaceManager } from "$lib/client/surfaces/panelManager.svelte"
	import type { LayoutBlob } from "$lib/client/surfaces/types"

	let session: Sockets.Sessions.Get.Response["session"] | undefined = $state()
	let pagination: Sockets.Sessions.Get.Response["pagination"] | undefined =
		$state()
	let newMessage = $state("")
	const socket = useTypedSocket()
	let showDeleteMessageModal = $state(false)
	let deleteSessionMessage: SelectSessionMessage | undefined = $state()
	let editSessionMessage: SelectSessionMessage | undefined = $state()
	let draftCompiledPrompt:
		| Sockets.Sessions.PromptTokenCount.Response
		| undefined = $state()
	let userCtx: UserCtx = getContext("userCtx")
	let panelsCtx: PanelsCtx = getContext("panelsCtx")
	let systemSettingsCtx: SystemSettingsCtx = getContext("systemSettingsCtx")
	let userSettingsCtx: UserSettingsCtx = getContext("userSettingsCtx")
	let openSessionCtx: OpenSessionCtx = getContext("openSessionCtx")
	let sceneSummarizesCtx: SceneSummarizesCtx = $state(
		getContext("sceneSummarizesCtx")
	)
	let sessionSummarizesCtx: SessionSummarizesCtx = $state(
		getContext("sessionSummarizesCtx")
	)

	// Lets globally-rendered sidebars (e.g. LorebooksSidebar) know which session
	// is open and whether it already has a lorebook, without a fetch of their own.
	$effect(() => {
		openSessionCtx.sessionId = session?.id ?? null
		openSessionCtx.lorebookId = session?.lorebookId ?? null
		openSessionCtx.isOwner =
			!!session && session.userId === userCtx.user?.id
	})

	let summarizationEnabled = $derived(
		!!systemSettingsCtx.settings?.summarizationEnabled
	)
	let vectorizationEnabled = $derived(
		!!systemSettingsCtx.settings?.vectorizationEnabled
	)

	// ── Typing indicator ──────────────────────────────────────────────────────
	// Other participants' personas currently typing, keyed by personaId. Purely
	// client-expired — there's no "stopped typing" event, entries just drop
	// off 10s after the last ping (matches how the composer's own throttled
	// ping below only re-fires every ~2.5s while text keeps changing).
	let typingPersonas: Map<number, { name: string; lastTypingAt: number }> =
		$state(new Map())
	let lastTypingEmitAt = 0
	let typingPruneInterval: ReturnType<typeof setInterval> | null = null

	$effect(() => {
		const content = newMessage
		if (!sessionId || !session || !content.trim()) return
		const now = Date.now()
		if (now - lastTypingEmitAt < 2500) return
		lastTypingEmitAt = now
		const personaId =
			currentUserPersona?.personaId ||
			session?.sessionPersonas?.[0]?.personaId
		if (personaId) socket.emit("sessions:typing", { sessionId, personaId })
	})

	// ── Draft autosave ────────────────────────────────────────────────────────
	// Debounce-save newMessage to the server as the user types.
	// Only runs when the session is loaded (session !== undefined) to avoid
	// clobbering another user's draft during a session transition.
	$effect(() => {
		const content = newMessage
		const currentSessionId = sessionId
		if (!currentSessionId || !session) return
		const timer = setTimeout(() => {
			socket.emit("sessions:saveDraft", {
				sessionId: currentSessionId,
				content
			})
		}, 500)
		return () => clearTimeout(timer)
	})

	let promptTokenCountTimeout: ReturnType<typeof setTimeout> | null = null
	let autoTriggerTimeout: ReturnType<typeof setTimeout> | null = null
	let loadingOlderMessages = $state(false)
	let messagesContainer: HTMLElement | undefined = $state()
	let contextExceeded = $derived(
		draftCompiledPrompt?.meta
			? draftCompiledPrompt.meta.tokenCounts.total >
					draftCompiledPrompt.meta.tokenCounts.limit
			: false
	)
	let openMsgControlsMenu: number | undefined = $state(undefined)
	let showDraftCompiledPromptModal = $state(false)
	let showTriggerCharacterMessageModal = $state(false)
	let triggerCharacterSearch = $state("")
	let showTriggerNarratorResponseModal = $state(false)
	let showAddPersonaModal = $state(false)
	let showBranchSessionModal = $state(false)
	let branchFromMessage: SelectSessionMessage | undefined = $state()

	// Summarization mode
	let isSummarizationMode = $state(false)
	let selectedMessageIds = $state(new Set<number>())
	let showSummarizeModal = $state(false)
	let summarizeLoreType = $state<"world" | "character" | "scene">("world")
	/** Message IDs already captured in a scene — hard-blocked from selection */
	let scenedMessageIds = $state(new Set<number>())
	/** Full scene list for this session — used for in-session scene/history-entry indicators */
	let sceneList = $state<Sockets.Scenes.List.SceneWithEntry[]>([])
	// Resolved display name for Narrator responses (session override -> user active
	// -> system default -> "Narrator"), used to label the trigger button/
	// modal/character-picker option before any message exists.
	let narratorName = $state("Narrator")

	// The contributed trigger set (19 §4, U-C5): what this mode's sessions offer
	// beyond the intrinsic composer, read from rows. The narrate button's
	// *presence* comes from here — retiring the narrate spec removes it with
	// no UI code involved. Its presentation stays bespoke (the resolved
	// narrator name), which is a client mapping on the function key, not a
	// hardcoded button.
	let modeTriggers: Sockets.Sessions.Triggers.Response["triggers"] = $state(
		[]
	)

	// The session's frame surfaces (20 §12): a mode-declared session-view
	// replaces core's log wholesale (the total-conversion lane); panels are
	// every enabled plugin's declared side frames. Presence is data — a
	// disabled plugin takes its frames with it, and a missing view-plugin
	// falls back to core's log with no error.
	let sessionFrames = $state<Sockets.Sessions.View.Response | null>(null)
	const sessionViewFrame = $derived(sessionFrames?.sessionView ?? null)

	// ── Surface grid (plan 21) ──────────────────────────────────────
	// The modular session layout: the conversation is the primary panel, and
	// scene portraits / sample widgets flow into container-responsive tracks
	// beside it. Availability = the mode's declared panels (from sessions:view)
	// merged with core's defaults below; placement is this user's, persisted.
	const surfaceManager = new SurfaceManager()
	let panelViewLoaded = $state(false)
	let panelLayoutLoaded = $state(false)
	let panelLayoutBlob = $state<LayoutBlob>({})

	/**
	 * Core's default panels for the standard chat — the scene portraits (moved
	 * out of the fixed viewport overlays) plus two temporary sample artifacts
	 * (plan 21) that exercise the framework. A custom mode's own panels arrive
	 * via `sessions:view.modePanels` and are merged on top (mode wins by id).
	 */
	const CORE_DEFAULT_PANELS: Sockets.Sessions.View.ModePanel[] = [
		{
			id: "scene-portraits",
			title: "Scene Portraits",
			icon: "Users",
			role: "secondary",
			surface: { kind: "native", component: "scene-portraits" },
			layout: { span: { ideal: 1 }, minInline: 200 },
			defaultActive: true
		},
		{
			id: "sample-map",
			title: "Map (sample)",
			icon: "Map",
			role: "secondary",
			surface: { kind: "native", component: "sample-map" },
			// A view onto the `map` channel: a node writing there pops it open.
			channels: ["map"],
			layout: { span: { ideal: 1 }, minInline: 220 },
			defaultActive: false
		},
		{
			id: "sample-notes",
			title: "Tasks (sample)",
			icon: "ListTodo",
			role: "secondary",
			surface: { kind: "native", component: "sample-notes" },
			// A view onto the `tasks` channel — the ST-style mission-list case.
			channels: ["tasks"],
			layout: { span: { ideal: 1 }, minInline: 200 },
			defaultActive: false
		},
		{
			// A live *iframe* panel (temporary test artifact, plan 21 §7): a
			// sandboxed opaque-origin frame speaking the frame protocol. Add it
			// from the drawer's + menu, then move/drawer it — its counter never
			// resets, proving the grid never reloads the iframe. `src` is set
			// directly here (a real plugin panel gets its src from the server).
			id: "sample-frame",
			title: "Frame (sample)",
			icon: "AppWindow",
			role: "secondary",
			surface: {
				kind: "frame",
				pluginId: "dev/sample-frame",
				entry: "dev-frame-panel.html"
			},
			src: "/dev-frame-panel.html",
			channels: ["main"],
			layout: { span: { ideal: 1 }, minInline: 240 },
			defaultActive: false
		}
	]

	function persistPanelLayout(blob: LayoutBlob) {
		if (sessionId == null) return
		panelLayoutBlob = blob
		socket.emit("sessions:panelLayout:set", {
			sessionId,
			layout: blob as Record<string, unknown>
		})
	}

	/** (Re)seed the manager once both the panel set and the saved layout land. */
	function initSurfaceManagerIfReady() {
		if (!panelViewLoaded || !panelLayoutLoaded) return
		const byId = new Map<string, Sockets.Sessions.View.ModePanel>()
		for (const p of CORE_DEFAULT_PANELS) byId.set(p.id, p)
		for (const p of sessionFrames?.modePanels ?? []) byId.set(p.id, p) // mode wins
		surfaceManager.init(
			sessionId,
			[...byId.values()],
			panelLayoutBlob,
			persistPanelLayout
		)
	}

	function handleSessionsView(res: Sockets.Sessions.View.Response) {
		if (res.sessionId !== sessionId) return
		sessionFrames = res
		panelViewLoaded = true
		initSurfaceManagerIfReady()
	}

	function handleSessionsPanelLayoutGet(
		res: Sockets.Sessions.PanelLayout.Get.Response
	) {
		if (res.sessionId !== sessionId) return
		panelLayoutBlob = (res.layout ?? {}) as LayoutBlob
		panelLayoutLoaded = true
		initSurfaceManagerIfReady()
	}

	/** Explicit surface intents (21 §9): a node/action opened or closed panels. */
	function handleSurfaceIntent(res: Sockets.Sessions.SurfaceIntent.Push) {
		if (res.sessionId !== sessionId) return
		for (const id of res.open ?? []) surfaceManager.applyOpenIntent(id)
		for (const id of res.close ?? []) surfaceManager.applyCloseIntent(id)
	}
	/** Frame actions ride the same audited path as every contributed button. */
	function handleFrameAction(
		fn: string,
		messageId?: number,
		payload?: Record<string, unknown>
	) {
		socket.emit("sessions:triggerFunction", {
			sessionId,
			function: fn,
			...(messageId != null ? { messageId } : {}),
			...(payload && Object.keys(payload).length ? { payload } : {})
		})
	}

	// The mode's shape (19 §1–§2): what capabilities exist for this session at
	// all. Null — an unknown mode, or a registry that never synced — means
	// today's behaviour exactly, the F29 posture the creation form shares.
	let modesList: Sockets.Sessions.Genres.Response["genres"] = $state([])
	let modeShape = $derived(
		modesList.find((m) => m.genreId === ((session as any)?.genreId ?? ""))
			?.shape ?? null
	)
	// `composer: 'none'` — a purely trigger-driven mode: the tabs (triggers,
	// lore, stats) stay; the text input and send affordance go.
	let composerHidden = $derived(modeShape?.composer === "none")
	// Read-only (19 §6, ruled): a non-standard mode this build does not
	// register means the session's history stays readable and nothing starts a
	// new turn. Requires the modes list to have actually arrived — an
	// in-flight fetch must not flash the banner over a healthy session.
	let modeMissing = $derived(
		modesList.length > 0 &&
			!!(session as any)?.genreId &&
			(session as any).genreId !== "core:genre/chat" &&
			!modesList.some((m) => m.genreId === (session as any).genreId)
	)
	// A capability the shape omits (or caps at zero) does not exist for the
	// session: no persona requirement on send, no character-response mechanics.
	let personasInMode = $derived(
		!modeShape ||
			(!!modeShape.personas && (modeShape.personas.max ?? 1) !== 0)
	)
	let charactersInMode = $derived(
		!modeShape ||
			(!!modeShape.characters && (modeShape.characters.max ?? 1) !== 0)
	)
	let sessionResponseOrder:
		| Sockets.Sessions.GetResponseOrder.Response
		| undefined = $state()
	let availablePersonas: Sockets.Personas.List.Response["personaList"] =
		$state([])

	// Get session id from route params
	let sessionId: number = $derived.by(() => Number(page.params.id))
	let sessionNotFound = $state(false)

	let lastMessage: SelectSessionMessage | undefined = $derived.by(() => {
		if (session && session.sessionMessages.length > 0) {
			return session.sessionMessages[session.sessionMessages.length - 1]
		}
		return undefined
	})

	let lastPersonaMessage: SelectSessionMessage | undefined = $derived.by(
		() => {
			if (session && session.sessionMessages.length > 0) {
				return session.sessionMessages
					.slice()
					.reverse()
					.find((msg: SelectSessionMessage) => msg.personaId)
			}
			return undefined
		}
	)

	let canRegenerateLastMessage: boolean = $derived.by(() => {
		return (
			(!lastMessage?.metadata?.isGreeting &&
				!!lastMessage &&
				!lastMessage.isGenerating &&
				!lastMessage.isHidden &&
				(!lastPersonaMessage ||
					lastPersonaMessage.id < lastMessage.id)) ||
			false
		)
	})

	// Check if any message is currently generating
	let hasGeneratingMessage: boolean = $derived.by(() => {
		return (
			session?.sessionMessages?.some((msg) => msg.isGenerating) || false
		)
	})

	/**
	 * True between dispatching a generation and the server's `isGenerating`
	 * placeholder arriving.
	 *
	 * Without it the next-character block flashes on every send: `handleSend`
	 * clears `newMessage` synchronously, while `isGenerating` is only set after
	 * a socket round trip that additionally queues on the session trigger lock. For
	 * that whole window every other condition below is already satisfied.
	 *
	 * This race is not 1:1-specific — group sessions on the ORDERED strategy have
	 * it too; it was simply invisible while the block was gated to groups.
	 */
	let triggerInFlight: boolean = $state(false)
	let triggerInFlightTimer: ReturnType<typeof setTimeout> | undefined

	function markTriggerInFlight() {
		triggerInFlight = true
		clearTimeout(triggerInFlightTimer)
		// Backstop only: a generation that never starts must not wedge the
		// block off permanently. The real clears are the two below.
		triggerInFlightTimer = setTimeout(
			() => (triggerInFlight = false),
			15000
		)
	}

	function clearTriggerInFlight() {
		triggerInFlight = false
		clearTimeout(triggerInFlightTimer)
	}

	// Clear as soon as the placeholder lands — the normal path.
	$effect(() => {
		if (hasGeneratingMessage) clearTriggerInFlight()
	})

	// Determine if we should show the next character block
	let shouldShowNextCharacterBlock: boolean = $derived.by(() => {
		const hasMessageDraft = newMessage.trim().length > 0
		const isEditingMessage = !!editSessionMessage
		const hasNextCharacter = !!sessionResponseOrder?.nextCharacterId

		const shouldShow =
			!triggerInFlight &&
			!hasGeneratingMessage &&
			!hasMessageDraft &&
			!isEditingMessage &&
			hasNextCharacter &&
			// No character system in the mode → nobody's turn to announce.
			charactersInMode &&
			!!session?.sessionMessages?.length // Only show if there are messages

		return shouldShow
	})

	// A single-character session has nobody else to hand the turn to, so the
	// "choose a different character" control is meaningless there. Keyed on cast
	// size rather than `isGroup`, because an isGroup session with one character
	// exists by the server's own definition (sessions.ts: isGroup = count > 1).
	let canChooseDifferentCharacter: boolean = $derived(
		(session?.sessionCharacters?.length || 0) > 1
	)

	// ── Scene review (activity-backed) ───────────────────────────────
	// A session-started scene summarize hands off to ProcessSceneModal, which is
	// the piece that already knows how to resume a minimized run and saves via
	// scenes:update. It takes plain props and no context, so it mounts here as
	// happily as it does in the lorebook panel — the only thing it needs that
	// this page lacks is the binding list, fetched below.
	let showProcessSceneModal = $state(false)
	let processSceneId: number | null = $state(null)
	let processActivityId: string | null = $state(null)
	let processPendingResult: any = $state(null)
	let lorebookBindingList: {
		id: number
		name: string
		binding: string
	}[] = $state([])

	$effect(() => {
		if (session?.lorebookId) {
			socket?.emit("lorebooks:bindingList", {
				lorebookId: session.lorebookId
			})
		}
	})

	/**
	 * Reopen a backgrounded world/character summarize when the Activity panel
	 * asks. The sidebar navigates here first (unlike the scene/compile cards,
	 * which open a panel), so this only has to pick the id back up.
	 */
	let resumeSummarizeActivity = $state<SessionSummarizeState | null>(null)
	$effect(() => {
		const id = sessionSummarizesCtx?.reviewActivityId
		if (!id) return
		const activity = sessionSummarizesCtx.activities.find(
			(a) => a.activityId === id && a.sessionId === sessionId
		)
		if (!activity) return
		sessionSummarizesCtx.setReviewActivityId(null)
		resumeSummarizeActivity = activity
		summarizeLoreType = activity.loreType
		showSummarizeModal = true
	})

	// Reopen a minimized/backgrounded run when the Activity panel asks for it.
	$effect(() => {
		const id = sceneSummarizesCtx?.reviewSceneId
		if (id == null) return
		const activity = sceneSummarizesCtx.activities.find(
			(a: any) =>
				a.sceneId === id &&
				(a.status === "review" || a.status === "running")
		)
		if (!activity) return
		sceneSummarizesCtx.setReviewSceneId(null)
		processSceneId = activity.sceneId
		processActivityId = activity.activityId
		processPendingResult = activity.pendingResult ?? null
		showProcessSceneModal = true
	})

	// Get the next character info from session data
	let nextCharacter: SelectCharacter | undefined = $derived.by(() => {
		const nextCharacterId = sessionResponseOrder?.nextCharacterId
		if (!nextCharacterId) {
			return undefined
		}

		const foundCharacter = session?.sessionCharacters?.find(
			(cc) => cc.characterId === nextCharacterId
		)?.character

		return foundCharacter
	})

	// Check if current user is a guest (not the session owner)
	let isGuest: boolean = $derived.by(() => {
		if (!session || !userCtx.user?.id) return false
		const isGuest = session.userId !== userCtx.user.id
		console.log("Guest check:", {
			sessionUserId: session.userId,
			currentUserId: userCtx.user.id,
			isGuest
		})
		return isGuest
	})

	// Check if current user has a persona in this session
	let userHasPersonaInSession: boolean = $derived.by(() => {
		if (!session?.sessionPersonas || !userCtx.user?.id) return false
		return session.sessionPersonas.some(
			(cp) => cp.persona?.userId === userCtx.user?.id
		)
	})

	// Determine if we should show the add persona CTA. A mode with no persona
	// system has nothing to add — the CTA would ask for a thing the shape
	// says does not exist here.
	let showAddPersonaCTA: boolean = $derived.by(() => {
		return isGuest && !userHasPersonaInSession && personasInMode
	})

	// All of the current user's personas in this session
	let userPersonasInSession = $derived.by(() => {
		if (!session?.sessionPersonas || !userCtx.user?.id) return []
		return session.sessionPersonas.filter(
			(cp) => cp.persona?.userId === userCtx.user?.id
		)
	})

	// Manually selected persona ID — null means auto-select (first in list)
	let selectedPersonaId = $state<number | null>(null)

	// Reset selection when navigating to a different session
	$effect(() => {
		const _watchSessionId = session?.id
		selectedPersonaId = null
	})

	// Get the current user's active persona in this session
	let currentUserPersona = $derived.by(() => {
		if (!userPersonasInSession.length) return undefined
		if (selectedPersonaId) {
			const found = userPersonasInSession.find(
				(cp) => cp.personaId === selectedPersonaId
			)
			if (found) return found
		}
		return userPersonasInSession[0]
	})

	function switchPersona(personaId: number) {
		selectedPersonaId = personaId
	}

	// Get ordered characters from session data using the response order
	let orderedCharacters: SelectCharacter[] = $derived.by(() => {
		const sessionCharacters = session?.sessionCharacters
		if (!sessionResponseOrder?.characterIds || !sessionCharacters) return []
		return sessionResponseOrder.characterIds
			.map(
				(id) =>
					sessionCharacters.find((cc) => cc.characterId === id)
						?.character
			)
			.filter((char) => char !== undefined) as SelectCharacter[]
	})

	// Check if current user can edit/control a specific message — mirrors
	// checkMessageEditPermission server-side exactly:
	// - Persona messages: only that persona's own owner, never the session
	//   owner (a persona is another participant's own self-representation).
	// - Character messages: the session owner, or whoever owns that character
	//   (so a guest who brought their own character in can control it).
	let canControlMessage = (msg: SelectSessionMessage): boolean => {
		if (!userCtx.user?.id) return false

		if (msg.personaId) {
			return (
				session?.sessionPersonas?.some(
					(cp) =>
						cp.personaId === msg.personaId &&
						cp.persona?.userId === userCtx.user?.id
				) ?? false
			)
		}

		if (msg.characterId) {
			if (!isGuest) return true
			return (
				session?.sessionCharacters?.some(
					(cc) =>
						cc.characterId === msg.characterId &&
						cc.character?.userId === userCtx.user?.id
				) ?? false
			)
		}

		// Narrator response messages aren't owned by any persona/character —
		// only the session owner controls them, mirroring
		// checkMessageEditPermission server-side.
		if (msg.isNarratorResponse) return !isGuest

		return false
	}

	function handleSend() {
		if (!newMessage.trim()) return

		// Use the current user's persona if they have one, otherwise use the first persona (for session owner)
		const personaId =
			currentUserPersona?.personaId ||
			session?.sessionPersonas?.[0]?.personaId

		// A mode whose shape has no persona system submits bare prose (19 §1:
		// "the user is simply prose") — the server already stores a
		// persona-less user message; this guard was the only thing requiring
		// one. Under the standard mode the requirement stands, as ever.
		if (!personaId && personasInMode) {
			toaster.error({ title: "No persona selected for this session" })
			return
		}

		const msg: Sockets.SessionMessages.SendPersonaMessage.Params = {
			sessionId,
			personaId: personaId ?? null,
			content: newMessage
		}
		socket.emit("sessionMessages:sendPersonaMessage", msg)
		newMessage = ""
		socket.emit("sessions:saveDraft", { sessionId, content: "" })

		// Character response triggering (once every persona has taken their turn)
		// is handled entirely server-side, in sessionMessagesSendPersonaMessageHandler —
		// see that handler for why: deciding this client-side, from a single
		// client's local session state, doesn't hold up with multiple real
		// participants sending messages around the same time.

		// ...but we do need to know whether a generation is *coming*, purely to
		// suppress the next-character block until it lands. Under MANUAL the
		// server's trigger call is a guaranteed no-op (it resolves no next
		// character and breaks), so flagging on every send would hide the block
		// for the whole settle timeout on exactly the sessions that need it most.
		//
		// Do NOT substitute sessions:getResponseOrder for this check — that handler
		// calls getNextCharacterTurn without the MANUAL guard and returns a
		// non-null nextCharacterId for MANUAL sessions.
		if (session?.groupReplyStrategy !== GroupReplyStrategies.MANUAL) {
			markTriggerInFlight()
		}

		// Refresh response order after sending message
		socket.emit("sessions:getResponseOrder", { sessionId })
	}

	// Display-name precedence for a message's speaker: prefer the LIVE
	// character/persona if it still exists (so a rename propagates to past
	// messages too, same as everywhere else in the app), falling back to the
	// `removedName` snapshot taken at removal time only once the entity is
	// itself globally deleted (its FK on the sessionCharacters/sessionPersonas row
	// nulls out via onDelete: "set null"). A removed-but-still-existing
	// participant's row is found here too (session.sessionCharacters/sessionPersonas
	// is deliberately unfiltered client-side, see getSessionFromDB), so this
	// already resolves the common case for free — the removedName fallback
	// only ever matters once .character/.persona is null.
	function getMessageCharacter(
		msg: SelectSessionMessage
	): SelectCharacter | SelectPersona | undefined {
		if (msg.personaId) {
			const cp = session?.sessionPersonas?.find(
				(p: SelectSessionPersona) => p.personaId === msg.personaId
			)
			return (
				cp?.persona ??
				(cp?.removedName
					? ({ name: cp.removedName } as SelectPersona)
					: undefined)
			)
		} else if (msg.characterId) {
			const cc = session?.sessionCharacters?.find(
				(c: SelectSessionCharacter) => c.characterId === msg.characterId
			)
			return (
				cc?.character ??
				(cc?.removedName
					? ({ name: cc.removedName } as SelectCharacter)
					: undefined)
			)
		}
	}

	function openDeleteMessageModal(message: SelectSessionMessage) {
		deleteSessionMessage = message
		showDeleteMessageModal = true
	}

	function onOpenMessageDeleteChange(details: OpenChangeDetails) {
		showDeleteMessageModal = details.open
		if (!showDeleteMessageModal) {
			deleteSessionMessage = undefined
		}
	}

	function onDeleteMessageConfirm() {
		if (!deleteSessionMessage) return
		socket.emit("sessionMessages:delete", {
			id: deleteSessionMessage.id
		})
		deleteSessionMessage = undefined
		showDeleteMessageModal = false
	}

	function onDeleteMessageCancel() {
		deleteSessionMessage = undefined
		showDeleteMessageModal = false
	}

	function onBranchSessionConfirm(title: string) {
		if (branchFromMessage && session) {
			socket.emit("sessions:branch", {
				sessionId,
				messageId: branchFromMessage.id,
				title
			})
		}
		branchFromMessage = undefined
		showBranchSessionModal = false
	}

	function onBranchSessionCancel() {
		branchFromMessage = undefined
		showBranchSessionModal = false
	}

	function handleEditMessageClick(message: SelectSessionMessage) {
		openMsgControlsMenu = undefined
		editSessionMessage = { ...message }
	}

	function handleMessageUpdate(event?: Event) {
		if (event) event.preventDefault()
		if (!editSessionMessage || !editSessionMessage.content.trim()) return

		const updatedMessage: Sockets.SessionMessages.Update.Params = {
			...editSessionMessage
		}
		socket.emit("sessionMessages:update", updatedMessage)
		editSessionMessage = undefined
	}

	function handleRegenerateMessage(e: Event, msg: SelectSessionMessage) {
		e.stopPropagation()
		socket.emit("sessionMessages:regenerate", { id: msg.id })
	}

	function handleContinueMessage(e: Event, msg: SelectSessionMessage) {
		e.stopPropagation()
		// The continue functionality should regenerate but preserve the existing content
		// This is handled server-side by passing continueFrom flag
		socket.emit("sessionMessages:continue", { id: msg.id })
	}

	function handleHideMessage(e: Event, msg: SelectSessionMessage) {
		e.stopPropagation()
		// Toggle isHidden status by updating the message
		socket.emit("sessionMessages:update", {
			id: msg.id,
			isHidden: !msg.isHidden
		})
	}

	function handleDeleteMessage(e: Event, msg: SelectSessionMessage) {
		e.stopPropagation()
		openDeleteMessageModal(msg)
	}

	$effect(() => {
		// React to sessionId changes (which is derived from page.params.id)
		if (sessionId) {
			// Reset state when switching sessions
			session = undefined // Clear current session data
			sessionNotFound = false
			pagination = undefined
			sessionResponseOrder = undefined
			draftCompiledPrompt = undefined
			editSessionMessage = undefined
			newMessage = ""
			isInitialLoad = true
			lastSeenMessageId = null
			lastSeenMessageContent = ""
			loadingOlderMessages = false
			// Surface grid re-seeds for the new session (plan 21): re-fetch its
			// panel set + this user's saved layout, and re-init once both land.
			panelViewLoaded = false
			panelLayoutLoaded = false
			panelLayoutBlob = {}
			socket.emit("sessions:get", { id: sessionId, limit: 25 })
			socket.emit("sessions:view", { sessionId })
			socket.emit("sessions:panelLayout:get", { sessionId })
			// console.log('Debug - Emitting getSessionResponseOrder for sessionId:', sessionId)
			socket.emit("sessions:getResponseOrder", { sessionId })
		}
	})

	$effect(() => {
		const _connection = systemSettingsCtx.settings?.defaultConnectionId // DO NOT REMOVE THIS LINE - REACTIVITY TRIGGER
		const _samplingConfig =
			systemSettingsCtx.settings?.defaultSamplingConfigId // DO NOT REMOVE THIS LINE - REACTIVITY TRIGGER
		const _contextConfig = userSettingsCtx.settings?.activeContextConfigId // DO NOT REMOVE THIS LINE - REACTIVITY TRIGGER
		const _promptConfig = userSettingsCtx.settings?.activePromptConfigId // DO NOT REMOVE THIS LINE - REACTIVITY TRIGGER
		const _newMessage = newMessage // DO NOT REMOVE THIS LINE - REACTIVITY TRIGGER
		if (
			!sessionId ||
			!lastMessage ||
			lastMessage.isGenerating ||
			!!editSessionMessage
		) {
			return
		}
		if (!systemSettingsCtx.settings?.contextDebuggingEnabled) return
		if (promptTokenCountTimeout) clearTimeout(promptTokenCountTimeout)
		promptTokenCountTimeout = setTimeout(() => {
			socket.emit("sessions:promptTokenCount", {
				sessionId,
				content: newMessage,
				personaId:
					session?.sessionPersonas?.[0]?.personaId || undefined,
				role: "user"
			})
		}, 2000)
	})

	let sessionMessagesContainer: HTMLDivElement | null = $state(null)
	let lastSeenMessageId: number | null = $state(null)
	let lastSeenMessageContent: string = $state("")
	let isInitialLoad = $state(true)

	// Helper function to perform autoscroll with retries
	function performAutoscroll(attempt = 1, maxAttempts = 3) {
		if (!sessionMessagesContainer || loadingOlderMessages) return

		const scrollHeight = sessionMessagesContainer.scrollHeight
		const clientHeight = sessionMessagesContainer.clientHeight

		// Check if there's actually content to scroll to
		if (scrollHeight > clientHeight) {
			sessionMessagesContainer.scrollTo({
				top: scrollHeight,
				behavior: isInitialLoad ? "instant" : "smooth"
			})
			return
		}

		// If no content yet and we haven't exceeded max attempts, retry
		if (attempt < maxAttempts) {
			const delay = attempt === 1 ? 100 : 300
			setTimeout(() => performAutoscroll(attempt + 1, maxAttempts), delay)
		}
	}

	// Auto-scroll to bottom on new messages, initial load, or last message content updates
	$effect(() => {
		// React to changes in messages and container
		const messagesLength = session?.sessionMessages?.length ?? 0
		const lastMessage = session?.sessionMessages?.[messagesLength - 1]
		const currentLastMessageId = lastMessage?.id
		const currentLastMessageContent = lastMessage?.content || ""

		if (
			sessionMessagesContainer &&
			messagesLength > 0 &&
			!loadingOlderMessages
		) {
			// Determine if we should autoscroll
			const isNewMessage =
				currentLastMessageId &&
				(!lastSeenMessageId || currentLastMessageId > lastSeenMessageId)
			const isLastMessageContentUpdated =
				currentLastMessageId === lastSeenMessageId &&
				currentLastMessageContent !== lastSeenMessageContent

			const shouldAutoscroll =
				isInitialLoad || isNewMessage || isLastMessageContentUpdated

			if (shouldAutoscroll) {
				// Use the new performAutoscroll function
				performAutoscroll()
				isInitialLoad = false
			}

			// Update tracking variables
			if (currentLastMessageId) {
				lastSeenMessageId = currentLastMessageId
				lastSeenMessageContent = currentLastMessageContent
			}
		}
	})

	function handleEditMessage(e: Event, msg: SelectSessionMessage) {
		e.stopPropagation()
		handleEditMessageClick(msg)
	}
	function handleCancelEditMessage(e?: Event) {
		e?.stopPropagation()
		editSessionMessage = undefined
	}
	function handleSaveEditMessage(content: string, e?: Event) {
		e?.stopPropagation()
		if (editSessionMessage) editSessionMessage.content = content
		handleMessageUpdate(e)
	}
	function handleAbortMessage(e: Event, msg: SelectSessionMessage) {
		e.stopPropagation()
		openMsgControlsMenu = undefined
		// Clear any pending auto-trigger timeout
		if (autoTriggerTimeout) {
			clearTimeout(autoTriggerTimeout)
			autoTriggerTimeout = null
		}
		socket.emit("sessionMessages:cancel", { id: msg.id, sessionId })
	}
	// ── Summarization mode ────────────────────────────────────────
	function enterSummarizationMode(msg: SelectSessionMessage) {
		openMsgControlsMenu = undefined
		isSummarizationMode = true
		selectedMessageIds = new Set([msg.id])
	}

	function exitSummarizationMode() {
		isSummarizationMode = false
		selectedMessageIds = new Set()
	}

	function enterSummarizationModeEmpty() {
		openMsgControlsMenu = undefined
		isSummarizationMode = true
		selectedMessageIds = new Set()
	}

	function toggleSummarizationMessage(id: number) {
		if (scenedMessageIds.has(id)) return // hard block
		const next = new Set(selectedMessageIds)
		next.has(id) ? next.delete(id) : next.add(id)
		selectedMessageIds = next
	}

	function selectAllAbove(msgIndex: number) {
		const msgs = session!.sessionMessages
		const next = new Set(selectedMessageIds)
		for (let i = msgIndex; i >= 0; i--) {
			if (scenedMessageIds.has(msgs[i].id)) break // stop at scened message
			if (next.has(msgs[i].id) && i < msgIndex) break
			next.add(msgs[i].id)
		}
		selectedMessageIds = next
	}

	function selectAllBelow(msgIndex: number) {
		const msgs = session!.sessionMessages
		const next = new Set(selectedMessageIds)
		for (let i = msgIndex; i < msgs.length; i++) {
			if (scenedMessageIds.has(msgs[i].id)) break // stop at scened message
			if (next.has(msgs[i].id) && i > msgIndex) break
			next.add(msgs[i].id)
		}
		selectedMessageIds = next
	}

	/** True when selected messages (for a scene) have a visible gap between them */
	let hasSceneGap = $derived.by(() => {
		if (!session?.sessionMessages.length || selectedMessageIds.size === 0)
			return false
		const msgs = session.sessionMessages
		const selectedIndices = msgs
			.map((m, i) => (selectedMessageIds.has(m.id) ? i : -1))
			.filter((i) => i !== -1)
		if (selectedIndices.length < 2) return false
		const minIdx = selectedIndices[0]
		const maxIdx = selectedIndices[selectedIndices.length - 1]
		for (let i = minIdx + 1; i < maxIdx; i++) {
			const m = msgs[i]
			if (!selectedMessageIds.has(m.id) && !m.isHidden) return true
		}
		return false
	})

	function openSummarizeModal(loreType: "world" | "character" | "scene") {
		if (loreType === "scene" && hasSceneGap) {
			toaster.error({
				title: "Non-consecutive messages selected",
				description:
					"Scenes require a consecutive sequence of messages with no visible gaps. Deselect the skipped messages or hide them first."
			})
			return
		}
		summarizeLoreType = loreType
		showSummarizeModal = true
	}

	function handleOpenEntry(lorebookId: number, historyEntryId: number) {
		panelsCtx.digest.lorebookId = lorebookId
		panelsCtx.digest.historyEntryId = historyEntryId
		panelsCtx.digest.historyEntryTab = "content"
		panelsCtx.openPanel({ key: "lorebooks", toggle: false })
	}

	function handleLorebookSet(newLorebookId: number) {
		if (session) {
			session = {
				...session,
				lorebookId: newLorebookId
			} as typeof session
		}
	}
	// ─────────────────────────────────────────────────────────────

	function handleBranchMessage(e: Event, msg: SelectSessionMessage) {
		e.stopPropagation()
		openMsgControlsMenu = undefined
		branchFromMessage = msg
		showBranchSessionModal = true
	}
	function handleSendButton(e: Event) {
		e.stopPropagation()
		handleSend()
	}
	function handleAbortLastMessage(e: Event) {
		e.stopPropagation()
		openMsgControlsMenu = undefined
		// Clear any pending auto-trigger timeout
		if (autoTriggerTimeout) {
			clearTimeout(autoTriggerTimeout)
			autoTriggerTimeout = null
		}
		if (lastMessage)
			socket.emit("sessionMessages:cancel", {
				id: lastMessage.id,
				sessionId
			})
	}
	function handleTriggerContinueConversation(e: Event) {
		e.stopPropagation()
		openMsgControlsMenu = undefined
		markTriggerInFlight()
		socket.emit("sessions:triggerGenerateMessage", {
			sessionId,
			triggered: true
		})
	}
	function handleTriggerCharacterMessage(e: Event) {
		e.stopPropagation()
		openMsgControlsMenu = undefined
		showTriggerCharacterMessageModal = true
	}
	function handleRegenerateLastMessage(e: Event) {
		e.stopPropagation()
		openMsgControlsMenu = undefined
		if (lastMessage && !lastMessage.isGenerating) {
			socket.emit("sessionMessages:regenerate", { id: lastMessage.id })
		}
	}

	function onSelectTriggerCharacterMessage(characterId: number) {
		showTriggerCharacterMessageModal = false
		openMsgControlsMenu = undefined
		markTriggerInFlight()
		socket.emit("sessions:triggerGenerateMessage", {
			sessionId,
			characterId,
			once: true
		})
	}

	function handleTriggerNarratorResponse(e: Event) {
		e.stopPropagation()
		openMsgControlsMenu = undefined
		showTriggerCharacterMessageModal = false
		showTriggerNarratorResponseModal = true
	}

	function handleConfirmTriggerNarratorResponse(instructions: string) {
		showTriggerNarratorResponseModal = false
		socket.emit("sessions:triggerNarratorResponse", {
			sessionId,
			instructions: instructions || undefined
		})
	}

	function handleCancelTriggerNarratorResponse() {
		showTriggerNarratorResponseModal = false
	}

	function handleContinueWithNextCharacter() {
		if (!nextCharacter) return
		markTriggerInFlight()
		socket.emit("sessions:triggerGenerateMessage", {
			sessionId,
			characterId: nextCharacter.id,
			once: true
		})
	}

	function handleChooseDifferentCharacter() {
		showTriggerCharacterMessageModal = true
	}

	function handleAddPersona(personaId: number) {
		const req: Sockets.Sessions.AddPersona.Params = {
			sessionId,
			personaId
		}
		socket.emit("sessions:addPersona", req)
		showAddPersonaModal = false
	}

	function handleCharacterNameClick(msg: SelectSessionMessage): void {
		if (msg.characterId) {
			panelsCtx.openPanel({ key: "characters", toggle: false })
			panelsCtx.digest.viewCharacterId = msg.characterId
		} else if (msg.personaId) {
			panelsCtx.openPanel({ key: "personas", toggle: false })
			panelsCtx.digest.viewPersonaId = msg.personaId
		}
	}

	function swipeRight(msg: SelectSessionMessage): void {
		const req: Sockets.SessionMessages.SwipeRight.Params = {
			id: msg.id
		}
		socket.emit("sessionMessages:swipeRight", req)
	}

	function swipeLeft(msg: SelectSessionMessage): void {
		const req: Sockets.SessionMessages.SwipeLeft.Params = {
			id: msg.id
		}
		socket.emit("sessionMessages:swipeLeft", req)
	}

	async function loadOlderMessages() {
		if (
			loadingOlderMessages ||
			!pagination?.hasMore ||
			!session ||
			session.sessionMessages.length === 0
		)
			return

		loadingOlderMessages = true

		// Save scroll anchor before the DOM changes so we can restore position after prepend
		if (sessionMessagesContainer) {
			sessionMessagesContainer.dataset.previousScrollHeight =
				sessionMessagesContainer.scrollHeight.toString()
			sessionMessagesContainer.dataset.previousScrollTop =
				sessionMessagesContainer.scrollTop.toString()
		}

		const beforeId = Math.min(...session.sessionMessages.map((m) => m.id))
		socket.emit("sessions:get", { id: sessionId, limit: 25, beforeId })

		// loadingOlderMessages will be set to false in the socket response handler
	}

	function handleScroll(event: Event) {
		const target = event.target as HTMLElement
		if (!target || loadingOlderMessages || !pagination?.hasMore) return

		// Check if user scrolled to within 200px of the top
		if (target.scrollTop <= 200) {
			loadOlderMessages()
		}
	}

	function canSwipeRight(
		msg: SelectSessionMessage,
		isGreeting: boolean
	): boolean {
		if (msg.isGenerating) return false
		if (lastPersonaMessage && lastPersonaMessage.id >= msg.id) {
			return false
		}
		if (isGreeting) {
			const idx = msg.metadata?.swipes?.currentIdx
			const len = msg.metadata?.swipes?.history?.length ?? 0
			if (typeof idx !== "number" || len === 0) return false
			return idx < len - 1
		}
		return true
	}

	// NOTE: this deliberately no longer returns true for
	// `openMsgControlsMenu === msg.id`. That branch made opening a message's
	// "..." popover add the swipe row to that message, growing it by a whole
	// row while the popover was anchored to it — the message jumped and the
	// popover had to reposition. The trade is that swipe arrows on mid-history
	// assistant messages are no longer reachable; if that needs restoring, add
	// a labelled swipe entry to the popover rather than re-coupling the two.
	function showSwipeControls(
		msg: SelectSessionMessage,
		isGreeting: boolean
	): boolean {
		let res = false
		if (msg.id === lastMessage?.id && !isGreeting) {
			// If this is the last message, we always show swipe controls
			res = canRegenerateLastMessage
		} else if (msg.isGenerating) {
			res = false
		} else if (msg.role === "user") {
			return false
		} else if (isGreeting) {
			res = (lastPersonaMessage?.id ?? 0) < msg.id
		}
		return res
	}

	// Named handlers (not inline in onMount) so cleanup can pass the exact
	// same reference to .off() — a no-arg .off() call (or one with a
	// different function reference than what was registered) removes
	// *every* listener for that event, not just this component's.
	function handlePersonasList(msg: Sockets.Personas.List.Response) {
		availablePersonas = msg.personaList
	}

	function handleSessionsUserTyping(
		msg: Sockets.Sessions.UserTyping.Response
	) {
		if (msg.sessionId !== sessionId) return
		const myPersonaId =
			currentUserPersona?.personaId ||
			session?.sessionPersonas?.[0]?.personaId
		if (msg.personaId === myPersonaId) return
		typingPersonas.set(msg.personaId, {
			name: msg.personaName,
			lastTypingAt: Date.now()
		})
		typingPersonas = new Map(typingPersonas)
	}

	function handleSessionsGet(msg: Sockets.Sessions.Get.Response) {
		if (msg.session === null && !loadingOlderMessages) {
			sessionNotFound = true
			return
		}
		if (msg.session?.id === sessionId) {
			if (session && loadingOlderMessages && msg.beforeId != null) {
				// Load-more: prepend older messages (server already deduped via cursor)
				const existingIds = new Set(
					session.sessionMessages.map((m) => m.id)
				)
				const olderMessages = msg.session.sessionMessages.filter(
					(m) => !existingIds.has(m.id)
				)
				const allMessages = [
					...olderMessages,
					...session.sessionMessages
				]
				session.sessionMessages = allMessages.sort(
					(a, b) => a.id - b.id
				)

				// Restore scroll position: account for the height added above the old content
				setTimeout(() => {
					if (sessionMessagesContainer) {
						const prevScrollHeight = parseInt(
							sessionMessagesContainer.dataset
								.previousScrollHeight || "0"
						)
						const prevScrollTop = parseInt(
							sessionMessagesContainer.dataset
								.previousScrollTop || "0"
						)
						const addedHeight =
							sessionMessagesContainer.scrollHeight -
							prevScrollHeight
						sessionMessagesContainer.scrollTop =
							addedHeight + prevScrollTop
						delete sessionMessagesContainer.dataset
							.previousScrollHeight
						delete sessionMessagesContainer.dataset
							.previousScrollTop
					}
					loadingOlderMessages = false
				}, 10)
			} else {
				// Initial load or session switch — restore draft only on first load
				const isFirstLoad = !session
				session = {
					...msg.session,
					sessionMessages: msg.session.sessionMessages.sort(
						(a, b) => a.id - b.id
					)
				}
				if (isFirstLoad && msg.userDraft) {
					newMessage = msg.userDraft
				}
				loadingOlderMessages = false
				// Autopopulate panels for any channel already present in the
				// loaded history (21 §9) — a session reopened with `tasks`
				// messages shows its Tasks panel without waiting for a new one.
				for (const m of session.sessionMessages)
					surfaceManager.activateForChannel((m as any).channel)
			}
			pagination = msg.pagination
			// Auto-scroll is handled by the $effect
		}
	}

	function handleSessionMessage(msg: Sockets.SessionMessage.Response) {
		const currentSession = session
		if (
			currentSession != null &&
			msg.sessionMessage &&
			msg.sessionMessage.sessionId === sessionId
		) {
			const sessionMessage = msg.sessionMessage
			const existingIndex = currentSession.sessionMessages.findIndex(
				(m: SelectSessionMessage) => m.id === sessionMessage.id
			)
			if (existingIndex !== -1) {
				const updatedMessages = [...currentSession.sessionMessages]
				updatedMessages[existingIndex] = sessionMessage
				session = {
					...currentSession,
					sessionMessages: updatedMessages
				}
			} else {
				// Add new message and maintain chronological order
				const updatedMessages = [
					...currentSession.sessionMessages,
					sessionMessage
				]
				session = {
					...currentSession,
					sessionMessages: updatedMessages.sort((a, b) => a.id - b.id)
				}
				// Channel-driven autopopulation (21 §9): a message on a
				// non-main channel flows in the panel that views that channel.
				surfaceManager.activateForChannel(
					(sessionMessage as any).channel
				)
			}
			// Refresh response order when messages change
			socket.emit("sessions:getResponseOrder", { sessionId })
			// Auto-scroll is handled by the $effect
		}
	}

	// "sessionMessage" (singular) is the server's event for a single message
	// fetch/echo (distinct from the "sessionMessages:*" bulk/action events used
	// elsewhere) - this surfaces a toast if that ever fails.
	function handleLorebookBindingList(msg: {
		lorebookBindingList?: { id: number; name: string; binding: string }[]
	}) {
		lorebookBindingList = msg.lorebookBindingList ?? []
	}

	function handleSessionSummarizeError(msg: { error?: string }) {
		// Page-level for the same reason as scenes:process:error — the modal
		// tears its listeners down on close, and this event is suppressed in
		// Layout's generic toaster, so a failure while minimized was silent.
		toaster.error({
			title: "Summarization failed",
			description: msg?.error
		})
	}

	function handleSceneProcessError(msg: { error?: string }) {
		toaster.error({
			title: "Scene processing failed",
			description: msg?.error
		})
	}

	function handleSessionMessageError(msg: { error?: string }) {
		// A generation that failed before any isGenerating row would otherwise
		// leave the next-character block suppressed for the full settle timeout.
		clearTriggerInFlight()
		toaster.error({
			title: "Failed to load message",
			description: msg?.error
		})
	}

	function handleCharactersUpdate(msg: Sockets.Characters.Update.Response) {
		const charId = msg.character?.id
		if (!charId || !session) return

		// Update session characters if the character is in the session
		const sessionCharacterIndex = session.sessionCharacters.findIndex(
			(c: SelectSessionCharacter) => c.characterId === charId
		)
		if (sessionCharacterIndex !== -1) {
			const updatedSessionCharacters = [...session.sessionCharacters]
			updatedSessionCharacters[sessionCharacterIndex] = {
				...updatedSessionCharacters[sessionCharacterIndex],
				character: msg.character
			}
			session = {
				...session,
				sessionCharacters: updatedSessionCharacters
			}
		}
	}

	function handlePersonasUpdate(msg: Sockets.Personas.Update.Response) {
		const personaId = msg.persona?.id
		if (!personaId || !session) return

		// Update session personas if the persona is in the session
		const sessionPersonaIndex = session.sessionPersonas.findIndex(
			(p: SelectSessionPersona) => p.personaId === personaId
		)
		if (sessionPersonaIndex !== -1) {
			const updatedSessionPersonas = [...session.sessionPersonas]
			updatedSessionPersonas[sessionPersonaIndex] = {
				...updatedSessionPersonas[sessionPersonaIndex],
				persona: msg.persona
			}
			session = { ...session, sessionPersonas: updatedSessionPersonas }
		}
	}

	function handleSessionsPromptTokenCount(
		msg: Sockets.Sessions.PromptTokenCount.Response
	) {
		draftCompiledPrompt = msg
	}

	function handleSessionMessagesDelete(
		msg: Sockets.SessionMessages.Delete.Response
	) {
		if (session) {
			// Check if we're deleting the last message
			const wasLastMessage = lastSeenMessageId === msg.id

			// Remove the deleted message from the session messages array
			const filteredMessages = session.sessionMessages.filter(
				(m: SelectSessionMessage) => m.id !== msg.id
			)

			// Ensure messages remain sorted chronologically
			session = {
				...session,
				sessionMessages: filteredMessages.sort((a, b) => a.id - b.id)
			}

			// Update tracking state if we deleted the last message
			if (wasLastMessage && session.sessionMessages.length > 0) {
				const newLastMessage =
					session.sessionMessages[session.sessionMessages.length - 1]
				lastSeenMessageId = newLastMessage.id
				lastSeenMessageContent = newLastMessage.content || ""
			} else if (session.sessionMessages.length === 0) {
				lastSeenMessageId = null
				lastSeenMessageContent = ""
			}

			// Refresh response order after deletion
			socket.emit("sessions:getResponseOrder", { sessionId })
		}
	}

	function handleSessionsGetResponseOrder(
		msg: Sockets.Sessions.GetResponseOrder.Response
	) {
		if (msg.sessionId === sessionId) {
			sessionResponseOrder = msg
		}
	}

	function handleSessionsAddPersona(
		msg: Sockets.Sessions.AddPersona.Response
	) {
		if (msg.success) {
			toaster.success({
				title: "Persona added to session successfully"
			})
		} else if (msg.error) {
			toaster.error({ title: msg.error })
		}
	}

	function handleSessionsBranch(msg: Sockets.Sessions.Branch.Response) {
		if (msg.session) {
			toaster.success({
				title: "Session branched successfully"
			})
			// Navigate to the new branched session
			goto(`/sessions/${msg.session.id}`)
		} else if (msg.error) {
			toaster.error({ title: msg.error })
		}
	}

	function handleScenesScenedMessageIds(
		msg: Sockets.Scenes.SenedMessageIds.Response
	) {
		scenedMessageIds = new Set(msg.scenedMessageIds)
	}

	function handleScenesScenedMessageIdsError() {
		sessionNotFound = true
	}

	function handleScenesList(msg: Sockets.Scenes.List.Response) {
		if (!msg.sceneList.length || msg.sceneList[0].sessionId === sessionId) {
			sceneList = msg.sceneList
		}
	}

	function handleScenesListError() {
		sessionNotFound = true
	}

	function handleSessionsGetNarratorName(
		msg: Sockets.Sessions.GetNarratorName.Response
	) {
		if (msg.sessionId !== sessionId) return
		narratorName = msg.narratorName
	}

	function handleSessionsTriggers(msg: Sockets.Sessions.Triggers.Response) {
		if (msg.sessionId !== sessionId) return
		modeTriggers = msg.triggers || []
	}

	function handleSessionsModesPage(msg: Sockets.Sessions.Genres.Response) {
		modesList = msg.genres || []
	}

	function handleSessionsTriggerFunction(
		msg: Sockets.Sessions.TriggerFunction.Response
	) {
		if (msg.sessionId !== sessionId) return
		if (msg.error) {
			toaster.error({ title: msg.function, description: msg.error })
		} else if (msg.success) {
			// The spec's consumers wrote whatever they wrote — re-read the session
			// so it shows.
			socket.emit("sessions:get", { id: sessionId })
		}
	}

	function fireTrigger(fn: string) {
		// The one function with a bespoke client flow: narrate opens its
		// instructions modal and fires its dedicated event. Everything else is
		// the generic fire (19 §4).
		if (fn === "narrate") {
			showTriggerNarratorResponseModal = true
			return
		}
		socket.emit("sessions:triggerFunction", { sessionId, function: fn })
	}

	/**
	 * A `kind: 'menu'` trigger, fired from a message's options menu (19 §4).
	 * The message is the subject: its id rides the run's input, so the winning
	 * spec receives which message the person meant.
	 */
	function fireMenuTrigger(fn: string, msg: SelectSessionMessage) {
		socket.emit("sessions:triggerFunction", {
			sessionId,
			function: fn,
			messageId: msg.id
		})
	}

	/**
	 * A declared block action (20 §6): a choices button or a form submit
	 * inside a parts-native message. Same audited path as a menu trigger,
	 * with the entered values riding as the payload.
	 */
	function fireBlockAction(
		fn: string,
		msg: SelectSessionMessage,
		payload?: Record<string, unknown>
	) {
		socket.emit("sessions:triggerFunction", {
			sessionId,
			function: fn,
			messageId: msg.id,
			...(payload && Object.keys(payload).length ? { payload } : {})
		})
	}

	/** `book-open-text` → `BookOpenText`, resolved against the lucide set. */
	function triggerIcon(name?: string) {
		const pascal = (name ?? "")
			.split("-")
			.map((p) => p.charAt(0).toUpperCase() + p.slice(1))
			.join("")
		return (Icons as any)[pascal] ?? Icons.Play
	}

	onMount(() => {
		// Fetch available personas for guest users
		socket.emit("personas:list", {})

		socket.on("personas:list", handlePersonasList)
		socket.on("sessions:userTyping", handleSessionsUserTyping)
		typingPruneInterval = setInterval(() => {
			const cutoff = Date.now() - 10_000
			let changed = false
			for (const [id, info] of typingPersonas) {
				if (info.lastTypingAt < cutoff) {
					typingPersonas.delete(id)
					changed = true
				}
			}
			if (changed) typingPersonas = new Map(typingPersonas)
		}, 1000)

		socket.on("sessions:get", handleSessionsGet)
		socket.on("sessionMessage", handleSessionMessage)
		socket.on("sessionMessage:error", handleSessionMessageError)
		socket.on("lorebooks:bindingList", handleLorebookBindingList)
		// Page-level, so it still fires when the review modal is closed. The
		// generic onAny toaster already suppresses this event, and the only
		// other listener lives in the lorebook History pane — so without this a
		// session-started run that failed while minimized reported nothing at all.
		socket.on("scenes:process:error", handleSceneProcessError)
		socket.on("sessions:summarize:error", handleSessionSummarizeError)
		socket.on("characters:update", handleCharactersUpdate)
		socket.on("personas:update", handlePersonasUpdate)
		socket.on("sessions:promptTokenCount", handleSessionsPromptTokenCount)
		socket.on("sessionMessages:delete", handleSessionMessagesDelete)
		socket.on("sessions:getResponseOrder", handleSessionsGetResponseOrder)
		socket.on("sessions:addPersona", handleSessionsAddPersona)
		socket.on("sessions:branch", handleSessionsBranch)
		socket.on("scenes:scenedMessageIds", handleScenesScenedMessageIds)
		socket.on(
			"scenes:scenedMessageIds:error",
			handleScenesScenedMessageIdsError
		)
		socket.on("scenes:list", handleScenesList)
		socket.on("scenes:list:error", handleScenesListError)
		socket.on("sessions:getNarratorName", handleSessionsGetNarratorName)
		socket.on("sessions:triggers", handleSessionsTriggers)
		socket.on("sessions:view", handleSessionsView)
		socket.on("sessions:panelLayout:get", handleSessionsPanelLayoutGet)
		socket.on("sessions:surfaceIntent", handleSurfaceIntent)
		socket.on("sessions:triggerFunction", handleSessionsTriggerFunction)
		socket.on("sessions:genres", handleSessionsModesPage)

		socket.emit("scenes:scenedMessageIds", { sessionId })
		socket.emit("scenes:list", {
			sessionId
		} satisfies Sockets.Scenes.List.Params)
		// The contributed trigger set (19 §4) — the buttons are rows — and the
		// shape, which gates what the view renders at all (19 §2).
		socket.emit("sessions:triggers", { sessionId })
		socket.emit("sessions:view", { sessionId })
		socket.emit("sessions:panelLayout:get", { sessionId })
		socket.emit("sessions:genres", {})

		// Cleanup function
		return () => {
			// Clear any pending timeouts
			if (promptTokenCountTimeout) {
				clearTimeout(promptTokenCountTimeout)
			}
			if (autoTriggerTimeout) {
				clearTimeout(autoTriggerTimeout)
			}
			if (typingPruneInterval) {
				clearInterval(typingPruneInterval)
			}
			socket.off("personas:list", handlePersonasList)
			socket.off("sessions:userTyping", handleSessionsUserTyping)
			socket.off("sessions:get", handleSessionsGet)
			socket.off("sessionMessage", handleSessionMessage)
			socket.off("sessionMessage:error", handleSessionMessageError)
			socket.off("lorebooks:bindingList", handleLorebookBindingList)
			socket.off("scenes:process:error", handleSceneProcessError)
			socket.off("sessions:summarize:error", handleSessionSummarizeError)
			socket.off("characters:update", handleCharactersUpdate)
			socket.off("personas:update", handlePersonasUpdate)
			socket.off(
				"sessions:promptTokenCount",
				handleSessionsPromptTokenCount
			)
			socket.off("sessionMessages:delete", handleSessionMessagesDelete)
			socket.off(
				"sessions:getResponseOrder",
				handleSessionsGetResponseOrder
			)
			socket.off("sessions:addPersona", handleSessionsAddPersona)
			socket.off("sessions:branch", handleSessionsBranch)
			socket.off("scenes:scenedMessageIds", handleScenesScenedMessageIds)
			socket.off(
				"scenes:scenedMessageIds:error",
				handleScenesScenedMessageIdsError
			)
			socket.off("scenes:list", handleScenesList)
			socket.off("scenes:list:error", handleScenesListError)
			socket.off(
				"sessions:getNarratorName",
				handleSessionsGetNarratorName
			)
			socket.off("sessions:triggers", handleSessionsTriggers)
			socket.off("sessions:view", handleSessionsView)
			socket.off(
				"sessions:panelLayout:get",
				handleSessionsPanelLayoutGet
			)
			socket.off("sessions:surfaceIntent", handleSurfaceIntent)
			socket.off(
				"sessions:triggerFunction",
				handleSessionsTriggerFunction
			)
			socket.off("sessions:genres", handleSessionsModesPage)
			surfaceManager.destroy()
		}
	})

	// Re-resolve if the session's narrator-config override changes (e.g. saved via
	// Edit Session) while this page stays open.
	$effect(() => {
		const overrideId = session?.narratorPromptConfigId
		if (sessionId) {
			socket.emit("sessions:getNarratorName", { sessionId })
		}
	})

	let showAvatarModal = $state(false)
	let avatarModalEntity = $state<{
		type: "character" | "persona"
		id: number
		name: string
		avatar: string | null | undefined
	} | null>(null)

	let showImageModal = $state(false)
	let imageModalSrc = $state<string | null>(null)

	// Scene image overlays — synced into the shared store so Layout can render them
	let leftSceneImage = $state<string | null>(null)
	let rightSceneImage = $state<string | null>(null)
	let sceneImagesInitialized = $state(false)

	// Load persisted images from localStorage when navigating to a session
	$effect(() => {
		const id = sessionId
		sceneImagesInitialized = false
		leftSceneImage = null
		rightSceneImage = null
		if (id) {
			try {
				const saved = localStorage.getItem(`sceneImages:${id}`)
				if (saved) {
					const { left, right } = JSON.parse(saved)
					leftSceneImage = left ?? null
					rightSceneImage = right ?? null
				}
			} catch {}
		}
		sceneImagesInitialized = true
	})

	// Persist images to localStorage when they change (but not during initial load)
	$effect(() => {
		if (!sceneImagesInitialized) return
		const id = sessionId
		if (!id) return
		const left = leftSceneImage
		const right = rightSceneImage
		if (left || right) {
			localStorage.setItem(
				`sceneImages:${id}`,
				JSON.stringify({ left, right })
			)
		} else {
			localStorage.removeItem(`sceneImages:${id}`)
		}
	})

	// Sync into the shared store so Layout can render them
	$effect(() => {
		sceneImages.set({ left: leftSceneImage, right: rightSceneImage })
	})
	onDestroy(() => {
		sceneImages.set({ left: null, right: null })
		openSessionCtx.sessionId = null
		openSessionCtx.lorebookId = null
		openSessionCtx.isOwner = false
	})

	function handleAvatarClick(
		char: SelectCharacter | SelectPersona | undefined
	) {
		if (!char) return
		const isPersona = session?.sessionPersonas?.some(
			(cp) => cp.persona?.id === char.id
		)
		avatarModalEntity = {
			type: isPersona ? "persona" : "character",
			id: char.id,
			// resolveCharacterName uses `||` (not `??`) deliberately — a blank
			// nickname is commonly stored as "" rather than null, and ""
			// isn't nullish, so `??` wouldn't fall through to the character's
			// real name, leaving the modal title empty.
			name: resolveCharacterName(char, ""),
			avatar: char.avatar ?? null
		}
		showAvatarModal = true
	}

	function handleImageClick(src: string) {
		imageModalSrc = src
		showImageModal = true
	}
</script>

<svelte:head>
	<title>
		Serene Pub - {sessionNotFound
			? "Not Found"
			: (session?.name ?? "Loading...")}
	</title>
	<meta name="description" content="Serene Pub" />
</svelte:head>

{#if sessionNotFound}
	<div
		class="flex h-full flex-col items-center justify-center gap-4 opacity-60"
	>
		<Icons.MessageSquareOff size={48} />
		<p class="text-lg font-semibold">Session not found</p>
		<p class="text-sm">
			This session may have been deleted or you don't have access to it.
		</p>
	</div>
{:else}
	<div class="relative flex h-full flex-col">
		{#if sessionViewFrame}
			<!-- The mode's declared session view (20 §12): one opaque-origin
			     frame owning the whole message section, layout-sized, fed
			     over its channel. Core's chrome deliberately absent — this is
			     the total-conversion lane. -->
			<div class="min-h-0 flex-1">
				<PluginFrame
					src={sessionViewFrame.src}
					title={sessionViewFrame.title ?? "Session view"}
					surface="session-view"
					session={session
						? { id: session.id, name: (session as any).name ?? null }
						: undefined}
					messages={session?.sessionMessages ?? []}
					onAction={handleFrameAction}
				/>
			</div>
		{:else}
		<!-- The modular session layout (mockup 2026-08-28): the conversation
		     is the fixed chat core; widgets live in the free-form zones the
		     user's layout template declares — pinned rails, icon strips with
		     pop-overs, and top/bottom strips, all by measured width. -->
		<SessionLayout
			manager={surfaceManager}
			{sessionId}
			{session}
			onFrameAction={handleFrameAction}
		>
			{#snippet messagesChildren()}
		<SessionContainer
			{session}
			{pagination}
			{loadingOlderMessages}
			bind:sessionMessagesContainer
			onScroll={handleScroll}
			{getMessageCharacter}
			{canControlMessage}
			{showSwipeControls}
			{canSwipeRight}
			{canRegenerateLastMessage}
			onSwipeLeft={swipeLeft}
			onSwipeRight={swipeRight}
			onEditMessage={handleEditMessage}
			onDeleteMessage={handleDeleteMessage}
			onHideMessage={handleHideMessage}
			onRegenerateMessage={handleRegenerateMessage}
			onContinueMessage={handleContinueMessage}
			onAbortMessage={handleAbortMessage}
			onBranchMessage={handleBranchMessage}
			{editSessionMessage}
			{hasGeneratingMessage}
			{isGuest}
			{sceneList}
			onHistoryEntryClick={({ historyEntryId, lorebookId }) => {
				panelsCtx.digest.lorebookId = lorebookId
				panelsCtx.digest.historyEntryId = historyEntryId
				panelsCtx.digest.historyEntryTab = "content"
				panelsCtx.openPanel({ key: "lorebooks", toggle: false })
			}}
			onSceneClick={({ sceneId, historyEntryId, lorebookId }) => {
				panelsCtx.digest.lorebookId = lorebookId
				panelsCtx.digest.historyEntryId = historyEntryId
				panelsCtx.digest.historyEntryTab = "scenes"
				panelsCtx.digest.sceneId = sceneId
				panelsCtx.openPanel({ key: "lorebooks", toggle: false })
			}}
			onNewHistoryEntry={({ lorebookId }) => {
				panelsCtx.digest.lorebookId = lorebookId
				panelsCtx.digest.historyEntryTab = "content"
				panelsCtx.openPanel({ key: "lorebooks", toggle: false })
			}}
			onAttachLorebook={() => {
				panelsCtx.openPanel({ key: "lorebooks", toggle: false })
			}}
		>
			{#snippet MessageComponent(props)}
				<SessionMessage
					{...props}
					onCharacterNameClick={handleCharacterNameClick}
					onAvatarClick={handleAvatarClick}
					onImageClick={handleImageClick}
					onCancelEditMessage={handleCancelEditMessage}
					onSaveEditMessage={handleSaveEditMessage}
					bind:openMsgControlsMenu
					{lastPersonaMessage}
					{isSummarizationMode}
					isSelected={selectedMessageIds.has(props.msg.id)}
					onStartSummarization={summarizationEnabled &&
					!isSummarizationMode
						? enterSummarizationMode
						: undefined}
					menuTriggers={modeTriggers.filter(
						(t) => t.kind === "menu"
					)}
					onFireTrigger={fireMenuTrigger}
					onBlockAction={fireBlockAction}
>
					{#snippet GeneratingAnimationComponent()}
						{@const character = props.getMessageCharacter(
							props.msg
						)}
						{@const speakerName = props.msg.isNarratorResponse
							? props.msg.metadata?.narratorName || "Narrator"
							: resolveCharacterName(character, "User")}
						<GeneratingAnimation
							text={`${speakerName} is typing`}
						/>
					{/snippet}
					{#snippet messageControls(msg)}
						{#if isSummarizationMode}
							{@const isScened = scenedMessageIds.has(msg.id)}
							<div
								class="flex gap-2"
								role="group"
								aria-label="Selection controls"
							>
								{#if isScened}
									<span
										class="btn msg-ctrl-btn-labeled preset-filled-surface-400-600 cursor-not-allowed opacity-60"
										title="Already captured in a scene"
										aria-label="Already captured in a scene"
									>
										<Icons.Film aria-hidden="true" />
										<span class="hidden lg:inline">
											In Scene
										</span>
									</span>
								{:else}
									<button
										class="btn msg-ctrl-btn-labeled {selectedMessageIds.has(
											msg.id
										)
											? 'preset-filled-secondary-500'
											: 'preset-filled-surface-400-600'}"
										title={selectedMessageIds.has(msg.id)
											? "Deselect message"
											: "Select message"}
										aria-label={selectedMessageIds.has(
											msg.id
										)
											? "Deselect message"
											: "Select message"}
										aria-pressed={selectedMessageIds.has(
											msg.id
										)}
										onclick={() =>
											toggleSummarizationMessage(msg.id)}
									>
										{#if selectedMessageIds.has(msg.id)}
											<Icons.CheckSquare
												aria-hidden="true"
											/>
										{:else}
											<Icons.Square aria-hidden="true" />
										{/if}
										<span class="hidden lg:inline">
											{selectedMessageIds.has(msg.id)
												? "Deselect"
												: "Select"}
										</span>
									</button>
									<button
										class="btn msg-ctrl-btn-labeled preset-filled-surface-400-600"
										title="Select all above up to nearest selected"
										aria-label="Select all above up to nearest selected"
										onclick={() =>
											selectAllAbove(props.index)}
									>
										<Icons.ChevronsUp aria-hidden="true" />
										<span class="hidden lg:inline">
											Select All Above
										</span>
									</button>
									<button
										class="btn msg-ctrl-btn-labeled preset-filled-surface-400-600"
										title="Select all below up to nearest selected"
										aria-label="Select all below up to nearest selected"
										onclick={() =>
											selectAllBelow(props.index)}
									>
										<Icons.ChevronsDown
											aria-hidden="true"
										/>
										<span class="hidden lg:inline">
											Select All Below
										</span>
									</button>
								{/if}
							</div>
						{:else}
							<MessageControls
								{msg}
								isLastMessage={props.isLastMessage}
								canRegenerateLastMessage={props.canRegenerateLastMessage}
								editSessionMessage={props.editSessionMessage}
								hasGeneratingMessage={props.hasGeneratingMessage}
								onEditMessage={props.onEditMessage}
								onHideMessage={props.onHideMessage}
								onDeleteMessage={props.onDeleteMessage}
								onRegenerateMessage={props.onRegenerateMessage}
								onContinueMessage={props.onContinueMessage}
								onAbortMessage={props.onAbortMessage}
								onBranchMessage={props.onBranchMessage}
								onStartSummarization={summarizationEnabled
									? enterSummarizationMode
									: undefined}
								debugMeta={systemSettingsCtx.settings
									?.contextDebuggingEnabled
									? (msg.debugMeta ?? null)
									: null}
								onShowDebugMeta={systemSettingsCtx.settings
									?.contextDebuggingEnabled
									? (meta: any) => {
											draftCompiledPrompt = {
												prompt: meta?.prompt,
												messages: meta?.messages,
												meta
											}
											showDraftCompiledPromptModal = true
										}
									: undefined}
								open={openMsgControlsMenu === msg.id}
								onOpenChange={(isOpen) =>
									(openMsgControlsMenu = isOpen
										? msg.id
										: undefined)}
							/>
						{/if}
					{/snippet}
				</SessionMessage>
			{/snippet}
			{#snippet NextCharacterComponent()}
				{#if shouldShowNextCharacterBlock}
					<NextCharacterBlock
						{nextCharacter}
						shouldShow={shouldShowNextCharacterBlock}
						{canChooseDifferentCharacter}
						onContinueWithNextCharacter={handleContinueWithNextCharacter}
						onChooseDifferentCharacter={handleChooseDifferentCharacter}
					/>
				{/if}
			{/snippet}
		</SessionContainer>
			{/snippet}
			{#snippet composerChildren()}
				{#if isSummarizationMode && summarizationEnabled}
					<div
						class="preset-tonal-secondary flex flex-wrap items-center gap-2 p-3 lg:rounded-t-lg"
					>
						<span class="text-sm font-semibold">
							{selectedMessageIds.size}
							{selectedMessageIds.size === 1
								? "message"
								: "messages"} selected
						</span>
						<div class="flex gap-2">
							<button
								class="btn btn-sm preset-filled-surface-400-600"
								title="Select All"
								onclick={() => {
									selectedMessageIds = new Set(
										session!.sessionMessages
											.filter(
												(m) =>
													!scenedMessageIds.has(m.id)
											)
											.map((m) => m.id)
									)
								}}
							>
								<Icons.CheckSquare size={16} />
								<span class="hidden sm:inline">Select All</span>
							</button>
							<button
								class="btn btn-sm preset-filled-surface-400-600"
								title="Select None"
								onclick={() => (selectedMessageIds = new Set())}
							>
								<Icons.Square size={16} />
								<span class="hidden sm:inline">
									Select None
								</span>
							</button>
						</div>
						<div class="ml-auto flex flex-wrap gap-2">
							<button
								class="btn btn-sm preset-filled-surface-500"
								title="Cancel"
								onclick={exitSummarizationMode}
							>
								<Icons.X size={16} />
								<span class="hidden sm:inline">Cancel</span>
							</button>
							<button
								class="btn btn-sm preset-filled-secondary-500"
								title="Scene"
								disabled={selectedMessageIds.size === 0}
								onclick={() => openSummarizeModal("scene")}
							>
								<Icons.Film size={16} />
								<span class="hidden sm:inline">Scene</span>
							</button>
							<button
								class="btn btn-sm preset-filled-primary-500"
								title="World Lore"
								disabled={selectedMessageIds.size === 0}
								onclick={() => openSummarizeModal("world")}
							>
								<Icons.Globe size={16} />
								<span class="hidden sm:inline">World Lore</span>
							</button>
							<button
								class="btn btn-sm preset-filled-tertiary-500"
								title="Character Lore"
								disabled={selectedMessageIds.size === 0}
								onclick={() => openSummarizeModal("character")}
							>
								<Icons.User size={16} />
								<span class="hidden sm:inline">
									Character Lore
								</span>
							</button>
						</div>
					</div>
				{:else if modeMissing}
					<!-- Read-only (19 §6, ruled): the mode disappeared, the
					     history stays, nothing starts a new turn — and the
					     server refuses independently at every generation
					     choke, so this banner is honesty, not the lock. -->
					<div
						class="preset-tonal-warning flex items-start gap-3 rounded-t-lg p-4"
						role="status"
					>
						<Icons.Lock size={20} class="mt-0.5 shrink-0" />
						<div class="text-sm">
							<p class="font-semibold">
								This session is read-only.
							</p>
							<p>
								Its mode ({(session as any)?.genreId}) is not
								installed. Messages are safe to read; new turns
								resume when the mode returns.
							</p>
						</div>
					</div>
				{:else}
					{#each [...typingPersonas.values()] as typingPersona (typingPersona.name)}
						<div class="flex items-center gap-2 px-2 pb-1">
							<p
								class="text-surface-600-400 animate-pulse text-sm"
							>
								{typingPersona.name} is typing...
							</p>
							<div
								class="bg-primary-500 h-2 w-2 animate-bounce rounded-full"
							></div>
						</div>
					{/each}
					<SessionComposer
						bind:newMessage
						onSend={handleSend}
						hideCompose={composerHidden}
						{draftCompiledPrompt}
						{currentUserPersona}
						{userPersonasInSession}
						onSwitchPersona={switchPersona}
						session={session ?? undefined}
						{lastMessage}
						{editSessionMessage}
						{isGuest}
						{showAddPersonaCTA}
						onAddPersonaClick={() => {
							showAddPersonaModal = true
						}}
						onAbortLastMessage={handleAbortLastMessage}
						extraTabs={isGuest
							? []
							: [
									{
										value: "extraControls",
										title: "Extra Controls",
										control: extraControlsButton,
										content: extraControlsContent
									},
									...(session?.lorebookId
										? [
												{
													value: "workflow",
													title: "Lore",
													control: workflowButton,
													content: workflowContent
												}
											]
										: []),
									{
										value: "sceneImages",
										title: "Pinned Images",
										control: sceneImagesButton,
										content: sceneImagesContent
									},
									...(systemSettingsCtx.settings
										?.contextDebuggingEnabled
										? [
												{
													value: "statistics",
													title: "Statistics",
													control: statisticsButton,
													content: statisticsContent
												}
											]
										: [])
								]}
					/>
				{/if}
			{/snippet}
		</SessionLayout>
		{/if}
	</div>

	{#if showProcessSceneModal && processSceneId !== null && session?.lorebookId}
		<ProcessSceneModal
			open={showProcessSceneModal}
			onOpenChange={(e) => (showProcessSceneModal = e.open)}
			sceneId={processSceneId}
			activityId={processActivityId}
			pendingResult={processPendingResult}
			lorebookId={session.lorebookId}
			{lorebookBindingList}
			onApplied={() => {
				socket?.emit("scenes:scenedMessageIds", { sessionId })
				socket?.emit("scenes:list", {
					sessionId
				} satisfies Sockets.Scenes.List.Params)
			}}
			onDiscarded={() => {
				// The server deletes the scene on dismiss when it was created
				// for this run, so refresh what the session shows as "scened".
				socket?.emit("scenes:scenedMessageIds", { sessionId })
				socket?.emit("scenes:list", {
					sessionId
				} satisfies Sockets.Scenes.List.Params)
			}}
		/>
	{/if}

	<SummarizeLoreModal
		bind:open={showSummarizeModal}
		onOpenChange={(e) => {
			showSummarizeModal = e.open
			// Drop the resume payload on close so the next manual open starts
			// from configure rather than rehydrating a stale review.
			if (!e.open) resumeSummarizeActivity = null
		}}
		resumeActivity={resumeSummarizeActivity}
		{sessionId}
		lorebookId={session?.lorebookId ?? null}
		selectedMessageIds={[...selectedMessageIds]}
		initialLoreType={summarizeLoreType}
		onSaved={() => {
			socket?.emit("scenes:scenedMessageIds", { sessionId })
			socket?.emit("scenes:list", {
				sessionId
			} satisfies Sockets.Scenes.List.Params)
			exitSummarizationMode()
		}}
		onSceneProcessStarted={(sceneId) => {
			// Fires only after scenes:create succeeded, so the selection is
			// safe to drop — the scene row now holds those message ids, and
			// they immediately render as "scened". Clearing on click instead
			// would lose a hand-picked selection whenever the create failed.
			socket?.emit("scenes:scenedMessageIds", { sessionId })
			socket?.emit("scenes:list", {
				sessionId
			} satisfies Sockets.Scenes.List.Params)
			exitSummarizationMode()
			// Review happens in the activity-backed modal, which is what knows
			// how to resume a minimized run and saves via scenes:update.
			processSceneId = sceneId
			processActivityId = null
			processPendingResult = null
			showProcessSceneModal = true
		}}
		onLorebookSet={handleLorebookSet}
		sessionCharacters={(session?.sessionCharacters ?? []).map((cc) => ({
			type: "character" as const,
			id: cc.character.id,
			name: resolveCharacterName(cc.character, cc.character.name)
		}))}
		sessionPersonas={(session?.sessionPersonas ?? []).map((cp) => ({
			type: "persona" as const,
			id: cp.persona.id,
			name: cp.persona.name
		}))}
		hasSceneMessageGap={hasSceneGap}
	/>

	<Dialog
		open={showDeleteMessageModal}
		onOpenChange={onOpenMessageDeleteChange}
	>
		<Portal>
			<Dialog.Backdrop
				class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
			/>
			<Dialog.Positioner
				class="fixed inset-0 z-50 flex items-center justify-center p-4"
			>
				<Dialog.Content
					class="card bg-surface-100-900 border-surface-300-700 max-w-[95vw] space-y-4 border p-4 shadow-xl"
				>
					<header class="flex justify-between">
						<h2 class="h2">Confirm</h2>
					</header>
					<article>
						<p class="opacity-60">
							Are you sure you want to delete this message?
						</p>
					</article>
					<footer class="flex justify-end gap-4">
						<button
							class="btn preset-filled-surface-500"
							onclick={onDeleteMessageCancel}
						>
							Cancel
						</button>
						<button
							class="btn preset-filled-error-500"
							onclick={onDeleteMessageConfirm}
						>
							Delete
						</button>
					</footer>
				</Dialog.Content>
			</Dialog.Positioner>
		</Portal>
	</Dialog>

	<Dialog
		open={showDraftCompiledPromptModal}
		onOpenChange={(details) =>
			(showDraftCompiledPromptModal = details.open)}
	>
		<Portal>
			<Dialog.Backdrop
				class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
			/>
			<Dialog.Positioner
				class="fixed inset-0 z-50 flex items-center justify-center p-4"
			>
				<Dialog.Content
					class="card bg-surface-100-900 border-surface-300-700 flex max-h-[90dvh] w-[70em] max-w-full flex-col space-y-4 border p-4 shadow-xl"
				>
					<header class="flex shrink-0 items-center justify-between">
						<h2 class="h2">Prompt Details</h2>
						<button
							class="btn btn-sm"
							onclick={() =>
								(showDraftCompiledPromptModal = false)}
						>
							<Icons.X size={20} />
						</button>
					</header>

					{#if draftCompiledPrompt?.meta}
						{@const tokens = draftCompiledPrompt.meta.tokenCounts}
						{@const msgs = draftCompiledPrompt.meta.sessionMessages}
						{@const src = draftCompiledPrompt.meta.sources}
						{@const retrieval = draftCompiledPrompt.meta.retrieval}
						{@const tokenPct = Math.min(
							100,
							Math.round((tokens.total / tokens.limit) * 100)
						)}
						{@const truncReason =
							draftCompiledPrompt.meta.truncationReason}

						<div
							class="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1"
						>
							<!-- ── Token Budget ──────────────────────────────────────────────── -->
							<section
								class="bg-surface-200-800 space-y-2 rounded-lg p-3"
							>
								<h3
									class="text-surface-700-300 text-xs font-semibold tracking-wide uppercase"
								>
									Token Budget
								</h3>
								<div
									class="flex items-center justify-between text-sm"
								>
									<span
										class:text-error-500={contextExceeded}
										class:text-success-500={!contextExceeded}
									>
										{tokens.total.toLocaleString()} / {tokens.limit.toLocaleString()}
										tokens
									</span>
									<span class="text-surface-700-300 text-xs">
										{tokenPct}%
									</span>
								</div>
								<div
									class="bg-surface-300-700 h-2 w-full overflow-hidden rounded-full"
								>
									<div
										class="h-full rounded-full transition-all {contextExceeded
											? 'bg-error-500'
											: tokenPct > 85
												? 'bg-warning-500'
												: 'bg-success-500'}"
										style="width: {tokenPct}%"
									></div>
								</div>
								<div
									class="text-surface-700-300 flex flex-wrap gap-4 text-xs"
								>
									<span>
										Format: <span
											class="text-surface-300-700"
										>
											{draftCompiledPrompt.meta
												.promptFormat || "—"}
										</span>
									</span>
									{#if draftCompiledPrompt.meta.templateName}
										<span>
											Template: <span
												class="text-surface-300-700"
											>
												{draftCompiledPrompt.meta
													.templateName}
											</span>
										</span>
									{/if}
									<!--
										One engine now. Which retrieval *arm*
										ran — keyword, vector, or both — is a
										per-candidate fact and shows up in the
										Retrieval section's reasoning, not as a
										single label over the whole prompt.
									-->
									<span class="text-surface-400">
										Pipeline
									</span>
								</div>
								{#if truncReason}
									<div
										class="bg-warning-500/10 border-warning-500/30 text-warning-400 flex items-center gap-1.5 rounded border px-2 py-1.5 text-xs"
									>
										<Icons.TriangleAlert
											size={12}
											class="shrink-0"
										/>
										<span>
											Truncated: <span
												class="font-medium"
											>
												{truncReason.replace(/_/g, " ")}
											</span>
										</span>
									</div>
								{/if}
							</section>

							<!-- ── Messages ─────────────────────────────────────────────────── -->
							<section
								class="bg-surface-200-800 space-y-2 rounded-lg p-3"
							>
								<h3
									class="text-surface-700-300 text-xs font-semibold tracking-wide uppercase"
								>
									Messages
								</h3>
								<div class="flex items-baseline gap-2 text-sm">
									<span>
										<span class="font-medium">
											{msgs.included}
										</span>
										<span class="text-surface-700-300">
											/ {msgs.total} included
										</span>
									</span>
									{#if msgs.total > msgs.included}
										<span class="text-warning-400 text-xs">
											{msgs.total - msgs.included} excluded
										</span>
									{/if}
								</div>
								{#if msgs.excludedIds?.length > 0}
									<p class="text-surface-700-300 text-xs">
										Excluded message IDs: {msgs.excludedIds.join(
											", "
										)}
									</p>
								{/if}
							</section>

							<!-- ── Retrieval ─────────────────────────────────────────────────── -->
							<!--
								Rebuilt on what the pipeline actually records, rather
								than on the shape the legacy engines reported.

								The old panel showed `guaranteed / RAG recalled /
								fill-in` counts and a score histogram. Those were
								counters for the infill engine's internal phases, and
								the pipeline has no phases: it scores candidates,
								allocates a budget, and records per block why that
								block is in or out. Reproducing the old numbers would
								have meant inventing values for stages that no longer
								run.

								This answers the question the panel existed for —
								"why isn't my lore showing up" — directly, per entry,
								instead of via an aggregate it was inferred from.
							-->
							{#if retrieval?.blocks?.length}
								{@const shown = retrieval.blocks}
								{@const kept = shown.filter(
									(b: { included: boolean }) => b.included
								)}
								<section
									class="bg-surface-200-800 space-y-2 rounded-lg p-3"
								>
									<h3
										class="text-surface-700-300 text-xs font-semibold tracking-wide uppercase"
									>
										Retrieval
									</h3>
									<p class="text-surface-700-300 text-xs">
										{kept.length} of {shown.length} candidates
										included
									</p>
									<div class="space-y-1">
										{#each shown as b (`${b.source}:${b.id}`)}
											<div
												class="bg-surface-300-700 rounded p-2 text-xs"
											>
												<div
													class="flex items-baseline gap-2"
												>
													<span
														class="font-medium {b.included
															? 'text-primary-400'
															: 'text-surface-400'}"
													>
														{b.included
															? "in"
															: "out"}
													</span>
													<span
														class="min-w-0 flex-1 truncate"
													>
														{b.name ?? b.source}
													</span>
													<span
														class="text-surface-700-300 shrink-0"
													>
														{b.source} · {b.tokens} tok
													</span>
												</div>
												{#if b.why?.length}
													<p
														class="text-surface-700-300 mt-1"
													>
														{b.why.join(" · ")}
													</p>
												{/if}
											</div>
										{/each}
									</div>
								</section>
							{/if}

							<!-- ── Sources ───────────────────────────────────────────────────── -->
							<section
								class="bg-surface-200-800 space-y-2 rounded-lg p-3"
							>
								<h3
									class="text-surface-700-300 text-xs font-semibold tracking-wide uppercase"
								>
									Sources
								</h3>
								<div
									class="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3"
								>
									<div>
										<p
											class="text-surface-400 mb-1 text-xs"
										>
											Characters
										</p>
										{#if src.characters.length > 0}
											<ul class="space-y-0.5">
												{#each src.characters as char}
													<li
														class="flex items-center gap-1"
													>
														<Icons.User
															size={12}
															class="text-surface-700-300 shrink-0"
														/>
														<span
															class="truncate text-xs"
														>
															{char.name}{char.nickname
																? ` (${char.nickname})`
																: ""}
														</span>
													</li>
												{/each}
											</ul>
										{:else}
											<p
												class="text-surface-700-300 text-xs"
											>
												None
											</p>
										{/if}
									</div>
									<div>
										<p
											class="text-surface-400 mb-1 text-xs"
										>
											Personas
										</p>
										{#if src.personas.length > 0}
											<ul class="space-y-0.5">
												{#each src.personas as persona}
													<li
														class="flex items-center gap-1"
													>
														<Icons.User2
															size={12}
															class="text-surface-700-300 shrink-0"
														/>
														<span
															class="truncate text-xs"
														>
															{persona.name}
														</span>
													</li>
												{/each}
											</ul>
										{:else}
											<p
												class="text-surface-700-300 text-xs"
											>
												None
											</p>
										{/if}
									</div>
									<div>
										<p
											class="text-surface-400 mb-1 text-xs"
										>
											Scenario
										</p>
										<p class="text-xs capitalize">
											{src.scenario ?? "None"}
										</p>
									</div>
								</div>
							</section>

							<!-- ── Prompt Preview ────────────────────────────────────────────── -->
							<section
								class="bg-surface-200-800 space-y-2 rounded-lg p-3"
							>
								<h3
									class="text-surface-700-300 text-xs font-semibold tracking-wide uppercase"
								>
									Prompt Preview
								</h3>
								{#if draftCompiledPrompt.messages && draftCompiledPrompt.messages.length > 0}
									<!-- Session format: render each message block -->
									<div
										class="max-h-96 space-y-2 overflow-y-auto"
									>
										{#each draftCompiledPrompt.messages as msg, i}
											<div
												class="rounded border {msg.role ===
												'system'
													? 'border-warning-500/30 bg-warning-500/5'
													: msg.role === 'assistant'
														? 'border-primary-500/30 bg-primary-500/5'
														: 'border-surface-400/30 bg-surface-300-700'} overflow-hidden"
											>
												<div
													class="flex items-center gap-2 border-b border-inherit px-2 py-1"
												>
													<span
														class="text-xs font-semibold tracking-wide uppercase {msg.role ===
														'system'
															? 'text-warning-400'
															: msg.role ===
																  'assistant'
																? 'text-primary-400'
																: 'text-surface-400'}"
													>
														{msg.role}
													</span>
													{#if msg.name}
														<span
															class="text-surface-700-300 text-xs"
														>
															({msg.name})
														</span>
													{/if}
													<span
														class="text-surface-600 ml-auto text-xs"
													>
														#{i + 1}
													</span>
												</div>
												<pre
													class="px-2 py-1.5 text-xs leading-relaxed whitespace-pre-wrap">{typeof msg.content ===
													"string"
														? msg.content
														: JSON.stringify(
																msg.content,
																null,
																2
															)}</pre>
											</div>
										{/each}
									</div>
								{:else if draftCompiledPrompt.prompt}
									<!-- Raw text format -->
									<pre
										class="bg-surface-300-700 max-h-96 overflow-y-auto rounded p-2 text-xs leading-relaxed whitespace-pre-wrap">{draftCompiledPrompt.prompt}</pre>
								{:else}
									<p class="text-surface-700-300 text-xs">
										No prompt content available.
									</p>
								{/if}
							</section>
						</div>
					{:else}
						<div
							class="text-surface-700-300 py-8 text-center text-sm"
						>
							No compiled prompt data available.
						</div>
					{/if}

					<footer class="flex shrink-0 justify-end gap-4 pt-2">
						<button
							class="btn preset-filled-surface-500"
							onclick={() =>
								(showDraftCompiledPromptModal = false)}
						>
							Close
						</button>
					</footer>
				</Dialog.Content>
			</Dialog.Positioner>
		</Portal>
	</Dialog>

	<Dialog
		open={showTriggerCharacterMessageModal}
		onOpenChange={(e) => (showTriggerCharacterMessageModal = e.open)}
	>
		<Portal>
			<Dialog.Backdrop
				class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
			/>
			<Dialog.Positioner
				class="fixed inset-0 z-50 flex items-center justify-center p-4"
			>
				<Dialog.Content
					class="card bg-surface-100-900 relative max-h-[95dvh] w-[min(95vw,800px)] space-y-4 overflow-hidden p-4 shadow-xl"
				>
					<header class="mb-2 flex items-center justify-between">
						<h2 class="h2">Trigger Character</h2>
						<button
							class="btn btn-sm"
							onclick={() =>
								(showTriggerCharacterMessageModal = false)}
						>
							<Icons.X size={20} />
						</button>
					</header>
					<button
						class="group preset-outlined-primary-400-600 hover:preset-filled-primary-500 mb-4 flex w-full items-center gap-3 rounded p-2"
						onclick={(e) => handleTriggerNarratorResponse(e)}
					>
						<div
							class="bg-primary-500/10 text-primary-500 group-hover:text-primary-950 shrink-0 rounded-lg p-2"
						>
							<Icons.CloudSun size={20} />
						</div>
						<div class="flex-1 text-left">
							<div class="font-semibold">{narratorName}</div>
							<div
								class="text-surface-700-300 group-hover:text-surface-800-200 text-xs"
							>
								Narrate the environment, atmosphere, or side
								characters instead
							</div>
						</div>
					</button>
					<input
						class="input mb-4 w-full"
						type="text"
						placeholder="Search characters..."
						bind:value={triggerCharacterSearch}
					/>
					<div class="max-h-[60dvh] min-h-0 overflow-y-auto">
						<div
							class="relative flex flex-col pr-2 lg:flex-row lg:flex-wrap"
						>
							{#each (session?.sessionCharacters || []).filter( (cc) => {
									const c = cc.character
									if (!c) return false
									const s = triggerCharacterSearch
										.trim()
										.toLowerCase()
									if (!s) return true
									return c.name
											?.toLowerCase()
											.includes(s) || c.nickname
											?.toLowerCase()
											.includes(s) || c.description
											?.toLowerCase()
											.includes(s) || c.creatorNotes
											?.toLowerCase()
											.includes(s)
								} ) as filtered}
								<div class="flex p-1 lg:basis-1/2">
									<button
										class="group preset-outlined-surface-400-600 hover:preset-filled-surface-500 relative flex w-full gap-3 overflow-hidden rounded p-2"
										onclick={() =>
											onSelectTriggerCharacterMessage(
												filtered.character.id
											)}
									>
										<div class="w-fit shrink-0">
											<Avatar char={filtered.character} />
										</div>
										<div
											class="relative flex w-0 min-w-0 flex-1 flex-col"
										>
											<div
												class="w-full truncate text-left font-semibold"
											>
												{filtered.character.nickname ||
													filtered.character.name}
											</div>
											<div
												class="text-surface-700-300 group-hover:text-surface-800-200 line-clamp-2 w-full text-left text-xs"
											>
												{filtered.character
													.creatorNotes ||
													filtered.character
														.description ||
													"No description"}
											</div>
										</div>
									</button>
								</div>
							{/each}
						</div>
					</div>
				</Dialog.Content>
			</Dialog.Positioner>
		</Portal>
	</Dialog>

	<TriggerNarratorResponseModal
		open={showTriggerNarratorResponseModal}
		onOpenChange={(e) => (showTriggerNarratorResponseModal = e.open)}
		onTrigger={handleConfirmTriggerNarratorResponse}
		onCancel={handleCancelTriggerNarratorResponse}
		{narratorName}
	/>

	<EntityGalleryViewModal
		bind:open={showAvatarModal}
		onOpenChange={(e) => (showAvatarModal = e.open)}
		entity={avatarModalEntity}
	/>

	<EntityGalleryViewModal
		bind:open={showImageModal}
		onOpenChange={(e) => (showImageModal = e.open)}
		image={imageModalSrc}
	/>

	<PersonaSelectModal
		open={showAddPersonaModal}
		onclose={() => (showAddPersonaModal = false)}
		onSelect={handleAddPersona}
		personas={availablePersonas}
		title="Add Persona to Session"
		description="Select a persona to add to this session. You'll be able to send messages as this persona."
	/>

	<BranchSessionModal
		open={showBranchSessionModal}
		onOpenChange={(e) => (showBranchSessionModal = e.open)}
		onConfirm={onBranchSessionConfirm}
		onCancel={onBranchSessionCancel}
		initialTitle={session?.name ?? undefined}
	/>

	{#snippet workflowButton()}
		<Icons.BookOpen size="0.75em" class="block" />
	{/snippet}

	{#snippet workflowContent()}
		{#if session?.lorebookId}
			<SessionWorkflowTab
				lorebookId={session.lorebookId}
				{sceneList}
				onOpenEntry={handleOpenEntry}
				onEnterSummarizationMode={summarizationEnabled
					? enterSummarizationModeEmpty
					: undefined}
			/>
		{/if}
	{/snippet}

	{#snippet sceneImagesButton()}
		<Icons.Images size="0.75em" />
	{/snippet}

	{#snippet sceneImagesContent()}
		<SessionSceneImagesTab
			sessionCharacters={session?.sessionCharacters ?? []}
			sessionPersonas={session?.sessionPersonas ?? []}
			bind:leftImage={leftSceneImage}
			bind:rightImage={rightSceneImage}
		/>
	{/snippet}

	{#snippet extraControlsButton()}
		<Icons.MessageSquare size="0.75em" />
	{/snippet}

	{#snippet extraControlsContent()}
		<div class="mb-[0.5em] flex flex-wrap gap-2">
			<!-- Character-response mechanics (19 §2): a mode whose shape has
			     no character system has nobody to continue as or trigger, so
			     these do not exist for it. The persona half of the disabled
			     check follows the shape too — a persona-less mode's turns
			     need no persona on record. -->
			{#if charactersInMode}
				<button
					class="btn btn-sm preset-tonal-primary"
					title="Continue Conversation"
					onclick={handleTriggerContinueConversation}
					disabled={!session ||
						(personasInMode &&
							!session.sessionPersonas?.[0]?.personaId) ||
						lastMessage?.isGenerating}
				>
					<Icons.MessageSquareMore size={14} />
					Continue
				</button>
				<button
					class="btn btn-sm preset-tonal-secondary"
					title="Trigger Character"
					onclick={handleTriggerCharacterMessage}
					disabled={!session ||
						(personasInMode &&
							!session.sessionPersonas?.[0]?.personaId) ||
						lastMessage?.isGenerating}
				>
					<Icons.MessageSquarePlus size={14} />
					Trigger Character
				</button>
			{/if}
			<button
				class="btn btn-sm preset-tonal-warning"
				title="Regenerate Last Message"
				onclick={handleRegenerateLastMessage}
				disabled={!canRegenerateLastMessage}
			>
				<Icons.RefreshCw size={14} />
				Regenerate
			</button>
			<!-- The contributed trigger set (19 §4): rendered from rows, so a
			     retired contributor takes its button with it. The narrate
			     function keeps its bespoke presentation — the resolved
			     narrator name and its instructions modal — mapped on the
			     function key. -->
			{#each modeTriggers.filter((t) => t.kind === "button") as t (t.specSlug + t.function)}
				{#if t.function === "narrate"}
					<button
						class="btn btn-sm preset-tonal-success"
						title="Trigger Narrator Response"
						onclick={handleTriggerNarratorResponse}
						disabled={!session || lastMessage?.isGenerating}
					>
						<Icons.CloudSun size={14} />
						{narratorName}
					</button>
				{:else}
					{@const TriggerIconComponent = triggerIcon(t.icon)}
					<button
						class="btn btn-sm preset-tonal-success"
						title={t.name}
						onclick={() => fireTrigger(t.function)}
						disabled={!session || lastMessage?.isGenerating}
					>
						<TriggerIconComponent size={14} />
						{t.name}
					</button>
				{/if}
			{/each}
		</div>
	{/snippet}

	{#snippet statisticsButton()}
		<Icons.BarChart2 size="0.75em" />
	{/snippet}

	{#snippet statisticsContent()}
		<div class="mb-[0.5em] flex flex-wrap items-center gap-3">
			<button
				class="btn btn-sm preset-tonal-primary"
				title="View full prompt details"
				onclick={() => (showDraftCompiledPromptModal = true)}
				disabled={!draftCompiledPrompt?.meta}
			>
				<Icons.Info size={14} />
				Details
			</button>
			{#if draftCompiledPrompt?.meta}
				<div class="flex gap-4 text-xs">
					<div class="flex flex-col gap-0.5">
						<span
							class="text-surface-700-300 tracking-wide uppercase"
							style="font-size:0.65rem"
						>
							Tokens
						</span>
						<span
							class:text-error-500={contextExceeded}
							class="font-medium tabular-nums"
						>
							{draftCompiledPrompt.meta.tokenCounts.total} / {draftCompiledPrompt
								.meta.tokenCounts.limit}
						</span>
					</div>
					<div class="flex flex-col gap-0.5">
						<span
							class="text-surface-700-300 tracking-wide uppercase"
							style="font-size:0.65rem"
						>
							Messages
						</span>
						<span class="font-medium tabular-nums">
							{draftCompiledPrompt.meta.sessionMessages.included} /
							{draftCompiledPrompt.meta.sessionMessages.total}
						</span>
					</div>
				</div>
			{:else if draftCompiledPrompt?.error}
				<span class="text-error-500 text-xs">
					{draftCompiledPrompt.error}
				</span>
			{:else}
				<span class="text-surface-700-300 text-xs">
					No statistics yet — send a message first.
				</span>
			{/if}
		</div>
	{/snippet}
{/if}

<style lang="postcss">
	@reference "tailwindcss";

	/* --- Markdown custom styles --- */
	:global(.markdown-body) {
		white-space: pre-line;
	}
	:global(.markdown-body blockquote) {
		color: #7dd3fc; /* sky-300 */
		border-left: 4px solid #38bdf8; /* sky-400 */
		background: rgba(56, 189, 248, 0.08);
		padding-left: 1em;
		margin-left: 0;
	}
	:global(.markdown-body em),
	:global(.markdown-body i) {
		color: #f472b6; /* pink-400 */
		font-style: italic;
		background: rgba(244, 114, 182, 0.08);
		border-radius: 0.2em;
		padding: 0 0.15em;
	}
	/* Preserve blank lines between paragraphs */
	:global(.markdown-body p) {
		margin-top: 1em;
		margin-bottom: 1em;
		min-height: 1.5em;
	}
</style>
