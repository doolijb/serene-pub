<script lang="ts">
	/**
	 * The changelist half of the template admin (context templates and
	 * variable templates share everything but their pool vocabulary). Rows
	 * come from the pipeline library view; New and Edit navigate to dedicated
	 * change pages (Django's changelist → change-form flow), never an inline
	 * editor.
	 */
	import { onDestroy, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { goto } from "$app/navigation"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import AdminList, {
		type AdminColumn
	} from "$lib/client/components/admin/AdminList.svelte"

	type Template = Sockets.Pipelines.Library.LibraryTemplate

	interface Props {
		kind: "context" | "variable"
		title: string
		description: string
		/** Route base, e.g. `/admin/context-templates`. */
		basePath: string
		storageKey: string
	}
	let { kind, title, description, basePath, storageKey }: Props = $props()

	const socket = useTypedSocket()

	let view = $state<Sockets.Pipelines.Library.Response>({})
	let loading = $state(true)

	function handleLibrary(res: Sockets.Pipelines.Library.Response) {
		view = res
		loading = false
	}

	onMount(() => {
		socket.on("pipelines:library", handleLibrary)
		socket.emit("pipelines:library", {})
	})
	onDestroy(() => {
		socket.off("pipelines:library", handleLibrary)
	})

	let rows = $derived(
		(kind === "context"
			? (view.contextTemplates ?? [])
			: (view.variableTemplates ?? [])) as Template[]
	)

	const columns: AdminColumn<Template>[] = [
		{ key: "name", label: "Name", value: (r) => r.name },
		{ key: "pool", label: "Pool", value: (r) => r.poolLabel },
		{ key: "engine", label: "Engine", value: (r) => r.engine ?? "" },
		{ key: "usedBy", label: "Used by", value: (r) => r.usedBy.length },
		{ key: "actions", label: "", class: "w-px text-right" }
	]
</script>

<div class="mb-4 flex flex-wrap items-start gap-3">
	<div class="flex-1">
		<h2 class="flex items-center gap-2 text-lg font-semibold">
			{#if kind === "context"}
				<Icons.LayoutTemplate size={20} />
			{:else}
				<Icons.Braces size={20} />
			{/if}
			{title}
		</h2>
		<p class="text-surface-600-400 text-sm">{description}</p>
	</div>
	<a class="btn btn-sm preset-filled-primary-500" href="{basePath}/new">
		<Icons.Plus size={16} /> New template
	</a>
</div>

<AdminList
	{rows}
	{columns}
	{loading}
	searchText={(r) => `${r.name} ${r.poolLabel} ${r.engine ?? ""}`}
	searchPlaceholder="Search templates…"
	defaultSort="name"
	{storageKey}
	emptyMessage="No templates yet."
	onRowClick={(r) => goto(`${basePath}/${r.id}`)}
>
	{#snippet cell(row, col)}
		{#if col.key === "name"}
			<span class="font-semibold">{row.name}</span>
			{#if row.isImmutable}
				<span
					class="preset-tonal-surface ml-1.5 rounded-full px-1.5 py-0.5 text-[0.68rem]"
					>built-in</span
				>
			{/if}
		{:else if col.key === "pool"}
			<span class="text-surface-700-300 text-xs">{row.poolLabel}</span>
		{:else if col.key === "engine"}
			<span class="font-mono text-xs">{row.engine ?? "default"}</span>
		{:else if col.key === "usedBy"}
			{#if row.usedBy.length}
				<span
					class="preset-tonal-secondary rounded-full px-2 py-0.5 text-xs"
					title={row.usedBy.join(", ")}
					>{row.usedBy.length} pipeline{row.usedBy.length === 1
						? ""
						: "s"}</span
				>
			{:else}
				<span class="text-surface-600-400 text-xs">unused</span>
			{/if}
		{:else if col.key === "actions"}
			<a
				class="btn btn-sm preset-tonal-surface"
				href="{basePath}/{row.id}"
				onclick={(e) => e.stopPropagation()}
			>
				<Icons.Pencil size={13} /> Edit
			</a>
		{/if}
	{/snippet}
</AdminList>
