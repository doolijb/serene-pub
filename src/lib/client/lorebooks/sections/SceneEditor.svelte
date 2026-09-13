<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { getContext } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import type { EntryEditorProps } from "./types"
	import SceneForm from "./SceneForm.svelte"
	import { getLorePoolCtx } from "./poolContext"

	/**
	 * A scene's page: what it is, and the one action that rewrites it.
	 *
	 * Processing runs against the saved messages, not the draft, so it is
	 * offered only for a scene that still has the messages it was captured
	 * from — a scene whose session is gone can be read and edited but never
	 * re-summarized.
	 */
	let { draft = $bindable(), source, bindings }: EntryEditorProps = $props()

	const socket = useTypedSocket()
	const pool = getLorePoolCtx()
	const sceneSummarizesCtx: SceneSummarizesCtx =
		getContext("sceneSummarizesCtx")

	let activity = $derived(
		sceneSummarizesCtx?.activities?.find((a) => a.sceneId === source?.id)
	)
	let isProcessing = $derived(activity?.status === "running")
	let pending = $derived(activity?.status === "review" ? activity : undefined)
	let hasMessages = $derived((source?.selectedMessageIds?.length ?? 0) > 0)

	function process() {
		if (!source) return
		pool.openProcess(source.id, null)
		socket.emit("scenes:process", {
			sceneId: source.id
		} satisfies Sockets.Scenes.Process.Params)
	}
</script>

<div class="flex flex-wrap items-center gap-2">
	{#if source?.graphed}
		<span class="preset-tonal-success rounded px-2 py-1 text-xs">
			<Icons.GitGraph size={13} class="inline" /> In the graph
		</span>
	{/if}
	{#if source?.sessionName}
		<span class="text-surface-700-300 text-xs">
			<Icons.MessageSquare size={11} class="inline" />
			{source.sessionName}
			{#if source.selectedMessageIds?.length}
				· {source.selectedMessageIds.length} messages
			{/if}
		</span>
	{/if}
</div>

<div class="flex flex-wrap gap-2">
	{#if pending}
		<button
			class="btn btn-sm preset-filled-warning-500"
			type="button"
			onclick={() => pool.openProcess(source!.id, pending!.activityId)}
		>
			<Icons.Eye size={13} /> Review Pending
		</button>
	{:else if hasMessages}
		<button
			class="btn btn-sm preset-filled-surface-400-600"
			type="button"
			disabled={isProcessing}
			onclick={process}
		>
			{#if isProcessing}
				<Icons.Loader size={13} class="animate-spin" /> Processing…
			{:else if source?.summary}
				<Icons.RefreshCw size={13} /> Reprocess
			{:else}
				<Icons.Sparkles size={13} /> Process
			{/if}
		</button>
	{/if}
	{#if source && pool.onNavigateToGraph && !source.graphed && source.summary}
		<button
			class="btn btn-sm preset-tonal-secondary"
			type="button"
			onclick={pool.onNavigateToGraph}
		>
			<Icons.GitGraph size={13} /> Build Graph
		</button>
	{/if}
</div>

<SceneForm bind:draft {bindings} />
