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
	import { resolveSamplingValues } from "@serene-pub/sdk"
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

	/**
	 * Every sampling config registered as a capability default, by row id.
	 *
	 * A Set rather than a single id: one config is the default for THREE image
	 * capabilities (`text->image`, `text+image->image`, `image->image` share a
	 * vocabulary), and the old single `defaultSamplingConfigId` could only ever
	 * describe the text one. The badge says "in use", which is the fact this
	 * list can honestly assert — which capabilities is the Defaults screen's
	 * question.
	 */
	let inUseIds = $derived(
		new Set(
			Object.values(systemSettingsCtx.capabilityDefaults ?? {})
				.map((d) => d?.samplingConfigId)
				.filter((id): id is number => id != null)
		)
	)

	/**
	 * One parameter, as the config will actually use it.
	 *
	 * A row stores `{shape, values, enabled}`, and `values` deliberately keeps
	 * keys that are switched off or that the shape doesn't declare — so reading
	 * `values.temperature` straight would print a remembered number for a sampler
	 * this config never sends. This runs the same resolution an adapter is handed
	 * (enabled → shape → declared default), which is why an absent result is the
	 * honest answer and renders as a dash below.
	 */
	function param(row: Row, key: string): number | undefined {
		const value = resolveSamplingValues(row)[key]
		return typeof value === "number" ? value : undefined
	}

	const columns: AdminColumn<Row>[] = [
		{ key: "name", label: "Name", value: (r) => r.name },
		{ key: "kind", label: "Kind", value: (r) => (r.isImmutable ? 0 : 1) },
		{
			key: "temperature",
			label: "Temp",
			value: (r) => param(r, "temperature"),
			class: "text-right"
		},
		{
			key: "contextTokens",
			label: "Context",
			value: (r) => param(r, "contextTokens"),
			class: "text-right"
		},
		{
			key: "responseTokens",
			label: "Response",
			value: (r) => param(r, "responseTokens"),
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
			{#if row.id != null && inUseIds.has(row.id)}
				<span
					class="preset-tonal-primary ml-1.5 rounded-full px-1.5 py-0.5 text-[0.68rem] font-semibold"
					title="Registered as a capability default — see Admin → Defaults"
					>in use</span
				>
			{/if}
		{:else if col.key === "temperature"}
			<span class="font-mono text-xs"
				>{param(row, "temperature") ?? "—"}</span
			>
		{:else if col.key === "contextTokens"}
			<span class="font-mono text-xs"
				>{param(row, "contextTokens") ?? "—"}</span
			>
		{:else if col.key === "responseTokens"}
			<span class="font-mono text-xs"
				>{param(row, "responseTokens") ?? "—"}</span
			>
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
