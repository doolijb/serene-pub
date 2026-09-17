<script lang="ts">
	/**
	 * The OPENING view of connections — every endpoint with its models.
	 *
	 * Organised Connection → Models: one group per endpoint, its models as rows
	 * beneath it. Neither is a category of the other in the data (endpoints are
	 * not pure by modality — one KoboldCPP does chat, vision and images), so the
	 * only filing here is the one that is true: where the compute is, and what
	 * is reachable through it.
	 *
	 * Top to bottom: the defaults pill row, search, the filter pills, the
	 * totals, and the groups.
	 *
	 * ## The defaults row is the first thing, because it is the first question
	 *
	 * "Which model answers when I press send" is what an admin opens this panel
	 * to find out, and until 0.6 the answer was a trip to Admin → Defaults. It
	 * is a ROW OF PILLS rather than a tile per section: there are ten transforms
	 * and four sections, so a tile per section could not show six of them, and a
	 * tile per transform would be a grid taller than the list it sits above.
	 * Pills wrap; nothing here scrolls sideways.
	 *
	 * ## One filter, as pills rather than a dropdown
	 *
	 * Everything, defaults, needs-attention, then one per section. A `<select>`
	 * hid the counts — "needs attention (3)" is the reason to press it — and
	 * cost a press to find out what the choices even were. The values are
	 * unchanged (`connectionIndexFilter`), so a seeded `cap:` filter from Jump
	 * or the onboarding wizard still lands; one that matches no pill is appended
	 * as its own.
	 *
	 * ## Defaults is not a filter over the groups
	 *
	 * It swaps them for the ledger. See `DefaultsLedger`'s header for why.
	 *
	 * ## Live status, asked for only where it applies
	 *
	 * A managed KoboldCPP's process, an Ollama host's version, the two local
	 * ONNX lanes — asked for HERE, once, and only when the list actually
	 * contains an endpoint of that kind, then handed down per group. Every one
	 * of them may stay silent (a manager switched off, a server build without
	 * the handler yet); a silent one renders as no line at all.
	 *
	 * The view decides nothing about which rows are shown — that is
	 * `connectionIndexFilter`, a pure function with its own tests.
	 */
	import { getContext } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { capabilityLabel } from "@serene-pub/sdk"
	import { JUMP_CONTEXT, type JumpCtx } from "$lib/client/shell/jump.svelte"
	import PanelFilterInput from "$lib/client/components/panels/PanelFilterInput.svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { declareInterest } from "$lib/client/sockets/interest.svelte"
	import ConnectionCard from "./ConnectionCard.svelte"
	import DefaultsLedger from "./DefaultsLedger.svelte"
	import {
		filterIndex,
		indexTotals,
		parseIndexFilter,
		type IndexFilter
	} from "./connectionIndexFilter"
	import {
		CONNECTION_SECTIONS,
		sectionForCapability,
		sectionForModality
	} from "$lib/shared/constants/connectionSections"
	import { OUTPUT_KIND_ICONS } from "$lib/shared/constants/outputKinds"
	import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
	import { isKoboldCppManagedType } from "$lib/shared/utils/connectionServiceItems"
	import { defaultsSummary, type DefaultState } from "./defaultsSummary"
	import { endpointKind, type RowAction } from "./modelManagement"
	import type { KcppStatus, LaneStatus, OllamaStatus } from "./endpointStatus"
	import {
		systemCapabilitiesForModel,
		type CapabilityDefaultRef
	} from "./modelSystemDefaults"

	type Row = Sockets.Connections.List.Row & { id: number }
	type ModelOf = Row["models"][number]

	interface Props {
		connectionsList: Sockets.Connections.List.Row[]
		capabilityDefaults?: Record<string, CapabilityDefaultRef | undefined>
		isLoading: boolean
		koboldCppManagerEnabled: boolean
		/** Endpoint ids with a sync in flight. */
		syncingIds: ReadonlySet<number>
		/** Every endpoint is being checked (the open-time sweep). */
		syncingAll: boolean
		/** Seeds the filter (e.g. the onboarding wizard's step, as `cap:<transform>`). */
		initialFilter?: string | null
		/** Scroll this endpoint's group into view and highlight it once. */
		focusConnectionId?: number | null
		onAddNew: () => void
		onOpenConnection: (connection: Row) => void
		onOpenModel: (connection: Row, model: ModelOf) => void
		onRefresh: (connection: Row) => void
		onRefreshAll: () => void
		onManage: (connection: Row, panel: "ollama" | "koboldcpp") => void
		onAddModel: (connection: Row, model: string, name: string) => void
		/**
		 * Register this pair as one capability's default.
		 *
		 * ⚠ Raised rather than emitted here: the sidebar's chain is what puts
		 * the costed confirmation in front of a switch that throws stored
		 * vectors or annotations away.
		 */
		onMakeDefault: (
			connection: Row,
			model: ModelOf,
			capability: string
		) => void
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
		onAddNew,
		onOpenConnection,
		onOpenModel,
		onRefresh,
		onRefreshAll,
		onManage,
		onAddModel,
		onMakeDefault
	}: Props = $props()

	const socket = useTypedSocket()
	const userCtx: { user?: SelectUser } = getContext("userCtx")

	let query = $state("")
	/**
	 * A hand-set filter wins; otherwise the seed applies, read through a
	 * derived so a later seed still lands.
	 */
	let filterOverride = $state<IndexFilter | null>(null)
	const filter = $derived(filterOverride ?? parseIndexFilter(initialFilter))

	/** List rows always carry ids; the guard is for the type. */
	const rows = $derived(connectionsList.filter((c): c is Row => c.id != null))
	const totals = $derived(indexTotals(rows))
	const summary = $derived(defaultsSummary(rows, capabilityDefaults))

	/**
	 * The filter pills: three views of the whole, then one per section.
	 *
	 * Four sections rather than ten transforms — the sections are the shapes a
	 * person thinks in ("images", "entities"), and a pill per transform would
	 * be a second wrapping row saying the same four things six more ways. A
	 * seeded `cap:` value outside that four is appended so the filter on screen
	 * is always the filter in force.
	 */
	const SECTION_PILL_LABELS: Record<string, string> = {
		"text-gen": "Chat",
		"image-gen": "Images",
		embeddings: "Embeddings",
		ner: "Entities"
	}
	const filterPills = $derived.by(() => {
		const attention = totals.missing + totals.unreachable
		const pills: { value: IndexFilter; label: string }[] = [
			{ value: "all", label: "All" },
			{ value: "defaults", label: "Defaults" },
			{
				value: "attention",
				label: attention
					? `Needs attention (${attention})`
					: "Needs attention"
			},
			...CONNECTION_SECTIONS.map((s) => ({
				value: `cap:${s.starCapability}` as IndexFilter,
				label:
					SECTION_PILL_LABELS[s.modality] ?? labelOf(s.starCapability)
			}))
		]
		if (!pills.some((p) => p.value === filter))
			pills.push({
				value: filter,
				label: filter.startsWith("cap:")
					? labelOf(filter.slice(4))
					: filter
			})
		return pills
	})

	function labelOf(id: string): string {
		try {
			return capabilityLabel(id as any)
		} catch {
			return sectionForCapability(id)?.starVerb ?? id
		}
	}

	function serviceLabelOf(type: string | null | undefined): string {
		return (
			CONNECTION_TYPE.options.find((t) => t.value === type)?.label ??
			(type || "Unknown service")
		)
	}

	const groups = $derived(
		filterIndex(rows, {
			query,
			filter,
			isDefault: (c, m) =>
				systemCapabilitiesForModel(capabilityDefaults, c, m).length > 0,
			serviceLabel: serviceLabelOf
		})
	)

	const hasNoMatches = $derived(
		!isLoading && rows.length > 0 && groups.length === 0
	)

	const DOT_CLASS: Record<DefaultState, string> = {
		ok: "bg-success-500",
		pending: "bg-surface-400-600",
		warning: "bg-warning-500",
		unset: "bg-surface-400-600"
	}

	/**
	 * Jump, scoped to this view.
	 *
	 * Registered from HERE and not from `ConnectionsSidebar`, which is the
	 * thing the rail opens: this component is mounted exactly while the index
	 * is on screen — as the whole screen in compact, as the standing left
	 * column at desk width — so the scope exists exactly while there is a
	 * filter box to bind to. A model's detail screen alone has no list to
	 * narrow.
	 *
	 * The rows are the groups' own two levels. A model carries its endpoint in
	 * `parentId`, which is what tells `onPick` which of the two things was
	 * picked; nothing outside this registration ever sees these hits, so they
	 * never reach the shared resolver.
	 */
	const jumpCtx = getContext<JumpCtx | undefined>(JUMP_CONTEXT)
	$effect(() =>
		jumpCtx?.registerScope("connections", {
			label: "Connections",
			placeholder: "Filter connections and models",
			getQuery: () => query,
			setQuery: (next) => (query = next),
			getHits: () =>
				groups.flatMap((group) => [
					{
						kind: "connection" as const,
						id: group.connection.id,
						title: group.connection.name || "Untitled connection",
						subtitle: serviceLabelOf(group.connection.type)
					},
					...group.models.map((model) => ({
						kind: "connection" as const,
						id: model.id,
						parentId: group.connection.id,
						title: model.name,
						subtitle: group.connection.name || undefined
					}))
				]),
			onPick: (hit) => {
				const connection =
					hit.parentId === undefined
						? rows.find((c) => c.id === Number(hit.id))
						: rows.find((c) => c.id === Number(hit.parentId))
				if (!connection) return
				if (hit.parentId === undefined) {
					onOpenConnection(connection)
					return
				}
				const model = connection.models.find(
					(m) => m.id === Number(hit.id)
				)
				if (model) onOpenModel(connection, model)
			}
		})
	)

	function clearFilters() {
		query = ""
		filterOverride = "all"
	}

	function manageDisabledFor(connection: Row): boolean {
		return (
			isKoboldCppManagedType(connection.type ?? "") &&
			!koboldCppManagerEnabled
		)
	}

	// ── Which live statuses this list needs ─────────────────────────────────
	//
	// Presence, not possibility: an install with no managed KoboldCPP never
	// asks the manager anything, and an install with no local ONNX endpoint
	// never wakes an embedding lane to ask whether it is resident.
	const isAdmin = $derived(!!userCtx?.user?.isAdmin)
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
	let ollama = $state<OllamaStatus | null>(null)
	let embeddingLane = $state<LaneStatus | null>(null)
	let entityLane = $state<LaneStatus | null>(null)
	/** The Hub form's last refusal, keyed by the endpoint that asked. */
	let hubErrors = $state<Record<number, string>>({})
	/** Which endpoint's Hub form is in flight, so its refusal lands on it. */
	let hubPendingId: number | null = null

	function ensureKcpp(): KcppStatus {
		if (!kcpp) kcpp = { run: null, loadedFiles: [], downloads: [] }
		return kcpp
	}
	function handleKcppSubprocess(
		msg: Sockets.KoboldCPP.GetSubprocessStatus.Response
	) {
		kcpp = { ...ensureKcpp(), run: msg.status?.status ?? null }
	}
	function handleKcppLoaded(msg: Sockets.KoboldCPP.GetLoadedConfig.Response) {
		const resident = msg.config?.resident
		const files = [resident?.text?.file, resident?.image?.file].filter(
			(f): f is string => !!f
		)
		kcpp = { ...ensureKcpp(), loadedFiles: files }
	}
	function handleKcppDownloads(
		msg: Sockets.KoboldCPP.GetDownloadProgress.Response
	) {
		kcpp = {
			...ensureKcpp(),
			downloads: Object.values(msg.downloads ?? {})
				.filter((d) => !d.isDone)
				.map((d) => ({
					filename: d.filename,
					downloaded: d.downloaded,
					total: d.total
				}))
		}
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
	 * groups' "Active: …" status lines don't refresh themselves on either, so
	 * ask again the same way the mount effects below do.
	 */
	function reaskLocalOnnx() {
		if (hasOnnxEmbeddings && isAdmin) socket.emit("vectorization:status", {})
		if (hasOnnxNer && isAdmin) socket.emit("ner:status", {})
	}

	function handleAddHubModel(_msg: Sockets.Connections.AddHubModel.Response) {
		// The refreshed list arrives on `connections:list`; all this has to do
		// is clear the refusal the form is showing.
		if (hubPendingId != null) {
			const { [hubPendingId]: _drop, ...rest } = hubErrors
			hubErrors = rest
		}
		hubPendingId = null
	}
	function handleAddHubModelError(msg: { error?: string }) {
		if (hubPendingId == null) return
		hubErrors = {
			...hubErrors,
			[hubPendingId]: msg.error ?? "The Hub would not confirm that id."
		}
		hubPendingId = null
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
			declareInterest<"koboldcpp:getLoadedConfig">(
				"koboldcpp:getLoadedConfig",
				handleKcppLoaded
			),
			declareInterest<"koboldcpp:getDownloadProgress">(
				"koboldcpp:getDownloadProgress",
				handleKcppDownloads
			),
			declareInterest<"koboldcpp:downloadProgress">(
				"koboldcpp:downloadProgress",
				handleKcppDownloads
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
			),
			declareInterest<"koboldcpp:cancelDownload">(
				"koboldcpp:cancelDownload",
				() => socket.emit("koboldcpp:getDownloadProgress", {})
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
	$effect(() => {
		const releases = [
			declareInterest<"connections:addHubModel">(
				"connections:addHubModel",
				handleAddHubModel
			),
			declareInterest<"connections:addHubModel:error">(
				"connections:addHubModel:error",
				handleAddHubModelError
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
		socket.emit("koboldcpp:getDownloadProgress", {})
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

	/** Which lane a local ONNX group is looking at, or null for anything else. */
	function laneFor(connection: Row): LaneStatus | null {
		if (connection.type === CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS)
			return embeddingLane
		if (connection.type === CONNECTION_TYPE.LOCAL_ONNX_NER)
			return entityLane
		return null
	}

	/**
	 * One press on a row's one action.
	 *
	 * ⚠ `makeActive` is NOT emitted here. It is a capability default like any
	 * other, so it goes up to the sidebar's chain and the costed confirmation
	 * appears; a shortcut from this list would throw a person's stored vectors
	 * away with no sentence saying so.
	 */
	function handleRowAction(
		connection: Row,
		model: ModelOf,
		action: RowAction
	) {
		switch (action.verb) {
			case "download":
			case "retry":
				socket.emit("connections:downloadModel", {
					id: connection.id,
					modelId: model.id
				})
				return
			case "cancel":
				socket.emit("connections:cancelModelDownload", {
					id: connection.id,
					modelId: model.id
				})
				return
			case "load":
				socket.emit("koboldcpp:loadModel", { filename: model.model })
				return
			case "cancelKcpp":
				socket.emit("koboldcpp:cancelDownload", {
					filename: model.model
				})
				return
			case "makeActive": {
				const capability = sectionForModality(
					connection.modality
				)?.starCapability
				if (capability) onMakeDefault(connection, model, capability)
				return
			}
		}
	}

	function handleAddHub(connection: Row, hubId: string) {
		hubPendingId = connection.id
		const { [connection.id]: _drop, ...rest } = hubErrors
		hubErrors = rest
		socket.emit("connections:addHubModel", { id: connection.id, hubId })
	}
</script>

<div class="flex h-full flex-col gap-3">
	<div class="flex flex-col gap-2">
		<button
			type="button"
			class="btn preset-filled-primary-500 w-full"
			onclick={onAddNew}
		>
			<Icons.Plus size={16} aria-hidden="true" />
			Add connection
		</button>

		<!-- The defaults row. Every pill is a button: a set default opens its
		     model, the dashed one opens the ledger.

		     Hidden on an install with no connections at all: "0 of 10 set" is
		     true and useless there, and the empty state below already says the
		     one thing to do. -->
		{#if rows.length}
			<div
				class="flex flex-col gap-1.5"
				role="group"
				aria-label="Instance defaults"
			>
				<div class="flex items-baseline gap-2 px-0.5">
					<span
						class="text-muted min-w-0 flex-1 truncate text-[11px]"
					>
						Defaults · {summary.setCount} of {summary.total} set
					</span>
					<a
						class="anchor shrink-0 text-[11px]"
						href="/admin/defaults"
					>
						Admin → Defaults
					</a>
				</div>
				<div class="flex flex-wrap gap-1.5">
					{#each summary.pills as pill (pill.capability)}
						{@const PillIcon =
							(Icons as any)[
								OUTPUT_KIND_ICONS[pill.outputKind ?? ""] ?? ""
							] ?? Icons.Boxes}
						<button
							type="button"
							class="preset-tonal-surface hover:preset-tonal-primary flex max-w-full min-w-0 items-center gap-1.5 rounded-full px-2 py-1 text-[11px]"
							title={`${pill.label}: ${pill.model?.name} on ${pill.connection?.name} — ${pill.stateWord}`}
							onclick={() =>
								pill.connection &&
								pill.model &&
								onOpenModel(
									pill.connection as Row,
									pill.model as ModelOf
								)}
						>
							<PillIcon
								size={12}
								class="shrink-0"
								aria-hidden="true"
							/>
							<span class="min-w-0 truncate">
								{pill.model?.name}
							</span>
							<span
								class="size-1.5 shrink-0 rounded-full {DOT_CLASS[
									pill.state
								]}"
								aria-hidden="true"
							></span>
						</button>
					{/each}
					{#if summary.unsetCount}
						<button
							type="button"
							class="border-surface-300-700 text-muted hover:preset-tonal-primary shrink-0 rounded-full border border-dashed px-2 py-1 text-[11px]"
							onclick={() => (filterOverride = "defaults")}
						>
							{summary.unsetCount} not set
						</button>
					{/if}
				</div>
			</div>
		{/if}

		<PanelFilterInput
			bind:value={query}
			placeholder={`Filter ${totals.models} models`}
			aria-label="Search connections and models"
		/>

		<div class="flex items-start gap-2">
			<div
				class="flex min-w-0 flex-1 flex-wrap gap-1"
				role="group"
				aria-label="Show"
			>
				{#each filterPills as pill (pill.value)}
					{@const active = filter === pill.value}
					<button
						type="button"
						class="rounded-full px-2 py-0.5 text-[11px] {active
							? 'preset-filled-surface-200-800 font-medium'
							: 'text-muted hover:preset-tonal-surface'}"
						aria-pressed={active}
						onclick={() => (filterOverride = pill.value)}
					>
						{pill.label}
					</button>
				{/each}
			</div>
			<button
				type="button"
				class="btn-icon preset-tonal-surface shrink-0"
				onclick={onRefreshAll}
				disabled={syncingAll || isLoading || !rows.length}
				title="Ask every host for its models again"
				aria-label="Refresh every connection's models"
			>
				<Icons.RefreshCw
					size={14}
					class={syncingAll ? "animate-spin" : ""}
					aria-hidden="true"
				/>
			</button>
		</div>
	</div>

	<div class="min-h-0 flex-1 overflow-y-auto pb-4">
		{#if isLoading}
			<p class="text-muted text-sm">Loading connections…</p>
		{:else if !rows.length}
			<div
				class="flex flex-col items-center gap-2 px-4 py-10 text-center"
			>
				<Icons.Cable
					size={28}
					class="text-surface-400"
					aria-hidden="true"
				/>
				<p class="text-muted text-sm">
					No connections yet. Add one to reach a model.
				</p>
			</div>
		{:else}
			<!-- One line of totals; the attention count is a shortcut. -->
			<p class="text-muted mb-2 px-0.5 text-[11px]">
				{totals.connections}
				{totals.connections === 1 ? "connection" : "connections"} ·
				{totals.models}
				{totals.models === 1 ? "model" : "models"}
				{#if totals.missing || totals.unreachable}
					·
					<button
						type="button"
						class="text-warning-500 underline-offset-2 hover:underline"
						onclick={() => (filterOverride = "attention")}
					>
						{totals.missing + totals.unreachable} need attention
					</button>
				{/if}
			</p>

			{#if filter === "defaults"}
				<DefaultsLedger
					{rows}
					{capabilityDefaults}
					onOpenModel={(connection, model) =>
						onOpenModel(connection, model)}
				/>
			{:else if hasNoMatches}
				<div class="flex flex-col items-start gap-2">
					<p class="text-muted text-sm">Nothing matches.</p>
					<button
						type="button"
						class="btn btn-sm preset-filled-surface-400-600"
						onclick={clearFilters}
					>
						Clear search and filter
					</button>
				</div>
			{:else}
				<!-- One column in the sidebar, as many 22rem groups as fit
				     when the panel goes fullscreen. -->
				<div
					class="grid [grid-template-columns:repeat(auto-fill,minmax(min(100%,22rem),1fr))] gap-2.5"
				>
					{#each groups as group (group.connection.id)}
						<ConnectionCard
							connection={group.connection}
							models={group.models}
							serviceLabel={serviceLabelOf(group.connection.type)}
							manageDisabled={manageDisabledFor(group.connection)}
							{capabilityDefaults}
							syncing={syncingAll ||
								syncingIds.has(group.connection.id)}
							focused={focusConnectionId === group.connection.id}
							kcpp={endpointKind(group.connection.type) ===
							"koboldcpp-managed"
								? kcpp
								: null}
							ollama={endpointKind(group.connection.type) ===
							"ollama"
								? ollama
								: null}
							lane={laneFor(group.connection)}
							hubError={hubErrors[group.connection.id] ?? null}
							onOpen={() => onOpenConnection(group.connection)}
							onOpenModel={(model) =>
								onOpenModel(group.connection, model)}
							onRefresh={() => onRefresh(group.connection)}
							onManage={(panel) =>
								onManage(group.connection, panel)}
							onAddModel={(model, name) =>
								onAddModel(group.connection, model, name)}
							onRowAction={(model, action) =>
								handleRowAction(
									group.connection,
									model,
									action
								)}
							onKcppStart={() =>
								socket.emit("koboldcpp:startSubprocess", {})}
							onKcppStop={() =>
								socket.emit("koboldcpp:stopSubprocess", {})}
							onLaneUnload={() =>
								group.connection.type ===
								CONNECTION_TYPE.LOCAL_ONNX_NER
									? socket.emit("ner:unloadModel", {})
									: socket.emit(
											"vectorization:unloadModel",
											{}
										)}
							onAddHubModel={(hubId) =>
								handleAddHub(group.connection, hubId)}
						/>
					{/each}
				</div>
			{/if}
		{/if}
	</div>
</div>
