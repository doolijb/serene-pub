<script lang="ts">
	/**
	 * The configurations inventory (admin IA 2026-08-28): every named config
	 * across every pipeline, with its dependents — the reverse edges no
	 * single workspace can show. An index, on purpose, not an editor: a
	 * config is meaningless without its spec (its option space IS the spec's
	 * declarations), so rows deep-link into the owning workspace's Configure
	 * tab and editing stays one surface.
	 */
	import { getContext, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { adminGoto as goto } from "$lib/client/admin/adminRouter.svelte"
	import { requestWithInterest } from "$lib/client/sockets/interest.svelte"
	import AdminList, {
		type AdminColumn
	} from "$lib/client/components/admin/AdminList.svelte"
	import AdminPageHeader from "$lib/client/components/admin/AdminPageHeader.svelte"

	const userCtx: { user: SelectUser } = getContext("userCtx")

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
	})

	/**
	 * The inventory, asked for and listened for in one. BARE — it spans every
	 * pipeline, so there is nothing to scope it to.
	 *
	 * The app-wide registry, not `adminInterest`: `pipelines:` is a MIXED
	 * family — most of its handlers answer every user — so this is an ordinary
	 * key, and the admin check here is the same one the redirect above makes.
	 */
	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		return requestWithInterest("pipelines:configsIndex", {}, onIndex)
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

<div class="mx-auto w-full max-w-[1120px]">
<AdminPageHeader
	title="Configurations"
	purpose="Every named tuning across every pipeline, and what depends on each one. Edit a configuration in its pipeline's workspace."
/>

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
					class="preset-tonal-primary ml-1.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold"
					>default</span
				>
			{/if}
		{:else if col.key === "pipeline"}
			<span class="text-surface-700-300 text-xs">{row.specName}</span>
			<span class="text-surface-600-400 block font-mono text-[11px]">
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
</div>
