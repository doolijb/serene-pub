<script lang="ts">
	import {
		CHARACTER_LORE_TYPE_ID,
		HISTORY_TYPE_ID,
		WORLD_LORE_TYPE_ID,
		type LorebookEntry
	} from "$lib/shared/entries/types"

	type History = LorebookEntry<typeof HISTORY_TYPE_ID>
	import * as Icons from "@lucide/svelte"
	import { getContext, onDestroy, untrack } from "svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { notRecordedToast } from "$lib/client/lorebooks/notRecordedToast"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import {
		declareInterest,
		requestWithInterest,
		useInterest
	} from "$lib/client/sockets/interest.svelte"
	import { awaitReply } from "$lib/client/utils/awaitReply"
	import { interestKey } from "$lib/shared/sockets/interest"
	import { attachLorebookToSession as attachToSession } from "$lib/client/utils/attachLorebookToSession"
	import { READ_INTO_SESSION } from "$lib/client/lorebooks/scopes"
	import { v4 as uuid } from "uuid"
	import AiTaskModal, { type AiTaskStep } from "./AiTaskModal.svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import LoreWritesOffNotice from "$lib/client/lorebooks/LoreWritesOffNotice.svelte"
	import { useLoreWritesOff } from "$lib/client/lorebooks/loreWritesOff.svelte"
	import { statusText } from "$lib/client/i18n/state.svelte"
	import type { StatusText } from "@serene-pub/sdk"
	import { lineOf } from "$lib/shared/lorebooks/lineReading"
	import type { StoryDate } from "$lib/shared/lorebooks/storyDate"
	import { historyEntriesOnReading } from "$lib/client/lorebooks/time/historyOnReading"

	/**
	 * Something character lore can be bound to. There is only ONE kind of
	 * binding now — a character binding — so a persona is just a character
	 * carrying `isPersona`, kept here only as a hint in the list.
	 */
	interface BindableEntity {
		id: number
		name: string
		isPersona?: boolean
	}

	interface Props {
		open: boolean
		onOpenChange: (e: { open: boolean }) => void
		sessionId: number
		lorebookId: number | null
		/**
		 * The session's line of that book, null for main. What it saves lands
		 * there (the server decides from the session), and the history
		 * entries offered are the ones that line reads.
		 */
		branchId?: number | null
		/**
		 * The session's own story clock, null while it follows its line's
		 * present — then its line's stored clock, when the line has one, is
		 * where its story stands. History dated after that is not offered.
		 */
		storyClock?: StoryDate | null
		selectedMessageIds: number[]
		initialLoreType?: "world" | "character" | "scene"
		onSaved: () => void
		onLorebookSet: (lorebookId: number) => void
		sessionCharacters?: BindableEntity[]
		sessionPersonas?: BindableEntity[]
		hasSceneMessageGap?: boolean
		/**
		 * Scene runs hand off to the activity-backed `scenes:process` pipeline:
		 * the scene row is created first, then this fires so the caller can
		 * clear the message selection and open the review modal. Only after the
		 * create succeeds — a failed create must leave the selection intact.
		 */
		onSceneProcessStarted?: (sceneId: number) => void
		/**
		 * Resume an existing session_summarize activity instead of starting fresh.
		 * Supplied by the session page when the Activity panel reopens a run.
		 */
		resumeActivity?: SessionSummarizeState | null
	}

	let {
		open = $bindable(),
		onOpenChange,
		sessionId,
		lorebookId = $bindable(),
		branchId = null,
		storyClock = null,
		selectedMessageIds,
		initialLoreType = "world",
		onSaved,
		onLorebookSet,
		sessionCharacters = [],
		sessionPersonas = [],
		hasSceneMessageGap = false,
		onSceneProcessStarted,
		resumeActivity = null
	}: Props = $props()

	/**
	 * Activity backing the current run, so Save can dismiss it and Minimize can
	 * leave it standing. Null for a run started before this modal opened.
	 */
	let activeActivityId = $state<string | null>(null)

	/**
	 * One socket handle, and it emits only.
	 *
	 * Every listener in this file goes through the interest registry —
	 * `useInterest` for the ones that live as long as the modal, and
	 * `declareInterest` + release for the per-dispatch ones a generation
	 * registers and tears down — so the typed handle is the only socket this
	 * file needs.
	 */
	const typedSocket = useTypedSocket()

	// ── Internal step (mapped to AiTaskStep for the shell) ───────────
	type InternalStep = "configure" | "generating" | "review" | "error"
	let step = $state<InternalStep>("configure")

	let aiStep = $derived<AiTaskStep>(
		step === "configure"
			? "confirm"
			: step === "generating"
				? "running"
				: step
	)

	// ── Configure step state ─────────────────────────────────────────
	let loreType = $state<"world" | "character" | "scene">(initialLoreType)
	let topic = $state("")

	let availableLorebooks = $state<
		Sockets.Lorebooks.List.Response["lorebookList"]
	>([])
	let attachingLorebookId = $state("")
	let isCreatingLorebook = $state(false)
	let newLorebookName = $state("")
	let historyEntryList = $state<History[]>([])

	let selectedHistoryEntryId = $state("")
	let isCreatingHistoryEntry = $state(false)

	/**
	 * The book's lines, for reading the session's one — its ancestor chain
	 * and fork cuts. Asked for only when the session is on a branch (main
	 * needs no chain); `branchesOf` names the book they are of, so a list
	 * for the last book never reads this one.
	 */
	let branches = $state<Sockets.Amendments.Branch[]>([])
	let branchesOf = $state<number | null>(null)
	let lineKnown = $derived(branchId == null || branchesOf === lorebookId)
	/** The session's line, named. */
	let lineName = $derived(
		branchId == null
			? "main"
			: (branches.find((b) => b.id === branchId)?.name ?? "this line")
	)

	/**
	 * The session's line's stored clock (`lorebooks:storyTime`), for a
	 * session with no clock of its own: that is where its story stands, as
	 * the server's `storyNowOf` reads it. `clockOf` names the book it is of.
	 */
	let lineClock = $state<StoryDate | null>(null)
	let clockOf = $state<number | null>(null)
	/** Where the session's story stands: its own clock, else its line's. */
	let storyMoment = $derived(storyClock ?? (clockOf === lorebookId ? lineClock : null))
	/** Whether that is known yet: a session with its own clock needs no fetch. */
	let momentKnown = $derived(storyClock != null || clockOf === lorebookId)

	/**
	 * The history the session's reading sees — its line, never a sibling's,
	 * and nothing dated after where its story stands — newest first, so the
	 * most recent entry is the obvious default.
	 */
	let lineHistory = $derived(
		historyEntriesOnReading(
			historyEntryList,
			lineOf(branchId, branches),
			storyMoment
		)
	)

	/**
	 * Whether this opening has already had its history entry defaulted. Reset
	 * in the reset-on-open effect and consumed in handleHistoryEntriesList, so
	 * the default is applied when the list actually arrives rather than
	 * depending on effect declaration order (the reset clears the selection, so
	 * an effect racing it would be wiped on the same open).
	 *
	 * Once per opening, not "whenever empty", so deliberately choosing the blank
	 * option isn't silently reverted.
	 */
	let didPreselectHistoryEntry = $state(false)

	let lorebookBindings = $state<SelectLorebookBinding[]>([])
	let bindableEntities = $derived.by<BindableEntity[]>(() => {
		// Keyed on the character id alone: a character the caller also voices
		// as a persona is ONE row, not two entries that would bind to the
		// same id.
		const seen = new Set<number>()
		const result: BindableEntity[] = []
		const add = (e: BindableEntity) => {
			if (!seen.has(e.id)) {
				seen.add(e.id)
				result.push(e)
			}
		}
		for (const cc of sessionCharacters) add(cc)
		for (const cp of sessionPersonas) add({ ...cp, isPersona: true })
		for (const b of lorebookBindings) {
			if (b.characterId && (b as any).character)
				add({
					id: b.characterId,
					name:
						(b as any).character.nickname ||
						(b as any).character.name
				})
		}
		return result
	})
	let selectedBinding = $state("")
	/**
	 * The character a character-lore review binds its entry to, as the run
	 * named it. Their cast member is found or added at Save — never before,
	 * so a discarded review leaves the book as it was.
	 */
	let bindCharacterId = $state<number | null>(null)

	// ── Generating step state ────────────────────────────────────────
	let summarizePhase = $state<
		"drafting" | "synthesizing" | "naming" | "extracting"
	>("drafting")
	let currentBatch = $state(0)
	let totalBatches = $state(1)
	/**
	 * The run's own word for what it is doing (R-19) — *summarising part 2
	 * of 5*, *merging the drafts* — shown in place of the phase's label once
	 * the run has said one. Null until then and again on reset.
	 */
	let runStatus = $state<StatusText | null>(null)

	// ── Review step state ────────────────────────────────────────────
	let reviewName = $state("")
	let reviewContent = $state("")
	let rawOutput = $state("")
	let showRaw = $state(false)
	let isSaving = $state(false)
	/**
	 * Why the last Save did not land, shown in the review step beside the
	 * text it failed to keep. Inline rather than a toast: the server's
	 * `{event}:error` is already toasted by Layout's catch-all, and a second
	 * toast would say the same thing twice.
	 */
	let saveError = $state("")
	/**
	 * The lore type the review in hand was generated as. Save files the
	 * entry as this, not as the radio's current choice: back on the
	 * configure step a person may pick Scene and then view the last result,
	 * and a world-lore summary is not a scene.
	 */
	let reviewLoreType = $state<"world" | "character">("world")

	// ── Error step state ─────────────────────────────────────────────
	let errorMessage = $state("")

	// ── Derived ─────────────────────────────────────────────────────
	let progressPercent = $derived(
		summarizePhase === "extracting"
			? 97
			: summarizePhase === "naming"
				? 93
				: summarizePhase === "synthesizing"
					? 90
					: totalBatches > 1
						? Math.max(
								5,
								Math.round((currentBatch / totalBatches) * 80)
							)
						: currentBatch > 0
							? 60
							: 5
	)

	let progressLabel = $derived(
		statusText(runStatus) ||
			(summarizePhase === "extracting"
				? "Extracting characters…"
				: summarizePhase === "naming"
					? "Naming entry…"
					: summarizePhase === "synthesizing"
						? "Synthesizing final entry…"
						: currentBatch > 0
							? `Drafting part ${currentBatch} of ${totalBatches}…`
							: "Starting…")
	)

	// Lorebook writes from sessions Off (plan A22): nothing this could make
	// would save, so it says so before any work and starts none.
	const loreWrites = useLoreWritesOff()
	let canGenerate = $derived(
		!loreWrites.off &&
		!!lorebookId &&
			selectedMessageIds.length > 0 &&
			(loreType !== "character" || topic.trim().length > 0) &&
			(loreType !== "scene" || !!selectedHistoryEntryId) &&
			(loreType !== "scene" || !hasSceneMessageGap)
	)
	let canSave = $derived(
		!loreWrites.off &&
			reviewName.trim().length > 0 &&
			reviewContent.trim().length > 0
	)
	let hasLorebook = $derived(!!lorebookId)

	let badgeLabel = $derived(
		loreType === "world"
			? "World lore"
			: loreType === "character"
				? "Character lore"
				: "Scene"
	)

	// ── Reset on open ────────────────────────────────────────────────
	// Resuming is handled *inside* this effect on purpose. A second effect that
	// rehydrated the review would race this one and be wiped on the same open —
	// the identical hazard the history-entry preselect hit, where the answer was
	// to stop depending on effect declaration order.
	$effect(() => {
		if (open && resumeActivity) {
			activeActivityId = resumeActivity.activityId
			loreType = resumeActivity.loreType
			reviewLoreType = resumeActivity.loreType
			topic = resumeActivity.topic ?? ""
			errorMessage = resumeActivity.errorMessage ?? ""
			const pending = resumeActivity.pendingResult
			if (pending) {
				reviewName = pending.name ?? ""
				reviewContent = pending.content ?? pending.raw ?? ""
				rawOutput = pending.raw ?? ""
				// Carried on the activity precisely so a reopened character-lore
				// review still binds the character the run was asked about.
				bindCharacterId = pending.lorebookBindingCharacterId ?? null
			}
			step =
				resumeActivity.status === "review"
					? "review"
					: resumeActivity.status === "error"
						? "error"
						: "generating"
			summarizePhase = resumeActivity.phase ?? "drafting"
			currentBatch = resumeActivity.batch ?? 0
			totalBatches = resumeActivity.totalBatches ?? 1
			return
		}
		if (open) {
			activeActivityId = null
			saveError = ""
			step = "configure"
			loreType = initialLoreType
			topic = ""
			selectedBinding = ""
			bindCharacterId = null
			selectedHistoryEntryId = ""
			didPreselectHistoryEntry = false
			isCreatingHistoryEntry = false
			attachingLorebookId = ""
			isCreatingLorebook = false
			newLorebookName = ""
			historyEntryList = []
			// Re-read on every opening: the line's clock may have moved.
			clockOf = null
			lorebookBindings = []
			summarizePhase = "drafting"
			currentBatch = 0
			totalBatches = 1
			runStatus = null
			rawOutput = ""
			showRaw = false
			reviewName = ""
			reviewContent = ""
			errorMessage = ""
		}
	})

	/**
	 * The session's book, read while the window is open — SCOPED to that book
	 * (plan B8). These were BARE keys held for the whole life of the session
	 * page, which held the server's gate open for every book's entry and cast
	 * cascades in this tab. Taken when the window opens on a book and let go
	 * when it closes or the session's book changes; the typed `emit` flushes
	 * the keys' sync ahead of the requests.
	 */
	$effect(() => {
		const id = lorebookId
		if (!open || !id) return
		const releases = [
			declareInterest<"entries:list">(
				interestKey("entries:list", id),
				handleHistoryEntriesList
			),
			declareInterest<"entries:create">(
				interestKey("entries:create", id),
				handleHistoryEntryCreate
			),
			declareInterest<"lorebooks:bindingList">(
				interestKey("lorebooks:bindingList", id),
				handleLorebookBindingList
			)
		]
		typedSocket.emit("entries:list", {
			lorebookId: id,
			typeId: HISTORY_TYPE_ID
		} satisfies Sockets.Entries.List.Params)
		typedSocket.emit("lorebooks:bindingList", { lorebookId: id })
		return () => {
			for (const release of releases) release()
		}
	})

	// The line's stored clock, when the session has none of its own. Scoped
	// to the book, like every `lorebooks:storyTime` reply.
	$effect(() => {
		const id = lorebookId
		if (!open || !id || storyClock != null) return
		const release = declareInterest<"lorebooks:storyTime">(
			interestKey("lorebooks:storyTime", id),
			handleStoryTime
		)
		typedSocket.emit("lorebooks:storyTime", { lorebookId: id })
		return release
	})

	// The session's line's chain, when it reads a branch. Scoped to the book,
	// like every `amendments:list` reply; the typed emit flushes the key's
	// sync ahead of the request.
	$effect(() => {
		const id = lorebookId
		if (!open || !id || branchId == null) return
		const release = declareInterest<"amendments:list">(
			interestKey("amendments:list", id),
			handleBranches
		)
		typedSocket.emit("amendments:list", { lorebookId: id })
		return release
	})

	/**
	 * The run, as the Activity panel knows it — the reconciliation that keeps
	 * the window from spinning forever (plan B8). A run reopened from the
	 * sidebar while still running has no per-dispatch listeners of its own,
	 * and a reconnect can drop the `:complete` frame; the activity store is
	 * refreshed on every `activity:update` and on reconnect, so while the
	 * window waits it follows the run there: its progress, its review, its
	 * failure. Which activity is ours: the one named (`activeActivityId`),
	 * else the first of this session's that was not there when Generate was
	 * pressed — a session runs one summarize at a time (the server's lock).
	 */
	const sessionSummarizesCtx: SessionSummarizesCtx | undefined =
		getContext("sessionSummarizesCtx")
	let activitiesBeforeRun: Set<string> | null = null

	$effect(() => {
		if (!open || step !== "generating") return
		const list = sessionSummarizesCtx?.activities ?? []
		const named = activeActivityId
		const run = named
			? list.find((a) => a.activityId === named)
			: activitiesBeforeRun
				? list.find(
						(a) =>
							a.sessionId === sessionId &&
							!activitiesBeforeRun!.has(a.activityId)
					)
				: undefined
		if (!run) return
		const status = run.status
		const pending = run.pendingResult
		const failure = run.errorMessage
		const phase = run.phase
		const batch = run.batch
		const total = run.totalBatches
		untrack(() => {
			activeActivityId = run.activityId
			if (status === "review" && pending) {
				activeCleanup?.()
				rawOutput = pending.raw ?? ""
				reviewName = pending.name ?? ""
				reviewContent = pending.content ?? pending.raw ?? ""
				bindCharacterId = pending.lorebookBindingCharacterId ?? null
				step = "review"
				return
			}
			if (status === "error") {
				activeCleanup?.()
				errorMessage = failure || "The summary could not be made."
				step = "error"
				return
			}
			if (phase) summarizePhase = phase as typeof summarizePhase
			if (batch != null) currentBatch = batch
			if (total != null) totalBatches = total
		})
	})

	// ── Socket handlers ──────────────────────────────────────────────
	function handleProgress(data: Sockets.Sessions.Summarize.Progress) {
		summarizePhase = data.phase
		currentBatch = data.batch
		totalBatches = data.totalBatches
		// A frame carrying a status sets it; a phase frame without one
		// leaves the last status standing, as the run itself would.
		if (data.status) runStatus = data.status
	}

	function handleComplete(data: Sockets.Sessions.Summarize.Response) {
		if (step !== "generating") return
		rawOutput = data.raw
		activeActivityId = data.activityId ?? activeActivityId
		reviewName = data.name ?? ""
		reviewContent = data.content ?? data.raw ?? ""
		bindCharacterId = data.lorebookBindingCharacterId ?? null
		step = "review"
	}

	function handleError(data: Sockets.Sessions.Summarize.ErrorResponse) {
		if (step !== "generating") return
		errorMessage = data.error
		step = "error"
	}

	function handleLorebooksList(data: Sockets.Lorebooks.List.Response) {
		availableLorebooks = data.lorebookList
	}

	/**
	 * Pushed to every tab of the user, and this modal is mounted on every
	 * session page — so another tab's attach arrives here too. Only this
	 * session's is ours; acting on another's would toast in every tab and
	 * hand `onLorebookSet` a different session's book to write onto this one
	 * (B8).
	 */
	function handleSetLorebook(data: Sockets.Sessions.SetLorebook.Response) {
		if (data.session?.id !== sessionId) return
		lorebookId = data.session.lorebookId
		if (data.session.lorebookId) {
			onLorebookSet(data.session.lorebookId)
			toaster.success({ title: "Lorebook read into this session" })
		}
	}

	/**
	 * `lorebooks:create` is a broadcast, not a reply — it fires for creates made
	 * anywhere, including the Lorebooks+ sidebar. This modal is mounted on every
	 * session page, so attaching unconditionally here meant creating a lorebook from
	 * the sidebar silently bound it to whatever session happened to be open.
	 *
	 * Only the create this modal asked for is its own: it sends a `requestId`,
	 * which the server echoes on the broadcast and on `lorebooks:create:error`.
	 * A bare flag, or the submitted name, is claimed by whichever answer lands
	 * first — another surface's refusal, or another create of the same name.
	 */
	let pendingCreateRequestId: string | null = $state(null)

	function handleLorebookCreate(data: any) {
		if (!data.lorebook) return
		availableLorebooks = [...availableLorebooks, data.lorebook]
		if (
			pendingCreateRequestId !== null &&
			data.requestId === pendingCreateRequestId
		) {
			pendingCreateRequestId = null
			attachLorebookToSession(data.lorebook.id)
		}
	}

	function handleLorebookCreateError(data: {
		error?: string
		requestId?: string
	}) {
		// Only a create this modal asked for is its to report — the sidebar,
		// in the same tab, reports its own.
		if (
			pendingCreateRequestId === null ||
			data?.requestId !== pendingCreateRequestId
		)
			return
		pendingCreateRequestId = null
		isCreatingLorebook = false
		toaster.error({
			title: "Failed to create lorebook",
			description: data?.error
		})
	}

	function handleHistoryEntriesList(data: Sockets.Entries.List.Response) {
		// One namespace now, so a list for some *other* tab's type arrives
		// here too — the type filter is what makes that harmless.
		if (data.lorebookId === lorebookId && data.typeId === HISTORY_TYPE_ID) {
			historyEntryList = data.entryList as History[]
			preselectNewestHistory()
		}
	}

	/**
	 * Default to the most recent entry the session's reading sees — the
	 * overwhelmingly common choice when summarising a scene that just
	 * happened. Only once the line and the story's moment are known: before a
	 * branch session's chain arrives, main's entries past its fork would
	 * still look like its own, and before its line's clock arrives, entries
	 * past that clock would.
	 */
	function preselectNewestHistory() {
		if (
			loreType !== "scene" ||
			didPreselectHistoryEntry ||
			selectedHistoryEntryId !== "" ||
			!lineKnown ||
			!momentKnown
		)
			return
		const newest = lineHistory[0]
		if (!newest) return
		selectedHistoryEntryId = String(newest.id)
		didPreselectHistoryEntry = true
	}

	function handleStoryTime(data: Sockets.Lorebooks.BookStoryTime) {
		if (data.lorebookId !== lorebookId) return
		const clock =
			branchId == null
				? data.clocks.main
				: (data.clocks.branches.find((b) => b.branchId === branchId)
						?.clock ?? null)
		lineClock = clock
			? {
					year: clock.year,
					month: clock.month ?? null,
					day: clock.month != null ? (clock.day ?? null) : null
				}
			: null
		clockOf = data.lorebookId
		preselectNewestHistory()
	}

	function handleBranches(data: Sockets.Amendments.List.Response) {
		if (data.lorebookId !== lorebookId) return
		branches = data.branches ?? []
		branchesOf = data.lorebookId
		preselectNewestHistory()
	}

	function handleHistoryEntryCreate(data: Sockets.Entries.Create.Response) {
		// A broadcast: another book's history entry is not this list's, and
		// only a create this modal started may move the picker.
		if (
			data.entry?.typeId !== HISTORY_TYPE_ID ||
			data.entry.lorebookId !== lorebookId
		)
			return
		const historyEntry = data.entry as History
		const asked = isCreatingHistoryEntry
		isCreatingHistoryEntry = false
		if (historyEntry) {
			// Don't rely on a subsequent entries:list refresh to show
			// this entry — in a busy session (concurrent message generation,
			// vectorization), that refresh can be one of several in flight
			// and an older, slower one can resolve last and overwrite this
			// entry right back out of the list. Apply it locally so the
			// modal is correct regardless of refresh ordering.
			if (!historyEntryList.some((e) => e.id === historyEntry.id)) {
				historyEntryList = [...historyEntryList, historyEntry]
			}
			if (loreType === "scene" && asked) {
				selectedHistoryEntryId = String(historyEntry.id)
			}
		}
	}

	// Without this, a failed create (e.g. the lorebook was deleted/detached
	// out from under this modal, or any other server-side error) left
	// isCreatingHistoryEntry stuck true forever — the "New"/"Create New
	// Entry" button would spin indefinitely with no way to retry, since
	// entries:create never fires and this was the only place that
	// cleared the loading state.
	function handleHistoryEntryCreateError(data: { error?: string }) {
		// The same `entries:create:error` answers a failed lore Save, which
		// reports itself inline — only a history create in flight is ours.
		if (!isCreatingHistoryEntry) return
		isCreatingHistoryEntry = false
		toaster.error({
			title: "Failed to create history entry",
			description: data?.error
		})
	}

	function handleLorebookBindingList(
		data: Sockets.Lorebooks.BindingList.Response
	) {
		if (data.lorebookId === lorebookId) {
			lorebookBindings = data.lorebookBindingList
		}
	}

	// Per-dispatch staleness guard for the sessions:summarize:* events —
	// generate() below registers fresh listeners closing over the token
	// current at dispatch time, and stores their cleanup so a superseding
	// call, a cancel, or unmount can all tear down a stale/in-flight
	// generation's listeners rather than leaving them registered.
	let activeGenerationToken = 0
	let activeCleanup: (() => void) | null = null

	// sessions:summarize:progress/complete/error are NOT declared here —
	// this component stays mounted for the whole session page (unlike
	// ProcessSceneModal, which remounts fresh per use), so a single persistent
	// listener can't distinguish a stale, already-superseded generation's
	// events from the current one. See generate()'s per-dispatch interest
	// below instead.
	//
	// These five are the modal's own, declared at initialisation and released
	// on destroy by the registry. The book's three reads are scoped and held
	// only while the window is open (the effect above).
	useInterest<"lorebooks:list">("lorebooks:list", handleLorebooksList)
	useInterest<"sessions:setLorebook">(
		"sessions:setLorebook",
		handleSetLorebook
	)
	useInterest<"lorebooks:create">("lorebooks:create", handleLorebookCreate)
	useInterest<"lorebooks:create:error">(
		"lorebooks:create:error",
		handleLorebookCreateError
	)
	useInterest<"entries:create:error">(
		"entries:create:error",
		handleHistoryEntryCreateError
	)

	$effect(() => {
		requestWithInterest("lorebooks:list", {}, handleLorebooksList)
	})

	onDestroy(() => {
		// Only the per-dispatch interests are torn down by hand; the five
		// above are the registry's to release.
		activeCleanup?.()
	})

	// ── Actions ──────────────────────────────────────────────────────
	function attachLorebookToSession(id: number) {
		attachToSession(typedSocket, sessionId, id)
		attachingLorebookId = ""
	}

	function confirmAttachExisting() {
		if (!attachingLorebookId) return
		attachLorebookToSession(Number(attachingLorebookId))
	}

	function createAndAttachLorebook() {
		if (!newLorebookName.trim()) return
		// Claim the pending create so handleLorebookCreate knows which
		// broadcast is ours to act on — see the comment there.
		pendingCreateRequestId = uuid()
		requestWithInterest(
			"lorebooks:create",
			{ name: newLorebookName.trim(), requestId: pendingCreateRequestId },
			handleLorebookCreate
		)
		newLorebookName = ""
		isCreatingLorebook = false
	}

	/**
	 * A session write: the server files it on the session's line and dates
	 * it at the session's story now (the step after its line's newest entry
	 * while the session follows that line's present), so no date is sent.
	 */
	function createBlankHistoryEntry() {
		if (!lorebookId) return
		// Answered on the book's scoped `entries:create` key, held while the
		// window is open (above); the typed `emit` flushes its sync first.
		// (A bare `requestWithInterest` here took a key it never let go of.)
		typedSocket.emit(
			"entries:create",
			{
				entry: {
					typeId: HISTORY_TYPE_ID,
					lorebookId,
					content: "",
					keys: [],
					enabled: true,
					constant: false,
					useRegex: false,
					caseSensitive: false
				} as Sockets.Entries.Create.Params["entry"],
				sessionId
			}
		)
		isCreatingHistoryEntry = true
	}

	/**
	 * Scene runs take a different route to the other two lore types.
	 *
	 * A scene is a row of its own with its messages linked, and
	 * `scenes:process` is the scene's own activity-backed, resumable pipeline
	 * — so the scene path creates its scene up front and hands off to it.
	 * `sessions:summarize` answers world and character lore only.
	 *
	 * Creating first also means the scene is visible in the UI, with its
	 * messages linked, from the moment the run starts.
	 */
	function generateScene() {
		if (!lorebookId || !selectedHistoryEntryId) return

		let releaseCreated: (() => void) | null = null
		let releaseCreateError: (() => void) | null = null
		/** This dispatch's id, echoed on the reply and on its refusal (B8). */
		const requestId = uuid()
		const cleanupCreate = () => {
			releaseCreated?.()
			releaseCreateError?.()
			releaseCreated = null
			releaseCreateError = null
			if (activeCleanup === cleanupCreate) activeCleanup = null
		}

		function onCreated(data: {
			scene?: { id: number; selectedMessageIds?: number[] }
			notRecorded?: string[]
			requestId?: string
		}) {
			// `scenes:create` is a broadcast, so it is claimed by the id this
			// dispatch sent — another tab's create, or another surface's in
			// this tab, is not this one's.
			if (!data.scene || data.requestId !== requestId) return
			cleanupCreate()
			// The scene is saved; what its recording left off the timeline
			// is said now (A18) — the processing that follows is its own.
			const recorded = notRecordedToast("Scene saved", data.notRecorded)
			if (recorded.kind === "warning")
				toaster.warning({ title: recorded.title, description: recorded.description })

			// Only now is it safe to drop the selection — see onSceneProcessStarted.
			onSceneProcessStarted?.(data.scene.id)

			typedSocket.emit("scenes:process", {
				sceneId: data.scene.id,
				ephemeralOnCancel: true
			} satisfies Sockets.Scenes.Process.Params)

			onOpenChange({ open: false })
		}

		function onCreateError(data: { error?: string; requestId?: string }) {
			// Claimed by id: the refusal goes to this tab alone, but another
			// surface in it may have asked for a scene too.
			if (data?.requestId !== requestId) return
			cleanupCreate()
			step = "error"
			errorMessage = data?.error ?? "Could not create the scene."
		}

		// Parked on activeCleanup so onDestroy can drop these too — closing the
		// modal while the create is still in flight used to leave both
		// interests declared forever.
		activeCleanup = cleanupCreate
		releaseCreateError = declareInterest<"scenes:create:error">(
			"scenes:create:error",
			onCreateError
		)

		step = "generating"
		errorMessage = ""
		// Declares the reply interest, syncs it, then emits — in that order, so
		// the reply is reachable whenever this family is gated.
		releaseCreated = requestWithInterest(
			"scenes:create",
			{
				scene: {
					lorebookId,
					sessionId,
					historyEntryId: Number(selectedHistoryEntryId),
					selectedMessageIds,
					name: null
				},
				requestId
			} as any,
			onCreated
		)
	}

	function generate() {
		if (loreType === "scene") {
			generateScene()
			return
		}

		// A truly-overlapping call (shouldn't normally happen — the UI
		// disables re-clicking Generate while step === "generating" — but
		// cheap to guard regardless) would otherwise leak the previous
		// dispatch's listeners, since its :complete/:error may never arrive
		// to trigger its own self-unsubscribe.
		activeCleanup?.()

		activeGenerationToken += 1
		const token = activeGenerationToken

		// Scoped to this session (`SCOPED_EVENTS`), and checked here too: a
		// run in another tab's session is never this modal's.
		const onProgress = (data: Sockets.Sessions.Summarize.Progress) => {
			if (token !== activeGenerationToken) return
			if (data.sessionId !== sessionId) return
			handleProgress(data)
		}
		const onComplete = (data: Sockets.Sessions.Summarize.Response) => {
			if (token !== activeGenerationToken) return
			if (data.sessionId !== sessionId) return
			cleanup()
			handleComplete(data)
		}
		const onError = (data: Sockets.Sessions.Summarize.ErrorResponse) => {
			if (token !== activeGenerationToken) return
			cleanup()
			handleError(data)
		}
		let releases: Array<() => void> = []
		function cleanup() {
			for (const release of releases) release()
			releases = []
			if (activeCleanup === cleanup) activeCleanup = null
		}
		activeCleanup = cleanup
		releases = [
			declareInterest<"sessions:summarize:progress">(
				interestKey("sessions:summarize:progress", sessionId),
				onProgress
			),
			declareInterest<"sessions:summarize:complete">(
				interestKey("sessions:summarize:complete", sessionId),
				onComplete
			),
			// A refusal: sent to the asking tab alone, never scoped.
			declareInterest<"sessions:summarize:error">(
				"sessions:summarize:error",
				onError
			)
		]

		step = "generating"
		summarizePhase = "drafting"
		currentBatch = 0
		totalBatches = 1
		runStatus = null
		bindCharacterId = null
		errorMessage = ""
		reviewLoreType = loreType
		// What the Activity panel already holds for this session, so the run
		// this press starts is told apart from them (the reconciliation above).
		activeActivityId = null
		activitiesBeforeRun = new Set(
			(sessionSummarizesCtx?.activities ?? [])
				.filter((a) => a.sessionId === sessionId)
				.map((a) => a.activityId)
		)

		// `sessions:summarize` answers on THREE other events, so there is no
		// reply interest for `requestWithInterest` to declare — the three above
		// are it. The typed `emit` flushes their pending sync before the request
		// leaves, so it cannot overtake the keys its answers need (ruling 3).
		typedSocket.emit("sessions:summarize", {
			sessionId,
			messageIds: selectedMessageIds,
			loreType,
			// Scene runs returned early above, so only world/character reach
			// here — the old `loreType === "scene" ? undefined : …` guard is
			// now dead and TypeScript rejects it.
			topic: topic.trim() || undefined,
			// One kind of binding: a persona IS a character, so the picker
			// only ever yields a character id.
			lorebookBindingCharacterId: selectedBinding
				? Number(selectedBinding)
				: undefined
		} satisfies Sockets.Sessions.Summarize.Params)
	}

	async function saveEntry() {
		if (!canSave || !lorebookId || isSaving) return
		const bookId = lorebookId
		isSaving = true
		saveError = ""
		const savedAs = reviewLoreType

		const name = reviewName.trim()
		const content = reviewContent.trim()
		// The anchor — the cast member this lore is private to — is
		// found or added by the save itself: the run names the
		// character, and the server adds the member in the entry's own
		// write, so a review discarded, a save refused or a save left
		// unanswered leaves the book's cast as it was.
		const lorebookBindingCharacterId =
			savedAs === "character" && bindCharacterId != null
				? bindCharacterId
				: undefined
		// The unified entries door, one row per save. Keys left empty:
		// the summarizer writes a draft for the author to key, and an
		// unkeyed row is not read in until they do.
		const entry =
			savedAs === "character"
				? ({
						typeId: CHARACTER_LORE_TYPE_ID,
						lorebookId: bookId,
						name,
						content,
						lorebookBindingId: null,
						keys: [],
						enabled: true,
						constant: false,
						useRegex: false,
						caseSensitive: false,
						priority: 1
					} satisfies Sockets.Entries.Create.Params["entry"])
				: ({
						typeId: WORLD_LORE_TYPE_ID,
						lorebookId: bookId,
						name,
						content,
						keys: [],
						enabled: true,
						constant: false,
						useRegex: false,
						caseSensitive: false,
						priority: 1
					} satisfies Sockets.Entries.Create.Params["entry"])
		try {
			// `entries:create` is broadcast to every tab of this user, so
			// the reply is claimed only when it is this row — same book,
			// type, name and (server-trimmed) content. A session write: the
			// server files it on the session's line.
			await awaitReply({
				socket: typedSocket,
				event: "entries:create",
				params: {
					entry,
					sessionId,
					lorebookBindingCharacterId,
					// The review this save keeps: what makes the row
					// machine-written, checked by the server.
					...(activeActivityId ? { activityId: activeActivityId } : {})
				},
				replyKey: interestKey("entries:create", bookId),
				errorEvent: "entries:create:error",
				fallbackError: "The entry could not be saved.",
				match: (data) =>
					data.entry?.lorebookId === bookId &&
					data.entry.typeId === entry.typeId &&
					(data.entry.name ?? "") === name &&
					data.entry.content === content
			})
		} catch (err) {
			// Keep the modal, the text and the activity: the save did not
			// land, so the generated summary still lives only here.
			saveError =
				err instanceof Error && err.message
					? err.message
					: "The entry could not be saved."
			isSaving = false
			return
		}

		toaster.success({
			title:
				savedAs === "character"
					? "Character lore entry saved"
					: "World lore entry saved"
		})
		isSaving = false
		// Only now is the generated text safe to let go of: the row exists.
		// Dismissing the activity any earlier would make a failed save
		// terminal — the summary lives nowhere else until then.
		if (activeActivityId) {
			typedSocket.emit("activity:dismiss", {
				id: activeActivityId,
				how: "acted"
			})
			activeActivityId = null
		}
		onSaved()
		onOpenChange({ open: false })
	}
</script>

{#snippet confirmBlock()}
	<div class="space-y-5">
		{#if loreWrites.off}
			<LoreWritesOffNotice />
		{/if}
		<!-- Lorebook status -->
		<div class="border-surface-300-700 rounded-lg border p-3">
			{#if hasLorebook}
				{@const book = availableLorebooks.find(
					(l) => l.id === lorebookId
				)}
				<div class="flex items-center gap-2 text-sm">
					<Icons.BookMarked
						size={16}
						class="text-success-500 shrink-0"
					/>
					<span class="text-surface-600-400">Saving to:</span>
					<span class="font-semibold">
						{book?.name ?? `Lorebook #${lorebookId}`}
					</span>
				</div>
			{:else}
				<div class="space-y-3">
					<div class="flex items-start gap-2 text-sm">
						<Icons.TriangleAlert
							size={16}
							class="text-warning-500 mt-0.5 shrink-0"
						/>
						<span>
							This session reads no lorebook. Read one into this
							session to continue.
						</span>
					</div>
					{#if !isCreatingLorebook}
						<div class="flex flex-wrap gap-2">
							<Select
								label="Lorebook to read into this session"
								labelHidden
								placeholder="Select existing lorebook…"
								class="flex-1 text-sm"
								options={availableLorebooks.map((lb) => ({
									value: String(lb.id),
									label: lb.name ?? ""
								}))}
								bind:value={attachingLorebookId}
							/>
							<button
								class="btn btn-sm preset-filled-primary-500"
								disabled={!attachingLorebookId}
								onclick={confirmAttachExisting}
							>
								{READ_INTO_SESSION}
							</button>
							<button
								class="btn btn-sm preset-filled-surface-400-600"
								onclick={() => (isCreatingLorebook = true)}
							>
								<Icons.Plus size={14} /> New
							</button>
						</div>
					{:else}
						<div class="flex gap-2">
							<input
								aria-label="New lorebook name"
								class="input flex-1 text-sm"
								type="text"
								placeholder="New lorebook name…"
								bind:value={newLorebookName}
								onkeydown={(e) =>
									e.key === "Enter" &&
									createAndAttachLorebook()}
							/>
							<button
								class="btn btn-sm preset-filled-primary-500"
								disabled={!newLorebookName.trim()}
								onclick={createAndAttachLorebook}
							>
								Create and read
							</button>
							<button
								aria-label="Cancel new lorebook"
								class="btn btn-sm preset-filled-surface-400-600"
								onclick={() => (isCreatingLorebook = false)}
							>
								<Icons.X size={14} />
							</button>
						</div>
					{/if}
				</div>
			{/if}
		</div>

		<!-- Entry type -->
		<fieldset class="space-y-2">
			<legend class="label text-sm font-semibold">Entry type</legend>
			<div class="flex flex-wrap gap-4">
				<label class="flex cursor-pointer items-center gap-2">
					<input
						type="radio"
						class="radio"
						name="loreType"
						value="scene"
						bind:group={loreType}
					/>
					<Icons.Film size={16} />
					<span class="text-sm">Scene</span>
				</label>
				<label class="flex cursor-pointer items-center gap-2">
					<input
						type="radio"
						class="radio"
						name="loreType"
						value="world"
						bind:group={loreType}
					/>
					<Icons.Globe size={16} />
					<span class="text-sm">World lore</span>
				</label>
				<label class="flex cursor-pointer items-center gap-2">
					<input
						type="radio"
						class="radio"
						name="loreType"
						value="character"
						bind:group={loreType}
					/>
					<Icons.User size={16} />
					<span class="text-sm">Character lore</span>
				</label>
			</div>
		</fieldset>

		<!-- Scene gap warning -->
		{#if loreType === "scene" && hasSceneMessageGap}
			<div
				class="border-warning-500/40 bg-warning-500/10 flex items-start gap-2 rounded-lg border p-3 text-sm"
			>
				<Icons.TriangleAlert
					size={16}
					class="text-warning-500 mt-0.5 shrink-0"
				/>
				<span>
					Selected messages have a visible gap. Scenes must be a
					consecutive sequence with no unselected visible messages
					between them.
				</span>
			</div>
		{/if}

		<!-- History entry binding (scene only) -->
		{#if loreType === "scene"}
			<div class="space-y-1">
				<!-- A heading for both branches; the Select carries its own
				     (visually hidden) label. -->
				<p class="label text-sm font-semibold">
					History entry <span class="text-error-500">*</span>
				</p>
				{#if lineHistory.length > 0 || selectedHistoryEntryId}
					<div class="flex gap-2">
						<Select
							label="History entry"
							labelHidden
							required
							placeholder="— Select history entry —"
							class="flex-1 text-sm"
							options={lineHistory.map((entry) => ({
								value: String(entry.id),
								label: entry.year
									? `Year ${entry.year}${entry.month ? `, Month ${entry.month}` : ""}${entry.day ? `, Day ${entry.day}` : ""}`
									: `Entry #${entry.id}`
							}))}
							bind:value={selectedHistoryEntryId}
						/>
						<button
							class="btn btn-sm preset-filled-surface-400-600"
							disabled={isCreatingHistoryEntry || !hasLorebook}
							onclick={createBlankHistoryEntry}
							title={!hasLorebook
								? "Read a lorebook into this session first"
								: "Add an empty history entry at this session's story date"}
						>
							{#if isCreatingHistoryEntry}
								<Icons.Loader2 size={14} class="animate-spin" />
							{:else}
								<Icons.Plus size={14} />
							{/if}
							New
						</button>
					</div>
				{:else}
					<div class="flex gap-2">
						<p class="text-surface-700-300 flex-1 text-sm">
							No history entries yet.
						</p>
						<button
							class="btn btn-sm preset-filled-primary-500"
							disabled={isCreatingHistoryEntry || !hasLorebook}
							onclick={createBlankHistoryEntry}
							title={!hasLorebook
								? "Read a lorebook into this session first"
								: undefined}
						>
							{#if isCreatingHistoryEntry}
								<Icons.Loader2 size={14} class="animate-spin" />
							{:else}
								<Icons.Plus size={14} />
							{/if}
							Create new entry
						</button>
					</div>
				{/if}
				{#if selectedHistoryEntryId}
					{@const entry = historyEntryList.find(
						(e) => e.id === Number(selectedHistoryEntryId)
					)}
					{#if entry?.content}
						<p class="text-surface-700-300 line-clamp-2 text-xs">
							{entry.content}
						</p>
					{:else}
						<p class="text-surface-600-400 text-xs italic">
							Empty entry — content will be populated from scenes
							later.
						</p>
					{/if}
				{/if}
			</div>
		{/if}

		<!-- Topic (world + character) -->
		{#if loreType === "world" || loreType === "character"}
			<div class="space-y-1">
				<label
					class="label text-sm font-semibold"
					for="summarize-topic"
				>
					Focus topic
					{#if loreType === "character"}
						<span class="text-error-500">*</span>
					{:else}
						<span class="text-surface-600-400 font-normal">
							(optional)
						</span>
					{/if}
				</label>
				<input
					id="summarize-topic"
					class="input text-sm"
					type="text"
					maxlength="300"
					placeholder={loreType === "character"
						? 'e.g. "abilities", "relationship with Kira", "past"'
						: 'e.g. "the guards in the Labyrinth of Descia"'}
					bind:value={topic}
				/>
				{#if topic.trim()}
					<p class="text-surface-700-300 text-xs">
						Prompt will include: <em>
							"Specifically focus on: "{topic.trim()}""
						</em>
					</p>
				{/if}
			</div>
		{/if}

		<!-- Binding (character lore only) -->
		{#if loreType === "character"}
			<div class="space-y-1">
				<Select
					label="Bind to character (optional)"
					class="text-sm"
					options={[
						{ value: "", label: "— None (unbound) —" },
						...bindableEntities.map((e) => ({
							value: String(e.id),
							label: e.isPersona ? `${e.name} · persona` : e.name
						}))
					]}
					bind:value={selectedBinding}
				/>
			</div>
		{/if}

		<!-- Message count -->
		<p class="text-surface-700-300 text-sm">
			<Icons.MessageSquare size={14} class="mr-1 inline" />
			Summarizing
			<strong>{selectedMessageIds.length}</strong>
			{selectedMessageIds.length === 1 ? "message" : "messages"}
		</p>
	</div>
{/snippet}

{#snippet previewBlock()}
	<!-- No draft text streams: the run reports its phase and status only,
	     and the text arrives whole at review. -->
	{#if summarizePhase === "synthesizing"}
		<div class="text-surface-700-300 py-4 text-center text-sm">
			<div
				class="bg-primary-500 mx-auto mb-2 h-2 w-2 animate-pulse rounded-full"
			></div>
			Synthesizing final entry…
		</div>
	{:else}
		<div class="text-surface-700-300 py-4 text-center text-sm">
			<div
				class="bg-primary-500 mx-auto mb-2 h-2 w-2 animate-pulse rounded-full"
			></div>
			Drafting…
		</div>
	{/if}
{/snippet}

{#snippet reviewBlock()}
	<div class="space-y-4">
		{#if loreWrites.off}
			<!-- A review reopened after the setting moved: it cannot save. -->
			<LoreWritesOffNotice />
		{/if}
		{#if saveError}
			<p
				class="border-error-500 text-error-700-300 rounded-lg border p-3 text-sm"
				role="alert"
			>
				Not saved: {saveError} Your text is still here — try Save again.
			</p>
		{/if}
		{#if branchId != null}
			<!-- A branch session's saves are that line's alone; say so before
			     Save rather than after. -->
			<p class="text-surface-700-300 text-xs">
				Saves on this session's line, {lineName}. Lines that branch off
				it see it up to where they branch; main and the other lines
				don't.
			</p>
		{/if}
		<div class="space-y-1">
			<label class="label text-sm font-semibold" for="review-name">
				Name <span class="text-error-500">*</span>
			</label>
			<input
				id="review-name"
				class="input text-sm"
				type="text"
				placeholder="Entry name…"
				bind:value={reviewName}
			/>
			{#if reviewName}
				<p class="text-surface-700-300 text-xs">
					Auto-generated — edit if needed.
				</p>
			{/if}
		</div>

		<div class="space-y-1">
			<label class="label text-sm font-semibold" for="review-content">
				Content <span class="text-error-500">*</span>
			</label>
			<textarea
				id="review-content"
				class="textarea min-h-32 text-sm"
				placeholder="Entry content…"
				bind:value={reviewContent}
			></textarea>
		</div>

		<div>
			<button
				class="text-surface-700-300 hover:text-surface-700-300 flex items-center gap-1 text-xs"
				onclick={() => (showRaw = !showRaw)}
			>
				<Icons.ChevronDown
					size={14}
					class="transition-transform {showRaw ? 'rotate-180' : ''}"
				/>
				{showRaw ? "Hide" : "Show"} raw LLM output
			</button>
			{#if showRaw}
				<pre
					class="bg-surface-200-800 mt-2 overflow-x-auto rounded p-3 text-xs whitespace-pre-wrap">{rawOutput}</pre>
			{/if}
		</div>
	</div>
{/snippet}

<AiTaskModal
	{open}
	{onOpenChange}
	title="Summarize to Lorebook"
	runningTitle="Generating summary…"
	reviewTitle="Review & Save"
	badge={badgeLabel}
	step={aiStep}
	{progressPercent}
	{progressLabel}
	canStart={canGenerate}
	startLabel="Generate summary"
	{canSave}
	saveLabel="Save to Lorebook"
	{isSaving}
	{errorMessage}
	hasReviewContent={reviewContent.trim().length > 0}
	onStart={generate}
	onSave={saveEntry}
	onCancel={() => {
		// The modal stays mounted (only `open` toggles), so cancelling a
		// generation must explicitly tear down its listeners here — without
		// this, an in-flight generation's :complete/:error would sit
		// registered indefinitely across repeated cancel/retry cycles.
		activeCleanup?.()
		// Cancel means stop, not hide: without this the server would keep
		// generating and the activity would linger as a phantom "running" card.
		if (activeActivityId) {
			typedSocket.emit("activity:cancel", { id: activeActivityId })
			activeActivityId = null
		}
		onOpenChange({ open: false })
	}}
	onMinimize={() => {
		// Deliberately the opposite of onCancel: drop the per-dispatch socket
		// listeners but leave the run and its activity alive, so the Activity
		// panel can carry it and reopen it later.
		activeCleanup?.()
		onOpenChange({ open: false })
	}}
	onRetry={generate}
	onDiscard={() => onOpenChange({ open: false })}
	onBack={() => (step = "configure")}
	onRerun={generate}
	onViewLastResult={() => {
		// The review is the type it was generated as, whatever the radio
		// says now.
		loreType = reviewLoreType
		step = "review"
	}}
	confirm={confirmBlock}
	preview={previewBlock}
	review={reviewBlock}
/>
