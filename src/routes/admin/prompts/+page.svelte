<script lang="ts">
	/**
	 * Prompts — the changelist over **pipeline prompts** (the live 0.6 rows,
	 * `pipeline_prompts`), not the 0.5 archives: those live in the Legacy
	 * panel, offered while the "show legacy configs" system setting is on.
	 * Edit navigates to the prompt's dedicated change page. No create — core
	 * seeds the prose it ships at startup; Clone is the way to a variant.
	 *
	 * ## Listed by pool, not by pipeline
	 *
	 * The "Pipeline" column here used to be the row's identity. It is not one
	 * any more: a prompt is pooled by the *step* that consumes it and follows
	 * that step into every pipeline reusing it, so there is no single pipeline
	 * to name. The pool is what the list sorts and groups on, and where a row
	 * was written survives as a secondary line, which is a fact about its
	 * history rather than a claim about its scope.
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
		// Sorted by the pool label, which is what puts every prompt for one
		// step together — the closest a flat changelist gets to grouping, and
		// the same ordering the library page reaches with headings.
		{ key: "pool", label: "Step", value: (r) => r.poolLabel },
		{
			key: "fields",
			label: "Fields",
			value: (r) => Object.keys(r.fields).length
		},
		// Shown as its own column rather than folded into "Fields": archived
		// text is the thing a person comes here looking for after a step
		// dropped a field, and a count buried in another number would not
		// tell them which row to open.
		{
			key: "archived",
			label: "Archived",
			value: (r) => Object.keys(r.archived ?? {}).length
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
			The pipelines' authored prose. Each belongs to a <em>step</em>
			rather than to a pipeline, so it is offered anywhere that step is reused;
			clone one to make a variant. The 0.5 prompt archives live in the Legacy
			panel.
		</p>
	</div>
</div>

<AdminList
	{rows}
	{columns}
	{loading}
	searchText={(r) => `${r.name} ${r.poolLabel} ${r.origin ?? ""}`}
	searchPlaceholder="Search prompts…"
	defaultSort="pool"
	storageKey="serene-pub:adminView:prompts"
	emptyMessage="No prompts yet. Core seeds the prose it ships at startup."
	onRowClick={(r) => goto(`/admin/prompts/${r.id}`)}
>
	{#snippet cell(row, col)}
		{#if col.key === "name"}
			<span class="font-semibold">{row.name}</span>
			{#if row.isImmutable}
				<span
					class="preset-tonal-surface ml-1.5 rounded-full px-1.5 py-0.5 text-[0.68rem]"
				>
					built-in
				</span>
			{/if}
		{:else if col.key === "pool"}
			<span class="text-surface-700-300 text-xs">{row.poolLabel}</span>
			{#if row.origin}
				<!-- Where it was written, not where it belongs — a prompt is
				     offered wherever its step is reused. -->
				<span class="text-surface-600-400 block text-[0.68rem]">
					written in {row.origin}
				</span>
			{/if}
		{:else if col.key === "fields"}
			<span class="text-xs">{Object.keys(row.fields).length}</span>
		{:else if col.key === "archived"}
			{#if Object.keys(row.archived ?? {}).length}
				<span
					class="preset-tonal-warning rounded-full px-2 py-0.5 text-xs"
					title={Object.keys(row.archived).join(", ")}
				>
					{Object.keys(row.archived).length}
				</span>
			{:else}
				<span class="text-surface-600-400 text-xs">—</span>
			{/if}
		{:else if col.key === "usedBy"}
			{#if row.usedBy.length}
				<span
					class="preset-tonal-secondary rounded-full px-2 py-0.5 text-xs"
					title={row.usedBy.join(", ")}
				>
					{row.usedBy.length} pipeline{row.usedBy.length === 1
						? ""
						: "s"}
				</span>
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
