<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import PanelNavHeader from "$lib/client/components/panels/PanelNavHeader.svelte"
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { getContext, onDestroy, onMount, tick } from "svelte"
	import EmbeddingStatusIcon from "$lib/client/components/EmbeddingStatusIcon.svelte"
	import LoreContentField from "./LoreContentField.svelte"
	import { v4 as uuid } from "uuid"
	import DeleteLorebookEntryConfirmModal from "../modals/DeleteLorebookEntryConfirmModal.svelte"
	import CompileHistoryEntryModal from "../modals/CompileHistoryEntryModal.svelte"
	import ProcessSceneModal from "../modals/ProcessSceneModal.svelte"

	interface Props {
		lorebookId: number
		hasUnsavedChanges: boolean
		/** Navigate directly to this history entry on mount / when changed */
		focusHistoryEntryId?: number
		/** Which tab to open when focusing an entry externally */
		focusEntryTab?: "content" | "scenes"
		/** Expand this scene ID within the scenes tab when focusing externally */
		focusSceneId?: number
		/** Called when the user wants to switch to the Graph tab */
		onNavigateToGraph?: () => void
	}

	const socket = useTypedSocket()

	let {
		lorebookId = $bindable(),
		hasUnsavedChanges = $bindable(false),
		focusHistoryEntryId,
		focusEntryTab,
		focusSceneId,
		onNavigateToGraph
	}: Props = $props()

	let systemSettingsCtx: SystemSettingsCtx = $state(
		getContext("systemSettingsCtx")
	)
	let sceneSummarizesCtx: SceneSummarizesCtx = $state(
		getContext("sceneSummarizesCtx")
	)
	let compileEntriesCtx: CompileEntriesCtx = $state(
		getContext("compileEntriesCtx")
	)
	let vectorizationEnabled = $derived(
		systemSettingsCtx.settings?.vectorizationEnabled ?? false
	)

	const SORT_OPTIONS = [
		{ value: "entry-date-desc", label: "Entry Date ↑" },
		{ value: "entry-date-asc", label: "Entry Date ↓" },
		{ value: "created-desc", label: "Date Created ↑" },
		{ value: "created-asc", label: "Date Created ↓" },
		{ value: "updated-desc", label: "Date Updated ↑" },
		{ value: "updated-asc", label: "Date Updated ↓" }
	]

	const DefaultHistoryEntry: InsertHistoryEntry = {
		year: 1,
		month: null,
		day: null,
		content: "",
		keys: "",
		useRegex: false,
		caseSensitive: false,
		constant: false,
		enabled: true,
		isCompleted: false,
		lorebookId
	}

	// ── Core list state ───────────────────────────────────────────
	let historyEntryList: SelectHistoryEntry[] = $state([])
	type BindingWithRelations = SelectLorebookBinding & {
		character?: { nickname?: string | null; name: string } | null
		persona?: { name: string } | null
	}
	let lorebookBindingList: BindingWithRelations[] = $state([])
	let bindingNameById = $derived.by(() => {
		const map = new Map<number, string>()
		for (const b of lorebookBindingList) map.set(b.id, b.name || b.binding)
		return map
	})
	let isReady = $state(false)
	let orderBy = $state("entry-date-desc")
	let search = $state("")

	// ── Panel mode: list → view → edit ────────────────────────────
	type PanelMode = "list" | "view" | "edit"
	let panelMode = $state<PanelMode>("list")
	let focusedEntry = $state<SelectHistoryEntry | null>(null)
	let focusedEntryTab = $state<"content" | "scenes">("content")
	/** Mutable copy being edited (includes new entries with _uuid) */
	let editingEntry = $state<(InsertHistoryEntry & { _uuid?: string }) | null>(
		null
	)
	let isNewEntry = $state(false)

	// ── Card `...` menus ─────────────────────────────────────────
	let openMenuEntryId = $state<number | null>(null)
	let openMenuSceneId = $state<number | null>(null)

	// ── Delete state ──────────────────────────────────────────────
	let deleteEntryId = $state<number | null>(null)
	let showDeleteConfirmModal = $state(false)

	// ── Scenes state ──────────────────────────────────────────────
	let sceneList = $state<Sockets.Scenes.SceneWithMeta[]>([])

	// Derive per-scene activity state from global context (persists across sidebar close/reopen)
	let sceneActivityBySceneId = $derived.by(() => {
		const map = new Map<
			number,
			(typeof sceneSummarizesCtx.activities)[number]
		>()
		for (const a of sceneSummarizesCtx?.activities ?? []) {
			map.set(a.sceneId, a)
		}
		return map
	})

	// Derive per-entry compile activity state from global context
	let compileActivityByEntryId = $derived.by(() => {
		const map = new Map<
			number,
			(typeof compileEntriesCtx.activities)[number]
		>()
		for (const a of compileEntriesCtx?.activities ?? []) {
			if (a.historyEntryId != null) map.set(a.historyEntryId, a)
		}
		return map
	})
	// Full scene edit form
	let editingSceneId = $state<number | null>(null)
	let editingSceneName = $state("")
	let editingSceneSummary = $state("")
	let editingSceneParticipants = $state<number[]>([])
	let editingSceneMentioned = $state<number[]>([])
	let newParticipantId = $state<number | "">("")
	let newMentionedId = $state<number | "">("")
	let showCompileModal = $state(false)
	let compileTargetEntry = $state<SelectHistoryEntry | null>(null)
	let compileActivityId = $state<string | null>(null)
	let compilePendingResult = $state<{ content: string } | null>(null)
	let compileInitialStep = $state<"review" | "running" | undefined>(undefined)
	/** Which scene is drilled into in the view-mode scenes tab */
	let focusedSceneId = $state<number | null>(null)

	// ── Process scene modal ───────────────────────────────────────
	let showProcessModal = $state(false)
	let processModalSceneId = $state<number | null>(null)
	let processModalActivityId = $state<string | null>(null)
	let processModalPendingResult = $state<
		SceneSummarizeState["pendingResult"] | null
	>(null)

	function openProcessModal(activity: SceneSummarizeState) {
		processModalSceneId = activity.sceneId
		processModalActivityId = activity.activityId
		processModalPendingResult = activity.pendingResult ?? null
		showProcessModal = true
	}

	let scenesByEntryId = $derived.by(() => {
		const map = new Map<number, Sockets.Scenes.SceneWithMeta[]>()
		for (const scene of sceneList) {
			const key = scene.historyEntryId
			if (!map.has(key)) map.set(key, [])
			map.get(key)!.push(scene)
		}
		return map
	})

	// ── Unsaved changes ───────────────────────────────────────────
	$effect(() => {
		if (panelMode !== "edit" || !editingEntry) {
			hasUnsavedChanges = false
			return
		}
		if (isNewEntry) {
			hasUnsavedChanges = !!(editingEntry as any).content?.trim()
			return
		}
		const original = historyEntryList.find(
			(e) => e.id === (editingEntry as any).id
		)
		hasUnsavedChanges = original
			? JSON.stringify(original) !== JSON.stringify(editingEntry)
			: false
	})

	// ── External focus (from session scene/history-entry clicks) ────────
	let _lastFocusedEntryId = $state<number | undefined>(undefined)
	$effect(() => {
		const targetId = focusHistoryEntryId
		if (
			!targetId ||
			targetId === _lastFocusedEntryId ||
			!historyEntryList.length
		)
			return
		const entry = historyEntryList.find((e) => e.id === targetId)
		if (!entry) return
		_lastFocusedEntryId = targetId
		viewEntry(entry)
		if (focusEntryTab) focusedEntryTab = focusEntryTab
	})

	// Open modal when activity sidebar triggers review or opens a running scene
	$effect(() => {
		const id = sceneSummarizesCtx?.reviewSceneId
		if (!id) return
		const mySceneIds = new Set(sceneList.map((s) => s.id))
		if (!mySceneIds.has(id)) return
		const activity = sceneSummarizesCtx.activities.find(
			(a) =>
				a.sceneId === id &&
				(a.status === "review" || a.status === "running")
		)
		if (!activity) return
		sceneSummarizesCtx.setReviewSceneId(null)
		openProcessModal(activity)
	})

	// ── List helpers ──────────────────────────────────────────────
	function getEntryDateValue(entry: SelectHistoryEntry) {
		return entry.year * 10000 + (entry.month || 0) * 100 + (entry.day || 0)
	}

	function getSortedEntries() {
		return historyEntryList.slice().sort((a, b) => {
			const getCreated = (e: SelectHistoryEntry) =>
				new Date(e.createdAt || 0).getTime()
			const getUpdated = (e: SelectHistoryEntry) =>
				new Date(e.updatedAt || 0).getTime()
			switch (orderBy) {
				case "entry-date-desc":
					return getEntryDateValue(b) - getEntryDateValue(a)
				case "entry-date-asc":
					return getEntryDateValue(a) - getEntryDateValue(b)
				case "created-desc":
					return getCreated(b) - getCreated(a)
				case "created-asc":
					return getCreated(a) - getCreated(b)
				case "updated-desc":
					return getUpdated(b) - getUpdated(a)
				case "updated-asc":
					return getUpdated(a) - getUpdated(b)
				default:
					return 0
			}
		})
	}

	function getFilteredEntries() {
		const lower = search.trim().toLowerCase()
		if (!lower) return getSortedEntries()
		return getSortedEntries().filter((entry) => {
			const content = (entry.content || "").toLowerCase()
			return (
				content.includes(lower) ||
				(entry.keys || "").toLowerCase().includes(lower)
			)
		})
	}

	let filteredEntries: SelectHistoryEntry[] = $derived.by(() =>
		getFilteredEntries()
	)

	let maxDateValue = $derived.by(() => {
		if (filteredEntries.length === 0) return 0
		return Math.max(...filteredEntries.map((e) => getEntryDateValue(e)))
	})

	// ── Date-order bounds ─────────────────────────────────────────
	/** Encoded date: year×10000 + month×100 + day. Used for ordering. */
	function dateValue(
		year: number,
		month?: number | null,
		day?: number | null
	) {
		return year * 10000 + (month || 0) * 100 + (day || 0)
	}

	/** Human-readable date from an encoded value. */
	function formatDateValue(value: number): string {
		const y = Math.floor(value / 10000)
		const m = Math.floor((value % 10000) / 100)
		const d = value % 100
		return `Year ${y}${m ? `, Mo. ${m}` : ""}${d ? `, Day ${d}` : ""}`
	}

	/**
	 * When editing an existing entry, returns the exclusive (min, max) date values
	 * it must remain between to preserve chronological order.
	 * Returns (-Infinity, Infinity) for new entries or the only entry.
	 */
	let editBounds = $derived.by((): { min: number; max: number } => {
		if (isNewEntry || !focusedEntry || historyEntryList.length < 2) {
			return { min: -Infinity, max: Infinity }
		}
		const sorted = [...historyEntryList].sort(
			(a, b) => getEntryDateValue(a) - getEntryDateValue(b)
		)
		const idx = sorted.findIndex((e) => e.id === focusedEntry!.id)
		if (idx === -1) return { min: -Infinity, max: Infinity }
		const prev = idx > 0 ? sorted[idx - 1] : null
		const next = idx < sorted.length - 1 ? sorted[idx + 1] : null
		return {
			min: prev ? getEntryDateValue(prev) : -Infinity,
			max: next ? getEntryDateValue(next) : Infinity
		}
	})

	function previewContent(entry: SelectHistoryEntry): string {
		let content = entry.content || ""
		lorebookBindingList.forEach((binding) => {
			if (binding.characterId) {
				content = content.replaceAll(
					binding.binding,
					binding.character!.nickname ||
						binding.character!.name ||
						binding.binding
				)
			} else if (binding.personaId) {
				content = content.replaceAll(
					binding.binding,
					binding.persona!.name || binding.binding
				)
			}
		})
		return content
	}

	function entryIsValid(
		entry: InsertHistoryEntry | SelectHistoryEntry,
		warn = false
	): boolean {
		if (!entry.year) {
			if (warn) toaster.error({ title: "Year is required" })
			return false
		}
		if (!!entry.day && !entry.month) {
			if (warn)
				toaster.error({ title: "Month is required if day is set" })
			return false
		}
		if (!isNewEntry && focusedEntry) {
			const v = dateValue(entry.year, entry.month, entry.day)
			if (editBounds.min !== -Infinity && v <= editBounds.min) {
				if (warn)
					toaster.error({
						title: "Date would be out of order",
						description: `Must be after ${formatDateValue(editBounds.min)}`
					})
				return false
			}
			if (editBounds.max !== Infinity && v >= editBounds.max) {
				if (warn)
					toaster.error({
						title: "Date would be out of order",
						description: `Must be before ${formatDateValue(editBounds.max)}`
					})
				return false
			}
		}
		return true
	}

	// ── Navigation ────────────────────────────────────────────────
	function goBack() {
		if (panelMode === "edit" && !isNewEntry && focusedEntry) {
			editingEntry = null
			isNewEntry = false
			editingSceneId = null
			panelMode = "view"
		} else {
			panelMode = "list"
			focusedEntry = null
			focusedEntryTab = "content"
			editingEntry = null
			editingSceneId = null
			focusedSceneId = null
			isNewEntry = false
		}
	}

	function viewEntry(entry: SelectHistoryEntry) {
		focusedEntry = entry
		focusedEntryTab = "content"
		focusedSceneId = null
		editingSceneId = null
		panelMode = "view"
	}

	function editEntry(entry: SelectHistoryEntry) {
		focusedEntry = entry
		editingEntry = { ...entry }
		focusedEntryTab = "content"
		panelMode = "edit"
	}

	function createEntry() {
		focusedEntry = null
		editingEntry = { ...DefaultHistoryEntry, _uuid: uuid() }
		isNewEntry = true
		focusedEntryTab = "content"
		panelMode = "edit"
	}

	// ── Save / Delete ─────────────────────────────────────────────
	function handleSave() {
		if (!editingEntry || !entryIsValid(editingEntry, true)) return

		const data = {
			...editingEntry,
			lorebookId,
			month: editingEntry.month === 0 ? null : editingEntry.month,
			day: editingEntry.day === 0 ? null : editingEntry.day,
			_uuid: undefined
		}

		if (isNewEntry) {
			socket.emit("historyEntries:create", {
				historyEntry: data as InsertHistoryEntry
			})
		} else {
			socket.emit("historyEntries:update", {
				historyEntry: data as UpdateHistoryEntry
			})
		}
		goBack()
	}

	function onDeleteClick(id: number) {
		deleteEntryId = id
		showDeleteConfirmModal = true
	}

	function onDeleteConfirm() {
		showDeleteConfirmModal = false
		if (deleteEntryId !== null) {
			socket.emit("historyEntries:delete", { id: deleteEntryId })
			if (focusedEntry?.id === deleteEntryId) goBack()
		}
		deleteEntryId = null
	}

	function onDeleteCancel() {
		showDeleteConfirmModal = false
		deleteEntryId = null
	}

	function onClickIterateNextEntry() {
		if (filteredEntries.length === 0) {
			toaster.error({
				title: "No entries found",
				description: "Create at least one entry before using Next Date."
			})
			return
		}
		const latestEntry = filteredEntries.reduce(
			(max, entry) =>
				getEntryDateValue(entry) > getEntryDateValue(max) ? entry : max,
			filteredEntries[0]
		)
		socket.emit("historyEntries:iterateNext", {
			id: latestEntry.id
		} satisfies Sockets.HistoryEntries.IterateNext.Params)
	}

	// ── Scene actions ─────────────────────────────────────────────
	function fetchScenes() {
		socket.emit("scenes:listByLorebook", {
			lorebookId
		} satisfies Sockets.Scenes.ListByLorebook.Params)
	}

	function deleteScene(sceneId: number) {
		socket.emit("scenes:delete", {
			id: sceneId
		} satisfies Sockets.Scenes.Delete.Params)
		if (editingSceneId === sceneId) editingSceneId = null
	}

	function startEditScene(scene: Sockets.Scenes.SceneWithMeta) {
		editingSceneId = scene.id
		editingSceneName = scene.name ?? ""
		editingSceneSummary = scene.summary ?? ""
		editingSceneParticipants = [...(scene.participantCharacters ?? [])]
		editingSceneMentioned = [...(scene.mentionedCharacters ?? [])]
		newParticipantId = ""
		newMentionedId = ""
	}

	function saveEditScene() {
		if (editingSceneId === null) return
		socket.emit("scenes:update", {
			scene: {
				id: editingSceneId,
				name: editingSceneName.trim() || null,
				summary: editingSceneSummary.trim() || null,
				participantCharacters: editingSceneParticipants,
				mentionedCharacters: editingSceneMentioned
			}
		} satisfies Sockets.Scenes.Update.Params)
		editingSceneId = null
	}

	function addParticipant() {
		if (newParticipantId === "") return
		const id = Number(newParticipantId)
		if (!editingSceneParticipants.includes(id)) {
			editingSceneParticipants = [...editingSceneParticipants, id]
		}
		newParticipantId = ""
	}

	function addMentioned() {
		if (newMentionedId === "") return
		const id = Number(newMentionedId)
		if (!editingSceneMentioned.includes(id)) {
			editingSceneMentioned = [...editingSceneMentioned, id]
		}
		newMentionedId = ""
	}

	function processScene(sceneId: number) {
		processModalSceneId = sceneId
		processModalActivityId = null
		processModalPendingResult = null
		showProcessModal = true
		socket.emit("scenes:process", {
			sceneId
		} satisfies Sockets.Scenes.Process.Params)
	}

	function cancelEditScene() {
		editingSceneId = null
	}

	function openCompileModal(
		entry: SelectHistoryEntry,
		opts?: {
			activityId?: string | null
			pendingResult?: { content: string } | null
			initialStep?: "review" | "running"
		}
	) {
		compileTargetEntry = entry
		compileActivityId = opts?.activityId ?? null
		compilePendingResult = opts?.pendingResult ?? null
		compileInitialStep = opts?.initialStep
		showCompileModal = true
	}

	function handleCompileDiscarded(_activityId: string) {
		compileEntriesCtx?.dismiss(_activityId)
	}

	// Starts a fresh compile, or reopens a pending/running one exactly
	// where it left off — used by the list card's "..." menu, its status
	// badges, and the activity-sidebar reopen effect below.
	function openOrReopenCompile(entry: SelectHistoryEntry) {
		const activity = compileActivityByEntryId.get(entry.id)
		if (activity) {
			openCompileModal(entry, {
				activityId: activity.activityId,
				pendingResult: activity.pendingResult ?? null,
				initialStep: activity.status === "review" ? "review" : "running"
			})
		} else {
			openCompileModal(entry)
		}
	}

	// Watch for activity sidebar "Review & Apply" trigger
	$effect(() => {
		const reviewId = compileEntriesCtx?.reviewHistoryEntryId
		if (!reviewId) return
		const entry = historyEntryList.find((e) => e.id === reviewId)
		if (entry && compileActivityByEntryId.has(reviewId)) {
			openOrReopenCompile(entry)
		}
		compileEntriesCtx.setReviewHistoryEntryId(null)
	})

	function handleCompileSaved(updated: SelectHistoryEntry) {
		historyEntryList = historyEntryList.map((e) =>
			e.id === updated.id ? updated : e
		)
		if (focusedEntry?.id === updated.id) focusedEntry = updated
	}

	// ── Socket setup ──────────────────────────────────────────────
	async function handleHistoryEntriesList(
		msg: Sockets.HistoryEntries.List.Response
	) {
		if (msg.lorebookId === lorebookId) {
			historyEntryList = msg.historyEntryList
			// Keep focusedEntry in sync
			if (focusedEntry) {
				const updated = msg.historyEntryList.find(
					(e: SelectHistoryEntry) => e.id === focusedEntry!.id
				)
				if (updated) focusedEntry = updated
			}
		}
		await tick()
	}

	function handleHistoryEntryCreate(
		msg: Sockets.HistoryEntries.Create.Response
	) {
		if (msg.historyEntry?.lorebookId === lorebookId) {
			toaster.success({ title: "History Entry created" })
		}
	}

	function handleHistoryEntryUpdate(
		msg: Sockets.HistoryEntries.Update.Response
	) {
		if (msg.historyEntry?.lorebookId === lorebookId) {
			toaster.success({ title: "History Entry updated" })
		}
	}

	function handleHistoryEntryDelete(
		msg: Sockets.HistoryEntries.Delete.Response
	) {
		if (
			(msg as any).id &&
			historyEntryList.some((e) => e.id === (msg as any).id)
		) {
			toaster.success({ title: "History Entry deleted" })
		}
	}

	async function handleLorebooksBindingList(
		msg: Sockets.Lorebooks.BindingList.Response
	) {
		if (msg.lorebookId === lorebookId) {
			lorebookBindingList = [
				...msg.lorebookBindingList
			] as BindingWithRelations[]
		}
		await tick()
	}

	function handleIterateNext(
		_msg: Sockets.HistoryEntries.IterateNext.Response
	) {
		toaster.success({ title: "The story's date has moved forward" })
	}

	function handleScenesListByLorebook(
		msg: Sockets.Scenes.ListByLorebook.Response
	) {
		sceneList = msg.sceneList
	}

	function handleSceneUpdate(msg: Sockets.Scenes.Update.Response) {
		if (msg.scene) {
			sceneList = sceneList.map((s) =>
				s.id === msg.scene.id ? { ...s, ...msg.scene } : s
			)
		}
	}

	function handleSceneDelete(_msg: Sockets.Scenes.Delete.Response) {
		fetchScenes()
	}

	function handleSceneCreate(_msg: Sockets.Scenes.Create.Response) {
		fetchScenes()
	}

	function handleScenesProcessError(
		msg: Sockets.Scenes.Process.ErrorResponse
	) {
		toaster.error({
			title: "Scene processing failed",
			description: msg.error
		})
	}

	// The background vectorization queue updates a row's embeddingModel
	// directly in the DB — without this, the badge here only ever refreshes
	// on the next explicit CRUD action, leaving it stale until a manual refresh.
	function handleVectorizationItemUpdated(
		msg: Sockets.Vectorization.ItemUpdated.Response
	) {
		if (msg.type !== "historyEntry" || msg.lorebookId !== lorebookId) return
		const target = historyEntryList.find((e: any) => e.id === msg.id)
		if (target) (target as any).embeddingModel = msg.embeddingModel
		if (focusedEntry?.id === msg.id)
			(focusedEntry as any).embeddingModel = msg.embeddingModel
	}

	onMount(() => {
		socket.on("historyEntries:list", handleHistoryEntriesList)
		socket.on("historyEntries:create", handleHistoryEntryCreate)
		socket.on("historyEntries:update", handleHistoryEntryUpdate)
		socket.on("historyEntries:delete", handleHistoryEntryDelete)
		socket.on("lorebooks:bindingList", handleLorebooksBindingList)
		socket.on("historyEntries:iterateNext", handleIterateNext)
		socket.on("scenes:listByLorebook", handleScenesListByLorebook)
		socket.on("scenes:update", handleSceneUpdate)
		socket.on("scenes:delete", handleSceneDelete)
		socket.on("scenes:create", handleSceneCreate)
		socket.on("scenes:process:error", handleScenesProcessError)
		socket.on("vectorization:itemUpdated", handleVectorizationItemUpdated)

		socket.emit("historyEntries:list", {
			lorebookId
		} satisfies Sockets.HistoryEntries.List.Params)
		socket.emit("lorebooks:bindingList", {
			lorebookId
		} satisfies Sockets.Lorebooks.BindingList.Params)
		fetchScenes()
		isReady = true
	})

	onDestroy(() => {
		hasUnsavedChanges = false
		socket.off("historyEntries:list", handleHistoryEntriesList)
		socket.off("historyEntries:create", handleHistoryEntryCreate)
		socket.off("historyEntries:update", handleHistoryEntryUpdate)
		socket.off("historyEntries:delete", handleHistoryEntryDelete)
		socket.off("lorebooks:bindingList", handleLorebooksBindingList)
		socket.off("historyEntries:iterateNext", handleIterateNext)
		socket.off("scenes:listByLorebook", handleScenesListByLorebook)
		socket.off("scenes:update", handleSceneUpdate)
		socket.off("scenes:delete", handleSceneDelete)
		socket.off("scenes:create", handleSceneCreate)
		socket.off("scenes:process:error", handleScenesProcessError)
		socket.off("vectorization:itemUpdated", handleVectorizationItemUpdated)
	})
</script>

<!--
	A scene's cast, as chips.

	Extracted rather than copied a third time. This markup already existed twice
	— in the scene detail drill-down and in edit mode — but NOT in the scene
	list, which is the surface users actually look at; reaching it took two
	clicks with nothing suggesting cast lived there. That matters more than
	tidiness: the cast is what the graph build's relationship extraction runs
	on, so a mis-extracted participant (a place read as a person, a duplicate
	identity) was invisible until after a build had already consumed it.

	Renders nothing when the scene has no cast, so a caller can drop it in
	unconditionally.
-->
{#snippet sceneCastChips(scene: {
	participantCharacters?: number[] | null
	mentionedCharacters?: number[] | null
})}
	{@const present = scene.participantCharacters ?? []}
	{@const mentioned = scene.mentionedCharacters ?? []}
	{#if present.length > 0 || mentioned.length > 0}
		<div class="space-y-1">
			{#if present.length > 0}
				<div class="flex flex-wrap items-center gap-1">
					<span
						class="text-surface-700-300 shrink-0 text-[10px] font-semibold tracking-wide uppercase"
					>
						Present:
					</span>
					{#each present as id}
						<span
							class="chip preset-tonal-primary py-0 text-[10px]"
						>
							{bindingNameById.get(id) ?? `#${id}`}
						</span>
					{/each}
				</div>
			{/if}
			{#if mentioned.length > 0}
				<div class="flex flex-wrap items-center gap-1">
					<span
						class="text-surface-700-300 shrink-0 text-[10px] font-semibold tracking-wide uppercase"
					>
						Mentioned:
					</span>
					{#each mentioned as id}
						<span
							class="chip preset-tonal-surface py-0 text-[10px]"
						>
							{bindingNameById.get(id) ?? `#${id}`}
						</span>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
{/snippet}

{#if isReady}
	<!-- ═══════════════════════════════════════════════════════════════
     LIST MODE
════════════════════════════════════════════════════════════════ -->
	{#if panelMode === "list"}
		<div class="flex flex-col gap-3">
			<!-- Toolbar -->
			<div class="flex flex-col gap-2">
				<input
					class="input input-sm w-full"
					placeholder="Search entries…"
					type="text"
					bind:value={search}
				/>
				<div class="flex gap-2">
					<select class="select compact text-sm" bind:value={orderBy}>
						{#each SORT_OPTIONS as opt}
							<option value={opt.value}>{opt.label}</option>
						{/each}
					</select>
					<button
						class="btn btn-sm preset-filled-primary-500"
						onclick={onClickIterateNextEntry}
						title="Add the next date in sequence"
						aria-label="Add the next date in sequence"
					>
						<Icons.CalendarPlus size={14} />
					</button>
					<button
						class="btn btn-sm preset-filled-success-500"
						onclick={createEntry}
					>
						<Icons.Plus size={14} /> New
					</button>
				</div>
			</div>

			<!-- Entry cards -->
			{#if filteredEntries.length === 0}
				<p class="text-surface-700-300 py-6 text-center text-sm italic">
					No history entries yet.
				</p>
			{:else}
				{#each filteredEntries as entry}
					{@const entryScenes = scenesByEntryId.get(entry.id) ?? []}
					{@const isMaxDate =
						getEntryDateValue(entry) === maxDateValue}
					{@const entryCompileActivity = compileActivityByEntryId.get(
						entry.id
					)}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<div
						role="button"
						tabindex="0"
						class="preset-filled-surface-100-900 hover:bg-surface-200-800 flex cursor-pointer items-start gap-2 rounded-lg p-3 transition-colors"
						class:opacity-50={!entry.enabled}
						onclick={() => viewEntry(entry)}
					>
						<!-- Main info -->
						<div class="min-w-0 flex-1">
							<div
								class="mb-1 flex flex-wrap items-center gap-2 text-sm font-semibold"
							>
								<span>
									Year {entry.year}{entry.month
										? `, Mo. ${entry.month}`
										: ""}{entry.day
										? `, Day ${entry.day}`
										: ""}
								</span>
								{#if isMaxDate}
									<span
										class="text-tertiary-500 text-xs font-normal"
									>
										(Current)
									</span>
								{/if}
							</div>
							{#if entry.content?.trim()}
								<p
									class="text-surface-600-400 line-clamp-2 text-xs leading-relaxed whitespace-pre-wrap"
								>
									{previewContent(entry)}
								</p>
							{:else}
								<p class="text-surface-700-300 text-xs italic">
									No content yet.
								</p>
							{/if}
							<!-- Status / meta badges -->
							<div
								class="mt-1.5 flex flex-wrap items-center gap-1"
							>
								<EmbeddingStatusIcon
									embeddingModel={entry.embeddingModel}
									size={12}
								/>
								{#if !entry.enabled}
									<span
										class="preset-filled-error-500 rounded px-1.5 py-0.5 text-xs"
										title="Disabled"
									>
										<Icons.Ghost size={11} class="inline" />
									</span>
								{/if}
								{#if entry.constant}
									<span
										class="preset-filled-warning-500 rounded px-1.5 py-0.5 text-xs"
										title="Pinned"
									>
										<Icons.Pin size={11} class="inline" />
									</span>
								{/if}
								{#if !vectorizationEnabled && entry.useRegex}
									<span
										class="preset-filled-primary-500 rounded px-1.5 py-0.5 text-xs"
										title="Regex keys"
									>
										<Icons.Regex size={11} class="inline" />
									</span>
								{/if}
								{#if entryScenes.length > 0}
									<span
										class="preset-tonal-secondary rounded px-1.5 py-0.5 text-xs"
									>
										<Icons.Film size={11} class="inline" />
										{entryScenes.length}
									</span>
								{/if}
								{#if entryCompileActivity?.status === "running"}
									<button
										class="preset-filled-tertiary-500 rounded px-1.5 py-0.5 text-xs"
										title="Compiling… — click to view progress"
										onclick={(e) => {
											e.stopPropagation()
											openOrReopenCompile(entry)
										}}
									>
										<Icons.Loader
											size={11}
											class="inline animate-spin"
										/> Compiling…
									</button>
								{:else if entryCompileActivity?.status === "review"}
									<button
										class="preset-filled-warning-500 rounded px-1.5 py-0.5 text-xs"
										title="Review pending — click to review"
										onclick={(e) => {
											e.stopPropagation()
											openOrReopenCompile(entry)
										}}
									>
										<Icons.Eye size={11} class="inline" /> Review
									</button>
								{/if}
							</div>
						</div>

						<!-- ... menu -->
						<div role="none" onclick={(e) => e.stopPropagation()}>
							<Popover
								open={openMenuEntryId === entry.id}
								onOpenChange={(e) =>
									(openMenuEntryId = e.open
										? entry.id
										: null)}
								positioning={{ placement: "bottom-end" }}
							>
								<Popover.Trigger
									class="btn btn-sm preset-filled-surface-400-600 shrink-0 p-1"
									title="More options"
									aria-label="More options for Year {entry.year}"
								>
									<Icons.Ellipsis size={16} />
								</Popover.Trigger>
								<Portal>
									<Popover.Positioner class="z-[1000]!">
										<Popover.Content
											class="card bg-surface-100-900 flex min-w-32 flex-col gap-1 p-2 shadow-xl"
										>
											<button
												class="btn btn-sm preset-filled-surface-400-600 w-full justify-start"
												onclick={(e) => {
													e.stopPropagation()
													openMenuEntryId = null
													viewEntry(entry)
												}}
											>
												<Icons.Eye size={14} /> View
											</button>
											<button
												class="btn btn-sm preset-filled-surface-400-600 w-full justify-start"
												onclick={(e) => {
													e.stopPropagation()
													openMenuEntryId = null
													editEntry(entry)
												}}
											>
												<Icons.Pencil size={14} /> Edit
											</button>
											<button
												class="btn btn-sm preset-filled-surface-400-600 w-full justify-start"
												disabled={entryScenes.length ===
													0}
												title={entryScenes.length === 0
													? "Add scenes first"
													: undefined}
												onclick={(e) => {
													e.stopPropagation()
													openMenuEntryId = null
													openOrReopenCompile(entry)
												}}
											>
												<Icons.Wand size={14} />
												{entryCompileActivity?.status ===
												"review"
													? "Review Compile"
													: entryCompileActivity?.status ===
														  "running"
														? "View Progress"
														: "Compile to Entry"}
											</button>
											<hr
												class="border-surface-300-700"
											/>
											<button
												class="btn btn-sm preset-filled-error-500 w-full justify-start"
												onclick={(e) => {
													e.stopPropagation()
													openMenuEntryId = null
													onDeleteClick(entry.id)
												}}
											>
												<Icons.Trash2 size={14} /> Delete
											</button>
										</Popover.Content>
									</Popover.Positioner>
								</Portal>
							</Popover>
						</div>
					</div>
				{/each}
			{/if}
		</div>

		<!-- ═══════════════════════════════════════════════════════════════
     VIEW MODE
════════════════════════════════════════════════════════════════ -->
	{:else if panelMode === "view" && focusedEntry}
		{@const viewScenes = scenesByEntryId.get(focusedEntry.id) ?? []}
		<div class="flex flex-col gap-4">
			<!-- Header -->
			<PanelNavHeader
				title="Year {focusedEntry.year}{focusedEntry.month
					? `, Mo. ${focusedEntry.month}`
					: ''}{focusedEntry.day ? `, Day ${focusedEntry.day}` : ''}"
				onBack={goBack}
				backLabel="Back"
				headingLevel={3}
				titleClass="text-sm"
			/>

			<!-- Tabs -->
			<div class="border-surface-300-700 flex gap-1 border-b pb-1">
				<button
					class="btn btn-sm {focusedEntryTab === 'content'
						? 'preset-filled-primary-500'
						: 'preset-filled-surface-400-600'}"
					onclick={() => (focusedEntryTab = "content")}
				>
					Content
				</button>
				<button
					class="btn btn-sm {focusedEntryTab === 'scenes'
						? 'preset-filled-primary-500'
						: 'preset-filled-surface-400-600'}"
					onclick={() => (focusedEntryTab = "scenes")}
				>
					<Icons.Film size={13} /> Scenes
					{#if viewScenes.length > 0}
						<span
							class="badge-icon preset-filled-secondary-500 ml-1 h-4 min-w-4 rounded-full text-xs"
						>
							{viewScenes.length}
						</span>
					{/if}
				</button>
			</div>

			<!-- Content tab -->
			{#if focusedEntryTab === "content"}
				<div class="flex flex-col gap-3 text-sm">
					<button
						class="btn btn-sm preset-filled-primary-500 self-start"
						onclick={() => editEntry(focusedEntry!)}
					>
						<Icons.Pencil size={14} /> Edit Entry
					</button>
					{#if focusedEntry.content?.trim()}
						<div class="leading-relaxed whitespace-pre-wrap">
							{previewContent(focusedEntry)}
						</div>
					{:else}
						<p class="text-surface-700-300 italic">
							No content yet.
						</p>
					{/if}
					{#if !vectorizationEnabled && focusedEntry.keys?.trim()}
						<div>
							<p
								class="text-surface-700-300 mb-1 text-xs font-semibold tracking-wide uppercase"
							>
								Keywords
							</p>
							<p class="text-sm">{focusedEntry.keys}</p>
						</div>
					{/if}
					<div class="flex flex-wrap items-center gap-2">
						<EmbeddingStatusIcon
							embeddingModel={focusedEntry.embeddingModel}
							size={14}
						/>
						{#if !focusedEntry.enabled}
							<span
								class="preset-filled-error-500 rounded px-2 py-1 text-xs"
							>
								<Icons.Ghost size={13} class="inline" /> Disabled
							</span>
						{/if}
						{#if focusedEntry.constant}
							<span
								class="preset-filled-warning-500 rounded px-2 py-1 text-xs"
							>
								<Icons.Pin size={13} class="inline" /> Pinned
							</span>
						{/if}
						{#if !vectorizationEnabled && focusedEntry.useRegex}
							<span
								class="preset-filled-primary-500 rounded px-2 py-1 text-xs"
							>
								<Icons.Regex size={13} class="inline" /> Regex
							</span>
						{/if}
					</div>
				</div>

				<!-- Scenes tab (view mode) -->
			{:else}
				<!-- ── Scene edit ── -->
				{#if editingSceneId !== null}
					{@const editingScene = viewScenes.find(
						(s) => s.id === editingSceneId
					)}
					<div class="flex flex-col gap-4">
						<div class="flex items-center gap-2">
							<button
								class="btn btn-sm preset-filled-surface-400-600 p-2"
								onclick={cancelEditScene}
								aria-label="Back"
							>
								<Icons.ChevronLeft size={16} />
							</button>
							<h4 class="flex-1 truncate text-sm font-semibold">
								{editingScene?.name ?? "Scene"}
							</h4>
						</div>
						<div class="flex gap-2">
							<button
								class="btn btn-sm preset-filled-surface-400-600"
								onclick={cancelEditScene}
							>
								Cancel
							</button>
							<button
								class="btn btn-sm preset-filled-success-500"
								onclick={saveEditScene}
							>
								<Icons.Save size={14} /> Update
							</button>
						</div>
						<input
							class="input input-sm w-full text-sm"
							type="text"
							placeholder="Scene name"
							bind:value={editingSceneName}
						/>
						<textarea
							class="textarea min-h-24 text-xs"
							placeholder="Scene summary…"
							bind:value={editingSceneSummary}
						></textarea>
						<div class="space-y-1">
							<p
								class="text-surface-700-300 text-[10px] font-semibold tracking-wide uppercase"
							>
								Participants
							</p>
							<div class="flex flex-wrap gap-1">
								{#each editingSceneParticipants as id, i}
									<span
										class="chip preset-tonal-primary flex items-center gap-0.5 py-0 text-[10px]"
									>
										{bindingNameById.get(id) ?? `#${id}`}
										<button
											class="p-1.5"
											aria-label="Remove participant {bindingNameById.get(
												id
											) ?? id}"
											onclick={() =>
												(editingSceneParticipants =
													editingSceneParticipants.filter(
														(_, j) => j !== i
													))}
										>
											<Icons.X size={9} />
										</button>
									</span>
								{/each}
							</div>
							<div class="flex gap-1">
								<select
									class="select select-sm flex-1 text-xs"
									bind:value={newParticipantId}
								>
									<option value="">Add character…</option>
									{#each lorebookBindingList.filter((b) => !editingSceneParticipants.includes(b.id)) as b}
										<option value={b.id}>
											{b.name || b.binding}
										</option>
									{/each}
								</select>
								<button
									class="btn btn-sm preset-filled-surface-400-600 p-1"
									onclick={addParticipant}
									disabled={newParticipantId === ""}
								>
									<Icons.Plus size={12} />
								</button>
							</div>
						</div>
						<div class="space-y-1">
							<p
								class="text-surface-700-300 text-[10px] font-semibold tracking-wide uppercase"
							>
								Mentioned
							</p>
							<div class="flex flex-wrap gap-1">
								{#each editingSceneMentioned as id, i}
									<span
										class="chip preset-tonal-surface flex items-center gap-0.5 py-0 text-[10px]"
									>
										{bindingNameById.get(id) ?? `#${id}`}
										<button
											class="p-1.5"
											aria-label="Remove mention {bindingNameById.get(
												id
											) ?? id}"
											onclick={() =>
												(editingSceneMentioned =
													editingSceneMentioned.filter(
														(_, j) => j !== i
													))}
										>
											<Icons.X size={9} />
										</button>
									</span>
								{/each}
							</div>
							<div class="flex gap-1">
								<select
									class="select select-sm flex-1 text-xs"
									bind:value={newMentionedId}
								>
									<option value="">Add character…</option>
									{#each lorebookBindingList.filter((b) => !editingSceneMentioned.includes(b.id)) as b}
										<option value={b.id}>
											{b.name || b.binding}
										</option>
									{/each}
								</select>
								<button
									class="btn btn-sm preset-filled-surface-400-600 p-1"
									onclick={addMentioned}
									disabled={newMentionedId === ""}
								>
									<Icons.Plus size={12} />
								</button>
							</div>
						</div>
					</div>

					<!-- ── Scene detail ── -->
				{:else if focusedSceneId !== null}
					{@const scene = viewScenes.find(
						(s) => s.id === focusedSceneId
					)}
					{#if scene}
						{@const sceneActivity = sceneActivityBySceneId.get(
							scene.id
						)}
						{@const isProcessing =
							sceneActivity?.status === "running"}
						{@const pendingActivity =
							sceneActivity?.status === "review"
								? sceneActivity
								: undefined}
						{@const hasMessages =
							(scene.selectedMessageIds?.length ?? 0) > 0}
						{@const hasSummary = !!scene.summary}
						<div class="flex flex-col gap-4">
							<div class="flex items-center gap-2">
								<button
									class="btn btn-sm preset-filled-surface-400-600 p-2"
									onclick={() => (focusedSceneId = null)}
									aria-label="Back"
								>
									<Icons.ChevronLeft size={16} />
								</button>
								<h4
									class="flex-1 truncate text-sm font-semibold"
								>
									{scene.name ?? "Unnamed Scene"}
								</h4>
								{#if scene.graphed}
									<Icons.GitGraph
										size={13}
										class="text-success-500 shrink-0"
									/>
								{/if}
							</div>
							<div class="flex flex-wrap gap-2">
								{#if pendingActivity}
									<button
										class="btn btn-sm preset-filled-warning-500"
										onclick={() =>
											openProcessModal(pendingActivity)}
									>
										<Icons.Eye size={13} /> Review Pending
									</button>
								{:else}
									<button
										class="btn btn-sm preset-filled-primary-500"
										onclick={() => startEditScene(scene)}
									>
										<Icons.Pencil size={14} /> Edit Scene
									</button>
									{#if hasMessages}
										<button
											class="btn btn-sm preset-filled-surface-400-600"
											disabled={isProcessing}
											onclick={() =>
												processScene(scene.id)}
										>
											{#if isProcessing}
												<Icons.Loader
													size={13}
													class="animate-spin"
												/>
											{:else if hasSummary}
												<Icons.RefreshCw size={13} /> Reprocess
											{:else}
												<Icons.Sparkles size={13} /> Process
											{/if}
										</button>
									{/if}
								{/if}
							</div>
							{#if scene.summary}
								<div
									class="text-sm leading-relaxed whitespace-pre-wrap"
								>
									{scene.summary}
								</div>
							{:else}
								<p class="text-surface-700-300 text-sm italic">
									No summary yet.
								</p>
							{/if}
							{@render sceneCastChips(scene)}
							{#if scene.sessionName}
								<p class="text-surface-700-300 text-xs">
									<Icons.MessageSquare
										size={11}
										class="inline"
									/>
									{scene.sessionName}
									{#if scene.selectedMessageIds?.length}· {scene
											.selectedMessageIds.length} messages{/if}
								</p>
							{/if}
						</div>
					{/if}

					<!-- ── Scene list ── -->
				{:else}
					{@const ungraphedSummarized = viewScenes.filter(
						(s) => !s.graphed && s.summary
					)}
					<div class="flex flex-col gap-2">
						{#if ungraphedSummarized.length > 0 && onNavigateToGraph}
							<button
								class="btn btn-sm preset-tonal-secondary w-full"
								onclick={onNavigateToGraph}
							>
								<Icons.GitGraph size={13} /> Build Graph ({ungraphedSummarized.length}
								ready)
							</button>
						{/if}
						{#if viewScenes.length === 0}
							<p
								class="text-surface-700-300 py-4 text-center text-xs italic"
							>
								No scenes captured for this entry yet.
							</p>
						{:else}
							{#each viewScenes as scene, sceneIdx}
								{@const sceneActivity =
									sceneActivityBySceneId.get(scene.id)}
								{@const isProcessing =
									sceneActivity?.status === "running"}
								{@const pendingActivity =
									sceneActivity?.status === "review"
										? sceneActivity
										: undefined}
								{@const hasMessages =
									(scene.selectedMessageIds?.length ?? 0) > 0}
								{@const hasSummary = !!scene.summary}
								<!-- svelte-ignore a11y_click_events_have_key_events -->
								<div
									role="button"
									tabindex="0"
									class="bg-surface-200-800 hover:bg-surface-300-700 flex cursor-pointer flex-col gap-1.5 rounded-md p-2 text-sm transition-colors"
									onclick={() => (focusedSceneId = scene.id)}
								>
									<div
										class="flex min-w-0 items-center gap-1.5"
									>
										<span
											class="flex-1 truncate text-sm font-medium"
										>
											<span
												class="text-surface-400 mr-1 font-normal"
											>
												{sceneIdx + 1}.
											</span>
											{scene.name ?? "Unnamed Scene"}
										</span>
										{#if scene.graphed}
											<Icons.GitGraph
												size={12}
												class="text-success-500 shrink-0"
											/>
										{/if}
										{#if isProcessing}
											<Icons.Loader
												size={13}
												class="text-primary-500 shrink-0 animate-spin"
											/>
										{:else if pendingActivity}
											<button
												class="btn btn-sm preset-filled-warning-500 shrink-0 p-1"
												onclick={(e) => {
													e.stopPropagation()
													openProcessModal(
														pendingActivity
													)
												}}
											>
												<Icons.Eye size={11} />
											</button>
										{/if}
										<div
											role="none"
											onclick={(e) => e.stopPropagation()}
										>
											<Popover
												open={openMenuSceneId ===
													scene.id}
												onOpenChange={(e) =>
													(openMenuSceneId = e.open
														? scene.id
														: null)}
												positioning={{
													placement: "bottom-end"
												}}
											>
												<Popover.Trigger
													class="btn btn-sm preset-filled-surface-400-600 shrink-0 p-1"
													title="More options"
													aria-label="More options for {scene.name ??
														'Unnamed Scene'}"
												>
													<Icons.Ellipsis size={14} />
												</Popover.Trigger>
												<Portal>
													<Popover.Positioner
														class="z-[1000]!"
													>
														<Popover.Content
															class="card bg-surface-100-900 flex min-w-36 flex-col gap-1 p-2 shadow-xl"
														>
															{#if pendingActivity}
																<button
																	class="btn btn-sm preset-filled-warning-500 w-full justify-start"
																	onclick={() => {
																		openMenuSceneId =
																			null
																		openProcessModal(
																			pendingActivity
																		)
																	}}
																>
																	<Icons.Eye
																		size={13}
																	/> Review
																</button>
															{:else if hasMessages}
																<button
																	class="btn btn-sm preset-filled-surface-400-600 w-full justify-start"
																	disabled={isProcessing}
																	onclick={() => {
																		openMenuSceneId =
																			null
																		processScene(
																			scene.id
																		)
																	}}
																>
																	{#if hasSummary}<Icons.RefreshCw
																			size={13}
																		/> Reprocess{:else}<Icons.Sparkles
																			size={13}
																		/> Process{/if}
																</button>
															{/if}
															<button
																class="btn btn-sm preset-filled-surface-400-600 w-full justify-start"
																onclick={() => {
																	openMenuSceneId =
																		null
																	startEditScene(
																		scene
																	)
																}}
															>
																<Icons.Pencil
																	size={13}
																/> Edit
															</button>
															<hr
																class="border-surface-300-700"
															/>
															<button
																class="btn btn-sm preset-filled-error-500 w-full justify-start"
																onclick={() => {
																	openMenuSceneId =
																		null
																	deleteScene(
																		scene.id
																	)
																}}
															>
																<Icons.Trash2
																	size={13}
																/> Delete
															</button>
														</Popover.Content>
													</Popover.Positioner>
												</Portal>
											</Popover>
										</div>
									</div>
									{#if scene.summary}
										<p
											class="text-surface-600-400 line-clamp-2 text-xs leading-relaxed whitespace-pre-wrap"
										>
											{scene.summary}
										</p>
									{/if}
									<!--
										The fix. The cast was previously visible
										only after clicking into a scene, with
										no affordance saying it was there — yet
										it is the input the graph build's
										relationship extraction runs on, so a
										bad cast could not be spotted before a
										build consumed it.
									-->
									{@render sceneCastChips(scene)}
								</div>
							{/each}
							<button
								class="btn btn-sm preset-tonal-secondary w-full"
								onclick={() => openCompileModal(focusedEntry!)}
							>
								<Icons.Wand size={14} /> Compile to Entry
							</button>
						{/if}
					</div>
				{/if}
			{/if}
		</div>

		<!-- ═══════════════════════════════════════════════════════════════
     EDIT MODE
════════════════════════════════════════════════════════════════ -->
	{:else if panelMode === "edit" && editingEntry}
		{@const editScenes = focusedEntry
			? (scenesByEntryId.get(focusedEntry.id) ?? [])
			: []}
		<div class="flex flex-col gap-4">
			<!-- Header -->
			<PanelNavHeader
				title={isNewEntry
					? "New History Entry"
					: `Year ${focusedEntry?.year ?? "?"}${
							focusedEntry?.month
								? `, Mo. ${focusedEntry.month}`
								: ""
						}${focusedEntry?.day ? `, Day ${focusedEntry.day}` : ""}`}
				onBack={goBack}
				backLabel="Back"
				headingLevel={3}
				titleClass="text-sm"
			/>

			<!-- Content | Scenes tabs (scenes only available when editing existing entry —
		     for a brand-new entry there's nothing to switch between, so the bar is
		     hidden entirely rather than showing a single, purposeless-looking button) -->
			{#if !isNewEntry}
				<div class="border-surface-300-700 flex gap-1 border-b pb-1">
					<button
						class="btn btn-sm {focusedEntryTab === 'content'
							? 'preset-filled-primary-500'
							: 'preset-filled-surface-400-600'}"
						onclick={() => (focusedEntryTab = "content")}
						disabled={hasUnsavedChanges &&
							focusedEntryTab !== "content"}
					>
						Content
					</button>
					<button
						class="btn btn-sm {focusedEntryTab === 'scenes'
							? 'preset-filled-primary-500'
							: 'preset-filled-surface-400-600'}"
						onclick={() => (focusedEntryTab = "scenes")}
						disabled={hasUnsavedChanges &&
							focusedEntryTab !== "scenes"}
					>
						<Icons.Film size={13} /> Scenes
						{#if editScenes.length > 0}
							<span
								class="badge-icon preset-filled-secondary-500 ml-1 h-4 min-w-4 rounded-full text-xs"
							>
								{editScenes.length}
							</span>
						{/if}
					</button>
				</div>
			{/if}

			<!-- Content form tab -->
			{#if focusedEntryTab === "content"}
				<div class="flex flex-col gap-4">
					<!-- Actions -->
					<div class="flex gap-2">
						<button
							class="btn btn-sm preset-filled-surface-400-600"
							onclick={goBack}
						>
							Cancel
						</button>
						<button
							class="btn btn-sm preset-filled-success-500"
							onclick={handleSave}
							disabled={!entryIsValid(editingEntry)}
						>
							<Icons.Save size={14} />
							{isNewEntry ? "Create" : "Update"}
						</button>
					</div>
					<!-- Date fields -->
					<div class="flex flex-col gap-1">
						<div class="flex gap-2">
							<div class="flex flex-col gap-1">
								<label
									class="flex items-center gap-1 text-sm font-semibold"
									for="editYear"
								>
									Year <Icons.ScanEye
										size={13}
										class="text-surface-400 relative top-[1px]"
									/>
								</label>
								<input
									id="editYear"
									class="input preset-filled-surface-200-800 w-full rounded-lg"
									type="number"
									bind:value={editingEntry.year}
									required
									placeholder="2055"
								/>
							</div>
							<div class="flex flex-col gap-1">
								<label
									class="flex items-center gap-1 text-sm font-semibold"
									for="editMonth"
								>
									Month <Icons.ScanEye
										size={13}
										class="text-surface-400 relative top-[1px]"
									/>
								</label>
								<input
									id="editMonth"
									class="input preset-filled-surface-200-800 w-full rounded-lg"
									type="number"
									bind:value={editingEntry.month}
									placeholder="3"
								/>
							</div>
							<div class="flex flex-col gap-1">
								<label
									class="flex items-center gap-1 text-sm font-semibold"
									for="editDay"
								>
									Day <Icons.ScanEye
										size={13}
										class="text-surface-400 relative top-[1px]"
									/>
								</label>
								<input
									id="editDay"
									class="input preset-filled-surface-200-800 w-full rounded-lg"
									type="number"
									bind:value={editingEntry.day}
									placeholder="1"
								/>
							</div>
						</div>
						{#if !isNewEntry && (editBounds.min !== -Infinity || editBounds.max !== Infinity)}
							<p class="text-surface-700-300 text-xs">
								{#if editBounds.min !== -Infinity && editBounds.max !== Infinity}
									Must be between {formatDateValue(
										editBounds.min
									)} and {formatDateValue(editBounds.max)}
								{:else if editBounds.min !== -Infinity}
									Must be after {formatDateValue(
										editBounds.min
									)}
								{:else}
									Must be before {formatDateValue(
										editBounds.max
									)}
								{/if}
							</p>
						{/if}
					</div>

					<!-- Content -->
					<div class="flex flex-col gap-1">
						<label
							class="flex items-center gap-1 text-sm font-semibold"
							for="editContent"
						>
							Content <Icons.ScanEye
								size={13}
								class="text-surface-400 relative top-[1px]"
							/>
						</label>
						<LoreContentField
							bind:content={(editingEntry as any).content}
							bind:lorebookBindingList={
								lorebookBindingList as any
							}
						/>
					</div>

					<!-- Keywords -->
					{#if !vectorizationEnabled}
						<div class="flex flex-col gap-1">
							<label
								class="flex items-center gap-1 text-sm font-semibold"
								for="editKeys"
							>
								Keywords <span
									class="text-surface-700-300 text-xs font-normal"
								>
									(comma separated)
								</span>
							</label>
							<input
								id="editKeys"
								class="input preset-filled-surface-200-800 w-full rounded-lg"
								type="text"
								bind:value={editingEntry.keys}
								placeholder="umber, umber city"
							/>
						</div>
					{/if}

					<!-- Advanced settings -->
					<details>
						<summary class="cursor-pointer text-sm font-semibold">
							Advanced Settings
						</summary>
						<div class="mt-2 flex flex-col gap-2 text-sm">
							{#if !vectorizationEnabled}
								<label
									class="flex w-full cursor-pointer items-center justify-between gap-2"
								>
									<span>Use Regex</span>
									<input
										type="checkbox"
										class="checkbox"
										checked={!!editingEntry.useRegex}
										onchange={(e) => {
											if (editingEntry)
												editingEntry.useRegex =
													e.currentTarget.checked
										}}
									/>
								</label>
								<label
									class="flex w-full cursor-pointer items-center justify-between gap-2"
								>
									<span>Case Sensitive</span>
									<input
										type="checkbox"
										class="checkbox"
										checked={!!editingEntry.caseSensitive}
										onchange={(e) => {
											if (editingEntry)
												editingEntry.caseSensitive =
													e.currentTarget.checked
										}}
									/>
								</label>
							{/if}
							<!-- Recursion depth.

							     Outside the `!vectorizationEnabled` gate that hides Use Regex and
							     Case Sensitive, deliberately: recursion is a property of the
							     keyword arm, and the keyword arm still runs with vectorization
							     on — an entry set to `keyword` or `both`, and every `rag` entry
							     on an instance whose model is not loaded, goes through it.
							     Hiding this would repeat the mistake those two are making. -->
							<div
								class="flex w-full items-center justify-between gap-2"
							>
								<label for="heeRecursion">
									Recursion depth
								</label>
								<select
									id="heeRecursion"
									class="select preset-filled-surface-200-800 w-max max-w-xs rounded-lg text-sm"
									value={String(
										editingEntry.recursionDepth ?? ""
									)}
									onchange={(e) => {
										if (!editingEntry) return
										// "" is not 0. Empty means the entry has no opinion and the
										// pipeline's ceiling decides, which is a different answer
										// from "conversation only" and has to survive as null.
										const v = e.currentTarget.value
										editingEntry.recursionDepth =
											v === "" ? null : Number(v)
									}}
								>
									<option value="">
										Use pipeline default
									</option>
									<option value="0">Conversation only</option>
									<option value="1">1 level deep</option>
									<option value="2">2 levels deep</option>
									<option value="3">3 levels deep</option>
								</select>
							</div>
							<label
								class="flex w-full cursor-pointer items-center justify-between gap-2"
							>
								<span>Pinned</span>
								<input
									type="checkbox"
									class="checkbox"
									checked={!!editingEntry.constant}
									onchange={(e) => {
										if (editingEntry)
											editingEntry.constant =
												e.currentTarget.checked
									}}
								/>
							</label>
							<label
								class="flex w-full cursor-pointer items-center justify-between gap-2"
							>
								<span>Enabled</span>
								<input
									type="checkbox"
									class="checkbox"
									checked={!!editingEntry.enabled}
									onchange={(e) => {
										if (editingEntry)
											editingEntry.enabled =
												e.currentTarget.checked
									}}
								/>
							</label>
							<label
								class="flex w-full cursor-pointer items-center justify-between gap-2"
							>
								<span>Completed</span>
								<input
									type="checkbox"
									class="checkbox"
									checked={!!editingEntry.isCompleted}
									onchange={(e) => {
										if (editingEntry)
											editingEntry.isCompleted =
												e.currentTarget.checked
									}}
								/>
							</label>
						</div>
					</details>
				</div>

				<!-- Scenes tab (edit mode) -->
			{:else if editingSceneId !== null}
				{@const editingScene = editScenes.find(
					(s) => s.id === editingSceneId
				)}
				<div class="flex flex-col gap-4">
					<div class="flex items-center gap-2">
						<button
							class="btn btn-sm preset-filled-surface-400-600 p-2"
							onclick={cancelEditScene}
							aria-label="Back"
						>
							<Icons.ChevronLeft size={16} />
						</button>
						<h4 class="flex-1 truncate text-sm font-semibold">
							{editingScene?.name ?? "Scene"}
						</h4>
					</div>
					<div class="flex gap-2">
						<button
							class="btn btn-sm preset-filled-surface-400-600"
							onclick={cancelEditScene}
						>
							Cancel
						</button>
						<button
							class="btn btn-sm preset-filled-success-500"
							onclick={saveEditScene}
						>
							<Icons.Save size={14} /> Update
						</button>
					</div>
					<input
						class="input input-sm w-full text-sm"
						type="text"
						placeholder="Scene name"
						bind:value={editingSceneName}
					/>
					<textarea
						class="textarea min-h-24 text-xs"
						placeholder="Scene summary…"
						bind:value={editingSceneSummary}
					></textarea>
					<div class="space-y-1">
						<p
							class="text-surface-700-300 text-[10px] font-semibold tracking-wide uppercase"
						>
							Participants
						</p>
						<div class="flex flex-wrap gap-1">
							{#each editingSceneParticipants as id, i}
								<span
									class="chip preset-tonal-primary flex items-center gap-0.5 py-0 text-[10px]"
								>
									{bindingNameById.get(id) ?? `#${id}`}
									<button
										class="p-1.5"
										aria-label="Remove participant {bindingNameById.get(
											id
										) ?? id}"
										onclick={() =>
											(editingSceneParticipants =
												editingSceneParticipants.filter(
													(_, j) => j !== i
												))}
									>
										<Icons.X size={9} />
									</button>
								</span>
							{/each}
						</div>
						<div class="flex gap-1">
							<select
								class="select select-sm flex-1 text-xs"
								bind:value={newParticipantId}
							>
								<option value="">Add character…</option>
								{#each lorebookBindingList.filter((b) => !editingSceneParticipants.includes(b.id)) as b}
									<option value={b.id}>
										{b.name || b.binding}
									</option>
								{/each}
							</select>
							<button
								class="btn btn-sm preset-filled-surface-400-600 p-1"
								onclick={addParticipant}
								disabled={newParticipantId === ""}
							>
								<Icons.Plus size={12} />
							</button>
						</div>
					</div>
					<div class="space-y-1">
						<p
							class="text-surface-700-300 text-[10px] font-semibold tracking-wide uppercase"
						>
							Mentioned
						</p>
						<div class="flex flex-wrap gap-1">
							{#each editingSceneMentioned as id, i}
								<span
									class="chip preset-tonal-surface flex items-center gap-0.5 py-0 text-[10px]"
								>
									{bindingNameById.get(id) ?? `#${id}`}
									<button
										class="p-1.5"
										aria-label="Remove mention {bindingNameById.get(
											id
										) ?? id}"
										onclick={() =>
											(editingSceneMentioned =
												editingSceneMentioned.filter(
													(_, j) => j !== i
												))}
									>
										<Icons.X size={9} />
									</button>
								</span>
							{/each}
						</div>
						<div class="flex gap-1">
							<select
								class="select select-sm flex-1 text-xs"
								bind:value={newMentionedId}
							>
								<option value="">Add character…</option>
								{#each lorebookBindingList.filter((b) => !editingSceneMentioned.includes(b.id)) as b}
									<option value={b.id}>
										{b.name || b.binding}
									</option>
								{/each}
							</select>
							<button
								class="btn btn-sm preset-filled-surface-400-600 p-1"
								onclick={addMentioned}
								disabled={newMentionedId === ""}
							>
								<Icons.Plus size={12} />
							</button>
						</div>
					</div>
				</div>
			{:else}
				{@const ungraphedSummarizedEdit = editScenes.filter(
					(s) => !s.graphed && s.summary
				)}
				<div class="flex flex-col gap-2">
					{#if ungraphedSummarizedEdit.length > 0 && onNavigateToGraph}
						<button
							class="btn btn-sm preset-tonal-secondary w-full"
							onclick={onNavigateToGraph}
							title="{ungraphedSummarizedEdit.length} scene{ungraphedSummarizedEdit.length ===
							1
								? ''
								: 's'} ready to graph"
							aria-label="{ungraphedSummarizedEdit.length} scene{ungraphedSummarizedEdit.length ===
							1
								? ''
								: 's'} ready to graph"
						>
							<Icons.GitGraph size={13} /> Build Graph ({ungraphedSummarizedEdit.length}
							ready)
						</button>
					{/if}
					{#if editScenes.length === 0}
						<p
							class="text-surface-700-300 py-4 text-center text-xs italic"
						>
							No scenes captured for this entry yet. Capture
							scenes from the session page.
						</p>
					{:else}
						{#each editScenes as scene, sceneIdx}
							{@const sceneActivity = sceneActivityBySceneId.get(
								scene.id
							)}
							{@const isProcessing =
								sceneActivity?.status === "running"}
							{@const pendingActivityEdit =
								sceneActivity?.status === "review"
									? sceneActivity
									: undefined}
							{@const hasMessages =
								(scene.selectedMessageIds?.length ?? 0) > 0}
							{@const hasSummary = !!scene.summary}
							<div
								class="bg-surface-200-800 flex flex-col gap-2 rounded-md p-2 text-sm"
							>
								<div class="flex min-w-0 items-center gap-1.5">
									<span
										class="flex-1 truncate text-sm font-medium"
									>
										<span
											class="text-surface-400 mr-1 font-normal"
										>
											{sceneIdx + 1}.
										</span>
										{scene.name ?? "Unnamed Scene"}
									</span>
									{#if scene.graphed}
										<Icons.GitGraph
											size={12}
											class="text-success-500 shrink-0"
											aria-label="Added to graph"
										/>
									{/if}
									{#if isProcessing}
										<Icons.Loader
											size={13}
											class="text-primary-500 shrink-0 animate-spin"
										/>
									{:else if pendingActivityEdit}
										<button
											class="btn btn-sm preset-filled-warning-500 shrink-0 p-1"
											onclick={() =>
												openProcessModal(
													pendingActivityEdit
												)}
											title="Review pending summary"
											aria-label="Review pending summary"
										>
											<Icons.Eye size={11} />
										</button>
									{/if}
									<div role="none">
										<Popover
											open={openMenuSceneId === scene.id}
											onOpenChange={(e) =>
												(openMenuSceneId = e.open
													? scene.id
													: null)}
											positioning={{
												placement: "bottom-end"
											}}
										>
											<Popover.Trigger
												class="btn btn-sm preset-filled-surface-400-600 shrink-0 p-1"
												title="More options"
												aria-label="More options for {scene.name ??
													'Unnamed Scene'}"
											>
												<Icons.Ellipsis size={14} />
											</Popover.Trigger>
											<Portal>
												<Popover.Positioner
													class="z-[1000]!"
												>
													<Popover.Content
														class="card bg-surface-100-900 flex min-w-36 flex-col gap-1 p-2 shadow-xl"
													>
														{#if pendingActivityEdit}
															<button
																class="btn btn-sm preset-filled-warning-500 w-full justify-start"
																onclick={() => {
																	openMenuSceneId =
																		null
																	openProcessModal(
																		pendingActivityEdit
																	)
																}}
															>
																<Icons.Eye
																	size={13}
																/> Review
															</button>
														{:else if hasMessages}
															<button
																class="btn btn-sm preset-filled-surface-400-600 w-full justify-start"
																disabled={isProcessing}
																onclick={() => {
																	openMenuSceneId =
																		null
																	processScene(
																		scene.id
																	)
																}}
															>
																{#if hasSummary}<Icons.RefreshCw
																		size={13}
																	/> Reprocess{:else}<Icons.Sparkles
																		size={13}
																	/> Process{/if}
															</button>
														{/if}
														<button
															class="btn btn-sm preset-filled-surface-400-600 w-full justify-start"
															onclick={() => {
																openMenuSceneId =
																	null
																startEditScene(
																	scene
																)
															}}
														>
															<Icons.Pencil
																size={13}
															/> Edit
														</button>
														<hr
															class="border-surface-300-700"
														/>
														<button
															class="btn btn-sm preset-filled-error-500 w-full justify-start"
															onclick={() => {
																openMenuSceneId =
																	null
																deleteScene(
																	scene.id
																)
															}}
														>
															<Icons.Trash2
																size={13}
															/> Delete
														</button>
													</Popover.Content>
												</Popover.Positioner>
											</Portal>
										</Popover>
									</div>
								</div>
								{#if scene.summary}
									<p
										class="text-surface-600-400 line-clamp-3 text-xs leading-relaxed whitespace-pre-wrap"
									>
										{scene.summary}
									</p>
								{:else}
									<p
										class="text-surface-700-300 text-xs italic"
									>
										No summary.
									</p>
								{/if}
								{@render sceneCastChips(scene)}
							</div>
						{/each}
					{/if}
					<button
						class="btn btn-sm preset-filled-secondary-500 w-full"
						onclick={() =>
							focusedEntry && openCompileModal(focusedEntry)}
						disabled={editScenes.length === 0}
						title={editScenes.length === 0
							? "No scenes to compile"
							: "Compile scenes into this history entry"}
						aria-label={editScenes.length === 0
							? "No scenes to compile"
							: "Compile scenes into this history entry"}
					>
						<Icons.Wand size={14} /> Compile to Entry
					</button>
				</div>
			{/if}
		</div>
	{/if}
{/if}

<DeleteLorebookEntryConfirmModal
	open={showDeleteConfirmModal}
	onOpenChange={(e) => {
		showDeleteConfirmModal = e.open
		if (!e.open) deleteEntryId = null
	}}
	onConfirm={onDeleteConfirm}
	onCancel={onDeleteCancel}
/>

{#if compileTargetEntry}
	<CompileHistoryEntryModal
		open={showCompileModal}
		onOpenChange={(e) => {
			showCompileModal = e.open
			if (!e.open) compileTargetEntry = null
		}}
		historyEntry={compileTargetEntry}
		activityId={compileActivityId}
		pendingResult={compilePendingResult}
		initialStep={compileInitialStep}
		onSaved={handleCompileSaved}
		onDiscarded={handleCompileDiscarded}
	/>
{/if}

{#if showProcessModal && processModalSceneId !== null}
	<ProcessSceneModal
		open={showProcessModal}
		onOpenChange={(e) => (showProcessModal = e.open)}
		sceneId={processModalSceneId}
		activityId={processModalActivityId}
		pendingResult={processModalPendingResult ?? null}
		{lorebookId}
		{lorebookBindingList}
		onApplied={(_sceneId) => {
			showProcessModal = false
		}}
		onDiscarded={(_activityId) => {
			showProcessModal = false
		}}
	/>
{/if}
