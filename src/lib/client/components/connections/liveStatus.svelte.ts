/**
 * The live statuses a list of connections needs — the managed KoboldCPP's
 * process and what it holds, each Ollama host's answer, and the local ONNX
 * lanes — held for as long as the calling view is mounted.
 *
 * Extracted whole from `ConnectionIndexView` (plan 2026-10-11, lane L1) so the
 * Models view and the Connections view can read the same rows the same way:
 * `statusOf(connection)` is a row's dot, `factsFor(entry)` is what the
 * readiness rows could not know about a pair.
 *
 * Presence, not possibility: an install with no managed KoboldCPP never asks
 * the manager anything, and an install with no local ONNX connection never
 * wakes an embedding lane to ask whether it is resident.
 *
 * ⚠ Call during component initialisation: it declares its interests in
 * effects, and reads `systemSettingsCtx` / `koboldCppSettingsCtx` from the
 * calling component's context.
 */
import { getContext, untrack } from "svelte"
import { SvelteMap } from "svelte/reactivity"
import { useTypedSocket } from "$lib/client/sockets/typedSocket"
import { declareInterest, onConnect } from "$lib/client/sockets/interest.svelte"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { connectionTypeDisabledReason } from "$lib/shared/utils/connectionServiceItems"
import {
	connectionRowStatus,
	rowDefaults,
	type RowDefaults,
	type RowStatus
} from "./connectionRowStatus"
import type { DefaultsSummaryEntry } from "./defaultsSummary"
import type { KcppStatus, LaneStatus, OllamaStatus } from "./endpointStatus"
import { getModelDisabledReason } from "./jobPicker"
import { kcppInstallState } from "./managedConnectionView"
import { endpointKind } from "./modelManagement"
import type { EntryFacts } from "./readiness"
import { timeAgo } from "$lib/client/utils/timeAgo"

type Row = Sockets.Connections.List.Row & { id: number }

export interface LiveStatusOptions {
	/** Whether the person is an admin (restricted asks wait for it). */
	admin: () => boolean
	/** The defaults summary's entries — the row's gold marks read them. */
	entries?: () => readonly DefaultsSummaryEntry[]
	/**
	 * The registered capability defaults — whether a broken row fills a
	 * loadout, and so is the one drawn red (`RowStatus.blocked`).
	 */
	capabilityDefaults?: () => RowDefaults["capabilityDefaults"]
	/** Whether a sync is in flight for a connection. */
	syncing?: (connectionId: number) => boolean
}

export function useLiveStatus(getRows: () => Row[], opts: LiveStatusOptions) {
	const socket = useTypedSocket()
	const systemSettingsCtx: SystemSettingsCtx | undefined =
		getContext("systemSettingsCtx")
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
	const isAdmin = $derived(opts.admin())
	const rows = $derived(getRows())
	const byId = $derived(new Map(rows.map((c) => [c.id, c])))
	const entitiesBlocked = $derived(
		getModelDisabledReason(
			"text->entities",
			systemSettingsCtx?.settings?.localOnnxAvailability
		)
	)

	const hasKcpp = $derived(
		rows.some((c) => endpointKind(c.type) === "koboldcpp-managed")
	)
	/**
	 * ⚠ `type === OLLAMA`, never `endpointKind(...) === "ollama"`: that kind
	 * also covers an Ollama *embeddings* connection, which is a plain API to
	 * the index (`statusOf` reads it as one) and is not something the
	 * manager's host asks are about.
	 */
	const isOllamaRuntime = (c: Row) => c.type === CONNECTION_TYPE.OLLAMA
	const hasOllama = $derived(rows.some(isOllamaRuntime))
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
	const ollamaIds = $derived(rows.filter(isOllamaRuntime).map((c) => c.id))
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
			connectionId: msg.connectionId ?? null,
			loaded: !!msg.loaded,
			lastUsedAt: msg.lastUsedAt ?? null,
			pending: msg.pending ?? null
		}
	}
	function handleNerStatus(msg: Sockets.Ner.Status.Response) {
		entityLane = {
			modelId: msg.modelId ?? null,
			connectionId: msg.connectionId ?? null,
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
	 * Every key this hook holds, declared ABOVE the effects that emit — effects
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
	/**
	 * Every status above is PUSHED after its first answer, and a push sent
	 * while the socket was down (a dropped connection, a server restart) is
	 * gone — the row would keep "Starting" or "Not reachable" until the
	 * panel was reopened. So the same asks run again on every reconnect,
	 * reading what is present at THAT moment rather than at registration.
	 */
	$effect(() =>
		onConnect(() => {
			if (!isAdmin) return
			if (hasKcpp) reaskKcpp()
			for (const id of ollamaIds) {
				socket.emit("ollama:version", { connectionId: id })
				socket.emit("ollama:listRunningModels", { connectionId: id })
			}
			reaskLocalOnnx()
		})
	)

	/** Which lane a local ONNX row is looking at, or null for anything else. */
	function laneFor(connection: Row): LaneStatus | null {
		if (connection.type === CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS)
			return embeddingLane
		if (connection.type === CONNECTION_TYPE.LOCAL_ONNX_NER)
			return entityLane
		return null
	}

	/**
	 * A row's status, live facts included.
	 *
	 * ⚠ A local ONNX row on a machine whose runtime didn't load says why, in
	 * place of whatever its lane reports: its Set up and Fix lead to a
	 * Download the server refuses, and "Active" would claim a model that
	 * can't load. Quiet, not red — nothing the person did is broken. The row
	 * still opens, and its view says the same above the models.
	 */
	function statusOf(
		connection: Row,
		{ ignoreSyncing = false }: { ignoreSyncing?: boolean } = {}
	): RowStatus {
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
		// An Ollama embeddings connection reads as the API it is: no host
		// status is asked for it (see `isOllamaRuntime`), so the Ollama
		// reading would say "Not checked" forever.
		const kind =
			connection.type === CONNECTION_TYPE.OLLAMA_EMBEDDINGS
				? "api"
				: endpointKind(connection.type)
		return connectionRowStatus(connection as any, {
			kind,
			kcpp: kind === "koboldcpp-managed" ? kcpp : null,
			ollama:
				kind === "ollama"
					? (ollamaById.get(connection.id) ?? null)
					: null,
			lane: laneFor(connection),
			kcppInstall: kind === "koboldcpp-managed" ? kcppInstall : undefined,
			defaults: rowDefaults(
				(opts.entries?.() ?? []) as any,
				opts.capabilityDefaults?.()
			),
			syncing: !ignoreSyncing && (opts.syncing?.(connection.id) ?? false),
			timeAgo
		})
	}

	/**
	 * What the summary could not know about a pair: whether its files are
	 * here, whether the process holding it is up, and whether the manager that
	 * owns it is switched on at all.
	 */
	function factsFor(entry: DefaultsSummaryEntry): EntryFacts {
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

	return {
		statusOf,
		factsFor,
		laneFor,
		reaskKcpp,
		get kcpp() {
			return kcpp
		},
		get ollamaById(): ReadonlyMap<number, OllamaStatus> {
			return ollamaById
		},
		get embeddingLane() {
			return embeddingLane
		},
		get entityLane() {
			return entityLane
		},
		get entitiesBlocked() {
			return entitiesBlocked
		},
		get kcppInstall() {
			return kcppInstall
		},
		get koboldCppManagerEnabled() {
			return koboldCppManagerEnabled
		}
	}
}

export type LiveStatus = ReturnType<typeof useLiveStatus>
