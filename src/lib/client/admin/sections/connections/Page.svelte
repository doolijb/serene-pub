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
	import { toaster } from "$lib/client/utils/toaster"
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
	import { endpointKind } from "$lib/client/components/connections/modelManagement"
	import {
		MODALITY_ORDER,
		connectionDeletion,
		defaultsHeldBy,
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
		toaster.success({ title: "Deleted" })
	}
	useInterest<"connections:delete">("connections:delete", handleDelete)

	onMount(() => {
		socket.emit("connections:list", {})
	})

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
			optionLabel: (v) => (v === "holds" ? "Holds a default" : "Holds none"),
			order: ["holds", "none"]
		}
	]

	const bulkActions: AdminBulkAction<Row>[] = [
		{
			key: "delete",
			label: "Delete selected connections…",
			icon: Icons.Trash2,
			destructive: true,
			confirm: (selected) => connectionDeletion(selected, defaults),
			run: (selected) => {
				const ids = selected.map((r) => r.id)
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
		<button type="button" class="btn btn-sm preset-tonal-surface" onclick={openView}>
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
						<Badge tone="primary" size="sm" title={h.modelName ? `${h.label}: ${h.modelName}` : h.label}>
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
				class="inline-flex items-center gap-1.5 text-chip {marks.text}"
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
