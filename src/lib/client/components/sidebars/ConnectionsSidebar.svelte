<script lang="ts">
	/**
	 * The Connections sidebar — three views over one list.
	 *
	 * - **index**: every endpoint with its models (`ConnectionIndexView`).
	 *   Search, one filter, the defaults strip, and the groups. Models are
	 *   opened from here and only from here.
	 * - **connection**: one endpoint's own settings — host, key, format,
	 *   capabilities, stop scripts. It says how many models it has and when
	 *   they were last checked, and offers Refresh; it does not list or edit
	 *   them. Models are not managed from the connection view.
	 * - **model**: one model's own settings (`ModelDetailView`).
	 *
	 * ## Models are synced, not imported
	 *
	 * The list rides on `connections:list` with every model attached, and
	 * `connections:syncModels` reconciles rows against what each host says.
	 * The sidebar asks for a (stale-only) sync of everything when the index
	 * opens, of one endpoint when its view or a model's view opens, and a
	 * forced one on Refresh. The server broadcasts the refreshed list and
	 * model views, so every open tab moves at once.
	 */
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import {
		declareInterest,
		useInterest
	} from "$lib/client/sockets/interest.svelte"
	import { getContext, onDestroy, onMount, untrack } from "svelte"
	import { SvelteMap, SvelteSet } from "svelte/reactivity"
	import * as Icons from "@lucide/svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
	import { toaster } from "$lib/client/utils/toaster"
	import {
		CONNECTION_DEFAULTS,
		OPENAI_COMPATIBLE_PRESETS,
		stableStringify
	} from "$lib/shared/utils/connectionDefaults"
	import ConnectionCapabilities from "$lib/client/components/connections/ConnectionCapabilities.svelte"
	import EmbeddingQueuePanel from "$lib/client/components/connections/EmbeddingQueuePanel.svelte"
	import NerLanePanel from "$lib/client/components/connections/NerLanePanel.svelte"
	import ConnectionServicePicker from "./ConnectionServicePicker.svelte"
	import {
		createNavStack,
		INDEX_ENTRY,
		type NavEntry,
		type NavView
	} from "$lib/client/components/connections/navStack"
	import { serviceLabel } from "$lib/client/components/connections/connectionIndexFilter"
	import ModelRow from "$lib/client/components/connections/ModelRow.svelte"
	import ConnectionIndexView from "$lib/client/components/connections/ConnectionIndexView.svelte"
	import { ViewModeTracker } from "$lib/client/shell/viewMode.svelte"
	import PanelSplit from "$lib/client/components/panels/PanelSplit.svelte"
	import PanelNavHeader from "$lib/client/components/panels/PanelNavHeader.svelte"
	import DetailHero from "$lib/client/components/panels/DetailHero.svelte"
	import ConnectionTypeForm from "$lib/client/components/connections/ConnectionTypeForm.svelte"
	import ConnectionStopScripts from "$lib/client/components/connections/ConnectionStopScripts.svelte"
	import ModelDetailView from "$lib/client/components/connections/ModelDetailView.svelte"
	import OnnxModelView from "$lib/client/components/connections/OnnxModelView.svelte"
	import OnnxEndpointView from "$lib/client/components/connections/OnnxEndpointView.svelte"
	import type { PairDefaultSelection } from "$lib/client/components/connections/modelSystemDefaults"
	import {
		endpointKind,
		isLocalOnnxType,
		type ModelManager
	} from "$lib/client/components/connections/modelManagement"
	import {
		enableManager,
		type ManagerKind
	} from "$lib/client/components/connections/managers"
	import PanelTabStrip from "$lib/client/components/panels/PanelTabStrip.svelte"
	import ManagedConnectionView from "$lib/client/components/connections/ManagedConnectionView.svelte"
	import { managedConnectionIds } from "$lib/client/components/connections/managedConnectionView"
	import CapabilityView from "$lib/client/components/connections/CapabilityView.svelte"
	import ModelFinderView from "$lib/client/components/connections/ModelFinderView.svelte"
	import SetupChatFlow from "$lib/client/components/connections/SetupChatFlow.svelte"
	import {
		activeApiTab,
		apiConnectionTabs,
		modelsHeadline,
		showsTabStrip,
		statusLine,
		type LastTest
	} from "$lib/client/components/connections/connectionViewChrome"
	import {
		keyUrlFor,
		needsCredential
	} from "$lib/shared/connections/credentials"
	import { manualAddAllowed } from "$lib/client/components/connections/modelManagement"
	import DownloadsView from "$lib/client/components/connections/DownloadsView.svelte"
	import ConnectionsOverview from "$lib/client/components/connections/ConnectionsOverview.svelte"
	import ModelTable from "$lib/client/components/connections/ModelTable.svelte"
	import { systemCapabilitiesForModel } from "$lib/client/components/connections/modelSystemDefaults"
	import { capabilityLabel } from "@serene-pub/sdk"
	import type { JobTile } from "$lib/client/components/connections/jobTile"
	import { timeAgo } from "$lib/client/utils/timeAgo"
	import {
		sectionForCapability,
		sectionForModality
	} from "$lib/shared/constants/connectionSections"
	import { EMBEDDING_CAPABILITY } from "$lib/shared/constants/embeddings"
	import { NER_CAPABILITY } from "$lib/shared/constants/ner"
	import type {
		ConnectionServiceCategory,
		ConnectionServiceItem
	} from "$lib/shared/utils/connectionServiceItems"
	import {
		NOTE_MAX_LENGTH,
		normalizeNote
	} from "$lib/shared/utils/connectionNotes"

	interface Props {
		onclose?: () => Promise<boolean> | undefined
		/** Deep-link: open the new-connection flow on mount (admin create page). */
		startNew?: boolean
		/**
		 * Deep-link: open straight to this connection.
		 *
		 * A PROP rather than `panelsCtx.digest.connectionId` for any caller
		 * that embeds this sidebar in a page of its own (the admin change
		 * page). The digest is one shared slot, and with the shell's tab model
		 * an already-open-but-hidden Connections view reads it too — whichever
		 * copy mounted first consumed it, so the embedded one showed the index
		 * while the hidden one silently jumped to the row. A prop is addressed
		 * to one instance and so cannot be raced. The digest stays for
		 * external navigation that OPENS the shell's view ("open connection"
		 * in the Ollama manager, a Jump hit).
		 */
		initialConnectionId?: number
		/**
		 * A page that embeds this panel for ONE connection (the admin edit
		 * page): leaving for the index calls this instead, so the page goes
		 * back to its own list rather than drawing a second index under its
		 * "Edit connection" heading (plan 2026-09-24 B10).
		 */
		onExit?: () => void
	}

	let {
		onclose = $bindable(),
		startNew = false,
		initialConnectionId,
		onExit
	}: Props = $props()
	let systemSettingsCtx: SystemSettingsCtx = $state(
		getContext("systemSettingsCtx")
	)
	let panelsCtx: PanelsCtx = getContext("panelsCtx")
	const userCtx: { user: SelectUser } = getContext("userCtx")
	let koboldCppSettingsCtx: KoboldCppSettingsCtx = getContext(
		"koboldCppSettingsCtx"
	)

	const socket = useTypedSocket()

	type ListRow = Sockets.Connections.List.Row
	/** Same five tones the index row uses, so one dot means one thing app-wide. */
	const CHROME_DOT: Record<string, string> = {
		ok: "bg-success-500",
		pending: "bg-warning-500 animate-pulse",
		warning: "bg-warning-500",
		error: "bg-error-500",
		quiet: "bg-surface-400-600"
	}

	// ── View state ──────────────────────────────────────────────────────────
	/**
	 * The three views are the same three at every width — what changes is
	 * whether opening one REPLACES the index or sits beside it. At desk width
	 * the index is a column that stays put, so `view` stops meaning "which
	 * screen" and means only "what, if anything, is open on the right".
	 */
	const viewMode = new ViewModeTracker()
	/**
	 * Six kinds since the 2026-09-17 concept rebuild. `capability`, `finder`
	 * and `downloads` are the three the index gained when models left it: a
	 * readiness row opens a CAPABILITY rather than a model, "Get a model"
	 * opens the one finder (ruling R3), and the tray opens the one downloads
	 * list (R4).
	 */
	type View = NavView
	let view = $state<View>("index")
	/** The transform the capability view is open on. Set with the view. */
	let selectedCapability = $state<string | null>(null)
	/** What the finder is scoped to, if anything. */
	let finderScope = $state<{ capability?: string; connectionId?: number }>({})
	/** The model whose detail view is open. Set with the view. */
	let selectedModelId = $state<number | null>(null)
	/** Seeds the index filter (a `cap:<transform>` value, or null). */
	let initialIndexFilter = $state<string | null>(null)
	/** The group the index scrolls to on return from a connection or model. */
	let indexFocusId = $state<number | null>(null)
	/**
	 * What the index worked out about readiness, for the full-page empty pane.
	 *
	 * Handed up by the index rather than derived again here: the tiles depend
	 * on live status only that view subscribes to, and a second derivation
	 * would disagree with the first exactly when something was wrong.
	 */
	let overviewFacts = $state<{
		chat: {
			modelName: string | null
			connectionName: string | null
			problem: string | null
			set: boolean
		}
		tiles: JobTile[]
		connectionCount: number
	} | null>(null)

	// ── Data ────────────────────────────────────────────────────────────────
	let connectionsList: ListRow[] = $state([])
	let isLoading = $state(true)
	let connection: any = $state()
	let originalConnection: any = $state()
	let unsavedChanges = $derived.by(() => {
		if (!connection || !originalConnection) return false
		// stableStringify (not JSON.stringify) so two logically-identical
		// connections with differently-ordered object keys — e.g. because a
		// form rebuilt extraJson from its own fields — don't register as a
		// false "unsaved changes."
		return (
			stableStringify(connection) !== stableStringify(originalConnection)
		)
	})
	let showConfirmModal = $state(false)
	let confirmResolve: ((v: boolean) => void) | null = null
	let showNewConnectionModal = $state(false)
	let newConnectionName = $state("")
	let newConnectionService: ConnectionServiceItem | undefined = $state()
	/** Which modality the New Connection picker opens on. */
	let newConnectionModality = $state<string>("text-gen")
	/**
	 * Whether the name was hand-typed. A preset prefills the name on
	 * selection, but a typed name is the person's and is never overwritten.
	 */
	let nameTouched = $state(false)
	$effect(() => {
		if (newConnectionService && !nameTouched) {
			newConnectionName = newConnectionService.label
		}
	})
	let showDeleteModal = $state(false)

	// Which connection is currently shown (local view state)
	let selectedConnectionId = $state<number | null>(null)
	// Set only when this panel was opened pointing AT a connection (the digest
	// seeding in onMount), and consumed by the first connections:get for that
	// id. Not $state: nothing renders from it.
	let deepLinkedConnectionId: number | null = null

	/** The list row for the open connection — the models summary lives on it. */
	const selectedRow = $derived(
		connectionsList.find((c) => c.id === selectedConnectionId) ?? null
	)
	const selectedMissingCount = $derived(
		(selectedRow?.models ?? []).filter((m) => m.missingSince != null).length
	)
	/**
	 * Whether the open connection is a runtime this pub RUNS, and which.
	 *
	 * Read off the LIST row first, not the loaded draft: the draft arrives one
	 * round trip later, and branching on it would show the ordinary form for a
	 * frame before the managed view replaced it.
	 */
	const openManagedKind = $derived(
		view === "connection"
			? managedViewKind(selectedRow?.type ?? connection?.type)
			: null
	)

	/** The open connection's title and the service chip beside it, if any. */
	const paneTitle = $derived(
		connection?.name ?? selectedRow?.name ?? "Connection"
	)
	// The index row's chip word, so the header and the row it was opened from
	// say the same thing ("ONNX", not the type's long label that repeats the
	// title and so hid the chip).
	const paneService = $derived(
		serviceLabel({
			type: connection?.type ?? selectedRow?.type,
			preset: selectedRow?.preset ?? null
		})
	)
	/**
	 * The chip only where it says something the title has not.
	 *
	 * R5 (2026-09-17) asked for both always; a connection's default name IS its
	 * service label, so the header read "Anthropic (Claude)" beside a chip
	 * saying "Anthropic (Claude)". Amended 2026-09-23 — see `ConnectionRow`.
	 */
	const showPaneChip = $derived(
		!!paneService &&
			paneService.trim().toLowerCase() !== paneTitle.trim().toLowerCase()
	)

	// Screen reader announcements
	let announcements = $state("")
	function announce(message: string) {
		announcements = message
		setTimeout(() => (announcements = ""), 1000)
	}

	// ── Model sync ──────────────────────────────────────────────────────────
	/** Endpoints with a sync in flight (reactive Set — see the memory note). */
	const syncingIds = new SvelteSet<number>()
	/**
	 * Each managed view's open tab, by connection. Held here because the view
	 * remounts on the dock ↔ full-page swap (plan 2026-09-24 B6).
	 */
	const managedTabById = new SvelteMap<number, string>()
	/**
	 * The open tab of each API connection's view, by connection id — the same
	 * per-connection memory the managed runtimes get, so switching between two
	 * endpoints does not drag one's tab onto the other.
	 */
	const apiTabById = new SvelteMap<number, string>()
	let syncingAll = $state(false)
	/** Forced syncs — the ones whose failure earns a toast. Not $state. */
	const forcedIds = new Set<number>()

	function requestSync(id?: number, force = false) {
		if (id != null) {
			syncingIds.add(id)
			if (force) forcedIds.add(id)
			socket.emit("connections:syncModels", {
				id,
				...(force ? { force: true } : {})
			})
		} else {
			syncingAll = true
			socket.emit("connections:syncModels", force ? { force: true } : {})
		}
	}
	function handleSyncModels(msg: Sockets.Connections.SyncModels.Response) {
		// Broadcast to every tab; results name the endpoints that were
		// actually synced (fresh ones are skipped and absent). Clearing every
		// pending marker on any response is deliberate — a sync in another
		// tab ending ours a moment early costs a spinner, not a fact.
		syncingIds.clear()
		syncingAll = false
		if (msg.error) toaster.error({ title: msg.error })
		for (const r of msg.results) {
			if (!r.error || !forcedIds.has(r.connectionId)) continue
			const name =
				connectionsList.find((c) => c.id === r.connectionId)?.name ??
				"the connection"
			toaster.warning({
				title: `Couldn't list models for ${name}`,
				description: r.error
			})
		}
		forcedIds.clear()
	}
	/** One row's disk state, replaced in place. An unknown id is ignored. */
	function handleModelLocalState(
		msg: Sockets.Connections.DownloadModel.Response
	) {
		if (msg.connectionId == null || msg.modelId == null) return
		connectionsList = connectionsList.map((c) =>
			c.id !== msg.connectionId
				? c
				: {
						...c,
						models: c.models.map((m) =>
							m.id === msg.modelId
								? { ...m, local: msg.local }
								: m
						)
					}
		)
	}
	function handleSyncModelsError(msg: { error?: string }) {
		syncingIds.clear()
		syncingAll = false
		forcedIds.clear()
		toaster.error({ title: msg.error ?? "Couldn't refresh models" })
	}

	// ── Navigation ──────────────────────────────────────────────────────────
	/**
	 * Land on the index with its filter seeded. A modality seed maps to the
	 * section's capability — endpoints are not pure by modality, so there is
	 * no modality filter left to seed.
	 */
	function openCategory(m: string) {
		const section = sectionForModality(m)
		initialIndexFilter = section ? `cap:${section.starCapability}` : null
		view = "index"
	}

	// ── The trail Back walks (plan 2026-09-24 B1) ───────────────────────────
	/**
	 * Where Back goes. Every door below pushes where it was opened FROM, and
	 * Back restores that entry whole — connection included, re-fetched when
	 * the draft is gone. See `navStack.ts` for why one stack replaced the
	 * per-view "return view" variables.
	 */
	const navStack = createNavStack()
	function currentEntry(): NavEntry {
		return {
			view,
			connectionId: selectedConnectionId,
			modelId: selectedModelId,
			capability: selectedCapability,
			finderScope
		}
	}
	/**
	 * Land on an entry.
	 *
	 * The ONE place view state is written, so a door cannot forget half of it:
	 * the selection follows the entry (a capability view does not leave the
	 * last connection highlighted in the list — B8), and a connection whose
	 * draft is not the one in hand is cleared and fetched, never shown under
	 * another connection's name (B2/B3).
	 */
	function applyEntry(entry: NavEntry) {
		if (
			entry.connectionId == null ||
			connection?.id !== entry.connectionId
		) {
			connection = undefined
			originalConnection = undefined
		}
		selectedConnectionId = entry.connectionId
		selectedModelId = entry.modelId
		selectedCapability = entry.capability
		finderScope = entry.finderScope
		view = entry.view
		if (entry.view === "connection" && entry.connectionId != null) {
			if (!connection)
				socket.emit("connections:get", { id: entry.connectionId })
			requestSync(entry.connectionId)
		}
	}
	/** A discarded draft is dropped, not left to reappear on the way back. */
	function dropDiscardedDraft() {
		if (view === "connection" && unsavedChanges) {
			connection = undefined
			originalConnection = undefined
		}
	}
	/**
	 * Go somewhere new. `fromList` is a door in the index list: the list is
	 * always one tap away, so a trail that ran through it starts again.
	 *
	 * Guarded — every door asks about an unsaved draft first (B7), so no new
	 * door can skip the question.
	 */
	async function navigate(
		entry: NavEntry,
		fromList = false
	): Promise<boolean> {
		if (!(await handleOnClose())) return false
		const leaving = currentEntry()
		dropDiscardedDraft()
		if (fromList) navStack.clear()
		else navStack.push(leaving)
		applyEntry(entry)
		return true
	}
	/** Back: the entry this view was opened from, or the index. */
	async function goBack() {
		if (!(await handleOnClose())) return
		const leavingId = selectedConnectionId
		dropDiscardedDraft()
		const target = navStack.pop()
		if (target.view === "index" && onExit) {
			onExit()
			return
		}
		applyEntry(target)
		if (target.view === "index") landOnIndex(leavingId)
	}

	function entryFor(to: NavView, over: Partial<NavEntry> = {}): NavEntry {
		return { ...INDEX_ENTRY, view: to, ...over }
	}

	async function openConnection(row: { id?: number }, fromList = false) {
		if (row.id == null) return
		await navigate(
			entryFor("connection", { connectionId: row.id }),
			fromList
		)
	}

	async function openModel(
		connectionId: number,
		modelId: number,
		fromList = false
	) {
		const entry = entryFor("model", { connectionId, modelId })
		if (await navigate(entry, fromList)) {
			requestSync(connectionId)
			announce("Model details opened")
		}
	}

	/**
	 * One capability's own view.
	 *
	 * The readiness rows' destination, and the only place a pair is changed
	 * from this panel — which is what keeps the costed confirmation in front
	 * of an embeddings or entities switch.
	 */
	async function openCapability(capability: string, fromList = false) {
		await navigate(entryFor("capability", { capability }), fromList)
	}
	async function openFinder(
		opts: { capability?: string; connectionId?: number } = {},
		fromList = false
	) {
		await navigate(
			entryFor("finder", { finderScope: { ...opts } }),
			fromList
		)
	}
	/** The Set up chat flow (U5). Its step is derived from the facts, so
	 * there is nothing to seed here. */
	async function openSetupChat() {
		await navigate(entryFor("setup-chat"), true)
	}
	async function openDownloads(fromList = false) {
		await navigate(entryFor("downloads"), fromList)
	}
	/**
	 * Switch a manager on, and land on the connection it is about.
	 *
	 * Both halves, because the flag alone is invisible: before the rebuild the
	 * switch lived in Settings → System and the connection had to be created
	 * separately, which is two screens for one intention. A row that already
	 * exists is opened; a missing one is created, and `handleConnectionsCreate`
	 * opens it when the server answers.
	 */
	function handleEnableManager(kind: ManagerKind) {
		const { connectionId } = enableManager(kind, socket, connectionsList)
		if (connectionId != null) {
			const row = connectionsList.find((c) => c.id === connectionId)
			if (row) void openConnection(row)
		}
	}
	/**
	 * Land on the index with a one-time highlight on the row just left. The
	 * trail is spent: the index is where every trail starts.
	 */
	function landOnIndex(focusId: number | null) {
		navStack.clear()
		indexFocusId = focusId
		// The highlight is a one-time landing cue, not a selection.
		setTimeout(() => (indexFocusId = null), 1500)
	}
	function backToIndex(focusId: number | null) {
		if (onExit) {
			onExit()
			return
		}
		applyEntry(INDEX_ENTRY)
		landOnIndex(focusId)
	}
	function handleModelRemoved() {
		toaster.success({ title: "Model removed" })
		void goBack()
	}
	/**
	 * Which runtime's VIEW a connection is, or null for an ordinary endpoint.
	 *
	 * Only the two rows that stand for an install: the KoboldCPP image row is
	 * the same install's second connection and is reached from inside the
	 * KoboldCPP view's Image list, so it keeps the ordinary connection pane.
	 */
	function managedViewKind(
		type: string | null | undefined
	): ManagerKind | null {
		if (type === CONNECTION_TYPE.KOBOLDCPP_MANAGED) return "koboldcpp"
		if (type === CONNECTION_TYPE.OLLAMA) return "ollama"
		return null
	}
	/**
	 * A door that used to open a manager panel, now opening its connection.
	 *
	 * The managers fold into their connection with the 2026-09-17 ruling (R2),
	 * so "open the KoboldCPP manager" and "open the KoboldCPP connection" are
	 * one act. A manager nobody has switched on has no row to open, so the
	 * press switches it on and lands on the row that appears — the same two
	 * halves the Add menu does.
	 */
	function openManager(manager: ModelManager | "ollama" | "koboldcpp") {
		const kind: ManagerKind =
			typeof manager === "string" ? manager : manager.panel
		const type =
			kind === "koboldcpp"
				? CONNECTION_TYPE.KOBOLDCPP_MANAGED
				: CONNECTION_TYPE.OLLAMA
		const row = connectionsList.find((c) => c.type === type && c.id != null)
		if (row) void openConnection(row)
		else handleEnableManager(kind)
	}
	/**
	 * "Remove KoboldCPP from this pub": the flag AND the rows.
	 *
	 * Both halves, because either one alone is a half-removed install — a flag
	 * off with a row still listed is a connection that can never answer, and a
	 * row deleted with the flag on is a manager the server will still spawn.
	 * Files on disk are deliberately left alone; they are the expensive half
	 * and nothing here re-downloads them.
	 */
	/** What Remove takes away: the whole KoboldCPP install, or one Ollama. */
	function removalIds(kind: ManagerKind): number[] {
		if (kind === "ollama")
			return selectedConnectionId != null ? [selectedConnectionId] : []
		return managedConnectionIds(kind, connectionsList)
	}
	function removeManager(kind: ManagerKind) {
		// Ollama: THIS connection. Every Ollama connection is managed on its
		// own host (plan 2026-09-24 B4), so removing one must not delete the
		// others — which the kind-wide delete here did. The flag goes off only
		// with the last one.
		const ids = removalIds(kind)
		const lastOllama =
			kind === "ollama" &&
			managedConnectionIds("ollama", connectionsList).every((id) =>
				ids.includes(id)
			)
		if (kind === "koboldcpp" || lastOllama)
			socket.emit(
				kind === "koboldcpp"
					? "systemSettings:updateKoboldCppManagerEnabled"
					: "systemSettings:updateOllamaManagerEnabled",
				{ enabled: false }
			)
		for (const id of ids) socket.emit("connections:delete", { id })
		// `handleConnectionsDelete` only lands the view when the row it
		// answers for is the open one; the image row is not, so navigate here
		// rather than relying on which ack arrives last.
		connection = undefined
		originalConnection = undefined
		const id = selectedConnectionId
		selectedConnectionId = null
		backToIndex(id)
	}
	function handleAddModel(row: ListRow, model: string, name: string) {
		if (row.id == null) return
		socket.emit("connections:createModel", {
			id: row.id,
			model: {
				model: model.trim(),
				...(name.trim() ? { name: name.trim() } : {})
			}
		})
	}

	/**
	 * The file presses on a LOCAL ONNX endpoint's own view.
	 *
	 * Emitted from here rather than from the view because `connectionsList` is
	 * here: every one of these answers on an event the sidebar already holds
	 * (`connections:downloadModel`, `connections:cancelModelDownload`,
	 * `connections:modelDownloadProgress`), which is what patches the row the
	 * two ONNX views read. A view that emitted them and listened for itself
	 * would be a second copy of the same subscription.
	 *
	 * ⚠ Make active is NOT here. It is `handlePairDefault` like every other
	 * star, so the costed confirmation stands in front of it.
	 */
	function downloadOnnxModel(connectionId: number, modelId: number) {
		socket.emit("connections:downloadModel", { id: connectionId, modelId })
	}
	function cancelOnnxDownload(connectionId: number, modelId: number) {
		socket.emit("connections:cancelModelDownload", {
			id: connectionId,
			modelId
		})
	}
	/**
	 * The star capability of the section this endpoint's modality belongs to.
	 *
	 * The TYPE is the fallback, not the first answer: an endpoint's modality is
	 * what says what its models are for (§10), and the two local ONNX types are
	 * the only ones whose modality can be read off the type at all.
	 */
	function starCapabilityOf(row: ListRow | null | undefined): string | null {
		const modality =
			row?.modality ??
			(row?.type === CONNECTION_TYPE.LOCAL_ONNX_NER
				? "ner"
				: row?.type === CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS
					? "embeddings"
					: null)
		return sectionForModality(modality)?.starCapability ?? null
	}

	// ── Defaults (the star) ─────────────────────────────────────────────────
	/**
	 * Star presses waiting on a reindex/re-annotate confirmation.
	 *
	 * The confirm dialogs' buttons call `commitSetDefault()` with no
	 * arguments, so the targets ride here — set by every path before any
	 * dialog opens. A "default for all" press stages several; the confirms
	 * chain (reindex, then re-annotate) before the single commit.
	 *
	 * ⚠ `$state` since 0.6, and it has to be: the confirmation copy names the
	 * model it would install ("Switch embeddings to bge-small?"), which is read
	 * back out of here. While it was a plain `let` the dialog happened to be
	 * right only because `showReindexModal` flipped in the same tick and
	 * dragged the derived with it — an invariant nothing states and the next
	 * caller would not know to keep.
	 */
	interface PendingStarTarget {
		capability: string
		id: number
		modelId: number
		verb: string
	}
	let pendingStars = $state<PendingStarTarget[] | null>(null)

	function commitSetDefault() {
		const targets = pendingStars ?? []
		pendingStars = null
		if (!targets.length) return
		for (const target of targets)
			socket.emit("connections:setDefault", {
				capability: target.capability,
				id: target.id,
				modelId: target.modelId
			})
		const selected = connectionsList.find((c) => c.id === targets[0].id)
		if (selected)
			announce(
				`${selected.name} will be used for ${targets.map((t) => t.verb).join(", ")}`
			)
	}

	/**
	 * Moving the embedding star throws every stored vector away, so it asks
	 * first — with the real number from the server, not a generic warning.
	 * Only when a DIFFERENT pair is already starred: the first star on a
	 * fresh install costs nothing and must not open a scary dialog.
	 */
	let showReindexModal = $state(false)
	/**
	 * The whole estimate, not just the row count.
	 *
	 * `byKind`/`lorebooks`/`sessions` are OPTIONAL on the wire, and the
	 * confirmation says "every entry in N lorebooks and the history of M
	 * sessions" only when they arrive. A server that answers with the bare
	 * `rows` still gets a correct dialog with one clause fewer.
	 */
	let reindexCost = $state<Sockets.Vectorization.ReindexCost.Response | null>(
		null
	)
	const reindexRows = $derived(reindexCost?.rows ?? null)
	function handleReindexCost(
		msg: Sockets.Vectorization.ReindexCost.Response
	) {
		reindexCost = msg
	}

	/**
	 * What the confirmation is switching FROM, resolved off the list.
	 *
	 * Named rather than counted: "Replaces bge-small" is a sentence a person
	 * can check against what they believe is running, and "Keep bge-small" on
	 * the cancel button is the only wording that makes the safe choice the
	 * obvious one.
	 */
	function currentDefaultModel(capability: string) {
		const def = systemSettingsCtx.capabilityDefaults?.[capability]
		if (!def?.connectionId) return null
		const connection = connectionsList.find(
			(c) => c.id === def.connectionId
		)
		const model = connection?.models.find(
			(m) => m.id === def.connectionModelId
		)
		return model ? { model, connection } : null
	}
	const stagedTargetFor = (capability: string) =>
		pendingStars?.find((t) => t.capability === capability) ?? null
	/** The model a staged switch would install, by name. */
	function stagedModelName(capability: string): string | null {
		const target = stagedTargetFor(capability)
		if (!target) return null
		const connection = connectionsList.find((c) => c.id === target.id)
		return (
			connection?.models.find((m) => m.id === target.modelId)?.name ??
			null
		)
	}
	const embeddingCurrent = $derived.by(() =>
		showReindexModal ? currentDefaultModel(EMBEDDING_CAPABILITY) : null
	)
	const embeddingNext = $derived.by(() =>
		showReindexModal ? stagedModelName(EMBEDDING_CAPABILITY) : null
	)
	/** The same disclosure for the entity star, with its own count. */
	let showReannotateModal = $state(false)
	let reannotateRows = $state<number | null>(null)
	const entityCurrent = $derived.by(() =>
		showReannotateModal ? currentDefaultModel(NER_CAPABILITY) : null
	)
	const entityNext = $derived.by(() =>
		showReannotateModal ? stagedModelName(NER_CAPABILITY) : null
	)
	/**
	 * "…stays on disk" is only true of a model whose FILES this install owns.
	 * A hosted embedding endpoint leaves nothing behind to switch back to, so
	 * the line is dropped rather than made vaguely true.
	 */
	const embeddingCurrentIsLocal = $derived(
		embeddingCurrent?.connection?.type ===
			CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS
	)
	const entityCurrentIsLocal = $derived(
		entityCurrent?.connection?.type === CONNECTION_TYPE.LOCAL_ONNX_NER
	)
	function handleNerStatus(msg: Sockets.Ner.Status.Response) {
		reannotateRows = msg.annotatedRows
	}
	/**
	 * A per-MODEL default choice from the model view — one capability, or
	 * every satisfiable one. Targets already pointing at this pair are
	 * dropped up front: the server would no-op them, and a no-op must not
	 * open a cost dialog.
	 */
	/**
	 * Which capabilities each of a connection's models is the default for.
	 *
	 * Keyed by model id for the table, which renders a row at a time and must
	 * not run an O(defaults) scan per row per frame.
	 */
	function defaultsByModel(row: {
		id?: number
		models: readonly { id: number }[]
	}): Record<number, string[]> {
		const defaults = systemSettingsCtx.capabilityDefaults ?? {}
		const out: Record<number, string[]> = {}
		if (row.id == null) return out
		for (const model of row.models) {
			const labels = systemCapabilitiesForModel(
				defaults as any,
				row.id,
				model.id
			).map((capability) => {
				try {
					return capabilityLabel(capability as any)
				} catch {
					return capability
				}
			})
			if (labels.length) out[model.id] = labels
		}
		return out
	}

	/**
	 * Use, from a connection's model list (the desk table and the dock list):
	 * chat where the pair can serve it, otherwise the first thing it can.
	 *
	 * ⚠ Named rather than taken from [0]. `satisfiableTransforms` happens to
	 * return TRANSFORMS' declaration order, which puts chat first — but that is
	 * an accident of a table in the SDK, and a Use button that quietly
	 * registered an embedding model as what sessions reply with is not a
	 * thing to leave to one.
	 */
	function useModelOn(
		row: {
			id?: number
			models: readonly {
				id: number
				name: string
				satisfiableCapabilities?: readonly string[] | null
			}[]
		},
		modelId: number
	) {
		if (row.id == null) return
		const m = row.models.find((x) => x.id === modelId)
		if (!m) return
		const serves = m.satisfiableCapabilities ?? []
		const capability = serves.includes("text->text")
			? "text->text"
			: serves[0]
		if (!capability) return
		handlePairDefault(
			row.id,
			{ id: m.id, name: m.name },
			{ kind: "one", capability }
		)
	}
	/** The dock's inline model list on an API connection's view. */
	let dockModelsOpen = $state(false)

	function handlePairDefault(
		connectionId: number,
		model: { id: number; name: string },
		selection: PairDefaultSelection
	) {
		const capabilities =
			selection.kind === "all"
				? selection.capabilities
				: [selection.capability]
		const current = systemSettingsCtx.capabilityDefaults ?? {}
		const targets: PendingStarTarget[] = []
		for (const capability of capabilities) {
			const def = current[capability]
			if (
				def?.connectionId === connectionId &&
				(def?.connectionModelId ?? null) === model.id
			)
				continue
			targets.push({
				capability,
				id: connectionId,
				modelId: model.id,
				verb: sectionForCapability(capability)?.starVerb ?? capability
			})
		}
		if (!targets.length) return
		pendingStars = targets
		maybeConfirmStar()
	}
	/** Whether staging this target throws stored work away. */
	function targetSwitchesPair(
		target: PendingStarTarget,
		capability: string
	): boolean {
		if (target.capability !== capability) return false
		const current =
			systemSettingsCtx.capabilityDefaults?.[target.capability]
		if (current?.connectionId == null) return false
		return (
			current.connectionId !== target.id ||
			(current.connectionModelId ?? null) !== target.modelId
		)
	}
	const stagesNer = () =>
		!!pendingStars?.some(
			(t) =>
				sectionForCapability(t.capability)?.modality === "ner" &&
				targetSwitchesPair(t, t.capability)
		)
	function maybeConfirmStar() {
		if (!pendingStars?.length) return
		if (
			pendingStars.some((t) =>
				targetSwitchesPair(t, EMBEDDING_CAPABILITY)
			)
		) {
			reindexCost = null
			socket.emit("vectorization:reindexCost", {})
			showReindexModal = true
			return
		}
		if (stagesNer()) {
			reannotateRows = null
			socket.emit("ner:status", {})
			showReannotateModal = true
			return
		}
		commitSetDefault()
	}
	/** The reindex confirm chains into the re-annotate one when both are staged. */
	function confirmReindexModal() {
		showReindexModal = false
		if (stagesNer()) {
			reannotateRows = null
			socket.emit("ner:status", {})
			showReannotateModal = true
			return
		}
		commitSetDefault()
	}

	// ── Create / update / delete ────────────────────────────────────────────
	/** The category the Add picker opens narrowed to, if a door chose one. */
	let newConnectionCategory = $state<ConnectionServiceCategory | undefined>(
		undefined
	)
	function handleNew(opts: { category?: ConnectionServiceCategory } = {}) {
		newConnectionCategory = opts.category
		newConnectionName = ""
		newConnectionService = undefined
		nameTouched = false
		// Seed the picker's modality from where the person is standing: the
		// index's capability filter, or the open connection's own modality.
		const seed =
			view === "index"
				? sectionForCapability(
						(initialIndexFilter ?? "").replace(/^cap:/, "")
					)?.modality
				: (connection?.modality ?? selectedRow?.modality)
		newConnectionModality = seed ?? "text-gen"
		showNewConnectionModal = true
		if (panelsCtx.digest.tutorial) panelsCtx.digest.tutorial = false
		setTimeout(() => document.getElementById("newConnName")?.focus(), 100)
	}
	function handleNewConnectionConfirm() {
		const name = newConnectionName.trim()
		if (!name) {
			toaster.error({ title: "Connection name is required" })
			return
		}
		if (!newConnectionService) {
			toaster.error({ title: "Choose a service to connect to" })
			return
		}
		// Same rule the server enforces, checked up front so the dialog can
		// say it beside the field instead of as a corner toast.
		if (
			connectionsList.some(
				(c) =>
					(c.name ?? "").trim().toLowerCase() === name.toLowerCase()
			)
		) {
			toaster.error({
				title: `A connection named "${name}" already exists`
			})
			return
		}
		const { type, presetValue, presetSlug } = newConnectionService
		if (type === CONNECTION_TYPE.OPENAI) {
			const preset = OPENAI_COMPATIBLE_PRESETS.find(
				(p) => p.value === presetValue
			)
			if (!preset) {
				toaster.error({ title: "Invalid OpenAI preset" })
				return
			}
		}
		const newConn = {
			name,
			type,
			enabled: true,
			// Which named service this is, so capability resolution has a
			// preset layer to consult. Undefined for a native type and for
			// the custom entry: NULL means custom.
			preset: presetSlug,
			...(type === CONNECTION_TYPE.OPENAI
				? OPENAI_COMPATIBLE_PRESETS.find((p) => p.value === presetValue)
						?.connectionDefaults
				: CONNECTION_DEFAULTS[type] || {})
		}
		socket.emit("connections:create", { connection: newConn })
		// The dialog closes on the success response, not on the emit: a
		// refused name must leave it open with the typed values intact.
	}
	function handleNewConnectionCancel() {
		showNewConnectionModal = false
	}
	function handleUpdate() {
		socket.emit("connections:update", { connection })
	}
	function handleReset() {
		connection = { ...originalConnection }
	}
	function handleDelete() {
		showDeleteModal = true
	}
	function handleDeleteModalConfirm() {
		if (connection) socket.emit("connections:delete", { id: connection.id })
		showDeleteModal = false
	}
	function handleDeleteModalCancel() {
		showDeleteModal = false
	}
	function handleOnClose(): Promise<boolean> {
		// Only the connection view holds a draft; the model view writes
		// through on every control.
		if (view !== "connection" || !unsavedChanges)
			return Promise.resolve(true)
		showConfirmModal = true
		return new Promise<boolean>((resolve) => {
			confirmResolve = resolve
		})
	}
	async function handleModalDiscard() {
		showConfirmModal = false
		// Resolving confirmResolve is what lets Layout.svelte's closePanel()
		// proceed to unmount this whole component. Skeleton's Dialog
		// FocusTrap schedules its own async return-focus bookkeeping on
		// close; unmounting before it runs reads a derived whose owning
		// effect is gone ("derived_inert"). A double rAF reliably lands
		// after that pending frame of work.
		await new Promise<void>((resolve) =>
			requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
		)
		if (confirmResolve) confirmResolve(true)
	}
	function handleModalCancel() {
		showConfirmModal = false
		if (confirmResolve) confirmResolve(false)
	}

	// Keyboard shortcuts
	function handleKeydown(e: KeyboardEvent) {
		if ((e.ctrlKey || e.metaKey) && e.key === "n") {
			e.preventDefault()
			handleNew()
		}
		if (e.key === "Escape") {
			if (showNewConnectionModal) handleNewConnectionCancel()
			else if (showDeleteModal) handleDeleteModalCancel()
			else if (showConfirmModal) handleModalCancel()
		}
	}

	// ── Socket handlers ─────────────────────────────────────────────────────
	function handleConnectionsList(msg: Sockets.Connections.List.Response) {
		connectionsList = msg.connectionsList
			.slice()
			.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
		isLoading = false
	}
	// Layout's generic **:error listener already toasts this — this just
	// stops the spinner so the panel settles into the empty state.
	function handleConnectionsListError() {
		isLoading = false
	}
	function handleConnectionsGet(msg: Sockets.Connections.Get.Response) {
		// connections:get is emitToUser — broadcast to every open tab for
		// this user. Without this check, another tab loading a different
		// connection silently overwrites this tab's in-progress edit.
		if (msg.connection?.id !== selectedConnectionId) return
		connection = { ...msg.connection }
		originalConnection = { ...msg.connection }
		if (msg.connection.id === deepLinkedConnectionId)
			deepLinkedConnectionId = null
	}
	function handleConnectionsUpdate(msg: Sockets.Connections.Update.Response) {
		if (msg.connection?.id !== selectedConnectionId) return
		// Reset the unsaved-changes baseline synchronously with the save's
		// own ack — msg.connection is the same fully-processed record
		// connections:get produces.
		connection = { ...msg.connection }
		originalConnection = { ...msg.connection }
		toaster.success({ title: "Connection updated" })
		if (msg.notice)
			toaster.warning({
				title: "Preset not kept",
				description: msg.notice
			})
		announce(
			`Connection ${connection?.name} has been updated successfully${
				msg.notice ? `. ${msg.notice}` : ""
			}`
		)
		// The host or key may have changed; the models follow the save.
		requestSync(msg.connection.id, true)
	}
	function handleConnectionsDelete(msg: Sockets.Connections.Delete.Response) {
		if (msg.id !== selectedConnectionId) return
		const deletedName = connection?.name
		toaster.success({ title: "Connection deleted" })
		announce(`Connection ${deletedName} has been permanently deleted`)
		connection = undefined
		originalConnection = undefined
		backToIndex(null)
	}
	function handleConnectionsCreate(msg: Sockets.Connections.Create.Response) {
		if (!msg.connection?.id) return
		showNewConnectionModal = false
		toaster.success({ title: "Connection created" })
		announce(`New connection ${msg.connection?.name} has been created`)
		// Creating lands straight on the new connection's view: a connection
		// nobody has finished setting up is not done, and the index gives no
		// hint what is missing. Its models are asked for at once (forced —
		// there is no listing yet to be fresh). ⚠ Not forced for a managed
		// runtime: a KoboldCPP with no binary yet, or an Ollama nobody has
		// started, fails that listing by construction, and the forced path's
		// "Couldn't list models" toast would greet every first-run door. The
		// managed view's status card is where that fact belongs.
		const kind = endpointKind(msg.connection.type)
		const managed = kind === "koboldcpp-managed" || kind === "ollama"
		// The Set up chat flow creates its KoboldCPP itself and stays put:
		// its Runtime step IS the setup, so landing on the connection view
		// here would pull the person out of the flow they just entered.
		if (view === "setup-chat") {
			requestSync(msg.connection.id, false)
			return
		}
		void openConnection(msg.connection).then(() =>
			requestSync(msg.connection.id, !managed)
		)
	}
	function handleConnectionsSetDefault(
		msg: Sockets.Connections.SetDefault.Response
	) {
		// Patch the local copy so the star moves on this frame rather than
		// when the server's systemSettings:get push lands. Merged per
		// capability, never replaced wholesale.
		systemSettingsCtx.capabilityDefaults = {
			...systemSettingsCtx.capabilityDefaults,
			[msg.capability]: {
				...(systemSettingsCtx.capabilityDefaults?.[msg.capability] ?? {
					connectionId: null,
					samplingConfigId: null
				}),
				connectionId: msg.id ?? null,
				connectionModelId: msg.modelId ?? null
			}
		}
		if (msg.id) toaster.success({ title: "Default updated" })
	}

	/**
	 * Every key this panel holds, declared ABOVE the two effects that emit.
	 * Effects run in creation order and a request flushes the pending interest
	 * sync, so a declaration made below either of them would miss the flush its
	 * own first reply rides on.
	 *
	 * All of them are BARE and STANDING. `connections:list` is re-sent after
	 * every write (the stop scripts hold their own keys, in
	 * `ConnectionStopScripts`), the star's cost
	 * estimates are re-asked whenever a picker moves, and `connections:get` is
	 * scoped in the shared table but not declared that way here: this panel
	 * follows whichever connection is selected, and its
	 * `selectedConnectionId` guard is the narrower of the two checks.
	 */
	useInterest<"connections:list">("connections:list", handleConnectionsList)
	// The status card's newest fact (U6). Guarded by id: the reply is
	// emitToUser, so a test run in another tab for another connection lands
	// here too. A form's own inline Test feeds the same card.
	let lastTest = $state<LastTest | null>(null)
	let testing = $state(false)
	function handleConnectionsTestForChrome(
		msg: Sockets.Connections.Test.Response
	) {
		if (
			msg.connectionId == null ||
			msg.connectionId !== selectedConnectionId
		)
			return
		testing = false
		lastTest = { ok: msg.ok, error: msg.error ?? null, at: Date.now() }
	}
	useInterest<"connections:test">(
		"connections:test",
		handleConnectionsTestForChrome
	)
	function testAgain() {
		if (!connection) return
		testing = true
		socket.emit("connections:test", { connection })
	}
	$effect(() => {
		// A different connection is a different card.
		void selectedConnectionId
		lastTest = null
		testing = false
	})
	let addByNameOpen = $state(false)
	let addByNameModel = $state("")
	let addByNameLabel = $state("")
	function submitAddByName() {
		if (!selectedRow || !addByNameModel.trim()) return
		handleAddModel(selectedRow, addByNameModel, addByNameLabel)
		addByNameModel = ""
		addByNameLabel = ""
		addByNameOpen = false
	}
	useInterest<"connections:list:error">(
		"connections:list:error",
		handleConnectionsListError
	)
	useInterest<"connections:get">("connections:get", handleConnectionsGet)
	useInterest<"connections:update">(
		"connections:update",
		handleConnectionsUpdate
	)
	useInterest<"connections:delete">(
		"connections:delete",
		handleConnectionsDelete
	)
	useInterest<"connections:create">(
		"connections:create",
		handleConnectionsCreate
	)
	useInterest<"connections:setDefault">(
		"connections:setDefault",
		handleConnectionsSetDefault
	)
	useInterest<"connections:syncModels">(
		"connections:syncModels",
		handleSyncModels
	)
	/**
	 * Local ONNX file progress, patched into the list the index renders.
	 *
	 * ⚠ Here rather than in the index view, because THIS is where
	 * `connectionsList` lives: a download's progress moves one row's `local`
	 * and nothing else, so patching it in place keeps the bar moving without
	 * re-fetching every endpoint several times a second. The three events share
	 * one response shape on purpose — a press and its progress say the same
	 * thing about the same row.
	 *
	 * The server lane may not answer any of them yet. Nothing here breaks when
	 * it does not: the rows simply keep the `local` the sync gave them.
	 */
	useInterest<"connections:modelDownloadProgress">(
		"connections:modelDownloadProgress",
		handleModelLocalState
	)
	useInterest<"connections:downloadModel">(
		"connections:downloadModel",
		handleModelLocalState
	)
	useInterest<"connections:cancelModelDownload">(
		"connections:cancelModelDownload",
		handleModelLocalState
	)
	useInterest<"connections:syncModels:error">(
		"connections:syncModels:error",
		handleSyncModelsError
	)
	/**
	 * The re-index estimate. `vectorization:reindexCost` is not in
	 * `SCOPED_EVENTS` (it prices the whole index, not one book), and the panel
	 * asks for it again whenever the embedding model picker moves, so the key
	 * has to outlive each request.
	 */
	useInterest<"vectorization:reindexCost">(
		"vectorization:reindexCost",
		handleReindexCost
	)
	/**
	 * `ner:` is restricted interest — every handler in that family is
	 * admin-only. The registry would refuse this key for a non-admin anyway;
	 * asking first keeps the refusal out of the dev console for the many
	 * non-admins who open this panel to read the list.
	 */
	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		return declareInterest<"ner:status">("ner:status", handleNerStatus)
	})

	onMount(() => {
		socket.emit("connections:list", {})
		// The open-time sweep: every endpoint whose listing is stale is
		// re-asked. Fresh ones are skipped server-side, so this is free
		// most of the time.
		requestSync()

		// Seed the view: `initialConnectionId` (a page that embeds this
		// sidebar, addressed to this copy) or digest.connectionId (from
		// external nav, e.g. managed Ollama's "open connection") mean "go
		// straight to that connection"; digest.connectionsModality (the
		// onboarding wizard's retrieval step) seeds the index filter.
		// Otherwise, the index.
		//
		// Only the digest is CONSUMED. It is one shared slot, so leaving it
		// set would send the next copy to open to the same row; the prop is
		// this instance's own and clearing the digest on its behalf would take
		// a deep link away from whichever view it was actually meant for.
		const digestId = panelsCtx.digest.connectionId ?? null
		const deepLinkId = initialConnectionId ?? digestId
		if (deepLinkId) {
			if (initialConnectionId == null) {
				panelsCtx.digest.connectionId = undefined
			}
			deepLinkedConnectionId = deepLinkId
			view = "connection"
			selectedConnectionId = deepLinkId
			socket.emit("connections:get", { id: deepLinkId })
		} else if (panelsCtx.digest.connectionsModality) {
			openCategory(panelsCtx.digest.connectionsModality)
			panelsCtx.digest.connectionsModality = undefined
		}
		onclose = handleOnClose

		// Admin create page deep-link: open the new-connection flow at once.
		if (startNew) handleNew()
	})

	/**
	 * A first-run door named from outside (`digest.connectionsDoor`) — the
	 * home wizard's Choose an LLM step. An effect rather than part of the
	 * mount seed, so a press lands whether this view was already open or
	 * not. Consumed on read: the digest is one shared slot.
	 */
	$effect(() => {
		const door = panelsCtx.digest.connectionsDoor
		if (!door) return
		untrack(() => {
			panelsCtx.digest.connectionsDoor = undefined
			if (door === "setup-chat") openSetupChat()
			else if (door === "chat") openCapability("text->text")
			else handleNew({ category: door === "service" ? "cloud" : "local" })
		})
	})

	onDestroy(() => {
		onclose = undefined
	})
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	class="text-foreground flex h-full min-h-0 flex-col"
	role="region"
	aria-label="Connections"
	onkeydown={handleKeydown}
	use:viewMode.observe
>
	<div aria-live="polite" aria-atomic="true" class="sr-only">
		{announcements}
	</div>

	<!--
		340px of list, the rest is detail (STYLE-GUIDE §4.2). It was 380px,
		which made the list column NARROWER at full page than in the 400px
		dock — so expanding the view truncated more, not less.

		`empty` rather than `emptyMessage`: the pane with nothing selected is
		the readiness dashboard, not the line "Pick a connection, or add one."
		centred in 1,150px.
	-->
	<PanelSplit
		mode={viewMode.mode}
		hasDetail={view !== "index"}
		listWidth="340px"
		list={indexPane}
		detail={detailPane}
		empty={overviewPane}
	/>
</div>

{#snippet indexPane()}
	<ConnectionIndexView
		{connectionsList}
		capabilityDefaults={systemSettingsCtx.capabilityDefaults ?? {}}
		{isLoading}
		{syncingIds}
		{syncingAll}
		initialFilter={initialIndexFilter}
		focusConnectionId={indexFocusId}
		{selectedConnectionId}
		mode={viewMode.mode}
		detailOpen={view !== "index"}
		onShowAllJobs={() => void navigate(INDEX_ENTRY, true)}
		onAddNew={handleNew}
		onEnableManager={handleEnableManager}
		onOpenConnection={(row) => openConnection(row, true)}
		onOpenModel={(row, model) => openModel(row.id, model.id, true)}
		onOpenCapability={(capability) => openCapability(capability, true)}
		onSetUpChat={openSetupChat}
		onGetModel={(opts) => openFinder(opts ?? {}, true)}
		onOpenDownloads={() => openDownloads(true)}
		onRefresh={(row) => requestSync(row.id, true)}
		onAddModel={handleAddModel}
		onFacts={(facts) => (overviewFacts = facts)}
	/>
{/snippet}

<!--
	The detail pane at full page with nothing open. See `ConnectionsOverview`:
	`PanelSplit` has always taken this snippet and nobody had passed one.
-->
{#snippet overviewPane()}
	{#if overviewFacts}
		<ConnectionsOverview
			tiles={overviewFacts.tiles}
			connectionCount={overviewFacts.connectionCount}
			onOpenCapability={(capability) => openCapability(capability, true)}
			onGetModel={() => openFinder({}, true)}
		/>
	{/if}
{/snippet}

{#snippet detailPane()}
	{#if view === "model" && selectedConnectionId != null && selectedModelId != null}
		{@render modelPane(selectedConnectionId, selectedModelId)}
	{:else if view === "capability" && selectedCapability}
		<CapabilityView
			capability={selectedCapability}
			onBack={goBack}
			onOpenModel={(connectionId, modelId) =>
				openModel(connectionId, modelId)}
			onGetModel={(capability) => openFinder({ capability })}
			onSelectDefault={handlePairDefault}
		/>
	{:else if view === "finder"}
		<ModelFinderView
			capability={finderScope.capability}
			connectionId={finderScope.connectionId}
			onBack={goBack}
			onOpenConnection={(id) => openConnection({ id })}
		/>
	{:else if view === "downloads"}
		<DownloadsView onBack={goBack} />
	{:else if view === "setup-chat"}
		<SetupChatFlow
			connections={connectionsList}
			onEnsureRuntime={() => {
				enableManager("koboldcpp", socket, connectionsList)
			}}
			onSelectDefault={handlePairDefault}
			onOpenConnection={(id) => {
				const row = connectionsList.find((c) => c.id === id)
				if (row) void openConnection(row)
			}}
			onBack={goBack}
			onOpenSessions={() =>
				panelsCtx.openPanel({ key: "sessions", toggle: false })}
		/>
	{:else if openManagedKind}
		{@render managedPane(openManagedKind)}
	{:else}
		{@render connectionPane()}
	{/if}
{/snippet}

<!--
	A runtime this pub runs, as its connection's view (ruling R2).

	It replaces the form-only pane for the two rows that stand for an install,
	and carries the manager whole — status card, tabs, setup screens. The
	connection's own settings ride in as a snippet, so its forms stay bound to
	the one draft this panel holds.
-->
{#snippet managedPane(kind: ManagerKind)}
	<!-- Keyed: two managed connections must not share one view's tab, status
	     and reachability (plan 2026-09-24 B5), and the Ollama check runs on
	     mount. -->
	{#key selectedConnectionId}
		<ManagedConnectionView
			bind:tab={
				() => managedTabById.get(selectedConnectionId ?? 0) ?? "models",
				(value) => managedTabById.set(selectedConnectionId ?? 0, value)
			}
			{kind}
			connectionId={selectedConnectionId ?? 0}
			title={connection?.name ??
				selectedRow?.name ??
				(kind === "koboldcpp" ? "KoboldCPP" : "Ollama")}
			isAdmin={userCtx.user?.isAdmin ?? false}
			capabilityDefaults={systemSettingsCtx.capabilityDefaults ?? {}}
			managedConnectionIds={removalIds(kind)}
			connections={connectionsList.filter(
				(c): c is (typeof connectionsList)[number] & { id: number } =>
					c.id != null
			)}
			onOpenModel={(id, modelId) => openModel(id, modelId)}
			onSetDefault={(capability, id, model) =>
				handlePairDefault(id, model, { kind: "one", capability })}
			onBack={goBack}
			onRefreshModels={() => {
				if (selectedConnectionId != null)
					requestSync(selectedConnectionId, true)
			}}
			onRemove={() => removeManager(kind)}
			onOpenConnection={(id) => {
				const row = connectionsList.find((c) => c.id === id)
				if (row) void openConnection(row)
			}}
			connectionSettings={managedConnectionSettings}
		/>
	{/key}
{/snippet}

{#snippet managedConnectionSettings()}
	{#if !connection}
		<div class="flex items-center justify-center py-8">
			<Icons.Loader2 size={20} class="text-surface-600-400 animate-spin" />
		</div>
	{:else}
		{#key connection.id}
			<section aria-labelledby="managed-connection-details">
				<h3 id="managed-connection-details" class="sr-only">
					Settings for {connection.name}
				</h3>
				{@render connectionSaveRow(false)}
				{@render connectionFormBody()}
			</section>
		{/key}
	{/if}
{/snippet}

{#snippet endpointSettings()}
	<!-- Settings, Advanced and Delete for an endpoint the app does not run.
	     A snippet rather than inline markup because a LOCAL ONNX endpoint
	     renders it inside its own Settings tab (2026-09-25) and every other
	     type renders it straight down the pane. One copy either way. -->
			<section
				class="flex flex-col"
				aria-labelledby="connection-details"
			>
				<h3
					id="connection-details"
					class="mb-2 text-sm font-semibold"
				>
					Settings
				</h3>
				{@render connectionFormFields()}
			</section>

			<!-- Notes, capabilities, lane panels, stop scripts: one
			     disclosure, open by default only when a note exists —
			     a person who wrote one wants to see it. -->
			<details
				class="group border-surface-300-700 rounded-lg border"
				open={!!connection.notes}
			>
				<summary
					class="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-sm font-semibold"
				>
					<Icons.ChevronRight
						size={14}
						class="transition-transform group-open:rotate-90"
						aria-hidden="true"
					/>
					Advanced and notes
				</summary>
				<div class="px-3 pb-3">
					{@render connectionFormExtras()}
				</div>
			</details>

			<div class="flex justify-start pt-1">
				<button
					type="button"
					class="btn btn-sm hover:preset-tonal-error text-error-500"
					onclick={handleDelete}
					aria-label={`Delete connection ${connection.name}`}
				>
					<Icons.Trash2 size={14} aria-hidden="true" />
					Delete connection
				</button>
			</div>
{/snippet}

{#snippet modelPane(connectionId: number, modelId: number)}
	<!-- A local ONNX model is a FILE on this machine and a lane that may be
	     holding it, not a name an endpoint answers to — so it gets its own
	     view rather than a `ModelDetailView` whose every field is blank here.
	     Both halves come out of `connectionsList`, which is what a download's
	     progress is patched into, so the view moves with the bar. -->
	{@const onnxRow = connectionsList.find((c) => c.id === connectionId)}
	{@const onnxModel = onnxRow?.models.find((m) => m.id === modelId)}
	{#if onnxRow && onnxModel && isLocalOnnxType(onnxRow.type)}
		<OnnxModelView
			connection={onnxRow}
			model={onnxModel}
			capabilityDefaults={systemSettingsCtx.capabilityDefaults ?? {}}
			mode={viewMode.mode}
			isAdmin={userCtx.user?.isAdmin ?? false}
			onBack={goBack}
			onSelectDefault={(model, selection) =>
				handlePairDefault(connectionId, model, selection)}
		/>
	{:else}
		<ModelDetailView
			{connectionId}
			connectionName={selectedRow?.name ??
				connection?.name ??
				"Connection"}
			{modelId}
			capabilityDefaults={systemSettingsCtx.capabilityDefaults ?? {}}
			syncing={syncingAll || syncingIds.has(connectionId)}
			onBack={goBack}
			onSelectDefault={(model, selection) =>
				handlePairDefault(connectionId, model, selection)}
			onRefresh={() => requestSync(connectionId, true)}
			onOpenManager={openManager}
			onRemoved={handleModelRemoved}
		/>
	{/if}
{/snippet}

<!--
	Save / Reset / Delete, and the live region that announces the draft.

	A snippet since the 2026-09-17 fold (ruling R2): a managed runtime's view
	renders the same row inside its Settings tab, minus Delete — removing a
	manager is a different act with a different confirmation, and two buttons
	that both destroy the row would be two answers to one question.
-->
{#snippet connectionSaveRow(showDelete: boolean)}
	<div class="mb-3 flex gap-2" role="toolbar" aria-label="Connection actions">
		<button
			type="button"
			class="btn btn-sm preset-filled-primary-500 flex-1"
			onclick={handleUpdate}
			disabled={!unsavedChanges}
			aria-label={unsavedChanges
				? `Save changes to ${connection.name}`
				: "No changes to save"}
		>
			<Icons.Save size={16} aria-hidden="true" />
			Save
		</button>
		<button
			type="button"
			class="btn btn-sm preset-filled-surface-400-600"
			onclick={handleReset}
			disabled={!unsavedChanges}
			title="Reset unsaved changes"
			aria-label="Reset unsaved changes"
		>
			<Icons.RefreshCcw size={16} aria-hidden="true" />
		</button>
		{#if showDelete}
			<button
				type="button"
				class="btn btn-sm preset-filled-error-500"
				onclick={handleDelete}
				title={`Delete ${connection.name}`}
				aria-label={`Delete connection ${connection.name}`}
			>
				<Icons.Trash2 size={16} aria-hidden="true" />
			</button>
		{/if}
	</div>
	<div class="sr-only" aria-live="polite">
		{unsavedChanges ? "You have unsaved changes" : "All changes saved"}
	</div>
{/snippet}

<!--
	The connection's OWN settings: its name, its service form, its notes, its
	capabilities and its stop scripts.

	A snippet since the 2026-09-17 fold (ruling R2). A managed runtime's view
	renders these beneath the manager's own settings, so nothing a person could
	set before the fold went missing after it — and the forms stay bound to the
	one draft this panel holds, which a prop could not carry.
-->
{#snippet connectionFormBody()}
	{@render connectionFormFields()}
	{@render connectionFormExtras()}
{/snippet}

<!-- The settings proper: the name and the service's own form. -->
{#snippet connectionFormFields()}
	<div class="flex flex-col gap-1">
		<label class="font-semibold" for="connection-name">
			Connection name
		</label>
		<input
			id="connection-name"
			type="text"
			bind:value={connection.name}
			class="input"
			aria-required="true"
		/>
	</div>
	<ConnectionTypeForm bind:connection />
{/snippet}

<!-- Below the settings: notes, capabilities, the lane panels, stop scripts.
     The API connection view folds these under one disclosure (U6). -->
{#snippet connectionFormExtras()}
	<!-- A note is a margin note. -->
	<div class="mt-4 flex flex-col gap-1">
		<label class="font-semibold" for="connection-notes">Notes</label>
		<p id="notes-help" class="text-surface-600-400 text-xs">
			For you, not for the app — "use this one for prose, the other for
			extraction". Shown beside this connection wherever you pick one.
		</p>
		<textarea
			id="connection-notes"
			rows="3"
			maxlength={NOTE_MAX_LENGTH}
			bind:value={connection.notes}
			onblur={() => (connection.notes = normalizeNote(connection.notes))}
			class="textarea"
			placeholder="Anything you want to remember about this connection."
			aria-describedby="notes-help"
		></textarea>
		{#if (connection.notes?.length ?? 0) > NOTE_MAX_LENGTH - 200}
			<p class="text-warning-500 text-xs">
				{NOTE_MAX_LENGTH - (connection.notes?.length ?? 0)} characters left.
			</p>
		{/if}
	</div>

	{#if connection.id}
		<ConnectionCapabilities connectionId={connection.id} />
		{#if connection.modality === "embeddings"}
			<!-- The indexing queue, as this connection's
			     detail panel — shown as its own when the
			     embeddings default targets it. -->
			<EmbeddingQueuePanel
				isStarred={systemSettingsCtx.capabilityDefaults?.[
					"text->embedding"
				]?.connectionId === connection.id}
			/>
		{/if}
		{#if connection.modality === "ner"}
			<NerLanePanel
				isStarred={systemSettingsCtx.capabilityDefaults?.[
					"text->entities"
				]?.connectionId === connection.id}
			/>
		{/if}
		<!-- Stop guards ride the connection (18 §4b). -->
		<div class="mt-4">
			<ConnectionStopScripts connectionId={connection.id} />
		</div>
	{/if}
{/snippet}

{#snippet paneServiceChip()}
	{@const managed =
		endpointKind(connection?.type ?? selectedRow?.type) ===
			"koboldcpp-managed" ||
		endpointKind(connection?.type ?? selectedRow?.type) === "ollama"}
	<span
		class="shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-normal {managed
			? 'preset-tonal-tertiary'
			: 'border-surface-300-700 text-surface-600-400 border'}"
	>
		{paneService}
	</span>
{/snippet}

{#snippet connectionPane()}
	<!--
		ONE API connection's view (concept ruling, U6): the *whether* above the
		*how*. A status card (does it answer), a models card (what it lists,
		with Refresh and Add by name), then the form under a Settings heading,
		the rest under one disclosure, Delete at the foot, and Save / Discard
		only while there is something to save. Forms keep their internals.
	-->
	<div class="flex h-full min-h-0 flex-col">
		<div class="shrink-0 pb-2">
			<PanelNavHeader
				title="Connection"
				onBack={goBack}
				backLabel="Back to all connections"
				titleClass="text-sm"
			/>
		</div>
		<div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-2">
			<DetailHero
				title={paneTitle}
				icon={Icons.Plug}
				chips={showPaneChip ? paneServiceChip : undefined}
			/>
			{#if !connection}
				<div class="flex items-center justify-center py-8">
					<Icons.Loader2
						size={20}
						class="text-surface-600-400 animate-spin"
					/>
				</div>
			{:else}
				{#key connection.id}
					{#if selectedRow && !isLocalOnnxType(connection.type)}
						{@const syncing =
							syncingAll || syncingIds.has(connection.id)}
						{@const line = statusLine({
							lastTest,
							testing,
							syncing,
							modelsSync: selectedRow.modelsSync,
							modelCount: selectedRow.models.length,
							missingCount: selectedMissingCount,
							timeAgo
						})}
						{@const unfinished = needsCredential({
							type: connection.type,
							preset: selectedRow.preset,
							baseUrl: connection.baseUrl,
							hasCredential: selectedRow.hasCredential
						})}
						{@const keyUrl = keyUrlFor({
							type: connection.type,
							preset: selectedRow.preset
						})}
						{@const apiTabs = apiConnectionTabs(connection.type)}
						{@const apiTab = activeApiTab(
							apiTabs,
							apiTabById.get(connection.id),
							unfinished
						)}
						<!--
							The status card.

							⚠ While a key is still missing it does NOT report the
							listing failure that missing key obviously caused.
							The shipped view greeted a ten-second-old connection
							with a red "Couldn't list models · Missing
							credentia…" — a symptom of a thing nobody had done
							yet, reported as a fault. Ask whether it is finished
							before asking whether it works.
						-->
						<section
							class="panel-card flex flex-col gap-2 {unfinished
								? 'border-primary-500/30!'
								: ''}"
							aria-label="Status"
						>
							<div class="flex min-w-0 items-center gap-2">
								{#if unfinished}
									<Icons.CircleAlert
										size={16}
										class="text-primary-500 shrink-0"
										aria-hidden="true"
									/>
									<span
										class="text-primary-700 dark:text-primary-300 shrink-0 text-sm font-medium"
									>
										Needs an API key
									</span>
								{:else}
									<span
										class="size-2 shrink-0 rounded-full {CHROME_DOT[
											line.dot
										]}"
										aria-hidden="true"
									></span>
									<span class="shrink-0 text-sm font-medium">
										{line.word}
									</span>
									<span
										class="text-surface-600-400 min-w-0 flex-1 truncate text-xs"
										title={line.sentence}
									>
										· {line.sentence}
									</span>
								{/if}
								<div class="flex-1"></div>
								<button
									type="button"
									class="btn btn-sm preset-tonal shrink-0"
									disabled={testing}
									onclick={testAgain}
								>
									{lastTest ? "Test again" : "Test"}
								</button>
							</div>
							{#if unfinished}
								<p class="text-surface-600-400 text-xs">
									Nothing has failed — this connection isn't
									finished. Put a key in <strong
										class="text-surface-950-50 font-medium"
									>
										API key
									</strong>
									in Settings, then press Test.
									{#if keyUrl}
										<!-- Underlined: a link inside a text block
										     may not rely on colour alone
										     (axe: `link-in-text-block`). -->
										<a
											class="anchor underline underline-offset-2"
											href={keyUrl}
											target="_blank"
											rel="noopener noreferrer"
										>
											Get a key ↗
										</a>
									{/if}
								</p>
							{/if}
						</section>

						<!-- Owner ruling 2026-09-25: every connection has a Settings tab,
						     Models appears where the API lists a choice, and the strip
						     is drawn only when there is more than one tab. The status
						     card stays ABOVE it, as the managed runtimes' does: whether
						     it answers is true of the whole connection, not one tab. -->
						{#if showsTabStrip(apiTabs)}
							<PanelTabStrip
								tabs={apiTabs.map((t) => ({
									value: t.value,
									label: t.label,
									icon: (Icons as any)[t.icon] ?? Icons.Package
								}))}
								bind:value={
									() => apiTab,
									(value) => apiTabById.set(connection.id, value)
								}
								ariaLabel="{connection.name} sections"
								panelIdPrefix="api-connection"
							/>
						{/if}

						{#if apiTab === "models"}
						<!-- The models card: how many, whether the host still
						     lists them all, and the two presses the index
						     used to hold for this connection. -->
						<section
							class="panel-card flex flex-col gap-2"
							aria-label="Models"
						>
							<div class="flex min-w-0 items-center gap-2">
								<Icons.Boxes
									size={16}
									class="text-surface-500 shrink-0"
									aria-hidden="true"
								/>
								<p
									class="min-w-0 flex-1 truncate text-sm font-medium"
								>
									{modelsHeadline({
										modelCount: selectedRow.models.length,
										missingCount: selectedMissingCount
									})}
								</p>
								<button
									type="button"
									class="btn btn-icon btn-icon-sm hover:preset-tonal-primary shrink-0"
									disabled={syncing}
									onclick={() =>
										requestSync(connection.id, true)}
									title="Ask the host for its models again"
									aria-label="Refresh models"
								>
									<Icons.RefreshCw
										size={14}
										class={syncing ? "animate-spin" : ""}
										aria-hidden="true"
									/>
								</button>
							</div>
							<!--
								At desk width the models are a TABLE, with the
								context and price columns 400px cannot hold. In
								the dock the same rows are `ModelRow`s, shown
								in place under "Show N models" — one list, two shapes.
							-->
							{#if viewMode.mode === "desk" && selectedRow.models.length}
								<ModelTable
									models={selectedRow.models}
									defaultsByModel={defaultsByModel(
										selectedRow
									)}
									local={endpointKind(connection.type) !==
										"api"}
									onOpen={(modelId) =>
										openModel(connection.id, modelId)}
									onUse={(modelId) =>
										useModelOn(selectedRow, modelId)}
									onToggleEnabled={(modelId, enabled) =>
										socket.emit("connections:updateModel", {
											id: connection.id,
											modelId,
											model: { enabled }
										})}
								/>
							{/if}
							<div class="flex flex-wrap gap-2">
								{#if selectedRow.models.length && viewMode.mode !== "desk"}
									<!-- The dock's list, in place. "Browse
									     models" went back to the index, which
									     has listed no models since R1 (plan
									     2026-09-24 C3). -->
									<button
										type="button"
										class="btn btn-sm preset-tonal"
										aria-expanded={dockModelsOpen}
										onclick={() =>
											(dockModelsOpen = !dockModelsOpen)}
									>
										{dockModelsOpen
											? "Hide models"
											: `Show ${selectedRow.models.length} models`}
										{#if dockModelsOpen}
											<Icons.ChevronUp
												size={14}
												aria-hidden="true"
											/>
										{:else}
											<Icons.ChevronDown
												size={14}
												aria-hidden="true"
											/>
										{/if}
									</button>
								{/if}
								{#if manualAddAllowed(connection.type)}
									<button
										type="button"
										class="btn btn-sm hover:preset-tonal"
										aria-expanded={addByNameOpen}
										onclick={() =>
											(addByNameOpen = !addByNameOpen)}
									>
										<Icons.Plus
											size={14}
											aria-hidden="true"
										/>
										Add by name
									</button>
								{/if}
							</div>
							{#if dockModelsOpen && viewMode.mode !== "desk"}
								{@const byModel = defaultsByModel(selectedRow)}
								<div class="flex flex-col gap-3">
									{#each selectedRow.models as m (m.id)}
										<ModelRow
											model={m}
											defaultFor={byModel[m.id] ?? []}
											canUse={!!(
												m.satisfiableCapabilities ?? []
											).length &&
												!(byModel[m.id] ?? []).length}
											onOpen={() =>
												openModel(connection.id, m.id)}
											onUse={() =>
												useModelOn(selectedRow, m.id)}
										/>
									{/each}
								</div>
							{/if}
							{#if addByNameOpen}
								<!-- For a host that serves no model list: a
								     compatible endpoint with no /models, a
								     catalogue that lags a launch. -->
								<form
									class="border-surface-300-700 flex flex-col gap-2 border-t pt-2"
									onsubmit={(e) => {
										e.preventDefault()
										submitAddByName()
									}}
								>
									<label
										class="text-surface-600-400 text-xs"
										for="connection-add-by-name-model"
									>
										Model identifier, exactly as the host
										expects it
									</label>
									<input
										id="connection-add-by-name-model"
										class="input"
										type="text"
										bind:value={addByNameModel}
										placeholder="gpt-4o-mini"
										required
									/>
									<label
										class="text-surface-600-400 text-xs"
										for="connection-add-by-name-label"
									>
										Shown as (optional)
									</label>
									<input
										id="connection-add-by-name-label"
										class="input"
										type="text"
										bind:value={addByNameLabel}
									/>
									<div class="flex justify-end gap-2">
										<button
											type="button"
											class="btn btn-sm hover:preset-tonal"
											onclick={() =>
												(addByNameOpen = false)}
										>
											Cancel
										</button>
										<button
											type="submit"
											class="btn btn-sm preset-filled-primary-500"
											disabled={!addByNameModel.trim()}
										>
											Add model
										</button>
									</div>
								</form>
							{/if}
						</section>
						{/if}

						{#if apiTab === "settings"}
							{@render endpointSettings()}
						{/if}
					{/if}

					<!-- A local ONNX endpoint has no host to reach and no key
					     to paste: what there IS to know about it is which
					     model is in charge and what is on this machine. -->
					{#if selectedRow && isLocalOnnxType(connection.type)}
						<OnnxEndpointView
							connection={selectedRow}
							capabilityDefaults={systemSettingsCtx.capabilityDefaults ??
								{}}
							mode={viewMode.mode}
							isAdmin={userCtx.user?.isAdmin ?? false}
							onOpenModel={(model) =>
								openModel(connection.id, model.id)}
							onMakeActive={(model) => {
								const capability = starCapabilityOf(selectedRow)
								if (capability)
									handlePairDefault(connection.id, model, {
										kind: "one",
										capability
									})
							}}
							onDownload={(model) =>
								downloadOnnxModel(connection.id, model.id)}
							onRetry={(model) =>
								downloadOnnxModel(connection.id, model.id)}
							onCancel={(model) =>
								cancelOnnxDownload(connection.id, model.id)}
							connectionSettings={endpointSettings}
						/>
					{/if}

					<!-- No list row yet (it is still loading): the form alone, as
					     before. With a row, the tabs above own it. -->
					{#if !selectedRow && !isLocalOnnxType(connection.type)}
						{@render endpointSettings()}
					{/if}
				{/key}
			{/if}
		</div>
		{#if connection && unsavedChanges}
			<!-- Only while there is something to save. -->
			<div
				class="border-surface-300-700 bg-surface-50-950 flex shrink-0 gap-2 border-t pt-2"
				role="toolbar"
				aria-label="Unsaved changes"
			>
				<button
					type="button"
					class="btn btn-sm preset-filled-primary-500 flex-1"
					onclick={handleUpdate}
					aria-label={`Save changes to ${connection.name}`}
				>
					<Icons.Save size={16} aria-hidden="true" />
					Save
				</button>
				<button
					type="button"
					class="btn btn-sm preset-tonal"
					onclick={handleReset}
					aria-label="Discard unsaved changes"
				>
					Discard
				</button>
			</div>
		{/if}
		<div class="sr-only" aria-live="polite">
			{unsavedChanges ? "You have unsaved changes" : "All changes saved"}
		</div>
	</div>
{/snippet}

<Dialog
	open={showConfirmModal}
	onOpenChange={(e) => (showConfirmModal = e.open)}
>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 w-full max-w-lg space-y-6 p-6 shadow-xl"
			>
				<div
					role="dialog"
					aria-labelledby="confirm-title"
					aria-describedby="confirm-desc"
				>
					<header class="flex justify-between">
						<h2 id="confirm-title" class="h2">Discard changes?</h2>
					</header>
					<article>
						<p id="confirm-desc" class="opacity-60">
							Your connection has unsaved changes. Discard them?
						</p>
					</article>
					<footer class="flex justify-end gap-4">
						<button
							class="btn preset-filled-surface-500"
							onclick={handleModalCancel}
							aria-label="Cancel and keep unsaved changes"
						>
							Keep editing
						</button>
						<button
							class="btn preset-filled-error-500"
							onclick={handleModalDiscard}
							aria-label="Discard all unsaved changes"
						>
							Discard
						</button>
					</footer>
				</div>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
<Dialog
	open={showNewConnectionModal}
	onOpenChange={(e) => (showNewConnectionModal = e.open)}
>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 max-h-[90vh] w-full max-w-2xl space-y-6 overflow-y-auto p-6 shadow-xl"
			>
				<div
					role="dialog"
					aria-labelledby="new-conn-title"
					aria-describedby="new-conn-desc"
				>
					<header class="mb-[1em] flex justify-between">
						<h2 id="new-conn-title" class="h2">New connection</h2>
					</header>
					<div id="new-conn-desc" class="sr-only">
						Create a new connection to a service
					</div>
					<form
						class="flex flex-col gap-2"
						onsubmit={(e) => {
							e.preventDefault()
							handleNewConnectionConfirm()
						}}
					>
						<div>
							<label class="font-semibold" for="newConnName">
								Connection name
							</label>
							<input
								id="newConnName"
								type="text"
								class="input w-full"
								bind:value={newConnectionName}
								placeholder="Enter a descriptive name…"
								aria-required="true"
								oninput={() => (nameTouched = true)}
								onkeydown={(e) => {
									if (
										e.key === "Enter" &&
										newConnectionName.trim()
									)
										handleNewConnectionConfirm()
								}}
							/>
						</div>
						<div>
							<ConnectionServicePicker
								label="Service"
								initialModality={newConnectionModality}
								initialCategory={newConnectionCategory}
								bind:selectedItem={newConnectionService}
							/>
						</div>
						{#if newConnectionService}
							<div
								class="bg-surface-500/25 mt-4 flex flex-col gap-2 rounded p-4"
							>
								<span class="preset-filled-primary-500 p-2">
									Difficulty: {newConnectionService.difficulty}
								</span>
								{@html newConnectionService.description}
							</div>
						{/if}
					</form>
					<footer class="mt-4 flex justify-end gap-4">
						<button
							type="button"
							class="btn preset-filled-surface-500"
							onclick={handleNewConnectionCancel}
							aria-label="Cancel connection creation"
						>
							Cancel
						</button>
						<button
							type="submit"
							class="btn preset-filled-primary-500"
							onclick={handleNewConnectionConfirm}
							disabled={!newConnectionName.trim() ||
								!newConnectionService}
							aria-label={!newConnectionName.trim()
								? "Enter a name to create connection"
								: !newConnectionService
									? "Choose a service to create connection"
									: `Create connection named ${newConnectionName}`}
						>
							Create
						</button>
					</footer>
				</div>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
<!-- Switching the embedding connection re-indexes everything. The number is
     the whole point of this dialog. -->
<Dialog
	open={showReindexModal}
	onOpenChange={(e) => (showReindexModal = e.open)}
>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 w-full max-w-lg space-y-5 p-6 shadow-xl"
			>
				<div
					role="alertdialog"
					aria-labelledby="reindex-title"
					aria-describedby="reindex-desc"
				>
					<header>
						<h2 id="reindex-title" class="h2 text-lg font-bold">
							{embeddingNext
								? `Switch embeddings to ${embeddingNext}?`
								: "Switch the embedding model?"}
						</h2>
						<p class="text-surface-600-400 mt-1 text-sm">
							{#if embeddingCurrent}
								Replaces {embeddingCurrent.model.name} as the one
								embedding model for this install.
							{:else if embeddingNext}
								Sets {embeddingNext} as the embedding model for this
								install.
							{:else}
								One embedding model runs for this whole install.
							{/if}
						</p>
					</header>
					<!-- What it costs, boxed: three consequences, each its own
					     line, most expensive first. NO time estimate — nothing
					     in the queue measures throughput, so there is no honest
					     rate to put here. -->
					<article
						id="reindex-desc"
						class="preset-tonal-surface mt-4 space-y-2 rounded-lg p-3 text-sm"
					>
						<p class="flex items-start gap-2">
							<Icons.AlertTriangle
								class="text-warning-500 mt-0.5 h-4 w-4 shrink-0"
								aria-hidden="true"
							/>
							<span>
								{#if reindexRows === null}
									<span class="text-surface-600-400">
										Counting what is stored…
									</span>
								{:else}
									<strong class="font-semibold">
										{reindexRows.toLocaleString()}
										stored {reindexRows === 1
											? "vector is"
											: "vectors are"} re-embedded
									</strong>
									{#if reindexCost?.lorebooks || reindexCost?.sessions || reindexCost?.byKind}
										{#if reindexCost.lorebooks || reindexCost.sessions}
											<span>
												— every entry in {(
													reindexCost.lorebooks ?? 0
												).toLocaleString()}
												{(reindexCost.lorebooks ??
													0) === 1
													? "lorebook"
													: "lorebooks"} and the history
												of {(
													reindexCost.sessions ?? 0
												).toLocaleString()}
												{(reindexCost.sessions ?? 0) ===
												1
													? "session"
													: "sessions"}.
											</span>
										{/if}
									{/if}
									<span>
										Vectors from the old model don't match
										the new one.
									</span>
								{/if}
							</span>
						</p>
						<p class="text-surface-600-400">
							Until it finishes, retrieval answers from keywords
							only.
						</p>
						{#if embeddingCurrentIsLocal}
							<p class="text-surface-600-400">
								{embeddingCurrent?.model.name} stays on disk. Switching
								back later re-embeds again.
							</p>
						{/if}
					</article>
					<footer class="mt-5 flex justify-end gap-2">
						<button
							type="button"
							class="btn preset-filled-surface-500"
							onclick={() => {
								showReindexModal = false
								pendingStars = null
							}}
						>
							{embeddingCurrent
								? `Keep ${embeddingCurrent.model.name}`
								: "Cancel"}
						</button>
						<button
							type="button"
							class="btn preset-filled-primary-500"
							onclick={confirmReindexModal}
						>
							<Icons.RefreshCw size={16} aria-hidden="true" />
							Switch and re-embed
						</button>
					</footer>
				</div>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
<Dialog
	open={showReannotateModal}
	onOpenChange={(e) => (showReannotateModal = e.open)}
>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 w-full max-w-lg space-y-5 p-6 shadow-xl"
			>
				<div
					role="alertdialog"
					aria-labelledby="reannotate-title"
					aria-describedby="reannotate-desc"
				>
					<header>
						<h2 id="reannotate-title" class="h2 text-lg font-bold">
							{entityNext
								? `Switch entity extraction to ${entityNext}?`
								: "Switch the entity model?"}
						</h2>
						<p class="text-surface-600-400 mt-1 text-sm">
							{#if entityCurrent}
								Replaces {entityCurrent.model.name} as the one entity
								model for this install.
							{:else if entityNext}
								Sets {entityNext} as the entity model for this install.
							{:else}
								One entity model runs for this whole install.
							{/if}
						</p>
					</header>
					<article
						id="reannotate-desc"
						class="preset-tonal-surface mt-4 space-y-2 rounded-lg p-3 text-sm"
					>
						<p class="flex items-start gap-2">
							<Icons.AlertTriangle
								class="text-warning-500 mt-0.5 h-4 w-4 shrink-0"
								aria-hidden="true"
							/>
							<span>
								{#if reannotateRows === null}
									<span class="text-surface-600-400">
										Counting what is annotated…
									</span>
								{:else}
									<strong class="font-semibold">
										{reannotateRows.toLocaleString()}
										{reannotateRows === 1
											? "entry or message is"
											: "entries and messages are"} re-scanned
										for names
									</strong>
									<span>
										Names one model finds are not the names
										another finds.
									</span>
								{/if}
							</span>
						</p>
						<p class="text-surface-600-400">
							Names your lorebook declares keep matching
							throughout.
						</p>
						{#if entityCurrentIsLocal}
							<p class="text-surface-600-400">
								{entityCurrent?.model.name} stays on disk. Switching
								back later re-scans again.
							</p>
						{/if}
					</article>
					<footer class="mt-5 flex justify-end gap-2">
						<button
							type="button"
							class="btn preset-filled-surface-500"
							onclick={() => {
								showReannotateModal = false
								pendingStars = null
							}}
						>
							{entityCurrent
								? `Keep ${entityCurrent.model.name}`
								: "Cancel"}
						</button>
						<button
							type="button"
							class="btn preset-filled-primary-500"
							onclick={() => {
								showReannotateModal = false
								commitSetDefault()
							}}
						>
							<Icons.RefreshCw size={16} aria-hidden="true" />
							Switch and re-scan
						</button>
					</footer>
				</div>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
<Dialog open={showDeleteModal} onOpenChange={(e) => (showDeleteModal = e.open)}>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 w-full max-w-lg space-y-6 p-6 shadow-xl"
			>
				<div
					role="alertdialog"
					aria-labelledby="delete-title"
					aria-describedby="delete-desc"
				>
					<header class="flex justify-between">
						<h2 id="delete-title" class="h2">Delete connection</h2>
					</header>
					<article>
						<p id="delete-desc" class="opacity-60">
							Delete "{connection?.name}" and its models? Anything
							set to use them will need another choice. This
							cannot be undone.
						</p>
					</article>
					<footer class="flex justify-end gap-4">
						<button
							type="button"
							class="btn preset-filled-surface-500"
							onclick={handleDeleteModalCancel}
							aria-label="Cancel deletion and keep the connection"
						>
							Cancel
						</button>
						<button
							type="button"
							class="btn preset-filled-error-500"
							onclick={handleDeleteModalConfirm}
							aria-label="Permanently delete this connection"
						>
							Delete connection
						</button>
					</footer>
				</div>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
