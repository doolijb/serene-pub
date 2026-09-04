<script lang="ts">
	/**
	 * Connections — the Django-style changelist: sortable, real-time
	 * searchable, paginated, table or cards. New and Edit navigate to
	 * dedicated change pages (`/admin/connections/new`, `/admin/connections/[id]`).
	 */
	import { getContext, onDestroy, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { goto } from "$app/navigation"
	import { capabilityLabel } from "@serene-pub/sdk"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import AdminList, {
		type AdminColumn
	} from "$lib/client/components/admin/AdminList.svelte"

	const socket = useTypedSocket()
	let systemSettingsCtx: SystemSettingsCtx = getContext("systemSettingsCtx")

	type Row = Partial<SelectConnection>
	let rows: Row[] = $state([])
	let loading = $state(true)

	function handleList(res: Sockets.Connections.List.Response) {
		rows = res.connectionsList
		loading = false
	}

	onMount(() => {
		socket.on("connections:list", handleList)
		socket.emit("connections:list", {})
	})
	onDestroy(() => {
		socket.off("connections:list", handleList)
	})

	/**
	 * Which capabilities this connection is registered for, as a badge.
	 *
	 * There is no single "the default" any more, and pretending otherwise is
	 * what the old `defaultConnectionId` badge did: one KoboldCPP row can be the
	 * chat default AND the image default, and a lone "default" pill said neither
	 * which nor how many. `connection_defaults` is keyed by capability, so the
	 * changelist reads it that way and names them.
	 */
	let defaultsFor = $derived.by(() => {
		const by = new Map<number, string[]>()
		for (const [capability, row] of Object.entries(
			systemSettingsCtx.capabilityDefaults ?? {}
		)) {
			if (row?.connectionId == null) continue
			by.set(row.connectionId, [
				...(by.get(row.connectionId) ?? []),
				capabilityLabel(capability as any)
			])
		}
		return by
	})

	const columns: AdminColumn<Row>[] = [
		{ key: "name", label: "Name", value: (r) => r.name },
		{ key: "type", label: "Adapter", value: (r) => r.type },
		{ key: "modality", label: "Modality", value: (r) => r.modality },
		{ key: "model", label: "Model", value: (r) => r.model },
		{ key: "baseUrl", label: "Endpoint", value: (r) => r.baseUrl },
		{ key: "actions", label: "", class: "w-px text-right" }
	]
</script>

<div class="mb-4 flex flex-wrap items-start gap-3">
	<div class="flex-1">
		<h2 class="flex items-center gap-2 text-lg font-semibold">
			<Icons.Cable size={20} /> Connections
		</h2>
		<p class="text-surface-600-400 text-sm">
			Adapters that link Serene Pub to model backends and services, across
			every modality. A connection is not used by anything until it is
			registered on
			<a class="underline" href="/admin/defaults">Defaults</a>.
		</p>
	</div>
	<a class="btn btn-sm preset-filled-primary-500" href="/admin/connections/new">
		<Icons.Plus size={16} /> New connection
	</a>
</div>

<AdminList
	{rows}
	{columns}
	{loading}
	searchText={(r) =>
		`${r.name ?? ""} ${r.type ?? ""} ${r.modality ?? ""} ${r.model ?? ""} ${r.baseUrl ?? ""}`}
	searchPlaceholder="Search connections…"
	defaultSort="name"
	storageKey="serene-pub:adminView:connections"
	emptyMessage="No connections yet — create one to get started."
	onRowClick={(r) => r.id != null && goto(`/admin/connections/${r.id}`)}
>
	{#snippet cell(row, col)}
		{#if col.key === "name"}
			<span class="font-semibold">{row.name}</span>
			{#each (row.id != null && defaultsFor.get(row.id)) || [] as capability (capability)}
				<span
					class="preset-tonal-primary ml-1.5 rounded-full px-1.5 py-0.5 text-[0.68rem] font-semibold"
					title="Registered on Admin → Defaults"
					>{capability}</span
				>
			{/each}
		{:else if col.key === "type"}
			<span
				class="preset-tonal-secondary rounded-full px-2 py-0.5 text-xs font-medium"
				>{row.type}</span
			>
		{:else if col.key === "modality"}
			<span class="text-surface-700-300 text-xs">{row.modality ?? "—"}</span>
		{:else if col.key === "model"}
			<span class="font-mono text-xs">{row.model ?? "—"}</span>
		{:else if col.key === "baseUrl"}
			<span class="text-surface-700-300 font-mono text-xs"
				>{row.baseUrl ?? "—"}</span
			>
		{:else if col.key === "actions"}
			{#if row.id != null}
				<a
					class="btn btn-sm preset-tonal-surface"
					href="/admin/connections/{row.id}"
					onclick={(e) => e.stopPropagation()}
				>
					<Icons.Pencil size={13} /> Edit
				</a>
			{/if}
		{/if}
	{/snippet}
</AdminList>
