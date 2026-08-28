<script lang="ts">
	/**
	 * Prompts — the changelist over **pipeline prompts** (the live 0.6 rows,
	 * `pipeline_prompts`), not the 0.5 archives: those live in the Legacy
	 * panel, offered while the "show legacy configs" system setting is on.
	 * Edit navigates to the prompt's dedicated change page. No create — core
	 * seeds one prompt per pipeline at startup; Clone is the way to a variant.
	 */
	import { onDestroy, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { goto } from "$app/navigation"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import AdminList, {
		type AdminColumn
	} from "$lib/client/components/admin/AdminList.svelte"

	type Prompt = Sockets.Pipelines.Library.LibraryPrompt

	const socket = useTypedSocket()

	let view = $state<Sockets.Pipelines.Library.Response>({})
	let loading = $state(true)

	function handleLibrary(res: Sockets.Pipelines.Library.Response) {
		view = res
		loading = false
	}
	function handleClone(res: Sockets.Pipelines.Library.Response) {
		view = res
	}

	onMount(() => {
		socket.on("pipelines:library", handleLibrary)
		socket.on("pipelines:libraryClonePrompt", handleClone)
		socket.emit("pipelines:library", {})
	})
	onDestroy(() => {
		socket.off("pipelines:library", handleLibrary)
		socket.off("pipelines:libraryClonePrompt", handleClone)
	})

	let rows = $derived((view.prompts ?? []) as Prompt[])

	const columns: AdminColumn<Prompt>[] = [
		{ key: "name", label: "Name", value: (r) => r.name },
		{ key: "spec", label: "Pipeline", value: (r) => r.specName },
		{
			key: "fields",
			label: "Fields",
			value: (r) => Object.keys(r.fields).length
		},
		{ key: "usedBy", label: "Used by", value: (r) => r.usedBy.length },
		{ key: "actions", label: "", class: "w-px text-right" }
	]
</script>

<div class="mb-4 flex flex-wrap items-start gap-3">
	<div class="flex-1">
		<h2 class="flex items-center gap-2 text-lg font-semibold">
			<Icons.MessageSquareText size={20} /> Prompts
		</h2>
		<p class="text-surface-600-400 text-sm">
			The pipelines' system prompts. Each belongs to one pipeline; clone
			one to make a variant. The 0.5 prompt archives live in the Legacy
			panel.
		</p>
	</div>
</div>

<AdminList
	{rows}
	{columns}
	{loading}
	searchText={(r) => `${r.name} ${r.specName} ${r.specSlug}`}
	searchPlaceholder="Search prompts…"
	defaultSort="spec"
	storageKey="serene-pub:adminView:prompts"
	emptyMessage="No prompts yet. Core seeds one per pipeline at startup."
	onRowClick={(r) => goto(`/admin/prompts/${r.id}`)}
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
		{:else if col.key === "spec"}
			<span class="text-surface-700-300 text-xs">{row.specName}</span>
		{:else if col.key === "fields"}
			<span class="text-xs">{Object.keys(row.fields).length}</span>
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
				href="/admin/prompts/{row.id}"
				onclick={(e) => e.stopPropagation()}
			>
				<Icons.Pencil size={13} /> Edit
			</a>
		{/if}
	{/snippet}
</AdminList>
