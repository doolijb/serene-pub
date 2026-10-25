<script lang="ts">
	/**
	 * The Connections view (rail key `connections`) — where models run: the
	 * hosts this pub talks to, the runtimes it manages, and the models inside
	 * each. Making sessions work — which model each job uses, getting a model,
	 * Set up chat, the downloads tray, the Defaults ledger — is the **Models**
	 * view's (`ModelsSidebar`, rail key `models`; PLAN-models-connections-split
	 * 2026-10-11).
	 *
	 * Three places, and only three (design 2026-10-09 C.1, `navStack.ts`):
	 *
	 * - **index**: every endpoint as a row or a card with its type, state and
	 *   model count (`ConnectionIndexView`; notes 42, 2026-10-03). With
	 *   nothing open at desk width it takes the whole view.
	 * - **connection**: one endpoint — its status, its MODELS (the Models
	 *   tab lists them: a table where the pane is wide, model rows where it
	 *   is not; Use, hide, Refresh, Add by name) and its settings. A managed
	 *   runtime's view carries the same inside its own tabs (its own finder
	 *   among them), as does a local ONNX endpoint's.
	 * - **model**: one model's own settings (`ModelDetailView`), opened from
	 *   its connection.
	 *
	 * Dialogs over whatever is open: New connection, Add a model by name (on
	 * the open connection), Delete, and the unsaved-changes confirmation.
	 *
	 * ## One way to choose (C.3)
	 *
	 * Every press here that makes a model the one a job uses — the Models
	 * tab's Use / Use in Reply, a model's Set as default…, a managed
	 * runtime's Use, a local ONNX model's Make active — calls
	 * `chooseJobModel` (the connections context): one costed confirmation
	 * (the re-embed and re-scan questions, `useStarConfirm`), one write
	 * (`connections:setDefault`), one toast.
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
	import { useConnections } from "$lib/client/contexts/connections.svelte"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
	import {
		getContext,
		onDestroy,
		onMount,
		untrack,
		type Snippet
	} from "svelte"
	import { SvelteMap } from "svelte/reactivity"
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
	import { CONNECTION_STATE_DOT } from "$lib/client/components/connections/connectionRowStatus"
	import { serviceLabel } from "$lib/client/components/connections/connectionIndexFilter"
	import { connectionTypeIcon } from "$lib/client/components/connections/connectionTypeIcon"
	import ModelRow from "$lib/client/components/connections/ModelRow.svelte"
	import ConnectionIndexView from "$lib/client/components/connections/ConnectionIndexView.svelte"
	import { ViewModeTracker } from "$lib/client/shell/viewMode.svelte"
	import PanelSplit from "$lib/client/components/panels/PanelSplit.svelte"
	import PanelNavHeader from "$lib/client/components/panels/PanelNavHeader.svelte"
	import DetailHero from "$lib/client/components/panels/DetailHero.svelte"
	import LoadingState from "$lib/client/components/LoadingState.svelte"
	import EmptyState from "$lib/client/components/EmptyState.svelte"
	import ConnectionTypeForm from "$lib/client/components/connections/ConnectionTypeForm.svelte"
	import ConnectionStopScripts from "$lib/client/components/connections/ConnectionStopScripts.svelte"
	import ModelDetailView from "$lib/client/components/connections/ModelDetailView.svelte"
	import EmbeddingSwitchDialog from "$lib/client/components/connections/EmbeddingSwitchDialog.svelte"
	import {
		addressOf,
		useEmbeddingEditConfirm
	} from "$lib/client/components/connections/useEmbeddingEditConfirm.svelte"
	import OnnxModelView from "$lib/client/components/connections/OnnxModelView.svelte"
	import OnnxEndpointView from "$lib/client/components/connections/OnnxEndpointView.svelte"
	import {
		endpointKind,
		isLocalOnnxType,
		type ModelManager
	} from "$lib/client/components/connections/modelManagement"
	import type { ManagerKind } from "$lib/client/components/connections/managers"
	import PanelTabStrip from "$lib/client/components/panels/PanelTabStrip.svelte"
	import ManagedConnectionView from "$lib/client/components/connections/ManagedConnectionView.svelte"
	import ComfyWorkflowsTab from "$lib/client/components/connections/comfy/ComfyWorkflowsTab.svelte"
	import { managedConnectionIds } from "$lib/client/components/connections/managedConnectionView"
	import {
		activeApiTab,
		apiConnectionTabs,
		chatDefaultFirst,
		modelMatchesQuery,
		modelsHeadline,
		nextStep,
		showsModelsFilter,
		showsTabStrip,
		statusLine,
		type LastTest
	} from "$lib/client/components/connections/connectionViewChrome"
	import PanelFilterInput from "$lib/client/components/panels/PanelFilterInput.svelte"
	import {
		keyUrlFor,
		needsCredential
	} from "$lib/shared/connections/credentials"
	import { manualAddAllowed } from "$lib/client/components/connections/modelManagement"
	import ModelTable from "$lib/client/components/connections/ModelTable.svelte"
	import { timeAgo } from "$lib/client/utils/timeAgo"
	import {
		sectionForCapability,
		sectionForModality
	} from "$lib/shared/constants/connectionSections"
	import { EMBEDDING_CAPABILITY } from "$lib/shared/constants/embeddings"
	import type {
		ConnectionServiceCategory,
		ConnectionServiceItem
	} from "$lib/shared/utils/connectionServiceItems"
	import { connectionTypeDisabledReason } from "$lib/shared/utils/connectionServiceItems"
	import {
		NOTE_MAX_LENGTH,
		normalizeNote
	} from "$lib/shared/utils/connectionNotes"

	interface Props {
		onclose?: () => Promise<boolean> | undefined
	}

	let { onclose = $bindable() }: Props = $props()
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
	/**
	 * The status card's edge, by its next step's connection state: gold while
	 * the next move is the person's, red for a saved key that still fails,
	 * green once replies come from here.
	 */
	const NEXT_STEP_EDGE: Record<string, string> = {
		unfinished: "border-primary-500/30!",
		broken: "border-error-500/30!",
		ready: "border-success-500/30!"
	}

	// ── View state ──────────────────────────────────────────────────────────
	/**
	 * The three places are the same three at every width — what changes is
	 * whether opening one REPLACES the index or sits beside it. At desk width
	 * the index is a column that stays put, so `view` stops meaning "which
	 * screen" and means only "what, if anything, is open on the right".
	 */
	const vm = new ViewModeTracker()
	let view = $state<NavView>("index")
	/** The model whose detail view is open. Set with the view. */
	let selectedModelId = $state<number | null>(null)

	/** Seeds the index filter (a `cap:<transform>` value, or null). */
	let initialIndexFilter = $state<string | null>(null)
	/** The group the index scrolls to on return from a connection or model. */
	let indexFocusId = $state<number | null>(null)

	// ── Data ────────────────────────────────────────────────────────────────
	/**
	 * The list, model sync and the one way to choose live in the connections
	 * context (contexts/connections.svelte.ts), held while this view is
	 * mounted — declared ABOVE the effects that ask for the list.
	 */
	const conns = useConnections()
	const connectionsList: ListRow[] = $derived(conns.list)
	const isLoading = $derived(conns.loading)
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
	/**
	 * Two independent copies of a connection record.
	 *
	 * ⚠ Never a shallow spread: `{ ...proxy }` copies the top level only, so
	 * the draft and the baseline would share one nested `extraJson` proxy and
	 * a later nested edit would change both — the unsaved-changes check
	 * would never see it. Snapshot, then clone, so neither copy aliases the
	 * other or the source.
	 */
	function cloneConnection<T>(source: T): T {
		return structuredClone($state.snapshot(source)) as T
	}
	/** `enableManager`, remembering the name of any row it asks to create. */
	const enableManagerHere = conns.enableManagerHere
	let showConfirmModal = $state(false)
	let confirmResolve: ((v: boolean) => void) | null = null
	let showNewConnectionModal = $state(false)
	let newConnectionName = $state("")
	let newConnectionService: ConnectionServiceItem | undefined = $state()
	/**
	 * Why the chosen service can't be created on this machine, or null. The
	 * picker already disables such a card; this covers a choice made before
	 * the machine's verdict arrived, and Enter in the name field, which
	 * submits without the Create button.
	 */
	const newConnectionBlocked = $derived(
		connectionTypeDisabledReason(
			newConnectionService?.type,
			systemSettingsCtx?.settings?.localOnnxAvailability
		)
	)
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
	// The context's own sentences (a choice, a create) are said here too.
	$effect(() => conns.onAnnounce(announce))

	// ── Model sync ──────────────────────────────────────────────────────────
	/** Endpoints with a sync in flight, and the open-time sweep. */
	const syncingIds = conns.syncingIds
	const syncingAll = $derived(conns.syncingAll)
	const requestSync = conns.requestSync
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

	// ── Navigation ──────────────────────────────────────────────────────────
	/**
	 * Land on the index with its filter seeded. A modality seed maps to the
	 * section's capability — endpoints are not pure by modality, so there is
	 * no modality filter left to seed.
	 */
	function openCategory(m: string) {
		const section = sectionForModality(m)
		initialIndexFilter = section ? `cap:${section.starCapability}` : null
		navStack.clear()
		view = "index"
	}

	// ── The trail Back walks (plan 2026-09-24 B1, design 2026-10-09 C.1) ────
	/**
	 * Where Back goes: up one level, always. `navStack.ts` keeps the trail —
	 * never more than a connection and a model below the index — and Back
	 * restores its entry whole, connection included, re-fetched when the
	 * draft is gone.
	 */
	const navStack = createNavStack()
	/**
	 * Land on an entry.
	 *
	 * The ONE place view state is written, so a door cannot forget half of it:
	 * the selection follows the entry, and a connection whose draft is not the
	 * one in hand is cleared and fetched, never shown under another
	 * connection's name (B2/B3).
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
	 * Go to a place. `fromList` is a door in the index list: the list is
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
		dropDiscardedDraft()
		navStack.go(entry, { fresh: fromList })
		applyEntry(entry)
		return true
	}
	/** Back: up one level — the connection a model was opened from, or the index. */
	async function goBack() {
		if (!(await handleOnClose())) return
		const leavingId = selectedConnectionId
		dropDiscardedDraft()
		const target = navStack.back()
		applyEntry(target)
		if (target.view === "index") landOnIndex(leavingId)
	}

	/**
	 * Back for the CONNECTION level (an API connection's pane or a managed
	 * runtime's view): compact only. At desk the list stands beside it, and
	 * the level above a connection is always that list. A model replaces the
	 * connection in the detail pane, so the model level keeps its Back at both
	 * widths (STYLE-GUIDE §6.3).
	 */
	const connectionBack = $derived(vm.mode === "compact" ? goBack : undefined)

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
	 * Switch a manager on, and land on the connection it is about.
	 *
	 * Both halves, because the flag alone is invisible: before the rebuild the
	 * switch lived in Settings → System and the connection had to be created
	 * separately, which is two screens for one intention. A row that already
	 * exists is opened; a missing one is created, and `handleConnectionsCreate`
	 * opens it when the server answers.
	 */
	function handleEnableManager(kind: ManagerKind) {
		const { connectionId } = enableManagerHere(kind)
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
	 * A door to a manager opens its connection.
	 *
	 * The managers fold into their connection with the 2026-09-17 ruling (R2),
	 * so "open the KoboldCPP manager" and "open the KoboldCPP connection" are
	 * one act — a place, so it goes on the trail as a connection does, and a
	 * model's "Open KoboldCPP" replaces the model rather than stacking on it.
	 * A manager nobody has switched on has no row to open, so the press
	 * switches it on and lands on the row that appears — the same two halves
	 * the Add menu does.
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
	 * ⚠ Make active is NOT here. It is `chooseJobModel` like every other
	 * choice, so the costed confirmation stands in front of it.
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

	// ── One way to choose (design 2026-10-09 C.3) ───────────────────────────
	/**
	 * THE way a model becomes the one a job uses, with its costed
	 * confirmation, lives in the connections context: one confirmation, one
	 * write (`connections:setDefault`), one toast.
	 */
	const chooseJobModel = conns.chooseJobModel
	const jobsOf = conns.jobsOf

	const currentDefaultModel = conns.currentDefaultModel
	const defaultsByModel = conns.defaultsByModel
	const useModelOn = conns.useModelOn
	/**
	 * The Models tab's own measured width: a table from 640px, model rows
	 * under it. Measured, not `vm` — at Half the view is compact while
	 * the pane is wide enough for the table.
	 */
	let modelsPaneWidth = $state(0)

	// ── Create / update / delete ────────────────────────────────────────────
	/** The category the Add picker opens narrowed to, if a door chose one. */
	let newConnectionCategory = $state<ConnectionServiceCategory | undefined>(
		undefined
	)
	/**
	 * 🚧 The address, asked in the dialog of a service whose whole setup it is
	 * (`setupNeed: 'address'` — Custom (OpenAI-compatible), 2026-10-18, the
	 * 100-turn walk #31: the address was never asked, and the card blamed a
	 * missing key).
	 */
	let newConnectionBaseUrl = $state("")
	const newConnectionAsksAddress = $derived(newConnectionService?.setupNeed === "address")
	function handleNew(opts: { category?: ConnectionServiceCategory } = {}) {
		newConnectionCategory = opts.category
		newConnectionName = ""
		newConnectionService = undefined
		newConnectionBaseUrl = ""
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
		if (newConnectionBlocked) {
			toaster.error({ title: newConnectionBlocked })
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
		const baseUrl = newConnectionAsksAddress ? newConnectionBaseUrl.trim() : ""
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
				: CONNECTION_DEFAULTS[type] || {}),
			// 🚧 The address the dialog asked for, over the preset's blank one.
			...(baseUrl ? { baseUrl } : {})
		}
		conns.expectCreate(name)
		socket.emit("connections:create", { connection: newConn })
		// The dialog closes on the success response, not on the emit: a
		// refused name must leave it open with the typed values intact.
	}
	function handleNewConnectionCancel() {
		showNewConnectionModal = false
	}
	/**
	 * Saving an edit of the starred embedding connection that makes it
	 * another model — another host — re-embeds the index, so it asks first,
	 * with the star's own confirmation (`useEmbeddingEditConfirm`). A
	 * respelled address is the same model and saves straight away.
	 */
	const embeddingEdits = useEmbeddingEditConfirm()
	async function handleUpdate() {
		if (!connection) return
		const draft = $state.snapshot(connection)
		const before = originalConnection
		if ((draft.baseUrl ?? "") !== (before?.baseUrl ?? "")) {
			const starred = currentDefaultModel(EMBEDDING_CAPABILITY)
			const name = starred?.model.name ?? draft.name
			const ok = await embeddingEdits.confirmEdit({
				connectionId: draft.id,
				edit: { baseUrl: draft.baseUrl ?? "" },
				currentName: `${name} at ${addressOf(before?.baseUrl)}`,
				nextName: `${name} at ${addressOf(draft.baseUrl)}`
			})
			if (!ok) return
		}
		socket.emit("connections:update", { connection: draft })
	}
	/** The same question for renaming the starred model's identifier. */
	function confirmIdentifier(
		connectionId: number,
		row: { id: number; model: string },
		next: string
	): Promise<boolean> {
		if (next.trim() === row.model.trim()) return Promise.resolve(true)
		return embeddingEdits.confirmEdit({
			connectionId,
			modelId: row.id,
			edit: { model: next },
			currentName: row.model,
			nextName: next.trim()
		})
	}
	function handleReset() {
		connection = cloneConnection(originalConnection)
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
	function handleConnectionsGet(msg: Sockets.Connections.Get.Response) {
		// connections:get is emitToUser — broadcast to every open tab for
		// this user. Without this check, another tab loading a different
		// connection silently overwrites this tab's in-progress edit.
		if (msg.connection?.id !== selectedConnectionId) return
		connection = cloneConnection(msg.connection)
		originalConnection = cloneConnection(msg.connection)
		if (msg.connection.id === deepLinkedConnectionId)
			deepLinkedConnectionId = null
	}
	function handleConnectionsUpdate(msg: Sockets.Connections.Update.Response) {
		if (msg.connection?.id !== selectedConnectionId) return
		// Reset the unsaved-changes baseline synchronously with the save's
		// own ack — msg.connection is the same fully-processed record
		// connections:get produces.
		connection = cloneConnection(msg.connection)
		originalConnection = cloneConnection(msg.connection)
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
		// The host or key may have changed; the models follow the save —
		// forced by the same rule create uses (see handleConnectionsCreate):
		// never where the listing fails by construction, or the forced
		// path's "Couldn't list models" toast lands on top of the save's.
		requestSync(msg.connection.id, syncMayForce(msg.connection))
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
	const syncMayForce = conns.syncMayForce
	/**
	 * A create this tab asked for (the context said "Connection created"):
	 * the Add menu, New connection and a managed runtime's finder all ask
	 * through `conns.expectCreate` / `enableManagerHere`, so a foreign ack is
	 * never `mine`. (Set up chat's runtime is asked for from the Models view,
	 * where this view is not mounted.)
	 */
	function handleConnectionsCreate(
		msg: Sockets.Connections.Create.Response,
		{ mine }: { mine: boolean }
	) {
		if (!msg.connection?.id || !mine) return
		showNewConnectionModal = false
		// Creating lands straight on the new connection's view: a connection
		// nobody has finished setting up is not done, and the index gives no
		// hint what is missing. Its models are asked for at once (forced —
		// there is no listing yet to be fresh) unless `syncMayForce` says
		// the listing would fail by construction. The list reply lands
		// before this one, so the new row is in it.
		const force = syncMayForce(msg.connection)
		void openConnection(msg.connection).then(() =>
			requestSync(msg.connection.id, force)
		)
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
	/** Start a session: the Sessions view, as Set up chat's Done card opens it. */
	function openSessions() {
		panelsCtx.openPanel({ key: "sessions", toggle: false })
	}
	/** The Models tab's filter text (drawn past twelve models). */
	let modelsQuery = $state("")
	$effect(() => {
		// A different connection is a different card.
		void selectedConnectionId
		lastTest = null
		testing = false
		modelsQuery = ""
	})
	/** The chat default with both halves resolved off the list, or `{}`. */
	const chatPair = $derived(conns.chatPair)
	const servesChat = conns.servesChat
	const useLabelOf = conns.useLabelOf
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
	useInterest<"connections:get">("connections:get", handleConnectionsGet)
	useInterest<"connections:update">(
		"connections:update",
		handleConnectionsUpdate
	)
	useInterest<"connections:delete">(
		"connections:delete",
		handleConnectionsDelete
	)
	$effect(() => conns.onCreated(handleConnectionsCreate))

	onMount(() => {
		conns.requestList()
		// The open-time sweep: every endpoint whose listing is stale is
		// re-asked. Fresh ones are skipped server-side, so this is free
		// most of the time.
		requestSync()

		// Seed the view: digest.connectionId (from external nav, e.g. managed
		// Ollama's "open connection", a Jump hit) means "go straight to that
		// connection"; digest.connectionsModality (the onboarding wizard's
		// retrieval step) seeds the index filter. Otherwise, the index.
		//
		// The digest is CONSUMED: it is one shared slot, so leaving it set
		// would send the next copy to open to the same row.
		const deepLinkId = panelsCtx.digest.connectionId ?? null
		if (deepLinkId) {
			panelsCtx.digest.connectionId = undefined
			deepLinkedConnectionId = deepLinkId
			const entry = entryFor("connection", { connectionId: deepLinkId })
			navStack.go(entry, { fresh: true })
			view = entry.view
			selectedConnectionId = deepLinkId
			socket.emit("connections:get", { id: deepLinkId })
		} else if (panelsCtx.digest.connectionsModality) {
			openCategory(panelsCtx.digest.connectionsModality)
			panelsCtx.digest.connectionsModality = undefined
		}
		onclose = handleOnClose
		seeded = true
	})

	/** The mount seed above has run; later deep links are the effect's. */
	let seeded = $state(false)

	/**
	 * A connection named from outside (`digest.connectionId`) while this view
	 * is already open — the home wizard's checklist ("Open {name}"). The
	 * mount seed takes the first one; this takes every later one, through
	 * `openConnection` so an unsaved draft is asked about first. Consumed on
	 * read: the digest is one shared slot.
	 */
	$effect(() => {
		const id = panelsCtx.digest.connectionId
		if (!seeded || id == null) return
		untrack(() => {
			panelsCtx.digest.connectionId = undefined
			void openConnection({ id })
		})
	})

	/**
	 * A first-run door named from outside (`digest.connectionsDoor`) — the
	 * home wizard's Choose an AI step. An effect rather than part of the
	 * mount seed, so a press lands whether this view was already open or
	 * not. Only the two doors that are New connection (`"service"`,
	 * `"local"`) are this view's; `"setup-chat"` and `"chat"` — and
	 * `digest.connectionsJob` — belong to the Models view, which consumes
	 * them, so they are left in the slot untouched. Consumed on read: the
	 * digest is one shared slot.
	 */
	$effect(() => {
		const door = panelsCtx.digest.connectionsDoor
		if (door !== "service" && door !== "local") return
		untrack(() => {
			panelsCtx.digest.connectionsDoor = undefined
			handleNew({ category: door === "service" ? "cloud" : "local" })
		})
	})

	onDestroy(() => {
		onclose = undefined
	})
</script>

<!-- The keydown is the view's Ctrl+N (New connection) and Escape for its
     dialogs, caught as they bubble from whatever inside has focus. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="flex h-full min-h-0 flex-col"
	onkeydown={handleKeydown}
	use:vm.observe
>
	<div aria-live="polite" aria-atomic="true" class="sr-only">
		{announcements}
	</div>

	{@render indexPane()}
</div>

<!--
	The connections are the view (notes 42, owner 2026-10-03). With nothing
	open at desk width the index takes the whole view — the connections as
	rows or cards, centred at the app's reading
	width (§5.3) — rather than a 340px column beside a dashboard pane: the
	list the view is named for is the main thing on it, not a sidebar to it
	(`listFills`, ruling Q5). Opening a connection or a model splits it:
	340px of list, the rest detail (§4.2). One split for both desk states, so
	opening something re-lays the list rather than remounting it.

	The index hands its toolbar and body back through `frame`, so the
	toolbar is pinned over the list's one scroller while the filter and the
	live statuses stay in the one `ConnectionIndexView`.
-->
{#snippet indexFrame(toolbar: Snippet, list: Snippet)}
	<PanelSplit
		mode={vm.mode}
		hasDetail={view !== "index"}
		listFills
		listWidth="340px"
		{toolbar}
		{list}
		detail={detailPane}
	/>
{/snippet}

{#snippet indexPane()}
	<ConnectionIndexView
		frame={indexFrame}
		{connectionsList}
		capabilityDefaults={systemSettingsCtx.capabilityDefaults ?? {}}
		{isLoading}
		{syncingIds}
		{syncingAll}
		initialFilter={initialIndexFilter}
		focusConnectionId={indexFocusId}
		{selectedConnectionId}
		mode={vm.mode}
		detailOpen={view !== "index"}
		onAddNew={handleNew}
		onEnableManager={handleEnableManager}
		onOpenConnection={(row) => openConnection(row, true)}
		onRefresh={(row) => requestSync(row.id, true)}
	/>
{/snippet}

{#snippet detailPane()}
	{#if view === "model" && selectedConnectionId != null && selectedModelId != null}
		{@render modelPane(selectedConnectionId, selectedModelId)}
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
				chooseJobModel(capability, { connectionId: id, model })}
			onBack={connectionBack}
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
		<LoadingState message="Loading the connection…" />
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
	<section class="flex flex-col" aria-labelledby="connection-details">
		<h3 id="connection-details" class="mb-2 text-sm font-medium">
			Settings
		</h3>
		{@render connectionFormFields()}
	</section>

	<!-- Notes, capabilities, lane panels, stop scripts: one
			     disclosure, open by default only when a note exists —
			     a person who wrote one wants to see it. -->
	<details
		class="group panel-edge rounded-lg border"
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
			class="btn btn-sm hover:preset-tonal-error text-error-600-400"
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
			mode={vm.mode}
			isAdmin={userCtx.user?.isAdmin ?? false}
			onBack={goBack}
			onSelectDefault={(model, selection) =>
				chooseJobModel(jobsOf(selection), { connectionId, model })}
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
				chooseJobModel(jobsOf(selection), { connectionId, model })}
			onRefresh={() => requestSync(connectionId, true)}
			onOpenManager={openManager}
			onRemoved={handleModelRemoved}
			confirmIdentifier={(row, next) =>
				confirmIdentifier(connectionId, row, next)}
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
			class="btn btn-sm preset-tonal-surface"
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
		class="shrink-0 rounded-full px-1.5 py-0.5 text-meta font-normal {managed
			? 'preset-tonal-tertiary'
			: 'panel-edge text-surface-600-400 border'}"
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
	<!-- Header, body and save bar pinned in one column: the form is long,
	     so the body alone scrolls between a fixed header and a fixed bar. -->
	<div class="flex h-full min-h-0 flex-col gap-3">
		<PanelNavHeader
			title="Connection"
			onBack={connectionBack}
			backLabel="Back to all connections"
		/>
		<div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-2">
			<DetailHero
				title={paneTitle}
				icon={connectionTypeIcon(
					connection?.type ?? selectedRow?.type,
					Icons.Plug
				)}
				chips={showPaneChip ? paneServiceChip : undefined}
			/>
			{#if !connection}
				<LoadingState message="Loading the connection…" />
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
						{@const next = nextStep({
							lastTest,
							testing,
							syncing,
							modelsSync: selectedRow.modelsSync,
							modelCount: selectedRow.models.length,
							missingCount: selectedMissingCount,
							timeAgo,
							keyMissing: unfinished,
							hasCredential: !!selectedRow.hasCredential,
							unsaved: unsavedChanges,
							servesChat: selectedRow.models.some(servesChat),
							chat: chatPair.model
								? {
										onThisConnection:
											chatPair.connection?.id ===
											connection.id,
										modelName: chatPair.model.name
									}
								: null
						})}
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
							class="panel-card flex flex-col gap-2 {NEXT_STEP_EDGE[
								next?.state ?? (unfinished ? 'unfinished' : '')
							] ?? ''}"
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
										class="text-primary-ink shrink-0 text-sm font-medium"
									>
										Needs an API key
									</span>
								{:else}
									<span
										class="size-2 shrink-0 rounded-full {CONNECTION_STATE_DOT[
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
								<!-- The one filled button on the card exactly when the
								     line below names it; "again" then too, so the
								     sentence and the button say the same word. -->
								<button
									type="button"
									class="btn btn-sm shrink-0 {next?.action ===
									'test'
										? 'preset-filled-primary-500'
										: 'preset-tonal'}"
									disabled={testing}
									onclick={testAgain}
								>
									{lastTest || next?.action === "test"
										? "Test again"
										: "Test"}
								</button>
							</div>
							<!--
								The next step (plan 2026-10-06 §B): one sentence
								naming the control by its word, and a button only
								where the control is not already in view — Save is
								the bar at the foot and Test is the button above,
								so those two draw none. It REPLACED the shipped
								"Nothing has failed — … then press Test", which
								told a person to press the one button that does
								not clear "Needs an API key".
							-->
							{#if next}
								<div
									class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2"
									data-next-step={next.state}
								>
									<p
										class="text-surface-600-400 min-w-0 flex-1 basis-48 text-xs"
										role="status"
									>
										{#each next.parts as part, i (i)}
											{#if typeof part === "string"}{part}{:else}<strong
													class="text-surface-950-50 font-medium"
												>
													{part.strong}
												</strong>{/if}
										{/each}
										{#if unfinished && keyUrl}
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
									{#if next.action === "models" && apiTab !== "models" && apiTabs.some((t) => t.value === "models")}
										<button
											type="button"
											class="btn btn-sm preset-filled-primary-500 shrink-0"
											onclick={() =>
												apiTabById.set(
													connection.id,
													"models"
												)}
										>
											<Icons.Package
												size={16}
												aria-hidden="true"
											/>
											Choose a model
										</button>
									{:else if next.action === "session"}
										<!-- The same press as Set up chat's Done card. -->
										<button
											type="button"
											class="btn btn-sm preset-filled-primary-500 shrink-0"
											onclick={openSessions}
										>
											<Icons.MessageSquare
												size={16}
												aria-hidden="true"
											/>
											Start a session
										</button>
									{/if}
								</div>
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
									icon:
										(Icons as any)[t.icon] ?? Icons.Package
								}))}
								bind:value={
									() => apiTab,
									(value) =>
										apiTabById.set(connection.id, value)
								}
								ariaLabel="{connection.name} sections"
								panelIdPrefix="api-connection"
							/>
						{/if}

						{#if apiTab === "models"}
							<!-- The models card: how many, whether the host still
						     lists them all, and the two presses the index
						     offers for this connection. The tab strip's
						     panel when there is one (its tab names it). -->
							<section
								class="panel-card flex flex-col gap-2"
								id="api-connection-models"
								role={showsTabStrip(apiTabs)
									? "tabpanel"
									: undefined}
								aria-labelledby={showsTabStrip(apiTabs)
									? "api-connection-models-tab"
									: undefined}
								aria-label={showsTabStrip(apiTabs)
									? undefined
									: "Models"}
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
											modelCount:
												selectedRow.models.length,
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
											class={syncing
												? "animate-spin"
												: ""}
											aria-hidden="true"
										/>
									</button>
								</div>
								<!--
								The connection's models, listed in place — this is
								where models live now (notes 42): the index lists
								connections, and opening one shows what it holds.
								Where the pane is wide they are a TABLE, with the
								context and price columns 400px cannot hold;
								narrower, the same models are `ModelRow`s. One
								list, two shapes, decided by the pane's own
								measured width — at Half the detail is ~650px and
								takes the table, in the dock it takes rows.
							-->
								{#if selectedRow.models.length}
									{@const ordered = chatDefaultFirst(
										selectedRow.models,
										chatPair.connection?.id ===
											connection.id
											? chatPair.model?.id
											: null
									)}
									<!-- The chat default leads both shapes: its star
								     said WHICH model replies, and on a 500-model
								     list it said so on row 212. -->
									<div
										class="min-w-0"
										bind:clientWidth={modelsPaneWidth}
									>
										{#if modelsPaneWidth >= 640}
											<ModelTable
												models={ordered}
												defaultsByModel={defaultsByModel(
													selectedRow
												)}
												local={endpointKind(
													connection.type
												) !== "api"}
												{useLabelOf}
												onOpen={(modelId) =>
													openModel(
														connection.id,
														modelId
													)}
												onUse={(modelId) =>
													useModelOn(
														selectedRow,
														modelId
													)}
												onToggleEnabled={(
													modelId,
													enabled
												) =>
													socket.emit(
														"connections:updateModel",
														{
															id: connection.id,
															modelId,
															model: { enabled }
														}
													)}
											/>
										{:else}
											{@const byModel =
												defaultsByModel(selectedRow)}
											{@const filtering =
												showsModelsFilter(
													selectedRow.models.length
												)}
											{@const shown = filtering
												? ordered.filter((m) =>
														modelMatchesQuery(
															m,
															modelsQuery
														)
													)
												: ordered}
											<div
												class="flex flex-col gap-3"
												data-connection-models
											>
												{#if filtering}
													<PanelFilterInput
														bind:value={modelsQuery}
														placeholder="models"
														singular="model"
														count={selectedRow
															.models.length}
														aria-label="Filter models by name or identifier"
													/>
												{/if}
												{#each shown as m (m.id)}
													<!-- The whole verb in the dock too while
												     chat is unset: it is the word the
												     status card tells a person to press. -->
													<ModelRow
														model={m}
														defaultFor={byModel[
															m.id
														] ?? []}
														canUse={!!(
															m.satisfiableCapabilities ??
															[]
														).length &&
															m.enabled !==
																false &&
															!(
																byModel[m.id] ??
																[]
															).length}
														useLabel={useLabelOf(m)}
														useShortLabel={useLabelOf(
															m
														)}
														onOpen={() =>
															openModel(
																connection.id,
																m.id
															)}
														onUse={() =>
															useModelOn(
																selectedRow,
																m.id
															)}
													/>
												{:else}
													<EmptyState
														icon={Icons.SearchX}
														message="Nothing matches."
														ctaLabel="Clear filter"
														onCta={() =>
															(modelsQuery = "")}
													/>
												{/each}
											</div>
										{/if}
									</div>
								{/if}
								{#if manualAddAllowed(connection.type)}
									<div class="flex flex-wrap gap-2">
										<button
											type="button"
											class="btn btn-sm hover:preset-tonal"
											aria-expanded={addByNameOpen}
											onclick={() =>
												(addByNameOpen =
													!addByNameOpen)}
										>
											<Icons.Plus
												size={14}
												aria-hidden="true"
											/>
											Add by name
										</button>
									</div>
								{/if}
								{#if addByNameOpen}
									<!-- For a host that serves no model list: a
								     compatible endpoint with no /models, a
								     catalogue that lags a launch. -->
									<form
										class="panel-edge flex flex-col gap-2 border-t pt-2"
										onsubmit={(e) => {
											e.preventDefault()
											submitAddByName()
										}}
									>
										<label
											class="text-surface-600-400 text-xs"
											for="connection-add-by-name-model"
										>
											Model identifier, exactly as the
											host expects it
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

						{#if apiTab === "workflows"}
							<!-- 🚧 A ComfyUI's workflows (§4.12): their one home. -->
							<div
								id="api-connection-workflows"
								role={showsTabStrip(apiTabs)
									? "tabpanel"
									: undefined}
								aria-labelledby={showsTabStrip(apiTabs)
									? "api-connection-workflows-tab"
									: undefined}
							>
								<ComfyWorkflowsTab
									connectionId={connection.id}
									baseUrl={connection.baseUrl}
								/>
							</div>
						{/if}

						{#if apiTab === "settings"}
							<div
								id="api-connection-settings"
								role={showsTabStrip(apiTabs)
									? "tabpanel"
									: undefined}
								aria-labelledby={showsTabStrip(apiTabs)
									? "api-connection-settings-tab"
									: undefined}
							>
								{@render endpointSettings()}
							</div>
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
							mode={vm.mode}
							isAdmin={userCtx.user?.isAdmin ?? false}
							onOpenModel={(model) =>
								openModel(connection.id, model.id)}
							onMakeActive={(model) => {
								const capability = starCapabilityOf(selectedRow)
								if (capability)
									chooseJobModel(capability, {
										connectionId: connection.id,
										model
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
				class="panel-edge bg-surface-50-950 flex shrink-0 gap-2 border-t pt-2"
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

<!-- 🚧 Mounted only while open (PLAN-dc-after-walk3 R3-5, #48): two views
     hold this sidebar, and each left a hidden "Discard changes?". -->
{#if showConfirmModal}
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
							class="btn preset-tonal-surface"
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
{/if}
<Dialog
	open={showNewConnectionModal}
	onOpenChange={(e) => (showNewConnectionModal = e.open)}
>
	<!-- 🚧 Mounted only while open (Q3-6, #48): the Connections and Models
	     views each hold this sidebar, and each left a hidden New connection. -->
	{#if showNewConnectionModal}
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
								<!-- The reason first, as on the picker's card: the
								     server would refuse Create. What the service
								     asks of the person is the chip on that card;
								     a filled "Difficulty:" pill here read as a
								     second button and is gone (plan 2026-10-06 §D). -->
								{#if newConnectionBlocked}
									<span
										class="preset-tonal-warning p-2 break-words"
									>
										{newConnectionBlocked}
									</span>
								{/if}
								{@html newConnectionService.description}
							</div>
							{#if newConnectionAsksAddress}
								<div class="mt-2">
									<label class="font-semibold" for="newConnBaseUrl">
										Base URL
									</label>
									<input
										id="newConnBaseUrl"
										type="url"
										class="input w-full"
										bind:value={newConnectionBaseUrl}
										placeholder={newConnectionService.type === CONNECTION_TYPE.OPENAI
											? "http://localhost:8080/v1"
											: ((CONNECTION_DEFAULTS as Record<string, { baseUrl?: string }>)[newConnectionService.type]?.baseUrl ?? "")}
										autocomplete="off"
									/>
									<p class="text-surface-600-400 mt-1 text-xs">
										The server's address, as its own settings or documentation give it{newConnectionService.type === CONNECTION_TYPE.OPENAI ? " — usually ending in /v1" : ""}. You can change it later in the connection's settings.
									</p>
								</div>
							{/if}
						{/if}
					</form>
					<footer class="mt-4 flex justify-end gap-4">
						<button
							type="button"
							class="btn preset-tonal-surface"
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
								!newConnectionService ||
								!!newConnectionBlocked}
							aria-label={!newConnectionName.trim()
								? "Enter a name to create connection"
								: !newConnectionService
									? "Choose a service to create connection"
									: newConnectionBlocked
										? `Create connection — ${newConnectionBlocked}`
										: `Create connection named ${newConnectionName}`}
						>
							Create
						</button>
					</footer>
				</div>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
	{/if}
</Dialog>
<!-- An edit of the starred connection that makes it another model re-embeds;
     the number is the whole point of this dialog. (A choice's own two
     questions are the shell's — `ConnectionsDialogs`.) -->
<EmbeddingSwitchDialog {...embeddingEdits.dialog} />
<!-- 🚧 …and a hidden "Delete connection" (R3-5, #48). -->
{#if showDeleteModal}
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
							class="btn preset-tonal-surface"
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
{/if}
