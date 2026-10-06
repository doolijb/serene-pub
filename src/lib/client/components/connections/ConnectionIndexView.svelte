<script lang="ts">
	/**
	 * The OPENING view of connections — what this pub can do, and what it is
	 * connected to.
	 *
	 * ## Connections are the list (notes 42, owner 2026-10-03)
	 *
	 * The per-modality defaults stay at the top — the status strip (chat) and
	 * the jobs grid folded to the other three modalities — and everything
	 * under them is the CONNECTIONS: one row, or one card (`ConnectionCard`,
	 * the list/card pair on the find row), per endpoint with its type, its
	 * state and its model count. A connection's models live inside it: open
	 * it and its Models tab lists them (a table where the pane is wide).
	 * No dashboard pane sits beside this list: with nothing open at desk
	 * width it takes the whole view, so the jobs grid is here, once, at
	 * every width (`JobsGrid columns="fit"`, off the list's own container).
	 *
	 * The toolbar is the shared `ViewToolbar` (STYLE-GUIDE §6.3): Add (the
	 * New menu) and Get a model on the action row; the filter, its popout and
	 * the list/card pair on the find row; the narrowing in force as a chip.
	 *
	 * ## History
	 *
	 * Two things, in that order, and models are in neither of them. Until
	 * 2026-09-17 this was Connection → Models: a card per endpoint with its
	 * models listed inside it, a pill row of defaults above, and a filter that
	 * narrowed MODELS. The concept ruling (R1) reverses that. A person opening
	 * this panel is asking one of two questions — "can this thing reply yet"
	 * and "what have I plugged in" — and a list of forty model names answers
	 * neither. Models moved to the capability view and the model finder; what
	 * is left here is readiness (the status strip and, in a column, the jobs
	 * grid) and a list of connections.
	 *
	 * Top to bottom: the Add row, the filter row, the status strip and jobs
	 * grid, the connections, and the downloads tray while anything is
	 * arriving.
	 *
	 * ## The filter's unit is the connection now
	 *
	 * Same values (`IndexFilter`), because a `cap:` value is seeded from
	 * outside — Jump, the onboarding wizard, the panels digest — but a
	 * capability filter now keeps CONNECTIONS that have at least one model able
	 * to serve it. In a popout rather than a pill row, matching the Characters
	 * view: seven rows will not fit across 400px and a strip that scrolls
	 * sideways is a strip nobody reads the end of.
	 *
	 * ## Defaults is not a filter over the list
	 *
	 * It swaps the list for the ledger, with the status strip still above it.
	 * See `DefaultsLedger`'s header for why.
	 *
	 * ## Live status, asked for only where it applies
	 *
	 * A managed KoboldCPP's process, an Ollama host's version, the two local
	 * ONNX lanes — asked for HERE, once, and only when the list actually
	 * contains a connection of that kind. Every one of them may stay silent (a
	 * manager switched off, a server build without the handler yet); a silent
	 * one leaves its clause out of the row's sentence rather than claiming
	 * anything (see `connectionRowStatus`).
	 *
	 * The view decides no sentences and no filtering: `connectionIndexFilter`,
	 * `readiness` and `connectionRowStatus` are pure and have their own tests.
	 */
	import { getContext, untrack } from "svelte"
	import { SvelteMap } from "svelte/reactivity"
	import * as Icons from "@lucide/svelte"
	import { capabilityLabel, capabilityTagline } from "@serene-pub/sdk"
	import { Dialog, Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import { JUMP_CONTEXT, type JumpCtx } from "$lib/client/shell/jump.svelte"
	import PanelFilterInput from "$lib/client/components/panels/PanelFilterInput.svelte"
	import { toolbarButtonClass } from "$lib/client/components/panels/toolbarButton"
	import ViewToolbar from "$lib/client/components/panels/ViewToolbar.svelte"
	import ListCardToggle from "$lib/client/components/panels/ListCardToggle.svelte"
	import { createViewMode } from "$lib/client/utils/viewMode.svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { declareInterest } from "$lib/client/sockets/interest.svelte"
	import AddMenu from "./AddMenu.svelte"
	import { canRunLocalRuntimes } from "./addMenuItems"
	import ConnectionRow from "./ConnectionRow.svelte"
	import { connectionTypeIcon } from "./connectionTypeIcon"
	import ConnectionCard from "./ConnectionCard.svelte"
	import DefaultsLedger from "./DefaultsLedger.svelte"
	import DownloadsTray from "./DownloadsTray.svelte"
	import StatusStrip from "./StatusStrip.svelte"
	import JobsGrid from "./JobsGrid.svelte"
	import {
		countConnections,
		filterConnections,
		indexTotals,
		parseIndexFilter,
		serviceLabel,
		servesCapability,
		type IndexFilter
	} from "./connectionIndexFilter"
	import {
		CONNECTION_SECTIONS,
		sectionForCapability
	} from "$lib/shared/constants/connectionSections"
	import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
	import { defaultsSummary } from "./defaultsSummary"
	import {
		readinessRows,
		type EntryFacts,
		type ReadinessRow
	} from "./readiness"
	import { connectionRowStatus, type RowStatus } from "./connectionRowStatus"
	import { defaultsForConnection, groupConnections } from "./connectionGroups"
	import {
		endpointKind,
		isLocalOnnxType,
		manualAddAllowed
	} from "./modelManagement"
	import type { KcppStatus, LaneStatus, OllamaStatus } from "./endpointStatus"
	import { timeAgo } from "$lib/client/utils/timeAgo"
	import { downloads } from "./downloads.svelte"
	import type { CapabilityDefaultRef } from "./modelSystemDefaults"
	import { buildJobTiles, chatFacts } from "./jobTile"
	import { kcppInstallState } from "./managedConnectionView"
	import { connectionTypeDisabledReason } from "$lib/shared/utils/connectionServiceItems"
	import { getModelDisabledReason } from "./capabilityView"

	type Row = Sockets.Connections.List.Row & { id: number }
	type ModelOf = Row["models"][number]

	interface Props {
		connectionsList: Sockets.Connections.List.Row[]
		capabilityDefaults?: Record<string, CapabilityDefaultRef | undefined>
		isLoading: boolean
		/** Connection ids with a sync in flight. */
		syncingIds: ReadonlySet<number>
		/** Every connection is being checked (the open-time sweep). */
		syncingAll: boolean
		/** Seeds the filter (e.g. the onboarding wizard's step, as `cap:<transform>`). */
		initialFilter?: string | null
		/** Scroll this connection's row into view and highlight it once. */
		focusConnectionId?: number | null
		/** The connection open beside the list at desk width. */
		selectedConnectionId?: number | null
		/**
		 * The view's measured mode.
		 *
		 * ⚠ Passed in rather than measured here: at desk with something open
		 * this list is a 340px column while the VIEW is 1,500px, so
		 * `@min-[900px]/view` answers about the wrong box. With `detailOpen`
		 * it decides one thing — whether this list is a narrow column beside
		 * a detail (desk + open), where the jobs fold to a strip of chips.
		 */
		mode?: "compact" | "desk"
		/**
		 * Something is open in the detail pane beside this list (desk only).
		 * The list is then a 340px column and the jobs grid folds to chips;
		 * `onShowAllJobs` closes the detail, which gives the list — and the
		 * full grid at its top — the whole view back (plan 2026-09-24 C7).
		 */
		detailOpen?: boolean
		/** Close the detail pane: the list, with the full grid, takes the view. */
		onShowAllJobs?: () => void
		/** Open Add; a door may narrow the service picker to one category. */
		onAddNew: (opts?: { category?: "cloud" | "local" | "custom" }) => void
		/** Switch a manager on and open its connection. */
		onEnableManager: (kind: "koboldcpp" | "ollama") => void
		onOpenConnection: (connection: Row) => void
		onOpenModel: (connection: Row, model: ModelOf) => void
		/** One capability's own view — the readiness rows' destination. */
		onOpenCapability: (capability: string) => void
		/** The Set up chat flow (U5): Runtime → Model → Done. */
		onSetUpChat: () => void
		/** The model finder, optionally scoped. */
		onGetModel: (opts?: {
			capability?: string
			connectionId?: number
		}) => void
		onOpenDownloads: () => void
		onRefresh: (connection: Row) => void
		onAddModel: (connection: Row, model: string, name: string) => void
	}
	let {
		connectionsList,
		capabilityDefaults = {},
		isLoading,
		syncingIds,
		syncingAll,
		initialFilter = null,
		focusConnectionId = null,
		selectedConnectionId = null,
		mode = "compact",
		detailOpen = false,
		onShowAllJobs,
		onAddNew,
		onEnableManager,
		onOpenConnection,
		onOpenModel,
		onOpenCapability,
		onSetUpChat,
		onGetModel,
		onOpenDownloads,
		onRefresh,
		onAddModel
	}: Props = $props()

	/** Rows or cards, remembered per browser like the other views' pairs. */
	const listMode = createViewMode("serene-pub:viewMode:connectionsIndex")
	/** A 340px column beside an open detail: the jobs fold to chips. */
	const asColumn = $derived(mode === "desk" && detailOpen)
	/**
	 * Cards where the list has the room to itself; rows in the column
	 * beside an open detail, where the list is navigation and a card's
	 * extra lines only push the next connection off screen.
	 */
	const showCards = $derived(listMode.value === "cards" && !asColumn)

	const socket = useTypedSocket()
	const userCtx: { user?: SelectUser } = getContext("userCtx")
	// Provided by `Layout` unconditionally (see ManagedConnectionView): the
	// managed KoboldCPP row reads its install the same way the view does —
	// `kcppInstallState`, one reading for both (plan 2026-09-24 A2).
	const koboldCppSettingsCtx: KoboldCppSettingsCtx = $state(
		getContext("koboldCppSettingsCtx") ?? { settings: undefined }
	)
	const kcppInstall = $derived(
		kcppInstallState(koboldCppSettingsCtx.settings)
	)
	/** The flag for the readiness rows; unknown until settings arrive. */
	const koboldCppManagerEnabled = $derived(
		kcppInstall === "loading"
			? undefined
			: !!koboldCppSettingsCtx.settings?.koboldCppManagerEnabled
	)
	const isAdmin = $derived(!!userCtx?.user?.isAdmin)
	/** Android hides the local-runtime Add items, as the setup wizard does. */
	const systemSettingsCtx: SystemSettingsCtx | undefined =
		getContext("systemSettingsCtx")
	/**
	 * False in the Android app, where the server refuses to switch either
	 * manager on: the Add menu's local-runtime items and the first-run
	 * "On this machine" door both hide on it.
	 */
	const localRuntimes = $derived(
		canRunLocalRuntimes(systemSettingsCtx?.settings)
	)
	/**
	 * Whether this machine runs local ONNX models — the "Later, optionally"
	 * doors depend on it. Embeddings still come from a service where it
	 * doesn't, so that door stays and only stops promising a local download;
	 * named entities come from local ONNX alone, so that door is disabled
	 * with the reason (`getModelDisabledReason`) rather than opening a view
	 * whose every way to a model is disabled.
	 */
	const localOnnxRuns = $derived(
		systemSettingsCtx?.settings?.localOnnxAvailability?.available !== false
	)
	const entitiesBlocked = $derived(
		getModelDisabledReason(
			"text->entities",
			systemSettingsCtx?.settings?.localOnnxAvailability
		)
	)

	let query = $state("")
	/**
	 * A hand-set filter wins; otherwise the seed applies, read through a
	 * derived so a later seed still lands.
	 */
	let filterOverride = $state<IndexFilter | null>(null)
	const filter = $derived(filterOverride ?? parseIndexFilter(initialFilter))
	let filterOpen = $state(false)

	/** List rows always carry ids; the guard is for the type. */
	const rows = $derived(
		connectionsList.filter((c): c is Row => c.id != null)
	)
	const totals = $derived(indexTotals(rows))
	const summary = $derived(defaultsSummary(rows, capabilityDefaults))
	const byId = $derived(new Map(rows.map((c) => [c.id, c])))

	/**
	 * The two kinds whose chip is TEAL: a runtime this pub manages, rather
	 * than a host it merely talks to (ruling R5). Keyed on the kind and not on
	 * the type so the Ollama embeddings type is the same "Ollama" the text one
	 * is — one service, one chip.
	 */
	const MANAGED_KINDS: ReadonlySet<string> = new Set([
		"koboldcpp-managed",
		"ollama"
	])

	const visible = $derived(
		filterConnections(rows, {
			query,
			filter,
			serviceLabel: serviceLabel
		})
	)
	const hasNoMatches = $derived(
		!isLoading && rows.length > 0 && visible.length === 0
	)
	/**
	 * The visible rows, split into "On this machine" and "Services".
	 *
	 * Derived from `visible` and not from `rows`, so a filter that empties a
	 * group drops its header too rather than leaving a heading over nothing.
	 */
	const groups = $derived(groupConnections(visible))

	function labelOf(id: string): string {
		try {
			return capabilityLabel(id as any)
		} catch {
			return sectionForCapability(id)?.starVerb ?? id
		}
	}

	/**
	 * The filter rows: three views of the whole, then one per section.
	 *
	 * Four sections rather than ten transforms — the sections are the shapes a
	 * person thinks in ("images", "entities"), and a row per transform would be
	 * six more rows saying the same four things. A seeded `cap:` value outside
	 * that four is appended, so the filter on screen is always the filter in
	 * force.
	 */
	const SECTION_LABELS: Record<string, string> = {
		"text-gen": "Chat",
		"image-gen": "Images",
		embeddings: "Embeddings",
		ner: "Entities"
	}
	const filterOptions = $derived.by(() => {
		const options: { value: IndexFilter; label: string; count?: number }[] =
			[
				{
					value: "all",
					label: "Everything",
					count: countConnections(rows, "all")
				},
				{
					value: "attention",
					label: "Needs attention",
					count: countConnections(rows, "attention")
				},
				// No count: the ledger is a MODE over transforms, not a
				// narrowing of connections, so any number here counts
				// something other than what the other rows count.
				{ value: "defaults", label: "Defaults ledger" },
				...CONNECTION_SECTIONS.map((s) => ({
					value: `cap:${s.starCapability}` as IndexFilter,
					label:
						SECTION_LABELS[s.modality] ?? labelOf(s.starCapability),
					count: countConnections(
						rows,
						`cap:${s.starCapability}` as IndexFilter
					)
				}))
			]
		if (!options.some((o) => o.value === filter))
			options.push({
				value: filter,
				label: filter.startsWith("cap:")
					? labelOf(filter.slice(4))
					: filter,
				count: countConnections(rows, filter)
			})
		return options
	})
	/** What the dismissible chip says. Undefined at Everything — no chip. */
	const activeFilterLabel = $derived(
		filter === "all"
			? undefined
			: filterOptions.find((o) => o.value === filter)?.label
	)
	function pickFilter(value: IndexFilter) {
		filterOverride = value
		filterOpen = false
	}

	// ── Which live statuses this list needs ─────────────────────────────────
	//
	// Presence, not possibility: an install with no managed KoboldCPP never
	// asks the manager anything, and an install with no local ONNX connection
	// never wakes an embedding lane to ask whether it is resident.
	const hasKcpp = $derived(
		rows.some((c) => endpointKind(c.type) === "koboldcpp-managed")
	)
	const hasOllama = $derived(
		rows.some((c) => endpointKind(c.type) === "ollama")
	)
	const hasOnnxEmbeddings = $derived(
		rows.some((c) => c.type === CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS)
	)
	const hasOnnxNer = $derived(
		rows.some((c) => c.type === CONNECTION_TYPE.LOCAL_ONNX_NER)
	)

	let kcpp = $state<KcppStatus | null>(null)
	/**
	 * Each Ollama connection's own host status, by connection id. One shared
	 * status painted every Ollama row with the manager's answer (plan
	 * 2026-09-24 B4); each answer now carries the connection it was for.
	 */
	const ollamaById = new SvelteMap<number, OllamaStatus>()
	const ollamaIds = $derived(
		rows
			.filter((c) => endpointKind(c.type) === "ollama")
			.map((c) => c.id)
	)
	/** Stable while the set of Ollama rows is, so the asks do not repeat. */
	const ollamaIdsKey = $derived(ollamaIds.join(","))
	let embeddingLane = $state<LaneStatus | null>(null)
	let entityLane = $state<LaneStatus | null>(null)

	function ensureKcpp(): KcppStatus {
		if (!kcpp) kcpp = { run: null, loadedFiles: [], downloads: [] }
		return kcpp
	}
	function handleKcppSubprocess(
		msg: Sockets.KoboldCPP.GetSubprocessStatus.Response
	) {
		kcpp = { ...ensureKcpp(), run: msg.status?.status ?? null }
	}
	/**
	 * The live push, not just the one-shot answer above. A generation starts
	 * the process on its own, from the session — nothing on this page asked
	 * for it — so without this the row keeps whatever it read at mount
	 * (_Starting_, most visibly) for as long as the page is open. A process
	 * that just came up may also have loaded something, so ask what.
	 */
	function handleKcppSubprocessPush(
		msg: Sockets.KoboldCPP.SubprocessStatus.Response
	) {
		kcpp = { ...ensureKcpp(), run: msg.status ?? null }
		if (msg.status === "running")
			socket.emit("koboldcpp:getLoadedConfig", {})
	}
	function handleKcppLoaded(msg: Sockets.KoboldCPP.GetLoadedConfig.Response) {
		const resident = msg.config?.resident
		const files = [resident?.text?.file, resident?.image?.file].filter(
			(f): f is string => !!f
		)
		kcpp = { ...ensureKcpp(), loadedFiles: files }
	}
	/** A process write moved something; ask what it moved to. */
	function reaskKcpp() {
		socket.emit("koboldcpp:getSubprocessStatus", {})
		socket.emit("koboldcpp:getLoadedConfig", {})
	}

	function handleOllamaVersion(msg: Sockets.Ollama.Version.Response) {
		const id = msg.connectionId
		if (id == null) return
		ollamaById.set(id, {
			reachable: true,
			version: msg.version ?? null,
			running: ollamaById.get(id)?.running ?? []
		})
	}
	function handleOllamaUnreachable(msg: Sockets.ErrorResponse) {
		const id = (msg as { connectionId?: number | null }).connectionId
		if (id == null) return
		ollamaById.set(id, {
			reachable: false,
			version: null,
			running: ollamaById.get(id)?.running ?? []
		})
	}
	function handleOllamaRunning(
		msg: Sockets.Ollama.ListRunningModels.Response
	) {
		const id = msg.connectionId
		if (id == null) return
		const previous = ollamaById.get(id)
		ollamaById.set(id, {
			reachable: previous?.reachable ?? null,
			version: previous?.version ?? null,
			running: (msg.runningModels ?? [])
				.map((m: any) => m?.name)
				.filter((n: unknown): n is string => typeof n === "string")
		})
	}

	function handleVectorizationStatus(
		msg: Sockets.Vectorization.Status.Response
	) {
		embeddingLane = {
			modelId: msg.modelId ?? null,
			loaded: !!msg.loaded,
			lastUsedAt: msg.lastUsedAt ?? null,
			pending: msg.pending ?? null
		}
	}
	function handleNerStatus(msg: Sockets.Ner.Status.Response) {
		entityLane = {
			modelId: msg.modelId ?? null,
			loaded: !!msg.loaded,
			lastUsedAt: msg.lastUsedAt ?? null,
			// The entity lane counts no queue. Null omits the clause rather
			// than printing a zero nobody measured.
			pending: null
		}
	}
	/**
	 * A capability default or the settings snapshot moved; the local ONNX
	 * rows' "… active" sentences don't refresh themselves on either, so ask
	 * again the same way the mount effects below do.
	 */
	function reaskLocalOnnx() {
		if (hasOnnxEmbeddings && isAdmin)
			socket.emit("vectorization:status", {})
		if (hasOnnxNer && isAdmin) socket.emit("ner:status", {})
	}

	/**
	 * Every key this view holds, declared ABOVE the effects that emit — effects
	 * run in creation order and a request flushes the pending interest sync, so
	 * a declaration made below would miss the flush its own first reply rides
	 * on.
	 *
	 * `koboldcpp:`, `ollama:` and `ner:` are restricted interest (admin-only),
	 * so those are asked for only once the user is known to be an admin: the
	 * registry would refuse them anyway, and asking first keeps the refusal out
	 * of the console for the many non-admins who open this panel to read.
	 */
	$effect(() => {
		if (!hasKcpp || !isAdmin) return
		const releases = [
			declareInterest<"koboldcpp:getSubprocessStatus">(
				"koboldcpp:getSubprocessStatus",
				handleKcppSubprocess
			),
			declareInterest<"koboldcpp:subprocessStatus">(
				"koboldcpp:subprocessStatus",
				handleKcppSubprocessPush
			),
			declareInterest<"koboldcpp:getLoadedConfig">(
				"koboldcpp:getLoadedConfig",
				handleKcppLoaded
			),
			declareInterest<"koboldcpp:startSubprocess">(
				"koboldcpp:startSubprocess",
				reaskKcpp
			),
			declareInterest<"koboldcpp:stopSubprocess">(
				"koboldcpp:stopSubprocess",
				reaskKcpp
			),
			declareInterest<"koboldcpp:loadModel">(
				"koboldcpp:loadModel",
				reaskKcpp
			)
		]
		return () => releases.forEach((release) => release())
	})
	$effect(() => {
		if (!hasOllama || !isAdmin) return
		const releases = [
			declareInterest<"ollama:version">(
				"ollama:version",
				handleOllamaVersion
			),
			declareInterest<"ollama:version:error">(
				"ollama:version:error",
				handleOllamaUnreachable
			),
			declareInterest<"ollama:listRunningModels">(
				"ollama:listRunningModels",
				handleOllamaRunning
			)
		]
		return () => releases.forEach((release) => release())
	})
	$effect(() => {
		if (!hasOnnxEmbeddings) return
		const releases = [
			declareInterest<"vectorization:status">(
				"vectorization:status",
				handleVectorizationStatus
			),
			declareInterest<"vectorization:unloadModel">(
				"vectorization:unloadModel",
				handleVectorizationStatus
			)
		]
		return () => releases.forEach((release) => release())
	})
	$effect(() => {
		if (!hasOnnxNer || !isAdmin) return
		const releases = [
			declareInterest<"ner:status">("ner:status", handleNerStatus),
			declareInterest<"ner:unloadModel">(
				"ner:unloadModel",
				handleNerStatus
			)
		]
		return () => releases.forEach((release) => release())
	})
	/**
	 * Neither event answers "is a local ONNX lane active now" itself — both
	 * just mean the answer may have changed — so the handler re-asks rather
	 * than reading either payload.
	 */
	$effect(() => {
		const releases = [
			declareInterest<"connections:setDefault">(
				"connections:setDefault",
				reaskLocalOnnx
			),
			declareInterest<"systemSettings:get">(
				"systemSettings:get",
				reaskLocalOnnx
			)
		]
		return () => releases.forEach((release) => release())
	})

	/**
	 * The downloads tray's feeds, held for as long as this view is mounted.
	 *
	 * The store keeps the three manager feeds; the ONNX one is handed in from
	 * here, because a local file's progress is already patched into
	 * `connections:list` by the sidebar and a second subscription would be the
	 * same event arriving twice.
	 */
	$effect(() => downloads.subscribe({ admin: isAdmin }))
	$effect(() => downloads.setOnnx(rows))
	const trayCount = $derived(downloads.inFlight)
	const trayPercent = $derived(downloads.percent)

	// The asks. One per kind that is actually present.
	$effect(() => {
		if (!hasKcpp || !isAdmin) return
		socket.emit("koboldcpp:getSubprocessStatus", {})
		socket.emit("koboldcpp:getLoadedConfig", {})
	})
	$effect(() => {
		if (!ollamaIdsKey || !isAdmin) return
		for (const id of untrack(() => ollamaIds)) {
			socket.emit("ollama:version", { connectionId: id })
			socket.emit("ollama:listRunningModels", { connectionId: id })
		}
	})
	$effect(() => {
		if (!hasOnnxEmbeddings || !isAdmin) return
		socket.emit("vectorization:status", {})
	})
	$effect(() => {
		if (!hasOnnxNer || !isAdmin) return
		socket.emit("ner:status", {})
	})

	/** Which lane a local ONNX row is looking at, or null for anything else. */
	function laneFor(connection: Row): LaneStatus | null {
		if (connection.type === CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS)
			return embeddingLane
		if (connection.type === CONNECTION_TYPE.LOCAL_ONNX_NER)
			return entityLane
		return null
	}

	/**
	 * ⚠ A local ONNX row on a machine whose runtime didn't load says why, in
	 * place of whatever its lane reports: its Set up and Fix lead to a
	 * Download the server refuses, and "Active" would claim a model that
	 * can't load. Quiet, not red — nothing the person did is broken. The row
	 * still opens, and its view says the same above the models.
	 */
	function statusOf(connection: Row): RowStatus {
		const unavailable = connectionTypeDisabledReason(
			connection.type,
			systemSettingsCtx?.settings?.localOnnxAvailability
		)
		if (unavailable)
			return {
				state: "idle",
				label: "Unavailable",
				detail: unavailable,
				metric: null,
				action: null
			}
		const kind = endpointKind(connection.type)
		return connectionRowStatus(connection as any, {
			kind,
			kcpp: kind === "koboldcpp-managed" ? kcpp : null,
			ollama:
				kind === "ollama"
					? (ollamaById.get(connection.id) ?? null)
					: null,
			lane: laneFor(connection),
			kcppInstall: kind === "koboldcpp-managed" ? kcppInstall : undefined,
			syncing: syncingAll || syncingIds.has(connection.id),
			timeAgo
		})
	}

	function handleRowAction(connection: Row, verb: string) {
		switch (verb) {
			case "start":
				socket.emit("koboldcpp:startSubprocess", {})
				return
			case "start-offline":
				// Switched off with the install kept: one call turns it back
				// on and starts it (ruled 2026-09-24).
				socket.emit("koboldcpp:startSubprocess", { enable: true })
				return
			case "stop":
				socket.emit("koboldcpp:stopSubprocess", {})
				return
			case "refresh":
				onRefresh(connection)
				return
			case "fix":
			case "setup":
				// Both open the connection. They are separate verbs because
				// they are separate SENTENCES — "Fix" admits something failed,
				// "Set up" says you have not finished — and a row that says
				// Fix about a key nobody has typed yet is the false alarm this
				// whole split removes.
				onOpenConnection(connection)
				return
		}
	}

	// ── Readiness (the status strip and jobs grid) ─────────────────────────
	/**
	 * What the summary could not know about a pair: whether its files are
	 * here, whether the process holding it is up, and whether the manager that
	 * owns it is switched on at all.
	 */
	function factsFor(entry: (typeof summary.entries)[number]): EntryFacts {
		const connection = entry.connection
			? byId.get(entry.connection.id)
			: undefined
		if (!connection) return {}
		const kind = endpointKind(connection.type)
		const local = connection.models.find(
			(m) => m.id === entry.model?.id
		)?.local
		return {
			localState: local?.state,
			downloadedBytes: local?.downloadedBytes,
			totalBytes: local?.totalBytes,
			syncError: connection.modelsSync.error,
			kcppRun:
				kind === "koboldcpp-managed" ? (kcpp?.run ?? null) : undefined,
			managerEnabled:
				kind === "koboldcpp-managed"
					? koboldCppManagerEnabled
					: undefined,
			managerLabel: kind === "koboldcpp-managed" ? "KoboldCPP" : undefined
		}
	}
	const readiness = $derived(readinessRows(summary.entries, factsFor))
	const sectionOrder = CONNECTION_SECTIONS.map((s) => s.starCapability)

	/** Chat for the status strip, and the rest as tiles. Both pure — `jobTile`. */
	const chat = $derived(chatFacts(summary.entries, readiness))
	const jobTiles = $derived(
		buildJobTiles(summary.entries, readiness, sectionOrder)
	)

	/**
	 * A readiness row's one fix.
	 *
	 * ⚠ None of these is a NEW write. Download and Refresh are the same emits
	 * the model rows and the ⋯ menu already made; Start is the manager's; and
	 * anything else goes to the capability view, where changing the pair keeps
	 * its costed confirmation.
	 */
	function handleReadinessFix(row: ReadinessRow) {
		switch (row.action?.verb) {
			case "download":
				if (row.connectionId != null && row.modelId != null)
					socket.emit("connections:downloadModel", {
						id: row.connectionId,
						modelId: row.modelId
					})
				return
			case "start":
				socket.emit("koboldcpp:startSubprocess", {})
				return
			case "refresh":
				if (row.connectionId != null)
					socket.emit("connections:syncModels", {
						id: row.connectionId,
						force: true
					})
				return
			default:
				// Chat with nothing able to serve it is the one case that gets
				// the guided flow: there is nothing for a capability view to
				// list, and "Set up" promised a setup, not an empty screen.
				if (
					row.capability === "text->text" &&
					row.state === "unset" &&
					!rows.some((c) =>
						servesCapability(c as any, "text->text")
					)
				) {
					onSetUpChat()
					return
				}
				onOpenCapability(row.capability)
		}
	}

	// ── Add a model by name ─────────────────────────────────────────────────
	//
	// The one add this list still owns. It exists for a host that serves no
	// model list at all — a compatible endpoint with no `/models`, a catalogue
	// that lags a launch — which is why the connection has to be PICKED: the
	// rest of the app knows which connection it is talking about, and this
	// dialog is reached from a toolbar that does not.
	const addByNameTargets = $derived(
		rows.filter((c) => manualAddAllowed(c.type))
	)
	let addByNameOpen = $state(false)
	let addByNameConnectionId = $state<string>("")
	let addByNameModel = $state("")
	let addByNameLabel = $state("")
	function openAddByName() {
		addByNameConnectionId = String(addByNameTargets[0]?.id ?? "")
		addByNameModel = ""
		addByNameLabel = ""
		addByNameOpen = true
	}
	function submitAddByName() {
		const connection = rows.find(
			(c) => String(c.id) === addByNameConnectionId
		)
		if (!connection || !addByNameModel.trim()) return
		onAddModel(connection, addByNameModel.trim(), addByNameLabel.trim())
		addByNameOpen = false
	}

	/**
	 * Jump, scoped to this view.
	 *
	 * Registered from HERE and not from `ConnectionsSidebar`, which is the
	 * thing the rail opens: this component is mounted exactly while the index
	 * is on screen, so the scope exists exactly while there is a filter box to
	 * bind to. The hits are connections, because the rows are connections —
	 * a model is found through the capability view or the finder now.
	 */
	const jumpCtx = getContext<JumpCtx | undefined>(JUMP_CONTEXT)
	$effect(() =>
		jumpCtx?.registerScope("connections", {
			label: "Connections",
			placeholder: "Filter connections",
			getQuery: () => query,
			setQuery: (next) => (query = next),
			getHits: () =>
				visible.map((connection) => ({
					kind: "connection" as const,
					id: connection.id,
					title: connection.name || "Untitled connection",
					subtitle: serviceLabel(connection)
				})),
			onPick: (hit) => {
				const connection = rows.find((c) => c.id === Number(hit.id))
				if (connection) onOpenConnection(connection)
			}
		})
	)

	function clearFilters() {
		query = ""
		filterOverride = "all"
	}

	/** The landing cue when a connection view hands the list back. */
	$effect(() => {
		if (focusConnectionId == null) return
		document
			.getElementById(`connection-row-${focusConnectionId}`)
			?.scrollIntoView({ block: "nearest" })
	})
</script>

{#snippet doorRow(
	icon: any,
	title: string,
	blurb: string,
	tile: string,
	size: string,
	run: () => void,
	trades: string[] = [],
	/** Why this door leads nowhere here: it is disabled and says so. */
	blocked: string | null = null
)}
	{@const DoorIcon = icon}
	<button
		type="button"
		class="focus-visible:ring-primary-500 flex min-h-11 w-full items-start gap-2.5 rounded-[10px] px-1.5 py-1.5 text-left focus-visible:ring-2 focus-visible:outline-none {blocked
			? 'cursor-not-allowed opacity-70'
			: 'hover:preset-tonal-primary'}"
		disabled={!!blocked}
		onclick={run}
	>
		<span
			class="grid shrink-0 place-items-center rounded-lg {size} {tile}"
			aria-hidden="true"
		>
			<DoorIcon size={18} />
		</span>
		<span class="min-w-0 flex-1">
			<span class="block truncate text-sm font-medium">{title}</span>
			{#if blocked}
				<!-- The reason in place of the blurb, and whole: it often
				     quotes the runtime's own error, and a disabled button
				     takes no focus, so no tooltip would be reachable (§9). -->
				<span class="text-surface-600-400 block text-xs break-words">
					{blocked}
				</span>
			{:else}
				<span class="text-surface-600-400 block truncate text-xs">
					{blurb}
				</span>
			{/if}
			{#if trades.length}
				<span class="mt-1.5 flex flex-wrap gap-1">
					{#each trades as trade (trade)}
						<!-- A cost is not a warning: every chip is the same
						     quiet tone, and the WORDS carry the difference. -->
						<span
							class="preset-tonal-surface text-surface-700-300 rounded-md px-1.5 py-0.5 text-[11px] font-medium"
						>
							{trade}
						</span>
					{/each}
				</span>
			{/if}
		</span>
		<Icons.ChevronRight
			size={16}
			class="text-surface-500 mt-1 shrink-0"
			aria-hidden="true"
		/>
	</button>
{/snippet}

{#snippet findFilter()}
	<PanelFilterInput
		bind:value={query}
		placeholder={totals.connections === 1
			? "connection"
			: "connections"}
		count={totals.connections}
		aria-label="Filter connections by name, service, host or model"
	/>
{/snippet}
{#snippet findActions()}
	<!-- A popout rather than a row of chips: seven choices will not
	     fit across 400px, and a strip that scrolls sideways is a
	     strip nobody reads the end of (§6.3). -->
	<Popover
		open={filterOpen}
		onOpenChange={(e) => (filterOpen = e.open)}
		positioning={{ placement: "bottom-end" }}
	>
		<Popover.Trigger
			class={toolbarButtonClass(filter !== "all")}
			title="Filter connections"
			aria-label="Filter connections"
			aria-expanded={filterOpen}
		>
			<Icons.SlidersHorizontal size={16} aria-hidden="true" />
		</Popover.Trigger>
		<Portal>
			<Popover.Positioner class="z-[1000]!">
				<Popover.Content
					class="card bg-surface-50-950 border-surface-200-800 w-[min(90vw,260px)] border p-2 shadow-xl"
				>
					<div
						class="flex max-h-[min(60vh,320px)] flex-col gap-0.5 overflow-y-auto"
						role="radiogroup"
						aria-label="Filter connections"
					>
						{#each filterOptions as option (option.value)}
							{@const checked = filter === option.value}
							<button
								type="button"
								role="radio"
								aria-checked={checked}
								class="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm {checked
									? 'sidebar-row-active'
									: 'hover:bg-surface-200-800'}"
								onclick={() => pickFilter(option.value)}
							>
								<span class="min-w-0 flex-1 truncate">
									{option.label}
								</span>
								{#if option.count !== undefined}
									<span
										class="text-surface-600-400 shrink-0 text-[11px]"
									>
										{option.count}
									</span>
								{/if}
							</button>
						{/each}
					</div>
				</Popover.Content>
			</Popover.Positioner>
		</Portal>
	</Popover>
	<!-- Not beside an open detail: the 340px column is navigation, rows
	     only, and three icon buttons there cut the filter's own words. -->
	{#if !asColumn}
		<ListCardToggle mode={listMode} label="Connections" />
	{/if}
{/snippet}

<div class="flex h-full min-h-0 flex-col">
	<!-- The view toolbar (STYLE-GUIDE §6.3). Add — the New menu — leads the
	     action row and Get a model is its quiet icon button; the filter box,
	     its popout and the list/card pair are the find row; the narrowing in
	     force is the one chip under them. No find row over an empty list:
	     there is nothing to narrow, and the doors below are the whole screen. -->
	<ViewToolbar
		label="Connections"
		class="mb-2"
		filter={rows.length > 0 ? findFilter : undefined}
		filterActions={rows.length > 0 ? findActions : undefined}
	>
		{#snippet primary()}
			<AddMenu
				onAddConnection={onAddNew}
				onAddKoboldCpp={() => onEnableManager("koboldcpp")}
				onAddOllama={() => onEnableManager("ollama")}
				onGetModel={() => onGetModel()}
				onAddByName={openAddByName}
				canAddByName={addByNameTargets.length > 0}
				canRunLocalRuntimes={localRuntimes}
			/>
		{/snippet}
		{#snippet actions()}
			<!--
				Quiet, and absent while nothing is connected: getting a model is
				a thing you do to a runtime, and on a fresh install there is
				nowhere to put one. A tonal icon button with its name in the
				tooltip and to a screen reader (§6.3).
			-->
			{#if rows.length}
				<button
					type="button"
					class={toolbarButtonClass()}
					onclick={() => onGetModel()}
					title="Get a model"
					aria-label="Get a model"
				>
					<Icons.Download size={16} aria-hidden="true" />
				</button>
			{/if}
		{/snippet}
		{#snippet chips()}
			<!-- The one narrowing in force, said once. At Everything there is
			     nothing to say and the row is absent (`empty:hidden`). -->
			{#if rows.length > 0 && activeFilterLabel}
				<span
					class="bg-surface-200-800 text-surface-700-300 flex min-w-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs"
				>
					<span class="min-w-0 truncate">{activeFilterLabel}</span>
					<button
						type="button"
						class="hover:text-surface-950-50 shrink-0"
						onclick={() => pickFilter("all")}
						aria-label={`Clear filter: ${activeFilterLabel}`}
					>
						<Icons.X size={12} aria-hidden="true" />
					</button>
				</span>
			{/if}
		{/snippet}
	</ViewToolbar>

	<div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-2">
		{#if isLoading}
			<p class="text-surface-600-400 text-sm">Loading connections…</p>
		{:else if !rows.length}
			<!-- Nothing is connected. The whole pane becomes the question that
			     matters, and the doors are the answers (three; two on Android, which cannot
			     run a local runtime). -->
			<section class="panel-card flex flex-col gap-2">
				<h3 class="[font-family:var(--typo-heading--font-family)] text-lg font-semibold">
					Where should the writing happen?
				</h3>
				<p class="text-surface-600-400 text-sm">
					A session can't reply until one model is connected. Pick the
					trade you prefer — the others can be added later.
				</p>
				<!--
					Each door names what it COSTS, in three chips.

					A door that describes itself ("Already installed here or on
					another machine") leaves the actual decision — privacy,
					money, memory — unstated, so the one question a first-timer
					is really asking has no answer on the screen they are asked
					it on.
				-->
				<div class="flex flex-col gap-1">
					{#if localRuntimes}
						{@render doorRow(
							connectionTypeIcon(
								CONNECTION_TYPE.KOBOLDCPP_MANAGED,
								Icons.Cpu
							),
							"On this machine",
							"KoboldCPP, installed and run by Serene Pub.",
							"preset-tonal-primary",
							"size-10",
							onSetUpChat,
							["Private", "Free", "Needs ~8 GB"]
						)}
					{/if}
					{@render doorRow(
						Icons.Cloud,
						"A service",
						"OpenAI, Anthropic, OpenRouter, Groq and 20 more.",
						"preset-tonal-surface",
						"size-10",
						onAddNew,
						["Fast", "Nothing to install", "Costs per message"]
					)}
					{@render doorRow(
						Icons.Server,
						"Something I already run",
						"Ollama, LM Studio, llama.cpp, KoboldCPP — here or on another machine.",
						"preset-tonal-surface",
						"size-10",
						// The picker, narrowed to local servers — this door once
						// switched the Ollama manager on whichever of the three
						// the person ran (ruled 2026-09-24).
						() => onAddNew({ category: "local" }),
						["Private", "Free"]
					)}
				</div>
				<hr class="panel-edge my-1" />
				<p class="text-surface-600-400 text-xs">
					Know what you want?
					<button
						type="button"
						class="anchor"
						onclick={() => onAddNew()}
					>
						Add a connection
					</button>
					lists every service and preset.
				</p>
			</section>
			<section class="panel-card flex flex-col gap-1">
				<h3 class="text-surface-600-400 mb-1 text-xs">Later, optionally</h3>
				{@render doorRow(
					Icons.Image,
					"Images",
					"Generate pictures in sessions",
					"preset-tonal-surface",
					"size-8",
					() => onOpenCapability("text->image")
				)}
				{@render doorRow(
					Icons.Zap,
					"Embeddings",
					localOnnxRuns
						? "Smarter lore retrieval · local download"
						: "Smarter lore retrieval",
					"preset-tonal-surface",
					"size-8",
					() => onOpenCapability("text->embedding")
				)}
				{@render doorRow(
					Icons.ScanText,
					"Named entities",
					"Find people and places in text · local",
					"preset-tonal-surface",
					"size-8",
					() => onOpenCapability("text->entities"),
					[],
					entitiesBlocked
				)}
			</section>
		{:else}
			<StatusStrip
				modelName={chat.modelName}
				connectionName={chat.connectionName}
				problem={chat.problem}
				onChange={() => onOpenCapability("text->text")}
				onSetUp={() => {
					const row = readiness.find(
						(r) => r.capability === "text->text"
					)
					if (chat.set && row) handleReadinessFix(row)
					else onSetUpChat()
				}}
			/>

			<!-- The defaults block's second half. The list carries the grid at
			     every width now (notes 42): two across in the dock, four
			     across a wide list (`columns="fit"`, off `@container/list`),
			     folded to the other three modalities and `N more`. Only as a
			     340px column beside an open detail is it a strip of chips —
			     never out of reach, and one press (`N more`) gives the list
			     the whole view back. -->
			{#if !asColumn}
				<JobsGrid
					tiles={jobTiles}
					onOpen={onOpenCapability}
					limit={3}
					columns="fit"
				/>
			{:else if jobTiles.length}
				<nav class="flex flex-wrap gap-1.5" aria-label="Other jobs">
					{#each jobTiles.slice(0, 4) as tile (tile.capability)}
						{@const TileIcon =
							((Icons as any)[tile.icon ?? ""] as any) ??
							Icons.Cable}
						<button
							type="button"
							class="bg-surface-200-800 hover:preset-tonal-primary flex min-h-8 items-center gap-1.5 rounded-full px-2.5 text-xs"
							onclick={() => onOpenCapability(tile.capability)}
							title={tile.problem ??
								tile.modelName ??
								`${tile.label}: not set up`}
						>
							<span
								class="size-1.5 shrink-0 rounded-full {tile.problem
									? 'bg-warning-500'
									: tile.modelName
										? 'bg-success-500'
										: 'bg-surface-400-600'}"
								aria-hidden="true"
							></span>
							<TileIcon size={12} aria-hidden="true" />
							{tile.label}
						</button>
					{/each}
					{#if jobTiles.length > 4 && onShowAllJobs}
						<!-- The rest behind one press: closing the detail gives
						     this list, with the full grid, the whole view. -->
						<button
							type="button"
							class="text-surface-600-400 hover:preset-tonal-primary flex min-h-8 items-center rounded-full px-2.5 text-xs"
							onclick={onShowAllJobs}
						>
							{jobTiles.length - 4} more
						</button>
					{/if}
				</nav>
			{/if}

			{#if filter === "defaults"}
				<DefaultsLedger
					rows={rows}
					{capabilityDefaults}
					onOpenModel={(connection, model) =>
						onOpenModel(connection as Row, model as ModelOf)}
				/>
			{:else if hasNoMatches}
				<div class="flex flex-col items-start gap-2">
					<p class="text-surface-600-400 text-sm">Nothing matches.</p>
					<button
						type="button"
						class="btn btn-sm preset-tonal-surface"
						onclick={clearFilters}
					>
						Clear search and filter
					</button>
				</div>
			{:else}
				<!--
					The main list: the connections, under one heading so the
					defaults above read as their own block.

					Grouped by where the compute is, which is the trade a person
					is actually weighing: on this machine is private and free,
					a service is fast and billed. The header names it once so
					no row has to. See `connectionGroups`. Rows, or cards (the
					list/card pair on the find row) — the same facts from the
					same `RowStatus`, a card with the room to show the type,
					the state and the model count all at once.
				-->
				<section
					class="flex flex-col gap-3"
					aria-labelledby="connections-index-heading"
				>
					<div class="flex items-baseline gap-2 px-0.5">
						<h2
							id="connections-index-heading"
							class="text-sm font-medium"
						>
							Connections
						</h2>
						<span class="text-surface-600-400 text-xs">
							{visible.length}
						</span>
					</div>
					{#each groups as { group, rows: groupRows } (group.id)}
						{@const GroupIcon =
							((Icons as any)[group.icon] as any) ?? Icons.Cable}
						<div class="flex flex-col gap-1">
							<div class="flex items-center gap-2 px-0.5">
								<GroupIcon
									size={13}
									class="text-surface-600-400 shrink-0"
									aria-hidden="true"
								/>
								<h3
									class="text-surface-600-400 shrink-0 text-xs font-medium"
								>
									{group.label}
								</h3>
								<span
									class="bg-surface-300-700 h-px min-w-2 flex-1"
								></span>
								<!-- Muted, not quiet: measured 3.45:1 at 11px,
								     which fails AA. §2.5. -->
								<span
									class="text-surface-600-400 shrink-0 text-[11px]"
								>
									{group.trade}
								</span>
							</div>
							{#if showCards}
								<!-- auto-fill/minmax off the list pane's own
								     width: one across the dock, as many as fit
								     at Half or across the whole view. -->
								<div
									class="mt-1 grid min-w-0 grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3"
									role="list"
									aria-label={group.label}
								>
									{#each groupRows as connection (connection.id)}
										<div
											id={`connection-row-${connection.id}`}
											class="flex min-w-0 flex-col"
											role="listitem"
										>
											<ConnectionCard
												title={connection.name ||
													"Untitled connection"}
												serviceLabel={serviceLabel(connection)}
												kind={endpointKind(connection.type)}
												type={connection.type}
												managed={MANAGED_KINDS.has(
													endpointKind(connection.type)
												)}
												status={statusOf(connection)}
												modelCount={connection.models.length}
												defaultFor={defaultsForConnection(
													connection.id,
													capabilityDefaults,
													(c) => capabilityLabel(c as any)
												)}
												selected={selectedConnectionId ===
													connection.id}
												onOpen={() =>
													onOpenConnection(connection)}
												onAction={(verb) =>
													handleRowAction(connection, verb)}
											/>
										</div>
									{/each}
								</div>
							{:else}
								{#each groupRows as connection (connection.id)}
									<div id={`connection-row-${connection.id}`}>
										<ConnectionRow
											title={connection.name ||
												"Untitled connection"}
											serviceLabel={serviceLabel(connection)}
											kind={endpointKind(connection.type)}
											type={connection.type}
											managed={MANAGED_KINDS.has(
												endpointKind(connection.type)
											)}
											status={statusOf(connection)}
											defaultFor={defaultsForConnection(
												connection.id,
												capabilityDefaults,
												(c) => capabilityLabel(c as any)
											)}
											selected={selectedConnectionId ===
												connection.id}
											onOpen={() =>
												onOpenConnection(connection)}
											onAction={(verb) =>
												handleRowAction(connection, verb)}
										/>
									</div>
								{/each}
							{/if}
						</div>
					{/each}
					{#if addByNameTargets.length}
						<button
							type="button"
							class="text-surface-600-400 hover:text-surface-950-50 self-start px-0.5 text-xs"
							onclick={openAddByName}
						>
							Add a model by name
						</button>
					{/if}
				</section>
			{/if}
		{/if}
	</div>

	{#if trayCount > 0}
		<DownloadsTray
			count={trayCount}
			percent={trayPercent}
			onView={onOpenDownloads}
		/>
	{/if}
</div>

<!-- A model whose host will not list it. Reached from the Add menu and from
     the Connections heading, both of which are outside any one connection —
     so the connection is the dialog's first field. -->
<Dialog open={addByNameOpen} onOpenChange={(e) => (addByNameOpen = e.open)}>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 w-full max-w-md space-y-4 p-6 shadow-xl"
			>
				<h2 class="[font-family:var(--typo-heading--font-family)] text-lg font-semibold">
					Add a model by name
				</h2>
				<p class="text-surface-600-400 text-xs">
					For a host that doesn't list its models. The name has to be
					the one the host answers to.
				</p>
				<form
					class="flex flex-col gap-3"
					onsubmit={(e) => {
						e.preventDefault()
						submitAddByName()
					}}
				>
					<Select
						label="Connection"
						options={addByNameTargets.map((c) => ({
							value: String(c.id),
							label: c.name || "Untitled connection"
						}))}
						bind:value={addByNameConnectionId}
						placeholder="Pick a connection"
					/>
					<label class="flex flex-col gap-1">
						<span class="text-surface-600-400 text-xs">
							Model identifier
						</span>
						<input
							class="input"
							bind:value={addByNameModel}
							placeholder="meta-llama/Llama-3.1-8B-Instruct"
						/>
					</label>
					<label class="flex flex-col gap-1">
						<span class="text-surface-600-400 text-xs">
							Display name (optional)
						</span>
						<input
							class="input"
							bind:value={addByNameLabel}
							placeholder="Llama 3.1 8B"
						/>
					</label>
				</form>
				<footer class="flex justify-end gap-2">
					<button
						type="button"
						class="btn preset-tonal-surface"
						onclick={() => (addByNameOpen = false)}
					>
						Cancel
					</button>
					<button
						type="button"
						class="btn preset-filled-primary-500"
						disabled={!addByNameModel.trim() ||
							!addByNameConnectionId}
						onclick={submitAddByName}
					>
						Add model
					</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
