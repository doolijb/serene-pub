<script lang="ts">
	/**
	 * The configurations inventory (admin IA 2026-08-28): every named config
	 * across every pipeline, with its dependents — the reverse edges no
	 * single workspace can show. An index, deliberately not an editor: a
	 * config is meaningless without its spec (its option space IS the spec's
	 * declarations), so rows deep-link into the owning workspace's Configure
	 * tab and editing stays one surface.
	 */
	import { getContext, onDestroy, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { goto } from "$app/navigation"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import AdminList, {
		type AdminColumn
	} from "$lib/client/components/admin/AdminList.svelte"

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const socket = useTypedSocket()

	type Row = Sockets.Pipelines.ConfigsIndex.Row
	let rows: Row[] = $state([])
	let loading = $state(true)

	const onIndex = (res: Sockets.Pipelines.ConfigsIndex.Response) => {
		rows = res.configs
		loading = false
	}

	onMount(() => {
		if (!userCtx.user?.isAdmin) {
			goto("/")
			return
		}
		socket.on("pipelines:configsIndex", onIndex)
		socket.emit("pipelines:configsIndex", {})
	})
	onDestroy(() => {
		socket.off("pipelines:configsIndex", onIndex)
	})

	const workspaceHref = (r: Row) =>
		`/admin/pipelines/${encodeURIComponent(r.specSlug)}?config=${r.id}`

	const columns: AdminColumn<Row>[] = [
		{ key: "name", label: "Configuration", value: (r) => r.name },
		{ key: "pipeline", label: "Pipeline", value: (r) => r.specName },
		{
			key: "usedByPresets",
			label: "Presets",
			value: (r) => r.usedByPresets,
			class: "text-right"
		},
		{
			key: "usedBySessions",
			label: "Sessions",
			value: (r) => r.usedBySessions,
			class: "text-right"
		},
		{
			key: "kind",
			label: "Kind",
			value: (r) => (r.isImmutable ? 0 : 1)
		},
		{ key: "actions", label: "", class: "w-px text-right" }
	]
</script>

<div class="mb-4 flex flex-wrap items-start gap-3">
	<div class="flex-1">
		<h2 class="flex items-center gap-2 text-lg font-semibold">
			<Icons.SlidersVertical size={20} /> Configurations
		</h2>
		<p class="text-surface-600-400 text-sm">
			Every named tuning across every pipeline, and what depends on each
			one. Editing happens in the pipeline's own workspace — a
			configuration's options are its pipeline's declarations.
		</p>
	</div>
</div>

<AdminList
	{rows}
	{columns}
	{loading}
	searchText={(r) => `${r.name} ${r.specName} ${r.specSlug}`}
	searchPlaceholder="Search configurations…"
	defaultSort="pipeline"
	storageKey="serene-pub:adminView:configurations"
	emptyMessage="No configurations — every pipeline ships one at startup, so an empty list means the bootstrap failed."
	onRowClick={(r) => goto(workspaceHref(r))}
>
	{#snippet cell(row, col)}
		{#if col.key === "name"}
			<span class="font-semibold">{row.name}</span>
			{#if row.isDefault}
				<span
					class="preset-tonal-primary ml-1.5 rounded-full px-1.5 py-0.5 text-[0.68rem] font-semibold"
					>default</span
				>
			{/if}
		{:else if col.key === "pipeline"}
			<span class="text-surface-700-300 text-xs">{row.specName}</span>
			<span class="text-surface-600-400 block font-mono text-[10px]">
				{row.specSlug}
			</span>
		{:else if col.key === "usedByPresets"}
			<span class="text-xs">{row.usedByPresets || "—"}</span>
		{:else if col.key === "usedBySessions"}
			<span class="text-xs">{row.usedBySessions || "—"}</span>
		{:else if col.key === "kind"}
			{#if row.isImmutable}
				<span
					class="preset-tonal-surface rounded-full px-2 py-0.5 text-xs"
				>
					<Icons.Lock size={10} class="mr-0.5 inline" />shipped
				</span>
			{:else}
				<span
					class="preset-tonal-secondary rounded-full px-2 py-0.5 text-xs"
					>custom</span
				>
			{/if}
		{:else if col.key === "actions"}
			<a
				class="btn btn-sm preset-tonal-surface"
				href={workspaceHref(row)}
				onclick={(e) => e.stopPropagation()}
			>
				<Icons.Settings2 size={13} /> Open in workspace
			</a>
		{/if}
	{/snippet}
</AdminList>
