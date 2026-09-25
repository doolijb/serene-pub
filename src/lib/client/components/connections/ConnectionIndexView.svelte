<script lang="ts">
	/**
	 * The OPENING view of connections — what this pub can do, and what it is
	 * connected to.
	 *
	 * Two things, in that order, and models are in neither of them. Until
	 * 2026-09-17 this was Connection → Models: a card per endpoint with its
	 * models listed inside it, a pill row of defaults above, and a filter that
	 * narrowed MODELS. The concept ruling (R1) reverses that. A person opening
	 * this panel is asking one of two questions — "can this thing reply yet"
	 * and "what have I plugged in" — and a list of forty model names answers
	 * neither. Models moved to the capability view and the model finder; what
	 * is left here is a readiness card and a list of connections.
	 *
	 * Top to bottom: the Add row, the filter row, the readiness card, the
	 * connections, and the downloads tray while anything is arriving.
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
	 * It swaps the list for the ledger, with the readiness card still above it.
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
	import { getContext } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { capabilityLabel, capabilityTagline } from "@serene-pub/sdk"
	import { Dialog, Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import { JUMP_CONTEXT, type JumpCtx } from "$lib/client/shell/jump.svelte"
	import PanelFilterInput from "$lib/client/components/panels/PanelFilterInput.svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { declareInterest } from "$lib/client/sockets/interest.svelte"
	import AddMenu from "./AddMenu.svelte"
	import ConnectionRow from "./ConnectionRow.svelte"
	import DefaultsLedger from "./DefaultsLedger.svelte"
	import DownloadsTray from "./DownloadsTray.svelte"
	import StatusStrip from "./StatusStrip.svelte"
	import JobsGrid from "./JobsGrid.svelte"
	import {
		countConnections,
		filterConnections,
		foldManagedImage,
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
	import { buildJobTiles, chatFacts, type JobTile } from "./jobTile"

	type Row = Sockets.Connections.List.Row & { id: number }
	type ModelOf = Row["models"][number]

	interface Props {
		connectionsList: Sockets.Connections.List.Row[]
		capabilityDefaults?: Record<string, CapabilityDefaultRef | undefined>
		isLoading: boolean
		/**
		 * The managed KoboldCPP cannot run at all with its flag off, which is
		 * a sentence on the row rather than a badge — see `connectionRowStatus`.
		 */
		koboldCppManagerEnabled: boolean
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
		 * ⚠ Passed in rather than measured here, and passed in rather than
		 * asked of a container query: at full page this column is 340px while
		 * the VIEW is 1,500px, so `@min-[900px]/view` answers about the wrong
		 * box. The one thing it decides is whether the jobs grid renders — at
		 * desk the detail pane shows it four-across, and two copies of the same
		 * grid a few hundred pixels apart is not emphasis.
		 */
		mode?: "compact" | "desk"
		onAddNew: () => void
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
		/**
		 * Handed back up so the FULL-PAGE empty pane can render the same
		 * dashboard this view renders in a column.
		 *
		 * Lifted rather than recomputed: the tiles depend on live status this
		 * view is the only subscriber to (the KoboldCPP process, the two ONNX
		 * lanes), and a second derivation in the sidebar would disagree with
		 * this one exactly when something was wrong.
		 */
		onFacts?: (facts: {
			chat: ReturnType<typeof chatFacts>
			tiles: JobTile[]
			connectionCount: number
		}) => void
	}
	let {
		connectionsList,
		capabilityDefaults = {},
		isLoading,
		koboldCppManagerEnabled,
		syncingIds,
		syncingAll,
		initialFilter = null,
		focusConnectionId = null,
		selectedConnectionId = null,
		mode = "compact",
		onAddNew,
		onEnableManager,
		onOpenConnection,
		onOpenModel,
		onOpenCapability,
		onSetUpChat,
		onGetModel,
		onOpenDownloads,
		onRefresh,
		onAddModel,
		onFacts
	}: Props = $props()

	const socket = useTypedSocket()
	const userCtx: { user?: SelectUser } = getContext("userCtx")
	// Provided by `Layout` unconditionally (see ManagedConnectionView): the
	// managed KoboldCPP row needs to know whether a mode and binary exist
	// before it can honestly call the process "stopped".
	const koboldCppSettingsCtx: KoboldCppSettingsCtx = $state(
		getContext("koboldCppSettingsCtx") ?? { settings: undefined }
	)
	const kcppSetUp = $derived.by((): boolean | undefined => {
		const settings = koboldCppSettingsCtx.settings
		if (!settings) return undefined
		const mode = settings.koboldCppManagedMode ?? null
		if (mode === null) return false
		if (mode === "managed") return !!settings.koboldCppManagedBinaryVariant
		return true
	})
	const isAdmin = $derived(!!userCtx?.user?.isAdmin)

	let query = $state("")
	/**
	 * A hand-set filter wins; otherwise the seed applies, read through a
	 * derived so a later seed still lands.
	 */
	let filterOverride = $state<IndexFilter | null>(null)
	const filter = $derived(filterOverride ?? parseIndexFilter(initialFilter))
	let filterOpen = $state(false)

	/** List rows always carry ids; the guard is for the type. */
	const allRows = $derived(
		connectionsList.filter((c): c is Row => c.id != null)
	)
	/**
	 * ⚠ The LIST is folded; the summary is not. A capability default may name
	 * the managed image connection, which this list hides inside its sibling —
	 * resolving the summary against the folded rows would report that default
	 * as unset.
	 */
	const rows = $derived(
		foldManagedImage(
			allRows,
			(t) => t === CONNECTION_TYPE.KOBOLDCPP_MANAGED,
			(t) => t === CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE
		)
	)
	const totals = $derived(indexTotals(rows))
	const summary = $derived(defaultsSummary(allRows, capabilityDefaults))
	const byId = $derived(new Map(allRows.map((c) => [c.id, c])))

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
	const groups = $derived(groupConnections(visible, endpointKind))

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
		allRows.some((c) => endpointKind(c.type) === "koboldcpp-managed")
	)
	const hasOllama = $derived(
		allRows.some((c) => endpointKind(c.type) === "ollama")
	)
	const hasOnnxEmbeddings = $derived(
		allRows.some((c) => c.type === CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS)
	)
	const hasOnnxNer = $derived(
		allRows.some((c) => c.type === CONNECTION_TYPE.LOCAL_ONNX_NER)
	)

	let kcpp = $state<KcppStatus | null>(null)
	let ollama = $state<OllamaStatus | null>(null)
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
		ollama = {
			reachable: true,
			version: (msg as any)?.version ?? null,
			running: ollama?.running ?? []
		}
	}
	function handleOllamaUnreachable() {
		ollama = {
			reachable: false,
			version: null,
			running: ollama?.running ?? []
		}
	}
	function handleOllamaRunning(
		msg: Sockets.Ollama.ListRunningModels.Response
	) {
		ollama = {
			reachable: ollama?.reachable ?? null,
			version: ollama?.version ?? null,
			running: (msg.runningModels ?? [])
				.map((m: any) => m?.name)
				.filter((n: unknown): n is string => typeof n === "string")
		}
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
	$effect(() => downloads.setOnnx(allRows))
	const trayCount = $derived(downloads.inFlight)
	const trayPercent = $derived(downloads.percent)

	// The asks. One per kind that is actually present.
	$effect(() => {
		if (!hasKcpp || !isAdmin) return
		socket.emit("koboldcpp:getSubprocessStatus", {})
		socket.emit("koboldcpp:getLoadedConfig", {})
	})
	$effect(() => {
		if (!hasOllama || !isAdmin) return
		socket.emit("ollama:version", {})
		socket.emit("ollama:listRunningModels", {})
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

	function statusOf(connection: Row): RowStatus {
		const kind = endpointKind(connection.type)
		return connectionRowStatus(connection as any, {
			kind,
			kcpp: kind === "koboldcpp-managed" ? kcpp : null,
			ollama: kind === "ollama" ? ollama : null,
			lane: laneFor(connection),
			// Only the managed KoboldCPP is DISABLED by its flag; an Ollama
			// connection reaches its host whether the manager is on or not.
			managerEnabled:
				kind === "koboldcpp-managed"
					? koboldCppManagerEnabled
					: undefined,
			kcppSetUp: kind === "koboldcpp-managed" ? kcppSetUp : undefined,
			syncing: syncingAll || syncingIds.has(connection.id),
			timeAgo
		})
	}

	function handleRowAction(connection: Row, verb: string) {
		switch (verb) {
			case "start":
				socket.emit("koboldcpp:startSubprocess", {})
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

	// ── The readiness card ──────────────────────────────────────────────────
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
	$effect(() => {
		onFacts?.({ chat, tiles: jobTiles, connectionCount: allRows.length })
	})

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
					!allRows.some((c) =>
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
	trades: string[] = []
)}
	{@const DoorIcon = icon}
	<button
		type="button"
		class="hover:preset-tonal-primary focus-visible:ring-primary-500 flex min-h-11 w-full items-start gap-2.5 rounded-[10px] px-1.5 py-1.5 text-left focus-visible:ring-2 focus-visible:outline-none"
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
			<span class="text-surface-600-400 block truncate text-xs">
				{blurb}
			</span>
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

<div class="flex h-full min-h-0 flex-col">
	<!-- The ways in, on their own row above the controls that narrow the list:
	     adding a connection is not a way of filtering it, and one row holding
	     both would read as though it were. -->
	<div class="mb-2 flex shrink-0 items-center gap-2">
		<AddMenu
			onAddConnection={onAddNew}
			onAddKoboldCpp={() => onEnableManager("koboldcpp")}
			onAddOllama={() => onEnableManager("ollama")}
			onGetModel={() => onGetModel()}
			onAddByName={openAddByName}
			canAddByName={addByNameTargets.length > 0}
		/>
		<div class="flex-1"></div>
		<!--
			Quiet, and absent while nothing is connected.

			It was `preset-filled-primary-500` beside Add — two filled buttons
			competing in the header, with the gold one offering to fetch a model
			on a fresh install where there is nowhere to put one. Getting a model
			is a thing you do to a runtime, so it belongs where a runtime is: the
			managed connection's own view, and the capability views. It stays
			here as a quiet shortcut once there is a destination for it.
		-->
		{#if rows.length}
			<button
				type="button"
				class="btn btn-sm preset-tonal-surface shrink-0"
				onclick={() => onGetModel()}
			>
				<Icons.Download size={16} aria-hidden="true" />
				Get a model
			</button>
		{/if}
	</div>

	<!-- No filter box over an empty list: there is nothing to narrow, and the
	     empty state below is the whole screen. -->
	{#if rows.length > 0}
		<div class="mb-2 flex shrink-0 items-center gap-2">
			<div class="min-w-0 flex-1">
				<PanelFilterInput
					bind:value={query}
					placeholder={totals.connections === 1
						? "connection"
						: "connections"}
					count={totals.connections}
					aria-label="Filter connections by name, service, host or model"
				/>
			</div>
			<!-- A popout rather than a row of chips: seven choices will not fit
			     across 400px, and a strip that scrolls sideways is a strip
			     nobody reads the end of (STYLE-GUIDE §6.3). -->
			<Popover
				open={filterOpen}
				onOpenChange={(e) => (filterOpen = e.open)}
				positioning={{ placement: "bottom-end" }}
			>
				<Popover.Trigger
					class="btn grid size-10 shrink-0 place-items-center p-0 {filter !==
					'all'
						? 'preset-tonal-primary'
						: ''}"
					title="Filter connections"
					aria-label="Filter connections"
					aria-expanded={filterOpen}
				>
					<Icons.SlidersHorizontal size={16} aria-hidden="true" />
				</Popover.Trigger>
				<Portal>
					<Popover.Positioner class="z-[1000]!">
						<Popover.Content
							class="card bg-surface-100-900 border-surface-300-700 w-[min(90vw,260px)] border p-2 shadow-xl"
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
											: 'hover:preset-tonal-primary'}"
										onclick={() => pickFilter(option.value)}
									>
										<span class="min-w-0 flex-1 truncate">
											{option.label}
										</span>
										{#if option.count !== undefined}
											<span
												class="text-surface-500 shrink-0 text-[11px]"
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
		</div>

		<!-- The one narrowing in force, said once. At Everything there is
		     nothing to say and the strip is absent entirely. -->
		{#if activeFilterLabel}
			<div
				class="mb-2 flex min-w-0 shrink-0 flex-wrap items-center gap-2"
			>
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
			</div>
		{/if}
	{/if}

	<div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-2">
		{#if isLoading}
			<p class="text-surface-600-400 text-sm">Loading connections…</p>
		{:else if !rows.length}
			<!-- Nothing is connected. The whole pane becomes the question that
			     matters, and the three doors are the three answers. -->
			<section class="panel-card flex flex-col gap-2">
				<h3 class="funnel-display text-lg font-semibold">
					Where should the writing happen?
				</h3>
				<p class="text-surface-600-400 text-sm">
					A session can't reply until one model is connected. Pick the
					trade you prefer — the others can be added later.
				</p>
				<!--
					Each door names what it COSTS, in three chips.

					The doors used to describe themselves ("Already installed
					here or on another machine") and left the actual decision —
					privacy, money, memory — unstated, so the one question a
					first-timer is really asking had no answer on the screen
					they were asked it on.
				-->
				<div class="flex flex-col gap-1">
					{@render doorRow(
						Icons.Cpu,
						"On this machine",
						"KoboldCPP, installed and run by Serene Pub.",
						"preset-tonal-primary",
						"size-10",
						onSetUpChat,
						["Private", "Free", "Needs ~8 GB"]
					)}
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
						"Ollama, LM Studio, llama.cpp — here or on another machine.",
						"preset-tonal-surface",
						"size-10",
						() => onEnableManager("ollama"),
						["Private", "Free"]
					)}
				</div>
				<hr class="border-surface-300-700 my-1" />
				<p class="text-surface-600-400 text-xs">
					Know what you want?
					<button type="button" class="anchor" onclick={onAddNew}>
						Add a connection
					</button>
					lists every service and preset.
				</p>
			</section>
			<section class="panel-card flex flex-col gap-1">
				<h3 class="text-surface-500 mb-1 text-xs">Later, optionally</h3>
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
					"Smarter lore retrieval · local download",
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
					() => onOpenCapability("text->entities")
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

			<!-- Dock only: the detail pane carries it at desk. -->
			{#if mode !== "desk"}
				<JobsGrid tiles={jobTiles} onOpen={onOpenCapability} />
			{/if}

			{#if filter === "defaults"}
				<DefaultsLedger
					rows={allRows}
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
					Grouped by where the compute is, which is the trade a person
					is actually weighing: on this machine is private and free,
					a service is fast and billed. The header names it once so
					no row has to. See `connectionGroups`.
				-->
				<section class="flex flex-col gap-3">
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
							{#each groupRows as connection (connection.id)}
								<div id={`connection-row-${connection.id}`}>
									<ConnectionRow
										title={connection.name ||
											"Untitled connection"}
										serviceLabel={serviceLabel(connection)}
										kind={endpointKind(connection.type)}
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
				<h2 class="funnel-display text-lg font-semibold">
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
						<span class="text-surface-500 text-xs">
							Model identifier
						</span>
						<input
							class="input"
							bind:value={addByNameModel}
							placeholder="meta-llama/Llama-3.1-8B-Instruct"
						/>
					</label>
					<label class="flex flex-col gap-1">
						<span class="text-surface-500 text-xs">
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
