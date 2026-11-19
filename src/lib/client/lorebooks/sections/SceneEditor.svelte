<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { getContext } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import type { EntryEditorProps } from "./types"
	import SceneForm from "./SceneForm.svelte"
	import { getLorePoolCtx } from "./poolContext"
	import { bookReadOnly } from "../bookData.svelte"
	import EditHistory from "../editHistory/EditHistory.svelte"
	import { RESTORE_BLOCKED_UNSAVED } from "../editHistory/editHistoryCopy"

	/**
	 * A scene's page: what it is, and the one action that rewrites it.
	 *
	 * Processing runs against the saved messages, not the draft, so it is
	 * offered only for a scene that still has the messages it was captured
	 * from — a scene whose session is gone can be read and edited but never
	 * re-summarized.
	 */
	let {
		draft = $bindable(),
		source,
		bindings,
		lorebookId,
		isNew
	}: EntryEditorProps = $props()

	const socket = useTypedSocket()
	const pool = getLorePoolCtx()
	// Edit history is for people who can edit the book.
	const readOnly = bookReadOnly()
	const sceneSummarizesCtx: SceneSummarizesCtx =
		getContext("sceneSummarizesCtx")

	let activity = $derived(
		sceneSummarizesCtx?.activities?.find((a) => a.sceneId === source?.id)
	)
	let isProcessing = $derived(activity?.status === "running")
	let pending = $derived(activity?.status === "review" ? activity : undefined)
	let hasMessages = $derived((source?.selectedMessageIds?.length ?? 0) > 0)

	// The draft differs from the saved scene when any of the four fields the
	// form edits differs; the two lists compare as sorted ids.
	const ids = (list: unknown): string =>
		JSON.stringify(
			[...((list as number[] | undefined) ?? [])].sort((a, b) => a - b)
		)
	let unsaved = $derived.by(() => {
		if (!source) return false
		const d = $state.snapshot(draft)
		return (
			(d.name ?? "") !== (source.name ?? "") ||
			(d.summary ?? "") !== (source.summary ?? "") ||
			ids(d.participantCharacters) !== ids(source.participantCharacters) ||
			ids(d.mentionedCharacters) !== ids(source.mentionedCharacters)
		)
	})

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
			class="btn btn-sm preset-tonal-surface"
			type="button"
			onclick={() => pool.openProcess(source!.id, pending!.activityId)}
		>
			<Icons.Eye size={13} /> Review pending
		</button>
	{:else if hasMessages}
		<button
			class="btn btn-sm preset-tonal-surface"
			type="button"
			disabled={isProcessing}
			onclick={process}
		>
			{#if isProcessing}
				<Icons.Loader2 size={13} class="animate-spin" /> Processing…
			{:else if source?.summary}
				<Icons.RefreshCw size={13} /> Reprocess
			{:else}
				<Icons.Sparkles size={13} /> Process
			{/if}
		</button>
	{/if}
	{#if source && pool.onNavigateToGraph && !source.graphed && source.summary}
		<button
			class="btn btn-sm preset-tonal-primary"
			type="button"
			onclick={pool.onNavigateToGraph}
		>
			<Icons.GitGraph size={13} /> Build graph
		</button>
	{/if}
</div>

{#if source?.summaryStatus === "done" && source?.summaryOrigin === "routine"}
	<p class="text-surface-600-400 text-xs">
		Summarized by itself. You can edit it, or turn this off under Routines.
	</p>
{/if}

<SceneForm bind:draft {bindings} />

{#if source && !isNew && !readOnly.value}
	<EditHistory
		{lorebookId}
		sceneId={source.id}
		updatedAt={source.updatedAt ?? null}
		restoreBlocked={unsaved ? RESTORE_BLOCKED_UNSAVED : undefined}
		onRestore={(phase) => {
			if (phase === "done") pool.refreshScenes()
		}}
	/>
{/if}
