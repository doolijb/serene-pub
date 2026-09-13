<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { getContext } from "svelte"
	import { substituteBindings } from "$lib/client/components/lorebookForms/entryManager"
	import type { EntryRowProps } from "./types"
	import EntryMarks from "./EntryMarks.svelte"
	import { getLorePoolCtx } from "./poolContext"

	/**
	 * A history row reads as its date: the kind declares an `order` role and no
	 * title, so the date is the heading rather than a field beside one.
	 */
	let { item, source, bindings, vectorizationEnabled }: EntryRowProps =
		$props()

	const pool = getLorePoolCtx()
	const compileEntriesCtx: CompileEntriesCtx = getContext("compileEntriesCtx")

	let preview = $derived(substituteBindings(item.content, bindings))
	let scenes = $derived(pool.scenesOf(source.id))
	let compiling = $derived(
		compileEntriesCtx?.activities?.find(
			(a) => a.historyEntryId === source.id
		)
	)
</script>

<div class="mb-1 flex flex-wrap items-center gap-2 text-sm font-semibold">
	<span>{item.name}</span>
	{#if pool.isCurrentDate(source.id)}
		<span class="text-tertiary-500 text-xs font-normal">(Current)</span>
	{/if}
</div>
{#if preview.trim()}
	<p
		class="text-surface-600-400 line-clamp-2 text-xs leading-relaxed whitespace-pre-wrap"
	>
		{preview}
	</p>
{:else}
	<p class="text-surface-700-300 text-xs italic">No content yet.</p>
{/if}
<div class="mt-1.5 flex flex-wrap items-center gap-1">
	<EntryMarks entry={source} {vectorizationEnabled} showPriority={false} />
	{#if scenes.length > 0}
		<span
			class="preset-tonal-secondary rounded px-1.5 py-0.5 text-xs"
			title="{scenes.length} scene{scenes.length === 1 ? '' : 's'}"
		>
			<Icons.Film size={11} class="inline" />
			{scenes.length}
		</span>
	{/if}
	{#if compiling?.status === "running"}
		<button
			class="preset-filled-tertiary-500 rounded px-1.5 py-0.5 text-xs"
			title="Compiling. Click to view progress"
			onclick={(e) => {
				e.stopPropagation()
				pool.openCompile(source)
			}}
		>
			<Icons.Loader size={11} class="inline animate-spin" /> Compiling…
		</button>
	{:else if compiling?.status === "review"}
		<button
			class="preset-filled-warning-500 rounded px-1.5 py-0.5 text-xs"
			title="Review pending. Click to review"
			onclick={(e) => {
				e.stopPropagation()
				pool.openCompile(source)
			}}
		>
			<Icons.Eye size={11} class="inline" /> Review
		</button>
	{/if}
</div>
