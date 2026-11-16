<script lang="ts">
	import Badge from "$lib/client/components/Badge.svelte"
	/**
	 * Admin → Connections: the changelist (owner ruling 2026-09-27 — admin
	 * manages its objects Django-style instead of nesting the Models
	 * view). Every connection on the instance with its service, modality,
	 * models, the defaults it holds and its state; filters, search, bulk
	 * delete. A row opens its change form at `/admin/connections/<id>`; its
	 * **Open in Connections** opens the Connections view on that connection
	 * (`digest.connectionId`).
	 *
	 * The rows are `connections:list`, the same list the Connections and
	 * Models views read; deleting is `connections:delete`, one per row, plus the manager
	 * switch a managed runtime's last row takes with it (`managerFlagsReleased`).
	 */
	import { getContext, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { openInConnections } from "$lib/client/admin/railDoors"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
	import { notify } from "$lib/client/utils/notify"
	import { useConnections } from "$lib/client/contexts/connections.svelte"
	import { timeAgo } from "$lib/client/utils/timeAgo"
	import AdminChangelist from "$lib/client/components/admin/AdminChangelist.svelte"
	import type {
		AdminBulkAction,
		AdminChangelistColumn,
		AdminChangelistFilter
	} from "$lib/client/components/admin/changelist"
	import { serviceLabel } from "$lib/client/components/connections/connectionIndexFilter"
	import {
		connectionRowStatus,
		rowDefaults,
		rowStatusClasses,
		type RowStatus
	} from "$lib/client/components/connections/connectionRowStatus"
	import { defaultsSummary } from "$lib/client/components/connections/defaultsSummary"
	import {
		connectionComesWithApp,
		endpointKind
	} from "$lib/client/components/connections/modelManagement"
	import {
		MODALITY_ORDER,
		connectionDeletion,
		defaultsHeldBy,
		llmLaneUsedBy,
		llmLaneWidthParse,
		LLM_LANE_WIDTH_MAX,
		managerFlagsReleased,
		modalityWord
	} from "./connectionsAdmin"

	type Row = Sockets.Connections.List.Row & { id: number }

	const socket = useTypedSocket()
	const systemSettingsCtx: SystemSettingsCtx = getContext("systemSettingsCtx")
	const panelsCtx: PanelsCtx | undefined = getContext("panelsCtx")

	let rows = $state<Row[]>([])
	let loading = $state(true)

	function handleList(msg: Sockets.Connections.List.Response) {
		rows = msg.connectionsList.filter((c): c is Row => c.id != null)
		loading = false
	}
	useInterest<"connections:list">("connections:list", handleList)
	useInterest<"connections:list:error">("connections:list:error", () => {
		loading = false
	})

	/** Ids this page asked to delete, so its toast counts only its own. */
	let deleting = $state<number[]>([])
	/**
	 * The manager switches this page's deletes release, sent only once every
	 * one of them is acknowledged (`managerFlagsReleased`).
	 */
	let releasing: ReturnType<typeof managerFlagsReleased> = []
	function handleDelete(msg: Sockets.Connections.Delete.Response) {
		if (!deleting.includes(msg.id)) return
		deleting = deleting.filter((id) => id !== msg.id)
		if (deleting.length) return
		for (const event of releasing) socket.emit(event, { enabled: false })
		releasing = []
		notify.success({ title: "Deleted" })
	}
	useInterest<"connections:delete">("connections:delete", handleDelete)

	// Held for the page's life: the context is the one listener for the
	// requests-at-once card and the only place its "Saved" toast is said.
	const connectionsCtx = useConnections()

	onMount(() => {
		socket.emit("connections:list", {})
		connectionsCtx.askLlmLanes()
	})

	// ── Requests at once ────────────────────────────────────────────────
	/** Refusal sentences by address; a field's edit text by address. */
	let laneRefusals = $state<Record<string, string>>({})
	let laneEdits = $state<Record<string, number | null | undefined>>({})
	function saveLane(host: Sockets.Connections.LlmLanes.Host) {
		const edited =
			host.laneKey in laneEdits ? laneEdits[host.laneKey] : host.width
		const parsed = llmLaneWidthParse(edited)
		if (!parsed.ok) {
			laneRefusals = { ...laneRefusals, [host.laneKey]: parsed.refusal }
			return
		}
		const { [host.laneKey]: _gone, ...rest } = laneRefusals
		laneRefusals = rest
		delete laneEdits[host.laneKey]
		if (parsed.width === host.width) return
		connectionsCtx.setLlmLaneWidth(host.laneKey, parsed.width)
	}

	const defaults = $derived(systemSettingsCtx?.capabilityDefaults ?? {})
	// The index view's reading, so a row here and the same row there carry
	// one label.
	const rowFacts = $derived(
		rowDefaults(defaultsSummary(rows, defaults).entries, defaults)
	)
	const statusOf = (r: Row): RowStatus =>
		connectionRowStatus(r as any, {
			kind: endpointKind(r.type),
			timeAgo,
			defaults: rowFacts
		})
	const STATE_ORDER = ["broken", "unfinished", "busy", "ready", "idle"]

	const columns: AdminChangelistColumn<Row>[] = [
		{
			key: "name",
			label: "Name",
			primary: true,
			text: (r) => r.name ?? `Connection ${r.id}`,
			sortValue: (r) => r.name
		},
		{
			key: "service",
			label: "Service",
			text: (r) => serviceLabel(r),
			sortValue: (r) => serviceLabel(r)
		},
		{
			key: "modality",
			label: "Modality",
			text: (r) => modalityWord(r.modality),
			sortValue: (r) => MODALITY_ORDER.indexOf(r.modality ?? "")
		},
		{
			key: "models",
			label: "Models",
			numeric: true,
			text: (r) =>
				`${r.models.length} ${r.models.length === 1 ? "model" : "models"}`,
			sortValue: (r) => r.models.length
		},
		{
			key: "defaults",
			label: "Fills loadouts",
			custom: true,
			sortValue: (r) => defaultsHeldBy(r, defaults).length || null
		},
		{
			key: "status",
			label: "Status",
			custom: true,
			sortValue: (r) => STATE_ORDER.indexOf(statusOf(r).state)
		},
		{
			key: "open",
			label: "Open",
			custom: true,
			class: "w-0 text-right"
		}
	]

	const filters: AdminChangelistFilter<Row>[] = [
		{ key: "service", label: "Service", values: (r) => serviceLabel(r) },
		{
			key: "modality",
			label: "Modality",
			values: (r) => r.modality ?? null,
			optionLabel: modalityWord,
			order: MODALITY_ORDER
		},
		{
			key: "status",
			label: "Status",
			values: (r) => statusOf(r).state,
			optionLabel: (v) =>
				({
					ready: "Ready",
					idle: "Idle",
					unfinished: "Unfinished",
					busy: "Busy",
					broken: "Broken"
				})[v] ?? v,
			order: STATE_ORDER
		},
		{
			key: "default",
			label: "Default",
			values: (r) =>
				defaultsHeldBy(r, defaults).length ? "holds" : "none",
			optionLabel: (v) =>
				v === "holds" ? "Holds a default" : "Holds none",
			order: ["holds", "none"]
		}
	]

	/** The app-made connections never go; the rest of a selection may. */
	function splitComesWithApp(selected: readonly Row[]) {
		return {
			going: selected.filter((r) => !connectionComesWithApp(r.type)),
			kept: selected.filter((r) => connectionComesWithApp(r.type))
		}
	}
	function keptLine(kept: readonly Row[]): string {
		const names = kept.map((r) => r.name ?? `Connection ${r.id}`).join(", ")
		return `${names} ${kept.length === 1 ? "comes" : "come"} with Serene Pub and ${kept.length === 1 ? "stays" : "stay"}. `
	}

	const bulkActions: AdminBulkAction<Row>[] = [
		{
			key: "delete",
			label: "Delete selected connections…",
			icon: Icons.Trash2,
			destructive: true,
			confirm: (selected) => {
				const { going, kept } = splitComesWithApp(selected)
				if (!kept.length) return connectionDeletion(going, defaults)
				const line = keptLine(kept)
				if (!going.length)
					return {
						title:
							kept.length === 1
								? `${kept[0].name ?? `Connection ${kept[0].id}`} comes with Serene Pub`
								: "These come with Serene Pub",
						summary:
							line +
							`To free space, use Delete from disk on one of ${kept.length === 1 ? "its" : "their"} models instead.`,
						objects: [],
						confirmLabel: ""
					}
				const deletion = connectionDeletion(going, defaults)
				return { ...deletion, summary: line + deletion.summary }
			},
			run: (selected) => {
				const ids = splitComesWithApp(selected).going.map((r) => r.id)
				releasing = [
					...new Set([
						...releasing,
						...managerFlagsReleased([...deleting, ...ids], rows)
					])
				]
				deleting = [...deleting, ...ids]
				for (const id of ids) socket.emit("connections:delete", { id })
			}
		}
	]

	function openView() {
		openInConnections(panelsCtx)
	}
</script>

<AdminChangelist
	title="Connections"
	purpose="The backends and services Serene Pub talks to, and the models each one serves. A connection does nothing until a loadout names it."
	{rows}
	rowKey={(r) => r.id}
	{columns}
	{filters}
	{bulkActions}
	{loading}
	noun={{ singular: "connection", plural: "connections" }}
	searchText={(r) =>
		`${r.name ?? ""} ${serviceLabel(r)} ${r.baseUrl ?? ""} ${modalityWord(r.modality)} ${r.notes ?? ""}`}
	rowHref={(r) => `/admin/connections/${r.id}`}
	addHref="/admin/connections/new"
	defaultSort="name"
	emptyIcon={Icons.Cable}
	emptyMessage="No connections yet. Add one to give Serene Pub a model to talk to."
>
	{#snippet headerActions()}
		<button
			type="button"
			class="btn btn-sm preset-tonal-surface"
			onclick={openView}
		>
			<Icons.Cable size={16} aria-hidden="true" />
			Open Connections view
		</button>
	{/snippet}
	{#snippet cell(row, col)}
		{#if col.key === "open"}
			<button
				type="button"
				class="btn btn-sm preset-tonal-surface whitespace-nowrap"
				aria-label="Open in Connections: {row.name ??
					`Connection ${row.id}`}"
				onclick={(e) => {
					e.stopPropagation()
					openInConnections(panelsCtx, { connectionId: row.id })
				}}
			>
				<Icons.Cable size={14} aria-hidden="true" />
				Open in Connections
			</button>
		{:else if col.key === "defaults"}
			{@const held = defaultsHeldBy(row, defaults)}
			{#if held.length}
				<span class="flex flex-wrap gap-1">
					{#each held as h (h.capability)}
						<Badge
							tone="primary"
							size="sm"
							title={h.modelName
								? `${h.label}: ${h.modelName}`
								: h.label}
						>
							{h.label}
						</Badge>
					{/each}
				</span>
			{:else}
				<span class="text-surface-600-400">—</span>
			{/if}
		{:else if col.key === "status"}
			{@const status = statusOf(row)}
			{@const marks = rowStatusClasses(status)}
			<!-- The index row's vocabulary (★R2 L4.1): a 6px dot and muted
			     words, red only when a loadout runs on a broken connection. -->
			<span
				class="text-chip inline-flex items-center gap-1.5 {marks.text}"
				title={status.detail ?? undefined}
			>
				<span
					class="size-1.5 shrink-0 rounded-full {marks.dot}"
					aria-hidden="true"
				></span>
				{status.label}
			</span>
		{/if}
	{/snippet}
</AdminChangelist>

<!--
	Requests at once. This governs requests in flight per host (the LLM lane
	width of each address) — never model residency or loading order. It is the
	first piece of the Servers direction (project_model_lane_lifecycle). The
	list and the "Saved" toast are the connections context's; this card
	listens to nothing and toasts nothing.
-->
<section
	class="panel-card @container/lanes mt-4 flex flex-col gap-3"
	aria-labelledby="llm-lanes-heading"
	data-section="llmLanes"
>
	<div class="flex flex-col gap-1">
		<h2 id="llm-lanes-heading" class="text-sm font-medium">
			Requests at once
		</h2>
		<p class="text-surface-700-300 text-sm">
			How many requests this server takes at once; one for a local model,
			more for a cloud provider.
		</p>
	</div>
	{#if connectionsCtx.llmLanes === null}
		<!-- Loading: the purpose sentence alone, until the list lands. -->
	{:else if connectionsCtx.llmLanes.length}
		<ul class="flex flex-col gap-2">
			{#each connectionsCtx.llmLanes as host (host.laneKey)}
				<li
					class="bg-surface-50-950 rounded-base flex flex-col gap-2 p-3 @md/lanes:flex-row @md/lanes:items-center @md/lanes:gap-4"
				>
					<div class="flex min-w-0 flex-1 flex-col gap-0.5">
						<span class="font-mono text-sm break-all">
							{host.laneKey}
						</span>
						<span class="text-surface-600-400 text-xs">
							{llmLaneUsedBy(host.connections)}
						</span>
					</div>
					<div class="flex flex-col gap-1 @md/lanes:items-end">
						<div class="flex items-center gap-2">
							<span
								class="text-surface-600-400 text-xs whitespace-nowrap"
							>
								Default {host.defaultWidth}
							</span>
							<input
								type="number"
								class="input w-20"
								min="1"
								max={LLM_LANE_WIDTH_MAX}
								step="1"
								placeholder={String(host.defaultWidth)}
								aria-label="Requests at once for {host.laneKey}"
								aria-invalid={laneRefusals[host.laneKey]
									? "true"
									: undefined}
								value={host.laneKey in laneEdits
									? laneEdits[host.laneKey]
									: host.width}
								oninput={(e) => {
									const raw = e.currentTarget.value
									laneEdits[host.laneKey] =
										raw === "" ? null : Number(raw)
								}}
								onchange={() => saveLane(host)}
							/>
						</div>
						{#if laneRefusals[host.laneKey]}
							<p class="text-error-600-400 text-xs" role="alert">
								{laneRefusals[host.laneKey]}
							</p>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="text-surface-600-400 text-sm">
			Add a connection and its address shows here.
		</p>
	{/if}
</section>
