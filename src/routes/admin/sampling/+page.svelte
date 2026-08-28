<script lang="ts">
	/**
	 * Sampling — the Django-style changelist over sampling configs. New and
	 * Edit navigate to dedicated change pages. The list projects the
	 * glanceable numbers people compare presets by — temperature and the two
	 * token budgets — beside identity.
	 */
	import { getContext, onDestroy, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { goto } from "$app/navigation"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import AdminList, {
		type AdminColumn
	} from "$lib/client/components/admin/AdminList.svelte"

	const socket = useTypedSocket()
	let systemSettingsCtx: SystemSettingsCtx = getContext("systemSettingsCtx")

	type Row = Partial<SelectSamplingConfig>
	let rows: Row[] = $state([])
	let loading = $state(true)

	function handleList(res: Sockets.SamplingConfigs.List.Response) {
		rows = res.samplingConfigsList
		loading = false
	}

	onMount(() => {
		socket.on("samplingConfigs:list", handleList)
		socket.emit("samplingConfigs:list", {})
	})
	onDestroy(() => {
		socket.off("samplingConfigs:list", handleList)
	})

	let defaultId = $derived(
		systemSettingsCtx.settings?.defaultSamplingConfigId
	)

	const columns: AdminColumn<Row>[] = [
		{ key: "name", label: "Name", value: (r) => r.name },
		{ key: "kind", label: "Kind", value: (r) => (r.isImmutable ? 0 : 1) },
		{
			key: "temperature",
			label: "Temp",
			value: (r) => r.temperature,
			class: "text-right"
		},
		{
			key: "contextTokens",
			label: "Context",
			value: (r) => r.contextTokens,
			class: "text-right"
		},
		{
			key: "responseTokens",
			label: "Response",
			value: (r) => r.responseTokens,
			class: "text-right"
		},
		{ key: "actions", label: "", class: "w-px text-right" }
	]
</script>

<div class="mb-4 flex flex-wrap items-start gap-3">
	<div class="flex-1">
		<h2 class="flex items-center gap-2 text-lg font-semibold">
			<Icons.SlidersHorizontal size={20} /> Sampling
		</h2>
		<p class="text-surface-600-400 text-sm">
			Generation parameter presets. Pipelines and sessions reference these
			by config, so an edit lands everywhere the config is used.
		</p>
	</div>
	<a class="btn btn-sm preset-filled-primary-500" href="/admin/sampling/new">
		<Icons.Plus size={16} /> New config
	</a>
</div>

<AdminList
	{rows}
	{columns}
	{loading}
	searchText={(r) => r.name ?? ""}
	searchPlaceholder="Search sampling configs…"
	defaultSort="name"
	storageKey="serene-pub:adminView:sampling"
	emptyMessage="No sampling configs."
	onRowClick={(r) => r.id != null && goto(`/admin/sampling/${r.id}`)}
>
	{#snippet cell(row, col)}
		{#if col.key === "name"}
			<span class="font-semibold">{row.name}</span>
			{#if row.id != null && row.id === defaultId}
				<span
					class="preset-tonal-primary ml-1.5 rounded-full px-1.5 py-0.5 text-[0.68rem] font-semibold"
					>default</span
				>
			{/if}
		{:else if col.key === "temperature"}
			<span class="font-mono text-xs">{row.temperature ?? "—"}</span>
		{:else if col.key === "contextTokens"}
			<span class="font-mono text-xs">{row.contextTokens ?? "—"}</span>
		{:else if col.key === "responseTokens"}
			<span class="font-mono text-xs">{row.responseTokens ?? "—"}</span>
		{:else if col.key === "kind"}
			{#if row.isImmutable}
				<span
					class="preset-tonal-surface rounded-full px-2 py-0.5 text-xs"
					>Built-in</span
				>
			{:else}
				<span
					class="preset-tonal-secondary rounded-full px-2 py-0.5 text-xs"
					>Custom</span
				>
			{/if}
		{:else if col.key === "actions"}
			{#if row.id != null}
				<a
					class="btn btn-sm preset-tonal-surface"
					href="/admin/sampling/{row.id}"
					onclick={(e) => e.stopPropagation()}
				>
					<Icons.Pencil size={13} /> Edit
				</a>
			{/if}
		{/if}
	{/snippet}
</AdminList>
