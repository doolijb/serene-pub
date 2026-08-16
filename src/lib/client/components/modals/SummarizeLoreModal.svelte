<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import * as skio from "sveltekit-io"
	import { onDestroy, onMount } from "svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { resolveOrCreateBindingByName } from "$lib/client/utils/createLorebookBinding"
	import { attachLorebookToChat as attachToChat } from "$lib/client/utils/attachLorebookToChat"
	import AiTaskModal, { type AiTaskStep } from "./AiTaskModal.svelte"

	/** A name not yet backed by a real lorebookBindings id — either
	 * suggested by character extraction or typed manually in review. Only
	 * resolved to a real binding (matched or newly created) at Save. */
	type PendingNewCharacter = { name: string; source: "suggested" | "manual" }

	/**
	 * Newest first. Missing month/day sort as 0, so a year-only entry lands
	 * *after* dated entries in the same year — the same precision ordering the
	 * History tab uses ascending (`NULLS FIRST`), just reversed.
	 */
	function compareHistoryEntriesDesc(
		a: { year: number | null; month: number | null; day: number | null },
		b: { year: number | null; month: number | null; day: number | null }
	): number {
		if ((a.year ?? 0) !== (b.year ?? 0)) return (b.year ?? 0) - (a.year ?? 0)
		if ((a.month ?? 0) !== (b.month ?? 0))
			return (b.month ?? 0) - (a.month ?? 0)
		return (b.day ?? 0) - (a.day ?? 0)
	}

	function computeDefaultDate(
		entries: Sockets.HistoryEntries.List.Response["historyEntryList"]
	): { year: number; month: number; day: number } {
		const dated = entries.filter((e) => e.year !== null)
		if (dated.length === 0) return { year: 1, month: 1, day: 1 }

		const latest = [...dated].sort(compareHistoryEntriesDesc)[0]

		return {
			year: latest.year ?? 1,
			month: latest.month ?? 1,
			day: (latest.day ?? 0) + 1
		}
	}

	interface BindableEntity {
		type: "character" | "persona"
		id: number
		name: string
	}

	interface Props {
		open: boolean
		onOpenChange: (e: { open: boolean }) => void
		chatId: number
		lorebookId: number | null
		selectedMessageIds: number[]
		initialLoreType?: "world" | "character" | "scene"
		onSaved: () => void
		onLorebookSet: (lorebookId: number) => void
		chatCharacters?: BindableEntity[]
		chatPersonas?: BindableEntity[]
		hasSceneMessageGap?: boolean
		/**
		 * Scene runs hand off to the activity-backed `scenes:process` pipeline:
		 * the scene row is created first, then this fires so the caller can
		 * clear the message selection and open the review modal. Only after the
		 * create succeeds — a failed create must leave the selection intact.
		 */
		onSceneProcessStarted?: (sceneId: number) => void
		/**
		 * Resume an existing chat_summarize activity instead of starting fresh.
		 * Supplied by the chat page when the Activity panel reopens a run.
		 */
		resumeActivity?: ChatSummarizeState | null
	}

	let {
		open = $bindable(),
		onOpenChange,
		chatId,
		lorebookId = $bindable(),
		selectedMessageIds,
		initialLoreType = "world",
		onSaved,
		onLorebookSet,
		chatCharacters = [],
		chatPersonas = [],
		hasSceneMessageGap = false,
		onSceneProcessStarted,
		resumeActivity = null
	}: Props = $props()

	/**
	 * Activity backing the current run, so Save can dismiss it and Minimize can
	 * leave it standing. Null for a run started before this modal opened.
	 */
	let activeActivityId = $state<string | null>(null)

	const socket = skio.get()!
	// Only used for resolveOrCreateBindingByName, which needs the type-safe
	// on/off/emit wrapper the rest of this file's older code predates.
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
	let attachingLorebookId = $state<number | "">("")
	let isCreatingLorebook = $state(false)
	let newLorebookName = $state("")
	let historyEntryList = $state<
		Sockets.HistoryEntries.List.Response["historyEntryList"]
	>([])

	let selectedHistoryEntryId = $state<number | "">("")
	let isCreatingHistoryEntry = $state(false)

	/** Newest first, so the most recent entry is the obvious default. */
	let sortedHistoryEntryList = $derived(
		[...historyEntryList].sort(compareHistoryEntriesDesc)
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
		const seen = new Set<string>()
		const result: BindableEntity[] = []
		const add = (e: BindableEntity) => {
			const key = `${e.type}:${e.id}`
			if (!seen.has(key)) {
				seen.add(key)
				result.push(e)
			}
		}
		for (const cc of chatCharacters) add(cc)
		for (const cp of chatPersonas) add(cp)
		for (const b of lorebookBindings) {
			if (b.characterId && (b as any).character)
				add({
					type: "character",
					id: b.characterId,
					name:
						(b as any).character.nickname ||
						(b as any).character.name
				})
			if (b.personaId && (b as any).persona)
				add({
					type: "persona",
					id: b.personaId,
					name: (b as any).persona.name
				})
		}
		return result
	})
	let selectedBinding = $state("")
	let resolvedBindingId = $state<number | null>(null)

	// ── Generating step state ────────────────────────────────────────
	let summarizePhase = $state<
		"drafting" | "synthesizing" | "naming" | "extracting"
	>("drafting")
	let currentBatch = $state(0)
	let totalBatches = $state(1)
	let partialSummary = $state<{ content?: string; raw?: string }>({})
	let trace = $state<Sockets.Chats.Summarize.TraceEntry[]>([])
	let showTrace = $state(false)
	let expandedTraceIdx = $state<number | null>(null)

	// ── Review step state ────────────────────────────────────────────
	let reviewName = $state("")
	let reviewContent = $state("")
	let rawOutput = $state("")
	let showRaw = $state(false)
	let isSaving = $state(false)
	let extractedParticipantCharacters = $state<number[]>([])
	let extractedMentionedCharacters = $state<number[]>([])
	let newParticipantId = $state<number | "">("")
	let newMentionedId = $state<number | "">("")
	let pendingNewParticipants = $state<PendingNewCharacter[]>([])
	let pendingNewMentioned = $state<PendingNewCharacter[]>([])
	let newParticipantName = $state("")
	let newMentionedName = $state("")
	let bindingNameById = $derived.by(() => {
		const map = new Map<number, string>()
		for (const b of lorebookBindings) map.set(b.id, b.name || b.binding)
		return map
	})

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
						? Math.max(5, Math.round((currentBatch / totalBatches) * 80))
						: currentBatch > 0
							? 60
							: 5
	)

	let progressLabel = $derived(
		summarizePhase === "extracting"
			? "Extracting characters…"
			: summarizePhase === "naming"
				? "Naming entry…"
				: summarizePhase === "synthesizing"
					? "Synthesizing final entry…"
					: currentBatch > 0
						? `Drafting part ${currentBatch} of ${totalBatches}…`
						: "Starting…"
	)

	let canGenerate = $derived(
		!!lorebookId &&
			selectedMessageIds.length > 0 &&
			(loreType !== "character" || topic.trim().length > 0) &&
			(loreType !== "scene" || !!selectedHistoryEntryId) &&
			(loreType !== "scene" || !hasSceneMessageGap)
	)
	let canSave = $derived(
		reviewName.trim().length > 0 && reviewContent.trim().length > 0
	)
	let hasLorebook = $derived(!!lorebookId)

	let badgeLabel = $derived(
		loreType === "world"
			? "World Lore"
			: loreType === "character"
				? "Character Lore"
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
			topic = resumeActivity.topic ?? ""
			errorMessage = resumeActivity.errorMessage ?? ""
			const pending = resumeActivity.pendingResult
			if (pending) {
				reviewName = pending.name ?? ""
				reviewContent = pending.content ?? pending.raw ?? ""
				rawOutput = pending.raw ?? ""
				// Carried on the activity precisely so a reopened character-lore
				// review still saves against the binding the server minted.
				resolvedBindingId = pending.lorebookBindingId ?? null
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
			step = "configure"
			loreType = initialLoreType
			topic = ""
			selectedBinding = ""
			resolvedBindingId = null
			selectedHistoryEntryId = ""
			didPreselectHistoryEntry = false
			isCreatingHistoryEntry = false
			attachingLorebookId = ""
			isCreatingLorebook = false
			newLorebookName = ""
			historyEntryList = []
			lorebookBindings = []
			summarizePhase = "drafting"
			currentBatch = 0
			totalBatches = 1
			partialSummary = {}
			rawOutput = ""
			showRaw = false
			reviewName = ""
			reviewContent = ""
			extractedParticipantCharacters = []
			extractedMentionedCharacters = []
			newParticipantId = ""
			newMentionedId = ""
			pendingNewParticipants = []
			pendingNewMentioned = []
			newParticipantName = ""
			newMentionedName = ""
			trace = []
			showTrace = false
			expandedTraceIdx = null
			errorMessage = ""
		}
	})

	$effect(() => {
		if (open && lorebookId) {
			socket.emit("historyEntries:list", { lorebookId })
			socket.emit("lorebooks:bindingList", { lorebookId })
		}
	})

	// ── Socket handlers ──────────────────────────────────────────────
	function handleProgress(data: Sockets.Chats.Summarize.Progress) {
		summarizePhase = data.phase
		currentBatch = data.batch
		totalBatches = data.totalBatches
		partialSummary = data.partial
	}

	function handleTrace(entry: Sockets.Chats.Summarize.TraceEntry) {
		trace = [...trace, entry]
	}

	function handleComplete(data: Sockets.Chats.Summarize.Response) {
		if (step !== "generating") return
		rawOutput = data.raw
		activeActivityId = data.activityId ?? activeActivityId
		reviewName = data.name ?? ""
		reviewContent = data.content ?? data.raw ?? ""
		resolvedBindingId = data.lorebookBindingId ?? null
		extractedParticipantCharacters = data.participantCharacters ?? []
		extractedMentionedCharacters = data.mentionedCharacters ?? []
		pendingNewParticipants = (data.suggestedParticipantCharacters ?? []).map(
			(name) => ({ name, source: "suggested" as const })
		)
		pendingNewMentioned = (data.suggestedMentionedCharacters ?? []).map(
			(name) => ({ name, source: "suggested" as const })
		)
		step = "review"
	}

	function handleError(data: Sockets.Chats.Summarize.ErrorResponse) {
		if (step !== "generating") return
		errorMessage = data.error
		step = "error"
	}

	function handleLorebooksList(data: Sockets.Lorebooks.List.Response) {
		availableLorebooks = data.lorebookList
	}

	function handleSetLorebook(data: Sockets.Chats.SetLorebook.Response) {
		lorebookId = data.chat.lorebookId
		if (data.chat.lorebookId) {
			onLorebookSet(data.chat.lorebookId)
			toaster.success({ title: "Lorebook attached" })
		}
	}

	/**
	 * `lorebooks:create` is a broadcast, not a reply — it fires for creates made
	 * anywhere, including the Lorebooks+ sidebar. This modal is mounted on every
	 * chat page, so attaching unconditionally here meant creating a lorebook from
	 * the sidebar silently bound it to whatever chat happened to be open.
	 *
	 * Only attach when *this* modal asked for the create. Correlating on the
	 * submitted name rather than a bare boolean, because a bare flag is consumed
	 * by whichever broadcast lands first — which may be the sidebar's.
	 *
	 * Residual: two creates racing with the *same* name can still mis-attach.
	 * Rare, and the failure mode is a wrong attach the user can undo, not data
	 * loss — so it is not worth a correlation id on the wire.
	 */
	let pendingCreateName: string | null = $state(null)

	function handleLorebookCreate(data: any) {
		if (!data.lorebook) return
		availableLorebooks = [...availableLorebooks, data.lorebook]
		if (
			pendingCreateName !== null &&
			data.lorebook.name === pendingCreateName
		) {
			pendingCreateName = null
			attachLorebookToChat(data.lorebook.id)
		}
	}

	function handleLorebookCreateError(data: { error: string }) {
		isCreatingLorebook = false
		toaster.error({
			title: "Failed to create lorebook",
			description: data.error
		})
	}

	function handleHistoryEntriesList(
		data: Sockets.HistoryEntries.List.Response
	) {
		if (data.lorebookId === lorebookId) {
			historyEntryList = data.historyEntryList
			// Default to the most recent entry — the overwhelmingly common
			// choice when summarising a scene that just happened.
			if (
				loreType === "scene" &&
				!didPreselectHistoryEntry &&
				selectedHistoryEntryId === "" &&
				sortedHistoryEntryList.length > 0
			) {
				selectedHistoryEntryId = sortedHistoryEntryList[0].id
				didPreselectHistoryEntry = true
			}
		}
	}

	function handleHistoryEntryCreate(
		data: Sockets.HistoryEntries.Create.Response
	) {
		isCreatingHistoryEntry = false
		if (data.historyEntry) {
			// Don't rely on a subsequent historyEntries:list refresh to show
			// this entry — in a busy chat (concurrent message generation,
			// vectorization), that refresh can be one of several in flight
			// and an older, slower one can resolve last and overwrite this
			// entry right back out of the list. Apply it locally so the
			// modal is correct regardless of refresh ordering.
			if (!historyEntryList.some((e) => e.id === data.historyEntry!.id)) {
				historyEntryList = [...historyEntryList, data.historyEntry]
			}
			if (loreType === "scene") {
				selectedHistoryEntryId = data.historyEntry.id
			}
		}
	}

	// Without this, a failed create (e.g. the lorebook was deleted/detached
	// out from under this modal, or any other server-side error) left
	// isCreatingHistoryEntry stuck true forever — the "New"/"Create New
	// Entry" button would spin indefinitely with no way to retry, since
	// historyEntries:create never fires and this was the only place that
	// cleared the loading state.
	function handleHistoryEntryCreateError(data: { error: string }) {
		isCreatingHistoryEntry = false
		toaster.error({
			title: "Failed to create history entry",
			description: data.error
		})
	}

	function handleLorebookBindingList(
		data: Sockets.Lorebooks.BindingList.Response
	) {
		if (data.lorebookId === lorebookId) {
			lorebookBindings = data.lorebookBindingList
		}
	}

	// Per-dispatch staleness guard for the chats:summarize:* events —
	// generate() below registers fresh listeners closing over the token
	// current at dispatch time, and stores their cleanup so a superseding
	// call, a cancel, or unmount can all tear down a stale/in-flight
	// generation's listeners rather than leaving them registered.
	let activeGenerationToken = 0
	let activeCleanup: (() => void) | null = null

	onMount(() => {
		// chats:summarize:progress/complete/error/trace are NOT registered
		// here — this component stays mounted for the whole chat page
		// session (unlike ProcessSceneModal, which remounts fresh per use),
		// so a single persistent listener can't distinguish a stale,
		// already-superseded generation's events from the current one. See
		// generate()'s per-dispatch registration below instead.
		socket.on("lorebooks:list", handleLorebooksList)
		socket.on("chats:setLorebook", handleSetLorebook)
		socket.on("lorebooks:create", handleLorebookCreate)
		socket.on("lorebooks:create:error", handleLorebookCreateError)
		socket.on("historyEntries:list", handleHistoryEntriesList)
		socket.on("historyEntries:create", handleHistoryEntryCreate)
		socket.on(
			"historyEntries:create:error",
			handleHistoryEntryCreateError
		)
		socket.on("lorebooks:bindingList", handleLorebookBindingList)
		socket.emit("lorebooks:list", {})
	})

	onDestroy(() => {
		// skio.get()! returns Server | Socket union — .off() signatures are incompatible
		const s = socket as any
		activeCleanup?.()
		s.off("lorebooks:list", handleLorebooksList)
		s.off("chats:setLorebook", handleSetLorebook)
		s.off("lorebooks:create", handleLorebookCreate)
		s.off("lorebooks:create:error", handleLorebookCreateError)
		s.off("historyEntries:list", handleHistoryEntriesList)
		s.off("historyEntries:create", handleHistoryEntryCreate)
		s.off("historyEntries:create:error", handleHistoryEntryCreateError)
		s.off("lorebooks:bindingList", handleLorebookBindingList)
	})

	// ── Actions ──────────────────────────────────────────────────────
	function attachLorebookToChat(id: number) {
		attachToChat(typedSocket, chatId, id)
		attachingLorebookId = ""
	}

	function confirmAttachExisting() {
		if (!attachingLorebookId) return
		attachLorebookToChat(Number(attachingLorebookId))
	}

	function createAndAttachLorebook() {
		if (!newLorebookName.trim()) return
		// Claim the pending create so handleLorebookCreate knows this broadcast
		// is ours to act on — see the comment there.
		pendingCreateName = newLorebookName.trim()
		socket.emit("lorebooks:create", { name: pendingCreateName })
		newLorebookName = ""
		isCreatingLorebook = false
	}

	function createBlankHistoryEntry() {
		if (!lorebookId) return
		const defaultDate =
			historyEntryList.length > 0
				? computeDefaultDate(historyEntryList)
				: { year: 1, month: 1, day: 1 }
		socket.emit("historyEntries:create", {
			historyEntry: {
				lorebookId,
				year: defaultDate.year,
				month: defaultDate.month,
				day: defaultDate.day,
				content: "",
				keys: "",
				enabled: true,
				constant: false,
				useRegex: false,
				caseSensitive: false
			}
		})
		isCreatingHistoryEntry = true
	}

	/**
	 * Scene runs take a different route to the other two lore types.
	 *
	 * `chats:summarize` is foreground-only: it registers no activity and takes
	 * no abort signal, so closing this modal orphans the run — the server keeps
	 * burning LLM calls while the client discards the result. `scenes:process`
	 * is already activity-backed and resumable, so the scene path creates its
	 * scene up front and hands off to that pipeline instead.
	 *
	 * Creating first also means the scene is visible in the UI, with its
	 * messages linked, from the moment the run starts.
	 */
	function generateScene() {
		if (!lorebookId || !selectedHistoryEntryId) return

		const cleanupCreate = () => {
			const s = socket as any
			s.off("scenes:create", onCreated)
			s.off("scenes:create:error", onCreateError)
		}

		function onCreated(data: { scene?: { id: number; selectedMessageIds?: number[] } }) {
			// `scenes:create` is a broadcast, so correlate before claiming it.
			// Matching on the message id set rather than a bare flag: it is
			// already unique to this dispatch, and a second tab creating a scene
			// concurrently would otherwise hand us the wrong id.
			const ids = data.scene?.selectedMessageIds ?? []
			const mine =
				ids.length === selectedMessageIds.length &&
				ids.every((id) => selectedMessageIds.includes(id))
			if (!data.scene || !mine) return
			cleanupCreate()

			// Only now is it safe to drop the selection — see onSceneProcessStarted.
			onSceneProcessStarted?.(data.scene.id)

			socket.emit("scenes:process", {
				sceneId: data.scene.id,
				ephemeralOnCancel: true
			} satisfies Sockets.Scenes.Process.Params)

			onOpenChange({ open: false })
		}

		function onCreateError(data: { error?: string }) {
			cleanupCreate()
			step = "error"
			errorMessage = data?.error ?? "Could not create the scene."
		}

		socket.on("scenes:create", onCreated)
		socket.on("scenes:create:error", onCreateError)

		step = "generating"
		errorMessage = ""
		socket.emit("scenes:create", {
			scene: {
				lorebookId,
				chatId,
				historyEntryId: Number(selectedHistoryEntryId),
				selectedMessageIds,
				name: null
			}
		} as any)
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

		const onProgress = (data: Sockets.Chats.Summarize.Progress) => {
			if (token !== activeGenerationToken) return
			handleProgress(data)
		}
		const onTrace = (entry: Sockets.Chats.Summarize.TraceEntry) => {
			if (token !== activeGenerationToken) return
			handleTrace(entry)
		}
		const onComplete = (data: Sockets.Chats.Summarize.Response) => {
			if (token !== activeGenerationToken) return
			cleanup()
			handleComplete(data)
		}
		const onError = (data: Sockets.Chats.Summarize.ErrorResponse) => {
			if (token !== activeGenerationToken) return
			cleanup()
			handleError(data)
		}
		function cleanup() {
			const s = socket as any
			s.off("chats:summarize:progress", onProgress)
			s.off("chats:summarize:complete", onComplete)
			s.off("chats:summarize:error", onError)
			s.off("chats:summarize:trace", onTrace)
			if (activeCleanup === cleanup) activeCleanup = null
		}
		activeCleanup = cleanup
		socket.on("chats:summarize:progress", onProgress)
		socket.on("chats:summarize:complete", onComplete)
		socket.on("chats:summarize:error", onError)
		socket.on("chats:summarize:trace", onTrace)

		step = "generating"
		summarizePhase = "drafting"
		currentBatch = 0
		totalBatches = 1
		partialSummary = {}
		resolvedBindingId = null
		pendingNewParticipants = []
		pendingNewMentioned = []
		trace = []
		showTrace = false
		expandedTraceIdx = null
		errorMessage = ""

		const [bindingType, bindingIdStr] = selectedBinding.split(":")
		socket.emit("chats:summarize", {
			chatId,
			messageIds: selectedMessageIds,
			loreType,
			// Scene runs returned early above, so only world/character reach
			// here — the old `loreType === "scene" ? undefined : …` guard is
			// now dead and TypeScript rejects it.
			topic: topic.trim() || undefined,
			lorebookBindingCharacterId:
				bindingType === "character" ? Number(bindingIdStr) : undefined,
			lorebookBindingPersonaId:
				bindingType === "persona" ? Number(bindingIdStr) : undefined
		} satisfies Sockets.Chats.Summarize.Params)
	}

	async function saveEntry() {
		if (!canSave || !lorebookId || isSaving) return
		isSaving = true

		if (loreType === "scene") {
			try {
				const participantIds = [...extractedParticipantCharacters]
				const mentionedIds = [...extractedMentionedCharacters]
				for (const p of pendingNewParticipants) {
					const { id } = await resolveOrCreateBindingByName(
						typedSocket,
						lorebookId,
						p.name
					)
					participantIds.push(id)
				}
				for (const m of pendingNewMentioned) {
					const { id } = await resolveOrCreateBindingByName(
						typedSocket,
						lorebookId,
						m.name
					)
					mentionedIds.push(id)
				}

				socket.emit("scenes:create", {
					scene: {
						lorebookId,
						chatId,
						historyEntryId: selectedHistoryEntryId
							? Number(selectedHistoryEntryId)
							: null,
						name: reviewName.trim() || null,
						summary: reviewContent.trim(),
						selectedMessageIds,
						participantCharacters: [...new Set(participantIds)],
						mentionedCharacters: [...new Set(mentionedIds)]
					}
				})
			} catch (err) {
				toaster.error({
					title: "Failed to save new character",
					description: err instanceof Error ? err.message : undefined
				})
				isSaving = false
				return
			}
		} else if (loreType === "world") {
			socket.emit("worldLoreEntries:create", {
				worldLoreEntry: {
					lorebookId,
					name: reviewName.trim(),
					content: reviewContent.trim(),
					keys: "",
					enabled: true,
					constant: false,
					useRegex: false,
					caseSensitive: false,
					priority: 1
				}
			})
		} else if (loreType === "character") {
			socket.emit("characterLoreEntries:create", {
				characterLoreEntry: {
					lorebookId,
					name: reviewName.trim(),
					content: reviewContent.trim(),
					lorebookBindingId: resolvedBindingId ?? null,
					keys: "",
					enabled: true,
					constant: false,
					useRegex: false,
					caseSensitive: false,
					priority: 1
				}
			})
		}

		const titles = {
			world: "World lore entry saved",
			character: "Character lore entry saved",
			scene: "Scene saved"
		}
		toaster.success({ title: titles[loreType] })
		isSaving = false
		// Only now is the generated text safe to let go of. The create emits
		// above are fire-and-forget, so dismissing the activity before this
		// point would make a failed save terminal — the summary lives nowhere
		// else until the row exists.
		if (activeActivityId) {
			socket.emit("activity:dismiss", { id: activeActivityId })
			activeActivityId = null
		}
		onSaved()
		onOpenChange({ open: false })
	}

	function addParticipant() {
		if (newParticipantId === "") return
		const id = Number(newParticipantId)
		if (!extractedParticipantCharacters.includes(id)) {
			extractedParticipantCharacters = [
				...extractedParticipantCharacters,
				id
			]
		}
		newParticipantId = ""
	}

	function addMentioned() {
		if (newMentionedId === "") return
		const id = Number(newMentionedId)
		if (!extractedMentionedCharacters.includes(id)) {
			extractedMentionedCharacters = [
				...extractedMentionedCharacters,
				id
			]
		}
		newMentionedId = ""
	}

	function pendingNameTaken(name: string, list: PendingNewCharacter[]) {
		return list.some((p) => p.name.toLowerCase() === name.toLowerCase())
	}

	function addManualParticipant() {
		const name = newParticipantName.trim()
		if (!name || pendingNameTaken(name, pendingNewParticipants)) return
		pendingNewParticipants = [
			...pendingNewParticipants,
			{ name, source: "manual" }
		]
		newParticipantName = ""
	}

	function addManualMentioned() {
		const name = newMentionedName.trim()
		if (!name || pendingNameTaken(name, pendingNewMentioned)) return
		pendingNewMentioned = [...pendingNewMentioned, { name, source: "manual" }]
		newMentionedName = ""
	}
</script>

{#snippet confirmBlock()}
	<div class="space-y-5">
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
							No lorebook is attached to this chat. Attach one to
							continue.
						</span>
					</div>
					{#if !isCreatingLorebook}
						<div class="flex flex-wrap gap-2">
							<select
								class="select flex-1 text-sm"
								bind:value={attachingLorebookId}
							>
								<option value="">
									Select existing lorebook…
								</option>
								{#each availableLorebooks as lb}
									<option value={lb.id}>{lb.name}</option>
								{/each}
							</select>
							<button
								class="btn btn-sm preset-filled-primary-500"
								disabled={!attachingLorebookId}
								onclick={confirmAttachExisting}
							>
								Attach
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
								Create & Attach
							</button>
							<button
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
					<span class="text-sm">World Lore</span>
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
					<span class="text-sm">Character Lore</span>
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
				<label
					class="label text-sm font-semibold"
					for="summarize-history-entry"
				>
					History entry <span class="text-error-500">*</span>
				</label>
				{#if historyEntryList.length > 0 || selectedHistoryEntryId}
					<div class="flex gap-2">
						<select
							id="summarize-history-entry"
							class="select flex-1 text-sm"
							bind:value={selectedHistoryEntryId}
						>
							<option value="">— Select history entry —</option>
							{#each sortedHistoryEntryList as entry}
								<option value={entry.id}>
									{#if entry.year}Year {entry.year}{entry.month
											? `, Month ${entry.month}`
											: ""}{entry.day
											? `, Day ${entry.day}`
											: ""}{:else}Entry #{entry.id}{/if}
								</option>
							{/each}
						</select>
						<button
							class="btn btn-sm preset-filled-surface-400-600"
							disabled={isCreatingHistoryEntry || !hasLorebook}
							onclick={createBlankHistoryEntry}
							title={!hasLorebook
								? "Attach a lorebook first"
								: "Create a new blank history entry"}
						>
							{#if isCreatingHistoryEntry}
								<Icons.Loader size={14} class="animate-spin" />
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
								? "Attach a lorebook first"
								: undefined}
						>
							{#if isCreatingHistoryEntry}
								<Icons.Loader size={14} class="animate-spin" />
							{:else}
								<Icons.Plus size={14} />
							{/if}
							Create New Entry
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
						<p class="text-surface-400 text-xs italic">
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
						<span class="text-surface-400 font-normal">
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
				<label
					class="label text-sm font-semibold"
					for="summarize-binding"
				>
					Bind to character / persona
					<span class="text-surface-400 font-normal">(optional)</span>
				</label>
				<select
					id="summarize-binding"
					class="select text-sm"
					bind:value={selectedBinding}
				>
					<option value="">— None (unbound) —</option>
					{#if bindableEntities.filter((e) => e.type === "character").length > 0}
						<optgroup label="Characters">
							{#each bindableEntities.filter((e) => e.type === "character") as e}
								<option value="character:{e.id}">
									{e.name}
								</option>
							{/each}
						</optgroup>
					{/if}
					{#if bindableEntities.filter((e) => e.type === "persona").length > 0}
						<optgroup label="Personas">
							{#each bindableEntities.filter((e) => e.type === "persona") as e}
								<option value="persona:{e.id}">{e.name}</option>
							{/each}
						</optgroup>
					{/if}
				</select>
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
	{#if partialSummary.content || partialSummary.raw}
		<div class="space-y-1">
			<p
				class="text-surface-700-300 text-xs font-semibold tracking-wide uppercase"
			>
				{summarizePhase === "synthesizing"
					? "Final entry"
					: `Draft ${currentBatch}`}
			</p>
			<div class="bg-surface-200-800 rounded-lg p-3 text-sm">
				{#if partialSummary.content}
					<p
						class="text-surface-700-300 line-clamp-6 whitespace-pre-wrap"
					>
						{partialSummary.content}
					</p>
				{:else if partialSummary.raw}
					<p
						class="text-surface-700-300 line-clamp-6 text-xs whitespace-pre-wrap italic"
					>
						{partialSummary.raw}
					</p>
				{/if}
			</div>
		</div>
	{:else if summarizePhase === "synthesizing"}
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
			Waiting for first draft…
		</div>
	{/if}
{/snippet}

{#snippet reviewBlock()}
	<div class="space-y-4">
		{#if loreType === "world" || loreType === "character" || loreType === "scene"}
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
		{/if}

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

		{#if loreType === "scene"}
			<div class="border-surface-300-700 space-y-3 rounded-lg border p-3">
				<p
					class="text-surface-700-300 text-xs font-semibold tracking-wide uppercase"
				>
					Extracted characters
				</p>

				<div class="space-y-1.5">
					<p class="text-sm font-semibold">
						Participants <span
							class="text-surface-700-300 text-xs font-normal"
						>
							(physically present)
						</span>
					</p>
					<div class="flex flex-wrap gap-1.5">
						{#each extractedParticipantCharacters as id, i}
							<span
								class="chip preset-tonal-primary flex items-center gap-1 text-xs"
							>
								{bindingNameById.get(id) ?? `#${id}`}
								<button
									class="hover:text-error-500 p-1.5"
									aria-label="Remove participant {bindingNameById.get(
										id
									) ?? id}"
									onclick={() =>
										(extractedParticipantCharacters =
											extractedParticipantCharacters.filter(
												(_, j) => j !== i
											))}
								>
									<Icons.X size={10} />
								</button>
							</span>
						{/each}
						<div class="flex gap-1">
							<select
								class="select select-sm w-32 text-xs"
								bind:value={newParticipantId}
							>
								<option value="">Add character…</option>
								{#each lorebookBindings.filter((b) => !extractedParticipantCharacters.includes(b.id)) as b}
									<option value={b.id}
										>{b.name || b.binding}</option
									>
								{/each}
							</select>
							<button
								class="btn btn-sm preset-filled-surface-400-600"
								onclick={addParticipant}
								disabled={newParticipantId === ""}
							>
								<Icons.Plus size={12} />
							</button>
						</div>
					</div>
					{#if extractedParticipantCharacters.length === 0}
						<p class="text-surface-400 text-xs italic">
							None extracted.
						</p>
					{/if}
					{#if pendingNewParticipants.length > 0}
						<div class="flex flex-wrap gap-1.5">
							{#each pendingNewParticipants as p, i}
								<span
									class="chip preset-tonal-warning flex items-center gap-1 border border-dashed text-xs"
								>
									{p.name}
									<span class="text-[10px] opacity-70">(new)</span
									>
									<button
										class="hover:text-error-500 p-1.5"
										aria-label="Remove suggested character {p.name}"
										onclick={() =>
											(pendingNewParticipants =
												pendingNewParticipants.filter(
													(_, j) => j !== i
												))}
									>
										<Icons.X size={10} />
									</button>
								</span>
							{/each}
						</div>
					{/if}
					<div class="flex gap-1">
						<input
							class="input input-sm w-32 text-xs"
							type="text"
							placeholder="Add new character…"
							bind:value={newParticipantName}
							onkeydown={(e) => {
								if (e.key === "Enter") {
									e.preventDefault()
									addManualParticipant()
								}
							}}
						/>
						<button
							class="btn btn-sm preset-filled-surface-400-600"
							onclick={addManualParticipant}
							disabled={!newParticipantName.trim()}
						>
							<Icons.Plus size={12} />
						</button>
					</div>
				</div>

				<div class="space-y-1.5">
					<p class="text-sm font-semibold">
						Mentioned <span
							class="text-surface-700-300 text-xs font-normal"
						>
							(referenced but absent)
						</span>
					</p>
					<div class="flex flex-wrap gap-1.5">
						{#each extractedMentionedCharacters as id, i}
							<span
								class="chip preset-tonal-surface flex items-center gap-1 text-xs"
							>
								{bindingNameById.get(id) ?? `#${id}`}
								<button
									class="hover:text-error-500 p-1.5"
									aria-label="Remove mention {bindingNameById.get(
										id
									) ?? id}"
									onclick={() =>
										(extractedMentionedCharacters =
											extractedMentionedCharacters.filter(
												(_, j) => j !== i
											))}
								>
									<Icons.X size={10} />
								</button>
							</span>
						{/each}
						<div class="flex gap-1">
							<select
								class="select select-sm w-32 text-xs"
								bind:value={newMentionedId}
							>
								<option value="">Add character…</option>
								{#each lorebookBindings.filter((b) => !extractedMentionedCharacters.includes(b.id)) as b}
									<option value={b.id}
										>{b.name || b.binding}</option
									>
								{/each}
							</select>
							<button
								class="btn btn-sm preset-filled-surface-400-600"
								onclick={addMentioned}
								disabled={newMentionedId === ""}
							>
								<Icons.Plus size={12} />
							</button>
						</div>
					</div>
					{#if extractedMentionedCharacters.length === 0}
						<p class="text-surface-400 text-xs italic">
							None extracted.
						</p>
					{/if}
					{#if pendingNewMentioned.length > 0}
						<div class="flex flex-wrap gap-1.5">
							{#each pendingNewMentioned as p, i}
								<span
									class="chip preset-tonal-warning flex items-center gap-1 border border-dashed text-xs"
								>
									{p.name}
									<span class="text-[10px] opacity-70">(new)</span
									>
									<button
										class="hover:text-error-500 p-1.5"
										aria-label="Remove suggested character {p.name}"
										onclick={() =>
											(pendingNewMentioned =
												pendingNewMentioned.filter(
													(_, j) => j !== i
												))}
									>
										<Icons.X size={10} />
									</button>
								</span>
							{/each}
						</div>
					{/if}
					<div class="flex gap-1">
						<input
							class="input input-sm w-32 text-xs"
							type="text"
							placeholder="Add new character…"
							bind:value={newMentionedName}
							onkeydown={(e) => {
								if (e.key === "Enter") {
									e.preventDefault()
									addManualMentioned()
								}
							}}
						/>
						<button
							class="btn btn-sm preset-filled-surface-400-600"
							onclick={addManualMentioned}
							disabled={!newMentionedName.trim()}
						>
							<Icons.Plus size={12} />
						</button>
					</div>
				</div>
			</div>
		{/if}

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

{#snippet debugBlock()}
	{#if trace.length > 0}
		<button
			class="text-surface-700-300 hover:text-surface-700-300 flex w-full items-center justify-between text-xs"
			onclick={() => (showTrace = !showTrace)}
		>
			<span>Debug ({trace.length} calls)</span>
			<Icons.ChevronDown
				size={14}
				class="transition-transform {showTrace ? 'rotate-180' : ''}"
			/>
		</button>
		{#if showTrace}
			<div class="mt-3 max-h-[40vh] space-y-2 overflow-y-auto pr-1">
				{#each trace as entry, i}
					<div
						class="bg-surface-100-900 border-surface-300-700 overflow-hidden rounded-lg border text-xs"
					>
						<button
							class="hover:bg-surface-200-800 flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors"
							onclick={() =>
								(expandedTraceIdx =
									expandedTraceIdx === i ? null : i)}
						>
							<Icons.ChevronRight
								size={12}
								class="text-surface-400 shrink-0 transition-transform {expandedTraceIdx ===
								i
									? 'rotate-90'
									: ''}"
							/>
							<span
								class="text-primary-400 shrink-0 font-mono font-medium"
							>
								{i + 1}.
							</span>
							<span class="truncate font-medium">
								{entry.label}
							</span>
						</button>
						{#if expandedTraceIdx === i}
							<div
								class="divide-surface-300-700 border-surface-300-700 divide-y border-t"
							>
								<div class="space-y-1 p-3">
									<p
										class="text-primary-500 text-[10px] font-bold tracking-widest uppercase"
									>
										System
									</p>
									<pre
										class="bg-surface-200-800 max-h-48 overflow-y-auto rounded p-2.5 leading-relaxed whitespace-pre-wrap">{entry.system}</pre>
								</div>
								<div class="space-y-1 p-3">
									<p
										class="text-warning-500 text-[10px] font-bold tracking-widest uppercase"
									>
										User
									</p>
									<pre
										class="bg-surface-200-800 max-h-48 overflow-y-auto rounded p-2.5 leading-relaxed whitespace-pre-wrap">{entry.user}</pre>
								</div>
								<div class="space-y-1 p-3">
									<p
										class="text-success-500 text-[10px] font-bold tracking-widest uppercase"
									>
										Response
									</p>
									<pre
										class="bg-surface-200-800 max-h-48 overflow-y-auto rounded p-2.5 leading-relaxed whitespace-pre-wrap">{entry.response}</pre>
								</div>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	{/if}
{/snippet}

<AiTaskModal
	{open}
	{onOpenChange}
	title="Summarize to Lorebook"
	runningTitle="Generating Summary…"
	reviewTitle="Review & Save"
	badge={badgeLabel}
	step={aiStep}
	{progressPercent}
	{progressLabel}
	canStart={canGenerate}
	startLabel="Generate Summary"
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
			socket.emit("activity:cancel", { id: activeActivityId })
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
	onViewLastResult={() => (step = "review")}
	confirm={confirmBlock}
	preview={previewBlock}
	review={reviewBlock}
	debug={debugBlock}
/>
