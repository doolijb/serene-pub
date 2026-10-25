/**
 * The session page's scenes: which lines are already in a scene and the
 * session's scene list (the transcript's markers), the summarization
 * selection and the Summarize modal, the Process scene window a session-
 * started scene summarize hands off to, and the cast of the session's book it
 * applies into. One refresh (`refreshScenes`) re-reads both scene lists after
 * every change the page makes.
 */
import { untrack } from "svelte"
import { toaster } from "$lib/client/utils/toaster"
import { extendCountsOf } from "$lib/shared/lorebooks/graphBuildScope"
import type { TypedSocket } from "$lib/client/sockets/typedSocket"
import type { SessionPageInbox } from "$lib/client/components/sessionPage/sessionPageInbox.svelte"
import { sessionStore } from "$lib/client/sessions/store/sessionStore.svelte"
import type { SessionPageData } from "$lib/client/components/sessionPage/sessionPageData.svelte"
import {
	capturedLineIds,
	type LiveSceneRow
} from "$lib/client/components/sessionPage/liveSceneProjection"

export interface ScenesFlowDeps {
	socket: TypedSocket
	inbox: SessionPageInbox
	/** The session in the route. */
	sessionId(): number
	/** The session's book while the viewer owns the session, else null (the page's `ownLorebookId`). */
	ownLorebookId(): number | null
	/** The loaded session: its lines, and its not-found verdict. */
	data: SessionPageData
	sceneSummarizesCtx: SceneSummarizesCtx
	sessionSummarizesCtx: SessionSummarizesCtx
}

/** The page's scenes. Registers its listeners on the inbox at once. */
export function createScenesFlow(d: ScenesFlowDeps) {
	const socket = d.socket
	const sceneSummarizesCtx = d.sceneSummarizesCtx
	const sessionSummarizesCtx = d.sessionSummarizesCtx
	const sessionId = $derived(d.sessionId())
	const ownLorebookId = $derived(d.ownLorebookId())
	const session = $derived(d.data.session)

	// Summarization mode
	let selectedMessageIds = $state(new Set<number>())
	let showSummarizeModal = $state(false)
	let summarizeLoreType = $state<"world" | "character" | "scene">("world")
	/** Message IDs already captured in a scene — hard-blocked from selection */
	const scenedMessageIds = $derived(new Set(sessionStore.scenedOf(sessionId)))
	/** Full scene list for this session — used for in-session scene/history-entry indicators */
	const sceneList = $derived(sessionStore.scenesOf(sessionId))

	/**
	 * 🚧 The lines a tick selection may not take (live scenes §14 C): what
	 * the server says a scene captured, and every loaded line inside a live
	 * scene's range — the open scene's too, whose lines are recorded only
	 * when it closes.
	 */
	const capturedMessageIds = $derived(
		capturedLineIds(
			scenedMessageIds,
			sceneList as unknown as LiveSceneRow[],
			session?.sessionMessages ?? []
		)
	)
	const capturedSet = $derived(new Set(capturedMessageIds))

	/**
	 * 🚧 *Remove boundary* (a scene divider's, live scenes §7): the page's
	 * question before the scene goes — answered once, by the dialog.
	 */
	let removeAsk = $state<{
		scene: { id: number; name: string | null; summarized: boolean }
		/** 🚧 The scene it would join (lane E); null when it is deleted. */
		into: { id: number; name: string | null; summarized: boolean } | null
		answer: (remove: boolean) => void
	} | null>(null)

	/**
	 * **Extend graph** (Chronicle, W3 — the composer Lore pane's, moved):
	 * this session's scenes on its line that the lorebook's graph has not
	 * read, by the build's own rule (`extendCountsOf`), and its review.
	 */
	const lineId = $derived(session?.lorebookBranchId ?? null)
	const extendCounts = $derived(
		extendCountsOf(sceneList, { branchId: lineId, sessionId })
	)
	let showExtendGraph = $state(false)

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
		/** The card the member is drawn from; null for a background member. */
		characterId: number | null
	}[] = $state([])

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

	/**
	 * 🚧 A scene review that went away — applied, discarded, or dismissed from
	 * the Activity panel (§15 G8): the server put the scene's summary status
	 * back (or wrote `done`), so the scene list is read again. Keyed on which
	 * scenes have a review waiting, so a run's progress reads nothing. Plain
	 * (not state): what the last pass saw.
	 */
	let reviewing: number[] = []
	$effect(() => {
		const now = (sceneSummarizesCtx?.activities ?? [])
			.filter((a) => a.status === "review")
			.map((a) => a.sceneId)
		const gone = reviewing.some((id) => !now.includes(id))
		reviewing = now
		if (gone) untrack(() => refreshScenes())
	})

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

	function handleLorebookBindingList(msg: {
		lorebookId?: number
		lorebookBindingList?: {
			id: number
			name: string
			binding: string
			characterId: number | null
		}[]
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

	function handleScenesScenedMessageIds(
		msg: Sockets.Scenes.SenedMessageIds.Response
	) {
		sessionStore.mergeScenedMessageIds(msg)
	}

	function handleScenesScenedMessageIdsError() {
		d.data.markNotFound()
	}

	function handleScenesList(msg: Sockets.Scenes.List.Response) {
		sessionStore.mergeSceneList(msg)
	}

	function handleScenesListError() {
		d.data.markNotFound()
	}

	/**
	 * Read both scene lists again — what is scened, and the scene list. After
	 * a scene is applied or discarded in the Process scene window, and after
	 * a summary is saved or a scene's processing starts; the server also
	 * re-sends both when a scene changes anywhere (they are cascade targets).
	 */
	function refreshScenes() {
		socket?.emit("scenes:scenedMessageIds", { sessionId })
		socket?.emit("scenes:list", {
			sessionId
		} satisfies Sockets.Scenes.List.Params)
	}

	/**
	 * A scene's processing started (fires only after `scenes:create`
	 * succeeded, so the selection is safe to drop — the scene row now holds
	 * those message ids, and they immediately render as "scened"; clearing
	 * on click instead would lose a hand-picked selection whenever the create
	 * failed). Review happens in the activity-backed window, which is what
	 * knows how to resume a minimized run and saves via `scenes:update`.
	 */
	function sceneProcessStarted(sceneId: number) {
		refreshScenes()
		exitSummarizationMode()
		processSceneId = sceneId
		processActivityId = null
		processPendingResult = null
		showProcessSceneModal = true
	}

	/**
	 * 🚧 Summarize an existing scene (a divider's *Summarize*, live scenes §7):
	 * the Process scene window runs it and saves its review. The scene stays
	 * if the run is abandoned (no `ephemeralOnCancel`): it existed before.
	 * The person's selection, if any, is left alone. 🚧 A scene whose run
	 * already finished, or still runs, opens THAT run's window instead (§15
	 * G8: a divider's *Ready to review*) — never a second run over it.
	 */
	function processScene(sceneId: number) {
		// One review window at a time: another scene's run stays on screen.
		if (showProcessSceneModal && processSceneId !== null && processSceneId !== sceneId)
			throw new Error("another scene's summary is open: finish or close it first")
		if (showProcessSceneModal && processSceneId === sceneId) return
		const waiting = sceneSummarizesCtx?.activities.find(
			(a) => a.sceneId === sceneId && (a.status === "review" || a.status === "running")
		)
		if (waiting) {
			processSceneId = sceneId
			processActivityId = waiting.activityId
			processPendingResult = waiting.pendingResult ?? null
			showProcessSceneModal = true
			return
		}
		processSceneId = sceneId
		processActivityId = null
		processPendingResult = null
		showProcessSceneModal = true
		socket?.emit("scenes:process", {
			sceneId
		} satisfies Sockets.Scenes.Process.Params)
	}

	/**
	 * Ask before *Remove boundary*: resolves true when the person removes it.
	 * 🚧 `into`: the scene it would join (lane E), whose name and summary the
	 * question names; null when the scene is deleted.
	 */
	function confirmRemoveScene(
		scene: { id: number; name?: string | null; summary?: string | null },
		into: { id: number; name?: string | null; summary?: string | null } | null = null
	): Promise<boolean> {
		const said = (s: { id: number; name?: string | null; summary?: string | null }) => ({
			id: s.id,
			name: s.name?.trim() ? s.name : null,
			summarized: !!s.summary?.trim()
		})
		// One question at a time: a second ask keeps the first's scene.
		removeAsk?.answer(false)
		return new Promise<boolean>((resolve) => {
			removeAsk = {
				scene: said(scene),
				into: into ? said(into) : null,
				answer: (remove) => {
					removeAsk = null
					resolve(remove)
				}
			}
		})
	}

	d.inbox.on("scenes:scenedMessageIds", handleScenesScenedMessageIds)
	d.inbox.on("scenes:list", handleScenesList)
	d.inbox.on(
		"scenes:scenedMessageIds:error",
		handleScenesScenedMessageIdsError
	)
	d.inbox.on("scenes:list:error", handleScenesListError)
	d.inbox.on("lorebooks:bindingList", handleLorebookBindingList)
	d.inbox.on("sessions:summarize:error", handleSessionSummarizeError)

	return {
		get selectedMessageIds() {
			return selectedMessageIds
		},
		set selectedMessageIds(ids: Set<number>) {
			selectedMessageIds = ids
		},
		get showSummarizeModal() {
			return showSummarizeModal
		},
		set showSummarizeModal(open: boolean) {
			showSummarizeModal = open
		},
		get summarizeLoreType() {
			return summarizeLoreType
		},
		get resumeSummarizeActivity() {
			return resumeSummarizeActivity
		},
		set resumeSummarizeActivity(activity: SessionSummarizeState | null) {
			resumeSummarizeActivity = activity
		},
		/** Message ids already captured in a scene — hard-blocked from selection. */
		get scenedMessageIds() {
			return scenedMessageIds
		},
		/**
		 * 🚧 What a tick selection may not take: the captured lines and every
		 * loaded line in a live scene's range (`capturedLineIds`).
		 */
		get capturedMessageIds() {
			return capturedMessageIds
		},
		/** The same, as a set (`summarize` drops these from a selection). */
		get captured(): { has(messageId: number): boolean } {
			return capturedSet
		},
		/** 🚧 The open *Remove boundary* question, or null. */
		get removeAsk() {
			return removeAsk
		},
		processScene,
		confirmRemoveScene,
		get sceneList() {
			return sceneList
		},
		get selectForSummary() {
			return selectForSummary
		},
		/** What Extend graph would read (W3): ready, unsummarized, unresolved cast. */
		get extendCounts() {
			return extendCounts
		},
		/** This session's scenes on its line not yet in the graph — the button's (N). */
		get ungraphedSceneCount() {
			return extendCounts.ready + extendCounts.unsummarized
		},
		get showExtendGraph() {
			return showExtendGraph
		},
		set showExtendGraph(open: boolean) {
			showExtendGraph = open
		},
		/** Open the Extend graph review (Chronicle's `extend-graph`). */
		openExtendGraph() {
			showExtendGraph = true
		},
		get summaryEnded() {
			return summaryEnded
		},
		get hasSceneGap() {
			return hasSceneGap
		},
		get showProcessSceneModal() {
			return showProcessSceneModal
		},
		set showProcessSceneModal(open: boolean) {
			showProcessSceneModal = open
		},
		get processSceneId() {
			return processSceneId
		},
		get processActivityId() {
			return processActivityId
		},
		get processPendingResult() {
			return processPendingResult
		},
		get lorebookBindingList() {
			return lorebookBindingList
		},
		exitSummarizationMode,
		enterSummarizationModeEmpty,
		openSummarizeModal,
		refreshScenes,
		sceneProcessStarted,
		/**
		 * Another session opened in the page: an open Process scene window
		 * closes — it would otherwise apply the old scene's cast into the new
		 * session's book (plan B8).
		 */
		closeProcess() {
			showProcessSceneModal = false
			processSceneId = null
			processActivityId = null
			processPendingResult = null
			// The question was about the last session's scene: kept.
			removeAsk?.answer(false)
		}
	}
}

/** The session page's scenes (`createScenesFlow`). */
export type ScenesFlow = ReturnType<typeof createScenesFlow>
