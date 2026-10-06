<script lang="ts">
	import { v4 as uuid } from "uuid"
	import { avatarSrc, withRevisedAvatar } from "$lib/client/utils/media"
	import {
		setHostParticipants,
		setHostViews
	} from "$lib/client/components/hostElements/context.svelte"
	import ChangeSpriteDialog from "$lib/client/components/sprites/ChangeSpriteDialog.svelte"
	import PanelFilterInput from "$lib/client/components/panels/PanelFilterInput.svelte"
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
		SESSION_STATE_KEY,
		SESSION_CHARACTERS_KEY,
		WIDGET_REQUESTS_KEY,
		type WidgetRequestHandler
	} from "$lib/shared/widgets/context"
	import {
		canRegenerateNewest,
		canSwipeRight as swipeRightAllowed,
		lastAuthorLine,
		showSwipeControls as swipeRowShown
	} from "$lib/client/components/sessionPage/swipeControls"
	import { guardWidgetRequests } from "$lib/client/components/sessionPage/requests/askers"
	import { answerSetAttributeValue } from "$lib/client/components/sessionPage/requests/setAttributeValue"
	import { createPendingAsks } from "$lib/client/components/sessionPage/requests/pendingAsks"
	import {
		answerSetSpriteSet,
		settleSpriteSetReply,
		spriteSetReplyKey,
		spriteSetWrite
	} from "$lib/client/components/sessionPage/requests/setSpriteSet"
	import { answerClearSceneImage } from "$lib/client/components/sessionPage/requests/clearSceneImage"
	import { answerMessages } from "$lib/client/components/sessionPage/requests/messages"
	import { answerOpenCharacter } from "$lib/client/components/sessionPage/requests/openCharacter"
	import { answerViewAvatar } from "$lib/client/components/sessionPage/requests/viewAvatar"
	import {
		answerViewImage,
		type ViewImageGallery
	} from "$lib/client/components/sessionPage/requests/viewImage"
	import { answerOpenLore } from "$lib/client/components/sessionPage/requests/openLore"
	import { answerPromptDetails } from "$lib/client/components/sessionPage/requests/promptDetails"
	import { answerInspectRun } from "$lib/client/components/sessionPage/requests/inspectRun"
	import { answerPickTurn } from "$lib/client/components/sessionPage/requests/pickTurn"
	import { answerChangeSprite } from "$lib/client/components/sessionPage/requests/changeSprite"
	import { answerActionsSeen } from "$lib/client/components/sessionPage/requests/actionsSeen"
	import { answerSummarize } from "$lib/client/components/sessionPage/requests/summarize"
	import { answerSend } from "$lib/client/components/sessionPage/requests/send"
	import {
		answerAttachFiles,
		answerRemoveAttachment,
		answerRemoveTrayItem
	} from "$lib/client/components/sessionPage/requests/attachments"
	import { createComposerTray } from "$lib/client/components/sessionPage/attachments/composerTray.svelte"
	import { answerDraft } from "$lib/client/components/sessionPage/requests/draft"
	import {
		collectedFire,
		createNarrations,
		holdsOf,
		narrateDirectly,
		nextDraftWrite,
		opensModal,
		routePress,
		draftHolds,
		draftToGiveBack,
		type Collected,
		type SpentDraft,
		type DraftWrite,
		type ListedCollects,
		type NarratorRequest
	} from "$lib/client/components/sessionPage/collects"
	import { actionTitle } from "$lib/client/components/sessionPage/actionTitle"
	import { answerSwitchPersona } from "$lib/client/components/sessionPage/requests/switchPersona"
	import { answerAddPersona } from "$lib/client/components/sessionPage/requests/addPersona"
	import { answerFireTurn } from "$lib/client/components/sessionPage/requests/fireTurn"
	import {
		fireTurn,
		fireTurnRefusal,
		pushSaysNoReply
	} from "$lib/client/components/sessionPage/turnControls"
	import { answerDecideProposal } from "$lib/client/components/sessionPage/requests/decideProposal"
	import { ScenePins } from "$lib/client/components/sessionPage/scenePins.svelte"
	import { hearLoreRanked } from "$lib/client/components/sessionPage/loreRanked"
	import { hearLoreMarked } from "$lib/client/components/sessionPage/loreMarked"
	import { hearGenreFieldsChanged } from "$lib/client/components/sessionPage/genreFieldsChanged"
	import {
		answerSessionEntries,
		hearSessionEntries,
		sessionEntriesReplyKey,
		tokenedEntriesRead
	} from "$lib/client/components/sessionPage/requests/sessionEntries"
	import {
		answerSetEntryMarks,
		entryMarksReplyKey,
		entryMarksWrite
	} from "$lib/client/components/sessionPage/requests/setEntryMarks"
	import {
		answerAuthorsNote,
		answerSetAuthorsNote,
		authorsNoteReplyKey,
		tokenedAsk
	} from "$lib/client/components/sessionPage/requests/authorsNote"
	import { projectSessionState } from "$lib/client/components/sessionPage/projections/sessionState"
	import { charactersSection } from "$lib/client/components/sessionPage/projections/charactersSection.svelte"
	import { coreDefaultWidgets } from "$lib/client/components/sessionPage/coreWidgets"
	import {
		EMPTY_TURN_ORDER,
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
		messageSpeaker,
		personLineName
	} from "$lib/client/utils/messageSpeaker"
	import { ownVoiceName } from "$lib/shared/sessions/ownVoiceName"
	import {
		resolvePlayerLabel,
		storedPlayerLabel
	} from "$lib/shared/sessions/playerLabel"
	import RunProgressCard from "$lib/client/components/pipelines/RunProgressCard.svelte"
	import { runProgress } from "$lib/client/stores/runProgress.svelte"
	import type { RunProgress } from "$lib/shared/sockets/progress"
	import { page } from "$app/state"
	import { goto, replaceState } from "$app/navigation"
	import {
		LANDING_SEEK_FRAMES,
		landingTarget,
		nextLandingStep,
		readMessageLanding,
		withoutLanding
	} from "$lib/client/sessions/messageLanding"
	import { landOn } from "$lib/client/utils/landOn"
	import { Dialog, Portal, Popover } from "@skeletonlabs/skeleton-svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import {
		declareInterest,
		onConnect,
		useInterest
	} from "$lib/client/sockets/interest.svelte"
	import { interestKey } from "$lib/shared/sockets/interest"
	import * as Icons from "@lucide/svelte"
	import PluginFrame from "$lib/client/components/frames/PluginFrame.svelte"
	import TurnPicker from "$lib/client/components/sessionPage/TurnPicker.svelte"
	import { createRemoteFaces } from "$lib/client/components/sessionPage/remoteFace"
	import {
		authoredOwnersOf,
		authoredReloadKeys,
		retargetAuthoredSrc
	} from "$lib/client/components/sessionPage/authoredReload"
	import ProcessSceneModal from "$lib/client/components/modals/ProcessSceneModal.svelte"
	import { canAnswerForm as formAnswerVerdict } from "$lib/client/utils/formAnswer"
	import { getAllContexts, getContext, onDestroy, onMount, setContext, untrack } from "svelte"
	import { statusText, t } from "$lib/client/i18n/state.svelte"
	import { itemValuesOf } from "$lib/shared/actions/itemValues"
	import Avatar from "$lib/client/components/Avatar.svelte"
	import PersonaSelectModal from "$lib/client/components/modals/PersonaSelectModal.svelte"
	import BranchSessionModal from "$lib/client/components/modals/BranchSessionModal.svelte"
	import SummarizeLoreModal from "$lib/client/components/modals/SummarizeLoreModal.svelte"
	import NarratorResponseModal from "$lib/client/components/modals/NarratorResponseModal.svelte"
	import RetakeConfirm from "$lib/client/components/sessionPage/RetakeConfirm.svelte"
	import CollectModal from "$lib/client/components/sessionPage/CollectModal.svelte"
	import {
		createRetake,
		retakeQuietly,
		RETAKE_QUIETLY,
		type RetakeRow
	} from "$lib/client/components/sessionPage/retake"
	import EntityGalleryViewModal from "$lib/client/components/gallery/EntityGalleryViewModal.svelte"
	import MediaLightbox from "$lib/client/components/sessionPage/MediaLightbox.svelte"
	import {
		lightboxStateOf,
		type LightboxState
	} from "$lib/client/components/sessionPage/mediaLightbox"
	import { runThatWrote } from "$lib/client/components/sessionPage/runInspection"
	import { runInspector } from "$lib/client/stores/runInspector.svelte"
	import { terminateAllWorkers } from "$lib/client/components/host/uiWorkers"
	import SessionSceneImagesTab from "$lib/client/components/sessionPage/SessionSceneImagesTab.svelte"
	import SessionWorkflowTab from "$lib/client/components/sessionPage/SessionWorkflowTab.svelte"
	import RagNotice from "$lib/client/components/sessionPage/RagNotice.svelte"
	import ActionLegend from "$lib/client/components/sessionPage/ActionLegend.svelte"
	import {
		legendSections,
		type LegendVerdict
	} from "$lib/client/components/sessionPage/actionLegend"
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
	import { LayoutCopyAsks } from "$lib/client/sessionLayout/layoutCopyAsks"
	import { LayoutAsks, olderThanHeld } from "$lib/client/sessionLayout/layoutAsks"
	import { quoted as quotedLayoutName } from "$lib/client/sessionLayout/startFrom"
	import { setWidgetStylePins } from "$lib/client/stores/widgetStyles.svelte"
	import {
		setWidgetSettingValues,
		setWidgetSettingsWriter
	} from "$lib/client/stores/widgetSettings.svelte"
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
	import { paletteRowState } from "@serene-pub/core-catalog/conversation"
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

	/**
	 * The loaded session's ids and scalars as PRIMITIVES — what this page's
	 * effects and its children's props read, never `session` itself.
	 *
	 * `session` is REPLACED on every streamed chunk (`handleSessionMessage`
	 * builds a new object around the new message array). An effect reading
	 * through it re-runs per token, and a prop written `{session.id}` — a bare
	 * member chain, which compiles to a getter over `session` rather than a
	 * memoised `$derived` — re-runs the child's effects the same way: six
	 * keys re-declared and `storyTime` + `entries:list` re-asked per token in
	 * SessionWorkflowTab, `bindingList` and `getNarratorName` re-asked here,
	 * the persona pick reset (B8's request storm). A `$derived` compares its
	 * value, so what reads these re-runs only when it moves.
	 * Pinned by `sessionPage/streamedSessionReads.test.ts`.
	 */
	const loadedSessionId = $derived(session?.id ?? null)
	const sessionName = $derived(session?.name ?? null)
	const sessionUserId = $derived(session?.userId ?? null)
	const sessionLorebookId = $derived(session?.lorebookId ?? null)
	const sessionLorebookBranchId = $derived(session?.lorebookBranchId ?? null)
	const loadedGenreId: string | null = $derived(
		typeof (session as any)?.genreId === "string" ? (session as any).genreId : null
	)
	const storyClockYear = $derived(session?.storyClockYear ?? null)
	const storyClockMonth = $derived(session?.storyClockMonth ?? null)
	const storyClockDay = $derived(session?.storyClockDay ?? null)
	/** A new object only when the clock moves, so readers of it re-derive only then. */
	const sessionStoryClock = $derived(
		storyClockYear != null
			? { year: storyClockYear, month: storyClockMonth, day: storyClockDay }
			: null
	)

	// Lets globally-rendered sidebars (e.g. LorebooksSidebar) know which session
	// is open and whether it already has a lorebook, without a fetch of their own,
	// and carries the session's identity — name, cast, genre — to the header,
	// which renders beside this page rather than inside it.
	//
	// The two OBJECT fields each get an effect of their own: `openSessionCtx`
	// is a `$state` proxy, so assigning an object re-proxies it and re-runs
	// every reader of the field, even when it is the same object. Shared with
	// `isGenerating`, which flips as a reply starts and ends, the clock and the
	// cast were re-sent to the lorebooks rail and the header with it.
	// Pinned by `sessionPage/streamedSessionReads.test.ts`.
	$effect(() => {
		openSessionCtx.storyClock = sessionStoryClock
	})
	$effect(() => {
		openSessionCtx.cast = headerCast
	})
	$effect(() => {
		openSessionCtx.sessionId = loadedSessionId
		openSessionCtx.sessionName = sessionName
		openSessionCtx.genreName = genreName
		openSessionCtx.lorebookId = sessionLorebookId
		openSessionCtx.lorebookBranchId = sessionLorebookBranchId
		openSessionCtx.isOwner =
			sessionUserId !== null && sessionUserId === userCtx.user?.id
		// The shell's spine shows it while a view is focused over the story.
		openSessionCtx.isGenerating = hasGeneratingMessage
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
		if (!sessionId || loadedSessionId === null || !content.trim()) return
		const now = Date.now()
		if (now - lastTypingEmitAt < 2500) return
		lastTypingEmitAt = now
		// Untracked: the ping answers the draft changing, never a streamed
		// chunk replacing `session` — which would tell the room this person
		// is typing for as long as a reply streams with text in the box.
		const personaId = untrack(
			() =>
				currentUserPersona?.personaId ||
				session?.sessionPersonas?.[0]?.personaId
		)
		if (personaId) socket.emit("sessions:typing", { sessionId, personaId })
	})

	// ── Draft autosave ────────────────────────────────────────────────────────
	// Debounce-save newMessage to the server as the user types.
	// Only runs when the session is loaded (session !== undefined) to avoid
	// clobbering another user's draft during a session transition.
	$effect(() => {
		const content = newMessage
		const currentSessionId = sessionId
		if (!currentSessionId || loadedSessionId === null) return
		const timer = setTimeout(() => {
			socket.emit("sessions:saveDraft", {
				sessionId: currentSessionId,
				content
			})
		}, 500)
		return () => clearTimeout(timer)
	})

	let promptTokenCountTimeout: ReturnType<typeof setTimeout> | null = null
	let autoAdvanceTimeout: ReturnType<typeof setTimeout> | null = null
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
	 * token readout reads it. Opening a message's report must never overwrite
	 * it: that would show a finished reply's numbers as the draft's until the
	 * next keystroke recompiled — a report about one thing shown as the state
	 * of another.
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
	let showPickSpeakerModal = $state(false)
	let pickSpeakerSearch = $state("")
	let showNarratorResponseModal = $state(false)
	/**
	 * What the narrator modal held when its press did not land — refused
	 * before its run, stopped, or failed (C2 follow-up): kept as a refused
	 * `/narrate <text>` keeps its draft, and the modal opens with it until it
	 * fires again. This session's only: cleared on a switch of session with
	 * the draft.
	 */
	let narratorUnlandedPress = $state<NarratorRequest | null>(null)
	/** The narrator's presses and answers (C2) — `createNarrations`. */
	const narrations = createNarrations({
		sessionId: () => sessionId,
		draft: () => newMessage,
		writeDraft: (content) => writeDraft(content),
		keepUnlanded: (press) => (narratorUnlandedPress = press),
		say: (error) =>
			toaster.error({
				title: listedAction(NARRATE_ACTION)?.name ?? "Narrate",
				description: error
			}),
		send: (params) => socket.emit("sessions:fireNarratorResponse", params)
	})
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
	// -> system default -> "Narrator"); labels the trigger button/
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
	/**
	 * What a block press of a form-venue action collects (lair pass R9) —
	 * those actions are listed in no venue, so `listedAction` cannot find
	 * them; `collectingAction` reads here after the venues.
	 */
	let formCollects = $state<NonNullable<Sockets.Sessions.Actions.Response["formCollects"]>>({})
	/**
	 * Every other channel's listing (lair re-plan S1), by slug: a composer on
	 * the Sanctum draws the Sanctum's chips and turn controls — Continue and
	 * Narrate, never Pick or retake there. `main`'s is `actionVenues`, which
	 * every other reader keeps; these arrive beside it, asked for each time
	 * `main`'s does (`handleSessionsActions`), so a run's end refreshes both.
	 */
	let channelVenues = $state<
		Record<string, Sockets.Sessions.Actions.Response["venues"]>
	>({})
	const onOtherChannel = (channel?: string): channel is string =>
		!!channel && channel !== DEFAULT_CHANNEL
	/** One venue of a channel's listing — `main`'s when none is named. */
	const venueOn = (kind: string, channel?: string) =>
		onOtherChannel(channel)
			? (channelVenues[channel]?.[kind] ?? { primary: [], overflow: [] })
			: venueOf(kind)
	const venueOf = (kind: string) =>
		actionVenues[kind] ?? { primary: [], overflow: [] }
	/**
	 * The composer venue's primary set — the chips. A genre that contributes
	 * none gets no row at all, which is what keeps the composer of a genre
	 * with nothing to press exactly as wide as its message field.
	 */
	let sessionActions = $derived(venueOf("composer").primary)
	/**
	 * The ONE chip of the composer's Actions row (note 30, 2026-10-02): the
	 * turn controls and the genre's actions alike. The row's widget sheet
	 * (`messages.composer-actions`) draws its colour and shape; this is the
	 * button underneath it.
	 */
	const sessionChipClass = "btn btn-sm preset-tonal-surface"
	/** …and its overflow: every enabled action the chips leave out (F38). */
	let composerOverflow = $derived(venueOf("composer").overflow)
	/** The More menu's list — primary then overflow, every enabled action, quick or not (NOMENCLATURE overflow). */
	let composerMenuActions = $derived([...sessionActions, ...composerOverflow])
	/** The message venue, handed to every row. */
	let messageActions = $derived(venueOf("message"))
	/** The extra tab's — the turn controls and Regenerate, when the server lists them. */
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
				: {}),
			// What it collects (R3): whether it takes a slash argument (S2).
			...(a.collects ? { collects: a.collects } : {})
		}))
	)
	/**
	 * What a composer press of a message action acts on — the newest row's
	 * `item` document, the same shape the message row and the server's door
	 * build — or `null` for a session with no row, which fails every `item.*`
	 * predicate: nothing to regenerate, extend or swipe.
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
	 * and `advance` at the **extra** venue; `retry` acts on the newest
	 * row: their state is the listed verdict plus the `item.*` predicates
	 * judged against `newestItem`, exactly as the `/` palette judges the
	 * same rows (review pass 3). The bespoke handlers stay the click
	 * targets; only the grey decision is the list's.
	 */
	const extraAction = (key: string) =>
		extraActions.find((a) => a.specSlug === "core" && a.key === key)
	/** A turn control on a channel's listing (S1) — `extraAction` for `main`. */
	const extraActionOn = (key: string, channel?: string) =>
		onOtherChannel(channel)
			? [...venueOn("extra", channel).primary, ...venueOn("extra", channel).overflow].find(
					(a) => a.specSlug === "core" && a.key === key
				)
			: extraAction(key)
	const extraChip = (
		t: Sockets.Sessions.Actions.Action,
		busy: [holds: boolean, reason: string][] = []
	) => {
		for (const [holds, reason] of busy)
			if (holds) return { disabled: true, reason }
		return paletteRowState(chipVerdict(t), {
			generating: !session || !!lastMessage?.isGenerating,
			newest: newestItem,
			// The reason for a failed `item.*` predicate, in the viewer's
			// language: the app's own `statusText`, as `chipVerdict` resolves
			// the listed reason.
			statusText
		})
	}
	/** A persona-less session cannot take a turn — the one client-side condition the turn controls keep. */
	const NO_PERSONA = "add a persona first"
	/**
	 * The action legend's verdict (2026-09-28): the one each row's own button
	 * reads — the chips', the turn controls' and the message menu's — so the
	 * legend greys exactly what is grey. A message row is judged without a
	 * row: its `item.*` predicates are per message, and the menu says those.
	 */
	const legendVerdict: LegendVerdict = (t, venue) => {
		const generating = !session || !!lastMessage?.isGenerating
		if (venue === "composer")
			return paletteRowState(chipVerdict(t), { generating, newest: newestItem, statusText })
		if (venue === "extra")
			return extraChip(
				t,
				t.specSlug === "core" && (t.key === "advance" || t.key === "pick")
					? [[needsPersona, NO_PERSONA]]
					: []
			)
		return paletteRowState(chipVerdict(t), { generating, statusText })
	}
	/** Every action this session offers right now, by venue — the legend's rows. */
	let actionLegend = $derived(
		// The narrate chip wears the narrator's resolved name and its own icon;
		// its legend row wears the same, so the two cannot disagree.
		legendSections(actionVenues, legendVerdict).map((s) => ({
			...s,
			entries: s.entries.map((e) =>
				e.identity === NARRATE_ACTION && s.venue === "composer"
					? { ...e, name: narratorName, icon: "cloud-sun", iconAlt: narratorName }
					: e
			)
		}))
	)
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
	 * What the pipeline's own voice is called (lair re-plan R5): the null
	 * turn entry and every line nobody claims — the genre's fallback envoy
	 * (declared, seated or not: the Lair's Castellan), else the narrator
	 * name above, else `UNCLAIMED_LINE_NAME`. The one rule
	 * (`ownVoiceName`) the ready line, the pickers' narrator row and the
	 * message names read; the server's seed line and progress card read it
	 * too. Chat's narrate *function* keeps `narratorName`.
	 */
	let ownVoice = $derived(
		ownVoiceName(
			{ envoys: sessionFrames?.envoys, narratorName },
			sessionFrames?.language ?? "en"
		)
	)
	/**
	 * Why Extend is unavailable on this session's messages, when it is.
	 *
	 * Off `sessions:view`, which the page already fetches once when a session
	 * opens and which already reads the genre — half the answer (`messageVerbs`)
	 * was there anyway, and the other half is the connection the replies resolve
	 * to. Session-level, so the button is disabled with the same sentence on
	 * every message rather than asking per row.
	 *
	 * ⚠ An affordance, not the enforcement. `sessionMessagesExtendHandler`
	 * refuses with this same sentence from the same resolution, so a stale value
	 * (an admin repointing the instance default while this page is open) costs a
	 * refusal message and never a wrong generation.
	 */
	const extendRefusal = $derived(sessionFrames?.extendRefusal)
	/**
	 * Which forbiddable message verbs this session's genre offers (R-15) —
	 * off the action list's message venue (U5c), the ONE list every verb
	 * control renders from: a forbidden opt-in built-in (`delete`, `hide`,
	 * `swipe`) or a forbidden `retry` is simply not listed, and the floors
	 * always are. Until the list has arrived, `sessions:view`'s
	 * `messageVerbs` answers, so the controls do not flash off and on while
	 * the page loads. An affordance, like `extendRefusal`: the handler
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
		// A session whose genre lacks the chosen channel — a preset
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
	 * Which run wrote a reply (R55; `runInspection.ts`), for the conversation's
	 * `inspect-run` request below: the page asks the server and opens the
	 * inspector, so the conversation reaches neither the socket nor the store.
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
	 * 🚧 The asks a widget's request is waiting on a socket reply for
	 * (`sessionPage/requests/pendingAsks.ts`) — one table per event, so a
	 * reply settles exactly one ask and a reply nobody here asked for (another
	 * tab's) settles none. The sprite-set reply is heard by the page's own
	 * standing `sessions:setSpriteSet` interest (`handleSetSpriteSetReply`);
	 * the two lore tables listen only while an ask waits.
	 */
	const spriteSetAsks = createPendingAsks<
		Sockets.Sessions.SetSpriteSet.Params,
		Sockets.Sessions.SetSpriteSet.Response
	>({
		emit: (ask) => socket.emit("sessions:setSpriteSet", ask),
		keyOf: spriteSetReplyKey,
		timeout: "the sprite set did not change: the server did not answer"
	})
	const entriesAsks = createPendingAsks<
		Sockets.Entries.SessionEntries.Params,
		Sockets.Entries.SessionEntries.Response
	>({
		emit: (ask) => socket.emit("entries:sessionEntries", ask),
		listen: hearSessionEntries({
			reply: (onReply) => declareInterest<"entries:sessionEntries">("entries:sessionEntries", onReply),
			refusal: (onRefusal) =>
				declareInterest<"entries:sessionEntries:error">("entries:sessionEntries:error", onRefusal)
		}),
		keyOf: sessionEntriesReplyKey,
		timeout: "the lore entries did not arrive: the server did not answer"
	})
	const readSessionEntries = tokenedEntriesRead(entriesAsks)
	const entryMarksAsks = createPendingAsks<
		Sockets.Entries.SetMarks.Params,
		Sockets.Entries.SetMarks.Response
	>({
		emit: (ask) => socket.emit("entries:setMarks", ask),
		listen: (onReply) => {
			const refused = declareInterest<"entries:setMarks:error">("entries:setMarks:error", onReply)
			const done = declareInterest<"entries:setMarks">("entries:setMarks", onReply)
			return () => {
				done()
				refused()
			}
		},
		keyOf: entryMarksReplyKey,
		timeout: "the marks did not change: the server did not answer"
	})
	const writeEntryMarks = entryMarksWrite(entryMarksAsks)
	// 🚧 The author's note (AN1): one table per event, each ask tokened.
	const authorsNoteAsks = createPendingAsks<
		Sockets.Sessions.AuthorsNote.Params,
		Sockets.Sessions.AuthorsNote.Response
	>({
		emit: (ask) => socket.emit("sessions:authorsNote", ask),
		listen: (onReply) => {
			const refused = declareInterest<"sessions:authorsNote:error">("sessions:authorsNote:error", onReply)
			const done = declareInterest<"sessions:authorsNote">("sessions:authorsNote", onReply)
			return () => {
				done()
				refused()
			}
		},
		keyOf: authorsNoteReplyKey,
		timeout: "the author's note did not arrive: the server did not answer"
	})
	const setAuthorsNoteAsks = createPendingAsks<
		Sockets.Sessions.SetAuthorsNote.Params,
		Sockets.Sessions.SetAuthorsNote.Response
	>({
		emit: (ask) => socket.emit("sessions:setAuthorsNote", ask),
		listen: (onReply) => {
			const refused = declareInterest<"sessions:setAuthorsNote:error">(
				"sessions:setAuthorsNote:error",
				onReply
			)
			const done = declareInterest<"sessions:setAuthorsNote">("sessions:setAuthorsNote", onReply)
			return () => {
				done()
				refused()
			}
		},
		keyOf: authorsNoteReplyKey,
		timeout: "the author's note was not saved: the server did not answer"
	})
	const readAuthorsNote = tokenedAsk(authorsNoteAsks, "widget-authors-note")
	const writeAuthorsNote = tokenedAsk(setAuthorsNoteAsks, "widget-set-authors-note")
	onDestroy(() => {
		const why = "the session page closed before the server answered"
		spriteSetAsks.drop(why)
		entriesAsks.drop(why)
		entryMarksAsks.drop(why)
		authorsNoteAsks.drop(why)
		setAuthorsNoteAsks.drop(why)
	})

	/**
	 * What a widget may ask this page for (C0b) — one handler for a frame and
	 * a remote. Each kind opens something of the page's
	 * own; the widget sees only that it was done (or why not). WHO may ask
	 * each kind is the SDK's askers table, enforced in front of this by
	 * `guardWidgetRequests` (F9) — core's writes to core's widgets, a scoped
	 * read to a widget holding its scope — so no case below repeats it.
	 */
	const answerWidgetRequest: WidgetRequestHandler = async (kind, params, from) => {
		const p = params as Record<string, unknown>
		switch (kind) {
			case "messages":
				return (await answerMessages(p, { olderPage })) as never
			case "open-character":
				answerOpenCharacter(p, {
					openCharactersPanel: () => panelsCtx.openPanel({ key: "characters", toggle: false }),
					viewCharacter: (id) => (panelsCtx.digest.viewCharacterId = id)
				})
				return undefined as never
			case "view-avatar":
				answerViewAvatar(p, { characterForRef, viewAvatar: handleAvatarClick })
				return undefined as never
			case "view-image":
				answerViewImage(p, from, { viewImage: handleImageClick })
				return undefined as never
			case "open-lore":
				answerOpenLore(p, {
					showLore: (target) => (panelsCtx.digest.lore = target as any),
					openLorebooksPanel: () => panelsCtx.openPanel({ key: "lorebooks", toggle: false })
				})
				return undefined as never
			case "prompt-details":
				answerPromptDetails(p, {
					isAdmin: !!userCtx.user?.isAdmin,
					contextDebugging: !!systemSettingsCtx.settings?.contextDebuggingEnabled,
					findMessage: (id) => session?.sessionMessages.find((m) => m.id === id),
					showReport: (report) => {
						messageReport = report
						showDraftCompiledPromptModal = true
					}
				})
				return undefined as never
			case "inspect-run":
				await answerInspectRun(p, {
					isAdmin: !!userCtx.user?.isAdmin,
					runOfMessage,
					openRun: (runId) => runInspector.open(runId)
				})
				return undefined as never
			case "pick-turn":
				answerPickTurn(p, { showTurnPicker: () => (showTurnPicker = true) })
				return undefined as never
			case "actions-seen":
				answerActionsSeen(p, { markActionsSeen })
				return undefined as never
			case "summarize":
				answerSummarize(p, {
					scened: scenedMessageIds,
					opensScenes: () => offersWrite("scenes"),
					select: (ids) => (selectedMessageIds = new Set(ids)),
					openSummarize: openSummarizeModal,
					summarizeOpen: () => showSummarizeModal
				})
				return undefined as never
			case "send":
				answerSend(p, {
					setDraft: (content) => (newMessage = content),
					channels: sessionChannels,
					setChannel: (channel) => (composerChannel = channel),
					switchPersona,
					send: handleSend
				})
				return undefined as never
			case "draft":
				answerDraft(p, { setDraft: (content) => (newMessage = content) })
				return undefined as never
			case "attach-files":
				answerAttachFiles(p, composerTray)
				return undefined as never
			case "remove-tray-item":
				answerRemoveTrayItem(p, composerTray)
				return undefined as never
			case "remove-attachment":
				answerRemoveAttachment(p, composerTray)
				return undefined as never
			case "switch-persona":
				answerSwitchPersona(p, { switchPersona })
				return undefined as never
			case "fire-turn":
				answerFireTurn(p, {
					fireTurn: (channel) => handleContinueWithNextCharacter(channel)
				})
				return undefined as never
			case "decide-proposal":
				answerDecideProposal(p, { decide: (id, accept) => stateStore.decide(id, accept) })
				return undefined as never
			case "add-persona":
				answerAddPersona(p, { showAddPersona: () => (showAddPersonaModal = true) })
				return undefined as never
			case "set-attribute-value":
				// Core's state widgets (R21): the viewer's own edit at the
				// session layer; its refusal is the asking widget's (R77).
				return (await answerSetAttributeValue(p, stateStore, sessionId ?? null)) as never
			case "set-sprite-set":
				// Core's scene portraits (R21): judged against the cast the
				// widget was shown (R77 — offered only where allowed); the
				// server's refusal is the asking widget's, not a toast.
				return (await answerSetSpriteSet(
					p,
					sessionCharactersSection.current,
					sessionId ?? null,
					spriteSetWrite(spriteSetAsks)
				)) as never
			case "clear-scene-image":
				// The PAGE's pin (R77, F10): the one it persists, mirrors into
				// the store and projects, so page and widget never disagree.
				answerClearSceneImage(p, scenePins)
				return undefined as never
			case "session-entries":
				// The session's lore, paged by request (R58); `titleOrKey`
				// becomes the socket's `query`, and each ask takes its own reply.
				return (await answerSessionEntries(p, sessionId ?? null, readSessionEntries)) as never
			case "set-entry-marks":
				// Answered as this session reads the entry (A14).
				return (await answerSetEntryMarks(p, sessionId ?? null, writeEntryMarks)) as never
			case "authors-note":
				// 🚧 The session's author's note and the last reply's verdict (AN1).
				return (await answerAuthorsNote(p, sessionId ?? null, readAuthorsNote)) as never
			case "set-authors-note":
				// Saved by the session's owner; the server judges it (AN1).
				return (await answerSetAuthorsNote(p, sessionId ?? null, writeAuthorsNote)) as never
			case "change-sprite":
				answerChangeSprite(p, {
					findMessage: (id) => session?.sessionMessages.find((m) => m.id === id),
					canControl: canControlMessage,
					showSpritePicker: (msg) => (spriteLine = msg)
				})
				return undefined as never
		}
		throw new Error(`'${String(kind)}' is not something this page answers`)
	}
	setContext(WIDGET_REQUESTS_KEY, guardWidgetRequests(answerWidgetRequest))

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
	// This person's session layout, WHOLE (the copy model): the first open
	// copied a starting point in, so there is no base under it. What it
	// started from is provenance only — the editor's label, "Start again
	// from", and the Updated mark — and never read to draw.
	let panelLayoutBlob = $state<LayoutBlob>({})
	let layoutPresets = $state<Sockets.Sessions.LayoutPreset[]>([])
	let startedFromLayoutPresetId = $state<number | null>(null)
	let startedFromUpdated = $state(false)
	// When this session's layout was last copied in, as the last answer said.
	// Not drawn: it orders the answers — a started-from push about an OLDER
	// copy (read before a copy this tab asked for landed) is old news.
	let layoutCopiedAt: string | null = null
	// The answer to "what does deleting this preset touch?", held for exactly
	// one pending delete confirmation. `null` = nothing asked, or still asking;
	// `unknown` = the ask failed (the confirmation says so rather than wait).
	let layoutPresetUsage = $state<
		import("$lib/client/sessionLayout/startFrom").LayoutPresetUsage | null
	>(null)
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
	 * so the writer here needs nothing but the current blob. They are this
	 * person's own values and nothing else: a layout's own `widgetSettings`
	 * were copied into them when the session started from it.
	 */
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
	 * Core's default widgets for the standard chat — the widgets beside the
	 * conversation, from one table (`sessionPage/coreWidgets.ts`), each core's
	 * own remote component (R79). A custom mode's own widgets arrive via
	 * `sessions:view.modePanels` and are merged on top (mode wins by id).
	 */
	const CORE_DEFAULT_PANELS: Sockets.Sessions.View.ModePanel[] = coreDefaultWidgets()

	function persistPanelLayout(blob: LayoutBlob) {
		if (sessionId == null) return
		panelLayoutBlob = blob
		// Deliberately blob-only: omitting the other keys is what tells the
		// server to leave this person's style pins and widget settings alone.
		socket.emit("sessions:panelLayout:set", {
			sessionId,
			layout: blob as Record<string, unknown>
		})
	}

	/** The copies this tab asked for and has no answer to yet (see `startLayoutFrom`). */
	const layoutCopyAsks = new LayoutCopyAsks()

	/**
	 * Replace this session's layout by COPYING one in — a card (_Start from_),
	 * _Start again from "X"_, _Reset to genre default layout_ (the genre
	 * default's id), or `null` for _Start from scratch_. The server answers
	 * with the whole new layout, like `:get`, and the page re-seeds from it
	 * (`handleLayoutStartFrom`); nothing changes here until it does. Resolves
	 * whether the copy landed, so the open editor stops waiting on a refusal.
	 *
	 * A debounced blob save still waiting to go out is dropped first: sent
	 * after this ask, it could land after the copy and write the old layout
	 * back over it. If the copy is refused, that save is sent after all
	 * (`settleLayoutCopy`), so a drag made just before is not lost.
	 */
	function startLayoutFrom(layoutPresetId: number | null): Promise<boolean> {
		if (sessionId == null) return Promise.resolve(false)
		const landed = layoutCopyAsks.ask(surfaceManager.cancelPendingSave())
		socket.emit("sessions:panelLayout:startFrom", {
			sessionId,
			layoutPresetId
		})
		return landed
	}

	/**
	 * An answer to the oldest copy this tab asked for. A refused one gives
	 * back the blob save its ask dropped: the layout it would have replaced
	 * is still this session's, drag included. `false` when this tab asked
	 * for nothing (another tab's answer).
	 */
	function settleLayoutCopy(landed: boolean): boolean {
		return layoutCopyAsks.settle(landed, () => surfaceManager.persistNow())
	}

	/**
	 * _Save as new layout_: a new named layout from this session's layout,
	 * which this session then started from. Sends the arrangement — the
	 * manager's own slots, which the editor has just committed — and every
	 * widget instance the session draws (`drawn`, the floor's included: an
	 * empty layout still draws the conversation and the genre's panels); the
	 * server packs those instances' settings and style pins in with it.
	 */
	function saveLayoutPreset(name: string, drawn: string[], description?: string) {
		if (sessionId == null) return
		socket.emit("sessions:layoutPreset:save", {
			sessionId,
			name,
			...(description ? { description } : {}),
			layout: committedArrangement(),
			drawnWidgetIds: drawn
		})
	}

	/**
	 * The arrangement the editor just committed — the manager's own slots —
	 * as _Save as new layout_ and _Save changes to_ send it.
	 */
	function committedArrangement(): Record<string, unknown> {
		const slot = (k: string, v: unknown) =>
			v !== undefined ? { [k]: $state.snapshot(v) } : {}
		return {
			...slot("zoneLayout", surfaceManager.zoneLayout),
			...slot("widgetGrid", surfaceManager.widgetGrid),
			...slot("arrangedGrid", surfaceManager.arrangedGrid)
		}
	}

	/* ── the card menu and Save changes to (brief 6b) ─────────────────────
	 * Every tab of this person hears every answer, and adopts the refreshed
	 * list when it is for this session's genre; only the tab that ASKED says
	 * how it went (`layoutAsks`), so a second tab never toasts someone
	 * else's click. A handler that threw answers with its `:error` twin,
	 * which settles this tab's oldest ask of that verb. */
	const layoutAsks = new LayoutAsks()
	/**
	 * Read this session's started-from facts again — provenance, Updated and
	 * the list. After a refusal (the card may be gone: someone stopped
	 * sharing or deleted it; the layout may have changed elsewhere), and on
	 * every reconnect (a push sent while the socket was down is lost).
	 */
	function askStartedFrom() {
		if (sessionId != null)
			socket.emit("sessions:panelLayout:startedFromUpdated", { sessionId })
	}
	const nameOf = (id: number) =>
		layoutPresets.find((p) => p.id === id)?.name ?? "that layout"

	/** _Save changes to "*Name*"_: the committed arrangement into that layout. */
	function saveLayoutChanges(
		presetId: number,
		drawn: string[],
		overwriteUpdated: boolean
	) {
		if (sessionId == null) return
		layoutAsks.ask("update", presetId)
		socket.emit("sessions:layoutPreset:update", {
			sessionId,
			id: presetId,
			layout: committedArrangement(),
			drawnWidgetIds: drawn,
			...(overwriteUpdated ? { overwriteUpdated: true } : {})
		})
	}
	function shareLayout(presetId: number, visibility: "shared" | "private") {
		if (sessionId == null) return
		layoutAsks.ask("share", presetId)
		socket.emit("sessions:layoutPreset:share", { sessionId, id: presetId, visibility })
	}
	function cloneLayout(presetId: number) {
		layoutAsks.ask("clone", presetId)
		socket.emit("sessions:layoutPreset:clone", { id: presetId })
	}
	function setNewSessionLayout(presetId: number | null) {
		const genreId = sessionGenreId()
		if (!genreId) return
		layoutAsks.ask("new-session", genreId)
		socket.emit("sessions:layoutPreset:setNewSessionLayout", {
			genreId,
			layoutPresetId: presetId
		})
	}
	/** "New Adventure sessions", or plainer while the genre's name loads. */
	const newSessionsOfGenre = () =>
		genreName ? `New ${genreName} sessions` : "New sessions of this genre"

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
			omit
		)
	}

	function handleSessionsView(res: Sockets.Sessions.View.Response) {
		if (res.sessionId !== sessionId) return
		sessionFrames = res
		panelViewLoaded = true
		initSurfaceManagerIfReady()
	}

	/** Adopt a whole session layout — the first open's, or a copy's. */
	function adoptPanelLayout(res: Sockets.Sessions.PanelLayout.Get.Response) {
		panelLayoutBlob = (res.layout ?? {}) as LayoutBlob
		layoutPresets = res.presets ?? []
		startedFromLayoutPresetId = res.startedFromLayoutPresetId ?? null
		startedFromUpdated = !!res.startedFromUpdated
		layoutCopiedAt = res.layoutCopiedAt ?? null
		layoutSettings = res.layoutSettings ?? {}
		widgetSettings = res.widgetSettings ?? {}
		panelLayoutLoaded = true
		initSurfaceManagerIfReady()
	}

	function handleSessionsPanelLayoutGet(
		res: Sockets.Sessions.PanelLayout.Get.Response
	) {
		if (res.sessionId !== sessionId) return
		adoptPanelLayout(res)
	}

	/**
	 * A copy landed (or was refused). The answer is the whole new layout, so
	 * the manager re-seeds from it — the editor, if open, re-reads its working
	 * copy when it sees the manager re-seeded. A refusal is said only in the
	 * tab that asked; every tab of this person hears the answer.
	 */
	function handleLayoutStartFrom(
		res: Sockets.Sessions.PanelLayout.StartFrom.Response
	) {
		if (res.sessionId !== sessionId) return
		if (!res.ok) {
			if (settleLayoutCopy(false))
				toaster.error({ title: res.error ?? "Could not change the layout" })
			return
		}
		adoptPanelLayout(res)
		settleLayoutCopy(true)
	}

	/**
	 * The copy's handler threw. The generic `:error` names no session, so it
	 * settles this tab's oldest ask, if it has one. Saying so is left to the
	 * shell's catch-all toast for every unhandled `*:error`.
	 */
	function handleLayoutStartFromError() {
		settleLayoutCopy(false)
	}

	function handleLayoutPresetSave(
		res: Sockets.Sessions.PanelLayout.Save.Response
	) {
		if (res.sessionId !== sessionId) return
		if (!res.ok) {
			toaster.error({ title: res.error ?? "Could not save that layout" })
			return
		}
		layoutPresets = res.presets ?? layoutPresets
		// The session now started from the row it just wrote.
		if (res.startedFromLayoutPresetId != null) {
			startedFromLayoutPresetId = res.startedFromLayoutPresetId
			startedFromUpdated = false
			layoutCopiedAt = res.layoutCopiedAt ?? layoutCopiedAt
		}
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
		// `layout_preset_id` is ON DELETE SET NULL, so the label is already
		// gone server-side; mirror it. The layout itself is this session's own
		// copy and does not move.
		if (res.id === startedFromLayoutPresetId) {
			startedFromLayoutPresetId = null
			startedFromUpdated = false
		}
	}

	function handleLayoutPresetUsage(
		res: Sockets.Sessions.PanelLayout.Usage.Response
	) {
		if (!res.ok) {
			// Answered, not pending: the delete question must not wait for good.
			layoutPresetUsage = {
				id: res.id,
				sessions: 0,
				newSessionLayoutUsers: 0,
				unknown: true
			}
			toaster.error({ title: res.error ?? "Could not read that layout" })
			return
		}
		layoutPresetUsage = {
			id: res.id,
			sessions: res.sessions,
			newSessionLayoutUsers: res.newSessionLayoutUsers ?? 0
		}
	}

	/** A card-menu answer: adopt its list in every tab of the genre; toast in the asker's. */
	function adoptManagedList(res: { ok: boolean; genreId?: string; presets: Sockets.Sessions.LayoutPreset[] }) {
		if (res.ok && res.genreId === sessionGenreId()) layoutPresets = res.presets
	}

	/**
	 * This tab's card-menu ask was refused. Said as the server says it; then
	 * the list is read again, because the commonest cause is a card that is
	 * not this person's to act on any more (unshared or deleted elsewhere).
	 */
	function refusedLayoutAsk(error: string | undefined, fallback: string) {
		toaster.error({ title: error ?? fallback })
		askStartedFrom()
	}

	function handleLayoutPresetShare(res: Sockets.Sessions.PanelLayout.Share.Response) {
		adoptManagedList(res)
		if (!layoutAsks.take("share", res.id)) return
		if (!res.ok) {
			refusedLayoutAsk(res.error, "Could not change who sees that layout")
			return
		}
		const name = quotedLayoutName(res.preset?.name ?? nameOf(res.id))
		if (res.preset?.visibility === "shared")
			toaster.success({ title: `Shared ${name} with everyone on this pub.` })
		else
			toaster.success({
				title: `${name} is private again.`,
				description: "Sessions that copied it keep their layout."
			})
	}

	function handleLayoutPresetClone(res: Sockets.Sessions.PanelLayout.Clone.Response) {
		adoptManagedList(res)
		if (!layoutAsks.take("clone", res.id)) return
		if (!res.ok) {
			refusedLayoutAsk(res.error, "Could not copy that layout")
			return
		}
		toaster.success({
			title: `Made a copy: ${quotedLayoutName(res.preset?.name ?? "")}.`,
			description: "It's under Your layouts."
		})
	}

	/**
	 * _Save changes to_ answered. This session now started from the row it
	 * saved into (and does not read it as Updated). A refusal — including
	 * "changed since this session copied it", when the Updated news had not
	 * reached this tab yet — re-reads the started-from facts, so the next ask
	 * warns.
	 */
	function handleLayoutPresetUpdate(res: Sockets.Sessions.PanelLayout.Update.Response) {
		adoptManagedList(res)
		if (res.ok && res.sessionId === sessionId && res.startedFromLayoutPresetId != null) {
			startedFromLayoutPresetId = res.startedFromLayoutPresetId
			startedFromUpdated = false
			layoutCopiedAt = res.layoutCopiedAt ?? layoutCopiedAt
		}
		if (!layoutAsks.take("update", res.id)) return
		if (!res.ok) {
			refusedLayoutAsk(res.error, "Could not save changes to that layout")
			return
		}
		toaster.success({ title: `Saved changes to ${quotedLayoutName(res.preset?.name ?? nameOf(res.id))}.` })
	}

	function handleLayoutPresetSetNewSessionLayout(
		res: Sockets.Sessions.PanelLayout.SetNewSessionLayout.Response
	) {
		if (res.genreId !== sessionGenreId()) return
		if (res.ok) layoutPresets = res.presets
		if (!layoutAsks.take("new-session", res.genreId)) return
		if (!res.ok) {
			refusedLayoutAsk(res.error, "Could not change the layout for new sessions")
			return
		}
		toaster.success({
			title:
				res.layoutPresetId != null
					? `${newSessionsOfGenre()} will start from ${quotedLayoutName(nameOf(res.layoutPresetId))}.`
					: `${newSessionsOfGenre()} will start from the genre default layout.`
		})
	}

	/**
	 * **Updated**, live (brief 6b): a layout this session started from moved
	 * — saved into from another session, or updated by its plugin or core.
	 * Only the label and the list move; the layout on screen is this
	 * session's own copy.
	 */
	function handleLayoutStartedFromUpdated(
		res: Sockets.Sessions.PanelLayout.StartedFromUpdated.Response
	) {
		if (res.sessionId !== sessionId) return
		// Read before a copy this tab asked for landed, sent after its answer:
		// it names the OLD source (and its Updated mark). Old news.
		if (olderThanHeld(layoutCopiedAt, res.layoutCopiedAt)) return
		layoutPresets = res.presets
		startedFromLayoutPresetId = res.startedFromLayoutPresetId
		startedFromUpdated = res.startedFromUpdated
		layoutCopiedAt = res.layoutCopiedAt
	}

	/**
	 * A card-menu verb's handler threw. Its `:error` twin names no layout, so
	 * it settles this tab's oldest ask of that verb; saying so is the shell's
	 * catch-all toast, as for every unhandled `*:error`.
	 */
	const failLayoutAsk = (verb: "share" | "clone" | "update" | "new-session") => () => {
		layoutAsks.fail(verb)
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
	 * `actionDispatch` down, so a widget's `invoke('extend')` is resolved at
	 * the mount and never reaches this function; a frame or widget that still
	 * arrives here naming `core#extend` (a bare `{ t: "action" }`, or a host
	 * wired without the dispatch) must not be sent to
	 * `sessions:fireAction`, which refuses it by name.
	 *
	 * Everything else goes to `fireOfferedAction` — the offered-action wrapper — or,
	 * when the press answers a form, straight to `emitFireAction` beneath it. A
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
			emitFireAction({ fn, identity: action, messageId, payload, blockId })
			return
		}
		// A press that named no well-formed identity (a bare `{ t: "action" }`)
		// carries its bare key onward, and the server resolves it to the one
		// declaration of that key or refuses it (plans/31 V2).
		fireOfferedAction(parsed ?? { key: fn }, { messageId, payload })
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
	let sessionNotFound = $state(false)

	/**
	 * The viewer's composer tray and what this session's reply can read
	 * (PLAN-composer-attachments §3.3): kept here, posted to core's composer
	 * in the dossier (`composer.tray`, `composer.attachments`), changed only
	 * through its requests. Guests attach too (D8).
	 */
	const composerTray = createComposerTray(
		{
			emit: (event, data) => socket.emit(event as any, data as any),
			on: (event, handler) => declareInterest(event as any, handler)
		},
		{ sessionId: () => (Number.isFinite(sessionId) ? sessionId : null) }
	)
	// A socket that came back has missed the pushes: ask for the tray again.
	const releaseTrayOnConnect = onConnect(() => composerTray.load())
	onDestroy(() => {
		releaseTrayOnConnect()
		composerTray.destroy()
	})
	$effect(() => {
		if (!Number.isFinite(sessionId)) return
		untrack(() => composerTray.load())
	})
	// What the reply can read moves with the session's genre and the models
	// its calls fall back to (§3.2 "recompute"): ask again when either moves,
	// and when the tab comes back — a model's Vision may have been switched
	// on in Connections meanwhile. The first reading is `load()`'s.
	let readersKey: string | null = null
	$effect(() => {
		const key = JSON.stringify([
			loadedGenreId,
			systemSettingsCtx.capabilityDefaults ?? null
		])
		if (readersKey !== null && key !== readersKey)
			untrack(() => composerTray.refreshReaders())
		readersKey = key
	})
	onMount(() => {
		const onVisible = () => {
			if (document.visibilityState === "visible") composerTray.refreshReaders()
		}
		document.addEventListener("visibilitychange", onVisible)
		return () => document.removeEventListener("visibilitychange", onVisible)
	})
	// A Send the server refused (an attachment still uploading, one the reply
	// stopped reading, a channel it lacks) says why; the tray stays.
	useInterest<"sessionMessages:sendPersonaMessage">(
		"sessionMessages:sendPersonaMessage",
		(res) => {
			if (res?.sessionId === sessionId && res.error)
				toaster.error({ title: "Not sent", description: res.error })
		}
	)
	useInterest<"attachments:removeFromMessage:error">(
		"attachments:removeFromMessage:error",
		(res) => {
			if (res?.sessionId == null || res.sessionId === sessionId)
				toaster.error({ title: "Couldn't remove the attachment", description: res.error })
		}
	)

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
	// Regenerate the last turn (`core#retake`, R2): the preview the dialog
	// names, the retake's answer, and its refusal in a sentence.
	useInterest<"sessions:retakeTurn">("sessions:retakeTurn", handleRetakeTurn)
	useInterest<"sessions:retakeTurn:error">(
		"sessions:retakeTurn:error",
		handleRetakeTurnError
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
	useInterest<"sessions:panelLayout:startFrom">(
		"sessions:panelLayout:startFrom",
		handleLayoutStartFrom
	)
	useInterest<"sessions:panelLayout:startFrom:error">(
		"sessions:panelLayout:startFrom:error",
		handleLayoutStartFromError
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
	// The card menu and Save changes to (brief 6b): every answer carries the
	// refreshed list for the layout's genre.
	useInterest<"sessions:layoutPreset:share">(
		"sessions:layoutPreset:share",
		handleLayoutPresetShare
	)
	useInterest<"sessions:layoutPreset:clone">(
		"sessions:layoutPreset:clone",
		handleLayoutPresetClone
	)
	useInterest<"sessions:layoutPreset:update">(
		"sessions:layoutPreset:update",
		handleLayoutPresetUpdate
	)
	useInterest<"sessions:layoutPreset:share:error">(
		"sessions:layoutPreset:share:error",
		failLayoutAsk("share")
	)
	useInterest<"sessions:layoutPreset:clone:error">(
		"sessions:layoutPreset:clone:error",
		failLayoutAsk("clone")
	)
	useInterest<"sessions:layoutPreset:update:error">(
		"sessions:layoutPreset:update:error",
		failLayoutAsk("update")
	)
	useInterest<"sessions:layoutPreset:setNewSessionLayout:error">(
		"sessions:layoutPreset:setNewSessionLayout:error",
		failLayoutAsk("new-session")
	)
	useInterest<"sessions:layoutPreset:setNewSessionLayout">(
		"sessions:layoutPreset:setNewSessionLayout",
		handleLayoutPresetSetNewSessionLayout
	)
	// No server emitter with a caller today — converted as it stands rather
	// than removed, since the surface-intent push is the declared seam.
	useInterest<"sessions:surfaceIntent">(
		"sessions:surfaceIntent",
		handleSurfaceIntent
	)
	useInterest<"sessions:fireAction">(
		"sessions:fireAction",
		handleSessionsFireAction
	)
	// How a narration went (genre uplift C2): spends a `/narrate <text>`
	// draft, keeps the modal's press that did not land.
	useInterest<"sessions:fireNarratorResponse">(
		"sessions:fireNarratorResponse",
		narrations.answered
	)
	// Why one was refused or failed — never gated (plan ruling 2); toasted
	// here, under the action's name, rather than by Layout's catch-all.
	useInterest<"sessions:fireNarratorResponse:error">(
		"sessions:fireNarratorResponse:error",
		narrations.error
	)
	useInterest<"sessions:genres">("sessions:genres", handleSessionsModesPage)
	// Never gated (plan ruling 2 — errors are not outputs to skip), but the
	// registry is the only listener path, so it is declared like the rest.
	useInterest<"sessions:summarize:error">(
		"sessions:summarize:error",
		handleSessionSummarizeError
	)

	/**
	 * The page-level pushes from three other families, every one BARE — and
	 * each for its own reason, not as a batch:
	 *
	 * · `sessionMessage:error` is a refusal with no id on it, never gated
	 *   (plan ruling 2), and page-level on purpose: the modals tear their own
	 *   listeners down on close, so a run that failed while minimized would
	 *   otherwise report nothing at all. A failed scene summarize is not
	 *   heard here: the Process scene window says it, or Layout does once
	 *   the window is closed (`sceneRunShown.ts`).
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
	useInterest<"media:changed">("media:changed", handleMediaChanged)
	useInterest<"sessionMessages:delete">(
		"sessionMessages:delete",
		handleSessionMessagesDelete
	)

	/**
	 * Live reload of the authored components this page draws (C6, P5,
	 * `sessionPage/authoredReload.ts`): one SCOPED `components:changed` key
	 * per authored owner offered here, so a page hears only about its own. A
	 * push retargets that owner's widgets — declarations and placed
	 * instances both, so a re-seed keeps the new module: a new `src` remounts
	 * the widget in place, `null` draws it missing. A component newly switched
	 * on that this page does not offer is NOT fetched now; it is offered on
	 * the next `sessions:view` (re-seeding would re-seat every widget).
	 */
	const authoredOwnersKey = $derived(
		authoredOwnersOf([
			...(sessionFrames?.modePanels ?? []),
			...surfaceManager.instances
		]).join(" ")
	)
	$effect(() => {
		const owners = authoredOwnersKey ? authoredOwnersKey.split(" ") : []
		const onChanged = (res: Sockets.Components.Changed.Response) =>
			retargetAuthoredSrc(
				[...(sessionFrames?.modePanels ?? []), ...surfaceManager.instances],
				res
			)
		const releases = authoredReloadKeys(owners).map((key) =>
			declareInterest<"components:changed">(key, onChanged)
		)
		return () => releases.forEach((release) => release())
	})

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
			// This session's lore was ranked (R81), to the widgets that read it.
			hearLoreRanked(sessionId, surfaceManager),
			// Its stored genre fields moved (Edit Session, the Author's note in
			// another tab): to the widgets that show one (2026-10-03).
			hearGenreFieldsChanged(sessionId, surfaceManager),
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
			),
			// **Updated**, live (brief 6b): a layout this session started
			// from moved. Scoped, so nothing is built for another session's tab.
			declareInterest<"sessions:panelLayout:startedFromUpdated">(
				interestKey("sessions:panelLayout:startedFromUpdated", sessionId),
				handleLayoutStartedFromUpdated
			),
			// …and asked again on every reconnect: a push sent while the
			// socket was down — a server restart's boot reconcile included —
			// is lost, and this page would never learn it missed it.
			onConnect(askStartedFrom)
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

	// The author's newest line — keyed on role, never on a persona (F1): a
	// persona-less genre's user line has no personaId (`swipeControls.ts`).
	/**
	 * The newest line once it has finished — its id and text — or null while
	 * it streams. A string, so what reads it re-runs when a line lands or is
	 * edited, never per streamed chunk (`lastMessage` is new on every one).
	 */
	const lastSettledMessageKey: string | null = $derived(
		lastMessage && !lastMessage.isGenerating
			? `${lastMessage.id}:${lastMessage.content}`
			: null
	)

	let lastAuthorMessage: SelectSessionMessage | undefined = $derived(
		lastAuthorLine(session?.sessionMessages)
	)

	let canRegenerateLastMessage: boolean = $derived(
		canRegenerateNewest(lastMessage, offersVerb("retry"))
	)

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
	let fireInFlight: boolean = $state(false)
	let fireInFlightTimer: ReturnType<typeof setTimeout> | undefined

	function markFireInFlight() {
		fireInFlight = true
		clearTimeout(fireInFlightTimer)
		// Backstop only: a generation that never starts must not wedge the
		// block off permanently. The real clears are the two below.
		fireInFlightTimer = setTimeout(
			() => (fireInFlight = false),
			15000
		)
	}

	function clearFireInFlight() {
		fireInFlight = false
		clearTimeout(fireInFlightTimer)
	}

	// Clear as soon as the placeholder lands — the normal path.
	$effect(() => {
		if (hasGeneratingMessage) clearFireInFlight()
	})

	// Determine if we should show the next character block
	let shouldShowNextCharacterBlock: boolean = $derived.by(() => {
		const hasMessageDraft = newMessage.trim().length > 0
		// The head, or — an empty order, a manual strategy waiting to be
		// told — someone to pick.
		const hasNextCharacter =
			!!turnOrder?.order.length || !!turnOrder?.candidates.length

		const shouldShow =
			!fireInFlight &&
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
	 * Both read `ownLorebookId`, never `session`: a streamed chunk replaces
	 * the object, and reading through it would re-ask per token.
	 *
	 * The session's OWNER only: the book is the host's, and the server refuses
	 * anyone else's ask ("Lorebook not found."), which a guest was shown on
	 * every visit for something they never did.
	 */
	const ownLorebookId = $derived(
		sessionUserId !== null && sessionUserId === userCtx.user?.id
			? sessionLorebookId
			: null
	)
	/**
	 * A change the viewer makes to an entry of the session's book — a mark
	 * set in a widget, a pin or an Off saved in an editor — to the widgets
	 * that read the lore (plan A14). SCOPED to the book, so its key moves
	 * with the session's book; read through `sessionLorebookId`, never
	 * `session`, for the reason `ownLorebookId` gives.
	 */
	$effect(() => {
		const lorebookId = sessionLorebookId
		if (!lorebookId) return
		return hearLoreMarked(lorebookId, surfaceManager)
	})

	$effect(() => {
		const lorebookId = ownLorebookId
		if (!lorebookId) return
		return declareInterest<"lorebooks:bindingList">(
			interestKey("lorebooks:bindingList", lorebookId),
			handleLorebookBindingList
		)
	})

	$effect(() => {
		const lorebookId = ownLorebookId
		if (lorebookId) {
			socket?.emit("lorebooks:bindingList", { lorebookId })
		} else {
			// A session with no book (or another's) has no cast: the last
			// session's list must not stand in for it (plan B8).
			lorebookBindingList = []
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
	 *
	 * Built from the streamed `session`, so the build re-runs per chunk; kept
	 * as a STRING, which a `$derived` compares by value, so `headerCast` — and
	 * the header that reads it — moves only when a face, a name or the next
	 * speaker does.
	 */
	const headerCastKey: string = $derived.by(() => {
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
		return JSON.stringify([...characters, ...personas])
	})
	let headerCast: OpenSessionCastMember[] = $derived(JSON.parse(headerCastKey))

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

	// Reset selection when navigating to a different session — keyed on the
	// id, not `session`, which a streamed chunk replaces: reading through it
	// would reset the person's pick on every token of a reply.
	$effect(() => {
		const _watchSessionId = loadedSessionId
		selectedPersonaId = null
	})

	/**
	 * Another session opened in this page (the route keeps the component):
	 * nothing waiting on the LAST session's answers may land in this one
	 * (plan B8). Its widget asks are rejected rather than settled by a reply
	 * about a session that has left the screen, and an open Process scene window
	 * closes — it would otherwise apply the old scene's cast into the new
	 * session's book. Untracked bookkeeping: only the id moving re-runs it,
	 * and the first load drops nothing.
	 */
	let switchedFrom: number | null = null
	$effect(() => {
		const id = loadedSessionId
		untrack(() => {
			const before = switchedFrom
			if (id !== null) switchedFrom = id
			if (before === null || id === null || id === before) return
			const why = "another session opened before the server answered"
			spriteSetAsks.drop(why)
			entriesAsks.drop(why)
			entryMarksAsks.drop(why)
			authorsNoteAsks.drop(why)
			setAuthorsNoteAsks.drop(why)
			showProcessSceneModal = false
			processSceneId = null
			processActivityId = null
			processPendingResult = null
		})
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

	/**
	 * Send the draft, with these ready tray items as its attachments; false
	 * when it was refused (nothing to send, no persona). Attachments alone
	 * are a line (composer attachments §3.1).
	 */
	function handleSend(trayItemIds: string[] = []): boolean {
		if (!newMessage.trim() && !trayItemIds.length) return false

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
			channel: composerChannel,
			...(trayItemIds.length ? { trayItemIds } : {})
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
		// cleared when the placeholder lands, or by the backstop in
		// `markFireInFlight` — rather than guessed here.
		markFireInFlight()

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
		const own = personLine(msg)
		// The character shape, so the row renders as any other.
		return own ? ({ name: own.name } as unknown as SelectCharacter) : undefined
	}

	/**
	 * What a person's own lines are called (lair re-plan R4): the session's
	 * override on its row, else the genre's `playerLabel` off the view —
	 * resolved at render, never stamped, so a rename relabels history.
	 */
	let sessionPlayerLabel = $derived(
		resolvePlayerLabel({
			declared: sessionFrames?.genrePlayerLabel,
			stored: storedPlayerLabel(session?.metadata)
		})
	)

	/**
	 * A person speaking as themselves — no persona, as a genre with
	 * `personas: { min: 0 }` allows (the Guide, the Lair). Named by the genre's
	 * `playerLabel` when it declares one (R4), with the member beside it on a
	 * shared session; else by the member the row belongs to: the viewer's own
	 * display name, a guest's off the member list.
	 */
	function personLine(
		msg: SelectSessionMessage
	): { name: string; member?: string } | undefined {
		const me = userCtx.user
		const member =
			me && msg.userId === me.id
				? me
				: session?.sessionGuests?.find((g) => g.userId === msg.userId)
						?.user
		return personLineName({
			playerLabel: sessionPlayerLabel,
			memberName: member
				? member.displayName?.trim() || member.username
				: null,
			memberCount: 1 + (session?.sessionGuests?.length ?? 0)
		})
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

	function handleExtendMessage(e: Event, msg: SelectSessionMessage) {
		e.stopPropagation()
		// Extend carries the reply on from its existing content (prefill);
		// the server keeps the partial and runs the turn from it.
		socket.emit("sessionMessages:extend", { id: msg.id })
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
			writeDraft("")
			// The narrator modal's unlanded press is the draft's other half:
			// the session left behind's text and speaker (a side character of
			// its own, perhaps), never this one's.
			narratorUnlandedPress = null
			loadingOlderMessages = false
			// Surface grid re-seeds for the new session (plan 21): re-fetch its
			// panel set + this user's saved layout, and re-init once both land.
			panelViewLoaded = false
			panelLayoutLoaded = false
			panelLayoutBlob = {}
			layoutPresets = []
			startedFromLayoutPresetId = null
			startedFromUpdated = false
			layoutCopiedAt = null
			layoutSettings = {}
			widgetSettings = {}
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

	/**
	 * Landing on the message a link named (`?message=<id>[&block=<blockId>]`,
	 * `sessionHref` — a notification's link): older pages load until the
	 * message is in the window, then its row (or the named form in it) is
	 * centred, ringed once and focused, and the params leave the address so a
	 * reload or Back does not land again. The log's own pin to its end
	 * (`sp-scroll`) hears the landing and lets go (`landOn`); scrolling back
	 * to the end pins it again. A message that is not there (deleted, never
	 * drawn) leaves the log at its end.
	 */
	const messageLanding = $derived(readMessageLanding(page.url.searchParams))
	const messageLandingStep = $derived.by(() => {
		if (!messageLanding || !session || session.id !== sessionId) return null
		return nextLandingStep(
			messageLanding,
			session.sessionMessages.map((m) => m.id),
			{ hasOlder: !!pagination?.hasMore, loadingOlder: loadingOlderMessages }
		)
	})
	function dropMessageLanding() {
		try {
			replaceState(withoutLanding(page.url), page.state)
		} catch {
			// Router not started (cannot happen after a load reply) — the
			// params stay, and the next load lands again; nothing breaks.
		}
	}
	$effect(() => {
		const landing = messageLanding
		const step = messageLandingStep
		if (!landing || !step || step === "wait") return
		if (step === "load-older") return void untrack(() => loadOlderMessages())
		if (step === "give-up") return void untrack(dropMessageLanding)
		// `seek`: the row is in the window; its element follows a few frames
		// on (the conversation is drawn by a worker).
		let frames = 0
		let raf = requestAnimationFrame(function seek() {
			const hit = landingTarget(document, landing)
			if (hit) landOn(hit.el, { focus: hit.focus })
			if (hit || ++frames >= LANDING_SEEK_FRAMES) untrack(dropMessageLanding)
			else raf = requestAnimationFrame(seek)
		})
		return () => cancelAnimationFrame(raf)
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
		const _newMessage = newMessage // DO NOT REMOVE THIS LINE - REACTIVITY TRIGGER
		if (!sessionId || !lastSettledMessageKey) return
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
		if (autoAdvanceTimeout) {
			clearTimeout(autoAdvanceTimeout)
			autoAdvanceTimeout = null
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
	 * The page's last write to core's composer draft (C0b, D1): the kept
	 * draft when the session opens, an empty one when a session switch or a
	 * spent action clears it. The composer owns the draft between writes and
	 * reports it (`draft`), which keeps `newMessage` — the token count, the
	 * save — in step; `writeDraft` is the one way the page changes it.
	 */
	let composerDraft = $state<DraftWrite>({ content: "", write: 0 })
	function writeDraft(content: string) {
		newMessage = content
		composerDraft = nextDraftWrite(untrack(() => composerDraft), content)
	}

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
		if (autoAdvanceTimeout) {
			clearTimeout(autoAdvanceTimeout)
			autoAdvanceTimeout = null
		}
		if (lastMessage)
			socket.emit("sessionMessages:cancel", {
				id: lastMessage.id,
				sessionId
			})
	}
	function handleAdvance(e: Event, channel?: string) {
		e.stopPropagation()
		markFireInFlight()
		// Continue presses the first entry on this composer's channel (§4.7,
		// R5) — the one its turn controls were drawn for (S1), else the page's
		// own; on an empty order the server refuses in words, which
		// `handleFireTurnError` shows.
		fireTurn(socket, sessionId, undefined, channel ?? composerChannel)
	}
	function handlePickSpeaker(e: Event) {
		e.stopPropagation()
		showPickSpeakerModal = true
	}
	function handleRegenerateLastMessage(e: Event) {
		e.stopPropagation()
		if (lastMessage && canRegenerateLastMessage) {
			socket.emit("sessionMessages:regenerate", { id: lastMessage.id })
		}
	}

	/**
	 * Regenerate the last turn, as a whole (`core#retake`, lair pass R2):
	 * a preview names the turn's rows in the confirm, unless this session's
	 * annex says not to ask (`core:annex#retake-quietly`, set by the
	 * dialog's checkbox and taken back in Edit Session → Settings).
	 */
	let showRetakeConfirm = $state(false)
	let retakeRows = $state<RetakeRow[]>([])
	const retake = createRetake({
		sessionId: () => sessionId,
		quiet: () => retakeQuietly(annexView),
		send: (p) => {
			if (!p.preview) markFireInFlight()
			socket.emit("sessions:retakeTurn", p)
		},
		setQuiet: (value) =>
			emitFireAction({
				fn: "retake-quietly",
				identity: RETAKE_QUIETLY,
				payload: { value }
			}),
		ask: (rows) => {
			retakeRows = rows
			showRetakeConfirm = true
		}
	})
	function handleRetake(e: Event) {
		e.stopPropagation()
		retake.press()
	}
	function handleRetakeTurn(msg: Sockets.Sessions.RetakeTurn.Response) {
		if (msg.sessionId !== sessionId) return
		if (retake.hear(msg)) return
		if (!msg.ok) clearFireInFlight()
	}
	function handleRetakeTurnError(msg: Sockets.Sessions.RetakeTurn.Response) {
		if (msg.sessionId !== sessionId) return
		if (retake.hear(msg)) return
		clearFireInFlight()
		if (msg.error) toaster.error({ title: msg.error })
	}

	function onPickSpeaker(characterId: number) {
		showPickSpeakerModal = false
		markFireInFlight()
		fireTurn(socket, sessionId, { characterId })
	}

	function openNarrateModal() {
		socket.emit("sessions:sideCharacterOptions", { sessionId })
		showNarratorResponseModal = true
	}

	function handleNarratorResponse(e: Event) {
		e.stopPropagation()
		showPickSpeakerModal = false
		openNarrateModal()
	}

	/**
	 * The narrator row of both pickers (B8): a narrator genre's own turn —
	 * the `narrate` turn control, when the list carries it — else Chat's
	 * narrate function and its instructions modal. Neither listed, no row.
	 */
	let narratorTurn = $derived(extraAction("narrate"))
	let narratorFunction = $derived(
		composerMenuActions.some((a) => actionIdentity(a) === NARRATE_ACTION)
	)
	let narratorRowChip = $derived(
		narratorTurn ? extraChip(narratorTurn) : undefined
	)
	function handleFireNarratorTurn(e?: Event, channel?: string) {
		e?.stopPropagation()
		showPickSpeakerModal = false
		markFireInFlight()
		// Where it was pressed (R8): a Lair narration lands on `main` either
		// way, and the run can tell a Sanctum press from a story one — the
		// Sanctum panel's Narrate names its channel (S1).
		fireTurn(socket, sessionId, { narrator: true }, channel ?? composerChannel)
	}
	function handleNarratorRow(e: Event) {
		if (narratorRowChip?.disabled) return e.preventDefault()
		if (narratorTurn) handleFireNarratorTurn(e)
		else handleNarratorResponse(e)
	}

	function handleConfirmNarratorResponse(request: NarratorRequest) {
		showNarratorResponseModal = false
		narrations.modal(request)
	}

	function handleCancelNarratorResponse() {
		showNarratorResponseModal = false
	}

	/**
	 * Continue (§4.7): the first entry prepared on the channel of the
	 * composer it was pressed in (lair re-plan R5) — the widget's, when it
	 * says; else this page's own composer channel.
	 */
	function handleContinueWithNextCharacter(channel?: string) {
		if (!turnOrder?.order.length) return
		markFireInFlight()
		fireTurn(socket, sessionId, undefined, channel ?? composerChannel)
	}

	/** "Someone else": the picker over the order's candidates (§4.9). */
	function handleChooseDifferentCharacter() {
		showTurnPicker = true
	}

	function handlePickTurn(entry: { ref: string | null }) {
		showTurnPicker = false
		// The narrator row: a narrator genre's turn, else Chat's modal.
		if (entry.ref === null && !narratorTurn) {
			openNarrateModal()
			return
		}
		markFireInFlight()
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
		return swipeRightAllowed(msg, isGreeting, lastAuthorMessage)
	}

	// NOTE: this intentionally does not return true for
	// `openMsgControlsMenu === msg.id`. That would make opening a message's
	// "..." popover add the swipe row to that message, growing it by a whole
	// row while the popover was anchored to it — the message would jump and
	// the popover reposition. The trade is that swipe arrows on mid-history
	// assistant messages are unreachable; if that needs restoring, add
	// a labelled swipe entry to the popover rather than re-coupling the two.
	function showSwipeControls(
		msg: SelectSessionMessage,
		isGreeting: boolean
	): boolean {
		// The author's line never swipes, in any genre (F1) — see
		// `swipeControls.ts`, which checks the role before "newest".
		return swipeRowShown(msg, {
			isGreeting,
			isNewest: msg.id === lastMessage?.id,
			swipeOffered: offersVerb("swipe"),
			canRegenerateNewest: canRegenerateLastMessage,
			lastAuthor: lastAuthorMessage
		})
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
				if (isFirstLoad && msg.userDraft) writeDraft(msg.userDraft)
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
		lorebookId?: number
		lorebookBindingList?: { id: number; name: string; binding: string }[]
	}) {
		// Only the session's own book's cast (a switch can leave a late reply
		// about the last one's).
		if (msg.lorebookId !== undefined && msg.lorebookId !== ownLorebookId)
			return
		lorebookBindingList = msg.lorebookBindingList ?? []
	}

	function handleSessionSummarizeError(msg: { error?: string }) {
		// Page-level because the modal tears its listeners down on close, and
		// this event is suppressed in Layout's generic toaster, so a failure
		// while minimized was silent.
		toaster.error({
			title: "Summarization failed",
			description: msg?.error
		})
	}

	function handleSessionMessageError(msg: { error?: string }) {
		// A generation that failed before any isGenerating row would otherwise
		// leave the next-character block suppressed for the full settle timeout.
		clearFireInFlight()
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
		// A widget's `set-sprite-set` owns its reply, refusal included (R77).
		settleSpriteSetReply(msg, spriteSetAsks, sessionId, (title) => toaster.error({ title }))
	}

	function handleTurnOrder(msg: Sockets.Sessions.TurnOrder.Push) {
		if (msg.sessionId !== sessionId) return
		const t = msg.turnOrder as Partial<TurnOrderView> | null
		turnOrder = {
			order: Array.isArray(t?.order) ? t!.order : [],
			candidates: Array.isArray(t?.candidates) ? t!.candidates : []
		}
		turnOrderDoc = readTurnOrder({ turnOrder: msg.turnOrder })
		// The server says no reply is coming from this change (B9): stop
		// waiting on the send, so the next-speaker block shows at once.
		if (pushSaysNoReply(msg, sessionId)) clearFireInFlight()
	}

	/**
	 * A fire that did not start a run — a person's turn, nothing prepared —
	 * answers on the success event with `ok: false`; no placeholder will
	 * land to clear the in-flight flag, so it is cleared here.
	 */
	function handleFireTurn(msg: Sockets.Sessions.FireTurn.Response) {
		if (msg.sessionId !== sessionId || msg.ok) return
		clearFireInFlight()
	}

	/** A refused fire: clear the in-flight flag and show the server's sentence. */
	function handleFireTurnError(msg: Sockets.Sessions.FireTurn.Response) {
		if (msg.sessionId !== sessionId) return
		clearFireInFlight()
		const sentence = fireTurnRefusal(msg, sessionId)
		if (sentence) toaster.error({ title: sentence })
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
		// Another channel's listing (S1): kept beside `main`'s, never over it.
		if (onOtherChannel(msg.channel)) {
			channelVenues = { ...channelVenues, [msg.channel]: msg.venues || {} }
			return
		}
		actionVenues = msg.venues || {}
		formCollects = msg.formCollects ?? {}
		// Every other channel the session has is listed again with it: a run
		// ending pushes `main`'s alone, and the Sanctum's Continue must lift
		// when the story's does.
		for (const channel of sessionChannels)
			if (onOtherChannel(channel))
				socket.emit("sessions:actions", { sessionId, channel })
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
	 * `invoke('extend')`, a frame's `{ t: "invoke", key: "core#edit" }`
	 * and the palette's `/advance` all land on. A verb named with a message
	 * acts on that message; `retry` named with none acts on the newest reply
	 * and `advance` fires the turn order's head (the turn controls); the rest
	 * need a subject and say so rather than guessing one.
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
		// The prefill extend carries ONE reply on, so it names it (B7); the
		// composer's Continue — fire the turn order's head — is `advance`.
		extend: (args) =>
			withMessage("extend", args, (m) =>
				handleExtendMessage(new Event("invoke"), m)
			),
		advance: () => handleAdvance(new Event("invoke")),
		// Pick who speaks and the narrator's turn (B8): the chips' own
		// handlers — the list decided they are here.
		pick: () => handlePickSpeaker(new Event("invoke")),
		narrate: () => handleFireNarratorTurn(new Event("invoke")),
		// Regenerate the last turn, as a whole (R2): the confirm first.
		retake: () => handleRetake(new Event("invoke")),
		retry: (args) =>
			args?.messageId != null
				? withMessage("retry", args, (m) => {
						const regenerate = () =>
							handleRegenerateMessage(new Event("invoke"), m)
						// In a retake genre a row that is not a delver's may be
						// one part of a several-row turn: the whole turn is
						// regenerated then, else the row as always (R2).
						if (
							extraAction("retake") &&
							m.characterId == null &&
							m.role !== "user"
						)
							retake.pressRow(m.id, regenerate)
						else regenerate()
					})
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
	 * page's own `fireOfferedAction`, which names the run and opens the narrator's
	 * modal, and the chip, the menu row and the widget are then one lane.
	 */
	const actionDispatch: ActionDispatch = {
		// A core verb takes no text (S2): `/advance x` is refused, never run.
		core: Object.fromEntries(
			Object.entries(coreVerbs).map(([key, handler]) => [
				key,
				(args?: InvokeArgs) => {
					if (args?.text?.trim()) {
						const identity = actionIdentity({ specSlug: "core", key })
						const route = routePress(listedAction(identity), { text: args.text }, key)
						if (route.route === "refuse") return refusePress(route.reason, identity)
					}
					handler?.(args)
				}
			])
		),
		// The text a press supplies (S2's slash argument) is the draft's:
		// the run spends it (D1) when the composer still holds it.
		fire: (a, args) =>
			fireOfferedAction(
				a,
				args,
				args?.text !== undefined ? { text: args.text, fromDraft: true } : undefined
			)
	}

	/** A press refused before it fired (S2): said, and nothing runs; the draft stays. */
	function refusePress(reason: string, identity?: string | null) {
		toaster.error({ title: runActionTitle(identity ?? undefined), description: reason })
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

	/** A run's toast title: the pressed action's name, never its `<spec>#<key>` identity. */
	const runActionTitle = (action: string | undefined) =>
		actionTitle(action, Object.values(actionVenues).flatMap((v) => [...v.primary, ...v.overflow]))

	function handleSessionsFireAction(
		msg: Sockets.Sessions.FireAction.Response
	) {
		if (msg.sessionId !== sessionId) return
		// The draft a text-taking press spent when it fired (note 31) comes
		// back when its run was refused, failed or was stopped — into an
		// empty composer only, never over what the person has typed since.
		if (draftSent && msg.action === draftSent.identity) {
			const giveBack = draftToGiveBack(msg, draftSent.draft, newMessage)
			if (giveBack !== null) writeDraft(giveBack)
			draftSent = null
		}
		// Cancelled FIRST, and never as an error. Somebody pressing Cancel is
		// a deliberate act; it gets no red toast for doing exactly what was
		// asked.
		if (msg.cancelled) {
			// A supersede is bookkeeping — the client re-sent the same run id,
			// so the run this replaces is one nobody watched and nobody
			// stopped. Its replacement is what the person is looking at, and a
			// notice about the one it displaced would be noise blaming them
			// for a cancel they did not make.
			if (msg.cancelledBy !== "system:superseded")
				toaster.info({ title: runActionTitle(msg.action), description: "Cancelled." })
			// Still re-read: a run stops BETWEEN nodes, so a consumer earlier
			// in the spec may already have written. "Cancelled" is all this
			// knows; "nothing happened" is a claim it cannot make.
			socket.emit("sessions:get", { id: sessionId })
		} else if (msg.error) {
			toaster.error({ title: runActionTitle(msg.action), description: msg.error })
		} else if (msg.success) {
			// The spec's consumers wrote whatever they wrote — re-read the session
			// so it shows.
			socket.emit("sessions:get", { id: sessionId })
		}
	}

	/**
	 * THE `sessions:fireAction` emit. There is no other on this page, and
	 * a second one would be a second, lesser fire for whoever pressed from the
	 * wrong place: every press — a chip, the `/` palette, a message's ⋮ menu,
	 * a widget's `invoke(key)`, a frame's `{ t: "invoke" }`, a bare frame
	 * action, a form answered on the row — is named as a run here, so Cancel
	 * reaches it during the window between the press and the first progress
	 * event, which is exactly when somebody realises they meant something
	 * else.
	 *
	 * Deliberately below the bespoke client flows rather than around them:
	 * `fireOfferedAction` diverts the narrator's functions before calling this, and
	 * a press answering a form calls it straight, because a form's button must
	 * answer the form whatever its function happens to be named.
	 */
	function emitFireAction(p: {
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
		/** The text the press collected (lair pass R3): the collect modal's, or S2's slash argument. */
		text?: string
		/** The cast members the press collected (R3), `character:<id>`. */
		recipients?: string[]
	}) {
		socket.emit("sessions:fireAction", {
			sessionId,
			...(p.identity ? { action: p.identity } : { key: p.fn }),
			...(p.messageId != null ? { messageId: p.messageId } : {}),
			...(p.blockId ? { blockId: p.blockId } : {}),
			...(p.text ? { text: p.text } : {}),
			...(p.recipients ? { recipients: p.recipients } : {}),
			...(p.payload && Object.keys(p.payload).length
				? { payload: p.payload }
				: {}),
			runId: uuid()
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
	function fireOfferedAction(
		a: {
			specSlug?: string
			key: string
		},
		args?: InvokeArgs,
		/**
		 * What the press already collected (lair pass R3) — S2's slash
		 * argument, say. `fromDraft` when that text is the composer's draft,
		 * which the run then spends (D1). Absent, a collecting action opens
		 * the collect modal.
		 */
		supplied?: Collected & { fromDraft?: boolean }
	) {
		// The functions with a bespoke client flow: both halves of the narrator
		// split open the same modal — whose first step *is* the choice between
		// them — and fire the dedicated event. Everything else is the generic
		// fire (19 §4).
		//
		// Never for a press that carries a `blockId`, whatever it is named: a
		// form answer answers its form. `fireBlockAction` goes straight to
		// `emitFireAction` for exactly that reason, but it is not the only way a
		// block's press arrives — a widget's `invoke(key, { blockId })` and a
		// frame's `{ t: "invoke", blockId }` come through this wrapper — so the
		// rule belongs here too, or a form whose action is one of the
		// narrator's two opens the modal and leaves its question unanswered and
		// still answerable.
		const identity = a.specSlug
			? actionIdentity({ specSlug: a.specSlug, key: a.key })
			: null
		// What the press collects (lair pass R3) and what it supplied (S2's
		// slash argument): ONE routing (`routePress`). Text to an action that
		// collects none — `/narrator x` among them, before the narrator's
		// divert — is refused and nothing fires; the draft stays.
		const listedRow = identity ? listedAction(identity) : undefined
		const listed = identity ? (listedRow ?? formCollects[identity]) : undefined
		const route = routePress(
			listed ? { slash: listedRow?.slash, name: listed.name, collects: listed.collects } : undefined,
			supplied,
			a.key
		)
		if (route.route === "refuse") {
			refusePress(route.reason, identity ?? a.key)
			return
		}
		if (
			!args?.blockId &&
			(identity === NARRATE_ACTION ||
				identity === NARRATE_CHARACTER_ACTION ||
				(!identity &&
					(a.key === "narrate" || a.key === "narrate-character")))
		) {
			// `/narrate the storm breaks` (C2): who speaks is answered — the
			// narrator — and what happens is the argument, so it fires. The
			// draft the argument came from is spent when the narration lands,
			// and kept when it is refused or fails.
			const direction = narrateDirectly(identity, route)
			if (direction) narrations.directed(direction, !!supplied?.fromDraft)
			else openNarrateModal()
			return
		}
		// A collecting action opens the collect modal, from any venue — a
		// chip, the palette, a message's ⋮, a widget's invoke, a form's
		// option — unless the press already supplied what it collects; an
		// argument cannot carry recipients (Whisper), so that modal opens
		// prefilled with it. Nothing reads the draft.
		if (route.route === "modal") {
			collecting = {
				action: listed!,
				identity: identity!,
				fn: a.key,
				args,
				initialText: route.initialText,
				fromDraft: !!supplied?.fromDraft
			}
			return
		}
		if (route.route === "fire") {
			if (supplied?.fromDraft && route.collected.text) spendDraft(identity!, route.collected.text)
			emitFireAction({
				fn: a.key,
				identity,
				messageId: args?.messageId,
				payload: args?.payload,
				blockId: args?.blockId,
				...route.collected
			})
			return
		}
		emitFireAction({
			fn: a.key,
			identity,
			messageId: args?.messageId,
			payload: args?.payload,
			blockId: args?.blockId
		})
	}
	/**
	 * The draft the last press spent, until its run answers (D1, note 31) —
	 * set only when the collected text was the composer's draft (S2's slash
	 * argument). The composer empties the moment the press fires; a refused
	 * or failed run gives the draft back.
	 */
	let draftSent: SpentDraft | null = null
	function spendDraft(identity: string, sent: string) {
		if (!draftHolds(sent, newMessage)) return
		draftSent = { identity, draft: newMessage }
		writeDraft("")
	}

	/** A listed action by identity, from any venue — what a press collects is on it. */
	function listedAction(identity: string): Sockets.Sessions.Actions.Action | undefined {
		for (const v of Object.values(actionVenues))
			for (const a of [...v.primary, ...v.overflow]) if (actionIdentity(a) === identity) return a
		return undefined
	}

	/** What the collect modal needs of a pressed action: its name, description and fields. */
	type CollectingAction = { name: string; description?: string; collects?: ListedCollects }

	/**
	 * The action a press collects for, by identity: a listed one (any venue),
	 * else a form-venue one — pressed from its block alone, so never listed
	 * (lair pass R9; `formCollects`).
	 */
	function collectingAction(identity: string): CollectingAction | undefined {
		return listedAction(identity) ?? formCollects[identity]
	}

	/** The press the collect modal is open for (lair pass R3), until submit or Cancel. */
	let collecting = $state<{
		action: CollectingAction
		identity: string
		fn: string
		args?: InvokeArgs
		initialText: string
		/** The prefilled text was the composer's draft (S2): the run spends it (D1). */
		fromDraft?: boolean
	} | null>(null)

	/**
	 * Who a collecting action may pick: the session's enabled cast members —
	 * each with what the action's overwritten slot holds for them now (lair
	 * re-plan R10: a delver's current whisper), so a replace is visible.
	 */
	let collectCast = $derived.by(() => {
		const overwrites = collecting?.action.collects?.recipients?.overwrites
		const slotKey = overwrites ? stateStore.slots.get(overwrites)?.key : undefined
		return (session?.sessionCharacters ?? [])
			.filter((cc) => cc.character && cc.isActive && !cc.removedAt)
			.map((cc) => {
				const holds = holdsOf(stateStore.state, slotKey, cc.character.id)
				return {
					ref: `character:${cc.character.id}`,
					name: resolveCharacterName(cc.character, cc.character.name),
					...(holds ? { holds } : {})
				}
			})
	})

	function submitCollected(got: Collected) {
		const press = collecting
		collecting = null
		if (!press?.action.collects) return
		if (press.fromDraft && press.initialText) spendDraft(press.identity, press.initialText)
		emitFireAction({
			fn: press.fn,
			identity: press.identity,
			messageId: press.args?.messageId,
			payload: press.args?.payload,
			blockId: press.args?.blockId,
			...collectedFire(press.action.collects, got)
		})
	}

	/**
	 * A contributed action fired from a message's options menu or quick row
	 * (19 §4). The message is the subject: its id rides the run's input, so
	 * the winning spec receives which message the person meant.
	 */
	function fireMenuAction(
		a: Sockets.Sessions.Actions.Action,
		msg: SelectSessionMessage
	) {
		fireOfferedAction(a, { messageId: msg.id })
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
		// Past `fireOfferedAction`: a form's button is not an offered action,
		// so it takes none of the offered ones' bespoke client flows — a block
		// whose function happens to be one of the narrator's must answer the
		// form, not open the narrator's modal. The run is named all the same,
		// so Cancel reaches a press made here like any other.
		//
		// But what the action collects is asked for here too (lair pass R3):
		// a form's option of a collecting action opens the collect modal, and
		// the answer rides with the typed text.
		const listed = action ? collectingAction(action) : undefined
		if (listed?.collects && opensModal(listed)) {
			collecting = {
				action: listed,
				identity: action!,
				fn,
				args: { messageId: msg.id, payload, blockId },
				initialText: ""
			}
			return
		}
		emitFireAction({
			fn,
			identity: action,
			messageId: msg.id,
			payload,
			blockId
		})
	}

	/** `book-open-text` → `BookOpenText`, resolved against the lucide set. */
	function actionIcon(name?: string) {
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
		// "sessionMessage:error" (page-level so a run that failed while
		// minimized is not silent), "media:changed",
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
			if (autoAdvanceTimeout) {
				clearTimeout(autoAdvanceTimeout)
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

	// Asked once per session. On the id, not `session`: reading through the
	// object would re-ask per token.
	$effect(() => {
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
	/** What the media lightbox shows: one image, or a message's media strip. */
	let lightboxState = $state<LightboxState | null>(null)

	// Scene image pins: loaded and persisted per session, mirrored into the
	// shared store the layout draws from (`sessionPage/scenePins.svelte.ts`).
	const scenePins = new ScenePins(() => sessionId)
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
				: typeof payload.slotId === "string"
					? (stateStore.slotLabelFor(payload.slotId) ?? payload.slotId)
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
	/**
	 * The faces core's box takes (C7, `remoteFace.ts`): the app's media,
	 * `https:` and raster data pass; an envoy's SVG is drawn to a WebP here
	 * first (none until it lands); `http:` is none.
	 */
	const remoteFaces = createRemoteFaces()

	let conversationDossier: ConversationDossierV1 | null = $derived.by(() => {
		if (!session) return null
		const lines: ConversationDossierV1["lines"] = {}
		// A line's facts are rebuilt only when something they read changed —
		// a streamed token rewrites one row's text, not who spoke every line.
		const castKey = [
			userCtx.user?.id,
			isGuest,
			// `promptDetails` reads both.
			userCtx.user?.isAdmin,
			systemSettingsCtx.settings?.contextDebuggingEnabled,
			// A face drawn for the box landed: the lines waiting on it rebuild.
			remoteFaces.landed,
			lastMessage?.id,
			lastAuthorMessage?.id,
			canRegenerateLastMessage,
			systemSettingsCtx.settings?.activeEmbeddingModel,
			...(session.sessionCharacters ?? []).map((cc) => `${cc.characterId}:${cc.character?.name}:${cc.character?.avatarMediaId}`),
			...(session.sessionPersonas ?? []).map((cp) => `${cp.personaId}:${cp.persona?.name}:${cp.persona?.userId}`),
			// An envoy's line takes its name and face off the view's list (U5g).
			// A data: image by its length (it rides every line's key), a URL whole.
			...(sessionFrames?.envoys ?? []).map(
				(e) => `${e.slug}:${e.name}:${e.image?.startsWith("data:") ? e.image.length : e.image}`
			),
			// A person's own line: the label and the members that name it (R4).
			sessionPlayerLabel,
			// A line nobody claims: the own voice's name (R5).
			ownVoice,
			...(session.sessionGuests ?? []).map(
				(g) => `${g.userId}:${g.user?.displayName}:${g.user?.username}`
			)
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
				// Who the row names (U5g); a fallback stamped at the write.
				(m.metadata as { speaker?: unknown } | undefined)?.speaker,
				(m.metadata as any)?.sprite,
				m.metadata?.isGreeting,
				m.metadata?.swipes?.currentIdx,
				m.metadata?.swipes?.history?.length,
				(m as { embeddingModel?: string | null }).embeddingModel,
				!!(m as { debugMeta?: unknown }).debugMeta
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
						: resolveCharacterName(who, ownVoice),
					ref,
					face: remoteFaces.face(avatarSrc(who)),
					sprite: remoteFaces.face(spriteSrc(who as any, shownSpriteOf(m), { variantKey: m.id })),
					// Whose "Dungeon Master" line it is, on a shared session (R4).
					...(m.role === "user" &&
					m.personaId == null &&
					!m.characterId &&
					!m.isNarratorResponse
						? (() => {
								const member = personLine(m)?.member
								return member ? { member } : {}
							})()
						: {})
				},
				swipes: { show: showSwipeControls(m, greeting), right: canSwipeRight(m, greeting) },
				embedding: embeddingStatusOf((m as { embeddingModel?: string | null }).embeddingModel),
				// Whether a prompt is on record — the prompt itself stays on the
				// page (`prompt-details`); rows reach the widget without it.
				promptDetails:
					!!userCtx.user?.isAdmin &&
					!!systemSettingsCtx.settings?.contextDebuggingEnabled &&
					!!(m as { debugMeta?: unknown }).debugMeta
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
			extendRefusal,
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
				draft: composerDraft,
				personas: userPersonasInSession
					.filter((cp) => cp.persona && cp.personaId != null)
					.map((cp) => ({ personaId: cp.personaId!, name: cp.persona!.name })),
				personaId:
					currentUserPersona?.personaId ??
					(!isGuest ? (session.sessionPersonas?.[0]?.personaId ?? null) : null),
				addPersona: showAddPersonaCTA,
				// "Write as the Dungeon Master…" (R4's label; S2).
				...(sessionPlayerLabel ? { playerLabel: sessionPlayerLabel } : {}),
				hidden: composerHidden,
				channels: sessionChannels,
				// What each channel is called (S1): the strip and a pinned
				// copy's head read the Lair's `sanctum` as _Sanctum_.
				...(sessionFrames?.channelLabels
					? { channelLabels: sessionFrames.channelLabels }
					: {}),
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
				sendTonal: shouldShowNextCharacterBlock,
				tray: composerTray.view,
				attachments: composerTray.readers
			},
			turn: {
				order: $state.snapshot(turnOrder?.order ?? []) as ConversationDossierV1["turn"]["order"],
				candidates: $state.snapshot(turnOrder?.candidates ?? []) as ConversationDossierV1["turn"]["candidates"],
				show: shouldShowNextCharacterBlock,
				canChoose: canChooseDifferentCharacter,
				ownVoiceName: ownVoice
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
	/**
	 * 🚧 `session_state.v1` (R72) for any widget granted `session:state` —
	 * core's state widgets, or a plugin's an admin granted
	 * `widget:session:state`: the store's one resolved read, projected once
	 * and read by every panel holding the grant. Lazy — computed only while
	 * some granted widget reads it.
	 */
	const sessionStateSection = $derived(
		sessionId == null
			? undefined
			: projectSessionState(
					{
						sessionId: stateStore.sessionId,
						loaded: stateStore.loaded,
						readError: stateStore.readError,
						state: stateStore.state,
						slots: stateStore.slots.values(),
						owners: stateStore.owners.values()
					},
					sessionId
				)
	)
	setContext(SESSION_STATE_KEY, {
		get current() {
			return sessionStateSection
		}
	})
	/**
	 * 🚧 `characters.v1` (R76) for any widget granted `characters` — core's
	 * scene portraits, or a plugin's an admin granted `widget:characters`:
	 * the cast, cast over card, with the page's own scene-image pins riding
	 * along. Lazy, like the state section; never another session's cast
	 * while the payload still lags the address; untouched by a streamed
	 * chunk that moves no current sprite (`charactersSection.svelte.ts`).
	 */
	const sessionCharactersSection = charactersSection({
		sessionId: () => sessionId,
		session: () => session,
		viewerUserId: () => userCtx.user?.id ?? null,
		voicedPersonaId: () => currentUserPersona?.personaId,
		sceneImages: () => ({ left: scenePins.left, right: scenePins.right })
	})
	setContext(SESSION_CHARACTERS_KEY, sessionCharactersSection)

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
		openSessionCtx.isGenerating = false
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

	function handleImageClick(src: string, gallery?: ViewImageGallery) {
		lightboxState = lightboxStateOf({ src, gallery })
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
					session={loadedSessionId !== null
						? { id: loadedSessionId, name: sessionName }
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
				{startedFromLayoutPresetId}
				{startedFromUpdated}
				onStartFrom={startLayoutFrom}
				onSavePreset={saveLayoutPreset}
				onRenamePreset={renameLayoutPreset}
				onDeletePreset={deleteLayoutPreset}
				onPresetUsage={askLayoutPresetUsage}
				presetUsage={layoutPresetUsage}
				onSaveChanges={saveLayoutChanges}
				onShareLayout={shareLayout}
				onCloneLayout={cloneLayout}
				onSetNewSessionLayout={setNewSessionLayout}
				{genreName}
				{isGuest}
				isAdmin={!!userCtx.user?.isAdmin}
				{layoutSettings}
				onLayoutSettings={persistLayoutSettings}
				actions={actionVenues}
				{actionDispatch}
				onFrameAction={handleFrameAction}
			/>
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
					<p
						class="text-surface-600-400 animate-pulse text-sm motion-reduce:animate-none"
					>
						{typingPersona.name} is typing…
					</p>
				</div>
			{/each}
		{/if}
	{/snippet}

	{#if showProcessSceneModal && processSceneId !== null && sessionLorebookId}
		<ProcessSceneModal
			open={showProcessSceneModal}
			onOpenChange={(e) => (showProcessSceneModal = e.open)}
			sceneId={processSceneId}
			activityId={processActivityId}
			pendingResult={processPendingResult}
			lorebookId={sessionLorebookId}
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
		branchId={sessionLorebookBranchId}
		storyClock={sessionStoryClock}
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
						<h2 class="h2">Delete this message?</h2>
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
						{@const src = { characters: [], personas: [], ...promptDetails.meta.sources }}
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
									class="text-surface-700-300 text-xs font-semibold"
								>
									Token budget
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
									class="text-surface-700-300 text-xs font-semibold"
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
								Built on what the pipeline actually records: it scores
								candidates, allocates a budget, and records per block
								why that block is in or out. There are no phase
								counters or score histogram, because the pipeline has
								no phases to count.

								This answers the question the panel is for —
								"why isn't my lore showing up" — directly, per entry.
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
											class="text-surface-700-300 text-xs font-semibold"
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
									class="text-surface-700-300 text-xs font-semibold"
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
									class="text-surface-700-300 text-xs font-semibold"
								>
									Prompt preview
								</h3>
								{#if promptDetails.messages && promptDetails.messages.length > 0}
									<!-- Chat format: render each message block -->
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
														class="text-xs font-semibold capitalize {msg.role ===
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
		offerNarrator={!!narratorTurn || narratorFunction}
		ownVoiceName={narratorTurn ? ownVoice : narratorName}
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
		open={showPickSpeakerModal}
		onOpenChange={(e) => (showPickSpeakerModal = e.open)}
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
								(showPickSpeakerModal = false)}
						>
							<Icons.X size={20} />
						</button>
					</header>
					<!-- The narrator row (B8): only where it is wired — a narrator
					     genre's own turn (`narrate`), else Chat's narrate function. -->
					{#if narratorTurn || narratorFunction}
						<button
							class="border-surface-200-800 hover:bg-surface-200-800 mb-4 flex w-full items-center gap-3 rounded border p-2"
							class:opacity-60={narratorRowChip?.disabled}
							class:cursor-not-allowed={narratorRowChip?.disabled}
							aria-disabled={narratorRowChip?.disabled}
							title={narratorRowChip?.reason
								? `${narratorTurn ? ownVoice : narratorName} — ${narratorRowChip.reason}`
								: undefined}
							onclick={handleNarratorRow}
						>
							<div
								class="bg-primary-500/10 text-primary-500 shrink-0 rounded-lg p-2"
							>
								<Icons.CloudSun size={20} />
							</div>
							<div class="flex-1 text-left">
								<!-- A narrator genre's turn is the own voice's (R5): the
								     Lair's reads "Castellan". Chat's narrate function
								     keeps the narrator's name. -->
								<div class="font-semibold">{narratorTurn ? ownVoice : narratorName}</div>
								<div
									class="text-surface-700-300 text-xs"
								>
									{#if narratorRowChip?.reason}
										{narratorRowChip.reason}
									{:else if narratorTurn}
										Let {ownVoice} take the turn instead
									{:else}
										Narrate the environment, atmosphere, or side
										characters instead
									{/if}
								</div>
							</div>
						</button>
					{/if}
					<div class="mb-4">
						<PanelFilterInput
							bind:value={pickSpeakerSearch}
							placeholder="characters"
							count={session?.sessionCharacters?.length ?? 0}
							aria-label="Search characters"
						/>
					</div>
					<div class="max-h-[60dvh] min-h-0 overflow-y-auto">
						<div
							class="relative flex flex-col pr-2 lg:flex-row lg:flex-wrap"
						>
							{#each (session?.sessionCharacters || []).filter( (cc) => {
									const c = cc.character
									if (!c) return false
									const s = pickSpeakerSearch
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
										class="border-surface-200-800 hover:bg-surface-200-800 relative flex w-full gap-3 overflow-hidden rounded border p-2"
										onclick={() =>
											onPickSpeaker(
												filtered.character.id
											)}
									>
										<div class="w-fit shrink-0">
											<Avatar
												char={filtered.character}
												size="lg"
												decorative
											/>
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
												class="text-surface-700-300 line-clamp-2 w-full text-left text-xs"
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

	<CollectModal
		open={!!collecting}
		action={collecting?.action.collects
			? {
					name: collecting.action.name,
					description: collecting.action.description,
					collects: collecting.action.collects
				}
			: null}
		cast={collectCast}
		{ownVoice}
		initialText={collecting?.initialText ?? ""}
		onSubmit={submitCollected}
		onCancel={() => (collecting = null)}
	/>

	<RetakeConfirm
		open={showRetakeConfirm}
		rows={retakeRows}
		onConfirm={(quietly) => {
			showRetakeConfirm = false
			retake.confirm(quietly)
		}}
		onCancel={() => {
			showRetakeConfirm = false
			retake.cancel()
		}}
	/>

	<NarratorResponseModal
		open={showNarratorResponseModal}
		onOpenChange={(e) => (showNarratorResponseModal = e.open)}
		onFire={handleConfirmNarratorResponse}
		onCancel={handleCancelNarratorResponse}
		{narratorName}
		sideCharacters={sideCharacterOptions}
		collectsText={listedAction(NARRATE_ACTION)?.collects?.text}
		unlandedPress={narratorUnlandedPress}
	/>

	<EntityGalleryViewModal
		bind:open={showAvatarModal}
		onOpenChange={(e) => (showAvatarModal = e.open)}
		entity={avatarModalEntity}
	/>

	<MediaLightbox
		bind:open={showImageModal}
		onOpenChange={(e) => (showImageModal = e.open)}
		state={lightboxState}
	/>

	<!-- Not mounted where the genre has no personas (`personas.max: 0`): the
	     picker holds a standing `characters:list` interest and its empty
	     state would speak of a system the session does not have. -->
	{#if personasInMode}
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
	{/if}

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
		<!-- Ids, never `{session.x}`: a bare member chain is a getter over the
		     object a streamed chunk replaces, and would re-run these
		     children's effects per token (B8). -->
		{#if sessionLorebookId && (sessionUserId === userCtx.user?.id || userCtx.user?.isAdmin)}
			<SessionWorkflowTab
				lorebookId={sessionLorebookId}
				branchId={sessionLorebookBranchId}
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
					sessionId={loadedSessionId}
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
				<SessionUsagePanel sessionId={loadedSessionId} />
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
			bind:leftImage={scenePins.left}
			bind:rightImage={scenePins.right}
		/>
	{/snippet}

	{#snippet extraControlsButton()}
		<Icons.MessageSquare size="0.75em" />
	{/snippet}

	{#snippet extraControlsContent(channel?: string)}
		<!-- No box of its own (note 30, 2026-10-02): these chips are drawn
		     straight into the composer's one Actions row, first, ahead of the
		     genre's actions and More — one group, one chip
		     (`sessionChipClass`), the row's spacing. -->
		<!-- Character-response mechanics (19 §2): a mode whose shape has
		     no character system is offered no Continue and no Pick — the
		     SDK's `turnControlDefault`, applied by the server's list. The
		     persona half of the disabled check follows the shape — a
		     persona-less mode's turns need no persona on record. -->
		<!-- The turn controls (R-15, U5c; B7, B8): Continue is core's
		     `advance`, Pick who speaks core's `pick`, Regenerate core's
		     `retry`, all at the extra venue and drawn only when the list
		     carries them. Whether a turn control is here at all is the
		     SERVER's verdict — the genre's `turnControls` and their
		     present-when — and nothing here recomputes it. Continue fires the next turn,
		     never the message's prefill `extend`. The narrator's turn
		     (`narrate`) has no chip: it is the narrator row of the two
		     pickers, and `/narrator`. -->
		<!-- Greyed, not disabled (S6): `aria-disabled` keeps the chip in
		     the tab order and the reason — the listed verdict's, or the
		     newest row's — reaches a screen reader through
		     `aria-describedby`; the click is guarded instead. -->
		{#if extraActionOn("advance", channel)}
			{@const t = extraActionOn("advance", channel)!}
			{@const chip = extraChip(t, [[needsPersona, NO_PERSONA]])}
			<button
				class={sessionChipClass}
				class:opacity-60={chip.disabled}
				class:cursor-not-allowed={chip.disabled}
				title={chip.reason
					? `Continue — ${chip.reason}`
					: (t.description ?? "Continue the conversation")}
				aria-disabled={chip.disabled}
				aria-describedby={chip.reason
					? `extra-note-advance-${channel ?? "main"}`
					: undefined}
				onclick={(e) =>
					chip.disabled
						? e.preventDefault()
						: handleAdvance(e, channel)}
			>
				<Icons.MessageSquareMore size={14} />
				Continue
			</button>
			{#if chip.reason}
				<span id="extra-note-advance-{channel ?? 'main'}" class="sr-only">
					{chip.reason}
				</span>
			{/if}
		{/if}
		{#if extraActionOn("pick", channel)}
			{@const t = extraActionOn("pick", channel)!}
			{@const pick = extraChip(t, [[needsPersona, NO_PERSONA]])}
			<button
				class={sessionChipClass}
				class:opacity-60={pick.disabled}
				class:cursor-not-allowed={pick.disabled}
				title={pick.reason
					? `Pick who speaks — ${pick.reason}`
					: (t.description ?? "Pick who speaks")}
				aria-disabled={pick.disabled}
				aria-describedby={pick.reason
					? `extra-note-pick-${channel ?? "main"}`
					: undefined}
				onclick={(e) =>
					pick.disabled
						? e.preventDefault()
						: handlePickSpeaker(e)}
			>
				<Icons.MessageSquarePlus size={14} />
				Pick who speaks
			</button>
			{#if pick.reason}
				<span id="extra-note-pick-{channel ?? 'main'}" class="sr-only">
					{pick.reason}
				</span>
			{/if}
		{/if}
		<!-- Narrate (S1): where a channel's listing carries the narrator's
		     turn but no Pick — the Sanctum's — the pickers' narrator row
		     is out of reach, so the turn is its own chip there. Elsewhere
		     it stays the pickers' row and `/narrator`. -->
		{#if extraActionOn("narrate", channel) && !extraActionOn("pick", channel)}
			{@const t = extraActionOn("narrate", channel)!}
			{@const chip = extraChip(t)}
			<button
				class={sessionChipClass}
				class:opacity-60={chip.disabled}
				class:cursor-not-allowed={chip.disabled}
				title={chip.reason
					? `${t.name} — ${chip.reason}`
					: (t.description ?? t.name)}
				aria-disabled={chip.disabled}
				aria-describedby={chip.reason
					? `extra-note-narrate-${channel ?? "main"}`
					: undefined}
				onclick={(e) =>
					chip.disabled
						? e.preventDefault()
						: handleFireNarratorTurn(e, channel)}
			>
				<Icons.CloudSun size={14} />
				{t.name}
			</button>
			{#if chip.reason}
				<span id="extra-note-narrate-{channel ?? 'main'}" class="sr-only">
					{chip.reason}
				</span>
			{/if}
		{/if}
		<!-- Regenerate the last turn, as a whole (`retake`, R2): where
		     the genre offers it, the server lists it here and takes the
		     row regenerate (`retry`) off this venue, so one chip reads
		     Regenerate. -->
		{#if extraActionOn("retake", channel)}
			{@const t = extraActionOn("retake", channel)!}
			{@const chip = extraChip(t)}
			<button
				class={sessionChipClass}
				class:opacity-60={chip.disabled}
				class:cursor-not-allowed={chip.disabled}
				title={chip.reason
					? `Regenerate — ${chip.reason}`
					: (t.description ?? "Regenerate the last turn")}
				aria-disabled={chip.disabled}
				aria-describedby={chip.reason
					? `extra-note-retake-${channel ?? "main"}`
					: undefined}
				onclick={(e) =>
					chip.disabled
						? e.preventDefault()
						: handleRetake(e)}
			>
				<Icons.RefreshCw size={14} />
				Regenerate
			</button>
			{#if chip.reason}
				<span id="extra-note-retake-{channel ?? 'main'}" class="sr-only">
					{chip.reason}
				</span>
			{/if}
		{/if}
		<!-- Absent, not disabled, when the genre does not offer retry
		     (R-15): a dice-are-final genre has no reply to redo. -->
		{#if extraActionOn("retry", channel)}
			{@const t = extraActionOn("retry", channel)!}
			{@const chip = extraChip(t)}
			<button
				class={sessionChipClass}
				class:opacity-60={chip.disabled}
				class:cursor-not-allowed={chip.disabled}
				title={chip.reason
					? `Regenerate — ${chip.reason}`
					: (t.description ?? "Regenerate the last reply")}
				aria-disabled={chip.disabled}
				aria-describedby={chip.reason
					? `extra-note-retry-${channel ?? "main"}`
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
				<span id="extra-note-retry-{channel ?? 'main'}" class="sr-only">
					{chip.reason}
				</span>
			{/if}
		{/if}
		<!-- The legend here when the genre lists no chips (so the
		     genre's view, which carries it, is not drawn): a genre with
		     none still has a way to learn what its controls and message
		     menu do. -->
		{#if !sessionActions.length}
			<ActionLegend sections={actionLegend} />
		{/if}
	{/snippet}

	<!-- The contributed trigger set (19 §4): rendered from rows, so a retired
	     contributor takes its button with it. It is the composer's own action
	     row rather than a tab panel, because an action the genre contributes is
	     how that genre is played and must not need a tab opened first. The
	     narrate function keeps its bespoke presentation — the resolved narrator
	     name and its instructions modal — mapped on the function key. -->
	<!-- The run in flight, above the composer (a host view, C0b). -->
	{#snippet runProgress()}
		{#if loadedSessionId}
			<RunProgressCard sessionId={loadedSessionId} />
		{/if}
	{/snippet}

	{#snippet ragNotice()}
		{#if loadedSessionId}
			<RagNotice
				sessionId={loadedSessionId}
				totalMessages={session?.sessionMessages?.length ?? 0}
			/>
		{/if}
	{/snippet}

	{#snippet sessionActionsRow(channel?: string)}
		<!-- Keyed by the action's identity (W3): two actions on one function
		     — core's and a plugin's `summarize` — are two chips. -->
		<!-- This composer's channel's chips (S1): the Sanctum's on the
		     Sanctum panel, `main`'s elsewhere. -->
		{#each onOtherChannel(channel) ? venueOn("composer", channel).primary : sessionActions as t (actionIdentity(t))}
			{@const chip = paletteRowState(chipVerdict(t), {
				generating: !session || !!lastMessage?.isGenerating,
				newest: newestItem,
				statusText
			})}
			{@const chipNoteId = `chip-note-${channel ?? "main"}-${actionIdentity(t).replace(/[^a-z0-9-]/g, "-")}`}
			<!-- Greyed, not disabled (S6): `aria-disabled` keeps the chip in
			     the tab order and the reason reaches a screen reader through
			     `aria-describedby`; a native `disabled` is skipped and says
			     nothing. The click is guarded instead. -->
			<!-- `narrate-character` deliberately falls through to the generic
			     branch: `fireOfferedAction` routes it to the same modal, whose first
			     step is the choice between the two. A second bespoke button
			     here would be a second place to keep in step with the
			     narrator's resolved name. -->
			{#if actionIdentity(t) === NARRATE_ACTION}
				<button
					class={sessionChipClass}
					class:opacity-60={chip.disabled}
					class:cursor-not-allowed={chip.disabled}
					title={chip.reason
						? `${narratorName} — ${chip.reason}`
						: t.description
							? `${narratorName} — ${t.description}`
							: "Ask the narrator"}
					aria-disabled={chip.disabled}
					aria-describedby={chip.reason ? chipNoteId : undefined}
					onclick={(e) =>
						chip.disabled
							? e.preventDefault()
							: handleNarratorResponse(e)}
				>
					<Icons.CloudSun size={14} />
					{narratorName}
				</button>
			{:else}
				{@const ActionIconComponent = actionIcon(t.icon)}
				<!-- Seen by the audience's `see`, pressable by its `act` (R-15):
				     a guest sees the genre's vocabulary and is told, not
				     shown nothing. -->
				<button
					class={sessionChipClass}
					class:opacity-60={chip.disabled}
					class:cursor-not-allowed={chip.disabled}
					title={chip.reason
						? `${t.name} — ${chip.reason}`
						: t.description
							? `${t.name} — ${t.description}`
							: t.name}
					aria-disabled={chip.disabled}
					aria-describedby={chip.reason ? chipNoteId : undefined}
					onclick={(e) =>
						chip.disabled ? e.preventDefault() : fireOfferedAction(t)}
				>
					<ActionIconComponent size={14} />
					{t.name}
				</button>
			{/if}
			{#if chip.reason}
				<span id={chipNoteId} class="sr-only">{chip.reason}</span>
			{/if}
		{/each}
		<!-- The legend (2026-09-28): what every action here does, message
		     menu included, one "?" away. -->
		<ActionLegend sections={actionLegend} />
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
							class="text-surface-700-300 text-[11px]"
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
							class="text-surface-700-300 text-[11px]"
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
