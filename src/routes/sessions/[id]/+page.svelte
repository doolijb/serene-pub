<script lang="ts">
	// The session page: a composition root. Its stores live beside it in
	// `sessionPage/` — the inbox every reply arrives in (`sessionPageInbox`),
	// the loaded session (`sessionPageData`), the action list, the turns, a
	// message's controls, the presses (`pressRouting`), the composer's half,
	// the scenes, the session layout and the ask tables — and its views are
	// mounted below: the session layout (or a genre's session view), the host
	// views core's composer places, and the modals.
	import { v4 as uuid } from "uuid"
	import { rememberFiredAction } from "$lib/client/components/pipelines/actionRetry"
	import { avatarSrc } from "$lib/client/utils/media"
	import { hostElementContext, setHostParticipants } from "$lib/client/components/hostElements/context.svelte"
	import ChangeSpriteDialog from "$lib/client/components/sprites/ChangeSpriteDialog.svelte"
	import { asShownSprite } from "$lib/shared/sprites"
	import { openSessionState, sessionState } from "$lib/client/state/sessionState.svelte"
	import {
		SESSION_VIEWER_KEY,
		SESSION_TURN_ORDER_KEY,
		SESSION_ATTENDANCE_KEY,
		SESSION_DOSSIER_KEY,
		SESSION_STATE_KEY,
		SESSION_CHARACTERS_KEY,
		WIDGET_REQUESTS_KEY
	} from "$lib/shared/widgets/context"
	import { guardWidgetRequests } from "$lib/client/components/sessionPage/requests/askers"
	import {
		buildWidgetRequestAnswerer,
		type WidgetRequestDeps
	} from "$lib/client/components/sessionPage/requests"
	import {
		createNarrations,
		narrateDirectly,
		nextDraftWrite,
		type DraftWrite,
		type NarratorRequest
	} from "$lib/client/components/sessionPage/collects"
	import { ScenePins } from "$lib/client/components/sessionPage/scenePins.svelte"
	import {
		createSessionPageInbox,
		provideSessionPageInbox
	} from "$lib/client/components/sessionPage/sessionPageInbox.svelte"
	import { createSessionPageData } from "$lib/client/components/sessionPage/sessionPageData.svelte"
	import { headerCastKeyOf } from "$lib/client/components/sessionPage/sessionPageProjections"
	import { presetHeaderNotice } from "$lib/client/components/sessionPage/presetNotice"
	import { catchUpHeaderNotice } from "$lib/client/components/sessionPage/catchUpNotice"
	import type { CatchUpOffer } from "$lib/shared/sessions/archive"
	import { rewindStripState } from "@serene-pub/core-catalog/conversation"
	import { regeneratePress } from "$lib/shared/sessions/rewind"
	import { rewindPresses } from "$lib/client/components/sessionPage/requests/rewindTurn"
	import { createEnvelopeSections } from "$lib/client/components/sessionPage/envelopeSections.svelte"
	import { createActionList } from "$lib/client/components/sessionPage/actionList.svelte"
	import {
		createTurnFlow,
		type FiredPress
	} from "$lib/client/components/sessionPage/turnFlow.svelte"
	import { createMessageControls } from "$lib/client/components/sessionPage/messageControls.svelte"
	import { createPressRouting } from "$lib/client/components/sessionPage/pressRouting.svelte"
	import { createComposerFlow } from "$lib/client/components/sessionPage/composerFlow.svelte"
	import { createScenesFlow } from "$lib/client/components/sessionPage/scenesFlow.svelte"
	import { createSessionLayoutData } from "$lib/client/components/sessionPage/sessionLayoutData.svelte"
	import { createPageAsks } from "$lib/client/components/sessionPage/pageAsks"
	import { createSceneCuesFlow } from "$lib/client/components/sessionPage/sceneCuesFlow.svelte"
	import SessionHostViews from "$lib/client/components/sessionPage/SessionHostViews.svelte"
	import PromptDetailsModal from "$lib/client/components/sessionPage/PromptDetailsModal.svelte"
	import PickSpeakerModal from "$lib/client/components/sessionPage/PickSpeakerModal.svelte"
	import DeleteMessageDialog from "$lib/client/components/sessionPage/DeleteMessageDialog.svelte"
	import { page } from "$app/state"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
	import * as Icons from "@lucide/svelte"
	import PluginFrame from "$lib/client/components/frames/PluginFrame.svelte"
	import TurnPicker from "$lib/client/components/sessionPage/TurnPicker.svelte"
	import ProcessSceneModal from "$lib/client/components/modals/ProcessSceneModal.svelte"
	import ConfirmDialog from "$lib/client/components/loadouts/sheet/ConfirmDialog.svelte"
	import { removeSceneBody } from "$lib/client/components/sessionPage/liveSceneProjection"
	import { getContext, onDestroy, setContext, untrack } from "svelte"
	import PersonaSelectModal from "$lib/client/components/modals/PersonaSelectModal.svelte"
	import BranchSessionModal from "$lib/client/components/modals/BranchSessionModal.svelte"
	import SummarizeLoreModal from "$lib/client/components/modals/SummarizeLoreModal.svelte"
	import NarratorResponseModal from "$lib/client/components/modals/NarratorResponseModal.svelte"
	import RetakeConfirm from "$lib/client/components/sessionPage/RetakeConfirm.svelte"
	import ActionConfirm from "$lib/client/components/sessionPage/ActionConfirm.svelte"
	import CollectModal from "$lib/client/components/sessionPage/CollectModal.svelte"
	import EntityGalleryViewModal from "$lib/client/components/gallery/EntityGalleryViewModal.svelte"
	import MediaLightbox from "$lib/client/components/sessionPage/MediaLightbox.svelte"
	import { runInspector } from "$lib/client/stores/runInspector.svelte"
	import { terminateAllWorkers } from "$lib/client/components/host/uiWorkers"
	import { sceneImages } from "$lib/client/stores/sceneImages"
	import { toaster } from "$lib/client/utils/toaster"
	import { sessionBookOf } from "$lib/client/sessions/store/derive"
	import { resolveCharacterName } from "$lib/shared/utils/resolveCharacterName"
	import SessionLayout from "$lib/client/sessionLayout/SessionLayout.svelte"
	import { NARRATE_ACTION } from "$lib/shared/actions/identity"
	import { SurfaceManager } from "$lib/client/surfaces/panelManager.svelte"

	const socket = useTypedSocket()
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

	// Get session id from route params
	let sessionId: number = $derived.by(() => Number(page.params.id))

	/**
	 * The composer's draft as the page knows it, and the page's last write to
	 * core's composer draft (C0b, D1): the kept draft when the session opens,
	 * an empty one when a session switch or a spent action clears it. The
	 * composer owns the draft between writes and reports it (`draft`), which
	 * keeps `newMessage` — the token count, the save — in step; `writeDraft`
	 * is the one way the page changes it.
	 */
	let newMessage = $state("")
	let composerDraft = $state<DraftWrite>({ content: "", write: 0 })
	function writeDraft(content: string) {
		newMessage = content
		composerDraft = nextDraftWrite(untrack(() => composerDraft), content)
	}

	/**
	 * What the narrator modal held when its press did not land — refused
	 * before its run, stopped, or failed (C2 follow-up): kept as a refused
	 * `/narrate <text>` keeps its draft, and the modal opens with it until it
	 * fires again. This session's only: cleared on a switch of session with
	 * the draft.
	 */
	let narratorUnlandedPress = $state<NarratorRequest | null>(null)

	// ── Surface grid (plan 21) ──────────────────────────────────────
	// The modular session layout: the conversation is the primary panel, and
	// scene portraits / sample widgets flow into container-responsive tracks
	// beside it. Availability = the mode's declared panels (from sessions:view)
	// merged with core's defaults; placement is this user's, persisted.
	const surfaceManager = new SurfaceManager()

	// The ONE subscriber to every reply and push the page reads, declared
	// ahead of every store that registers on it and of the session-load
	// effect below: effects run in declaration order, so the keys are held
	// before the first request group goes out (plan ruling 3).
	const inbox = createSessionPageInbox({
		sessionId: () => sessionId,
		lorebookId: () => sessionLorebookId,
		ownLorebookId: () => ownLorebookId,
		authoredOwners: () => layout.authoredOwnersKey,
		widgets: surfaceManager
	})
	provideSessionPageInbox(inbox)

	/** What every store of the page is handed: the socket, the inbox, the session in the route. */
	const base = { socket, inbox, sessionId: () => sessionId }
	const data = createSessionPageData({
		...base,
		loadedSessionId: () => loadedSessionId,
		userCtx,
		widgets: surfaceManager,
		draft: () => newMessage,
		writeDraft
	})
	const session = $derived(data.session)

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
	// pr-6 (pass 9 S4): a primitive off the streamed session — the catch-up offer as a key.
	const sessionCatchUpKey: string = $derived(
		(session as { catchUp?: unknown } | undefined)?.catchUp
			? JSON.stringify((session as { catchUp: unknown }).catchUp)
			: ""
	)
	let catchUpDismissedFor = $state<number | null>(null)
	const sessionLorebookId = $derived(session?.lorebookId ?? null)
	// 🚧 pr-6 (B §B-3): the session's own book — its Session notes.
	const sessionOwnBookId: number | null = $derived((session as { ownBookId?: number | null } | undefined)?.ownBookId ?? null)
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
		openSessionCtx.cast = headerCast
	})
	// The stale-preset notice is the header's one line now (§3.16).
	const headerNotice = $derived(
		catchUpHeaderNotice(
			sessionCatchUpKey ? (JSON.parse(sessionCatchUpKey) as CatchUpOffer) : null,
			{
				dismissed: catchUpDismissedFor === loadedSessionId,
				dismiss: () => (catchUpDismissedFor = loadedSessionId),
				press: (id) => socket.emit("sessions:closeOut", { sessionId: id })
			}
		) ?? presetHeaderNotice(data, !!userCtx.user?.isAdmin)
	)
	$effect(() => {
		openSessionCtx.headerNotice = headerNotice
	})
	/**
	 * 🚧 Back · Forward (RF fix 5) in the header's right cluster (polish
	 * parity L1, 2026-10-24): the owner's three presses, Back, Forward and the
	 * turn's Regenerate (pr-6 D2), read by the widget's own rule
	 * (`rewindStripState`) off the ONE rewind state (`data.rewind`) the
	 * conversation's note reads, and busy as the host's door is
	 * (`data.generating`). Kept as a STRING, so the header moves only
	 * when a press's state does, never per streamed chunk.
	 */
	const rewindPress = rewindPresses(socket, () => sessionId)
	const headerRewindKey: string = $derived.by(() => {
		const strip = rewindStripState({
			rewind: data.rewind,
			isOwner: sessionUserId !== null && sessionUserId === userCtx.user?.id,
			generating: data.generating,
			story: true
		})
		const retakeAction = actions.extraActionOn("retake")
		const retakeChip = retakeAction ? actions.extraChip(retakeAction) : null
		const regenerate = regeneratePress({
			offered: !!retakeAction,
			generating: data.generating,
			listedReason: retakeChip?.disabled ? (retakeChip.reason ?? null) : null,
			rewind: data.rewind
		})
		return strip.shown
			? JSON.stringify({ back: strip.back, forward: strip.forward, ahead: strip.ahead, aheadText: strip.aheadText, regenerate })
			: ""
	})
	const headerRewind: SessionHeaderRewind | null = $derived(
		headerRewindKey
			? (() => {
					const parsed = JSON.parse(headerRewindKey) as Omit<SessionHeaderRewind, "goBack" | "goForward" | "regenerate"> & {
						regenerate: { disabled: boolean; reason?: string } | null
					}
					return {
						...parsed,
						goBack: rewindPress.rewindTurn,
						goForward: rewindPress.forwardTurn,
						regenerate: parsed.regenerate ? { ...parsed.regenerate, press: () => turns.retake.press() } : null
					}
				})()
			: null
	)
	$effect(() => {
		openSessionCtx.rewind = headerRewind
	})
	/**
	 * The session's book for its OWNER only — the lorebook it reads, else its own book (`sessionBookOf`) — whose cast (`lorebooks:bindingList`) the page reads. The book is the host's: the
	 * server refuses anyone else's ask ("Lorebook not found."), which a guest
	 * was shown on every visit for something they never did. Read through the
	 * primitives, never `session`: a streamed chunk replaces the object, and
	 * reading through it would re-ask per token.
	 */
	const ownLorebookId = $derived(
		sessionUserId !== null && sessionUserId === userCtx.user?.id
			? sessionBookOf({ lorebookId: sessionLorebookId, ownBookId: sessionOwnBookId })
			: null
	)

	const actions = createActionList({ ...base, data })
	/** The narrator's presses and answers (C2) — `createNarrations`. */
	const narrations = createNarrations({
		sessionId: () => sessionId,
		draft: () => newMessage,
		writeDraft: (content) => writeDraft(content),
		keepUnlanded: (press) => (narratorUnlandedPress = press),
		say: (error) =>
			toaster.error({
				title: actions.listedAction(NARRATE_ACTION)?.name ?? "Narrate",
				description: error
			}),
		send: (params) => socket.emit("sessions:fireNarratorResponse", params)
	})
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

	const turns = createTurnFlow({
		...base,
		data,
		actions,
		draft: () => newMessage,
		narrations,
		emitFireAction
	})
	const controls = createMessageControls({ ...base, data, actions })
	const composer = createComposerFlow({
		...base,
		loadedSessionId: () => loadedSessionId,
		loadedGenreId: () => loadedGenreId,
		data,
		turns,
		systemSettingsCtx,
		draft: () => newMessage,
		setNewMessage: (content) => (newMessage = content),
		restoreDraft: (content) => writeDraft(content),
		userId: () => userCtx.user?.id ?? null
	})
	const scenes = createScenesFlow({
		...base,
		ownLorebookId: () => ownLorebookId,
		data,
		sceneSummarizesCtx,
		sessionSummarizesCtx
	})
	const layout = createSessionLayoutData({ ...base, surfaceManager, data })
	const asks = createPageAsks(base)
	onDestroy(() => asks.drop("the session page closed before the server answered"))
	/**
	 * 🚧 The calendar of the book the session reads (PROPOSAL-live-scenes
	 * §15 G9), for the conversation's dates: read once per session and book
	 * (`sessions:storyClock`, anyone in the session may), and kept fresh by
	 * every later clock reading the Chronicle makes (`noteStoryCalendar`).
	 */
	$effect(() => {
		const id = loadedSessionId
		void sessionLorebookId
		if (id == null) return
		untrack(() => {
			asks
				.readStoryClock({ sessionId: id })
				.then((r) => data.setStoryCalendar(id, r?.calendar ?? null))
				.catch(() => {})
		})
	})
	// 🚧 Live scenes, lane D: the session's scene cues and scene settings,
	// and the asks Chronicle and the cue chip make about them.
	const sceneCues = createSceneCuesFlow(base)

	// The session state's ledger, projected for core's conversation (C0b):
	// the page holds the store, the widget draws what it is told.
	const stateStore = sessionState()
	$effect(() => openSessionState(sessionId ?? null))
	// ⏳ Scene image pins: this browser's old pins, given once to the Scene
	// Portraits that drew them, then cleared (`sessionPage/scenePins.svelte.ts`, W6).
	const scenePins = new ScenePins(() => sessionId, undefined, {
		surfaces: surfaceManager,
		characters: () => envelope.characters.current,
		readGallery: (characterId) => asks.readCharacterGallery(characterId)
	})

	/**
	 * THE `sessions:fireAction` emit. There is no other on this page: every
	 * press — a chip, the `/` palette, a message's ⋮ menu, a widget's
	 * `invoke(key)`, a frame's `{ t: "invoke" }`, a bare frame action, a form
	 * answered on the row — is named as a run here, so Cancel reaches it
	 * between the press and the first progress event. Below the bespoke
	 * client flows (`pressRouting`): the narrator's divert comes first, and a
	 * form's answer comes straight here (`FiredPress` says what rides).
	 */
	function emitFireAction(p: FiredPress) {
		const params: Sockets.Sessions.FireAction.Params = {
			sessionId,
			...(p.identity ? { action: p.identity } : { key: p.fn }),
			...(p.messageId != null ? { messageId: p.messageId } : {}),
			...(p.blockId ? { blockId: p.blockId } : {}),
			...(p.text ? { text: p.text } : {}),
			...(p.recipients ? { recipients: p.recipients } : {}),
			...(p.clockStep ? { clockStep: p.clockStep } : {}),
			...(p.payload && Object.keys(p.payload).length
				? { payload: p.payload }
				: {}),
			runId: uuid()
		}
		// 🚧 Kept by its run id, so a halted run's card can offer Retry.
		rememberFiredAction(params)
		socket.emit("sessions:fireAction", params)
	}

	const press = createPressRouting({
		...base,
		data,
		actions,
		turns,
		controls,
		stateStore,
		draft: () => newMessage,
		writeDraft,
		emitFireAction,
		narrate: (identity, route, supplied) => {
			// `/narrate the storm breaks` (C2): who speaks is answered — the
			// narrator — and what happens is the argument, so it fires. The
			// draft the argument came from is spent when the narration lands,
			// and kept when it is refused or fails.
			const direction = narrateDirectly(identity, route)
			if (direction) narrations.directed(direction, !!supplied?.fromDraft)
			else turns.openNarrateModal()
		}
	})

	/**
	 * The page's sections of the widget envelope (`envelopeSections`), each
	 * set as the context every widget on the page reads it from.
	 */
	const envelope = createEnvelopeSections({
		...base,
		data,
		actions,
		turns,
		controls,
		composer,
		scenes,
		sceneCues,
		stateStore,
		scenePins,
		userCtx,
		systemSettingsCtx,
		userSettingsCtx,
		composerDraft: () => composerDraft
	})
	setContext(SESSION_VIEWER_KEY, envelope.viewer)
	setContext(SESSION_TURN_ORDER_KEY, envelope.turnOrder)
	setContext(SESSION_ATTENDANCE_KEY, envelope.attendance)
	setContext("sessionLocale", envelope.locale)
	setContext("sessionAnnex", envelope.annex)
	setContext(SESSION_DOSSIER_KEY, envelope.dossier)
	setContext(SESSION_STATE_KEY, envelope.state)
	setContext(SESSION_CHARACTERS_KEY, envelope.characters)

	/**
	 * What a widget may ask this page for (C0b) — one handler for a frame and
	 * a remote, answered off ONE table (`sessionPage/requests/index.ts`, C1):
	 * a `WidgetRequests` kind with no answer there does not compile. Each kind
	 * opens something of the page's own; the widget sees only that it was
	 * done (or why not). WHO may ask each kind is the SDK's askers table,
	 * enforced in front of it by `guardWidgetRequests` (F9). Every dep below
	 * is a function, read when a request arrives — never when this is built,
	 * so it may name locals declared further down.
	 */
	const widgetRequestDeps: WidgetRequestDeps = {
		sessionId: () => sessionId ?? null,
		findMessage: (id) => session?.sessionMessages.find((m) => m.id === id),
		messagesPage: (ask) => data.messagesPage(ask),
		loadOlderIn: (channels) => data.loadOlderIn(channels),
		channelLanes: (ask) => data.channelLanes(ask),
		characters: () => envelope.characters.current,
		characterForRef: (ref) => data.characterForRef(ref),
		isAdmin: () => !!userCtx.user?.isAdmin,
		contextDebugging: () => !!systemSettingsCtx.settings?.contextDebuggingEnabled,
		canControlMessage: (msg) => data.canControlMessage(msg),
		// A name opens the person as this story knows them: the cast member
		// when the session's own book holds one for the card, else the card.
		// `ownLorebookId` is null for a guest (they may not read the book), so
		// a guest lands on the card as before.
		castMemberOf: (characterId) => {
			const lorebookId = ownLorebookId
			if (lorebookId === null) return null
			const member = scenes.lorebookBindingList.find(
				(b) => b.characterId === characterId
			)
			return member ? { lorebookId, castId: member.id } : null
		},
		openCastMember: ({ lorebookId, castId }) => {
			// Address first, then open (openJumpHit's rule).
			panelsCtx.digest.lore = { lorebookId, scope: "cast", castId }
			panelsCtx.openPanel({ key: "lorebooks", toggle: false })
		},
		openCharactersPanel: () => panelsCtx.openPanel({ key: "characters", toggle: false }),
		viewCharacter: (id) => (panelsCtx.digest.viewCharacterId = id),
		showLore: (target) => (panelsCtx.digest.lore = target as any),
		openLorebooksPanel: () => panelsCtx.openPanel({ key: "lorebooks", toggle: false }),
		viewAvatar: (who) => controls.handleAvatarClick(who),
		viewImage: (src, gallery) => controls.handleImageClick(src, gallery),
		showReport: (report) => {
			composer.messageReport = report
			composer.showDraftCompiledPromptModal = true
		},
		runOfMessage: (messageId) => asks.runOfMessage(messageId),
		openRun: (runId) => runInspector.open(runId),
		showTurnPicker: () => (turns.showTurnPicker = true),
		showSpritePicker: (msg) => (controls.spriteLine = msg),
		showAddPersona: () => (turns.showAddPersonaModal = true),
		takeSeat: (name) => turns.takeSeat(name),
		markActionsSeen: (keys) => actions.markActionsSeen(keys),
		// What a tick selection may not take: captured lines and live ranges.
		scened: () => scenes.captured,
		opensScenes: () => data.offersWrite("scenes"),
		select: (ids) => (scenes.selectedMessageIds = new Set(ids)),
		openSummarize: (loreType) => scenes.openSummarizeModal(loreType),
		summarizeOpen: () => scenes.showSummarizeModal,
		startSummarySelection: () => scenes.enterSummarizationModeEmpty(),
		processScene: (sceneId) => scenes.processScene(sceneId),
		// 🚧 Live scenes (§14 C): the conversation's scene boundaries. The
		// verdict is the dossier's, so the page and the widget read one.
		sceneBoundaries: () => !!envelope.dossier.current?.sceneBoundaries,
		openScene: asks.openScene,
		closeScene: asks.closeScene,
		moveSceneBoundary: asks.moveSceneBoundary,
		renameScene: asks.renameScene,
		confirmRemoveScene: (scene, into) => scenes.confirmRemoveScene(scene, into),
		deleteScene: asks.deleteScene,
		mergeScene: asks.mergeScene,
		sceneList: () => scenes.sceneList,
		ownBookId: () => sessionOwnBookId,
		ungraphedScenes: () => scenes.ungraphedSceneCount,
		openExtendGraph: () => scenes.openExtendGraph(),
		noteStoryClock: (own) => data.setStoryClock(own),
		noteStoryCalendar: (calendar) => {
			if (loadedSessionId != null) data.setStoryCalendar(loadedSessionId, calendar)
		},
		readOpenScenes: () => sceneCues.readOpenScenes(),
		summarizeScenes: (sceneIds) => sceneCues.summarize(sceneIds),
		decideSceneCue: (cueId, accept) => sceneCues.decide(cueId, accept),
		setDraft: (content) => (newMessage = content),
		composerChannel: () => data.composerChannel,
		channels: () => data.sessionChannels,
		setChannel: (channel) => (data.composerChannel = channel),
		switchPersona: (personaId) => data.switchPersona(personaId),
		send: (trayItemIds) => composer.handleSend(trayItemIds),
		composerTray: () => composer.composerTray,
		fireTurn: (channel) => turns.handleContinueWithNextCharacter(channel),
		// 🚧 Back · Forward (RF fix 5): a refusal is the central toast's.
		rewindTurn: rewindPress.rewindTurn,
		forwardTurn: rewindPress.forwardTurn,
		stateStore: () => stateStore,
		scenePins: () => scenePins,
		writeSpriteSet: asks.writeSpriteSet,
		readSessionEntries: asks.readSessionEntries,
		writeEntryMarks: asks.writeEntryMarks,
		readAuthorsNote: asks.readAuthorsNote,
		writeAuthorsNote: asks.writeAuthorsNote,
		readStoryClock: asks.readStoryClock,
		writeStoryClock: asks.writeStoryClock,
		readHistory: asks.readHistory,
		readLines: asks.readLines,
		startNextEntry: asks.startNextEntry,
		readSessionPlaces: asks.readSessionPlaces,
		readCharacterGallery: asks.readCharacterGallery,
		readStatTrail: asks.readStatTrail,
		readRoutineLog: asks.readRoutineLog,
		writeBackdrop: asks.writeBackdrop,
		// 🚧 A seat's portrait (PLAN-sheet-widget §12, 2026-10-18).
		writeOwnerFace: asks.writeOwnerFace,
		// 🚧 Give to… (PLAN-dc-after-walk2 Q0-4, ★4).
		writeGive: asks.writeGive,
		// 🚧 A tie side shown or hidden (ties on the graph, screen 2).
		writeTieShown: asks.writeTieShown,
		// A carry switch flipped from the Stats widget (RF fix 8).
		writeCarry: asks.writeCarry
	}
	setContext(WIDGET_REQUESTS_KEY, guardWidgetRequests(buildWidgetRequestAnswerer(widgetRequestDeps)))

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
			asks.drop("another session opened before the server answered")
			scenes.closeProcess()
		})
	})

	$effect(() => {
		// React to sessionId changes (which is derived from page.params.id)
		if (sessionId) {
			// Reset state when switching sessions
			data.reset()
			turns.reset()
			composer.reset()
			writeDraft("")
			// The narrator modal's unlanded press is the draft's other half:
			// the session left behind's text and speaker (a side character of
			// its own, perhaps), never this one's.
			narratorUnlandedPress = null
			// Surface grid re-seeds for the new session (plan 21): re-fetch its
			// panel set + this user's saved layout, and re-init once both land.
			layout.reset()
			// The interest keys for these four replies are held by the inbox
			// (including the ones re-scoped to this very id, whose effects run
			// before this one); the first typed `emit` puts their sync packet
			// ahead of the request group on the same socket — plan ruling 3.
			socket.emit("sessions:get", { id: sessionId, limit: 25 })
			socket.emit("sessions:presetStatus", { sessionId })
			socket.emit("sessions:view", { sessionId })
			socket.emit("sessions:panelLayout:get", { sessionId })
			socket.emit("sessions:genreOf", { sessionId })
			// Asked once per session open, a switch included: the scenes, and the
			// action list (R-15) — the buttons are rows — whose shape gates what
			// the view renders at all (19 §2).
			scenes.refreshScenes()
			socket.emit("sessions:actions", { sessionId })
		}
	})

	/**
	 * The session header's cast stack (`headerCastKeyOf`), carried up by
	 * `openSessionCtx`: kept as a STRING, which a `$derived` compares by
	 * value, so the header moves only when a face, a name or the next
	 * speaker does — never per streamed chunk.
	 */

	const headerCastKey: string = $derived(
		headerCastKeyOf(
			session,
			turns.shouldShowNextCharacterBlock
				? (turns.nextCharacter?.id ?? null)
				: null
		)
	)
	let headerCast: OpenSessionCastMember[] = $derived(JSON.parse(headerCastKey))

	onDestroy(() => terminateAllWorkers())

	// `sp-avatar` asks the page who a participant reference is (C0b): the
	// session's characters and the personas people speak as, one lookup.
	// Set in an effect, not at init: a session page that replaces this one
	// (another session opened) is made before this one is destroyed, and a
	// clear at destroy wiped the new page's lookup — every avatar fell back
	// to "?" (H's walk, 2026-10-25). Effects run after the old page's teardown.
	const participantOf = (ref: string) => {
		const who = data.characterForRef(ref)
		return who ? { name: resolveCharacterName(who, who.name ?? ""), avatarUrl: avatarSrc(who) ?? null } : null
	}
	$effect(() => {
		setHostParticipants(participantOf)
		return () => {
			if (hostElementContext.participant === participantOf) setHostParticipants(undefined)
		}
	})

	onDestroy(() => {
		sceneImages.set({ left: null, right: null })
		openSessionCtx.cast = []
		openSessionCtx.headerNotice = null
		openSessionCtx.rewind = null
	})
</script>

<svelte:head>
	<title>
		Serene Pub - {data.sessionNotFound
			? "Not Found"
			: (session?.name ?? "Loading...")}
	</title>
	<meta name="description" content="Serene Pub" />
</svelte:head>

{#if data.sessionNotFound}
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
		{#if data.sessionViewFrame}
			<!-- The mode's declared session view (20 §12): one opaque-origin
			     frame owning the whole message section, layout-sized, fed
			     over its channel. Core's chrome deliberately absent — this is
			     the total-conversion lane. -->
			<div class="min-h-0 flex-1">
				<PluginFrame
					src={data.sessionViewFrame.src}
					title={data.sessionViewFrame.title ?? "Session view"}
					surface="session-view"
					session={loadedSessionId !== null
						? { id: loadedSessionId, name: sessionName }
						: undefined}
					messages={session?.sessionMessages ?? []}
					actions={actions.actionVenues}
					actionDispatch={press.actionDispatch}
					onAction={press.handleFrameAction}
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
				conversationDossier={envelope.dossier.current}
				viewerId={userCtx.user?.id ?? null}
				annex={envelope.annex.current}
				presets={layout.layoutPresets}
				startedFromLayoutPresetId={layout.startedFromLayoutPresetId}
				startedFromUpdated={layout.startedFromUpdated}
				onStartFrom={layout.startLayoutFrom}
				onSavePreset={layout.saveLayoutPreset}
				onRenamePreset={layout.renameLayoutPreset}
				onDeletePreset={layout.deleteLayoutPreset}
				onPresetUsage={layout.askLayoutPresetUsage}
				presetUsage={layout.layoutPresetUsage}
				onSaveChanges={layout.saveLayoutChanges}
				onShareLayout={layout.shareLayout}
				onCloneLayout={layout.cloneLayout}
				onSetNewSessionLayout={layout.setNewSessionLayout}
				genreName={data.genreName}
				isGuest={data.isGuest}
				isAdmin={!!userCtx.user?.isAdmin}
				layoutSettings={layout.layoutSettings}
				onLayoutSettings={layout.persistLayoutSettings}
				actions={actions.actionVenues}
				actionDispatch={press.actionDispatch}
				onFrameAction={press.handleFrameAction}
			/>
		{/if}
	</div>

	<!-- The page's own views core's composer places (`sp-host-view`, C0b). -->
	<SessionHostViews
		{data}
		{actions}
		{turns}
		{composer}
		{scenes}
		{press}
		draft={newMessage}
		{loadedSessionId}
		{sessionUserId}
		{sessionLorebookId}
		{sessionLorebookBranchId}
	/>

	{#if scenes.showProcessSceneModal && scenes.processSceneId !== null && sessionLorebookId}
		<ProcessSceneModal
			open={scenes.showProcessSceneModal}
			onOpenChange={(e) => (scenes.showProcessSceneModal = e.open)}
			sceneId={scenes.processSceneId}
			activityId={scenes.processActivityId}
			pendingResult={scenes.processPendingResult}
			lorebookId={sessionLorebookId}
			lorebookBindingList={scenes.lorebookBindingList}
			onApplied={() => scenes.refreshScenes()}
			onDiscarded={() => {
				// The server deletes the scene on dismiss when it was created
				// for this run, so refresh what the session shows as "scened".
				scenes.refreshScenes()
			}}
		/>
	{/if}

	<!-- 🚧 *Remove boundary* (a scene divider's): what goes and what stays,
	     asked before the scene is removed (STYLE-GUIDE §6.6). -->
	<ConfirmDialog
		open={!!scenes.removeAsk}
		title="Remove this scene's boundary?"
		body={removeSceneBody(
			scenes.removeAsk?.scene ?? null,
			scenes.removeAsk?.into ?? null
		)}
		keepLabel="Keep the scene"
		confirmLabel="Remove boundary"
		onKeep={() => scenes.removeAsk?.answer(false)}
		onConfirm={() => scenes.removeAsk?.answer(true)}
	/>

	<SummarizeLoreModal
		bind:open={scenes.showSummarizeModal}
		onOpenChange={(e) => {
			scenes.showSummarizeModal = e.open
			// Drop the resume payload on close so the next manual open starts
			// from configure rather than rehydrating a stale review.
			if (!e.open) scenes.resumeSummarizeActivity = null
		}}
		resumeActivity={scenes.resumeSummarizeActivity}
		{sessionId}
		lorebookId={sessionBookOf({ lorebookId: sessionLorebookId, ownBookId: sessionOwnBookId })}
		ownBookId={sessionOwnBookId}
		branchId={sessionLorebookBranchId}
		storyClock={sessionStoryClock}
		selectedMessageIds={[...scenes.selectedMessageIds]}
		initialLoreType={scenes.summarizeLoreType}
		onSaved={() => {
			scenes.refreshScenes()
			scenes.exitSummarizationMode()
		}}
		onSceneProcessStarted={(sceneId) => scenes.sceneProcessStarted(sceneId)}
		onLorebookSet={(id) => data.setLorebook(id)}
		sessionCharacters={(session?.sessionCharacters ?? []).map((cc) => ({
			id: cc.character.id,
			name: resolveCharacterName(cc.character, cc.character.name)
		}))}
		sessionPersonas={(session?.sessionPersonas ?? []).map((cp) => ({
			id: cp.persona.id,
			name: cp.persona.name
		}))}
		hasSceneMessageGap={scenes.hasSceneGap}
	/>

	<DeleteMessageDialog
		open={controls.showDeleteMessageModal}
		onOpenChange={controls.onOpenMessageDeleteChange}
		onConfirm={controls.onDeleteMessageConfirm}
		onCancel={controls.onDeleteMessageCancel}
		revision={controls.deleteRevision}
	/>

	<PromptDetailsModal
		open={composer.showDraftCompiledPromptModal}
		onOpenChange={(open) => (composer.showDraftCompiledPromptModal = open)}
		promptDetails={composer.promptDetails}
		detailsExceeded={composer.detailsExceeded}
		reportMessageId={composer.messageReport?.messageId}
		isAdmin={!!userCtx.user?.isAdmin}
	/>

	<!-- "Someone else" (§4.9): at the page's top level, not inside the nudge,
	     which unmounts the moment a turn is fired. -->
	<TurnPicker
		open={turns.showTurnPicker}
		candidates={turns.turnOrder?.candidates ?? []}
		headRef={turns.turnOrder?.order[0]?.ref}
		avatarFor={data.characterForRef}
		offerNarrator={!!turns.narratorTurn || turns.narratorFunction}
		ownVoiceName={turns.narratorTurn ? data.ownVoice : data.narratorName}
		onPick={turns.handlePickTurn}
		onClose={() => (turns.showTurnPicker = false)}
	/>

	<!-- The sprite picker a message's controls ask for (`change-sprite`, C0b). -->
	{#if controls.spriteLine?.characterId}
		<ChangeSpriteDialog
			open
			messageId={controls.spriteLine.id}
			characterId={controls.spriteLine.characterId}
			characterName={data.getMessageCharacter(controls.spriteLine)?.name}
			current={asShownSprite((controls.spriteLine.metadata as any)?.sprite)}
			onClose={() => (controls.spriteLine = null)}
		/>
	{/if}

	<PickSpeakerModal
		open={turns.showPickSpeakerModal}
		onOpenChange={(open) => (turns.showPickSpeakerModal = open)}
		sessionCharacters={session?.sessionCharacters}
		bind:pickSpeakerSearch={turns.pickSpeakerSearch}
		narratorTurn={!!turns.narratorTurn}
		narratorFunction={turns.narratorFunction}
		narratorRowChip={turns.narratorRowChip}
		ownVoice={data.ownVoice}
		narratorName={data.narratorName}
		onNarratorRow={turns.handleNarratorRow}
		onPickSpeaker={turns.onPickSpeaker}
	/>

	<CollectModal
		open={!!press.collecting}
		action={press.collecting?.action.collects
			? {
					name: press.collecting.action.name,
					description: press.collecting.action.description,
					collects: press.collecting.action.collects
				}
			: null}
		cast={press.collectCast}
		ownVoice={data.ownVoice}
		initialText={press.collecting?.initialText ?? ""}
		onSubmit={press.submitCollected}
		onCancel={() => (press.collecting = null)}
	/>

	<!-- 🚧 An action's question before it fires (`ActionDecl.confirm`). -->
	<ActionConfirm
		asking={press.confirming?.asking ?? null}
		onConfirm={() => press.confirmPress()}
		onCancel={() => press.cancelPress()}
	/>

	<RetakeConfirm
		open={turns.showRetakeConfirm}
		rows={turns.retakeRows}
		revision={turns.retakeRevision}
		channelLabels={data.sessionFrames?.channelLabels ?? {}}
		onConfirm={(quietly) => {
			turns.showRetakeConfirm = false
			turns.retake.confirm(quietly)
		}}
		onCancel={() => {
			turns.showRetakeConfirm = false
			turns.retake.cancel()
		}}
	/>

	<NarratorResponseModal
		open={turns.showNarratorResponseModal}
		onOpenChange={(e) => (turns.showNarratorResponseModal = e.open)}
		onFire={turns.handleConfirmNarratorResponse}
		onCancel={turns.handleCancelNarratorResponse}
		narratorName={data.narratorName}
		sideCharacters={turns.sideCharacterOptions}
		collectsText={actions.listedAction(NARRATE_ACTION)?.collects?.text}
		unlandedPress={narratorUnlandedPress}
	/>

	<EntityGalleryViewModal
		bind:open={controls.showAvatarModal}
		onOpenChange={(e) => (controls.showAvatarModal = e.open)}
		entity={controls.avatarModalEntity}
	/>

	<MediaLightbox
		bind:open={controls.showImageModal}
		onOpenChange={(e) => (controls.showImageModal = e.open)}
		state={controls.lightboxState}
	/>

	<!-- Not mounted where the genre has no personas (`personas.max: 0`): the
	     picker holds a standing `characters:list` interest and its empty
	     state would speak of a system the session does not have. -->
	{#if data.personasInMode}
	<PersonaSelectModal
		open={turns.showAddPersonaModal}
		onclose={() => (turns.showAddPersonaModal = false)}
		onSelect={turns.handleAddPersona}
		excludeIds={(session?.sessionPersonas ?? [])
			.filter((cp) => !cp.removedAt)
			.map((cp) => cp.personaId)
			.filter((id): id is number => id != null)}
		title="Choose who you play as"
		description={composer.personaAskedBySend
			? "Choose who you play as before you send. Your message stays in the box."
			: "Pick a character to play in this session. Your messages are sent as them."}
	/>
	{/if}

	<BranchSessionModal
		open={controls.showBranchSessionModal}
		onOpenChange={(e) => (controls.showBranchSessionModal = e.open)}
		onConfirm={controls.onBranchSessionConfirm}
		onCancel={controls.onBranchSessionCancel}
		initialTitle={session?.name ?? undefined}
	/>
{/if}
