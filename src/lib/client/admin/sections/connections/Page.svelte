<script lang="ts">
	/**
	 * Admin → Connections: the changelist (owner ruling 2026-09-27 — admin
	 * manages its objects Django-style instead of nesting the Connections
	 * view). Every connection on the instance with its service, modality,
	 * models, the defaults it holds and its state; filters, search, bulk
	 * delete. A row opens its change form at `/admin/connections/<id>`.
	 *
	 * The rows are `connections:list`, the same list the Connections view
	 * reads; deleting is `connections:delete`, one per row, plus the manager
	 * switch a managed runtime's last row takes with it (`managerFlagsReleased`).
	 */
	import { getContext, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { timeAgo } from "$lib/client/utils/timeAgo"
	import AdminPageHeader from "$lib/client/components/admin/AdminPageHeader.svelte"
	import AdminChangelist from "$lib/client/components/admin/AdminChangelist.svelte"
	import type {
		AdminBulkAction,
		AdminChangelistColumn,
		AdminChangelistFilter
	} from "$lib/client/components/admin/changelist"
	import { serviceLabel } from "$lib/client/components/connections/connectionIndexFilter"
	import {
		connectionRowStatus,
		stateTone,
		type RowStatus
	} from "$lib/client/components/connections/connectionRowStatus"
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
	function handleDelete(msg: Sockets.Connections.Delete.Response) {
		if (!deleting.includes(msg.id)) return
		deleting = deleting.filter((id) => id !== msg.id)
		if (!deleting.length) toaster.success({ title: "Deleted" })
	}
	useInterest<"connections:delete">("connections:delete", handleDelete)

	onMount(() => {
		socket.emit("connections:list", {})
	})

	const defaults = $derived(systemSettingsCtx?.capabilityDefaults ?? {})
	const statusOf = (r: Row): RowStatus =>
		connectionRowStatus(r as any, { kind: endpointKind(r.type), timeAgo })
	const STATE_ORDER = ["broken", "unfinished", "busy", "ready", "idle"]
	const DOT: Record<string, string> = {
		ok: "bg-success-500",
		quiet: "bg-surface-400-600",
		primary: "bg-primary-500",
		warning: "bg-warning-500",
		error: "bg-error-500"
	}

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
			label: "Default for",
			custom: true,
			sortValue: (r) => defaultsHeldBy(r, defaults).length || null
		},
		{
			key: "status",
			label: "Status",
			custom: true,
			sortValue: (r) => STATE_ORDER.indexOf(statusOf(r).state)
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
				for (const event of managerFlagsReleased(ids, rows))
					socket.emit(event, { enabled: false })
				deleting = [...deleting, ...ids]
				for (const id of ids) socket.emit("connections:delete", { id })
			}
		}
	]

	function openView() {
		panelsCtx?.openPanel({ key: "connections" })
	}
</script>

<AdminPageHeader
	title="Connections"
	purpose="The backends and services Serene Pub talks to, and the models each one serves. A connection does nothing until Defaults gives it a job."
>
	{#snippet actions()}
		<button type="button" class="btn btn-sm preset-tonal-surface" onclick={openView}>
			<Icons.Cable size={16} aria-hidden="true" />
			Open Connections view
		</button>
	{/snippet}
</AdminPageHeader>

<AdminChangelist
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
	{#snippet cell(row, col)}
		{#if col.key === "defaults"}
			{@const held = defaultsHeldBy(row, defaults)}
			{#if held.length}
				<span class="flex flex-wrap gap-1">
					{#each held as h (h.capability)}
						<span
							class="preset-tonal-primary rounded-full px-2 py-0.5 text-[11px]"
							title={h.modelName ? `${h.label}: ${h.modelName}` : h.label}
						>
							{h.label}
						</span>
					{/each}
				</span>
			{:else}
				<span class="text-surface-600-400">—</span>
			{/if}
		{:else if col.key === "status"}
			{@const status = statusOf(row)}
			<span class="inline-flex items-center gap-1.5" title={status.detail ?? undefined}>
				<span
					class="size-2 shrink-0 rounded-full {DOT[stateTone(status.state)]}"
					aria-hidden="true"
				></span>
				{status.label}
			</span>
		{/if}
	{/snippet}
</AdminChangelist>
