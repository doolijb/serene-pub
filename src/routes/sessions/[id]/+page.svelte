<script lang="ts">
	import { avatarSrc, withRevisedAvatar } from "$lib/client/utils/media"
	import {
		setHostParticipants,
		setHostViews
	} from "$lib/client/components/hostElements/context.svelte"
	import ChangeSpriteDialog from "$lib/client/components/sprites/ChangeSpriteDialog.svelte"
	import { asShownSprite } from "$lib/shared/sprites"
	import type {
		ConversationDossierV1,
		ConversationLineV1,
		ConversationProposalV1
	} from "$lib/shared/widgets/conversation"
	import { openSessionState, sessionState } from "$lib/client/state/sessionState.svelte"
	import { describeProposal } from "$lib/shared/state/ledgerLines"
	import {
		SESSION_VIEWER_KEY,
		SESSION_TURN_ORDER_KEY,
		SESSION_DOSSIER_KEY,
		WIDGET_REQUESTS_KEY,
		type WidgetRequestHandler
	} from "$lib/shared/widgets/context"
	import {
		EMPTY_TURN_ORDER,
		hostAttributeValueFinding,
		readTurnOrder,
		type MessageV1,
		type TurnOrderV1,
		type ViewerV1
	} from "@serene-pub/sdk"
	import {
		currentSpriteIn,
		currentSpriteOf,
		shownSpriteOf,
		spriteSrc
	} from "$lib/client/utils/sprites"
	import { embeddingsStarred } from "$lib/shared/constants/embeddings"
	// The channel every session has, from the one place the host and a plugin
	// frame both read it (`messages/channels.ts` re-exports the same symbol).
	import { DEFAULT_CHANNEL } from "@serene-pub/sdk"
	import {
		messageEnvoySlug,
		messageSpeaker
	} from "$lib/client/utils/messageSpeaker"
	import RunProgressCard from "$lib/client/components/pipelines/RunProgressCard.svelte"
	import { runProgress } from "$lib/client/stores/runProgress.svelte"
	import type { RunProgress } from "$lib/shared/sockets/progress"
	import { page } from "$app/state"
	import { goto } from "$app/navigation"
	import { Dialog, Portal, Popover } from "@skeletonlabs/skeleton-svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import {
		declareInterest,
		useInterest
	} from "$lib/client/sockets/interest.svelte"
	import { interestKey } from "$lib/shared/sockets/interest"
	import * as Icons from "@lucide/svelte"
	import MessageComposer from "$lib/client/components/sessionMessages/MessageComposer.svelte"
	import PluginFrame from "$lib/client/components/frames/PluginFrame.svelte"
	import TurnPicker from "$lib/client/components/sessionMessages/TurnPicker.svelte"
	import MessagesWidget from "$lib/client/components/sessionMessages/MessagesWidget.svelte"
	import RemoteConversation from "$lib/client/components/sessionPage/RemoteConversation.svelte"
	import ProcessSceneModal from "$lib/client/components/modals/ProcessSceneModal.svelte"
	import { canAnswerForm as formAnswerVerdict } from "$lib/client/utils/formAnswer"
	import { getAllContexts, getContext, onDestroy, onMount, setContext } from "svelte"
	import { statusText, t } from "$lib/client/i18n/state.svelte"
	import { itemValuesOf } from "$lib/shared/actions/itemValues"
	import Avatar from "$lib/client/components/Avatar.svelte"
	import PersonaSelectModal from "$lib/client/components/modals/PersonaSelectModal.svelte"
	import BranchSessionModal from "$lib/client/components/modals/BranchSessionModal.svelte"
	import SummarizeLoreModal from "$lib/client/components/modals/SummarizeLoreModal.svelte"
	import TriggerNarratorResponseModal from "$lib/client/components/modals/TriggerNarratorResponseModal.svelte"
	import EntityGalleryViewModal from "$lib/client/components/gallery/EntityGalleryViewModal.svelte"
	import {
		runThatWrote,
		setRunInspection
	} from "$lib/client/components/sessionMessages/runInspection"
	import { runInspector } from "$lib/client/stores/runInspector.svelte"
	import { terminateAllWorkers } from "$lib/client/components/host/uiWorkers"
	import SessionSceneImagesTab from "$lib/client/components/sessionPage/SessionSceneImagesTab.svelte"
	import SessionWorkflowTab from "$lib/client/components/sessionPage/SessionWorkflowTab.svelte"
	import RagNotice from "$lib/client/components/sessionPage/RagNotice.svelte"
	// The answer where the question is asked (ruling 2026-09-08, 4.4): what
	// lore would fire if you sent right now, what has fired in this session,
	// and — in the prompt report — what actually fired for one reply. All
	// three read the same server projection the admin workspace does.
	import SessionRetrievalPreview from "$lib/client/components/pipelines/workspace/SessionRetrievalPreview.svelte"
	import SessionUsagePanel from "$lib/client/components/pipelines/workspace/SessionUsagePanel.svelte"
	import MessageRetrievalExplanation from "$lib/client/components/pipelines/workspace/MessageRetrievalExplanation.svelte"
	import { sceneImages } from "$lib/client/stores/sceneImages"
	import { toaster } from "$lib/client/utils/toaster"
	import { resolveCharacterName } from "$lib/shared/utils/resolveCharacterName"
	import SessionLayout from "$lib/client/sessionLayout/SessionLayout.svelte"
	import { presetBase } from "$lib/shared/sessionLayout/presets"
	import { setWidgetStylePins } from "$lib/client/stores/widgetStyles.svelte"
	import {
		setWidgetSettingBase,
		setWidgetSettingValues,
		setWidgetSettingsWriter
	} from "$lib/client/stores/widgetSettings.svelte"
	import { CORE_WIDGETS } from "$lib/shared/widgets/types"
	import {
		dispatchAction,
		type ActionDispatch,
		type CoreVerbHandlers,
		type InvokeArgs
	} from "$lib/shared/widgets/invokeAction"
	import {
		actionIdentity,
		isCoreActionIdentity,
		NARRATE_ACTION,
		NARRATE_CHARACTER_ACTION,
		parseActionIdentity
	} from "$lib/shared/actions/identity"
	import { paletteRowState } from "$lib/client/components/sessionMessages/slashPalette"
	import { VERB_REASONS } from "$lib/client/components/sessionMessages/messageVerbState"
	import { SurfaceManager } from "$lib/client/surfaces/panelManager.svelte"
	import type { LayoutBlob } from "$lib/client/surfaces/types"

	let session: Sockets.Sessions.Get.Response["session"] | undefined = $state()
	let pagination: Sockets.Sessions.Get.Response["pagination"] | undefined =
		$state()
	let newMessage = $state("")
	const socket = useTypedSocket()
	let showDeleteMessageModal = $state(false)
	let deleteSessionMessage: SelectSessionMessage | undefined = $state()
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
	// is open and whether it already has a lorebook, without a fetch of their own,
	// and carries the session's identity — name, cast, genre — to the header,
	// which renders beside this page rather than inside it.
	$effect(() => {
		openSessionCtx.sessionId = session?.id ?? null
		openSessionCtx.sessionName = session?.name ?? null
		openSessionCtx.cast = headerCast
		openSessionCtx.genreName = genreName
		openSessionCtx.lorebookId = session?.lorebookId ?? null
		openSessionCtx.lorebookBranchId = session?.lorebookBranchId ?? null
		openSessionCtx.isOwner =
			!!session && session.userId === userCtx.user?.id
	})

	// The star is the switch: embeddings are on when something is registered
	// for `text->embedding`.
	let vectorizationEnabled = $derived(
		embeddingsStarred(systemSettingsCtx.capabilityDefaults)
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
	/**
	 * The message whose report is open, and the report itself.
	 *
	 * Separate from `draftCompiledPrompt` because that is *live*: the composer
	 * recompiles it on a debounce while somebody types, and the footer's own
	 * token readout reads it. Opening a message's report used to overwrite it,
	 * which silently replaced the draft's numbers with a finished reply's and
	 * left them there until the next keystroke recompiled — a report about one
	 * thing shown as the state of another.
	 */
	let messageReport:
		| {
				messageId: number
				meta: any
				prompt?: string
				messages?: any[]
		  }
		| undefined = $state()
	/** Whichever of the two the modal is currently reporting on. */
	let promptDetails = $derived(
		messageReport
			? {
					prompt: messageReport.prompt,
					messages: messageReport.messages,
					meta: messageReport.meta
				}
			: draftCompiledPrompt
	)
	/** The modal's own budget verdict — `contextExceeded` is the composer's. */
	let detailsExceeded = $derived(
		promptDetails?.meta
			? promptDetails.meta.tokenCounts.total >
					promptDetails.meta.tokenCounts.limit
			: false
	)
	let showDraftCompiledPromptModal = $state(false)
	let showTriggerCharacterMessageModal = $state(false)
	let triggerCharacterSearch = $state("")
	let showTriggerNarratorResponseModal = $state(false)
	/**
	 * The dropdown half of the trigger's first step (ruling 2026-09-07): this
	 * person's characters, minus the cast. Fetched when the modal opens rather
	 * than on every session load — it is a list nobody sees until they ask.
	 */
	let sideCharacterOptions: {
		id: number
		name: string
		nickname: string | null
	}[] = $state([])
	let showAddPersonaModal = $state(false)
	let showBranchSessionModal = $state(false)
	let branchFromMessage: SelectSessionMessage | undefined = $state()

	// Summarization mode
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

	// The action list (R-15, U5c): what this session offers this person, per
	// venue, from rows. The narrate button's *presence* comes from here —
	// retiring the narrate spec removes it with no UI code involved. Its
	// presentation stays bespoke (the resolved narrator name), which is a
	// client mapping on the function key, not a hardcoded button. Core's
	// message verbs ride the same list, so the message menu and the quick
	// row hand-write no verb button either.
	let actionVenues = $state<Sockets.Sessions.Actions.Response["venues"]>({})
	const venueOf = (kind: string) =>
		actionVenues[kind] ?? { primary: [], overflow: [] }
	/**
	 * The composer venue's primary set — the chips. A genre that contributes
	 * none gets no row at all, which is what keeps the composer of a genre
	 * with nothing to press exactly as wide as its message field.
	 */
	let sessionActions = $derived(venueOf("composer").primary)
	/** …and its overflow: every enabled action the chips leave out (F38). */
	let composerOverflow = $derived(venueOf("composer").overflow)
	/** The More menu's list — primary then overflow, every enabled action, quick or not (NOMENCLATURE overflow). */
	let composerMenuActions = $derived([...sessionActions, ...composerOverflow])
	/** The message venue, handed to every row. */
	let messageActions = $derived(venueOf("message"))
	/** The extra tab's — Continue and Regenerate, when the genre offers them. */
	let extraActions = $derived([
		...venueOf("extra").primary,
		...venueOf("extra").overflow
	])
	/**
	 * What `/` offers (R-15 slash names): the composer's own venues — the
	 * chips row and the extra tab — one entry per action, whether it sits in
	 * the primary set or the overflow.
	 */
	let paletteActions = $derived(
		[...sessionActions, ...composerOverflow, ...extraActions].map((a) => ({
			key: a.key,
			specSlug: a.specSlug,
			name: a.name,
			slash: a.slash,
			icon: a.icon,
			audience: a.audience,
			canAct: a.canAct,
			isNew: a.isNew,
			venue: a.venue,
			// The enabled-when verdict (U5e), its reason resolved here once
			// for the chips, the More menu and the palette alike; the
			// `item.*` half rides for the palette to judge against the
			// newest row (`newestItem`).
			enabled: a.enabled,
			...(a.reason
				? { reason: statusText(a.reason) || a.reason.i18n.en }
				: {}),
			...(a.itemPredicates?.length
				? { itemPredicates: a.itemPredicates }
				: {})
		}))
	)
	/**
	 * What a composer press of a message action acts on — the newest row's
	 * `item` document, the same shape the message row and the server's door
	 * build — or `null` for a session with no row, which fails every `item.*`
	 * predicate: nothing to regenerate, continue or swipe.
	 */
	let newestItem = $derived.by(() => {
		// `lastMessage` and `canControlMessage` are declared further down;
		// a derived body runs after the script has, so the closure is fine.
		const newest = lastMessage
		if (!newest) return null
		return itemValuesOf(newest, {
			isNewest: true,
			mine: canControlMessage(newest)
		})
	})

	/**
	 * The verdict a chip reads off its listed action: the audience and the
	 * enabled-when (U5e), the reason resolved to a sentence — the same
	 * `paletteRowState` the palette and the More menu read.
	 */
	const chipVerdict = (a: Sockets.Sessions.Actions.Action) => ({
		name: a.name,
		audience: a.audience,
		canAct: a.canAct,
		enabled: a.enabled,
		venue: a.venue,
		...(a.reason
			? { reason: statusText(a.reason) || a.reason.i18n.en }
			: {}),
		...(a.itemPredicates?.length
			? { itemPredicates: a.itemPredicates }
			: {})
	})
	/**
	 * The turn controls' chips — Regenerate, Continue — are core's `retry`
	 * and `continue` at the **extra** venue, and they act on the newest
	 * row: their state is the listed verdict plus the `item.*` predicates
	 * judged against `newestItem`, exactly as the `/` palette judges the
	 * same rows (review pass 3). The bespoke handlers stay the click
	 * targets; only the grey decision is the list's.
	 */
	const extraAction = (key: string) =>
		extraActions.find((a) => a.specSlug === "core" && a.key === key)
	const extraChip = (
		t: Sockets.Sessions.Actions.Action,
		busy: [holds: boolean, reason: string][] = []
	) => {
		for (const [holds, reason] of busy)
			if (holds) return { disabled: true, reason }
		return paletteRowState(chipVerdict(t), {
			generating: !session || !!lastMessage?.isGenerating,
			newest: newestItem
		})
	}
	/** A persona-less session cannot take a turn — the one client-side condition the turn controls keep. */
	const NO_PERSONA = "add a persona first"
	const needsPersona = $derived.by(
		() =>
			!session ||
			(personasInMode && !session.sessionPersonas?.[0]?.personaId)
	)

	/**
	 * The enabled-when verdict is a snapshot of the session's published
	 * values (U5e). The SERVER re-sends the list when a run ends — every road
	 * pushes `sessions:actions` after `runRegistry.finish` (review C1) — so
	 * nothing here relists off progress frames or the generating flag. The
	 * one client-side ask is a state write landing (`state:changed`, scoped
	 * to this session): a person setting a slot by hand starts no run, and
	 * *Set a location first* should lift the moment they set it.
	 */
	function relistActions() {
		if (!Number.isFinite(sessionId)) return
		socket.emit("sessions:actions", { sessionId })
	}
	$effect(() => {
		if (!Number.isFinite(sessionId)) return
		return declareInterest<"state:changed">(
			interestKey("state:changed", sessionId),
			relistActions
		)
	})

	// The session's frame surfaces (20 §12): a mode-declared session-view
	// replaces core's log wholesale (the total-conversion lane); panels are
	// every enabled plugin's declared side frames. Presence is data — a
	// disabled plugin takes its frames with it, and a missing view-plugin
	// falls back to core's log with no error.
	let sessionFrames = $state<Sockets.Sessions.View.Response | null>(null)
	const sessionViewFrame = $derived(sessionFrames?.sessionView ?? null)
	/**
	 * Why Continue is unavailable on this session's messages, when it is.
	 *
	 * Off `sessions:view`, which the page already fetches once when a session
	 * opens and which already reads the genre — half the answer (`messageVerbs`)
	 * was there anyway, and the other half is the connection the replies resolve
	 * to. Session-level, so the button is disabled with the same sentence on
	 * every message rather than asking per row.
	 *
	 * ⚠ An affordance, not the enforcement. `sessionMessagesContinueHandler`
	 * refuses with this same sentence from the same resolution, so a stale value
	 * (an admin repointing the instance default while this page is open) costs a
	 * refusal message and never a wrong generation.
	 */
	const continueRefusal = $derived(sessionFrames?.continueRefusal)
	/**
	 * Which forbiddable message verbs this session's genre offers (R-15) —
	 * off the action list's message venue (U5c), the ONE list every verb
	 * control renders from: a forbidden opt-in built-in (`delete`, `hide`,
	 * `swipe`) or a forbidden `retry` is simply not listed, and the floors
	 * always are. Until the list has arrived, `sessions:view`'s
	 * `messageVerbs` answers, so the controls do not flash off and on while
	 * the page loads. An affordance, like `continueRefusal`: the handler
	 * refuses the verb regardless.
	 */
	const messageVerbs = $derived(sessionFrames?.messageVerbs)
	const offersVerb = (verb: "retry" | "swipe") => {
		const listed = [...messageActions.primary, ...messageActions.overflow]
		if (listed.length)
			return listed.some((a) => a.specSlug === "core" && a.key === verb)
		return messageVerbs?.[verb] !== false
	}
	/**
	 * What this session may write beyond messages (R-B) — off `sessions:view`,
	 * resolved from the same declaration the write sites refuse with.
	 *
	 * An affordance, like `messageVerbs`: an absent answer (an older server, or
	 * the view not back yet) reads as on, and the summarize handler, the scene
	 * create handler and the lore-entry outlet each refuse independently. So a
	 * stale value costs a refusal message, never a write the genre forbade.
	 */
	const writes = $derived(sessionFrames?.writes)
	const offersWrite = (write: "lore" | "scenes") => writes?.[write] !== false

	/**
	 * The session's channels (20 §7; R-C) — off `sessions:view`, `main` first,
	 * and `[main]` for every session whose genre declares none.
	 */
	const sessionChannels = $derived(
		sessionFrames?.channels ?? [DEFAULT_CHANNEL]
	)
	/**
	 * Which of them the composer is writing on, and the log is showing.
	 *
	 * Held here rather than in the composer because BOTH halves answer to it:
	 * the send carries it to the server, where the row is stored on it and the
	 * reply is asked for on it, and the log hides what is not on it. One
	 * answer, in the one place that can hand it to both.
	 */
	let composerChannel = $state(DEFAULT_CHANNEL)
	$effect(() => {
		// A session whose genre no longer has the chosen channel — a preset
		// changed under an open page, or the view arrived after a guess —
		// falls back to `main`, which every session has.
		if (!sessionChannels.includes(composerChannel))
			composerChannel = DEFAULT_CHANNEL
	})

	// ── Surface grid (plan 21) ──────────────────────────────────────
	// The modular session layout: the conversation is the primary panel, and
	// scene portraits / sample widgets flow into container-responsive tracks
	// beside it. Availability = the mode's declared panels (from sessions:view)
	// merged with core's defaults below; placement is this user's, persisted.
	const surfaceManager = new SurfaceManager()
	const handleRecordedEvent = (push: Sockets.Sessions.RecordedEvent.Push) =>
		surfaceManager.announceRecordedEvent(push)

	/**
	 * What this viewer may see of the session annex (R57): the server's
	 * merged view, never the annex. Given to every widget on the page — native
	 * ones read it as `annex.v1`, frames are posted it — through one context,
	 * so no layout has to thread it.
	 */
	/**
	 * "Inspect run" for the message controls (R55; `runInspection.ts`): the
	 * page asks which run wrote a reply and opens the inspector, so the
	 * controls import neither the socket nor the store (C0).
	 */
	const runOfMessage = (messageId: number): Promise<string | null> =>
			new Promise((resolve) => {
				let done = false
				const finish = (runId: string | null) => {
					if (done) return
					done = true
					release()
					clearTimeout(timer)
					resolve(runId)
				}
				// BARE: `pipelines:artifactRuns` is not a scoped event; the
				// kind/entity check is the filter.
				const release = declareInterest<"pipelines:artifactRuns">(
					"pipelines:artifactRuns",
					(res) => {
						if (res.kind !== "message" || res.entityId !== messageId) return
						finish(runThatWrote(res.runs))
					}
				)
				const timer = setTimeout(() => finish(null), 15_000)
				socket.emit("pipelines:artifactRuns", { kind: "message", entityId: messageId })
			})
	setRunInspection({ runOf: runOfMessage, openRun: (runId) => runInspector.open(runId) })

	/**
	 * Who is looking (`viewer.v1`, C0b) — so a widget asks "may I" of the
	 * host's answer instead of comparing user ids itself.
	 */
	setContext(SESSION_VIEWER_KEY, {
		get current(): ViewerV1 {
			return {
				userId: userCtx.user?.id ?? null,
				isAdmin: !!userCtx.user?.isAdmin,
				isGuest
			}
		}
	})

	/** The session's turn order (`turnOrder.v1`, C5), for every widget on the page. */
	setContext(SESSION_TURN_ORDER_KEY, {
		get current(): TurnOrderV1 {
			return turnOrderDoc
		}
	})

	/** Resolves once an older page has landed (or nothing more is coming). */
	async function olderPage(): Promise<{ rows: MessageV1[]; nextCursor?: string }> {
		if (!session || !pagination?.hasMore) return { rows: [] }
		const before = new Set(session.sessionMessages.map((m) => m.id))
		await loadOlderMessages()
		for (let waited = 0; loadingOlderMessages && waited < 15_000; waited += 100)
			await new Promise((r) => setTimeout(r, 100))
		const rows = (session?.sessionMessages ?? []).filter((m) => !before.has(m.id))
		const oldest = session?.sessionMessages.length
			? Math.min(...session.sessionMessages.map((m) => m.id))
			: undefined
		return {
			rows: rows as unknown as MessageV1[],
			nextCursor: pagination?.hasMore && oldest != null ? String(oldest) : undefined
		}
	}

	/**
	 * What a widget may ask this page for (C0b) — one handler for a native
	 * widget, a frame and a remote. Each kind opens something of the page's
	 * own; the widget sees only that it was done (or why not).
	 */
	const answerWidgetRequest: WidgetRequestHandler = async (kind, params, from) => {
		const p = params as Record<string, unknown>
		switch (kind) {
			case "messages":
				return (await olderPage()) as never
			case "open-character": {
				const id = Number(p.characterId)
				if (!Number.isFinite(id)) throw new Error("open-character needs a characterId")
				panelsCtx.openPanel({ key: "characters", toggle: false })
				panelsCtx.digest.viewCharacterId = id
				return undefined as never
			}
			case "view-avatar": {
				const who = characterForRef(String(p.ref ?? ""))
				if (!who) throw new Error(`no participant '${String(p.ref)}' in this session`)
				handleAvatarClick(who)
				return undefined as never
			}
			case "view-image": {
				// Core's messages show images from anywhere, as they always
				// have; a plugin's widget only the app's own (R69) — the page
				// fetching an address a widget chose is a way out for what it
				// was shown.
				const src = String(p.src ?? "")
				const ok =
					from.owner === "core"
						? /^(https?:|\/|data:image\/)/.test(src)
						: !hostAttributeValueFinding("img", "src", src)
				if (!ok) throw new Error("view-image shows the app's own images only")
				handleImageClick(src)
				return undefined as never
			}
			case "open-lore": {
				panelsCtx.digest.lore = {
					lorebookId: typeof p.lorebookId === "number" ? p.lorebookId : undefined,
					scope: p.scope === "scenes" ? "scenes" : "history",
					entryId: typeof p.entryId === "number" ? p.entryId : undefined,
					sceneId: typeof p.sceneId === "number" ? p.sceneId : undefined
				} as any
				panelsCtx.openPanel({ key: "lorebooks", toggle: false })
				return undefined as never
			}
			case "prompt-details": {
				if (!userCtx.user?.isAdmin || !systemSettingsCtx.settings?.contextDebuggingEnabled)
					throw new Error("prompt details are for admins, with context debugging on")
				const msg = session?.sessionMessages.find((m) => m.id === Number(p.messageId))
				const meta = (msg as any)?.debugMeta
				if (!msg || !meta) throw new Error("that message has no recorded prompt")
				messageReport = { messageId: msg.id, prompt: meta?.prompt, messages: meta?.messages, meta }
				showDraftCompiledPromptModal = true
				return undefined as never
			}
			case "inspect-run": {
				if (!userCtx.user?.isAdmin) throw new Error("runs are for admins")
				const runId = await runOfMessage(Number(p.messageId))
				if (!runId) throw new Error("no run is recorded as writing that message")
				runInspector.open(runId)
				return undefined as never
			}
			case "pick-turn":
				showTurnPicker = true
				return undefined as never
			case "actions-seen":
				// Core's own lists: a plugin's widget does not clear the marks on
				// other packages' actions.
				if (from.owner !== "core") throw new Error("only core's widgets mark actions seen")
				markActionsSeen((p.keys as string[] | undefined) ?? [])
				return undefined as never
			case "summarize": {
				if (from.owner !== "core") throw new Error("only core's conversation summarizes a selection")
				const ids = ((p.messageIds as number[] | undefined) ?? []).filter(
					(id) => !scenedMessageIds.has(id)
				)
				if (!ids.length) throw new Error("select at least one message")
				const kind = p.kind === "scene" || p.kind === "character" ? p.kind : "world"
				if (kind === "scene" && !offersWrite("scenes"))
					throw new Error("this session does not open scenes")
				selectedMessageIds = new Set(ids)
				openSummarizeModal(kind)
				// The gap check refused it (and said so): the widget keeps its selection.
				if (!showSummarizeModal) throw new Error("the selection has a gap")
				return undefined as never
			}
			case "send": {
				// Core's own composer only: a plugin's widget writes through its
				// own actions, never as the viewer's line.
				if (from.owner !== "core") throw new Error("only core's composer sends a line")
				newMessage = String(p.content ?? "")
				if (typeof p.channel === "string" && sessionChannels.includes(p.channel))
					composerChannel = p.channel
				if (typeof p.personaId === "number") switchPersona(p.personaId)
				// Refused (said with a toast): the composer keeps its draft.
				if (!handleSend()) throw new Error("the line was not sent")
				return undefined as never
			}
			case "draft":
				if (from.owner !== "core") throw new Error("only core's composer keeps a draft")
				newMessage = String(p.content ?? "")
				return undefined as never
			case "switch-persona":
				if (from.owner !== "core") throw new Error("only core's composer switches persona")
				switchPersona(Number(p.personaId))
				return undefined as never
			case "fire-turn":
				if (from.owner !== "core") throw new Error("only core's conversation fires a turn")
				handleContinueWithNextCharacter()
				return undefined as never
			case "decide-proposal":
				if (from.owner !== "core") throw new Error("only core's conversation decides a proposal")
				stateStore.decide(Number(p.proposalId), !!p.accept)
				return undefined as never
			case "add-persona":
				if (from.owner !== "core") throw new Error("only core's composer adds a persona")
				showAddPersonaModal = true
				return undefined as never
			case "change-sprite": {
				// The controls' own rule (a settled character line the viewer may
				// control), held here too: a request is not a grant.
				const msg = session?.sessionMessages.find((m) => m.id === Number(p.messageId))
				if (!msg?.characterId || msg.isNarratorResponse || msg.isGenerating || !canControlMessage(msg))
					throw new Error("that line's sprite is not yours to change")
				spriteLine = msg
				return undefined as never
			}
		}
		throw new Error(`'${String(kind)}' is not something this page answers`)
	}
	setContext(WIDGET_REQUESTS_KEY, answerWidgetRequest)

	// The viewer's language, off `sessions:view` — every widget's `locale.v1`.
	setContext("sessionLocale", {
		get current() {
			return sessionFrames?.language ?? "en"
		}
	})

	let annexView = $state<Record<string, Record<string, unknown>>>({})
	setContext("sessionAnnex", {
		get current() {
			return annexView
		}
	})
	const handleAnnex = (res: Sockets.Sessions.Annex.Response) => {
		if (res.sessionId !== sessionId) return
		const next = res.annex ?? {}
		// The same view again re-posts nothing to a frame and rebuilds no
		// widget context.
		if (JSON.stringify(next) === JSON.stringify(annexView)) return
		annexView = next
	}
	let panelViewLoaded = $state(false)
	let panelLayoutLoaded = $state(false)
	let panelLayoutBlob = $state<LayoutBlob>({})
	// The preset layer (PLAN 25 redesign). `layoutPresetBase` is the ALREADY
	// composed read-only floor (active preset + this user's widget settings);
	// it is handed to the manager as a base it never serialises, so the user's
	// own blob above still wins slot by slot and an existing arrangement is
	// untouched. `{}` composes to `undefined` — i.e. no base at all.
	let layoutPresets = $state<Sockets.Sessions.LayoutPreset[]>([])
	let layoutPresetId = $state<number | null>(null)
	let layoutPresetBase = $state<Record<string, unknown> | undefined>(
		undefined
	)
	// The answer to "how many sessions are on this preset?", held for exactly
	// one pending delete confirmation. `null` = nothing asked, or still asking.
	let layoutPresetUsage = $state<{ id: number; sessions: number } | null>(
		null
	)
	let layoutSettings = $state<Record<string, unknown>>({})
	let widgetSettings = $state<Record<string, Record<string, unknown>>>({})

	// PLAN 25: the per-widget style pins ride `layoutSettings.widgetStyles`.
	// They are pushed into the widget-style store rather than threaded as
	// props because the thing that needs them — WidgetHost — is mounted deep
	// inside Panel, several layers below anything this page hands down.
	$effect(() => {
		setWidgetStylePins(layoutSettings?.widgetStyles)
	})

	/**
	 * Per-instance widget settings (PLAN 25), pushed to the same store lane and
	 * for the same reason: the settings overlay is inside a `WidgetHost`. They
	 * ride their OWN key on the layout round trip rather than `layoutSettings`,
	 * so the writer here needs nothing but the current blob.
	 *
	 * The active preset's own `widgetSettings` are the floor under them: a
	 * layout that docks a widget usually has an opinion about how that widget is
	 * configured, and a preset whose settings nothing read would be half a
	 * layout. See `presetWidgetSettings` for the merge rule.
	 */
	$effect(() => {
		setWidgetSettingBase(layoutPresetBase)
	})
	$effect(() => {
		setWidgetSettingValues(widgetSettings)
	})
	$effect(() => {
		const id = sessionId
		if (id == null) return
		setWidgetSettingsWriter((next) => {
			widgetSettings = next
			socket.emit("sessions:panelLayout:set", {
				sessionId: id,
				layout: surfaceManager.toBlob() as Record<string, unknown>,
				widgetSettings: next
			})
		})
		return () => setWidgetSettingsWriter(null)
	})

	/**
	 * Persist a replacement `layoutSettings` blob (the Settings tab's style
	 * pins today). Sent with `layout` because the server requires it, and WITH
	 * the `layoutSettings` key present — key presence is what tells it to write
	 * that column at all, so an absent key here would silently drop the write.
	 *
	 * `layoutPresetBase` is deliberately NOT recomputed: it composes the preset
	 * with these settings for the SURFACE MANAGER's slots, and `widgetStyles`
	 * is not one of them — merging it in would change nothing and re-seeding
	 * the manager mid-session would.
	 */
	function persistLayoutSettings(next: Record<string, unknown>) {
		if (sessionId == null) return
		layoutSettings = next
		socket.emit("sessions:panelLayout:set", {
			sessionId,
			layout: surfaceManager.toBlob() as Record<string, unknown>,
			layoutSettings: next
		})
	}

	/**
	 * Core's default panels for the standard chat — the scene portraits (moved
	 * out of the fixed viewport overlays) plus two temporary sample artifacts
	 * (plan 21) that exercise the framework. A custom mode's own panels arrive
	 * via `sessions:view.modePanels` and are merged on top (mode wins by id).
	 */
	/**
	 * A core widget's declared settings, by id.
	 *
	 * The panel and the widget are one declaration in two places: core
	 * announces the settings (`CORE_WIDGETS`), and a panel entry has to carry
	 * them for the settings card to draw a control. Read rather than retyped,
	 * so a field added to the announcement reaches the panel with it.
	 *
	 * CORE's only, and only for the defaults below. A genre's widgets and a
	 * plugin's arrive on `sessions:view.modePanels` with their schema already
	 * on them; `SurfaceManager.toInstance` copies it onto the instance and
	 * `widgetDeclOf` prefers the instance over `CORE_WIDGETS`, so a declaration
	 * core has never heard of resolves its values on the same path.
	 */
	const declaredSettings = (id: string) =>
		CORE_WIDGETS.find((w) => w.id === id)?.settings as
			| Record<string, unknown>
			| undefined

	const CORE_DEFAULT_PANELS: Sockets.Sessions.View.ModePanel[] = [
		{
			id: "scene-portraits",
			title: "Scene Portraits",
			icon: "Users",
			role: "secondary",
			surface: { kind: "native", component: "scene-portraits" },
			layout: { span: { ideal: 1 }, minInline: 200 },
			settings: declaredSettings("scene-portraits"),
			defaultActive: true
		},
		/* Stats, inventory and world state (docs/stats-and-states.md). Offered,
		   never on: a genre that declares no slots would otherwise seat three
		   empty panels in every chat session, and a newcomer must never see a
		   bar. A genre that wants them docked ships a layout preset. */
		{
			id: "stats",
			title: "Stats",
			icon: "HeartPulse",
			role: "secondary",
			surface: { kind: "native", component: "stats" },
			layout: { span: { ideal: 1 }, minInline: 220 },
			settings: declaredSettings("stats"),
			defaultActive: false
		},
		{
			id: "inventory",
			title: "Inventory",
			icon: "Backpack",
			role: "secondary",
			surface: { kind: "native", component: "inventory" },
			layout: { span: { ideal: 1 }, minInline: 220 },
			settings: declaredSettings("inventory"),
			defaultActive: false
		},
		{
			id: "world-state",
			title: "World State",
			icon: "CloudSun",
			role: "secondary",
			surface: { kind: "native", component: "world-state" },
			layout: { span: { ideal: 2 }, minInline: 240, minBlock: 60 },
			settings: declaredSettings("world-state"),
			defaultActive: false
		},
		/* The session's lore entries with their retrieval facts (L1). Offered,
		   never on: a session with no lorebook would seat an empty panel. */
		{
			id: "lore-entries",
			title: "Lore entries",
			icon: "BookOpen",
			role: "secondary",
			surface: { kind: "native", component: "lore-entries" },
			layout: { span: { ideal: 1 }, minInline: 260 },
			settings: declaredSettings("lore-entries"),
			defaultActive: false
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
		// Deliberately blob-only: omitting the preset keys is what tells the
		// server to leave the user's preset choice and widget settings alone.
		socket.emit("sessions:panelLayout:set", {
			sessionId,
			layout: blob as Record<string, unknown>
		})
	}

	/**
	 * Apply a layout preset: point at it, and drop this user's own arrangement
	 * so the preset shows through. The arrangement is CLEARED rather than
	 * overwritten with a copy — that keeps the row a reference, so a later edit
	 * to the preset still reaches them.
	 */
	function applyLayoutPreset(presetId: number | null) {
		if (sessionId == null) return
		const chosen = layoutPresets.find((p) => p.id === presetId)
		layoutPresetId = presetId
		layoutPresetBase = presetBase(chosen?.layout ?? {}, layoutSettings)
		surfaceManager.setBaseLayout(layoutPresetBase)
		surfaceManager.clearArrangement()
		socket.emit("sessions:panelLayout:set", {
			sessionId,
			layout: surfaceManager.toBlob() as Record<string, unknown>,
			layoutPresetId: presetId
		})
	}

	/**
	 * Save the current arrangement as a new user-authored preset.
	 *
	 * The EFFECTIVE layout, not this user's delta: someone who applied a preset
	 * and nudged one thing expects "save" to capture what they can see, not the
	 * one slot they happened to touch. Slots nobody has set stay absent, so a
	 * preset saved from an untouched session is `{}` — the shipped default,
	 * which is exactly what it looked like.
	 */
	function saveLayoutPreset(name: string) {
		if (sessionId == null) return
		const slot = (k: string, v: unknown) =>
			v !== undefined ? { [k]: v } : {}
		socket.emit("sessions:layoutPreset:save", {
			sessionId,
			name,
			layout: {
				...slot("zoneLayout", surfaceManager.effectiveZoneLayout),
				...slot("widgetGrid", surfaceManager.effectiveWidgetGrid),
				...slot("arrangedGrid", surfaceManager.effectiveArrangedGrid)
			} as Record<string, unknown>
		})
	}

	/** (Re)seed the manager once both the panel set and the saved layout land. */
	function initSurfaceManagerIfReady() {
		if (!panelViewLoaded || !panelLayoutLoaded) return
		const byId = new Map<string, Sockets.Sessions.View.ModePanel>()
		// What the genre withholds (R71) is not offered — core's included.
		const omit = new Set(sessionFrames?.omitWidgets ?? [])
		for (const p of CORE_DEFAULT_PANELS) if (!omit.has(p.id)) byId.set(p.id, p)
		for (const p of sessionFrames?.modePanels ?? []) byId.set(p.id, p) // mode wins
		surfaceManager.init(
			sessionId,
			[...byId.values()],
			panelLayoutBlob,
			persistPanelLayout,
			layoutPresetBase,
			omit
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
		layoutPresets = res.presets ?? []
		layoutPresetId = res.layoutPresetId ?? null
		layoutSettings = res.layoutSettings ?? {}
		widgetSettings = res.widgetSettings ?? {}
		layoutPresetBase = presetBase(res.presetLayout, layoutSettings)
		panelLayoutLoaded = true
		initSurfaceManagerIfReady()
	}

	function handleLayoutPresetSave(
		res: Sockets.Sessions.PanelLayout.Save.Response
	) {
		if (res.sessionId !== sessionId) return
		layoutPresets = res.presets ?? layoutPresets
	}

	/**
	 * Managing the presets this user saved (PLAN 25 redesign).
	 *
	 * These three are GENRE-scoped, not session-scoped: a preset belongs to a
	 * genre and an author, not to the session you happened to be looking at
	 * when you saved it. So the refreshed list is adopted only when the reply
	 * names THIS session's genre — and a refusal names no genre at all (it must
	 * not say where an id it declined to touch lives), which the same check
	 * correctly declines to adopt.
	 *
	 * A refusal arrives on the main channel with `ok: false` and the server's
	 * own sentence; it is toasted verbatim rather than re-worded here, because
	 * the server is the only thing that knows which of "built-in", "not yours"
	 * or "already gone" happened.
	 */
	function sessionGenreId(): string | undefined {
		const g = (session as any)?.genreId
		return typeof g === "string" ? g : undefined
	}

	function handleLayoutPresetRename(
		res: Sockets.Sessions.PanelLayout.Rename.Response
	) {
		if (!res.ok) {
			toaster.error({
				title: res.error ?? "Could not rename that layout"
			})
			return
		}
		if (res.genreId !== sessionGenreId()) return
		layoutPresets = res.presets ?? layoutPresets
	}

	function handleLayoutPresetDelete(
		res: Sockets.Sessions.PanelLayout.Delete.Response
	) {
		layoutPresetUsage = null
		if (!res.ok) {
			toaster.error({
				title: res.error ?? "Could not delete that layout"
			})
			return
		}
		if (res.genreId !== sessionGenreId()) return
		layoutPresets = res.presets ?? layoutPresets
		if (res.id === layoutPresetId) {
			// `layout_preset_id` is ON DELETE SET NULL, so the pin is already
			// gone server-side — mirror it here so the open page stops standing
			// on a floor that no longer exists. Only the base moves: this user's
			// own arrangement blob is untouched, exactly as a reload would leave
			// it. The genre default's layout is `{}`, which is what the server
			// would resolve this session to next time it asks.
			layoutPresetId = null
			layoutPresetBase = presetBase({}, layoutSettings)
			surfaceManager.setBaseLayout(layoutPresetBase)
		}
	}

	function handleLayoutPresetUsage(
		res: Sockets.Sessions.PanelLayout.Usage.Response
	) {
		if (!res.ok) {
			layoutPresetUsage = null
			toaster.error({ title: res.error ?? "Could not read that layout" })
			return
		}
		layoutPresetUsage = { id: res.id, sessions: res.sessions }
	}

	function renameLayoutPreset(presetId: number, name: string) {
		socket.emit("sessions:layoutPreset:rename", { id: presetId, name })
	}
	function deleteLayoutPreset(presetId: number) {
		socket.emit("sessions:layoutPreset:delete", { id: presetId })
	}
	function askLayoutPresetUsage(presetId: number) {
		// Cleared first so the confirmation cannot show a stale count for the
		// preset it asked about last time while this answer is in flight.
		layoutPresetUsage = null
		socket.emit("sessions:layoutPreset:usage", { id: presetId })
	}

	/** Explicit surface intents (21 §9): a node/action opened or closed panels. */
	function handleSurfaceIntent(res: Sockets.Sessions.SurfaceIntent.Push) {
		if (res.sessionId !== sessionId) return
		for (const id of res.open ?? []) surfaceManager.applyOpenIntent(id)
		for (const id of res.close ?? []) surfaceManager.applyCloseIntent(id)
	}
	/**
	 * Frame and widget actions ride the same audited path as every
	 * contributed button — with the pressed declaration's identity when the
	 * caller named one (`invoke`; W1), and the block a form's press answers
	 * when it answers one (U5d).
	 *
	 * One of core's verbs named that way is routed to its real handler here
	 * too (W4). The hosts between this page and a mount now carry the whole
	 * `actionDispatch` down, so a widget's `invoke('continue')` is resolved at
	 * the mount and never reaches this function; a frame or widget that still
	 * arrives here naming `core#continue` (a bare `{ t: "action" }`, or a host
	 * wired without the dispatch) must not be sent to
	 * `sessions:triggerFunction`, which refuses it by name.
	 *
	 * Everything else goes to `fireTrigger` — the offered-action wrapper — or,
	 * when the press answers a form, straight to `emitTrigger` beneath it. A
	 * press arriving from a frame or a widget is the same press as the chip or
	 * the form button beside it, so it is named as a run on the same terms; an
	 * emit of its own here would be a second, lesser fire for whoever pressed
	 * from the wrong place.
	 */
	function handleFrameAction(
		fn: string,
		messageId?: number,
		payload?: Record<string, unknown>,
		action?: string,
		blockId?: string
	) {
		const parsed = action ? parseActionIdentity(action) : null
		if (action && parsed && isCoreActionIdentity(action)) {
			dispatchAction(
				{ specSlug: parsed.specSlug, key: parsed.key },
				actionDispatch,
				{ messageId, payload, ...(blockId ? { blockId } : {}) }
			)
			return
		}
		// A press naming a block answers a form already on the row, so it goes
		// straight to the emit — the same route `fireBlockAction` takes for the
		// row's own buttons, and for the same reason: no divert, and the
		// block's stamped identity carried verbatim rather than read as a
		// declaration this session offers.
		if (blockId) {
			emitTrigger({ fn, identity: action, messageId, payload, blockId })
			return
		}
		// A press that named no well-formed identity (a bare `{ t: "action" }`)
		// carries its bare key onward, and the server resolves it to the one
		// declaration of that key or refuses it (plans/31 V2).
		fireTrigger(parsed ?? { key: fn }, { messageId, payload })
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
	/**
	 * Whether a send needs a persona. The persona system existing is not
	 * the same as one being required: a genre declaring `personas: { min:
	 * 0 }` — the Guide, where a person asks as themselves — takes bare
	 * prose (19 §1), which the server has always stored. The standard
	 * chat keeps its historical requirement whatever its shape says, on
	 * the same parity footing as the creation form's floor.
	 */
	let personaRequiredOnSend = $derived(
		personasInMode &&
			(!modeShape ||
				(session as any)?.genreId == null ||
				(session as any).genreId === "core:genre/chat" ||
				(modeShape.personas?.min ?? 0) >= 1)
	)
	let charactersInMode = $derived(
		!modeShape ||
			(!!modeShape.characters && (modeShape.characters.max ?? 1) !== 0)
	)
	/**
	 * Whether this session runs what its preset says (ruled 2026-09-10).
	 *
	 * A binding whose pipeline has gone never stops the turn — the genre's
	 * default runs — so the only thing standing between that and silence is
	 * this banner. Sourced from the same verdict the run resolves against, by
	 * way of `sessions:presetStatus`, so the sentence and the substitution
	 * cannot disagree.
	 */
	let presetStatus: Sockets.Sessions.PresetStatus.Response | undefined =
		$state()
	/**
	 * Dismissed for this view only, deliberately.
	 *
	 * Nothing is written down: the condition is still true tomorrow, and a
	 * dismissal that outlived the tab would let a person hide a session
	 * running a pipeline nobody chose. Cleared on every session change below,
	 * because a dismissal is about the banner you just read.
	 */
	let presetBannerDismissed = $state(false)
	let presetStale = $derived(presetStatus?.stale ?? [])

	const handlePresetStatus = (
		res: Sockets.Sessions.PresetStatus.Response
	) => {
		if (res.sessionId !== sessionId) return
		presetStatus = res
	}

	/**
	 * The session's stored turn order (PLAN-turn-order §4.9), as the server
	 * pushes it — on `sessions:view` and whenever it is written. Never
	 * derived here: the order is the strategy's answer, and this page only
	 * shows it.
	 */
	type TurnOrderView = {
		order: Array<{ ref: string | null; [k: string]: unknown }>
		candidates: Array<{
			ref: string
			kind: string
			name: string
			nickname?: string
			ownerUserId?: number
		}>
	}
	let turnOrder = $state<TurnOrderView | null>(null)
	/** The stored document, whole — every widget's `turnOrder.v1` (C5). */
	let turnOrderDoc = $state.raw<TurnOrderV1>(EMPTY_TURN_ORDER)
	let showTurnPicker = $state(false)
	/** The line whose sprite is being changed (`change-sprite`), while the picker is open. */
	let spriteLine = $state<SelectSessionMessage | null>(null)

	// Get session id from route params
	let sessionId: number = $derived.by(() => Number(page.params.id))
	/** The C7 gate: core's conversation mounted as a remote, until the cutover makes it the only path. */
	let remoteConversation = $derived(page.url.searchParams.get("remote") === "1")
	let sessionNotFound = $state(false)

	/**
	 * The streamed reply, for THIS session only.
	 *
	 * `sessionMessage` is a gated event now, so this declaration is what makes
	 * the server broadcast it at all — and it carries the session as its
	 * **interest scope**, so a tab sitting on another session is not sent this
	 * one's chunks (one broadcast per chunk, two roster queries behind each).
	 *
	 * Declared in an effect of its own rather than through `useInterest`,
	 * because that helper reads its key once: navigating from session 41 to 42
	 * changes `sessionId`, and this releases `#41` as it takes `#42`.
	 */
	$effect(() => {
		if (!Number.isFinite(sessionId)) return
		return declareInterest<"sessionMessage">(
			interestKey("sessionMessage", sessionId),
			handleSessionMessage
		)
	})

	/**
	 * Every `sessions:*` reply and push this page reads, declared on the
	 * interest registry — which owns the one listener per event name and
	 * releases this page's subscribers when it is destroyed. That is what the
	 * named `socket.off` calls in the old teardown were doing by hand, minus
	 * the hazard that a bare `off(event)` would have torn down every other
	 * view's listener with them.
	 *
	 * ⚠ BARE keys, deliberately: none of these events has an entry in
	 * `SCOPED_EVENTS`, and a `#<id>` key for an event the shared table does not
	 * scope matches NO payload at all. Each handler's own
	 * `msg.sessionId !== sessionId` check stays the filter. The two events that
	 * ARE scoped — `sessions:get` and `sessions:userTyping` — are declared in
	 * the effect below, keyed on the id so a client-side navigation between
	 * sessions releases the old scope as it takes the new one.
	 *
	 * Declared HERE, ahead of the session-load effect and `onMount` further
	 * down, because effects run in declaration order: the keys are held before
	 * either of them sends its request group (which then flushes the interest
	 * sync itself — plan ruling 3).
	 */
	useInterest<"sessions:presetStatus">(
		"sessions:presetStatus",
		handlePresetStatus
	)
	useInterest<"sessions:promptTokenCount">(
		"sessions:promptTokenCount",
		handleSessionsPromptTokenCount
	)
	useInterest<"sessions:turnOrder">("sessions:turnOrder", handleTurnOrder)
	// A session's sprite-set switch (DESIGN-sprites §2.3): pushed to every member, so faces
	// redraw in the new set before the character's next line records it.
	useInterest<"sessions:spriteSetChanged">(
		"sessions:spriteSetChanged",
		handleSpriteSetChanged
	)
	useInterest<"sessions:setSpriteSet">(
		"sessions:setSpriteSet",
		handleSetSpriteSetReply
	)
	useInterest<"sessions:fireTurn:error">(
		"sessions:fireTurn:error",
		handleFireTurnError
	)
	useInterest<"sessions:fireTurn">("sessions:fireTurn", handleFireTurn)
	useInterest<"sessions:triggerGenerateMessage">(
		"sessions:triggerGenerateMessage",
		handleTriggerGenerateMessage
	)
	useInterest<"sessions:addPersona">(
		"sessions:addPersona",
		handleSessionsAddPersona
	)
	useInterest<"sessions:branch">("sessions:branch", handleSessionsBranch)
	useInterest<"sessions:getNarratorName">(
		"sessions:getNarratorName",
		handleSessionsGetNarratorName
	)
	useInterest<"sessions:sideCharacterOptions">(
		"sessions:sideCharacterOptions",
		handleSessionsSideCharacterOptions
	)
	useInterest<"sessions:view">("sessions:view", handleSessionsView)
	useInterest<"sessions:panelLayout:get">(
		"sessions:panelLayout:get",
		handleSessionsPanelLayoutGet
	)
	useInterest<"sessions:layoutPreset:save">(
		"sessions:layoutPreset:save",
		handleLayoutPresetSave
	)
	useInterest<"sessions:layoutPreset:rename">(
		"sessions:layoutPreset:rename",
		handleLayoutPresetRename
	)
	useInterest<"sessions:layoutPreset:delete">(
		"sessions:layoutPreset:delete",
		handleLayoutPresetDelete
	)
	useInterest<"sessions:layoutPreset:usage">(
		"sessions:layoutPreset:usage",
		handleLayoutPresetUsage
	)
	// No server emitter with a caller today — converted as it stands rather
	// than removed, since the surface-intent push is the declared seam.
	useInterest<"sessions:surfaceIntent">(
		"sessions:surfaceIntent",
		handleSurfaceIntent
	)
	useInterest<"sessions:triggerFunction">(
		"sessions:triggerFunction",
		handleSessionsTriggerFunction
	)
	useInterest<"sessions:genres">("sessions:genres", handleSessionsModesPage)
	// Never gated (plan ruling 2 — errors are not outputs to skip), but the
	// registry is the only listener path, so it is declared like the rest.
	useInterest<"sessions:summarize:error">(
		"sessions:summarize:error",
		handleSessionSummarizeError
	)

	/**
	 * The page-level pushes from four other families, every one BARE — and
	 * each for its own reason, not as a batch:
	 *
	 * · `sessionMessage:error` and `scenes:process:error` are refusals with no
	 *   id on them, never gated (plan ruling 2), and page-level on purpose:
	 *   the modals tear their own listeners down on close, so a run that
	 *   failed while minimized would otherwise report nothing at all.
	 * · `media:changed` IS scoped — on the media row's id — and this page
	 *   wants every one of them: it repaints whichever avatar or scene image
	 *   changed, wherever it changed. A bare key is the request for "all
	 *   scopes", which is exactly right here.
	 * · `sessionMessages:delete` answers with a message ROW and no session
	 *   beside it, so it has no `SCOPED_EVENTS` entry at all;
	 *   `handleSessionMessagesDelete`'s own check against the rows on screen
	 *   stays the filter.
	 */
	useInterest<"sessionMessage:error">(
		"sessionMessage:error",
		handleSessionMessageError
	)
	useInterest<"scenes:process:error">(
		"scenes:process:error",
		handleSceneProcessError
	)
	useInterest<"media:changed">("media:changed", handleMediaChanged)
	useInterest<"sessionMessages:delete">(
		"sessionMessages:delete",
		handleSessionMessagesDelete
	)

	/**
	 * The two scene refusals, BARE for the ordinary reason: neither carries an
	 * id, so neither is in `SCOPED_EVENTS` and a `#<id>` key would match no
	 * payload. Their success halves are scoped, in the effect below.
	 */
	useInterest<"scenes:scenedMessageIds:error">(
		"scenes:scenedMessageIds:error",
		handleScenesScenedMessageIdsError
	)
	useInterest<"scenes:list:error">("scenes:list:error", handleScenesListError)

	/**
	 * The cast event this page reads, BARE.
	 *
	 * `characters:update` is a page-level push with NO id filter of its own:
	 * whichever character changed, this page folds the new row into the
	 * session it is showing if it is in the cast — as a character, as a
	 * persona, or as both, since a persona IS a character. It is also what
	 * `characters:setAvatar` cascades, which is how a new portrait reaches an
	 * open session. A bare key is therefore the point, not an omission — the
	 * event is not in `SCOPED_EVENTS`, so a scoped key would match no payload
	 * at all.
	 */
	useInterest<"characters:update">(
		"characters:update",
		handleCharactersUpdate
	)

	/**
	 * The two SCOPED `sessions:*` interests, keyed on the session in the route.
	 *
	 * An effect rather than `useInterest` for the same reason `sessionMessage`
	 * above is one: the helper reads its key once, and `sessionId` moves when
	 * somebody opens another session without a page load. Releasing inside the
	 * effect ends `#41` as `#42` is taken.
	 *
	 * No BARE `sessions:get` alongside them: the not-found reply carries the
	 * requested id on `sessionId`, so `scopeOfPayload` gives it this very scope
	 * and `handleSessionsGet` sees it on the scoped key. A bare key would have
	 * matched every OTHER session's reply too — which on the server means the
	 * gate passing for every id while this page is open.
	 */
	$effect(() => {
		if (!Number.isFinite(sessionId)) return
		const releases = [
			declareInterest<"sessions:get">(
				interestKey("sessions:get", sessionId),
				handleSessionsGet
			),
			declareInterest<"sessions:userTyping">(
				interestKey("sessions:userTyping", sessionId),
				handleSessionsUserTyping
			),
			// A package's recorded event (R56), to this session's widgets.
			declareInterest<"sessions:recordedEvent">(
				interestKey("sessions:recordedEvent", sessionId),
				handleRecordedEvent
			),
			// The action list, SCOPED (U5e review W-A4): the reply to this
			// page's own request and the push every finished run makes both
			// carry `sessionId`, so a tab on another session hears nothing
			// and the server builds no list for it.
			declareInterest<"sessions:actions">(
				interestKey("sessions:actions", sessionId),
				handleSessionsActions
			),
			// The viewer's annex view (R57): the reply to the ask below and
			// the push every annex write makes, each member their own.
			declareInterest<"sessions:annex">(
				interestKey("sessions:annex", sessionId),
				handleAnnex
			)
		]
		annexView = {}
		socket.emit("sessions:annex", { sessionId })
		return () => {
			for (const release of releases) release()
		}
	})

	/**
	 * The run-progress pushes, SCOPED to this session for the same reason and
	 * in the same shape: every emitter puts `sessionId` on the payload (see
	 * `SCOPED_EVENTS`), so a tab on another session is not sent this one's
	 * ticks — and an image run emits one preview frame per tick.
	 *
	 * `handleRunProgress`'s own id check stays as belt and braces.
	 */
	$effect(() => {
		if (!Number.isFinite(sessionId)) return
		const releases = [
			declareInterest<"pipelines:runStarted">(
				interestKey("pipelines:runStarted", sessionId),
				handleRunStarted
			),
			declareInterest<"pipelines:progress">(
				interestKey("pipelines:progress", sessionId),
				handleRunProgress
			)
		]
		return () => {
			for (const release of releases) release()
		}
	})

	/**
	 * The two scene reads, SCOPED to this session — both replies carry
	 * `sessionId` (see `SCOPED_EVENTS`), so a tab on another session is not
	 * handed this one's scene list. STANDING rather than one-shot: both are
	 * cascade targets, re-sent when a scene is created, processed or deleted,
	 * which is how the scene markers on the transcript stay honest.
	 *
	 * An effect rather than `useInterest` for the same reason the two above
	 * are ones: `sessionId` moves when somebody opens another session without
	 * a page load, and this releases the old scope as it takes the new one.
	 * The requests that fill them first are in `onMount`, which runs after
	 * this — effects run in creation order.
	 */
	$effect(() => {
		if (!Number.isFinite(sessionId)) return
		const releases = [
			declareInterest<"scenes:scenedMessageIds">(
				interestKey("scenes:scenedMessageIds", sessionId),
				handleScenesScenedMessageIds
			),
			declareInterest<"scenes:list">(
				interestKey("scenes:list", sessionId),
				handleScenesList
			)
		]
		return () => {
			for (const release of releases) release()
		}
	})

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
			(offersVerb("retry") &&
				!lastMessage?.metadata?.isGreeting &&
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
		// The head, or — an empty order, a manual strategy waiting to be
		// told — someone to pick.
		const hasNextCharacter =
			!!turnOrder?.order.length || !!turnOrder?.candidates.length

		const shouldShow =
			!triggerInFlight &&
			!hasGeneratingMessage &&
			!hasMessageDraft &&
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

	/**
	 * The cast of the session's book, SCOPED to that book — the reply carries
	 * `lorebookId` (see `SCOPED_EVENTS`), and this page DOES know which book
	 * it wants: `session.lorebookId`, the same id the request below sends. No
	 * bare key alongside it, which would have matched every other book's
	 * reply and kept the server's gate open for all of them.
	 *
	 * STANDING rather than one-shot: the list is a cascade target, re-sent
	 * after a binding is created or absorbed, and the Process Scene modal
	 * renders from it.
	 *
	 * An effect rather than `useInterest` because the key moves — the session
	 * loads after this page does, and its book can be changed while it is
	 * open. Declared above the request so the key is held before it goes out.
	 */
	$effect(() => {
		const lorebookId = session?.lorebookId
		if (!lorebookId) return
		return declareInterest<"lorebooks:bindingList">(
			interestKey("lorebooks:bindingList", lorebookId),
			handleLorebookBindingList
		)
	})

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

	/** A face for a turn ref, from the loaded cast (`character:<id>`). */
	function characterForRef(ref: string | null | undefined): SelectCharacter | undefined {
		const m = /^character:(\d+)$/.exec(ref ?? "")
		if (!m) return undefined
		const id = Number(m[1])
		return (
			session?.sessionCharacters?.find((cc) => cc.characterId === id)?.character ??
			session?.sessionPersonas?.find((cp) => cp.personaId === id)?.persona
		) as SelectCharacter | undefined
	}

	// The head of the order, when it is one of the session's characters.
	let nextCharacter: SelectCharacter | undefined = $derived(
		characterForRef(turnOrder?.order[0]?.ref)
	)

	/**
	 * The session header's cast stack: the session's characters, then the
	 * personas people speak as. Names come from `resolveCharacterName`, the same
	 * helper the message log labels a speaker with, so a face and its lines
	 * carry one name. The header renders under `<main>` as a sibling of this
	 * page, so `openSessionCtx` is what carries the faces up to it.
	 */
	let headerCast: OpenSessionCastMember[] = $derived.by(() => {
		const nextId = shouldShowNextCharacterBlock
			? (nextCharacter?.id ?? null)
			: null
		const characters = (session?.sessionCharacters ?? [])
			.filter((cc) => !!cc.character)
			.map((cc) => ({
				key: `character:${cc.character.id}`,
				name: resolveCharacterName(cc.character, cc.character.name),
				// The CURRENT sprite (DESIGN-sprites §7): the face on this
				// character's newest line, else its avatar. Derived from the
				// loaded messages, never stored.
				avatarSrc:
					spriteSrc(
						cc.character as any,
						currentSpriteIn(
							currentSpriteOf(
								cc.character.id,
								(session?.sessionMessages ?? []) as any[]
							),
							(session as any)?.spriteSetOverrides?.[cc.character.id]
						)
					) ?? null,
				isPersona: false,
				isNext: cc.character.id === nextId
			}))
		const personas = (session?.sessionPersonas ?? [])
			.filter((cp) => !!cp.persona)
			.map((cp) => ({
				key: `persona:${cp.persona.id}`,
				name: resolveCharacterName(cp.persona, cp.persona.name),
				avatarSrc: avatarSrc(cp.persona) ?? null,
				isPersona: true,
				isNext: false
			}))
		return [...characters, ...personas]
	})

	/** What the header calls this session's genre; null while the list loads. */
	let genreName: string | null = $derived(
		modesList.find((m) => m.genreId === ((session as any)?.genreId ?? ""))
			?.name ?? null
	)

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

	// May this person answer a form put to `addressee` (U5d review, W7)? The
	// resolver's rules over the session the client holds
	// (`utils/formAnswer.ts`); an affordance only — the server refuses
	// regardless. Handed down to every message's block view.
	let canAnswerForm = (addressee: string | undefined): boolean =>
		formAnswerVerdict(
			addressee,
			{
				userId: userCtx.user?.id ?? null,
				isOwner: !!session && !isGuest,
				isAdmin: !!userCtx.user?.isAdmin
			},
			session
		)

	// Check if current user can edit/control a specific message — mirrors
	// `canActOnMessage` (`server/messages/permissions.ts`) branch for branch:
	// - Persona messages: only that persona's own owner, never the session
	//   owner (a persona is another participant's own self-representation).
	// - Character messages: the session owner, or whoever owns that character
	//   (so a guest who brought their own character in can control it).
	// - An envoy's line and narration: the session owner's.
	// - A user line with no persona: its author's, by `userId`.
	// - An orphaned row (its character/persona deleted globally, its author
	//   gone — the rows that render as "Unknown"): the session owner's.
	// An affordance only — the server refuses regardless.
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

		// An envoy's line (U5g): no character row behind it, the reference
		// on the row is its identity, and it is the session owner's to act
		// on, as narration is.
		if (messageEnvoySlug(msg)) return !isGuest

		// Narrator response messages aren't owned by any persona/character —
		// only the session owner controls them, mirroring
		// canActOnMessage server-side.
		if (msg.isNarratorResponse) return !isGuest

		// A person's own line with no persona voicing it: the author's —
		// nobody else's, not even the owner's, on a persona line's terms.
		if (msg.role === "user" && msg.userId != null)
			return msg.userId === userCtx.user?.id

		// Nothing on the row names anyone: the session owner's, as narration.
		return !isGuest
	}

	/** Send the draft; false when it was refused (nothing to send, no persona). */
	function handleSend(): boolean {
		if (!newMessage.trim()) return false

		// Use the current user's persona if they have one, otherwise use the first persona (for session owner)
		const personaId =
			currentUserPersona?.personaId ||
			session?.sessionPersonas?.[0]?.personaId

		// A mode whose shape has no persona system submits bare prose (19 §1:
		// "the user is simply prose") — the server already stores a
		// persona-less user message; this guard was the only thing requiring
		// one. Under the standard mode the requirement stands, as ever.
		if (!personaId && personaRequiredOnSend) {
			toaster.error({ title: "No persona selected for this session" })
			return false
		}

		const msg: Sockets.SessionMessages.SendPersonaMessage.Params = {
			sessionId,
			personaId: personaId ?? null,
			content: newMessage,
			// Where this line goes, and — through the trigger the handler
			// makes — which channel the reply is asked for on (R-C).
			channel: composerChannel
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
		// suppress the next-character block until it lands. Whether one is
		// coming is the run's decision now (the speaker node, under the
		// session's strategy), so the flag is raised on every send and
		// cleared by the trigger's own reply when nobody was due — see
		// `handleTriggerGenerateMessage` — rather than guessed here.
		markTriggerInFlight()

		return true
	}

	// The resolution itself is in `messageSpeaker` so it can be tested without
	// a page; this keeps the prop name every child already binds to.
	function getMessageCharacter(
		msg: SelectSessionMessage
	): SelectCharacter | undefined {
		// The envoys ride the view payload, not the session row (U5g).
		const speaker = messageSpeaker(
			session ? { ...session, envoys: sessionFrames?.envoys } : session,
			msg
		)
		if (speaker || msg.role !== "user" || msg.personaId != null)
			return speaker
		// A person speaking as themselves — no persona, as a genre with
		// `personas: { min: 0 }` allows (the Guide). Named by the member the
		// row belongs to: the viewer's own display name, a guest's off the
		// member list; the character shape, so the row renders as any other.
		const me = userCtx.user
		const member =
			me && msg.userId === me.id
				? me
				: session?.sessionGuests?.find((g) => g.userId === msg.userId)
						?.user
		if (!member) return undefined
		return {
			name: member.displayName?.trim() || member.username
		} as unknown as SelectCharacter
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
			turnOrder = null
			turnOrderDoc = EMPTY_TURN_ORDER
			showTurnPicker = false
			draftCompiledPrompt = undefined
			newMessage = ""
			loadingOlderMessages = false
			// Surface grid re-seeds for the new session (plan 21): re-fetch its
			// panel set + this user's saved layout, and re-init once both land.
			panelViewLoaded = false
			panelLayoutLoaded = false
			panelLayoutBlob = {}
			layoutPresets = []
			layoutPresetId = null
			layoutSettings = {}
			widgetSettings = {}
			layoutPresetBase = undefined
			layoutPresetUsage = null
			presetStatus = undefined
			presetBannerDismissed = false
			// The interest keys for these five replies are held by the declares
			// above (including the two re-scoped to this very id, whose effects
			// run before this one); the first typed `emit` puts their sync packet
			// ahead of the request group on the same socket — plan ruling 3.
			socket.emit("sessions:get", { id: sessionId, limit: 25 })
			socket.emit("sessions:presetStatus", { sessionId })
			socket.emit("sessions:view", { sessionId })
			socket.emit("sessions:panelLayout:get", { sessionId })
		}
	})

	$effect(() => {
		// REPOINTED, not deleted: these two reads exist only to make the effect
		// depend on the instance defaults, so the token count is recomputed when
		// an admin changes which connection or sampling config a reply will use.
		// They now read `connection_defaults`, the only place a default lives
		// (0181) — reading the dropped columns would have made the effect depend
		// on `undefined`, which never changes, and the count would have gone
		// quietly stale on every default change.
		const _connection =
			systemSettingsCtx.capabilityDefaults?.["text->text"]?.connectionId // DO NOT REMOVE THIS LINE - REACTIVITY TRIGGER
		const _samplingConfig =
			systemSettingsCtx.capabilityDefaults?.["text->text"]
				?.samplingConfigId // DO NOT REMOVE THIS LINE - REACTIVITY TRIGGER
		const _contextConfig = userSettingsCtx.settings?.activeContextConfigId // DO NOT REMOVE THIS LINE - REACTIVITY TRIGGER
		const _promptConfig = userSettingsCtx.settings?.activePromptConfigId // DO NOT REMOVE THIS LINE - REACTIVITY TRIGGER
		const _newMessage = newMessage // DO NOT REMOVE THIS LINE - REACTIVITY TRIGGER
		if (
			!sessionId ||
			!lastMessage ||
			lastMessage.isGenerating
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


	function handleAbortMessage(e: Event, msg: SelectSessionMessage) {
		e.stopPropagation()
		// Clear any pending auto-trigger timeout
		if (autoTriggerTimeout) {
			clearTimeout(autoTriggerTimeout)
			autoTriggerTimeout = null
		}
		socket.emit("sessionMessages:cancel", { id: msg.id, sessionId })
	}
	// ── Summarization mode ────────────────────────────────────────

	/**
	 * The summary finished (saved, or a scene started): the conversation's
	 * selection ends now — never when the modal merely opened, so a cancelled
	 * or failed create keeps a hand-picked selection (C0b review, M1).
	 */
	let summaryEnded = $state(0)
	function exitSummarizationMode() {
		selectedMessageIds = new Set()
		summaryEnded++
	}

	/**
	 * The draft handed to core's composer when the session opens (C0b): the
	 * composer owns the draft from then on and reports it (`draft`), which
	 * keeps `newMessage` — the token count, the save — in step.
	 */
	let composerDraftSeed = $state("")

	/** Selection is the conversation widget's (C0b): ask it to start one. */
	let selectForSummary = $state(0)
	function enterSummarizationModeEmpty() {
		selectForSummary++
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
		panelsCtx.digest.lore = {
			lorebookId,
			scope: "history",
			entryId: historyEntryId
		}
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
		branchFromMessage = msg
		showBranchSessionModal = true
	}
	function handleAbortLastMessage(e: Event) {
		e.stopPropagation()
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
		markTriggerInFlight()
		socket.emit("sessions:triggerGenerateMessage", {
			sessionId,
			triggered: true
		})
	}
	function handleTriggerCharacterMessage(e: Event) {
		e.stopPropagation()
		showTriggerCharacterMessageModal = true
	}
	function handleRegenerateLastMessage(e: Event) {
		e.stopPropagation()
		if (lastMessage && !lastMessage.isGenerating) {
			socket.emit("sessionMessages:regenerate", { id: lastMessage.id })
		}
	}

	function onSelectTriggerCharacterMessage(characterId: number) {
		showTriggerCharacterMessageModal = false
		markTriggerInFlight()
		socket.emit("sessions:triggerGenerateMessage", {
			sessionId,
			characterId,
			once: true
		})
	}

	function openNarrateModal() {
		socket.emit("sessions:sideCharacterOptions", { sessionId })
		showTriggerNarratorResponseModal = true
	}

	function handleTriggerNarratorResponse(e: Event) {
		e.stopPropagation()
		showTriggerCharacterMessageModal = false
		openNarrateModal()
	}

	function handleConfirmTriggerNarratorResponse(request: {
		instructions: string
		speaker?: { characterId: number | null; name: string | null }
	}) {
		showTriggerNarratorResponseModal = false
		socket.emit("sessions:triggerNarratorResponse", {
			sessionId,
			instructions: request.instructions || undefined,
			// Absent means world narration, which is what this trigger has
			// always sent — the server reads its absence, not a mode flag.
			...(request.speaker ? { speaker: request.speaker } : {})
		})
	}

	function handleCancelTriggerNarratorResponse() {
		showTriggerNarratorResponseModal = false
	}

	/** Continue: take the order's head (§4.7). */
	function handleContinueWithNextCharacter() {
		if (!turnOrder?.order.length) return
		markTriggerInFlight()
		socket.emit("sessions:fireTurn", { sessionId })
	}

	/** "Someone else": the picker over the order's candidates (§4.9). */
	function handleChooseDifferentCharacter() {
		showTurnPicker = true
	}

	function handlePickTurn(entry: { ref: string | null }) {
		showTurnPicker = false
		markTriggerInFlight()
		socket.emit("sessions:fireTurn", {
			sessionId,
			entry: { ref: entry.ref, via: "pick" }
		})
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
			// A persona is a character, so its card lives in the Characters
			// view like every other.
			panelsCtx.openPanel({ key: "characters", toggle: false })
			panelsCtx.digest.viewCharacterId = msg.personaId
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

		const beforeId = Math.min(...session.sessionMessages.map((m) => m.id))
		socket.emit("sessions:get", { id: sessionId, limit: 25, beforeId })

		// loadingOlderMessages will be set to false in the socket response handler
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
		// An opt-in built-in the genre switched off has no control (R-15).
		if (!offersVerb("swipe")) return false
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

				// The log's `sp-scroll` holds the reader's place as the rows land.
				loadingOlderMessages = false
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
					composerDraftSeed = msg.userDraft
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
				// Held before the array is rewritten: the row it REPLACES is
				// the only thing that says whether this push is a streamed
				// chunk, an edit or a run ending (`witnessMessage`).
				const previous = currentSession.sessionMessages[existingIndex]
				const updatedMessages = [...currentSession.sessionMessages]
				updatedMessages[existingIndex] = sessionMessage
				session = {
					...currentSession,
					sessionMessages: updatedMessages
				}
				// Announced AFTER the state is written, so a widget woken by
				// the event reads the row the event describes.
				surfaceManager.witnessMessage(sessionMessage, previous)
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
				// No previous row: the arrival itself is `message:created`,
				// which every widget's own feed announces. What this adds is
				// `generation:start` for a reply that arrives already filling.
				surfaceManager.witnessMessage(sessionMessage)
			}
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

		// …and the persona links, which name the same table. The SAME row can
		// be in the cast and be somebody's persona, so this is a second check
		// rather than an else.
		const sessionPersonaIndex = session.sessionPersonas.findIndex(
			(p: SelectSessionPersona) => p.personaId === charId
		)
		if (sessionPersonaIndex !== -1) {
			const updatedSessionPersonas = [...session.sessionPersonas]
			updatedSessionPersonas[sessionPersonaIndex] = {
				...updatedSessionPersonas[sessionPersonaIndex],
				persona: msg.character
			}
			session = { ...session, sessionPersonas: updatedSessionPersonas }
		}
	}

	/**
	 * A media row whose bytes changed while keeping its id — a re-cut
	 * thumbnail, or a display pointer moved by a cull.
	 *
	 * Nothing was written to the character or persona wearing that file, so no
	 * `characters:update` fires and every avatar on screen keeps the `<img src>`
	 * it already has. Re-addressing the link's entity is what makes the URL
	 * differ, which is the only thing a browser's image cache answers to.
	 */
	function handleMediaChanged(msg: Sockets.Media.Changed.Response) {
		if (!session) return
		let touched = false
		const sessionCharacters = session.sessionCharacters.map((cc) => {
			if (!cc.character) return cc
			const character = withRevisedAvatar(cc.character, msg)
			if (character === cc.character) return cc
			touched = true
			return { ...cc, character }
		})
		const sessionPersonas = session.sessionPersonas.map((cp) => {
			if (!cp.persona) return cp
			const persona = withRevisedAvatar(cp.persona, msg)
			if (persona === cp.persona) return cp
			touched = true
			return { ...cp, persona }
		})
		if (!touched) return
		session = { ...session, sessionCharacters, sessionPersonas }
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
			// The row itself, while the page still holds it: the announcement
			// below names the channel it was on so a widget that declared
			// another is not told about it (`witnessMessageDeleted`).
			const deleted = session.sessionMessages.find(
				(m: SelectSessionMessage) => m.id === msg.id
			)

			// Remove the deleted message from the session messages array
			const filteredMessages = session.sessionMessages.filter(
				(m: SelectSessionMessage) => m.id !== msg.id
			)

			// Ensure messages remain sorted chronologically
			session = {
				...session,
				sessionMessages: filteredMessages.sort((a, b) => a.id - b.id)
			}

			surfaceManager.witnessMessageDeleted(deleted ?? { id: msg.id })

		}
	}

	function handleSpriteSetChanged(msg: Sockets.Sessions.SetSpriteSet.Response) {
		if (msg.sessionId !== sessionId || !session || msg.error) return
		const next = { ...((session as any).spriteSetOverrides ?? {}) }
		if (msg.set) next[msg.characterId] = msg.set
		else delete next[msg.characterId]
		;(session as any).spriteSetOverrides = next
	}

	function handleSetSpriteSetReply(msg: Sockets.Sessions.SetSpriteSet.Response) {
		if (msg.sessionId !== sessionId || !msg.error) return
		toaster.error({ title: msg.error })
	}

	function handleTurnOrder(msg: Sockets.Sessions.TurnOrder.Push) {
		if (msg.sessionId !== sessionId) return
		const t = msg.turnOrder as Partial<TurnOrderView> | null
		turnOrder = {
			order: Array.isArray(t?.order) ? t!.order : [],
			candidates: Array.isArray(t?.candidates) ? t!.candidates : []
		}
		turnOrderDoc = readTurnOrder({ turnOrder: msg.turnOrder })
	}

	/**
	 * A fire that did not start a run — a person's turn, nothing prepared —
	 * answers on the success event with `ok: false`; no placeholder will
	 * land to clear the in-flight flag, so it is cleared here.
	 */
	function handleFireTurn(msg: Sockets.Sessions.FireTurn.Response) {
		if (msg.sessionId !== sessionId || msg.ok) return
		clearTriggerInFlight()
	}

	function handleFireTurnError(msg: Sockets.Sessions.FireTurn.Response) {
		if (msg.sessionId !== sessionId) return
		clearTriggerInFlight()
		if (msg.error) toaster.error({ title: msg.error })
	}

	/**
	 * The trigger's own reply. `nobodyDue` is the quiet end of a round —
	 * the run's speaker node seated nobody, or the session's strategy
	 * waits to be told — and the one case where no placeholder will ever
	 * land to clear the in-flight flag, so it is cleared here.
	 */
	function handleTriggerGenerateMessage(
		msg: Sockets.Sessions.TriggerGenerateMessage.Response
	) {
		if (msg.nobodyDue) clearTriggerInFlight()
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

	function handleSessionsSideCharacterOptions(
		msg: Sockets.Sessions.SideCharacterOptions.Response
	) {
		if (msg.sessionId !== sessionId) return
		sideCharacterOptions = msg.characters ?? []
	}

	function handleSessionsActions(msg: Sockets.Sessions.Actions.Response) {
		if (msg.sessionId !== sessionId) return
		actionVenues = msg.venues || {}
	}

	/**
	 * The person opened a list that showed these newcomers: the mark clears
	 * here at once and on the server for good (`sessions:actionsSeen`).
	 */
	function markActionsSeen(keys: string[]) {
		if (!keys.length) return
		const set = new Set(keys)
		const next: typeof actionVenues = {}
		for (const [kind, v] of Object.entries(actionVenues))
			next[kind] = {
				primary: v.primary.map((a) =>
					set.has(actionIdentity(a)) ? { ...a, isNew: false } : a
				),
				overflow: v.overflow.map((a) =>
					set.has(actionIdentity(a)) ? { ...a, isNew: false } : a
				)
			}
		actionVenues = next
		socket.emit("sessions:actionsSeen", { sessionId, keys })
	}

	/** The message an invocation named, when it is one this page holds. */
	const messageById = (id?: number) =>
		id == null
			? undefined
			: session?.sessionMessages?.find((m) => m.id === id)

	/**
	 * Core's verbs, as this page implements them (W4): what a widget's
	 * `invoke('continue')`, a frame's `{ t: "invoke", key: "core#edit" }`
	 * and the palette's `/continue` all land on. A verb named with a message
	 * acts on that message; `continue` and `retry` named with none act on
	 * the newest reply (the turn controls); the rest need a subject and say
	 * so rather than guessing one.
	 */
	const needsSubject = (key: string) => {
		throw new Error(`'${key}' acts on a message — name one`)
	}
	const withMessage = (
		key: string,
		args: InvokeArgs | undefined,
		fn: (m: SelectSessionMessage) => void
	) => {
		const m = messageById(args?.messageId)
		if (!m) return needsSubject(key)
		fn(m)
	}
	const coreVerbs: CoreVerbHandlers = {
		continue: (args) =>
			args?.messageId != null
				? withMessage("continue", args, (m) =>
						handleContinueMessage(new Event("invoke"), m)
					)
				: handleTriggerContinueConversation(new Event("invoke")),
		retry: (args) =>
			args?.messageId != null
				? withMessage("retry", args, (m) =>
						handleRegenerateMessage(new Event("invoke"), m)
					)
				: handleRegenerateLastMessage(new Event("invoke")),
		// `edit` COMMITS (C0b): edit mode is the widget's own state, and the
		// verb carries the new text.
		edit: (args) =>
			withMessage("edit", args, (m) => {
				const content = args?.payload?.content
				if (typeof content !== "string" || !content.trim())
					throw new Error("'edit' carries the new text — { content }")
				socket.emit("sessionMessages:update", { ...m, content })
			}),
		stop: (args) =>
			args?.messageId != null
				? withMessage("stop", args, (m) =>
						handleAbortMessage(new Event("invoke"), m)
					)
				: handleAbortLastMessage(new Event("invoke")),
		branch: (args) =>
			withMessage("branch", args, (m) =>
				handleBranchMessage(new Event("invoke"), m)
			),
		// A reply swiped to the newer alternative, or back (`{ direction }`).
		swipe: (args) =>
			withMessage("swipe", args, (m) =>
				args?.payload?.direction === "left" ? swipeLeft(m) : swipeRight(m)
			),
		hide: (args) =>
			withMessage("hide", args, (m) =>
				handleHideMessage(new Event("invoke"), m)
			),
		delete: (args) =>
			withMessage("delete", args, (m) =>
				handleDeleteMessage(new Event("invoke"), m)
			)
	}
	/**
	 * ONE routing rule (`dispatchAction`): core's verbs above, the rest the
	 * audited fire.
	 *
	 * Threaded down to every widget and frame mount (`actionDispatch`), so a
	 * press inside one resolves here and not in a lesser copy: `fire` is this
	 * page's own `fireTrigger`, which names the run and opens the narrator's
	 * modal, and the chip, the menu row and the widget are then one lane.
	 */
	const actionDispatch: ActionDispatch = {
		core: coreVerbs,
		fire: (a, args) => fireTrigger(a, args)
	}

	/**
	 * One action, invoked from the overflow or the `/` palette. Core's verbs
	 * go to their handlers; everything else is the generic fire, identity in
	 * hand, which routes the narrator's to its modal.
	 */
	function invokeAction(a: { specSlug: string; key: string }) {
		dispatchAction(a, actionDispatch)
	}

	function handleSessionsModesPage(msg: Sockets.Sessions.Genres.Response) {
		modesList = msg.genres || []
	}

	/**
	 * A long run reporting itself.
	 *
	 * Both events land in the store: `runStarted` is the same shape as a
	 * progress tick, and recording it as one means the card appears the
	 * instant the run does rather than after the backend's first report —
	 * which for an image render can be several seconds of a button that looks
	 * like it did nothing. A start goes through `started`, so what last ended
	 * in the session yields to the new run whether or not a progress card is
	 * mounted to say so.
	 */
	function handleRunProgress(msg: RunProgress) {
		if (msg.sessionId != null && msg.sessionId !== sessionId) return
		runProgress.apply(msg)
	}
	function handleRunStarted(msg: RunProgress) {
		if (msg.sessionId != null && msg.sessionId !== sessionId) return
		runProgress.started(msg)
	}

	function handleSessionsTriggerFunction(
		msg: Sockets.Sessions.TriggerFunction.Response
	) {
		if (msg.sessionId !== sessionId) return
		// Cancelled FIRST, and never as an error. Somebody pressing Cancel is
		// a deliberate act; it used to arrive here as `error: "the run was
		// cancelled"` and got a red toast for doing exactly what was asked.
		if (msg.cancelled) {
			// A supersede is bookkeeping — the client re-sent the same run id,
			// so the run this replaces is one nobody watched and nobody
			// stopped. Its replacement is what the person is looking at, and a
			// notice about the one it displaced would be noise blaming them
			// for a cancel they did not make.
			if (msg.cancelledBy !== "system:superseded")
				toaster.info({ title: msg.action, description: "Cancelled." })
			// Still re-read: a run stops BETWEEN nodes, so a consumer earlier
			// in the spec may already have written. "Cancelled" is all this
			// knows; "nothing happened" is a claim it cannot make.
			socket.emit("sessions:get", { id: sessionId })
		} else if (msg.error) {
			toaster.error({ title: msg.action, description: msg.error })
		} else if (msg.success) {
			// The spec's consumers wrote whatever they wrote — re-read the session
			// so it shows.
			socket.emit("sessions:get", { id: sessionId })
		}
	}

	/**
	 * THE `sessions:triggerFunction` emit. There is no other on this page, and
	 * a second one would be a second, lesser fire for whoever pressed from the
	 * wrong place: every press — a chip, the `/` palette, a message's ⋮ menu,
	 * a widget's `invoke(key)`, a frame's `{ t: "invoke" }`, a bare frame
	 * action, a form answered on the row — is named as a run here, so Cancel
	 * reaches it during the window between the press and the first progress
	 * event, which is exactly when somebody realises they meant something
	 * else.
	 *
	 * Deliberately below the bespoke client flows rather than around them:
	 * `fireTrigger` diverts the narrator's functions before calling this, and
	 * a press answering a form calls it straight, because a form's button must
	 * answer the form whatever its function happens to be named.
	 */
	function emitTrigger(p: {
		/** The action's bare key — what the server resolves when no identity rides (⏳, plans/31 V2). */
		fn: string
		/**
		 * `<spec slug>#<key>`, when the press named a declaration (W1): the
		 * server checks THAT action's audience and enablement and runs THAT
		 * spec. Absent, the server resolves `fn` to its sole declarer.
		 */
		identity?: string | null
		messageId?: number
		payload?: Record<string, unknown>
		/**
		 * The form this press answers (U5d): the server reads the block off
		 * the row and holds the press to its addressee.
		 */
		blockId?: string
	}) {
		socket.emit("sessions:triggerFunction", {
			sessionId,
			...(p.identity ? { action: p.identity } : { key: p.fn }),
			...(p.messageId != null ? { messageId: p.messageId } : {}),
			...(p.blockId ? { blockId: p.blockId } : {}),
			...(p.payload && Object.keys(p.payload).length
				? { payload: p.payload }
				: {}),
			runId: crypto.randomUUID()
		})
	}

	/**
	 * The generic fire (19 §4) for an OFFERED action, named by the declaration
	 * that was pressed (W1). A subject message, entered values and the block a
	 * press answers ride when there are any.
	 *
	 * The wrapper every offered press takes, and the reason
	 * `actionDispatch.fire` is it: the chips, the `/` palette, a message's ⋮
	 * menu, a widget's `invoke(key)`, a frame's `{ t: "invoke" }` and a bare
	 * frame action all arrive here, so the divert below is had by all of them
	 * or by none.
	 *
	 * The spec is optional because a caller may have no declaration to give
	 * — a frame's bare `{ t: "action", fn }` — and then the key alone rides.
	 */
	function fireTrigger(
		a: {
			specSlug?: string
			key: string
		},
		args?: InvokeArgs
	) {
		// The functions with a bespoke client flow: both halves of the narrator
		// split open the same modal — whose first step *is* the choice between
		// them — and fire the dedicated event. Everything else is the generic
		// fire (19 §4).
		//
		// Never for a press that carries a `blockId`, whatever it is named: a
		// form answer answers its form. `fireBlockAction` goes straight to
		// `emitTrigger` for exactly that reason, but it is not the only way a
		// block's press arrives — a widget's `invoke(key, { blockId })` and a
		// frame's `{ t: "invoke", blockId }` come through this wrapper — so the
		// rule belongs here too, or a form whose action is one of the
		// narrator's two opens the modal and leaves its question unanswered and
		// still answerable.
		const identity = a.specSlug
			? actionIdentity({ specSlug: a.specSlug, key: a.key })
			: null
		if (
			!args?.blockId &&
			(identity === NARRATE_ACTION ||
				identity === NARRATE_CHARACTER_ACTION ||
				(!identity &&
					(a.key === "narrate" || a.key === "narrate-character")))
		) {
			openNarrateModal()
			return
		}
		emitTrigger({
			fn: a.key,
			identity,
			messageId: args?.messageId,
			payload: args?.payload,
			blockId: args?.blockId
		})
	}

	/**
	 * A contributed action fired from a message's options menu or quick row
	 * (19 §4). The message is the subject: its id rides the run's input, so
	 * the winning spec receives which message the person meant.
	 */
	function fireMenuTrigger(
		a: Sockets.Sessions.Actions.Action,
		msg: SelectSessionMessage
	) {
		fireTrigger(a, { messageId: msg.id })
	}

	/**
	 * A declared block action (20 §6): a choices button or a form submit
	 * inside a parts-native message. Same audited path as a menu trigger,
	 * with the entered values riding as the payload and the block's stamped
	 * identity (W-E) naming the declaration the server holds the press to —
	 * a block stamped by a spec that opened it to any participant admits a
	 * guest; a block with none is the legacy shape and gets the owner floor.
	 */
	function fireBlockAction(
		fn: string,
		msg: SelectSessionMessage,
		payload?: Record<string, unknown>,
		action?: string,
		blockId?: string
	) {
		// Straight to the emit, past `fireTrigger`: a form's button is not an
		// offered action, so it takes none of the offered ones' bespoke client
		// flows — a block whose function happens to be one of the narrator's
		// must answer the form, not open the modal. The run is named all the
		// same, so Cancel reaches a press made here like any other.
		emitTrigger({
			fn,
			identity: action,
			messageId: msg.id,
			payload,
			blockId
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
		// The guest persona picker asks `characters:list` for itself, so there
		// is nothing to fetch here.
		// "sessions:userTyping" is a scoped interest, declared above.
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

		// Every listener this page needs is an interest, declared above rather
		// than registered by hand here: "sessionMessage", "sessions:get" and
		// the run-progress pushes scoped to this session; "scenes:list" and
		// "scenes:scenedMessageIds" likewise; "lorebooks:bindingList" scoped
		// to the session's book; and the bare page-level ones —
		// "sessionMessage:error", "scenes:process:error" (page-level so a run
		// that failed while minimized is not silent), "media:changed",
		// "sessionMessages:delete", "characters:update" and the two scene
		// `:error` halves.

		// The keys for every `sessions:*` reply below are already held (they are
		// declared above, and effects run in declaration order); the first typed
		// `emit` puts their sync packet ahead of this request group on the same
		// socket — plan ruling 3, which is what makes an ack unnecessary.
		socket.emit("scenes:scenedMessageIds", { sessionId })
		socket.emit("scenes:list", {
			sessionId
		} satisfies Sockets.Scenes.List.Params)
		// The action list (R-15) — the buttons are rows — and the shape,
		// which gates what the view renders at all (19 §2).
		socket.emit("sessions:actions", { sessionId })
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
			// Runs belonging to a session nobody is looking at any more. The
			// server keeps running them; the card is what goes away.
			runProgress.clearAll()
			// Every listener is released by the interest registry as this
			// component's effects are destroyed — there is nothing to take off
			// the socket by hand here.
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
		avatarMediaId: number | null
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
	// The page's UI workers (§3.5) go with the page, whatever still holds them.
	/**
	 * What core's conversation widget is told about this session (C0b,
	 * `session_full.v1`): the page's answers — who the viewer controls, who
	 * spoke each line, where the scenes fall — so the widget judges nothing
	 * it would need the page for.
	 */
	// The session state's ledger, projected for core's conversation (C0b):
	// the page holds the store, the widget draws what it is told.
	const stateStore = sessionState()
	$effect(() => openSessionState(sessionId ?? null))
	const describeProposalRow = (row: Sockets.State.ProposalRow): ConversationProposalV1 => {
		const payload = (row.payload ?? {}) as Record<string, unknown>
		const moved =
			row.status !== "superseded"
				? null
				: row.kind === "value" && typeof payload.slotId === "string"
					? (stateStore.slotLabelFor(payload.slotId) ?? payload.slotId)
					: typeof payload.entryId === "number"
						? (stateStore.itemNameFor(payload.entryId) ?? t("an item"))
						: t("a value")
		return {
			id: row.id,
			status: row.status,
			messageId: (row as { messageId?: number | null }).messageId ?? null,
			text: describeProposal(row, {
				ownerLabel: (owner) => stateStore.ownerLabelFor(owner),
				slotLabel: (slotId) => stateStore.slotLabelFor(slotId),
				itemName: (entryId) => stateStore.itemNameFor(entryId)
			}),
			proposedBy: (row as { proposedBy?: string | null }).proposedBy ?? null,
			moved
		}
	}

	/** A line's vectors against the active embedding model (the old EmbeddingStatusIcon's rule). */
	const embeddingStatusOf = (model: string | null | undefined): ConversationLineV1["embedding"] => {
		const active = systemSettingsCtx?.settings?.activeEmbeddingModel ?? null
		if (!embeddingsStarred(systemSettingsCtx?.capabilityDefaults) || !active) return "hidden"
		if (model === active) return "current"
		return model ? "stale" : "none"
	}

	/** Each line's facts, and what they were built from (a plain map: a cache, not state). */
	const lineCache = new Map<number, { key: string; line: ConversationLineV1 }>()

	let conversationDossier: ConversationDossierV1 | null = $derived.by(() => {
		if (!session) return null
		const lines: ConversationDossierV1["lines"] = {}
		// A line's facts are rebuilt only when something they read changed —
		// a streamed token rewrites one row's text, not who spoke every line.
		const castKey = [
			userCtx.user?.id,
			isGuest,
			lastMessage?.id,
			lastPersonaMessage?.id,
			canRegenerateLastMessage,
			systemSettingsCtx.settings?.activeEmbeddingModel,
			...(session.sessionCharacters ?? []).map((cc) => `${cc.characterId}:${cc.character?.name}:${cc.character?.avatarMediaId}`),
			...(session.sessionPersonas ?? []).map((cp) => `${cp.personaId}:${cp.persona?.name}:${cp.persona?.userId}`)
		].join("|")
		for (const m of session.sessionMessages) {
			const key = JSON.stringify([
				castKey,
				m.characterId,
				m.personaId,
				m.userId,
				m.role,
				m.isGenerating,
				m.isNarratorResponse,
				m.metadata?.narratorName,
				(m.metadata as any)?.sprite,
				m.metadata?.isGreeting,
				m.metadata?.swipes?.currentIdx,
				m.metadata?.swipes?.history?.length,
				(m as { embeddingModel?: string | null }).embeddingModel
			])
			const held = lineCache.get(m.id)
			if (held?.key === key) {
				lines[m.id] = held.line
				continue
			}
			const who = getMessageCharacter(m)
			const ref = m.characterId
				? `character:${m.characterId}`
				: m.personaId
					? `character:${m.personaId}`
					: null
			const greeting = !!m.metadata?.isGreeting
			const line: ConversationLineV1 = {
				controllable: canControlMessage(m),
				speaker: {
					name: m.isNarratorResponse
						? m.metadata?.narratorName || "Narrator"
						: resolveCharacterName(who, "Unknown"),
					ref,
					face: avatarSrc(who) ?? null,
					sprite: spriteSrc(who as any, shownSpriteOf(m), { variantKey: m.id }) ?? null
				},
				swipes: { show: showSwipeControls(m, greeting), right: canSwipeRight(m, greeting) },
				embedding: embeddingStatusOf((m as { embeddingModel?: string | null }).embeddingModel)
			}
			lineCache.set(m.id, { key, line })
			lines[m.id] = line
		}
		return {
			sessionId: session.id,
			lines,
			scenes: sceneList as unknown as ConversationDossierV1["scenes"],
			scened: [...scenedMessageIds],
			hasOlder: !!pagination?.hasMore,
			loadingOlder: loadingOlderMessages,
			continueRefusal,
			isOwner: !isGuest,
			cast: {
				sessionPersonas: (session.sessionPersonas ?? []).map((cp) => ({
					personaId: cp.personaId ?? null,
					persona: cp.persona ? { userId: cp.persona.userId ?? null } : null
				})),
				sessionCharacters: (session.sessionCharacters ?? []).map((cc) => ({
					characterId: cc.characterId ?? null
				}))
			},
			writes: { scenes: offersWrite("scenes"), lore: offersWrite("lore") },
			debugPrompts:
				!!userCtx.user?.isAdmin && !!systemSettingsCtx.settings?.contextDebuggingEnabled,
			selectForSummary,
			summaryEnded,
			composer: {
				draft: composerDraftSeed,
				personas: userPersonasInSession
					.filter((cp) => cp.persona && cp.personaId != null)
					.map((cp) => ({ personaId: cp.personaId!, name: cp.persona!.name })),
				personaId:
					currentUserPersona?.personaId ??
					(!isGuest ? (session.sessionPersonas?.[0]?.personaId ?? null) : null),
				addPersona: showAddPersonaCTA,
				hidden: composerHidden,
				channels: sessionChannels,
				usage: draftCompiledPrompt?.meta?.tokenCounts
					? {
							total: draftCompiledPrompt.meta.tokenCounts.total,
							limit: draftCompiledPrompt.meta.tokenCounts.limit
						}
					: null,
				tabs: isGuest
					? []
					: [
							{ view: "session-controls", title: "Turn controls", icon: "message-square" },
							...(session.lorebookId
								? [{ view: "session-workflow", title: "Lore", icon: "book-open" }]
								: []),
							{ view: "scene-images", title: "Pinned images", icon: "images" },
							...(systemSettingsCtx.settings?.contextDebuggingEnabled
								? [{ view: "session-statistics", title: "Statistics", icon: "bar-chart-2" }]
								: [])
						],
				actions: sessionActions.length > 0,
				notice: embeddingsStarred(systemSettingsCtx.capabilityDefaults),
				overflow: $state.snapshot(composerMenuActions) as unknown[],
				palette: $state.snapshot(paletteActions) as unknown[],
				newest: newestItem ? $state.snapshot(newestItem) : null,
				sendTonal: shouldShowNextCharacterBlock
			},
			turn: {
				order: $state.snapshot(turnOrder?.order ?? []) as ConversationDossierV1["turn"]["order"],
				candidates: $state.snapshot(turnOrder?.candidates ?? []) as ConversationDossierV1["turn"]["candidates"],
				show: shouldShowNextCharacterBlock,
				canChoose: canChooseDifferentCharacter
			},
			readOnly: modeMissing ? { genreId: ((session as any)?.genreId as string | null) ?? null } : null,
			state: {
				ledgers: Object.fromEntries(
					session.sessionMessages
						.map((m) => [m.id, stateStore.ledgerFor(m.id)] as const)
						.filter(([, groups]) => groups.length)
				) as ConversationDossierV1["state"]["ledgers"],
				pending: Object.fromEntries(
					session.sessionMessages
						.map((m) => [m.id, stateStore.pendingFor(m.id).map(describeProposalRow)] as const)
						.filter(([, rows]) => rows.length)
				),
				waiting: stateStore.pending.map(describeProposalRow)
			},
			backdrop: !!userSettingsCtx.settings?.backgroundImagePath
		}
	})
	// Any widget granted `session:full` reads the same dossier (C5): a
	// plugin's, when an admin granted its `widget:session:full`.
	setContext(SESSION_DOSSIER_KEY, {
		get current() {
			return conversationDossier
		}
	})

	onDestroy(() => terminateAllWorkers())

	// `sp-avatar` asks the page who a participant reference is (C0b): the
	// session's characters and the personas people speak as, one lookup.
	setHostParticipants((ref) => {
		const who = characterForRef(ref)
		return who ? { name: resolveCharacterName(who, who.name ?? ""), avatarUrl: avatarSrc(who) ?? null } : null
	})
	onDestroy(() => setHostParticipants(undefined))

	// The page's own views a widget may place (`sp-host-view`, C0b), drawn
	// by the page under its own contexts wherever core's composer puts them.
	// Registered from the template (`registerHostViews`): the snippets live
	// inside its blocks, out of the script's reach.
	const pageContexts = getAllContexts()

	onDestroy(() => {
		sceneImages.set({ left: null, right: null })
		openSessionCtx.sessionId = null
		openSessionCtx.sessionName = null
		openSessionCtx.cast = []
		openSessionCtx.genreName = null
		openSessionCtx.lorebookId = null
		openSessionCtx.isOwner = false
	})

	function handleAvatarClick(char: SelectCharacter | undefined) {
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
			// The id, not a resolved URL: the modal shows this large, and a
			// pre-resolved thumbnail URL is not something it can undo.
			avatarMediaId: char.avatarMediaId ?? null
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
						? {
								id: session.id,
								name: (session as any).name ?? null
							}
						: undefined}
					messages={session?.sessionMessages ?? []}
					actions={actionVenues}
					{actionDispatch}
					onAction={handleFrameAction}
					source={surfaceManager}
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
				{conversationDossier}
				presets={layoutPresets}
				activePresetId={layoutPresetId}
				onApplyPreset={applyLayoutPreset}
				onSavePreset={saveLayoutPreset}
				onRenamePreset={renameLayoutPreset}
				onDeletePreset={deleteLayoutPreset}
				onPresetUsage={askLayoutPresetUsage}
				presetUsage={layoutPresetUsage}
				{layoutSettings}
				onLayoutSettings={persistLayoutSettings}
				actions={actionVenues}
				{actionDispatch}
				onFrameAction={handleFrameAction}
			>
				<!-- The one `messages` widget: the log, the field you write into,
				     and the strips that belong beside the field. `MessagesWidget`
				     reads the widget's settings and hands them back to each
				     snippet, so the log, the composer and the scroll handling all
				     answer to one reading of them. -->
				{#snippet conversationChildren()}
					{#if remoteConversation}
						<!-- C7 gate: core's conversation as a remote (`?remote=1`). -->
						<RemoteConversation
							{actionDispatch}
							source={surfaceManager}
							onAction={handleFrameAction}
						/>
					{:else}
						<MessagesWidget />
					{/if}
				{/snippet}
			</SessionLayout>
		{/if}
	</div>

	<div
		hidden
		{@attach () => {
			setHostViews(
				{
					"session-banners": conversationBanners,
					"session-actions": sessionActionsRow,
					"retrieval-notice": ragNotice,
					"run-progress": runProgress,
					"session-controls": extraControlsContent,
					"session-workflow": workflowContent,
					"scene-images": sceneImagesContent,
					"session-statistics": statisticsContent
				},
				pageContexts
			)
			return () => setHostViews(undefined)
		}}
	></div>

	{#snippet conversationBanners()}
		<!-- The session's preset binds an event to a pipeline that
		     is not here any more (ruled 2026-09-10). It runs the
		     genre's default instead, and this is the only place a
		     person in the session would ever find that out.
		     Dismissible per view, never persisted — the condition
		     outlives the tab, so a stored dismissal would be a way
		     to hide it from yourself. Above the composer chain
		     rather than inside it: it is true whether or not the
		     session is in summarization mode or read-only. -->
		{#if presetStale.length && !presetBannerDismissed}
			<div
				class="preset-tonal-warning flex items-start gap-3 p-3 lg:rounded-t-lg"
				role="status"
			>
				<Icons.Replace size={18} class="mt-0.5 shrink-0" />
				<div class="min-w-0 flex-1 text-sm">
					{#if userCtx.user?.isAdmin}
						<p>
							This session runs the default pipeline: preset
							<strong>
								{presetStatus?.presetName}
							</strong>
							binds
						</p>
						<ul class="my-1 flex flex-col gap-0.5">
							{#each presetStale as b (b.event)}
								<li class="text-xs">
									<code class="font-mono">
										{b.event}
									</code>
									to
									<code class="font-mono">
										{b.bound}
									</code>
									— which is not available.
								</li>
							{/each}
						</ul>
						<a
							class="underline"
							href="/admin/session-presets/{presetStatus?.presetId}#bindings"
						>
							Fix the binding
						</a>
					{:else}
						<p>
							This session is running the default pipeline for
							{presetStale.map((b) => b.event).join(", ")}.
						</p>
					{/if}
				</div>
				<button
					class="btn-icon btn-icon-sm preset-tonal-surface shrink-0"
					title="Dismiss"
					aria-label="Dismiss"
					onclick={() => (presetBannerDismissed = true)}
				>
					<Icons.X size={14} />
				</button>
			</div>
		{/if}
		<!-- Who else is writing, directly above the field they are writing into.
		     It belongs to the composer, so it shows where the composer does: a
		     selection toolbar, a read-only session and a genre with no field are
		     three states in which nobody is typing into anything. -->
		{#if !modeMissing && !composerHidden}
			{#each [...typingPersonas.values()] as typingPersona (typingPersona.name)}
				<div class="flex items-center gap-2 px-2 pb-1">
					<p class="text-surface-600-400 animate-pulse text-sm">
						{typingPersona.name} is typing...
					</p>
					<div
						class="bg-primary-500 h-2 w-2 animate-bounce rounded-full"
					></div>
				</div>
			{/each}
		{/if}
	{/snippet}

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
			id: cc.character.id,
			name: resolveCharacterName(cc.character, cc.character.name)
		}))}
		sessionPersonas={(session?.sessionPersonas ?? []).map((cp) => ({
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

					{#if promptDetails?.meta}
						{@const tokens = promptDetails.meta.tokenCounts}
						{@const msgs = promptDetails.meta.sessionMessages}
						{@const src = promptDetails.meta.sources}
						{@const retrieval = promptDetails.meta.retrieval}
						{@const tokenPct = Math.min(
							100,
							Math.round((tokens.total / tokens.limit) * 100)
						)}
						{@const truncReason =
							promptDetails.meta.truncationReason}

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
										class:text-error-500={detailsExceeded}
										class:text-success-500={!detailsExceeded}
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
										class="h-full rounded-full transition-all {detailsExceeded
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
											{promptDetails.meta.promptFormat ||
												"—"}
										</span>
									</span>
									{#if promptDetails.meta.templateName}
										<span>
											Template: <span
												class="text-surface-300-700"
											>
												{promptDetails.meta
													.templateName}
											</span>
										</span>
									{/if}
									<!--
										One engine now. Which retrieval *mechanism*
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
							<!--
								The thin list is now the FALLBACK, not the answer.

								It reports "in / out", a source and a token count,
								which says *that* an entry was left out and never
								*why* — the only half anybody opens this report to
								learn. `pipelines:messageExplain` returns the same
								projection the pipeline workspace reads, resolved
								from the message rather than from a run id the
								reader was never given; when nothing was recorded
								for a reply, this is still what there is.
							-->
							{#snippet thinRetrieval()}
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
															{b.source} · {b.tokens}
															tok
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
							{/snippet}
							<!-- The run's explanation reads its receipt, an
							     administrator's (R55); everyone else gets the
							     message's own stored record. -->
							{#if messageReport && userCtx.user?.isAdmin}
								<MessageRetrievalExplanation
									messageId={messageReport.messageId}
									fallback={thinRetrieval}
								/>
							{:else}
								{@render thinRetrieval()}
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
								{#if promptDetails.messages && promptDetails.messages.length > 0}
									<!-- Session format: render each message block -->
									<div
										class="max-h-96 space-y-2 overflow-y-auto"
									>
										{#each promptDetails.messages as msg, i}
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
								{:else if promptDetails.prompt}
									<!-- Raw text format -->
									<pre
										class="bg-surface-300-700 max-h-96 overflow-y-auto rounded p-2 text-xs leading-relaxed whitespace-pre-wrap">{promptDetails.prompt}</pre>
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

	<!-- "Someone else" (§4.9): at the page's top level, not inside the nudge,
	     which unmounts the moment a turn is fired. -->
	<TurnPicker
		open={showTurnPicker}
		candidates={turnOrder?.candidates ?? []}
		headRef={turnOrder?.order[0]?.ref}
		avatarFor={characterForRef}
		offerNarrator
		onPick={handlePickTurn}
		onClose={() => (showTurnPicker = false)}
	/>

	<!-- The sprite picker a message's controls ask for (`change-sprite`, C0b). -->
	{#if spriteLine?.characterId}
		<ChangeSpriteDialog
			open
			messageId={spriteLine.id}
			characterId={spriteLine.characterId}
			characterName={getMessageCharacter(spriteLine)?.name}
			current={asShownSprite((spriteLine.metadata as any)?.sprite)}
			onClose={() => (spriteLine = null)}
		/>
	{/if}
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
						<h2 class="h2">Pick who speaks</h2>
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
		sideCharacters={sideCharacterOptions}
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
		excludeIds={(session?.sessionPersonas ?? [])
			.filter((cp) => !cp.removedAt)
			.map((cp) => cp.personaId)
			.filter((id): id is number => id != null)}
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
		{#if session?.lorebookId && (session.userId === userCtx.user?.id || userCtx.user?.isAdmin)}
			<SessionWorkflowTab
				lorebookId={session.lorebookId}
				{sceneList}
				onOpenEntry={handleOpenEntry}
				onEnterSummarizationMode={offersWrite("lore")
					? enterSummarizationModeEmpty
					: undefined}
			/>

			<!--
				"The answer goes where the question is asked" (ruling
				2026-09-08, 4.4). Both halves of it live here, under the tab
				the author already opens to think about lore:

				· What WOULD fire, if they sent the message currently in the
				  box. On a button, never on a keystroke — a turn is a real run
				  with a real embedding call behind it (`EntryFireTest`'s rule).
				· What HAS fired in this conversation, which is the question no
				  single turn can answer and the one that catches an entry
				  that has never once come in.

				The persona is the CURRENT one rather than the session's first:
				a persona switch changes which character lore is in scope, so
				answering from the first would answer about somebody else.
			-->
			<div
				class="border-surface-300-700 mt-3 flex flex-col gap-3 border-t pt-3"
			>
				<SessionRetrievalPreview
					sessionId={session.id}
					content={newMessage}
					personaId={currentUserPersona?.personaId ||
						session?.sessionPersonas?.[0]?.personaId ||
						null}
					disabledReason={(session?.sessionCharacters ?? []).some(
						(cc) => cc.isActive && !cc.removedAt
					)
						? null
						: "Add a character to this conversation to see what its next reply would pull in."}
				/>
				<SessionUsagePanel sessionId={session.id} />
			</div>
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
			<!-- Continue and Regenerate are core's `retry`/`continue` at the
			     extra venue (R-15, U5c): present when the genre offers the
			     verb, off the one action list. -->
			<!-- Greyed, not disabled (S6): `aria-disabled` keeps the chip in
			     the tab order and the reason — the listed verdict's, or the
			     newest row's — reaches a screen reader through
			     `aria-describedby`; the click is guarded instead. -->
			{#if charactersInMode && extraAction("continue")}
				{@const t = extraAction("continue")!}
				{@const chip = extraChip(t, [[needsPersona, NO_PERSONA]])}
				<button
					class="btn btn-sm preset-tonal-primary"
					class:opacity-60={chip.disabled}
					class:cursor-not-allowed={chip.disabled}
					title={chip.reason
						? `Continue — ${chip.reason}`
						: "Continue the conversation"}
					aria-disabled={chip.disabled}
					aria-describedby={chip.reason
						? "extra-note-continue"
						: undefined}
					onclick={(e) =>
						chip.disabled
							? e.preventDefault()
							: handleTriggerContinueConversation(e)}
				>
					<Icons.MessageSquareMore size={14} />
					Continue
				</button>
				{#if chip.reason}
					<span id="extra-note-continue" class="sr-only">
						{chip.reason}
					</span>
				{/if}
			{/if}
			{#if charactersInMode}
				{@const pick = needsPersona
					? { disabled: true, reason: NO_PERSONA }
					: !session || lastMessage?.isGenerating
						? { disabled: true, reason: VERB_REASONS.generating }
						: { disabled: false, reason: undefined }}
				<button
					class="btn btn-sm preset-tonal-secondary"
					class:opacity-60={pick.disabled}
					class:cursor-not-allowed={pick.disabled}
					title={pick.reason
						? `Pick who speaks — ${pick.reason}`
						: "Pick who speaks"}
					aria-disabled={pick.disabled}
					aria-describedby={pick.reason
						? "extra-note-pick"
						: undefined}
					onclick={(e) =>
						pick.disabled
							? e.preventDefault()
							: handleTriggerCharacterMessage(e)}
				>
					<Icons.MessageSquarePlus size={14} />
					Pick who speaks
				</button>
				{#if pick.reason}
					<span id="extra-note-pick" class="sr-only">
						{pick.reason}
					</span>
				{/if}
			{/if}
			<!-- Absent, not disabled, when the genre does not offer retry
			     (R-15): a dice-are-final genre has no reply to redo. -->
			{#if extraAction("retry")}
				{@const t = extraAction("retry")!}
				{@const chip = extraChip(t)}
				<button
					class="btn btn-sm preset-tonal-warning"
					class:opacity-60={chip.disabled}
					class:cursor-not-allowed={chip.disabled}
					title={chip.reason
						? `Regenerate — ${chip.reason}`
						: "Regenerate the last reply"}
					aria-disabled={chip.disabled}
					aria-describedby={chip.reason
						? "extra-note-retry"
						: undefined}
					onclick={(e) =>
						chip.disabled
							? e.preventDefault()
							: handleRegenerateLastMessage(e)}
				>
					<Icons.RefreshCw size={14} />
					Regenerate
				</button>
				{#if chip.reason}
					<span id="extra-note-retry" class="sr-only">
						{chip.reason}
					</span>
				{/if}
			{/if}
		</div>
	{/snippet}

	<!-- The contributed trigger set (19 §4): rendered from rows, so a retired
	     contributor takes its button with it. It is the composer's own action
	     row rather than a tab panel, because an action the genre contributes is
	     how that genre is played and must not need a tab opened first. The
	     narrate function keeps its bespoke presentation — the resolved narrator
	     name and its instructions modal — mapped on the function key. -->
	<!-- The run in flight, above the composer (a host view, C0b). -->
	{#snippet runProgress()}
		{#if session?.id}
			<RunProgressCard sessionId={session.id} />
		{/if}
	{/snippet}

	{#snippet ragNotice()}
		{#if session?.id}
			<RagNotice
				sessionId={session.id}
				totalMessages={session.sessionMessages?.length ?? 0}
			/>
		{/if}
	{/snippet}

	{#snippet sessionActionsRow()}
		<!-- Keyed by the action's identity (W3): two actions on one function
		     — core's and a plugin's `summarize` — are two chips. -->
		{#each sessionActions as t (actionIdentity(t))}
			{@const chip = paletteRowState(chipVerdict(t), {
				generating: !session || !!lastMessage?.isGenerating,
				newest: newestItem
			})}
			{@const chipNoteId = `chip-note-${actionIdentity(t).replace(/[^a-z0-9-]/g, "-")}`}
			<!-- Greyed, not disabled (S6): `aria-disabled` keeps the chip in
			     the tab order and the reason reaches a screen reader through
			     `aria-describedby`; a native `disabled` is skipped and says
			     nothing. The click is guarded instead. -->
			<!-- `narrate-character` deliberately falls through to the generic
			     branch: `fireTrigger` routes it to the same modal, whose first
			     step is the choice between the two. A second bespoke button
			     here would be a second place to keep in step with the
			     narrator's resolved name. -->
			{#if actionIdentity(t) === NARRATE_ACTION}
				<button
					class="btn btn-sm preset-tonal-success"
					class:opacity-60={chip.disabled}
					class:cursor-not-allowed={chip.disabled}
					title={chip.reason
						? `${narratorName} — ${chip.reason}`
						: "Ask the narrator"}
					aria-disabled={chip.disabled}
					aria-describedby={chip.reason ? chipNoteId : undefined}
					onclick={(e) =>
						chip.disabled
							? e.preventDefault()
							: handleTriggerNarratorResponse(e)}
				>
					<Icons.CloudSun size={14} />
					{narratorName}
				</button>
			{:else}
				{@const TriggerIconComponent = triggerIcon(t.icon)}
				<!-- Seen by the audience's `see`, pressable by its `act` (R-15):
				     a guest sees the genre's vocabulary and is told, not
				     shown nothing. -->
				<button
					class="btn btn-sm preset-tonal-success"
					class:opacity-60={chip.disabled}
					class:cursor-not-allowed={chip.disabled}
					title={chip.reason ? `${t.name} — ${chip.reason}` : t.name}
					aria-disabled={chip.disabled}
					aria-describedby={chip.reason ? chipNoteId : undefined}
					onclick={(e) =>
						chip.disabled ? e.preventDefault() : fireTrigger(t)}
				>
					<TriggerIconComponent size={14} />
					{t.name}
				</button>
			{/if}
			{#if chip.reason}
				<span id={chipNoteId} class="sr-only">{chip.reason}</span>
			{/if}
		{/each}
	{/snippet}

	{#snippet statisticsButton()}
		<Icons.BarChart2 size="0.75em" />
	{/snippet}

	{#snippet statisticsContent()}
		<div class="mb-[0.5em] flex flex-wrap items-center gap-3">
			<button
				class="btn btn-sm preset-tonal-primary"
				title="View full prompt details"
				onclick={() => {
					// The draft is the subject again; a message report left
					// standing here would put a finished reply behind a button
					// labelled with the draft's own numbers.
					messageReport = undefined
					showDraftCompiledPromptModal = true
				}}
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
